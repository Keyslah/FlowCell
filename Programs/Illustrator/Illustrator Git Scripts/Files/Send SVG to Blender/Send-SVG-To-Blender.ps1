param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$internalOwnerButtonId = 'internal-illustrator-svg-import'
$internalBridgeAction = 'flowcell_button_{0}' -f $internalOwnerButtonId
$orcaBundledSourceId = 'blender.orca'
$bridgeResponseTimeoutSeconds = 110
$statusFileName = 'send-svg-to-blender.status.txt'
$mutexName = 'Local\FlowCell.SendSvgToBlender'
$requestId = ''
$importedCount = 0
$exitCode = 1
$mutex = $null
$ownsMutex = $false
$bridgeStatusPath = ''
$orcaBridgeStatusPath = ''

function Get-ObjectPropertyValue {
    param(
        [object]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Source) {
        return $null
    }

    $property = $Source.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function ConvertTo-SingleLineMessage {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return 'Send SVG to Blender failed.'
    }

    $singleLine = [regex]::Replace($Message, '[\x00-\x1F\x7F]+', ' ')
    $singleLine = [regex]::Replace($singleLine, '\s{2,}', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($singleLine)) {
        return 'Send SVG to Blender failed.'
    }

    return $singleLine
}

function Write-HandoffStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string]$CorrelationId,
        [Parameter(Mandatory = $true)]
        [ValidateSet('Ok', 'Error')]
        [string]$Status,
        [string]$Message,
        [int]$Count
    )

    $folder = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }

    $lines = @(
        'RequestId={0}' -f $CorrelationId
        'Status={0}' -f $Status
        'Message={0}' -f (ConvertTo-SingleLineMessage -Message $Message)
        'ImportedCount={0}' -f ([Math]::Max($Count, 0))
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $temporaryPath = '{0}.{1}.{2}.tmp' -f $Path, $PID, ([guid]::NewGuid().ToString('N'))

    try {
        [System.IO.File]::WriteAllLines($temporaryPath, $lines, $utf8NoBom)
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            try {
                [System.IO.File]::Replace($temporaryPath, $Path, $null)
            }
            catch {
                Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
            }
        }
        else {
            Move-Item -LiteralPath $temporaryPath -Destination $Path
        }
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Resolve-FlowCellRepoRoot {
    param([Parameter(Mandatory = $true)][string]$StartPath)

    $current = [System.IO.DirectoryInfo](Get-Item -LiteralPath $StartPath -ErrorAction Stop)
    while ($null -ne $current) {
        $invokeCandidate = Join-Path $current.FullName 'Programs\Blender\SupportScripts\Invoke-BlenderFlowCellAction.ps1'
        if (Test-Path -LiteralPath $invokeCandidate -PathType Leaf) {
            return $current.FullName
        }
        $current = $current.Parent
    }

    throw 'Could not resolve the FlowCell repository root from the installed Illustrator Button.'
}

function Register-InternalBlenderAction {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $installerPath = Join-Path $RepoRoot 'Programs\Blender\SupportScripts\Install-BlenderFlowCellButtons.ps1'
    $sourcePath = Join-Path $RepoRoot 'Programs\Blender\Blender Git Scripts\Files\Import Illustrator SVG\import illustrator svg.py'
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Blender action registry installer not found: $installerPath"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Illustrator SVG Blender importer not found: $sourcePath"
    }

    $installOutput = @(& $installerPath `
        -SelectedPaths @($sourcePath) `
        -PanelName 'Internal' `
        -OwnerButtonId $internalOwnerButtonId `
        -BridgeDataJson '{}' `
        -RegistryOnly `
        -SkipSync)

    $installText = ($installOutput | ForEach-Object { [string]$_ }) -join "`n"
    try {
        $installResult = $installText | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Blender returned an invalid internal action registration response: $($_.Exception.Message)"
    }
    if ([int](Get-ObjectPropertyValue -Source $installResult -Name 'installedCount') -ne 1) {
        $failure = [string](Get-ObjectPropertyValue -Source $installResult -Name 'firstFailureMessage')
        if ([string]::IsNullOrWhiteSpace($failure)) {
            $failure = 'The registry installer did not register exactly one action.'
        }
        throw $failure
    }

    $registeredResult = @((Get-ObjectPropertyValue -Source $installResult -Name 'results')) | Select-Object -First 1
    $registeredAction = [string](Get-ObjectPropertyValue -Source $registeredResult -Name 'action')
    if ($registeredAction.Trim() -cne $internalBridgeAction) {
        throw "Blender registered unexpected internal action '$registeredAction'."
    }
    return $internalBridgeAction
}

