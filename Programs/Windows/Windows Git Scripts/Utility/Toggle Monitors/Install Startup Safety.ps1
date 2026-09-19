[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$ButtonConfigPath,

    [Parameter()]
    [string]$PythonwPath,

    [Parameter()]
    [switch]$ValidateOnly,

    [Parameter()]
    [switch]$StartNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is unavailable; the stable per-user safety directory cannot be resolved.'
}

$taskName = 'FlowCell Restore All Available Monitors'
$destinationDirectory = Join-Path $env:LOCALAPPDATA 'FlowCell\ToggleMonitorsStartupSafety'
$destinationScriptPath = Join-Path $destinationDirectory 'toggle_monitors.py'
$destinationConfigPath = Join-Path $destinationDirectory 'toggle-monitors.txt'
$sourceScriptPath = Join-Path $PSScriptRoot 'toggle_monitors.py'

function Resolve-ExistingFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) {
        throw "$Description was not found: $LiteralPath"
    }

    return (Resolve-Path -LiteralPath $LiteralPath).ProviderPath
}

function Resolve-ButtonConfig {
    if (-not [string]::IsNullOrWhiteSpace($ButtonConfigPath)) {
        return Resolve-ExistingFile -LiteralPath $ButtonConfigPath -Description 'Button runtime config'
    }

    # Installed Button packages keep immutable source and mutable runtime as siblings.
    $ownerDirectory = Split-Path -Parent $PSScriptRoot
    $siblingConfigPath = Join-Path $ownerDirectory 'runtime\toggle-monitors.txt'
    if (Test-Path -LiteralPath $siblingConfigPath -PathType Leaf) {
        return (Resolve-Path -LiteralPath $siblingConfigPath).ProviderPath
    }

    throw ('No Button runtime config was supplied or found beside this source package. ' +
        'Run this installer from an installed Button source folder, or pass -ButtonConfigPath.')
}

function Read-ConfiguredPythonwPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath
    )

    foreach ($line in Get-Content -LiteralPath $ConfigPath -Encoding UTF8) {
        if ($line -match '^\s*PYTHONW\s*=\s*(.+?)\s*$') {
            return $Matches[1].Trim().Trim('"')
        }
    }

    return $null
}

function Resolve-PythonwExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigPath
    )

    $candidate = $PythonwPath
    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $candidate = Read-ConfiguredPythonwPath -ConfigPath $ConfigPath
    }

    if ([string]::IsNullOrWhiteSpace($candidate)) {
        $pythonwCommand = Get-Command 'pythonw.exe' -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $pythonwCommand) {
            $candidate = $pythonwCommand.Source
        }
    }

    if ([string]::IsNullOrWhiteSpace($candidate)) {
        throw 'pythonw.exe could not be resolved. Pass -PythonwPath or save PYTHONW in the Button runtime config.'
    }

    $resolved = Resolve-ExistingFile -LiteralPath $candidate -Description 'pythonw.exe'
    if (-not [System.IO.Path]::GetFileName($resolved).Equals('pythonw.exe', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "The resolved Python launcher is not pythonw.exe: $resolved"
    }

    return $resolved
}

function ConvertTo-TaskArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ($Value.Contains('"')) {
        throw "A scheduled-task argument contains an unsupported quote character: $Value"
    }

    return '"' + $Value + '"'
}

function ConvertTo-XmlText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    return [System.Security.SecurityElement]::Escape($Value)
}

