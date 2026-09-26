' Description: Hidden launcher for repeated fixed-box snapshots.
Option Explicit
Dim shell, scriptDir, command
Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\Snapshots.ps1"""
shell.Run command, 0, False
