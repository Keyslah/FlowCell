Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectRoot = Join-Path $repoRoot 'Blender'
$localRoot = Join-Path $repoRoot 'FlowCell\local'
$localConfigPath = Join-Path $localRoot 'private\blender.config.local.json'
$configPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) { $localConfigPath } else { Join-Path $projectRoot 'config.json' }
$flowCellStatePath = Join-Path $localRoot 'flowcell_state.json'
$flowCellLayoutsRoot = Join-Path $localRoot 'layouts'
$wrapperRoot = Join-Path $projectRoot 'FlowCellButtons'
$supportRoot = Join-Path $projectRoot 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
$customActionSyncPath = Join-Path $supportRoot 'Sync-BlenderCustomActionCode.ps1'
$bridgeLayoutPath = Join-Path $supportRoot 'FlowCellBlenderBridgeLayout.ps1'
$renameSelectedPath = Join-Path $wrapperRoot 'org_rename_selected_objects.ps1'
$legacyAddonPattern = Join-Path (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender') '*\scripts\addons\flowcell_*.py'
if (-not (Test-Path -LiteralPath $bridgeLayoutPath -PathType Leaf)) {
    throw "Blender bridge layout helper not found: $bridgeLayoutPath"
}
. $bridgeLayoutPath

function Get-SafeName([string]$Value) {
    $safe = ($Value -replace '[^A-Za-z0-9]+', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        return 'button'
    }
    return $safe.ToLowerInvariant()
}

function Get-FlowCellButtonPrefix([string]$PanelName) {
    $normalizedPanelName = if ($null -ne $PanelName) { [string]$PanelName } else { '' }
    switch ($normalizedPanelName.Trim().ToLowerInvariant()) {
        'collections' { return 'org_' }
        'layers' { return 'org_' }
        'files' { return 'file_' }
        default { return 'util_' }
    }
}

function Write-FlowCellTextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,
        [ValidateSet('ASCII', 'UTF8')]
        [string]$Encoding = 'ASCII',
        [int]$RetryCount = 10
    )

    $lastError = $null
    for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
        try {
            $resolvedEncoding = switch ($Encoding) {
                'UTF8' { New-Object System.Text.UTF8Encoding($false) }
                default { [System.Text.Encoding]::ASCII }
            }
            [System.IO.File]::WriteAllText($Path, $Value, $resolvedEncoding)
            return
        }
        catch [System.IO.IOException] {
            $lastError = $_
            if ($attempt -lt $RetryCount) {
                Start-Sleep -Milliseconds (40 * $attempt)
                continue
            }

            throw ('Could not update "{0}" because another process is using it. Close the related FlowCell or Blender button/popout and try again.' -f $Path)
        }
    }

    if ($lastError) {
        throw $lastError
    }
}

function Get-WrapperFileName([string]$PanelName, [string]$Name) {
    return ('{0}{1}.ps1' -f (Get-FlowCellButtonPrefix -PanelName $PanelName), (Get-SafeName -Value $Name))
}

function Get-BuiltInActionDescriptionMap {
    return @{
        'make_layers' = 'Create Live, Snapshots, Trash, and Archive if missing.'
        'sort' = 'Sort by visibility: visible objects become Live, matching invisible family objects become Snapshots as s#, and other invisible objects become Trash as t#.'
        'sort_live' = 'Move every currently hidden object under Live into Trash.'
        'snapshot' = 'Copy the selected Live objects into Snapshots as versioned s# duplicates.'
        'back' = 'Move the current Live version to Trash and restore the newest matching snapshot back into Live.'
        'restore' = 'Copy selected snapshot, trash, or archive objects into Live and move the current Live version to Trash first.'
        'trash' = 'Move the selected objects into Trash.'
        'archive' = 'Copy the selected objects into Archive.'
        'empty_trash' = 'Delete everything inside Trash.'
        'add_to_live' = 'Copy selected snapshot, trash, or archive objects into Live without replacing the current Live version.'
        'new_collection' = 'Prompt for a name and create a new child collection near the selected object.'
        'empty_collections' = 'Delete empty collections while keeping the system roots.'
        'cycle_collection' = 'Use the selected object''s collection and show one direct object at a time while selecting it.'
        'cycle_live_versions' = 'With one selected Live object, cycle Live and snapshot versions one visible object at a time.'
        'save_selected_stl_to_assets' = 'Export the selected mesh objects to 01 src\04 assets\03 3d as a uniquely named STL.'
        'render_active_object_png_to_images' = 'Render the active selected object from the current scene camera to 01 src\04 assets\01 images as a transparent PNG cropped exactly to the visible object bounds.'
        'alignment_tools' = 'Open FlowCell alignment controls for active-object min, center, max, surface, and geocenter alignment.'
        'flatten_revolve_tools' = 'Flatten the active mesh into a centered profile, hide the source object, and generate revolve output in place.'
        'cursor_center_hole' = 'With one hole wall face selected in Edit Mode, find the center point and move the 3D cursor to it.'
        'rename_selected_objects' = 'Prompt for rename values and batch-rename the selected Blender objects through the FlowCell bridge.'
    }
}

