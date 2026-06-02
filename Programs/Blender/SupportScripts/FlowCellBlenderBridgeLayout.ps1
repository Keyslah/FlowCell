function Get-FlowCellBlenderAutomationStringValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DefaultValue
    )

    if ($null -eq $Config -or $null -eq $Config.automation) {
        return $DefaultValue
    }

    $property = $Config.automation.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $DefaultValue
    }

    $value = [string]$property.Value
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }

    return $value.Trim()
}

function Get-FlowCellBlenderDefaultBridgeFolderName {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $signals = @(
        (Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'customActionsFileName' -DefaultValue '')
        (Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonActionsFileName' -DefaultValue '')
        (Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonBridgeFileName' -DefaultValue '')
        (Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonDisplayName' -DefaultValue '')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }

    foreach ($signal in @($signals)) {
        if ([string]$signal -match 'flowcell') {
            return 'blender_bridge_flowcell'
        }
    }

    return 'blender_bridge'
}

function Resolve-FlowCellBlenderBridgeFolder {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $configuredBridgeRoot = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''
    if (-not [string]::IsNullOrWhiteSpace($configuredBridgeRoot)) {
        try {
            return [System.IO.Path]::GetFullPath($configuredBridgeRoot)
        }
        catch {
            return $configuredBridgeRoot.Trim()
        }
    }

    $defaultFolderName = Get-FlowCellBlenderDefaultBridgeFolderName -Config $Config
    $blenderAppDataRoot = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Blender Foundation\Blender'
    if (-not (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container)) {
        return ''
    }

    $versionDirectories = @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    foreach ($versionDirectory in $versionDirectories) {
        if (-not [string]::IsNullOrWhiteSpace($defaultFolderName)) {
            $candidate = Join-Path $versionDirectory.FullName ('scripts\addons\{0}' -f [string]$defaultFolderName)
            if (Test-Path -LiteralPath $candidate -PathType Container) {
                return $candidate
            }
        }
    }

    if ($versionDirectories.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($defaultFolderName)) {
        return (Join-Path $versionDirectories[0].FullName ('scripts\addons\{0}' -f $defaultFolderName))
    }

    return ''
}

function Get-FlowCellBlenderAddonTemplatePath {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [Parameter(Mandatory = $true)]
        [string]$AutomationPropertyName
    )

    $fileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name $AutomationPropertyName -DefaultValue ''
    if ([string]::IsNullOrWhiteSpace($fileName)) {
        return ''
    }

    $repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
    foreach ($addonScriptsRoot in @(
        (Join-Path $repoRoot 'Programs\Blender\AddonScripts'),
        (Join-Path $repoRoot 'Blender\AddonScripts')
    )) {
        $candidate = Join-Path $addonScriptsRoot $fileName
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return ''
}

function Get-FlowCellBlenderBridgeLayout {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [string]$BridgeFolder = ''
    )

    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        $BridgeFolder = Resolve-FlowCellBlenderBridgeFolder -Config $Config
    }
    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        throw 'Blender bridge folder could not be resolved. Set automation.bridgeFolder or install/reload the FlowCell Blender add-on.'
    }

    try {
        $BridgeFolder = [System.IO.Path]::GetFullPath($BridgeFolder)
    }
    catch {
        $BridgeFolder = $BridgeFolder.Trim()
    }

    $bridgeFolderName = Split-Path -Path $BridgeFolder -Leaf
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName)) {
        $bridgeFolderName = Get-FlowCellBlenderDefaultBridgeFolderName -Config $Config
    }

    $addonRoot = Split-Path -Parent $BridgeFolder
    $customActionsFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'customActionsFileName' -DefaultValue 'flowcell_custom_actions.json'
    $addonActionsFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonActionsFileName' -DefaultValue 'flowcell_actions.py'
    $addonBridgeFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonBridgeFileName' -DefaultValue 'flowcell_bridge.py'
    $setupStatusFileName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'setupStatusFileName' -DefaultValue 'flowcell_bridge_setup.json'
    $generatedActionPrefix = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'generatedActionPrefix' -DefaultValue 'custom_'
    $generatedFunctionPrefix = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'generatedFunctionPrefix' -DefaultValue 'perform_flowcell_custom_'
    $generatedRunNamePrefix = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'generatedRunNamePrefix' -DefaultValue 'flowcell_custom_'
    $generatedSourceRunNamePrefix = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'generatedSourceRunNamePrefix' -DefaultValue 'flowcell_custom_source_'
    $builtInOperatorPrefix = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'builtInOperatorPrefix' -DefaultValue 'live_snapshot'
    $addonDisplayName = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonDisplayName' -DefaultValue 'Flowcell'
    $addonDescription = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'addonDescription' -DefaultValue 'FlowCell Blender actions.'
    $addonActionsTemplatePath = Get-FlowCellBlenderAddonTemplatePath -Config $Config -AutomationPropertyName 'addonActionsFileName'
    $addonBridgeTemplatePath = Get-FlowCellBlenderAddonTemplatePath -Config $Config -AutomationPropertyName 'addonBridgeFileName'

    return [pscustomobject]@{
        BridgeFolder = $BridgeFolder
        BridgeFolderName = $bridgeFolderName
        AddonRoot = $addonRoot
        CustomActionsFileName = $customActionsFileName
        CustomRegistryPath = Join-Path $BridgeFolder $customActionsFileName
        AddonActionsFileName = $addonActionsFileName
        AddonActionsPath = Join-Path $addonRoot $addonActionsFileName
        AddonActionsModuleName = [System.IO.Path]::GetFileNameWithoutExtension($addonActionsFileName)
        AddonActionsTemplatePath = $addonActionsTemplatePath
        AddonBridgeFileName = $addonBridgeFileName
        AddonBridgePath = Join-Path $addonRoot $addonBridgeFileName
        AddonBridgeModuleName = [System.IO.Path]::GetFileNameWithoutExtension($addonBridgeFileName)
        AddonBridgeTemplatePath = $addonBridgeTemplatePath
        SetupStatusFileName = $setupStatusFileName
        SetupStatusPath = Join-Path $BridgeFolder $setupStatusFileName
        GeneratedActionPrefix = $generatedActionPrefix
        GeneratedFunctionPrefix = $generatedFunctionPrefix
        GeneratedRunNamePrefix = $generatedRunNamePrefix
        GeneratedSourceRunNamePrefix = $generatedSourceRunNamePrefix
        BuiltInOperatorPrefix = $builtInOperatorPrefix
        AddonDisplayName = $addonDisplayName
        AddonDescription = $addonDescription
    }
}

