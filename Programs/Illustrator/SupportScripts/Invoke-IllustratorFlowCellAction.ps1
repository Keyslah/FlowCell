#requires -version 5.1
[CmdletBinding()]
param(
  [string]$ActionId,
  [string]$RepoRoot,
  [string]$ManifestPath,
  [string]$PipeName = 'FlowCell.Illustrator.Bridge.v1',
  [int]$ConnectTimeoutMs = 700,
  [int]$StartTimeoutMs = 6000,
  [string]$ArgsJson,
  [switch]$Wait,
  [switch]$StartOnly,
  [switch]$Ping,
  [switch]$ListActions,
  [switch]$NoStartBridge
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-FlowCellRepoRoot {
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    return [System.IO.Path]::GetFullPath($RepoRoot)
  }

  $supportRoot = Split-Path -Parent $PSCommandPath
  $programRoot = Split-Path -Parent $supportRoot
  $programsRoot = Split-Path -Parent $programRoot
  return [System.IO.Path]::GetFullPath((Split-Path -Parent $programsRoot))
}

$script:RepoRootPath = Get-FlowCellRepoRoot
$script:ProgramRoot = Join-Path $script:RepoRootPath 'Programs\Illustrator'
$script:ManifestPath = if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  Join-Path $script:ProgramRoot 'illustrator-actions.json'
} else {
  [System.IO.Path]::GetFullPath($ManifestPath)
}
$script:BridgeScript = Join-Path $script:ProgramRoot 'SupportScripts\Start-IllustratorFlowCellBridge.ps1'
$script:PidPath = Join-Path $script:RepoRootPath 'FlowCell\local\illustrator-bridge.pid.json'

function ConvertTo-RequestLine {
  param([Parameter(Mandatory = $true)]$Value)
  return ($Value | ConvertTo-Json -Compress -Depth 20)
}

function ConvertTo-ProcessArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Send-BridgeRequest {
  param(
    [Parameter(Mandatory = $true)]$Request,
    [int]$TimeoutMs = 700
  )

  $client = $null
  $reader = $null
  $writer = $null

  try {
    $client = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    $client.Connect($TimeoutMs)
    $client.ReadTimeout = [Math]::Max($TimeoutMs, 1000)
    $client.WriteTimeout = [Math]::Max($TimeoutMs, 1000)

    $reader = [System.IO.StreamReader]::new($client)
    $writer = [System.IO.StreamWriter]::new($client)
    $writer.AutoFlush = $true
    $writer.WriteLine((ConvertTo-RequestLine -Value $Request))

    $responseLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($responseLine)) {
      throw 'Illustrator bridge returned an empty response.'
    }

    return ($responseLine | ConvertFrom-Json)
  } finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $client) { $client.Dispose() }
  }
}

function Test-BridgeProcessAlive {
  if (-not [System.IO.File]::Exists($script:PidPath)) {
    return $false
  }

  try {
    $pidInfo = Get-Content -LiteralPath $script:PidPath -Raw | ConvertFrom-Json
    if ($null -eq $pidInfo.pid) {
      return $false
    }

    $process = Get-Process -Id ([int]$pidInfo.pid) -ErrorAction SilentlyContinue
    return $null -ne $process
  } catch {
    return $false
  }
}

function Start-BridgeProcess {
  if (-not [System.IO.File]::Exists($script:BridgeScript)) {
    throw "Illustrator bridge script not found: $script:BridgeScript"
  }

  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not [System.IO.File]::Exists($powerShellExe)) {
    throw "Windows PowerShell not found: $powerShellExe"
  }

  $arguments = @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Sta',
    '-File',
    $script:BridgeScript,
    '-RepoRoot',
    $script:RepoRootPath,
    '-ManifestPath',
    $script:ManifestPath,
    '-PipeName',
    $PipeName
  ) | ForEach-Object { ConvertTo-ProcessArgument -Value ([string]$_) }

  Start-Process -FilePath $powerShellExe -ArgumentList ($arguments -join ' ') -WindowStyle Hidden | Out-Null
}

function Ensure-Bridge {
  $pingRequest = [pscustomobject]@{
    command = 'ping'
    requestId = [guid]::NewGuid().ToString('n')
  }

  try {
    return Send-BridgeRequest -Request $pingRequest -TimeoutMs $ConnectTimeoutMs
  } catch {
    if ($NoStartBridge) {
      throw
    }
  }

  $mutex = [System.Threading.Mutex]::new($false, 'Global\FlowCell.Illustrator.Bridge.Start.v1')
  $hasMutex = $false
  try {
    $hasMutex = $mutex.WaitOne(5000)
    if (-not $hasMutex) {
      throw 'Timed out waiting for the Illustrator bridge start lock.'
    }

    try {
      return Send-BridgeRequest -Request $pingRequest -TimeoutMs $ConnectTimeoutMs
    } catch {
      if (-not (Test-BridgeProcessAlive)) {
        Start-BridgeProcess
      }
    }
  } finally {
    if ($hasMutex) {
      $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds($StartTimeoutMs)
  do {
    Start-Sleep -Milliseconds 150
    try {
      return Send-BridgeRequest -Request $pingRequest -TimeoutMs $ConnectTimeoutMs
    } catch {
      if ([DateTime]::UtcNow -ge $deadline) {
        throw
      }
    }
  } while ([DateTime]::UtcNow -lt $deadline)

  throw 'Timed out waiting for the Illustrator bridge to become ready.'
}

function Import-LocalManifest {
  if (-not [System.IO.File]::Exists($script:ManifestPath)) {
    throw "Illustrator action manifest not found: $script:ManifestPath"
  }

  return (Get-Content -LiteralPath $script:ManifestPath -Raw | ConvertFrom-Json)
}

function Assert-ManifestAction {
  param([Parameter(Mandatory = $true)][string]$Id)

  $manifest = Import-LocalManifest
  $matches = @($manifest.actions | Where-Object { $_.id -ieq $Id })
  if ($matches.Count -ne 1) {
    throw "Unknown Illustrator action id: $Id"
  }
}

if ($ListActions) {
  $manifest = Import-LocalManifest
  $manifest.actions |
    Sort-Object id |
    ForEach-Object { "{0}`t{1}`t{2}" -f $_.id, $_.label, $_.script }
  exit 0
}

if ($Ping) {
  $response = Ensure-Bridge
  if (-not $response.ok) {
    throw $response.error
  }
  $response | ConvertTo-Json -Compress -Depth 10
  exit 0
}

if ($StartOnly) {
  $response = Ensure-Bridge
  if (-not $response.ok) {
    throw $response.error
  }
  Write-Host "Illustrator bridge ready on pipe '$PipeName' (PID $($response.pid))."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($ActionId)) {
  throw 'ActionId is required unless -StartOnly, -Ping, or -ListActions is used.'
}

Assert-ManifestAction -Id $ActionId
[void](Ensure-Bridge)

$request = [pscustomobject]@{
  command = 'run'
  requestId = [guid]::NewGuid().ToString('n')
  actionId = $ActionId
  wait = [bool]$Wait
}

if (-not [string]::IsNullOrWhiteSpace($ArgsJson)) {
  $request | Add-Member -NotePropertyName args -NotePropertyValue ($ArgsJson | ConvertFrom-Json)
}

$response = Send-BridgeRequest -Request $request -TimeoutMs $ConnectTimeoutMs
if (-not $response.ok) {
  throw $response.error
}

if ($Wait) {
  $response | ConvertTo-Json -Compress -Depth 10
} else {
  Write-Host "Accepted Illustrator action '$ActionId'."
}
