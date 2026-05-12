param(
    [Parameter(Mandatory = $true)]
    [string]$EnvelopePath,
    [Parameter(Mandatory = $true)]
    [string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:FlowCellHomeRoot = [System.IO.Path]::GetFullPath((Join-Path $script:ProjectRoot '..'))
$script:FlowCellLocalRoot = Join-Path $script:ProjectRoot 'local'
$script:FlowCellPrivateRoot = Join-Path $script:FlowCellLocalRoot 'private'
$script:LogsDir = Join-Path $script:FlowCellLocalRoot 'logs'
$script:CommandHostLogPath = Join-Path $script:LogsDir 'command_host.log'
$script:LastActionStatusPath = Join-Path $script:LogsDir 'last_action_status.txt'
$script:AhkScriptPath = Join-Path $script:ProjectRoot 'FlowCellBackend.ahk'

function Ensure-CommandHostDirectory([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-CommandHostLog([string]$Message) {
    Ensure-CommandHostDirectory -Path $script:LogsDir
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $script:CommandHostLogPath -Value ('[{0}] {1}' -f $timestamp, $Message) -Encoding UTF8
}

function Write-SharedTextFile([string]$Path, [string]$Text) {
    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        Ensure-CommandHostDirectory -Path $directory
    }
    Set-Content -LiteralPath $Path -Value $Text -Encoding UTF8
}

function Read-AllTextSafe([string]$Path, [string]$Default = '') {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Default }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $Default }
    try {
        return [string](Get-Content -LiteralPath $Path -Raw)
    }
    catch {
        return $Default
    }
}

function Get-ProgramLabelKey([string]$Label) {
    $normalizedLabel = [string]$Label
    if ($null -eq $normalizedLabel) { $normalizedLabel = '' }
    $normalizedLabel = $normalizedLabel.Trim().ToLowerInvariant()
    switch ($normalizedLabel) {
        'illustrator' { return 'illustrator' }
        'windows' { return 'windows' }
        'blender' { return 'blender' }
        'photoshop' { return 'photoshop' }
        default { return (($normalizedLabel -replace '[^a-z0-9]+', '_').Trim('_')) }
    }
}

function Get-FlowCellNormalizedPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    try {
        return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').ToLowerInvariant()
    }
    catch {
        return $Path.Trim().TrimEnd('\').ToLowerInvariant()
    }
}

function Get-FlowCellSmartAxisLockCommandForScriptPath([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { return '' }
    $fileName = [System.IO.Path]::GetFileName([string]$ScriptPath)
    switch ([string]$fileName.ToLowerInvariant()) {
        'util_smart_axis_base.ps1' { return 'baseline' }
        'util_smart_axis_x.ps1' { return 'cycle_x' }
        'util_smart_axis_y.ps1' { return 'cycle_y' }
        'util_smart_axis_z.ps1' { return 'cycle_z' }
        'util_smart_axis_live.ps1' { return 'toggle_live' }
        default { return '' }
    }
}

function Get-FlowCellBlenderConfigPath {
    $localOverridePath = Join-Path $script:FlowCellPrivateRoot 'blender.config.local.json'
    if (Test-Path -LiteralPath $localOverridePath -PathType Leaf) {
        return $localOverridePath
    }
    return (Join-Path $script:FlowCellHomeRoot 'Blender\config.json')
}

function Get-FlowCellBlenderConfig {
    $configPath = Get-FlowCellBlenderConfigPath
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Blender config not found: $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($null -eq $config.automation -or [string]::IsNullOrWhiteSpace([string]$config.automation.bridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }
    if ($null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20
    }
    return $config
}

function Get-FlowCellBlenderAutomationStringValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DefaultValue
    )

    if ($null -eq $Config -or $null -eq $Config.automation) {
        return $DefaultValue
    }

    $property = $Config.automation.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $DefaultValue
    }

    $value = [string]$property.Value
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }

    return $value.Trim()
}

