<#
Purpose: Verify backend launcher role/path isolation and per-user startup ownership in fixtures.
Context: Windows PowerShell; no application launch, sign-in change or real FlowCell data writes.
Writes: Task temporary resource roots, shortcuts and one temporary HKCU test registry key.
Constraints: Environment restored; registration tests supply isolated LocalRoot/startup/registry.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$root = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell startup tests ' + [guid]::NewGuid().ToString('N'))
$backend = Join-Path $root 'flowcellbackend'
$helpers = Join-Path $backend 'helpers'
[IO.Directory]::CreateDirectory($helpers) | Out-Null
foreach ($name in @('FlowCellPaths.ps1','Start-FlowCellBackend.ps1','Configure-InstalledBackendStartup.ps1','AutoHotkeyState.ps1')) {
    Copy-Item -LiteralPath (Join-Path $repo ('flowcellbackend/helpers/' + $name)) -Destination (Join-Path $helpers $name)
}
Copy-Item -LiteralPath (Join-Path $repo 'flowcellbackend/run_backend_hidden.vbs') -Destination (Join-Path $backend 'run_backend_hidden.vbs')
# Registration discovers legacy evidence here; migration semantics have isolated
# state-helper tests. Never read/write this computer's actual AutoHotkey choice.
@'
function Import-FlowCellAutoHotkeyLegacyState {
    param([string[]]$LegacyRoots)
    ConvertTo-Json -InputObject @($LegacyRoots) | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'migration-candidates.json') -Encoding UTF8
}
'@ | Set-Content -LiteralPath (Join-Path $helpers 'AutoHotkeyState.ps1') -Encoding UTF8
$toggleDirectory = Join-Path $root 'tools/autohotkey v2 on off'
[IO.Directory]::CreateDirectory($toggleDirectory) | Out-Null
foreach ($name in @('Toggle-AutoHotkey.vbs','Toggle-AutoHotkey.ps1','Toggle-AutoHotkey-On.ico','Toggle-AutoHotkey-Off.ico')) {
    Copy-Item -LiteralPath (Join-Path $repo ('tools/autohotkey v2 on off/' + $name)) -Destination (Join-Path $toggleDirectory $name)
}
$saved = @{}
foreach ($key in @('FLOWCELL_LOCAL_ROOT','FLOWCELL_PROGRAMS_ROOT','FLOWCELL_RESOURCE_ROOT','FLOWCELL_BACKEND_ROLE')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key,$null)
}
$registry = 'HKCU:\Software\FlowCell Startup Tests ' + [guid]::NewGuid().ToString('N')
$startup = Join-Path $root 'Startup With Spaces'
$desktop = Join-Path $root 'Desktop With Spaces'
$registrationArguments = @{ ResourceRoot = $root; StartupDirectory = $startup; DesktopDirectory = $desktop; RegistryPath = $registry }
$local = Join-Path $root 'Physical User Data'
$launcher = Join-Path $helpers 'Start-FlowCellBackend.ps1'
$register = Join-Path $helpers 'Configure-InstalledBackendStartup.ps1'
$script:panelChecks = 0
function Assert-PanelChoice([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:panelChecks++
}
try {
    # Tauri saves its remembered destination in a child of the background
    # registration key. Recreating that parent with -Force erases the child.
    New-Item -Path $registry | Out-Null
    New-ItemProperty -LiteralPath $registry -Name ExistingUserSetting -Value 'preserve' -PropertyType String | Out-Null
    $installerRegistry = Join-Path $registry 'FlowCell'
    New-Item -Path $installerRegistry | Out-Null
    Set-Item -LiteralPath $installerRegistry -Value $root
    $development = & $launcher -DefinitionsOnly
    if ($development.Role -ne 'development' -or $development.LocalRoot -ne (Join-Path $backend 'local') -or $development.ProgramsRoot -ne (Join-Path $root 'Programs')) { throw 'Development launcher descriptor does not own source roots.' }
    if ($development.Arguments -notcontains '--backend-role=development') { throw 'Development role was not explicit in AHK command.' }
    '{}' | Set-Content -LiteralPath (Join-Path $root 'flowcell-installed.json')
    $legacyRoot = Join-Path $root 'Legacy Workspace'
    $legacyBackend = Join-Path $legacyRoot 'flowcellbackend'
    [IO.Directory]::CreateDirectory($legacyBackend) | Out-Null
    [IO.Directory]::CreateDirectory($startup) | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo 'run_backend_hidden.vbs') -Destination (Join-Path $legacyRoot 'run_backend_hidden.vbs')
    Copy-Item -LiteralPath (Join-Path $repo 'flowcellbackend/run_backend_hidden.vbs') -Destination (Join-Path $legacyBackend 'run_backend_hidden.vbs')
    '; test fixture backend, never launched' | Set-Content -LiteralPath (Join-Path $legacyBackend 'FlowCellBackend.ahk')
    $previousToggleDirectory = Join-Path $legacyRoot 'tools/autohotkey v2 on off'
    [IO.Directory]::CreateDirectory($previousToggleDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($desktop) | Out-Null
    foreach ($name in @('Toggle-AutoHotkey.vbs','Toggle-AutoHotkey.ps1')) {
        Copy-Item -LiteralPath (Join-Path $toggleDirectory $name) -Destination (Join-Path $previousToggleDirectory $name)
    }
    $shell = New-Object -ComObject WScript.Shell
    $oldToggle = $shell.CreateShortcut((Join-Path $desktop 'Toggle AutoHotkey.lnk'))
    $oldToggle.TargetPath = Join-Path $env:SystemRoot 'System32/wscript.exe'
    $oldToggle.Arguments = '"' + (Join-Path $previousToggleDirectory 'Toggle-AutoHotkey.vbs') + '"'
    $oldToggle.Save()
    $legacyStartupPath = Join-Path $startup 'FlowCell Hotkeys Startup.vbs'
    $legacyBytes = [Text.Encoding]::UTF8.GetBytes(('target = "' + (Join-Path $legacyRoot 'run_backend_hidden.vbs') + '"' + "`r`n"))
    [IO.File]::WriteAllBytes($legacyStartupPath,$legacyBytes)
    $env:FLOWCELL_LOCAL_ROOT = Join-Path $root 'Wrong Workspace Data'
    $env:FLOWCELL_PROGRAMS_ROOT = Join-Path $root 'Wrong Workspace Programs'
    & $register @registrationArguments -LocalRoot $local
    if (-not (Test-Path -LiteralPath $installerRegistry) -or
        (Get-Item -LiteralPath $installerRegistry).GetValue('') -ne $root -or
        (Get-ItemProperty -LiteralPath $registry).ExistingUserSetting -ne 'preserve') {
        throw 'Startup registration erased existing registry values or the installer remembered destination.'
    }
    $migrationCandidates = Get-Content -LiteralPath (Join-Path $helpers 'migration-candidates.json') -Raw | ConvertFrom-Json
    foreach ($expected in @((Join-Path $local 'autohotkey-toggle'), $toggleDirectory, $previousToggleDirectory, (Join-Path $legacyBackend 'local/autohotkey-toggle'))) {
        if ($migrationCandidates -notcontains $expected) { throw "Missing legacy toggle candidate before desktop shortcut replacement: $expected" }
    }
    $config = Join-Path $root 'flowcell.runtime.json'
    $firstConfig = [IO.File]::ReadAllText($config)
    if (($firstConfig | ConvertFrom-Json).localRoot -ne $local) { throw 'First registration did not persist the physical local root.' }
    $defaultPanelChoice = Join-Path $local 'installation-defaults/windows-panels.json'
    $defaultPanels = [IO.File]::ReadAllText($defaultPanelChoice) | ConvertFrom-Json
    Assert-PanelChoice (($defaultPanels.selectedPanels -join '|') -ceq 'Startup|Files|Utility') 'Default registration did not select mandatory Startup and both optional Windows panels.'
    if (Test-Path -LiteralPath $legacyStartupPath) { throw 'Recognized legacy startup entry still launches a competing backend.' }
    $legacyBackup = @(Get-ChildItem -LiteralPath (Join-Path $local 'backups/startup-migration') -Filter 'FlowCell Hotkeys Startup.vbs' -File -Recurse)
    if ($legacyBackup.Count -ne 1 -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyBackup[0].FullName)) -ne [Convert]::ToBase64String($legacyBytes)) { throw 'Legacy startup bytes were not preserved in the installed data backup.' }
    $installed = & $launcher -Role installed -DefinitionsOnly
    if ($installed.Role -ne 'installed' -or $installed.LocalRoot -ne $local -or $installed.ProgramsRoot -ne (Join-Path $local 'Programs')) { throw 'Inherited workspace roots contaminated installed launcher.' }
    if ($installed.Arguments -notcontains '--backend-role=installed') { throw 'Installed role was not explicit in AHK command.' }
    $shell = New-Object -ComObject WScript.Shell
    $link = Join-Path $startup 'FlowCell Background.lnk'
    $target = $shell.CreateShortcut($link)
    if ($target.TargetPath -ne (Join-Path $backend 'run_backend_hidden.vbs') -or $target.WorkingDirectory -ne $root -or $target.Arguments -ne '--logon') { throw 'Startup shortcut does not target the installed backend with its own cwd and logon mode.' }
    $desktopLink = Join-Path $desktop 'Toggle AutoHotkey.lnk'
    $desktopTarget = $shell.CreateShortcut($desktopLink)
    if ($desktopTarget.TargetPath -ne (Join-Path $env:SystemRoot 'System32/wscript.exe') -or $desktopTarget.Arguments -ne ('"' + (Join-Path $toggleDirectory 'Toggle-AutoHotkey.vbs') + '"') -or $desktopTarget.WorkingDirectory -ne $toggleDirectory) { throw 'Default desktop toggle is not independent of FlowCell UI and AutoHotkey.' }
    if ($desktopTarget.IconLocation -notlike ($toggleDirectory + '\Toggle-AutoHotkey-*.ico,*')) { throw 'Desktop toggle icon does not use the installed icon resources.' }
    if (Test-Path -LiteralPath (Join-Path $local 'Programs/Windows')) { throw 'Background registration created a Windows program or panel before native panel selection.' }
    $uncheckedDesktop = Join-Path $root 'Unchecked Desktop'
    & $register -ResourceRoot $root -StartupDirectory $startup -RegistryPath $registry -DesktopDirectory $uncheckedDesktop -DesktopToggle Skip
    if (Test-Path -LiteralPath (Join-Path $uncheckedDesktop 'Toggle AutoHotkey.lnk')) { throw 'Unchecked desktop option created a shortcut.' }
    if ((Get-ItemPropertyValue -LiteralPath $registry -Name InstalledResourceRoot) -ne $root) { throw 'Installed relay resource pointer was not registered.' }
    & $register @registrationArguments -LocalRoot (Join-Path $root 'Wrong Upgrade Data')
    if ([IO.File]::ReadAllText($config) -ne $firstConfig) { throw 'Repeat registration overwrote established runtime config.' }
    if ((Get-Item -LiteralPath $installerRegistry).GetValue('') -ne $root -or (Get-ItemProperty -LiteralPath $registry).ExistingUserSetting -ne 'preserve') { throw 'Repeat registration changed existing installer registry metadata.' }
    $fixtureWindows = Join-Path $local 'Programs/Windows'
    [IO.Directory]::CreateDirectory($fixtureWindows) | Out-Null
    $fixtureManifest = Join-Path $fixtureWindows 'flowcell.program.json'
    $manifestBytes = [Text.Encoding]::UTF8.GetBytes('{"programId":"windows","panelsFolder":"Custom Panels","defaultPanels":["Existing"]}')
    [IO.File]::WriteAllBytes($fixtureManifest, $manifestBytes)
    $existingPanel = Join-Path $fixtureWindows 'Custom Panels/Existing'
    [IO.Directory]::CreateDirectory($existingPanel) | Out-Null
    $existingScript = Join-Path $existingPanel 'keep.ps1'
    $existingScriptBytes = [Text.Encoding]::UTF8.GetBytes('# preserve the selected existing panel exactly')
    [IO.File]::WriteAllBytes($existingScript, $existingScriptBytes)
    $fixtureState = Join-Path $local 'button-system/button-state.json'
    [IO.Directory]::CreateDirectory((Split-Path -Parent $fixtureState)) | Out-Null
    $stateBytes = [Text.Encoding]::UTF8.GetBytes('{"fixture":"existing scripts, bindings and panel selection are preserved"}')
    [IO.File]::WriteAllBytes($fixtureState, $stateBytes)
    & $register @registrationArguments
    $fixtureStartup = Join-Path $fixtureWindows 'Custom Panels/Startup'
    if (Test-Path -LiteralPath $fixtureStartup) { throw 'Background registration created an unchecked Startup panel.' }
    if (Test-Path -LiteralPath (Join-Path $fixtureWindows 'Panels')) { throw 'Background registration created the default panel root beside a custom panel selection.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($existingScript)) -ne [Convert]::ToBase64String($existingScriptBytes)) { throw 'Background registration modified an existing selected panel.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($fixtureManifest)) -ne [Convert]::ToBase64String($manifestBytes) -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($fixtureState)) -ne [Convert]::ToBase64String($stateBytes)) { throw 'Upgrade modified existing program or Button settings.' }
    [IO.Directory]::CreateDirectory($fixtureStartup) | Out-Null
    $startupScript = Join-Path $fixtureStartup 'keep-startup.ps1'
    $startupScriptBytes = [Text.Encoding]::UTF8.GetBytes('# preserve an explicitly selected Startup panel')
    [IO.File]::WriteAllBytes($startupScript, $startupScriptBytes)
    & $register @registrationArguments
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($startupScript)) -ne [Convert]::ToBase64String($startupScriptBytes)) { throw 'Background registration modified an existing Startup panel.' }
    # Simulate deleting only the temporary Startup fixture created immediately above.
    $resolvedStartup = [IO.Path]::GetFullPath($fixtureStartup)
    $fixturePrefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if (-not $resolvedStartup.StartsWith($fixturePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Startup deletion fixture escaped the temporary test root.' }
    Remove-Item -LiteralPath $resolvedStartup -Recurse -Force
    & $register @registrationArguments
    if (Test-Path -LiteralPath $fixtureStartup) { throw 'Background registration recreated a deleted Startup panel.' }
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($existingScript)) -ne [Convert]::ToBase64String($existingScriptBytes)) { throw 'Repeat registration changed a surviving panel.' }
    # Replace only this temporary fixture launcher to verify installer call/error handling.
    @'
