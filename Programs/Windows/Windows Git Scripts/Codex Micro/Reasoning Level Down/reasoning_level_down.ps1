# Description: Decrease the current Codex composer reasoning level by one step.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CodexMicroAction = 'ReasoningLevelDown'

. (Join-Path $PSScriptRoot 'CodexMicroHelpers.ps1')

Invoke-CodexMicroAction -Action $CodexMicroAction
