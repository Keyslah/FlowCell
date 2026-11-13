$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$entry = Join-Path (Split-Path -Parent $PSScriptRoot) 'Windows Git Scripts\Utility\toggle_flowcell_windows.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($entry, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

# Exercise the production functions and entry point, replacing only user32.
# No native window is enumerated, focused, minimized, restored, or created.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Text;

public sealed class ToggleTestWindow {
    public long Handle;
    public string Title;
    public bool Visible;
    public bool Minimized;
    public bool Maximized;
    public ToggleTestWindow(long handle, string title, bool visible, bool minimized, bool maximized) {
        Handle = handle; Title = title; Visible = visible; Minimized = minimized; Maximized = maximized;
    }
}
public sealed class ToggleTestCall {
    public long Handle;
    public int Mode;
    public ToggleTestCall(long handle, int mode) { Handle = handle; Mode = mode; }
}
public static class FlowCellWindowToggleNative {
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
    public static readonly List<ToggleTestWindow> Windows = new List<ToggleTestWindow>();
    public static readonly List<ToggleTestCall> Calls = new List<ToggleTestCall>();
    public static bool EnumWindows(EnumWindowsProc callback, IntPtr parameter) {
        foreach (var window in Windows) if (!callback(new IntPtr(window.Handle), parameter)) return false;
        return true;
    }
    public static bool IsWindowVisible(IntPtr handle) { return Find(handle).Visible; }
    public static bool IsIconic(IntPtr handle) { return Find(handle).Minimized; }
    public static int GetWindowText(IntPtr handle, StringBuilder text, int maxCount) {
        var title = Find(handle).Title;
        text.Append(title.Substring(0, Math.Min(title.Length, maxCount - 1)));
        return text.Length;
    }
    public static bool ShowWindowAsync(IntPtr handle, int mode) {
        Calls.Add(new ToggleTestCall(handle.ToInt64(), mode));
        Find(handle).Minimized = mode == 6;
        return true;
    }
    public static ToggleTestWindow Find(IntPtr handle) {
        return Windows.Find(window => window.Handle == handle.ToInt64());
    }
}
'@

foreach ($statement in $ast.EndBlock.Statements) {
    if ($statement -is [Management.Automation.Language.FunctionDefinitionAst]) {
        . ([ScriptBlock]::Create($statement.Extent.Text))
    }
}
$entryPoint = $ast.EndBlock.Statements[-1]
if ($entryPoint -isnot [Management.Automation.Language.TryStatementAst]) { throw 'Toggle entry point was not found.' }
$runToggle = [ScriptBlock]::Create($entryPoint.Extent.Text)
$script:assertionCount = 0
$script:scenarioCount = 0
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('flowcell-window-toggle-tests-' + [Guid]::NewGuid().ToString('N'))
$previousLocalRoot = $env:FLOWCELL_LOCAL_ROOT
$previousSource = $env:FLOWCELL_SOURCE_HWND

function Assert($Condition, [string]$Message) {
    $script:assertionCount++
    if (-not $Condition) { throw "Scenario $script:scenarioCount`: $Message" }
}
function Reset-Scenario([string]$Source = '2') {
    $script:scenarioCount++
    $env:FLOWCELL_LOCAL_ROOT = Join-Path $testRoot ([string]$script:scenarioCount)
    $env:FLOWCELL_SOURCE_HWND = $Source
    [FlowCellWindowToggleNative]::Windows.Clear()
    [FlowCellWindowToggleNative]::Calls.Clear()
}
function Add-Window([long]$Handle, [string]$Title, [bool]$Minimized = $false, [bool]$Maximized = $false, [bool]$Visible = $true) {
    [FlowCellWindowToggleNative]::Windows.Add([ToggleTestWindow]::new($Handle, $Title, $Visible, $Minimized, $Maximized))
}
function Assert-Calls([long[]]$Handles, [int]$Mode) {
    $actual = @([FlowCellWindowToggleNative]::Calls | ForEach-Object Handle | Sort-Object)
    Assert (($actual -join ',') -eq (($Handles | Sort-Object) -join ',')) "Unexpected native targets: $($actual -join ',')"
    Assert (@([FlowCellWindowToggleNative]::Calls | Where-Object { $_.Mode -ne $Mode }).Count -eq 0) "Unexpected native show mode; expected $Mode"
}
function Set-SavedState($Entries) {
    $path = Get-FlowCellToggleStatePath
    Ensure-ParentDirectory $path
    @{ savedAt = 'test'; windows = @($Entries) } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8
}
function Assert-ProtectedWindows([bool]$MainMinimized, [bool]$MainMaximized, [bool]$SourceMinimized = $false) {
    $main = [FlowCellWindowToggleNative]::Find([IntPtr]1)
    $source = [FlowCellWindowToggleNative]::Find([IntPtr]2)
    Assert ($main.Minimized -eq $MainMinimized -and $main.Maximized -eq $MainMaximized) 'Main changed state'
    Assert ($source.Minimized -eq $SourceMinimized) 'Launching window changed state'
}

