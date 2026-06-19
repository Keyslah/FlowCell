param(
    [string]$RepoRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-RepoRoot {
    param([string]$Candidate)

    if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
        $full = [System.IO.Path]::GetFullPath($Candidate)
        if (Test-Path -LiteralPath (Join-Path $full 'FlowCell\FlowCellCommandBackend.ps1') -PathType Leaf) {
            return $full
        }
        throw "RepoRoot does not contain FlowCell\FlowCellCommandBackend.ps1: $full"
    }

    $current = [System.IO.DirectoryInfo](Get-Location)
    while ($null -ne $current) {
        $candidateFile = Join-Path $current.FullName 'FlowCell\FlowCellCommandBackend.ps1'
        if (Test-Path -LiteralPath $candidateFile -PathType Leaf) {
            return $current.FullName
        }
        $current = $current.Parent
    }

    throw 'Could not find FlowCell\FlowCellCommandBackend.ps1. Run this from the FlowCell repo root or pass -RepoRoot.'
}

$root = Resolve-RepoRoot -Candidate $RepoRoot
$targetPath = Join-Path $root 'FlowCell\FlowCellCommandBackend.ps1'
$raw = [System.IO.File]::ReadAllText($targetPath)

if ($raw -match 'Resolve-FlowCellBlenderBridgeActionForScriptPath') {
    exit 0
}

$helperBlock = @'
function Get-FlowCellBlenderProgramRoot {
    $programsRoot = Join-Path $script:FlowCellHomeRoot 'Programs\Blender'
    if (Test-Path -LiteralPath $programsRoot -PathType Container) {
        return $programsRoot
    }

    return (Join-Path $script:FlowCellHomeRoot 'Blender')
}

function Get-FlowCellJsonStringProperty($Source, [string]$Name) {
    if ($null -eq $Source -or [string]::IsNullOrWhiteSpace($Name)) {
        return ''
    }

    $property = $Source.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return ''
    }

    return [string]$property.Value
}

