param(
    [switch]$BackgroundWorker,
    [switch]$ConfigureOnly
)

# Description: With your FlowCell project's folder path on the clipboard, click to save a dated copy along with the Blender bridge and its action scripts. If you haven't chosen a backup location yet, FlowCell asks where to save it.
$scriptRoot = Split-Path -Parent $PSCommandPath
$enginePath = Join-Path $scriptRoot 'file_github_back_up.ps1'

& $enginePath -BackgroundWorker:$BackgroundWorker -ConfigureOnly:$ConfigureOnly -BackupFlavor FlowCell
exit $LASTEXITCODE
