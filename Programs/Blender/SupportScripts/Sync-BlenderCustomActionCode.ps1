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

    $projectSourcePath = Join-Path $projectRoot $sourcePythonPath
    if (Test-Path -LiteralPath $projectSourcePath -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($projectSourcePath)
    }

    $addonTemplateRoot = Split-Path -Parent (Split-Path -Parent $BundledRegistryPath)
    $templateSourcePath = Join-Path $addonTemplateRoot $sourcePythonPath
    if (Test-Path -LiteralPath $templateSourcePath -PathType Leaf) {
        return [System.IO.Path]::GetFullPath($templateSourcePath)
    }

    return ''
}

function Resolve-FlowCellRegistryPythonPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonPath
    )

    if ([string]::IsNullOrWhiteSpace($PythonPath)) {
        return ''
    }

    try {
        if ([System.IO.Path]::IsPathRooted($PythonPath)) {
            $absolutePath = [System.IO.Path]::GetFullPath($PythonPath)
            if (Test-Path -LiteralPath $absolutePath -PathType Leaf) {
                return $absolutePath
            }
            return $absolutePath
        }
    }
    catch {
    }

    $registryRoot = Split-Path -Parent $customRegistryPath
    $addonRoot = Split-Path -Parent $registryRoot
    foreach ($candidate in @(
        (Join-Path $addonRoot $PythonPath),
        (Join-Path $registryRoot $PythonPath),
        (Join-Path $projectRoot $PythonPath)
    )) {
        try {
            $resolvedCandidate = [System.IO.Path]::GetFullPath($candidate)
        }
        catch {
            $resolvedCandidate = $candidate
        }
        if (Test-Path -LiteralPath $resolvedCandidate -PathType Leaf) {
            return $resolvedCandidate
        }
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

function Get-FlowCellNormalizedPathKey([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ''
    }
    try {
        return ([System.IO.Path]::GetFullPath([string]$Path)).TrimEnd('\').ToLowerInvariant()
    }
    catch {
        return ([string]$Path).Trim().TrimEnd('\').ToLowerInvariant()
    }
}

$managedActionRoot = Join-Path $BridgeFolder 'ManagedActions'
New-Item -ItemType Directory -Path $managedActionRoot -Force | Out-Null
$addonActionsPathKey = Get-FlowCellNormalizedPathKey $addonActionsPath
$normalizedEntries = New-Object System.Collections.Generic.List[object]

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

    $resolvedSourcePythonPath = Resolve-FlowCellRegistryPythonPath -PythonPath $sourcePythonPath
    if ([string]::IsNullOrWhiteSpace($resolvedSourcePythonPath)) {
        try {
            $resolvedSourcePythonPath = [System.IO.Path]::GetFullPath($sourcePythonPath)
        }
        catch {
            $resolvedSourcePythonPath = $sourcePythonPath
        }
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

    # Runtime target is always the action's own ManagedActions wrapper — never the shared flowcell_actions.py.
    $resolvedRuntimePythonPath = Resolve-FlowCellRegistryPythonPath -PythonPath $entryPythonPath
    if ([string]::IsNullOrWhiteSpace($resolvedRuntimePythonPath) -or
        (Get-FlowCellNormalizedPathKey $resolvedRuntimePythonPath) -eq $addonActionsPathKey -or
        -not (Test-Path -LiteralPath $resolvedRuntimePythonPath -PathType Leaf)) {
        $resolvedRuntimePythonPath = Join-Path $managedActionRoot ('{0}.py' -f $actionName)
        if (-not (Test-Path -LiteralPath $resolvedRuntimePythonPath -PathType Leaf)) {
            Copy-Item -LiteralPath $resolvedSourcePythonPath -Destination $resolvedRuntimePythonPath -Force
        }
    }

    $preferredRuntimeFunctionName = if ($entry.PSObject.Properties['functionName']) { [string]$entry.functionName } else { '' }
    $runtimeMeta = Get-FlowCellCustomEntrypointMetadata -Path $resolvedRuntimePythonPath -PreferredFunctionName $preferredRuntimeFunctionName
    if ([string]::IsNullOrWhiteSpace([string]$runtimeMeta.FunctionName)) {
        $runtimeMeta = Get-FlowCellCustomEntrypointMetadata -Path $resolvedRuntimePythonPath
    }
    if ([string]::IsNullOrWhiteSpace([string]$runtimeMeta.FunctionName)) {
        continue
    }
    $runtimeFunctionName = [string]$runtimeMeta.FunctionName

    $entryMap = [ordered]@{
        action = $actionName
    }
    foreach ($prop in @($entry.PSObject.Properties)) {
        if (@('action', 'pythonPath', 'functionName', 'sourcePythonPath', 'sourceFunctionName', 'startLine') -contains [string]$prop.Name) {
            continue
        }
        $entryMap[[string]$prop.Name] = $prop.Value
    }
    $entryMap.pythonPath = $resolvedRuntimePythonPath
    $entryMap.functionName = $runtimeFunctionName
    $entryMap.sourcePythonPath = $resolvedSourcePythonPath
    $entryMap.sourceFunctionName = $resolvedFunctionName
    $entryMap.startLine = [int]$sourceMeta.StartLine
    [void]$normalizedEntries.Add([pscustomobject]$entryMap)
}

$registry.actions = @($normalizedEntries.ToArray())
Set-Content -LiteralPath $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8

# Custom actions dispatch per-file from the registry; strip any legacy auto-generated wrapper section.
Set-GeneratedCustomSection -Path $addonActionsPath -SectionText ''

$legacyCompatibility = Sync-LegacyFlowCellCompatibilityRegistry -NormalizedEntries @($normalizedEntries.ToArray())

[pscustomobject]@{
    RegistryPath = $customRegistryPath
    AddonActionsPath = $addonActionsPath
    UpdatedActions = @($registry.actions).Count
    LegacyCompatibilityRegistryPath = if ($null -ne $legacyCompatibility) { [string]$legacyCompatibility.RegistryPath } else { '' }
    LegacyCompatibilityActions = if ($null -ne $legacyCompatibility) { [int]$legacyCompatibility.CompatibilityActions } else { 0 }
} | ConvertTo-Json -Depth 4
