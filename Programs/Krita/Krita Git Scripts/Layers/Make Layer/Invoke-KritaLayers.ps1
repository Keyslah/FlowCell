param([Parameter(Mandatory=$true)][string]$Action, [string]$BrushId = '')
$ErrorActionPreference = 'Stop'
$bridgeRoot = Join-Path $env:LOCALAPPDATA 'FlowCell\KritaLayers'
$readyPath = Join-Path $bridgeRoot 'ready.json'
if (-not (Test-Path -LiteralPath $readyPath)) {
    throw 'FlowCell Layers is not loaded. Open Krita after installing/enabling its FlowCell Layers Python plugin.'
}
$ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
$process = Get-Process -Id $ready.pid -ErrorAction SilentlyContinue
if (-not $process -or $process.ProcessName -ne 'krita') { throw 'Open Krita with the FlowCell Layers plugin enabled first.' }
if ($Action -notin $ready.actions -and $Action -notin @('status','self_test')) { throw 'Unsupported Krita Layers action.' }
$requestId = [Guid]::NewGuid().ToString('N')
$requestPath = Join-Path $bridgeRoot ($requestId + '.request.json')
$responsePath = Join-Path $bridgeRoot ($requestId + '.response.json')
$pendingPath = Join-Path $bridgeRoot ($requestId + '.pending')
$utf8 = New-Object System.Text.UTF8Encoding($false)
$expires = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 300
$request = @{ session=$ready.session; action=$Action; brushId=$BrushId; expires=$expires } | ConvertTo-Json -Compress
[IO.File]::WriteAllText($pendingPath, $request, $utf8)
[IO.File]::Move($pendingPath, $requestPath)
try {
    while (-not (Test-Path -LiteralPath $responsePath)) {
        if ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -gt $expires) { throw 'Krita did not finish the action within five minutes. Check its open dialog.' }
        if (-not (Get-Process -Id $ready.pid -ErrorAction SilentlyContinue)) { throw 'Krita closed before completing the action.' }
        Start-Sleep -Milliseconds 100
    }
    $response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
    if (-not $response.ok) { throw $response.error }
    $response.result | ConvertTo-Json -Depth 12
} finally {
    # These three paths are transient request/response files created by this invocation.
    foreach ($temporaryPath in @($pendingPath,$requestPath,$responsePath)) {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
}
