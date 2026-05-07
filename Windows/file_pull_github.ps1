# Description: Pull the active Explorer Git repository from GitHub with fast-forward only.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ExplorerWindowInterop {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@

$repoRoot = Split-Path -Parent $PSScriptRoot
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$statusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'

function Write-Status([string]$Message) {
    $directory = Split-Path -Parent $statusPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
}

function Show-ResultMessage(
    [string]$Message,
    [string]$Title = 'GitHub Pull',
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
) {
    $suppressUi = [string][Environment]::GetEnvironmentVariable('FLOWCELL_NO_MESSAGE_BOX')
    if ($suppressUi -and $suppressUi.Trim().ToLowerInvariant() -in @('1','true','yes','on')) {
        return
    }

    try {
        [void][System.Windows.Forms.MessageBox]::Show(
            $Message,
            $Title,
            [System.Windows.Forms.MessageBoxButtons]::OK,
            $Icon
        )
    }
    catch {
    }
}

function Get-ClipboardPath {
    try {
        $clipboardText = Get-Clipboard -Raw -ErrorAction Stop
    }
    catch {
        return ''
    }

    if ([string]::IsNullOrWhiteSpace($clipboardText)) {
        return ''
    }

    $candidatePath = [string]$clipboardText
    $candidatePath = $candidatePath.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidatePath)) {
        return ''
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Container) {
        return $candidatePath
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
        return $candidatePath
    }

    return ''
}

function Get-ExplorerWindowInfo($Window) {
    try {
        if ($null -eq $Window) { return $null }
        if (-not $Window.FullName) { return $null }
        if ([System.IO.Path]::GetFileName([string]$Window.FullName).ToLowerInvariant() -ne 'explorer.exe') { return $null }

        $folderPath = ''
        try {
            $folderPath = [string]$Window.Document.Folder.Self.Path
        }
        catch {
            $folderPath = ''
        }

        $selectedPaths = @()
        try {
            foreach ($item in @($Window.Document.SelectedItems())) {
                if ($null -eq $item) { continue }
                $candidatePath = [string]$item.Path
                if ([string]::IsNullOrWhiteSpace($candidatePath)) { continue }
                if (Test-Path -LiteralPath $candidatePath) {
                    $selectedPaths += $candidatePath
                }
            }
        }
        catch {
            $selectedPaths = @()
        }

        return [pscustomobject]@{
            Hwnd          = [int64]$Window.HWND
            FolderPath    = $folderPath
            SelectedPaths = @($selectedPaths | Select-Object -Unique)
        }
    }
    catch {
        return $null
    }
}

function Get-ExplorerCandidatePath {
    $shell = New-Object -ComObject Shell.Application
    $foregroundHwnd = [int64][ExplorerWindowInterop]::GetForegroundWindow()
    $windows = @()

    foreach ($window in @($shell.Windows())) {
        $info = Get-ExplorerWindowInfo -Window $window
        if ($null -ne $info) {
            $windows += $info
        }
    }

    $preferred = @($windows | Where-Object { $_.Hwnd -eq $foregroundHwnd } | Select-Object -First 1)
    if (@($preferred).Count -eq 0) {
        $preferred = @($windows | Select-Object -First 1)
    }

    if (@($preferred).Count -eq 0) {
        return ''
    }

    $windowInfo = $preferred[0]
    if (@($windowInfo.SelectedPaths).Count -gt 0) {
        return [string]$windowInfo.SelectedPaths[0]
    }

    if (-not [string]::IsNullOrWhiteSpace([string]$windowInfo.FolderPath) -and (Test-Path -LiteralPath $windowInfo.FolderPath -PathType Container)) {
        return [string]$windowInfo.FolderPath
    }

    return ''
}

function Select-PathInteractively {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose a Git repository folder to pull from GitHub.'
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace([string]$dialog.SelectedPath)) {
        return [string]$dialog.SelectedPath
    }

    return ''
}

function Get-TargetPath {
    foreach ($envVarName in @('FLOWCELL_TARGET_REPO', 'FLOWCELL_TEST_REPO')) {
        $envPath = [string][Environment]::GetEnvironmentVariable($envVarName)
        if (-not [string]::IsNullOrWhiteSpace($envPath)) {
            return $envPath.Trim().Trim('"')
        }
    }

    $explorerPath = Get-ExplorerCandidatePath
    if (-not [string]::IsNullOrWhiteSpace($explorerPath)) {
        return $explorerPath
    }

    $clipboardPath = Get-ClipboardPath
    if (-not [string]::IsNullOrWhiteSpace($clipboardPath)) {
        return $clipboardPath
    }

    if (Test-Path -LiteralPath (Join-Path $repoRoot '.git')) {
        return $repoRoot
    }

    return (Select-PathInteractively)
}

function Get-GitExecutablePath {
    $command = Get-Command 'git.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        return [string]$command.Source
    }

    $command = Get-Command 'git' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        return [string]$command.Source
    }

    throw 'Could not locate git.'
}

