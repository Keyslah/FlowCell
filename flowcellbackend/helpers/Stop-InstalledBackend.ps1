<#
Purpose: Release this installation's bundled runtime before NSIS upgrades/uninstalls it.
Context: Invoked by NSIS with its exact ResourceRoot; no other backend is targeted.
Inputs: ResourceRoot. Changes: Stops matching headless backend processes only.
Deletion/conflicts: No files or user state removed. Unrelated processes are preserved.
Constraints: Requires an installed marker and exact executable/script path ownership.
#>
param([Parameter(Mandatory=$true)][string]$ResourceRoot)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($ResourceRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'flowcell-installed.json'))) { throw 'Not an installed FlowCell resource root.' }
$runtime=Join-Path $root 'flowcellbackend\runtime\AutoHotkey64.exe'
$backend=Join-Path $root 'flowcellbackend\FlowCellBackend.ahk'
Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe'" | Where-Object {
    $_.ExecutablePath -eq $runtime -and $_.CommandLine.Contains($backend) -and $_.CommandLine.Contains('--headless')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