function Get-FlowCellBlenderBridgeLayout {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [string]$BridgeFolder = ''
    )

    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        $BridgeFolder = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''
    }
    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }

    try {
        $BridgeFolder = [System.IO.Path]::GetFullPath($BridgeFolder)
    }
    catch {
        $BridgeFolder = $BridgeFolder.Trim()
    }

    $bridgeFolderName = Split-Path -Path $BridgeFolder -Leaf
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName)) {
        $bridgeFolderName = 'blender_bridge'
    }

    return [pscustomobject]@{
        BridgeFolder = $BridgeFolder
        BridgeFolderName = $bridgeFolderName
    }
}

function Get-FlowCellTargetBlenderProcessId {
    $blenderProcesses = @(Get-Process blender -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if (@($blenderProcesses).Count -eq 0) {
        throw 'Blender is not running. Open Blender with the addon enabled first.'
    }
    if (@($blenderProcesses).Count -eq 1) {
        return [int]$blenderProcesses[0].Id
    }
    return [int](@($blenderProcesses | Sort-Object StartTime -Descending | Select-Object -First 1)[0].Id)
}

function Get-FlowCellBridgeFolderCandidates([object]$Config, [int]$TargetBlenderProcessId) {
    $candidates = New-Object System.Collections.Generic.List[string]
    $configuredBridgeRoot = [string]$Config.automation.bridgeFolder
    $bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $Config -BridgeFolder $configuredBridgeRoot
    $bridgeFolderName = [string]$bridgeLayout.BridgeFolderName

    $addBridgeRootCandidates = {
        param([string]$BridgeRoot)
        if ([string]::IsNullOrWhiteSpace($BridgeRoot)) { return }
        $primaryBridgeFolder = Join-Path $BridgeRoot ([string]$TargetBlenderProcessId)
        if (-not $candidates.Contains($primaryBridgeFolder)) {
            [void]$candidates.Add($primaryBridgeFolder)
        }

        $legacyResponsePath = Join-Path $BridgeRoot 'response.json'
        $legacyRequestPath = Join-Path $BridgeRoot 'request.json'
        if (
            $BridgeRoot -ne $primaryBridgeFolder -and
            (
                (Test-Path -LiteralPath $legacyResponsePath -PathType Leaf) -or
                (Test-Path -LiteralPath $legacyRequestPath -PathType Leaf)
            ) -and
            -not $candidates.Contains($BridgeRoot)
        ) {
            [void]$candidates.Add($BridgeRoot)
        }
    }

    & $addBridgeRootCandidates $configuredBridgeRoot

    if (-not [string]::IsNullOrWhiteSpace($configuredBridgeRoot)) {
        return @($candidates)
    }

    $blenderAppDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $fallbackBridgeRoot = Join-Path $_.FullName ('scripts\addons\{0}' -f $bridgeFolderName)
                if (
                    (Test-Path -LiteralPath $fallbackBridgeRoot -PathType Container) -and
                    ((Get-FlowCellNormalizedPath $fallbackBridgeRoot) -ne (Get-FlowCellNormalizedPath $configuredBridgeRoot))
                ) {
                    & $addBridgeRootCandidates $fallbackBridgeRoot
                }
            }
    }

    return @($candidates)
}

function Wait-FlowCellBridgeResponse([string]$ResponsePath, [string]$RequestId, [datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        if (Test-Path -LiteralPath $ResponsePath -PathType Leaf) {
            try {
                $response = Get-Content -LiteralPath $ResponsePath -Raw | ConvertFrom-Json
                if ([string]$response.id -eq $RequestId) {
                    return $response
                }
            }
            catch {
            }
        }
        Start-Sleep -Milliseconds 5
    }
    return $null
}

