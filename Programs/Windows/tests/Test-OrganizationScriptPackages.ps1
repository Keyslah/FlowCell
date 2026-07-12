$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$filesRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts\Files'
$packages = [ordered]@{
    'Organize Folder' = @(
        'flowcell.script.json',
        'organize_folder.ps1',
        'Organize-FolderCore.ps1'
    )
    'New Organization' = @(
        'flowcell.script.json',
        'new_organization.ps1',
        'Organization-ProfileCore.ps1'
    )
    'Apply Profile Default' = @(
        'flowcell.script.json',
        'apply_profile_default.ps1',
        'Apply-OrganizationProfileCore.ps1'
    )
    'Apply Profile Project Tree' = @(
        'flowcell.script.json',
        'apply_profile_project_tree.ps1',
        'Apply-OrganizationProfileCore.ps1'
    )
    'Dynamic Organization' = @(
        'flowcell.script.json',
        'dynamic_organization.ps1',
        'Dynamic-OrganizationCore.ps1',
        'Apply-OrganizationProfileCore.ps1'
    )
    'New Organization Profile Template' = @(
        'flowcell.script.json',
        'new_organization_profile_template.ps1',
        'new_organization.ps1',
        'Organization-ProfileCore.ps1'
    )
}

foreach ($packageName in $packages.Keys) {
    $packagePath = Join-Path $filesRoot $packageName
    if (-not (Test-Path -LiteralPath $packagePath -PathType Container)) {
        throw "Organization catalog package is missing: $packagePath"
    }

    $expected = @($packages[$packageName] | Sort-Object)
    $actual = @(
        Get-ChildItem -LiteralPath $packagePath -File -Force |
            ForEach-Object Name |
            Sort-Object
    )
    if (($expected -join "`n") -cne ($actual -join "`n")) {
        throw "Package '$packageName' is not a closed source graph. Expected [$($expected -join ', ')], found [$($actual -join ', ')]."
    }

    $manifestPath = Join-Path $packagePath 'flowcell.script.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace([string]$manifest.source)) {
        throw "Package '$packageName' has an invalid flowcell.script.json."
    }
    $sourcePath = Join-Path $packagePath ([string]$manifest.source)
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Package '$packageName' manifest source is missing: $sourcePath"
    }

    foreach ($scriptFile in Get-ChildItem -LiteralPath $packagePath -File -Filter '*.ps1') {
        $tokens = $null
        $errors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile(
            $scriptFile.FullName,
            [ref]$tokens,
            [ref]$errors
        )
        if (@($errors).Count -gt 0) {
            throw "PowerShell parse failed for $($scriptFile.FullName): $($errors[0].Message)"
        }

        $source = Get-Content -LiteralPath $scriptFile.FullName -Raw -Encoding UTF8
        if ($source -match '(?i)Programs[\\/]Windows[\\/]SupportScripts') {
            throw "Package '$packageName' reaches back into mutable repo SupportScripts: $($scriptFile.Name)"
        }
    }
}

$legacyFlatSources = @(
    'organize_folder.ps1',
    'new_organization.ps1',
    'apply_profile_default.ps1',
    'apply_profile_project_tree.ps1',
    'dynamic_organization.ps1',
    'new_organization_profile_template.ps1'
)
foreach ($legacyName in $legacyFlatSources) {
    $legacyPath = Join-Path $filesRoot $legacyName
    if (Test-Path -LiteralPath $legacyPath) {
        throw "Legacy flat organization catalog source still exists: $legacyPath"
    }
}

"Organization script packages validated: $($packages.Count)"
