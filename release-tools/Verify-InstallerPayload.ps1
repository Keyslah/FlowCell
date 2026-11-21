<# Compare installed critical executables with this installer's embedded bytes.
   Invoked before installer registration; performs no writes to installed data. #>
param(
    [Parameter(Mandatory=$true)][string]$ResourceRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedFrontend,
    [Parameter(Mandatory=$true)][string]$ExpectedRuntime
)
$ErrorActionPreference = 'Stop'
function Get-FlowCellFileHash([string]$Path) {
    # NSIS can launch 32-bit Windows PowerShell without the module that exports
    # Get-FileHash. .NET is available in both installer PowerShell hosts.
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [IO.File]::OpenRead($Path)
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '')
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        $algorithm.Dispose()
    }
}
$pairs = @(
    @{ Name = 'FlowCell frontend'; Expected = $ExpectedFrontend; Actual = (Join-Path $ResourceRoot 'flowcell_frontend.exe') },
    @{ Name = 'AutoHotkey runtime'; Expected = $ExpectedRuntime; Actual = (Join-Path $ResourceRoot 'flowcellbackend\runtime\AutoHotkey64.exe') }
)
foreach ($pair in $pairs) {
    if (-not (Test-Path -LiteralPath $pair.Expected -PathType Leaf) -or
        -not (Test-Path -LiteralPath $pair.Actual -PathType Leaf)) {
        throw "$($pair.Name) verification failed: an expected or installed file is missing."
    }
    $expectedHash = Get-FlowCellFileHash -Path $pair.Expected
    $actualHash = Get-FlowCellFileHash -Path $pair.Actual
    if ($expectedHash -ne $actualHash) {
        throw "$($pair.Name) verification failed: installed bytes do not match the installer."
    }
    Write-Output "$($pair.Name) verified."
}
