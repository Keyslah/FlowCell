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
  Assert-NoReparsePathComponents ([System.IO.Path]::GetPathRoot($source)) $source 'Blender theme library'
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    Stop-Package "Blender theme library was not found: $source"
  }
  return $source
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
    $assetCount += $assets.Count
    $packages.Add([pscustomobject]@{
      Name = $directory.Name
      ManifestName = $manifests[0].Name
      Manifest = $manifest
      Assets = $assets
    }) | Out-Null
  }
  if ($packages.Count -eq 0) {
    Stop-Package "Blender theme library contains no saved packages: $sourceRoot"
  }

  # Validate the complete library before writing anything to staging.
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
  return [pscustomobject]@{ PackageCount = $packages.Count; AssetCount = $assetCount }
}
