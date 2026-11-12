Set-StrictMode -Version Latest

# This helper is dot-sourced by package-portable.ps1. Stop-Package and
# $RepoRoot are supplied by that release driver.

function Resolve-ProgramProfileLocalRoot([string]$RequestedRoot) {
  $localRoot = $RequestedRoot
  if ([string]::IsNullOrWhiteSpace($localRoot)) { $localRoot = $env:FLOWCELL_PROGRAM_LOCAL_ROOT }
  if ([string]::IsNullOrWhiteSpace($localRoot)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
      Stop-Package 'Program ZIPs require -ProgramLocalRoot or FLOWCELL_PROGRAM_LOCAL_ROOT; the installed FlowCell runtime location is unavailable.'
    }
    $runtimePath = Join-Path $env:LOCALAPPDATA 'Programs/FlowCell/flowcell.runtime.json'
    if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
      Stop-Package 'Program ZIPs require -ProgramLocalRoot or FLOWCELL_PROGRAM_LOCAL_ROOT; no installed FlowCell runtime configuration identifies the current saved profile.'
    }
    if ((Get-Item -LiteralPath $runtimePath).Length -gt 65536) { Stop-Package 'Installed FlowCell runtime configuration exceeds 65536 bytes.' }
    try { $runtime = [IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json }
    catch { Stop-Package "Installed FlowCell runtime configuration is invalid JSON: $runtimePath" }
    if ($null -eq $runtime -or -not $runtime.PSObject.Properties['localRoot'] -or $runtime.localRoot -isnot [string]) {
      Stop-Package "Installed FlowCell runtime configuration does not declare localRoot: $runtimePath"
    }
    $localRoot = $runtime.localRoot
  }
  if ([string]::IsNullOrWhiteSpace($localRoot) -or -not [IO.Path]::IsPathRooted($localRoot)) {
    Stop-Package 'ProgramLocalRoot must be an absolute path to the current saved FlowCell local root.'
  }
  $localRoot = [IO.Path]::GetFullPath($localRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $localRoot 'button-system/button-state.json') -PathType Leaf)) {
    Stop-Package "ProgramLocalRoot has no canonical button-system/button-state.json: $localRoot. Catalog-only packaging cannot preserve the working configuration."
  }
  return (Resolve-Path -LiteralPath $localRoot).Path
}

