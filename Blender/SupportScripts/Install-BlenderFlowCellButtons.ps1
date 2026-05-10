param(
    [string[]]$SelectedPaths = @(),
    [Parameter(Mandatory = $true)]
    [string]$PanelName,
    [string]$ConfigPath = '',
    [string]$BridgeFolder = '',
    [switch]$SkipSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectRoot = Join-Path $repoRoot 'Blender'
$wrapperRoot = Join-Path $projectRoot 'FlowCellButtons'
$managedActionRoot = Join-Path $projectRoot 'ManagedActions'
$supportRoot = Join-Path $projectRoot 'SupportScripts'
$bridgeLayoutPath = Join-Path $supportRoot 'FlowCellBlenderBridgeLayout.ps1'
$syncScriptPath = Join-Path $supportRoot 'Sync-BlenderButtonsToFlowCell.ps1'
$customActionSyncPath = Join-Path $supportRoot 'Sync-BlenderCustomActionCode.ps1'
$localConfigPath = Join-Path $repoRoot 'FlowCell\local\private\blender.config.local.json'
if (-not (Test-Path -LiteralPath $bridgeLayoutPath -PathType Leaf)) {
    throw "Blender bridge layout helper not found: $bridgeLayoutPath"
}
. $bridgeLayoutPath
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) { $localConfigPath } else { Join-Path $projectRoot 'config.json' }
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Blender config not found: $ConfigPath"
}

New-Item -ItemType Directory -Path $wrapperRoot -Force | Out-Null
New-Item -ItemType Directory -Path $managedActionRoot -Force | Out-Null

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($null -eq $config.buttons) { $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() }
$config.buttons = @($config.buttons)
$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
$BridgeFolder = [string]$bridgeLayout.BridgeFolder

New-Item -ItemType Directory -Path $BridgeFolder -Force | Out-Null
$customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
$addonRoot = [string]$bridgeLayout.AddonRoot
$addonActionsPath = [string]$bridgeLayout.AddonActionsPath
$addonBridgePath = [string]$bridgeLayout.AddonBridgePath

$registry = [pscustomobject]@{ actions = @() }
if (Test-Path -LiteralPath $customRegistryPath -PathType Leaf) {
    try {
        $registry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
        if ($null -eq $registry.actions) { $registry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force }
    }
    catch {
        $registry = [pscustomobject]@{ actions = @() }
    }
}
$registry.actions = @($registry.actions)

function Get-SafeName([string]$Value) {
    $safe = (($Value -replace '[^A-Za-z0-9]+', '_').Trim('_')).ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($safe)) { return 'button' }
    return $safe
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

function Get-UniqueActionName([string]$BaseName, [System.Collections.Generic.HashSet[string]]$Taken) {
    $candidate = $BaseName
    $suffix = 2
    while ($Taken.Contains($candidate)) {
        $candidate = ('{0}_{1}' -f $BaseName, $suffix)
        $suffix++
    }
    [void]$Taken.Add($candidate)
    return $candidate
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
            if ($indent -le $baseIndent -and $line -match '^\s*(def|class)\s+') { break }
        }
        [void]$sourceLines.Add($line)
    }

    return [pscustomobject]@{
        FunctionName = $functionName
        StartLine = $startLine
        SourceText = ($sourceLines -join "`r`n")
    }
}

function Get-PythonTopLevelFunctionNames([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @()
    }

    $names = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Get-Content -LiteralPath $Path)) {
        if ([string]$line -match '^(?<indent>[ \t]*)def\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(' -and [string]$matches['indent'] -eq '') {
            [void]$names.Add([string]$matches['name'])
        }
    }

    return @($names.ToArray())
}

function Test-FlowCellCustomEntrypointName([string]$FunctionName) {
    if ([string]::IsNullOrWhiteSpace($FunctionName)) {
        return $false
    }

    return ([string]$FunctionName -ieq 'run_flowcell_action') -or
        ([string]$FunctionName -ieq 'main') -or
        ([string]$FunctionName -imatch '^perform_[A-Za-z0-9_]*$')
}

