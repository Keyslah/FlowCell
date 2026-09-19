Set-StrictMode -Version Latest

function Get-FlowCellFusionRepoRoot {
    return Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

function Get-FlowCellFusionSourceAddonRoot {
    return Join-Path (Get-FlowCellFusionRepoRoot) 'Programs\Fusion 360\Fusion AddIns\FlowCellFusionBridge'
}

function Get-FlowCellFusionApiRoots {
    $applicationData = [Environment]::GetFolderPath('ApplicationData')
    return @(
        (Join-Path $applicationData 'Autodesk\Autodesk Fusion 360\API\AddIns'),
        (Join-Path $applicationData 'Autodesk\Autodesk Fusion\API\AddIns'),
        (Join-Path $applicationData 'Autodesk\FusionAddins')
    )
}

function Resolve-FlowCellFusionAddonRoot {
    param([switch]$ExistingOnly)

    $apiRoots = @(Get-FlowCellFusionApiRoots)
    foreach ($apiRoot in $apiRoots) {
        $candidate = Join-Path $apiRoot 'FlowCellFusionBridge'
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    if ($ExistingOnly) {
        return ''
    }

    foreach ($apiRoot in $apiRoots) {
        if (Test-Path -LiteralPath $apiRoot -PathType Container) {
            return [System.IO.Path]::GetFullPath((Join-Path $apiRoot 'FlowCellFusionBridge'))
        }
    }

    return [System.IO.Path]::GetFullPath((Join-Path $apiRoots[0] 'FlowCellFusionBridge'))
}

function Write-FlowCellFusionUtf8File {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $temporaryPath = '{0}.{1}.tmp' -f $Path, [Guid]::NewGuid().ToString('N')
    try {
        $encoding = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temporaryPath, $Text, $encoding)
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Write-FlowCellFusionJsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )
    Write-FlowCellFusionUtf8File -Path $Path -Text (($Value | ConvertTo-Json -Depth 16) + "`n")
}

function Test-FlowCellFusionFilesEqual {
    param(
        [Parameter(Mandatory = $true)][string]$First,
        [Parameter(Mandatory = $true)][string]$Second
    )
    if (-not (Test-Path -LiteralPath $First -PathType Leaf) -or -not (Test-Path -LiteralPath $Second -PathType Leaf)) {
        return $false
    }
    $firstInfo = Get-Item -LiteralPath $First
    $secondInfo = Get-Item -LiteralPath $Second
    if ($firstInfo.Length -ne $secondInfo.Length) {
        return $false
    }
    return (Get-FileHash -LiteralPath $First -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $Second -Algorithm SHA256).Hash
}

function Copy-FlowCellFusionFileIfChanged {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (Test-FlowCellFusionFilesEqual -First $Source -Second $Destination) {
        return $false
    }
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporaryPath = '{0}.{1}.tmp' -f $Destination, [Guid]::NewGuid().ToString('N')
    try {
        Copy-Item -LiteralPath $Source -Destination $temporaryPath -Force
        Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
    return $true
}

function Read-FlowCellFusionRegistry {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ schemaVersion = 1; actions = @() }
    }
    try {
        $registry = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "The Fusion action registry is invalid: $Path"
    }
    if ($null -eq $registry -or $null -eq $registry.PSObject.Properties['actions']) {
        throw "The Fusion action registry has no actions array: $Path"
    }
    $registry.actions = @($registry.actions)
    if ($null -eq $registry.PSObject.Properties['schemaVersion']) {
        $registry | Add-Member -MemberType NoteProperty -Name schemaVersion -Value 1
    }
    return $registry
}

function Install-FlowCellFusionBridgeBundle {
    $sourceRoot = Get-FlowCellFusionSourceAddonRoot
    foreach ($requiredName in @('FlowCellFusionBridge.py', 'FlowCellFusionBridge.manifest')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $requiredName) -PathType Leaf)) {
            throw "Missing FlowCell Fusion add-in source: $requiredName"
        }
    }

    $addonRoot = Resolve-FlowCellFusionAddonRoot
    New-Item -ItemType Directory -Path $addonRoot -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $addonRoot 'Bridge') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $addonRoot 'ManagedActions') -Force | Out-Null

    $changedFiles = New-Object System.Collections.Generic.List[string]
    foreach ($requiredName in @('FlowCellFusionBridge.py', 'FlowCellFusionBridge.manifest')) {
        $sourcePath = Join-Path $sourceRoot $requiredName
        $destinationPath = Join-Path $addonRoot $requiredName
        if (Copy-FlowCellFusionFileIfChanged -Source $sourcePath -Destination $destinationPath) {
            [void]$changedFiles.Add($destinationPath)
        }
    }

    $registryPath = Join-Path $addonRoot 'flowcell_fusion_actions.json'
    if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
        Write-FlowCellFusionJsonFile -Path $registryPath -Value ([pscustomobject]@{ schemaVersion = 1; actions = @() })
    }

    return [pscustomobject]@{
        addonRoot = $addonRoot
        bridgeRoot = (Join-Path $addonRoot 'Bridge')
        managedActionsRoot = (Join-Path $addonRoot 'ManagedActions')
        registryPath = $registryPath
        changedFiles = @($changedFiles)
        reloadRequired = ($changedFiles.Count -gt 0)
    }
}

function Get-FlowCellNormalizedPathKey {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([System.IO.Path]::GetFullPath($Path)).TrimEnd('\', '/').ToLowerInvariant()
}

function Test-FlowCellPathUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $pathKey = Get-FlowCellNormalizedPathKey -Path $Path
    $rootKey = Get-FlowCellNormalizedPathKey -Path $Root
    return $pathKey -eq $rootKey -or $pathKey.StartsWith($rootKey + '\')
}
