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

    return 'blender_bridge_flowcell'
}

function Get-FlowCellBlenderVersionSortRecord([System.IO.DirectoryInfo]$Directory, [string[]]$ActiveVersionNames) {
    $parts = @([regex]::Matches([string]$Directory.Name, '\d+') | ForEach-Object { [int]$_.Value })
    $isActive = $false
    foreach ($activeVersionName in @($ActiveVersionNames)) {
        if ([string]$Directory.Name -ieq [string]$activeVersionName -or [string]$Directory.Name -like (([string]$activeVersionName) + '.*')) {
            $isActive = $true
            break
        }
    }

    return [pscustomobject]@{
        Directory = $Directory
        IsActive = $isActive
        Major = if ($parts.Count -gt 0) { $parts[0] } else { -1 }
        Minor = if ($parts.Count -gt 1) { $parts[1] } else { -1 }
        Patch = if ($parts.Count -gt 2) { $parts[2] } else { -1 }
        Revision = if ($parts.Count -gt 3) { $parts[3] } else { -1 }
    }
}

function Get-FlowCellRunningBlenderVersionNames {
    $versions = New-Object System.Collections.Generic.List[string]
    foreach ($process in @(Get-Process blender -ErrorAction SilentlyContinue)) {
        foreach ($value in @(
            [string]$(try { $process.MainModule.FileVersionInfo.ProductVersion } catch { '' }),
            [string]$(try { $process.MainModule.FileVersionInfo.FileVersion } catch { '' }),
            [string]$(try { Split-Path -Leaf (Split-Path -Parent $process.MainModule.FileName) } catch { '' })
        )) {
            if ($value -match '(?<!\d)(\d+\.\d+)(?!\d)') {
                $version = [string]$Matches[1]
                if (-not $versions.Contains($version)) {
                    [void]$versions.Add($version)
                }
            }
        }
    }
    return @($versions)
}

function Test-FlowCellBlenderBridgeFolder {
    param(
        [Parameter(Mandatory = $true)][object]$Config,
        [Parameter(Mandatory = $true)][string]$BridgeFolder
    )

    if ([string]::IsNullOrWhiteSpace($BridgeFolder) -or -not (Test-Path -LiteralPath $BridgeFolder -PathType Container)) {
        return $false
    }

    $addonRoot = Split-Path -Parent $BridgeFolder

    return (
        (Test-Path -LiteralPath (Join-Path $BridgeFolder 'flowcell_custom_actions.json') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $BridgeFolder 'ManagedActions') -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_actions.py') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $addonRoot 'flowcell_bridge.py') -PathType Leaf)
    )
}

function Resolve-FlowCellBlenderBridgeFolder {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,
        [switch]$IncludeDiagnostics
    )

    $checkedPaths = New-Object System.Collections.Generic.List[string]
    $configuredBridgeRoot = Get-FlowCellBlenderAutomationStringValue -Config $Config -Name 'bridgeFolder' -DefaultValue ''
    if (-not [string]::IsNullOrWhiteSpace($configuredBridgeRoot)) {
        try {
            $configuredBridgeRoot = [System.IO.Path]::GetFullPath($configuredBridgeRoot)
        }
        catch {
            $configuredBridgeRoot = $configuredBridgeRoot.Trim()
        }
        [void]$checkedPaths.Add($configuredBridgeRoot)
        if (Test-FlowCellBlenderBridgeFolder -Config $Config -BridgeFolder $configuredBridgeRoot) {
            $result = [pscustomobject]@{
                BridgeFolder = $configuredBridgeRoot
                Source = 'config'
                CheckedPaths = @($checkedPaths)
                VersionFolders = @()
            }
            if ($IncludeDiagnostics) { return $result }
            return [string]$result.BridgeFolder
        }
    }

    $applicationDataRoot = [string]$env:APPDATA
    if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
    }
    $blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'
    $versionDirectories = if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue)
    }
    else {
        @()
    }
    $activeVersionNames = @(Get-FlowCellRunningBlenderVersionNames)
    $sortedVersionRecords = @(
        $versionDirectories |
            ForEach-Object { Get-FlowCellBlenderVersionSortRecord -Directory $_ -ActiveVersionNames $activeVersionNames } |
            Sort-Object @{ Expression = { $_.IsActive }; Descending = $true },
                @{ Expression = { $_.Major }; Descending = $true },
                @{ Expression = { $_.Minor }; Descending = $true },
                @{ Expression = { $_.Patch }; Descending = $true },
                @{ Expression = { $_.Revision }; Descending = $true },
                @{ Expression = { $_.Directory.Name }; Descending = $true }
    )

    foreach ($versionRecord in $sortedVersionRecords) {
        $candidate = Join-Path $versionRecord.Directory.FullName 'scripts\addons\blender_bridge_flowcell'
        if (-not $checkedPaths.Contains($candidate)) {
            [void]$checkedPaths.Add($candidate)
        }
        if (Test-FlowCellBlenderBridgeFolder -Config $Config -BridgeFolder $candidate) {
            $result = [pscustomobject]@{
                BridgeFolder = $candidate
                Source = 'runtime auto-resolve'
                CheckedPaths = @($checkedPaths)
                VersionFolders = @($sortedVersionRecords | ForEach-Object { $_.Directory.FullName })
            }
            if ($IncludeDiagnostics) { return $result }
            return [string]$result.BridgeFolder
        }
    }

    $unresolved = [pscustomobject]@{
        BridgeFolder = ''
        Source = 'unresolved'
        CheckedPaths = @($checkedPaths)
        VersionFolders = @($sortedVersionRecords | ForEach-Object { $_.Directory.FullName })
    }
    if ($IncludeDiagnostics) { return $unresolved }
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
        (Join-Path $repoRoot 'Programs\Blender\Blender Addons - Copy contents Into Blender'),
        (Join-Path $repoRoot 'Blender\Blender Addons - Copy contents Into Blender')
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
        throw 'Blender bridge folder could not be resolved. Install or reload the FlowCell Blender add-on. Use automation.bridgeFolder only for a nonstandard Blender add-ons location.'
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
