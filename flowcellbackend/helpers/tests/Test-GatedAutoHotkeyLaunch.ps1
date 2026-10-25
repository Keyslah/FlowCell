$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('FlowCell-GatedLaunch-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($fixture) | Out-Null
try {
    $launcher = Join-Path $fixture 'Start-FlowCellAutoHotkey.ps1'
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-FlowCellAutoHotkey.ps1') -Destination $launcher
    # The actual user state and all AutoHotkey processes are outside this fixture.
    @'
function Get-FlowCellAutoHotkeyState { [pscustomobject]@{Enabled = -not (Test-Path (Join-Path $PSScriptRoot 'off'))} }
function Enter-FlowCellAutoHotkeyLock { return 'fixture-lock' }
function Exit-FlowCellAutoHotkeyLock { param($Mutex) }
'@ | Set-Content -LiteralPath (Join-Path $fixture 'AutoHotkeyState.ps1') -Encoding UTF8
    $exe = Join-Path $fixture 'Argument probe.exe'
    Add-Type -TypeDefinition @'
using System;
using System.Text;
public static class FlowCellArgumentProbe {
    public static int Main(string[] args) {
        foreach (var arg in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg)));
        Console.Error.WriteLine("probe-stderr");
        return 7;
    }
}
'@ -OutputAssembly $exe -OutputType ConsoleApplication
    $values = @('C:\User Files\quoted "name"\action.ahk', '--out=C:\User Files\', '', ('--label=Unicode-' + [char]0x65e5), '$(literal)')
    $json = ConvertTo-Json -InputObject $values -Compress
    $hex = -join ([Text.Encoding]::UTF8.GetBytes($json) | ForEach-Object { $_.ToString('x2') })
    $stderr = Join-Path $fixture 'stderr.txt'
    $stdout = Join-Path $fixture 'stdout.txt'
    $nativeArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $launcher + '"'), '-ExecutablePath', ('"' + $exe + '"'), '-ArgumentsHex', $hex, '-WorkingDirectory', ('"' + $fixture + '"'))
    $process = Start-Process powershell.exe -ArgumentList $nativeArguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 7) { throw "Child exit was not preserved: $($process.ExitCode); $([IO.File]::ReadAllText($stderr))" }
    $actual = [IO.File]::ReadAllLines($stdout)
    $expected = @($values | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) })
    if (($actual -join '|') -cne ($expected -join '|')) { throw "Native arguments changed in the gated launcher. Expected: $($expected -join '|'); actual: $($actual -join '|')" }
    if ([IO.File]::ReadAllText($stderr).Trim() -ne 'probe-stderr') { throw 'Child stderr was not preserved.' }
    [IO.File]::WriteAllText((Join-Path $fixture 'off'), 'disabled')
    $process = Start-Process powershell.exe -ArgumentList $nativeArguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -eq 0 -or [IO.File]::ReadAllText($stdout).Length -gt 0 -or [IO.File]::ReadAllText($stderr) -notmatch 'AutoHotkey is OFF') {
        throw 'Manual OFF did not reject launch before process creation.'
    }
    Write-Output 'PASS: gated child rejects OFF; ON preserves spaces, quotes, trailing slash, empty/unicode/literal arguments, stdout, stderr and exit code.'
} finally {
    if ([IO.Path]::GetFullPath($fixture).StartsWith([IO.Path]::GetTempPath(), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
