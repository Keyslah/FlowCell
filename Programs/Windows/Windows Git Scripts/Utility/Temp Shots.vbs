' Description: Hidden launcher for Temp Shots screenshots.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
windowsRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(windowsRoot))
psExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
psScript = windowsRoot & "\Windows Git Scripts\Utility\Temp Shots.ps1"

If Not fso.FileExists(psScript) Then
    psScript = scriptDir & "\Temp Shots.ps1"
End If

If Not fso.FileExists(psScript) Then
    psScript = windowsRoot & "\Windows Local Scripts\Temp Shots.ps1"
End If

If Not fso.FileExists(psScript) Then
    statusPath = repoRoot & "\flowcellbackend\local\logs\last_action_status.txt"
    statusDir = fso.GetParentFolderName(statusPath)
    If Not fso.FolderExists(statusDir) Then
        fso.CreateFolder(statusDir)
    End If
    Set statusFile = fso.CreateTextFile(statusPath, True, True)
    statusFile.Write "Temp Shots failed: Temp Shots.ps1 was not found."
    statusFile.Close
    WScript.Quit 1
End If

extraArgs = ""
For i = 0 To WScript.Arguments.Count - 1
    argument = WScript.Arguments(i)
    If LCase(argument) = "--validate" Or LCase(argument) = "-validateonly" Then
        extraArgs = extraArgs & " -ValidateOnly"
    End If
Next

command = Chr(34) & psExe & Chr(34) & " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta -File " & Chr(34) & psScript & Chr(34) & extraArgs
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
