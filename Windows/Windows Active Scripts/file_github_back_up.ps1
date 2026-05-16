param(
    [switch]$BackgroundWorker,
    [ValidateSet('GitHub', 'FlowCell')]
    [string]$BackupFlavor = 'GitHub'
)

# Description: Trigger a background repo backup snapshot and mirror the clipboard folder into the backup root.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-BackupUiLabel([string]$Flavor) {
    if ($Flavor -eq 'FlowCell') {
        return 'FlowCell back up'
    }

    return 'GitHub back up'
}

function Get-BackupUiTitle([string]$Flavor) {
    if ($Flavor -eq 'FlowCell') {
        return 'FlowCell Back Up'
    }

    return 'GitHub Back Up'
}

function Find-FlowTestRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }
        $currentPath = $parentPath
    }

    return [System.IO.Path]::GetFullPath((Split-Path -Parent $StartPath))
}

$repoRoot = Find-FlowTestRoot -StartPath $PSScriptRoot
$flowCellLocalRoot = Join-Path $repoRoot 'FlowCell\local'
$statusPath = Join-Path $flowCellLocalRoot 'logs\last_action_status.txt'
$script:BackupUiLabel = Get-BackupUiLabel -Flavor $BackupFlavor
$script:BackupUiTitle = Get-BackupUiTitle -Flavor $BackupFlavor

function Write-Status([string]$Message) {
    $directory = Split-Path -Parent $statusPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    Set-Content -LiteralPath $statusPath -Value $Message -Encoding UTF8
}

function Show-ResultMessage(
    [string]$Message,
    [string]$Title = 'GitHub Back Up',
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

function Show-WindowsNotification(
    [string]$Message,
    [string]$Title = 'GitHub Back Up',
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
) {
    $suppressUi = [string][Environment]::GetEnvironmentVariable('FLOWCELL_NO_MESSAGE_BOX')
    if ($suppressUi -and $suppressUi.Trim().ToLowerInvariant() -in @('1','true','yes','on')) {
        return
    }

    try {
        $notifyIcon = New-Object System.Windows.Forms.NotifyIcon
        $notifyIcon.Icon = switch ($Icon) {
            ([System.Windows.Forms.MessageBoxIcon]::Error) { [System.Drawing.SystemIcons]::Error; break }
            ([System.Windows.Forms.MessageBoxIcon]::Warning) { [System.Drawing.SystemIcons]::Warning; break }
            default { [System.Drawing.SystemIcons]::Information; break }
        }
        $notifyIcon.BalloonTipIcon = switch ($Icon) {
            ([System.Windows.Forms.MessageBoxIcon]::Error) { [System.Windows.Forms.ToolTipIcon]::Error; break }
            ([System.Windows.Forms.MessageBoxIcon]::Warning) { [System.Windows.Forms.ToolTipIcon]::Warning; break }
            default { [System.Windows.Forms.ToolTipIcon]::Info; break }
        }
        $notifyIcon.BalloonTipTitle = $Title
        $balloonText = [string]$Message
        if ([string]::IsNullOrWhiteSpace($balloonText)) {
            $balloonText = $Title
        }
        $balloonText = $balloonText.Trim()
        if ($balloonText.Length -gt 240) {
            $balloonText = $balloonText.Substring(0, 237) + '...'
        }
        $notifyIcon.BalloonTipText = $balloonText
        $notifyIcon.Visible = $true
        $notifyIcon.ShowBalloonTip(5000)
        Start-Sleep -Seconds 6
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
        return
    }
    catch {
        Show-ResultMessage -Message $Message -Title $Title -Icon $Icon
    }
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

function Get-WindowsPowerShellPath {
    $command = Get-Command 'powershell.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        return [string]$command.Source
    }

    $fallback = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (Test-Path -LiteralPath $fallback -PathType Leaf) {
        return $fallback
    }

    throw 'Could not locate powershell.exe.'
}

function Start-BackgroundBackup {
    $scriptPath = [string]$PSCommandPath
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw 'Could not determine the current script path for background launch.'
    }

    $powershellExe = Get-WindowsPowerShellPath
    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = $powershellExe
    $processStartInfo.WorkingDirectory = Split-Path -Parent $scriptPath
    $processStartInfo.UseShellExecute = $true
    $processStartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $processStartInfo.Arguments = ((@(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $scriptPath,
        '-BackgroundWorker',
        '-BackupFlavor',
        $BackupFlavor
    ) | ForEach-Object { Convert-ToProcessArgument -Value ([string]$_) }) -join ' ')

    [void][System.Diagnostics.Process]::Start($processStartInfo)
}