function Get-RepositoryRoot([string]$CandidatePath) {
    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return ''
    }

    $currentPath = if (Test-Path -LiteralPath $CandidatePath -PathType Leaf) {
        Split-Path -Parent $CandidatePath
    }
    else {
        $CandidatePath
    }

    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        if (Test-Path -LiteralPath (Join-Path $currentPath '.git')) {
            return [System.IO.Path]::GetFullPath($currentPath)
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }
        $currentPath = $parentPath
    }

    return ''
}

function Convert-ToProcessArgument([string]$Value) {
    if ($null -eq $Value) {
        return '""'
    }

    $text = [string]$Value
    if ($text.Length -eq 0) {
        return '""'
    }

    if ($text -notmatch '[\s"]') {
        return $text
    }

    $escaped = $text -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return ('"{0}"' -f $escaped)
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $gitExe = Get-GitExecutablePath
    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = $gitExe
    $processStartInfo.WorkingDirectory = $RepositoryRoot
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.RedirectStandardOutput = $true
    $processStartInfo.RedirectStandardError = $true
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $processStartInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $processArgumentValues = @('-C', $RepositoryRoot) + @($Arguments | ForEach-Object { [string]$_ })
    $processStartInfo.Arguments = (($processArgumentValues | ForEach-Object { Convert-ToProcessArgument -Value ([string]$_) }) -join ' ')

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processStartInfo
    [void]$process.Start()
    $stdOut = $process.StandardOutput.ReadToEnd()
    $stdErr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = [int]$process.ExitCode

    $lines = @(
        @($stdOut -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) +
        @($stdErr -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    )
    $warningPatterns = @(
        "^warning: in the working copy of '.*', LF will be replaced by CRLF the next time Git touches it$",
        "^warning: in the working copy of '.*', CRLF will be replaced by LF the next time Git touches it$"
    )
    $significantLines = @(
        $lines | Where-Object {
            $line = [string]$_
            foreach ($pattern in $warningPatterns) {
                if ($line -match $pattern) {
                    return $false
                }
            }
            return $true
        }
    )
    $warningLines = @(
        $lines | Where-Object {
            $line = [string]$_
            foreach ($pattern in $warningPatterns) {
                if ($line -match $pattern) {
                    return $true
                }
            }
            return $false
        }
    )

    if (-not $AllowFailure -and $exitCode -ne 0) {
        $message = if (@($significantLines).Count -gt 0) {
            $significantLines -join [Environment]::NewLine
        }
        elseif (@($lines).Count -gt 0) {
            $lines -join [Environment]::NewLine
        }
        else {
            'Git command failed.'
        }
        throw $message
    }

    return [pscustomobject]@{
        ExitCode         = $exitCode
        Lines            = $lines
        SignificantLines = $significantLines
        WarningLines     = $warningLines
        Text             = ($significantLines -join [Environment]::NewLine)
        RawText          = ($lines -join [Environment]::NewLine)
    }
}

function Get-CurrentBranchName([string]$RepositoryRoot) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('branch', '--show-current')
    return ($result.Text.Trim())
}

function Get-OriginUrl([string]$RepositoryRoot) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('remote', 'get-url', 'origin') -AllowFailure
    if ($result.ExitCode -ne 0) {
        return ''
    }

    return ($result.Text.Trim())
}

function Get-UpstreamName([string]$RepositoryRoot) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') -AllowFailure
    if ($result.ExitCode -ne 0) {
        return ''
    }

    return ($result.Text.Trim())
}

function Get-AheadCount([string]$RepositoryRoot, [string]$UpstreamName) {
    if ([string]::IsNullOrWhiteSpace($UpstreamName)) {
        return 0
    }

    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-list', '--count', ('{0}..HEAD' -f $UpstreamName)) -AllowFailure
    if ($result.ExitCode -ne 0) {
        return 0
    }

    $count = 0
    [void][int]::TryParse($result.Text.Trim(), [ref]$count)
    return $count
}

function Get-BehindCount([string]$RepositoryRoot, [string]$UpstreamName) {
    if ([string]::IsNullOrWhiteSpace($UpstreamName)) {
        return 0
    }

    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-list', '--count', ('HEAD..{0}' -f $UpstreamName)) -AllowFailure
    if ($result.ExitCode -ne 0) {
        return 0
    }

    $count = 0
    [void][int]::TryParse($result.Text.Trim(), [ref]$count)
    return $count
}

function Get-RevisionHash([string]$RepositoryRoot, [string]$Revision) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', $Revision)
    return ($result.Text.Trim())
}

