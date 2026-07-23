#Requires AutoHotkey v2.0
pipePath := "\\.\pipe\FlowCell.Illustrator.Bridge.v1"
if !DllCall("WaitNamedPipeW", "Str", pipePath, "UInt", 700)
    throw Error("pipe wait failed",, A_LastError)
handle := DllCall("CreateFileW", "Str", pipePath, "UInt", 0xC0000000, "UInt", 0, "Ptr", 0, "UInt", 3, "UInt", 0, "Ptr", 0, "Ptr")
if handle = -1
    throw Error("pipe open failed",, A_LastError)
try {
    request := '{"command":"ping","requestId":"ahk-native-ping"}' "`n"
    requestBuffer := Buffer(StrPut(request, "UTF-8"))
    requestLength := StrPut(request, requestBuffer, "UTF-8") - 1
    bytesWritten := 0
    if !DllCall("WriteFile", "Ptr", handle, "Ptr", requestBuffer.Ptr, "UInt", requestLength, "UIntP", &bytesWritten, "Ptr", 0)
        throw Error("pipe write failed",, A_LastError)
    responseBuffer := Buffer(4096, 0)
    bytesRead := 0
    if !DllCall("ReadFile", "Ptr", handle, "Ptr", responseBuffer.Ptr, "UInt", responseBuffer.Size, "UIntP", &bytesRead, "Ptr", 0)
        throw Error("pipe read failed",, A_LastError)
    response := StrGet(responseBuffer.Ptr, bytesRead, "UTF-8")
} finally {
    DllCall("CloseHandle", "Ptr", handle)
}
ExitApp(InStr(response, '"ok":true') ? 0 : 7)
