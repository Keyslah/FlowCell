# Description: Navigate to the next Codex task.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CodexMicroAction = 'NextThread'

. (Join-Path $PSScriptRoot 'CodexMicroHelpers.ps1')

Invoke-CodexMicroAction -Action $CodexMicroAction
