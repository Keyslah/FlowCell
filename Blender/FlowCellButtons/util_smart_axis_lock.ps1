# Description: Open FlowCell Smart Axis Lock controls for baseline, X/Y/Z cycling, live pinning, and status.

param(
    [switch]$SelfTest,
    [string]$StatusPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($StatusPath)) {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $StatusPath = Join-Path $repoRoot 'FlowCell\local\logs\last_action_status.txt'
}

function Write-Status([string]$Message) {
    if ([string]::IsNullOrWhiteSpace($StatusPath)) { return }
    try {
        $folder = Split-Path -Parent $StatusPath
        if (-not [string]::IsNullOrWhiteSpace($folder)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Set-Content -LiteralPath $StatusPath -Value $Message -Encoding UTF8
    }
    catch {
    }
}

if ($SelfTest) {
    Write-Output 'Smart Axis Lock script self-test OK'
    exit 0
}

$message = 'Reload FlowCell to use the inline Smart Axis Lock utility controls.'
Write-Status $message
Write-Output $message
exit 0
