' Toggle Monitors launcher.
' Nothing here is hardcoded to one machine: it finds Python and asks which single
' monitor to toggle to the first time it runs, then remembers that choice in a
' runtime file inside this Button's owned Local Scripts package. Each button
' keeps its own choice, so several Buttons can target different monitors.

Option Explicit

Dim q : q = Chr(34)
Dim shell : Set shell = CreateObject("WScript.Shell")
Dim fso : Set fso = CreateObject("Scripting.FileSystemObject")

Dim scriptDir : scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' The owned Local Scripts package is runtime truth, including its engine.
Dim scriptPath : scriptPath = fso.BuildPath(scriptDir, "toggle_monitors.py")

' Per-button mutable settings stay outside immutable source and survive Update.
Dim packageRoot : packageRoot = fso.GetParentFolderName(scriptDir)
Dim runtimeDir : runtimeDir = fso.BuildPath(packageRoot, "runtime")
Dim configPath : configPath = fso.BuildPath(runtimeDir, "toggle-monitors.txt")

Dim validateOnly : validateOnly = False
Dim argument
For Each argument In WScript.Arguments
    If LCase(argument) = "--validate" Or LCase(argument) = "-validateonly" Then validateOnly = True
Next

If Not fso.FileExists(scriptPath) Then
    MsgBox "Toggle Monitors could not find toggle_monitors.py." & vbCrLf & _
           "Update this Button from the Toggle Monitors script package.", vbExclamation, "Toggle Monitors"
    WScript.Quit 1
End If

If validateOnly Then WScript.Quit 0

Dim pythonwPath : pythonwPath = ResolvePythonw()
If pythonwPath = "" Then WScript.Quit 1

Dim targetDisplay : targetDisplay = ResolveTargetDisplay(pythonwPath)
If targetDisplay = "" Then WScript.Quit 1

Dim command
command = q & pythonwPath & q & " " & q & scriptPath & q & _
    " --toggle-once --target-display " & q & targetDisplay & q
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
        WriteConfig detected, ReadConfigValue("DISPLAY")
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
            WriteConfig entered, ReadConfigValue("DISPLAY")
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


' ---- Monitor selection -----------------------------------------------------

Function ResolveTargetDisplay(pythonwPath)
    Dim configured : configured = ReadConfigValue("DISPLAY")
    If configured <> "" Then
        ResolveTargetDisplay = configured
        Exit Function
    End If

    Dim labels(), selectors(), count
    count = LoadDisplays(pythonwPath, labels, selectors)
    If count = 0 Then
        MsgBox "Toggle Monitors could not detect any monitors to choose from.", vbExclamation, "Toggle Monitors"
        ResolveTargetDisplay = ""
        Exit Function
    End If

    Dim menu, i
    menu = "Which monitor do you want to toggle to?" & vbCrLf & _
           "(Clicking the button switches to this monitor alone, then back. Pick it by number.)" & vbCrLf & vbCrLf
    For i = 0 To count - 1
        menu = menu & (i + 1) & ". " & labels(i) & vbCrLf
    Next

    Dim choiceText, choiceNum
    Do
        choiceText = InputBox(menu, "Toggle Monitors - choose monitor", "1")
        If choiceText = "" Then
            ResolveTargetDisplay = ""
            Exit Function
        End If
        If IsNumeric(choiceText) Then
            choiceNum = CLng(choiceText)
            If choiceNum >= 1 And choiceNum <= count Then
                WriteConfig ReadConfigValue("PYTHONW"), selectors(choiceNum - 1)
                ResolveTargetDisplay = selectors(choiceNum - 1)
                Exit Function
            End If
        End If
    Loop
End Function

Function LoadDisplays(pythonwPath, ByRef labels, ByRef selectors)
    LoadDisplays = 0
    Dim tmp : tmp = fso.BuildPath(fso.GetSpecialFolder(2), fso.GetTempName())
    Dim cmd
    cmd = q & pythonwPath & q & " " & q & scriptPath & q & " --list-displays --out " & q & tmp & q
    shell.Run cmd, 0, True
    If Not fso.FileExists(tmp) Then Exit Function

    Dim content : content = ReadTextUtf8(tmp)
    fso.DeleteFile tmp, True

    content = Replace(content, vbCrLf, vbLf)
    content = Replace(content, vbCr, vbLf)
    Dim rawLines : rawLines = Split(content, vbLf)
    ReDim labels(UBound(rawLines))
    ReDim selectors(UBound(rawLines))

    Dim i, n, parts, line : n = 0
    For i = 0 To UBound(rawLines)
        line = Trim(rawLines(i))
        If line <> "" Then
            parts = Split(line, vbTab)
            If UBound(parts) >= 1 Then
                labels(n) = parts(0)
                selectors(n) = parts(1)
            Else
                labels(n) = line
                selectors(n) = line
            End If
            n = n + 1
        End If
    Next
    LoadDisplays = n
End Function


' ---- Config + file helpers -------------------------------------------------

Function ReadConfigValue(key)
    ReadConfigValue = ""
    If Not fso.FileExists(configPath) Then Exit Function

    Dim stream, line, prefix
    prefix = key & "="
    Set stream = fso.OpenTextFile(configPath, 1, False)
    Do Until stream.AtEndOfStream
        line = stream.ReadLine
        If Left(line, Len(prefix)) = prefix Then
            ReadConfigValue = Trim(Mid(line, Len(prefix) + 1))
        End If
    Loop
    stream.Close
End Function

Sub WriteConfig(pythonwVal, displayVal)
    Dim stream
    If Not fso.FolderExists(runtimeDir) Then fso.CreateFolder runtimeDir
    Set stream = fso.OpenTextFile(configPath, 2, True)
    stream.WriteLine "# Toggle Monitors - this button's saved choices."
    stream.WriteLine "# Delete this file to make this button ask for its monitor again."
    stream.WriteLine "PYTHONW=" & pythonwVal
    stream.WriteLine "DISPLAY=" & displayVal
    stream.Close
End Sub

Function ReadTextUtf8(path)
    ReadTextUtf8 = ""
    Dim stream
    On Error Resume Next
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2
    stream.Charset = "utf-8"
    stream.Open
    stream.LoadFromFile path
    ReadTextUtf8 = stream.ReadText(-1)
    stream.Close
    On Error GoTo 0
End Function
