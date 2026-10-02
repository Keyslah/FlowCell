' Description: Starts the backend belonging to this resource root with explicit role and paths.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = root & "\helpers\Start-FlowCellBackend.ps1"
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(launcher) Then WScript.Quit 1
result = shell.Run(Chr(34) & powershell & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & launcher & Chr(34), 0, True)
WScript.Quit result
