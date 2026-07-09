[CmdletBinding()]
param(
  [string]$BuiltExe,
  [string]$AutoHotkeyExe,
  [string]$AutoHotkeyLicenseFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = Join-Path $RepoRoot 'dist'
$ProgramsRoot = Join-Path $RepoRoot 'Programs'
$StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("FlowCell-package-" + [guid]::NewGuid().ToString('N'))

function Stop-Package([string]$Message) {
  throw "[FlowCell package] $Message"
}

function Resolve-BuiltExe([string]$RequestedPath) {
  if ($RequestedPath) {
    if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
      Stop-Package "Built FlowCell app was not found: $RequestedPath"
    }
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $defaultPath = Join-Path $RepoRoot 'FlowCellFrontend\src-tauri\target\release\flowcell_frontend.exe'
  if (Test-Path -LiteralPath $defaultPath -PathType Leaf) {
    return (Resolve-Path -LiteralPath $defaultPath).Path
  }

  Stop-Package "Built FlowCell app was not found. Build it first, then pass -BuiltExe. Default checked: $defaultPath"
}

function Get-AhkPath([string]$RequestedPath) {
  if ($RequestedPath) {
    if (Test-Path -LiteralPath $RequestedPath -PathType Leaf) {
      return (Resolve-Path -LiteralPath $RequestedPath).Path
    }
    Stop-Package "AutoHotkey executable was not found: $RequestedPath"
  }

  $paths = @(
    'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
    'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
  )
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      return (Resolve-Path -LiteralPath $path).Path
    }
  }
  Stop-Package 'AutoHotkey v2 was not found. Pass -AutoHotkeyExe with the full path.'
}

function Get-AhkLicense([string]$RequestedPath, [string]$AhkPath) {
  if ($RequestedPath) {
    if (Test-Path -LiteralPath $RequestedPath -PathType Leaf) {
      return (Resolve-Path -LiteralPath $RequestedPath).Path
    }
    Stop-Package "AutoHotkey license file was not found: $RequestedPath"
  }

  $ahkDir = Split-Path -Parent $AhkPath
  $rootDir = Split-Path -Parent $ahkDir
  $names = @('LICENSE.txt', 'License.txt', 'license.txt', 'LICENSE', 'COPYING.txt', 'COPYING')
  foreach ($dir in @($ahkDir, $rootDir)) {
    foreach ($name in $names) {
      $candidate = Join-Path $dir $name
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return (Resolve-Path -LiteralPath $candidate).Path
      }
    }
  }

  Stop-Package 'AutoHotkey GPL-2.0 license text was not found. Provide -AutoHotkeyLicenseFile before publishing the ZIP.'
}

function Copy-Folder([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    Stop-Package "Required folder missing: $Source"
  }
  $destinationParent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null

  $excludeDirs = @('.git', 'dist', 'local', 'node_modules', 'target', 'bin', 'obj', '.vs')
  $excludeFiles = @('*.pdb', '*.log', '*.tmp')
  $robocopyArgs = @($Source, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP', '/XD') + $excludeDirs + @('/XF') + $excludeFiles
  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    Stop-Package "robocopy failed for $Source"
  }
}

function Copy-RootFile([string]$Name, [string]$PackageRoot) {
  $source = Join-Path $RepoRoot $Name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    Stop-Package "Required file missing: $Name"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $PackageRoot $Name) -Force
}

function Convert-ToAssetName([string]$Name) {
  $assetName = $Name.Trim() -replace '[^A-Za-z0-9._-]+', '-'
  $assetName = $assetName.Trim('-')
  if (-not $assetName) {
    Stop-Package "Program folder name cannot be converted into an asset name: $Name"
  }
  return $assetName
}

