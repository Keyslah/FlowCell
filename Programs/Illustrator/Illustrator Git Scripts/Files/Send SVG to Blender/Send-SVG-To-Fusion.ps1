param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$internalImportOwnerButtonId = 'internal-illustrator-svg-import'
$internalImportBridgeAction = 'flowcell_button_{0}' -f $internalImportOwnerButtonId
$fusionImporterRelativePath = 'Programs\Fusion 360\Fusion Git Scripts\Files\Import Illustrator SVG\import_illustrator_svg.py'
$fusionInstallerRelativePath = 'Programs\Fusion 360\SupportScripts\Install-FusionFlowCellButtons.ps1'
$bridgeResponseTimeoutSeconds = 110
$fusionLaunchTimeoutSeconds = 180
$runningFusionReadyTimeoutSeconds = 15
$statusFileName = 'send-svg-to-fusion.status.txt'
$mutexName = 'Local\FlowCell.SendSvgToFusion'
$requestId = ''
$importedCount = 0
$exitCode = 1
$mutex = $null
$ownsMutex = $false

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
        return 'Send SVG to Fusion failed.'
    }

    $singleLine = [regex]::Replace($Message, '[\x00-\x1F\x7F]+', ' ')
    $singleLine = [regex]::Replace($singleLine, '\s{2,}', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($singleLine)) {
        return 'Send SVG to Fusion failed.'
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
    $temporaryIoPath = ConvertTo-ExtendedFilePath -Path $temporaryPath
    $destinationIoPath = ConvertTo-ExtendedFilePath -Path $Path

    try {
        [System.IO.File]::WriteAllLines($temporaryIoPath, $lines, $utf8NoBom)
        if ([System.IO.File]::Exists($destinationIoPath)) {
            try {
                # [NullString]::Value passes a real null; $null would become an empty backup path.
                [System.IO.File]::Replace($temporaryIoPath, $destinationIoPath, [NullString]::Value)
            }
            catch {
                [System.IO.File]::Copy($temporaryIoPath, $destinationIoPath, $true)
                [System.IO.File]::Delete($temporaryIoPath)
            }
        }
        else {
            [System.IO.File]::Move($temporaryIoPath, $destinationIoPath)
        }
    }
    finally {
        if ([System.IO.File]::Exists($temporaryIoPath)) {
            [System.IO.File]::Delete($temporaryIoPath)
        }
    }
}

function ConvertTo-ExtendedFilePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ($Path.StartsWith('\\?\')) { return $Path }
    if ($Path.StartsWith('\\')) { return '\\?\UNC\' + $Path.Substring(2) }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { throw 'Handoff status path must be absolute.' }
    return '\\?\' + $Path
}

function Read-SharedText {
    param([Parameter(Mandatory = $true)][string]$Path)

    # The bridge replaces its status and response files with os.replace; share
    # delete so a read here never makes that replace fail and drop a response.
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)), $true)
        return $reader.ReadToEnd()
    }
    finally {
        $stream.Dispose()
    }
}

function Resolve-FlowCellRepoRoot {
    param([Parameter(Mandatory = $true)][string]$StartPath)

    $current = [System.IO.DirectoryInfo](Get-Item -LiteralPath $StartPath -ErrorAction Stop)
    while ($null -ne $current) {
        $installerCandidate = Join-Path $current.FullName $fusionInstallerRelativePath
        if (Test-Path -LiteralPath $installerCandidate -PathType Leaf) {
            return $current.FullName
        }
        $current = $current.Parent
    }

    throw 'FlowCell could not find its Fusion 360 program package above the installed Illustrator Button. Add Fusion 360 in FlowCell, then try again.'
}

function Register-InternalFusionAction {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $installerPath = Join-Path $RepoRoot $fusionInstallerRelativePath
    $sourcePath = Join-Path $RepoRoot $fusionImporterRelativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Illustrator SVG Fusion importer source not found: $sourcePath"
    }

    $installOutput = @(& $installerPath `
        -SelectedPaths @($sourcePath) `
        -PanelName 'Internal' `
        -OwnerButtonId $internalImportOwnerButtonId `
        -BridgeDataJson '{}')

    $installText = ($installOutput | ForEach-Object { [string]$_ }) -join "`n"
    try {
        $installResult = $installText | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Fusion returned an invalid internal action registration response: $($_.Exception.Message)"
    }
    $registered = @((Get-ObjectPropertyValue -Source $installResult -Name 'results')) | Select-Object -First 1
    if ((Get-ObjectPropertyValue -Source $registered -Name 'installed') -ne $true) {
        $failure = [string](Get-ObjectPropertyValue -Source $registered -Name 'message')
        if ([string]::IsNullOrWhiteSpace($failure)) {
            $failure = 'The Fusion action installer did not register the Illustrator SVG importer.'
        }
        throw $failure
    }

    $registeredAction = [string](Get-ObjectPropertyValue -Source $registered -Name 'action')
    if ($registeredAction.Trim() -cne $internalImportBridgeAction) {
        throw "Fusion registered unexpected internal action '$registeredAction'."
    }
    $addonRoot = [string](Get-ObjectPropertyValue -Source $registered -Name 'addonRoot')
    if ([string]::IsNullOrWhiteSpace($addonRoot)) {
        throw 'The Fusion action installer did not report the FlowCell add-in folder.'
    }
    return $addonRoot
}

