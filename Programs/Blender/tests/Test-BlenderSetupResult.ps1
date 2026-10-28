[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $temporaryBase ('flowcell-blender-setup-test-' + [guid]::NewGuid().ToString('N'))
$installerSource = Join-Path $PSScriptRoot '..\SupportScripts\Install-FlowCellBlenderAddon.ps1'
$fixtureInstaller = Join-Path $fixtureRoot 'Programs\Blender\SupportScripts\Install-FlowCellBlenderAddon.ps1'
$fixtureData = Join-Path $fixtureRoot 'appdata'
$fixtureLocal = Join-Path $fixtureRoot 'local'
$previousLocal = $env:FLOWCELL_LOCAL_ROOT
$previousTestData = $env:FLOWCELL_TEST_APPDATA
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-FixtureInstaller([switch]$CheckOnly) {
    $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $fixtureInstaller,
        '-BlenderExePath', (Join-Path $fixtureRoot 'Blender 5.2.1\blender.exe'))
    if ($CheckOnly) { $arguments += '-CheckOnly' }
    $output = @(& $powershell @arguments 2>&1)
    if ($LASTEXITCODE -ne 0) { throw ('Fixture installer failed: ' + ($output -join "`n")) }
    $marker = @($output | ForEach-Object { [string]$_ } | Where-Object { $_.StartsWith('FLOWCELL_PROGRAM_SETUP_RESULT=') })
    Assert-True ($marker.Count -eq 1) 'Expected exactly one typed setup result.'
    return ($marker[0].Substring('FLOWCELL_PROGRAM_SETUP_RESULT='.Length) | ConvertFrom-Json)
}

try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $fixtureInstaller) -Force | Out-Null
    # Redirect only the OS profile lookup in this disposable copy. Production
    # installer branches and all filesystem operations remain unchanged.
    $source = [IO.File]::ReadAllText($installerSource)
    $profileLookup = "[Environment]::GetFolderPath('ApplicationData')"
    Assert-True ($source.Contains($profileLookup)) 'Installer profile lookup changed; update the fixture explicitly.'
    [IO.File]::WriteAllText($fixtureInstaller, $source.Replace($profileLookup, '$env:FLOWCELL_TEST_APPDATA'))
    $payload = Join-Path $fixtureRoot 'Programs\Blender\Blender Addons - Copy contents Into Blender'
    New-Item -ItemType Directory -Path (Join-Path $payload 'blender_bridge_flowcell') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $payload 'flowcell_actions.py'), '# fixture')
    [IO.File]::WriteAllText((Join-Path $payload 'flowcell_bridge.py'), '# fixture')
    [IO.File]::WriteAllText((Join-Path $payload 'blender_bridge_flowcell\flowcell_custom_actions.json'), '{"actions":[]}')
    $env:FLOWCELL_TEST_APPDATA = $fixtureData
    $env:FLOWCELL_LOCAL_ROOT = $fixtureLocal

    $pending = Invoke-FixtureInstaller -CheckOnly
    Assert-True ($pending.status -eq 'needsHostInitialization') 'Missing settings must be pending.'
    Assert-True (-not (Test-Path -LiteralPath $fixtureLocal)) 'CheckOnly must not write logs or local state.'
    Assert-True (-not (Test-Path -LiteralPath $fixtureData)) 'CheckOnly must not create a host profile.'

    $unrelatedProfile = Join-Path $fixtureData 'Blender Foundation\Blender\4.5'
    New-Item -ItemType Directory -Path $unrelatedProfile -Force | Out-Null
    $pending = Invoke-FixtureInstaller
    Assert-True ($pending.status -eq 'needsHostInitialization') 'A different Blender profile must not satisfy the selected version.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $unrelatedProfile 'scripts'))) 'Pending setup must not write into another version.'

    $selectedProfile = Join-Path $fixtureData 'Blender Foundation\Blender\5.2'
    New-Item -ItemType Directory -Path $selectedProfile -Force | Out-Null
    $ready = Invoke-FixtureInstaller -CheckOnly
    Assert-True ($ready.status -eq 'ready') 'Patch-version executable must resolve to its major.minor profile.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $selectedProfile 'scripts'))) 'CheckOnly must not install the add-on.'

    $ready = Invoke-FixtureInstaller
    Assert-True ($ready.status -eq 'ready') 'Initialized setup should install successfully.'
    Assert-True (-not [string]::IsNullOrWhiteSpace($ready.restartNotes)) 'Ready setup must retain restart instructions.'
    $bridge = Join-Path $selectedProfile 'scripts\addons\blender_bridge_flowcell'
    Assert-True (Test-Path -LiteralPath (Join-Path $bridge 'ManagedActions')) 'Installer must create the managed action destination.'
    Assert-True (Test-Path -LiteralPath (Join-Path $selectedProfile 'scripts\startup\flowcell_startup_bootstrap.py')) 'Installer must create startup activation.'
    $registryPath = Join-Path $bridge 'flowcell_custom_actions.json'
    [IO.File]::WriteAllText($registryPath, '{"actions":["owned"]}')
    $null = Invoke-FixtureInstaller
    Assert-True ([IO.File]::ReadAllText($registryPath) -eq '{"actions":["owned"]}') 'Recheck must preserve installed Button ownership.'
    Write-Output 'PASS: 5 Blender setup fixture scenarios (missing profile, selected version, read-only check, ready install, repeat preservation).'
}
finally {
    $env:FLOWCELL_LOCAL_ROOT = $previousLocal
    $env:FLOWCELL_TEST_APPDATA = $previousTestData
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if (-not $resolvedFixture.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean a fixture outside the temporary directory.'
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
