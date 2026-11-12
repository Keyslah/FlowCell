<# Resolves authoritative release input only. Does not build or create ZIPs. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $PSScriptRoot '../program-package-safety.ps1')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-program-profile-root-tests-' + [guid]::NewGuid().ToString('N'))
$savedLocalAppData = $env:LOCALAPPDATA
$savedProgramRoot = $env:FLOWCELL_PROGRAM_LOCAL_ROOT
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
  $script:checks++
}
function Rejected([scriptblock]$Action, [string]$Pattern) {
  $message = $null
  try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
  Assert ($null -ne $message -and $message -like $Pattern) "Expected '$Pattern'; received '$message'."
}
function Put([string]$Path, [string]$Text) {
  [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
try {
  $env:LOCALAPPDATA = Join-Path $fixtureRoot 'appdata'
  $env:FLOWCELL_PROGRAM_LOCAL_ROOT = ''
  $explicit = Join-Path $fixtureRoot 'explicit'
  $configured = Join-Path $fixtureRoot 'configured'
  $installed = Join-Path $fixtureRoot 'installed'
  $runtimePath = Join-Path $env:LOCALAPPDATA 'Programs/FlowCell/flowcell.runtime.json'
  foreach ($root in @($explicit, $configured, $installed)) { Put (Join-Path $root 'button-system/button-state.json') '{}' }
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*no installed FlowCell runtime*'
  Put $runtimePath (@{localRoot=$installed} | ConvertTo-Json)
  Assert ((Resolve-ProgramProfileLocalRoot '') -ceq $installed) 'Installed runtime selects its exact canonical saved root.'
  $env:FLOWCELL_PROGRAM_LOCAL_ROOT = $configured
  Assert ((Resolve-ProgramProfileLocalRoot '') -ceq $configured) 'Environment overrides installed runtime.'
  Assert ((Resolve-ProgramProfileLocalRoot $explicit) -ceq $explicit) 'Explicit root overrides environment and installed runtime.'
  Rejected { Resolve-ProgramProfileLocalRoot (Join-Path $fixtureRoot 'missing') } '*no canonical*'
  Rejected { Resolve-ProgramProfileLocalRoot 'relative/local' } '*absolute path*'
  $env:FLOWCELL_PROGRAM_LOCAL_ROOT = Join-Path $fixtureRoot 'missing-environment'
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*no canonical*'
  $env:FLOWCELL_PROGRAM_LOCAL_ROOT = ''
  Put $runtimePath 'broken JSON'
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*invalid JSON*'
  Put $runtimePath '{}'
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*does not declare localRoot*'
  Put $runtimePath '{"localRoot":null}'
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*does not declare localRoot*'
  Put $runtimePath '{"localRoot":"relative"}'
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*absolute path*'
  Put $runtimePath (' ' * 65537)
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*exceeds 65536 bytes*'
  $env:LOCALAPPDATA = ''
  Rejected { Resolve-ProgramProfileLocalRoot '' } '*runtime location is unavailable*'
  Write-Output "Program profile root: $($script:checks) checks passed; 0 ZIPs created."
} finally {
  $env:LOCALAPPDATA = $savedLocalAppData
  $env:FLOWCELL_PROGRAM_LOCAL_ROOT = $savedProgramRoot
  $resolved = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notmatch '^flowcell-program-profile-root-tests-[0-9a-f]{32}$') { throw 'Unsafe fixture cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
