param(
    [string]$ConfigPath = '',
    [string]$BridgeFolder = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$projectRoot = Join-Path $repoRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    $projectRoot = Join-Path $repoRoot 'Blender'
}
$supportRoot = Join-Path $projectRoot 'SupportScripts'
$bridgeLayoutPath = Join-Path $supportRoot 'FlowCellBlenderBridgeLayout.ps1'
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

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
$BridgeFolder = [string]$bridgeLayout.BridgeFolder
Ensure-FlowCellBlenderBridgeRuntime -Layout $bridgeLayout
$script:FlowCellGeneratedFunctionPrefix = [string]$bridgeLayout.GeneratedFunctionPrefix
$script:FlowCellGeneratedSourceRunNamePrefix = [string]$bridgeLayout.GeneratedSourceRunNamePrefix
$customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
$addonActionsPath = [string]$bridgeLayout.AddonActionsPath
if (-not (Test-Path -LiteralPath $addonActionsPath -PathType Leaf)) {
    throw "Live Blender actions file not found: $addonActionsPath"
}

$registry = [pscustomobject]@{ actions = @() }
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

function Get-FlowCellBundledCustomRegistryPath {
    $bridgeFolderName = [string]$bridgeLayout.BridgeFolderName
    $customActionsFileName = [string]$bridgeLayout.CustomActionsFileName
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName) -or [string]::IsNullOrWhiteSpace($customActionsFileName)) {
        return ''
    }

    $candidate = Join-Path $projectRoot ('Blender Addons - Copy contents Into Blender\{0}\{1}' -f $bridgeFolderName, $customActionsFileName)
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
    }

    return ''
}

function Resolve-FlowCellBundledActionSourcePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BundledRegistryPath,
        [Parameter(Mandatory = $true)]
        [object]$Entry
    )

    $sourcePythonPath = [string](Get-FlowCellObjectPropertyValue -InputObject $Entry -Name 'sourcePythonPath')
    if ([string]::IsNullOrWhiteSpace($sourcePythonPath)) {
        $sourcePythonPath = [string](Get-FlowCellObjectPropertyValue -InputObject $Entry -Name 'pythonPath')
    }
    if ([string]::IsNullOrWhiteSpace($sourcePythonPath)) {
        return ''
    }

    $managedSourcePath = Join-Path (Join-Path $projectRoot 'ManagedActions') (Split-Path -Leaf $sourcePythonPath)
    if (Test-Path -LiteralPath $managedSourcePath -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($managedSourcePath)
    }

    try {
        if ([System.IO.Path]::IsPathRooted($sourcePythonPath)) {
            $absolutePath = [System.IO.Path]::GetFullPath($sourcePythonPath)
            if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
                return $absolutePath
            }
        }
    }
    catch {
    }

    $addonTemplateRoot = Split-Path -Parent (Split-Path -Parent $BundledRegistryPath)
    $templateSourcePath = Join-Path $addonTemplateRoot $sourcePythonPath
    if (Test-Path -LiteralPath $templateSourcePath -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($templateSourcePath)
    }

    return ''
}

function Get-FlowCellRequiredBundledActionNames {
    $requiredActions = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($button in @($config.buttons)) {
        $actionName = [string](Get-FlowCellObjectPropertyValue -InputObject $button -Name 'action')
        if ([string]::IsNullOrWhiteSpace($actionName)) {
            continue
        }
        [void]$requiredActions.Add($actionName.Trim())
        if ($actionName.Trim() -ieq 'flowcell_custom_theme' -or $actionName.Trim() -ieq 'flowcell_custom_hdri_world_tools') {
            [void]$requiredActions.Add('custom_hdri_world_tools')
        }
    }

    return $requiredActions
}

