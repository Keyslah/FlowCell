# Description: Runs DummyMonitorHelpers.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PythonExecutablePath {
    $pythonCandidates = @('python.exe', 'py.exe')

    foreach ($candidate in $pythonCandidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $resolvedPath = [string]$command.Source
            try {
                & $resolvedPath -c "import sys; print(sys.executable)" *> $null
                if ($LASTEXITCODE -eq 0) {
                    return $resolvedPath
                }
            }
            catch {
            }
        }
    }

    throw 'A working Python interpreter was not found for the dummy monitor helper. Install Python or fix py.exe/python.exe on PATH.'
}

function Get-DummyMonitorWorkspaceRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-DummyMonitorCodexRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
}

function Get-DummyMonitorToggleScriptCandidates {
    $candidates = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($env:FLOWCELL_DUMMY_MONITOR_SCRIPT)) {
        $candidates.Add([System.IO.Path]::GetFullPath($env:FLOWCELL_DUMMY_MONITOR_SCRIPT))
    }

    $workspaceRoot = Get-DummyMonitorWorkspaceRoot
    $codexRoot = Get-DummyMonitorCodexRoot
    foreach ($candidate in @(
        (Join-Path $workspaceRoot 'tools\dummy_monitor_toggle.py'),
        (Join-Path $workspaceRoot 'Windows\dummy_monitor_toggle.py'),
        (Join-Path $codexRoot 'computerideas\dummy_monitor_toggle.py')
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            $candidates.Add([System.IO.Path]::GetFullPath($candidate))
        }
    }

    return @($candidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
}

function Get-DummyMonitorToggleScriptPath {
    foreach ($candidate in @(Get-DummyMonitorToggleScriptCandidates)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [string]$candidate
        }
    }

    $codexRoot = Get-DummyMonitorCodexRoot
    $discovered = Get-ChildItem -Path $codexRoot -Filter 'dummy_monitor_toggle.py' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not [string]::IsNullOrWhiteSpace($discovered)) {
        return [string]$discovered
    }

    throw ('Dummy monitor toggle script was not found. Set FLOWCELL_DUMMY_MONITOR_SCRIPT or place dummy_monitor_toggle.py under {0}.' -f $codexRoot)
}

function Get-DummyMonitorTargetDisplay {
    if (-not [string]::IsNullOrWhiteSpace($env:FLOWCELL_DUMMY_MONITOR_TARGET_DISPLAY)) {
        return [string]$env:FLOWCELL_DUMMY_MONITOR_TARGET_DISPLAY
    }

    return '\\.\DISPLAY4'
}

function Get-DummyMonitorLogPath {
    return Join-Path $env:LOCALAPPDATA 'DummyMonitorToggle\dummy_monitor_toggle.log'
}

function Get-DummyMonitorLastLogLines {
    param(
        [int]$Tail = 14
    )

    $logPath = Get-DummyMonitorLogPath
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
        return ''
    }

    try {
        return ((Get-Content -LiteralPath $logPath -Tail $Tail) -join [Environment]::NewLine).Trim()
    }
    catch {
        return ''
    }
}

function Get-FlowCellLastActionStatusPath {
    $workspaceRoot = Get-DummyMonitorWorkspaceRoot
    return Join-Path $workspaceRoot 'FlowCell\local\logs\last_action_status.txt'
}

function Write-DummyMonitorStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    $statusPath = Get-FlowCellLastActionStatusPath
    $statusDir = Split-Path -Parent $statusPath
    if (-not (Test-Path -LiteralPath $statusDir -PathType Container)) {
        New-Item -ItemType Directory -Path $statusDir -Force | Out-Null
    }

    Set-Content -LiteralPath $statusPath -Value $Text -Encoding UTF8
}

function Invoke-DummyMonitorPython {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $pythonExe = Get-PythonExecutablePath
    $toggleScript = Get-DummyMonitorToggleScriptPath
    $output = & $pythonExe $toggleScript @Arguments 2>&1

    return [pscustomobject]@{
        PythonPath = [string]$pythonExe
        ScriptPath = [string]$toggleScript
        Output = @($output)
        ExitCode = [int]$LASTEXITCODE
    }
}