function Get-PreferredActionDescription([string]$ActionName, [string]$CurrentDescription = '') {
    $builtInDescriptions = Get-BuiltInActionDescriptionMap
    if (-not [string]::IsNullOrWhiteSpace($ActionName) -and $builtInDescriptions.ContainsKey($ActionName)) {
        return [string]$builtInDescriptions[$ActionName]
    }

    return [string]$CurrentDescription
}

function New-WrapperContent([string]$DispatcherPath, [string]$Action, [string]$Label, [string]$Direction) {
    $lines = @(
        '$ErrorActionPreference = ''Stop''',
        '$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) ''SupportScripts''',
        '$dispatcherPath = Join-Path $supportRoot ''Invoke-BlenderFlowCellAction.ps1'''
    )
    $command = '& $dispatcherPath -Action ''{0}'' -Label ''{1}''' -f ($Action -replace "'", "''"), ($Label -replace "'", "''")
    if (-not [string]::IsNullOrWhiteSpace($Direction)) {
        $command += " -Direction '{0}'" -f ($Direction -replace "'", "''")
    }
    $lines += $command
    $lines += 'exit $LASTEXITCODE'
    return ($lines -join "`r`n") + "`r`n"
}

function Move-FileToRecycleBin([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
}

function Test-PathUnderScriptDump([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }

    try {
        $currentPath = [System.IO.Path]::GetFullPath([string]$Path)
    }
    catch {
        return $false
    }

    while (-not [string]::IsNullOrWhiteSpace($currentPath)) {
        $leafName = Split-Path -Path $currentPath -Leaf
        if ([string]$leafName -ieq 'ScriptDump') {
            return $true
        }

        $parentPath = Split-Path -Path $currentPath -Parent
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }

        $currentPath = $parentPath
    }

    return $false
}

function Get-NormalizedPathKey([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }

    try {
        return ([System.IO.Path]::GetFullPath([string]$Path)).TrimEnd('\')
    }
    catch {
        return ([string]$Path).Trim()
    }
}

function Resolve-FlowCellButtonScriptPath([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
        return ''
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    $addCandidate = {
        param([string]$Candidate)
        if ([string]::IsNullOrWhiteSpace([string]$Candidate)) {
            return
        }

        try {
            $resolvedCandidate = [System.IO.Path]::GetFullPath([string]$Candidate)
        }
        catch {
            $resolvedCandidate = [string]$Candidate
        }

        if (-not $candidates.Contains($resolvedCandidate)) {
            [void]$candidates.Add($resolvedCandidate)
        }
    }

    if ([System.IO.Path]::IsPathRooted([string]$ScriptPath)) {
        & $addCandidate ([string]$ScriptPath)
    }
    else {
        $trimmedLeaf = ([string]$ScriptPath).Trim().TrimStart('.','\','/')
        & $addCandidate (Join-Path $projectRoot ([string]$ScriptPath))
        if (-not [string]::IsNullOrWhiteSpace($trimmedLeaf)) {
            & $addCandidate (Join-Path $wrapperRoot $trimmedLeaf)
        }
        & $addCandidate ([string]$ScriptPath)
    }

    foreach ($candidate in @($candidates)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [string]$candidate
        }
    }

    if (@($candidates).Count -gt 0) {
        return [string]$candidates[0]
    }

    return [string]$ScriptPath
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Blender config not found: $configPath"
}

if (-not (Test-Path -LiteralPath $flowCellStatePath -PathType Leaf)) {
    throw "FlowCell state not found: $flowCellStatePath"
}

New-Item -ItemType Directory -Path $wrapperRoot -Force | Out-Null
New-Item -ItemType Directory -Path $supportRoot -Force | Out-Null

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config
$bridgeFolder = [string]$bridgeLayout.BridgeFolder
$customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
$addonActionsPath = [string]$bridgeLayout.AddonActionsPath
$addonBridgePath = [string]$bridgeLayout.AddonBridgePath
$registry = [pscustomobject]@{ actions = @() }
if (-not [string]::IsNullOrWhiteSpace($customRegistryPath) -and (Test-Path -LiteralPath $customRegistryPath -PathType Leaf)) {
    try {
        $registry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
        if ($null -eq $registry.actions) {
            $registry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force
        }
    }
    catch {
        $registry = [pscustomobject]@{ actions = @() }
    }
}

if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
    & $customActionSyncPath -ConfigPath $configPath -BridgeFolder $bridgeFolder | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($customRegistryPath) -and (Test-Path -LiteralPath $customRegistryPath -PathType Leaf)) {
        try {
            $registry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
            if ($null -eq $registry.actions) {
                $registry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force
            }
        }
        catch {
            $registry = [pscustomobject]@{ actions = @() }
        }
    }
}

