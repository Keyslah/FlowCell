<#
Purpose: Resolve FlowCell resource and writable roots consistently for backend helpers.
Context: Dot-source from the shipped backend; no working-directory or checkout dependency.
Inputs: FLOWCELL_LOCAL_ROOT (direct override), installed marker beside the application.
Changes: Process environment only; no migration, deletion, copying, or user-state writes.
Constraints: Development/portable defaults remain beside their own backend.
#>
$FlowCellResourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FlowCellInstalled = Test-Path -LiteralPath (Join-Path $FlowCellResourceRoot 'flowcell-installed.json') -PathType Leaf
$FlowCellConfiguredLocalRoot = $null
$FlowCellRuntimeConfig = Join-Path $FlowCellResourceRoot 'flowcell.runtime.json'
if ($FlowCellInstalled -and -not $env:FLOWCELL_LOCAL_ROOT -and (Test-Path -LiteralPath $FlowCellRuntimeConfig -PathType Leaf)) {
    $FlowCellRuntimeSettings = Get-Content -LiteralPath $FlowCellRuntimeConfig -Raw | ConvertFrom-Json
    $FlowCellConfiguredLocalRoot = [string]$FlowCellRuntimeSettings.localRoot
    if ([string]::IsNullOrWhiteSpace($FlowCellConfiguredLocalRoot) -or -not [IO.Path]::IsPathRooted($FlowCellConfiguredLocalRoot)) {
        throw 'flowcell.runtime.json requires an absolute localRoot.'
    }
}
$FlowCellLocalRoot = if ($env:FLOWCELL_LOCAL_ROOT) {
    [System.IO.Path]::GetFullPath($env:FLOWCELL_LOCAL_ROOT)
} elseif ($FlowCellConfiguredLocalRoot) {
    $FlowCellConfiguredLocalRoot
} elseif ($FlowCellInstalled) {
    Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FlowCell\local'
} else {
    Join-Path $FlowCellResourceRoot 'flowcellbackend\local'
}
$FlowCellProgramsRoot = if ($env:FLOWCELL_PROGRAMS_ROOT) {
    $env:FLOWCELL_PROGRAMS_ROOT
} elseif ($FlowCellInstalled -or $env:FLOWCELL_LOCAL_ROOT) {
    Join-Path $FlowCellLocalRoot 'Programs'
} else {
    Join-Path $FlowCellResourceRoot 'Programs'
}
$env:FLOWCELL_LOCAL_ROOT = $FlowCellLocalRoot
$env:FLOWCELL_PROGRAMS_ROOT = $FlowCellProgramsRoot
$env:FLOWCELL_RESOURCE_ROOT = $FlowCellResourceRoot
