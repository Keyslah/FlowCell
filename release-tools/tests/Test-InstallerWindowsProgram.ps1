<#
Purpose: Verify real Windows installer payload and isolated package safety failures.
Writes: One disposable temporary fixture tree; no installed data or source checkout changes.
#>
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$releaseRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Split-Path -Parent $releaseRoot
. (Join-Path $releaseRoot 'installer-windows-program.ps1')
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell-installer-windows-tests-' + [guid]::NewGuid().ToString('N'))
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
}
function Put([string]$Path, [string]$Text) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Expect-Rejection([scriptblock]$Action, [string]$Pattern) {
    $message = ''
    try { & $Action | Out-Null } catch { $message = $_.Exception.Message }
    Assert ($message -like $Pattern) "Expected '$Pattern'; received '$message'."
}
try {
    $actual = & {
        # Installer preparation must work even when Get-FileHash is unavailable
        # in its Windows PowerShell host. Keep the independent hash check below.
        function Get-FileHash { throw 'Get-FileHash is deliberately unavailable in this staging test.' }
        Copy-InstallerWindowsProgram -RepositoryRoot $sourceRoot -DestinationRoot (Join-Path $fixtureRoot 'actual')
    }
    Assert ($null -ne $actual) 'Real payload staging does not depend on Get-FileHash.'
    $manifest = Get-Content -LiteralPath (Join-Path $actual.Destination 'flowcell.program.json') -Raw | ConvertFrom-Json
    Assert ($manifest.programId -ceq 'windows') 'Real Windows manifest is present.'
    Assert (@($manifest.panels | Where-Object { $_.label -in @('Files','Utility','Startup') }).Count -eq 3) 'All three panel choices are bundled.'
    Assert ($actual.Files -gt 10 -and $actual.CatalogFiles -gt 10) 'The full Windows catalog is bundled.'
    $baseline = Get-Content -LiteralPath (Join-Path $actual.Destination 'SupportScripts/catalog-baseline.json') -Raw | ConvertFrom-Json
    $mismatches = @($baseline.files.PSObject.Properties | Where-Object {
        (Get-FileHash -LiteralPath (Join-Path $actual.Destination ($manifest.gitScriptsFolder + '/' + $_.Name)) -Algorithm SHA256).Hash -ine $_.Value
    })
    Assert ($mismatches.Count -eq 0 -and @($baseline.files.PSObject.Properties).Count -eq $actual.CatalogFiles) 'Every shipped catalog hash is current.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $actual.Destination 'Panels'))) 'No mutable panel state is staged.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $actual.Destination 'Windows Local Scripts'))) 'No installed owner state is staged.'
    $config = Get-Content -LiteralPath (Join-Path $sourceRoot 'FlowCellFrontend/src-tauri/tauri.installer.conf.json') -Raw | ConvertFrom-Json
    Assert ($config.bundle.resources.'../../dist/installer-resources/bundled-programs/Programs/' -ceq 'bundled-programs/') 'Tauri installs the catalog at bundled-programs/Windows.'

    $repository = Join-Path $fixtureRoot 'repo'
    $program = Join-Path $repository 'Programs/Windows'
    $fixtureManifest = @{schemaVersion=1;programId='windows';panelsFolder='Panels';localScriptsFolder='Windows Local Scripts';supportScriptsFolder='SupportScripts';gitScriptsFolder='Windows Git Scripts';bundledSources=@(@{sourcePath='Windows Git Scripts/fixture.ps1';importKind='script'})}
    Put (Join-Path $program 'flowcell.program.json') ($fixtureManifest | ConvertTo-Json -Depth 10)
    Put (Join-Path $program 'SupportScripts/catalog-baseline.json') '{}'
    Put (Join-Path $program 'Windows Git Scripts/fixture.ps1') 'throw "Catalog scripts must remain inert during staging."'
    & git -C $repository init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Fixture Git init failed.' }
    & git -C $repository add -- Programs/Windows
    if ($LASTEXITCODE -ne 0) { throw 'Fixture Git add failed.' }
    Put (Join-Path $program 'Panels/Startup/private.txt') 'private user data'
    Put (Join-Path $program 'Windows Local Scripts/private.ps1') 'private owner'
    Put (Join-Path $program 'Windows Git Scripts/untracked.ps1') 'private untracked script'
    $clean = Copy-InstallerWindowsProgram -RepositoryRoot $repository -DestinationRoot (Join-Path $fixtureRoot 'clean')
    Assert ($clean.Files -eq 3 -and $clean.CatalogFiles -eq 1) 'Only tracked package files are copied.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $clean.Destination 'Panels'))) 'Untracked private panels remain excluded.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $clean.Destination 'Windows Local Scripts'))) 'Untracked owners remain excluded.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $clean.Destination 'Windows Git Scripts/untracked.ps1'))) 'Untracked scripts remain excluded.'
    Expect-Rejection { Copy-InstallerWindowsProgram -RepositoryRoot $repository -DestinationRoot (Join-Path $fixtureRoot 'clean') } '*already exists*'
    foreach ($relative in @('Panels/Startup/private.txt', 'Windows Local Scripts/private.ps1', 'SupportScripts/runtime/status.json', 'SupportScripts/owner.flowcell-source.json', 'flowcell.install.json', 'Windows Git Scripts/private.log')) {
        Put (Join-Path $program $relative) 'private fixture'
        & git -C $repository add -f -- ('Programs/Windows/' + $relative)
        if ($LASTEXITCODE -ne 0) { throw 'Fixture Git add failed.' }
        $attempt = Join-Path $fixtureRoot ('rejected-' + $script:checks)
        $pattern = if ($relative -like 'Panels/*' -or $relative -like 'Windows Local Scripts/*') { '*state*' } else { '*Private/generated*' }
        Expect-Rejection { Copy-InstallerWindowsProgram -RepositoryRoot $repository -DestinationRoot $attempt } $pattern
        Assert (-not (Test-Path -LiteralPath $attempt)) 'Unsafe payload is rejected before staging.'
        & git -C $repository rm --cached -q -- ('Programs/Windows/' + $relative)
        if ($LASTEXITCODE -ne 0) { throw 'Fixture Git index cleanup failed.' }
    }
    [IO.File]::Delete((Join-Path $program 'Windows Git Scripts/fixture.ps1'))
    Expect-Rejection { Copy-InstallerWindowsProgram -RepositoryRoot $repository -DestinationRoot (Join-Path $fixtureRoot 'missing-source') } '*not found*'
    Write-Output "Installer Windows program tests: $script:checks passed. Real payload: $($actual.Files) files, $($actual.CatalogFiles) catalog hashes. No catalog scripts executed."
} finally {
    $resolved = [IO.Path]::GetFullPath($fixtureRoot)
    $temporary = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($temporary, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'FlowCell-installer-windows-tests-*') { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
