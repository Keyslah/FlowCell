Option Explicit

Dim shell, fileSystem, sourceFolder, watcherPath, sourcePath, powerShellPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

sourceFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
watcherPath = fileSystem.BuildPath(sourceFolder, "IllustratorSymmetryWatcher.ps1")
sourcePath = fileSystem.BuildPath(sourceFolder, "Illustrator Symmetry.jsx")
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")

If Not fileSystem.FileExists(watcherPath) Then
    WScript.Quit 2
End If
If Not fileSystem.FileExists(sourcePath) Then
    WScript.Quit 3
End If

command = QuoteArgument(powerShellPath) & _
    " -NoLogo -NoProfile -ExecutionPolicy Bypass -Sta -File " & QuoteArgument(watcherPath) & _
    " -SourcePath " & QuoteArgument(sourcePath)

shell.Run command, 0, False
WScript.Quit 0

Function QuoteArgument(ByVal value)
    QuoteArgument = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
