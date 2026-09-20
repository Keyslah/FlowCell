# Exercise the package's own WinForms controls using its real message loop.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts\Utility\shortcycle\shortcycle.ps1') -ValidateOnly
$script:setupRuntime = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-shortcycle-setup-' + [guid]::NewGuid().ToString('N'))
function Get-SettingsDirectory { return $script:setupRuntime }
function Send-ShortcutToWindow { throw 'Setup must never send keys.' }
$script:step = 0
$script:setupFailure = $null
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    try {
        $form = @([Windows.Forms.Application]::OpenForms | Where-Object Text -eq 'shortcycle - shortcuts')[0]
        $field = @($form.Controls | Where-Object { $_ -is [Windows.Forms.TextBox] })[0]
        $save = @($form.Controls | Where-Object Text -eq 'Save')[0]
        $cancel = @($form.Controls | Where-Object Text -eq 'Cancel')[0]
        if ($script:step -eq 0) {
            $field.Text = 'Ctrl+NotAKey'
            $save.PerformClick()
            if (-not $form.Visible -or (Test-Path (Join-Path $script:setupRuntime 'shortcycle.json'))) { throw 'Invalid setup was saved.' }
            $script:step++
        } elseif ($script:step -eq 1) {
            $field.Text = "Ctrl+S`r`nCtrl+Shift+S`r`nF5"
            $script:step++
            $timer.Stop()
            $save.PerformClick()
        } else {
            $field.Text = 'Alt+F4'
            $timer.Stop()
            $cancel.PerformClick()
        }
    } catch {
        $script:setupFailure = $_
        $timer.Stop()
        foreach ($dialog in @([Windows.Forms.Application]::OpenForms)) { $dialog.Close() }
    }
})
try {
    $timer.Start()
    Invoke-Shortcycle
    if ($script:setupFailure) { throw $script:setupFailure }
    $settings = Join-Path $script:setupRuntime 'shortcycle.json'
    $state = Get-Content $settings -Raw | ConvertFrom-Json
    if (($state.shortcuts -join ',') -ne 'Ctrl+S,Ctrl+Shift+S,F5' -or $state.nextIndex -ne 0 -or $state.sessionId -ne '') {
        throw 'Setup did not preserve the exact list and reset its position.'
    }
    $before = [IO.File]::ReadAllText($settings)
    $Configure = $true
    $timer.Start()
    Invoke-Shortcycle
    if ($script:setupFailure) { throw $script:setupFailure }
    if ([IO.File]::ReadAllText($settings) -cne $before) { throw 'Cancelling setup changed the saved list.' }
    'Native setup passed: invalid input rejected, Save preserves order without sending, Cancel preserves saved settings.'
} finally {
    $timer.Dispose()
    if (Test-Path -LiteralPath $script:setupRuntime) { Remove-Item -LiteralPath $script:setupRuntime -Recurse -Force }
}
