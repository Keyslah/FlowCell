<#
Purpose: Verify backend installed/development/override root selection in temporary fixtures.
Context: Windows PowerShell; no app launch or actual user state. Inputs: tracked path helper.
Writes: Temporary simulated resource roots with spaces. No deletion of existing content.
Constraints: Environment restored; no registration, copying of programs, or host changes.
#>
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'flowcellbackend/helpers/FlowCellPaths.ps1'
$root=Join-Path ([IO.Path]::GetTempPath()) ('FlowCell path tests '+[guid]::NewGuid().ToString('N'))
$helper=Join-Path $root 'flowcellbackend/helpers/FlowCellPaths.ps1'
[IO.Directory]::CreateDirectory((Split-Path -Parent $helper))|Out-Null
Copy-Item -LiteralPath $source -Destination $helper
$saved=@{}
foreach($key in @('FLOWCELL_LOCAL_ROOT','FLOWCELL_PROGRAMS_ROOT','FLOWCELL_RESOURCE_ROOT')){$saved[$key]=[Environment]::GetEnvironmentVariable($key);[Environment]::SetEnvironmentVariable($key,$null)}
try {
    . $helper
    if($FlowCellLocalRoot -ne (Join-Path $root 'flowcellbackend/local') -or $FlowCellProgramsRoot -ne (Join-Path $root 'Programs')){throw 'Development defaults changed.'}
    . $helper
    if($FlowCellProgramsRoot -ne (Join-Path $root 'Programs')){throw 'Repeated preflight relocated development Programs.'}
    $env:FLOWCELL_LOCAL_ROOT='';$env:FLOWCELL_PROGRAMS_ROOT=''
    '{}'|Set-Content -LiteralPath (Join-Path $root 'flowcell-installed.json')
    . $helper
    if($FlowCellLocalRoot -ne (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FlowCell/local')){throw 'Installed AppData path incorrect.'}
    if($FlowCellProgramsRoot -ne (Join-Path $FlowCellLocalRoot 'Programs')){throw 'Installed Programs path incorrect.'}
    $override=Join-Path $root 'Explicit User Data'
    $env:FLOWCELL_LOCAL_ROOT=$override;$env:FLOWCELL_PROGRAMS_ROOT=''
    . $helper
    if($FlowCellLocalRoot -ne $override -or $FlowCellProgramsRoot -ne (Join-Path $override 'Programs')){throw 'Explicit local root was not used directly.'}
    Write-Output 'PASS: development, installed AppData, and direct local override path checks.'
} finally {foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key])}}
