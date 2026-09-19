<#
Purpose: On-demand, one-way download of one public GitHub program catalog.
Context: Called by an ordinary installed program-owned Update Git Scripts Button.
Inputs: PackageRoot containing updater.json, the owning program manifest and shipped baseline.
Writes: Only that manifest's Git Scripts catalog and local/catalog-updates recovery metadata.
Conflicts: Preserve unknown/local edits; recycle unchanged upstream deletions. Downloads are
staged and blob-verified from one commit. Durable backups recover an interrupted apply.
Constraints: No Git/login, setup execution, Local Scripts replacement, or manifest updates.
#>
[CmdletBinding()]
param([string]$PackageRoot = $PSScriptRoot, [switch]$ShowUi, [switch]$DefinitionsOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-CatalogPath([string]$Root, [string]$Path) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -ne $rootFull -and -not $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path escaped authorized root: $Path" }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Link/reparse point rejected: $cursor" }
        }
        $cursor = Split-Path -Parent $cursor
    }
    return $full
}

function Join-CatalogPath([string]$Root, [string]$Relative) {
    if (-not $Relative -or $Relative -match '[\\:\x00-\x1f]' -or $Relative.StartsWith('/')) { throw "Unsafe relative path: $Relative" }
    foreach ($part in $Relative.Split('/')) {
        if (-not $part -or $part -in @('.', '..', '.git') -or $part -match '[. ]$|[<>"|?*]' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw "Unsafe path component: $Relative" }
    }
    return Assert-CatalogPath $Root (Join-Path $Root $Relative)
}

