#requires -version 5.1
[CmdletBinding()]
param(
  [string]$RepoRoot,
  [string]$ManifestPath,
  [string]$PipeName = 'FlowCell.Illustrator.Bridge.v1',
  [string]$PidPath,
  [string]$LogPath,
  [switch]$NoPrewarm
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
$script:PidPath = if ([string]::IsNullOrWhiteSpace($PidPath)) {
  Join-Path $script:RepoRootPath 'FlowCell\local\illustrator-bridge.pid.json'
} else {
  [System.IO.Path]::GetFullPath($PidPath)
}
$script:LogPath = if ([string]::IsNullOrWhiteSpace($LogPath)) {
  Join-Path $script:RepoRootPath 'FlowCell\local\logs\illustrator-bridge.log'
} else {
  [System.IO.Path]::GetFullPath($LogPath)
}
$script:IllustratorApp = $null
$script:ActionMap = @{}

function Write-BridgeLog {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [string]$Level = 'INFO'
  )

  $directory = Split-Path -Parent $script:LogPath
  if (-not [System.IO.Directory]::Exists($directory)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }

  $stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffK')
  Add-Content -LiteralPath $script:LogPath -Value "[$stamp] [$Level] $Message" -Encoding UTF8
}

function ConvertTo-ResponseLine {
  param([Parameter(Mandatory = $true)]$Value)
  return ($Value | ConvertTo-Json -Compress -Depth 20)
}

function ConvertTo-JsLiteral {
  param([AllowNull()]$Value)

  if ($null -eq $Value) {
    return 'null'
  }

  return ($Value | ConvertTo-Json -Compress -Depth 20)
}

function ConvertTo-JsStringLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return ($Value | ConvertTo-Json -Compress)
}

function Test-IsUnderRoot {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Root
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  return $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-ProgramRelativePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
    [System.IO.Path]::GetFullPath($Path)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $script:ProgramRoot $Path))
  }

  if (-not (Test-IsUnderRoot -Path $candidate -Root $script:ProgramRoot)) {
    throw "Refusing Illustrator action path outside program root: $Path"
  }

  return $candidate
}

function Import-ActionManifest {
  if (-not [System.IO.File]::Exists($script:ManifestPath)) {
    throw "Illustrator action manifest not found: $script:ManifestPath"
  }

  $manifest = Get-Content -LiteralPath $script:ManifestPath -Raw | ConvertFrom-Json
  if ($null -eq $manifest.actions) {
    throw "Illustrator action manifest has no actions array: $script:ManifestPath"
  }

  $map = @{}
  foreach ($action in @($manifest.actions)) {
    if ([string]::IsNullOrWhiteSpace($action.id)) {
      throw 'Illustrator action manifest contains an action without an id.'
    }
    if ([string]::IsNullOrWhiteSpace($action.script)) {
      throw "Illustrator action '$($action.id)' does not declare a script path."
    }

    $key = $action.id.ToLowerInvariant()
    if ($map.ContainsKey($key)) {
      throw "Duplicate Illustrator action id: $($action.id)"
    }

    $scriptPath = Resolve-ProgramRelativePath -Path $action.script
    if (-not [System.IO.File]::Exists($scriptPath)) {
      throw "Illustrator action '$($action.id)' script not found: $scriptPath"
    }

    $map[$key] = [pscustomobject]@{
      id = [string]$action.id
      label = [string]$action.label
      script = [string]$action.script
      scriptPath = $scriptPath
      description = if ($action.PSObject.Properties.Name -contains 'description') { [string]$action.description } else { '' }
    }
  }

  $script:ActionMap = $map
  Write-BridgeLog "Loaded $($map.Count) Illustrator action(s) from $script:ManifestPath"
}