function Merge-FlowCellBundledCustomActions {
    $bundledRegistryPath = Get-FlowCellBundledCustomRegistryPath
    if ([string]::IsNullOrWhiteSpace($bundledRegistryPath)) {
        return
    }

    try {
        $bundledRegistry = Get-Content -LiteralPath $bundledRegistryPath -Raw | ConvertFrom-Json
    }
    catch {
        return
    }
    if ($null -eq $bundledRegistry.actions) {
        return
    }

    $requiredActions = Get-FlowCellRequiredBundledActionNames
    if ($requiredActions.Count -eq 0) {
        return
    }

    $existingActions = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in @($registry.actions)) {
        $actionName = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'action')
        if (-not [string]::IsNullOrWhiteSpace($actionName)) {
            [void]$existingActions.Add($actionName.Trim())
        }
    }

    $mergedActions = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($registry.actions)) {
        if ($null -ne $entry) {
            [void]$mergedActions.Add($entry)
        }
    }

    foreach ($entry in @($bundledRegistry.actions)) {
        $actionName = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'action')
        if ([string]::IsNullOrWhiteSpace($actionName)) {
            continue
        }
        $actionName = $actionName.Trim()
        if (-not $requiredActions.Contains($actionName) -or $existingActions.Contains($actionName)) {
            continue
        }

        $sourcePythonPath = Resolve-FlowCellBundledActionSourcePath -BundledRegistryPath $bundledRegistryPath -Entry $entry
        if ([string]::IsNullOrWhiteSpace($sourcePythonPath)) {
            continue
        }

        $entryMap = [ordered]@{}
        foreach ($prop in @($entry.PSObject.Properties)) {
            $entryMap[[string]$prop.Name] = $prop.Value
        }
        $entryMap.action = $actionName
        $entryMap.pythonPath = $sourcePythonPath
        $entryMap.sourcePythonPath = $sourcePythonPath
        if (-not $entryMap.Contains('sourceFunctionName')) {
            $entryMap.sourceFunctionName = ''
        }
        if (-not $entryMap.Contains('functionName')) {
            $entryMap.functionName = ''
        }
        [void]$mergedActions.Add([pscustomobject]$entryMap)
        [void]$existingActions.Add($actionName)
    }

    $registry.actions = @($mergedActions.ToArray())
}

function Get-SafePythonIdentifier([string]$Value) {
    $safe = ($Value -replace '[^A-Za-z0-9_]+', '_').Trim('_')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        $safe = 'custom_action'
    }
    if ($safe -match '^[0-9]') {
        $safe = 'custom_' + $safe
    }
    return $safe.ToLowerInvariant()
}

function New-FlowCellCustomWrapperFunctionName([string]$ActionName) {
    return ('{0}{1}' -f $script:FlowCellGeneratedFunctionPrefix, (Get-SafePythonIdentifier -Value $ActionName))
}

function ConvertTo-PythonStringLiteral([string]$Value) {
    $text = if ($null -ne $Value) { [string]$Value } else { '' }
    $text = $text -replace '\\', '\\\\'
    $text = $text -replace "'", "\\'"
    $text = $text -replace "`r", '\r'
    $text = $text -replace "`n", '\n'
    return ("'{0}'" -f $text)
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
        return [pscustomobject]@{
            FunctionName = ''
            StartLine = 1
            SourceText = ($lines -join "`r`n")
        }
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

function Convert-TextToCommentLines([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) {
        return @('# (No source text was available.)')
    }

    $normalized = $Text -replace "`r`n", "`n"
    return @(($normalized -split "`n", -1) | ForEach-Object { '# ' + [string]$_ })
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, [string]$Content, $utf8NoBom)
}

function Set-GeneratedCustomSection([string]$Path, [string]$SectionText) {
    $raw = Get-Content -LiteralPath $Path -Raw
    $pattern = '(?s)\r?\n?# FLOWCELL CUSTOM ACTIONS START - AUTO-GENERATED.*?# FLOWCELL CUSTOM ACTIONS END - AUTO-GENERATED\r?\n?'
    $sectionRegex = New-Object System.Text.RegularExpressions.Regex($pattern)

    if ($sectionRegex.IsMatch($raw)) {
        $replacement = if ([string]::IsNullOrWhiteSpace($SectionText)) { '' } else { "`r`n`r`n$SectionText`r`n" }
        $raw = $sectionRegex.Replace($raw, $replacement, 1)
    }
    elseif (-not [string]::IsNullOrWhiteSpace($SectionText)) {
        $raw = $raw.TrimEnd("`r", "`n") + "`r`n`r`n" + $SectionText + "`r`n"
    }

    Write-Utf8NoBomFile -Path $Path -Content $raw
}

