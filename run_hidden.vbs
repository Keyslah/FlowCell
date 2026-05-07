Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
target = root & "\FlowCell\run_hidden.vbs"

If Not fso.FileExists(target) Then
    WScript.Echo "FlowCell launcher was not found: " & target
    WScript.Quit 1
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & Chr(34) & WScript.Arguments(i) & Chr(34)
Next

shell.Run Chr(34) & target & Chr(34) & args, 0, False
