Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "dummy_monitor_toggle.py")
pythonwPath = "C:\Users\aaron\AppData\Local\Programs\Python\Python311\pythonw.exe"
command = """" & pythonwPath & """ """ & scriptPath & """ --toggle-once --target-display ""AOC28E850.HDR"""
shell.Run command, 0, False