function Get-FlowCellCustomEntrypointMetadata([string]$Path, [string]$PreferredFunctionName = '') {
    $availableFunctions = @(Get-PythonTopLevelFunctionNames -Path $Path)
    $baseFailure = [pscustomobject]@{
        FunctionName = ''
        StartLine = 1
        SourceText = ''
        AvailableFunctions = $availableFunctions
        Reason = 'Custom Blender button Python files must expose run_flowcell_action, main, or a perform_* function.'
    }

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $baseFailure
    }

    if (-not [string]::IsNullOrWhiteSpace($PreferredFunctionName)) {
        if (-not (Test-FlowCellCustomEntrypointName -FunctionName $PreferredFunctionName)) {
            return $baseFailure
        }

        $preferredMeta = Get-PythonFunctionMetadata -Path $Path -PreferredFunctionName $PreferredFunctionName
        if ([string]$preferredMeta.FunctionName -ieq [string]$PreferredFunctionName) {
            return [pscustomobject]@{
                FunctionName = [string]$preferredMeta.FunctionName
                StartLine = [int]$preferredMeta.StartLine
                SourceText = [string]$preferredMeta.SourceText
                AvailableFunctions = $availableFunctions
                Reason = ''
            }
        }

        return $baseFailure
    }

    foreach ($candidateName in @('run_flowcell_action', 'main')) {
        $candidateMeta = Get-PythonFunctionMetadata -Path $Path -PreferredFunctionName $candidateName
        if ([string]$candidateMeta.FunctionName -ieq $candidateName) {
            return [pscustomobject]@{
                FunctionName = [string]$candidateMeta.FunctionName
                StartLine = [int]$candidateMeta.StartLine
                SourceText = [string]$candidateMeta.SourceText
                AvailableFunctions = $availableFunctions
                Reason = ''
            }
        }
    }

    foreach ($candidateName in @($availableFunctions | Where-Object { [string]$_ -imatch '^perform_[A-Za-z0-9_]*$' })) {
        $candidateMeta = Get-PythonFunctionMetadata -Path $Path -PreferredFunctionName ([string]$candidateName)
        if ([string]$candidateMeta.FunctionName -ieq [string]$candidateName) {
            return [pscustomobject]@{
                FunctionName = [string]$candidateMeta.FunctionName
                StartLine = [int]$candidateMeta.StartLine
                SourceText = [string]$candidateMeta.SourceText
                AvailableFunctions = $availableFunctions
                Reason = ''
            }
        }
    }

    return $baseFailure
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

function Get-SourceMetadataForAction([string]$ActionName) {
    $map = Get-BridgeActionFunctionMap
    if ([string]::IsNullOrWhiteSpace($ActionName) -or -not $map.ContainsKey($ActionName)) { return $null }
    $functionName = [string]$map[$ActionName]

    if ($functionName -eq 'perform_batch_rename_selected_objects' -and (Test-Path -LiteralPath $addonBridgePath -PathType Leaf)) {
        $meta = Get-PythonFunctionMetadata -Path $addonBridgePath -PreferredFunctionName $functionName
        return [pscustomobject]@{ PythonPath = $addonBridgePath; FunctionName = $meta.FunctionName; StartLine = [int]$meta.StartLine; SourceText = [string]$meta.SourceText }
    }

    if (Test-Path -LiteralPath $addonActionsPath -PathType Leaf) {
        $meta = Get-PythonFunctionMetadata -Path $addonActionsPath -PreferredFunctionName $functionName
        return [pscustomobject]@{ PythonPath = $addonActionsPath; FunctionName = $meta.FunctionName; StartLine = [int]$meta.StartLine; SourceText = [string]$meta.SourceText }
    }

    return $null
}