function Get-PythonFunctionMetadata([string]$Path, [string]$PreferredFunctionName = '') {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ FunctionName = ''; StartLine = 1; SourceText = '' }
    }

    $lines = @(Get-Content -LiteralPath $Path)
    $functionName = ''
    $startLine = 1

    if (-not [string]::IsNullOrWhiteSpace($PreferredFunctionName)) {
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ([string]$lines[$i] -match ('^\s*def\s+{0}\s*\(' -f [Regex]::Escape($PreferredFunctionName))) {
                $functionName = $PreferredFunctionName
                $startLine = $i + 1
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($functionName)) {
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ([string]$lines[$i] -match '^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(') {
                $functionName = [string]$matches[1]
                $startLine = $i + 1
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($functionName)) {
        return [pscustomobject]@{ FunctionName = ''; StartLine = 1; SourceText = ($lines -join "`r`n") }
    }

    $sourceLines = New-Object System.Collections.Generic.List[string]
    $baseIndent = 0
    $inFunction = $false
    for ($i = $startLine - 1; $i -lt $lines.Count; $i++) {
        $line = [string]$lines[$i]
        if (-not $inFunction) {
            $inFunction = $true
            $baseIndent = ($line -replace '^([\s]*).*$', '$1').Length
            [void]$sourceLines.Add($line)
            continue
        }

        $trimmed = $line.Trim()
        if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
            $indent = ($line -replace '^([\s]*).*$', '$1').Length
            if ($indent -le $baseIndent -and $line -match '^\s*(def|class)\s+') {
                break
            }
        }

        [void]$sourceLines.Add($line)
    }

    return [pscustomobject]@{
        FunctionName = $functionName
        StartLine = $startLine
        SourceText = ($sourceLines -join "`r`n")
    }
}

function Get-BridgeActionFunctionMap {
    return @{
        'make_layers' = 'perform_make_layers'
        'sort' = 'perform_sort'
        'sort_live' = 'perform_sort_live'
        'snapshot' = 'perform_snapshot'
        'back' = 'perform_back'
        'restore' = 'perform_restore'
        'trash' = 'perform_trash'
        'archive' = 'perform_archive'
        'empty_trash' = 'perform_empty_trash'
        'add_to_live' = 'perform_add_to_live'
        'new_collection' = 'perform_new_collection'
        'empty_collections' = 'perform_empty_collections'
        'cycle_collection' = 'perform_cycle_collection'
        'cycle_live_versions' = 'perform_cycle_live_versions'
        'save_selected_stl_to_assets' = 'perform_save_selected_stl_to_assets_result'
        'import_obj_into_scene' = 'perform_import_obj_into_scene_result'
        'import_png_as_lithophane' = 'perform_import_png_as_lithophane_result'
        'render_active_object_png_to_images' = 'perform_render_active_object_png_to_images_result'
        'alignment_tools' = 'perform_flowcell_alignment_tool'
        'flatten_revolve_tools' = 'perform_flowcell_flatten_revolve_tool'
        'cursor_center_hole' = 'perform_cursor_center_hole'
        'rename_selected_objects' = 'perform_batch_rename_selected_objects'
    }
}

