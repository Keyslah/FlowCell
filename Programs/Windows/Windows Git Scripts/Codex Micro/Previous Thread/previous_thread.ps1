# Description: Navigate to the previous Codex task.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CodexMicroAction = 'PreviousThread'

. (Join-Path $PSScriptRoot 'CodexMicroHelpers.ps1')

Invoke-CodexMicroAction -Action $CodexMicroAction
