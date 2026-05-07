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

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$localConfigPath = Join-Path $flowCellLocalRoot 'private\blender.config.local.json'
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) { $localConfigPath } else { Join-Path $repoRoot 'Blender\config.json' }
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

function Read-ConfigFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Blender config not found: $Path"
    }

    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if ($null -eq $config.automation -or [string]::IsNullOrWhiteSpace([string]$config.automation.bridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }

    if ($null -eq $config.automation.responseTimeoutSeconds) {
        $config.automation | Add-Member -MemberType NoteProperty -Name responseTimeoutSeconds -Value 20
    }

    return $config
}

function Get-ConfiguredBridgeFolderLeafName([object]$Config) {
    $configuredBridgeRoot = if ($Config -and $Config.automation) { [string]$Config.automation.bridgeFolder } else { '' }
    $bridgeFolderLeafName = if ([string]::IsNullOrWhiteSpace($configuredBridgeRoot)) { '' } else { Split-Path -Path $configuredBridgeRoot -Leaf }
    if ([string]::IsNullOrWhiteSpace($bridgeFolderLeafName)) {
        return 'blender_bridge'
    }
    return $bridgeFolderLeafName
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
    $configuredBridgeRoot = [string]$Config.automation.bridgeFolder
    $bridgeFolderLeafName = Get-ConfiguredBridgeFolderLeafName -Config $Config

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

    $blenderAppDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $fallbackBridgeRoot = Join-Path $_.FullName ('scripts\addons\{0}' -f $bridgeFolderLeafName)
                if (
                    (Test-Path -LiteralPath $fallbackBridgeRoot -PathType Container) -and
                    ($fallbackBridgeRoot.TrimEnd('\').ToLowerInvariant() -ne $configuredBridgeRoot.TrimEnd('\').ToLowerInvariant())
                ) {
                    & $addBridgeRootCandidates $fallbackBridgeRoot
                }
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

try {
    $config = Read-ConfigFile -Path $ConfigPath
    if (-not (Test-BlenderRunning)) {
        throw 'Blender is not running. Open Blender with the addon enabled first.'
    }

    $targetBlenderProcessId = Get-TargetBlenderProcessId
    $requestId = [guid]::NewGuid().ToString()
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

        [System.IO.File]::WriteAllText($requestPath, $json, $utf8NoBom)

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

        if ([string]$response.status -eq 'ok') {
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

    $bridgeSummary = ($bridgeFolders -join '; ')
    throw ("Timed out waiting for Blender. Target PID {0}. Checked bridge path(s): {1}" -f $targetBlenderProcessId, $bridgeSummary)
}
catch {
    Write-Status $_.Exception.Message
    if ((Test-ActionToastEnabled -Action $Action) -and -not $SuppressToast) {
        Show-ActionToast -Title (Get-ActionToastTitle -Action $Action -Failed $true) -Message $_.Exception.Message -Kind 'Error'
    }
    exit 1
}