param([string]$Role, [switch]$Logon)
if ($Role -ne 'installed' -or $Logon) { throw 'Installer attempted a sign-in reset instead of an ordinary installed start.' }
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'simulate-start-failure')) { throw 'FIXTURE_BACKGROUND_START_FAILURE' }
'@ | Set-Content -LiteralPath $launcher -Encoding UTF8
    & $register @registrationArguments -Start
    [IO.File]::WriteAllText((Join-Path $helpers 'simulate-start-failure'), '')
    $observedFailure = $false
    try { & $register @registrationArguments -Start } catch { $observedFailure = $_.Exception.Message -eq 'FIXTURE_BACKGROUND_START_FAILURE' }
    if (-not $observedFailure) { throw 'Installer registration suppressed a background startup failure.' }
    if ($shell.CreateShortcut($desktopLink).Description -notlike '*startup failed*') { throw 'Desktop toggle did not report the failed startup accurately.' }
    $unrelatedBytes = [Text.Encoding]::UTF8.GetBytes('target = "C:\Unrelated\run_backend_hidden.vbs"')
    [IO.File]::WriteAllBytes($legacyStartupPath,$unrelatedBytes)
    & $register @registrationArguments
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyStartupPath)) -ne [Convert]::ToBase64String($unrelatedBytes)) { throw 'Unrecognized same-name startup entry was modified.' }
    $foreign = Join-Path $root 'Other Installation'
    & $register -Action Remove -ResourceRoot $foreign -StartupDirectory $startup -RegistryPath $registry -DesktopDirectory $desktop
    if (-not (Test-Path -LiteralPath $link) -or (Get-ItemPropertyValue -LiteralPath $registry -Name InstalledResourceRoot) -ne $root) { throw 'Uninstall removed another installation ownership.' }
    if (-not (Test-Path -LiteralPath $desktopLink)) { throw 'Uninstall removed a different installation desktop toggle.' }
    & $register @registrationArguments -Action Remove
    if (Test-Path -LiteralPath $link) { throw 'Owned startup shortcut remained after removal.' }
    if (Test-Path -LiteralPath $desktopLink) { throw 'Owned desktop toggle remained after removal.' }
    if ((Get-ItemProperty -LiteralPath $registry).PSObject.Properties['InstalledResourceRoot']) { throw 'Owned installed pointer remained after removal.' }
    if ((Get-Item -LiteralPath $installerRegistry).GetValue('') -ne $root -or (Get-ItemProperty -LiteralPath $registry).ExistingUserSetting -ne 'preserve') { throw 'Startup removal changed unrelated registry metadata.' }
    if ([IO.File]::ReadAllText($config) -ne $firstConfig) { throw 'Startup removal modified data configuration.' }
    $hooks = [IO.File]::ReadAllText((Join-Path $repo 'release-tools/installer-hooks.nsh'))
    if ($hooks -notmatch '\$\{NSD_Check\} \$FlowCellToggleCheckbox' -or $hooks -notmatch 'StrCpy \$1 "Install"' -or $hooks -notmatch '\-DesktopToggle \$1') { throw 'Installer desktop toggle option is not checked by default for UI and silent installation.' }
    Assert-PanelChoice ($hooks -match '\$\{NSD_Check\} \$FlowCellStartupCheckbox' -and $hooks -match 'EnableWindow \$FlowCellStartupCheckbox 0') 'Installer Startup panel is not checked and mandatory.'
    Assert-PanelChoice ($hooks -match '\$\{NSD_GetState\} \$FlowCellFilesCheckbox \$FlowCellFilesSelection' -and $hooks -match '\$\{NSD_GetState\} \$FlowCellUtilityCheckbox \$FlowCellUtilitySelection' -and $hooks -match '\-WindowsFiles \$2 \-WindowsUtility \$3') 'Installer panel checkbox choices are not passed to registration.'
    try {
        foreach ($files in @('Install','Skip')) {
            foreach ($utility in @('Install','Skip')) {
                $caseRoot = Join-Path $root ("Panel choices $files $utility")
                [IO.Directory]::CreateDirectory($caseRoot) | Out-Null
                @{localRoot=$caseRoot} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
                & $register @registrationArguments -WindowsFiles $files -WindowsUtility $utility -DesktopToggle Skip
                $choicePath = Join-Path $caseRoot 'installation-defaults/windows-panels.json'
                $bytes = [IO.File]::ReadAllBytes($choicePath)
                $choice = [IO.File]::ReadAllText($choicePath) | ConvertFrom-Json
                $expected = @('Startup')
                if ($files -eq 'Install') { $expected += 'Files' }
                if ($utility -eq 'Install') { $expected += 'Utility' }
                Assert-PanelChoice ($choice.schemaVersion -eq 1) "Panel choice schema is invalid for $files/$utility."
                Assert-PanelChoice (($choice.selectedPanels -join '|') -ceq ($expected -join '|')) "Checkbox selection was not preserved, including mandatory Startup, for $files/$utility."
                Assert-PanelChoice (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)) "Installer panel JSON has a UTF-8 BOM for $files/$utility."
                & $register @registrationArguments -WindowsFiles $(if ($files -eq 'Install') {'Skip'} else {'Install'}) -WindowsUtility $(if ($utility -eq 'Install') {'Skip'} else {'Install'}) -DesktopToggle Skip
                Assert-PanelChoice ([Convert]::ToBase64String([IO.File]::ReadAllBytes($choicePath)) -ceq [Convert]::ToBase64String($bytes)) "Upgrade overwrote established panel choices for $files/$utility."
            }
        }
        foreach ($completed in @('registration','receipt','marker')) {
            $caseRoot = Join-Path $root ("Existing Windows $completed")
            [IO.Directory]::CreateDirectory($caseRoot) | Out-Null
            @{localRoot=$caseRoot} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
            if ($completed -eq 'registration') {
                [IO.File]::WriteAllText((Join-Path $caseRoot 'bindings.ini'), "[ProgramTab_2]`r`nLabel=Windows`r`nNormalizedName=windows`r`n")
            } elseif ($completed -eq 'receipt') {
                [IO.Directory]::CreateDirectory((Join-Path $caseRoot 'program-setup-status')) | Out-Null
                [IO.File]::WriteAllText((Join-Path $caseRoot 'program-setup-status/77696e646f7773.json'), '{"programName":"Windows","status":"ready"}')
            } else {
                [IO.Directory]::CreateDirectory((Join-Path $caseRoot 'installation-defaults')) | Out-Null
                [IO.File]::WriteAllText((Join-Path $caseRoot 'installation-defaults/windows.json'), '{"schemaVersion":1,"programName":"Windows"}')
            }
            & $register @registrationArguments -WindowsFiles Skip -WindowsUtility Skip -DesktopToggle Skip
            Assert-PanelChoice (-not (Test-Path -LiteralPath (Join-Path $caseRoot 'installation-defaults/windows-panels.json'))) "Upgrade created pending panel choices despite existing Windows $completed."
        }
    } finally { [IO.File]::WriteAllText($config, $firstConfig) }
    Write-Output "PASS: $script:panelChecks Windows installer panel checks; role/root isolation, startup logon registration, default desktop toggle and opt-out, installed icons, no implicit program/panel creation or deleted Startup resurrection, existing panel and settings preservation, ordinary upgrade launch, reported startup failure, legacy migration and scoped uninstall removal."
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key]) }
    if (Test-Path -LiteralPath $registry) { Remove-Item -LiteralPath $registry -Recurse }
}