function Get-FlowCellObjectPropertyValue {
    param(
        [object]$InputObject,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $InputObject -or [string]::IsNullOrWhiteSpace($Name)) {
        return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        if ($InputObject.Contains($Name)) {
            return $InputObject[$Name]
        }
        return $null
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-FlowCellLegacyFlowCellBridgeRoot {
    $blenderAppDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (-not (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container)) {
        return ''
    }

    $versionDirectory = Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($null -eq $versionDirectory) {
        return ''
    }

    $bridgeRoot = Join-Path $versionDirectory.FullName 'scripts\addons\blender_bridge_flowcell'
    if (-not (Test-Path -LiteralPath $bridgeRoot -PathType Container)) {
        return ''
    }

    return $bridgeRoot
}

function Sync-LegacyFlowCellCompatibilityRegistry {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$NormalizedEntries
    )

    $legacyBridgeRoot = Get-FlowCellLegacyFlowCellBridgeRoot
    if ([string]::IsNullOrWhiteSpace($legacyBridgeRoot)) {
        return $null
    }

    $legacyRegistryPath = Join-Path $legacyBridgeRoot 'flowcell_custom_actions.json'
    $legacyRegistry = [pscustomobject]@{ actions = @() }
    if (Test-Path -LiteralPath $legacyRegistryPath -PathType Leaf) {
        try {
            $legacyRegistry = Get-Content -LiteralPath $legacyRegistryPath -Raw | ConvertFrom-Json
            if ($null -eq $legacyRegistry.actions) {
                $legacyRegistry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force
            }
        }
        catch {
            $legacyRegistry = [pscustomobject]@{ actions = @() }
        }
    }

    $legacyEntries = New-Object System.Collections.Generic.List[object]
    foreach ($entry in @($legacyRegistry.actions)) {
        if ($null -eq $entry) {
            continue
        }

        $legacyActionName = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'action')
        if ($legacyActionName -ieq 'flowcell_custom_rotate') {
            continue
        }

        [void]$legacyEntries.Add($entry)
    }

    foreach ($entry in @($NormalizedEntries)) {
        $actionName = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'action')
        if ($actionName -ine 'flowcell_custom_rotate') {
            continue
        }

        $description = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'description')
        $sourcePythonPath = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'sourcePythonPath')
        $sourceFunctionName = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'sourceFunctionName')
        $startLine = Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'startLine'
        if ([string]::IsNullOrWhiteSpace($sourcePythonPath) -or [string]::IsNullOrWhiteSpace($sourceFunctionName)) {
            continue
        }

        $compatEntry = [pscustomobject][ordered]@{
            action = $actionName
            description = $description
            pythonPath = $sourcePythonPath
            functionName = $sourceFunctionName
            sourcePythonPath = $sourcePythonPath
            sourceFunctionName = $sourceFunctionName
            startLine = $startLine
        }
        [void]$legacyEntries.Add($compatEntry)
    }

    $legacyRegistry.actions = @($legacyEntries.ToArray())
    Set-Content -LiteralPath $legacyRegistryPath -Value ($legacyRegistry | ConvertTo-Json -Depth 8) -Encoding UTF8

    return [pscustomobject]@{
        RegistryPath = $legacyRegistryPath
        CompatibilityActions = @($legacyRegistry.actions | Where-Object {
            [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'action') -ieq 'flowcell_custom_rotate'
        }).Count
    }
}

Merge-FlowCellBundledCustomActions

$normalizedEntries = New-Object System.Collections.Generic.List[object]
$sectionLines = New-Object System.Collections.Generic.List[string]

