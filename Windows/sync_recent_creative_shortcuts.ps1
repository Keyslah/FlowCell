# Description: Runs sync recent creative shortcuts.
param(
    [switch]$Once,
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = 'Stop'

$defaultRecentRoot = Join-Path $HOME 'FlowCellRecent'
$rootPath = if (-not [string]::IsNullOrWhiteSpace($env:FLOWCELL_RECENT_ROOT)) { $env:FLOWCELL_RECENT_ROOT } else { $defaultRecentRoot }
$livePath = Join-Path $rootPath 'live'
$assetsPath = Join-Path $rootPath 'assets'
$mutexName = 'RecentCreativeShortcutsSync'
$userRoot = $HOME
$projectsRoot = if (-not [string]::IsNullOrWhiteSpace($env:FLOWCELL_RECENT_PROJECTS_ROOT)) { $env:FLOWCELL_RECENT_PROJECTS_ROOT } else { (Join-Path $HOME 'Documents') }
$modelsRoot = if (-not [string]::IsNullOrWhiteSpace($env:FLOWCELL_RECENT_MODELS_ROOT)) { $env:FLOWCELL_RECENT_MODELS_ROOT } else { (Join-Path $HOME 'Desktop') }
$watchRoots = @(
    $projectsRoot,
    $modelsRoot,
    $userRoot
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
$excludedRoots = @(
    $rootPath,
    (Join-Path $userRoot 'AppData')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

$liveExtensions = @('.ai', '.psd', '.blend')
$assetExtensions = @(
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp',
    '.svg', '.obj', '.stl', '.mtl', '.3mf', '.dxf', '.blend1',
    '.psb', '.fbx', '.glb', '.gltf', '.dae', '.abc', '.ply',
    '.usd', '.usda', '.usdc'
)

$null = New-Item -ItemType Directory -Path $rootPath -Force
$null = New-Item -ItemType Directory -Path $livePath -Force
$null = New-Item -ItemType Directory -Path $assetsPath -Force

$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$hasHandle = $false
$watchers = @()
$eventIds = @()

try {
    $hasHandle = $mutex.WaitOne(0, $false)
    if (-not $hasHandle) {
        exit 0
    }

    $shell = New-Object -ComObject WScript.Shell

    function Compare-Path {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Left,
            [Parameter(Mandatory = $true)]
            [string]$Right
        )

        return [string]::Equals(
            [System.IO.Path]::GetFullPath($Left),
            [System.IO.Path]::GetFullPath($Right),
            [System.StringComparison]::OrdinalIgnoreCase
        )
    }

    function Test-PathUnder {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Candidate,
            [Parameter(Mandatory = $true)]
            [string]$Parent
        )

        $candidateFull = [System.IO.Path]::GetFullPath($Candidate).TrimEnd('\')
        $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\')
        return $candidateFull.StartsWith($parentFull + '\', [System.StringComparison]::OrdinalIgnoreCase)
    }

    function Get-DestinationDirectory {
        param(
            [Parameter(Mandatory = $true)]
            [string]$TargetPath
        )

        $extension = [System.IO.Path]::GetExtension($TargetPath).ToLowerInvariant()
        if ($script:liveExtensions -contains $extension) {
            return $script:livePath
        }

        if ($script:assetExtensions -contains $extension) {
            return $script:assetsPath
        }

        return $null
    }

    function Test-IsExcludedPath {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Candidate
        )

        foreach ($excludedRoot in $script:excludedRoots) {
            if (Compare-Path -Left $Candidate -Right $excludedRoot) {
                return $true
            }

            if (Test-PathUnder -Candidate $Candidate -Parent $excludedRoot) {
                return $true
            }
        }

        return $false
    }

    function Get-ShortcutTarget {
        param(
            [Parameter(Mandatory = $true)]
            [string]$ShortcutPath
        )

        try {
            return $script:shell.CreateShortcut($ShortcutPath).TargetPath
        }
        catch {
            return $null
        }
    }

    function Get-ExistingShortcutForTarget {
        param(
            [Parameter(Mandatory = $true)]
            [string]$DirectoryPath,
            [Parameter(Mandatory = $true)]
            [string]$TargetPath
        )

        foreach ($item in (Get-ChildItem -LiteralPath $DirectoryPath -Filter '*.lnk' -Force -ErrorAction SilentlyContinue)) {
            $existingTarget = Get-ShortcutTarget -ShortcutPath $item.FullName
            if ([string]::Equals($existingTarget, $TargetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $item.FullName
            }
        }

        return $null
    }

    function Get-ShortcutDestinationPath {
        param(
            [Parameter(Mandatory = $true)]
            [string]$DirectoryPath,
            [Parameter(Mandatory = $true)]
            [string]$TargetPath
        )

        $existingPath = Get-ExistingShortcutForTarget -DirectoryPath $DirectoryPath -TargetPath $TargetPath
        if ($existingPath) {
            return $existingPath
        }

        $fileName = [System.IO.Path]::GetFileName($TargetPath)
        $candidate = Join-Path $DirectoryPath ($fileName + '.lnk')
        if (-not (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }

        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        $extension = [System.IO.Path]::GetExtension($fileName)
        $index = 2
        while ($true) {
            $candidate = Join-Path $DirectoryPath ('{0} ({1}){2}.lnk' -f $baseName, $index, $extension)
            if (-not (Test-Path -LiteralPath $candidate)) {
                return $candidate
            }

            $existingTarget = Get-ShortcutTarget -ShortcutPath $candidate
            if ([string]::Equals($existingTarget, $TargetPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $candidate
            }

            $index++
        }
    }

    function Upsert-Shortcut {
        param(
            [Parameter(Mandatory = $true)]
            [string]$TargetPath
        )

        $destinationDirectory = Get-DestinationDirectory -TargetPath $TargetPath
        if ($null -eq $destinationDirectory) {
            return
        }

        $shortcutPath = Get-ShortcutDestinationPath -DirectoryPath $destinationDirectory -TargetPath $TargetPath
        $shortcut = $script:shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $TargetPath
        $shortcut.WorkingDirectory = Split-Path -Path $TargetPath -Parent
        $shortcut.Save()

        $item = Get-Item -LiteralPath $TargetPath
        (Get-Item -LiteralPath $shortcutPath).LastWriteTime = $item.LastWriteTime
    }

    function Handle-Path {
        param(
            [Parameter(Mandatory = $true)]
            [string]$Path
        )

        if ([string]::IsNullOrWhiteSpace($Path)) {
            return
        }

        if (Test-IsExcludedPath -Candidate $Path) {
            return
        }

        $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
        if (($script:liveExtensions -notcontains $extension) -and ($script:assetExtensions -notcontains $extension)) {
            return
        }

        $targetPath = $null
        for ($attempt = 0; $attempt -lt 5; $attempt++) {
            if (Test-Path -LiteralPath $Path -PathType Leaf) {
                $targetPath = [System.IO.Path]::GetFullPath($Path)
                break
            }
            Start-Sleep -Milliseconds 400
        }

        if ($null -eq $targetPath) {
            return
        }

        Upsert-Shortcut -TargetPath $targetPath
    }

    function Register-Watchers {
        $index = 0
        foreach ($watchRoot in $script:watchRoots) {
            $watcher = New-Object System.IO.FileSystemWatcher
            $watcher.Path = $watchRoot
            $watcher.IncludeSubdirectories = $true
            $watcher.EnableRaisingEvents = $true
            $watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, CreationTime'

            $createdId = 'RecentCreativeShortcuts.Created.' + $index
            $changedId = 'RecentCreativeShortcuts.Changed.' + $index
            $renamedId = 'RecentCreativeShortcuts.Renamed.' + $index

            Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier $createdId | Out-Null
            Register-ObjectEvent -InputObject $watcher -EventName Changed -SourceIdentifier $changedId | Out-Null
            Register-ObjectEvent -InputObject $watcher -EventName Renamed -SourceIdentifier $renamedId | Out-Null

            $script:watchers += $watcher
            $script:eventIds += @($createdId, $changedId, $renamedId)
            $index++
        }
    }

    $script:shell = $shell
    $script:rootPath = $rootPath
    $script:livePath = $livePath
    $script:assetsPath = $assetsPath
    $script:watchRoots = $watchRoots
    $script:excludedRoots = $excludedRoots
    $script:liveExtensions = $liveExtensions
    $script:assetExtensions = $assetExtensions

    Register-Watchers

    if ($Once) {
        exit 0
    }

    while ($true) {
        $event = Wait-Event -Timeout $WaitSeconds
        if ($null -eq $event) {
            continue
        }

        try {
            $args = $event.SourceEventArgs
            if ($args -is [System.IO.RenamedEventArgs]) {
                Handle-Path -Path $args.FullPath
            }
            else {
                Handle-Path -Path $args.FullPath
            }
        }
        finally {
            Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
        }
    }
}
finally {
    foreach ($eventId in $eventIds) {
        Unregister-Event -SourceIdentifier $eventId -ErrorAction SilentlyContinue
    }

    foreach ($watcher in $watchers) {
        if ($null -ne $watcher) {
            $watcher.EnableRaisingEvents = $false
            $watcher.Dispose()
        }
    }

    if ($hasHandle) {
        $mutex.ReleaseMutex()
    }

    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}
