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

function Test-FlowCellCustomActionLifecycleEnabled([object]$RegistryEntry) {
    if ($null -eq $RegistryEntry) {
        return $false
    }
    $bridgeDataProperty = $RegistryEntry.PSObject.Properties['bridgeData']
    if ($null -eq $bridgeDataProperty -or $null -eq $bridgeDataProperty.Value) {
        return $false
    }
    $lifecycleProperty = $bridgeDataProperty.Value.PSObject.Properties['lifecycle']
    if ($null -eq $lifecycleProperty) {
        return $false
    }
    $lifecycle = $lifecycleProperty.Value
    if ($lifecycle -is [bool]) {
        return [bool]$lifecycle
    }
    if ($null -eq $lifecycle) {
        return $false
    }
    $enabledProperty = $lifecycle.PSObject.Properties['enabled']
    return $null -ne $enabledProperty -and $enabledProperty.Value -is [bool] -and [bool]$enabledProperty.Value
}

function Request-FlowCellCustomActionLifecycleRemoval {
    param(
        [Parameter(Mandatory = $true)]
        [object]$RegistryEntry,
        [Parameter(Mandatory = $true)]
        [object]$Registry,
        [Parameter(Mandatory = $true)]
        [string]$RegistryPath,
        [Parameter(Mandatory = $true)]
        [string]$ResolvedBridgeFolder
    )

    if (-not (Test-FlowCellCustomActionLifecycleEnabled -RegistryEntry $RegistryEntry)) {
        return
    }
    $bridgeData = $RegistryEntry.PSObject.Properties['bridgeData'].Value
    $lifecycleProperty = $bridgeData.PSObject.Properties['lifecycle']
    $originalLifecycle = $lifecycleProperty.Value
    if ($originalLifecycle -is [bool]) {
        $lifecycleProperty.Value = [pscustomobject]@{ enabled = $true }
    }
    $lifecycle = $lifecycleProperty.Value
    $removalToken = [Guid]::NewGuid().ToString('N')
    $lifecycle | Add-Member -MemberType NoteProperty -Name removalRequested -Value $removalToken -Force
    Write-FlowCellTextFile -Path $RegistryPath -Value ($Registry | ConvertTo-Json -Depth 8) -Encoding UTF8

    $blenderRunning = $null -ne (Get-Process blender -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $blenderRunning) {
        return ''
    }

    $acknowledgementRoot = Join-Path $ResolvedBridgeFolder 'lifecycle-removals'
    $acknowledgementPath = Join-Path $acknowledgementRoot ('{0}.json' -f $removalToken)
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $acknowledgementPath -PathType Leaf)) {
        Start-Sleep -Milliseconds 50
    }
    if (Test-Path -LiteralPath $acknowledgementPath -PathType Leaf) {
        return $acknowledgementPath
    }

    if ($originalLifecycle -is [bool]) {
        $lifecycleProperty.Value = $originalLifecycle
    }
    else {
        [void]$lifecycle.PSObject.Properties.Remove('removalRequested')
    }
    Write-FlowCellTextFile -Path $RegistryPath -Value ($Registry | ConvertTo-Json -Depth 8) -Encoding UTF8
    throw 'Blender did not acknowledge lifecycle cleanup; the Button registry and runtime were left installed.'
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
    $removedRuntimeDirectories = New-Object System.Collections.Generic.List[string]
    $lifecycleAcknowledgementPaths = New-Object System.Collections.Generic.List[string]
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
            $lifecycleAcknowledgementPath = Request-FlowCellCustomActionLifecycleRemoval `
                -RegistryEntry $registryEntry `
                -Registry $registry `
                -RegistryPath $customRegistryPath `
                -ResolvedBridgeFolder $resolvedBridgeFolder
            Add-UniqueText -List $lifecycleAcknowledgementPaths -Value $lifecycleAcknowledgementPath
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
            if (Test-FlowCellCustomActionLifecycleEnabled -RegistryEntry $registryEntry) {
                $pythonPathProperty = $registryEntry.PSObject.Properties['pythonPath']
                $rawPythonPath = if ($null -ne $pythonPathProperty) { [string]$pythonPathProperty.Value } else { '' }
                $resolvedPythonPath = Resolve-FlowCellRegistryPath -RawPath $rawPythonPath -BridgeFolder $resolvedBridgeFolder -AddonRoot $addonRoot
                $runtimeDirectory = if ([string]::IsNullOrWhiteSpace($resolvedPythonPath)) { '' } else { '{0}.flowcell-runtime' -f $resolvedPythonPath }
                if (
                    -not [string]::IsNullOrWhiteSpace($runtimeDirectory) -and
                    (Test-FlowCellPathUnderAnyRoot -Path $runtimeDirectory -Roots $managedRoots)
                ) {
                    Add-UniqueText -List $removedRuntimeDirectories -Value (Get-NormalizedPathKey $runtimeDirectory)
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
    $referencedRuntimeDirectories = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
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
        if (Test-FlowCellCustomActionLifecycleEnabled -RegistryEntry $registryEntry) {
            $pythonPathProperty = $registryEntry.PSObject.Properties['pythonPath']
            $rawPythonPath = if ($null -ne $pythonPathProperty) { [string]$pythonPathProperty.Value } else { '' }
            $resolvedPythonPath = Resolve-FlowCellRegistryPath -RawPath $rawPythonPath -BridgeFolder $resolvedBridgeFolder -AddonRoot $addonRoot
            if (-not [string]::IsNullOrWhiteSpace($resolvedPythonPath)) {
                [void]$referencedRuntimeDirectories.Add((Get-NormalizedPathKey ('{0}.flowcell-runtime' -f $resolvedPythonPath)))
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
    foreach ($runtimeDirectory in @($removedRuntimeDirectories.ToArray() | Select-Object -Unique)) {
        if (-not $referencedRuntimeDirectories.Contains($runtimeDirectory)) {
            Move-FlowCellDirectoryToRecycleBin -Path $runtimeDirectory
        }
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
    foreach ($acknowledgementPath in @($lifecycleAcknowledgementPaths.ToArray() | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $acknowledgementPath -PathType Leaf) {
            [System.IO.File]::Delete($acknowledgementPath)
        }
        $acknowledgementRoot = Split-Path -Parent $acknowledgementPath
        if (
            -not [string]::IsNullOrWhiteSpace($acknowledgementRoot) -and
            (Test-Path -LiteralPath $acknowledgementRoot -PathType Container) -and
            @((Get-ChildItem -LiteralPath $acknowledgementRoot -Force -ErrorAction SilentlyContinue)).Count -eq 0
        ) {
            [System.IO.Directory]::Delete($acknowledgementRoot)
        }
    }

    return [pscustomobject]@{
        RemovedActionCount = $prunedActionCount
        RemovedActions = @($removedActions.ToArray())
        RemovedRuntimePaths = @($removedRuntimePaths.ToArray())
        RemovedRuntimeDirectories = @($removedRuntimeDirectories.ToArray())
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
