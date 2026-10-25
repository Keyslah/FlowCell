$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-FlowCellShortcut.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors.Message -join '; ') }
$function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-FlowCellShortcut' }, $false)
. ([scriptblock]::Create($function.Extent.Text))
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell Shortcut Tests ' + [guid]::NewGuid().ToString('N'))
$savedRole = $env:FLOWCELL_BACKEND_ROLE
$FlowCellResourceRoot = $fixture
$env:FLOWCELL_BACKEND_ROLE = 'installed'
$script:Enabled = $false
$script:LockHeld = $false
$script:Launches = @()
function Enter-FlowCellAutoHotkeyLock { $script:LockHeld = $true; return 'fixture' }
function Exit-FlowCellAutoHotkeyLock { param($Mutex) $script:LockHeld = $false }
function Get-FlowCellAutoHotkeyState { [pscustomobject]@{Enabled = $script:Enabled} }
function Start-Process {
    param([string]$FilePath, [string]$ArgumentList, [string]$WorkingDirectory, [string]$WindowStyle)
    if ([IO.Path]::GetExtension($FilePath) -ne '.lnk' -and (-not $script:LockHeld -or -not $script:Enabled)) { throw 'AutoHotkey shortcut launch escaped the shared state gate.' }
    $script:Launches += [pscustomobject]@{FilePath=$FilePath; Arguments=$ArgumentList; WorkingDirectory=$WorkingDirectory; WindowStyle=$WindowStyle}
}
try {
    $runtime = Join-Path $fixture 'flowcellbackend/runtime/AutoHotkey64.exe'
    [IO.Directory]::CreateDirectory((Split-Path -Parent $runtime)) | Out-Null
    [IO.File]::WriteAllText($runtime, 'fixture: never executed')
    $scriptPath = Join-Path $fixture 'User Script.ahk'
    [IO.File]::WriteAllText($scriptPath, 'fixture: never executed')
    $shell = New-Object -ComObject WScript.Shell
    $scriptLink = Join-Path $fixture 'Script shortcut.lnk'
    $link = $shell.CreateShortcut($scriptLink)
    $link.TargetPath = $scriptPath
    $link.Arguments = '--label "quoted words"'
    $link.WorkingDirectory = $fixture
    $link.Save()
    $runtimeLink = Join-Path $fixture 'Runtime shortcut.lnk'
    $link = $shell.CreateShortcut($runtimeLink)
    $link.TargetPath = $runtime
    $link.Arguments = '"' + $scriptPath + '" --runtime'
    $link.WorkingDirectory = $fixture
    $link.Save()
    foreach ($path in @($scriptLink, $runtimeLink)) {
        $rejected = $false
        try { Invoke-FlowCellShortcut -Path $path } catch { $rejected = $_.Exception.Message -like 'AutoHotkey is OFF*' }
        if (-not $rejected -or $script:Launches.Count -ne 0 -or $script:LockHeld) { throw 'OFF did not prevent a shortcut-target AutoHotkey launch.' }
    }
    $script:Enabled = $true
    Invoke-FlowCellShortcut -Path $scriptLink
    Invoke-FlowCellShortcut -Path $runtimeLink
    if ($script:Launches.Count -ne 2 -or $script:Launches[0].FilePath -ne $runtime -or $script:Launches[0].Arguments -ne ('"' + $scriptPath + '" --label "quoted words"') -or $script:Launches[1].Arguments -ne ('"' + $scriptPath + '" --runtime') -or $script:Launches[0].WorkingDirectory -ne $fixture -or $script:LockHeld) { throw 'Shortcut arguments, bundled runtime or working directory were not preserved.' }
    $regularLink = Join-Path $fixture 'Regular shortcut.lnk'
    $link = $shell.CreateShortcut($regularLink)
    $link.TargetPath = Join-Path $env:SystemRoot 'System32/notepad.exe'
    $link.Save()
    $script:Enabled = $false
    Invoke-FlowCellShortcut -Path $regularLink
    if ($script:Launches.Count -ne 3 -or $script:Launches[2].FilePath -ne $regularLink) { throw 'An unrelated Windows shortcut was changed or blocked while AutoHotkey was OFF.' }
    Write-Output 'PASS: shortcut AHK script/runtime targets respect OFF and shared locking; ON preserves arguments/cwd and uses bundled runtime; unrelated shortcuts remain available.'
} finally {
    $env:FLOWCELL_BACKEND_ROLE = $savedRole
    if ([IO.Path]::GetFullPath($fixture).StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