function Get-ReadyFusionBridgeProcessId {
    param([Parameter(Mandatory = $true)][string]$BridgeRoot)

    # Like FlowCell's own Fusion runner, prefer the newest live Fusion whose
    # bridge published a runtime status from its own process folder.
    $processIds = @(Get-Process Fusion360 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | Sort-Object -Descending)
    foreach ($processId in $processIds) {
        $statusPath = Join-Path $BridgeRoot ('{0}\runtime_status.json' -f $processId)
        if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
            continue
        }
        try {
            $runtimeStatus = Read-SharedText -Path $statusPath | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }
        $state = [string](Get-ObjectPropertyValue -Source $runtimeStatus -Name 'state')
        $statusProcessId = [string](Get-ObjectPropertyValue -Source $runtimeStatus -Name 'pid')
        if ($state.Trim() -in @('ready', 'handling') -and $statusProcessId -eq [string]$processId) {
            return [int]$processId
        }
    }

    return 0
}

function Wait-ForFusionBridge {
    param(
        [Parameter(Mandatory = $true)][string]$BridgeRoot,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max($TimeoutSeconds, 1))
    while ((Get-Date) -lt $deadline) {
        $processId = Get-ReadyFusionBridgeProcessId -BridgeRoot $BridgeRoot
        if ($processId -ne 0) {
            return $processId
        }
        Start-Sleep -Milliseconds 500
    }

    return 0
}

