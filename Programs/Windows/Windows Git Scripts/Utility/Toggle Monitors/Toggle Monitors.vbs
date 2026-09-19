' Toggle Monitors launcher.
' Nothing here is hardcoded to one machine: on the first successful Button press
' it finds Python and opens the owned two-group checkbox picker. Both groups are
' remembered in this Button owner's runtime folder, then the owned Python engine
' toggles only between those two explicit physical-monitor combinations.

Option Explicit

Const CONFIGURATION_CANCELLED_EXIT_CODE = 3

Dim q : q = Chr(34)
Dim shell : Set shell = CreateObject("WScript.Shell")
Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

Dim scriptDir : scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' The owned Local Scripts package is runtime truth, including its engine.
Dim scriptPath : scriptPath = fso.BuildPath(scriptDir, "toggle_monitors.py")
Dim pickerPath : pickerPath = fso.BuildPath(scriptDir, "Toggle Monitors Picker.ps1")
Dim startupSafetyInstallerPath : startupSafetyInstallerPath = fso.BuildPath(scriptDir, "Install Startup Safety.ps1")

' Per-button mutable settings stay outside immutable source and survive Update.
Dim packageRoot : packageRoot = fso.GetParentFolderName(scriptDir)
Dim runtimeDir : runtimeDir = fso.BuildPath(packageRoot, "runtime")
Dim configPath : configPath = fso.BuildPath(runtimeDir, "toggle-monitors.txt")

Dim validateOnly : validateOnly = False
Dim forceConfigure : forceConfigure = False
Dim argument
For Each argument In WScript.Arguments
    If LCase(argument) = "--validate" Or LCase(argument) = "-validateonly" Then validateOnly = True
    If LCase(argument) = "--configure" Then forceConfigure = True
Next

If Not fso.FileExists(scriptPath) Then
    MsgBox "Toggle Monitors could not find toggle_monitors.py." & vbCrLf & _
           "Update this Button from the Toggle Monitors script package.", vbExclamation, "Toggle Monitors"
    WScript.Quit 1
End If
If Not fso.FileExists(pickerPath) Then
    MsgBox "Toggle Monitors could not find Toggle Monitors Picker.ps1." & vbCrLf & _
           "Update this Button from the Toggle Monitors script package.", vbExclamation, "Toggle Monitors"
    WScript.Quit 1
End If

If validateOnly Then
    ValidateLauncherContracts
    WScript.Quit 0
End If

Dim pythonwPath : pythonwPath = ResolvePythonw()
If pythonwPath = "" Then WScript.Quit 0

If Not ResolveMonitorGroups(pythonwPath, forceConfigure) Then WScript.Quit 0
RefreshStartupSafety pythonwPath

Dim command
command = q & pythonwPath & q & " " & q & scriptPath & q & _
    " --toggle-once --button-config " & q & configPath & q
shell.Run command, 0, False
WScript.Quit 0


Function ResolvePythonw()
    Dim configured : configured = ReadConfigValue("PYTHONW")
    If configured <> "" And fso.FileExists(configured) Then
        ResolvePythonw = configured
        Exit Function
    End If

    Dim detected : detected = DetectPythonw()
    If detected <> "" Then
        ResolvePythonw = detected
        Exit Function
    End If

    Dim entered, msg
    msg = "Toggle Monitors needs Python (pythonw.exe) to run, but it was not found automatically." & vbCrLf & vbCrLf & _
          "Enter the full path to pythonw.exe. It lives in your Python install folder, for example:" & vbCrLf & _
          "C:\Users\<you>\AppData\Local\Programs\Python\Python3xx\pythonw.exe"
    Do
        entered = InputBox(msg, "Toggle Monitors - locate Python", "")
        If entered = "" Then
            ResolvePythonw = ""
            Exit Function
        End If
        entered = Replace(Trim(entered), q, "")
        If fso.FileExists(entered) Then
            ResolvePythonw = entered
            Exit Function
        End If
        msg = "That file was not found. Enter the full path to pythonw.exe:"
    Loop
End Function

Function DetectPythonw()
    DetectPythonw = ""

    Dim found : found = WhereExe("pythonw.exe")
    If found <> "" Then
        DetectPythonw = found
        Exit Function
    End If

    Dim py : py = WhereExe("python.exe")
    If py <> "" Then
        Dim candidate : candidate = fso.BuildPath(fso.GetParentFolderName(py), "pythonw.exe")
        If fso.FileExists(candidate) Then
            DetectPythonw = candidate
        Else
            DetectPythonw = py
        End If
    End If
End Function

Function WhereExe(exeName)
    WhereExe = ""
    Dim tmp : tmp = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName())
    On Error Resume Next
    shell.Run "cmd /c where " & exeName & " > " & q & tmp & q & " 2>nul", 0, True
    On Error GoTo 0
    If Not fso.FileExists(tmp) Then Exit Function

    Dim stream, firstLine : firstLine = ""
    Set stream = fso.OpenTextFile(tmp, 1, False)
    If Not stream.AtEndOfStream Then firstLine = Trim(stream.ReadLine)
    stream.Close
    fso.DeleteFile tmp, True

    If firstLine <> "" And fso.FileExists(firstLine) Then WhereExe = firstLine