try {
    foreach ($mainState in @('normal', 'minimized', 'maximized')) {
        foreach ($sourceTitle in @('FlowCell - Button Popout', 'FlowCell - Button Fan', 'FlowCell - Utility')) {
            Reset-Scenario
            $mainMinimized = $mainState -eq 'minimized'
            $mainMaximized = $mainState -eq 'maximized'
            Add-Window 1 'FlowCell' $mainMinimized $mainMaximized
            Add-Window 2 $sourceTitle
            Add-Window 3 'FlowCell - Button Popout'
            Add-Window 4 'FlowCell - Button Fan'
            Add-Window 5 'FlowCell - Page'
            Add-Window 6 'Other application'
            Add-Window 7 'FlowCell - Hidden' $false $false $false
            Add-Window 8 'FlowCell - Previously minimized' $true

            & $runToggle
            Assert-Calls @(3, 4, 5) 6
            Assert-ProtectedWindows $mainMinimized $mainMaximized
            $saved = Read-FlowCellToggleState
            Assert ((@($saved.windows | ForEach-Object handle | Sort-Object) -join ',') -eq '3,4,5') 'Saved state included an excluded or previously minimized window'
            Assert ((Get-Content -LiteralPath (Get-FlowCellStatusPath) -Raw) -match 'Minimized 3') 'Minimize status was not recorded'

            [FlowCellWindowToggleNative]::Calls.Clear()
            & $runToggle
            Assert-Calls @(3, 4, 5) 9
            Assert-ProtectedWindows $mainMinimized $mainMaximized
            Assert (@((Read-FlowCellToggleState).windows).Count -eq 0) 'Restore did not clear saved state'
            Assert ([FlowCellWindowToggleNative]::Find([IntPtr]8).Minimized) 'Restore changed a previously minimized window outside the saved set'
        }
    }

    # Older saves may contain Main, the calling window, or a recycled HWND.
    Reset-Scenario
    Add-Window 1 'FlowCell' $true
    Add-Window 2 'FlowCell - Button Popout' $true
    Add-Window 3 'FlowCell - Replacement page' $true
    Add-Window 4 'FlowCell - Button Fan' $true
    Add-Window 5 'FlowCell - Visible page'
    Set-SavedState @(
        @{ handle = '1'; title = 'FlowCell' },
        @{ handle = '2'; title = 'FlowCell - Button Popout' },
        @{ handle = '3'; title = 'FlowCell - Former page' },
        @{ handle = '4'; title = 'FlowCell - Button Fan' },
        @{ handle = '99'; title = 'FlowCell - Closed page' }
    )
    & $runToggle
    Assert-Calls @(4) 9
    Assert-ProtectedWindows $true $false $true
    Assert ([FlowCellWindowToggleNative]::Find([IntPtr]3).Minimized) 'Recycled handle was restored'
    Assert (-not [FlowCellWindowToggleNative]::Find([IntPtr]5).Minimized) 'Saved restore also minimized a newly opened page'
    Assert (@((Read-FlowCellToggleState).windows).Count -eq 0) 'Stale saved entries remained after restore'

    Reset-Scenario
    Add-Window 1 'FlowCell' $true
    Add-Window 2 'FlowCell - Button Fan'
    Add-Window 3 'FlowCell - Button Popout'
    Set-SavedState @(@{ handle = '1'; title = 'FlowCell' }, @{ handle = '2'; title = 'FlowCell - Button Fan' })
    & $runToggle
    Assert-Calls @(3) 6
    Assert-ProtectedWindows $true $false
    Assert ((Read-FlowCellToggleState).windows[0].handle -eq '3') 'Stale excluded entries prevented a new minimize cycle'

    Reset-Scenario
    Add-Window 1 'FlowCell' $true
    Add-Window 2 'FlowCell - Utility'
    foreach ($window in @(@(3, 'FlowCell - Button Popout'), @(4, 'FlowCell - Button Fan'), @(5, 'FlowCell - Page'))) {
        Add-Window $window[0] $window[1] $true
    }
    & $runToggle
    Assert-Calls @(3, 4, 5) 9
    Assert-ProtectedWindows $true $false
    Assert ((Get-Content -LiteralPath (Get-FlowCellStatusPath) -Raw) -match 'Restored 3 minimized') 'All-minimized fallback did not run'

    Reset-Scenario
    Add-Window 1 'FlowCell' $false $true
    Add-Window 2 'FlowCell - Utility'
    Add-Window 3 'Unrelated application'
    Add-Window 4 'FlowCell - Hidden' $false $false $false
    & $runToggle
    Assert-Calls @() 6
    Assert-ProtectedWindows $false $true
    Assert ((Get-Content -LiteralPath (Get-FlowCellStatusPath) -Raw) -match 'No additional') 'No-op status was not recorded'

    Reset-Scenario
    & $runToggle
    Assert-Calls @() 6
    Assert ((Get-Content -LiteralPath (Get-FlowCellStatusPath) -Raw) -match 'No additional') 'No windows should be a harmless no-op'

    Reset-Scenario
    Add-Window 1 'FlowCell'
    Add-Window 2 'FlowCell - Utility'
    Add-Window 3 'FlowCell - Page'
    Ensure-ParentDirectory (Get-FlowCellToggleStatePath)
    Set-Content -LiteralPath (Get-FlowCellToggleStatePath) -Value '{bad json' -Encoding UTF8
    & $runToggle
    Assert-Calls @(3) 6
    Assert-ProtectedWindows $false $false
    Assert ((Read-FlowCellToggleState).windows[0].handle -eq '3') 'Malformed prior state was not replaced'

    foreach ($source in @('', '0', '-5', 'invalid', '999999999999999999999999999')) {
        Reset-Scenario $source
        Add-Window 1 'FlowCell Development' $true
        Add-Window 2 'FlowCell - Button Popout'
        Add-Window 3 'FlowCell - Button Fan'
        & $runToggle
        Assert-Calls @(2, 3) 6
        Assert ([FlowCellWindowToggleNative]::Find([IntPtr]1).Minimized) 'Missing source context changed Development Main'
    }

    Reset-Scenario
    Add-Window 1 'FlowCell' $true
    Add-Window 2 'FlowCell - Utility'
    Add-Window 3 'FlowCell - Page' $false $true
    Set-SavedState @(@{ handle = '3'; title = 'FlowCell - Page' })
    & $runToggle
    Assert-Calls @() 9
    Assert ([FlowCellWindowToggleNative]::Find([IntPtr]3).Maximized) 'An already visible saved page was changed'
    Assert-ProtectedWindows $true $false

    "FlowCell toggle: $script:scenarioCount scenarios, $script:assertionCount assertions passed; native window calls were mocked."
}
catch {
    throw "Scenario $script:scenarioCount failed: $($_.Exception.Message)"
}
finally {
    $env:FLOWCELL_LOCAL_ROOT = $previousLocalRoot
    $env:FLOWCELL_SOURCE_HWND = $previousSource
    if (Test-Path -LiteralPath $testRoot) {
        $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
        $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if (-not $resolvedRoot.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup escaped TEMP.' }
        Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
}
