<#
Purpose: One per-user AutoHotkey preference shared by every FlowCell launcher.
The authentication logon ID and logon time change only at a new Windows sign-in,
not when FlowCell restarts, Windows unlocks, or the computer wakes. Callers hold
the shared mutex across checking the preference and creating/stopping processes.
Preference and measured process status are deliberately separate files.
#>
function Get-FlowCellAutoHotkeyStateRoot {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FlowCell\autohotkey-toggle'
}

function Get-FlowCellAutoHotkeySessionId {
    if (-not ('FlowCellAutoHotkeyLogon' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class FlowCellAutoHotkeyLogon {
    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] private struct LsaString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] private struct LogonData {
        public uint Size; public Luid LogonId; public LsaString UserName; public LsaString Domain;
        public LsaString AuthenticationPackage; public uint LogonType; public uint Session;
        public IntPtr Sid; public long LogonTime;
    }
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr data, int length, out int needed);
    [DllImport("secur32.dll")] private static extern uint LsaGetLogonSessionData(ref Luid id, out IntPtr data);
    [DllImport("secur32.dll")] private static extern uint LsaFreeReturnBuffer(IntPtr data);
    public static string SessionId() {
        using (var identity = WindowsIdentity.GetCurrent()) {
            IntPtr statistics = Marshal.AllocHGlobal(64);
            try {
                int needed;
                if (!GetTokenInformation(identity.Token, 10, statistics, 64, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error());
                var id = (Luid)Marshal.PtrToStructure(IntPtr.Add(statistics, 8), typeof(Luid));
                IntPtr data;
                uint status = LsaGetLogonSessionData(ref id, out data);
                if (status != 0 || data == IntPtr.Zero) throw new InvalidOperationException("Windows logon session could not be read: " + status);
                try {
                    var logon = (LogonData)Marshal.PtrToStructure(data, typeof(LogonData));
                    return id.High.ToString("X8") + id.Low.ToString("X8") + "-" + logon.LogonTime.ToString("X16");
                } finally { LsaFreeReturnBuffer(data); }
            } finally { Marshal.FreeHGlobal(statistics); }
        }
    }
}
'@
    }
    [FlowCellAutoHotkeyLogon]::SessionId()
}

function Enter-FlowCellAutoHotkeyLock {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = New-Object Threading.Mutex($false, ('Local\FlowCell.AutoHotkey.' + $sid))
    try {
        try { $acquired = $mutex.WaitOne(30000) }
        catch [Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'Timed out waiting for the AutoHotkey state lock.' }
        return $mutex
    } catch {
        $mutex.Dispose()
        throw
    }
}

function Exit-FlowCellAutoHotkeyLock {
    param([Parameter(Mandatory=$true)]$Mutex)
    try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() }
}

function Get-FlowCellAutoHotkeyState {
    param(
        [string]$StateRoot = (Get-FlowCellAutoHotkeyStateRoot),
        [string]$SessionId = (Get-FlowCellAutoHotkeySessionId)
    )
    $path = Join-Path $StateRoot ('AutoHotkeySessionState-' + $SessionId + '.json')
    $enabled = $true
    $newSession = $true
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        # Invalid or unreadable preference must not silently launch hotkeys.
        $saved = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if (-not $saved -or -not $saved.PSObject.Properties['sessionId'] -or
            -not $saved.PSObject.Properties['enabled'] -or $saved.enabled -isnot [bool]) {
            throw 'The AutoHotkey session preference is invalid.'
        }
        $newSession = [string]$saved.sessionId -ne $SessionId
        if (-not $newSession) { $enabled = $saved.enabled }
    }
    [pscustomobject]@{ Enabled = $enabled; SessionId = $SessionId; IsNewSession = $newSession; StatePath = $path }
}

