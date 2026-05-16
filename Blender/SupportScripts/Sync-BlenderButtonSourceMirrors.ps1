param(
    [string]$StatePath = '',
    [string]$ConfigPath = '',
    [string]$LibraryOutputRoot = '',
    [string]$ActiveOutputRoot = '',
    [switch]$RefreshDescriptions
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$projectRoot = Join-Path $repoRoot 'Blender'
$localConfigPath = Join-Path $repoRoot 'FlowCell\local\private\blender.config.local.json'
$updateDescriptionPath = Join-Path $PSScriptRoot 'Update-BlenderFlowCellButtonDescription.ps1'
$exportPath = Join-Path $PSScriptRoot 'Export-BlenderPanelAddScriptSources.ps1'
$customActionSyncPath = Join-Path $PSScriptRoot 'Sync-BlenderCustomActionCode.ps1'

if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $repoRoot 'FlowCell\local\flowcell_state.json'
}
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = if (Test-Path -LiteralPath $localConfigPath -PathType Leaf) { $localConfigPath } else { Join-Path $projectRoot 'config.json' }
}
if ([string]::IsNullOrWhiteSpace($LibraryOutputRoot)) {
    $LibraryOutputRoot = Join-Path $projectRoot 'Blender Scripts'
}
if ([string]::IsNullOrWhiteSpace($ActiveOutputRoot)) {
    $ActiveOutputRoot = Join-Path $projectRoot 'Blender Active Scripts'
}

foreach ($requiredPath in @($StatePath, $ConfigPath, $updateDescriptionPath, $exportPath, $customActionSyncPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required file was not found: $requiredPath"
    }
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

function Get-FirstNonEmptyValue {
    param(
        [string[]]$Values
    )

    foreach ($value in @($Values)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }

    return ''
}

$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$blenderProgram = @($state.Programs | Where-Object { [string]$_.ProgramConfig.NormalizedName -ieq 'blender' })[0]
if ($null -eq $blenderProgram) {
    throw "Could not find the Blender program in $StatePath"
}

$buttonRecords = New-Object System.Collections.Generic.List[object]
foreach ($panel in @($blenderProgram.Panels)) {
    foreach ($button in @($panel.Buttons)) {
        $target = if ($button.PSObject.Properties['Target']) { [string]$button.Target } else { '' }
        $executionTarget = if ($button.PSObject.Properties['ExecutionTarget']) { [string]$button.ExecutionTarget } else { '' }
        $syncKey = Get-FirstNonEmptyValue @($executionTarget, $target)
        if ([string]::IsNullOrWhiteSpace($syncKey)) {
            continue
        }

        $buttonRecords.Add([pscustomobject]@{
            Panel = [string]$panel.Name
            Label = [string]$button.Label
            Target = $target
            ExecutionTarget = $executionTarget
            Description = Get-FirstNonEmptyValue @(
                [string]$(if ($button.PSObject.Properties['Tooltip']) { $button.Tooltip } else { '' }),
                [string]$button.Label
            )
            SyncKey = $syncKey
            SyncKeyNormalized = Get-NormalizedPathKey $syncKey
        }) | Out-Null
    }
}

$descriptionSyncCount = 0
$uniqueButtonTargetCount = 0

if ($RefreshDescriptions) {
    $buttonGroups = @{}
    foreach ($record in $buttonRecords.ToArray()) {
        $groupKey = [string]$record.SyncKeyNormalized
        if (-not $buttonGroups.ContainsKey($groupKey)) {
            $buttonGroups[$groupKey] = New-Object System.Collections.Generic.List[object]
        }
        $buttonGroups[$groupKey].Add($record) | Out-Null
    }

    foreach ($groupEntry in $buttonGroups.GetEnumerator()) {
        $group = $groupEntry.Value.ToArray()
        if ($group.Count -eq 0) {
            continue
        }

        $descriptions = @(
            $group |
              ForEach-Object { [string]$_.Description } |
              Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } |
              Select-Object -Unique
        )
        if ($descriptions.Count -gt 1) {
            $labels = ($group | ForEach-Object { [string]$_.Label } | Select-Object -Unique) -join ', '
            throw ("Conflicting descriptions were found for Blender target {0}. Buttons: {1}." -f [string]$group[0].SyncKey, $labels)
        }

        $record = $group[0]
        $description = if ($descriptions.Count -gt 0) { [string]$descriptions[0] } else { [string]$record.Label }
        & $updateDescriptionPath `
            -ButtonTarget ([string]$record.Target) `
            -ExecutionTarget ([string]$record.ExecutionTarget) `
            -Description $description `
            -ConfigPath $ConfigPath `
            -SkipCustomActionSync | Out-Null
        $descriptionSyncCount++
    }

    & $customActionSyncPath -ConfigPath $ConfigPath | Out-Null
    $uniqueButtonTargetCount = $buttonGroups.Count
}

$libraryResult = & $exportPath -StatePath $StatePath -OutputRoot $LibraryOutputRoot | ConvertFrom-Json
$activeResult = & $exportPath -StatePath $StatePath -OutputRoot $ActiveOutputRoot | ConvertFrom-Json

[pscustomobject]@{
    RefreshDescriptions = [bool]$RefreshDescriptions
    DescriptionSyncCount = $descriptionSyncCount
    UniqueButtonTargetCount = $uniqueButtonTargetCount
    ButtonCount = $buttonRecords.Count
    LibraryOutputRoot = $LibraryOutputRoot
    ActiveOutputRoot = $ActiveOutputRoot
    LibraryManifestPath = [string]$libraryResult.ManifestPath
    ActiveManifestPath = [string]$activeResult.ManifestPath
    StatusMessage = 'Blender button source mirrors refreshed.'
} | ConvertTo-Json -Depth 4
