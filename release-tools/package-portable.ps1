[CmdletBinding()]
param(
  [string]$BuiltExe,
  [string]$AutoHotkeyExe,
  [string]$AutoHotkeyLicenseFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistRoot = Join-Path $RepoRoot 'dist'
$PortableRoot = Join-Path $DistRoot 'FlowCell-portable'
$ZipPath = Join-Path $DistRoot 'FlowCell-portable.zip'

function Stop-Package([string]$Message) {
  throw "[FlowCell portable package] $Message"
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
  $excludeDirs = @('.git', 'dist', 'local', 'node_modules', 'target', 'bin', 'obj', '.vs')
  $excludeFiles = @('*.pdb', '*.log', '*.tmp')
  $robocopyArgs = @($Source, $Destination, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS', '/NP', '/XD') + $excludeDirs + @('/XF') + $excludeFiles
  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    Stop-Package "robocopy failed for $Source"
  }
}

function Copy-RootFile([string]$Name) {
  $source = Join-Path $RepoRoot $Name
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    Stop-Package "Required file missing: $Name"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $PortableRoot $Name) -Force
}

$builtExePath = Resolve-BuiltExe $BuiltExe
$ahk = Get-AhkPath $AutoHotkeyExe
$ahkLicense = Get-AhkLicense $AutoHotkeyLicenseFile $ahk

if (Test-Path -LiteralPath $PortableRoot) { Remove-Item -LiteralPath $PortableRoot -Recurse -Force }
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
New-Item -ItemType Directory -Path $PortableRoot -Force | Out-Null

Copy-Item -LiteralPath $builtExePath -Destination (Join-Path $PortableRoot 'FlowCell.exe') -Force
Copy-RootFile 'Start FlowCell.cmd'
Copy-RootFile 'README.md'
Copy-RootFile 'SETUP.md'
Copy-RootFile 'BUILD_FROM_SOURCE.md'
Copy-RootFile 'PROGRAM_SUMMARY.txt'

Copy-Folder (Join-Path $RepoRoot 'FlowCell') (Join-Path $PortableRoot 'FlowCell')
Copy-Folder (Join-Path $RepoRoot 'Programs') (Join-Path $PortableRoot 'Programs')
Copy-Folder (Join-Path $RepoRoot 'tools') (Join-Path $PortableRoot 'tools')
Copy-Folder (Join-Path $RepoRoot 'docs') (Join-Path $PortableRoot 'docs')

$runtime = Join-Path $PortableRoot 'FlowCell\runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Copy-Item -LiteralPath $ahk -Destination (Join-Path $runtime 'AutoHotkey64.exe') -Force
Copy-Item -LiteralPath $ahkLicense -Destination (Join-Path $runtime 'AutoHotkey-LICENSE.txt') -Force

@'
This package includes AutoHotkey v2, licensed under GPL-2.0.
AutoHotkey is third-party software and is not owned by FlowCell.
AutoHotkey project/source code:
https://github.com/AutoHotkey/AutoHotkey
'@ | Set-Content -LiteralPath (Join-Path $runtime 'AutoHotkey-SOURCE.txt') -Encoding UTF8

Compress-Archive -LiteralPath $PortableRoot -DestinationPath $ZipPath -Force
Write-Host "Portable package created: $ZipPath"
