param(
    [string]$RepoRoot = (Get-Location).Path,
    [string]$OutputPath = (Join-Path (Get-Location).Path 'FlowCell-Core.zip')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = [System.IO.Path]::GetFullPath($RepoRoot)
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('flowcell-core-package-' + [guid]::NewGuid().ToString('N'))
$coreRoot = Join-Path $stage 'FlowCell-Core'

New-Item -ItemType Directory -Path $coreRoot -Force | Out-Null

$coreDirs = @('FlowCell', 'FlowCellFrontend', 'docs')
foreach ($dir in $coreDirs) {
    $src = Join-Path $repo $dir
    if (Test-Path -LiteralPath $src -PathType Container) {
        Copy-Item -LiteralPath $src -Destination $coreRoot -Recurse -Force
    }
}

$coreFiles = @('README.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PROGRAM_SUMMARY.txt', '.gitattributes')
foreach ($file in $coreFiles) {
    $src = Join-Path $repo $file
    if (Test-Path -LiteralPath $src -PathType Leaf) {
        Copy-Item -LiteralPath $src -Destination $coreRoot -Force
    }
}

$badPaths = @(
    (Join-Path $stage 'Programs'),
    (Join-Path $coreRoot 'Programs'),
    (Join-Path $coreRoot 'FlowCell-Core')
)
foreach ($bad in $badPaths) {
    if (Test-Path -LiteralPath $bad) {
        throw "Bad FlowCell-Core package layout detected: $bad"
    }
}

$expected = @(
    (Join-Path $coreRoot 'FlowCell'),
    (Join-Path $coreRoot 'FlowCellFrontend')
)
foreach ($path in $expected) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Expected FlowCell-Core package path missing: $path"
    }
}

$out = [System.IO.Path]::GetFullPath($OutputPath)
$outParent = Split-Path -Parent $out
if ($outParent) {
    New-Item -ItemType Directory -Path $outParent -Force | Out-Null
}
Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $coreRoot -DestinationPath $out -Force

Write-Host "Built package: $out"
Write-Host 'Expected ZIP root layout:'
Write-Host '  FlowCell-Core/'
Write-Host 'No Programs folder is included in this ZIP.'
