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

function Get-FlowCellBlenderBridgeLayout {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [string]$BridgeFolder = ''
    )

    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        $BridgeFolder = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''
    }
    if ([string]::IsNullOrWhiteSpace($BridgeFolder)) {
        throw 'Blender config is missing automation.bridgeFolder.'
    }

    try {
        $BridgeFolder = [System.IO.Path]::GetFullPath($BridgeFolder)
    }
    catch {
        $BridgeFolder = $BridgeFolder.Trim()
    }

    $bridgeFolderName = Split-Path -Path $BridgeFolder -Leaf
    if ([string]::IsNullOrWhiteSpace($bridgeFolderName)) {
        $bridgeFolderName = 'blender_bridge'
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

    return [pscustomobject]@{
        BridgeFolder = $BridgeFolder
        BridgeFolderName = $bridgeFolderName
        AddonRoot = $addonRoot
        CustomActionsFileName = $customActionsFileName
        CustomRegistryPath = Join-Path $BridgeFolder $customActionsFileName
        AddonActionsFileName = $addonActionsFileName
        AddonActionsPath = Join-Path $addonRoot $addonActionsFileName
        AddonActionsModuleName = [System.IO.Path]::GetFileNameWithoutExtension($addonActionsFileName)
        AddonBridgeFileName = $addonBridgeFileName
        AddonBridgePath = Join-Path $addonRoot $addonBridgeFileName
        AddonBridgeModuleName = [System.IO.Path]::GetFileNameWithoutExtension($addonBridgeFileName)
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
