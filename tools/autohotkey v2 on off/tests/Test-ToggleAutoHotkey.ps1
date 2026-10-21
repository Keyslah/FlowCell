$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourcePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Toggle-AutoHotkey.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if (@($parseErrors).Count -gt 0) { throw ($parseErrors | Out-String) }

# Load definitions only. Never execute the real toggle's top-level statements.
$definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false))
foreach ($definition in $definitions) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
foreach ($required in @('Invoke-AutoHotkeyToggle', 'Invoke-ToggleWithFeedback')) {
    if (-not ($definitions.Name -contains $required)) { throw "Missing function: $required" }
}

$script:Assertions = 0
function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
    $script:Assertions++
}

$script:ToggleRoot = Join-Path ([IO.Path]::GetTempPath()) ('FlowCellToggleTests-' + [guid]::NewGuid().ToString('N'))
$script:ToggleStatePath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleState.txt'
$script:ToggleStatusPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleStatus.json'
$script:ToggleSnapshotPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggleSnapshot.json'
$script:ToggleLogPath = Join-Path $script:ToggleRoot 'AutoHotkeyToggle.log'
$script:FixtureExePath = Join-Path $script:ToggleRoot 'fixture.exe'
$script:FixtureArguments = '"fixture.ahk" --headless'

# Every process boundary is mocked, including guards against an accidental new
# dependency on direct CIM/process access. No real hotkeys, shortcuts or popups.
function Get-CimInstance { throw 'Tests must not enumerate real processes.' }
function Get-AllAutoHotkeyProcesses { return @($script:FakeProcesses) }
function Start-Process {
    param([string]$FilePath, $ArgumentList, [string]$WindowStyle)
    $script:StartCalls++
    if ($script:FailStart) { throw 'Synthetic launch failure' }
    Assert-True ($FilePath -eq $script:FixtureExePath) 'An unexpected executable was requested.'
    $script:FakeProcesses = @([pscustomobject]@{
        ProcessId = 424242
        ExecutablePath = $FilePath
        CommandLine = '"' + $FilePath + '" ' + ($ArgumentList -join ' ')
    })
}
function Stop-Process {
    param([int]$Id, [switch]$Force, [string]$ErrorAction)
    $script:StopCalls++
    Assert-True ($Id -eq 424242) 'An unexpected process stop was requested.'
    $script:FakeProcesses = @()
}
function Start-ManagedHotkeyLaunchers { throw 'Fixture snapshot should supply the launcher.' }
function Set-DesktopShortcut {
    param([string]$State)
    $script:ShortcutStates += $State
    if ($script:FailPresentation) { throw 'Synthetic shortcut failure' }
}
function New-Object {
    param([string]$ComObject)
    if ($ComObject -ne 'WScript.Shell') { throw "Unexpected COM request: $ComObject" }
    $shell = [pscustomobject]@{}
    $shell | Add-Member -MemberType ScriptMethod -Name Popup -Value {
        param($Message, $Seconds, $Title, $Flags)
        $script:Popups += [pscustomobject]@{
            Message = $Message; Seconds = $Seconds; Title = $Title; Flags = $Flags
        }
        return 1
    }
    return $shell
}
function Reset-Fixture {
    param([bool]$Running = $false)
    $script:StatusOnly = $false
    $script:StartCalls = 0
    $script:StopCalls = 0
    $script:FailStart = $false
    $script:FailPresentation = $false
    $script:ShortcutStates = @()
    $script:Popups = @()
    $script:FakeProcesses = @()
    if ($Running) {
        $script:FakeProcesses = @([pscustomobject]@{
            ProcessId = 424242
            ExecutablePath = $script:FixtureExePath
            CommandLine = '"' + $script:FixtureExePath + '" ' + $script:FixtureArguments
        })
    }
    Save-HotkeySnapshot -Entries @([pscustomobject]@{
        ExecutablePath = $script:FixtureExePath
        ArgumentString = $script:FixtureArguments
    })
}
function Read-FixtureStatus {
    return (Get-Content -LiteralPath $script:ToggleStatusPath -Raw | ConvertFrom-Json)
}