function Resolve-ActiveBlenderBundledAction {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$BundledSourceId
    )

    $panelRoot = Join-Path $RepoRoot 'Programs\Blender\Panels\Files'
    if (-not (Test-Path -LiteralPath $panelRoot -PathType Container)) {
        throw "Blender Files panel records were not found: $panelRoot"
    }

    $matches = New-Object System.Collections.Generic.List[object]
    foreach ($recordFile in @(Get-ChildItem -LiteralPath $panelRoot -Filter '*.flowcell-source.json' -File -ErrorAction Stop)) {
        $recordText = Get-Content -LiteralPath $recordFile.FullName -Raw -Encoding UTF8
        try {
            $record = $recordText | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            if ($recordText -match [regex]::Escape($BundledSourceId)) {
                throw "The active Blender record for '$BundledSourceId' is invalid JSON: $($recordFile.FullName)"
            }
            continue
        }

        $recordSourceId = [string](Get-ObjectPropertyValue -Source $record -Name 'bundledSourceId')
        if ($recordSourceId.Trim() -ieq $BundledSourceId) {
            $matches.Add([pscustomobject]@{
                File = $recordFile
                Record = $record
            }) | Out-Null
        }
    }

    if ($matches.Count -eq 0) {
        throw "The Blender Files '$BundledSourceId' Button is not installed. Add it in FlowCell, finish its normal setup if prompted, and try again."
    }
    if ($matches.Count -ne 1) {
        throw "FlowCell found $($matches.Count) active Blender Files records for '$BundledSourceId'; exactly one is required."
    }

    $activeRecord = $matches[0].Record
    $programId = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'programId')
    $panelName = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'panelName')
    $runner = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'runner')
    $ownerButtonId = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'ownerButtonId')
    $bridgeAction = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'bridgeAction')
    if ($programId.Trim() -ine 'blender' -or
        $panelName.Trim() -ine 'Files' -or
        $runner.Trim() -ine 'blender-bridge' -or
        [string]::IsNullOrWhiteSpace($ownerButtonId) -or
        $ownerButtonId.Trim() -cnotmatch '^[A-Za-z0-9_-]+$' -or
        [string]::IsNullOrWhiteSpace($bridgeAction)) {
        throw "The installed Blender Files '$BundledSourceId' Button has an invalid active action contract."
    }

    $expectedBridgeAction = 'flowcell_button_{0}' -f $ownerButtonId.Trim().ToLowerInvariant()
    if ($bridgeAction.Trim() -cne $expectedBridgeAction) {
        throw "The installed Blender Files '$BundledSourceId' Button action does not match its owner."
    }

    return $bridgeAction.Trim()
}

function Get-BlenderExecutableVersion {
    param([Parameter(Mandatory = $true)][string]$Path)

    $versionTexts = New-Object System.Collections.Generic.List[string]
    try {
        $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
        if (-not [string]::IsNullOrWhiteSpace([string]$versionInfo.ProductVersion)) {
            $versionTexts.Add([string]$versionInfo.ProductVersion) | Out-Null
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$versionInfo.FileVersion)) {
            $versionTexts.Add([string]$versionInfo.FileVersion) | Out-Null
        }
    }
    catch {
    }
    $versionTexts.Add($Path) | Out-Null

    foreach ($versionText in @($versionTexts)) {
        if ($versionText -match '(?<!\d)(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?') {
            $patch = if ([string]::IsNullOrWhiteSpace([string]$Matches.patch)) { 0 } else { [int]$Matches.patch }
            return [version]('{0}.{1}.{2}' -f [int]$Matches.major, [int]$Matches.minor, $patch)
        }
    }

    return [version]'0.0.0'
}

