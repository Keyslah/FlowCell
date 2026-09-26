<#
Ill SVG: import the existing Illustrator selection into the running Krita preview.
Setup: Windows PowerShell 5.1, an open Illustrator document with vector artwork
selected, and a live KritaStencilPreview with its preview-only import bridge ready.
Side effects: reads Illustrator through GetActiveObject/DoJavaScript only; writes
a unique SVG batch and requests an undoable Krita import. Never launches apps,
edits/saves source artwork or overwrites a batch. Only its own short-lived bridge
request/response files are cleaned up; generated SVG batches are retained.
Limits: geometry only; see export-selection.jsx. Bridge timeouts never auto-retry.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$bridgeRoot = Join-Path $env:LOCALAPPDATA 'Krita-addons\StencilAssistantsPreview\flowcell-bridge'
$readyPath = Join-Path $bridgeRoot 'ready.json'

function Read-JsonFile([string]$Path) {
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.Length -gt 1048576) { throw 'The preview bridge returned an oversized control file.' }
    return ([IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json)
}

function Write-NewUtf8([string]$Path, [string]$Text) {
    $bytes = $utf8.GetBytes($Text)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

function Get-ReadyPreview {
    if (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) {
        throw 'Open the separate Krita Stencil Assistants preview with its Ill SVG bridge enabled first.'
    }
    $record = Read-JsonFile $readyPath
    if (-not $record.session -or 'status' -notin @($record.actions) -or 'import_layers' -notin @($record.actions)) {
        throw 'This preview does not advertise the required Ill SVG import and status actions.'
    }
    $processId = 0
    if (-not [int]::TryParse([string]$record.pid, [ref]$processId) -or $processId -le 0) {
        throw 'The preview bridge has an invalid process identity.'
    }
    $previewProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $previewProcess -or $previewProcess.ProcessName -cne 'KritaStencilPreview' -or
        [IO.Path]::GetFileName($previewProcess.Path) -ine 'KritaStencilPreview.exe') {
        throw 'The ready bridge does not belong to a live KritaStencilPreview process.'
    }
    if ($previewProcess.SessionId -ne (Get-Process -Id ([Diagnostics.Process]::GetCurrentProcess().Id)).SessionId) {
        throw 'The preview belongs to another Windows login session.'
    }
    return @{ record = $record; started = $previewProcess.StartTime.ToUniversalTime().Ticks }
}

function Assert-SamePreview($Identity) {
    $current = Get-ReadyPreview
    if ($current.record.pid -ne $Identity.record.pid -or $current.record.session -cne $Identity.record.session -or
        $current.started -ne $Identity.started) {
        throw 'The Krita preview changed during export. No request was sent to the replacement session.'
    }
}

function Invoke-PreviewAction($Identity, [string]$Action, [string]$Manifest = '', [int]$Seconds = 30) {
    Assert-SamePreview $Identity
    if ($Action -notin @('status', 'import_layers')) { throw 'Unsupported Ill SVG bridge action.' }
    $requestId = [Guid]::NewGuid().ToString('N')
    $pending = Join-Path $bridgeRoot ($requestId + '.pending')
    $requestPath = Join-Path $bridgeRoot ($requestId + '.request.json')
    $responsePath = Join-Path $bridgeRoot ($requestId + '.response.json')
    $expires = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + $Seconds
    $request = @{ session = $Identity.record.session; action = $Action; expires = $expires }
    if ($Action -eq 'import_layers') { $request.manifest = [IO.Path]::GetFullPath($Manifest) }
    try {
        Write-NewUtf8 $pending ($request | ConvertTo-Json -Depth 8 -Compress)
        [IO.File]::Move($pending, $requestPath)
        while (-not (Test-Path -LiteralPath $responsePath -PathType Leaf)) {
            if ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -gt $expires) {
                throw 'The preview did not finish the request in time. Check Krita before retrying; Ill SVG has not repeated the import.'
            }
            Assert-SamePreview $Identity
            Start-Sleep -Milliseconds 100
        }
        $response = Read-JsonFile $responsePath
        if ($response.ok -ne $true) { throw ('Krita import bridge: ' + [string]$response.error) }
        return $response.result
    } finally {
        # These are this call's newly generated, short-lived control files only.
        # Never remove the bridge's claimed .processing.json or any batch data.
        foreach ($temporaryPath in @($pending, $requestPath, $responsePath)) {
            try { [IO.File]::Delete($temporaryPath) } catch { Write-Warning 'A temporary Ill SVG control file could not be cleaned up.' }
        }
    }
}

try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
        throw 'Ill SVG requires Windows PowerShell 5.1 for the existing Illustrator COM connection.'
    }
    $identity = Get-ReadyPreview
    $status = Invoke-PreviewAction $identity 'status'
    if ($status.nativeBatchImport -ne $true -or -not $status.document) {
        throw 'Open a document in the native Krita preview before importing Illustrator layers.'
    }
    try { $illustrator = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application') }
    catch { throw 'Open Illustrator and select the vector artwork first. Ill SVG does not launch Illustrator.' }
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'export-selection.jsx'), [Text.Encoding]::UTF8)
    $script = $source + "`n" + '(function () { if (!app.documents.length) throw new Error("Open an Illustrator document first."); return IllSvgExporter.stringify(IllSvgExporter.buildBatch(app.activeDocument)); }());'
    $raw = [string]$illustrator.DoJavaScript($script)
    if ($raw.Length -gt 33554432) { throw 'The selected geometry exceeds the bounded Ill SVG export size.' }
    $batch = $raw | ConvertFrom-Json
    if ($batch.schemaVersion -ne 1 -or $batch.type -ne 'krita-stencil-layers' -or
        @($batch.layers).Count -lt 1 -or @($batch.layers).Count -gt 128 -or $batch.scaleFactor -ne 1) {
        throw 'Illustrator returned an invalid layer batch.'
    }
    Assert-SamePreview $identity
    $batchId = [Guid]::NewGuid().ToString('N')
    $batchDirectory = Join-Path (Join-Path $bridgeRoot 'batches') $batchId
    if (Test-Path -LiteralPath $batchDirectory) { throw 'The unique batch path already exists; nothing was overwritten.' }
    [void][IO.Directory]::CreateDirectory($batchDirectory)
    $layers = @()
    $index = 0
    foreach ($layer in @($batch.layers)) {
        $index++
        if (-not $layer.name -or -not $layer.svg) { throw 'An exported layer has no name or SVG geometry.' }
        if ($utf8.GetByteCount([string]$layer.svg) -gt 2097152) { throw ('Layer exceeds the native 2 MiB SVG limit: ' + $layer.name) }
        $filename = 'layer-{0:D3}.svg' -f $index
        Write-NewUtf8 (Join-Path $batchDirectory $filename) ([string]$layer.svg)
        $layers += @{ name = [string]$layer.name; file = $filename }
    }
    $manifest = @{ schemaVersion = 1; type = 'krita-stencil-layers'; name = [string]$batch.name;
                   centerOnCanvas = $true; layers = $layers }
    $manifestPath = Join-Path $batchDirectory 'manifest.stencil.json'
    Write-NewUtf8 $manifestPath ($manifest | ConvertTo-Json -Depth 8)
    $result = Invoke-PreviewAction $identity 'import_layers' $manifestPath 300
    $result | ConvertTo-Json -Depth 12
} catch {
    $message = $_.Exception.Message
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($message, 'Ill SVG', 'OK', 'Error')
    } catch { Write-Warning $message }
    throw $message
} finally {
    if ($null -ne $illustrator -and [Runtime.InteropServices.Marshal]::IsComObject($illustrator)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($illustrator)
    }
}
