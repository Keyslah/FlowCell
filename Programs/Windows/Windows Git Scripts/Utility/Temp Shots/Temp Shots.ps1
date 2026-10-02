# Description: Requests one direct-to-folder capture from the resident FlowCell backend.
[CmdletBinding()]
param(
    [switch]$ValidateOnly,
    [ValidateSet('temp-shots', 'snapshots')][string]$Mode = 'temp-shots',
    [string]$LauncherPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FlowCellRepoRoot {
    if ($env:FLOWCELL_RESOURCE_ROOT -and (Test-Path -LiteralPath (Join-Path $env:FLOWCELL_RESOURCE_ROOT 'flowcellbackend/FlowCellBackend.ahk'))) { return $env:FLOWCELL_RESOURCE_ROOT }
    $current = [System.IO.Path]::GetFullPath($PSScriptRoot)
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        if (Test-Path -LiteralPath (Join-Path $current 'flowcellbackend/FlowCellBackend.ahk') -PathType Leaf) {
            return $current
        }

        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }

    $installedRoot = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\FlowCell' -Name InstalledResourceRoot -ErrorAction SilentlyContinue
    if ($installedRoot -and (Test-Path -LiteralPath (Join-Path $installedRoot 'flowcell-installed.json') -PathType Leaf)) {
        return $installedRoot
    }
    throw 'The installed FlowCell capture backend could not be located.'
}

$script:RepoRoot = Resolve-FlowCellRepoRoot
. (Join-Path $script:RepoRoot 'flowcellbackend/helpers/FlowCellPaths.ps1')
$script:FlowCellLocalRoot = $FlowCellLocalRoot
$script:BackendRole = if ($FlowCellInstalled) { 'installed' } else { 'development' }
$script:ReceiverTitle = 'FlowCellBackendDirectScriptReceiver:' + $script:BackendRole
if ($script:BackendRole -eq 'development') {
    $receiverRoot = $script:RepoRoot.Replace('/', '\').TrimEnd('\')
    if ($receiverRoot.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $receiverRoot = '\\' + $receiverRoot.Substring(8) }
    elseif ($receiverRoot.StartsWith('\\?\')) { $receiverRoot = $receiverRoot.Substring(4) }
    $script:ReceiverTitle += ':' + $receiverRoot.ToLowerInvariant()
}
$script:StatusPath = Join-Path $script:FlowCellLocalRoot 'logs\last_action_status.txt'
$script:ConfigDirectory = Join-Path $script:FlowCellLocalRoot 'windows\temp-shots'
$script:ConfigPath = Join-Path $script:ConfigDirectory 'temp-shots.config.json'
$script:FolderCachePath = Join-Path $script:ConfigDirectory 'temp-shots.folder.txt'

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-FlowCellStatus {
    param([Parameter(Mandatory = $true)][string]$Message)

    $statusDirectory = Split-Path -Parent $script:StatusPath
    Ensure-Directory -Path $statusDirectory
    Set-Content -LiteralPath $script:StatusPath -Value $Message -Encoding UTF8
}

function Write-Utf8NoBomText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text
    )

    $directory = Split-Path -Parent $Path
    Ensure-Directory -Path $directory
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Read-TempShotsFolder {
    if (Test-Path -LiteralPath $script:FolderCachePath -PathType Leaf) {
        try {
            $cachedFolder = [System.IO.File]::ReadAllText($script:FolderCachePath, [System.Text.Encoding]::UTF8).Trim()
            $cachedFolder = $cachedFolder.Trim([char]0xFEFF)
            if (-not [string]::IsNullOrWhiteSpace($cachedFolder) -and
                (Test-Path -LiteralPath $cachedFolder -PathType Container)) {
                return [System.IO.Path]::GetFullPath($cachedFolder)
            }
        }
        catch {
        }
    }

    if (-not (Test-Path -LiteralPath $script:ConfigPath -PathType Leaf)) {
        return ''
    }

    try {
        $config = Get-Content -LiteralPath $script:ConfigPath -Raw -ErrorAction Stop | ConvertFrom-Json
        $folder = if ($config.PSObject.Properties['folder']) { [string]$config.folder } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($folder) -and
            (Test-Path -LiteralPath $folder -PathType Container)) {
            $resolvedFolder = [System.IO.Path]::GetFullPath($folder)
            Write-Utf8NoBomText -Path $script:FolderCachePath -Text $resolvedFolder
            return $resolvedFolder
        }
    }
    catch {
        return ''
    }

    return ''
}

function Save-TempShotsFolder {
    param([Parameter(Mandatory = $true)][string]$Folder)

    Ensure-Directory -Path $script:ConfigDirectory
    $config = [pscustomobject]@{
        folder = [System.IO.Path]::GetFullPath($Folder)
        savedAt = (Get-Date).ToString('o')
    }
    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    Write-Utf8NoBomText -Path $script:FolderCachePath -Text $config.folder
}

function Select-TempShotsFolder {
    Add-Type -AssemblyName System.Windows.Forms

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose where Temp Shots saves screenshots.'
    $dialog.ShowNewFolderButton = $true
    $dialog.SelectedPath = [Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyPictures)

    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and
        -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
        return [System.IO.Path]::GetFullPath($dialog.SelectedPath)
    }

    return ''
}

