$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$package = Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts\Utility\shortcycle'
$entry = Join-Path $package 'shortcycle.ps1'
$tokens = $null; $errors = $null
[void][Management.Automation.Language.Parser]::ParseFile($entry, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
. $entry -ValidateOnly
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
Assert ((ConvertTo-ShortcutKeys 'Ctrl+Shift+S') -join ',' -eq '17,16,83') 'Ctrl+Shift+S mapping'
Assert ((ConvertTo-ShortcutKeys 'Win+E') -join ',' -eq '91,69') 'Win mapping'
Assert ((ConvertTo-ShortcutKeys 'Alt+Tab') -join ',' -eq '18,9') 'Alt+Tab mapping'
Assert ((ConvertTo-ShortcutKeys 'Ctrl+1') -join ',' -eq '17,49') 'Number mapping'
Assert ((ConvertTo-ShortcutKeys 'F24') -join ',' -eq '135') 'Function key mapping'
foreach ($invalid in @('', 'Ctrl', 'Ctrl+Ctrl+A', 'Ctrl++A', 'Ctrl+NotAKey', 'Ctrl+Shift', 'Ctrl+999', 'Ctrl+A+B', 'Ctrl+LButton')) {
    $rejected = $false
    try { [void](ConvertTo-ShortcutKeys $invalid) } catch { $rejected = $true }
    Assert $rejected "Invalid shortcut accepted: $invalid"
}
$shortcuts = @('Ctrl+A','Ctrl+B','Ctrl+C')
$state = [pscustomobject]@{sessionId='one'; shortcuts=$shortcuts; nextIndex=0}
$observed = @()
foreach ($press in 1..7) {
    $index = Get-CycleIndex $state 'one' $shortcuts
    $observed += $shortcuts[$index]
    $state.nextIndex = ($index+1)%$shortcuts.Count
}
Assert (($observed -join ',') -eq 'Ctrl+A,Ctrl+B,Ctrl+C,Ctrl+A,Ctrl+B,Ctrl+C,Ctrl+A') 'Wrap order'
Assert ((Get-CycleIndex $state 'two' $shortcuts) -eq 0) 'New session resets'
Assert ((Get-CycleIndex $state 'one' @('F1')) -eq 0) 'Changed list resets'
Assert ((Get-CycleIndex $null 'one' $shortcuts) -eq 0) 'First use resets'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-shortcycle-tests-' + [guid]::NewGuid().ToString('N'))
try {
    foreach ($name in @('owner-a','owner-b')) {
        $source = Join-Path $tempRoot "$name\source"
        [void][IO.Directory]::CreateDirectory($source)
        Copy-Item -LiteralPath $entry -Destination (Join-Path $source 'shortcycle.ps1')
        [IO.File]::WriteAllText((Join-Path $tempRoot "$name\flowcell.install.json"), '{}')
        . (Join-Path $source 'shortcycle.ps1') -ValidateOnly
        $runtime = Get-SettingsDirectory
        Assert ($runtime -eq (Join-Path $tempRoot "$name\runtime")) 'Owner runtime isolation'
        [void][IO.Directory]::CreateDirectory($runtime)
        Write-AtomicJson (Join-Path $runtime 'shortcycle.json') @{ schemaVersion=1; shortcuts=@($name); sessionId='one'; nextIndex=0 }
        Write-AtomicJson (Join-Path $runtime 'shortcycle.json') @{ schemaVersion=1; shortcuts=@($name); sessionId='two'; nextIndex=0 }
    }
    $a = Get-Content (Join-Path $tempRoot 'owner-a\runtime\shortcycle.json') -Raw | ConvertFrom-Json
    $b = Get-Content (Join-Path $tempRoot 'owner-b\runtime\shortcycle.json') -Raw | ConvertFrom-Json
    Assert ($a.shortcuts[0] -ne $b.shortcuts[0]) 'Owners share settings'
    Assert ($a.sessionId -eq 'two') 'Atomic replace failed'
} finally { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
'shortcycle: key parsing, invalid input, cycle order, session reset, list reset, owner isolation and atomic updates passed.'
