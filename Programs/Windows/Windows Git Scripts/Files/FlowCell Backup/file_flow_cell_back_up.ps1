param(
    [switch]$BackgroundWorker
)

# Description: Trigger a background FlowCell back up with the minimum non-repo program support files.
$scriptRoot = Split-Path -Parent $PSCommandPath
$enginePath = Join-Path $scriptRoot 'file_github_back_up.ps1'

& $enginePath -BackgroundWorker:$BackgroundWorker -BackupFlavor FlowCell
exit $LASTEXITCODE
