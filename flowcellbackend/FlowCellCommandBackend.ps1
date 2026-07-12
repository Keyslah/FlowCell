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

function Get-FlowCellJsonStringProperty($Source, [string]$Name) {
    if ($null -eq $Source -or [string]::IsNullOrWhiteSpace($Name)) {
        return ''
    }

    $property = $Source.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ''
    }

    return [string]$property.Value
}

function Resolve-FlowCellBlenderBridgeActionForScriptPath([string]$ScriptPath) {
    $normalizedScriptPath = Get-FlowCellNormalizedPath $ScriptPath
    if ([string]::IsNullOrWhiteSpace($normalizedScriptPath)) {
        return ''
    }

    $panelsRoot = Join-Path $script:FlowCellHomeRoot 'Programs\Blender\Panels'
    if (-not (Test-Path -LiteralPath $panelsRoot -PathType Container)) {
        return ''
    }

    $resolvedAction = ''
    foreach ($recordPath in @(Get-ChildItem -LiteralPath $panelsRoot -Recurse -Filter '*.flowcell-source.json' -File -ErrorAction SilentlyContinue)) {
        try {
            $record = Get-Content -LiteralPath $recordPath.FullName -Raw | ConvertFrom-Json
            $schemaVersion = $record.PSObject.Properties['schemaVersion']
            if ($null -eq $schemaVersion -or [int]$schemaVersion.Value -ne 1) {
                continue
            }
        }
        catch {
            continue
        }

        $sourcePath = Get-FlowCellJsonStringProperty -Source $record -Name 'sourcePath'
        $bridgeAction = Get-FlowCellJsonStringProperty -Source $record -Name 'bridgeAction'
        if (
            [string]::IsNullOrWhiteSpace($sourcePath) -or
            [string]::IsNullOrWhiteSpace($bridgeAction) -or
            (Get-FlowCellNormalizedPath $sourcePath) -ne $normalizedScriptPath
        ) {
            continue
        }

        $bridgeAction = $bridgeAction.Trim()
        if (-not [string]::IsNullOrWhiteSpace($resolvedAction) -and $resolvedAction -ine $bridgeAction) {
            throw ("Active Blender source records disagree about the bridge action for {0}." -f $ScriptPath)
        }
        $resolvedAction = $bridgeAction
    }

    return $resolvedAction
}

function Get-FlowCellBlenderConfigPath {
    $localOverridePath = Join-Path $script:FlowCellPrivateRoot 'blender.config.local.json'
    if (Test-Path -LiteralPath $localOverridePath -PathType Leaf) {
        return $localOverridePath
    }
    $repoProgramsConfigPath = Join-Path $script:FlowCellHomeRoot 'Programs\Blender\config.json'
    if (Test-Path -LiteralPath $repoProgramsConfigPath -PathType Leaf) {
        return $repoProgramsConfigPath
    }
    return (Join-Path $script:FlowCellHomeRoot 'Blender\config.json')
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

function Get-FlowCellBlenderVersionSortRecord([System.IO.DirectoryInfo]$Directory, [string[]]$ActiveVersionNames) {
    $parts = @([regex]::Matches([string]$Directory.Name, '\d+') | ForEach-Object { [int]$_.Value })
    $major = if ($parts.Count -gt 0) { $parts[0] } else { -1 }
    $minor = if ($parts.Count -gt 1) { $parts[1] } else { -1 }
    $patch = if ($parts.Count -gt 2) { $parts[2] } else { -1 }
    $revision = if ($parts.Count -gt 3) { $parts[3] } else { -1 }
    $isActive = $false
    foreach ($activeVersionName in @($ActiveVersionNames)) {
        if (
            [string]$Directory.Name -ieq [string]$activeVersionName -or
            [string]$Directory.Name -like (([string]$activeVersionName) + '.*')
        ) {
            $isActive = $true
            break
        }
    }

    return [pscustomobject]@{
        Directory = $Directory
        IsActive = $isActive
        Major = $major
        Minor = $minor
        Patch = $patch
        Revision = $revision
    }
}

function Get-FlowCellRunningBlenderVersionNames {
    $versions = New-Object System.Collections.Generic.List[string]
    foreach ($process in @(Get-Process blender -ErrorAction SilentlyContinue)) {
        foreach ($value in @(
            [string]$(try { $process.MainModule.FileVersionInfo.ProductVersion } catch { '' }),
            [string]$(try { $process.MainModule.FileVersionInfo.FileVersion } catch { '' }),
            [string]$(try { Split-Path -Leaf (Split-Path -Parent $process.MainModule.FileName) } catch { '' })
        )) {
            if ($value -match '(?<!\d)(\d+\.\d+)(?!\d)') {
                $version = [string]$Matches[1]
                if (-not $versions.Contains($version)) {
                    [void]$versions.Add($version)
                }
            }
        }
    }
    return @($versions)
}

function Test-FlowCellBlenderBridgeFolder([object]$Config, [string]$BridgeFolder) {
    if ([string]::IsNullOrWhiteSpace($BridgeFolder) -or -not (Test-Path -LiteralPath $BridgeFolder -PathType Container)) {
        return $false
    }

    $addonRoot = Split-Path -Parent $BridgeFolder

    return (
        (Test-Path -LiteralPath (Join-Path $BridgeFolder 'flowcell_custom_actions.json') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $BridgeFolder 'ManagedActions') -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_actions.py') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_bridge.py') -PathType Leaf)
    )
}