function Copy-PortableCore([string]$PackageRoot, [string]$BuiltExePath, [string]$AhkPath, [string]$AhkLicensePath) {
  New-Item -ItemType Directory -Path $PackageRoot -Force | Out-Null

  Copy-Item -LiteralPath $BuiltExePath -Destination (Join-Path $PackageRoot 'FlowCell.exe') -Force
  Copy-RootFile 'Start FlowCell.cmd' $PackageRoot
  Copy-RootFile 'README.md' $PackageRoot
  Copy-RootFile 'SETUP.md' $PackageRoot
  Copy-RootFile 'BUILD_FROM_SOURCE.md' $PackageRoot
  Copy-RootFile 'PROGRAM_SUMMARY.txt' $PackageRoot

  Copy-Folder (Join-Path $RepoRoot 'flowcellbackend') (Join-Path $PackageRoot 'flowcellbackend')
  Copy-Folder (Join-Path $RepoRoot 'tools') (Join-Path $PackageRoot 'tools')
  Copy-Folder (Join-Path $RepoRoot 'docs') (Join-Path $PackageRoot 'docs')
  New-Item -ItemType Directory -Path (Join-Path $PackageRoot 'Programs') -Force | Out-Null

  $runtime = Join-Path $PackageRoot 'flowcellbackend\runtime'
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null
  Copy-Item -LiteralPath $AhkPath -Destination (Join-Path $runtime 'AutoHotkey64.exe') -Force
  Copy-Item -LiteralPath $AhkLicensePath -Destination (Join-Path $runtime 'AutoHotkey-LICENSE.txt') -Force

  @'
This package includes AutoHotkey v2, licensed under GPL-2.0.
AutoHotkey is third-party software and is not owned by FlowCell.
AutoHotkey project/source code:
https://github.com/AutoHotkey/AutoHotkey
'@ | Set-Content -LiteralPath (Join-Path $runtime 'AutoHotkey-SOURCE.txt') -Encoding UTF8
}

function Move-ExistingZipToRecycleBin([string]$Path) {
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
      $Path,
      [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
      [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
  }
}

function New-ZipFromDirectory([string]$SourceRoot, [string]$ZipPath) {
  Move-ExistingZipToRecycleBin $ZipPath
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $SourceRoot,
    $ZipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
}

function Ensure-ZipDirectoryEntry([string]$ZipPath, [string]$EntryName) {
  $archive = [System.IO.Compression.ZipFile]::Open(
    $ZipPath,
    [System.IO.Compression.ZipArchiveMode]::Update
  )
  try {
    $existingEntry = $archive.Entries | Where-Object { $_.FullName -eq $EntryName } | Select-Object -First 1
    if ($null -eq $existingEntry) {
      [void]$archive.CreateEntry($EntryName)
    }
  } finally {
    $archive.Dispose()
  }
}

function New-FlowCellCorePackage([string]$BuiltExePath, [string]$AhkPath, [string]$AhkLicensePath) {
  $packageRoot = Join-Path $StagingRoot 'Core'
  $zipPath = Join-Path $DistRoot 'FlowCell-Core.zip'

  Copy-PortableCore $packageRoot $BuiltExePath $AhkPath $AhkLicensePath
  New-ZipFromDirectory $packageRoot $zipPath
  Ensure-ZipDirectoryEntry $zipPath 'Programs/'
  Write-Host "Created: $zipPath"
}

function New-FlowCellProgramPackage([System.IO.DirectoryInfo]$ProgramDirectory) {
  $assetName = Convert-ToAssetName $ProgramDirectory.Name
  $packageRoot = Join-Path $StagingRoot $assetName
  $programsPackageRoot = Join-Path $packageRoot 'Programs'
  $destination = Join-Path $programsPackageRoot $ProgramDirectory.Name
  $zipPath = Join-Path $DistRoot "FlowCell-$assetName.zip"

  New-Item -ItemType Directory -Path $programsPackageRoot -Force | Out-Null
  Copy-Folder $ProgramDirectory.FullName $destination

  New-ZipFromDirectory $packageRoot $zipPath
  Write-Host "Created: $zipPath"
}

if (-not (Test-Path -LiteralPath $ProgramsRoot -PathType Container)) {
  Stop-Package "Required folder missing: $ProgramsRoot"
}

$builtExePath = Resolve-BuiltExe $BuiltExe
$ahk = Get-AhkPath $AutoHotkeyExe
$ahkLicense = Get-AhkLicense $AutoHotkeyLicenseFile $ahk

New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
New-Item -ItemType Directory -Path $StagingRoot -Force | Out-Null

$programDirs = Get-ChildItem -LiteralPath $ProgramsRoot -Directory | Sort-Object Name
try {
  New-FlowCellCorePackage $builtExePath $ahk $ahkLicense

  foreach ($programDir in $programDirs) {
    New-FlowCellProgramPackage $programDir
  }

  Write-Host ''
  Write-Host 'FlowCell release assets are ready in dist:'
  Write-Host '  FlowCell-Core.zip'
  foreach ($programDir in $programDirs) {
    $assetName = Convert-ToAssetName $programDir.Name
    Write-Host "  FlowCell-$assetName.zip"
  }
} finally {
  if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
  }
}
