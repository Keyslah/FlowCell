#requires -version 5.1
[CmdletBinding()]
param(
  [string]$ActionId,
  [string]$ScriptPath,
  [string]$RepoRoot,
  [string]$PipeName = 'FlowCell.Illustrator.Bridge.v1',
  [int]$ConnectTimeoutMs = 700,
  [int]$StartTimeoutMs = 6000,
  [string]$ArgsJson,
  [switch]$Wait,
  [switch]$StartOnly,
  [switch]$Ping,
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
$script:LocalScriptsRoot = Join-Path $script:ProgramRoot 'Illustrator Local Scripts'
$script:BridgeScript = Join-Path $script:ProgramRoot 'SupportScripts\Start-IllustratorFlowCellBridge.ps1'
$script:PidPath = Join-Path $script:RepoRootPath 'flowcellbackend\local\illustrator-bridge.pid.json'

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
    # PipeStream on .NET Framework (Windows PowerShell 5.1) does not support
    # Read/Write timeouts and throws when they are assigned. Connect() above
    # already bounds connection time, so treat these as best-effort.
    try {
      $client.ReadTimeout = [Math]::Max($TimeoutMs, 1000)
      $client.WriteTimeout = [Math]::Max($TimeoutMs, 1000)
    } catch {
      # Timeouts are not supported on this stream; continue without them.
    }

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

function ConvertTo-ComparablePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if ($fullPath.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
    return '\\' + $fullPath.Substring(8)
  }
  if (
    $fullPath.StartsWith('\\?\', [System.StringComparison]::OrdinalIgnoreCase) -and
    $fullPath.Length -ge 6 -and
    $fullPath[5] -eq ':'
  ) {
    return $fullPath.Substring(4)
  }
  return $fullPath
}

function Test-IsUnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $fullPath = ConvertTo-ComparablePath -Path $Path
  $fullRoot = (ConvertTo-ComparablePath -Path $Root).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  return $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-InstalledScriptPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $candidate = ConvertTo-ComparablePath -Path $Path
  if (-not (Test-IsUnderRoot -Path $candidate -Root $script:LocalScriptsRoot)) {
    throw "Refusing Illustrator script outside Button-owned Local Scripts: $Path"
  }
  $extension = [System.IO.Path]::GetExtension($candidate)
  if (($extension -ine '.jsx' -and $extension -ine '.js') -or -not [System.IO.File]::Exists($candidate)) {
    throw "Installed Illustrator script was not found or is unsupported: $candidate"
  }
  return $candidate
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
  throw 'ActionId is required unless -StartOnly or -Ping is used.'
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  throw 'ScriptPath is required and must identify a Button-owned Local Scripts file.'
}
$resolvedScriptPath = Assert-InstalledScriptPath -Path $ScriptPath
[void](Ensure-Bridge)

$request = [pscustomobject]@{
  command = 'run'
  requestId = [guid]::NewGuid().ToString('n')
  actionId = $ActionId
  wait = [bool]$Wait
}

if (-not [string]::IsNullOrWhiteSpace($resolvedScriptPath)) {
  $request | Add-Member -NotePropertyName scriptPath -NotePropertyValue $resolvedScriptPath
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