function Get-SourceMetadataForAction([string]$ActionName) {
    foreach ($entry in @($registry.actions)) {
        if ([string]$entry.action -ieq $ActionName) {
            $registryPythonPath = if ($entry.PSObject.Properties['sourcePythonPath'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.sourcePythonPath)) {
                [string]$entry.sourcePythonPath
            } else {
                [string]$entry.pythonPath
            }
            $registryFunctionName = if ($entry.PSObject.Properties['sourceFunctionName'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.sourceFunctionName)) {
                [string]$entry.sourceFunctionName
            } else {
                [string]$entry.functionName
            }
            $meta = Get-PythonFunctionMetadata -Path $registryPythonPath -PreferredFunctionName $registryFunctionName
            return [pscustomobject]@{
                PythonPath = $registryPythonPath
                FunctionName = if ([string]::IsNullOrWhiteSpace($registryFunctionName)) { [string]$meta.FunctionName } else { $registryFunctionName }
                StartLine = [int]$meta.StartLine
                SourceText = [string]$meta.SourceText
            }
        }
    }

    $map = Get-BridgeActionFunctionMap
    if ([string]::IsNullOrWhiteSpace($ActionName) -or -not $map.ContainsKey($ActionName)) {
        return $null
    }

    $functionName = [string]$map[$ActionName]
    if ($functionName -eq 'perform_batch_rename_selected_objects' -and (Test-Path -LiteralPath $addonBridgePath -PathType Leaf)) {
        $meta = Get-PythonFunctionMetadata -Path $addonBridgePath -PreferredFunctionName $functionName
        return [pscustomobject]@{
            PythonPath = $addonBridgePath
            FunctionName = $meta.FunctionName
            StartLine = [int]$meta.StartLine
            SourceText = [string]$meta.SourceText
        }
    }

    if (Test-Path -LiteralPath $addonActionsPath -PathType Leaf) {
        $meta = Get-PythonFunctionMetadata -Path $addonActionsPath -PreferredFunctionName $functionName
        return [pscustomobject]@{
            PythonPath = $addonActionsPath
            FunctionName = $meta.FunctionName
            StartLine = [int]$meta.StartLine
            SourceText = [string]$meta.SourceText
        }
    }

    return $null
}

function Get-PrimaryWrapperAction([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return ''
    }

    $raw = Get-Content -LiteralPath $ScriptPath -Raw
    $matches = [Regex]::Matches($raw, "-Action\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($matches.Count -eq 0) {
        return ''
    }

    foreach ($match in @($matches)) {
        $value = [string]$match.Groups[1].Value
        if ($value -ieq 'get_selected_objects') {
            continue
        }
        return $value
    }

    return [string]$matches[0].Groups[1].Value
}

function Get-TopDescription([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ''
    }

    $lines = @(Get-Content -LiteralPath $Path -TotalCount 32)
    foreach ($line in $lines) {
        if ([string]$line -match '^\s*#\s*Description\s*:\s*(.+)$') {
            return [string]$matches[1].Trim()
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$line) -and [string]$line -notmatch '^\s*#') {
            break
        }
    }

    return ''
}

function Convert-TextToCommentLines([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @('# (No source text was available.)')
    }

    $normalized = $Text -replace "`r`n", "`n"
    return @(($normalized -split "`n", -1) | ForEach-Object { '# ' + [string]$_ })
}

function Update-WrapperMetadata([string]$WrapperPath, [string]$FallbackDescription = '') {
    if ([string]::IsNullOrWhiteSpace($WrapperPath) -or -not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)) {
        return
    }

    $actionName = Get-PrimaryWrapperAction -ScriptPath $WrapperPath
    if ([string]::IsNullOrWhiteSpace($actionName)) {
        return
    }

    $sourceMeta = Get-SourceMetadataForAction -ActionName $actionName
    if ($null -eq $sourceMeta) {
        return
    }

    $lines = @(Get-Content -LiteralPath $WrapperPath)
    $bodyStart = 0
    while ($bodyStart -lt $lines.Count) {
        $currentLine = [string]$lines[$bodyStart]
        if ($currentLine -match '^\s*$' -or $currentLine -match '^\s*#') {
            $bodyStart++
            continue
        }
        break
    }
    $bodyLines = if ($bodyStart -lt $lines.Count) { @($lines[$bodyStart..($lines.Count - 1)]) } else { @() }

    $description = Get-TopDescription -Path $WrapperPath
    if ([string]::IsNullOrWhiteSpace($description)) {
        $description = if (-not [string]::IsNullOrWhiteSpace($FallbackDescription)) { $FallbackDescription } else { ('Run Blender action {0} through the {1} bridge.' -f $actionName, [string]$bridgeLayout.AddonDisplayName) }
    }
    $description = Get-PreferredActionDescription -ActionName $actionName -CurrentDescription $description

    $header = @(
        ('# Description: {0}' -f $description),
        '',
        ('# Source Bridge Action: {0}' -f [string]$actionName),
        ('# Source Python Filename: {0}' -f ([System.IO.Path]::GetFileName([string]$sourceMeta.PythonPath))),
        ('# Source Python File: {0}' -f [string]$sourceMeta.PythonPath),
        '',
        ('# Source Action Function: {0}' -f [string]$sourceMeta.FunctionName),
        ('# Source Action Start Line: {0}' -f [int]$sourceMeta.StartLine),
        '',
        '# Source Action Logic:',
        ''
    ) + @(Convert-TextToCommentLines -Text ([string]$sourceMeta.SourceText))

    $newLines = @($header)
    if (@($bodyLines).Count -gt 0) {
        $newLines += @('') + @($bodyLines)
    }

    Write-FlowCellTextFile -Path $WrapperPath -Value (($newLines -join "`r`n") + "`r`n") -Encoding ASCII
}

