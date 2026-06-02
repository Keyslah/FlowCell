param(
    [Parameter(Mandatory = $true)]
    [string]$ButtonTarget,
    [string]$ExecutionTarget = '',
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Description,
    [string]$ConfigPath = '',
    [string]$BridgeFolder = '',
    [switch]$SkipCustomActionSync
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$projectRoot = Join-Path $repoRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    $projectRoot = Join-Path $repoRoot 'Blender'
}
$supportRoot = Join-Path $projectRoot 'SupportScripts'
$managedActionRoot = Join-Path $projectRoot 'ManagedActions'
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

function Write-FlowCellTextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,
        [ValidateSet('ASCII', 'UTF8')]
        [string]$Encoding = 'UTF8'
    )

    $resolvedEncoding = switch ($Encoding) {
        'UTF8' { New-Object System.Text.UTF8Encoding($false) }
        default { [System.Text.Encoding]::ASCII }
    }
    [System.IO.File]::WriteAllText($Path, $Value, $resolvedEncoding)
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

function Get-NormalizedPathKey([string]$Path) {
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
            & $addCandidate (Join-Path (Join-Path $projectRoot 'FlowCellButtons') $trimmedLeaf)
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
        if ($value -ieq 'get_selected_objects') { continue }
        return $value
    }
    return [string]$matches[0].Groups[1].Value
}

function Get-PrimaryWrapperLabel([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return ''
    }

    $raw = Get-Content -LiteralPath $ScriptPath -Raw
    $match = [Regex]::Match($raw, "-Label\s+'([^']+)'", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        return ''
    }
    return [string]$match.Groups[1].Value
}

function Set-TopDescription([string]$Path, [string]$NextDescription) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

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
    return $true
}

function Normalize-ReferenceLabel([string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Label)) {
        return ''
    }
    return (([string]$Label).ToLowerInvariant() -replace '[^a-z0-9]+', '')
}

function Update-AddonReferenceDescription([string]$AddonActionsPath, [string]$ReferenceLabel, [string]$NextDescription) {
    if (
        [string]::IsNullOrWhiteSpace($AddonActionsPath) -or
        [string]::IsNullOrWhiteSpace($ReferenceLabel) -or
        -not (Test-Path -LiteralPath $AddonActionsPath -PathType Leaf)
    ) {
        return $false
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @(Get-Content -LiteralPath $AddonActionsPath)) {
        [void]$lines.Add([string]$line)
    }

    $docStart = -1
    $docEnd = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ([string]$lines[$i] -match '^"""\s*Blender Bridge Button Reference\.') {
            $docStart = $i
            break
        }
    }
    if ($docStart -lt 0) {
        return $false
    }
    for ($i = $docStart + 1; $i -lt $lines.Count; $i++) {
        if ([string]$lines[$i] -match '^"""$') {
            $docEnd = $i
            break
        }
    }
    if ($docEnd -le $docStart) {
        return $false
    }

    $normalizedReferenceLabel = Normalize-ReferenceLabel $ReferenceLabel
    for ($i = $docStart + 1; $i -lt $docEnd; $i++) {
        $line = [string]$lines[$i]
        $match = [Regex]::Match($line, '^(?<label>[^:]+):\s*(?<description>.*)$')
        if (-not $match.Success) {
            continue
        }
        if ((Normalize-ReferenceLabel $match.Groups['label'].Value) -ne $normalizedReferenceLabel) {
            continue
        }
        $lines[$i] = ('{0}: {1}' -f [string]$match.Groups['label'].Value.TrimEnd(), [string]$NextDescription)
        Write-FlowCellTextFile -Path $AddonActionsPath -Value (($lines -join "`r`n") + "`r`n") -Encoding UTF8
        return $true
    }

    return $false
}

