param(
    [string[]]$SelectedPaths = @(),
    [string]$SelectedPathsJson = '',
    [Parameter(Mandatory = $true)]
    [string]$PanelName,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]{1,128}$')]
    [string]$OwnerButtonId,
    [string]$BridgeDataJson = '{}',
    [string]$ConfigPath = '',
    [string]$BridgeFolder = '',
    [switch]$SkipSync,
    [switch]$RegistryOnly
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
$localConfigPath = Join-Path $repoRoot 'flowcellbackend\local\private\blender.config.local.json'
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

$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
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
        $registry = Get-Content -LiteralPath $customRegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $registry.actions) { $registry | Add-Member -MemberType NoteProperty -Name actions -Value @() -Force }
    }
    catch {
        $registry = [pscustomobject]@{ actions = @() }
    }
}
$registry.actions = @($registry.actions)

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

function Get-PythonFunctionMetadata([string]$Path, [string]$PreferredFunctionName = '') {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ FunctionName = ''; StartLine = 1; SourceText = '' }
    }

    $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
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
    foreach ($line in @(Get-Content -LiteralPath $Path -Encoding UTF8)) {
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
            Reason = 'Blender Button script sources must expose run_flowcell_action(context=None, data=None).'
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

function Get-TopDescription([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
    $lines = @(Get-Content -LiteralPath $Path -TotalCount 32 -Encoding UTF8)
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
    foreach ($line in @(Get-Content -LiteralPath $Path -Encoding UTF8)) {
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

$selectedFilePaths = @($SelectedPaths | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
if ($selectedFilePaths.Count -ne 1) {
    if ($RegistryOnly) {
        throw 'An internal Blender registry action requires exactly one source file.'
    }
    throw 'An owned Blender Button install requires exactly one Local source file.'
}
if ($RegistryOnly -and $OwnerButtonId -cnotmatch '^internal-[A-Za-z0-9_-]{1,119}$') {
    throw "Internal Blender registry actions require an OwnerButtonId beginning with 'internal-'."
}

try {
    $bridgeData = if ([string]::IsNullOrWhiteSpace($BridgeDataJson)) {
        [pscustomobject]@{}
    }
    else {
        ConvertFrom-Json -InputObject $BridgeDataJson -ErrorAction Stop
    }
    if ($null -eq $bridgeData -or
        ($bridgeData -isnot [System.Management.Automation.PSCustomObject] -and
         $bridgeData -isnot [System.Collections.IDictionary])) {
        throw 'bridgeData must be a JSON object.'
    }
}
catch {
    throw "Could not parse -BridgeDataJson for Blender Button install: $($_.Exception.Message)"
}
$actionName = ('flowcell_button_{0}' -f $OwnerButtonId.ToLowerInvariant())

$installResults = New-Object System.Collections.Generic.List[object]
$registeredActions = 0
$regeneratedFlowcellActions = $false
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

        $label = [System.IO.Path]::GetFileNameWithoutExtension($fullPath)
        if ([string]::IsNullOrWhiteSpace($label)) { $label = 'button' }
        $description = Get-TopDescription -Path $fullPath
        if ([string]::IsNullOrWhiteSpace($description)) { $description = ('Run {0} through the {1} Blender bridge.' -f $label, [string]$bridgeLayout.AddonDisplayName) }

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

        $existingEntry = @($registry.actions | Where-Object { [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'action') -ieq $actionName } | Select-Object -First 1)
        if (@($registry.actions | Where-Object { [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'action') -ieq $actionName }).Count -gt 1) {
            throw ('Blender action {0} has duplicate registry entries and cannot be safely updated.' -f $actionName)
        }
        if (@($existingEntry).Count -gt 0) {
            $existingOwner = [string](Get-FlowCellObjectPropertyValue -InputObject $existingEntry[0] -Name 'ownerButtonId')
            if ($existingOwner -cne $OwnerButtonId) {
                throw ('Blender action {0} is not owned by Button {1}.' -f $actionName, $OwnerButtonId)
            }
        }

        $sourcePythonPath = [System.IO.Path]::GetFullPath($fullPath)
        $managedPythonPath = Join-Path $managedActionRoot ('{0}.py' -f $actionName)
        Copy-Item -LiteralPath $fullPath -Destination $managedPythonPath -Force
        Set-TopDescription -Path $managedPythonPath -NextDescription $description
        $meta = Get-PythonFunctionMetadata -Path $managedPythonPath -PreferredFunctionName ([string]$sourceValidation.FunctionName)
        $pythonPath = $managedPythonPath
        $functionName = [string]$meta.FunctionName
        $startLine = [int]$meta.StartLine

        if (@($existingEntry).Count -gt 0) {
            $existingEntry[0].pythonPath = [string]$pythonPath
            $existingEntry[0].functionName = [string]$functionName
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name ownerButtonId -Value ([string]$OwnerButtonId) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourcePythonPath -Value ([string]$sourcePythonPath) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name sourceFunctionName -Value ([string]$functionName) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name startLine -Value ([int]$startLine) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name description -Value ([string]$description) -Force
            $existingEntry[0] | Add-Member -MemberType NoteProperty -Name bridgeData -Value $bridgeData -Force
        }
        else {
            $registry.actions = @($registry.actions) + @([pscustomobject]@{
                action = [string]$actionName
                ownerButtonId = [string]$OwnerButtonId
                pythonPath = [string]$pythonPath
                functionName = [string]$functionName
                sourcePythonPath = [string]$sourcePythonPath
                sourceFunctionName = [string]$functionName
                startLine = [int]$startLine
                description = [string]$description
                bridgeData = $bridgeData
            })
            $registeredActions++
        }

        $installResults.Add([pscustomobject]@{
            Source = $fullPath
            Installed = $true
            Action = $actionName
            Label = [string]$label
            Tooltip = [string]$description
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

Write-FlowCellTextFile -Path $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8

if (-not $SkipSync -and (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf)) {
    & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $BridgeFolder | Out-Null
    $regeneratedFlowcellActions = $true
    if (Test-Path -LiteralPath $customRegistryPath -PathType Leaf) {
        try {
            $registry = Get-Content -LiteralPath $customRegistryPath -Raw -Encoding UTF8 | ConvertFrom-Json
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
if (-not $SkipSync -and @($installResults | Where-Object { [bool]$_.Installed }).Count -gt 0) {
    # Registration must not execute an arbitrary program action. The registry and
    # generated wrapper are validated above; execution belongs to an explicit
    # user action with its declared payload.
    $callableCheckStatus = 'registered'
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
    $phaseMessage = if ($RegistryOnly -and $SkipSync) {
        'Registered {0} internal Blender {1} in {2} without creating a panel record, synchronizing, or invoking it,' -f $installedCount, $(if ($installedCount -eq 1) { 'action' } else { 'actions' }), [string]$bridgeLayout.BridgeFolderName
    }
    elseif ($RegistryOnly) {
        'Registered {0} internal Blender {1} in {2} without creating a panel record, and synchronized {3},' -f $installedCount, $(if ($installedCount -eq 1) { 'action' } else { 'actions' }), [string]$bridgeLayout.BridgeFolderName, [string]$bridgeLayout.AddonActionsFileName
    }
    elseif ($SkipSync) {
        'Installed {0} Blender {1} on {2}. Registered the {3} sandbox action without synchronizing or invoking it,' -f $installedCount, $buttonWord, $PanelName, [string]$bridgeLayout.BridgeFolderName
    }
    else {
        'Installed {0} Blender {1} on {2}. Registered the {3} sandbox action and regenerated {4},' -f $installedCount, $buttonWord, $PanelName, [string]$bridgeLayout.BridgeFolderName, [string]$bridgeLayout.AddonActionsFileName
    }
    switch ([string]$callableCheckStatus) {
        'registered' {
            $statusMessage = $phaseMessage + ' and validated registration without executing a program action.'
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

$publicResults = @($installResults.ToArray() | ForEach-Object {
    [pscustomobject]@{
        source = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Source')
        installed = [bool](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Installed')
        action = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Action')
        label = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Label')
        tooltip = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Tooltip')
        pythonPath = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'PythonPath')
        functionName = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'FunctionName')
        message = [string](Get-FlowCellObjectPropertyValue -InputObject $_ -Name 'Message')
    }
})
$scriptResult = [pscustomobject]@{
    installedCount = $installedCount
    failedCount = $failedCount
    registeredActions = $registeredActions
    regeneratedFlowcellActions = $regeneratedFlowcellActions
    callableCheckStatus = $callableCheckStatus
    configPath = $ConfigPath
    registryPath = $customRegistryPath
    reloadRequired = $reloadRequired
    reloadReason = $reloadReason
    firstFailureMessage = $firstFailureMessage
    statusMessage = $statusMessage
    addonActionsFileName = [string]$bridgeLayout.AddonActionsFileName
    bridgeFolder = [string]$BridgeFolder
    results = $publicResults
}

$global:LASTEXITCODE = 0
$scriptResult | ConvertTo-Json -Depth 8


