' Description: Runs run hidden.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
windowTitle = "FlowCell"
restoreScript = root & "\helpers\Restore-FlowCellWindow.ps1"
psExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
uiScript = root & "\FlowCellUI.ps1"

If fso.FileExists(restoreScript) Then
    restoreExitCode = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & restoreScript & """", 0, True)
    If restoreExitCode = 0 Then
        WScript.Quit 0
    End If
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
Next
shell.Run Chr(34) & psExe & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -STA -File " & Chr(34) & uiScript & Chr(34) & args, 0, False

For retry = 1 To 30
    WScript.Sleep 250
    If fso.FileExists(restoreScript) Then
        restoreExitCode = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & restoreScript & """", 0, True)
        If restoreExitCode = 0 Then
            Exit For
        End If
    End If
Next