End Function


' ---- Two-group monitor selection -------------------------------------------

Function ResolveMonitorGroups(pythonwPath, forcePicker)
    ResolveMonitorGroups = False
    If Not forcePicker And HasConfiguredGroups() Then
        ResolveMonitorGroups = True
        Exit Function
    End If

    Dim command, exitCode
    command = q & pythonwPath & q & " " & q & scriptPath & q & _
        " --configure-button --button-config " & q & configPath & q & _
        " --pythonw-path " & q & pythonwPath & q
    exitCode = shell.Run(command, 0, True)
    If exitCode = CONFIGURATION_CANCELLED_EXIT_CODE Then Exit Function
    If exitCode <> 0 Then
        MsgBox "Toggle Monitors could not open or save its two monitor groups." & vbCrLf & _
               "No monitor settings were changed. Check toggle_monitors.log for details.", _
               vbExclamation, "Toggle Monitors"
        Exit Function
    End If

    ' The picker writes schema 3 only after Save.
    If HasConfiguredGroups() Then ResolveMonitorGroups = True
End Function


Sub RefreshStartupSafety(pythonwPath)
    If Not fso.FileExists(startupSafetyInstallerPath) Then Exit Sub

    Dim powershellPath : powershellPath = WindowsPowerShellPath()
    If Not fso.FileExists(powershellPath) Then Exit Sub

    Dim command
    command = q & powershellPath & q & _
        " -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " & q & startupSafetyInstallerPath & q & _
        " -ButtonConfigPath " & q & configPath & q & _
        " -PythonwPath " & q & pythonwPath & q
    shell.Run command, 0, False
End Sub

Function HasConfiguredGroups()
    HasConfiguredGroups = False
    If ReadConfigValue("SCHEMA") <> "3" Then Exit Function
    If ReadConfigValue("GROUP_1") = "" Then Exit Function
    If ReadConfigValue("GROUP_2") = "" Then Exit Function
    HasConfiguredGroups = True
End Function

Function WindowsPowerShellPath()
    WindowsPowerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & _
        "\System32\WindowsPowerShell\v1.0\powershell.exe"
End Function

Sub ValidateLauncherContracts()
    Dim launcherText : launcherText = ReadTextUtf8(WScript.ScriptFullName)
    If InStr(1, launcherText, "Option Explicit", vbBinaryCompare) = 0 Then
        Err.Raise vbObjectError + 2100, "Toggle Monitors validation", "UTF-8 launcher read did not return the expected source."
    End If
    If InStr(1, launcherText, "If exitCode = CONFIGURATION_CANCELLED_EXIT_CODE Then Exit Function", vbBinaryCompare) = 0 Then
        Err.Raise vbObjectError + 2104, "Toggle Monitors validation", "Picker cancellation is not guarded as a no-op."
    End If
    If Not fso.FileExists(pickerPath) Then
        Err.Raise vbObjectError + 2101, "Toggle Monitors validation", "The owned checkbox picker is missing."
    End If
    If Not fso.FileExists(startupSafetyInstallerPath) Then
        Err.Raise vbObjectError + 2105, "Toggle Monitors validation", "The owned startup-safety installer is missing."
    End If

    Dim powershellPath : powershellPath = WindowsPowerShellPath()
    If Not fso.FileExists(powershellPath) Then
        Err.Raise vbObjectError + 2102, "Toggle Monitors validation", "Windows PowerShell was not found."
    End If

    Dim command, exitCode
    command = q & powershellPath & q & _
        " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Sta -File " & q & pickerPath & q & " -ValidateOnly"
    exitCode = shell.Run(command, 0, True)
    If exitCode <> 0 Then
        Err.Raise vbObjectError + 2103, "Toggle Monitors validation", "The checkbox picker contract validation failed."
    End If
End Sub


' ---- Config + file helpers -------------------------------------------------

Function ReadConfigValue(key)
    ReadConfigValue = ""
    If Not fso.FileExists(configPath) Then Exit Function

    Dim content : content = ReadTextUtf8(configPath)
    content = Replace(content, vbCrLf, vbLf)
    content = Replace(content, vbCr, vbLf)

    Dim rawLines : rawLines = Split(content, vbLf)
    Dim i, line, prefix
    prefix = key & "="
    For i = 0 To UBound(rawLines)
        line = rawLines(i)
        If Left(line, Len(prefix)) = prefix Then
            ReadConfigValue = Trim(Mid(line, Len(prefix) + 1))
        End If
    Next
End Function

Function ReadTextUtf8(path)
    ReadTextUtf8 = ""
    Dim stream, failureNumber, failureDescription
    On Error Resume Next
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.LoadFromFile path
    ReadTextUtf8 = stream.ReadText(-1)
    If Err.Number = 0 Then stream.Close
    If Err.Number <> 0 Then
        failureNumber = Err.Number
        failureDescription = Err.Description
        Err.Clear
    End If
    On Error GoTo 0
    If failureNumber <> 0 Then
        Err.Raise failureNumber, "Toggle Monitors UTF-8 reader", failureDescription
    End If
End Function
