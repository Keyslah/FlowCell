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
foreach($key in @('FLOWCELL_LOCAL_ROOT','FLOWCELL_PROGRAMS_ROOT','FLOWCELL_RESOURCE_ROOT','FLOWCELL_BACKEND_ROLE')){$saved[$key]=[Environment]::GetEnvironmentVariable($key);[Environment]::SetEnvironmentVariable($key,$null)}
try {
    . $helper
    if($FlowCellLocalRoot -ne (Join-Path $root 'flowcellbackend/local') -or $FlowCellProgramsRoot -ne (Join-Path $root 'Programs')){throw 'Development defaults changed.'}
    . $helper
    if($FlowCellProgramsRoot -ne (Join-Path $root 'Programs')){throw 'Repeated preflight relocated development Programs.'}
    $env:FLOWCELL_LOCAL_ROOT=Join-Path $root 'Inherited Installed Data';$env:FLOWCELL_PROGRAMS_ROOT=Join-Path $root 'Inherited Installed Programs'
    . $helper
    if($FlowCellLocalRoot -ne (Join-Path $root 'flowcellbackend/local') -or $FlowCellProgramsRoot -ne (Join-Path $root 'Programs') -or $env:FLOWCELL_BACKEND_ROLE -ne 'development'){throw 'Inherited installed roots contaminated development paths.'}
    $env:FLOWCELL_LOCAL_ROOT='';$env:FLOWCELL_PROGRAMS_ROOT=''
    '{}'|Set-Content -LiteralPath (Join-Path $root 'flowcell-installed.json')
    . $helper
    $expectedAppData=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FlowCell/local'
    $expectedState=Join-Path $expectedAppData 'button-system/button-state.json'
    if(Test-Path -LiteralPath $expectedState){$expectedAppData=Split-Path -Parent (Split-Path -Parent (Resolve-FlowCellPhysicalPath -Path $expectedState))}
    elseif(Test-Path -LiteralPath $expectedAppData){$expectedAppData=Resolve-FlowCellPhysicalPath -Path $expectedAppData}
    if($FlowCellLocalRoot -ne $expectedAppData){throw 'Installed AppData physical path incorrect.'}
    if($FlowCellProgramsRoot -ne (Join-Path $FlowCellLocalRoot 'Programs')){throw 'Installed Programs path incorrect.'}
    $configured=Join-Path $root 'Physical User Data'
    @{localRoot=$configured}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $root 'flowcell.runtime.json')
    $env:FLOWCELL_LOCAL_ROOT=Join-Path $root 'Inherited Workspace Data';$env:FLOWCELL_PROGRAMS_ROOT=Join-Path $root 'Inherited Workspace Programs'
    . $helper
    if($FlowCellLocalRoot -ne $configured -or $FlowCellProgramsRoot -ne (Join-Path $configured 'Programs')){throw 'Installed runtime config was ignored.'}
    $override=Join-Path $root 'Explicit User Data'
    $env:FLOWCELL_LOCAL_ROOT=$override;$env:FLOWCELL_PROGRAMS_ROOT=''
    . $helper
    if($FlowCellLocalRoot -ne $configured -or $FlowCellProgramsRoot -ne (Join-Path $configured 'Programs') -or $env:FLOWCELL_BACKEND_ROLE -ne 'installed'){throw 'Installed config did not win over inherited local root.'}
    Remove-Item -LiteralPath (Join-Path $root 'flowcell.runtime.json')
    $env:FLOWCELL_LOCAL_ROOT=$override;$env:FLOWCELL_PROGRAMS_ROOT=''
    . $helper -AllowEnvironmentOverrides
    if($FlowCellLocalRoot -ne $override -or $FlowCellProgramsRoot -ne (Join-Path $override 'Programs')){throw 'Explicit fixture local root was not used directly.'}
    [IO.Directory]::CreateDirectory((Join-Path $override 'button-system'))|Out-Null
    '{}'|Set-Content -LiteralPath (Join-Path $override 'button-system/button-state.json')
    . $helper -AllowEnvironmentOverrides
    if($FlowCellLocalRoot -ne (Resolve-FlowCellPhysicalPath -Path $override)){throw 'Physical installed root did not follow canonical Button state.'}
    Write-Output 'PASS: development/installed roots, inherited-root isolation, configured physical root, fixture override and physical Button-state ownership.'
} finally {foreach($key in $saved.Keys){[Environment]::SetEnvironmentVariable($key,$saved[$key])}}