function Set-FlowCellAutoHotkeyEnabled {
    param(
        [Parameter(Mandatory=$true)][bool]$Enabled,
        [string]$StateRoot = (Get-FlowCellAutoHotkeyStateRoot),
        [string]$SessionId = (Get-FlowCellAutoHotkeySessionId)
    )
    [IO.Directory]::CreateDirectory($StateRoot) | Out-Null
    $path = Join-Path $StateRoot ('AutoHotkeySessionState-' + $SessionId + '.json')
    $temporary = Join-Path $StateRoot ([guid]::NewGuid().ToString('N') + '.tmp')
    $json = [ordered]@{ sessionId = $SessionId; enabled = $Enabled; updatedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    try {
        if ([IO.File]::Exists($path)) { [IO.File]::Replace($temporary, $path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $path) }
    } finally {
        # Only the temporary file created immediately above is eligible for cleanup.
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

function Import-FlowCellAutoHotkeyLegacyState {
    param(
        [string[]]$LegacyRoots,
        [string]$StateRoot = (Get-FlowCellAutoHotkeyStateRoot),
        [string]$SessionId = (Get-FlowCellAutoHotkeySessionId)
    )
    $mutex = Enter-FlowCellAutoHotkeyLock
    try {
        $preference = Get-FlowCellAutoHotkeyState -StateRoot $StateRoot -SessionId $SessionId
        $records = @(
            foreach ($legacyRoot in @($LegacyRoots | Select-Object -Unique)) {
                if ([string]::IsNullOrWhiteSpace($legacyRoot)) { continue }
                $statusPath = Join-Path $legacyRoot 'AutoHotkeyToggleStatus.json'
                if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) { continue }
                try {
                    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
                    if ($status -and $status.PSObject.Properties['updatedAt'] -and
                        $status.PSObject.Properties['state'] -and $status.PSObject.Properties['message']) {
                        [pscustomobject]@{ Root = $legacyRoot; Status = $status; Updated = [DateTimeOffset]::Parse([string]$status.updatedAt) }
                    }
                } catch { Write-Warning "Could not read legacy AutoHotkey status at '$statusPath': $($_.Exception.Message)" }
            }
        )
        $newest = $records | Sort-Object Updated -Descending | Select-Object -First 1
        # Only the old toggle's successful manual OFF feedback proves intent.
        # A status-only refresh or absence of processes does not prove OFF.
        if (-not (Test-Path -LiteralPath $preference.StatePath -PathType Leaf) -and $newest -and
            $SessionId -match '^[A-Fa-f0-9]{16}-([A-Fa-f0-9]{16})$') {
            $logonTime = [DateTime]::FromFileTimeUtc([Convert]::ToInt64($Matches[1], 16))
            if ($newest.Updated.UtcDateTime -ge $logonTime -and $newest.Updated.UtcDateTime -le [DateTime]::UtcNow -and
                $newest.Status.state -eq 'off' -and
                $newest.Status.message -ceq 'AutoHotkey is OFF. No AutoHotkey process is running.') {
                Set-FlowCellAutoHotkeyEnabled -Enabled $false -StateRoot $StateRoot -SessionId $SessionId
            }
        }
        $snapshotPath = Join-Path $StateRoot 'AutoHotkeyToggleSnapshot.json'
        if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) {
            $snapshotRoots = @($records | Sort-Object Updated -Descending | ForEach-Object { $_.Root }) + @($LegacyRoots)
            foreach ($legacyRoot in @($snapshotRoots | Select-Object -Unique)) {
                if ([string]::IsNullOrWhiteSpace($legacyRoot)) { continue }
                $legacySnapshot = Join-Path $legacyRoot 'AutoHotkeyToggleSnapshot.json'
                if (-not (Test-Path -LiteralPath $legacySnapshot -PathType Leaf)) { continue }
                try {
                    $parsedEntries = Get-Content -LiteralPath $legacySnapshot -Raw | ConvertFrom-Json
                    $entries = @($parsedEntries)
                    if ($entries.Count -eq 0) { continue }
                    $valid = @($entries | Where-Object { $_ -and $_.PSObject.Properties['ExecutablePath'] -and $_.PSObject.Properties['ArgumentString'] })
                    if ($valid.Count -ne $entries.Count) { continue }
                    [IO.Directory]::CreateDirectory($StateRoot) | Out-Null
                    Copy-Item -LiteralPath $legacySnapshot -Destination $snapshotPath -ErrorAction Stop
                    break
                } catch { Write-Warning "Could not read legacy AutoHotkey snapshot at '$legacySnapshot': $($_.Exception.Message)" }
            }
        }
    } finally {
        Exit-FlowCellAutoHotkeyLock -Mutex $mutex
    }
}
