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
foreach ($name in @('FlowCellPaths.ps1','Start-FlowCellBackend.ps1','Configure-InstalledBackendStartup.ps1')) {
    Copy-Item -LiteralPath (Join-Path $repo ('flowcellbackend/helpers/' + $name)) -Destination (Join-Path $helpers $name)
}
Copy-Item -LiteralPath (Join-Path $repo 'flowcellbackend/run_backend_hidden.vbs') -Destination (Join-Path $backend 'run_backend_hidden.vbs')
$saved = @{}
foreach ($key in @('FLOWCELL_LOCAL_ROOT','FLOWCELL_PROGRAMS_ROOT','FLOWCELL_RESOURCE_ROOT','FLOWCELL_BACKEND_ROLE')) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key,$null)
}
$registry = 'HKCU:\Software\FlowCell Startup Tests ' + [guid]::NewGuid().ToString('N')
$startup = Join-Path $root 'Startup With Spaces'
$local = Join-Path $root 'Physical User Data'
$launcher = Join-Path $helpers 'Start-FlowCellBackend.ps1'
$register = Join-Path $helpers 'Configure-InstalledBackendStartup.ps1'
try {
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
    $legacyStartupPath = Join-Path $startup 'FlowCell Hotkeys Startup.vbs'
    $legacyBytes = [Text.Encoding]::UTF8.GetBytes(('target = "' + (Join-Path $legacyRoot 'run_backend_hidden.vbs') + '"' + "`r`n"))
    [IO.File]::WriteAllBytes($legacyStartupPath,$legacyBytes)
    $env:FLOWCELL_LOCAL_ROOT = Join-Path $root 'Wrong Workspace Data'
    $env:FLOWCELL_PROGRAMS_ROOT = Join-Path $root 'Wrong Workspace Programs'
    & $register -ResourceRoot $root -StartupDirectory $startup -RegistryPath $registry -LocalRoot $local
    $config = Join-Path $root 'flowcell.runtime.json'
    $firstConfig = [IO.File]::ReadAllText($config)
    if (($firstConfig | ConvertFrom-Json).localRoot -ne $local) { throw 'First registration did not persist the physical local root.' }
    if (Test-Path -LiteralPath $legacyStartupPath) { throw 'Recognized legacy startup entry still launches a competing backend.' }
    $legacyBackup = @(Get-ChildItem -LiteralPath (Join-Path $local 'backups/startup-migration') -Filter 'FlowCell Hotkeys Startup.vbs' -File -Recurse)
    if ($legacyBackup.Count -ne 1 -or [Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyBackup[0].FullName)) -ne [Convert]::ToBase64String($legacyBytes)) { throw 'Legacy startup bytes were not preserved in the installed data backup.' }
    $installed = & $launcher -Role installed -DefinitionsOnly
    if ($installed.Role -ne 'installed' -or $installed.LocalRoot -ne $local -or $installed.ProgramsRoot -ne (Join-Path $local 'Programs')) { throw 'Inherited workspace roots contaminated installed launcher.' }
    if ($installed.Arguments -notcontains '--backend-role=installed') { throw 'Installed role was not explicit in AHK command.' }
    $shell = New-Object -ComObject WScript.Shell
    $link = Join-Path $startup 'FlowCell Background.lnk'
    $target = $shell.CreateShortcut($link)
    if ($target.TargetPath -ne (Join-Path $backend 'run_backend_hidden.vbs') -or $target.WorkingDirectory -ne $root) { throw 'Startup shortcut does not target the installed backend with its own cwd.' }
    if ((Get-ItemPropertyValue -LiteralPath $registry -Name InstalledResourceRoot) -ne $root) { throw 'Installed relay resource pointer was not registered.' }
    & $register -ResourceRoot $root -StartupDirectory $startup -RegistryPath $registry -LocalRoot (Join-Path $root 'Wrong Upgrade Data')
    if ([IO.File]::ReadAllText($config) -ne $firstConfig) { throw 'Repeat registration overwrote established runtime config.' }
    $unrelatedBytes = [Text.Encoding]::UTF8.GetBytes('target = "C:\Unrelated\run_backend_hidden.vbs"')
    [IO.File]::WriteAllBytes($legacyStartupPath,$unrelatedBytes)
    & $register -ResourceRoot $root -StartupDirectory $startup -RegistryPath $registry
    if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($legacyStartupPath)) -ne [Convert]::ToBase64String($unrelatedBytes)) { throw 'Unrecognized same-name startup entry was modified.' }
    $foreign = Join-Path $root 'Other Installation'
    & $register -Action Remove -ResourceRoot $foreign -StartupDirectory $startup -RegistryPath $registry
    if (-not (Test-Path -LiteralPath $link) -or (Get-ItemPropertyValue -LiteralPath $registry -Name InstalledResourceRoot) -ne $root) { throw 'Uninstall removed another installation ownership.' }
    & $register -Action Remove -ResourceRoot $root -StartupDirectory $startup -RegistryPath $registry
    if (Test-Path -LiteralPath $link) { throw 'Owned startup shortcut remained after removal.' }
    if ((Get-ItemProperty -LiteralPath $registry).PSObject.Properties['InstalledResourceRoot']) { throw 'Owned installed pointer remained after removal.' }
    if ([IO.File]::ReadAllText($config) -ne $firstConfig) { throw 'Startup removal modified data configuration.' }
    Write-Output 'PASS: explicit roles/root isolation, physical config, startup/registry registration, preserved legacy migration, unrelated startup preservation, repeat registration and guarded removal.'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key]) }
    if (Test-Path -LiteralPath $registry) { Remove-Item -LiteralPath $registry -Recurse }
}
