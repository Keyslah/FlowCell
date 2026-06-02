param(
    [Parameter(Mandatory = $true)]
    [string]$ButtonTarget,
    [string]$ConfigPath = '',
    [string]$BridgeFolder = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$projectRoot = Join-Path $repoRoot 'Programs\Blender'
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) {
    $projectRoot = Join-Path $repoRoot 'Blender'
}
$wrapperRoot = Join-Path $projectRoot 'FlowCellButtons'
$managedActionRoot = Join-Path $projectRoot 'ManagedActions'
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

function Write-FlowCellTextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,
        [ValidateSet('ASCII', 'UTF8')]
        [string]$Encoding = 'ASCII'
    )

    $resolvedEncoding = switch ($Encoding) {
        'UTF8' { New-Object System.Text.UTF8Encoding($false) }
        default { [System.Text.Encoding]::ASCII }
    }
    [System.IO.File]::WriteAllText($Path, $Value, $resolvedEncoding)
}

function Move-FlowCellFileToRecycleBin([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
        $Path,
        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
    )
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

function Get-BridgeActionFromWrapper([string]$ScriptPath) {
    if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return ''
    }

    $lines = @(Get-Content -LiteralPath $ScriptPath -TotalCount 80)
    foreach ($line in $lines) {
        if ([string]$line -match '^\s*#\s*Source Bridge Action\s*:\s*(.+)$') {
            return [string]$matches[1].Trim()
        }
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

$normalizedTargetPath = Get-NormalizedPathKey $ButtonTarget
if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    throw 'Blender button delete target was blank.'
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($null -eq $config.buttons) {
    $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() -Force
}
$config.buttons = @($config.buttons)

$bridgeActionFromWrapper = Get-BridgeActionFromWrapper -ScriptPath $ButtonTarget
if ([string]::IsNullOrWhiteSpace($bridgeActionFromWrapper) -and $ButtonTarget -match '^\s*(?:flowcell-)?action\s*:\s*(?<action>.+?)\s*$') {
    $bridgeActionFromWrapper = [string]$matches['action']
}
$removedActions = New-Object System.Collections.Generic.List[string]
$remainingButtons = New-Object System.Collections.Generic.List[object]
$removedButtonCount = 0

foreach ($button in @($config.buttons)) {
    $buttonScriptPath = if ($button.PSObject.Properties['scriptPath']) {
        Get-NormalizedPathKey (Resolve-FlowCellButtonScriptPath ([string]$button.scriptPath))
    } else {
        ''
    }
    $buttonAction = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
    $matchesTarget = (
        -not [string]::IsNullOrWhiteSpace($buttonScriptPath) -and
        $buttonScriptPath -eq $normalizedTargetPath
    )
    $matchesAction = (
        -not [string]::IsNullOrWhiteSpace($bridgeActionFromWrapper) -and
        -not [string]::IsNullOrWhiteSpace($buttonAction) -and
        $buttonAction -ieq $bridgeActionFromWrapper
    )

    if ($matchesTarget -or $matchesAction) {
        $removedButtonCount++
        if (-not [string]::IsNullOrWhiteSpace($buttonAction) -and -not $removedActions.Contains($buttonAction)) {
            [void]$removedActions.Add($buttonAction)
        }
        continue
    }

    [void]$remainingButtons.Add($button)
}

if (-not [string]::IsNullOrWhiteSpace($bridgeActionFromWrapper) -and -not $removedActions.Contains($bridgeActionFromWrapper)) {
    [void]$removedActions.Add($bridgeActionFromWrapper)
}

if ($removedButtonCount -le 0) {
    throw ('No matching Blender config button was found for target: {0}' -f $ButtonTarget)
}

$config.buttons = @($remainingButtons.ToArray())
Write-FlowCellTextFile -Path $ConfigPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8

$bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
$BridgeFolder = [string]$bridgeLayout.BridgeFolder
$customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
$managedRoot = Get-NormalizedPathKey $managedActionRoot
$liveActionsPath = Get-NormalizedPathKey ([string]$bridgeLayout.AddonActionsPath)
$prunedActionCount = 0
$prunedSourcePaths = New-Object System.Collections.Generic.List[string]

if (-not [string]::IsNullOrWhiteSpace($customRegistryPath)) {
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

    $remainingRegistry = New-Object System.Collections.Generic.List[object]
    foreach ($registryEntry in @($registry.actions)) {
        $registryAction = if ($registryEntry.PSObject.Properties['action']) { [string]$registryEntry.action } else { '' }
        if (
            -not [string]::IsNullOrWhiteSpace($registryAction) -and
            $removedActions.Contains($registryAction) -and
            @($config.buttons | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $registryAction }).Count -eq 0
        ) {
            $sourcePath = if ($registryEntry.PSObject.Properties['sourcePythonPath'] -and -not [string]::IsNullOrWhiteSpace([string]$registryEntry.sourcePythonPath)) {
                Get-NormalizedPathKey ([string]$registryEntry.sourcePythonPath)
            }
            elseif ($registryEntry.PSObject.Properties['pythonPath']) {
                Get-NormalizedPathKey ([string]$registryEntry.pythonPath)
            }
            else {
                ''
            }
            if (
                -not [string]::IsNullOrWhiteSpace($sourcePath) -and
                $sourcePath -ne $liveActionsPath -and
                $sourcePath.StartsWith($managedRoot)
            ) {
                [void]$prunedSourcePaths.Add($sourcePath)
            }
            $prunedActionCount++
            continue
        }
        [void]$remainingRegistry.Add($registryEntry)
    }

    $registry.actions = @($remainingRegistry.ToArray())
    Write-FlowCellTextFile -Path $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8
}

foreach ($sourcePath in @($prunedSourcePaths.ToArray() | Select-Object -Unique)) {
    Move-FlowCellFileToRecycleBin -Path $sourcePath
}

if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
    & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $BridgeFolder | Out-Null
}

[pscustomobject]@{
    RemovedButtonCount = $removedButtonCount
    RemovedActionCount = $prunedActionCount
    RemovedActions = @($removedActions.ToArray())
    StatusMessage = ('Removed Blender button traces. Removed config entries: {0}. Pruned custom actions: {1}.' -f $removedButtonCount, $prunedActionCount)
} | ConvertTo-Json -Depth 6
