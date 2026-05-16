# Description: Export the selected mesh objects as STL files and add them to Cura.

# Source Bridge Action: save_selected_stl_to_assets
# Source Python Filename: flowtest_actions.py
# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_save_selected_stl_to_assets_result
# Source Action Start Line: 1259

# Source Action Logic:

# def perform_save_selected_stl_to_assets_result(
#     context: bpy.types.Context,
#     requested_name: str = "",
# ) -> dict[str, object]:
#     if not hasattr(bpy.ops.wm, "stl_export"):
#         raise ValueError("This Blender build does not expose wm.stl_export.")
# 
#     selected_objects = list(context.selected_objects)
#     selected_meshes = [obj for obj in selected_objects if obj.type == "MESH"]
#     if not selected_meshes:
#         raise ValueError("Select at least one mesh object to export an STL.")
# 
#     assets_dir = get_assets_3d_directory_from_current_file()
#     export_scale = get_stl_export_scale_for_millimeters(context.scene)
# 
#     view_layer = context.view_layer
#     previous_active = view_layer.objects.active
#     previous_selected = list(selected_objects)
#     previous_mode = str(getattr(context, "mode", "OBJECT") or "OBJECT")
#     exported_paths: list[Path] = []
# 
#     try:
#         if previous_mode != "OBJECT":
#             if previous_active is not None:
#                 view_layer.objects.active = previous_active
#             elif selected_meshes:
#                 view_layer.objects.active = selected_meshes[0]
#             bpy.ops.object.mode_set(mode="OBJECT")
# 
#         result = None
#         for obj in selected_meshes:
#             bpy.ops.object.select_all(action="DESELECT")
#             obj.select_set(True)
#             view_layer.objects.active = obj
# 
#             export_stem = (
#                 sanitize_export_stem(requested_name)
#                 if requested_name.strip() and len(selected_meshes) == 1
#                 else sanitize_export_stem(strip_hidden_name_pad(strip_version_prefix(obj.name) or obj.name))
#             )
#             export_path = get_overwrite_export_path(assets_dir, export_stem, ".stl")
# 
#             result = bpy.ops.wm.stl_export(
#                 filepath=str(export_path),
#                 check_existing=False,
#                 export_selected_objects=True,
#                 apply_modifiers=True,
#                 ascii_format=False,
#                 use_scene_unit=False,
#                 global_scale=export_scale,
#             )
#             if result is None or "FINISHED" not in result:
#                 raise ValueError(f"STL export did not finish for '{obj.name}'.")
# 
#             exported_paths.append(export_path)
#     finally:
#         bpy.ops.object.select_all(action="DESELECT")
#         for obj in previous_selected:
#             try:
#                 obj.select_set(True)
#             except Exception:
#                 pass
#         if previous_active is not None:
#             try:
#                 view_layer.objects.active = previous_active
#             except Exception:
#                 pass
#         if previous_mode != "OBJECT":
#             try:
#                 bpy.ops.object.mode_set(mode=previous_mode)
#             except Exception:
#                 pass
# 
#     exported_count = len(exported_paths)
#     if exported_count == 0:
#         raise ValueError("STL export did not produce any files.")
# 
#     if exported_count == 1:
#         return {
#             "message": f"Saved STL to {exported_paths[0]}",
#             "exported_paths": [str(exported_paths[0])],
#         }
# 
#     return {
#         "message": f"Saved {exported_count} STL files to {assets_dir}",
#         "exported_paths": [str(path) for path in exported_paths],
#     }
# 
# 

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
$statusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'
$workerLogPath = Join-Path $flowCellLocalRoot 'logs\cura_import.log'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FlowCellCuraWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@