$customProtectedNames = @(
    foreach ($button in @($config.buttons)) {
        if (-not ($button.PSObject.Properties['scriptPath'])) { continue }
        $scriptPath = [string]$button.scriptPath
        if ([string]::IsNullOrWhiteSpace($scriptPath)) { continue }
        try {
            $fullPath = Resolve-FlowCellButtonScriptPath -ScriptPath $scriptPath
            if (Test-PathUnderScriptDump -Path $fullPath) {
                continue
            }
            if ((Split-Path -Parent $fullPath) -ieq $wrapperRoot) {
                Split-Path -Leaf $fullPath
            }
        }
        catch {
        }
    }
)

$protectedNames = @(
    'org_rename_selected_objects.ps1'
) + @($customProtectedNames)
Get-ChildItem -LiteralPath $wrapperRoot -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
    Where-Object { $protectedNames -notcontains $_.Name } |
    ForEach-Object { Move-FileToRecycleBin -Path $_.FullName }
$buttonSpecs = New-Object System.Collections.Generic.List[object]

foreach ($button in @($config.buttons)) {
    $hasLocalAction = ($button.PSObject.Properties['localAction'] -and -not [string]::IsNullOrWhiteSpace([string]$button.localAction))
    $action = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
    $scriptPath = if ($button.PSObject.Properties['scriptPath']) { [string]$button.scriptPath } else { '' }
    $panel = if ($button.PSObject.Properties['panel'] -and -not [string]::IsNullOrWhiteSpace([string]$button.panel)) { [string]$button.panel } else { 'collections' }
    $tooltip = if ($button.PSObject.Properties['tooltip']) { [string]$button.tooltip } else { '' }
    $tooltip = Get-PreferredActionDescription -ActionName $action -CurrentDescription $tooltip
    if (-not [string]::IsNullOrWhiteSpace($action)) {
        if (-not ($button.PSObject.Properties['tooltip'])) {
            $button | Add-Member -MemberType NoteProperty -Name tooltip -Value $tooltip -Force
        }
        else {
            $button.tooltip = $tooltip
        }
    }
    if ($hasLocalAction) {
        continue
    }

    if (-not [string]::IsNullOrWhiteSpace($scriptPath)) {
        $resolvedScriptPath = Resolve-FlowCellButtonScriptPath -ScriptPath $scriptPath
        if (Test-PathUnderScriptDump -Path $resolvedScriptPath) {
            continue
        }
        if ([string]::IsNullOrWhiteSpace($resolvedScriptPath) -or -not (Test-Path -LiteralPath $resolvedScriptPath -PathType Leaf)) {
            throw ('Configured Blender button target was not found: {0}' -f $scriptPath)
        }
        $safeName = Get-SafeName -Value ([string]$button.label)
        $buttonSpecs.Add([pscustomobject]@{
            Id        = ('button_blender_flowcell_{0}' -f $safeName)
            Label     = [string]$button.label
            Target    = $resolvedScriptPath
            Tooltip   = $tooltip
            Action    = ''
            Direction = ''
            Panel     = $panel
        }) | Out-Null
        continue
    }

    if ([string]::IsNullOrWhiteSpace($action)) {
        continue
    }

    if (($button.PSObject.Properties['showCycleArrows']) -and [bool]$button.showCycleArrows -and $action -eq 'cycle_live_versions') {
        $buttonSpecs.Add([pscustomobject]@{
            Id        = 'button_blender_flowcell_cycle_versions_back'
            Label     = 'cycle versions <'
            Target    = (Join-Path $wrapperRoot (Get-WrapperFileName -PanelName $panel -Name 'cycle_versions_back'))
            Tooltip   = $tooltip
            Action    = $action
            Direction = 'backward'
            Panel     = $panel
        }) | Out-Null
        $buttonSpecs.Add([pscustomobject]@{
            Id        = 'button_blender_flowcell_cycle_versions_forward'
            Label     = 'cycle versions >'
            Target    = (Join-Path $wrapperRoot (Get-WrapperFileName -PanelName $panel -Name 'cycle_versions_forward'))
            Tooltip   = $tooltip
            Action    = $action
            Direction = 'forward'
            Panel     = $panel
        }) | Out-Null
        continue
    }

    $safeName = Get-SafeName -Value $action
    $buttonSpecs.Add([pscustomobject]@{
        Id        = ('button_blender_flowcell_{0}' -f $safeName)
        Label     = [string]$button.label
        Target    = (Join-Path $wrapperRoot (Get-WrapperFileName -PanelName $panel -Name $safeName))
        Tooltip   = $tooltip
        Action    = $action
        Direction = ''
        Panel     = $panel
    }) | Out-Null
}

