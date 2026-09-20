# Uses a disposable test window. Never sends keys to a user document.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$entry = Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts\Utility\shortcycle\shortcycle.ps1'
. $entry -ValidateOnly
$script:testRuntime = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-shortcycle-native-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:testRuntime)
function Get-SettingsDirectory { return $script:testRuntime }
$savedSession = $env:FLOWCELL_SESSION_ID
$savedTarget = $env:FLOWCELL_TARGET_HWND
$env:FLOWCELL_SESSION_ID = 'native-test-session-one'
$settings = Join-Path $script:testRuntime 'shortcycle.json'
Write-AtomicJson $settings @{schemaVersion=1;shortcuts=@('F13','Ctrl+F14','Shift+F15');sessionId='';nextIndex=0}
$form = New-Object Windows.Forms.Form
$form.Text = 'shortcycle keyboard delivery test'
$form.ClientSize = New-Object Drawing.Size(440,100)
$form.StartPosition = 'CenterScreen'
$form.KeyPreview = $true
$label = New-Object Windows.Forms.Label
$label.Text = 'Testing shortcuts in this temporary window. It closes automatically.'
$label.Dock = 'Fill'
$form.Controls.Add($label)
$script:received = New-Object 'System.Collections.Generic.List[string]'
$script:failure = $null
$script:press = 0
$script:focusDeadline = [DateTime]::UtcNow.AddSeconds(60)
$form.Add_KeyDown({
    param($sender,$event)
    if ([int]$event.KeyCode -ge 124 -and [int]$event.KeyCode -le 126) {
        $script:received.Add($event.KeyData.ToString())
        $event.SuppressKeyPress = $true
    }
})
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 400
$timer.Add_Tick({
    try {
        if ($script:press -eq 0 -and [ShortcycleNative]::GetForegroundWindow() -ne $form.Handle) {
            if ([DateTime]::UtcNow -gt $script:focusDeadline) { throw 'Focus the native test window to begin the delivery test.' }
            return
        }
        if ($script:press -eq 7) { $timer.Stop(); $form.Close(); return }
        if ($script:press -eq 4) { $env:FLOWCELL_SESSION_ID = 'native-test-session-two' }
        if ($script:press -eq 5) {
            Write-AtomicJson $settings @{schemaVersion=1;shortcuts=@('Ctrl+F14');sessionId='';nextIndex=0}
        }
        $env:FLOWCELL_TARGET_HWND = $form.Handle.ToInt64().ToString()
        Invoke-Shortcycle
        $script:press++
    } catch { $script:failure = $_; $timer.Stop(); $form.Close() }
})
$form.Add_Shown({ $form.Activate(); $timer.Start() })
try {
    [void]$form.ShowDialog()
    if ($script:failure) { throw $script:failure }
    $actual = $script:received -join '|'
    if ($actual -ne 'F13|F14, Control|F15, Shift|F13|F13|F14, Control|F14, Control') { throw "Unexpected native key events: $actual" }
    $state = Get-Content $settings -Raw | ConvertFrom-Json
    if ($state.nextIndex -ne 0 -or $state.sessionId -ne 'native-test-session-two') { throw 'Native cycle state mismatch.' }
    # Verify a missing target neither sends nor advances.
    $before = [IO.File]::ReadAllText($settings)
    $env:FLOWCELL_TARGET_HWND = '0'
    $failed = $false
    try { Invoke-Shortcycle } catch { $failed = $true }
    if (-not $failed -or [IO.File]::ReadAllText($settings) -cne $before) { throw 'Failed dispatch advanced the cycle.' }
    "Native keyboard delivery passed: $actual; missing target preserves the index."
} finally {
    $timer.Dispose(); $form.Dispose()
    $env:FLOWCELL_SESSION_ID = $savedSession
    $env:FLOWCELL_TARGET_HWND = $savedTarget
    Remove-Item -LiteralPath $script:testRuntime -Recurse -Force
}
