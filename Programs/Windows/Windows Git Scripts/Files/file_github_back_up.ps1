# Description: Compatibility launcher for the packaged GitHub Back Up button.
param([switch]$BackgroundWorker, [switch]$ConfigureOnly,
    [ValidateSet('GitHub', 'FlowCell')][string]$BackupFlavor = 'GitHub')
$ErrorActionPreference = 'Stop'
$engine = Join-Path $PSScriptRoot 'GitHub Backup/file_github_back_up.ps1'
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) {
    $current = [IO.DirectoryInfo]::new($PSScriptRoot)
    while ($current) {
        $candidate = Join-Path $current.FullName 'Windows Git Scripts/Files/GitHub Backup/file_github_back_up.ps1'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $engine = $candidate; break }
        $current = $current.Parent
    }
}
if (-not (Test-Path -LiteralPath $engine -PathType Leaf)) {
    throw 'Add or update this Button from Windows Git Scripts/Files/GitHub Backup.'
}
& $engine -BackgroundWorker:$BackgroundWorker -ConfigureOnly:$ConfigureOnly -BackupFlavor $BackupFlavor
exit $LASTEXITCODE