$buttonSpecs.Add([pscustomobject]@{
    Id        = 'button_blender_flowcell_rename_selected_objects'
    Label     = 'rename selected'
    Target    = $renameSelectedPath
    Tooltip   = 'Rename all selected Blender objects in one prompt.'
    Action    = ''
    Direction = ''
    Panel     = 'collections'
}) | Out-Null

$wrapperDescriptions = @{}
$actionDescriptions = @{}
foreach ($spec in $buttonSpecs.ToArray()) {
    $normalizedTarget = Get-NormalizedPathKey -Path ([string]$spec.Target)
    if (-not [string]::IsNullOrWhiteSpace($normalizedTarget) -and -not [string]::IsNullOrWhiteSpace([string]$spec.Tooltip)) {
        $wrapperDescriptions[$normalizedTarget] = [string]$spec.Tooltip
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$spec.Action) -and -not [string]::IsNullOrWhiteSpace([string]$spec.Tooltip)) {
        $actionDescriptions[[string]$spec.Action] = [string]$spec.Tooltip
    }
}

foreach ($spec in $buttonSpecs) {
    if (-not [string]::IsNullOrWhiteSpace([string]$spec.Action)) {
        $wrapperContent = New-WrapperContent -DispatcherPath $dispatcherPath -Action ([string]$spec.Action) -Label ([string]$spec.Label) -Direction ([string]$spec.Direction)
        try {
            Write-FlowCellTextFile -Path ([string]$spec.Target) -Value $wrapperContent -Encoding ASCII
        }
        catch {
            Write-Warning $_.Exception.Message
        }
    }
}

foreach ($wrapper in @(Get-ChildItem -LiteralPath $wrapperRoot -Filter '*.ps1' -File -ErrorAction SilentlyContinue)) {
    $wrapperPath = [string]$wrapper.FullName
    $description = ''
    $normalizedWrapperPath = Get-NormalizedPathKey -Path $wrapperPath
    if ($wrapperDescriptions.ContainsKey($normalizedWrapperPath)) {
        $description = [string]$wrapperDescriptions[$normalizedWrapperPath]
    }
    else {
        $actionName = Get-PrimaryWrapperAction -ScriptPath $wrapperPath
        if (-not [string]::IsNullOrWhiteSpace($actionName) -and $actionDescriptions.ContainsKey($actionName)) {
            $description = [string]$actionDescriptions[$actionName]
        }
    }
    try {
        Update-WrapperMetadata -WrapperPath $wrapperPath -FallbackDescription $description
    }
    catch {
        Write-Warning $_.Exception.Message
    }
}

Write-FlowCellTextFile -Path $configPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8

$flowState = Get-Content -LiteralPath $flowCellStatePath -Raw | ConvertFrom-Json
$blenderProgram = @($flowState.Programs | Where-Object { [int]$_.ProgramTabId -eq 3 } | Select-Object -First 1)
if (@($blenderProgram).Count -eq 0) {
    throw 'Blender FlowCell program was not found.'
}
$blenderProgram = $blenderProgram[0]

function Get-PanelIdForName([string]$Name) {
    $safe = (($Name -replace '[^A-Za-z0-9]+', '_').Trim('_')).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($safe)) {
        $safe = [guid]::NewGuid().ToString('N')
    }
    return ('panel_{0}' -f $safe)
}

function Get-FlowCellPanelByName($Program, [string]$PanelName) {
    return @($Program.Panels | Where-Object { [string]$_.Name -ieq [string]$PanelName } | Select-Object -First 1)
}

