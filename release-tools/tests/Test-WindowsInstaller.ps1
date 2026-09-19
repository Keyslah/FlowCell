<#
Purpose: Exercise NSIS install, Start Menu launch, upgrade, and uninstall on disposable CI Windows.
Inputs: Setup executable; GitHub-hosted Windows runner required to protect real user profiles.
Writes: Temporary install root and the runner's fresh AppData FlowCell data. Creates sentinels.
Deletion: Runs normal NSIS uninstall for the application; verifies user sentinels survive.
Constraints: Never runs on a developer desktop. Does not claim interactive/host-app validation.
#>
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP){throw 'Installer smoke test requires a disposable GitHub Actions Windows runner.'}
$install=Join-Path $env:RUNNER_TEMP 'FlowCell Install With Spaces'
$local=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FlowCell/local'
if(Test-Path -LiteralPath $local){throw 'Expected a fresh CI user data root.'}
Remove-Item Env:FLOWCELL_LOCAL_ROOT -ErrorAction SilentlyContinue
Remove-Item Env:FLOWCELL_PROGRAMS_ROOT -ErrorAction SilentlyContinue
function Run-Setup {
    $p=Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$install") -PassThru -Wait -WindowStyle Hidden
    if($p.ExitCode -ne 0){throw "Installer returned $($p.ExitCode)"}
}
function Stop-SmokeApp {
    Get-Process -Name flowcell_frontend -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq (Join-Path $install 'flowcell_frontend.exe')} | Stop-Process -Force
}
function Launch-And-Check([string]$expectedLocal) {
    $sentinel=Join-Path $expectedLocal 'button-system/last-bootstrap-error.log'
    [IO.Directory]::CreateDirectory((Split-Path -Parent $sentinel))|Out-Null
    [IO.File]::WriteAllText($sentinel,'INSTALLER_SMOKE_PENDING')
    $shell=New-Object -ComObject WScript.Shell
    $shortcut=@(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Programs')) -Recurse -Filter '*FlowCell*.lnk'|Where-Object {$shell.CreateShortcut($_.FullName).TargetPath -eq (Join-Path $install 'flowcell_frontend.exe')})
    if($shortcut.Count -ne 1){throw 'Missing or ambiguous FlowCell Start Menu shortcut.'}
    Start-Process -FilePath $shortcut[0].FullName -WorkingDirectory $env:SystemRoot -WindowStyle Hidden
    $deadline=[DateTime]::UtcNow.AddSeconds(90)
    while((Test-Path -LiteralPath $sentinel) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 400}
    if(Test-Path -LiteralPath $sentinel){throw ('Frontend bootstrap failed: '+[IO.File]::ReadAllText($sentinel))}
    $frontend=@(Get-Process -Name flowcell_frontend -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq (Join-Path $install 'flowcell_frontend.exe')})
    if($frontend.Count -ne 1){throw 'Installed frontend did not remain running.'}
    $runtime=Join-Path $install 'flowcellbackend/runtime/AutoHotkey64.exe'
    $backend=@(Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe'"|Where-Object {$_.ExecutablePath -eq $runtime -and $_.CommandLine -like '*--headless*'})
    if($backend.Count -ne 1){throw 'Start Menu launch did not start the required bundled backend.'}
    if(-not (Test-Path -LiteralPath (Join-Path $expectedLocal 'Programs/Windows'))){throw 'Missing empty Windows placeholder.'}
    if(Test-Path -LiteralPath (Join-Path $expectedLocal 'Programs/Windows/flowcell.program.json')){throw 'Placeholder incorrectly became a registered program.'}
    if(-not (Test-Path -LiteralPath (Join-Path $expectedLocal 'bindings.ini'))){throw 'Bindings were not written to the resolved local root.'}
    foreach($forbidden in @('Programs','local','flowcellbackend/local')){if(Test-Path -LiteralPath (Join-Path $install $forbidden)){throw "Writable data appeared inside installation: $forbidden"}}
    foreach($forbidden in @('panels','scripts')){if(Test-Path -LiteralPath (Join-Path $expectedLocal $forbidden)){throw "Global mutable folder created: $forbidden"}}
    Stop-SmokeApp
}
Run-Setup
Launch-And-Check $local
$userFile=Join-Path $local 'Programs/Windows/preserve-user-data.txt'
[IO.File]::WriteAllText($userFile,'keep through upgrade and uninstall')
Run-Setup
if([IO.File]::ReadAllText($userFile) -ne 'keep through upgrade and uninstall'){throw 'Upgrade modified user data.'}
Launch-And-Check $local
& (Join-Path $install 'flowcellbackend/helpers/Stop-InstalledBackend.ps1') -ResourceRoot $install
$override=Join-Path $env:RUNNER_TEMP 'Explicit Local Data With Spaces'
$env:FLOWCELL_LOCAL_ROOT=$override
Launch-And-Check $override
$uninstaller=Join-Path $install 'uninstall.exe'
if(-not (Test-Path -LiteralPath $uninstaller)){throw 'Uninstall executable missing.'}
$p=Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
if($p.ExitCode -ne 0){throw "Uninstaller returned $($p.ExitCode)"}
Start-Sleep -Seconds 3
if([IO.File]::ReadAllText($userFile) -ne 'keep through upgrade and uninstall'){throw 'Uninstall modified user data.'}
if(Test-Path -LiteralPath (Join-Path $install 'flowcell_frontend.exe')){throw 'Application remained after uninstall.'}
Write-Output 'PASS: installer, fresh Start Menu launch, backend, unrelated cwd, spaces, default AppData, explicit override, upgrade/uninstall user-data preservation.'