function Get-PrimaryWrapperAction([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { return '' }
    $raw = Get-Content -LiteralPath $ScriptPath -Raw
    $matches = [Regex]::Matches($raw, "-Action\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($matches.Count -eq 0) { return '' }
    foreach ($match in @($matches)) {
        $value = [string]$match.Groups[1].Value
        if ($value -ieq 'get_selected_objects') { continue }
        return $value
    }
    return [string]$matches[0].Groups[1].Value
}

function Get-TopDescription([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $lines = @(Get-Content -LiteralPath $Path -TotalCount 32)
    foreach ($line in $lines) {
        if ([string]$line -match '^\s*#\s*Description\s*:\s*(.+)$') { return [string]$matches[1].Trim() }
        if (-not [string]::IsNullOrWhiteSpace([string]$line) -and [string]$line -notmatch '^\s*#') { break }
    }
    return ''
}

function Convert-TextToCommentLines([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return @('# (No source text was available.)') }
    $normalized = $Text -replace "`r`n", "`n"
    return @(($normalized -split "`n", -1) | ForEach-Object { '# ' + [string]$_ })
}

function Update-WrapperMetadata([string]$WrapperPath, [string]$FallbackDescription = '') {
    if ([string]::IsNullOrWhiteSpace($WrapperPath) -or -not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)) { return }
    $actionName = Get-PrimaryWrapperAction -ScriptPath $WrapperPath
    if ([string]::IsNullOrWhiteSpace($actionName)) { return }

    $sourceMeta = $null
    foreach ($entry in @($registry.actions)) {
        if ([string]$entry.action -ieq $actionName) {
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
            $sourceMeta = [pscustomobject]@{
                PythonPath = $registryPythonPath
                FunctionName = if ([string]::IsNullOrWhiteSpace($registryFunctionName)) { [string]$meta.FunctionName } else { $registryFunctionName }
                StartLine = [int]$meta.StartLine
                SourceText = [string]$meta.SourceText
            }
            break
        }
    }
    if ($null -eq $sourceMeta) { $sourceMeta = Get-SourceMetadataForAction -ActionName $actionName }
    if ($null -eq $sourceMeta) { return }

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
        $description = if (-not [string]::IsNullOrWhiteSpace($FallbackDescription)) { $FallbackDescription } else { ('Run Blender action {0} through the FlowCell bridge.' -f $actionName) }
    }
    $description = Get-PreferredActionDescription -ActionName $actionName -CurrentDescription $description

    $header = @(
        ('# Description: {0}' -f $description),
        '',
        ('# Source Python File: {0}' -f [string]$sourceMeta.PythonPath),
        '',
        ('# Source Action Function: {0}' -f [string]$sourceMeta.FunctionName),
        ('# Source Action Start Line: {0}' -f [int]$sourceMeta.StartLine),
        '',
        '# Source Action Logic:',
        ''
    ) + @(Convert-TextToCommentLines -Text ([string]$sourceMeta.SourceText))

    $newLines = @($header)
    if (@($bodyLines).Count -gt 0) { $newLines += @('') + @($bodyLines) }
    Write-FlowCellTextFile -Path $WrapperPath -Value (($newLines -join "`r`n") + "`r`n") -Encoding ASCII
}

$takenActionNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($button in @($config.buttons)) {
    if ($button.PSObject.Properties['action'] -and -not [string]::IsNullOrWhiteSpace([string]$button.action)) { [void]$takenActionNames.Add([string]$button.action) }
    if ($button.PSObject.Properties['localAction'] -and -not [string]::IsNullOrWhiteSpace([string]$button.localAction)) { [void]$takenActionNames.Add([string]$button.localAction) }
}
foreach ($entry in @($registry.actions)) {
    if ($entry.PSObject.Properties['action'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.action)) { [void]$takenActionNames.Add([string]$entry.action) }
}

$installResults = New-Object System.Collections.Generic.List[object]
$addedConfigButtons = 0
$updatedConfigButtons = 0
$registeredActions = 0
$regeneratedFlowcellActions = $false
$syncedFlowCellButtons = $false
$callableCheckStatus = 'skipped'
$statusMessage = ''

foreach ($selectedPathRaw in @($SelectedPaths)) {
    $selectedPath = [string]$selectedPathRaw
    if ([string]::IsNullOrWhiteSpace($selectedPath)) { continue }

    try { $fullPath = [System.IO.Path]::GetFullPath($selectedPath) }
    catch {
        $installResults.Add([pscustomobject]@{ Source = $selectedPath; Installed = $false; Message = 'Invalid path.' }) | Out-Null
        continue
    }

    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        $installResults.Add([pscustomobject]@{ Source = $fullPath; Installed = $false; Message = 'File not found.' }) | Out-Null
        continue
    }

    try {
        $extension = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
        if ($extension -notin @('.py', '.ps1')) {
            $installResults.Add([pscustomobject]@{ Source = $fullPath; Installed = $false; Message = 'Only .py and .ps1 files are supported for Blender Add Button.' }) | Out-Null
            continue
        }

        $label = [System.IO.Path]::GetFileNameWithoutExtension($fullPath)
        if ([string]::IsNullOrWhiteSpace($label)) { $label = 'button' }
        $safeLabel = Get-SafeName $label
        $actionName = Get-UniqueActionName -BaseName ('{0}{1}' -f [string]$bridgeLayout.GeneratedActionPrefix, $safeLabel) -Taken $takenActionNames
        $description = Get-TopDescription -Path $fullPath
        if ([string]::IsNullOrWhiteSpace($description)) { $description = ('Run {0} through the {1} Blender bridge.' -f $label, [string]$bridgeLayout.AddonDisplayName) }

        $pythonPath = ''
        $functionName = ''
        $startLine = 1
        $sourceMeta = $null

        if ($extension -eq '.py') {
            $entrypointMeta = Get-FlowCellCustomEntrypointMetadata -Path $fullPath
            if ([string]::IsNullOrWhiteSpace([string]$entrypointMeta.FunctionName)) {
                $availableFunctions = @($entrypointMeta.AvailableFunctions)
                $availableSummary = if ($availableFunctions.Count -gt 0) {
                    ' Found top-level functions: ' + (($availableFunctions | ForEach-Object { "'$_'" }) -join ', ') + '.'
                }
                else {
                    ' No top-level Python functions were found.'
                }
                $installResults.Add([pscustomobject]@{
                    Source = $fullPath
                    Installed = $false
                    Message = ([string]$entrypointMeta.Reason + $availableSummary)
                }) | Out-Null
                continue
            }

            $managedPythonPath = Join-Path $managedActionRoot ('{0}.py' -f $actionName)
            Copy-Item -LiteralPath $fullPath -Destination $managedPythonPath -Force
            $meta = Get-PythonFunctionMetadata -Path $managedPythonPath -PreferredFunctionName ([string]$entrypointMeta.FunctionName)
            $pythonPath = $managedPythonPath
            $functionName = [string]$meta.FunctionName
            $startLine = [int]$meta.StartLine
            $sourceMeta = [pscustomobject]@{ PythonPath = $pythonPath; FunctionName = $functionName; StartLine = $startLine; SourceText = [string]$meta.SourceText }
        }
        else {
            $mappedAction = Get-PrimaryWrapperAction -ScriptPath $fullPath
            if ([string]::IsNullOrWhiteSpace($mappedAction)) {
                $installResults.Add([pscustomobject]@{ Source = $fullPath; Installed = $false; Message = 'Could not resolve a Blender action from this .ps1 file.' }) | Out-Null
                continue
            }
            $resolvedMeta = Get-SourceMetadataForAction -ActionName $mappedAction
            if ($null -eq $resolvedMeta) {
                $installResults.Add([pscustomobject]@{ Source = $fullPath; Installed = $false; Message = ('Could not resolve Python source for action ''{0}''.' -f $mappedAction) }) | Out-Null
                continue
            }
            $pythonPath = [string]$resolvedMeta.PythonPath
            $functionName = [string]$resolvedMeta.FunctionName
            $startLine = [int]$resolvedMeta.StartLine
            $sourceMeta = $resolvedMeta
        }

        $wrapperName = ('{0}{1}.ps1' -f (Get-FlowCellButtonPrefix -PanelName $PanelName), $safeLabel)
        $wrapperPath = Join-Path $wrapperRoot $wrapperName
        $wrapperLines = @(
            '$ErrorActionPreference = ''Stop''',
            '$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) ''SupportScripts''',
            '$dispatcherPath = Join-Path $supportRoot ''Invoke-BlenderFlowCellAction.ps1''',
            ("& `$dispatcherPath -Action '{0}' -Label '{1}'" -f ($actionName -replace "'","''"), ($label -replace "'","''")),
            'exit $LASTEXITCODE'
        )
        Write-FlowCellTextFile -Path $wrapperPath -Value (($wrapperLines -join "`r`n") + "`r`n") -Encoding ASCII

        $existingButton = @($config.buttons | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $actionName } | Select-Object -First 1)
        if (@($existingButton).Count -gt 0) {
            $existingButton[0].label = [string]$label
            $existingButton[0].tooltip = [string](Get-PreferredActionDescription -ActionName $actionName -CurrentDescription $description)
            $existingButton[0].panel = [string]$PanelName
            $updatedConfigButtons++
        }
        else {
            $config.buttons = @($config.buttons) + @([pscustomobject]@{
                label = [string]$label
                tooltip = [string](Get-PreferredActionDescription -ActionName $actionName -CurrentDescription $description)
                action = [string]$actionName
                panel = [string]$PanelName
            })
            $addedConfigButtons++
        }

        $existingEntry = @($registry.actions | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $actionName } | Select-Object -First 1)
        if (@($existingEntry).Count -gt 0) {
            $existingEntry[0].pythonPath = [string]$pythonPath
            $existingEntry[0].functionName = [string]$functionName
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourcePythonPath -Value ([string]$pythonPath) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourceFunctionName -Value ([string]$functionName) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name startLine -Value ([int]$startLine) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name description -Value ([string]$description) -Force
        }
        else {
            $registry.actions = @($registry.actions) + @([pscustomobject]@{
                action = [string]$actionName
                pythonPath = [string]$pythonPath
                functionName = [string]$functionName
                sourcePythonPath = [string]$pythonPath
                sourceFunctionName = [string]$functionName
                startLine = [int]$startLine
                description = [string]$description
            })
            $registeredActions++
        }

        Update-WrapperMetadata -WrapperPath $wrapperPath -FallbackDescription $description

        $installResults.Add([pscustomobject]@{
            Source = $fullPath
            Installed = $true
            Action = $actionName
            WrapperPath = $wrapperPath
            PythonPath = $pythonPath
            FunctionName = $functionName
        }) | Out-Null
    }
    catch {
        $installResults.Add([pscustomobject]@{
            Source = $fullPath
            Installed = $false
            Message = $_.Exception.Message
        }) | Out-Null
        continue
    }
}

