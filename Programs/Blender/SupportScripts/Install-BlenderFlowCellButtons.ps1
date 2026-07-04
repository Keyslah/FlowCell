param(
    [string[]]$SelectedPaths = @(),
    [string]$SelectedPathsJson = '',
    [Parameter(Mandatory = $true)]
    [string]$PanelName,
    [string]$ConfigPath = '',
    [string]$BridgeFolder = '',
    [switch]$SkipSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not [string]::IsNullOrWhiteSpace($SelectedPathsJson)) {
    try {
        $decodedSelectedPaths = ConvertFrom-Json -InputObject $SelectedPathsJson -ErrorAction Stop
        if ($decodedSelectedPaths -is [System.Array]) {
            $SelectedPaths = @($decodedSelectedPaths | ForEach-Object { [string]$_ })
        }
        elseif ($null -eq $decodedSelectedPaths) {
            $SelectedPaths = @()
        }
        else {
            $SelectedPaths = @([string]$decodedSelectedPaths)
        }
    }
    catch {
        throw "Could not parse -SelectedPathsJson for Blender Add Button."
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$projectRoot = Join-Path $repoRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    $projectRoot = Join-Path $repoRoot 'Blender'
}
$managedActionRoot = ''
$supportRoot = Join-Path $projectRoot 'SupportScripts'
$bridgeLayoutPath = Join-Path $supportRoot 'FlowCellBlenderBridgeLayout.ps1'
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

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($null -eq $config.buttons) { $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() }
$config.buttons = @($config.buttons)
$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
$BridgeFolder = [string]$bridgeLayout.BridgeFolder
Ensure-FlowCellBlenderBridgeRuntime -Layout $bridgeLayout

New-Item -ItemType Directory -Path $BridgeFolder -Force | Out-Null
$managedActionRoot = Join-Path $BridgeFolder 'ManagedActions'
New-Item -ItemType Directory -Path $managedActionRoot -Force | Out-Null
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

function Get-FlowCellSupportedCommentBody {
    param([AllowEmptyString()][string]$Line)

    $trimmed = ([string]$Line).TrimStart()
    if ($trimmed.StartsWith('#')) { return $trimmed.Substring(1) }
    if ($trimmed.StartsWith('//')) { return $trimmed.Substring(2) }
    if ($trimmed.StartsWith(';')) { return $trimmed.Substring(1) }
    if ($trimmed.StartsWith("'")) { return $trimmed.Substring(1) }
    if ($trimmed.StartsWith('REM', [System.StringComparison]::OrdinalIgnoreCase) -and $trimmed.Length -gt 3 -and [char]::IsWhiteSpace($trimmed[3])) {
        return $trimmed.Substring(3)
    }

    return $null
}

function Get-FlowCellDirectiveValue {
    param(
        [AllowEmptyString()][string]$Line,
        [Parameter(Mandatory = $true)]
        [string]$Directive
    )

    $body = Get-FlowCellSupportedCommentBody -Line $Line
    if ($null -eq $body) { return $null }

    $trimmedBody = ([string]$body).TrimStart()
    if (-not $trimmedBody.StartsWith($Directive, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    $rest = $trimmedBody.Substring($Directive.Length).TrimStart()
    if (-not $rest.StartsWith(':')) { return $null }
    return $rest.Substring(1).Trim()
}

function Get-FlowCellButtonEventName {
    param([AllowEmptyString()][string]$Name)

    $normalized = (([string]$Name).Trim() -replace '[_\-\s]+', '').ToLowerInvariant()
    switch ($normalized) {
        'click' { return 'click' }
        'doubleclick' { return 'doubleClick' }
        'contextmenu' { return 'contextMenu' }
        'rightclick' { return 'contextMenu' }
        'hoverenter' { return 'hoverEnter' }
        'pointerenter' { return 'hoverEnter' }
        'mouseenter' { return 'hoverEnter' }
        'hoverleave' { return 'hoverLeave' }
        'pointerleave' { return 'hoverLeave' }
        'mouseleave' { return 'hoverLeave' }
        'pressdown' { return 'pressDown' }
        'pointerdown' { return 'pressDown' }
        'mousedown' { return 'pressDown' }
        'pressup' { return 'pressUp' }
        'pointerup' { return 'pressUp' }
        'mouseup' { return 'pressUp' }
        'pointercancel' { return 'pressUp' }
        'focus' { return 'focus' }
        'blur' { return 'blur' }
        default { return '' }
    }
}

function Get-FlowCellButtonActionType {
    param([AllowEmptyString()][string]$Type)

    $normalized = (([string]$Type).Trim() -replace '[_\-\s]+', '').ToLowerInvariant()
    switch ($normalized) {
        '' { return 'blenderBridge' }
        'bridge' { return 'blenderBridge' }
        'blenderbridge' { return 'blenderBridge' }
        'noop' { return 'none' }
        'noaction' { return 'none' }
        'none' { return 'none' }
        default { return ([string]$Type).Trim() }
    }
}

function Get-FlowCellButtonEvents {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }

    $events = [ordered]@{}
    foreach ($line in @(Get-Content -LiteralPath $Path)) {
        $eventsJson = Get-FlowCellDirectiveValue -Line ([string]$line) -Directive 'FLOWCELL_EVENTS'
        if (-not [string]::IsNullOrWhiteSpace($eventsJson)) {
            $parsedEvents = $eventsJson | ConvertFrom-Json -ErrorAction Stop
            foreach ($property in @($parsedEvents.PSObject.Properties)) {
                $eventName = Get-FlowCellButtonEventName -Name ([string]$property.Name)
                if ([string]::IsNullOrWhiteSpace($eventName)) { continue }

                $record = $property.Value
                $actionType = Get-FlowCellButtonActionType -Type ([string](Get-FlowCellObjectPropertyValue -InputObject $record -Name 'type'))
                $actionName = ([string](Get-FlowCellObjectPropertyValue -InputObject $record -Name 'action')).Trim()
                if ($actionType -ne 'none' -and [string]::IsNullOrWhiteSpace($actionName)) { continue }

                $eventRecord = [ordered]@{
                    type = $actionType
                    action = $actionName
                }
                $data = Get-FlowCellObjectPropertyValue -InputObject $record -Name 'data'
                if ($null -ne $data) {
                    $eventRecord.data = $data
                }
                $events[$eventName] = [pscustomobject]$eventRecord
            }
            continue
        }

        $eventValue = Get-FlowCellDirectiveValue -Line ([string]$line) -Directive 'FLOWCELL_EVENT'
        if ([string]::IsNullOrWhiteSpace($eventValue)) { continue }

        $parts = @(([string]$eventValue).Split([char]'|', 4) | ForEach-Object { ([string]$_).Trim() })
        if ($parts.Count -lt 2) { continue }

        $eventName = Get-FlowCellButtonEventName -Name $parts[0]
        if ([string]::IsNullOrWhiteSpace($eventName)) { continue }

        if ($parts.Count -ge 3) {
            $actionType = Get-FlowCellButtonActionType -Type $parts[1]
            $actionName = ([string]$parts[2]).Trim()
            $dataText = if ($parts.Count -ge 4) { ([string]$parts[3]).Trim() } else { '' }
        }
        else {
            $actionType = 'blenderBridge'
            $actionName = ([string]$parts[1]).Trim()
            $dataText = ''
        }

        if ($actionType -ne 'none' -and [string]::IsNullOrWhiteSpace($actionName)) { continue }
        $eventRecord = [ordered]@{
            type = $actionType
            action = $actionName
        }
        if (-not [string]::IsNullOrWhiteSpace($dataText)) {
            $eventRecord.data = $dataText | ConvertFrom-Json -ErrorAction Stop
        }
        $events[$eventName] = [pscustomobject]$eventRecord
    }

    if ($events.Count -le 0) { return $null }
    return [pscustomobject]$events
}

function Set-FlowCellButtonPanel {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Button,
        [Parameter(Mandatory = $true)]
        [string]$PanelName
    )

    $resolvedPanelName = ([string]$PanelName).Trim()
    if ([string]::IsNullOrWhiteSpace($resolvedPanelName)) {
        return
    }

    if ($Button.PSObject.Properties['panel']) {
        $Button.panel = $resolvedPanelName
    }
    else {
        $Button | Add-Member -MemberType NoteProperty -Name panel -Value $resolvedPanelName -Force
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

function Test-FlowCellPortableBlenderSource([string]$Path) {
    $runMeta = Get-FlowCellCustomEntrypointMetadata -Path $Path -PreferredFunctionName 'run_flowcell_action'
    if ([string]::IsNullOrWhiteSpace([string]$runMeta.FunctionName)) {
        return [pscustomobject]@{
            IsValid = $false
            FunctionName = ''
            Reason = 'Blender Add Script sources must expose run_flowcell_action(context=None, data=None).'
        }
    }

    return [pscustomobject]@{
        IsValid = $true
        FunctionName = [string]$runMeta.FunctionName
        Reason = ''
    }
}

function Get-FlowCellPythonBootstrapHint([string]$Path, [string[]]$AvailableFunctions = @()) {
    $leafName = if ([string]::IsNullOrWhiteSpace($Path)) { '' } else { [System.IO.Path]::GetFileName($Path) }
    $normalizedLeaf = $leafName.ToLowerInvariant()
    $normalizedFunctions = @($AvailableFunctions | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim().ToLowerInvariant() })
    $bootstrapNames = @(
        'bootstrap',
        'listener',
        'server',
        'daemon',
        'startup',
        'watcher'
    )
    $bootstrapFunctions = @(
        'register',
        'unregister',
        'handle',
        'server',
        'bootstrap',
        'start_listener',
        'run_listener'
    )

    $looksLikeBootstrapName = $false
    foreach ($namePart in $bootstrapNames) {
        if ($normalizedLeaf -like "*$namePart*") {
            $looksLikeBootstrapName = $true
            break
        }
    }

    $looksLikeBootstrapFunctions = $false
    foreach ($functionName in $normalizedFunctions) {
        if ($bootstrapFunctions -contains $functionName) {
            $looksLikeBootstrapFunctions = $true
            break
        }
    }

    if ($looksLikeBootstrapName -or $looksLikeBootstrapFunctions) {
        return 'This file looks like a Blender bootstrap/listener helper, not a FlowCell action source. Pick the actual tool `.py` file that exposes run_flowcell_action, main, or perform_*.'
    }

    return ''
}

function Get-FriendlyBlenderButtonLabel([string]$RawLabel) {
    if ([string]::IsNullOrWhiteSpace($RawLabel)) {
        return 'button'
    }

    $label = [string]$RawLabel
    $match = [System.Text.RegularExpressions.Regex]::Match(
        $label,
        '^(?:util_)?(?:flowcell_custom_)?util_boolsafe_(?<shape>cylinder|cone|cube|sphere|triangle)(?:_\d+)?$',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($match.Success) {
        return $match.Groups['shape'].Value.ToLowerInvariant()
    }

    return $label
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

function Set-TopDescription([string]$Path, [string]$NextDescription) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }

    $normalizedDescription = if ($null -ne $NextDescription) { [string]$NextDescription.Trim() } else { '' }
    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @(Get-Content -LiteralPath $Path)) {
        [void]$lines.Add([string]$line)
    }

    $lineIndex = 0
    $shebang = ''
    if ($lines.Count -gt 0 -and [string]$lines[0] -match '^#!') {
        $shebang = [string]$lines[0]
        $lineIndex = 1
    }

    $leadingHeader = [System.Collections.Generic.List[string]]::new()
    while ($lineIndex -lt $lines.Count) {
        $currentLine = [string]$lines[$lineIndex]
        if ([string]::IsNullOrWhiteSpace($currentLine) -or $currentLine -match '^\s*#') {
            if ($currentLine -notmatch '^\s*#\s*Description\s*:') {
                [void]$leadingHeader.Add($currentLine)
            }
            $lineIndex++
            continue
        }
        break
    }

    while ($leadingHeader.Count -gt 0 -and [string]::IsNullOrWhiteSpace([string]$leadingHeader[$leadingHeader.Count - 1])) {
        $leadingHeader.RemoveAt($leadingHeader.Count - 1)
    }

    $bodyLines = if ($lineIndex -lt $lines.Count) { @($lines[$lineIndex..($lines.Count - 1)]) } else { @() }
    $nextLines = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($shebang)) {
        [void]$nextLines.Add($shebang)
    }
    [void]$nextLines.Add(('# Description: {0}' -f $normalizedDescription))
    [void]$nextLines.Add('')
    foreach ($headerLine in @($leadingHeader)) {
        [void]$nextLines.Add([string]$headerLine)
    }
    if ($leadingHeader.Count -gt 0 -and $bodyLines.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace([string]$leadingHeader[$leadingHeader.Count - 1])) {
        [void]$nextLines.Add('')
    }
    foreach ($bodyLine in @($bodyLines)) {
        [void]$nextLines.Add([string]$bodyLine)
    }

    Write-FlowCellTextFile -Path $Path -Value (($nextLines -join "`r`n") + "`r`n") -Encoding UTF8
}

$takenActionNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($button in @($config.buttons)) {
    $buttonAction = [string](Get-FlowCellObjectPropertyValue -InputObject $button -Name 'action')
    if (-not [string]::IsNullOrWhiteSpace($buttonAction)) { [void]$takenActionNames.Add($buttonAction) }
    $buttonLocalAction = [string](Get-FlowCellObjectPropertyValue -InputObject $button -Name 'localAction')
    if (-not [string]::IsNullOrWhiteSpace($buttonLocalAction)) { [void]$takenActionNames.Add($buttonLocalAction) }
}
foreach ($entry in @($registry.actions)) {
    $entryAction = [string](Get-FlowCellObjectPropertyValue -InputObject $entry -Name 'action')
    if (-not [string]::IsNullOrWhiteSpace($entryAction)) { [void]$takenActionNames.Add($entryAction) }
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
        if ($extension -ne '.py') {
            $installResults.Add([pscustomobject]@{ Source = $fullPath; Installed = $false; Message = 'Only .py files are supported for Blender Add Button.' }) | Out-Null
            continue
        }

        $label = Get-FriendlyBlenderButtonLabel ([System.IO.Path]::GetFileNameWithoutExtension($fullPath))
        if ([string]::IsNullOrWhiteSpace($label)) { $label = 'button' }
        $safeLabel = Get-SafeName $label
        $actionName = Get-UniqueActionName -BaseName ('{0}{1}' -f [string]$bridgeLayout.GeneratedActionPrefix, $safeLabel) -Taken $takenActionNames
        $description = Get-TopDescription -Path $fullPath
        if ([string]::IsNullOrWhiteSpace($description)) { $description = ('Run {0} through the {1} Blender bridge.' -f $label, [string]$bridgeLayout.AddonDisplayName) }
        Set-TopDescription -Path $fullPath -NextDescription $description
        $buttonEvents = Get-FlowCellButtonEvents -Path $fullPath

        $pythonPath = ''
        $functionName = ''
        $startLine = 1

        $sourceValidation = Test-FlowCellPortableBlenderSource -Path $fullPath
        if (-not [bool]$sourceValidation.IsValid) {
            $availableFunctions = @(Get-PythonTopLevelFunctionNames -Path $fullPath)
            $bootstrapHint = Get-FlowCellPythonBootstrapHint -Path $fullPath -AvailableFunctions $availableFunctions
            $baseReason = if (-not [string]::IsNullOrWhiteSpace($bootstrapHint)) {
                $bootstrapHint
            }
            else {
                [string]$sourceValidation.Reason
            }
            $availableSummary = if ($availableFunctions.Count -gt 0) {
                ' Found top-level functions: ' + (($availableFunctions | ForEach-Object { "'$_'" }) -join ', ') + '.'
            }
            else {
                ' No top-level Python functions were found.'
            }
            $installResults.Add([pscustomobject]@{
                Source = $fullPath
                Installed = $false
                Message = ($baseReason + $availableSummary)
            }) | Out-Null
            continue
        }

        $sourcePythonPath = [System.IO.Path]::GetFullPath($fullPath)
        $managedPythonPath = Join-Path $managedActionRoot ('{0}.py' -f $actionName)
        Copy-Item -LiteralPath $fullPath -Destination $managedPythonPath -Force
        Set-TopDescription -Path $managedPythonPath -NextDescription $description
        $meta = Get-PythonFunctionMetadata -Path $managedPythonPath -PreferredFunctionName ([string]$sourceValidation.FunctionName)
        $pythonPath = $managedPythonPath
        $functionName = [string]$meta.FunctionName
        $startLine = [int]$meta.StartLine

        $existingButton = @($config.buttons | Where-Object { [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'action') -ieq $actionName } | Select-Object -First 1)
        if (@($existingButton).Count -gt 0) {
            $existingButton[0].label = [string]$label
            $existingButton[0].tooltip = [string]$description
            Set-FlowCellButtonPanel -Button $existingButton[0] -PanelName $PanelName
            if ($null -ne $buttonEvents) {
                $existingButton[0] | Add-Member -MemberType NoteProperty -Name events -Value $buttonEvents -Force
            }
            elseif ($existingButton[0].PSObject.Properties['events']) {
                $existingButton[0].PSObject.Properties.Remove('events')
            }
            $updatedConfigButtons++
        }
        else {
            $newButton = [ordered]@{
                label = [string]$label
                tooltip = [string]$description
                action = [string]$actionName
                panel = [string]$PanelName
            }
            if ($null -ne $buttonEvents) {
                $newButton.events = $buttonEvents
            }
            $config.buttons = @($config.buttons) + @([pscustomobject]$newButton)
            $addedConfigButtons++
        }

        $existingEntry = @($registry.actions | Where-Object { [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'action') -ieq $actionName } | Select-Object -First 1)
        if (@($existingEntry).Count -gt 0) {
            $existingEntry[0].pythonPath = [string]$pythonPath
            $existingEntry[0].functionName = [string]$functionName
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourcePythonPath -Value ([string]$sourcePythonPath) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourceFunctionName -Value ([string]$functionName) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name startLine -Value ([int]$startLine) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name description -Value ([string]$description) -Force
        }
        else {
            $registry.actions = @($registry.actions) + @([pscustomobject]@{
                action = [string]$actionName
                pythonPath = [string]$pythonPath
                functionName = [string]$functionName
                sourcePythonPath = [string]$sourcePythonPath
                sourceFunctionName = [string]$functionName
                startLine = [int]$startLine
                description = [string]$description
            })
            $registeredActions++
        }

        $installResults.Add([pscustomobject]@{
            Source = $fullPath
            Installed = $true
            Action = $actionName
            Label = [string]$label
            Tooltip = [string]$description
            Events = $buttonEvents
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
        else {
            $responseStatus = [string](Get-FlowCellObjectPropertyValue -InputObject $response -Name 'status')
            if ($response -and -not [string]::IsNullOrWhiteSpace($responseStatus) -and $responseStatus -ne 'ok') {
                $reloadRequired = $true
                $responseMessage = [string](Get-FlowCellObjectPropertyValue -InputObject $response -Name 'message')
                $reloadReason = ('Blender addon reported ''{0}'' for action ''{1}'' from {2}. Reload or restart Blender.' -f $responseMessage, [string]$firstInstalled[0].Action, [string]$bridgeLayout.BridgeFolderName)
                $callableCheckStatus = 'reload_required'
            }
            else {
                $callableCheckStatus = 'callable'
            }
        }
    }
}

$installedCount = @($installResults | Where-Object { [bool]$_.Installed }).Count
$failedCount = @($installResults | Where-Object { -not [bool]$_.Installed }).Count
$buttonWord = if ($installedCount -eq 1) { 'button' } else { 'buttons' }
$firstFailedResult = @($installResults | Where-Object { -not [bool]$_.Installed } | Select-Object -First 1)
$firstFailureMessage = if (@($firstFailedResult).Count -gt 0) { [string]$firstFailedResult[0].Message } else { '' }

if ($installedCount -le 0) {
    if (-not [string]::IsNullOrWhiteSpace($firstFailureMessage)) {
        $statusMessage = ('No Blender buttons were installed. First failure: {0}' -f $firstFailureMessage)
    }
    else {
        $statusMessage = 'No Blender buttons were installed.'
    }
}
else {
    $phaseMessage = 'Installed {0} Blender {1} on {2}. Registered the {3} sandbox action and regenerated {4},' -f $installedCount, $buttonWord, $PanelName, [string]$bridgeLayout.BridgeFolderName, [string]$bridgeLayout.AddonActionsFileName
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
        if (-not [string]::IsNullOrWhiteSpace($firstFailureMessage)) {
            $statusMessage += (' First failure: {0}' -f $firstFailureMessage)
        }
    }
}

$scriptResult = [pscustomobject]@{
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
    FirstFailureMessage = $firstFailureMessage
    StatusMessage = $statusMessage
    AddonActionsFileName = [string]$bridgeLayout.AddonActionsFileName
    BridgeFolder = [string]$BridgeFolder
    Results = @($installResults.ToArray())
}

$global:LASTEXITCODE = 0
$scriptResult | ConvertTo-Json -Depth 8


