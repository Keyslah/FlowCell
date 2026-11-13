[CmdletBinding()]
param(
    [ValidateRange(2, 100)][int]$ButtonCount = 8,
    # Test-only comparison: run this fixture with Windows PowerShell itself to
    # measure the same adapter work without launching another process per owner.
    [switch]$ReuseProcess
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $temporaryBase ('flowcell-blender-sync-test-' + [guid]::NewGuid().ToString('N'))
$supportSource = Join-Path $PSScriptRoot '..\SupportScripts'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$previousLocal = $env:FLOWCELL_LOCAL_ROOT
$previousCounter = $env:FLOWCELL_TEST_SYNC_COUNT

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function New-Fixture([string]$Name) {
    $caseRoot = Join-Path $fixtureRoot $Name
    $support = Join-Path $caseRoot 'Programs\Blender\SupportScripts'
    $bridge = Join-Path $caseRoot 'addons\blender_bridge_flowcell'
    New-Item -ItemType Directory -Path $support, $bridge -Force | Out-Null
    foreach ($file in @('Install-BlenderFlowCellButtons.ps1', 'Sync-BlenderCustomActionCode.ps1', 'FlowCellBlenderBridgeLayout.ps1')) {
        Copy-Item -LiteralPath (Join-Path $supportSource $file) -Destination (Join-Path $support $file)
    }
    # Count actual sync execution in a disposable copy; production code is unchanged.
    $sync = Join-Path $support 'Sync-BlenderCustomActionCode.ps1'
    $body = [IO.File]::ReadAllText($sync)
    $marker = '$ErrorActionPreference = ''Stop'''
    Assert-True ($body.Contains($marker)) 'Sync fixture marker changed.'
    [IO.File]::WriteAllText($sync, $body.Replace($marker, ($marker + "`n" + 'Add-Content -LiteralPath $env:FLOWCELL_TEST_SYNC_COUNT -Value 1')))
    $config = Join-Path $caseRoot 'config.json'
    [IO.File]::WriteAllText($config, '{"automation":{}}')
    [IO.File]::WriteAllText((Join-Path $caseRoot 'addons\flowcell_actions.py'), "# isolated fixture`n")
    [IO.File]::WriteAllText((Join-Path $caseRoot 'addons\flowcell_bridge.py'), "# isolated fixture`n")
    $source = Join-Path $caseRoot 'action.py'
    [IO.File]::WriteAllText($source, "# Fixture action`ndef run_flowcell_action(context=None, data=None):`n    return None`n")
    return [pscustomobject]@{ Root = $caseRoot; Support = $support; Bridge = $bridge; Config = $config; Source = $source; Counter = (Join-Path $caseRoot 'sync-count.txt') }
}

function Invoke-FixtureScript($Fixture, [string]$Name, [string[]]$Arguments = @(), [switch]$ExpectFailure) {
    $env:FLOWCELL_LOCAL_ROOT = Join-Path $Fixture.Root 'local'
    $env:FLOWCELL_TEST_SYNC_COUNT = $Fixture.Counter
    $args = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Fixture.Support $Name), '-ConfigPath', $Fixture.Config, '-BridgeFolder', $Fixture.Bridge) + $Arguments
    # Capture native errors without letting the parent PowerShell preference hide
    # the child's exit code (this fixture intentionally exercises failures).
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($ReuseProcess) {
            $parameters = @{ ConfigPath = $Fixture.Config; BridgeFolder = $Fixture.Bridge }
            for ($i = 0; $i -lt $Arguments.Count; $i++) {
                $key = $Arguments[$i].TrimStart('-')
                if ($key -eq 'SkipSync') { $parameters[$key] = $true }
                else { $i++; $parameters[$key] = $Arguments[$i] }
            }
            try { $output = @(& (Join-Path $Fixture.Support $Name) @parameters 2>&1); $code = 0 }
            catch { $output = @($_); $code = 1 }
        }
        else { $output = @(& $powershell @args 2>&1); $code = $LASTEXITCODE }
    }
    finally { $ErrorActionPreference = $oldPreference }
    if ($ExpectFailure) {
        Assert-True ($code -ne 0) 'Expected the final synchronization failure to propagate.'
        return
    }
    if ($code -ne 0) { throw ('Fixture script failed: ' + ($output -join "`n")) }
    return (($output -join "`n") | ConvertFrom-Json)
}