function Get-IllustratorApplication {
  if ($null -ne $script:IllustratorApp) {
    try {
      [void]$script:IllustratorApp.Version
      return $script:IllustratorApp
    } catch {
      Write-BridgeLog "Discarding stale Illustrator COM object: $($_.Exception.Message)" 'WARN'
      $script:IllustratorApp = $null
    }
  }

  try {
    $script:IllustratorApp = [Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')
  } catch {
    $script:IllustratorApp = New-Object -ComObject Illustrator.Application
  }

  try {
    $script:IllustratorApp.Visible = $true
  } catch {
    Write-BridgeLog "Could not set Illustrator visible: $($_.Exception.Message)" 'WARN'
  }

  [void]$script:IllustratorApp.Version
  return $script:IllustratorApp
}

function Invoke-IllustratorAction {
  param(
    [Parameter(Mandatory = $true)][string]$ActionId,
    [AllowNull()]$Arguments
  )

  $key = $ActionId.ToLowerInvariant()
  if (-not $script:ActionMap.ContainsKey($key)) {
    throw "Unknown Illustrator action id: $ActionId"
  }

  $action = $script:ActionMap[$key]
  $app = Get-IllustratorApplication
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  Write-BridgeLog "Running Illustrator action '$($action.id)' from $($action.scriptPath)"

  $hasArguments = $null -ne $Arguments
  if ($hasArguments) {
    $scriptBody = Get-Content -LiteralPath $action.scriptPath -Raw
    $prefix = @(
      "var FLOWCELL_ACTION_ID = $(ConvertTo-JsStringLiteral -Value $action.id);"
      "var FLOWCELL_ARGS = $(ConvertTo-JsLiteral -Value $Arguments);"
    ) -join "`r`n"
    $result = $app.DoJavaScript($prefix + "`r`n" + $scriptBody)
  } else {
    try {
      $result = $app.DoJavaScriptFile($action.scriptPath)
    } catch {
      Write-BridgeLog "DoJavaScriptFile failed for '$($action.id)', retrying from script text: $($_.Exception.Message)" 'WARN'
      $scriptBody = Get-Content -LiteralPath $action.scriptPath -Raw
      $prefix = "var FLOWCELL_ACTION_ID = $(ConvertTo-JsStringLiteral -Value $action.id);"
      $result = $app.DoJavaScript($prefix + "`r`n" + $scriptBody)
    }
  }

  $timer.Stop()
  Write-BridgeLog "Finished Illustrator action '$($action.id)' in $($timer.ElapsedMilliseconds) ms"
  return [pscustomobject]@{
    ok = $true
    actionId = $action.id
    elapsedMs = $timer.ElapsedMilliseconds
    result = if ($null -eq $result) { $null } else { [string]$result }
  }
}

function Write-PidFile {
  $directory = Split-Path -Parent $script:PidPath
  if (-not [System.IO.Directory]::Exists($directory)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }

  [pscustomobject]@{
    pid = $PID
    pipeName = $PipeName
    manifestPath = $script:ManifestPath
    startedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:PidPath -Encoding UTF8
}

function Handle-Request {
  param([Parameter(Mandatory = $true)]$Request)

  $command = if ($Request.PSObject.Properties.Name -contains 'command') { [string]$Request.command } else { 'run' }
  $requestId = if ($Request.PSObject.Properties.Name -contains 'requestId') { [string]$Request.requestId } else { [guid]::NewGuid().ToString('n') }

  switch ($command) {
    'ping' {
      return [pscustomobject]@{
        ok = $true
        requestId = $requestId
        pid = $PID
        pipeName = $PipeName
        actionCount = $script:ActionMap.Count
        apartment = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
      }
    }
    'reload-manifest' {
      Import-ActionManifest
      return [pscustomobject]@{
        ok = $true
        requestId = $requestId
        actionCount = $script:ActionMap.Count
      }
    }
    'list-actions' {
      return [pscustomobject]@{
        ok = $true
        requestId = $requestId
        actions = @($script:ActionMap.Values | Sort-Object id | ForEach-Object {
          [pscustomobject]@{
            id = $_.id
            label = $_.label
            script = $_.script
            description = $_.description
          }
        })
      }
    }
    'run' {
      $actionId = [string]$Request.actionId
      if ([string]::IsNullOrWhiteSpace($actionId)) {
        throw 'Run request missing actionId.'
      }
      if (-not $script:ActionMap.ContainsKey($actionId.ToLowerInvariant())) {
        throw "Unknown Illustrator action id: $actionId"
      }

      $arguments = if ($Request.PSObject.Properties.Name -contains 'args') { $Request.args } else { $null }
      $wait = if ($Request.PSObject.Properties.Name -contains 'wait') { [bool]$Request.wait } else { $false }

      if ($wait) {
        $result = Invoke-IllustratorAction -ActionId $actionId -Arguments $arguments
        $result | Add-Member -NotePropertyName requestId -NotePropertyValue $requestId -Force
        return $result
      }

      return [pscustomobject]@{
        ok = $true
        accepted = $true
        requestId = $requestId
        actionId = $actionId
      }
    }
    default {
      throw "Unknown Illustrator bridge command: $command"
    }
  }
}

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne [System.Threading.ApartmentState]::STA) {
  throw 'Start-IllustratorFlowCellBridge.ps1 must run in an STA PowerShell host. Use powershell.exe -Sta.'
}

Import-ActionManifest
Write-PidFile
Write-BridgeLog "Illustrator bridge started on pipe '$PipeName' with PID $PID"

if (-not $NoPrewarm) {
  try {
    [void](Get-IllustratorApplication)
    Write-BridgeLog 'Illustrator COM prewarm completed'
  } catch {
    Write-BridgeLog "Illustrator COM prewarm deferred: $($_.Exception.Message)" 'WARN'
  }
}

while ($true) {
  $server = $null
  $reader = $null
  $writer = $null
  $pendingRun = $null

  try {
    $server = [System.IO.Pipes.NamedPipeServerStream]::new(
      $PipeName,
      [System.IO.Pipes.PipeDirection]::InOut,
      1,
      [System.IO.Pipes.PipeTransmissionMode]::Byte,
      [System.IO.Pipes.PipeOptions]::None
    )
    $server.WaitForConnection()

    $reader = [System.IO.StreamReader]::new($server)
    $writer = [System.IO.StreamWriter]::new($server)
    $writer.AutoFlush = $true

    $line = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) {
      throw 'Empty Illustrator bridge request.'
    }

    $request = $line | ConvertFrom-Json
    $response = Handle-Request -Request $request
    $writer.WriteLine((ConvertTo-ResponseLine -Value $response))

    if (([string]$request.command) -eq 'run') {
      $wait = if ($request.PSObject.Properties.Name -contains 'wait') { [bool]$request.wait } else { $false }
      if (-not $wait) {
        $pendingRun = $request
      }
    }
  } catch {
    $message = $_.Exception.Message
    Write-BridgeLog $message 'ERROR'
    if ($null -ne $writer) {
      $writer.WriteLine((ConvertTo-ResponseLine -Value ([pscustomobject]@{
        ok = $false
        error = $message
      })))
    }
  } finally {
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $reader) { $reader.Dispose() }
    if ($null -ne $server) { $server.Dispose() }
  }

  if ($null -ne $pendingRun) {
    try {
      $arguments = if ($pendingRun.PSObject.Properties.Name -contains 'args') { $pendingRun.args } else { $null }
      [void](Invoke-IllustratorAction -ActionId ([string]$pendingRun.actionId) -Arguments $arguments)
    } catch {
      Write-BridgeLog "Async Illustrator action '$($pendingRun.actionId)' failed: $($_.Exception.Message)" 'ERROR'
    }
  }
}
