#requires -version 5.1
[CmdletBinding()]
param(
  [string]$RepoRoot,
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
$script:LocalScriptsRoot = Join-Path $script:ProgramRoot 'Illustrator Local Scripts'
$script:PidPath = if ([string]::IsNullOrWhiteSpace($PidPath)) {
  Join-Path $script:RepoRootPath 'flowcellbackend\local\illustrator-bridge.pid.json'
} else {
  [System.IO.Path]::GetFullPath($PidPath)
}
$script:LogPath = if ([string]::IsNullOrWhiteSpace($LogPath)) {
  Join-Path $script:RepoRootPath 'flowcellbackend\local\logs\illustrator-bridge.log'
} else {
  [System.IO.Path]::GetFullPath($LogPath)
}
$script:IllustratorApp = $null

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

function Resolve-InstalledScriptPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $candidate = [System.IO.Path]::GetFullPath($Path)
  if (-not (Test-IsUnderRoot -Path $candidate -Root $script:LocalScriptsRoot)) {
    throw "Refusing Illustrator script outside Button-owned Local Scripts: $Path"
  }
  $extension = [System.IO.Path]::GetExtension($candidate)
  if (($extension -ine '.jsx' -and $extension -ine '.js') -or -not [System.IO.File]::Exists($candidate)) {
    throw "Installed Illustrator script was not found or is unsupported: $candidate"
  }
  return $candidate
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

function Test-IsStaleIllustratorComError {
  param([Parameter(Mandatory = $true)][System.Exception]$Exception)

  $current = $Exception
  while ($null -ne $current) {
    if (
      $current.HResult -eq -2147023174 -or
      $current.Message -match '(?i)0x800706BA|RPC server is unavailable'
    ) {
      return $true
    }
    $current = $current.InnerException
  }
  return $false
}

function Invoke-IllustratorAction {
  param(
    [Parameter(Mandatory = $true)][string]$ActionId,
    [string]$ScriptPath,
    [AllowNull()]$Arguments
  )

  if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    throw 'Illustrator action is missing its Button-owned installed script path.'
  }
  $resolvedScriptPath = Resolve-InstalledScriptPath -Path $ScriptPath
  $action = [pscustomobject]@{
    id = $ActionId
    label = $ActionId
    script = $resolvedScriptPath
    scriptPath = $resolvedScriptPath
    description = 'Button-owned installed Illustrator script'
  }
  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  Write-BridgeLog "Running Illustrator action '$($action.id)' from $($action.scriptPath)"

  $hasArguments = $null -ne $Arguments
  $result = $null
  for ($attempt = 0; $attempt -lt 2; $attempt += 1) {
    $app = Get-IllustratorApplication
    try {
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
          if (Test-IsStaleIllustratorComError -Exception $_.Exception) { throw }
          Write-BridgeLog "DoJavaScriptFile failed for '$($action.id)', retrying from script text: $($_.Exception.Message)" 'WARN'
          $scriptBody = Get-Content -LiteralPath $action.scriptPath -Raw
          $prefix = "var FLOWCELL_ACTION_ID = $(ConvertTo-JsStringLiteral -Value $action.id);"
          $result = $app.DoJavaScript($prefix + "`r`n" + $scriptBody)
        }
      }
      break
    } catch {
      if ($attempt -ne 0 -or -not (Test-IsStaleIllustratorComError -Exception $_.Exception)) {
        throw
      }
      Write-BridgeLog "Illustrator COM disconnected during '$($action.id)'; reacquiring the active application and retrying once." 'WARN'
      $script:IllustratorApp = $null
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
        apartment = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
      }
    }
    'run' {
      $actionId = [string]$Request.actionId
      if ([string]::IsNullOrWhiteSpace($actionId)) {
        throw 'Run request missing actionId.'
      }
      $installedScriptPath = if ($Request.PSObject.Properties.Name -contains 'scriptPath') { [string]$Request.scriptPath } else { '' }
      if ([string]::IsNullOrWhiteSpace($installedScriptPath)) {
        throw 'Run request missing Button-owned installed scriptPath.'
      }
      $installedScriptPath = Resolve-InstalledScriptPath -Path $installedScriptPath

      $arguments = if ($Request.PSObject.Properties.Name -contains 'args') { $Request.args } else { $null }
      $wait = if ($Request.PSObject.Properties.Name -contains 'wait') { [bool]$Request.wait } else { $false }

      if ($wait) {
        $result = Invoke-IllustratorAction -ActionId $actionId -ScriptPath $installedScriptPath -Arguments $arguments
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
      $installedScriptPath = if ($pendingRun.PSObject.Properties.Name -contains 'scriptPath') { [string]$pendingRun.scriptPath } else { '' }
      [void](Invoke-IllustratorAction -ActionId ([string]$pendingRun.actionId) -ScriptPath $installedScriptPath -Arguments $arguments)
    } catch {
      Write-BridgeLog "Async Illustrator action '$($pendingRun.actionId)' failed: $($_.Exception.Message)" 'ERROR'
    }
  }
}
