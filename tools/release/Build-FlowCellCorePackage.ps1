param(
    [string]$RepoRoot = (Get-Location).Path,
    [string]$OutputPath = (Join-Path (Get-Location).Path 'FlowCell-Core.zip')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = [System.IO.Path]::GetFullPath($RepoRoot)
$packagedApp = Join-Path $repo 'dist\FlowCell-Core'
$packagedExe = Join-Path $packagedApp 'FlowCell.exe'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('flowcell-core-package-' + [guid]::NewGuid().ToString('N'))
$coreRoot = Join-Path $stage 'FlowCell-Core'
$tempArchive = Join-Path ([System.IO.Path]::GetTempPath()) ('flowcell-core-package-' + [guid]::NewGuid().ToString('N') + '.zip')

if (-not (Test-Path -LiteralPath $packagedApp -PathType Container)) {
    throw "Packaged FlowCell Core app folder not found: $packagedApp"
}
if (-not (Test-Path -LiteralPath $packagedExe -PathType Leaf)) {
    throw "Packaged FlowCell Core launcher not found: $packagedExe"
}

try {
    New-Item -ItemType Directory -Path $coreRoot -Force | Out-Null

    foreach ($item in Get-ChildItem -LiteralPath $packagedApp -Force) {
        if ($item.Name -eq 'Programs') {
            continue
        }
        if ($item.Name -eq 'FlowCell-Core') {
            throw "Nested FlowCell-Core package folder is not allowed: $($item.FullName)"
        }
        Copy-Item -LiteralPath $item.FullName -Destination $coreRoot -Recurse -Force
    }

    $stagedExe = Join-Path $coreRoot 'FlowCell.exe'
    if (-not (Test-Path -LiteralPath $stagedExe -PathType Leaf)) {
        throw "Expected FlowCell Core launcher missing from package stage: $stagedExe"
    }

    $sourceExeHash = (Get-FileHash -LiteralPath $packagedExe -Algorithm SHA256).Hash
    $stagedExeHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash
    if ($sourceExeHash -cne $stagedExeHash) {
        throw 'The staged FlowCell.exe does not match dist\FlowCell-Core\FlowCell.exe.'
    }

    $forbiddenDirectory = Get-ChildItem -LiteralPath $coreRoot -Directory -Recurse -Force |
        Where-Object { $_.Name -in @('Programs', 'FlowCell-Core') } |
        Select-Object -First 1
    if ($forbiddenDirectory) {
        throw "Forbidden package directory detected: $($forbiddenDirectory.FullName)"
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stage,
        $tempArchive,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $archive = [System.IO.Compression.ZipFile]::OpenRead($tempArchive)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        if ($entries -cnotcontains 'FlowCell-Core/FlowCell.exe') {
            throw 'Expected ZIP entry missing: FlowCell-Core/FlowCell.exe'
        }
        $forbiddenEntry = $entries |
            Where-Object { $_ -match '(^|/)Programs(/|$)' -or $_ -match '^FlowCell-Core/FlowCell-Core(/|$)' } |
            Select-Object -First 1
        if ($forbiddenEntry) {
            throw "Forbidden ZIP entry detected: $forbiddenEntry"
        }
    }
    finally {
        $archive.Dispose()
    }

    $out = [System.IO.Path]::GetFullPath($OutputPath)
    $outParent = Split-Path -Parent $out
    if ($outParent) {
        New-Item -ItemType Directory -Path $outParent -Force | Out-Null
    }
    if (Test-Path -LiteralPath $out) {
        Add-Type -AssemblyName Microsoft.VisualBasic
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
            $out,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
    }
    Move-Item -LiteralPath $tempArchive -Destination $out

    Write-Host "Built package: $out"
    Write-Host "FlowCell.exe SHA256: $sourceExeHash"
    Write-Host 'ZIP launcher: FlowCell-Core/FlowCell.exe'
    Write-Host 'No Programs folder is included in this ZIP.'
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tempArchive -Force -ErrorAction SilentlyContinue
}