function Resolve-FlowCellBlenderBridgeFolder([object]$Config, [string]$ConfigPath) {
    $checkedPaths = New-Object System.Collections.Generic.List[string]
    $configuredBridgeFolder = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''

    if (-not [string]::IsNullOrWhiteSpace($configuredBridgeFolder)) {
        try { $configuredBridgeFolder = [System.IO.Path]::GetFullPath($configuredBridgeFolder) } catch { $configuredBridgeFolder = $configuredBridgeFolder.Trim() }
        [void]$checkedPaths.Add($configuredBridgeFolder)
        if (Test-FlowCellBlenderBridgeFolder -Config $Config -BridgeFolder $configuredBridgeFolder) {
            return [pscustomobject]@{
                BridgeFolder = $configuredBridgeFolder
                Source = 'config'
                CheckedPaths = @($checkedPaths)
                VersionFolders = @()
            }
        }
    }

    $applicationDataRoot = [string]$env:APPDATA
    if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
    }
    $blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'
    $versionDirectories = if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue)
    }
    else {
        @()
    }
    $activeVersionNames = @(Get-FlowCellRunningBlenderVersionNames)
    $sortedVersionRecords = @(
        $versionDirectories |
            ForEach-Object { Get-FlowCellBlenderVersionSortRecord -Directory $_ -ActiveVersionNames $activeVersionNames } |
            Sort-Object @{ Expression = { $_.IsActive }; Descending = $true },
                @{ Expression = { $_.Major }; Descending = $true },
                @{ Expression = { $_.Minor }; Descending = $true },
                @{ Expression = { $_.Patch }; Descending = $true },
                @{ Expression = { $_.Revision }; Descending = $true },
                @{ Expression = { $_.Directory.Name }; Descending = $true }
    )

    foreach ($versionRecord in $sortedVersionRecords) {
        $candidate = Join-Path $versionRecord.Directory.FullName 'scripts\addons\blender_bridge_flowcell'
        if (-not $checkedPaths.Contains($candidate)) {
            [void]$checkedPaths.Add($candidate)
        }
        if (Test-FlowCellBlenderBridgeFolder -Config $Config -BridgeFolder $candidate) {
            return [pscustomobject]@{
                BridgeFolder = $candidate
                Source = 'runtime auto-resolve'
                CheckedPaths = @($checkedPaths)
                VersionFolders = @($sortedVersionRecords | ForEach-Object { $_.Directory.FullName })
            }
        }
    }

    $checkedSummary = if ($checkedPaths.Count -gt 0) { $checkedPaths -join '; ' } else { '(none; Blender AppData root was not found)' }
    $message = "Blender bridge folder could not be resolved. Config path: $ConfigPath. Checked path(s): $checkedSummary"
    Write-CommandHostLog $message
    throw $message
}

