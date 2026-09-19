param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$lithophaneBundledSourceId = 'blender.lithophane'
$bridgeResponseTimeoutSeconds = 110
$statusFileName = 'lithophane.status.txt'
$mutexName = 'Local\FlowCell.IllustratorLithophane'
$requestId = ''
$statusPath = ''
$bridgeStatusPath = ''
$mutex = $null
$ownsMutex = $false
$exitCode = 1

function Get-ObjectPropertyValue {
    param(
        [object]$Source,
        [Parameter(Mandatory = $true)][string]$Name
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
        return 'Lithophane handoff failed.'
    }
    $singleLine = [regex]::Replace($Message, '[\x00-\x1F\x7F]+', ' ')
    $singleLine = [regex]::Replace($singleLine, '\s{2,}', ' ').Trim()
    if ([string]::IsNullOrWhiteSpace($singleLine)) {
        return 'Lithophane handoff failed.'
    }
    return $singleLine
}

function Write-HandoffStatus {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
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
        'ChangedCount={0}' -f ([Math]::Max($Count, 0))
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $processId = [System.Diagnostics.Process]::GetCurrentProcess().Id
    $temporaryPath = '{0}.{1}.{2}.tmp' -f $Path, $processId, ([guid]::NewGuid().ToString('N'))

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
    throw 'Could not resolve the FlowCell repository root from the installed Illustrator Lithophane Button.'
}

function Resolve-ActiveBlenderLithophaneAction {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $panelRoot = Join-Path $RepoRoot 'Programs\Blender\Panels\Utility'
    if (-not (Test-Path -LiteralPath $panelRoot -PathType Container)) {
        throw 'Blender Utility panel records were not found.'
    }

    $matches = New-Object System.Collections.Generic.List[object]
    foreach ($recordFile in @(Get-ChildItem -LiteralPath $panelRoot -Filter '*.flowcell-source.json' -File -ErrorAction Stop)) {
        $recordText = Get-Content -LiteralPath $recordFile.FullName -Raw -Encoding UTF8
        try {
            $record = $recordText | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            if ($recordText -match [regex]::Escape($lithophaneBundledSourceId)) {
                throw "The active Blender Lithophane descriptor is invalid JSON: $($recordFile.FullName)"
            }
            continue
        }

        $recordSourceId = [string](Get-ObjectPropertyValue -Source $record -Name 'bundledSourceId')
        if ($recordSourceId.Trim() -ieq $lithophaneBundledSourceId) {
            $matches.Add([pscustomobject]@{
                File = $recordFile
                Record = $record
            }) | Out-Null
        }
    }

    if ($matches.Count -eq 0) {
        throw "The Blender Utility '$lithophaneBundledSourceId' Button is not installed. Add or update Lithophane in Blender first."
    }
    if ($matches.Count -ne 1) {
        throw "FlowCell found $($matches.Count) active Blender Utility descriptors for '$lithophaneBundledSourceId'; exactly one is required."
    }

    $activeRecord = $matches[0].Record
    $programId = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'programId')
    $panelName = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'panelName')
    $runner = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'runner')
    $ownerButtonId = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'ownerButtonId')
    $bridgeAction = [string](Get-ObjectPropertyValue -Source $activeRecord -Name 'bridgeAction')
    if ($programId.Trim() -ine 'blender' -or
        $panelName.Trim() -ine 'utility' -or
        $runner.Trim() -ine 'blender-bridge' -or
        [string]::IsNullOrWhiteSpace($ownerButtonId) -or
        $ownerButtonId.Trim() -cnotmatch '^[A-Za-z0-9_-]+$' -or
        [string]::IsNullOrWhiteSpace($bridgeAction)) {
        throw "The installed Blender Utility '$lithophaneBundledSourceId' Button has an invalid active action contract."
    }

    $expectedBridgeAction = 'flowcell_button_{0}' -f $ownerButtonId.Trim().ToLowerInvariant()
    if ($bridgeAction.Trim() -cne $expectedBridgeAction) {
        throw "The installed Blender Lithophane bridge action does not match its owner."
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
    foreach ($appPathKey in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\blender.exe'
    )) {
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
        (Join-Path $(if ($env:FLOWCELL_LOCAL_ROOT) { $env:FLOWCELL_LOCAL_ROOT } elseif (Test-Path -LiteralPath (Join-Path $RepoRoot 'flowcellbackend')) { Join-Path $RepoRoot 'flowcellbackend/local' } else { $RepoRoot }) 'private/blender.config.local.json')
        (Join-Path $RepoRoot 'Programs\Blender\config.json')
    )) {
        if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
            continue
        }
        try {
            $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $automation = Get-ObjectPropertyValue -Source $config -Name 'automation'
            & $addRoot ([string](Get-ObjectPropertyValue -Source $automation -Name 'bridgeFolder'))
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
            $eventHistory = Get-ObjectPropertyValue -Source $runtimeStatus -Name 'events'
            $statusEvents = @($lastEvent) + @($eventHistory)
            foreach ($statusEvent in $statusEvents) {
                if ($null -eq $statusEvent) {
                    continue
                }
                $runtimeProcessId = 0
                if (-not [int]::TryParse(
                    [string](Get-ObjectPropertyValue -Source $statusEvent -Name 'pid'),
                    [ref]$runtimeProcessId
                )) {
                    continue
                }
                if (($ProcessIds -contains $runtimeProcessId) -and
                    ($runningProcessIds -contains $runtimeProcessId)) {
                    return $true
                }
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

function Invoke-BlenderBridgeAction {
    param(
        [Parameter(Mandatory = $true)][string]$InvokeScript,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][string]$DataJson,
        [Parameter(Mandatory = $true)][string]$StatusPath
    )

    $invokeParameters = @{
        Action = $Action
        Label = 'Lithophane'
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
            $bridgeError = 'Blender did not complete the Illustrator Lithophane request.'
        }
        throw $bridgeError
    }

    $responses = @(
        $invokeOutput |
            Where-Object { $null -ne $_ -and $null -ne $_.PSObject.Properties['status'] } |
            Select-Object -Last 1
    )
    if ($responses.Count -eq 0) {
        throw 'Lithophane completed without returning a FlowCell response.'
    }
    return $responses[0]
}

