[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Stop-Package([string]$Message) { throw $Message }
. (Join-Path $PSScriptRoot '..\program-package-safety.ps1')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-bind-reference-tests-' + [guid]::NewGuid().ToString('N'))
$passed = 0
function Expect-Rejection([scriptblock]$Action, [string]$Pattern) {
  $message = $null
  try { & $Action } catch { $message = $_.Exception.Message }
  if (-not $message -or $message -notlike $Pattern) { throw "Expected '$Pattern'; received '$message'." }
}
try {
  $programPath = Join-Path $fixtureRoot 'Programs\Sample'
  $helpers = Join-Path $programPath 'Helpers'
  New-Item -ItemType Directory -Path $helpers -Force | Out-Null
  $program = Get-Item -LiteralPath $programPath
  $manifest = [pscustomobject]@{supportScriptsFolder='Helpers';bundledSources=@()}
  Assert-ProgramManifestReferencesTracked $program $manifest @()
  $passed++
  $manifest | Add-Member -NotePropertyName bindActionsFile -NotePropertyValue 'Helpers/actions.ini'
  Expect-Rejection { Assert-ProgramManifestReferencesTracked $program $manifest @() } '*not found*'
  $passed++
  $actions = Join-Path $helpers 'actions.ini'
  [IO.File]::WriteAllText($actions, "[Meta]`nSchemaVersion=1`n[Action_sample]`nSource=Helpers/capture.jsx`n")
  [IO.File]::WriteAllText((Join-Path $helpers 'capture.jsx'), 'throw "fixture must not execute";')
  Expect-Rejection { Assert-ProgramManifestReferencesTracked $program $manifest @() } '*not Git-tracked*'
  $passed++
  $tracked = @('Programs/Sample/Helpers/actions.ini')
  Expect-Rejection { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*not Git-tracked*'
  $passed++
  $tracked += 'Programs/Sample/Helpers/capture.jsx'
  Assert-ProgramManifestReferencesTracked $program $manifest $tracked
  $passed++
  [IO.File]::WriteAllText($actions, "[Action_sample]`nSource=../capture.jsx`n")
  Expect-Rejection { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*unsafe*'
  $passed++
  [IO.File]::WriteAllText($actions, "[Action_sample]`nSource=Helpers/missing.jsx`n")
  Expect-Rejection { Assert-ProgramManifestReferencesTracked $program $manifest $tracked } '*not found*'
  $passed++
  Write-Output "Program bind action reference tests: $passed passed."
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot)
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notlike 'flowcell-bind-reference-tests-*') { throw 'Unsafe fixture cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
