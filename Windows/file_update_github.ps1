# Description: Runs update github.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
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
    [string]$Title = 'Update GitHub',
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

function Show-TopMostTextPrompt(
    [string]$Title,
    [string]$Prompt,
    [string]$DefaultValue = '',
    [string]$OkText = 'OK',
    [string]$CancelText = 'Cancel'
) {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = $Title
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.Size = New-Object System.Drawing.Size(640, 220)
    $form.MinimumSize = New-Object System.Drawing.Size(520, 220)
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ShowInTaskbar = $true
    $form.TopMost = $true
    $form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

    $promptLabel = New-Object System.Windows.Forms.Label
    $promptLabel.AutoSize = $false
    $promptLabel.Location = New-Object System.Drawing.Point(12, 12)
    $promptLabel.Size = New-Object System.Drawing.Size(600, 58)
    $promptLabel.Text = $Prompt

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point(12, 78)
    $textBox.Size = New-Object System.Drawing.Size(600, 28)
    $textBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
    $textBox.Text = [string]$DefaultValue

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = $OkText
    $okButton.Size = New-Object System.Drawing.Size(100, 32)
    $okButton.Location = New-Object System.Drawing.Point(402, 126)
    $okButton.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Right
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = $CancelText
    $cancelButton.Size = New-Object System.Drawing.Size(100, 32)
    $cancelButton.Location = New-Object System.Drawing.Point(512, 126)
    $cancelButton.Anchor = [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Right
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $form.Controls.Add($promptLabel)
    $form.Controls.Add($textBox)
    $form.Controls.Add($okButton)
    $form.Controls.Add($cancelButton)
    $form.AcceptButton = $okButton
    $form.CancelButton = $cancelButton

    $form.Add_Shown({
        $form.Activate()
        $textBox.Focus()
        $textBox.SelectAll()
    })

    $dialogResult = $form.ShowDialog()
    if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
        return $null
    }

    return [string]$textBox.Text
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
    $dialog.Description = 'Choose a Git repository folder to update on GitHub.'
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

function Get-HeadCommitHash([string]$RepositoryRoot) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', 'HEAD')
    return ($result.Text.Trim())
}

function Get-RemoteBranchCommitHash([string]$RepositoryRoot, [string]$RemoteName, [string]$BranchName) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('ls-remote', '--heads', $RemoteName, $BranchName) -AllowFailure
    if ($result.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($result.RawText.Trim())) {
        return ''
    }

    $line = @($result.RawText -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -First 1)
    if (@($line).Count -eq 0) {
        return ''
    }

    return (([string]$line[0]).Split("`t")[0].Trim())
}

