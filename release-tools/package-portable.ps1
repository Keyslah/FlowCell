[CmdletBinding()]
param(
  [string]$BuiltExe,
  [string]$AutoHotkeyExe,
  [string]$AutoHotkeyLicenseFile,
  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.IO.Compression.FileSystem

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $RepoRoot 'dist'
} elseif ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $OutputDirectory))
}
$ProgramsRoot = Join-Path $RepoRoot 'Programs'
$StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("FlowCell-package-" + [guid]::NewGuid().ToString('N'))

function Stop-Package([string]$Message) {
  throw "[FlowCell package] $Message"
}

$programPackageSafetyScript = Join-Path $PSScriptRoot 'program-package-safety.ps1'
if (-not (Test-Path -LiteralPath $programPackageSafetyScript -PathType Leaf)) {
  Stop-Package "Required release helper missing: $programPackageSafetyScript"
}
. $programPackageSafetyScript

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

function New-TemporaryZipPath([string]$AssetName) {
  return (Join-Path $DistRoot (".$AssetName-" + [guid]::NewGuid().ToString('N') + '.tmp.zip'))
}

function Publish-ZipAtomically([string]$TemporaryZipPath, [string]$ZipPath) {
  if (-not (Test-Path -LiteralPath $TemporaryZipPath -PathType Leaf)) {
    Stop-Package "Validated ZIP is missing before publish: $TemporaryZipPath"
  }

  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    [System.IO.File]::Move($TemporaryZipPath, $ZipPath)
    return
  }

  $backupPath = Join-Path (Split-Path -Parent $ZipPath) ("." + [System.IO.Path]::GetFileName($ZipPath) + "." + [guid]::NewGuid().ToString('N') + '.backup.zip')
  [System.IO.File]::Replace($TemporaryZipPath, $ZipPath, $backupPath, $true)
  Move-ExistingZipToRecycleBin $backupPath
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
  $temporaryZipPath = New-TemporaryZipPath 'FlowCell-Core'

  Copy-PortableCore $packageRoot $BuiltExePath $AhkPath $AhkLicensePath
  try {
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $packageRoot,
      $temporaryZipPath,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )
    Ensure-ZipDirectoryEntry $temporaryZipPath 'Programs/'
    Assert-CoreZipInvariant $temporaryZipPath
    Publish-ZipAtomically $temporaryZipPath $zipPath
    Write-Host "Created: $zipPath"
  } finally {
    if (Test-Path -LiteralPath $temporaryZipPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryZipPath -Force
    }
  }
}

function New-FlowCellProgramPackage([System.IO.DirectoryInfo]$ProgramDirectory) {
  $assetName = Convert-ToAssetName $ProgramDirectory.Name
  $packageRoot = Join-Path $StagingRoot $assetName
  $programsPackageRoot = Join-Path $packageRoot 'Programs'
  $destination = Join-Path $programsPackageRoot $ProgramDirectory.Name
  $zipPath = Join-Path $DistRoot "FlowCell-$assetName.zip"
  $temporaryZipPath = New-TemporaryZipPath "FlowCell-$assetName"
  $contract = Get-ProgramPackageContract $ProgramDirectory
  $trackedFiles = @(Get-TrackedProgramFiles $ProgramDirectory)
  Assert-ProgramManifestReferencesTracked $ProgramDirectory $contract.Manifest $trackedFiles

  New-Item -ItemType Directory -Path $programsPackageRoot -Force | Out-Null
  Copy-TrackedProgramFolder $ProgramDirectory $destination $trackedFiles
  Assert-ProgramStagingInvariant $packageRoot $ProgramDirectory.Name $contract.MutableFolders

  try {
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $packageRoot,
      $temporaryZipPath,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false
    )
    Assert-ProgramZipInvariant $temporaryZipPath $ProgramDirectory.Name $contract.MutableFolders
    Publish-ZipAtomically $temporaryZipPath $zipPath
    Write-Host "Created: $zipPath"
  } finally {
    if (Test-Path -LiteralPath $temporaryZipPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryZipPath -Force
    }
  }
}

function Assert-CoreZipInvariant([string]$ZipPath) {
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    if (-not ($entryNames -contains 'FlowCell.exe')) {
      Stop-Package 'Core ZIP is missing FlowCell.exe.'
    }
    if (-not ($entryNames -contains 'Programs/')) {
      Stop-Package 'Core ZIP is missing its empty Programs directory.'
    }
    $programPayload = @($entryNames | Where-Object {
      $_.StartsWith('Programs/', [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $_.Equals('Programs/', [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($programPayload.Count -gt 0) {
      Stop-Package "Core ZIP unexpectedly contains program payload: $($programPayload[0])"
    }
  } finally {
    $archive.Dispose()
  }
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
  Write-Host "FlowCell release assets are ready in ${DistRoot}:"
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
