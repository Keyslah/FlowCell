param(
    [Parameter(Mandatory = $true)]
    [string]$Action,
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [string]$Direction = '',
    [string]$DataJson = '',
    [switch]$PassThruResponse,
    [switch]$SuppressToast,
    [string]$ConfigPath = '',
    [string]$StatusPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$localConfigPath = Join-Path $flowCellLocalRoot 'private\blender.config.local.json'
$repoProgramsConfigPath = Join-Path $repoRoot 'Programs\Blender\config.json'
$legacyConfigPath = Join-Path $repoRoot 'Blender\config.json'
$bridgeLayoutPath = Join-Path $PSScriptRoot 'FlowCellBlenderBridgeLayout.ps1'
if (-not (Test-Path -LiteralPath $bridgeLayoutPath -PathType Leaf)) {
    throw "Blender bridge layout helper not found: $bridgeLayoutPath"
}
. $bridgeLayoutPath
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) {
        $localConfigPath
    }
    elseif (Test-Path -LiteralPath $repoProgramsConfigPath -PathType Leaf) {
        $repoProgramsConfigPath
    }
    else {
        $legacyConfigPath
    }
}
if ([string]::IsNullOrWhiteSpace($StatusPath)) {
    $StatusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'
}

Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FlowCellForegroundWindow {
    public const uint GW_HWNDNEXT = 2;

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
}
"@