function Resolve-NewestBlenderExecutable {
    $candidatePaths = New-Object System.Collections.Generic.List[string]
    $seenPaths = @{}

    $addCandidate = {
        param([string]$CandidatePath)

        if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
            return
        }
        $expandedPath = [Environment]::ExpandEnvironmentVariables($CandidatePath).Trim().Trim('"')
        if (-not (Test-Path -LiteralPath $expandedPath -PathType Leaf)) {
            return
        }
        try {
            $expandedPath = [System.IO.Path]::GetFullPath($expandedPath)
        }
        catch {
            return
        }
        $pathKey = $expandedPath.ToLowerInvariant()
        if (-not $seenPaths.ContainsKey($pathKey)) {
            $seenPaths[$pathKey] = $true
            $candidatePaths.Add($expandedPath) | Out-Null
        }
    }

    foreach ($command in @(Get-Command blender.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        & $addCandidate ([string]$command.Path)
    }

    $appPathKeys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
    )
    foreach ($appPathKey in $appPathKeys) {
        try {
            $registryKey = Get-Item -LiteralPath $appPathKey -ErrorAction Stop
            & $addCandidate ([string]$registryKey.GetValue(''))
        }
        catch {
        }
    }

    $installRoots = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) {
        $installRoots.Add((Join-Path $env:LOCALAPPDATA 'Programs\Blender Foundation')) | Out-Null
        $installRoots.Add((Join-Path $env:LOCALAPPDATA 'Blender Foundation')) | Out-Null
    }
    foreach ($programFilesRoot in @([string]$env:ProgramFiles, [string]$env:ProgramW6432, [string]${env:ProgramFiles(x86)})) {
        if (-not [string]::IsNullOrWhiteSpace($programFilesRoot)) {
            $installRoots.Add((Join-Path $programFilesRoot 'Blender Foundation')) | Out-Null
        }
    }

    foreach ($installRoot in @($installRoots | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) {
            continue
        }
        & $addCandidate (Join-Path $installRoot 'blender.exe')
        foreach ($installDirectory in @(Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue)) {
            & $addCandidate (Join-Path $installDirectory.FullName 'blender.exe')
        }
    }

    if ($candidatePaths.Count -eq 0) {
        return ''
    }

    $rankedCandidates = foreach ($candidatePath in @($candidatePaths)) {
        $file = Get-Item -LiteralPath $candidatePath -ErrorAction Stop
        [pscustomobject]@{
            Path = $candidatePath
            Version = Get-BlenderExecutableVersion -Path $candidatePath
            LastWriteTimeUtc = $file.LastWriteTimeUtc
        }
    }

    $selected = $rankedCandidates | Sort-Object -Property @(
        @{ Expression = { $_.Version }; Descending = $true }
        @{ Expression = { $_.LastWriteTimeUtc }; Descending = $true }
        @{ Expression = { $_.Path }; Descending = $true }
    ) | Select-Object -First 1
    return [string]$selected.Path
}