function Ensure-FlowCellBlenderBridgeRuntime {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Layout
    )

    $bridgeFolder = [string]$Layout.BridgeFolder
    $addonRoot = [string]$Layout.AddonRoot
    if (-not [string]::IsNullOrWhiteSpace($bridgeFolder)) {
        New-Item -ItemType Directory -Path $bridgeFolder -Force | Out-Null
    }
    if (-not [string]::IsNullOrWhiteSpace($addonRoot)) {
        New-Item -ItemType Directory -Path $addonRoot -Force | Out-Null
    }

    $copyTargets = @(
        @{
            Source = [string]$Layout.AddonActionsTemplatePath
            Target = [string]$Layout.AddonActionsPath
            Label = 'actions'
        }
        @{
            Source = [string]$Layout.AddonBridgeTemplatePath
            Target = [string]$Layout.AddonBridgePath
            Label = 'bridge'
        }
    )

    foreach ($copyTarget in $copyTargets) {
        $targetPath = [string]$copyTarget.Target
        if ([string]::IsNullOrWhiteSpace($targetPath) -or (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
            continue
        }

        $sourcePath = [string]$copyTarget.Source
        if ([string]::IsNullOrWhiteSpace($sourcePath) -or -not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw ('Blender FlowCell {0} template was not found: {1}' -f [string]$copyTarget.Label, $sourcePath)
        }

        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    }
}