function Write-Status([string]$Message) {
    if ([string]::IsNullOrWhiteSpace($StatusPath)) { return }
    try {
        $folder = Split-Path -Parent $StatusPath
        if (-not [string]::IsNullOrWhiteSpace($folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Set-Content -LiteralPath $StatusPath -Value $Message -Encoding UTF8
    }
    catch {
    }
}

function Show-ActionToast([string]$Title, [string]$Message, [string]$Kind = 'Information') {
    try {
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $width = 420
        $height = 104
        $margin = 18

        $backgroundColor = switch ($Kind) {
            'Error' { [System.Drawing.Color]::FromArgb(188, 42, 54) }
            default { [System.Drawing.Color]::FromArgb(37, 117, 70) }
        }

        $form = New-Object System.Windows.Forms.Form
        $form.Text = $Title
        $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
        $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
        $form.ShowInTaskbar = $false
        $form.TopMost = $true
        $form.BackColor = $backgroundColor
        $form.ForeColor = [System.Drawing.Color]::White
        $form.Size = New-Object System.Drawing.Size($width, $height)
        $centeredLeft = [int]($screen.Left + (($screen.Width - $width) / 2))
        $form.Location = New-Object System.Drawing.Point($centeredLeft, ($screen.Bottom - $height - $margin))
        $form.Padding = New-Object System.Windows.Forms.Padding(16, 12, 16, 12)
        $form.Opacity = 0.97

        $titleLabel = New-Object System.Windows.Forms.Label
        $titleLabel.AutoSize = $false
        $titleLabel.Text = $Title
        $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 12, [System.Drawing.FontStyle]::Bold)
        $titleLabel.ForeColor = [System.Drawing.Color]::White
        $titleLabel.Location = New-Object System.Drawing.Point(16, 12)
        $titleLabel.Size = New-Object System.Drawing.Size(($width - 32), 24)

        $messageLabel = New-Object System.Windows.Forms.Label
        $messageLabel.AutoSize = $false
        $messageLabel.Text = $Message
        $messageLabel.Font = New-Object System.Drawing.Font('Segoe UI', 10)
        $messageLabel.ForeColor = [System.Drawing.Color]::White
        $messageLabel.Location = New-Object System.Drawing.Point(16, 40)
        $messageLabel.Size = New-Object System.Drawing.Size(($width - 32), 48)

        $form.Controls.Add($titleLabel)
        $form.Controls.Add($messageLabel)

        $fadeTimer = New-Object System.Windows.Forms.Timer
        $fadeTimer.Interval = 65
        $fadeTimer.Add_Tick({
            $form.Opacity = [Math]::Max(0.0, ($form.Opacity - 0.12))
            if ($form.Opacity -le 0.01) {
                $fadeTimer.Stop()
                $form.Close()
            }
        })

        $displayTimer = New-Object System.Windows.Forms.Timer
        $displayTimer.Interval = 2600
        $displayTimer.Add_Tick({
            $displayTimer.Stop()
            $fadeTimer.Start()
        })

        $form.Add_Shown({
            $displayTimer.Start()
        })

        [void]$form.ShowDialog()
    }
    catch {
    }
}

function Test-ActionToastEnabled([string]$Action) {
    return @(
        'save_selected_stl_to_assets',
        'render_active_object_png_to_images'
    ) -contains ([string]$Action)
}

function Get-ActionToastTitle([string]$Action, [bool]$Failed = $false) {
    switch ([string]$Action) {
        'save_selected_stl_to_assets' {
            if ($Failed) { return 'Save STL Failed' }
            return 'Save STL'
        }
        'render_active_object_png_to_images' {
            if ($Failed) { return 'Save PNG Failed' }
            return 'Save PNG'
        }
        default {
            if ($Failed) { return 'Blender Action Failed' }
            return 'Blender Action'
        }
    }
}

function Get-FlowCellConfiguredBridgeFolderLeafName([object]$Config) {
    $configuredBridgeRoot = if ($Config -and $Config.automation) { [string]$Config.automation.bridgeFolder } else { '' }
    $bridgeFolderLeafName = if ([string]::IsNullOrWhiteSpace($configuredBridgeRoot)) { '' } else { Split-Path -Path $configuredBridgeRoot -Leaf }
    if (-not [string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
        return $bridgeFolderLeafName
    }

    $signals = @(
        if ($Config -and $Config.automation) { [string]$Config.automation.customActionsFileName } else { '' }
        if ($Config -and $Config.automation) { [string]$Config.automation.addonActionsFileName } else { '' }
        if ($Config -and $Config.automation) { [string]$Config.automation.addonBridgeFileName } else { '' }
        if ($Config -and $Config.automation) { [string]$Config.automation.addonDisplayName } else { '' }
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }

    foreach ($signal in @($signals)) {
        if ([string]$signal -match 'flowcell') {
            return 'blender_bridge_flowcell'
        }
    }

    return 'blender_bridge'
}

function Resolve-FlowCellConfiguredBridgeFolder([object]$Config) {
    $configuredBridgeRoot = if ($Config -and $Config.automation) { [string]$Config.automation.bridgeFolder } else { '' }
    if (-not [string]::IsNullOrWhiteSpace($configuredBridgeRoot)) {
        try {
            return [System.IO.Path]::GetFullPath($configuredBridgeRoot)
        }
        catch {
            return $configuredBridgeRoot.Trim()
        }
    }

    $bridgeFolderLeafName = Get-FlowCellConfiguredBridgeFolderLeafName -Config $Config
    $applicationDataRoot = [string]$env:APPDATA
    if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
    }
    $blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'
    if (-not (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container)) {
        return ''
    }

    $versionDirectories = @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    foreach ($versionDirectory in $versionDirectories) {
        if (-not [string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
            $candidate = Join-Path $versionDirectory.FullName ('scripts\addons\{0}' -f [string]$bridgeFolderLeafName)
            if (Test-Path -LiteralPath $candidate -PathType Container) {
                return $candidate
            }
        }
    }

    if ($versionDirectories.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
        return (Join-Path $versionDirectories[0].FullName ('scripts\addons\{0}' -f $bridgeFolderLeafName))
    }

    return ''
}

function Read-ConfigFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Blender config not found: $Path"
    }

    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if (-not $config.PSObject.Properties['automation'] -or $null -eq $config.automation) {
        $config | Add-Member -MemberType NoteProperty -Name automation -Value ([pscustomobject]@{}) -Force
    }

    $resolvedBridgeFolder = Resolve-FlowCellBlenderBridgeFolder -Config $config
    if ([string]::IsNullOrWhiteSpace($resolvedBridgeFolder)) {
        $diagnostics = Resolve-FlowCellBlenderBridgeFolder -Config $config -IncludeDiagnostics
        $checkedSummary = if (@($diagnostics.CheckedPaths).Count -gt 0) { @($diagnostics.CheckedPaths) -join '; ' } else { '(none; Blender AppData root was not found)' }
        throw "Blender bridge folder could not be resolved. Config path: $Path. Checked path(s): $checkedSummary"
    }
    $config.automation | Add-Member -MemberType NoteProperty -Name bridgeFolder -Value $resolvedBridgeFolder -Force

    if (-not $config.automation.PSObject.Properties['responseTimeoutSeconds'] -or $null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20 -Force
    }

    return $config
}

