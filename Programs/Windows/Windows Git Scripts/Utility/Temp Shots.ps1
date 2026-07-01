# Description: Opens Windows screen snip and saves the captured image to a first-use chosen Temp Shots folder.
[CmdletBinding()]
param(
    [switch]$ValidateOnly,
    [switch]$StaRelaunch,
    [switch]$SaveStartedSnip,
    [uint32]$InitialSequence = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FlowCellRepoRoot {
    $current = [System.IO.Path]::GetFullPath($PSScriptRoot)
    while (-not [string]::IsNullOrWhiteSpace($current)) {
        $summaryPath = Join-Path $current 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $current 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and
            (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $current
        }

        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }

    throw 'FlowCell repository root could not be resolved.'
}

$script:RepoRoot = Resolve-FlowCellRepoRoot
$script:FlowCellLocalRoot = Join-Path $script:RepoRoot 'FlowCell\local'
$script:StatusPath = Join-Path $script:FlowCellLocalRoot 'logs\last_action_status.txt'
$script:ConfigDirectory = Join-Path $script:FlowCellLocalRoot 'windows\temp-shots'
$script:ConfigPath = Join-Path $script:ConfigDirectory 'temp-shots.config.json'
$script:FolderCachePath = Join-Path $script:ConfigDirectory 'temp-shots.folder.txt'
$script:LiveLauncherPath = Join-Path $script:RepoRoot 'Programs\Windows\Panels\Utility\Temp_Shots.vbs'

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

function Stop-OlderTempShotsRuns {
    $currentPid = [int]$PID
    $currentParentPid = 0
    try {
        $currentProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $currentPid) -ErrorAction Stop
        $currentParentPid = [int]$currentProcess.ParentProcessId
    }
    catch {
        $currentParentPid = 0
    }

    $processes = @()
    foreach ($processName in @('powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe')) {
        $processes += @(Get-CimInstance Win32_Process -Filter ("Name = '{0}'" -f $processName) -ErrorAction SilentlyContinue)
    }

    foreach ($process in $processes) {
        $processId = [int]$process.ProcessId
        if ($processId -eq $currentPid -or $processId -eq $currentParentPid) {
            continue
        }

        $name = [string]$process.Name
        $commandLine = [string]$process.CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine)) {
            continue
        }

        $isTempShotsPowerShell =
            ($name -ieq 'powershell.exe' -or $name -ieq 'pwsh.exe') -and
            ($commandLine -match 'Temp Shots\.ps1')
        $isTempShotsLauncher =
            ($name -ieq 'wscript.exe' -or $name -ieq 'cscript.exe') -and
            ($commandLine -match 'Temp_Shots\.vbs')

        if ($isTempShotsPowerShell -or $isTempShotsLauncher) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($ValidateOnly) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        [void][Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyPictures)
        $explorerPath = Join-Path $env:WINDIR 'explorer.exe'
        if (-not (Test-Path -LiteralPath $explorerPath -PathType Leaf)) {
            throw "Windows Explorer was not found at $explorerPath."
        }
        Write-FlowCellStatus -Message 'Temp Shots script validation OK.'
        exit 0
    }
    catch {
        Write-FlowCellStatus -Message ("Temp Shots validation failed: {0}" -f $_.Exception.Message)
        exit 1
    }
}

if (-not $StaRelaunch -and [System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $scriptPath = if (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
        $PSCommandPath
    }
    else {
        $MyInvocation.MyCommand.Path
    }
    $childArgs = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Sta',
        '-WindowStyle',
        'Hidden',
        '-File',
        $scriptPath,
        '-StaRelaunch'
    )
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $powershell
    foreach ($argument in $childArgs) {
        [void]$startInfo.ArgumentList.Add($argument)
    }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.WaitForExit()
    exit ([int]$process.ExitCode)
}

Stop-OlderTempShotsRuns

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

function Add-ClipboardSequenceType {
    if ('FlowCell.TempShots.NativeMethods' -as [type]) {
        return
    }

    Add-Type -Namespace FlowCell.TempShots -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetClipboardSequenceNumber();
'@
}

function Get-ClipboardSequenceNumber {
    Add-ClipboardSequenceType
    return [FlowCell.TempShots.NativeMethods]::GetClipboardSequenceNumber()
}

function Start-WindowsScreenSnip {
    try {
        $explorerPath = Join-Path $env:WINDIR 'explorer.exe'
        Start-Process -FilePath $explorerPath -ArgumentList 'ms-screenclip:' -ErrorAction Stop
        return
    }
    catch {
        try {
            Start-Process -FilePath 'SnippingTool.exe' -ArgumentList '/clip' -ErrorAction Stop
            return
        }
        catch {
            throw 'Windows screen snip could not be started.'
        }
    }
}

function Wait-ForClipboardScreenshot {
    param(
        [Parameter(Mandatory = $true)][uint32]$InitialSequence,
        [int]$TimeoutSeconds = 90
    )

    Add-Type -AssemblyName System.Windows.Forms
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $clipboardChangedWithoutImageAt = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 60
        $currentSequence = Get-ClipboardSequenceNumber
        if ($currentSequence -eq $InitialSequence) {
            $clipboardChangedWithoutImageAt = $null
            continue
        }

        if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
            $image = [System.Windows.Forms.Clipboard]::GetImage()
            if ($null -ne $image) {
                return $image
            }
        }

        if ($null -eq $clipboardChangedWithoutImageAt) {
            $clipboardChangedWithoutImageAt = Get-Date
        }
        elseif (((Get-Date) - $clipboardChangedWithoutImageAt).TotalMilliseconds -ge 1200) {
            return $null
        }
    }

    return $null
}

function New-TempShotPath {
    param([Parameter(Mandatory = $true)][string]$Folder)

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    for ($index = 0; $index -lt 100; $index++) {
        $suffix = if ($index -eq 0) { '' } else { '-{0:00}' -f $index }
        $candidate = Join-Path $Folder ("temp-shot-{0}{1}.png" -f $stamp, $suffix)
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    return (Join-Path $Folder ("temp-shot-{0}-{1}.png" -f $stamp, [guid]::NewGuid().ToString('N')))
}

try {
    $targetFolder = Resolve-TempShotsFolder
    Ensure-Directory -Path $targetFolder

    Add-Type -AssemblyName System.Drawing
    if ($SaveStartedSnip) {
        $initialSequence = $InitialSequence
    }
    else {
        $initialSequence = Get-ClipboardSequenceNumber
        Start-WindowsScreenSnip
    }
    Write-FlowCellStatus -Message 'Temp Shots is waiting for a screen snip.'

    $image = Wait-ForClipboardScreenshot -InitialSequence $initialSequence
    if ($null -eq $image) {
        Write-FlowCellStatus -Message 'Temp Shots cancelled or no screenshot was copied.'
        exit 0
    }

    $shotPath = New-TempShotPath -Folder $targetFolder
    try {
        $image.Save($shotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $image.Dispose()
    }

    Write-FlowCellStatus -Message ("Saved Temp Shot: {0}" -f $shotPath)
    exit 0
}
catch {
    Write-FlowCellStatus -Message ("Temp Shots failed: {0}" -f $_.Exception.Message)
    exit 1
}
