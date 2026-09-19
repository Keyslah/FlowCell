' Purpose: Start this installed package's PowerShell updater hidden, with its progress UI.
' Context/inputs: Own file location, no arguments or selected-program state.
' Writes: Helper permits only owning catalog and recovery metadata changes.
' Conflicts/deletion: Preserves local edits; recycles unchanged upstream deletions.
' Constraints: No checkout, Git, login, or optional Windows package dependency.
Option Explicit
Dim shell, fso, root, ps, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
command = Chr(34) & ps & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -STA -File " & Chr(34) & root & "\Update-Catalog.ps1" & Chr(34) & " -PackageRoot " & Chr(34) & root & Chr(34) & " -ShowUi"
shell.Run command, 0, False