function Invoke-FlowCellBlenderBridgeRequest([string]$Action, [hashtable]$Data = @{}, [int]$TimeoutSeconds = 0) {
    $config = Get-FlowCellBlenderConfig
    $targetBlenderProcessId = Get-FlowCellTargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString()
    if ([int]$TimeoutSeconds -gt 0) {
        $timeoutSeconds = [Math]::Max([int]$TimeoutSeconds, 1)
    }
    else {
        $timeoutSeconds = [Math]::Max([int]$config.automation.responseTimeoutSeconds, 1)
    }
    $bridgeFolders = @(Get-FlowCellBridgeFolderCandidates -Config $config -TargetBlenderProcessId $targetBlenderProcessId)

    $payload = [pscustomobject][ordered]@{
        id = $requestId
        action = $Action
        data = $Data
        requested = (Get-Date).ToString('o')
    }

    $json = $payload | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $finalDeadline = (Get-Date).AddSeconds($timeoutSeconds)

    foreach ($bridgeFolder in @($bridgeFolders)) {
        $requestPath = Join-Path $bridgeFolder 'request.json'
        $responsePath = Join-Path $bridgeFolder 'response.json'
        New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
        [System.IO.File]::WriteAllText($requestPath, $json, $utf8NoBom)

        $response = Wait-FlowCellBridgeResponse -ResponsePath $responsePath -RequestId $requestId -Deadline $finalDeadline
        if ($null -eq $response) {
            continue
        }
        if ([string]$response.status -eq 'ok') {
            return $response
        }
        if ($response.PSObject.Properties['message']) {
            throw ([string]$response.message)
        }
        throw 'Blender returned an error.'
    }

    throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $targetBlenderProcessId, ($bridgeFolders -join '; '))
}

function Convert-FlowCellSmartAxisLockResponseToResult($Response) {
    $statusText = if ($Response.PSObject.Properties['message']) { [string]$Response.message } else { 'Smart Axis Lock complete.' }
    if ([string]::IsNullOrWhiteSpace($statusText)) {
        $statusText = 'Smart Axis Lock complete.'
    }
    $modes = @{ X = 'NONE'; Y = 'NONE'; Z = 'NONE' }
    if ($Response.PSObject.Properties['modes'] -and $Response.modes) {
        foreach ($axis in @('X', 'Y', 'Z')) {
            if ($Response.modes.PSObject.Properties[$axis]) {
                $modes[$axis] = [string]$Response.modes.$axis
            }
        }
    }
    return [pscustomobject]@{
        Succeeded = $true
        Message = $statusText
        Modes = $modes
        LiveEnabled = [bool]$(if ($Response.PSObject.Properties['live_enabled']) { $Response.live_enabled } else { $false })
        RunnerActive = [bool]$(if ($Response.PSObject.Properties['runner_active']) { $Response.runner_active } else { $false })
        Selected = [int]$(if ($Response.PSObject.Properties['selected']) { $Response.selected } else { 0 })
        EnabledToolCount = [int]$(if ($Response.PSObject.Properties['enabled_tool_count']) { $Response.enabled_tool_count } else { 0 })
        Registered = [bool]$(if ($Response.PSObject.Properties['registered']) { $Response.registered } else { $false })
    }
}

function New-FlowCellSmartAxisLockFailedResult([string]$Message) {
    $resolvedMessage = [string]$Message
    if ($resolvedMessage -match 'Unsupported action:\s*smart_axis_lock') {
        $resolvedMessage = 'Reload the FlowTest Blender add-on or restart Blender once.'
    }
    return [pscustomobject]@{
        Succeeded = $false
        Message = $resolvedMessage
        Modes = @{ X = 'NONE'; Y = 'NONE'; Z = 'NONE' }
        LiveEnabled = $false
        RunnerActive = $false
        Selected = 0
        EnabledToolCount = 0
        Registered = $false
    }
}

function Get-FlowCellAutoHotkeyExePath {
    $candidates = @(
        (Join-Path $script:ProjectRoot 'runtime\AutoHotkey64.exe'),
        (Join-Path $script:ProjectRoot 'runtime\AutoHotkey.exe'),
        (Join-Path $script:ProjectRoot 'local\bin\AutoHotkey64.exe'),
        (Join-Path $script:ProjectRoot 'local\bin\AutoHotkey.exe'),
        'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe',
        'C:\Program Files\AutoHotkey\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\AutoHotkey.exe'
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    throw 'AutoHotkey v2 runtime was not found for FlowCell backend execution.'
}

function Invoke-FlowCellControllerCli([string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $script:AhkScriptPath -PathType Leaf)) {
        throw "FlowCell backend adapter not found: $script:AhkScriptPath"
    }
    $ahkExe = Get-FlowCellAutoHotkeyExePath
    $argumentList = @('/ErrorStdOut', $script:AhkScriptPath) + @($Arguments)
    $process = Start-Process -FilePath $ahkExe -ArgumentList $argumentList -PassThru -Wait -WindowStyle Hidden
    return [int]$process.ExitCode
}