function Get-FlowCellBlenderConfig {
    $configPath = Get-FlowCellBlenderConfigPath
    Write-CommandHostLog ('Blender config read. Path={0}' -f $configPath)
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "Blender config not found: $configPath"
    }

    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $config.PSObject.Properties['automation'] -or $null -eq $config.automation) {
        $config | Add-Member -MemberType NoteProperty -Name automation -Value ([pscustomobject]@{}) -Force
    }
    if (-not $config.automation.PSObject.Properties['responseTimeoutSeconds'] -or $null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20 -Force
    }

    $resolution = Resolve-FlowCellBlenderBridgeFolder -Config $config -ConfigPath $configPath
    $config.automation | Add-Member -MemberType NoteProperty -Name bridgeFolder -Value ([string]$resolution.BridgeFolder) -Force
    $config | Add-Member -MemberType NoteProperty -Name FlowCellConfigPath -Value $configPath -Force
    $config | Add-Member -MemberType NoteProperty -Name FlowCellBridgeFolderSource -Value ([string]$resolution.Source) -Force
    $config | Add-Member -MemberType NoteProperty -Name FlowCellBridgePathsChecked -Value @($resolution.CheckedPaths) -Force
    Write-CommandHostLog ('Blender bridge folder source. Source={0}' -f [string]$resolution.Source)
    Write-CommandHostLog ('Blender bridge folder final path. Path={0}' -f [string]$resolution.BridgeFolder)
    return $config
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
        throw 'Blender bridge folder was not resolved.'
    }

    try {
        $BridgeFolder = [System.IO.Path]::GetFullPath($BridgeFolder)
    }
    catch {
        $BridgeFolder = $BridgeFolder.Trim()
    }

    $bridgeFolderName = Split-Path -Path $BridgeFolder -Leaf
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName)) {
        $bridgeFolderName = 'blender_bridge_flowcell'
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

function Invoke-FlowCellBlenderBridgeRequest([string]$Action, [hashtable]$Data = @{}, [int]$TimeoutSeconds = 0, [switch]$NoWait) {
    $config = Get-FlowCellBlenderConfig
    $targetBlenderProcessId = Get-FlowCellTargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString('N')
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
        Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue
        $temporaryRequestPath = '{0}.{1}.tmp' -f $requestPath, $requestId
        [System.IO.File]::WriteAllText($temporaryRequestPath, $json, $utf8NoBom)
        Move-Item -LiteralPath $temporaryRequestPath -Destination $requestPath -Force
        Write-CommandHostLog ('Blender bridge request written. RequestId={0}; Action={1}; Path={2}; WaitForResponse={3}' -f $requestId, $Action, $requestPath, (-not [bool]$NoWait))

        if ($NoWait) {
            return [pscustomobject]@{
                id = $requestId
                status = 'queued'
                message = 'Blender action queued.'
                bridge_folder = $bridgeFolder
            }
        }

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
    $quotedArguments = @(
        $argumentList | ForEach-Object {
            $value = [string]$_
            if ([string]::IsNullOrEmpty($value)) {
                '""'
            }
            elseif ($value -notmatch '[\s"]') {
                $value
            }
            else {
                '"' + (($value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
            }
        }
    ) -join ' '
    $process = Start-Process -FilePath $ahkExe -ArgumentList $quotedArguments -PassThru -Wait -WindowStyle Hidden
    return [int]$process.ExitCode
}

function New-BackendResult {
    param(
        [bool]$Succeeded,
        [string]$Message,
        [string]$ResolvedTarget = '',
        [string]$ExecutionMethod = '',
        [object]$Details = $null
    )
    return [pscustomobject]@{
        Succeeded = [bool]$Succeeded
        Message = [string]$Message
        ResolvedTarget = [string]$ResolvedTarget
        ExecutionMethod = [string]$ExecutionMethod
        Details = $Details
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

function Invoke-FlowCellScriptCommand($Envelope) {
    $payload = $Envelope.payload
    $resolvedTarget = [string]$payload.resolved_target
    if ([string]::IsNullOrWhiteSpace($resolvedTarget) -or -not (Test-Path -LiteralPath $resolvedTarget -PathType Leaf)) {
        throw ("Script target was not found: {0}" -f $resolvedTarget)
    }

    $programLabel = if ($Envelope.program.PSObject.Properties['label']) { [string]$Envelope.program.label } else { '' }
    $programKey = Get-ProgramLabelKey $programLabel

    if ($programKey -eq 'blender') {
        $bridgeAction = Resolve-FlowCellBlenderBridgeActionForScriptPath -ScriptPath $resolvedTarget
        if ([string]::IsNullOrWhiteSpace($bridgeAction)) {
            throw ("Blender script target is missing bridge metadata and will not be opened through Windows defaults: {0}" -f $resolvedTarget)
        }

        Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=blender_bridge_fire_and_forget; Target={1}; Action={2}' -f [string]$Envelope.command_id, $resolvedTarget, $bridgeAction)
        $queuedRequest = Invoke-FlowCellBlenderBridgeRequest -Action $bridgeAction -Data @{} -NoWait
        $statusText = 'Blender action queued.'
        Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
        Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge_fire_and_forget; Status=queued; RequestId={1}; Message={2}' -f [string]$Envelope.command_id, [string]$queuedRequest.id, $statusText)
        return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget $resolvedTarget -ExecutionMethod 'blender_bridge_fire_and_forget' -Details $queuedRequest)
    }

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
    Write-CommandHostLog ('State/payload validation passed. CommandId={0}; Kind={1}' -f [string]$envelope.command_id, [string]$(if ($envelope.payload.PSObject.Properties['kind']) { $envelope.payload.kind } else { '' }))

    $result = switch ([string]$envelope.command_id) {
        'flowcell.run_script' { Invoke-FlowCellScriptCommand -Envelope $envelope; break }
        'windows.chrome_workspace.save' { Invoke-FlowCellScriptCommand -Envelope $envelope; break }
        'windows.chrome_workspace.open' { Invoke-FlowCellScriptCommand -Envelope $envelope; break }
        'flowcell.run_macro' { Invoke-FlowCellMacroCommand -Envelope $envelope; break }
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
