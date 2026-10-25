#requires -version 5.1
<# Exercises extracted bridge functions with a fake COM boundary. No bridge,
   Illustrator process, named pipe, or desktop interaction is started. #>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$bridgePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-IllustratorFlowCellBridge.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($bridgePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Assert-ClosedApplication([scriptblock]$Operation) {
  $failure = ''
  try { & $Operation | Out-Null } catch { $failure = $_.Exception.Message }
  Assert-True ($failure -like 'Open Illustrator to use this action.*') 'A closed application must produce an actionable error.'
  Assert-True ($null -eq $script:IllustratorApp) 'A failed connection must not leave a cached COM object.'
}

$source = $ast.Extent.Text
Assert-True ($source -notmatch '(?i)-ComObject|CreateInstance|\.Visible\s*=') 'The bridge must never create or show Illustrator.'
$functions = @(
  'Get-IllustratorApplication', 'Test-IsStaleIllustratorComError',
  'Test-IsUnavailableDoJavaScriptFileMember', 'Invoke-IllustratorAction',
  'ConvertTo-JsStringLiteral', 'ConvertTo-JsLiteral', 'Handle-Request'
)
foreach ($name in $functions) {
  $functionAst = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Assert-True ($null -ne $functionAst) "Missing bridge function: $name"
  $definition = $functionAst.Extent.Text
  if ($name -eq 'Get-IllustratorApplication') {
    $boundary = "[Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application')"
    Assert-True ($definition.Contains($boundary)) 'The COM boundary must attach to an already-running instance.'
    $definition = $definition.Replace($boundary, '(Get-FixtureActiveIllustrator)')
  }
  . ([scriptblock]::Create($definition))
}

function Write-BridgeLog { param([string]$Message, [string]$Level) }
function Resolve-InstalledScriptPath { param([string]$Path) return $Path }
function Get-FixtureActiveIllustrator {
  $script:LookupCount++
  if ($null -eq $script:AvailableApp) { throw 'No active COM object.' }
  return $script:AvailableApp
}
function New-FixtureApp {
  $app = [pscustomobject]@{ Disconnected = $false; DisconnectOnAction = $false; Executions = 0 }
  $app | Add-Member ScriptProperty Version {
    if ($this.Disconnected) { throw 'RPC server is unavailable (0x800706BA).' }
    return 'fixture-version'
  }
  $app | Add-Member ScriptMethod DoJavaScript {
    param($Source)
    if ($this.DisconnectOnAction) {
      $this.Disconnected = $true
      throw 'RPC server is unavailable (0x800706BA).'
    }
    return 'context installed'
  }
  $app | Add-Member ScriptMethod DoJavaScriptFile {
    param($Path)
    $this.Executions++
    return 'action executed'
  }
  return $app
}

$script:IllustratorApp = $null
$script:AvailableApp = $null
$script:LookupCount = 0
$PipeName = 'fixture-only'
$prewarm = [pscustomobject]@{ command = 'prewarm'; requestId = 'startup' }
$action = [pscustomobject]@{ command = 'run'; requestId = 'button'; actionId = 'fixture'; scriptPath = 'fixture.jsx'; wait = $true }

# Startup makes one attempt and remains idle when Illustrator is closed.
Assert-ClosedApplication { Handle-Request $prewarm }
Assert-True ($script:LookupCount -eq 1) 'Closed-app prewarm must make only one attachment attempt.'

# An already-open application connects at startup; subsequent actions reuse it.
$script:AvailableApp = New-FixtureApp
$response = Handle-Request $prewarm
Assert-True ($response.ok -and $script:LookupCount -eq 2) 'Startup must attach to an already-open application.'
$response = Handle-Request $action
Assert-True ($response.ok -and $response.result -eq 'action executed') 'The first button must execute its action.'
[void](Handle-Request $action)
Assert-True ($script:LookupCount -eq 2 -and $script:AvailableApp.Executions -eq 2) 'Subsequent actions must reuse the connection.'

# A stale cached connection is replaced only when a request arrives.
$script:IllustratorApp.Disconnected = $true
$script:AvailableApp = New-FixtureApp
$response = Handle-Request $action
Assert-True ($response.ok -and $script:LookupCount -eq 3 -and $script:AvailableApp.Executions -eq 1) 'The next action must reconnect to a restarted application.'

# Closed-app asynchronous actions fail before being falsely acknowledged.
$script:IllustratorApp.Disconnected = $true
$script:AvailableApp = $null
$action.wait = $false
Assert-ClosedApplication { Handle-Request $action }
Assert-True ($script:LookupCount -eq 4) 'A closed app must receive only one attempt for this button press.'

# Opening Illustrator later allows the next asynchronous action to attach.
$script:AvailableApp = New-FixtureApp
$response = Handle-Request $action
Assert-True ($response.accepted -and $script:LookupCount -eq 5) 'The first later button press must establish the bridge.'
[void](Invoke-IllustratorAction -ActionId 'fixture' -ScriptPath 'fixture.jsx' -Arguments $null)
Assert-True ($script:AvailableApp.Executions -eq 1 -and $script:LookupCount -eq 5) 'The accepted action must execute using its new connection.'

# An in-flight disconnect can retry once against an already-open replacement.
$script:IllustratorApp.DisconnectOnAction = $true
$script:AvailableApp = New-FixtureApp
$action.wait = $true
$response = Handle-Request $action
Assert-True ($response.ok -and $script:LookupCount -eq 6 -and $script:AvailableApp.Executions -eq 1) 'A stale action must retry once against the active replacement.'

# If Illustrator actually closed during that action, the retry cannot launch it.
$script:IllustratorApp.DisconnectOnAction = $true
$script:AvailableApp = $null
Assert-ClosedApplication { Handle-Request $action }
Assert-True ($script:LookupCount -eq 7) 'An in-flight disconnect must not repeatedly poll for Illustrator.'

Write-Output 'PASS: attach-only startup, closed-app error, cached connection, first-action connection, asynchronous rejection, and stale COM reconnection. All COM boundaries mocked.'
