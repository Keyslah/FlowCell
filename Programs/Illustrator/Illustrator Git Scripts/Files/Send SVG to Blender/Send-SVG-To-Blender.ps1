param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$internalImportOwnerButtonId = 'internal-illustrator-svg-import'
$internalImportBridgeAction = 'flowcell_button_{0}' -f $internalImportOwnerButtonId
$internalSaveOwnerButtonId = 'internal-illustrator-save-blender'
$internalSaveBridgeAction = 'flowcell_button_{0}' -f $internalSaveOwnerButtonId
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
$saveBridgeStatusPaths = @()

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
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$SourceRelativePath,
        [Parameter(Mandatory = $true)][string]$OwnerButtonId,
        [Parameter(Mandatory = $true)][string]$ExpectedBridgeAction,
        [Parameter(Mandatory = $true)][string]$ActionDescription
    )

    $installerPath = Join-Path $RepoRoot 'Programs\Blender\SupportScripts\Install-BlenderFlowCellButtons.ps1'
    $sourcePath = Join-Path $RepoRoot $SourceRelativePath
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Blender action registry installer not found: $installerPath"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "$ActionDescription source not found: $sourcePath"
    }

    $installOutput = @(& $installerPath `
        -SelectedPaths @($sourcePath) `
        -PanelName 'Internal' `
        -OwnerButtonId $OwnerButtonId `
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
    if ($registeredAction.Trim() -cne $ExpectedBridgeAction) {
        throw "Blender registered unexpected internal action '$registeredAction'."
    }
    return $ExpectedBridgeAction
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

function Get-RequiredBooleanResponseValue {
    param(
        [object]$Value,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ($Value -is [bool]) {
        return [bool]$Value
    }
    $normalized = [string]$Value
    if ($normalized.Trim() -ieq 'true') {
        return $true
    }
    if ($normalized.Trim() -ieq 'false') {
        return $false
    }
    throw "$Label returned an invalid saved state."
}

function Resolve-MarkedProjectRootFromDocumentPath {
    param([Parameter(Mandatory = $true)][string]$DocumentPath)

    if (-not [System.IO.Path]::IsPathRooted($DocumentPath)) {
        throw 'The Illustrator document path is not absolute.'
    }
    if (-not (Test-Path -LiteralPath $DocumentPath -PathType Leaf)) {
        throw "The saved Illustrator document could not be found: $DocumentPath"
    }

    $documentFile = Get-Item -LiteralPath $DocumentPath -Force -ErrorAction Stop
    $current = $documentFile.Directory
    while ($null -ne $current) {
        $markerPath = Join-Path $current.FullName '.flowcell-project.json'
        if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
            return [pscustomobject]@{
                DocumentFile = $documentFile
                ProjectRoot = $current.FullName
                MarkerPath = $markerPath
            }
        }
        $current = $current.Parent
    }

    throw (
        "Blender is unsaved, and FlowCell could not find .flowcell-project.json above the Illustrator document. " +
        "Run the Project organizer on that project folder once, then try Ill Orca again."
    )
}

function Invoke-SetupOrganizationPrepareExistingTarget {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$ProjectRoot
    )

    $setupScript = Join-Path $RepoRoot 'Programs\Windows\Windows Git Scripts\Files\Setup Organization\setup_organization.ps1'
    if (-not (Test-Path -LiteralPath $setupScript -PathType Leaf)) {
        throw "Setup Organization provider not found: $setupScript"
    }

    $powerShellHost = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    if ([string]::IsNullOrWhiteSpace($powerShellHost) -or -not (Test-Path -LiteralPath $powerShellHost -PathType Leaf)) {
        throw 'FlowCell could not resolve the current PowerShell host for Setup Organization.'
    }

    $argsJson = [pscustomobject][ordered]@{
        operation = 'prepare-existing-target'
        projectRoot = $ProjectRoot
        plannedExtension = '.blend'
    } | ConvertTo-Json -Depth 5 -Compress
    $setupScriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($setupScript))
    $argsJsonBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argsJson))
    $childScript = @'
