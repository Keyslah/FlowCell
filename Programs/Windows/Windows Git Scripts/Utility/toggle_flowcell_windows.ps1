# Description: Toggle FlowCell popouts, fans and pages, leaving Main and the launching window unchanged.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class FlowCellWindowToggleNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

}
"@

function Find-FlowCellRoot([string]$StartPath) {
    $currentPath = [System.IO.Path]::GetFullPath($StartPath)
    while (-not [string]::IsNullOrWhiteSpace($currentPath) -and (Test-Path -LiteralPath $currentPath -PathType Container)) {
        $summaryPath = Join-Path $currentPath 'PROGRAM_SUMMARY.txt'
        $flowCellPath = Join-Path $currentPath 'FlowCell'
        if ((Test-Path -LiteralPath $summaryPath -PathType Leaf) -and (Test-Path -LiteralPath $flowCellPath -PathType Container)) {
            return $currentPath
        }

        $parentPath = Split-Path -Parent $currentPath
        if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
            break
        }

        $currentPath = $parentPath
    }

    throw 'Could not locate the FlowCell repository root for the FlowCell window toggle.'
}

function Get-FlowCellLocalRoot {
    if ($env:FLOWCELL_LOCAL_ROOT) { return $env:FLOWCELL_LOCAL_ROOT }
    $repoRoot = Find-FlowCellRoot -StartPath $PSScriptRoot
    return Join-Path $repoRoot 'flowcellbackend\local'
}

function Get-FlowCellStatusPath {
    return Join-Path (Get-FlowCellLocalRoot) 'logs\last_action_status.txt'
}

function Get-FlowCellToggleStatePath {
    return Join-Path (Get-FlowCellLocalRoot) 'windows\flowcell_window_toggle_state.json'
}

function Ensure-ParentDirectory([string]$Path) {
    $parentPath = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parentPath) -and -not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        New-Item -ItemType Directory -Path $parentPath -Force | Out-Null
    }
}

function Write-FlowCellStatus([string]$Text) {
    $statusPath = Get-FlowCellStatusPath
    Ensure-ParentDirectory -Path $statusPath
    Set-Content -LiteralPath $statusPath -Value $Text -Encoding UTF8
}

function Test-IsFlowCellWindowTitle([string]$Title) {
    if ([string]::IsNullOrWhiteSpace($Title)) {
        return $false
    }

    return $Title.StartsWith('FlowCell - ', [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-WindowTitle([IntPtr]$Handle) {
    $titleBuilder = New-Object System.Text.StringBuilder 512
    [void][FlowCellWindowToggleNative]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity)
    return $titleBuilder.ToString()
}

function Get-OpenFlowCellWindows {
    $script:FlowCellWindowToggleMatches = New-Object System.Collections.ArrayList
    $script:FlowCellWindowToggleEnumProc = [FlowCellWindowToggleNative+EnumWindowsProc]{
        param([IntPtr]$hWnd, [IntPtr]$lParam)

        $isVisible = [FlowCellWindowToggleNative]::IsWindowVisible($hWnd)
        $isMinimized = [FlowCellWindowToggleNative]::IsIconic($hWnd)
        if (-not $isVisible -and -not $isMinimized) {
            return $true
        }

        $title = Get-WindowTitle -Handle $hWnd
        if (-not (Test-IsFlowCellWindowTitle -Title $title)) {
            return $true
        }

        [void]$script:FlowCellWindowToggleMatches.Add([pscustomobject]@{
                Handle = $hWnd
                HandleKey = $hWnd.ToString()
                Title = $title
                IsMinimized = $isMinimized
            })

        return $true
    }

    [void][FlowCellWindowToggleNative]::EnumWindows($script:FlowCellWindowToggleEnumProc, [IntPtr]::Zero)

    return @(
        $script:FlowCellWindowToggleMatches |
            Sort-Object @{ Expression = { $_.Title.ToLowerInvariant() } }
    )
}

function Read-FlowCellToggleState {
    $statePath = Get-FlowCellToggleStatePath
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return $null
    }

    try {
        $raw = Get-Content -LiteralPath $statePath -Raw
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return $null
        }

        return $raw | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Write-FlowCellToggleState($Windows) {
    $statePath = Get-FlowCellToggleStatePath
    Ensure-ParentDirectory -Path $statePath

    $state = [pscustomobject]@{
        savedAt = (Get-Date).ToString('o')
        windows = @(
            @($Windows) | ForEach-Object {
                [pscustomobject]@{
                    handle = $_.HandleKey
                    title = $_.Title
                }
            }
        )
    }

    Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 4) -Encoding UTF8
}

function Clear-FlowCellToggleState {
    $statePath = Get-FlowCellToggleStatePath
    Ensure-ParentDirectory -Path $statePath

    $state = [pscustomobject]@{
        savedAt = ''
        windows = @()
    }

    Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 3) -Encoding UTF8
}

