<#
Purpose: Build the installer-only release and every tracked program ZIP from one committed revision.
Context: Windows developer/CI tools installed, locked npm dependencies restored.
Inputs: AutoHotkey executable/license, optional output directory. No credentials required to build.
Writes: Ignored dist and Tauri build output. Prior installer ZIP is recycled before replacement.
Constraints: No portable ZIP, user state, registration, publication, or source mutation.
#>
[CmdletBinding()]
param([string]$AutoHotkeyExe='C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe', [string]$AutoHotkeyLicenseFile='C:\Program Files\AutoHotkey\license.txt', [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
$output=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $repo 'dist/release'}
& (Join-Path $PSScriptRoot 'prepare-installer.ps1') -AutoHotkeyExe $AutoHotkeyExe -AutoHotkeyLicenseFile $AutoHotkeyLicenseFile
Push-Location (Join-Path $repo 'FlowCellFrontend')
try { & npm.cmd run tauri build -- --config src-tauri/tauri.installer.conf.json; if($LASTEXITCODE -ne 0){throw "Tauri installer build failed: $LASTEXITCODE"} } finally {Pop-Location}
$installers=@(Get-ChildItem -LiteralPath (Join-Path $repo 'FlowCellFrontend/src-tauri/target/release/bundle/nsis') -Filter '*-setup.exe' -File)
if($installers.Count -ne 1){throw "Expected exactly one installer; found $($installers.Count)"}
[IO.Directory]::CreateDirectory($output)|Out-Null
$zip=Join-Path $output 'flowcellwindowsinstaller.zip'
if(Test-Path -LiteralPath $zip){Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($zip,'OnlyErrorDialogs','SendToRecycleBin')}
Compress-Archive -LiteralPath $installers[0].FullName -DestinationPath $zip
& (Join-Path $PSScriptRoot 'package-portable.ps1') -ProgramsOnly -OutputDirectory $output
& (Join-Path $PSScriptRoot 'verify-release.ps1') -Directory $output
Write-Output "Installer and all program packages built from $((& git -C $repo rev-parse HEAD).Trim()) in $output"
