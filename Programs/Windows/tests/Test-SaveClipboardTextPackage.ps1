$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$packageRoot = Join-Path (
    Split-Path -Parent $PSScriptRoot
) 'Windows Git Scripts\Files\Save Clipboard Text'
$manifestPath = Join-Path $packageRoot 'flowcell.script.json'
$sourcePath = Join-Path $packageRoot 'save_clipboard_text.ps1'

$expectedPackageFiles = @(
    'README.md',
    'flowcell.script.json',
    'save_clipboard_text.ps1'
) | Sort-Object
$actualPackageFiles = @(
    Get-ChildItem -LiteralPath $packageRoot -File -Force |
        ForEach-Object Name |
        Sort-Object
)
if (($expectedPackageFiles -join "`n") -cne ($actualPackageFiles -join "`n")) {
    throw "Save Clipboard Text is not a closed package. Found [$($actualPackageFiles -join ', ')]."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or
    $manifest.id -ne 'windows.save-clipboard-text' -or
    $manifest.program -ne 'Windows' -or
    $manifest.source -ne 'save_clipboard_text.ps1') {
    throw 'Save Clipboard Text has an invalid flowcell.script.json.'
}

$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $sourcePath,
    [ref]$tokens,
    [ref]$parseErrors
)
if (@($parseErrors).Count -gt 0) {
    throw "PowerShell parse failed: $($parseErrors[0].Message)"
}

function Invoke-OwnerIsolationProbe {
    param(
        [Parameter(Mandatory = $true)][string]$InstalledScriptPath,
        [Parameter(Mandatory = $true)][string]$ExpectedSettingsDirectory,
        [Parameter(Mandatory = $true)][string]$DestinationFolder
    )

    $env:FLOWCELL_CLIPBOARD_TEST_SCRIPT = $InstalledScriptPath
    $env:FLOWCELL_CLIPBOARD_TEST_SETTINGS = $ExpectedSettingsDirectory
    $env:FLOWCELL_CLIPBOARD_TEST_DESTINATION = $DestinationFolder
    try {
        $probe = @'
$ErrorActionPreference = 'Stop'
. $env:FLOWCELL_CLIPBOARD_TEST_SCRIPT -ValidateOnly
$settingsDirectory = Get-SettingsDirectory
if ([System.IO.Path]::GetFullPath($settingsDirectory) -cne
    [System.IO.Path]::GetFullPath($env:FLOWCELL_CLIPBOARD_TEST_SETTINGS)) {
    throw "Unexpected settings directory: $settingsDirectory"
}
$settingsPath = Join-Path $settingsDirectory 'save-clipboard-text.json'
Save-DestinationFolder `
    -SettingsDirectory $settingsDirectory `
    -SettingsPath $settingsPath `
    -DestinationFolder $env:FLOWCELL_CLIPBOARD_TEST_DESTINATION
$saved = Get-SavedDestinationFolder -SettingsPath $settingsPath
if ([System.IO.Path]::GetFullPath($saved) -cne
    [System.IO.Path]::GetFullPath($env:FLOWCELL_CLIPBOARD_TEST_DESTINATION)) {
    throw "Unexpected saved destination: $saved"
}
'Owner isolation probe passed.'
'@
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
        $output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
            -NoProfile `
            -STA `
            -ExecutionPolicy Bypass `
            -EncodedCommand $encoded 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Owner isolation probe failed: $($output -join [Environment]::NewLine)"
        }
    }
    finally {
        Remove-Item Env:FLOWCELL_CLIPBOARD_TEST_SCRIPT -ErrorAction SilentlyContinue
        Remove-Item Env:FLOWCELL_CLIPBOARD_TEST_SETTINGS -ErrorAction SilentlyContinue
        Remove-Item Env:FLOWCELL_CLIPBOARD_TEST_DESTINATION -ErrorAction SilentlyContinue
    }
}

$testRoot = Join-Path (
    [System.IO.Path]::GetTempPath()
) ('flowcell-save-clipboard-owner-isolation-' + [guid]::NewGuid().ToString('N'))
try {
    $owners = @(
        [pscustomobject]@{
            Name = 'button-owner-a'
            Destination = Join-Path $testRoot 'destinations\alpha'
        },
        [pscustomobject]@{
            Name = 'button-owner-b'
            Destination = Join-Path $testRoot 'destinations\beta'
        }
    )

    foreach ($owner in $owners) {
        $ownerRoot = Join-Path $testRoot $owner.Name
        $ownerSource = Join-Path $ownerRoot 'source'
        [void][System.IO.Directory]::CreateDirectory($ownerSource)
        [void][System.IO.Directory]::CreateDirectory($owner.Destination)
        Copy-Item -LiteralPath $sourcePath -Destination (
            Join-Path $ownerSource 'save_clipboard_text.ps1'
        )
        [System.IO.File]::WriteAllText(
            (Join-Path $ownerRoot 'flowcell.install.json'),
            '{}',
            (New-Object System.Text.UTF8Encoding $false)
        )

        Invoke-OwnerIsolationProbe `
            -InstalledScriptPath (Join-Path $ownerSource 'save_clipboard_text.ps1') `
            -ExpectedSettingsDirectory (Join-Path $ownerRoot 'runtime') `
            -DestinationFolder $owner.Destination
    }

    $settingsA = Get-Content -LiteralPath (
        Join-Path $testRoot 'button-owner-a\runtime\save-clipboard-text.json'
    ) -Raw -Encoding UTF8 | ConvertFrom-Json
    $settingsB = Get-Content -LiteralPath (
        Join-Path $testRoot 'button-owner-b\runtime\save-clipboard-text.json'
    ) -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($settingsA.destinationFolder -eq $settingsB.destinationFolder) {
        throw 'Two installed Button owners unexpectedly share one destination.'
    }
}
finally {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

'Save Clipboard Text package validated: two Button owners keep independent destinations.'