function Resolve-SavedFlowCellWindows($OpenWindows, $State) {
    if ($null -eq $State -or $null -eq $State.windows) {
        return @()
    }

    $openWindowsByHandle = @{}
    foreach ($window in @($OpenWindows)) {
        $openWindowsByHandle[[string]$window.HandleKey] = $window
    }

    $matches = @()
    foreach ($entry in @($State.windows)) {
        if ($null -eq $entry) {
            continue
        }

        $handleKey = [string]$entry.handle
        if ([string]::IsNullOrWhiteSpace($handleKey)) {
            continue
        }

        if ($openWindowsByHandle.ContainsKey($handleKey)) {
            $window = $openWindowsByHandle[$handleKey]
            if ($window.Title -eq [string]$entry.title) {
                $matches += $window
            }
        }
    }

    return @($matches)
}

function Get-ToggleableFlowCellWindows($Windows) {
    # The runner supplies the actual calling webview, even when the click does
    # not activate it. Foreground-window guesses can hide the toggle itself.
    $sourceHandle = 0L
    [void][long]::TryParse($env:FLOWCELL_SOURCE_HWND, [ref]$sourceHandle)
    return @(@($Windows) | Where-Object {
        $null -ne $_ -and (Test-IsFlowCellWindowTitle -Title $_.Title) -and
        ($sourceHandle -le 0 -or $_.HandleKey -ne [string]$sourceHandle)
    })
}

function Restore-FlowCellWindows($Windows) {
    $windowList = @($Windows)
    if ($windowList.Count -eq 0) {
        return
    }

    foreach ($window in $windowList) {
        if ($window.IsMinimized) {
            [void][FlowCellWindowToggleNative]::ShowWindowAsync($window.Handle, 9)
        }
    }
}

function Minimize-FlowCellWindows($Windows) {
    $windowList = @($Windows)
    if ($windowList.Count -eq 0) {
        return
    }

    foreach ($window in @($windowList | Sort-Object @{ Expression = { $_.Title.ToLowerInvariant() } })) {
        [void][FlowCellWindowToggleNative]::ShowWindowAsync($window.Handle, 6)
    }
}

try {
    $secondaryWindows = @(Get-ToggleableFlowCellWindows (Get-OpenFlowCellWindows))
    $savedState = Read-FlowCellToggleState
    $savedWindows = @(Resolve-SavedFlowCellWindows $secondaryWindows $savedState)

    if ($savedWindows.Count -gt 0) {
        Restore-FlowCellWindows $savedWindows
        Clear-FlowCellToggleState
        Write-FlowCellStatus ('Restored {0} FlowCell utility window(s).' -f $savedWindows.Count)
        return
    }

    $savedStateCount = if ($null -ne $savedState -and $null -ne $savedState.windows) { @($savedState.windows).Count } else { 0 }
    if ($savedStateCount -gt 0) {
        Clear-FlowCellToggleState
    }

    $windowsToMinimize = @($secondaryWindows | Where-Object { -not $_.IsMinimized })
    if ($windowsToMinimize.Count -eq 0) {
        $minimizedSecondaryWindows = @($secondaryWindows | Where-Object { $_.IsMinimized })
        if ($minimizedSecondaryWindows.Count -gt 0) {
            Restore-FlowCellWindows $minimizedSecondaryWindows
            Clear-FlowCellToggleState
            Write-FlowCellStatus ('Restored {0} minimized FlowCell utility window(s).' -f $minimizedSecondaryWindows.Count)
            return
        }

        Write-FlowCellStatus 'No additional FlowCell windows are open to toggle.'
        return
    }

    Minimize-FlowCellWindows $windowsToMinimize
    Write-FlowCellToggleState $windowsToMinimize
    Write-FlowCellStatus ('Minimized {0} FlowCell utility window(s). Run the button again to restore them.' -f $windowsToMinimize.Count)
}
catch {
    $message = $_.Exception.Message
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = 'FlowCell window toggle failed.'
    }

    Write-FlowCellStatus $message
    throw
}