function New-BackendResult {
    param(
        [bool]$Succeeded,
        [string]$Message,
        [string]$ResolvedTarget = '',
        [string]$ExecutionMethod = '',
        [string]$ClientAction = '',
        [object]$SmartAxisResult = $null,
        [object]$ToolOptionState = $null
    )
    return [pscustomobject]@{
        Succeeded = [bool]$Succeeded
        Message = [string]$Message
        ResolvedTarget = [string]$ResolvedTarget
        ExecutionMethod = [string]$ExecutionMethod
        ClientAction = [string]$ClientAction
        SmartAxisResult = $SmartAxisResult
        ToolOptionState = $ToolOptionState
    }
}

function Get-FlowCellObjectValue($Source, [string]$Name, $Default = $null) {
    if ($null -eq $Source -or [string]::IsNullOrWhiteSpace($Name)) {
        return $Default
    }

    if ($Source -is [System.Collections.IDictionary]) {
        foreach ($key in $Source.Keys) {
            if ([string]$key -ieq $Name) {
                return $Source[$key]
            }
        }
    }

    if ($Source.PSObject.Properties[$Name]) {
        return $Source.$Name
    }

    return $Default
}

function ConvertTo-FlowCellSmartAxisToolOptionState($StateSource) {
    $modeSource = Get-FlowCellObjectValue -Source $StateSource -Name 'Modes'
    $statusMessage = [string](Get-FlowCellObjectValue -Source $StateSource -Name 'Message' -Default '')
    if ([string]::IsNullOrWhiteSpace($statusMessage)) {
        $statusMessage = [string](Get-FlowCellObjectValue -Source $StateSource -Name 'LastMessage' -Default 'Smart Axis Lock ready.')
    }

    return [pscustomobject]@{
        Modes = [pscustomobject]@{
            X = [string](Get-FlowCellObjectValue -Source $modeSource -Name 'X' -Default 'NONE')
            Y = [string](Get-FlowCellObjectValue -Source $modeSource -Name 'Y' -Default 'NONE')
            Z = [string](Get-FlowCellObjectValue -Source $modeSource -Name 'Z' -Default 'NONE')
        }
        LiveEnabled = [bool](Get-FlowCellObjectValue -Source $StateSource -Name 'LiveEnabled' -Default $false)
        RunnerActive = [bool](Get-FlowCellObjectValue -Source $StateSource -Name 'RunnerActive' -Default $false)
        Selected = [int](Get-FlowCellObjectValue -Source $StateSource -Name 'Selected' -Default 0)
        EnabledToolCount = [int](Get-FlowCellObjectValue -Source $StateSource -Name 'EnabledToolCount' -Default 0)
        Registered = [bool](Get-FlowCellObjectValue -Source $StateSource -Name 'Registered' -Default $false)
        LastMessage = $statusMessage
    }
}

function Write-FlowCellResultJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $rendered = $Value | ConvertTo-Json -Depth 10
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $rendered, $encoding)
}

