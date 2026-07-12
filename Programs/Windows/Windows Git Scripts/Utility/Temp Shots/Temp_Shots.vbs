' Description: Hidden launcher for Temp Shots screenshots.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
psScript = scriptDir & "\Temp Shots.ps1"

If Not fso.FileExists(psScript) Then
    MsgBox "Temp Shots is missing its owned Temp Shots.ps1 engine. Update this Button from the Temp Shots script package.", vbExclamation, "Temp Shots"
    WScript.Quit 1
End If

extraArgs = ""
waitForExit = False
For i = 0 To WScript.Arguments.Count - 1
    argument = LCase(WScript.Arguments(i))
    If argument = "--validate" Or argument = "-validateonly" Then
        extraArgs = extraArgs & " -ValidateOnly"
        waitForExit = True
    End If
Next

command = Chr(34) & psExe & Chr(34) & " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta -File " & Chr(34) & psScript & Chr(34) & extraArgs
exitCode = shell.Run(command, 0, waitForExit)
If waitForExit Then
    WScript.Quit exitCode
End If

WScript.Quit 0
