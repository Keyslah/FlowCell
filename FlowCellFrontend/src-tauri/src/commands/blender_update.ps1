# Runs in a hidden Windows PowerShell worker. Paths and action metadata arrive as data.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$utf8 = [Console]::OutputEncoding
$plan = [IO.File]::ReadAllText($env:FLOWCELL_UPDATE_PLAN) | ConvertFrom-Json
$work = Split-Path -Parent $env:FLOWCELL_UPDATE_PLAN

function Get-BlenderInfo([string]$Path) {
    if (-not [IO.File]::Exists($Path) -or [IO.Path]::GetFileName($Path) -ine 'blender.exe') { return }
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    if ($info.ProductName -ine 'Blender' -or $info.ProductVersion -notmatch '^\d+\.\d+') { return }
    [pscustomobject]@{ path = $Path; version = $Matches[0] }
}

function Get-WinGetVersion {
    $winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
    if (-not (Test-Path -LiteralPath $winget)) { throw 'Install Windows App Installer to use WinGet, or install Blender separately and browse to blender.exe.' }
    if (Get-Process blender -ErrorAction SilentlyContinue) { throw 'Save your work and close Blender before installing the update.' }
    $package = @('--id', 'BlenderFoundation.Blender', '--exact', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity')
    & $winget install @package --accept-package-agreements --silent | Out-Null
    # WinGet also returns APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE when already current.
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
        throw ('Blender installation did not complete (WinGet 0x{0:X8}). You can retry or browse to an installed copy.' -f $LASTEXITCODE)
    }
    $rows = @(& $winget list @package)
    $versions = foreach ($row in $rows) {
        if ($row -match '\bBlenderFoundation\.Blender\s+(\d+\.\d+(?:\.\d+)+)\b') { [version]$Matches[1] }
    }
    return [string]($versions | Sort-Object -Descending | Select-Object -First 1)
}