function Get-OrCreateFlowCellPanel($Program, [string]$PanelName, [string]$PreferredId = '') {
    $existing = @()
    if (-not [string]::IsNullOrWhiteSpace($PreferredId)) {
        $existing = @($Program.Panels | Where-Object { [string]$_.Id -eq [string]$PreferredId } | Select-Object -First 1)
    }
    if (@($existing).Count -eq 0) {
        $existing = @(Get-FlowCellPanelByName -Program $Program -PanelName $PanelName)
    }
    if (@($existing).Count -gt 0) {
        return $existing[0]
    }

    $panelId = if ([string]::IsNullOrWhiteSpace($PreferredId)) { Get-PanelIdForName -Name $PanelName } else { [string]$PreferredId }
    $suffix = 2
    while (@($Program.Panels | Where-Object { [string]$_.Id -eq $panelId }).Count -gt 0) {
        $panelId = ('{0}_{1}' -f (Get-PanelIdForName -Name $PanelName), $suffix)
        $suffix++
    }

    $panel = [pscustomobject]@{
        Id = $panelId
        Name = [string]$PanelName
        IsPoppedOut = $false
        PopoutBounds = $null
        Buttons = @()
    }
    $Program.Panels += $panel
    return $panel
}

function Get-PreservedPanelButtons($Panel) {
    return @(
        @($Panel.Buttons) | Where-Object {
            -not ([string]$_.Id -like 'button_blender_flowcell_*') -and
            -not ([string]$_.Target -like (Join-Path $wrapperRoot '*')) -and
            -not ([string]$_.Target -like $legacyAddonPattern)
        }
    )
}

$filesPanel = Get-OrCreateFlowCellPanel -Program $blenderProgram -PanelName 'Files' -PreferredId 'panel_files'
$utilityPanel = Get-OrCreateFlowCellPanel -Program $blenderProgram -PanelName 'Utility' -PreferredId 'panel_utility'
$collectionsPanel = Get-OrCreateFlowCellPanel -Program $blenderProgram -PanelName 'Collections' -PreferredId 'panel_collections'
$editPanel = Get-OrCreateFlowCellPanel -Program $blenderProgram -PanelName 'Edit' -PreferredId 'panel_edit'
$blenderProgram.Panels = @(
    $blenderProgram.Panels | Where-Object {
        if ([string]$_.Id -eq [string]$editPanel.Id) {
            return $true
        }
        if ([string]$_.Id -like 'panel_edit*' -and [string]$_.Name -ieq 'Edit' -and @($_.Buttons).Count -eq 0) {
            return $false
        }
        return $true
    }
)
$currentSelectedPanelId = if ($blenderProgram.PSObject.Properties['SelectedPanelId']) { [string]$blenderProgram.SelectedPanelId } else { '' }
$panelPreservedButtons = @{}
foreach ($panel in @($blenderProgram.Panels)) {
    $panelPreservedButtons[[string]$panel.Id] = @(Get-PreservedPanelButtons -Panel $panel)
}

$importedButtons = @(
    foreach ($spec in $buttonSpecs) {
        [pscustomobject]@{
            Id        = [string]$spec.Id
            Kind      = 'script'
            Label     = [string]$spec.Label
            Target    = [string]$spec.Target
            Tooltip   = [string]$spec.Tooltip
            Shortcut  = ''
            BindingId = 0
            Panel     = [string]$spec.Panel
        }
    }
)

$importedPanelButtonMap = @{}
foreach ($button in @($importedButtons)) {
    $panelName = if ([string]::IsNullOrWhiteSpace([string]$button.Panel)) { 'Collections' } else { [string]$button.Panel }
    $panelNameKey = $panelName.Trim().ToLowerInvariant()
    if (-not $importedPanelButtonMap.ContainsKey($panelNameKey)) {
        $importedPanelButtonMap[$panelNameKey] = [pscustomobject]@{
            PanelName = $panelName
            Buttons = New-Object System.Collections.ArrayList
        }
    }
    [void]$importedPanelButtonMap[$panelNameKey].Buttons.Add([pscustomobject]@{
        Id        = [string]$button.Id
        Kind      = [string]$button.Kind
        Label     = [string]$button.Label
        Target    = [string]$button.Target
        Tooltip   = [string]$button.Tooltip
        Shortcut  = [string]$button.Shortcut
        BindingId = [int]$button.BindingId
    })
}

foreach ($panel in @($blenderProgram.Panels)) {
    $preserved = if ($panelPreservedButtons.ContainsKey([string]$panel.Id)) { @($panelPreservedButtons[[string]$panel.Id]) } else { @() }
    $panel.Buttons = @($preserved)
}