try {
    $targetPath = Get-TargetPath
    if ([string]::IsNullOrWhiteSpace($targetPath)) {
        $statusMessage = 'GitHub Pull cancelled.'
        Write-Status $statusMessage
        Show-ResultMessage -Message $statusMessage -Title 'GitHub Pull' -Icon ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }

    $repositoryRoot = Get-RepositoryRoot -CandidatePath $targetPath
    if ([string]::IsNullOrWhiteSpace($repositoryRoot)) {
        throw ('No Git repository was found at or above: {0}' -f $targetPath)
    }

    $branchName = Get-CurrentBranchName -RepositoryRoot $repositoryRoot
    if ([string]::IsNullOrWhiteSpace($branchName)) {
        throw ('Could not determine the current branch for: {0}' -f $repositoryRoot)
    }

    $originUrl = Get-OriginUrl -RepositoryRoot $repositoryRoot
    if ([string]::IsNullOrWhiteSpace($originUrl)) {
        throw ('Repository has no origin remote: {0}' -f $repositoryRoot)
    }

    $upstreamName = Get-UpstreamName -RepositoryRoot $repositoryRoot
    if ([string]::IsNullOrWhiteSpace($upstreamName)) {
        throw ('No upstream branch is configured for {0}. Use Update GitHub or set the upstream first.' -f $branchName)
    }

    $statusResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('status', '--porcelain')
    if (-not [string]::IsNullOrWhiteSpace($statusResult.Text.Trim())) {
        throw ('Repository has uncommitted changes. Commit, stash, or discard them before using GitHub Pull.{0}{0}Repository: {1}' -f [Environment]::NewLine, $repositoryRoot)
    }

    $gitWarnings = New-Object System.Collections.Generic.List[string]
    $fetchResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('fetch', '--prune', 'origin')
    foreach ($warningLine in @($fetchResult.WarningLines)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$warningLine)) {
            [void]$gitWarnings.Add([string]$warningLine)
        }
    }

    $aheadCount = Get-AheadCount -RepositoryRoot $repositoryRoot -UpstreamName $upstreamName
    $behindCount = Get-BehindCount -RepositoryRoot $repositoryRoot -UpstreamName $upstreamName
    if ($behindCount -le 0) {
        $statusLines = @(
            ('Repository: {0}' -f $repositoryRoot),
            ('Branch: {0}' -f $branchName),
            ('Remote: {0}' -f $originUrl)
        )
        if ($aheadCount -gt 0) {
            $statusLines += ('Nothing to pull. Local branch is ahead of {0} by {1} commit(s).' -f $upstreamName, $aheadCount)
        }
        else {
            $statusLines += 'GitHub is already up to date.'
        }
        if ($gitWarnings.Count -gt 0) {
            $statusLines += ('Warnings: {0}' -f (($gitWarnings | Select-Object -Unique) -join ' | '))
        }

        $statusMessage = ($statusLines -join [Environment]::NewLine)
        Write-Status $statusMessage
        Show-ResultMessage -Message $statusMessage
        exit 0
    }

    if ($aheadCount -gt 0) {
        throw ('Branch has diverged from {0}. GitHub Pull only allows fast-forward updates; rebase or merge manually first.{1}{1}Repository: {2}' -f $upstreamName, [Environment]::NewLine, $repositoryRoot)
    }

    Write-Status ('Pulling latest changes from GitHub:{0}{0}{1}{0}Branch: {2}' -f [Environment]::NewLine, $repositoryRoot, $branchName)
    $pullResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('pull', '--ff-only')
    foreach ($warningLine in @($pullResult.WarningLines)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$warningLine)) {
            [void]$gitWarnings.Add([string]$warningLine)
        }
    }

    $localHead = Get-RevisionHash -RepositoryRoot $repositoryRoot -Revision 'HEAD'
    $upstreamHead = Get-RevisionHash -RepositoryRoot $repositoryRoot -Revision $upstreamName
    if ($localHead -ne $upstreamHead) {
        throw ('Pull completed, but local HEAD does not match {0}.' -f $upstreamName)
    }

    $statusLines = @(
        ('Repository: {0}' -f $repositoryRoot),
        ('Branch: {0}' -f $branchName),
        ('Remote: {0}' -f $originUrl),
        ('Pulled: {0} commit(s) from {1}' -f $behindCount, $upstreamName),
        ('Verified: local HEAD matches {0} at {1}' -f $upstreamName, $localHead.Substring(0, [Math]::Min(8, $localHead.Length)))
    )
    if (-not [string]::IsNullOrWhiteSpace($pullResult.Text)) {
        $statusLines += ('Git: {0}' -f $pullResult.Text)
    }
    if ($gitWarnings.Count -gt 0) {
        $statusLines += ('Warnings: {0}' -f (($gitWarnings | Select-Object -Unique) -join ' | '))
    }

    $statusMessage = ($statusLines -join [Environment]::NewLine)
    Write-Status $statusMessage
    Show-ResultMessage -Message $statusMessage
    exit 0
}
catch {
    $statusMessage = $_.Exception.Message
    Write-Status $statusMessage
    Show-ResultMessage -Message $statusMessage -Title 'GitHub Pull Failed' -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