function Get-ReleaseProgramDirectories([string[]]$ProgramNames) {
  $manifestPaths = @(& git -C $RepoRoot -c core.quotePath=false ls-files -- 'Programs/*/flowcell.program.json')
  if ($LASTEXITCODE -ne 0) { Stop-Package 'Could not discover tracked program manifests.' }
  $programDirectories = @($manifestPaths | ForEach-Object {
    Get-Item -LiteralPath (Split-Path -Parent (Join-Path $RepoRoot $_))
  } | Sort-Object Name)
  if ($null -ne $ProgramNames -and $ProgramNames.Count -gt 0) {
    $trackedNames = @($programDirectories | ForEach-Object Name)
    foreach ($name in $ProgramNames) {
      if ([string]::IsNullOrWhiteSpace($name) -or $trackedNames -notcontains $name) {
        Stop-Package "Unknown release program '$name'. Tracked programs: $($trackedNames -join ', ')."
      }
    }
    $programDirectories = @($programDirectories | Where-Object { $ProgramNames -contains $_.Name })
  }
  return $programDirectories
}

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
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  $volumeRoot = [System.IO.Path]::GetPathRoot($rootFull)
  $rootFull = $rootFull.TrimEnd('\', '/')
  # Keep volume roots absolute: C: resolves against that drive's current folder.
  if ($rootFull.Length -lt $volumeRoot.Length) { $rootFull = $volumeRoot }
  $candidateFull = [System.IO.Path]::GetFullPath($Candidate)
  $rootPrefix = $rootFull.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
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

function Assert-PortableAppearanceData($Value, [string]$Location) {
  if ($null -eq $Value) { return }
  if ($Value -is [string]) {
    if ($Value -match '^(?:[A-Za-z]:[\\/]|\\\\|file://|//)') {
      Stop-Package "Program defaultTheme contains an absolute local path at $Location."
    }
    return
  }
  if ($Value -is [System.Array]) {
    foreach ($item in $Value) { Assert-PortableAppearanceData $item "$Location[]" }
    return
  }
  if ($Value -isnot [pscustomobject]) { return }
  foreach ($property in $Value.PSObject.Properties) {
    if ($null -ne $property.Value -and @(
      'executionTarget', 'execution', 'sourceIdentity', 'sourcePath', 'catalogPath',
      'localPackagePath', 'bridgeAction', 'bridgeData', 'runner', 'events', 'inlineScript'
    ) -contains $property.Name) {
      Stop-Package "Program defaultTheme cannot embed executable or local source data at $Location.$($property.Name)."
    }
    Assert-PortableAppearanceData $property.Value "$Location.$($property.Name)"
  }
}

function Assert-ProgramDefaultThemeReferences(
  [System.IO.DirectoryInfo]$ProgramDirectory,
  $Manifest,
  [string[]]$TrackedFiles
) {
  if (-not $Manifest.PSObject.Properties['defaultTheme'] -or $null -eq $Manifest.defaultTheme) { return }
  $path = Assert-TrackedProgramReference $ProgramDirectory $TrackedFiles ([string]$Manifest.defaultTheme) 'defaultTheme' -RequireFile
  if ([IO.Path]::GetExtension($path) -ine '.json') { Stop-Package 'Program defaultTheme must name a JSON file.' }
  try { $file = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }
  catch { Stop-Package "Program defaultTheme is invalid JSON: $path ($($_.Exception.Message))" }
  if (-not $file.PSObject.Properties['kind'] -or -not $file.PSObject.Properties['version'] -or $file.version -ne 1) {
    Stop-Package 'Program defaultTheme has an unsupported format.'
  }
  $compact = $file.kind -ceq 'FlowCellProgramAppearance'
  if ($compact) {
    foreach ($property in $file.PSObject.Properties) {
      if (@('kind', 'version', 'theme', 'skins', 'skinSources') -notcontains $property.Name) {
        Stop-Package "Program defaultTheme contains unsupported embedded data: $($property.Name)."
      }
    }
  }
  $theme = if ($compact -and $file.PSObject.Properties['theme']) { $file.theme } else { $file }
  if ($theme.kind -cne 'FlowCellPortableTheme' -or $theme.version -ne 1 -or
      $theme.target.kind -cne 'program' -or $theme.target.programName -ine $Manifest.label -or
      $null -ne $theme.target.panelName -or $theme.target.PSObject.Properties['area']) {
    Stop-Package 'Program defaultTheme must target this whole Program.'
  }
  Assert-PortableAppearanceData $theme 'defaultTheme.theme'
  $sources = @{}
  foreach ($source in @($Manifest.bundledSources)) { $sources[[string]$source.id] = $source }
  $dependencies = @{}
  if ($theme.dependencies -isnot [System.Array]) { Stop-Package 'Program defaultTheme dependencies must be an array.' }
  foreach ($dependency in $theme.dependencies) {
    foreach ($field in @('id', 'programName', 'programId', 'panelName', 'sourceId', 'sourceVersion')) {
      if (-not $dependency.PSObject.Properties[$field] -or [string]::IsNullOrWhiteSpace([string]$dependency.$field)) {
        Stop-Package "Program defaultTheme dependency requires $field."
      }
    }
    if ($dependencies.ContainsKey([string]$dependency.id)) { Stop-Package 'Program defaultTheme duplicates a dependency id.' }
    if (-not $sources.ContainsKey([string]$dependency.sourceId)) {
      Stop-Package "Program defaultTheme dependency '$($dependency.sourceId)' is not a bundled source."
    }
    $source = $sources[[string]$dependency.sourceId]
    if ($dependency.sourceVersion -cne $source.version -or $dependency.panelName -ine $source.panelName -or
        $dependency.programName -ine $Manifest.label -or $dependency.programId -ine $Manifest.programId) {
      Stop-Package "Program defaultTheme dependency '$($dependency.sourceId)' does not match its bundled source version, panel or Program."
    }
    $dependencies[[string]$dependency.id] = $dependency
  }
  foreach ($reference in $theme.references.PSObject.Properties) {
    if ($reference.Value.kind -eq 'source' -and -not $dependencies.ContainsKey([string]$reference.Value.dependencyId)) {
      Stop-Package "Program defaultTheme reference '$($reference.Name)' has no dependency."
    }
  }
  if (-not $compact) { return }
  if (-not $file.PSObject.Properties['skins'] -or $file.skins -isnot [pscustomobject] -or
      -not $file.PSObject.Properties['skinSources'] -or $file.skinSources -isnot [pscustomobject]) {
    Stop-Package 'Program defaultTheme requires compact skins and skinSources dictionaries.'
  }
  # Literal markup/CSS is kept in skinSources. Validate references without
  # scanning, expanding, rewriting or executing those potentially large strings.
  Assert-PortableAppearanceData $file.skins 'defaultTheme.skins'
  foreach ($entry in $file.skinSources.PSObject.Properties) {
    if ($entry.Value -isnot [string]) { Stop-Package 'Program defaultTheme skinSources values must be strings.' }
  }
  foreach ($entry in $file.skins.PSObject.Properties) {
    foreach ($section in @('structure', 'base', 'hover', 'pressed', 'held', 'release', 'play', 'disabled', 'error', 'keyframes')) {
      if (-not $entry.Value.PSObject.Properties[$section] -or
          -not $file.skinSources.PSObject.Properties[[string]$entry.Value.$section]) {
        Stop-Package "Program defaultTheme skin '$($entry.Name)' references a missing $section source."
      }
    }
    if ($entry.Value.PSObject.Properties['metadata'] -and
        $entry.Value.metadata.PSObject.Properties['buttonSkinEmbeddedVariants']) {
      foreach ($variant in $entry.Value.metadata.buttonSkinEmbeddedVariants.PSObject.Properties) {
        if (-not $file.skinSources.PSObject.Properties[[string]$variant.Value]) {
          Stop-Package "Program defaultTheme skin '$($entry.Name)' references a missing variant source."
        }
      }
    }
  }
  foreach ($button in @($theme.theme.buttons)) {
    if ($button.skin -isnot [string] -or -not $file.skins.PSObject.Properties[$button.skin]) {
      Stop-Package 'Program defaultTheme references a missing skin.'
    }
  }
}

function Assert-ProgramManifestReferencesTracked(
  [System.IO.DirectoryInfo]$ProgramDirectory,
  $Manifest,
  [string[]]$TrackedFiles
) {
  Assert-ProgramDefaultThemeReferences $ProgramDirectory $Manifest $TrackedFiles
  $supportScriptsFolder = Convert-ToSafeRelativeFolder ([string]$Manifest.supportScriptsFolder) 'supportScriptsFolder' $ProgramDirectory.Name
  if ($Manifest.PSObject.Properties['bindActionsFile'] -and $null -ne $Manifest.bindActionsFile) {
    $actionsPath = Assert-TrackedProgramReference $ProgramDirectory $TrackedFiles ([string]$Manifest.bindActionsFile) 'bindActionsFile' -RequireFile
    if ((Get-Item -LiteralPath $actionsPath).Length -gt 65536) {
      Stop-Package "Program '$($ProgramDirectory.Name)' bindActionsFile exceeds 65536 bytes."
    }
    foreach ($line in Get-Content -LiteralPath $actionsPath) {
      if ($line -match '^\s*Source\s*=\s*(.*)$') {
        [void](Assert-TrackedProgramReference $ProgramDirectory $TrackedFiles $Matches[1].Trim() 'bind action Source' -RequireFile)
      }
    }
  }
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
    $toolsetManifestPath = if (Test-Path -LiteralPath $sourcePath -PathType Container) {
      Join-Path $sourcePath 'flowcell.toolset.json'
    } elseif ([System.IO.Path]::GetFileName($sourcePath) -eq 'flowcell.toolset.json') {
      $sourcePath
    } else { $null }
    if ($toolsetManifestPath -and (Test-Path -LiteralPath $toolsetManifestPath -PathType Leaf)) {
      try { $toolset = Get-Content -LiteralPath $toolsetManifestPath -Raw | ConvertFrom-Json }
      catch { Stop-Package "Invalid tool-set manifest: $toolsetManifestPath" }
      if ($toolset.PSObject.Properties['appearance'] -and $toolset.appearance) {
        $packageFolder = Split-Path -Parent $toolsetManifestPath
        $programPrefix = $ProgramDirectory.FullName.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
        $relativeFolder = $packageFolder.Substring($programPrefix.Length).Replace('\', '/')
        foreach ($entry in $toolset.appearance.skins.PSObject.Properties) {
          $skinFiles = @([string]$entry.Value.file)
          if ($entry.Value.PSObject.Properties['variants'] -and $entry.Value.variants) {
            $skinFiles += @($entry.Value.variants.PSObject.Properties | ForEach-Object { [string]$_.Value })
          }
          foreach ($file in $skinFiles) {
            $relativeSkin = Convert-ToSafeRelativeFolder $file "$fieldPrefix appearance skin" $ProgramDirectory.Name
            [void](Assert-TrackedProgramReference $ProgramDirectory $TrackedFiles "$relativeFolder/$relativeSkin" "$fieldPrefix appearance skin" -RequireFile)
          }
        }
      }
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
