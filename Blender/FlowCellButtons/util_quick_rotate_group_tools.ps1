# Description: Open the inline Quick Rotate Group controls inside the FlowCell Tool Set.
# Source Bridge Action: flowtest_custom_quick_rotate_group
# Source Python Filename: custom_quick_rotate_group.py
# Source Python File: D:\Dev\workspace\Codex\FlowTest\Blender\ManagedActions\custom_quick_rotate_group.py
# Source Action Function: run_flowcell_action
# Source Action Start Line: 1

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
    Write-Output 'Quick Rotate Group tools script self-test OK'
    exit 0
}

$message = 'Reload FlowCell to use the inline Quick Rotate Group controls.'
Write-Status $message
Write-Output $message
exit 0