$normalizedButtonTarget = Get-NormalizedPathKey $ButtonTarget
if ([string]::IsNullOrWhiteSpace($normalizedButtonTarget)) {
    throw 'Blender button description target was blank.'
}
$resolvedButtonTarget = Resolve-FlowCellButtonScriptPath $ButtonTarget
$resolvedExecutionTarget = if ([string]::IsNullOrWhiteSpace($ExecutionTarget)) { $resolvedButtonTarget } else { Resolve-FlowCellButtonScriptPath $ExecutionTarget }

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($null -eq $config.buttons) {
    $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() -Force
}
$config.buttons = @($config.buttons)
$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
$BridgeFolder = [string]$bridgeLayout.BridgeFolder
$customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
$addonActionsPath = [string]$bridgeLayout.AddonActionsPath
$addonBridgePath = [string]$bridgeLayout.AddonBridgePath
$liveAddonPaths = @(
    Get-NormalizedPathKey $addonActionsPath
    Get-NormalizedPathKey $addonBridgePath
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$wrapperAction = Get-PrimaryWrapperAction $resolvedExecutionTarget
$wrapperLabel = Get-PrimaryWrapperLabel $resolvedExecutionTarget

$updatedPaths = New-Object System.Collections.Generic.List[string]
$updatedConfigCount = 0
$updatedRegistryCount = 0

foreach ($button in @($config.buttons)) {
    $buttonScriptPath = if ($button.PSObject.Properties['scriptPath']) {
        Get-NormalizedPathKey (Resolve-FlowCellButtonScriptPath ([string]$button.scriptPath))
    }
    else {
        ''
    }
    $buttonAction = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
    $matchesTarget = (
        -not [string]::IsNullOrWhiteSpace($buttonScriptPath) -and
        $buttonScriptPath -eq $normalizedButtonTarget
    )
    $matchesAction = (
        -not [string]::IsNullOrWhiteSpace($wrapperAction) -and
        -not [string]::IsNullOrWhiteSpace($buttonAction) -and
        $buttonAction -ieq $wrapperAction
    )

    if (-not ($matchesTarget -or $matchesAction)) {
        continue
    }

    if ($button.PSObject.Properties['tooltip']) {
        $button.tooltip = [string]$Description
    }
    else {
        $button | Add-Member -MemberType NoteProperty -Name tooltip -Value ([string]$Description) -Force
    }
    $updatedConfigCount++
}

Write-FlowCellTextFile -Path $ConfigPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8

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

if (Test-Path -LiteralPath $resolvedButtonTarget -PathType Leaf) {
    if (Set-TopDescription -Path $resolvedButtonTarget -NextDescription $Description) {
        [void]$updatedPaths.Add($resolvedButtonTarget)
    }
}
if (
    -not [string]::IsNullOrWhiteSpace($resolvedExecutionTarget) -and
    (Get-NormalizedPathKey $resolvedExecutionTarget) -ne (Get-NormalizedPathKey $resolvedButtonTarget) -and
    (Test-Path -LiteralPath $resolvedExecutionTarget -PathType Leaf)
) {
    if (Set-TopDescription -Path $resolvedExecutionTarget -NextDescription $Description) {
        [void]$updatedPaths.Add($resolvedExecutionTarget)
    }
}

foreach ($entry in @($registry.actions)) {
    $entryAction = if ($entry.PSObject.Properties['action']) { [string]$entry.action } else { '' }
    if ([string]::IsNullOrWhiteSpace($wrapperAction) -or $entryAction -notin @($wrapperAction)) {
        continue
    }

    if ($entry.PSObject.Properties['description']) {
        $entry.description = [string]$Description
    }
    else {
        $entry | Add-Member -MemberType NoteProperty -Name description -Value ([string]$Description) -Force
    }
    $updatedRegistryCount++

    $sourcePythonPath = if ($entry.PSObject.Properties['sourcePythonPath']) {
        [string]$entry.sourcePythonPath
    }
    elseif ($entry.PSObject.Properties['pythonPath']) {
        [string]$entry.pythonPath
    }
    else {
        ''
    }
    $normalizedSourcePath = Get-NormalizedPathKey $sourcePythonPath
    if (
        [string]::IsNullOrWhiteSpace($normalizedSourcePath) -or
        $liveAddonPaths -contains $normalizedSourcePath
    ) {
        continue
    }
    if (-not (Test-Path -LiteralPath $sourcePythonPath -PathType Leaf)) {
        continue
    }
    if (Set-TopDescription -Path $sourcePythonPath -NextDescription $Description) {
        [void]$updatedPaths.Add($sourcePythonPath)
    }
}

if ($updatedRegistryCount -gt 0 -or (Test-Path -LiteralPath $customRegistryPath -PathType Leaf)) {
    Write-FlowCellTextFile -Path $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8
}

if (-not $SkipCustomActionSync -and (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf)) {
    & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $BridgeFolder | Out-Null
}

if (-not [string]::IsNullOrWhiteSpace($wrapperLabel)) {
    [void](Update-AddonReferenceDescription -AddonActionsPath $addonActionsPath -ReferenceLabel $wrapperLabel -NextDescription $Description)
}

[pscustomobject]@{
    UpdatedPaths = @($updatedPaths.ToArray() | Select-Object -Unique)
    UpdatedConfigCount = $updatedConfigCount
    UpdatedRegistryCount = $updatedRegistryCount
    Action = $wrapperAction
    CustomActionSyncSkipped = [bool]$SkipCustomActionSync
    StatusMessage = 'Updated Blender button description.'
} | ConvertTo-Json -Depth 6