function Get-BridgeRootCandidates {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $roots = New-Object System.Collections.Generic.List[string]
    $seenRoots = @{}
    $addRoot = {
        param([string]$RootPath)
        if ([string]::IsNullOrWhiteSpace($RootPath)) {
            return
        }
        $expandedRoot = [Environment]::ExpandEnvironmentVariables($RootPath).Trim().Trim('"').TrimEnd('\')
        if ([string]::IsNullOrWhiteSpace($expandedRoot)) {
            return
        }
        $rootKey = $expandedRoot.ToLowerInvariant()
        if (-not $seenRoots.ContainsKey($rootKey)) {
            $seenRoots[$rootKey] = $true
            $roots.Add($expandedRoot) | Out-Null
        }
    }

    foreach ($configPath in @(
        (Join-Path $RepoRoot 'flowcellbackend\local\private\blender.config.local.json')
        (Join-Path $RepoRoot 'Programs\Blender\config.json')
    )) {
        if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
            continue
        }
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $automation = Get-ObjectPropertyValue -Source $config -Name 'automation'
            $configuredRoot = [string](Get-ObjectPropertyValue -Source $automation -Name 'bridgeFolder')
            & $addRoot $configuredRoot
        }
        catch {
        }
    }

    $applicationDataRoot = [string]$env:APPDATA
    if ([string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $applicationDataRoot = [Environment]::GetFolderPath('ApplicationData')
    }
    if (-not [string]::IsNullOrWhiteSpace($applicationDataRoot)) {
        $blenderAppDataRoot = Join-Path $applicationDataRoot 'Blender Foundation\Blender'
        if (Test-Path -LiteralPath $blenderAppDataRoot -PathType Container) {
            foreach ($versionDirectory in @(Get-ChildItem -LiteralPath $blenderAppDataRoot -Directory -ErrorAction SilentlyContinue)) {
                & $addRoot (Join-Path $versionDirectory.FullName 'scripts\addons\blender_bridge_flowcell')
            }
        }
    }

    return @($roots)
}

function Test-FlowCellBridgeReady {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][int[]]$ProcessIds
    )

    if (@($ProcessIds).Count -eq 0) {
        return $false
    }

    $runningProcessIds = @(
        Get-Process blender -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 } |
            Select-Object -ExpandProperty Id
    )
    if ($runningProcessIds.Count -eq 0) {
        return $false
    }

    foreach ($bridgeRoot in @(Get-BridgeRootCandidates -RepoRoot $RepoRoot)) {
        $runtimeStatusPath = Join-Path $bridgeRoot 'flowcell_bridge_runtime_status.json'
        if (-not (Test-Path -LiteralPath $runtimeStatusPath -PathType Leaf)) {
            continue
        }
        try {
            $runtimeStatus = Get-Content -LiteralPath $runtimeStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $lastEvent = Get-ObjectPropertyValue -Source $runtimeStatus -Name 'last_event'
            $runtimePid = [int](Get-ObjectPropertyValue -Source $lastEvent -Name 'pid')
            if (($ProcessIds -contains $runtimePid) -and ($runningProcessIds -contains $runtimePid)) {
                return $true
            }
        }
        catch {
        }
    }

    return $false
}

