<#
Purpose: Resolve FlowCell resource and writable roots consistently for backend helpers.
Context: Dot-source from the shipped backend; no working-directory or checkout dependency.
Inputs: Installed marker and runtime config beside the application; explicit fixture override.
Changes: Process environment only; no migration, deletion, copying, or user-state writes.
Constraints: Development/portable defaults remain beside their own backend.
#>
param([switch]$AllowEnvironmentOverrides)
function Resolve-FlowCellPhysicalPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not ('FlowCellPhysicalPaths' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class FlowCellPhysicalPaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
    public static string Resolve(string path) {
        using (var handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var buffer = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0 || length >= buffer.Capacity) throw new Win32Exception(Marshal.GetLastWin32Error());
            string result = buffer.ToString();
            if (result.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + result.Substring(8);
            return result.StartsWith(@"\\?\", StringComparison.Ordinal) ? result.Substring(4) : result;
        }
    }
}
'@
    }
    [FlowCellPhysicalPaths]::Resolve([IO.Path]::GetFullPath($Path))
}
$FlowCellResourceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FlowCellInstalled = Test-Path -LiteralPath (Join-Path $FlowCellResourceRoot 'flowcell-installed.json') -PathType Leaf
$FlowCellConfiguredLocalRoot = $null
$FlowCellRuntimeConfig = Join-Path $FlowCellResourceRoot 'flowcell.runtime.json'
if ($FlowCellInstalled -and (Test-Path -LiteralPath $FlowCellRuntimeConfig -PathType Leaf)) {
    $FlowCellRuntimeSettings = Get-Content -LiteralPath $FlowCellRuntimeConfig -Raw | ConvertFrom-Json
    $FlowCellConfiguredLocalRoot = [string]$FlowCellRuntimeSettings.localRoot
    if ([string]::IsNullOrWhiteSpace($FlowCellConfiguredLocalRoot) -or -not [IO.Path]::IsPathRooted($FlowCellConfiguredLocalRoot)) {
        throw 'flowcell.runtime.json requires an absolute localRoot.'
    }
}
$FlowCellLocalRoot = if ($FlowCellConfiguredLocalRoot) {
    [System.IO.Path]::GetFullPath($FlowCellConfiguredLocalRoot)
} elseif ($AllowEnvironmentOverrides -and $env:FLOWCELL_LOCAL_ROOT) {
    [System.IO.Path]::GetFullPath($env:FLOWCELL_LOCAL_ROOT)
} elseif ($FlowCellInstalled) {
    Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'FlowCell\local'
} else {
    Join-Path $FlowCellResourceRoot 'flowcellbackend\local'
}
if ($FlowCellInstalled) {
    $FlowCellStatePath = Join-Path $FlowCellLocalRoot 'button-system\button-state.json'
    if (Test-Path -LiteralPath $FlowCellStatePath -PathType Leaf) {
        $FlowCellLocalRoot = Split-Path -Parent (Split-Path -Parent (Resolve-FlowCellPhysicalPath -Path $FlowCellStatePath))
    } elseif (Test-Path -LiteralPath $FlowCellLocalRoot -PathType Container) {
        $FlowCellLocalRoot = Resolve-FlowCellPhysicalPath -Path $FlowCellLocalRoot
    }
}
$FlowCellProgramsRoot = if ($AllowEnvironmentOverrides -and -not $FlowCellConfiguredLocalRoot -and $env:FLOWCELL_PROGRAMS_ROOT) {
    $env:FLOWCELL_PROGRAMS_ROOT
} elseif ($FlowCellInstalled -or ($AllowEnvironmentOverrides -and $env:FLOWCELL_LOCAL_ROOT)) {
    Join-Path $FlowCellLocalRoot 'Programs'
} else {
    Join-Path $FlowCellResourceRoot 'Programs'
}
$env:FLOWCELL_LOCAL_ROOT = $FlowCellLocalRoot
$env:FLOWCELL_PROGRAMS_ROOT = $FlowCellProgramsRoot
$env:FLOWCELL_RESOURCE_ROOT = $FlowCellResourceRoot
$env:FLOWCELL_BACKEND_ROLE = if ($FlowCellInstalled) { 'installed' } else { 'development' }