$setupScript = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{0}'))
$argsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{1}'))
& $setupScript -FlowCellCapability 'windows.setup-organization' -ArgsJson $argsJson
exit $LASTEXITCODE
'@ -f $setupScriptBase64, $argsJsonBase64
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
    $prepareOutput = @(& $powerShellHost `
        -NoLogo `
        -NoProfile `
        -NonInteractive `
        -ExecutionPolicy Bypass `
        -EncodedCommand $encodedCommand 2>&1)
    $prepareExitCode = $LASTEXITCODE
    $prepareText = ($prepareOutput | ForEach-Object { [string]$_ }) -join "`n"
    if ($prepareExitCode -ne 0) {
        if ([string]::IsNullOrWhiteSpace($prepareText)) {
            $prepareText = 'Setup Organization could not prepare the existing project Blender destination.'
        }
        throw $prepareText
    }

    try {
        $prepared = $prepareText | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Setup Organization returned invalid JSON: $($_.Exception.Message)"
    }
    if (-not (Get-RequiredBooleanResponseValue `
        -Value (Get-ObjectPropertyValue -Source $prepared -Name 'prepared') `
        -Label 'Setup Organization')) {
        throw 'Setup Organization did not report a prepared Blender destination.'
    }

    $preparedRoot = [string](Get-ObjectPropertyValue -Source $prepared -Name 'projectRoot')
    $destinationDirectory = [string](Get-ObjectPropertyValue -Source $prepared -Name 'destinationDirectory')
    if ([string]::IsNullOrWhiteSpace($preparedRoot) -or [string]::IsNullOrWhiteSpace($destinationDirectory)) {
        throw 'Setup Organization omitted the prepared project root or Blender destination.'
    }
    $expectedRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
    $returnedRoot = [System.IO.Path]::GetFullPath($preparedRoot).TrimEnd('\')
    if ($returnedRoot -ine $expectedRoot) {
        throw "Setup Organization returned the wrong project folder. Expected '$expectedRoot', got '$returnedRoot'."
    }

    return $prepared
}

function Ensure-BlenderSavedForOrca {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [Parameter(Mandatory = $true)][string]$InvokeScript,
        [Parameter(Mandatory = $true)][string]$SaveBridgeAction,
        [string]$SourceDocumentPath,
        [Parameter(Mandatory = $true)][string]$RequestId,
        [Parameter(Mandatory = $true)][string]$RuntimeDirectory
    )

    $statusBridgePath = Join-Path $RuntimeDirectory ('send-svg-to-blender.save-status.{0}.tmp' -f $RequestId)
    $script:saveBridgeStatusPaths = @($script:saveBridgeStatusPaths) + $statusBridgePath
    $statusResponse = Invoke-BlenderBridgeAction `
        -InvokeScript $InvokeScript `
        -Action $SaveBridgeAction `
        -Label 'Check Blender save status' `
        -DataJson '{"command":"status"}' `
        -StatusPath $statusBridgePath `
        -FailureMessage 'Blender did not report whether the current file is saved.'
    $alreadySaved = Get-RequiredBooleanResponseValue `
        -Value (Get-ObjectPropertyValue -Source $statusResponse -Name 'saved') `
        -Label 'Save Blender status'
    if ($alreadySaved) {
        return [pscustomobject]@{
            AutoSaved = $false
            FinalPath = [string](Get-ObjectPropertyValue -Source $statusResponse -Name 'filePath')
            Message = ''
        }
    }

    if ([string]::IsNullOrWhiteSpace($SourceDocumentPath)) {
        throw (
            'Blender and the Illustrator document are both unsaved. Save the Illustrator document inside its ' +
            'FlowCell-organized project first, then try Ill Orca again.'
        )
    }
    $project = Resolve-MarkedProjectRootFromDocumentPath -DocumentPath $SourceDocumentPath
    $prepared = Invoke-SetupOrganizationPrepareExistingTarget `
        -RepoRoot $RepoRoot `
        -ProjectRoot ([string]$project.ProjectRoot)
    $destinationDirectory = [string](Get-ObjectPropertyValue -Source $prepared -Name 'destinationDirectory')
    $fileName = [System.IO.Path]::GetFileNameWithoutExtension([string]$project.DocumentFile.Name)
    if ([string]::IsNullOrWhiteSpace($fileName)) {
        throw 'The Illustrator document filename cannot be used for a Blender filename.'
    }

    $saveDataJson = [pscustomobject][ordered]@{
        command = 'save-prepared-existing-target'
        fileName = $fileName
        projectRoot = [string]$project.ProjectRoot
        destinationDirectory = $destinationDirectory
    } | ConvertTo-Json -Depth 5 -Compress
    $initialSaveBridgePath = Join-Path $RuntimeDirectory ('send-svg-to-blender.initial-save.{0}.tmp' -f $RequestId)
    $script:saveBridgeStatusPaths = @($script:saveBridgeStatusPaths) + $initialSaveBridgePath
    $saveResponse = Invoke-BlenderBridgeAction `
        -InvokeScript $InvokeScript `
        -Action $SaveBridgeAction `
        -Label 'Save Blender in Illustrator project' `
        -DataJson $saveDataJson `
        -StatusPath $initialSaveBridgePath `
        -FailureMessage 'Blender was unsaved and could not be saved in the Illustrator project.'
    if (-not (Get-RequiredBooleanResponseValue `
        -Value (Get-ObjectPropertyValue -Source $saveResponse -Name 'saved') `
        -Label 'Save Blender')) {
        throw 'Save Blender completed without reporting a saved file.'
    }
    $finalPath = [string](Get-ObjectPropertyValue -Source $saveResponse -Name 'finalPath')
    if ([string]::IsNullOrWhiteSpace($finalPath)) {
        throw 'Save Blender completed without returning the saved Blender path.'
    }
    $saveMessage = [string](Get-ObjectPropertyValue -Source $saveResponse -Name 'display')
    if ([string]::IsNullOrWhiteSpace($saveMessage)) {
        $saveMessage = [string](Get-ObjectPropertyValue -Source $saveResponse -Name 'message')
    }
    if ([string]::IsNullOrWhiteSpace($saveMessage)) {
        $saveMessage = "Saved Blender file to $finalPath"
    }

    return [pscustomobject]@{
        AutoSaved = $true
        FinalPath = $finalPath
        Message = $saveMessage.Trim()
    }
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
    $sourceDocumentPath = [string](Get-ObjectPropertyValue -Source $request -Name 'sourceDocumentPath')
    $sourceDocumentPath = $sourceDocumentPath.Trim()

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
    $bridgeAction = Register-InternalBlenderAction `
        -RepoRoot $repoRoot `
        -SourceRelativePath 'Programs\Blender\Blender Git Scripts\Files\Import Illustrator SVG\import illustrator svg.py' `
        -OwnerButtonId $internalImportOwnerButtonId `
        -ExpectedBridgeAction $internalImportBridgeAction `
        -ActionDescription 'Illustrator SVG Blender importer'
    $saveBridgeAction = ''
    if ($postAction -eq 'orca') {
        $saveBridgeAction = Register-InternalBlenderAction `
            -RepoRoot $repoRoot `
            -SourceRelativePath 'Programs\Blender\Blender Git Scripts\Files\Save Blender\save_blender.py' `
            -OwnerButtonId $internalSaveOwnerButtonId `
            -ExpectedBridgeAction $internalSaveBridgeAction `
            -ActionDescription 'Save Blender'
    }
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

    $autoSaveState = [pscustomobject]@{
        AutoSaved = $false
        FinalPath = ''
        Message = ''
    }
    if ($postAction -eq 'orca') {
        $autoSaveState = Ensure-BlenderSavedForOrca `
            -RepoRoot $repoRoot `
            -InvokeScript $invokeScript `
            -SaveBridgeAction $saveBridgeAction `
            -SourceDocumentPath $sourceDocumentPath `
            -RequestId $requestId `
            -RuntimeDirectory $runtimeDirectory
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
        if ([bool]$autoSaveState.AutoSaved) {
            $finalSaveBridgePath = Join-Path $runtimeDirectory ('send-svg-to-blender.final-save.{0}.tmp' -f $requestId)
            $saveBridgeStatusPaths = @($saveBridgeStatusPaths) + $finalSaveBridgePath
            $finalSaveResponse = Invoke-BlenderBridgeAction `
                -InvokeScript $invokeScript `
                -Action $saveBridgeAction `
                -Label 'Save imported Illustrator artwork' `
                -DataJson '{"command":"save-current"}' `
                -StatusPath $finalSaveBridgePath `
                -FailureMessage 'Blender imported the Illustrator SVG batch, but could not save the imported artwork.'
            if (-not (Get-RequiredBooleanResponseValue `
                -Value (Get-ObjectPropertyValue -Source $finalSaveResponse -Name 'saved') `
                -Label 'Save Blender')) {
                throw 'Save Blender did not confirm the imported artwork was saved.'
            }
            $message = ('{0} {1}' -f ([string]$autoSaveState.Message).Trim(), $message.Trim()).Trim()
        }

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
    foreach ($saveBridgeStatusPath in @($saveBridgeStatusPaths)) {
        if (-not [string]::IsNullOrWhiteSpace($saveBridgeStatusPath) -and (Test-Path -LiteralPath $saveBridgeStatusPath -PathType Leaf)) {
            Remove-Item -LiteralPath $saveBridgeStatusPath -Force -ErrorAction SilentlyContinue
        }
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