function Copy-FileAtomically {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $temporaryPath = $Destination + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        Copy-Item -LiteralPath $Source -Destination $temporaryPath -Force
        Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

$resolvedSourceScriptPath = Resolve-ExistingFile -LiteralPath $sourceScriptPath -Description 'Toggle Monitors engine'
$resolvedConfigPath = Resolve-ButtonConfig
$resolvedPythonwPath = Resolve-PythonwExecutable -ConfigPath $resolvedConfigPath

$engineText = Get-Content -LiteralPath $resolvedSourceScriptPath -Raw -Encoding UTF8
if ($engineText -notmatch '(?m)--startup-safety-guardian') {
    throw 'The Toggle Monitors engine does not expose --startup-safety-guardian.'
}

$configText = Get-Content -LiteralPath $resolvedConfigPath -Raw -Encoding UTF8
if ($configText -notmatch '(?m)^\s*SCHEMA\s*=\s*3\s*$' -or
    $configText -notmatch '(?m)^\s*GROUP_1\s*=\s*\S+' -or
    $configText -notmatch '(?m)^\s*GROUP_2\s*=\s*\S+') {
    throw "The selected Button runtime config is not a complete schema-3 two-group configuration: $resolvedConfigPath"
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($null -eq $currentIdentity.User) {
    throw 'The current Windows user SID could not be resolved.'
}

$currentUserSid = $currentIdentity.User.Value
if ($currentUserSid -in @('S-1-5-18', 'S-1-5-19', 'S-1-5-20')) {
    throw 'Startup safety must be installed by the interactive user, not a Windows service account.'
}

if ($null -eq (Get-Command 'Register-ScheduledTask' -ErrorAction SilentlyContinue)) {
    throw 'The Windows Register-ScheduledTask command is unavailable.'
}

$actionArguments = @(
    (ConvertTo-TaskArgument -Value $destinationScriptPath)
    '--startup-safety-guardian'
    '--button-config'
    (ConvertTo-TaskArgument -Value $destinationConfigPath)
) -join ' '

$xmlTaskName = ConvertTo-XmlText -Value ('\' + $taskName)
$xmlAuthor = ConvertTo-XmlText -Value $currentIdentity.Name
$xmlUserSid = ConvertTo-XmlText -Value $currentUserSid
$xmlPythonwPath = ConvertTo-XmlText -Value $resolvedPythonwPath
$xmlActionArguments = ConvertTo-XmlText -Value $actionArguments
$xmlWorkingDirectory = ConvertTo-XmlText -Value $destinationDirectory

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$xmlAuthor</Author>
    <URI>$xmlTaskName</URI>
    <Description>Restore every available display, including dummy monitors, independently of toggle groups at sign-in and across lock, unlock, sleep, and resume.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$xmlUserSid</UserId>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <UserId>$xmlUserSid</UserId>
      <StateChange>SessionLock</StateChange>
    </SessionStateChangeTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <UserId>$xmlUserSid</UserId>
      <StateChange>SessionUnlock</StateChange>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="CurrentUser">
      <UserId>$xmlUserSid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="CurrentUser">
    <Exec>
      <Command>$xmlPythonwPath</Command>
      <Arguments>$xmlActionArguments</Arguments>
      <WorkingDirectory>$xmlWorkingDirectory</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# Parse before any mutation so malformed task XML fails even under -ValidateOnly.
$parsedTaskXml = [xml]$taskXml
if ($null -eq $parsedTaskXml.Task.Triggers.LogonTrigger -or
    @($parsedTaskXml.Task.Triggers.SessionStateChangeTrigger).Count -ne 2) {
    throw 'The startup-safety task XML does not contain exactly the required logon, lock, and unlock triggers.'
}

# Ask Task Scheduler to parse an in-memory definition. This validates its native
# schema without creating, updating, or starting any task.
$taskService = New-Object -ComObject 'Schedule.Service'
$taskService.Connect()
$taskDefinition = $taskService.NewTask(0)
$taskDefinition.XmlText = $taskXml
if ($taskDefinition.Triggers.Count -ne 3 -or
    $taskDefinition.Principal.LogonType -ne 3 -or
    $taskDefinition.Principal.RunLevel -ne 0 -or
    $taskDefinition.Settings.MultipleInstances -ne 2 -or
    -not $taskDefinition.Settings.Hidden -or
    $taskDefinition.Settings.DisallowStartIfOnBatteries -or
    $taskDefinition.Settings.StopIfGoingOnBatteries) {
    throw 'Task Scheduler did not preserve the required current-user safety contract.'
}

# A routine Button refresh must not undo an explicit pause of recovery.
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$preserveDisabled = $null -ne $existingTask -and -not $existingTask.Settings.Enabled
if ($preserveDisabled) {
    $taskDefinition.Settings.Enabled = $false
    $taskXml = $taskDefinition.XmlText
}

$result = [ordered]@{
    TaskName = $taskName
    User = $currentIdentity.Name
    UserSid = $currentUserSid
    LogonType = 'InteractiveToken'
    RunLevel = 'LeastPrivilege'
    Triggers = @('Logon', 'SessionLock', 'SessionUnlock')
    PythonwPath = $resolvedPythonwPath
    SourceScriptPath = $resolvedSourceScriptPath
    SourceConfigPath = $resolvedConfigPath
    InstalledDirectory = $destinationDirectory
    InstalledScriptPath = $destinationScriptPath
    InstalledConfigPath = $destinationConfigPath
    StartRequested = [bool]$StartNow
    PreservedDisabled = [bool]$preserveDisabled
}

if ($ValidateOnly) {
    $result.Mode = 'ValidateOnly'
    [pscustomobject]$result
    return
}

if (-not $PSCmdlet.ShouldProcess($destinationDirectory, 'Install Toggle Monitors startup-safety files and register the current-user task')) {
    $result.Mode = 'WhatIf'
    [pscustomobject]$result
    return
}

New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
Copy-FileAtomically -Source $resolvedSourceScriptPath -Destination $destinationScriptPath
Copy-FileAtomically -Source $resolvedConfigPath -Destination $destinationConfigPath

Register-ScheduledTask -TaskName $taskName -Xml $taskXml -Force | Out-Null

if ($StartNow -and -not $preserveDisabled) {
    $registeredTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    if ([string]$registeredTask.State -ne 'Running') {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }
}

$result.Mode = if ($preserveDisabled) { 'InstalledDisabled' } elseif ($StartNow) { 'InstalledAndStarted' } else { 'Installed' }
[pscustomobject]$result