function Write-Status([string]$Message) {
    try {
        $folder = Split-Path -Parent $statusPath
        if (-not [string]::IsNullOrWhiteSpace($folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
    }
    catch {
    }
}

function Write-WorkerLog([string]$Message) {
    try {
        $folder = Split-Path -Parent $workerLogPath
        if (-not [string]::IsNullOrWhiteSpace($folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Add-Content -LiteralPath $workerLogPath -Value ("[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss.fff'), $Message) -Encoding UTF8
    }
    catch {
    }
}

function ConvertTo-LogJson([object]$Value) {
    try {
        return ($Value | ConvertTo-Json -Depth 8 -Compress)
    }
    catch {
        return '<unserializable>'
    }
}

function Show-Toast([string]$Title, [string]$Message, [string]$Kind = 'Information') {
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

function Get-SelectedObjectNames([object]$Response) {
    $names = @()
    if ($null -eq $Response) {
        return @()
    }

    if ($Response.PSObject.Properties['selected_objects']) {
        foreach ($item in @($Response.selected_objects)) {
            $name = ''
            if ($null -ne $item) {
                if ($item -is [string]) {
                    $name = [string]$item
                }
                elseif ($item.PSObject.Properties['name']) {
                    $name = [string]$item.name
                }
            }

            if (-not [string]::IsNullOrWhiteSpace($name)) {
                $names += $name
            }
        }
    }

    return @($names)
}

function Get-SanitizedExportStem([string]$Name) {
    $value = if ($null -eq $Name) { '' } else { [string]$Name }
    $value = [regex]::Replace($value, '^\([sta]\d+\)', '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Trim()
    $value = $value.Replace([string][char]0x200B, '')
    $value = [regex]::Replace($value, '[<>:"/\\|?*]+', '_')
    $value = [regex]::Replace($value, '\s+', ' ').Trim()
    $value = $value.Trim(' ', '.')
    if ([string]::IsNullOrWhiteSpace($value)) {
        return 'selected'
    }
    return $value
}

function Get-ExpectedExportCount([object]$Response, [string[]]$SelectedObjectNames) {
    if (@($SelectedObjectNames).Count -gt 0) {
        return @($SelectedObjectNames).Count
    }

    if ($null -ne $Response -and $Response.PSObject.Properties['message']) {
        $message = [string]$Response.message
        if ($message -match '^Saved (\d+) STL files? to ') {
            return [int]$matches[1]
        }
        if ($message -match '^Saved STL to .+\.stl$') {
            return 1
        }
    }

    return 0
}

function Get-RecentExportedPaths([string]$FolderPath, [int]$Count, [datetime]$ExportStartedAt) {
    if ([string]::IsNullOrWhiteSpace($FolderPath) -or $Count -le 0 -or -not (Test-Path -LiteralPath $FolderPath -PathType Container)) {
        return @()
    }

    $cutoff = $ExportStartedAt.AddSeconds(-10)
    $recent = @(
        Get-ChildItem -LiteralPath $FolderPath -Filter '*.stl' -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -ge $cutoff } |
            Sort-Object LastWriteTime, Name -Descending |
            Select-Object -First $Count
    )

    if (@($recent).Count -ne $Count) {
        return @()
    }

    return @($recent | Sort-Object Name | ForEach-Object { $_.FullName })
}

function Normalize-ExportedPaths([object]$Response, [string[]]$SelectedObjectNames = @(), [datetime]$ExportStartedAt = [datetime]::MinValue) {
    $paths = @()
    if ($null -eq $Response) {
        return @()
    }

    if ($Response.PSObject.Properties['exported_paths']) {
        foreach ($item in @($Response.exported_paths)) {
            $value = [string]$item
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $paths += $value
            }
        }
    }

    if (@($paths).Count -eq 0 -and $Response.PSObject.Properties['message']) {
        $message = [string]$Response.message
        if ($message -match '^Saved STL to (.+\.stl)$') {
            $paths += $matches[1]
        }
        elseif ($message -match '^Saved \d+ STL files? to (.+)$') {
            $folderPath = [string]$matches[1]
            $expectedPaths = @()
            foreach ($name in @($SelectedObjectNames)) {
                $stem = Get-SanitizedExportStem -Name $name
                $expectedPaths += (Join-Path $folderPath ($stem + '.stl'))
            }

            $existingExpectedPaths = @($expectedPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
            if (@($existingExpectedPaths).Count -eq @($expectedPaths).Count -and @($existingExpectedPaths).Count -gt 0) {
                $paths += $existingExpectedPaths
            }
            else {
                $expectedCount = Get-ExpectedExportCount -Response $Response -SelectedObjectNames $SelectedObjectNames
                $recentPaths = @(Get-RecentExportedPaths -FolderPath $folderPath -Count $expectedCount -ExportStartedAt $ExportStartedAt)
                if (@($recentPaths).Count -gt 0) {
                    $paths += $recentPaths
                }
            }
        }
    }

    return @($paths)
}

function Get-CuraExecutablePath {
    $running = @(Get-Process 'UltiMaker-Cura' -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (@($running).Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$running[0].Path)) {
        return [string]$running[0].Path
    }

    $candidates = @(
        Get-ChildItem 'C:\Program Files' -Filter 'UltiMaker Cura*' -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'UltiMaker-Cura.exe' }
        Get-ChildItem 'C:\Program Files (x86)' -Filter 'UltiMaker Cura*' -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'UltiMaker-Cura.exe' }
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [string]$candidate
        }
    }

    throw 'Could not find UltiMaker Cura.exe.'
}

function Format-Argument([string]$Value) {
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-ForegroundProcessId {
    $windowHandle = [FlowCellCuraWindow]::GetForegroundWindow()
    if ($windowHandle -eq [IntPtr]::Zero) {
        return 0
    }

    $processId = 0
    [void][FlowCellCuraWindow]::GetWindowThreadProcessId($windowHandle, [ref]$processId)
    return [int]$processId
}

function Get-TargetCuraProcess {
    $visibleCura = @(Get-Process 'UltiMaker-Cura' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending)
    if (@($visibleCura).Count -eq 0) {
        return $null
    }

    return $visibleCura[0]
}

function Get-ProcessMainWindowHandle([System.Diagnostics.Process]$Process, [int]$TimeoutMilliseconds = 2000) {
    if ($null -eq $Process) {
        return [IntPtr]::Zero
    }

    $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $Process.Refresh()
        }
        catch {
        }

        $handleValue = [int64]$Process.MainWindowHandle
        if ($handleValue -ne 0) {
            return [IntPtr]$handleValue
        }

        Start-Sleep -Milliseconds 120
    }

    return [IntPtr]::Zero
}

function Wait-ForAppActivate([object[]]$Titles, [int]$TimeoutMilliseconds = 5000) {
    $shell = New-Object -ComObject WScript.Shell
    $deadline = (Get-Date).AddMilliseconds($TimeoutMilliseconds)
    while ((Get-Date) -lt $deadline) {
        foreach ($title in $Titles) {
            if ($shell.AppActivate($title)) {
                return $true
            }
        }
        Start-Sleep -Milliseconds 120
    }

    return $false
}

function Activate-CuraWindow([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) {
        return $false
    }

    $deadline = (Get-Date).AddMilliseconds(2200)
    while ((Get-Date) -lt $deadline) {
        $windowHandle = Get-ProcessMainWindowHandle -Process $Process -TimeoutMilliseconds 300
        if ($windowHandle -ne [IntPtr]::Zero) {
            $showMode = if ([FlowCellCuraWindow]::IsIconic($windowHandle)) { 9 } else { 5 }
            [void][FlowCellCuraWindow]::ShowWindowAsync($windowHandle, $showMode)
            [void][FlowCellCuraWindow]::BringWindowToTop($windowHandle)
            $nativeResult = [FlowCellCuraWindow]::SetForegroundWindow($windowHandle)
            Start-Sleep -Milliseconds 250

            if ((Get-ForegroundProcessId) -eq $Process.Id) {
                Write-WorkerLog ("Activated Cura via native handle {0}." -f $windowHandle)
                return $true
            }

            if ($nativeResult) {
                $shell = New-Object -ComObject WScript.Shell
                $shell.SendKeys('%')
                Start-Sleep -Milliseconds 120
                [void][FlowCellCuraWindow]::ShowWindowAsync($windowHandle, $showMode)
                [void][FlowCellCuraWindow]::BringWindowToTop($windowHandle)
                [void][FlowCellCuraWindow]::SetForegroundWindow($windowHandle)
                Start-Sleep -Milliseconds 250
                if ((Get-ForegroundProcessId) -eq $Process.Id) {
                    Write-WorkerLog ("Activated Cura via ALT+native handle {0}." -f $windowHandle)
                    return $true
                }
            }
        }

        $shell = New-Object -ComObject WScript.Shell
        $titles = @()
        if (-not [string]::IsNullOrWhiteSpace([string]$Process.MainWindowTitle)) {
            $titles += [string]$Process.MainWindowTitle
        }
        $titles += 'UltiMaker Cura'

        foreach ($title in $titles) {
            if (-not $shell.AppActivate($title)) {
                continue
            }
            Start-Sleep -Milliseconds 250
            if ((Get-ForegroundProcessId) -eq $Process.Id) {
                Write-WorkerLog ("Activated Cura via AppActivate title '{0}'." -f $title)
                return $true
            }
            $shell.SendKeys('%')
            Start-Sleep -Milliseconds 120
            if ($shell.AppActivate($title)) {
                Start-Sleep -Milliseconds 250
                if ((Get-ForegroundProcessId) -eq $Process.Id) {
                    Write-WorkerLog ("Activated Cura via ALT+AppActivate title '{0}'." -f $title)
                    return $true
                }
            }
        }

        if ($shell.AppActivate($Process.Id)) {
            Start-Sleep -Milliseconds 250
            if ((Get-ForegroundProcessId) -eq $Process.Id) {
                Write-WorkerLog ("Activated Cura via AppActivate PID {0}." -f $Process.Id)
                return $true
            }
            $shell.SendKeys('%')
            Start-Sleep -Milliseconds 120
            if ($shell.AppActivate($Process.Id)) {
                Start-Sleep -Milliseconds 250
                if ((Get-ForegroundProcessId) -eq $Process.Id) {
                    Write-WorkerLog ("Activated Cura via ALT+AppActivate PID {0}." -f $Process.Id)
                    return $true
                }
            }
        }

        Start-Sleep -Milliseconds 120
    }

    Write-WorkerLog ("Failed to activate Cura. PID={0}; Title='{1}'; Handle={2}; ForegroundPid={3}" -f $Process.Id, ([string]$Process.MainWindowTitle), ([int64]$windowHandle), (Get-ForegroundProcessId))
    return $false
}

function Open-CuraFileDialog([System.Diagnostics.Process]$Process) {
    if ($null -eq $Process) {
        throw 'Cura is not running.'
    }

    if (Wait-ForAppActivate -Titles @('Open file(s)', 'Open') -TimeoutMilliseconds 300) {
        return
    }

    if (-not (Activate-CuraWindow -Process $Process)) {
        throw 'Could not activate the Cura window.'
    }

    $shell = New-Object -ComObject WScript.Shell
    $attempts = @(
        @('%f', 'o'),
        @('^o'),
        @('%f', 'o')
    )
    foreach ($attempt in $attempts) {
        Write-WorkerLog ("Trying dialog shortcut sequence: {0}" -f ($attempt -join ' '))
        $shell.SendKeys('{ESCAPE}')
        Start-Sleep -Milliseconds 120
        foreach ($keys in $attempt) {
            $shell.SendKeys($keys)
            Start-Sleep -Milliseconds 220
        }
        if (Wait-ForAppActivate -Titles @('Open file(s)', 'Open') -TimeoutMilliseconds 1200) {
            return
        }
    }

    throw 'Cura did not open its file dialog.'
}

function Import-FilesIntoRunningCura([System.Diagnostics.Process]$Process, [string[]]$Files) {
    if ($null -eq $Process) {
        throw 'Cura is not running.'
    }

    $shell = New-Object -ComObject WScript.Shell
    Write-WorkerLog ("Importing into Cura PID {0}" -f $Process.Id)
    $fullPaths = @($Files | ForEach-Object { [System.IO.Path]::GetFullPath($_) })

    foreach ($fullPath in $fullPaths) {
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw ("STL file not found: {0}" -f $fullPath)
        }

        Write-WorkerLog ("Submitting file: {0}" -f $fullPath)
        Open-CuraFileDialog -Process $Process

        Set-Clipboard -Value $fullPath
        Start-Sleep -Milliseconds 120
        $shell.SendKeys('%n')
        Start-Sleep -Milliseconds 180
        $shell.SendKeys('^a')
        Start-Sleep -Milliseconds 120
        $shell.SendKeys('^v')
        Start-Sleep -Milliseconds 150
        $shell.SendKeys('{ENTER}')

        Start-Sleep -Milliseconds 700
        if (Wait-ForAppActivate -Titles @('Open file(s)', 'Open') -TimeoutMilliseconds 500) {
            throw ("Cura open dialog did not complete the import for {0}." -f ([System.IO.Path]::GetFileName($fullPath)))
        }
    }

    Write-WorkerLog ("Cura import dialog accepted {0} file(s)." -f @($fullPaths).Count)
}

try {
    Write-WorkerLog 'Main wrapper started.'

    $selectionResponse = $null
    try {
        $selectionResponse = & $dispatcherPath -Action 'get_selected_objects' -Label 'cura selection' -PassThruResponse
        Write-WorkerLog ("Selection response: {0}" -f (ConvertTo-LogJson -Value $selectionResponse))
        Write-WorkerLog ("Selection dispatcher exit code: {0}" -f $LASTEXITCODE)
        if ($LASTEXITCODE -ne 0) {
            $selectionResponse = $null
        }
    }
    catch {
        Write-WorkerLog ("Selection preflight failed: {0}" -f $_.Exception.Message)
        $selectionResponse = $null
    }

    $selectedObjectNames = @(Get-SelectedObjectNames -Response $selectionResponse)
    Write-WorkerLog ("Selected object names: {0}" -f (ConvertTo-LogJson -Value $selectedObjectNames))

    $exportStartedAt = Get-Date
    $response = & $dispatcherPath -Action 'save_selected_stl_to_assets' -Label 'cura' -PassThruResponse -SuppressToast
    Write-WorkerLog ("Export response: {0}" -f (ConvertTo-LogJson -Value $response))
    $dispatcherExitCode = $LASTEXITCODE
    Write-WorkerLog ("Export dispatcher exit code: {0}" -f $dispatcherExitCode)
    if ($dispatcherExitCode -ne 0) {
        exit $dispatcherExitCode
    }

    $exportedPaths = @(Normalize-ExportedPaths -Response $response -SelectedObjectNames $selectedObjectNames -ExportStartedAt $exportStartedAt)
    Write-WorkerLog ("Normalized exported paths: {0}" -f (ConvertTo-LogJson -Value $exportedPaths))
    if (@($exportedPaths).Count -eq 0) {
        throw 'FlowCell did not receive any exported STL paths back from Blender.'
    }

    $fullPaths = @()
    foreach ($item in @($exportedPaths)) {
        $fullPath = [System.IO.Path]::GetFullPath([string]$item)
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw ("STL file not found: {0}" -f $fullPath)
        }
        $fullPaths += $fullPath
    }

    $fileCount = @($fullPaths).Count
    $fileLabel = if ($fileCount -eq 1) { 'file' } else { 'files' }

    $targetCura = Get-TargetCuraProcess
    if ($null -ne $targetCura) {
        Write-WorkerLog ("Resolved target Cura PID: {0}" -f $targetCura.Id)
        Import-FilesIntoRunningCura -Process $targetCura -Files $fullPaths
        $message = "Sent $fileCount STL $fileLabel to Cura."
        Write-Status $message
        Show-Toast -Title 'Cura' -Message $message -Kind 'Information'
        exit 0
    }

    $curaExe = Get-CuraExecutablePath
    $arguments = @('--single-instance') + @($fullPaths | ForEach-Object { Format-Argument -Value $_ })
    Write-WorkerLog ("No running Cura found. Launching {0}" -f $curaExe)
    Start-Process -FilePath $curaExe -ArgumentList ($arguments -join ' ')
    $message = "Launched Cura with $fileCount STL $fileLabel."
    Write-Status $message
    Show-Toast -Title 'Cura' -Message $message -Kind 'Information'
    exit 0
}
catch {
    $message = $_.Exception.Message
    Write-WorkerLog ("Main wrapper failed: {0}" -f $message)
    Write-Status $message
    Show-Toast -Title 'Cura Failed' -Message $message -Kind 'Error'
    exit 1
}































































