function Get-PositiveFiniteNumber {
    param(
        [object]$Value,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($null -eq $Value -or $Value -is [bool]) {
        throw "$Label must be a positive finite number."
    }
    $number = 0.0
    if (-not [double]::TryParse(
        [string]$Value,
        [System.Globalization.NumberStyles]::Float,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$number
    ) -or [double]::IsNaN($number) -or [double]::IsInfinity($number) -or $number -le 0.0) {
        throw "$Label must be a positive finite number."
    }
    return $number
}

try {
    $RequestPath = [System.IO.Path]::GetFullPath($RequestPath)
    $statusPath = Join-Path (Split-Path -Parent $RequestPath) $statusFileName
    $mutex = New-Object System.Threading.Mutex($false, $mutexName)
    try {
        $ownsMutex = $mutex.WaitOne([TimeSpan]::FromSeconds(120))
    }
    catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        throw 'Another Illustrator Lithophane request is still running.'
    }

    if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) {
        throw "Illustrator Lithophane request not found: $RequestPath"
    }
    $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $requestId = [string](Get-ObjectPropertyValue -Source $request -Name 'requestId')
    $requestId = $requestId.Trim()
    if ($requestId -cnotmatch '^[A-Za-z0-9_-]{1,128}$') {
        throw 'The Illustrator Lithophane request has an invalid requestId.'
    }
    $schemaVersion = Get-ObjectPropertyValue -Source $request -Name 'schemaVersion'
    if ($null -eq $schemaVersion -or [int]$schemaVersion -ne 1) {
        throw 'The Illustrator Lithophane request has an unsupported schemaVersion.'
    }

    $imagePath = [string](Get-ObjectPropertyValue -Source $request -Name 'imagePath')
    $imagePath = $imagePath.Trim()
    if ([string]::IsNullOrWhiteSpace($imagePath) -or -not [System.IO.Path]::IsPathRooted($imagePath)) {
        throw 'The Illustrator Lithophane request requires an absolute imagePath.'
    }
    $imagePath = [System.IO.Path]::GetFullPath($imagePath)
    if ([System.IO.Path]::GetExtension($imagePath) -ine '.png') {
        throw 'The Illustrator Lithophane imagePath must identify a .png file.'
    }
    if (-not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
        throw "The selected Illustrator PNG is unavailable: $imagePath"
    }

    $widthMm = Get-PositiveFiniteNumber -Value (Get-ObjectPropertyValue -Source $request -Name 'widthMm') -Label 'widthMm'
    $heightMm = Get-PositiveFiniteNumber -Value (Get-ObjectPropertyValue -Source $request -Name 'heightMm') -Label 'heightMm'
    $objectName = [string](Get-ObjectPropertyValue -Source $request -Name 'objectName')
    if ([string]::IsNullOrWhiteSpace($objectName) -or $objectName.IndexOf([char]0) -ge 0) {
        throw 'The Illustrator Lithophane request requires the selected PNG owning layer name.'
    }
    $repoRoot = Resolve-FlowCellRepoRoot -StartPath $PSScriptRoot
    $bridgeAction = Resolve-ActiveBlenderLithophaneAction -RepoRoot $repoRoot
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
            throw 'Blender opened, but the FlowCell bridge add-on did not become ready.'
        }
        throw 'The running Blender window does not report a ready FlowCell bridge.'
    }

    $dataJson = [pscustomobject][ordered]@{
        image_path = $imagePath
        object_name = $objectName
        width_mm = $widthMm
        height_mm = $heightMm
    } | ConvertTo-Json -Depth 4 -Compress
    $bridgeStatusPath = Join-Path (Split-Path -Parent $RequestPath) ('lithophane.bridge.{0}.tmp' -f $requestId)
    $response = Invoke-BlenderBridgeAction `
        -InvokeScript $invokeScript `
        -Action $bridgeAction `
        -DataJson $dataJson `
        -StatusPath $bridgeStatusPath

    $changedValue = Get-ObjectPropertyValue -Source $response -Name 'changed'
    if ($null -ne $changedValue -and [int]$changedValue -ne 1) {
        throw "Blender Lithophane reported an unexpected changed count: $changedValue"
    }
    $message = [string](Get-ObjectPropertyValue -Source $response -Name 'display')
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = [string](Get-ObjectPropertyValue -Source $response -Name 'message')
    }
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'Created one Blender lithophane at the selected Illustrator PNG dimensions.'
    }

    Write-HandoffStatus -Path $statusPath -CorrelationId $requestId -Status Ok -Message $message -Count 1
    $exitCode = 0
}
catch {
    if (-not [string]::IsNullOrWhiteSpace($statusPath)) {
        try {
            Write-HandoffStatus -Path $statusPath -CorrelationId $requestId -Status Error -Message $_.Exception.Message -Count 0
        }
        catch {
        }
    }
    $exitCode = 1
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($bridgeStatusPath) -and (Test-Path -LiteralPath $bridgeStatusPath -PathType Leaf)) {
        Remove-Item -LiteralPath $bridgeStatusPath -Force -ErrorAction SilentlyContinue
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