function Invoke-FlowCellToolCommand($Envelope) {
    $payload = $Envelope.payload
    $toolId = [string]$payload.tool
    $toolCommand = [string]$payload.command
    Write-CommandHostLog ('Resolved execution target. CommandId={0}; Tool={1}; ToolCommand={2}; Target={3}' -f [string]$Envelope.command_id, $toolId, $toolCommand, [string]$payload.resolved_target)

    switch ([string]$toolId) {
        'alignment' {
            $actionType = [string]$payload.action_type
            switch ([string]$actionType) {
                'toggle_modifier' {
                    $statusText = if ($payload.PSObject.Properties['status_message']) { [string]$payload.status_message } else { '' }
                    if ([string]::IsNullOrWhiteSpace($statusText)) {
                        $statusText = 'Alignment modifier updated.'
                    }
                    Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
                    Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=state_only; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
                    return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'state_only')
                }
                'align_axis' {
                    $response = Invoke-FlowCellBlenderBridgeRequest -Action 'alignment_tools' -Data @{
                        command = 'align_axis'
                        axis = [string]$payload.axis
                        mode = [string]$payload.mode
                        modifier = [string]$(if ($payload.PSObject.Properties['modifier']) { $payload.modifier } else { '' })
                    }
                    $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Alignment complete.' }
                    Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
                    Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
                    return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge')
                }
                'center_all' {
                    $response = Invoke-FlowCellBlenderBridgeRequest -Action 'alignment_tools' -Data @{ command = 'center_all' }
                    $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Alignment complete.' }
                    Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
                    Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
                    return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge')
                }
            }
            throw ("Unsupported alignment action type: {0}" -f $actionType)
        }
        'flatten_revolve' {
            $data = @{
                command = [string]$toolCommand
                center_mode = [string]$payload.center_mode
                angle_deg = [double]$payload.angle_deg
                revolve_steps = [int]$payload.revolve_steps
                merge_distance = [double]$payload.merge_distance
            }
            if ($payload.PSObject.Properties['flatten_axis']) {
                $data.flatten_axis = [string]$payload.flatten_axis
            }
            if ($payload.PSObject.Properties['revolve_axis']) {
                $data.revolve_axis = [string]$payload.revolve_axis
            }

            try {
                $response = Invoke-FlowCellBlenderBridgeRequest -Action 'flatten_revolve_tools' -Data $data
            }
            catch {
                if ($_.Exception.Message -notmatch 'Unsupported action:\s*flatten_revolve_tools') {
                    throw
                }
                $data.tool = 'flatten_revolve'
                $data.tool_command = [string]$toolCommand
                $response = Invoke-FlowCellBlenderBridgeRequest -Action 'alignment_tools' -Data $data
            }
            $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Flatten/revolve complete.' }
            Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
            Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
            return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge')
        }
        'quick_rotate_group' {
            $response = Invoke-FlowCellBlenderBridgeRequest -Action 'flowtest_custom_quick_rotate_group' -Data @{
                command = [string]$toolCommand
                axis = [string]$payload.axis
                center_mode = [string]$payload.center_mode
                operation_mode = [string]$payload.operation_mode
                angle_deg = [double]$payload.angle_deg
            }
            $statusText = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Quick rotate complete.' }
            Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
            Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
            return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge')
        }
        'smart_axis_lock' {
            try {
                $response = Invoke-FlowCellBlenderBridgeRequest -Action 'smart_axis_lock' -Data @{
                    command = [string]$toolCommand
                }
                $result = Convert-FlowCellSmartAxisLockResponseToResult -Response $response
                $toolOptionState = ConvertTo-FlowCellSmartAxisToolOptionState -StateSource $result
                Write-SharedTextFile -Path $script:LastActionStatusPath -Text ([string]$result.Message)
                Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, [string]$result.Message)
                return (New-BackendResult -Succeeded $true -Message ([string]$result.Message) -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge' -SmartAxisResult $result -ToolOptionState $toolOptionState)
            }
            catch {
                $result = New-FlowCellSmartAxisLockFailedResult -Message $_.Exception.Message
                $toolOptionState = ConvertTo-FlowCellSmartAxisToolOptionState -StateSource $result
                Write-SharedTextFile -Path $script:LastActionStatusPath -Text ([string]$result.Message)
                Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=error; Message={1}' -f [string]$Envelope.command_id, [string]$result.Message)
                return (New-BackendResult -Succeeded $false -Message ([string]$result.Message) -ResolvedTarget ([string]$payload.resolved_target) -ExecutionMethod 'blender_bridge' -SmartAxisResult $result -ToolOptionState $toolOptionState)
            }
        }
        default {
            throw ("Unsupported tool action: {0}" -f $toolId)
        }
    }
}

