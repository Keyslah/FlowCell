Set-StrictMode -Version Latest

# This helper is dot-sourced by package-portable.ps1. Stop-Package and
# $RepoRoot are supplied by that release driver.

function Convert-ToSafeRelativeFolder([string]$Value, [string]$FieldName, [string]$ProgramName) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Stop-Package "Program '$ProgramName' has an empty $FieldName in flowcell.program.json."
  }

  $normalized = $Value.Trim().Replace('\', '/').Trim('/')
  $segments = @($normalized.Split('/') | Where-Object { $_ -ne '' })
  if (
    [System.IO.Path]::IsPathRooted($Value) -or
    $segments.Count -eq 0 -or
    @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0
  ) {
    Stop-Package "Program '$ProgramName' has an unsafe $FieldName in flowcell.program.json: $Value"
  }

  return ($segments -join '/')
}

function Get-ProgramPackageContract([System.IO.DirectoryInfo]$ProgramDirectory) {
  $manifestPath = Join-Path $ProgramDirectory.FullName 'flowcell.program.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Stop-Package "Program manifest missing: $manifestPath"
  }

  try {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  } catch {
    Stop-Package "Program manifest is not valid JSON: $manifestPath ($($_.Exception.Message))"
  }

  $mutableFolders = @(
    Convert-ToSafeRelativeFolder ([string]$manifest.panelsFolder) 'panelsFolder' $ProgramDirectory.Name
    Convert-ToSafeRelativeFolder ([string]$manifest.localScriptsFolder) 'localScriptsFolder' $ProgramDirectory.Name
  )

  return [pscustomobject]@{
    ManifestPath = $manifestPath
    Manifest = $manifest
    MutableFolders = $mutableFolders
  }
}

function Assert-NoReparsePathComponents(
  [string]$Root,
  [string]$Candidate,
  [string]$Description
) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $candidateFull = [System.IO.Path]::GetFullPath($Candidate)
  $rootPrefix = "$rootFull$([System.IO.Path]::DirectorySeparatorChar)"
  if (
    -not $candidateFull.Equals($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -and
    -not $candidateFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    Stop-Package "$Description escaped its program package root: $candidateFull"
  }

  $relative = $candidateFull.Substring($rootFull.Length).TrimStart('\', '/')
  $current = $rootFull
  $pathsToCheck = New-Object System.Collections.Generic.List[string]
  $pathsToCheck.Add($current) | Out-Null
  if (-not [string]::IsNullOrWhiteSpace($relative)) {
    foreach ($segment in @($relative -split '[\\/]' | Where-Object { $_ -ne '' })) {
      $current = Join-Path $current $segment
      $pathsToCheck.Add($current) | Out-Null
    }
  }

  foreach ($path in $pathsToCheck) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }
    $item = Get-Item -LiteralPath $path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Stop-Package "$Description traverses a link or reparse point: $path"
    }
  }
}

function Assert-TrackedProgramReference(
  [System.IO.DirectoryInfo]$ProgramDirectory,
  [string[]]$TrackedFiles,
  [string]$RelativePath,
  [string]$FieldName,
  [switch]$RequireFile
) {
  $normalized = Convert-ToSafeRelativeFolder $RelativePath $FieldName $ProgramDirectory.Name
  $programRoot = "Programs/$($ProgramDirectory.Name)"
  $repoRelative = "$programRoot/$normalized"
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $ProgramDirectory.FullName ($normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar))))
  Assert-NoReparsePathComponents $ProgramDirectory.FullName $candidate "Program '$($ProgramDirectory.Name)' manifest field '$FieldName'"

  if (-not (Test-Path -LiteralPath $candidate)) {
    Stop-Package "Program '$($ProgramDirectory.Name)' manifest field '$FieldName' was not found: $normalized"
  }
  if ($RequireFile -and -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    Stop-Package "Program '$($ProgramDirectory.Name)' manifest field '$FieldName' must name a file: $normalized"
  }

  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    if (-not ($TrackedFiles -contains $repoRelative)) {
      Stop-Package "Program '$($ProgramDirectory.Name)' manifest field '$FieldName' is not Git-tracked: $normalized"
    }
    return $candidate
  }

  $trackedPrefix = "$repoRelative/"
  $trackedDescendants = @($TrackedFiles | Where-Object {
    $_.StartsWith($trackedPrefix, [System.StringComparison]::OrdinalIgnoreCase)
  })
  if ($trackedDescendants.Count -eq 0) {
    Stop-Package "Program '$($ProgramDirectory.Name)' manifest field '$FieldName' has no Git-tracked package files: $normalized"
  }
  return $candidate
}

