<# Uses the actual release entry point with inert profile/compiler fixtures.
Proves every selected profile is checked before artifacts; creates no ZIP. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$releaseRoot = Split-Path -Parent $PSScriptRoot
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-profile-release-preflight-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $fixtureRoot 'repo'
$fixtureRelease = Join-Path $repo 'release-tools'
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FAIL: $Message" }
  $script:checks++
}
function Put([string]$Path, [string]$Text) {
  [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
try {
  [IO.Directory]::CreateDirectory($fixtureRelease) | Out-Null
  foreach ($name in @('package-portable.ps1', 'program-package-safety.ps1', 'program-package-integrity.ps1', 'blender-theme-packages.ps1')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot $name) -Destination (Join-Path $fixtureRelease $name)
  }
  foreach ($name in @('Alpha', 'Beta')) {
    Put (Join-Path $repo "Programs/$name/flowcell.program.json") (@{schemaVersion=1;programId=$name.ToLowerInvariant();label=$name;
      panelsFolder='Panels';localScriptsFolder="$name Local Scripts";gitScriptsFolder='Catalog';supportScriptsFolder='Support';bundledSources=@()} | ConvertTo-Json -Depth 8)
  }
  Put (Join-Path $repo 'FlowCellFrontend/node_modules/.bin/tsc.cmd') "@exit /b 0`r`n"
  Put (Join-Path $fixtureRelease 'prepare-program-profile.mjs') @'
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
const program = basename(process.argv[process.argv.indexOf('--program-root') + 1]);
appendFileSync(new URL('./profiles-reached.log', import.meta.url), program + '\n');
if (program === 'Beta') process.exitCode = 1;
'@
  Put (Join-Path $fixtureRelease 'add-catalog-updaters.mjs') @'
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./updater-reached.txt', import.meta.url), 'unexpected');
process.exitCode = 1;
'@
  $localRoot = Join-Path $fixtureRoot 'current-local'
  Put (Join-Path $localRoot 'button-system/button-state.json') '{}'
  & git -C $repo init --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Fixture Git initialization failed.' }
  & git -C $repo add -- Programs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture Git inventory failed.' }
  $output = Join-Path $fixtureRoot 'output'
  $message = $null
  try { & (Join-Path $fixtureRelease 'package-portable.ps1') -ProgramsOnly -OutputDirectory $output -ProgramNames @('Alpha', 'Beta') -ProgramLocalRoot $localRoot | Out-Null }
  catch { $message = $_.Exception.Message }
  Assert ($null -ne $message -and $message -like "*profile preflight failed for 'Beta'*") 'The second profile failure is reported.'
  $visited = @(Get-Content -LiteralPath (Join-Path $fixtureRelease 'profiles-reached.log'))
  Assert ($visited.Count -eq 2 -and $visited[0] -ceq 'Alpha' -and $visited[1] -ceq 'Beta') 'All selected profiles are checked in deterministic order.'
  Assert (-not (Test-Path -LiteralPath $output)) 'No output directory is created after an incomplete profile preflight.'
  Assert (-not (Test-Path -LiteralPath (Join-Path $fixtureRelease 'updater-reached.txt'))) 'No catalog preparation begins after failed profile preflight.'
  Assert (@(Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File -Filter '*.zip').Count -eq 0) 'No ZIP was created.'
  Write-Output "Program profile release preflight: $($script:checks) checks passed; 0 ZIPs created."
} finally {
  $resolved = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
  $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolved) -notmatch '^flowcell-profile-release-preflight-[0-9a-f]{32}$') { throw 'Unsafe fixture cleanup path.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
