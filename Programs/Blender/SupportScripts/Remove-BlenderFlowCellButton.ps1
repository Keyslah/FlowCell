param(
    [Parameter(Mandatory = $true)]
    [string]$ButtonTarget,
    [ValidatePattern('^[A-Za-z0-9_-]{0,128}$')]
    [string]$OwnerButtonId = '',
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

function Move-FlowCellDirectoryToRecycleBin([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        return
    }

    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
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
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    $removedActions = New-Object System.Collections.Generic.List[string]
    Add-UniqueText -List $removedActions -Value $targetAction

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
    $managedCacheRoots = New-Object System.Collections.Generic.List[string]
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

    $remainingRegistry = New-Object System.Collections.Generic.List[object]
    foreach ($registryEntry in @($registry.actions)) {
        $registryAction = if ($registryEntry.PSObject.Properties['action']) { [string]$registryEntry.action } else { '' }
        $sameTarget = -not [string]::IsNullOrWhiteSpace($registryAction) -and $registryAction -ieq $targetAction
        if ($sameTarget) {
            $registryOwner = if ($registryEntry.PSObject.Properties['ownerButtonId']) { [string]$registryEntry.ownerButtonId } else { '' }
            if (-not [string]::IsNullOrWhiteSpace($OwnerButtonId) -and $registryOwner -cne $OwnerButtonId) {
                throw ('Blender action {0} is not owned by Button {1}.' -f $targetAction, $OwnerButtonId)
            }
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
        if ([string]::IsNullOrWhiteSpace($managedRootCandidate)) { continue }
        $exactManagedPath = Join-Path $managedRootCandidate ('{0}.py' -f $targetAction)
        $exactManagedPathKey = Get-NormalizedPathKey $exactManagedPath
        if ((Test-Path -LiteralPath $exactManagedPath -PathType Leaf) -and -not $referencedRuntimePaths.Contains($exactManagedPathKey)) {
            Add-UniqueText -List $removedRuntimePaths -Value $exactManagedPathKey
        }
        $cacheRoot = Join-Path $managedRootCandidate '__pycache__'
        Add-UniqueText -List $managedCacheRoots -Value $cacheRoot
        if (Test-Path -LiteralPath $cacheRoot -PathType Container) {
            $escapedAction = [System.Text.RegularExpressions.Regex]::Escape($targetAction)
            foreach ($cacheFile in @(Get-ChildItem -LiteralPath $cacheRoot -File -ErrorAction SilentlyContinue)) {
                if ($cacheFile.Name -match ('^{0}(?:\.[^.]+)?\.pyc$' -f $escapedAction)) {
                    Add-UniqueText -List $removedRuntimePaths -Value (Get-NormalizedPathKey $cacheFile.FullName)
                }
            }
        }
    }

    foreach ($runtimePath in @($removedRuntimePaths.ToArray() | Select-Object -Unique)) {
        Move-FlowCellFileToRecycleBin -Path $runtimePath
    }

    if (Test-Path -LiteralPath $customActionSyncPath -PathType Leaf) {
        & $customActionSyncPath -ConfigPath $ConfigPath -BridgeFolder $resolvedBridgeFolder | Out-Null
    }
    foreach ($cacheRoot in @($managedCacheRoots.ToArray() | Select-Object -Unique)) {
        if (
            (Test-Path -LiteralPath $cacheRoot -PathType Container) -and
            @((Get-ChildItem -LiteralPath $cacheRoot -Force -ErrorAction SilentlyContinue)).Count -eq 0
        ) {
            Move-FlowCellDirectoryToRecycleBin -Path $cacheRoot
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($customRegistryPath) -and (Test-Path -LiteralPath $customRegistryPath -PathType Leaf)) {
        $verifiedRegistry = Get-Content -LiteralPath $customRegistryPath -Raw | ConvertFrom-Json
        $danglingRegistry = @($verifiedRegistry.actions | Where-Object { $_.PSObject.Properties['action'] -and [string]$_.action -ieq $targetAction })
        if (@($danglingRegistry).Count -gt 0) {
            throw ('delete_blender_action left registry references for {0}.' -f $targetAction)
        }
    }

    return [pscustomobject]@{
        RemovedActionCount = $prunedActionCount
        RemovedActions = @($removedActions.ToArray())
        RemovedRuntimePaths = @($removedRuntimePaths.ToArray())
        StatusMessage = ('Deleted Blender action {0}. Pruned owned custom actions: {1}.' -f $targetAction, $prunedActionCount)
    }
}

$bridgeActionFromWrapper = if (-not [string]::IsNullOrWhiteSpace($OwnerButtonId)) {
    'flowcell_button_{0}' -f $OwnerButtonId.ToLowerInvariant()
}
else {
    $resolvedAction = ''
    if ($ButtonTarget -match '^\s*(?:flowcell-)?action\s*:\s*(?<action>.+?)\s*$') {
        $resolvedAction = [string]$matches['action']
    }
    $resolvedAction
}
if ([string]::IsNullOrWhiteSpace($bridgeActionFromWrapper)) {
    throw ('Could not resolve a Blender action id from delete target: {0}' -f $ButtonTarget)
}

delete_blender_action -action_id $bridgeActionFromWrapper | ConvertTo-Json -Depth 6
