' Description: Runs the FlowCell Tauri frontend hidden.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
psExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
frontendScript = root & "\helpers\Start-FlowCellFrontend.ps1"

If Not fso.FileExists(frontendScript) Then
    WScript.Echo "FlowCell frontend launcher was not found: " & frontendScript
    WScript.Quit 1
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
Next
shell.Run Chr(34) & psExe & Chr(34) & " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & frontendScript & Chr(34) & args, 0, False