function Invoke-FlowCellScriptCommand($Envelope) {
    $payload = $Envelope.payload
    $resolvedTarget = [string]$payload.resolved_target
    if ([string]::IsNullOrWhiteSpace($resolvedTarget) -or -not (Test-Path -LiteralPath $resolvedTarget -PathType Leaf)) {
        throw ("Script target was not found: {0}" -f $resolvedTarget)
    }

    $smartAxisCommand = Get-FlowCellSmartAxisLockCommandForScriptPath -ScriptPath $resolvedTarget
    if (-not [string]::IsNullOrWhiteSpace($smartAxisCommand)) {
        Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=blender_bridge; Target={1}; SmartAxisCommand={2}' -f [string]$Envelope.command_id, $resolvedTarget, $smartAxisCommand)
        try {
            $response = Invoke-FlowCellBlenderBridgeRequest -Action 'smart_axis_lock' -Data @{ command = [string]$smartAxisCommand }
            $result = Convert-FlowCellSmartAxisLockResponseToResult -Response $response
            Write-SharedTextFile -Path $script:LastActionStatusPath -Text ([string]$result.Message)
            Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, [string]$result.Message)
            return (New-BackendResult -Succeeded $true -Message ([string]$result.Message) -ResolvedTarget $resolvedTarget -ExecutionMethod 'blender_bridge' -SmartAxisResult $result)
        }
        catch {
            $result = New-FlowCellSmartAxisLockFailedResult -Message $_.Exception.Message
            Write-SharedTextFile -Path $script:LastActionStatusPath -Text ([string]$result.Message)
            Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=error; Message={1}' -f [string]$Envelope.command_id, [string]$result.Message)
            return (New-BackendResult -Succeeded $false -Message ([string]$result.Message) -ResolvedTarget $resolvedTarget -ExecutionMethod 'blender_bridge' -SmartAxisResult $result)
        }
    }

    $programLabel = if ($Envelope.program.PSObject.Properties['label']) { [string]$Envelope.program.label } else { '' }
    $programKey = Get-ProgramLabelKey $programLabel
    Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=controller_cli; Target={1}; Program={2}' -f [string]$Envelope.command_id, $resolvedTarget, $programKey)
    $exitCode = Invoke-FlowCellControllerCli -Arguments @(
        ('--run-script-path={0}' -f $resolvedTarget),
        ('--run-script-program={0}' -f $programKey),
        ('--run-script-program-tab-id={0}' -f [int]$Envelope.program_id)
    )
    $statusText = Read-AllTextSafe -Path $script:LastActionStatusPath -Default ('Script run {0}.' -f $(if ($exitCode -eq 0) { 'completed' } else { 'failed' }))
    Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=controller_cli; ExitCode={1}; Message={2}' -f [string]$Envelope.command_id, $exitCode, $statusText)
    return (New-BackendResult -Succeeded ($exitCode -eq 0) -Message $statusText -ResolvedTarget $resolvedTarget -ExecutionMethod 'controller_cli')
}

function Invoke-FlowCellMacroCommand($Envelope) {
    $payload = $Envelope.payload
    $actionId = [string]$payload.target
    if ([string]::IsNullOrWhiteSpace($actionId)) {
        throw 'Macro action id was missing.'
    }
    Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=controller_cli; ActionId={1}' -f [string]$Envelope.command_id, $actionId)
    $exitCode = Invoke-FlowCellControllerCli -Arguments @(
        ('--run-action={0}' -f $actionId)
    )
    $statusText = Read-AllTextSafe -Path $script:LastActionStatusPath -Default ('Macro {0}.' -f $(if ($exitCode -eq 0) { 'completed' } else { 'failed' }))
    Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=controller_cli; ExitCode={1}; Message={2}' -f [string]$Envelope.command_id, $exitCode, $statusText)
    return (New-BackendResult -Succeeded ($exitCode -eq 0) -Message $statusText -ResolvedTarget $actionId -ExecutionMethod 'controller_cli')
}

