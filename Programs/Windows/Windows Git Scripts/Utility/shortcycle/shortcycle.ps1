#Requires -Version 5.1
# Description: Send one saved keyboard shortcut per press, cycling within a FlowCell session.
[CmdletBinding()]
param([switch]$Configure, [switch]$ValidateOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if (-not ('ShortcycleNative' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShortcycleNative {
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort vk, scan; public uint flags, time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int x,y; public uint data,flags,time; public UIntPtr extra;
    }
    [StructLayout(LayoutKind.Explicit)] public struct UNION {
        [FieldOffset(0)] public KEYBDINPUT key;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
    [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
    public static uint ProcessId(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
    public static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
    static uint Extended(ushort vk) { return (vk>=33 && vk<=46) || vk==91 || vk==92 || vk==93 || vk==111 || vk==144 ? 1u : 0u; }
    public static void Send(ushort[] keys) {
        INPUT[] inputs = new INPUT[keys.Length * 2];
        for (int i=0; i<keys.Length; i++) {
            inputs[i].type=1; inputs[i].data.key.vk=keys[i]; inputs[i].data.key.flags=Extended(keys[i]);
            int j=inputs.Length-1-i; inputs[j].type=1; inputs[j].data.key.vk=keys[i]; inputs[j].data.key.flags=2|Extended(keys[i]);
        }
        uint sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)));
        if (sent != inputs.Length) {
            // A partial injection must not leave our modifiers held down.
            INPUT[] releases=new INPUT[keys.Length];
            for(int i=0;i<keys.Length;i++) { releases[i].type=1; releases[i].data.key.vk=keys[keys.Length-1-i]; releases[i].data.key.flags=2|Extended(keys[keys.Length-1-i]); }
            SendInput((uint)releases.Length,releases,Marshal.SizeOf(typeof(INPUT)));
            throw new InvalidOperationException("Windows could not send the complete shortcut. The cycle has not advanced.");
        }
    }
}
'@
}

function ConvertTo-ShortcutKeys([string]$Shortcut) {
    $parts = @($Shortcut.Trim().Split('+') | ForEach-Object { $_.Trim() })
    if (-not $Shortcut.Trim() -or $parts -contains '') { throw 'Enter a shortcut such as Ctrl+Shift+S. Use Plus for the + key.' }
    $modifiers = @{ ctrl=17; control=17; alt=18; shift=16; win=91; windows=91; meta=91 }
    $aliases = @{ esc='Escape'; return='Enter'; space='Space'; del='Delete'; ins='Insert'; pgup='PageUp'; pgdn='PageDown';
        left='Left'; right='Right'; up='Up'; down='Down'; plus='Oemplus'; minus='OemMinus'; comma='Oemcomma'; period='OemPeriod';
        slash='OemQuestion'; backslash='OemPipe'; semicolon='OemSemicolon'; quote='OemQuotes';
        leftbracket='OemOpenBrackets'; rightbracket='OemCloseBrackets'; backtick='Oemtilde' }
    $keys = New-Object 'System.Collections.Generic.List[System.UInt16]'
    for ($i=0; $i -lt $parts.Count-1; $i++) {
        $part = $parts[$i].ToLowerInvariant()
        if (-not $modifiers.ContainsKey($part)) { throw "Unknown modifier '$($parts[$i])'. Use Ctrl, Alt, Shift or Win." }
        $key = [uint16]$modifiers[$part]
        if ($keys.Contains($key)) { throw 'A modifier cannot appear twice in one shortcut.' }
        $keys.Add($key)
    }
    $last = $parts[-1]
    if ($modifiers.ContainsKey($last.ToLowerInvariant())) { throw 'A shortcut needs a key after its modifiers.' }
    if ($last -match '^[0-9]$') { $last = 'D' + $last }
    if ($aliases.ContainsKey($last.ToLowerInvariant())) { $last = $aliases[$last.ToLowerInvariant()] }
    if ($last -notmatch '^[a-zA-Z][a-zA-Z0-9]*$') { throw "Unknown key '$last'." }
    try { $parsed = [System.Windows.Forms.Keys][Enum]::Parse([System.Windows.Forms.Keys], $last, $true) }
    catch { throw "Unknown key '$last'. Examples: A, F5, Tab, Enter, Space, PageDown." }
    $code = [int]$parsed
    if ($code -lt 8 -or $code -gt 254 -or $code -in @(16,17,18,91,92,160,161,162,163,164,165)) {
        throw "'$last' is not a shortcut key."
    }
    $keys.Add([uint16]$code)
    return ,$keys.ToArray()
}

function Get-SettingsDirectory {
    $owner = Split-Path -Parent $PSScriptRoot
    if ((Split-Path -Leaf $PSScriptRoot) -ieq 'source' -and (Test-Path -LiteralPath (Join-Path $owner 'flowcell.install.json'))) {
        return Join-Path $owner 'runtime'
    }
    return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FlowCell\shortcycle'
}

function Write-AtomicJson([string]$Path, $Value) {
    $temp = $Path + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temp, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temp, $Path) }
    } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}

function Get-CycleIndex($State, [string]$Session, [string[]]$Shortcuts) {
    if ($null -eq $State -or $State.sessionId -cne $Session -or
        ($State.shortcuts -join "`n") -cne ($Shortcuts -join "`n")) { return 0 }
    $index = [int]$State.nextIndex
    if ($index -lt 0 -or $index -ge $Shortcuts.Count) { return 0 }
    return $index
}