function Invoke-Process {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [string]$FailureLabel = 'Process failed.',
        [switch]$AllowFailure
    )

    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = $FilePath
    $processStartInfo.WorkingDirectory = $WorkingDirectory
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.RedirectStandardOutput = $true
    $processStartInfo.RedirectStandardError = $true
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $processStartInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $processStartInfo.Arguments = (($Arguments | ForEach-Object { Convert-ToProcessArgument -Value ([string]$_) }) -join ' ')

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processStartInfo
    [void]$process.Start()
    $stdOutTask = $process.StandardOutput.ReadToEndAsync()
    $stdErrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    [void]$stdOutTask.Wait()
    [void]$stdErrTask.Wait()

    $stdOut = [string]$stdOutTask.Result
    $stdErr = [string]$stdErrTask.Result
    $exitCode = [int]$process.ExitCode
    $lines = @(
        @($stdOut -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) +
        @($stdErr -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    )

    if (-not $AllowFailure -and $exitCode -ne 0) {
        if (@($lines).Count -gt 0) {
            throw ($lines -join [Environment]::NewLine)
        }
        throw $FailureLabel
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Lines    = $lines
        Text     = ($lines -join [Environment]::NewLine)
    }
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

function Get-RobocopyExecutablePath {
    $command = Get-Command 'robocopy.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        return [string]$command.Source
    }

    $fallback = Join-Path $env:WINDIR 'System32\robocopy.exe'
    if (Test-Path -LiteralPath $fallback -PathType Leaf) {
        return $fallback
    }

    throw 'Could not locate robocopy.exe.'
}

function Get-NormalizedFullPath([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.Length -gt 3) {
        return $fullPath.TrimEnd('\')
    }

    return $fullPath
}

function Resolve-FolderCandidate([string]$PathText) {
    if ([string]::IsNullOrWhiteSpace($PathText)) {
        return ''
    }

    $candidatePath = [string]$PathText
    $candidatePath = $candidatePath.Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($candidatePath)) {
        return ''
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Container) {
        return (Get-NormalizedFullPath -Path $candidatePath)
    }

    if (Test-Path -LiteralPath $candidatePath -PathType Leaf) {
        return (Get-NormalizedFullPath -Path (Split-Path -Parent $candidatePath))
    }

    return ''
}

function Add-UniquePath([System.Collections.Generic.List[string]]$Collection, [string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }

    foreach ($existing in $Collection) {
        if ([string]::Equals([string]$existing, [string]$Path, [System.StringComparison]::OrdinalIgnoreCase)) {
            return
        }
    }

    [void]$Collection.Add($Path)
}

function Convert-TextToFolderCandidates([string]$Text) {
    $results = New-Object 'System.Collections.Generic.List[string]'
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @()
    }

    foreach ($line in @($Text -split "(`r`n|`n|`r)")) {
        $resolvedPath = Resolve-FolderCandidate -PathText ([string]$line)
        Add-UniquePath -Collection $results -Path $resolvedPath
    }

    return @($results)
}

function Get-ClipboardFolderCandidates {
    $results = New-Object 'System.Collections.Generic.List[string]'

    try {
        foreach ($path in @(Get-Clipboard -Format FileDropList -ErrorAction Stop)) {
            $resolvedPath = Resolve-FolderCandidate -PathText ([string]$path)
            Add-UniquePath -Collection $results -Path $resolvedPath
        }
    }
    catch {
    }

    try {
        $clipboardText = Get-Clipboard -Raw -ErrorAction Stop
        foreach ($path in @(Convert-TextToFolderCandidates -Text $clipboardText)) {
            Add-UniquePath -Collection $results -Path $path
        }
    }
    catch {
    }

    return @($results)
}

function Select-SourceFolderInteractively {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Choose a folder to back up.'
    $dialog.ShowNewFolderButton = $false
    $dialog.UseDescriptionForTitle = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace([string]$dialog.SelectedPath)) {
        return (Get-NormalizedFullPath -Path $dialog.SelectedPath)
    }

    return ''
}