function Resolve-TempShotsFolder {
    $folder = Read-TempShotsFolder
    if (-not [string]::IsNullOrWhiteSpace($folder)) {
        return $folder
    }

    $selectedFolder = Select-TempShotsFolder
    if ([string]::IsNullOrWhiteSpace($selectedFolder)) {
        Write-FlowCellStatus -Message 'Temp Shots folder selection cancelled.'
        exit 0
    }

    Ensure-Directory -Path $selectedFolder
    Save-TempShotsFolder -Folder $selectedFolder
    return $selectedFolder
}

function Add-TempShotsBackendBridge {
    if ('FlowCell.TempShots.BackendBridge' -as [type]) { return }
    Add-Type -Namespace FlowCell.TempShots -Name BackendBridge -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct CopyData {
    public System.UIntPtr Id;
    public int ByteCount;
    public System.IntPtr Data;
}
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr FindWindow(string className, string title);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hwnd, uint message,
    System.IntPtr wParam, ref CopyData data, uint flags, uint timeout, out System.UIntPtr result);
'@
}

function Invoke-TempShotsBackend {
    Add-TempShotsBackendBridge
    & (Join-Path $script:RepoRoot 'flowcellbackend/helpers/Start-FlowCellBackend.ps1')
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $receiver = [FlowCell.TempShots.BackendBridge]::FindWindow('AutoHotkeyGUI', $script:ReceiverTitle)
        if ($receiver -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($receiver -eq [IntPtr]::Zero) {
        throw 'The FlowCell capture backend did not become ready.'
    }
    # Both the panel button and hotkey use the same resident, in-memory capture.
    # Do not fall back to Windows Snipping Tool: it independently auto-saves.
    $payload = @{
        command = 'run_script_now'
        scriptPath = if ($LauncherPath) { [IO.Path]::GetFullPath($LauncherPath) } else { Join-Path $PSScriptRoot 'Temp_Shots.vbs' }
        programKey = 'windows_generic'
        requestId = 'temp-shots-' + [guid]::NewGuid().ToString('N')
        backendRole = $script:BackendRole
        programsRoot = $FlowCellProgramsRoot
    } | ConvertTo-Json -Compress
    $dataPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($payload)
    try {
        $data = New-Object 'FlowCell.TempShots.BackendBridge+CopyData'
        $data.Id = [UIntPtr]::new(0x46435344)
        $data.ByteCount = ($payload.Length + 1) * 2
        $data.Data = $dataPointer
        $reply = [UIntPtr]::Zero
        $sent = [FlowCell.TempShots.BackendBridge]::SendMessageTimeout(
            $receiver, 0x4A, [IntPtr]::Zero, [ref]$data, 2, 2000, [ref]$reply)
        if ($sent -eq [IntPtr]::Zero -or $reply.ToUInt64() -ne 1) {
            throw 'The FlowCell capture backend did not accept Temp Shots. Try again when its current action finishes.'
        }
    }
    finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($dataPointer) }
}

try {
    Add-TempShotsBackendBridge
    if ($ValidateOnly) {
        $captureHelper = Join-Path $script:RepoRoot 'flowcellbackend\helpers\TempShotsCapture.ahk'
        if (-not (Test-Path -LiteralPath $captureHelper -PathType Leaf)) {
            throw 'The direct Temp Shots capture helper is missing.'
        }
        $validatedLauncher = if ($LauncherPath) { $LauncherPath } else { Join-Path $PSScriptRoot 'Temp_Shots.vbs' }
        if (-not (Test-Path -LiteralPath $validatedLauncher -PathType Leaf)) {
            throw 'The owned capture launcher is missing.'
        }
        Write-Output 'Temp Shots direct-capture package validation OK.'
        exit 0
    }
    $targetFolder = Resolve-TempShotsFolder
    Ensure-Directory -Path $targetFolder
    Invoke-TempShotsBackend
    exit 0
}
catch {
    $captureName = if ($Mode -eq 'snapshots') { 'Snapshots' } else { 'Temp Shots' }
    Write-FlowCellStatus -Message ("{0} failed: {1}" -f $captureName, $_.Exception.Message)
    exit 1
}