function Install-FixtureOwner($Fixture, [string]$Owner, [switch]$Deferred, [string]$Source = '') {
    if (-not $Source) { $Source = $Fixture.Source }
    $args = @('-SelectedPaths', $Source, '-PanelName', 'Files', '-OwnerButtonId', $Owner)
    if ($Deferred) { $args += '-SkipSync' }
    return Invoke-FixtureScript $Fixture 'Install-BlenderFlowCellButtons.ps1' $args
}

function Read-FixtureRegistry($Fixture) {
    return (Get-Content -LiteralPath (Join-Path $Fixture.Bridge 'flowcell_custom_actions.json') -Raw | ConvertFrom-Json)
}

try {
    $baseline = New-Fixture 'baseline'
    $deferred = New-Fixture 'deferred'
    $measurements = @()
    foreach ($case in @($baseline, $deferred)) {
        $isDeferred = $case -eq $deferred
        $seed = Install-FixtureOwner $case 'unrelated-owner' -Deferred
        Assert-True ($seed.installedCount -eq 1) 'Could not seed unrelated owner.'
        $watch = [Diagnostics.Stopwatch]::StartNew()
        for ($i = 0; $i -lt $ButtonCount; $i++) {
            $result = Install-FixtureOwner $case ('owner-' + $i) -Deferred:$isDeferred
            Assert-True ($result.installedCount -eq 1 -and $result.failedCount -eq 0) 'Owner installation failed.'
            Assert-True ([bool]$result.regeneratedFlowcellActions -eq (-not $isDeferred)) 'Unexpected per-owner synchronization behavior.'
        }
        if ($isDeferred) {
            Assert-True (-not (Test-Path -LiteralPath $case.Counter)) 'Deferred installs synchronized before the final boundary.'
            $syncResult = Invoke-FixtureScript $case 'Sync-BlenderCustomActionCode.ps1'
            Assert-True ($syncResult.UpdatedActions -eq ($ButtonCount + 1)) 'Final synchronization lost an owner.'
        }
        $watch.Stop()
        $syncCount = @(Get-Content -LiteralPath $case.Counter).Count
        Assert-True ($syncCount -eq $(if ($isDeferred) { 1 } else { $ButtonCount })) 'Wrong synchronization count.'
        $registry = Read-FixtureRegistry $case
        Assert-True (@($registry.actions).Count -eq ($ButtonCount + 1)) 'Unexpected registry size.'
        Assert-True (@($registry.actions | Where-Object { $_.ownerButtonId -eq 'unrelated-owner' }).Count -eq 1) 'Unrelated owner was lost.'
        $measurements += [pscustomobject]@{ mode = $(if ($isDeferred) { 'deferred' } else { 'per-button' }); processMode = $(if ($ReuseProcess) { 'shared' } else { 'per-button' }); powershellVersion = [string]$PSVersionTable.PSVersion; buttons = $ButtonCount; elapsedMs = $watch.ElapsedMilliseconds; syncCount = $syncCount }
    }
    $before = ((Read-FixtureRegistry $baseline) | ConvertTo-Json -Depth 10 -Compress).Replace($baseline.Root.Replace('\', '\\'), '<fixture>')
    $after = ((Read-FixtureRegistry $deferred) | ConvertTo-Json -Depth 10 -Compress).Replace($deferred.Root.Replace('\', '\\'), '<fixture>')
    Assert-True ($before -eq $after) 'Deferred synchronization changed the final owned registry.'

    $invalid = Join-Path $deferred.Root 'invalid.py'
    [IO.File]::WriteAllText($invalid, '# no callable entrypoint')
    $failure = Install-FixtureOwner $deferred 'invalid-owner' -Deferred -Source $invalid
    Assert-True ($failure.installedCount -eq 0 -and $failure.failedCount -eq 1) 'Invalid source was reported as installed.'
    Assert-True (@((Read-FixtureRegistry $deferred).actions).Count -eq ($ButtonCount + 1)) 'Failed registration changed existing ownership.'
    # A failed final sync must remain a failure to its native caller.
    [IO.File]::WriteAllText((Join-Path $deferred.Support 'Sync-BlenderCustomActionCode.ps1'), "param([string]`$ConfigPath, [string]`$BridgeFolder)`nthrow 'injected final synchronization failure'")
    Invoke-FixtureScript $deferred 'Sync-BlenderCustomActionCode.ps1' -ExpectFailure
    Write-Output 'PASS: deferred sync parity, exact sync count, unrelated ownership, invalid source, and final-sync failure.'
    $measurements | ConvertTo-Json -Compress
}
finally {
    $env:FLOWCELL_LOCAL_ROOT = $previousLocal
    $env:FLOWCELL_TEST_SYNC_COUNT = $previousCounter
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if (-not $resolvedFixture.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