function Get-RequestedSourceFolders {
    foreach ($envVarName in @('FLOWCELL_GITHUB_BACKUP_SOURCE', 'FLOWCELL_TARGET_REPO', 'FLOWCELL_TEST_REPO')) {
        $envPathText = [string][Environment]::GetEnvironmentVariable($envVarName)
        if (-not [string]::IsNullOrWhiteSpace($envPathText)) {
            $resolvedPaths = @(Convert-TextToFolderCandidates -Text $envPathText)
            if (@($resolvedPaths).Count -gt 0) {
                return $resolvedPaths
            }
        }
    }

    $clipboardPaths = @(Get-ClipboardFolderCandidates)
    if (@($clipboardPaths).Count -gt 0) {
        return $clipboardPaths
    }

    $interactivePath = Select-SourceFolderInteractively
    if (-not [string]::IsNullOrWhiteSpace($interactivePath)) {
        return @($interactivePath)
    }

    return @()
}

function Get-BackupRoot {
    $envPath = [string][Environment]::GetEnvironmentVariable('FLOWCELL_GITHUB_BACKUP_ROOT')
    if (-not [string]::IsNullOrWhiteSpace($envPath)) {
        return (Get-NormalizedFullPath -Path $envPath.Trim().Trim('"'))
    }

    return 'D:\Backups\GitHub'
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
            return (Get-NormalizedFullPath -Path $currentPath)
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }
        $currentPath = $parentPath
    }

    return ''
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
    return (Invoke-Process -FilePath $gitExe -WorkingDirectory $RepositoryRoot -Arguments (@('-C', $RepositoryRoot) + @($Arguments | ForEach-Object { [string]$_ })) -FailureLabel 'Git command failed.' -AllowFailure:$AllowFailure)
}