function Sync-Blender {
    $exe = $plan.executable
    if (-not (Get-BlenderInfo $exe)) { throw 'Choose a Blender installation with a valid blender.exe.' }
    # Ask the selected binary so portable installs and BLENDER_USER_RESOURCES work as well.
    $env:FLOWCELL_TARGET_BLENDER_OPEN = if (Get-Process blender -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) { '1' } else { '0' }
    $probe = Join-Path $work 'prepare_update_profile.py'
    $output = @(& $exe --background --factory-startup --disable-autoexec --python-exit-code 1 --python $probe)
    $profileLine = $output | Where-Object { $_ -like 'FLOWCELL_PROFILE=*' } | Select-Object -Last 1
    if ($LASTEXITCODE -ne 0 -or -not $profileLine) {
        $reason = $output | Where-Object { $_ -like 'FLOWCELL_PROFILE_ERROR=*' } | Select-Object -Last 1
        if ($reason) { throw $reason.Substring('FLOWCELL_PROFILE_ERROR='.Length) }
        throw 'The selected Blender could not prepare its user profile.'
    }
    $profile = $profileLine.Substring('FLOWCELL_PROFILE='.Length) | ConvertFrom-Json
    if ($profile.PSObject.Properties['needsPreferenceChoice']) { return $profile }
    if (-not [IO.Path]::IsPathRooted($profile.scripts)) { throw 'Blender returned an invalid user scripts folder.' }

    $stage = Join-Path $work 'scripts'
    $stageBridge = Join-Path $stage 'addons\blender_bridge_flowcell'
    $bridge = Join-Path $profile.scripts 'addons\blender_bridge_flowcell'
    $registry = Join-Path $bridge 'flowcell_custom_actions.json'
    $support = Join-Path $plan.program 'SupportScripts'
    $payload = Join-Path $plan.program 'Blender Addons - Copy contents Into Blender'
    [IO.Directory]::CreateDirectory((Join-Path $stageBridge 'ManagedActions')) | Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $stage 'startup')) | Out-Null
    foreach ($file in @('flowcell_actions.py','flowcell_bridge.py')) {
        Copy-Item -LiteralPath (Join-Path $payload $file) -Destination (Join-Path $stage 'addons')
    }
    Copy-Item -LiteralPath (Join-Path $work 'flowcell_startup_bootstrap.py') -Destination (Join-Path $stage 'startup')
    Copy-Item -LiteralPath (Join-Path $payload 'blender_bridge_flowcell\flowcell_bridge_setup.json') -Destination $stageBridge
    [IO.File]::WriteAllText((Join-Path $stageBridge 'flowcell_custom_actions.json'), '{"actions":[]}', $utf8)
    $params = @{ BridgeFolder = $stageBridge; ConfigPath = $plan.config }
    foreach ($owner in $plan.owners) {
        $data = ConvertTo-Json -InputObject $owner.data -Compress -Depth 64
        $result = (& (Join-Path $support 'Install-BlenderFlowCellButtons.ps1') @params -SkipSync -PanelName $owner.panel -SelectedPaths $owner.source -OwnerButtonId $owner.id -BridgeDataJson $data) | ConvertFrom-Json
        if ($result.failedCount -ne 0 -or $result.installedCount -ne 1) { throw "Could not sync $($owner.id). $($result.firstFailureMessage)" }
    }
    $sync = (& (Join-Path $support 'Sync-BlenderCustomActionCode.ps1') @params) | ConvertFrom-Json
    if ($sync.UpdatedActions -ne $plan.owners.Count) { throw 'The staged Blender registry is missing an installed action.' }
    $stagedRegistry = Join-Path $stageBridge 'flowcell_custom_actions.json'
    $generated = (Get-Content -Raw -LiteralPath $stagedRegistry -Encoding UTF8 | ConvertFrom-Json).actions
    $entries = @{}
    $document = if ([IO.File]::Exists($registry)) {
        Get-Content -Raw -LiteralPath $registry -Encoding UTF8 | ConvertFrom-Json
    } else { [pscustomobject]@{ actions = @() } }
    if ($document.actions -isnot [array]) { throw 'The destination Blender action registry is invalid.' }
    foreach ($entry in $document.actions) {
        if ($entries.ContainsKey($entry.action)) { throw "Duplicate destination action $($entry.action)." }
        $entries[$entry.action] = $entry
    }
    foreach ($action in $generated) {
        if ($entries.ContainsKey($action.action) -and $entries[$action.action].ownerButtonId -cne $action.ownerButtonId) {
            throw "Another owner already uses $($action.action) in the selected Blender."
        }
        $action.pythonPath = Join-Path $bridge ('ManagedActions\' + [IO.Path]::GetFileName($action.pythonPath))
        $entries[$action.action] = $action
    }
    $document.actions = @($entries.Values | Sort-Object action)
    [IO.File]::WriteAllText($stagedRegistry, (ConvertTo-Json $document -Depth 64), $utf8)

    # Publish complete individual files and put the registry last. Restore replaced
    # files if any write fails. No unrelated add-ons or preferences are copied.
    $published = New-Object System.Collections.Generic.List[object]
    try {
        [IO.Directory]::CreateDirectory((Join-Path $bridge 'ManagedActions')) | Out-Null
        $files = @(Get-ChildItem $stage -Recurse -File | Where-Object FullName -ne $stagedRegistry) + @(Get-Item -LiteralPath $stagedRegistry)
        foreach ($file in $files) {
            $target = Join-Path $profile.scripts $file.FullName.Substring($stage.Length + 1)
            $parent = [IO.Path]::GetDirectoryName($target)
            [IO.Directory]::CreateDirectory($parent) | Out-Null
            $scratch = Join-Path $parent ([guid]::NewGuid().ToString('N') + '.tmp')
            $backup = $null
            try {
                [IO.File]::Copy($file.FullName,$scratch)
                if ([IO.File]::Exists($target)) {
                    $backup = $scratch + '.bak'
                    [IO.File]::Replace($scratch,$target,$backup)
                } else { [IO.File]::Move($scratch,$target) }
                $published.Add(@{target=$target; backup=$backup})
            } finally { if ([IO.File]::Exists($scratch)) { [IO.File]::Delete($scratch) } }
        }
    } catch {
        $failure = $_
        for ($i = $published.Count - 1; $i -ge 0; $i--) {
            $item = $published[$i]
            if ($item.backup) {
                $discard = $item.backup + '.tmp'
                [IO.File]::Replace($item.backup,$item.target,$discard)
                [IO.File]::Delete($discard)
            }
            else { [IO.File]::Delete($item.target) }
        }
        throw $failure
    }
    foreach ($item in $published) {
        if ($item.backup) { Remove-Item -LiteralPath $item.backup -ErrorAction SilentlyContinue }
    }
    return @{ bridge = $bridge; version = $profile.version; count = $plan.owners.Count }
}

try {
    switch ($plan.operation) {
        'detect' {
            $items = @(foreach ($path in $plan.paths) { Get-BlenderInfo $path })
            $result = @($items | Sort-Object @{ Expression = { [version]$_.version }; Descending = $true }, path)
        }
        'install' { $result = Get-WinGetVersion }
        'sync' { $result = Sync-Blender }
        default { throw 'Unknown Blender update operation.' }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress -Depth 8))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
