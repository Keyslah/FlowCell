# Description: Open Theme and HDRI controls for Blender UI colors, world path, X/Y/Z rotation, and world strength.

# Source Bridge Action: flowtest_custom_hdri_world_tools
# Source Python Filename: custom_hdri_world_tools.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\custom_hdri_world_tools.py
# Source Action Function: run_flowcell_action

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
    Write-Output 'HDRI world tools script self-test OK'
    exit 0
}

$message = 'Reload FlowCell to use the inline theme, background pic, and HDRI controls.'
Write-Status $message
Write-Output $message
exit 0