function Get-CommitMessage([string]$RepositoryRoot, [string]$BranchName) {
    $envCommitMessage = [string][Environment]::GetEnvironmentVariable('FLOWCELL_COMMIT_MESSAGE')
    if (-not [string]::IsNullOrWhiteSpace($envCommitMessage)) {
        return $envCommitMessage.Trim()
    }

    $repoName = Split-Path -Leaf $RepositoryRoot
    $defaultMessage = 'Update {0} ({1}) {2}' -f $repoName, $BranchName, (Get-Date -Format 'yyyy-MM-dd HH:mm')
    Write-Status ('Waiting for commit message for:{0}{0}{1}' -f [Environment]::NewLine, $RepositoryRoot)
    $message = Show-TopMostTextPrompt `
        -Title 'Update GitHub' `
        -Prompt ('Commit message for {0}:{1}{1}{2}' -f $repoName, [Environment]::NewLine, $RepositoryRoot) `
        -DefaultValue $defaultMessage `
        -OkText 'Commit and Push' `
        -CancelText 'Cancel'
    if ($null -eq $message) {
        Write-Status ('Update GitHub cancelled for {0}.' -f $RepositoryRoot)
        return $null
    }

    $message = $message.Trim()
    if ([string]::IsNullOrWhiteSpace($message)) {
        Write-Status ('Update GitHub cancelled for {0}.' -f $RepositoryRoot)
        return $null
    }

    Write-Status ('Committing and pushing:{0}{0}{1}{0}Branch: {2}' -f [Environment]::NewLine, $RepositoryRoot, $BranchName)
    return $message
}

try {
    $targetPath = Get-TargetPath
    if ([string]::IsNullOrWhiteSpace($targetPath)) {
        $statusMessage = 'Update GitHub cancelled.'
        Write-Status $statusMessage
        Show-ResultMessage -Message $statusMessage -Title 'Update GitHub' -Icon ([System.Windows.Forms.MessageBoxIcon]::Warning)
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

    $statusResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('status', '--porcelain')
    $hasWorkingChanges = -not [string]::IsNullOrWhiteSpace($statusResult.Text.Trim())
    $commitCreated = $false
    $commitMessage = ''
    $gitWarnings = New-Object System.Collections.Generic.List[string]

    if ($hasWorkingChanges) {
        $commitMessage = Get-CommitMessage -RepositoryRoot $repositoryRoot -BranchName $branchName
        if ([string]::IsNullOrWhiteSpace($commitMessage)) {
            Write-Status ('Update GitHub cancelled for {0}.' -f $repositoryRoot)
            exit 1
        }

        $addResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('add', '-A')
        foreach ($warningLine in @($addResult.WarningLines)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$warningLine)) {
                [void]$gitWarnings.Add([string]$warningLine)
            }
        }
        $commitResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('commit', '-m', $commitMessage) -AllowFailure
        foreach ($warningLine in @($commitResult.WarningLines)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$warningLine)) {
                [void]$gitWarnings.Add([string]$warningLine)
            }
        }
        if ($commitResult.ExitCode -ne 0) {
            if ($commitResult.RawText -match 'nothing to commit') {
                $hasWorkingChanges = $false
            }
            else {
                throw $(if (-not [string]::IsNullOrWhiteSpace($commitResult.Text)) { $commitResult.Text } else { $commitResult.RawText })
            }
        }
        else {
            $commitCreated = $true
        }
    }

    $upstreamName = Get-UpstreamName -RepositoryRoot $repositoryRoot
    $aheadCount = Get-AheadCount -RepositoryRoot $repositoryRoot -UpstreamName $upstreamName
    if (-not $commitCreated -and -not $hasWorkingChanges -and $aheadCount -le 0) {
        $statusMessage = (
            @(
                ('Repository: {0}' -f $repositoryRoot),
                ('Branch: {0}' -f $branchName),
                'GitHub is already up to date.'
            ) -join [Environment]::NewLine
        )
        Write-Status $statusMessage
        Show-ResultMessage -Message $statusMessage
        exit 0
    }

    if ([string]::IsNullOrWhiteSpace($upstreamName)) {
        $pushResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('push', '-u', 'origin', $branchName)
    }
    else {
        $pushResult = Invoke-Git -RepositoryRoot $repositoryRoot -Arguments @('push')
    }
    foreach ($warningLine in @($pushResult.WarningLines)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$warningLine)) {
            [void]$gitWarnings.Add([string]$warningLine)
        }
    }

    $localHead = Get-HeadCommitHash -RepositoryRoot $repositoryRoot
    $remoteHead = Get-RemoteBranchCommitHash -RepositoryRoot $repositoryRoot -RemoteName 'origin' -BranchName $branchName
    if ([string]::IsNullOrWhiteSpace($remoteHead)) {
        throw ('Push completed, but remote verification failed for origin/{0}.' -f $branchName)
    }
    if ($remoteHead -ne $localHead) {
        throw ('Push completed, but origin/{0} does not match local HEAD.' -f $branchName)
    }

    $statusLines = @(
        ('Repository: {0}' -f $repositoryRoot),
        ('Branch: {0}' -f $branchName),
        ('Remote: {0}' -f $originUrl),
        ('Verified: origin/{0} matches local HEAD {1}' -f $branchName, $localHead.Substring(0, [Math]::Min(8, $localHead.Length)))
    )
    if ($commitCreated) {
        $statusLines += ('Committed: {0}' -f $commitMessage)
    }
    else {
        $statusLines += 'Committed: no new commit'
    }
    $statusLines += 'Pushed to GitHub.'
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
    Show-ResultMessage -Message $statusMessage -Title 'Update GitHub Failed' -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
