' Description: Runs run backend hidden.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")

root = fso.GetParentFolderName(WScript.ScriptFullName)
backendScript = root & "\FlowCellBackend.ahk"
ahkExe = "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
backendFound = False

If Not fso.FileExists(ahkExe) Then
    ahkExe = "C:\Program Files\AutoHotkey\v2\AutoHotkey.exe"
End If

For Each proc In wmi.ExecQuery("Select ProcessId, Name, CommandLine From Win32_Process Where Name = 'AutoHotkey64.exe' Or Name = 'AutoHotkey.exe'")
    commandLine = ""
    On Error Resume Next
    commandLine = proc.CommandLine
    On Error GoTo 0
    If InStr(1, commandLine, backendScript, vbTextCompare) > 0 And InStr(1, commandLine, "--headless", vbTextCompare) > 0 Then
        backendFound = True
        Exit For
    End If
Next

If backendFound Then
    WScript.Quit 0
End If

shell.Run Chr(34) & ahkExe & Chr(34) & " /ErrorStdOut " & Chr(34) & backendScript & Chr(34) & " --headless", 0, False
