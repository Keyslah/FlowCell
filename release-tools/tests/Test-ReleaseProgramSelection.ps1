<#
Verify selected release inventories, default inventory and failure-before-build behavior.
Uses a disposable Git fixture and inert ZIP payloads; never builds or installs FlowCell.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot = Split-Path -Parent $PSScriptRoot
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixtureRoot = Join-Path $temporaryParent ('flowcell-release-selection-tests-' + [guid]::NewGuid().ToString('N'))
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
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
  $message = $null
  try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
  Assert ($null -ne $message -and $message -like $Pattern) "Expected '$Pattern', received '$message'."
}
function Add-InstallerFixture([string]$Output) {
  $installerPath = Join-Path $fixtureRoot 'Fixture-setup.exe'
  [IO.File]::WriteAllBytes($installerPath, [byte[]]::new(1000001))
  Compress-Archive -LiteralPath $installerPath -DestinationPath (Join-Path $Output 'flowcellwindowsinstaller.zip')
}

try {
  [IO.Directory]::CreateDirectory($fixtureRelease) | Out-Null
  foreach ($name in @('build-installer.ps1', 'package-portable.ps1', 'verify-release.ps1', 'program-package-safety.ps1', 'program-package-integrity.ps1', 'blender-theme-packages.ps1')) {
    Copy-Item -LiteralPath (Join-Path $releaseRoot $name) -Destination (Join-Path $fixtureRelease $name)
  }
  Put (Join-Path $fixtureRelease 'prepare-installer.ps1') @'
param([string]$AutoHotkeyExe, [string]$AutoHotkeyLicenseFile)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'prepare-reached.txt'), 'unexpected')
throw 'This fixture must never prepare or build an installer.'
'@
  # Updater content validation has separate regression coverage. Keep this fixture's catalogs inert.
  Put (Join-Path $fixtureRelease 'add-catalog-updaters.mjs') '// Inert catalog-validation fixture.'
  # Profile capture and compilation have their own real-production tests. This
  # fixture isolates release selection and exact archive verification.
  Put (Join-Path $fixtureRelease 'prepare-program-profile.mjs') '// Inert profile-capture fixture.'
  Put (Join-Path $repo 'FlowCellFrontend/node_modules/.bin/tsc.cmd') "@exit /b 0`r`n"
  $localRoot = Join-Path $fixtureRoot 'current-local'
  Put (Join-Path $localRoot 'button-system/button-state.json') '{}'
  foreach ($name in @('Blender', 'Windows')) {
    $program = Join-Path $repo "Programs/$name"
    $manifest = @{
      schemaVersion = 1; programId = $name.ToLowerInvariant(); label = $name
      panelsFolder = 'Panels'; localScriptsFolder = "$name Local Scripts"
      gitScriptsFolder = 'Catalog'; supportScriptsFolder = 'SupportScripts'; bundledSources = @()
    }
    Put (Join-Path $program 'flowcell.program.json') ($manifest | ConvertTo-Json -Depth 10)
    Put (Join-Path $program 'Catalog/action.ps1') 'throw "Fixture scripts must never run."'
    Put (Join-Path $program 'SupportScripts/catalog-baseline.json') '{}'
  }
  $themes = Join-Path $fixtureRoot 'themes'
  Put (Join-Path $themes 'Fixture.flowtheme.json') '{"kind":"FlowCellTheme","version":2,"target":{"kind":"program","programName":"Blender"}}'
  Put (Join-Path $repo 'flowcellbackend/local/program-package-sources.json') (@{blenderThemeLibrary=$themes} | ConvertTo-Json)
  & git -C $repo init --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Fixture Git init failed.' }
  & git -C $repo add -- Programs
  if ($LASTEXITCODE -ne 0) { throw 'Fixture Git inventory setup failed.' }
  Put (Join-Path $repo 'Programs/Untracked/flowcell.program.json') '{}'

  foreach ($driver in @('build-installer.ps1', 'package-portable.ps1', 'verify-release.ps1')) {
    foreach ($invalid in @('Untracked', '../Blender', '')) {
      $output = Join-Path $fixtureRoot ([guid]::NewGuid().ToString('N'))
      $arguments = @{ProgramNames=@($invalid)}
      if ($driver -eq 'verify-release.ps1') { $arguments.Directory = $output }
      else { $arguments.OutputDirectory = $output }
      if ($driver -eq 'package-portable.ps1') { $arguments.ProgramsOnly = $true }
      Assert-Rejected { & (Join-Path $fixtureRelease $driver) @arguments } '*Unknown release program*'
      Assert (-not (Test-Path -LiteralPath $output)) "$driver rejects '$invalid' before output writes"
      Assert (-not (Test-Path -LiteralPath (Join-Path $fixtureRelease 'prepare-reached.txt'))) "$driver rejects before installer preparation"
    }
  }

  $selected = Join-Path $fixtureRoot 'selected'
  & (Join-Path $fixtureRelease 'package-portable.ps1') -ProgramsOnly -OutputDirectory $selected -ProgramNames @('blender', 'Blender') -ProgramLocalRoot $localRoot | Out-Null
  $selectedZips = @(Get-ChildItem -LiteralPath $selected -File -Filter '*.zip')
  Assert ($selectedZips.Count -eq 1 -and $selectedZips[0].Name -ceq 'FlowCell-Blender.zip') 'case-insensitive duplicate selection creates one canonical Blender ZIP'
  Add-InstallerFixture $selected
  & (Join-Path $fixtureRelease 'verify-release.ps1') -Directory $selected -ProgramNames Blender | Out-Null
  $hashes = @(Get-Content -LiteralPath (Join-Path $selected 'SHA256SUMS.txt'))
  Assert ($hashes.Count -eq 2) 'selected release contains exactly two checksums'
  foreach ($asset in @('FlowCell-Blender.zip', 'flowcellwindowsinstaller.zip')) {
    $expected = (Get-FileHash -LiteralPath (Join-Path $selected $asset) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $asset
    Assert ($hashes -ccontains $expected) "selected release records the exact $asset SHA256"
  }

  $all = Join-Path $fixtureRoot 'all'
  & (Join-Path $fixtureRelease 'package-portable.ps1') -ProgramsOnly -OutputDirectory $all -ProgramLocalRoot $localRoot | Out-Null
  Assert (@(Get-ChildItem -LiteralPath $all -File -Filter '*.zip').Count -eq 2) 'omitting selection builds both tracked programs'
  Add-InstallerFixture $all
  & (Join-Path $fixtureRelease 'verify-release.ps1') -Directory $all | Out-Null
  Assert (@(Get-Content -LiteralPath (Join-Path $all 'SHA256SUMS.txt')).Count -eq 3) 'omitting selection verifies the complete tracked inventory'
  Assert-Rejected { & (Join-Path $fixtureRelease 'verify-release.ps1') -Directory $selected } '*Could not find*'
  Copy-Item -LiteralPath (Join-Path $all 'FlowCell-Windows.zip') -Destination (Join-Path $selected 'FlowCell-Windows.zip')
  Assert-Rejected { & (Join-Path $fixtureRelease 'verify-release.ps1') -Directory $selected -ProgramNames Blender } '*Release ZIP set differs*'
  # All files here are short-lived fixtures created by this test.
  Remove-Item -LiteralPath (Join-Path $selected 'FlowCell-Windows.zip') -Force
  $archive = [IO.Compression.ZipFile]::Open((Join-Path $selected 'FlowCell-Blender.zip'), [IO.Compression.ZipArchiveMode]::Update)
  try {
    $entry = $archive.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq 'Programs/Blender/Catalog/action.ps1' } | Select-Object -First 1
    $writer = [IO.StreamWriter]::new($entry.Open())
    try { $writer.Write('tampered fixture catalog') } finally { $writer.Dispose() }
  } finally { $archive.Dispose() }
  Assert-Rejected { & (Join-Path $fixtureRelease 'verify-release.ps1') -Directory $selected -ProgramNames Blender } '*Package inventory payload mismatch*'
  Write-Output "PASS: $($script:checks) release-selection assertions; no application build or installation."
} finally {
  $cleanupRoot = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
  if (-not $cleanupRoot.StartsWith(($temporaryParent + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($cleanupRoot) -notmatch '^flowcell-release-selection-tests-[0-9a-f]{32}$') {
    throw "Refusing cleanup outside the test fixture: $cleanupRoot"
  }
  if (Test-Path -LiteralPath $cleanupRoot) { Remove-Item -LiteralPath $cleanupRoot -Recurse -Force }
}
