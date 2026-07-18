[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$preflight = Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-FlowCellPreflight.ps1'
. $preflight -DefinitionsOnly

$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("flowcell-preflight-paths-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $resolved = Resolve-ManifestRelativePath -Root $testRoot -Value 'SupportScripts\.\Adapters' -Field 'supportScriptsFolder'
    $expected = [System.IO.Path]::GetFullPath((Join-Path $testRoot 'SupportScripts\Adapters'))
    if (-not $resolved.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Relative manifest path was not normalized. Expected '$expected', received '$resolved'."
    }

    foreach ($invalid in @('..\outside', 'inside\..\outside', 'C:\outside', '\\server\share')) {
        $rejected = $false
        try {
            $null = Resolve-ManifestRelativePath -Root $testRoot -Value $invalid -Field 'testPath'
        }
        catch {
            $rejected = $true
        }
        if (-not $rejected) {
            throw "Unsafe manifest path was accepted: $invalid"
        }
    }

    $empty = Resolve-ManifestRelativePath -Root $testRoot -Value '' -Field 'runner.installScript' -AllowEmpty
    if ($empty -ne '') {
        throw 'Optional empty runner path was not preserved.'
    }

    $ProgramsRoot = Join-Path $testRoot 'Programs'
    $LocalRoot = Join-Path $testRoot 'local'
    $LogRoot = Join-Path $LocalRoot 'logs'
    $LogPath = Join-Path $LogRoot 'startup-preflight.log'
    $BindingsPath = Join-Path $LocalRoot 'bindings.ini'
    $unusedProgramRoot = Join-Path $ProgramsRoot 'Unused'
    New-Item -ItemType Directory -Path $unusedProgramRoot -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $unusedProgramRoot 'flowcell.program.json') -Value '{ invalid json' -Encoding UTF8

    Ensure-ManifestProgramStructure

    $bindingsCutBackup = Join-Path $LocalRoot '.bindings.ini.test.backup'
    $bindingsCutStage = Join-Path $LocalRoot '.bindings.ini.test.writing'
    [System.IO.File]::Move($BindingsPath, $bindingsCutBackup)
    [System.IO.File]::WriteAllText($bindingsCutStage, '[Meta]')
    Ensure-ManifestProgramStructure
    if (-not (Test-Path -LiteralPath $BindingsPath -PathType Leaf)) {
        throw 'Preflight did not recover bindings from an interrupted atomic replacement.'
    }

    New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
    @'
[Meta]
ProgramTabIds=1
SelectedProgramTabId=1

[ProgramTab_1]
Label=Unused
'@ | Set-Content -LiteralPath $BindingsPath -Encoding UTF8

    $registeredInvalidRejected = $false
    try {
        Ensure-ManifestProgramStructure
    }
    catch {
        $registeredInvalidRejected = $true
    }
    if (-not $registeredInvalidRejected) {
        throw 'Registered malformed program package was not rejected.'
    }

    $bindingsBeforePendingRename = [System.IO.File]::ReadAllBytes($BindingsPath)
    $pendingRenameRoot = Join-Path $LocalRoot 'program-rename-transactions\rename-test'
    New-Item -ItemType Directory -Path $pendingRenameRoot -Force | Out-Null
    Ensure-ManifestProgramStructure
    $bindingsAfterPendingRename = [System.IO.File]::ReadAllBytes($BindingsPath)
    if ([Convert]::ToBase64String($bindingsBeforePendingRename) -ne [Convert]::ToBase64String($bindingsAfterPendingRename)) {
        throw 'Preflight mutated bindings while a program rename transaction was pending.'
    }
    Remove-Item -LiteralPath (Join-Path $LocalRoot 'program-rename-transactions') -Recurse -Force

    Remove-Item -LiteralPath $ProgramsRoot -Recurse -Force
    $registeredProgramRoot = Join-Path $ProgramsRoot 'Registered'
    New-Item -ItemType Directory -Path $registeredProgramRoot -Force | Out-Null
    @'
[Meta]
ProgramTabIds=1
SelectedProgramTabId=1

[ProgramTab_1]
Label=Registered
'@ | Set-Content -LiteralPath $BindingsPath -Encoding UTF8

    function Write-RegisteredTestManifest {
        param([string]$InstallScript = '')

        $manifest = [ordered]@{
            schemaVersion = 1
            programId = 'registered'
            label = 'Registered'
            programType = 'local-script'
            defaultPanels = @('Tools')
            processNames = @('registered')
            gitScriptsFolder = 'Registered Git Scripts'
            panelsFolder = 'Panels'
            localScriptsFolder = 'Registered Local Scripts'
            supportScriptsFolder = 'SupportScripts'
            allowedScriptExtensions = @('ps1')
            runner = [ordered]@{
                kind = 'windows-script'
                programKey = 'registered'
                installScript = $InstallScript
                deleteScript = ''
                capabilityScript = ''
            }
        }
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $registeredProgramRoot 'flowcell.program.json') -Encoding UTF8
    }

    function Assert-RegisteredPreflightRejected {
        param([string]$ExpectedMessage)

        $rejected = $false
        try {
            Ensure-ManifestProgramStructure
        }
        catch {
            $rejected = $true
            if (-not $_.Exception.Message.Contains($ExpectedMessage)) {
                throw
            }
        }
        if (-not $rejected) {
            throw "Registered package unexpectedly passed preflight; expected: $ExpectedMessage"
        }
    }

    Write-RegisteredTestManifest
    New-Item -ItemType Directory -Path (Join-Path $registeredProgramRoot 'SupportScripts') -Force | Out-Null
    Assert-RegisteredPreflightRejected 'gitScriptsFolder'

    New-Item -ItemType Directory -Path (Join-Path $registeredProgramRoot 'Registered Git Scripts') -Force | Out-Null
    Remove-Item -LiteralPath (Join-Path $registeredProgramRoot 'SupportScripts') -Recurse -Force
    Assert-RegisteredPreflightRejected 'supportScriptsFolder'

    New-Item -ItemType Directory -Path (Join-Path $registeredProgramRoot 'SupportScripts') -Force | Out-Null
    Write-RegisteredTestManifest -InstallScript 'Install-Registered.ps1'
    Assert-RegisteredPreflightRejected 'runner.installScript'

    Set-Content -LiteralPath (Join-Path $registeredProgramRoot 'SupportScripts\Install-Registered.ps1') -Value '# test adapter' -Encoding UTF8
    Ensure-ManifestProgramStructure
    foreach ($createdFolder in @('Panels', 'Registered Local Scripts')) {
        if (-not (Test-Path -LiteralPath (Join-Path $registeredProgramRoot $createdFolder) -PathType Container)) {
            throw "Registered preflight did not create mutable folder: $createdFolder"
        }
    }
}
finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}

Write-Output 'FlowCell preflight manifest path tests passed.'