$lastImportedPanel = $null
foreach ($entry in @($importedPanelButtonMap.GetEnumerator())) {
    $panelName = [string]$entry.Value.PanelName
    $targetPanel = switch ($panelName.Trim().ToLowerInvariant()) {
        'files' { $filesPanel; break }
        'utility' { $utilityPanel; break }
        'edit' { $editPanel; break }
        'collections' { $collectionsPanel; break }
        default { Get-OrCreateFlowCellPanel -Program $blenderProgram -PanelName $panelName }
    }
    $preserved = if ($panelPreservedButtons.ContainsKey([string]$targetPanel.Id)) { @($panelPreservedButtons[[string]$targetPanel.Id]) } else { @() }
    $mergedButtons = New-Object System.Collections.Generic.List[object]
    foreach ($button in @($preserved)) {
        [void]$mergedButtons.Add($button)
    }
    foreach ($button in @($entry.Value.Buttons)) {
        [void]$mergedButtons.Add($button)
    }
    $targetPanel.Buttons = @($mergedButtons.ToArray())
    $lastImportedPanel = $targetPanel
}

$filesPanel.IsPoppedOut = $false
$collectionsPanel.IsPoppedOut = $false
if (-not [string]::IsNullOrWhiteSpace($currentSelectedPanelId) -and @($blenderProgram.Panels | Where-Object { [string]$_.Id -eq $currentSelectedPanelId }).Count -gt 0) {
    $blenderProgram.SelectedPanelId = $currentSelectedPanelId
}
elseif ($lastImportedPanel) {
    $blenderProgram.SelectedPanelId = [string]$lastImportedPanel.Id
}
elseif (@($blenderProgram.Panels).Count -gt 0) {
    $blenderProgram.SelectedPanelId = [string]$blenderProgram.Panels[0].Id
}

$importedFileButtons = if ($importedPanelButtonMap.ContainsKey('files')) { @($importedPanelButtonMap['files'].Buttons) } else { @() }
$importedUtilityButtons = if ($importedPanelButtonMap.ContainsKey('utility')) { @($importedPanelButtonMap['utility'].Buttons) } else { @() }
$importedEditButtons = if ($importedPanelButtonMap.ContainsKey('edit')) { @($importedPanelButtonMap['edit'].Buttons) } else { @() }
$importedCollectionButtons = if ($importedPanelButtonMap.ContainsKey('collections')) { @($importedPanelButtonMap['collections'].Buttons) } else { @() }

$json = $flowState | ConvertTo-Json -Depth 8
Write-FlowCellTextFile -Path $flowCellStatePath -Value $json -Encoding UTF8

$layoutPaths = @(
    Join-Path $flowCellLayoutsRoot 'main.flowlayout.json'
    Join-Path $flowCellLayoutsRoot 'last_layout.json'
)

foreach ($layoutPath in $layoutPaths) {
    if (-not (Test-Path -LiteralPath $layoutPath -PathType Leaf)) {
        continue
    }

    try {
        $layoutPayload = Get-Content -LiteralPath $layoutPath -Raw | ConvertFrom-Json
        $layoutState = if ($layoutPayload.PSObject.Properties['FlowCellState'] -and $layoutPayload.FlowCellState) {
            $layoutPayload.FlowCellState
        }
        else {
            $layoutPayload
        }

        if (-not ($layoutState.PSObject.Properties['Programs']) -or $null -eq $layoutState.Programs) {
            continue
        }

        $layoutBlenderProgram = @($layoutState.Programs | Where-Object { [int]$_.ProgramTabId -eq 3 } | Select-Object -First 1)
        if (@($layoutBlenderProgram).Count -eq 0) {
            continue
        }
        $layoutBlenderProgram = $layoutBlenderProgram[0]

        foreach ($sourcePanel in @($blenderProgram.Panels)) {
            $targetPanel = @($layoutBlenderProgram.Panels | Where-Object {
                [string]$_.Id -eq [string]$sourcePanel.Id -or [string]$_.Name -ieq [string]$sourcePanel.Name
            } | Select-Object -First 1)
            if (@($targetPanel).Count -eq 0) {
                continue
            }
            $targetPanel[0].Buttons = @($sourcePanel.Buttons)
        }

        Write-FlowCellTextFile -Path $layoutPath -Value ($layoutPayload | ConvertTo-Json -Depth 12) -Encoding UTF8
    }
    catch {
        Write-Warning ('Could not update layout {0}: {1}' -f $layoutPath, $_.Exception.Message)
    }
}

Write-Output ('Imported {0} Blender buttons into FlowCell. Files={1}; Utility={2}; Edit={3}; Collections={4}' -f @($importedButtons).Count, @($importedFileButtons).Count, @($importedUtilityButtons).Count, @($importedEditButtons).Count, @($importedCollectionButtons).Count)