function Invoke-FlowCellBuiltinCommand($Envelope) {
    $payload = $Envelope.payload
    $target = [string]$payload.target
    if ([string]$target -eq 'flowcell_toggle_popouts_minimized') {
        $statusText = 'Pop-out window minimize toggle requested.'
        Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
        Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=frontend_callback; ClientAction={1}; Message={2}' -f [string]$Envelope.command_id, $target, $statusText)
        return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget $target -ExecutionMethod 'frontend_callback' -ClientAction $target)
    }
    throw ("Unknown builtin action: {0}" -f $target)
}

try {
    Ensure-CommandHostDirectory -Path $script:LogsDir
    $envelope = Get-Content -LiteralPath $EnvelopePath -Raw | ConvertFrom-Json
    $requestId = [string]$(if ($envelope.PSObject.Properties['request_id']) { $envelope.request_id } else { '' })
    $sourceButtonId = [string]$(if ($envelope.PSObject.Properties['owner_button_id'] -and -not [string]::IsNullOrWhiteSpace([string]$envelope.owner_button_id)) { $envelope.owner_button_id } elseif ($envelope.PSObject.Properties['button_id']) { $envelope.button_id } else { '' })
    $childSlotId = [string]$(if ($envelope.PSObject.Properties['child_slot_id']) { $envelope.child_slot_id } else { '' })
    Write-CommandHostLog ('Backend command received. RequestId={0}; CommandId={1}; SourceButtonId={2}; ProgramId={3}; PanelId={4}; Surface={5}; ChildSlotId={6}' -f `
        $requestId, `
        [string]$envelope.command_id, `
        $sourceButtonId, `
        [int]$(if ($envelope.PSObject.Properties['program_id']) { $envelope.program_id } else { 0 }), `
        [string]$(if ($envelope.PSObject.Properties['panel_id']) { $envelope.panel_id } else { '' }), `
        [string]$(if ($envelope.PSObject.Properties['source_surface']) { $envelope.source_surface } else { '' }), `
        $childSlotId)

    if ($null -eq $envelope -or -not $envelope.PSObject.Properties['command_id'] -or [string]::IsNullOrWhiteSpace([string]$envelope.command_id)) {
        throw 'Command envelope is missing command_id.'
    }
    if (-not $envelope.PSObject.Properties['payload'] -or $null -eq $envelope.payload) {
        throw 'Command envelope is missing payload.'
    }
    Write-CommandHostLog ('State/payload validation passed. CommandId={0}; Kind={1}; Tool={2}' -f [string]$envelope.command_id, [string]$(if ($envelope.payload.PSObject.Properties['kind']) { $envelope.payload.kind } else { '' }), [string]$(if ($envelope.payload.PSObject.Properties['tool']) { $envelope.payload.tool } else { '' }))

    $result = switch ([string]$envelope.command_id) {
        'flowcell.run_script' { Invoke-FlowCellScriptCommand -Envelope $envelope; break }
        'flowcell.run_macro' { Invoke-FlowCellMacroCommand -Envelope $envelope; break }
        'flowcell.run_tool_action' { Invoke-FlowCellToolCommand -Envelope $envelope; break }
        'flowcell.run_builtin' { Invoke-FlowCellBuiltinCommand -Envelope $envelope; break }
        default { throw ("Unsupported command id: {0}" -f [string]$envelope.command_id) }
    }

    Write-FlowCellResultJsonFile -Path $ResultPath -Value $result
    Write-CommandHostLog ('Final user-visible status. CommandId={0}; Succeeded={1}; Status={2}' -f [string]$envelope.command_id, [bool]$result.Succeeded, [string]$result.Message)
    exit $(if ($result.Succeeded) { 0 } else { 1 })
}
catch {
    $message = [string]$_.Exception.Message
    Write-CommandHostLog ('State/payload validation failed. Error={0}' -f $message)
    Write-SharedTextFile -Path $script:LastActionStatusPath -Text $message
    $errorResult = New-BackendResult -Succeeded $false -Message $message
    Write-FlowCellResultJsonFile -Path $ResultPath -Value $errorResult
    Write-CommandHostLog ('Final user-visible status. Succeeded=False; Status={0}' -f $message)
    exit 1
}