Write-FlowCellTextFile -Path $ConfigPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8
Write-FlowCellTextFile -Path $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8

if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
    & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $BridgeFolder | Out-Null
    $regeneratedFlowcellActions = $true
    if (Test-Path -LiteralPath $customRegistryPath -PathType Leaf) {
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

foreach ($wrapper in @(Get-ChildItem -LiteralPath $wrapperRoot -Filter '*.ps1' -File -ErrorAction SilentlyContinue)) {
    try {
        Update-WrapperMetadata -WrapperPath $wrapper.FullName
    }
    catch {
        Write-Warning $_.Exception.Message
    }
}

if (-not $SkipSync -and (Test-Path -LiteralPath $syncScriptPath -PathType Leaf)) {
    & $syncScriptPath | Out-Null
    $syncedFlowCellButtons = $true
}

$reloadRequired = $false
$reloadReason = ''
$firstInstalled = @($installResults | Where-Object { [bool]$_.Installed } | Select-Object -First 1)
if (@($firstInstalled).Count -gt 0) {
    $dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
    if (Test-Path -LiteralPath $dispatcherPath -PathType Leaf) {
        $response = & $dispatcherPath -Action ([string]$firstInstalled[0].Action) -Label ([string]$firstInstalled[0].Action) -PassThruResponse -SuppressToast 2>$null
        if ($LASTEXITCODE -ne 0) {
            $reloadRequired = $true
            $reloadReason = ('Blender must reload the addon or restart to use newly registered action ''{0}''.' -f [string]$firstInstalled[0].Action)
            $callableCheckStatus = 'reload_required'
        }
        elseif ($response -and $response.PSObject.Properties['status'] -and [string]$response.status -ne 'ok') {
            $reloadRequired = $true
            $reloadReason = ('Blender addon reported ''{0}'' for action ''{1}'' from {2}. Reload or restart Blender.' -f [string]$response.message, [string]$firstInstalled[0].Action, [string]$bridgeLayout.BridgeFolderName)
            $callableCheckStatus = 'reload_required'
        }
        else {
            $callableCheckStatus = 'callable'
        }
    }
}

$installedCount = @($installResults | Where-Object { [bool]$_.Installed }).Count
$failedCount = @($installResults | Where-Object { -not [bool]$_.Installed }).Count
$buttonWord = if ($installedCount -eq 1) { 'button' } else { 'buttons' }

if ($installedCount -le 0) {
    $statusMessage = 'No Blender buttons were installed. Check logs for skipped files.'
}
else {
    $phaseMessage = 'Installed {0} Blender {1} on {2}. Registered the {3} sandbox action, regenerated {4}, synced FlowTest buttons only,' -f $installedCount, $buttonWord, $PanelName, [string]$bridgeLayout.BridgeFolderName, [string]$bridgeLayout.AddonActionsFileName
    switch ([string]$callableCheckStatus) {
        'callable' {
            $statusMessage = $phaseMessage + ' and verified the action is callable.'
        }
        'reload_required' {
            $statusMessage = $phaseMessage + ' and determined Blender must reload the addon or restart before the action is callable.'
        }
        default {
            $statusMessage = $phaseMessage + ' and skipped the callable check.'
        }
    }
    if ($failedCount -gt 0) {
        $statusMessage += (' Skipped {0} file(s).' -f $failedCount)
    }
}

[pscustomobject]@{
    InstalledCount = $installedCount
    FailedCount = $failedCount
    AddedConfigButtons = $addedConfigButtons
    UpdatedConfigButtons = $updatedConfigButtons
    RegisteredActions = $registeredActions
    RegeneratedFlowcellActions = $regeneratedFlowcellActions
    SyncedFlowCellButtons = $syncedFlowCellButtons
    CallableCheckStatus = $callableCheckStatus
    ConfigPath = $ConfigPath
    RegistryPath = $customRegistryPath
    ReloadRequired = $reloadRequired
    ReloadReason = $reloadReason
    StatusMessage = $statusMessage
    AddonActionsFileName = [string]$bridgeLayout.AddonActionsFileName
    BridgeFolder = [string]$BridgeFolder
    Results = @($installResults.ToArray())
} | ConvertTo-Json -Depth 8