function Wait-ForFlowCellBlender {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [int[]]$InitialProcessIds,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max($TimeoutSeconds, 1))
    while ((Get-Date) -lt $deadline) {
        $currentProcessIds = @(Get-Process blender -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $processIds = @(@($InitialProcessIds) + $currentProcessIds | Select-Object -Unique)
        if (Test-FlowCellBridgeReady -RepoRoot $RepoRoot -ProcessIds $processIds) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Get-ImportedCountFromResponse {
    param(
        [object]$Response,
        [int]$FallbackCount
    )

    foreach ($propertyName in @('importedCount', 'imported_count')) {
        $value = Get-ObjectPropertyValue -Source $Response -Name $propertyName
        if ($null -ne $value) {
            $parsedCount = 0
            if ([int]::TryParse([string]$value, [ref]$parsedCount)) {
                return [Math]::Max($parsedCount, 0)
            }
        }
    }

    return [Math]::Max($FallbackCount, 0)
}

function Invoke-BlenderBridgeAction {
    param(
        [Parameter(Mandatory = $true)][string]$InvokeScript,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$DataJson,
        [Parameter(Mandatory = $true)][string]$StatusPath,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    $invokeParameters = @{
        Action = $Action
        Label = $Label
        DataJson = $DataJson
        PassThruResponse = $true
        StatusPath = $StatusPath
        ResponseTimeoutSeconds = $bridgeResponseTimeoutSeconds
    }
    $invokeOutput = @(& $InvokeScript @invokeParameters)
    $invokeExitCode = $LASTEXITCODE
    if ($invokeExitCode -ne 0) {
        $bridgeError = ''
        if (Test-Path -LiteralPath $StatusPath -PathType Leaf) {
            $bridgeError = [string](Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8)
        }
        if ([string]::IsNullOrWhiteSpace($bridgeError)) {
            $bridgeError = $FailureMessage
        }
        throw $bridgeError
    }

    $responses = @(
        $invokeOutput |
            Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['status'] } |
            Select-Object -Last 1
    )
    if ($responses.Count -eq 0) {
        throw "$Label completed without returning a FlowCell response."
    }
    return $responses[0]
}

$runtimeDirectory = Split-Path -Parent $RequestPath
$statusPath = Join-Path $runtimeDirectory $statusFileName

try {
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(120))
    }
    catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        throw 'Another Send SVG to Blender request is still running.'
    }

    if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
        throw "Illustrator export request not found: $RequestPath"
    }

    $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $requestId = [string](Get-ObjectPropertyValue -Source $request -Name 'requestId')
    $requestId = $requestId.Trim()
    if ([string]::IsNullOrWhiteSpace($requestId)) {
        throw 'The Illustrator export request is missing requestId.'
    }

    $schemaVersion = Get-ObjectPropertyValue -Source $request -Name 'schemaVersion'
    if ($null -eq $schemaVersion -or [int]$schemaVersion -ne 1) {
        throw 'The Illustrator export request has an unsupported schemaVersion.'
    }

    $postAction = [string](Get-ObjectPropertyValue -Source $request -Name 'postAction')
    if ([string]::IsNullOrWhiteSpace($postAction)) {
        $postAction = 'none'
    }
    $postAction = $postAction.Trim().ToLowerInvariant()
    if ($postAction -notin @('none', 'orca')) {
        throw "The Illustrator export request has unsupported postAction '$postAction'."
    }

    $items = @((Get-ObjectPropertyValue -Source $request -Name 'items'))
    if ($items.Count -eq 0) {
        throw 'The Illustrator export request contains no SVG items.'
    }
    foreach ($item in $items) {
        $svgPath = [string](Get-ObjectPropertyValue -Source $item -Name 'filepath')
        if ([string]::IsNullOrWhiteSpace($svgPath)) {
            throw 'An Illustrator export item is missing filepath.'
        }
        if (-not (Test-Path -LiteralPath $svgPath -PathType Leaf)) {
            throw "Exported SVG not found: $svgPath"
        }
    }

    $repoRoot = Resolve-FlowCellRepoRoot -StartPath $PSScriptRoot
    $orcaBridgeAction = ''
    if ($postAction -eq 'orca') {
        $orcaBridgeAction = Resolve-ActiveBlenderBundledAction -RepoRoot $repoRoot -BundledSourceId $orcaBundledSourceId
    }
    $bridgeAction = Register-InternalBlenderAction -RepoRoot $repoRoot
    $invokeScript = Join-Path $repoRoot 'Programs\Blender\SupportScripts\Invoke-BlenderFlowCellAction.ps1'

    $existingBlenderProcesses = @(Get-Process blender -ErrorAction SilentlyContinue)
    $startedBlender = $false
    $candidateProcessIds = @($existingBlenderProcesses | Select-Object -ExpandProperty Id)
    if ($existingBlenderProcesses.Count -eq 0) {
        $blenderExecutable = Resolve-NewestBlenderExecutable
        if ([string]::IsNullOrWhiteSpace($blenderExecutable)) {
            throw 'Blender is not running and blender.exe could not be found.'
        }

        $launchedProcess = Start-Process -FilePath $blenderExecutable -WindowStyle Normal -PassThru
        $startedBlender = $true
        $candidateProcessIds = @([int]$launchedProcess.Id)
    }

    $readyTimeoutSeconds = if ($startedBlender) { 90 } else { 10 }
    if (-not (Wait-ForFlowCellBlender -RepoRoot $repoRoot -InitialProcessIds $candidateProcessIds -TimeoutSeconds $readyTimeoutSeconds)) {
        if ($startedBlender) {
            throw 'Blender opened, but the FlowCell bridge add-on did not become ready. Enable or refresh the FlowCell add-on, then try again.'
        }
        throw 'The running Blender window does not report a ready FlowCell bridge. Enable or refresh the FlowCell add-on, then try again.'
    }

    $dataJson = [pscustomobject][ordered]@{ items = $items } | ConvertTo-Json -Depth 10 -Compress
    $bridgeStatusPath = Join-Path $runtimeDirectory ('send-svg-to-blender.bridge.{0}.tmp' -f $requestId)
    $response = Invoke-BlenderBridgeAction `
        -InvokeScript $invokeScript `
        -Action $bridgeAction `
        -Label 'Import Illustrator SVG' `
        -DataJson $dataJson `
        -StatusPath $bridgeStatusPath `
        -FailureMessage 'Blender did not complete the Illustrator SVG import.'

    $importedCount = Get-ImportedCountFromResponse -Response $response -FallbackCount $items.Count
    $message = [string](Get-ObjectPropertyValue -Source $response -Name 'display')
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = [string](Get-ObjectPropertyValue -Source $response -Name 'message')
    }
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'Imported {0} Illustrator SVG item(s) into Blender.' -f $importedCount
    }

    if ($postAction -eq 'orca') {
        $orcaBridgeStatusPath = Join-Path $runtimeDirectory ('send-svg-to-blender.orca.{0}.tmp' -f $requestId)
        $orcaResponse = Invoke-BlenderBridgeAction `
            -InvokeScript $invokeScript `
            -Action $orcaBridgeAction `
            -Label 'Orca' `
            -DataJson '{}' `
            -StatusPath $orcaBridgeStatusPath `
            -FailureMessage 'Blender imported the Illustrator SVG batch, but the Orca action did not complete.'
        $orcaMessage = [string](Get-ObjectPropertyValue -Source $orcaResponse -Name 'display')
        if ([string]::IsNullOrWhiteSpace($orcaMessage)) {
            $orcaMessage = [string](Get-ObjectPropertyValue -Source $orcaResponse -Name 'message')
        }
        if ([string]::IsNullOrWhiteSpace($orcaMessage)) {
            $orcaMessage = 'Exported the imported Blender objects and sent them to OrcaSlicer.'
        }
        $message = ('{0} {1}' -f $message.Trim(), $orcaMessage.Trim()).Trim()
    }

    Write-HandoffStatus -Path $statusPath -CorrelationId $requestId -Status Ok -Message $message -Count $importedCount
    $exitCode = 0
}
catch {
    try {
        Write-HandoffStatus -Path $statusPath -CorrelationId $requestId -Status Error -Message $_.Exception.Message -Count 0
    }
    catch {
    }
    $exitCode = 1
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($bridgeStatusPath) -and (Test-Path -LiteralPath $bridgeStatusPath -PathType Leaf)) {
        Remove-Item -LiteralPath $bridgeStatusPath -Force -ErrorAction SilentlyContinue
    }
    if (-not [string]::IsNullOrWhiteSpace($orcaBridgeStatusPath) -and (Test-Path -LiteralPath $orcaBridgeStatusPath -PathType Leaf)) {
        Remove-Item -LiteralPath $orcaBridgeStatusPath -Force -ErrorAction SilentlyContinue
    }
    if ($ownsMutex -and $null -ne $mutex) {
        try {
            $mutex.ReleaseMutex()
        }
        catch {
        }
    }
    if ($null -ne $mutex) {
        $mutex.Dispose()
    }
}

exit $exitCode
