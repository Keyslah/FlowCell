Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
target = root & "\FlowCell\run_backend_hidden.vbs"

If Not fso.FileExists(target) Then
    WScript.Echo "FlowCell backend launcher was not found: " & target
    WScript.Quit 1
End If

shell.Run Chr(34) & target & Chr(34), 0, False
