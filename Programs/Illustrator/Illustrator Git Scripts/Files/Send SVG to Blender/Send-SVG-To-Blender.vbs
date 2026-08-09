Option Explicit

Dim q : q = Chr(34)
Dim shell : Set shell = CreateObject("WScript.Shell")
Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

Dim scriptDir : scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Dim packageRoot : packageRoot = fso.GetParentFolderName(scriptDir)
Dim runtimeDir : runtimeDir = fso.BuildPath(packageRoot, "runtime")
Dim requestPath : requestPath = fso.BuildPath(runtimeDir, "send-svg-to-blender.request.json")
Dim powerShellScript : powerShellScript = fso.BuildPath(scriptDir, "Send-SVG-To-Blender.ps1")
Dim powerShellExe : powerShellExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & _
    "\System32\WindowsPowerShell\v1.0\powershell.exe"

If Not fso.FileExists(powerShellScript) Then
    MsgBox "Send SVG to Blender is missing Send-SVG-To-Blender.ps1. " & _
        "Update this Button from its script package.", vbExclamation, "Send SVG to Blender"
    WScript.Quit 1
End If

If Not fso.FileExists(requestPath) Then
    MsgBox "Send SVG to Blender could not find its Illustrator export request.", _
        vbExclamation, "Send SVG to Blender"
    WScript.Quit 1
End If

Dim command
command = q & powerShellExe & q & _
    " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
    q & powerShellScript & q & " -RequestPath " & q & requestPath & q

shell.Run command, 0, False
WScript.Quit 0