function Get-ConfiguredBridgeFolderLeafName([object]$Config) {
    return Get-FlowCellConfiguredBridgeFolderLeafName -Config $Config
}

function Get-BridgeRuntimeStatusFileName([string]$BridgeRoot) {
    $bridgeLeaf = Split-Path -Path ([string]$BridgeRoot) -Leaf
    switch ($bridgeLeaf.ToLowerInvariant()) {
        'blender_bridge_flowcell' { return 'flowcell_bridge_runtime_status.json' }
        default { return 'flowcell_bridge_runtime_status.json' }
    }
}

function Test-BlenderRunning {
    return $null -ne (Get-Process blender -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-ForegroundProcessId {
    $windowHandle = Get-ForegroundWindowHandle
    if ($windowHandle -eq [IntPtr]::Zero) {
        return 0
    }

    return Get-WindowProcessId -WindowHandle $windowHandle
}

function Get-ForegroundWindowHandle {
    return [FlowCellForegroundWindow]::GetForegroundWindow()
}

function Get-WindowProcessId([IntPtr]$WindowHandle) {
    if ($WindowHandle -eq [IntPtr]::Zero) {
        return 0
    }

    $processId = 0
    [void][FlowCellForegroundWindow]::GetWindowThreadProcessId($WindowHandle, [ref]$processId)
    return [int]$processId
}

function Get-VisibleBlenderProcesses {
    return @(Get-Process blender -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
}

function Find-BlenderProcessIdBelowWindow([IntPtr]$StartHandle) {
    if ($StartHandle -eq [IntPtr]::Zero) {
        return 0
    }

    $visitedHandles = New-Object 'System.Collections.Generic.HashSet[string]'
    $windowHandle = $StartHandle
    for ($index = 0; $index -lt 250; $index++) {
        $windowHandle = [FlowCellForegroundWindow]::GetWindow($windowHandle, [FlowCellForegroundWindow]::GW_HWNDNEXT)
        if ($windowHandle -eq [IntPtr]::Zero) {
            break
        }

        $windowKey = $windowHandle.ToString()
        if (-not $visitedHandles.Add($windowKey)) {
            break
        }

        if (-not [FlowCellForegroundWindow]::IsWindowVisible($windowHandle)) {
            continue
        }

        $processId = Get-WindowProcessId -WindowHandle $windowHandle
        if ($processId -le 0) {
            continue
        }

        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($process -and [string]$process.ProcessName -ieq 'blender') {
            return [int]$processId
        }
    }

    return 0
}

function Get-TargetBlenderProcessId {
    $foregroundWindowHandle = Get-ForegroundWindowHandle
    $foregroundProcessId = Get-WindowProcessId -WindowHandle $foregroundWindowHandle
    if ($foregroundProcessId -gt 0) {
        $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
        if ($foregroundProcess -and [string]$foregroundProcess.ProcessName -ieq 'blender') {
            return [int]$foregroundProcessId
        }
    }

    $belowForegroundProcessId = Find-BlenderProcessIdBelowWindow -StartHandle $foregroundWindowHandle
    if ($belowForegroundProcessId -gt 0) {
        return [int]$belowForegroundProcessId
    }

    $blenderProcesses = @(Get-VisibleBlenderProcesses | Sort-Object StartTime -Descending)
    if (@($blenderProcesses).Count -eq 1) {
        return [int]$blenderProcesses[0].Id
    }

    throw 'Could not determine which Blender window is active. Activate the target Blender window and try again.'
}

function Get-BridgeFolderCandidates([object]$Config, [int]$TargetBlenderProcessId) {
    $candidates = New-Object System.Collections.Generic.List[string]
    $rootCandidates = New-Object System.Collections.Generic.List[object]
    $configuredBridgeRoot = [string]$Config.automation.bridgeFolder
    $bridgeFolderLeafName = Get-ConfiguredBridgeFolderLeafName -Config $Config
    $applicationDataRoot = [string]$env:APPDATA
    if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
    }
    $blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'

    $addRootCandidate = {
        param([string]$BridgeRoot)
        if ([string]::IsNullOrWhiteSpace($BridgeRoot)) { return }
        if (-not (Test-Path -LiteralPath $BridgeRoot -PathType Container)) { return }

        $runtimeStatusPath = Join-Path $BridgeRoot (Get-BridgeRuntimeStatusFileName -BridgeRoot $BridgeRoot)
        $runtimePid = 0
        if (Test-Path -LiteralPath $runtimeStatusPath -PathType Leaf) {
            try {
                $runtimeStatus = Get-Content -LiteralPath $runtimeStatusPath -Raw | ConvertFrom-Json
                if ($null -ne $runtimeStatus -and $runtimeStatus.PSObject.Properties['last_event']) {
                    $lastEvent = $runtimeStatus.last_event
                    if ($null -ne $lastEvent -and $lastEvent.PSObject.Properties['pid']) {
                        $runtimePid = [int]$lastEvent.pid
                    }
                }
            }
            catch {
                $runtimePid = 0
            }
        }

        $rootCandidates.Add([pscustomobject]@{
            BridgeRoot = $BridgeRoot
            RuntimePid = $runtimePid
            Preferred = ($runtimePid -eq $TargetBlenderProcessId)
        }) | Out-Null
    }

    & $addRootCandidate $configuredBridgeRoot

    if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        $bridgeLeafNames = New-Object System.Collections.Generic.List[string]
        if (-not [string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
            [void]$bridgeLeafNames.Add($bridgeFolderLeafName)
        }
        if ([string]$Action -ieq 'flowcell_custom_rotate' -and -not $bridgeLeafNames.Contains('blender_bridge_flowcell')) {
            [void]$bridgeLeafNames.Add('blender_bridge_flowcell')
        }

        foreach ($versionDirectory in @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
            foreach ($leafName in @($bridgeLeafNames)) {
                $fallbackBridgeRoot = Join-Path $versionDirectory.FullName ('scripts\addons\{0}' -f $leafName)
                if (
                    (Test-Path -LiteralPath $fallbackBridgeRoot -PathType Container) -and
                    ($configuredBridgeRoot.TrimEnd('\').ToLowerInvariant() -ne $fallbackBridgeRoot.TrimEnd('\').ToLowerInvariant())
                ) {
                    & $addRootCandidate $fallbackBridgeRoot
                }
            }
        }
    }

    foreach ($rootEntry in @($rootCandidates | Sort-Object @{ Expression = { if ($_.Preferred) { 0 } else { 1 } } }, @{ Expression = { $_.BridgeRoot } })) {
        $bridgeRoot = [string]$rootEntry.BridgeRoot
        if ([string]::IsNullOrWhiteSpace($bridgeRoot)) {
            continue
        }

        $primaryBridgeFolder = Join-Path $bridgeRoot ([string]$TargetBlenderProcessId)
        if (-not $candidates.Contains($primaryBridgeFolder)) {
            [void]$candidates.Add($primaryBridgeFolder)
        }

        $legacyResponsePath = Join-Path $bridgeRoot 'response.json'
        $legacyRequestPath = Join-Path $bridgeRoot 'request.json'
        if (
            $bridgeRoot -ne $primaryBridgeFolder -and
            (
                (Test-Path -LiteralPath $legacyResponsePath -PathType Leaf) -or
                (Test-Path -LiteralPath $legacyRequestPath -PathType Leaf)
            ) -and
            -not $candidates.Contains($bridgeRoot)
        ) {
            [void]$candidates.Add($bridgeRoot)
        }
    }

    return @($candidates)
}

function Wait-ForBridgeResponse([string]$ResponsePath, [string]$RequestId, [datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        if (Test-Path -LiteralPath $ResponsePath -PathType Leaf) {
            $response = Get-Content -LiteralPath $ResponsePath -Raw | ConvertFrom-Json
            if ([string]$response.id -eq $RequestId) {
                return $response
            }
        }

        Start-Sleep -Milliseconds 60
    }

    return $null
}

function Get-BridgeRuntimeStatus([string]$BridgeRoot) {
    if ([string]::IsNullOrWhiteSpace($BridgeRoot)) {
        return $null
    }

    $runtimeStatusPath = Join-Path $BridgeRoot (Get-BridgeRuntimeStatusFileName -BridgeRoot $BridgeRoot)
    if (-not (Test-Path -LiteralPath $runtimeStatusPath -PathType Leaf)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $runtimeStatusPath -Raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-BridgeTimeoutMessage([object]$Config, [int]$TargetBlenderProcessId, [string[]]$BridgeFolders) {
    $bridgeSummary = ($BridgeFolders -join '; ')
    $targetBridgeFolder = @($BridgeFolders | Where-Object { [string]$_ -match ([string]$TargetBlenderProcessId + '$') } | Select-Object -First 1)
    $targetBridgeFolder = if ($targetBridgeFolder.Count -gt 0) { [string]$targetBridgeFolder[0] } else { '' }
    $pendingRequestPath = if ([string]::IsNullOrWhiteSpace($targetBridgeFolder)) { '' } else { Join-Path $targetBridgeFolder 'request.json' }
    $pendingRequest = -not [string]::IsNullOrWhiteSpace($pendingRequestPath) -and (Test-Path -LiteralPath $pendingRequestPath -PathType Leaf)
    $runtimeStatus = Get-BridgeRuntimeStatus -BridgeRoot ([string]$Config.automation.bridgeFolder)
    $lastBridgePid = 0

    if ($null -ne $runtimeStatus -and $runtimeStatus.PSObject.Properties['last_event']) {
        $lastEvent = $runtimeStatus.last_event
        if ($null -ne $lastEvent -and $lastEvent.PSObject.Properties['pid']) {
            $lastBridgePid = [int]$lastEvent.pid
        }
    }

    if ($pendingRequest -and $lastBridgePid -ne $TargetBlenderProcessId) {
        return (
            "The active Blender window is not running the FlowCell bridge add-on. " +
            "Reload the Blender add-on from Item > FlowCell > 'refresh flowcell' or restart Blender, then try again. " +
            ("Target PID {0}; last bridge PID {1}; checked bridge path(s): {2}" -f $TargetBlenderProcessId, $lastBridgePid, $bridgeSummary)
        )
    }

    if ($pendingRequest) {
        return (
            "The active Blender window did not process the FlowCell bridge request. " +
            "Reload the Blender add-on from Item > FlowCell > 'refresh flowcell' or restart Blender, then try again. " +
            ("Target PID {0}; checked bridge path(s): {1}" -f $TargetBlenderProcessId, $bridgeSummary)
        )
    }

    return ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $TargetBlenderProcessId, $bridgeSummary)
}

function Test-BridgeResponseSucceeded([object]$Response) {
    if ($null -eq $Response) {
        return $false
    }

    $status = if ($Response.PSObject.Properties['status']) {
        [string]$Response.status
    }
    else {
        ''
    }
    $normalizedStatus = $status.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($normalizedStatus)) {
        return $true
    }

    return @('ok', 'finished', 'success') -contains $normalizedStatus
}

try {
    $config = Read-ConfigFile -Path $ConfigPath
    if (-not (Test-BlenderRunning)) {
        throw 'Blender is not running. Open Blender with the addon enabled first.'
    }

    $targetBlenderProcessId = Get-TargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString('N')
    $timeoutSeconds = [Math]::Max([int]$config.automation.responseTimeoutSeconds, 1)
    if ([string]$Action -eq 'render_active_object_png_to_images') {
        $timeoutSeconds = [Math]::Max($timeoutSeconds, 60)
    }
    $bridgeFolders = @(Get-BridgeFolderCandidates -Config $config -TargetBlenderProcessId $targetBlenderProcessId)

    $data = [ordered]@{}
    if (-not [string]::IsNullOrWhiteSpace($DataJson)) {
        $parsedData = $DataJson | ConvertFrom-Json
        foreach ($property in @($parsedData.PSObject.Properties)) {
            $data[$property.Name] = $property.Value
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($Direction)) {
        $data.direction = $Direction
    }

    if ([string]$Action -eq 'new_collection') {
        $name = [Microsoft.VisualBasic.Interaction]::InputBox(
            'Name for the new collection:',
            'New Collection',
            'Collection'
        )

        if ($null -eq $name) {
            Write-Status ('Cancelled Blender action: {0}' -f $Label)
            exit 1
        }

        $name = $name.Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            $name = 'Collection'
        }
        $data.name = $name
    }

    $payload = [pscustomobject][ordered]@{
        id        = $requestId
        action    = $Action
        data      = $data
        requested = (Get-Date).ToString('o')
    }

    $json = $payload | ConvertTo-Json -Depth 5
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $finalDeadline = (Get-Date).AddSeconds($timeoutSeconds)
    $firstAttemptSeconds = if (@($bridgeFolders).Count -gt 1) {
        [Math]::Min([Math]::Max([int][Math]::Ceiling($timeoutSeconds / 2.0), 2), [Math]::Max($timeoutSeconds - 1, 2))
    }
    else {
        $timeoutSeconds
    }

    for ($index = 0; $index -lt @($bridgeFolders).Count; $index++) {
        $bridgeFolder = [string]$bridgeFolders[$index]
        $requestPath = Join-Path $bridgeFolder 'request.json'
        $responsePath = Join-Path $bridgeFolder 'response.json'

        New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
        if (Test-Path -LiteralPath $responsePath -PathType Leaf) {
            Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $requestPath -PathType Leaf) {
            Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue
        }

        $temporaryRequestPath = '{0}.{1}.tmp' -f $requestPath, $requestId
        [System.IO.File]::WriteAllText($temporaryRequestPath, $json, $utf8NoBom)
        Move-Item -LiteralPath $temporaryRequestPath -Destination $requestPath -Force

        $waitForResponse = [bool]$PassThruResponse -or (Test-ActionToastEnabled -Action $Action)
        if (-not $waitForResponse) {
            Write-Status ('Queued Blender action: {0}' -f $Label)
            exit 0
        }

        $attemptDeadline = if ($index -lt (@($bridgeFolders).Count - 1)) {
            (Get-Date).AddSeconds($firstAttemptSeconds)
        }
        else {
            $finalDeadline
        }
        if ($attemptDeadline -gt $finalDeadline) {
            $attemptDeadline = $finalDeadline
        }

        $response = Wait-ForBridgeResponse -ResponsePath $responsePath -RequestId $requestId -Deadline $attemptDeadline
        if ($null -eq $response) {
            continue
        }

        if (Test-BridgeResponseSucceeded -Response $response) {
            $message = if ($response.PSObject.Properties['display'] -and -not [string]::IsNullOrWhiteSpace([string]$response.display)) {
                [string]$response.display
            }
            elseif ($response.PSObject.Properties['message'] -and -not [string]::IsNullOrWhiteSpace([string]$response.message)) {
                [string]$response.message
            }
            else {
                'Blender action completed.'
            }
            Write-Status $message
            if ((Test-ActionToastEnabled -Action $Action) -and -not $SuppressToast) {
                Show-ActionToast -Title (Get-ActionToastTitle -Action $Action) -Message $message -Kind 'Information'
            }
            if ($PassThruResponse) {
                $response
            }
            exit 0
        }

        $errorMessage = if ($response.PSObject.Properties['message']) { [string]$response.message } else { 'Blender returned an error.' }
        if ((Test-ActionToastEnabled -Action $Action) -and -not $SuppressToast) {
            Show-ActionToast -Title (Get-ActionToastTitle -Action $Action -Failed $true) -Message $errorMessage -Kind 'Error'
        }
        throw $errorMessage
    }

    throw (Get-BridgeTimeoutMessage -Config $config -TargetBlenderProcessId $targetBlenderProcessId -BridgeFolders $bridgeFolders)
}
catch {
    Write-Status $_.Exception.Message
    if ((Test-ActionToastEnabled -Action $Action) -and -not $SuppressToast) {
        Show-ActionToast -Title (Get-ActionToastTitle -Action $Action -Failed $true) -Message $_.Exception.Message -Kind 'Error'
    }
    exit 1
}

