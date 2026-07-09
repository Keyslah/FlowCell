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

function Get-FlowCellActionFamilyKey([string]$ActionId) {
    if ([string]::IsNullOrWhiteSpace($ActionId)) {
        return ''
    }
    return (([string]$ActionId).Trim() -replace '_\d+$', '').ToLowerInvariant()
}

function Test-FlowCellPathUnderAnyRoot([string]$Path, [string[]]$Roots) {
    $pathKey = Get-NormalizedPathKey $Path
    if ([string]::IsNullOrWhiteSpace($pathKey)) {
        return $false
    }
    foreach ($root in @($Roots)) {
        $rootKey = Get-NormalizedPathKey $root
        if ([string]::IsNullOrWhiteSpace($rootKey)) {
            continue
        }
        if ($pathKey -eq $rootKey -or $pathKey.StartsWith($rootKey + '\')) {
            return $true
        }
    }
    return $false
}

function Resolve-FlowCellRegistryPath([string]$RawPath, [string]$BridgeFolder, [string]$AddonRoot) {
    if ([string]::IsNullOrWhiteSpace($RawPath)) {
        return ''
    }
    try {
        if ([System.IO.Path]::IsPathRooted($RawPath)) {
            return [System.IO.Path]::GetFullPath($RawPath)
        }
    }
    catch {
    }

    $trimmedPath = ([string]$RawPath).Trim().TrimStart('\', '/')
    foreach ($candidate in @(
        (Join-Path $AddonRoot $trimmedPath),
        (Join-Path $BridgeFolder $trimmedPath),
        (Join-Path $projectRoot $trimmedPath)
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

function Add-UniqueText([System.Collections.Generic.List[string]]$List, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return
    }
    if (-not $List.Contains($Value)) {
        [void]$List.Add($Value)
    }
}

function delete_blender_action([string]$action_id) {
    $targetAction = ([string]$action_id).Trim()
    if ([string]::IsNullOrWhiteSpace($targetAction)) {
        throw 'delete_blender_action requires a non-empty action id.'
    }
    $targetFamily = Get-FlowCellActionFamilyKey $targetAction

    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    if ($null -eq $config.buttons) {
        $config | Add-Member -MemberType NoteProperty -Name buttons -Value @() -Force
    }
    $config.buttons = @($config.buttons)

    $removedActions = New-Object System.Collections.Generic.List[string]
    Add-UniqueText -List $removedActions -Value $targetAction
    $remainingButtons = New-Object System.Collections.Generic.List[object]
    $removedButtonCount = 0

    foreach ($button in @($config.buttons)) {
        $buttonAction = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($buttonAction) -and $buttonAction -ieq $targetAction) {
            $removedButtonCount++
            Add-UniqueText -List $removedActions -Value $buttonAction
            continue
        }
        [void]$remainingButtons.Add($button)
    }

    $config.buttons = @($remainingButtons.ToArray())
    Write-FlowCellTextFile -Path $ConfigPath -Value ($config | ConvertTo-Json -Depth 16) -Encoding UTF8

    $bridgeLayout = Get-FlowCellBlenderBridgeLayout -Config $config -BridgeFolder $BridgeFolder
    $resolvedBridgeFolder = [string]$bridgeLayout.BridgeFolder
    $addonRoot = [string]$bridgeLayout.AddonRoot
    $customRegistryPath = [string]$bridgeLayout.CustomRegistryPath
    $managedRoots = @(
        (Join-Path $projectRoot 'ManagedActions'),
        (Join-Path $resolvedBridgeFolder 'ManagedActions')
    )
    $liveActionsPath = Get-NormalizedPathKey ([string]$bridgeLayout.AddonActionsPath)
    $removedRuntimePaths = New-Object System.Collections.Generic.List[string]
    $prunedActionCount = 0

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
    $registry.actions = @($registry.actions)

    $referencedActions = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($button in @($config.buttons)) {
        $buttonAction = if ($button.PSObject.Properties['action']) { [string]$button.action } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($buttonAction)) {
            [void]$referencedActions.Add($buttonAction.Trim())
        }
    }

    $remainingRegistry = New-Object System.Collections.Generic.List[object]
    foreach ($registryEntry in @($registry.actions)) {
        $registryAction = if ($registryEntry.PSObject.Properties['action']) { [string]$registryEntry.action } else { '' }
        $registryFamily = Get-FlowCellActionFamilyKey $registryAction
        $sameTarget = -not [string]::IsNullOrWhiteSpace($registryAction) -and $registryAction -ieq $targetAction
        $sameUnreferencedFamily = (
            -not [string]::IsNullOrWhiteSpace($registryFamily) -and
            $registryFamily -eq $targetFamily -and
            -not $referencedActions.Contains($registryAction)
        )

        if ($sameTarget -or $sameUnreferencedFamily) {
            Add-UniqueText -List $removedActions -Value $registryAction
            foreach ($propertyName in @('pythonPath', 'sourcePythonPath')) {
                $property = $registryEntry.PSObject.Properties[$propertyName]
                $rawPath = if ($null -ne $property) { [string]$property.Value } else { '' }
                $resolvedPath = Resolve-FlowCellRegistryPath -RawPath $rawPath -BridgeFolder $resolvedBridgeFolder -AddonRoot $addonRoot
                if (
                    -not [string]::IsNullOrWhiteSpace($resolvedPath) -and
                    (Get-NormalizedPathKey $resolvedPath) -ne $liveActionsPath -and
                    (Test-FlowCellPathUnderAnyRoot -Path $resolvedPath -Roots $managedRoots)
                ) {
                    Add-UniqueText -List $removedRuntimePaths -Value (Get-NormalizedPathKey $resolvedPath)
                }
            }
            $prunedActionCount++
            continue
        }

        [void]$remainingRegistry.Add($registryEntry)
    }

    $registry.actions = @($remainingRegistry.ToArray())
    if (-not [string]::IsNullOrWhiteSpace($customRegistryPath)) {
        Write-FlowCellTextFile -Path $customRegistryPath -Value ($registry | ConvertTo-Json -Depth 8) -Encoding UTF8
    }

    $referencedRuntimePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($registryEntry in @($registry.actions)) {
        foreach ($propertyName in @('pythonPath', 'sourcePythonPath')) {
            $property = $registryEntry.PSObject.Properties[$propertyName]
            $rawPath = if ($null -ne $property) { [string]$property.Value } else { '' }
            $resolvedPath = Resolve-FlowCellRegistryPath -RawPath $rawPath -BridgeFolder $resolvedBridgeFolder -AddonRoot $addonRoot
            if (
                -not [string]::IsNullOrWhiteSpace($resolvedPath) -and
                (Test-FlowCellPathUnderAnyRoot -Path $resolvedPath -Roots $managedRoots)
            ) {
                [void]$referencedRuntimePaths.Add((Get-NormalizedPathKey $resolvedPath))
            }
        }
    }

    foreach ($managedRootCandidate in @($managedRoots)) {
        if ([string]::IsNullOrWhiteSpace($managedRootCandidate) -or -not (Test-Path -LiteralPath $managedRootCandidate -PathType Container)) {
            continue
        }
        foreach ($file in @(Get-ChildItem -LiteralPath $managedRootCandidate -File -Filter '*.py' -ErrorAction SilentlyContinue)) {
            $fileAction = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            if ((Get-FlowCellActionFamilyKey $fileAction) -ne $targetFamily) {
                continue
            }
            $fileKey = Get-NormalizedPathKey $file.FullName
            if (-not $referencedRuntimePaths.Contains($fileKey)) {
                Add-UniqueText -List $removedRuntimePaths -Value $fileKey
            }
        }
    }

    foreach ($runtimePath in @($removedRuntimePaths.ToArray() | Select-Object -Unique)) {
        Move-FlowCellFileToRecycleBin -Path $runtimePath
    }

    if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
        & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $resolvedBridgeFolder | Out-Null
    }

    $verifiedConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $danglingConfig = @($verifiedConfig.buttons | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $targetAction })
    if (@($danglingConfig).Count -gt 0) {
        throw ('delete_blender_action left config references for {0}.' -f $targetAction)
    }
    if (-not [string]::IsNullOrWhiteSpace($customRegistryPath) -and (Test-Path -LiteralPath $customRegistryPath -PathType Leaf)) {
        $verifiedRegistry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
        $danglingRegistry = @($verifiedRegistry.actions | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $targetAction })
        if (@($danglingRegistry).Count -gt 0) {
            throw ('delete_blender_action left registry references for {0}.' -f $targetAction)
        }
    }

    return [pscustomobject]@{
        RemovedButtonCount = $removedButtonCount
        RemovedActionCount = $prunedActionCount
        RemovedActions = @($removedActions.ToArray())
        RemovedRuntimePaths = @($removedRuntimePaths.ToArray())
        StatusMessage = ('Deleted Blender action {0}. Removed config entries: {1}. Pruned custom actions: {2}.' -f $targetAction, $removedButtonCount, $prunedActionCount)
    }
}

$normalizedTargetPath = Get-NormalizedPathKey $ButtonTarget
if ([string]::IsNullOrWhiteSpace($normalizedTargetPath)) {
    throw 'Blender button delete target was blank.'
}

$bridgeActionFromWrapper = Get-BridgeActionFromWrapper -ScriptPath $ButtonTarget
if ([string]::IsNullOrWhiteSpace($bridgeActionFromWrapper) -and $ButtonTarget -match '^\s*(?:flowcell-)?action\s*:\s*(?<action>.+?)\s*$') {
    $bridgeActionFromWrapper = [string]$matches['action']
}
if ([string]::IsNullOrWhiteSpace($bridgeActionFromWrapper)) {
    throw ('Could not resolve a Blender action id from delete target: {0}' -f $ButtonTarget)
}

delete_blender_action -action_id $bridgeActionFromWrapper | ConvertTo-Json -Depth 6
