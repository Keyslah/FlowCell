#Requires -Version 5.1
<#
.SYNOPSIS
Saves text from the Windows clipboard as a new UTF-8 text file.

.DESCRIPTION
The first run asks for a destination folder and remembers it. Importing this
package more than once creates independent FlowCell Buttons: every owner stores
its own destination in its own preserved runtime folder. Hold Shift while
running one Button to change only that Button's folder. Direct, standalone use
stores its setting under the current user's Local AppData. No repository, user,
or machine path is hardcoded.

.PARAMETER Configure
Choose and remember a different destination folder before saving the clipboard.
This is the command-line equivalent of holding Shift while running a Button.

.PARAMETER ValidateOnly
Load the desktop dependencies and validate portable path resolution without
opening a dialog, reading the clipboard, or writing a file.

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\save_clipboard_text.ps1

.EXAMPLE
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\save_clipboard_text.ps1 -Configure
#>
[CmdletBinding()]
param(
    [switch]$Configure,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Save Clipboard Text requires Windows.'
}

if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne [Threading.ApartmentState]::STA) {
    if ([string]::IsNullOrWhiteSpace($PSCommandPath)) {
        throw 'Save Clipboard Text must be run from its .ps1 file.'
    }

    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
        $windowsPowerShell = (Get-Process -Id $PID -ErrorAction Stop).Path
    }

    $quotedScriptPath = '"' + $PSCommandPath + '"'
    $childArguments = "-NoProfile -STA -ExecutionPolicy Bypass -File $quotedScriptPath"
    if ($Configure) {
        $childArguments += ' -Configure'
    }
    if ($ValidateOnly) {
        $childArguments += ' -ValidateOnly'
    }

    $child = Start-Process -FilePath $windowsPowerShell -ArgumentList $childArguments -WindowStyle Hidden -Wait -PassThru
    exit $child.ExitCode
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-SettingsDirectory {
    $sourceDirectory = [System.IO.Path]::GetFullPath($PSScriptRoot)
    $ownerDirectory = Split-Path -Parent $sourceDirectory
    $installRecordPath = Join-Path $ownerDirectory 'flowcell.install.json'

    if ((Split-Path -Leaf $sourceDirectory) -ieq 'source' -and
        (Test-Path -LiteralPath $installRecordPath -PathType Leaf)) {
        return (Join-Path $ownerDirectory 'runtime')
    }

    $localApplicationData = [Environment]::GetFolderPath(
        [Environment+SpecialFolder]::LocalApplicationData
    )
    if ([string]::IsNullOrWhiteSpace($localApplicationData)) {
        throw 'The current user Local AppData folder could not be resolved.'
    }

    return (Join-Path $localApplicationData 'FlowCell\Save Clipboard Text')
}

function Get-SavedDestinationFolder {
    param([Parameter(Mandatory = $true)][string]$SettingsPath)

    if (-not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
        return ''
    }

    try {
        $settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $folder = [string]$settings.destinationFolder
        if ([string]::IsNullOrWhiteSpace($folder) -or
            -not (Test-Path -LiteralPath $folder -PathType Container)) {
            return ''
        }

        return [System.IO.Path]::GetFullPath($folder)
    }
    catch {
        return ''
    }
}

