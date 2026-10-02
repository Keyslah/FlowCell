<#
Purpose: Start only this root's backend with explicit installed/development ownership.
Context: Called by installed startup, frontend and development launchers, independent of cwd.
Inputs: Adjacent installed marker/runtime config. DefinitionsOnly is a fixture-only override.
Changes: Child process environment; Restart stops only this exact backend script.
Constraints: An installed backend at another resource root is never replaced implicitly.
#>
[CmdletBinding()]
param(
    [ValidateSet('installed','development')][string]$Role,
    [switch]$Restart,
    [switch]$DefinitionsOnly
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'FlowCellPaths.ps1') -AllowEnvironmentOverrides:$DefinitionsOnly
$resolvedRole = $env:FLOWCELL_BACKEND_ROLE
if ($Role -and $Role -ne $resolvedRole) { throw "Backend role '$Role' does not match resource root '$FlowCellResourceRoot' ($resolvedRole)." }
$backendScript = Join-Path $FlowCellResourceRoot 'flowcellbackend\FlowCellBackend.ahk'
$runtimeCandidates = @(
    (Join-Path $FlowCellResourceRoot 'flowcellbackend\runtime\AutoHotkey64.exe'),
    (Join-Path $FlowCellResourceRoot 'flowcellbackend\runtime\AutoHotkey.exe')
)
if ($resolvedRole -eq 'development') {
    $runtimeCandidates += @(
        (Join-Path $FlowCellResourceRoot 'flowcellbackend\local\bin\AutoHotkey64.exe'),
        (Join-Path $FlowCellResourceRoot 'flowcellbackend\local\bin\AutoHotkey.exe'),
        'C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe',
        'C:\Program Files\AutoHotkey\v2\AutoHotkey.exe'
    )
}
$runtime = $runtimeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$descriptor = [pscustomobject]@{
    Role = $resolvedRole
    ResourceRoot = $FlowCellResourceRoot
    LocalRoot = $FlowCellLocalRoot
    ProgramsRoot = $FlowCellProgramsRoot
    BackendScript = $backendScript
    Runtime = $runtime
    Arguments = @(('"' + $backendScript + '"'), '--headless', '--direct-script-receiver', "--backend-role=$resolvedRole")
}
if ($DefinitionsOnly) { return $descriptor }
try {
    if (-not (Test-Path -LiteralPath $backendScript -PathType Leaf)) { throw "Backend script missing: $backendScript" }
    if (-not $runtime) { throw "AutoHotkey v2 runtime missing for $resolvedRole FlowCell at $FlowCellResourceRoot." }
    $backendSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    $backends = @(Get-CimInstance Win32_Process -Filter "Name = 'AutoHotkey64.exe' Or Name = 'AutoHotkey.exe'" | Where-Object {
        $_.SessionId -eq $backendSessionId -and $_.CommandLine -and $_.CommandLine -match '(?i)FlowCellBackend\.ahk' -and $_.CommandLine.Contains('--headless')
    })
    if ($resolvedRole -eq 'installed') {
        $otherOwner = $backends | Where-Object {
            $_.CommandLine.Contains('--backend-role=installed') -and $_.CommandLine.IndexOf($backendScript, [StringComparison]::OrdinalIgnoreCase) -lt 0
        } | Select-Object -First 1
        if ($otherOwner) { throw "The installed background backend is already running from another installation (PID $($otherOwner.ProcessId)): $($otherOwner.CommandLine)" }
    }
    $owned = @($backends | Where-Object { $_.CommandLine.IndexOf($backendScript, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    if ($Restart) {
        $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
    } elseif ($owned.Count -gt 0) {
        return
    }
    Start-Process -FilePath $runtime -ArgumentList $descriptor.Arguments -WorkingDirectory (Split-Path -Parent $backendScript) -WindowStyle Hidden | Out-Null
} catch {
    $logRoot = Join-Path $FlowCellLocalRoot 'logs'
    [IO.Directory]::CreateDirectory($logRoot) | Out-Null
    Add-Content -LiteralPath (Join-Path $logRoot 'backend-launcher.log') -Value ("[{0}] {1}: {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $resolvedRole, $_.Exception.Message) -Encoding UTF8
    throw
}