function Resolve-FusionLauncherPath {
    if ([string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) {
        return ''
    }
    $productionRoot = Join-Path $env:LOCALAPPDATA 'Autodesk\webdeploy\production'
    if (-not (Test-Path -LiteralPath $productionRoot -PathType Container)) {
        return ''
    }

    # Fusion's Start menu shortcut targets this fixed launcher folder; each
    # update folder also carries a launcher, so fall back to the newest one.
    $stableLauncher = Join-Path $productionRoot '6a0c9611291d45bb9226980209917c3d\FusionLauncher.exe'
    if (Test-Path -LiteralPath $stableLauncher -PathType Leaf) {
        return $stableLauncher
    }
    $newestLauncher = @(
        Get-ChildItem -LiteralPath $productionRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object { Join-Path $_.FullName 'FusionLauncher.exe' } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            ForEach-Object { Get-Item -LiteralPath $_ } |
            Sort-Object -Property LastWriteTimeUtc -Descending
    ) | Select-Object -First 1
    if ($null -eq $newestLauncher) {
        return ''
    }
    return $newestLauncher.FullName
}

function Resolve-ReadyFusionProcessId {
    param([Parameter(Mandatory = $true)][string]$BridgeRoot)

    $processId = Get-ReadyFusionBridgeProcessId -BridgeRoot $BridgeRoot
    if ($processId -ne 0) {
        return $processId
    }

    $fusionWasRunning = @(Get-Process Fusion360 -ErrorAction SilentlyContinue).Count -gt 0
    if (-not $fusionWasRunning) {
        $launcherPath = Resolve-FusionLauncherPath
        if ([string]::IsNullOrWhiteSpace($launcherPath)) {
            throw 'Fusion 360 is not running and FusionLauncher.exe could not be found.'
        }
        Start-Process -FilePath $launcherPath | Out-Null
    }

    $timeoutSeconds = if ($fusionWasRunning) { $runningFusionReadyTimeoutSeconds } else { $fusionLaunchTimeoutSeconds }
    $processId = Wait-ForFusionBridge -BridgeRoot $BridgeRoot -TimeoutSeconds $timeoutSeconds
    if ($processId -ne 0) {
        return $processId
    }
    if ($fusionWasRunning) {
        throw 'Fusion 360 is running, but the FlowCell bridge add-in is not ready. Run FlowCellFusionBridge from Utilities > Add-Ins in Fusion (or restart Fusion), then try again.'
    }
    throw 'Fusion 360 opened, but the FlowCell bridge add-in did not become ready. Run FlowCellFusionBridge from Utilities > Add-Ins in Fusion, then try again.'
}

function Publish-FusionBridgeRequest {
    param(
        [Parameter(Mandatory = $true)][string]$StagedPath,
        [Parameter(Mandatory = $true)][string]$RequestPath
    )

    # The bridge watcher briefly opens request.json without delete sharing
    # while it reads; retry the atomic replace the way its own writer does.
    $maximumAttempts = 40
    for ($attempt = 1; $attempt -le $maximumAttempts; $attempt += 1) {
        try {
            if ([System.IO.File]::Exists($RequestPath)) {
                [System.IO.File]::Replace($StagedPath, $RequestPath, [NullString]::Value)
            }
            else {
                [System.IO.File]::Move($StagedPath, $RequestPath)
            }
            return
        }
        catch {
            if ($attempt -eq $maximumAttempts) {
                throw "FlowCell could not publish the Fusion bridge request: $($_.Exception.Message)"
            }
            Start-Sleep -Milliseconds 25
        }
    }
}

function Invoke-FusionBridgeAction {
    param(
        [Parameter(Mandatory = $true)][string]$BridgeRoot,
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][object]$Payload
    )

    $runtimeRoot = Join-Path $BridgeRoot ([string]$ProcessId)
    $bridgeRequestId = 'illustrator-svg-fusion-{0}' -f ([guid]::NewGuid().ToString('N'))
    $requestJson = [pscustomobject][ordered]@{
        requestId = $bridgeRequestId
        action = $Action
        payload = $Payload
        requested = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Depth 12 -Compress
    $stagedPath = Join-Path $runtimeRoot ('.request-{0}.tmp' -f $bridgeRequestId)
    [System.IO.File]::WriteAllText($stagedPath, $requestJson, (New-Object System.Text.UTF8Encoding($false)))
    try {
        Publish-FusionBridgeRequest -StagedPath $stagedPath -RequestPath (Join-Path $runtimeRoot 'request.json')
    }
    finally {
        if (Test-Path -LiteralPath $stagedPath -PathType Leaf) {
            Remove-Item -LiteralPath $stagedPath -Force -ErrorAction SilentlyContinue
        }
    }

    $responsePath = Join-Path $runtimeRoot 'response.json'
    $deadline = (Get-Date).AddSeconds($bridgeResponseTimeoutSeconds)
    $nextProcessCheck = Get-Date
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 50
        if ((Get-Date) -ge $nextProcessCheck) {
            if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
                throw 'Fusion 360 closed before it finished the Illustrator SVG import.'
            }
            $nextProcessCheck = (Get-Date).AddSeconds(1)
        }
        if (-not (Test-Path -LiteralPath $responsePath -PathType Leaf)) {
            continue
        }
        try {
            $response = Read-SharedText -Path $responsePath | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            continue
        }
        if ([string](Get-ObjectPropertyValue -Source $response -Name 'requestId') -ceq $bridgeRequestId) {
            return $response
        }
    }

    throw "Fusion 360 did not finish the Illustrator SVG import within $bridgeResponseTimeoutSeconds seconds."
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
        throw 'Another Send SVG to Fusion request is still running.'
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
    if (-not [string]::IsNullOrWhiteSpace($postAction) -and $postAction.Trim() -ine 'none') {
        throw "Send SVG to Fusion does not support postAction '$postAction'."
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
    $addonRoot = Register-InternalFusionAction -RepoRoot $repoRoot
    $bridgeRoot = Join-Path $addonRoot 'Bridge'
    $fusionProcessId = Resolve-ReadyFusionProcessId -BridgeRoot $bridgeRoot

    $response = Invoke-FusionBridgeAction `
        -BridgeRoot $bridgeRoot `
        -ProcessId $fusionProcessId `
        -Action $internalImportBridgeAction `
        -Payload ([pscustomobject][ordered]@{ items = $items })

    $message = [string](Get-ObjectPropertyValue -Source $response -Name 'display')
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = [string](Get-ObjectPropertyValue -Source $response -Name 'message')
    }
    $responseStatus = [string](Get-ObjectPropertyValue -Source $response -Name 'status')
    if ((Get-ObjectPropertyValue -Source $response -Name 'ok') -ne $true -or
        $responseStatus.Trim().ToUpperInvariant() -in @('ERROR', 'FAILED', 'CANCELLED')) {
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = 'Fusion 360 did not complete the Illustrator SVG import.'
        }
        throw $message
    }

    $importedCount = Get-ImportedCountFromResponse -Response $response -FallbackCount $items.Count
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'Imported {0} Illustrator SVG item(s) into Fusion 360.' -f $importedCount
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
