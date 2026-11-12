Set-StrictMode -Version Latest

# Dot-sourced after program-package-safety.ps1 by package-portable.ps1.
# $RepoRoot, Stop-Package and Assert-NoReparsePathComponents come from that driver.

function Resolve-BlenderThemePackageLibrary([string]$LibraryPath) {
  $source = $LibraryPath
  if ([string]::IsNullOrWhiteSpace($source)) {
    $configPath = Join-Path $RepoRoot 'flowcellbackend/local/program-package-sources.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
      Assert-NoReparsePathComponents $RepoRoot $configPath 'Program package source configuration'
      try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      } catch {
        Stop-Package "Invalid program package source configuration: $configPath ($($_.Exception.Message))"
      }
      if ($null -eq $config -or $config -isnot [pscustomobject]) {
        Stop-Package "Program package source configuration must be a JSON object: $configPath"
      }
      if ($config.PSObject.Properties['blenderThemeLibrary']) {
        if ($config.blenderThemeLibrary -isnot [string] -or [string]::IsNullOrWhiteSpace($config.blenderThemeLibrary)) {
          Stop-Package "blenderThemeLibrary must name the saved Blender theme library: $configPath"
        }
        $source = $config.blenderThemeLibrary
      }
    }
    if ([string]::IsNullOrWhiteSpace($source)) {
      Stop-Package "FlowCell-Blender.zip requires the saved Blender theme library. Set blenderThemeLibrary in $configPath or pass -BlenderThemeLibrary."
    }
  }

  if (-not [System.IO.Path]::IsPathRooted($source)) {
    $source = Join-Path $RepoRoot $source
  }
  $source = [System.IO.Path]::GetFullPath($source)
  if ([System.IO.Path]::GetFileName($source.TrimEnd('\', '/')) -ieq 'blender_themes') {
    $canonical = Join-Path ([System.IO.Path]::GetDirectoryName($source.TrimEnd('\', '/'))) 'themes/Blender'
    $migration = Join-Path ([System.IO.Path]::GetDirectoryName($canonical)) '.migration-v1.json'
    if ((Test-Path -LiteralPath $canonical -PathType Container) -and (Test-Path -LiteralPath $migration -PathType Leaf)) {
      $source = [System.IO.Path]::GetFullPath($canonical)
    }
  }
  Assert-NoReparsePathComponents ([System.IO.Path]::GetPathRoot($source)) $source 'Blender theme library'
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    Stop-Package "Blender theme library was not found: $source"
  }
  return $source
}

function Get-BlenderThemeProperty($Value, [string]$Name) {
  if ($null -ne $Value -and $Value -is [pscustomobject] -and $Value.PSObject.Properties[$Name]) {
    return $Value.$Name
  }
  return $null
}

function Read-BlenderThemeProvenanceJson([string]$Root, [string]$Path) {
  Assert-NoReparsePathComponents $Root $Path 'Blender theme appearance provenance'
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Stop-Package "Blender theme appearance provenance is missing: $Path. Resave the theme from its original installed Buttons before packaging."
  }
  try { $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
  catch { Stop-Package "Invalid Blender theme appearance provenance: $Path ($($_.Exception.Message))" }
  if ($value -isnot [pscustomobject]) { Stop-Package "Blender theme appearance provenance must be an object: $Path" }
  return $value
}

function Join-BlenderThemeProvenancePath([string]$Root, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':') -or
      @($Relative -split '[\\/]' | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
    Stop-Package "Unsafe Blender theme appearance provenance path: $Relative"
  }
  $path = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
  Assert-NoReparsePathComponents $Root $path 'Blender theme appearance provenance'
  return $path
}

function Get-BlenderThemeAppearanceContext([string]$SourceLibrary) {
  $library = [IO.DirectoryInfo]$SourceLibrary
  if ($library.Name -ieq 'Blender' -and $library.Parent.Name -ieq 'themes') { $localRoot = $library.Parent.Parent.FullName }
  elseif ($library.Name -ieq 'blender_themes') { $localRoot = $library.Parent.FullName }
  else {
    Stop-Package "Legacy Blender theme appearance has no portable sourceReference. Package it from local/themes/Blender or local/blender_themes with its original button-system state, or resave it in the current Theme Editor."
  }
  $state = Read-BlenderThemeProvenanceJson $localRoot (Join-Path $localRoot 'button-system/button-state.json')
  foreach ($field in @('buttons', 'placements', 'surfaces')) {
    if ((Get-BlenderThemeProperty $state $field) -isnot [pscustomobject]) {
      Stop-Package "Blender theme appearance provenance has no canonical $field object. Resave the theme from its original installation."
    }
  }
  $programRoot = Join-Path $localRoot 'Programs/Blender'
  $manifest = Read-BlenderThemeProvenanceJson $localRoot (Join-Path $programRoot 'flowcell.program.json')
  if ((Get-BlenderThemeProperty $manifest 'programId') -cne 'blender') {
    Stop-Package 'Blender theme appearance provenance must identify programId blender.'
  }
  return [pscustomobject]@{
    State = $state; ProgramRoot = $programRoot; Manifest = $manifest
    PanelsRoot = Join-BlenderThemeProvenancePath $programRoot ([string](Get-BlenderThemeProperty $manifest 'panelsFolder'))
    ScriptsRoot = Join-BlenderThemeProvenancePath $programRoot ([string](Get-BlenderThemeProperty $manifest 'localScriptsFolder'))
  }
}

function Add-BlenderThemeAppearanceReferences($Manifest, [string]$SourceLibrary, [string]$ManifestPath, [hashtable]$Cache) {
  $appearance = Get-BlenderThemeProperty (Get-BlenderThemeProperty $Manifest 'values') 'popped_button_appearance'
  if ($null -eq $appearance -or -not $appearance.PSObject.Properties['placements']) { return }
  $entries = $appearance.placements
  if ($null -eq $entries -or @($entries).Count -eq 0) { return }
  if ($entries -isnot [array]) { Stop-Package "Blender theme appearance placements must be an array: $ManifestPath" }
  foreach ($entry in $entries) {
    $reference = Get-BlenderThemeProperty $entry 'sourceReference'
    if ($null -ne $reference) {
      $slot = Get-BlenderThemeProperty $reference 'slot'
      if ($reference -isnot [pscustomobject] -or
          (Get-BlenderThemeProperty $reference 'programId') -cne 'blender' -or
          (Get-BlenderThemeProperty $reference 'sourceId') -isnot [string] -or
          [string]::IsNullOrWhiteSpace($reference.sourceId) -or
          -not $reference.PSObject.Properties['slot'] -or
          ($null -ne $slot -and ($slot -isnot [string] -or [string]::IsNullOrWhiteSpace($slot))) -or
          (Get-BlenderThemeProperty $reference 'surfaceKind') -notin @('regular-popout', 'tool-set-popout', 'fan')) {
        Stop-Package "Invalid portable Blender theme appearance sourceReference: $ManifestPath"
      }
      continue
    }
    if ($null -eq $Cache.Context) { $Cache.Context = Get-BlenderThemeAppearanceContext $SourceLibrary }
    $context = $Cache.Context
    $placementId = [string](Get-BlenderThemeProperty $entry 'placementId')
    $buttonId = [string](Get-BlenderThemeProperty $entry 'buttonId')
    $placement = Get-BlenderThemeProperty $context.State.placements $placementId
    $button = Get-BlenderThemeProperty $context.State.buttons $buttonId
    $surface = Get-BlenderThemeProperty $context.State.surfaces ([string](Get-BlenderThemeProperty $placement 'surfaceId'))
    $surfaceKind = Get-BlenderThemeProperty $surface 'kind'
    if ($placementId -eq '' -or $buttonId -eq '' -or $null -eq $placement -or $null -eq $button -or
        (Get-BlenderThemeProperty $placement 'id') -cne $placementId -or
        (Get-BlenderThemeProperty $placement 'buttonId') -cne $buttonId -or
        (Get-BlenderThemeProperty $button 'id') -cne $buttonId -or
        (Get-BlenderThemeProperty $surface 'id') -cne (Get-BlenderThemeProperty $placement 'surfaceId') -or
        $surfaceKind -notin @('regular-popout', 'tool-set-popout', 'fan') -or
        $placementId -cnotin @(Get-BlenderThemeProperty $surface 'placementIds')) {
      Stop-Package "Cannot prove Blender theme appearance placement '$placementId' owns Button '$buttonId': $ManifestPath. Resave the theme with its original canonical Button state."
    }
    $slot = $null
    $owner = $button
    if ((Get-BlenderThemeProperty $button 'role') -eq 'tool-set-child') {
      $ownerId = [string](Get-BlenderThemeProperty $button 'toolSetParentId')
      $owner = Get-BlenderThemeProperty $context.State.buttons $ownerId
      $target = Get-BlenderThemeProperty $button 'executionTarget'
      $slot = Get-BlenderThemeProperty $target 'command'
      if ((Get-BlenderThemeProperty $owner 'role') -ne 'tool-set-owner' -or
          (Get-BlenderThemeProperty $target 'kind') -ne 'tool-set-action' -or
          $slot -isnot [string] -or [string]::IsNullOrWhiteSpace($slot)) {
        Stop-Package "Cannot prove Blender theme child ownership/slot for '$buttonId': $ManifestPath. Resave the theme from the original Tool Set."
      }
    } elseif ((Get-BlenderThemeProperty $button 'role') -ne 'single-script') {
      Stop-Package "Unsupported Blender theme appearance Button role for '$buttonId': $ManifestPath"
    }
    $identity = Get-BlenderThemeProperty $owner 'sourceIdentity'
    $panel = [string](Get-BlenderThemeProperty $identity 'displayPanelName')
    $file = [string](Get-BlenderThemeProperty $identity 'displayFileName')
    if ((Get-BlenderThemeProperty $identity 'normalizedProgramName') -cne 'blender' -or
        $panel -match '[\\/]' -or $file -match '[\\/]' -or -not $file.EndsWith('.flowcell-source.json')) {
      Stop-Package "Cannot prove Blender theme source identity for '$buttonId': $ManifestPath"
    }
    $recordPath = Join-BlenderThemeProvenancePath $context.PanelsRoot "$panel/$file"
    $record = Read-BlenderThemeProvenanceJson $context.ProgramRoot $recordPath
    $ownerId = [string](Get-BlenderThemeProperty $owner 'id')
    if ((Get-BlenderThemeProperty $record 'ownerButtonId') -cne $ownerId -or
        (Get-BlenderThemeProperty $record 'installId') -cne $ownerId -or
        (Get-BlenderThemeProperty $record 'programId') -cne 'blender' -or
        (Get-BlenderThemeProperty $record 'panelName') -cne $panel) {
      Stop-Package "Blender theme source record ownership differs for '$buttonId': $ManifestPath"
    }
    $sourceRoot = Join-BlenderThemeProvenancePath $context.ScriptsRoot "$ownerId/source"
    $packageFiles = @('flowcell.script.json', 'flowcell.toolset.json') | ForEach-Object {
      Join-BlenderThemeProvenancePath $sourceRoot $_
    } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }
    if (@($packageFiles).Count -gt 1) { Stop-Package "Ambiguous Blender theme source manifests for '$buttonId': $ManifestPath" }
    $package = if (@($packageFiles).Count -eq 1) { Read-BlenderThemeProvenanceJson $sourceRoot @($packageFiles)[0] } else { $null }
    $sourceId = Get-BlenderThemeProperty $record 'bundledSourceId'
    if ($null -eq $sourceId -or $sourceId -eq '') { $sourceId = Get-BlenderThemeProperty $package 'id' }
    if ($sourceId -isnot [string] -or [string]::IsNullOrWhiteSpace($sourceId)) {
      Stop-Package "Blender theme appearance source '$ownerId' has no portable source ID: $ManifestPath. Resave it with its owned source manifest."
    }
    if ($null -ne $slot) {
      $ownedSlots = @(Get-BlenderThemeProperty $record 'children' | Where-Object { (Get-BlenderThemeProperty $_ 'slot') -ceq $slot })
      $declaredSlots = @(Get-BlenderThemeProperty $package 'children' | Where-Object { (Get-BlenderThemeProperty $_ 'slot') -ceq $slot })
      if ($ownedSlots.Count -ne 1 -or $declaredSlots.Count -ne 1 -or
          (Get-BlenderThemeProperty $target 'ownerFileName') -cne $file -or
          (Get-BlenderThemeProperty $target 'panelName') -cne $panel -or
          (Get-BlenderThemeProperty $target 'programName') -ine 'Blender') {
        Stop-Package "Missing or ambiguous Blender theme source slot '$slot' for '$buttonId': $ManifestPath. Resave it from the original Tool Set."
      }
    }
    $sameTargets = @($context.State.placements.PSObject.Properties.Value | Where-Object {
      (Get-BlenderThemeProperty $_ 'buttonId') -ceq $buttonId -and
      (Get-BlenderThemeProperty (Get-BlenderThemeProperty $context.State.surfaces ([string](Get-BlenderThemeProperty $_ 'surfaceId'))) 'kind') -ceq $surfaceKind
    })
    if ($sameTargets.Count -ne 1) { Stop-Package "Ambiguous Blender theme appearance placements for '$buttonId' on '$surfaceKind': $ManifestPath" }
    $entry | Add-Member -MemberType NoteProperty -Name sourceReference -Value ([pscustomobject]@{
      programId = 'blender'; sourceId = $sourceId; slot = $slot; surfaceKind = $surfaceKind
    }) -Force
  }
}

function Copy-BlenderThemePackages([string]$SourceLibrary, [string]$Destination) {
  if ([string]::IsNullOrWhiteSpace($SourceLibrary) -or [string]::IsNullOrWhiteSpace($Destination)) {
    Stop-Package 'Blender theme packaging requires source and destination folders.'
  }
  $sourceRoot = [System.IO.Path]::GetFullPath($SourceLibrary).TrimEnd('\', '/')
  $destinationRoot = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
  $separator = [System.IO.Path]::DirectorySeparatorChar
  if ($sourceRoot.Equals($destinationRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $destinationRoot.StartsWith("$sourceRoot$separator", [System.StringComparison]::OrdinalIgnoreCase) -or
      $sourceRoot.StartsWith("$destinationRoot$separator", [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Package 'Blender theme source and staging destination must not overlap.'
  }
  Assert-NoReparsePathComponents ([System.IO.Path]::GetPathRoot($sourceRoot)) $sourceRoot 'Blender theme library'
  Assert-NoReparsePathComponents ([System.IO.Path]::GetPathRoot($destinationRoot)) $destinationRoot 'Blender theme staging folder'
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    Stop-Package "Blender theme library was not found: $sourceRoot"
  }
  if (Test-Path -LiteralPath $destinationRoot) {
    if (-not (Test-Path -LiteralPath $destinationRoot -PathType Container) -or
        @(Get-ChildItem -LiteralPath $destinationRoot -Force).Count -gt 0) {
      Stop-Package "Blender theme staging folder must be empty: $destinationRoot"
    }
  }

  $packages = New-Object System.Collections.Generic.List[object]
  $assetCount = 0
  $flatThemes = New-Object System.Collections.Generic.List[object]
  $appearanceProvenance = @{ Context = $null }
  foreach ($file in @(Get-ChildItem -LiteralPath $sourceRoot -File -Force | Where-Object {
    -not $_.Name.StartsWith('.') -and ($_.Name.EndsWith('.flowtheme.json') -or $_.Name.EndsWith('.flowcell-theme-pack.json'))
  })) {
    Assert-NoReparsePathComponents $sourceRoot $file.FullName 'Unified Blender theme'
    try { $theme = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Stop-Package "Invalid unified Blender theme: $($file.FullName)" }
    if ($null -eq $theme -or $theme -isnot [pscustomobject] -or -not $theme.PSObject.Properties['kind'] -or
        $theme.kind -notin @('FlowCellPortableTheme', 'FlowCellTheme') -or -not $theme.PSObject.Properties['version'] -or
        ($theme.kind -eq 'FlowCellPortableTheme' -and $theme.version -ne 1) -or
        ($theme.kind -eq 'FlowCellTheme' -and $theme.version -notin @(1, 2)) -or
        -not $theme.PSObject.Properties['target'] -or $theme.target.kind -ne 'program' -or $theme.target.programName -ine 'Blender') {
      Stop-Package "Unsupported format or wrong target in unified Blender theme: $($file.FullName)"
    }
    if ($theme.kind -eq 'FlowCellPortableTheme') {
      if (-not $theme.PSObject.Properties['theme'] -or $theme.theme.target.kind -ne 'program' -or $theme.theme.target.programName -ine 'Blender') {
        Stop-Package "Portable theme inner target does not match Blender: $($file.FullName)"
      }
      $assetPaths = @{}
      if ($theme.PSObject.Properties['assets']) {
        foreach ($asset in $theme.assets) {
          $relative = [string]$asset.path
          if ([IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or -not $relative.StartsWith('assets/') -or
              @($relative -split '[\\/]' | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0 -or $assetPaths.ContainsKey($relative)) {
            Stop-Package "Unsafe or duplicate embedded theme asset: $relative"
          }
          try { $bytes = [Convert]::FromBase64String([string]$asset.base64) }
          catch { Stop-Package "Invalid embedded theme image: $relative" }
          $sha = [Security.Cryptography.SHA256]::Create()
          try { $hash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
          if ($hash -cne [string]$asset.sha256) { Stop-Package "Embedded theme image checksum differs: $relative" }
          $assetPaths[$relative] = $true
        }
      }
      $serialized = $theme | ConvertTo-Json -Depth 100 -Compress
      foreach ($match in [regex]::Matches($serialized, 'theme-asset:([^"\s]+)')) {
        if (-not $assetPaths.ContainsKey($match.Groups[1].Value)) { Stop-Package "Portable theme is missing embedded asset $($match.Groups[1].Value)" }
      }
      $assetCount += $assetPaths.Count
    }
    $flatThemes.Add($file) | Out-Null
  }
  $directories = @(Get-ChildItem -LiteralPath $sourceRoot -Directory -Force | Where-Object {
    -not $_.Name.StartsWith('.') -and ($_.Attributes -band [System.IO.FileAttributes]::Hidden) -eq 0
  } | Sort-Object Name)
  foreach ($directory in $directories) {
    Assert-NoReparsePathComponents $sourceRoot $directory.FullName 'Blender theme package'
    $manifests = @(Get-ChildItem -LiteralPath $directory.FullName -File -Force -Filter '*.flowcell-theme-pack.json')
    if ($manifests.Count -ne 1) {
      Stop-Package "Blender theme package must contain exactly one theme manifest: $($directory.FullName)"
    }
    $manifestPath = $manifests[0].FullName
    Assert-NoReparsePathComponents $directory.FullName $manifestPath 'Blender theme manifest'
    try {
      $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
      Stop-Package "Invalid Blender theme manifest: $manifestPath ($($_.Exception.Message))"
    }
    if ($null -eq $manifest -or $manifest -isnot [pscustomobject] -or
        -not $manifest.PSObject.Properties['format'] -or
        $manifest.format -ne 'flowcell-tool-package/blender-theme/v1') {
      Stop-Package "Unsupported Blender theme format; resave this package with the current Theme tool: $manifestPath"
    }
    if (-not $manifest.PSObject.Properties['assets'] -or $manifest.assets -isnot [pscustomobject] -or
        -not $manifest.PSObject.Properties['values'] -or $manifest.values -isnot [pscustomobject]) {
      Stop-Package "Blender theme manifest requires assets and values objects: $manifestPath"
    }
    foreach ($field in @('theme_image_path', 'static_background_path')) {
      if ($manifest.values.PSObject.Properties[$field] -and
          -not [string]::IsNullOrWhiteSpace([string]$manifest.values.$field) -and
          -not $manifest.assets.PSObject.Properties[$field]) {
        Stop-Package "Blender theme field '$field' has no packaged asset reference: $manifestPath"
      }
    }
    $assets = @{}
    foreach ($asset in $manifest.assets.PSObject.Properties) {
      if ($asset.Name -notin @('theme_image_path', 'static_background_path')) {
        Stop-Package "Unsupported Blender theme asset field '$($asset.Name)': $manifestPath"
      }
      if ($asset.Value -isnot [string] -or [string]::IsNullOrWhiteSpace($asset.Value)) {
        Stop-Package "Blender theme asset '$($asset.Name)' requires a relative file path: $manifestPath"
      }
      $relative = $asset.Value
      $segments = @($relative -split '[\\/]')
      if ([System.IO.Path]::IsPathRooted($relative) -or $relative.Contains(':') -or
          @($segments | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
        Stop-Package "Unsafe Blender theme asset path '$relative': $manifestPath"
      }
      $assetPath = [System.IO.Path]::GetFullPath((Join-Path $directory.FullName $relative))
      Assert-NoReparsePathComponents $directory.FullName $assetPath 'Blender theme asset'
      if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf) -or
          $assetPath.Equals($manifestPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-Package "Blender theme image asset was not found or names its manifest: $assetPath"
      }
      $assets[$relative] = $assetPath
      $manifest.values | Add-Member -MemberType NoteProperty -Name $asset.Name -Value $relative -Force
    }
    if ($assets.Count -eq 0) {
      Stop-Package "Blender theme package has no image assets: $manifestPath"
    }
    Add-BlenderThemeAppearanceReferences $manifest $sourceRoot $manifestPath $appearanceProvenance
    $assetCount += $assets.Count
    $packages.Add([pscustomobject]@{
      Name = $directory.Name
      ManifestName = $manifests[0].Name
      Manifest = $manifest
      Assets = $assets
    }) | Out-Null
  }
  if ($packages.Count -eq 0 -and $flatThemes.Count -eq 0) {
    Stop-Package "Blender theme library contains no saved packages: $sourceRoot"
  }

  # Validate the complete library before writing anything to staging.
  if ($flatThemes.Count -gt 0) {
    New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
    foreach ($file in $flatThemes) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destinationRoot $file.Name) }
  }
  foreach ($package in $packages) {
    $packageRoot = Join-Path $destinationRoot $package.Name
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    foreach ($relative in $package.Assets.Keys) {
      $target = Join-Path $packageRoot $relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $package.Assets[$relative] -Destination $target
    }
    $json = $package.Manifest | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText((Join-Path $packageRoot $package.ManifestName), $json, (New-Object System.Text.UTF8Encoding($false)))
  }
  return [pscustomobject]@{ PackageCount = $packages.Count + $flatThemes.Count; AssetCount = $assetCount }
}