function Get-CatalogHash([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Expected a regular file: $Path" }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-CatalogJson([string]$Path, $Value) {
    $temporary = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Read-CatalogMap($Value) {
    $map = @{}
    foreach ($property in $Value.PSObject.Properties) {
        if ($property.Value -notmatch '^[a-f0-9]{64}$') { throw "Invalid baseline hash: $($property.Name)" }
        if ($map.ContainsKey($property.Name)) { throw 'Case-colliding baseline paths.' }
        $map[$property.Name] = [string]$property.Value
    }
    return $map
}

function Get-CatalogContext([string]$PackageRoot) {
    $package = Assert-CatalogPath $PackageRoot $PackageRoot
    $metadataPath = Join-CatalogPath $package 'updater.json'
    $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($metadata.schemaVersion -ne 1 -or $metadata.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or -not $metadata.ref) { throw 'Invalid updater source metadata.' }
    $cursor = $package
    $program = $null
    while ($cursor) {
        if (Test-Path -LiteralPath (Join-Path $cursor 'flowcell.program.json')) { $program = $cursor; break }
        $cursor = Split-Path -Parent $cursor
    }
    if (-not $program) { throw 'Installed updater has no owning program manifest.' }
    $manifest = Get-Content -LiteralPath (Join-CatalogPath $program 'flowcell.program.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.programId -cne $metadata.programId) { throw 'Updater and owning program identities differ.' }
    $catalog = Join-CatalogPath $program ($manifest.gitScriptsFolder.Replace('\','/'))
    $localScripts = Join-CatalogPath $program ($manifest.localScriptsFolder.Replace('\','/'))
    $panels = Join-CatalogPath $program ($manifest.panelsFolder.Replace('\','/'))
    $support = Join-CatalogPath $program ($manifest.supportScriptsFolder.Replace('\','/'))
    foreach ($other in @($localScripts, $panels, $support)) {
        if ($other -eq $catalog -or $other.StartsWith($catalog+'\',[StringComparison]::OrdinalIgnoreCase) -or $catalog.StartsWith($other+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Catalog overlaps another manifest folder role.' }
    }
    [void](Assert-CatalogPath $localScripts $package)
    $relative = $package.Substring($localScripts.Length).TrimStart('\').Split('\')
    if ($relative.Count -lt 2 -or $relative[1] -ne 'source') { throw 'Run the updater from an installed Local Scripts package.' }
    $install = Get-Content -LiteralPath (Join-CatalogPath $localScripts ($relative[0]+'/flowcell.install.json')) -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($install.programId -ne $manifest.programId -or $install.ownerButtonId -ne $relative[0]) { throw 'Installed updater ownership does not match.' }
    $programs = Split-Path -Parent $program
    $homeRoot = Split-Path -Parent $programs
    $local = if ($env:FLOWCELL_LOCAL_ROOT) { $env:FLOWCELL_LOCAL_ROOT } elseif (Test-Path -LiteralPath (Join-Path $homeRoot 'flowcellbackend')) { Join-Path $homeRoot 'flowcellbackend/local' } else { $homeRoot }
    $identityBytes = [Text.Encoding]::UTF8.GetBytes($program.ToLowerInvariant())
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $key = ([BitConverter]::ToString($sha.ComputeHash($identityBytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    $state = Join-CatalogPath $local ('catalog-updates/'+$key)
    $baseline = Join-CatalogPath $support 'catalog-baseline.json'
    return @{ Program=$program; Catalog=$catalog; State=$state; Baseline=$baseline; Metadata=$metadata; ProgramId=$manifest.programId }
}

function Invoke-CatalogApi([string]$Url) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try { return Invoke-RestMethod -Uri $Url -Headers @{ 'User-Agent'='FlowCell-Catalog-Updater'; Accept='application/vnd.github+json' } -TimeoutSec 60 }
    catch { throw "GitHub request failed ($Url): $($_.Exception.Message). Public API limits may require waiting before retrying." }
}

function Get-RemoteCatalog($Metadata) {
    $api = 'https://api.github.com/repos/' + $Metadata.repository
    $commit = Invoke-CatalogApi ($api+'/commits/'+[Uri]::EscapeDataString($Metadata.ref))
    if ($commit.sha -notmatch '^[a-f0-9]{40}$') { throw 'GitHub did not resolve one immutable commit.' }
    $treeSha = $commit.commit.tree.sha
    foreach ($segment in $Metadata.catalogPath.Split('/')) {
        [void](Join-CatalogPath ([IO.Path]::GetTempPath()) $segment)
        $tree = Invoke-CatalogApi ($api+'/git/trees/'+$treeSha)
        if ($tree.truncated) { throw 'GitHub returned an incomplete path listing.' }
        $match = @($tree.tree | Where-Object { $_.path -ceq $segment -and $_.type -eq 'tree' -and $_.mode -eq '040000' })
        if ($match.Count -ne 1) { throw "Catalog path is missing or is not a directory: $segment" }
        $treeSha = $match[0].sha
    }
    $listing = Invoke-CatalogApi ($api+'/git/trees/'+$treeSha+'?recursive=1')
    if ($listing.truncated) { throw 'GitHub returned a truncated catalog; nothing was applied.' }
    $files = @{}
    foreach ($entry in $listing.tree) {
        [void](Join-CatalogPath ([IO.Path]::GetTempPath()) $entry.path)
        if ($entry.type -eq 'tree' -and $entry.mode -eq '040000') { continue }
        if ($entry.type -ne 'blob' -or $entry.mode -notin @('100644','100755') -or $entry.sha -notmatch '^[a-f0-9]{40}$') { throw "Unsupported link/submodule in catalog: $($entry.path)" }
        if ($files.ContainsKey($entry.path)) { throw 'GitHub catalog contains case-colliding paths.' }
        $files[$entry.path] = $entry
    }
    if ($files.Count -eq 0) { throw 'GitHub catalog is empty; refusing an unexpected mass deletion.' }
    return @{ Commit=$commit.sha; Files=$files }
}

function Save-CatalogDownload([string]$Url, [string]$Path, $Entry) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -Headers @{'User-Agent'='FlowCell-Catalog-Updater'} -TimeoutSec 90 | Out-Null }
    catch { throw "Download failed for $($Entry.path): $($_.Exception.Message)" }
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -ne $Entry.size) { throw "Incomplete download: $($Entry.path)" }
    $header = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
    $sha = [Security.Cryptography.SHA1]::Create()
    try { $actual = ([BitConverter]::ToString($sha.ComputeHash([byte[]]($header+$bytes)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($actual -cne $Entry.sha) { throw "Git blob hash mismatch: $($Entry.path)" }
}

function Restore-CatalogTransaction($Context, [string]$JournalPath) {
    if (-not (Test-Path -LiteralPath $JournalPath)) { return }
    $journal = Get-Content -LiteralPath $JournalPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($journal.catalog -ne $Context.Catalog -or $journal.state -ne $Context.State) { throw 'Recovery journal targets another catalog.' }
    if ($journal.phase -eq 'committed') { return }
    foreach ($change in @($journal.changes)) {
        $target = Join-CatalogPath $Context.Catalog $change.path
        $current = Get-CatalogHash $target
        if ($current -eq $change.before) { continue }
        if ($current -ne $change.after) { throw "Recovery preserved an unexpected local edit: $($change.path). Inspect $JournalPath" }
        if ($change.before) {
            $backup = Join-CatalogPath $Context.State $change.backup
            if ((Get-CatalogHash $backup) -ne $change.before) { throw 'Recovery backup is missing or damaged.' }
            [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
            $temp = $target+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
            [IO.File]::Copy($backup,$temp)
            if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temp,$target,[NullString]::Value) } else { [IO.File]::Move($temp,$target) }
        } elseif (Test-Path -LiteralPath $target) { Move-CatalogToRecycleBin $target }
    }
    # Baseline is committed last. Restore its exact previous bytes/absence as well.
    $statePath = Join-CatalogPath $Context.State 'baseline.json'
    if ($journal.baselineBackup) { [IO.File]::Copy((Join-CatalogPath $Context.State $journal.baselineBackup),$statePath,$true) }
    elseif (Test-Path -LiteralPath $statePath) { Move-CatalogToRecycleBin $statePath }
    $journal.phase = 'recovered'
    Write-CatalogJson $JournalPath $journal
}

function Move-CatalogToRecycleBin([string]$Path) {
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}

function Invoke-CatalogUpdate([string]$PackageRoot) {
    $context = Get-CatalogContext $PackageRoot
    [IO.Directory]::CreateDirectory($context.State) | Out-Null
    $lockPath = Join-CatalogPath $context.State 'update.lock'
    try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate','ReadWrite','None') }
    catch { throw 'An update for this program is already running.' }
    try {
        $journalPath = Join-CatalogPath $context.State 'transaction.json'
        Restore-CatalogTransaction $context $journalPath
        $statePath = Join-CatalogPath $context.State 'baseline.json'
        $baselinePath = if (Test-Path -LiteralPath $statePath) { $statePath } else { $context.Baseline }
        $baselineDocument = Get-Content -LiteralPath $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($baselineDocument.programId -ne $context.ProgramId) { throw 'Catalog baseline belongs to another program.' }
        $baseline = Read-CatalogMap $baselineDocument.files
        foreach ($key in @($baseline.Keys)) { [void](Join-CatalogPath $context.Catalog $key) }
        $remote = Get-RemoteCatalog $context.Metadata
        $runName = 'runs/'+[guid]::NewGuid().ToString('N')
        $runRoot = Join-CatalogPath $context.State $runName
        [IO.Directory]::CreateDirectory($runRoot) | Out-Null
        $remoteHashes = @{}
        $count = 0
        foreach ($key in @($remote.Files.Keys | Sort-Object)) {
            $stage = Join-CatalogPath $runRoot ('download/'+$key)
            [IO.Directory]::CreateDirectory((Split-Path -Parent $stage)) | Out-Null
            $remotePath = ($context.Metadata.catalogPath+'/'+$key).Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }
            $url = 'https://raw.githubusercontent.com/'+$context.Metadata.repository+'/'+$remote.Commit+'/'+($remotePath -join '/')
            Save-CatalogDownload $url $stage $remote.Files[$key]
            $remoteHashes[$key] = Get-CatalogHash $stage
            $count++
            Write-Progress -Activity 'Update Git Scripts' -Status "Downloaded $count of $($remote.Files.Count) files" -PercentComplete (100*$count/$remote.Files.Count)
        }
        $changes = @()
        $conflicts = @()
        $next = @{} + $baseline
        $keys = @(@($baseline.Keys)+@($remoteHashes.Keys) | Sort-Object -Unique)
        foreach ($key in $keys) {
            $target = Join-CatalogPath $context.Catalog $key
            $current = Get-CatalogHash $target
            $before = if ($baseline.ContainsKey($key)) { $baseline[$key] } else { '' }
            $after = if ($remoteHashes.ContainsKey($key)) { $remoteHashes[$key] } else { '' }
            if ($current -and -not $baseline.ContainsKey($key)) { $conflicts += $key; continue }
            if ($current -eq $after) { if ($after) {$next[$key]=$after} else {$next.Remove($key)}; continue }
            if ($current -ne $before) { $conflicts += $key; continue }
            $backup = $runName+'/backup/'+$key
            if ($current) {
                $backupPath = Join-CatalogPath $context.State $backup
                [IO.Directory]::CreateDirectory((Split-Path -Parent $backupPath)) | Out-Null
                [IO.File]::Copy($target,$backupPath)
                if ((Get-CatalogHash $backupPath) -ne $current) { throw "Catalog changed during backup: $key" }
            }
            $changes += @{path=$key; before=$current; after=$after; backup=$backup}
            if ($after) {$next[$key]=$after} else {$next.Remove($key)}
        }
        $baselineBackup = ''
        if (Test-Path -LiteralPath $statePath) {
            $baselineBackup = $runName+'/previous-baseline.json'
            [IO.File]::Copy($statePath,(Join-CatalogPath $context.State $baselineBackup))
        }
        $journal = @{phase='applying'; catalog=$context.Catalog; state=$context.State; changes=@($changes); baselineBackup=$baselineBackup}
        Write-CatalogJson $journalPath $journal
        try {
            foreach ($change in $changes) {
                $target = Join-CatalogPath $context.Catalog $change.path
                if ((Get-CatalogHash $target) -ne $change.before) { throw "Catalog changed during update: $($change.path)" }
                if ($change.after) {
                    $stage = Join-CatalogPath $runRoot ('download/'+$change.path)
                    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
                    if ($change.before) { [IO.File]::Replace($stage,$target,[NullString]::Value) } else { [IO.File]::Move($stage,$target) }
                } else { Move-CatalogToRecycleBin $target }
            }
            Write-CatalogJson $statePath @{schemaVersion=1; programId=$context.ProgramId; commit=$remote.Commit; files=$next}
            $journal.phase='committed'
            Write-CatalogJson $journalPath $journal
        } catch {
            $failure = $_.Exception.Message
            Restore-CatalogTransaction $context $journalPath
            throw "Update failed and the previous catalog was restored: $failure"
        }
        $result = if ($conflicts.Count) {
            "Local changes preserved ($($conflicts.Count) conflicts). Updated $($changes.Count) files. Conflicts: $($conflicts -join ', '). Downloaded alternatives and recovery: $runRoot"
        } elseif ($changes.Count) { "Updated successfully: $($changes.Count) changed/deleted files; $count files verified from commit $($remote.Commit)." }
        else { "Already up to date. $count files verified from commit $($remote.Commit)." }
        Write-CatalogJson (Join-CatalogPath $context.State 'result.json') @{programId=$context.ProgramId; message=$result; conflicts=@($conflicts); commit=$remote.Commit; completedUtc=[DateTime]::UtcNow.ToString('o')}
        return $result
    } finally { $lock.Dispose() }
}

if ($DefinitionsOnly) { return }
if (-not $ShowUi) { Invoke-CatalogUpdate $PackageRoot; return }
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object Windows.Forms.Form
$form.Text = 'Update Git Scripts'
$form.Width = 440; $form.Height = 130; $form.StartPosition='CenterScreen'
$form.ControlBox = $false
$label = New-Object Windows.Forms.Label
$label.Text = 'Downloading and validating the program catalog...'
$label.AutoSize = $true; $label.Left=16; $label.Top=16
$bar = New-Object Windows.Forms.ProgressBar
$bar.Style='Marquee'; $bar.Left=16; $bar.Top=45; $bar.Width=390
$form.Controls.Add($label); $form.Controls.Add($bar)
$form.Show()
$worker = [PowerShell]::Create()
[void]$worker.AddScript('param($helper,$root); . $helper -DefinitionsOnly; Invoke-CatalogUpdate $root').AddArgument($PSCommandPath).AddArgument($PackageRoot)
$pending = $worker.BeginInvoke()
try {
    while (-not $pending.IsCompleted) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    $messages = $worker.EndInvoke($pending)
    $result = if ($worker.HadErrors) { 'Download failed: '+($worker.Streams.Error | Out-String) } else { $messages -join "`r`n" }
} catch { $result = 'Download failed: '+$_.Exception.Message }
finally { $form.Close(); $worker.Dispose() }
[void][Windows.Forms.MessageBox]::Show($result,'Update Git Scripts')