function Select-DestinationFolder {
    param([string]$InitialFolder)

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    try {
        $dialog.Description = 'Choose where clipboard text files will be saved.'
        $dialog.ShowNewFolderButton = $true

        if (-not [string]::IsNullOrWhiteSpace($InitialFolder) -and
            (Test-Path -LiteralPath $InitialFolder -PathType Container)) {
            $dialog.SelectedPath = $InitialFolder
        }
        else {
            $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
            if (-not [string]::IsNullOrWhiteSpace($documents)) {
                $dialog.SelectedPath = $documents
            }
        }

        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK -or
            [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {
            return ''
        }

        return [System.IO.Path]::GetFullPath($dialog.SelectedPath)
    }
    finally {
        $dialog.Dispose()
    }
}

function Save-DestinationFolder {
    param(
        [Parameter(Mandatory = $true)][string]$SettingsDirectory,
        [Parameter(Mandatory = $true)][string]$SettingsPath,
        [Parameter(Mandatory = $true)][string]$DestinationFolder
    )

    [void][System.IO.Directory]::CreateDirectory($SettingsDirectory)
    $settings = [ordered]@{
        schemaVersion = 1
        destinationFolder = [System.IO.Path]::GetFullPath($DestinationFolder)
    }
    $json = ($settings | ConvertTo-Json -Depth 3) + [Environment]::NewLine
    [System.IO.File]::WriteAllText(
        $SettingsPath,
        $json,
        (New-Object System.Text.UTF8Encoding $false)
    )
}

function Resolve-DestinationFolder {
    param(
        [Parameter(Mandatory = $true)][string]$SettingsDirectory,
        [Parameter(Mandatory = $true)][string]$SettingsPath,
        [switch]$ForcePrompt
    )

    $savedFolder = Get-SavedDestinationFolder -SettingsPath $SettingsPath
    if (-not $ForcePrompt -and -not [string]::IsNullOrWhiteSpace($savedFolder)) {
        return $savedFolder
    }

    $selectedFolder = Select-DestinationFolder -InitialFolder $savedFolder
    if ([string]::IsNullOrWhiteSpace($selectedFolder)) {
        return ''
    }

    Save-DestinationFolder `
        -SettingsDirectory $SettingsDirectory `
        -SettingsPath $SettingsPath `
        -DestinationFolder $selectedFolder
    return $selectedFolder
}

function Get-ClipboardTextResult {
    $attemptCount = 8
    for ($attempt = 1; $attempt -le $attemptCount; $attempt++) {
        try {
            if (-not [System.Windows.Forms.Clipboard]::ContainsText()) {
                return [pscustomobject]@{
                    HasText = $false
                    Text = ''
                }
            }

            return [pscustomobject]@{
                HasText = $true
                Text = [System.Windows.Forms.Clipboard]::GetText(
                    [System.Windows.Forms.TextDataFormat]::UnicodeText
                )
            }
        }
        catch [System.Runtime.InteropServices.ExternalException] {
            if ($attempt -eq $attemptCount) {
                throw 'The Windows clipboard is busy. Try the Button again.'
            }
            Start-Sleep -Milliseconds 75
        }
    }

    throw 'The Windows clipboard could not be read.'
}

function Write-TextToNewFile {
    param(
        [Parameter(Mandatory = $true)][string]$DestinationFolder,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss-fff', [Globalization.CultureInfo]::InvariantCulture)
    $encoding = New-Object System.Text.UTF8Encoding $false

    for ($index = 0; $index -lt 1000; $index++) {
        $suffix = if ($index -eq 0) { '' } else { '-{0:D3}' -f $index }
        $fileName = 'clipboard-{0}{1}.txt' -f $stamp, $suffix
        $path = Join-Path $DestinationFolder $fileName
        $stream = $null
        $writer = $null

        try {
            $stream = New-Object System.IO.FileStream(
                $path,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::Read
            )
            $writer = New-Object System.IO.StreamWriter($stream, $encoding)
            $writer.Write($Text)
            return $path
        }
        catch [System.IO.IOException] {
            if ([System.IO.File]::Exists($path)) {
                continue
            }
            throw
        }
        finally {
            if ($null -ne $writer) {
                $writer.Dispose()
            }
            elseif ($null -ne $stream) {
                $stream.Dispose()
            }
        }
    }

    throw 'A unique clipboard text filename could not be created.'
}

function Show-UserMessage {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [Parameter(Mandatory = $true)][string]$Title,
        [ValidateSet('Information', 'Warning', 'Error')][string]$Kind = 'Information'
    )

    $icon = switch ($Kind) {
        'Warning' { [System.Windows.Forms.MessageBoxIcon]::Warning }
        'Error' { [System.Windows.Forms.MessageBoxIcon]::Error }
        default { [System.Windows.Forms.MessageBoxIcon]::Information }
    }

    [void][System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $icon
    )
}

function Show-SavedNotification {
    param([Parameter(Mandatory = $true)][string]$Path)

    $notification = New-Object System.Windows.Forms.NotifyIcon
    try {
        $notification.Icon = [System.Drawing.SystemIcons]::Information
        $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notification.BalloonTipTitle = 'Clipboard text saved'
        $notification.BalloonTipText = Split-Path -Leaf $Path
        $notification.Visible = $true
        $notification.ShowBalloonTip(2200)
        Start-Sleep -Milliseconds 1600
    }
    finally {
        $notification.Visible = $false
        $notification.Dispose()
    }
}

$settingsDirectory = Get-SettingsDirectory
$settingsPath = Join-Path $settingsDirectory 'save-clipboard-text.json'

if ($ValidateOnly) {
    if (-not [System.IO.Path]::IsPathRooted($settingsDirectory)) {
        throw 'The settings directory did not resolve to an absolute path.'
    }
    Write-Output 'Save Clipboard Text validation passed.'
    return
}

try {
    $shiftHeld = (
        [System.Windows.Forms.Control]::ModifierKeys -band
        [System.Windows.Forms.Keys]::Shift
    ) -eq [System.Windows.Forms.Keys]::Shift
    $destinationFolder = Resolve-DestinationFolder `
        -SettingsDirectory $settingsDirectory `
        -SettingsPath $settingsPath `
        -ForcePrompt:($Configure -or $shiftHeld)
    if ([string]::IsNullOrWhiteSpace($destinationFolder)) {
        return
    }

    $clipboard = Get-ClipboardTextResult
    if (-not $clipboard.HasText) {
        Show-UserMessage `
            -Message 'The clipboard does not currently contain text. No file was created.' `
            -Title 'Save Clipboard Text' `
            -Kind Warning
        return
    }

    $savedPath = Write-TextToNewFile -DestinationFolder $destinationFolder -Text $clipboard.Text
    Write-Output $savedPath
    Show-SavedNotification -Path $savedPath
}
catch {
    $failureMessage = $_.Exception.Message
    try {
        Show-UserMessage -Message $failureMessage -Title 'Save Clipboard Text Failed' -Kind Error
    }
    catch {
        # Preserve the original failure when desktop UI itself is unavailable.
    }
    Write-Error $failureMessage
    exit 1
}