function Assert-ProgramManifestReferencesTracked(
  [System.IO.DirectoryInfo]$ProgramDirectory,
  $Manifest,
  [string[]]$TrackedFiles
) {
  $supportScriptsFolder = Convert-ToSafeRelativeFolder ([string]$Manifest.supportScriptsFolder) 'supportScriptsFolder' $ProgramDirectory.Name
  if ($Manifest.PSObject.Properties['runner'] -and $null -ne $Manifest.runner) {
    foreach ($runnerField in @('installScript', 'deleteScript')) {
      if (-not $Manifest.runner.PSObject.Properties[$runnerField]) {
        continue
      }
      $runnerPath = ([string]$Manifest.runner.$runnerField).Trim()
      if ([string]::IsNullOrWhiteSpace($runnerPath)) {
        continue
      }
      $runnerRelative = Convert-ToSafeRelativeFolder $runnerPath "runner.$runnerField" $ProgramDirectory.Name
      [void](Assert-TrackedProgramReference `
        $ProgramDirectory `
        $TrackedFiles `
        "$supportScriptsFolder/$runnerRelative" `
        "runner.$runnerField" `
        -RequireFile)
    }
  }

  if (-not $Manifest.PSObject.Properties['bundledSources'] -or $null -eq $Manifest.bundledSources) {
    return
  }

  $sourceIndex = 0
  foreach ($source in @($Manifest.bundledSources)) {
    $fieldPrefix = "bundledSources[$sourceIndex]"
    $sourcePath = Assert-TrackedProgramReference `
      $ProgramDirectory `
      $TrackedFiles `
      ([string]$source.sourcePath) `
      "$fieldPrefix.sourcePath"

    if (Test-Path -LiteralPath $sourcePath -PathType Container) {
      $importKind = ([string]$source.importKind).Trim().ToLowerInvariant()
      $packageManifestName = if ($importKind -eq 'tool-set' -or $importKind -eq 'toolset') {
        'flowcell.toolset.json'
      } elseif ($importKind -eq 'script') {
        'flowcell.script.json'
      } else {
        Stop-Package "Program '$($ProgramDirectory.Name)' has an unsupported $fieldPrefix.importKind: $($source.importKind)"
      }
      $sourceRelative = Convert-ToSafeRelativeFolder ([string]$source.sourcePath) "$fieldPrefix.sourcePath" $ProgramDirectory.Name
      $packageManifestRelative = "$sourceRelative/$packageManifestName"
      $packageManifestPath = Assert-TrackedProgramReference `
        $ProgramDirectory `
        $TrackedFiles `
        $packageManifestRelative `
        "$fieldPrefix package manifest" `
        -RequireFile
      try {
        $packageManifest = Get-Content -LiteralPath $packageManifestPath -Raw | ConvertFrom-Json
      } catch {
        Stop-Package "Program '$($ProgramDirectory.Name)' bundled package manifest is invalid JSON: $packageManifestPath ($($_.Exception.Message))"
      }
      $declaredSource = ([string]$packageManifest.source).Trim()
      if ([string]::IsNullOrWhiteSpace($declaredSource)) {
        Stop-Package "Program '$($ProgramDirectory.Name)' bundled package manifest is missing source: $packageManifestPath"
      }
      $declaredSourceRelative = Convert-ToSafeRelativeFolder $declaredSource "$fieldPrefix package source" $ProgramDirectory.Name
      [void](Assert-TrackedProgramReference `
        $ProgramDirectory `
        $TrackedFiles `
        "$sourceRelative/$declaredSourceRelative" `
        "$fieldPrefix package source" `
        -RequireFile)
    }
    $sourceIndex++
  }
}

function Get-TrackedProgramFiles([System.IO.DirectoryInfo]$ProgramDirectory) {
  $relativeProgramRoot = "Programs/$($ProgramDirectory.Name)"
  $trackedFiles = @(
    & git -C $RepoRoot -c core.quotePath=false ls-files -- $relativeProgramRoot |
      ForEach-Object { $_.Replace('\', '/') } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  if ($LASTEXITCODE -ne 0) {
    Stop-Package "git ls-files failed for $relativeProgramRoot. Program packages require a Git worktree."
  }
  if ($trackedFiles.Count -eq 0) {
    Stop-Package "Program '$($ProgramDirectory.Name)' has no Git-tracked package files. Commit its payload before packaging."
  }

  $expectedManifest = "$relativeProgramRoot/flowcell.program.json"
  if (-not ($trackedFiles -contains $expectedManifest)) {
    Stop-Package "Program '$($ProgramDirectory.Name)' does not have a Git-tracked flowcell.program.json."
  }

  return $trackedFiles
}

function Copy-TrackedProgramFolder(
  [System.IO.DirectoryInfo]$ProgramDirectory,
  [string]$Destination,
  [string[]]$TrackedFiles
) {
  $relativeProgramRoot = "Programs/$($ProgramDirectory.Name)"
  $sourceRoot = [System.IO.Path]::GetFullPath($ProgramDirectory.FullName).TrimEnd('\', '/')
  $destinationRoot = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')

  foreach ($trackedFile in $TrackedFiles) {
    $normalized = $trackedFile.Replace('\', '/')
    $prefix = "$relativeProgramRoot/"
    if (-not $normalized.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      Stop-Package "Tracked program path escaped its package root: $trackedFile"
    }

    $programRelativePath = $normalized.Substring($prefix.Length)
    $segments = @($programRelativePath.Split('/') | Where-Object { $_ -ne '' })
    if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
      Stop-Package "Tracked program path is unsafe: $trackedFile"
    }

    $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
    $destinationPath = [System.IO.Path]::GetFullPath((Join-Path $destinationRoot ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
    if (
      -not $sourcePath.StartsWith("$sourceRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase) -or
      -not $destinationPath.StartsWith("$destinationRoot$([System.IO.Path]::DirectorySeparatorChar)", [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      Stop-Package "Tracked program path escaped its package root: $trackedFile"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      Stop-Package "Tracked program file is missing from the worktree: $trackedFile"
    }

    Assert-NoReparsePathComponents $sourceRoot $sourcePath "Tracked program file '$trackedFile'"

    New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  }
}

function Assert-ProgramPackageEntries(
  [string[]]$EntryNames,
  [string]$ProgramName,
  [string[]]$MutableFolders,
  [string]$SourceDescription
) {
  $programRoot = "Programs/$ProgramName"
  $programPrefix = "$programRoot/"
  $manifestEntry = "$programRoot/flowcell.program.json"
  $hasManifest = $false

  foreach ($entryName in $EntryNames) {
    $normalized = $entryName.Replace('\', '/').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($normalized)) {
      continue
    }

    $segments = @($normalized.Split('/') | Where-Object { $_ -ne '' })
    if (
      $normalized.StartsWith('/') -or
      $normalized -match '^[A-Za-z]:' -or
      @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0
    ) {
      Stop-Package "$SourceDescription contains an unsafe member: $entryName"
    }
    if (
      -not $normalized.Equals('Programs', [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $normalized.Equals($programRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $normalized.StartsWith($programPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
      Stop-Package "$SourceDescription contains content outside Programs/${ProgramName}: $entryName"
    }

    if ($normalized.Equals($manifestEntry, [System.StringComparison]::OrdinalIgnoreCase)) {
      $hasManifest = $true
    }

    foreach ($segment in $segments) {
      if (
        $segment.Equals('Panels', [System.StringComparison]::OrdinalIgnoreCase) -or
        $segment.EndsWith(' Local Scripts', [System.StringComparison]::OrdinalIgnoreCase)
      ) {
        Stop-Package "$SourceDescription contains forbidden mutable program state: $entryName"
      }
    }

    foreach ($mutableFolder in $MutableFolders) {
      $mutableRoot = "$programRoot/$mutableFolder"
      if (
        $normalized.Equals($mutableRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        $normalized.StartsWith("$mutableRoot/", [System.StringComparison]::OrdinalIgnoreCase)
      ) {
        Stop-Package "$SourceDescription contains manifest-declared mutable program state: $entryName"
      }
    }
  }

  if (-not $hasManifest) {
    Stop-Package "$SourceDescription is missing Programs/$ProgramName/flowcell.program.json."
  }
}

function Assert-ProgramStagingInvariant(
  [string]$PackageRoot,
  [string]$ProgramName,
  [string[]]$MutableFolders
) {
  $packageRootFull = [System.IO.Path]::GetFullPath($PackageRoot).TrimEnd('\', '/')
  $packagePrefix = "$packageRootFull$([System.IO.Path]::DirectorySeparatorChar)"
  $entryNames = @(
    Get-ChildItem -LiteralPath $PackageRoot -Recurse -Force |
      ForEach-Object {
        $entryFullPath = [System.IO.Path]::GetFullPath($_.FullName)
        if (-not $entryFullPath.StartsWith($packagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
          Stop-Package "Staging entry escaped its package root: $entryFullPath"
        }
        $entryFullPath.Substring($packagePrefix.Length).Replace('\', '/')
      }
  )
  Assert-ProgramPackageEntries $entryNames $ProgramName $MutableFolders "Staging package for '$ProgramName'"
}

function Assert-ProgramZipInvariant(
  [string]$ZipPath,
  [string]$ProgramName,
  [string[]]$MutableFolders
) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
    Assert-ProgramPackageEntries $entryNames $ProgramName $MutableFolders "ZIP package for '$ProgramName'"
  } finally {
    $archive.Dispose()
  }
}