foreach ($entry in @($registry.actions)) {
    $actionName = [string]$entry.action
    $actionName = $actionName.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($actionName)) {
        continue
    }

    $entryPythonPath = if ($entry.PSObject.Properties['pythonPath']) { [string]$entry.pythonPath } else { '' }
    $sourcePythonPath = if ($entry.PSObject.Properties['sourcePythonPath'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.sourcePythonPath)) {
        [string]$entry.sourcePythonPath
    }
    elseif (-not [string]::IsNullOrWhiteSpace($entryPythonPath) -and $entryPythonPath -ne $addonActionsPath) {
        $entryPythonPath
    }
    else {
        ''
    }
    if ([string]::IsNullOrWhiteSpace($sourcePythonPath)) {
        continue
    }

    try {
        $resolvedSourcePythonPath = [System.IO.Path]::GetFullPath($sourcePythonPath)
    }
    catch {
        $resolvedSourcePythonPath = $sourcePythonPath
    }
    if (-not (Test-Path -LiteralPath $resolvedSourcePythonPath -PathType Leaf)) {
        continue
    }

    $sourceFunctionName = if ($entry.PSObject.Properties['sourceFunctionName'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.sourceFunctionName)) {
        [string]$entry.sourceFunctionName
    }
    elseif (-not [string]::IsNullOrWhiteSpace($entryPythonPath) -and $entryPythonPath -ne $addonActionsPath -and $entry.PSObject.Properties['functionName']) {
        [string]$entry.functionName
    }
    else {
        ''
    }

    $sourceMeta = Get-FlowCellCustomEntrypointMetadata -Path $resolvedSourcePythonPath -PreferredFunctionName $sourceFunctionName
    if ([string]::IsNullOrWhiteSpace([string]$sourceMeta.FunctionName)) {
        continue
    }
    $resolvedFunctionName = [string]$sourceMeta.FunctionName
    $wrapperFunctionName = New-FlowCellCustomWrapperFunctionName -ActionName $actionName
    $entryDescription = if ($entry.PSObject.Properties['description']) { [string]$entry.description } else { '' }

    $entryMap = [ordered]@{
        action = $actionName
    }
    foreach ($prop in @($entry.PSObject.Properties)) {
        if (@('action', 'pythonPath', 'functionName', 'sourcePythonPath', 'sourceFunctionName', 'startLine') -contains [string]$prop.Name) {
            continue
        }
        $entryMap[[string]$prop.Name] = $prop.Value
    }
    $entryMap.pythonPath = $addonActionsPath
    $entryMap.functionName = $wrapperFunctionName
    $entryMap.sourcePythonPath = $resolvedSourcePythonPath
    $entryMap.sourceFunctionName = $resolvedFunctionName
    $entryMap.startLine = [int]$sourceMeta.StartLine
    [void]$normalizedEntries.Add([pscustomobject]$entryMap)

    if ($sectionLines.Count -eq 0) {
        [void]$sectionLines.Add('# FLOWCELL CUSTOM ACTIONS START - AUTO-GENERATED')
        [void]$sectionLines.Add('')
        [void]$sectionLines.Add('def _flowcell_generated_custom_call(action_name: str, source_path: str, function_name: str, context, data):')
        [void]$sectionLines.Add('    script_path = Path(source_path).expanduser()')
        [void]$sectionLines.Add('    if not script_path.exists():')
        [void]$sectionLines.Add('        raise ValueError(f"Custom action script not found: {script_path}")')
        [void]$sectionLines.Add('')
        [void]$sectionLines.Add(('    namespace = runpy.run_path(str(script_path), run_name=f"{0}{{action_name}}")' -f $script:FlowCellGeneratedSourceRunNamePrefix))
        [void]$sectionLines.Add('    callback = namespace.get(function_name) if function_name else None')
        [void]$sectionLines.Add('    if callback is None and not function_name:')
        [void]$sectionLines.Add('        callback = namespace.get("run_flowcell_action") or namespace.get("main")')
        [void]$sectionLines.Add('        if callback is None:')
        [void]$sectionLines.Add('            for name, value in namespace.items():')
        [void]$sectionLines.Add('                if name.startswith("perform_") and callable(value):')
        [void]$sectionLines.Add('                    callback = value')
        [void]$sectionLines.Add('                    break')
        [void]$sectionLines.Add('')
        [void]$sectionLines.Add('    if callback is None or not callable(callback):')
        [void]$sectionLines.Add('        if function_name:')
        [void]$sectionLines.Add('            raise ValueError(')
        [void]$sectionLines.Add('                f"Custom action ''{action_name}'' could not find function ''{function_name}'' in {script_path}."')
        [void]$sectionLines.Add('            )')
        [void]$sectionLines.Add('        raise ValueError(f"Custom action ''{action_name}'' did not expose a callable entrypoint.")')
        [void]$sectionLines.Add('')
        [void]$sectionLines.Add('    raw_result = _call_custom_action_callable(callback, context or bpy.context, data or {})')
        [void]$sectionLines.Add('    message = f"Completed {action_name}."')
        [void]$sectionLines.Add('    display = ""')
        [void]$sectionLines.Add('    payload: dict[str, object] = {}')
        [void]$sectionLines.Add('    if isinstance(raw_result, dict):')
        [void]$sectionLines.Add('        payload = raw_result')
        [void]$sectionLines.Add('        message = str(payload.get("message", message))')
        [void]$sectionLines.Add('        display = str(payload.get("display", ""))')
        [void]$sectionLines.Add('    elif isinstance(raw_result, str):')
        [void]$sectionLines.Add('        message = raw_result')
        [void]$sectionLines.Add('    elif raw_result is not None:')
        [void]$sectionLines.Add('        message = str(raw_result)')
        [void]$sectionLines.Add('')
        [void]$sectionLines.Add('    return {')
        [void]$sectionLines.Add('        "message": message,')
        [void]$sectionLines.Add('        "display": display,')
        [void]$sectionLines.Add('        **payload,')
        [void]$sectionLines.Add('    }')
    }

    [void]$sectionLines.Add('')
    [void]$sectionLines.Add(('# FlowCell Custom Action: {0}' -f $actionName))
    if (-not [string]::IsNullOrWhiteSpace($entryDescription)) {
        [void]$sectionLines.Add(('# Description: {0}' -f $entryDescription))
    }
    [void]$sectionLines.Add(('# Source Python File: {0}' -f $resolvedSourcePythonPath))
    [void]$sectionLines.Add(('# Source Action Function: {0}' -f $resolvedFunctionName))
    [void]$sectionLines.Add(('# Source Action Start Line: {0}' -f [int]$sourceMeta.StartLine))
    [void]$sectionLines.Add('# Source Action Logic:')
    foreach ($commentLine in @(Convert-TextToCommentLines -Text ([string]$sourceMeta.SourceText))) {
        [void]$sectionLines.Add([string]$commentLine)
    }
    [void]$sectionLines.Add(('def {0}(context=None, data=None):' -f $wrapperFunctionName))
    [void]$sectionLines.Add('    return _flowcell_generated_custom_call(')
    [void]$sectionLines.Add(('        action_name={0},' -f (ConvertTo-PythonStringLiteral -Value $actionName)))
    [void]$sectionLines.Add(('        source_path={0},' -f (ConvertTo-PythonStringLiteral -Value $resolvedSourcePythonPath)))
    [void]$sectionLines.Add(('        function_name={0},' -f (ConvertTo-PythonStringLiteral -Value $resolvedFunctionName)))
    [void]$sectionLines.Add('        context=context,')
    [void]$sectionLines.Add('        data=(data or {}),')
    [void]$sectionLines.Add('    )')
}

if ($sectionLines.Count -gt 0) {
    [void]$sectionLines.Add('')
    [void]$sectionLines.Add('# FLOWCELL CUSTOM ACTIONS END - AUTO-GENERATED')
}

$registry.actions = @($normalizedEntries.ToArray())
Set-Content -LiteralPath $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8

$sectionText = if ($sectionLines.Count -gt 0) { ($sectionLines -join "`r`n") } else { '' }
Set-GeneratedCustomSection -Path $addonActionsPath -SectionText $sectionText

$legacyCompatibility = Sync-LegacyFlowCellCompatibilityRegistry -NormalizedEntries @($normalizedEntries.ToArray())

[pscustomobject]@{
    RegistryPath = $customRegistryPath
    AddonActionsPath = $addonActionsPath
    UpdatedActions = @($registry.actions).Count
    LegacyCompatibilityRegistryPath = if ($null -ne $legacyCompatibility) { [string]$legacyCompatibility.RegistryPath } else { '' }
    LegacyCompatibilityActions = if ($null -ne $legacyCompatibility) { [int]$legacyCompatibility.CompatibilityActions } else { 0 }
} | ConvertTo-Json -Depth 4