function Resolve-FlowCellBlenderBridgeActionForScriptPath([string]$ScriptPath) {
    $normalizedScriptPath = Get-FlowCellNormalizedPath $ScriptPath
    if ([string]::IsNullOrWhiteSpace($normalizedScriptPath)) {
        return ''
    }

    if ([string]$ScriptPath -imatch '\.flowcell-panel-item\.json$' -and (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        try {
            $record = Get-Content -LiteralPath $ScriptPath -Raw | ConvertFrom-Json
            $action = Get-FlowCellJsonStringProperty -Source $record -Name 'bridgeAction'
            if (-not [string]::IsNullOrWhiteSpace($action)) {
                return $action.Trim()
            }
        }
        catch {
        }
    }

    $blenderRoot = Get-FlowCellBlenderProgramRoot
    $panelsRoot = Join-Path $blenderRoot 'Panels'
    if (Test-Path -LiteralPath $panelsRoot -PathType Container) {
        foreach ($recordPath in @(Get-ChildItem -LiteralPath $panelsRoot -Recurse -Filter '*.flowcell-panel-item.json' -File -ErrorAction SilentlyContinue)) {
            try {
                $record = Get-Content -LiteralPath $recordPath.FullName -Raw | ConvertFrom-Json
                $sourcePath = Get-FlowCellJsonStringProperty -Source $record -Name 'sourcePath'
                $executionTarget = Get-FlowCellJsonStringProperty -Source $record -Name 'executionTarget'

                if (
                    (Get-FlowCellNormalizedPath $sourcePath) -eq $normalizedScriptPath -or
                    (Get-FlowCellNormalizedPath $executionTarget) -eq $normalizedScriptPath
                ) {
                    $action = Get-FlowCellJsonStringProperty -Source $record -Name 'bridgeAction'
                    if (-not [string]::IsNullOrWhiteSpace($action)) {
                        return $action.Trim()
                    }
                }
            }
            catch {
            }
        }
    }

    $managedRoot = Join-Path $blenderRoot 'ManagedActions'
    if (Test-Path -LiteralPath $managedRoot -PathType Container) {
        $normalizedManagedRoot = Get-FlowCellNormalizedPath $managedRoot
        if ($normalizedScriptPath -eq $normalizedManagedRoot -or $normalizedScriptPath.StartsWith($normalizedManagedRoot + '\')) {
            $stem = [System.IO.Path]::GetFileNameWithoutExtension([string]$ScriptPath)
            if (-not [string]::IsNullOrWhiteSpace($stem)) {
                return $stem
            }
        }
    }

    return ''
}

'@

$marker = 'function Get-FlowCellBlenderConfigPath'
if (-not $raw.Contains($marker)) {
    throw "Patch marker not found: $marker"
}
$raw = $raw.Replace($marker, $helperBlock + $marker)

$oldBlock = @'
    $programLabel = if ($Envelope.program.PSObject.Properties['label']) { [string]$Envelope.program.label } else { '' }
    $programKey = Get-ProgramLabelKey $programLabel
    Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=controller_cli; Target={1}; Program={2}' -f [string]$Envelope.command_id, $resolvedTarget, $programKey)
    $exitCode = Invoke-FlowCellControllerCli -Arguments @(
        ('--run-script-path={0}' -f $resolvedTarget),
        ('--run-script-program={0}' -f $programKey),
        ('--run-script-program-tab-id={0}' -f [int]$Envelope.program_id)
    )
'@

$newBlock = @'
    $programLabel = if ($Envelope.program.PSObject.Properties['label']) { [string]$Envelope.program.label } else { '' }
    $programKey = Get-ProgramLabelKey $programLabel

    if ($programKey -eq 'blender') {
        $bridgeAction = Resolve-FlowCellBlenderBridgeActionForScriptPath -ScriptPath $resolvedTarget
        if ([string]::IsNullOrWhiteSpace($bridgeAction)) {
            throw ("Blender script target is missing bridge metadata and will not be opened through Windows defaults: {0}" -f $resolvedTarget)
        }

        Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=blender_bridge; Target={1}; Action={2}' -f [string]$Envelope.command_id, $resolvedTarget, $bridgeAction)
        $response = Invoke-FlowCellBlenderBridgeRequest -Action $bridgeAction -Data @{}
        $statusText = if ($response.PSObject.Properties['display'] -and -not [string]::IsNullOrWhiteSpace([string]$response.display)) {
            [string]$response.display
        }
        elseif ($response.PSObject.Properties['message'] -and -not [string]::IsNullOrWhiteSpace([string]$response.message)) {
            [string]$response.message
        }
        else {
            'Blender action completed.'
        }
        Write-SharedTextFile -Path $script:LastActionStatusPath -Text $statusText
        Write-CommandHostLog ('Bridge/runner execution result. CommandId={0}; Method=blender_bridge; Status=ok; Message={1}' -f [string]$Envelope.command_id, $statusText)
        return (New-BackendResult -Succeeded $true -Message $statusText -ResolvedTarget $resolvedTarget -ExecutionMethod 'blender_bridge' -Details $response)
    }

    Write-CommandHostLog ('Resolved execution target. CommandId={0}; Method=controller_cli; Target={1}; Program={2}' -f [string]$Envelope.command_id, $resolvedTarget, $programKey)
    $exitCode = Invoke-FlowCellControllerCli -Arguments @(
        ('--run-script-path={0}' -f $resolvedTarget),
        ('--run-script-program={0}' -f $programKey),
        ('--run-script-program-tab-id={0}' -f [int]$Envelope.program_id)
    )
'@

if (-not $raw.Contains($oldBlock)) {
    throw 'Patch target block not found. File may have changed; do not guess.'
}

$raw = $raw.Replace($oldBlock, $newBlock)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetPath, $raw, $utf8NoBom)
