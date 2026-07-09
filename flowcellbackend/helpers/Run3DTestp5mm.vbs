' Description: Runs Run3DTestp5mm.
Dim shell
Dim fso
Dim root
Dim ps
Dim tempPath
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
tempPath = shell.ExpandEnvironmentStrings("%TEMP%") & "\Illustrator_3D_Test_p5mm.signal.txt"

command = """" & ps & """" _
    & " -NoProfile -ExecutionPolicy Bypass -File " _
    & """" & root & "\RunRecordedMacro.ps1""" _
    & " -Label ""p5mm""" _
    & " -SignalPath " _
    & """" & tempPath & """"

shell.Run command, 0, False
