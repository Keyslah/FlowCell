<#
Purpose: Verify the actual release entry points require the current Blender theme library before building or publishing.
Writes: One disposable Git fixture and captured child-process logs. No app build or release ZIP.
Deletion: Only the unique temporary fixture is removed after checking its absolute boundary.
#>
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$fixtureRoot = Join-Path $temporaryParent ('FlowCell-theme-preflight-tests-' + [guid]::NewGuid().ToString('N'))
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
function Invoke-ReleasePreflight([string]$Driver, [string]$Scenario) {
    $output = Join-Path $fixtureRoot ($Scenario + '-' + $Driver + '-output')
    $driverPath = Join-Path $fixtureRelease $Driver
    $process = New-Object Diagnostics.Process
    $process.StartInfo.FileName = 'powershell.exe'
    $process.StartInfo.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $driverPath + '" -OutputDirectory "' + $output + '"'
    if ($Driver -eq 'package-portable.ps1') { $process.StartInfo.Arguments += ' -ProgramsOnly' }
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $log = $stdout + [Environment]::NewLine + $stderr
        Put (Join-Path $fixtureRoot ($Scenario + '-' + $Driver + '.log')) $log
        Assert ($process.ExitCode -ne 0) "$Scenario/$Driver rejects the unavailable source"
        Assert ($log -match 'Blender theme') "$Scenario/$Driver identifies the theme-library problem"
        Assert (-not (Test-Path -LiteralPath $output)) "$Scenario/$Driver creates no release output"
        Assert (-not (Test-Path -LiteralPath (Join-Path $fixtureRelease 'prepare-reached.txt'))) "$Scenario/$Driver does not start installer preparation"
        Assert (-not (Test-Path -LiteralPath (Join-Path $fixtureRelease 'updater-reached.txt'))) "$Scenario/$Driver does not start catalog preparation"
    } finally {
        $process.Dispose()
    }
}

try {
    [IO.Directory]::CreateDirectory($fixtureRelease) | Out-Null
    foreach ($name in @('build-installer.ps1', 'package-portable.ps1', 'program-package-safety.ps1', 'blender-theme-packages.ps1')) {
        Copy-Item -LiteralPath (Join-Path $releaseRoot $name) -Destination (Join-Path $fixtureRelease $name)
    }
    Put (Join-Path $fixtureRelease 'prepare-installer.ps1') @'
param([string]$AutoHotkeyExe, [string]$AutoHotkeyLicenseFile)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'prepare-reached.txt'), 'unexpected')
throw 'Installer preparation must not run without the current themes library.'
'@
    Put (Join-Path $fixtureRelease 'add-catalog-updaters.mjs') @'
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./updater-reached.txt', import.meta.url), 'unexpected');
throw new Error('Catalog preparation must not run without the current themes library.');
'@
    Put (Join-Path $repo 'Programs/Blender/flowcell.program.json') @'
{"schemaVersion":1,"programId":"blender","label":"Blender","panelsFolder":"Panels","localScriptsFolder":"Blender Local Scripts"}
'@
    # A stale duplicate must never rescue a missing authoritative library.
    Put (Join-Path $repo 'Programs/Blender/blender themes/Packages/Old/Old.flowcell-theme-pack.json') @'
{"format":"flowcell-tool-package/blender-theme/v1","name":"Old","assets":{"theme_image_path":"old.png"},"values":{"theme_image_path":"old.png"}}
'@
    Put (Join-Path $repo 'Programs/Blender/blender themes/Packages/Old/old.png') 'stale image'
    & git -C $repo init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the disposable Git fixture.' }
    & git -C $repo add -- 'Programs/Blender/flowcell.program.json'
    if ($LASTEXITCODE -ne 0) { throw 'Could not track the disposable Blender manifest.' }

    foreach ($driver in @('package-portable.ps1', 'build-installer.ps1')) {
        Invoke-ReleasePreflight $driver 'unconfigured'
    }
    $config = @{ blenderThemeLibrary = (Join-Path $fixtureRoot 'missing-current-themes') } | ConvertTo-Json
    Put (Join-Path $repo 'flowcellbackend/local/program-package-sources.json') $config
    foreach ($driver in @('package-portable.ps1', 'build-installer.ps1')) {
        Invoke-ReleasePreflight $driver 'missing-configured-folder'
    }
    Assert (@(Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File -Filter '*.zip').Count -eq 0) 'neither release entry point creates a ZIP without the source library'
    Write-Output "PASS: $($script:checks) release-entry preflight assertions; both real drivers stop before build/output when the current themes folder is unavailable. No release ZIP created."
} finally {
    $cleanupRoot = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\', '/')
    if (-not $cleanupRoot.StartsWith(($temporaryParent + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($cleanupRoot) -notmatch '^FlowCell-theme-preflight-tests-[0-9a-f]{32}$') {
        throw "Refusing cleanup outside the test fixture: $cleanupRoot"
    }
    if (Test-Path -LiteralPath $cleanupRoot) { Remove-Item -LiteralPath $cleanupRoot -Recurse -Force }
}