function Test-IsSameOrChildPath([string]$Path, [string]$PossibleAncestor) {
    $normalizedPath = Get-NormalizedFullPath -Path $Path
    $normalizedAncestor = Get-NormalizedFullPath -Path $PossibleAncestor
    if ([string]::Equals($normalizedPath, $normalizedAncestor, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }

    return $normalizedPath.StartsWith(($normalizedAncestor + '\'), [System.StringComparison]::OrdinalIgnoreCase)
}

function New-ExternalBackupItem(
    [string]$RepositoryRoot,
    [string]$SourcePath,
    [string]$RelativeBackupPath,
    [string]$Label
) {
    if ([string]::IsNullOrWhiteSpace($SourcePath)) {
        return $null
    }

    $normalizedSourcePath = Get-NormalizedFullPath -Path $SourcePath
    if (Test-IsSameOrChildPath -Path $normalizedSourcePath -PossibleAncestor $RepositoryRoot) {
        return $null
    }

    return [pscustomobject]@{
        SourcePath          = $normalizedSourcePath
        RelativeBackupPath  = $RelativeBackupPath
        Label               = $Label
        Exists              = (Test-Path -LiteralPath $normalizedSourcePath -PathType Leaf)
    }
}

function Get-FlowCellExternalBackupItems([string]$RepositoryRoot, [string]$BackupDateLabel) {
    if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
        return @()
    }

    $localConfigPath = Join-Path $RepositoryRoot 'FlowCell\local\private\blender.config.local.json'
    if (-not (Test-Path -LiteralPath $localConfigPath -PathType Leaf)) {
        return @()
    }

    try {
        $localConfig = Get-Content -LiteralPath $localConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw ('Could not read Blender local config: {0}' -f $localConfigPath)
    }

    $automation = $localConfig.automation
    if ($null -eq $automation) {
        return @()
    }

    $bridgeFolderText = [string]$automation.bridgeFolder
    if ([string]::IsNullOrWhiteSpace($bridgeFolderText)) {
        return @()
    }

    $bridgeFolder = Get-NormalizedFullPath -Path $bridgeFolderText
    $addonsRoot = Get-NormalizedFullPath -Path (Split-Path -Parent $bridgeFolder)
    $blenderBundleRoot = 'Blender\Blender Scripts\blender addons{0}' -f $BackupDateLabel
    $items = @()
    $candidates = @(
        [pscustomobject]@{
            Path = Join-Path $addonsRoot ([string]$automation.addonActionsFileName)
            Relative = $blenderBundleRoot + '\' + [string]$automation.addonActionsFileName
            Label = 'Blender add-on actions'
        },
        [pscustomobject]@{
            Path = Join-Path $addonsRoot ([string]$automation.addonBridgeFileName)
            Relative = $blenderBundleRoot + '\' + [string]$automation.addonBridgeFileName
            Label = 'Blender add-on bridge'
        },
        [pscustomobject]@{
            Path = Join-Path $bridgeFolder ([string]$automation.customActionsFileName)
            Relative = $blenderBundleRoot + '\blender_bridge_flowtest\' + [string]$automation.customActionsFileName
            Label = 'Blender custom action registry'
        },
        [pscustomobject]@{
            Path = Join-Path $bridgeFolder ([string]$automation.setupStatusFileName)
            Relative = $blenderBundleRoot + '\blender_bridge_flowtest\' + [string]$automation.setupStatusFileName
            Label = 'Blender bridge setup state'
        },
        [pscustomobject]@{
            Path = Join-Path $bridgeFolder 'flowtest_bridge_runtime_status.json'
            Relative = $blenderBundleRoot + '\blender_bridge_flowtest\flowtest_bridge_runtime_status.json'
            Label = 'Blender bridge runtime status'
        }
    )

    foreach ($candidate in $candidates) {
        $item = New-ExternalBackupItem -RepositoryRoot $RepositoryRoot -SourcePath ([string]$candidate.Path) -RelativeBackupPath ([string]$candidate.Relative) -Label ([string]$candidate.Label)
        if ($null -ne $item) {
            $items += $item
        }
    }

    return @($items)
}

function Copy-ExternalBackupItem([string]$DestinationRoot, [object]$Item) {
    $destinationPath = Join-Path $DestinationRoot ([string]$Item.RelativeBackupPath)
    $destinationDirectory = Split-Path -Parent $destinationPath
    if (-not (Test-Path -LiteralPath $destinationDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    Copy-Item -LiteralPath ([string]$Item.SourcePath) -Destination $destinationPath -Force
    return $destinationPath
}

function Test-GitBranchExists([string]$RepositoryRoot, [string]$BranchName) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('show-ref', '--verify', '--quiet', ('refs/heads/{0}' -f $BranchName)) -AllowFailure
    return ($result.ExitCode -eq 0)
}

function Get-BackupSnapshotBranchName([string]$RepositoryRoot, [string]$Stamp) {
    $baseName = 'codex/backup-snapshot-{0}' -f $Stamp
    $candidateName = $baseName
    $suffix = 2
    while (Test-GitBranchExists -RepositoryRoot $RepositoryRoot -BranchName $candidateName) {
        $candidateName = '{0}-{1:00}' -f $baseName, $suffix
        $suffix++
    }

    return $candidateName
}

function Get-CurrentGitRef([string]$RepositoryRoot) {
    $result = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', '--abbrev-ref', 'HEAD')
    return $result.Text.Trim()
}

function New-GitBackupSnapshot([string]$RepositoryRoot, [string]$Stamp) {
    $startingRef = Get-CurrentGitRef -RepositoryRoot $RepositoryRoot
    $headResult = Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('rev-parse', 'HEAD') -AllowFailure
    if ($headResult.ExitCode -ne 0) {
        throw 'Git backup snapshot skipped because the repository does not have a committed HEAD yet.'
    }

    $commitHash = $headResult.Text.Trim()
    $branchName = Get-BackupSnapshotBranchName -RepositoryRoot $RepositoryRoot -Stamp $Stamp
    [void](Invoke-Git -RepositoryRoot $RepositoryRoot -Arguments @('branch', $branchName, $commitHash))

    return [pscustomobject]@{
        BranchName = $branchName
        CommitHash = $commitHash
        StartingRef = $startingRef
    }
}

function Get-SafeLeafName([string]$Path) {
    $trimmedPath = (Get-NormalizedFullPath -Path $Path)
    $leafName = Split-Path -Leaf $trimmedPath
    if ([string]::IsNullOrWhiteSpace($leafName) -and $trimmedPath -match '^[A-Za-z]:\\?$') {
        $leafName = $trimmedPath.Substring(0, 1)
    }
    if ([string]::IsNullOrWhiteSpace($leafName)) {
        $leafName = 'backup'
    }

    $invalidChars = [System.IO.Path]::GetInvalidFileNameChars()
    foreach ($invalidChar in $invalidChars) {
        $leafName = $leafName.Replace([string]$invalidChar, '_')
    }

    return $leafName
}

function Get-UniqueDestinationPath([string]$BackupRoot, [string]$LeafName, [string]$Stamp) {
    $basePath = Join-Path $BackupRoot ('{0}_{1}' -f $LeafName, $Stamp)
    if (-not (Test-Path -LiteralPath $basePath)) {
        return $basePath
    }

    $suffix = 2
    while ($true) {
        $candidatePath = Join-Path $BackupRoot ('{0}_{1}_{2:00}' -f $LeafName, $Stamp, $suffix)
        if (-not (Test-Path -LiteralPath $candidatePath)) {
            return $candidatePath
        }
        $suffix++
    }
}

function Invoke-RobocopyMirror([string]$SourcePath, [string]$DestinationPath) {
    $robocopyExe = Get-RobocopyExecutablePath
    $result = Invoke-Process -FilePath $robocopyExe -WorkingDirectory $SourcePath -Arguments @(
        $SourcePath,
        $DestinationPath,
        '/MIR',
        '/XJ',
        '/R:1',
        '/W:1',
        '/NP',
        '/NFL',
        '/NDL'
    ) -FailureLabel 'RoboCopy failed.' -AllowFailure

    if ($result.ExitCode -ge 8) {
        if (@($result.Lines).Count -gt 0) {
            throw ((@($result.Lines | Select-Object -Last 12)) -join [Environment]::NewLine)
        }
        throw ('RoboCopy failed with exit code {0}.' -f $result.ExitCode)
    }

    return $result
}

function Resolve-BackupSources([string[]]$RequestedFolders) {
    $results = @()
    foreach ($requestedFolder in @($RequestedFolders)) {
        $normalizedRequestedFolder = Resolve-FolderCandidate -PathText $requestedFolder
        if ([string]::IsNullOrWhiteSpace($normalizedRequestedFolder)) {
            continue
        }

        $repositoryRoot = Get-RepositoryRoot -CandidatePath $normalizedRequestedFolder
        $sourcePath = if (-not [string]::IsNullOrWhiteSpace($repositoryRoot)) {
            $repositoryRoot
        }
        else {
            $normalizedRequestedFolder
        }

        $alreadyAdded = $false
        foreach ($existing in $results) {
            if ([string]::Equals([string]$existing.SourcePath, [string]$sourcePath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $alreadyAdded = $true
                break
            }
        }
        if ($alreadyAdded) {
            continue
        }

        $results += [pscustomobject]@{
            RequestedPath = $normalizedRequestedFolder
            SourcePath    = $sourcePath
            IsGitRepo     = -not [string]::IsNullOrWhiteSpace($repositoryRoot)
            RepositoryRoot = $repositoryRoot
        }
    }

    return @($results)
}

function Get-CompletionNotificationText([object[]]$Results, [bool]$HasIssues) {
    $lines = @()
    if ($HasIssues) {
        $lines += ('{0} finished with issues.' -f $script:BackupUiLabel)
    }
    else {
        $lines += ('{0} completed.' -f $script:BackupUiLabel)
    }

    if (@($Results).Count -eq 1) {
        $result = $Results[0]
        if (-not [string]::IsNullOrWhiteSpace([string]$result.BackupPath)) {
            $lines += ('Backup: {0}' -f (Split-Path -Leaf ([string]$result.BackupPath)))
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$result.GitBranchName)) {
            $lines += ('Snapshot: {0}' -f [string]$result.GitBranchName)
        }
        if ($BackupFlavor -eq 'FlowCell' -and @($result.ExternalBackupPaths).Count -gt 0) {
            $lines += ('Extras: {0} file(s)' -f @($result.ExternalBackupPaths).Count)
        }
    }
    elseif (@($Results).Count -gt 1) {
        $lines += ('Processed: {0} folder(s)' -f @($Results).Count)
    }

    return ($lines -join [Environment]::NewLine)
}

if (-not $BackgroundWorker) {
    try {
        Start-BackgroundBackup
        $statusMessage = ('{0} started in the background. Windows will notify you when it finishes.' -f $script:BackupUiLabel)
        Write-Status $statusMessage
        exit 0
    }
    catch {
        $statusMessage = $_.Exception.Message
        Write-Status $statusMessage
        Show-ResultMessage -Message $statusMessage -Title ($script:BackupUiTitle + ' Failed') -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
        exit 1
    }
}

try {
    $requestedFolders = @(Get-RequestedSourceFolders)
    if (@($requestedFolders).Count -eq 0) {
        $statusMessage = ('{0} cancelled. Copy a folder path to the clipboard first, or choose one when prompted.' -f $script:BackupUiLabel)
        Write-Status $statusMessage
        Show-WindowsNotification -Message $statusMessage -Title ($script:BackupUiTitle + ' Cancelled') -Icon ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }

    $backupRoot = Get-BackupRoot
    if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    }

    $sourceRecords = @(Resolve-BackupSources -RequestedFolders $requestedFolders)
    if (@($sourceRecords).Count -eq 0) {
        $statusMessage = 'No valid folders were found in the clipboard or override values.'
        Write-Status $statusMessage
        Show-WindowsNotification -Message $statusMessage -Title ($script:BackupUiTitle + ' Failed') -Icon ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }

    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
    $backupDateLabel = Get-Date -Format 'M-d-yyyy'
    $results = @()
    $failures = @()

    foreach ($sourceRecord in $sourceRecords) {
        $sourcePath = [string]$sourceRecord.SourcePath
        $destinationPath = Get-UniqueDestinationPath -BackupRoot $backupRoot -LeafName (Get-SafeLeafName -Path $sourcePath) -Stamp $stamp

        if (Test-IsSameOrChildPath -Path $destinationPath -PossibleAncestor $sourcePath) {
            throw ('Backup root must stay outside the source folder: {0}' -f $sourcePath)
        }
        if (Test-IsSameOrChildPath -Path $sourcePath -PossibleAncestor $backupRoot) {
            throw ('Refusing to back up a folder that is already inside the backup root: {0}' -f $sourcePath)
        }

        Write-Status ('Creating {0} for:{1}{1}{2}' -f $script:BackupUiLabel, [Environment]::NewLine, $sourcePath)

        $gitResult = $null
        $gitError = ''
        if ($sourceRecord.IsGitRepo) {
            try {
                $gitResult = New-GitBackupSnapshot -RepositoryRoot ([string]$sourceRecord.RepositoryRoot) -Stamp $stamp
            }
            catch {
                $gitError = $_.Exception.Message
                $failures += ('Git backup snapshot failed for {0}: {1}' -f $sourcePath, $gitError)
            }
        }

        $copyResult = $null
        $copyError = ''
        try {
            $copyResult = Invoke-RobocopyMirror -SourcePath $sourcePath -DestinationPath $destinationPath
        }
        catch {
            $copyError = $_.Exception.Message
            $failures += ('RoboCopy failed for {0}: {1}' -f $sourcePath, $copyError)
        }

        $externalBackupPaths = @()
        $externalBackupErrors = @()
        if ($BackupFlavor -eq 'FlowCell' -and $sourceRecord.IsGitRepo) {
            try {
                $externalItems = @(Get-FlowCellExternalBackupItems -RepositoryRoot ([string]$sourceRecord.RepositoryRoot) -BackupDateLabel $backupDateLabel)
            }
            catch {
                $externalItems = @()
                $externalBackupErrors += $_.Exception.Message
                $failures += ('External backup discovery failed for {0}: {1}' -f $sourcePath, $_.Exception.Message)
            }

            foreach ($externalItem in @($externalItems)) {
                if (-not [bool]$externalItem.Exists) {
                    $missingMessage = ('Missing {0}: {1}' -f [string]$externalItem.Label, [string]$externalItem.SourcePath)
                    $externalBackupErrors += $missingMessage
                    $failures += ('External backup file missing for {0}: {1}' -f $sourcePath, [string]$externalItem.SourcePath)
                    continue
                }

                try {
                    $externalBackupPaths += (Copy-ExternalBackupItem -DestinationRoot $destinationPath -Item $externalItem)
                }
                catch {
                    $copyMessage = ('Failed to copy {0}: {1}' -f [string]$externalItem.Label, $_.Exception.Message)
                    $externalBackupErrors += $copyMessage
                    $failures += ('External backup copy failed for {0}: {1}' -f $sourcePath, $copyMessage)
                }
            }
        }

        $results += [pscustomobject]@{
            SourcePath       = $sourcePath
            BackupPath       = $destinationPath
            IsGitRepo        = [bool]$sourceRecord.IsGitRepo
            GitBranchName    = if ($null -ne $gitResult) { [string]$gitResult.BranchName } else { '' }
            GitCommitHash    = if ($null -ne $gitResult) { [string]$gitResult.CommitHash } else { '' }
            GitStartingRef   = if ($null -ne $gitResult) { [string]$gitResult.StartingRef } else { '' }
            GitError         = $gitError
            RoboCopyExitCode = if ($null -ne $copyResult) { [int]$copyResult.ExitCode } else { -1 }
            CopyError        = $copyError
            ExternalBackupPaths = @($externalBackupPaths)
            ExternalBackupErrors = @($externalBackupErrors)
        }
    }

    $summaryLines = @(
        ('Backup root: {0}' -f $backupRoot)
    )

    foreach ($result in $results) {
        $summaryLines += ''
        $summaryLines += ('Source: {0}' -f [string]$result.SourcePath)
        $summaryLines += ('Backup: {0}' -f [string]$result.BackupPath)
        if ($result.IsGitRepo) {
            if (-not [string]::IsNullOrWhiteSpace([string]$result.GitBranchName)) {
                $shortHash = [string]$result.GitCommitHash
                if ($shortHash.Length -gt 8) {
                    $shortHash = $shortHash.Substring(0, 8)
                }
                $summaryLines += ('Git backup snapshot: {0} from {1} @ {2} (current branch unchanged)' -f [string]$result.GitBranchName, [string]$result.GitStartingRef, $shortHash)
            }
            else {
                $summaryLines += ('Git backup snapshot: failed - {0}' -f [string]$result.GitError)
            }
        }
        else {
            $summaryLines += 'Git backup snapshot: skipped (no repository found above the selected folder)'
        }

        if ([string]::IsNullOrWhiteSpace([string]$result.CopyError)) {
            $summaryLines += ('RoboCopy: completed (exit code {0})' -f [int]$result.RoboCopyExitCode)
        }
        else {
            $summaryLines += ('RoboCopy: failed - {0}' -f [string]$result.CopyError)
        }

        if ($BackupFlavor -eq 'FlowCell') {
            if (@($result.ExternalBackupPaths).Count -gt 0) {
                $summaryLines += ('External support files: {0} copied' -f @($result.ExternalBackupPaths).Count)
                foreach ($externalBackupPath in @($result.ExternalBackupPaths)) {
                    $summaryLines += ('External: {0}' -f [string]$externalBackupPath)
                }
            }
            elseif (@($result.ExternalBackupErrors).Count -gt 0) {
                $summaryLines += 'External support files: incomplete'
                foreach ($externalBackupError in @($result.ExternalBackupErrors)) {
                    $summaryLines += ('External: {0}' -f [string]$externalBackupError)
                }
            }
            else {
                $summaryLines += 'External support files: none detected for this source'
            }
        }
    }

    if (@($failures).Count -gt 0) {
        $summaryLines += ''
        $summaryLines += 'Completed with issues:'
        foreach ($failure in $failures) {
            $summaryLines += [string]$failure
        }

        $statusMessage = $summaryLines -join [Environment]::NewLine
        Write-Status $statusMessage
        $notificationText = Get-CompletionNotificationText -Results $results -HasIssues $true
        Show-WindowsNotification -Message $notificationText -Title ($script:BackupUiTitle + ' Partial') -Icon ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 1
    }

    $summaryLines += ''
    $summaryLines += ('{0} completed.' -f $script:BackupUiLabel)
    $statusMessage = $summaryLines -join [Environment]::NewLine
    Write-Status $statusMessage
    $notificationText = Get-CompletionNotificationText -Results $results -HasIssues $false
    Show-WindowsNotification -Message $notificationText -Title $script:BackupUiTitle
    exit 0
}
catch {
    $statusMessage = $_.Exception.Message
    Write-Status $statusMessage
    Show-WindowsNotification -Message $statusMessage -Title ($script:BackupUiTitle + ' Failed') -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