function Show-ShortcutSetup([string[]]$Shortcuts) {
    $form = New-Object Windows.Forms.Form
    $form.Text = 'shortcycle - shortcuts'
    $form.ClientSize = New-Object Drawing.Size(510,390)
    $form.StartPosition = 'CenterScreen'
    $form.MinimumSize = New-Object Drawing.Size(450,350)
    $form.TopMost = $true
    $hint = New-Object Windows.Forms.Label
    $hint.Text = "Enter one shortcut per line, in order. Add as many as you need.`r`nExamples: Ctrl+S, Ctrl+Shift+S, Alt+Tab, F5, Win+E"
    $hint.SetBounds(16,16,478,44)
    $hint.Anchor = 'Top,Left,Right'
    $shortcutInput = New-Object Windows.Forms.TextBox
    $shortcutInput.Multiline = $true; $shortcutInput.AcceptsReturn = $true; $shortcutInput.ScrollBars = 'Vertical'
    $shortcutInput.WordWrap = $false; $shortcutInput.Font = New-Object Drawing.Font('Segoe UI',11)
    $shortcutInput.Text = $Shortcuts -join "`r`n"
    $shortcutInput.SetBounds(16,65,478,220); $shortcutInput.Anchor = 'Top,Bottom,Left,Right'
    $status = New-Object Windows.Forms.Label
    $status.Text = 'Save keeps the list. The next press sends its first shortcut.'
    $status.SetBounds(16,296,478,40); $status.Anchor = 'Bottom,Left,Right'
    $save = New-Object Windows.Forms.Button
    $save.Text = 'Save'; $save.SetBounds(306,346,90,30); $save.Anchor = 'Bottom,Right'
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancel'; $cancel.SetBounds(404,346,90,30); $cancel.Anchor = 'Bottom,Right'
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancel
    $save.Add_Click({
        try {
            $lines = @($shortcutInput.Lines | ForEach-Object { $_.Trim() } | Where-Object { $_ })
            if ($lines.Count -eq 0) { throw 'Enter at least one shortcut.' }
            for ($i=0; $i -lt $lines.Count; $i++) {
                try { [void](ConvertTo-ShortcutKeys $lines[$i]) }
                catch { throw "Line $($i+1): $($_.Exception.Message)" }
            }
            $form.Tag = $lines
            $form.DialogResult = [Windows.Forms.DialogResult]::OK
            $form.Close()
        } catch { $status.Text = $_.Exception.Message }
    })
    $form.Controls.AddRange(@($hint,$shortcutInput,$status,$save,$cancel))
    $form.Add_Shown({ $form.Activate(); [void]$shortcutInput.Focus() })
    try {
        if ($form.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { return ,([string[]]$form.Tag) }
        return $null
    } finally { $form.Dispose() }
}

function Send-ShortcutToWindow([uint16[]]$Keys, [IntPtr]$Target, [uint32]$TargetProcess) {
    if ($Target -eq [IntPtr]::Zero -or -not [ShortcycleNative]::IsWindow($Target) -or
        [ShortcycleNative]::ProcessId($Target) -ne $TargetProcess) { throw 'Select the application that should receive the shortcut, then press shortcycle again.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while (@(1,16,17,18,91,92 | Where-Object { [ShortcycleNative]::Down($_) }).Count -gt 0) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Release the mouse and modifier keys, then press shortcycle again.' }
        Start-Sleep -Milliseconds 15
    }
    [void][ShortcycleNative]::SetForegroundWindow($Target)
    $deadline = [DateTime]::UtcNow.AddMilliseconds(600)
    while ([ShortcycleNative]::GetForegroundWindow() -ne $Target) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Windows could not focus the target application. The cycle has not advanced.' }
        Start-Sleep -Milliseconds 15
    }
    [ShortcycleNative]::Send($Keys)
}

function Invoke-Shortcycle {
    $directory = Get-SettingsDirectory
    [void][IO.Directory]::CreateDirectory($directory)
    $settingsPath = Join-Path $directory 'shortcycle.json'
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $token = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($directory.ToLowerInvariant()))).Replace('-','') }
    finally { $hash.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\FlowCell-shortcycle-' + $token))
    $locked = $false
    try {
        try { $locked = $mutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'shortcycle setup is already open or another press is still running.' }
        $state = $null
        if (Test-Path -LiteralPath $settingsPath) {
            $state = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($state.schemaVersion -ne 1 -or @($state.shortcuts).Count -eq 0) { throw 'The saved shortcycle list is invalid.' }
        }
        $shortcuts = @()
        if ($null -ne $state) { $shortcuts = @($state.shortcuts) }
        if ($Configure -or $null -eq $state -or [ShortcycleNative]::Down(16)) {
            $chosen = Show-ShortcutSetup $shortcuts
            if ($null -ne $chosen) {
                Write-AtomicJson $settingsPath @{ schemaVersion=1; shortcuts=@($chosen); sessionId=''; nextIndex=0 }
            }
            return
        }
        $session = $env:FLOWCELL_SESSION_ID
        if ([string]::IsNullOrWhiteSpace($session)) { throw 'Run this button from FlowCell so shortcycle can track the current session.' }
        $index = Get-CycleIndex $state $session $shortcuts
        $keys = ConvertTo-ShortcutKeys $shortcuts[$index]
        $target = [IntPtr]([long]$env:FLOWCELL_TARGET_HWND)
        $targetProcess = [ShortcycleNative]::ProcessId($target)
        Send-ShortcutToWindow $keys $target $targetProcess
        Write-AtomicJson $settingsPath @{ schemaVersion=1; shortcuts=@($shortcuts); sessionId=$session; nextIndex=(($index+1)%$shortcuts.Count) }
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

if ($ValidateOnly) { return }
try { Invoke-Shortcycle }
catch {
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, 'shortcycle', 'OK', 'Error')
    exit 1
}
