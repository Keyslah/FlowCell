# Description: Runs Restore FlowCellWindow.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FlowCellWindowInterop {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetActiveWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool AllowSetForegroundWindow(int dwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@

function Show-FlowCellWindowInFront([IntPtr]$Handle) {
    $hwndTopMost = [IntPtr](-1)
    $hwndNotTopMost = [IntPtr](-2)
    $swpNoSize = 0x0001
    $swpNoMove = 0x0002
    $swpShowWindow = 0x0040
    $swpFlags = [uint32]($swpNoSize -bor $swpNoMove -bor $swpShowWindow)

    if ([FlowCellWindowInterop]::IsIconic($Handle)) {
        [void][FlowCellWindowInterop]::ShowWindowAsync($Handle, 9)
    }
    else {
        [void][FlowCellWindowInterop]::ShowWindowAsync($Handle, 5)
    }

    Start-Sleep -Milliseconds 40

    $currentThread = [FlowCellWindowInterop]::GetCurrentThreadId()
    $targetProcessId = [uint32]0
    $targetThread = [FlowCellWindowInterop]::GetWindowThreadProcessId($Handle, [ref]$targetProcessId)
    $foregroundHandle = [FlowCellWindowInterop]::GetForegroundWindow()
    $foregroundProcessId = [uint32]0
    $foregroundThread = if ($foregroundHandle -ne [IntPtr]::Zero) {
        [FlowCellWindowInterop]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
    }
    else {
        [uint32]0
    }

    $attachedTarget = $false
    $attachedForeground = $false
    try {
        if ($targetThread -ne 0 -and $targetThread -ne $currentThread) {
            $attachedTarget = [FlowCellWindowInterop]::AttachThreadInput($currentThread, $targetThread, $true)
        }
        if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread -and $foregroundThread -ne $targetThread) {
            $attachedForeground = [FlowCellWindowInterop]::AttachThreadInput($currentThread, $foregroundThread, $true)
        }

        [void][FlowCellWindowInterop]::AllowSetForegroundWindow(-1)
        [void][FlowCellWindowInterop]::SetWindowPos($Handle, $hwndTopMost, 0, 0, 0, 0, $swpFlags)
        [void][FlowCellWindowInterop]::BringWindowToTop($Handle)
        [void][FlowCellWindowInterop]::SetForegroundWindow($Handle)
        [void][FlowCellWindowInterop]::SetActiveWindow($Handle)
        [void][FlowCellWindowInterop]::SetFocus($Handle)
        Start-Sleep -Milliseconds 140
        [void][FlowCellWindowInterop]::SetWindowPos($Handle, $hwndNotTopMost, 0, 0, 0, 0, $swpFlags)
        [void][FlowCellWindowInterop]::BringWindowToTop($Handle)
        [void][FlowCellWindowInterop]::SetForegroundWindow($Handle)
    }
    finally {
        if ($attachedForeground) {
            [void][FlowCellWindowInterop]::AttachThreadInput($currentThread, $foregroundThread, $false)
        }
        if ($attachedTarget) {
            [void][FlowCellWindowInterop]::AttachThreadInput($currentThread, $targetThread, $false)
        }
    }
}

$windowHandle = [IntPtr]::Zero
[FlowCellWindowInterop]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)

    if (-not [FlowCellWindowInterop]::IsWindowVisible($hWnd)) {
        return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder 512
    [void][FlowCellWindowInterop]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
    if ($titleBuilder.ToString() -eq 'FlowCell') {
        $script:windowHandle = $hWnd
        return $false
    }

    return $true
}, [IntPtr]::Zero) | Out-Null

if ($windowHandle -eq [IntPtr]::Zero) {
    exit 1
}

$bounds = New-Object FlowCellWindowInterop+RECT
[void][FlowCellWindowInterop]::GetWindowRect($windowHandle, [ref]$bounds)
$width = $bounds.Right - $bounds.Left
$height = $bounds.Bottom - $bounds.Top
$isClearlyOffscreen = ($bounds.Right -lt -1000) -or ($bounds.Bottom -lt -1000)
$isClearlyBrokenSize = ($width -lt 600) -or ($height -lt 500)

if ($isClearlyOffscreen -or $isClearlyBrokenSize) {
    [void][FlowCellWindowInterop]::MoveWindow($windowHandle, 140, 120, 1420, 920, $true)
    [void][FlowCellWindowInterop]::ShowWindowAsync($windowHandle, 5)
}

Show-FlowCellWindowInFront -Handle $windowHandle
exit 0