try {
    Ensure-Directory -Path $script:ToggleRoot
    Set-Content -LiteralPath $script:FixtureExePath -Value ''

    Reset-Fixture
    Assert-True (Invoke-ToggleWithFeedback) 'Turning ON unexpectedly failed.'
    $status = Read-FixtureStatus
    Assert-True ($status.state -eq 'on' -and $status.processCount -eq 1) 'ON status must reflect the running process.'
    Assert-True ($script:StartCalls -eq 1 -and $script:StopCalls -eq 0) 'Turning ON must restore the snapshot once.'
    Assert-True ($script:Popups.Count -eq 1 -and $script:Popups[0].Title -match 'ON') 'ON must produce a clearly titled popup.'
    Assert-True ($script:Popups[0].Seconds -eq 5 -and $script:Popups[0].Flags -eq 0x10040) 'ON feedback must last five seconds and be foreground-visible.'

    Reset-Fixture -Running $true
    Assert-True (Invoke-ToggleWithFeedback) 'Turning OFF unexpectedly failed.'
    $status = Read-FixtureStatus
    Assert-True ($status.state -eq 'off' -and $status.processCount -eq 0) 'OFF status must reflect zero processes.'
    Assert-True ($script:StopCalls -eq 1 -and $script:StartCalls -eq 0) 'Turning OFF must stop only the fixture.'
    Assert-True ($script:Popups.Count -eq 1 -and $script:Popups[0].Title -match 'OFF') 'OFF must produce a clearly titled popup.'

    foreach ($running in @($true, $false)) {
        Reset-Fixture -Running $running
        $snapshotBefore = Get-Content -LiteralPath $script:ToggleSnapshotPath -Raw
        $script:StatusOnly = $true
        Assert-True (Invoke-ToggleWithFeedback) 'Status-only inspection unexpectedly failed.'
        $status = Read-FixtureStatus
        $expectedState = if ($running) { 'on' } else { 'off' }
        Assert-True ($status.state -eq $expectedState) 'Status-only must report the measured state.'
        Assert-True ($script:StartCalls -eq 0 -and $script:StopCalls -eq 0) 'Status-only must never start or stop a process.'
        Assert-True ((Get-Content -LiteralPath $script:ToggleSnapshotPath -Raw) -eq $snapshotBefore) 'Status-only must preserve the saved restart snapshot.'
        Assert-True ($script:Popups.Count -eq 1) 'Status-only must show feedback.'
    }

    Reset-Fixture
    $script:FailStart = $true
    Assert-True (-not (Invoke-ToggleWithFeedback)) 'A launch exception must report failure.'
    $status = Read-FixtureStatus
    Assert-True ($status.state -eq 'off' -and $status.processCount -eq 0) 'A failed launch must not leave a stale ON indication.'
    Assert-True ($script:Popups.Count -eq 1 -and $script:Popups[0].Message -match 'Synthetic launch failure') 'A hidden launch error must be shown to the user.'
    Assert-True ($script:Popups[0].Flags -eq 0x10010) 'Error feedback must be foreground-visible with an error icon.'
    Assert-True ((Get-Content -LiteralPath $script:ToggleLogPath -Raw) -match 'Synthetic launch failure') 'Launch errors must be logged.'

    Reset-Fixture -Running $true
    $script:StatusOnly = $true
    $script:FailPresentation = $true
    Assert-True (-not (Invoke-ToggleWithFeedback)) 'A presentation exception must report failure.'
    Assert-True ($script:Popups.Count -eq 1 -and $script:Popups[0].Message -match 'Synthetic shortcut failure') 'A repeated presentation failure must not prevent the error popup.'
    Assert-True ($script:StartCalls -eq 0 -and $script:StopCalls -eq 0) 'Presentation recovery must preserve processes.'

    Reset-Fixture -Running $true
    $ensureDirectoryDefinition = ($definitions | Where-Object Name -eq 'Ensure-Directory').Extent.Text
    $originalLogPath = $script:ToggleLogPath
    # The nonexistent parent also forces the real logger to fail. The same
    # directory mock rejects status repair, leaving only visible error feedback.
    $script:ToggleLogPath = Join-Path $script:ToggleRoot 'missing-directory\toggle.log'
    function Ensure-Directory {
        param([string]$Path)
        throw 'Synthetic directory initialization failure'
    }
    try {
        Assert-True (-not (Invoke-ToggleWithFeedback 3>$null)) 'An initialization exception must report failure.'
        Assert-True (-not (Test-Path -LiteralPath $script:ToggleLogPath)) 'This case must exercise failure to write the error log.'
        Assert-True ($script:Popups.Count -eq 1 -and $script:Popups[0].Message -match 'Synthetic directory initialization failure') 'Initialization, logging and status repair failures must still show the original error.'
        Assert-True ($script:Popups[0].Flags -eq 0x10010) 'Initialization errors must use foreground error feedback.'
        Assert-True ($script:StartCalls -eq 0 -and $script:StopCalls -eq 0) 'Initialization failure must preserve processes.'
    }
    finally {
        . ([scriptblock]::Create($ensureDirectoryDefinition))
        $script:ToggleLogPath = $originalLogPath
    }

    Write-Output "PASS: $($script:Assertions) AutoHotkey toggle assertions. No real processes or shortcuts changed."
}
finally {
    # This unique directory contains only short-lived files created by this test.
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolvedFixture = [IO.Path]::GetFullPath($script:ToggleRoot)
    if ($resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolvedFixture).StartsWith('FlowCellToggleTests-')) {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}
