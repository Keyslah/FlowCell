#Requires AutoHotkey v2.0
#SingleInstance Off
#Include %A_ScriptDir%\..\..\..\flowcellbackend\helpers\TempShotsCapture.ahk

; Invoke only geometry, naming, cancellation without a GUI, and the encoder.
; Clipboard payloads go to an in-memory mock, never to the real clipboard.
; The production capture entry point and native clipboard writer are never invoked.
assertions := 0

Assert(condition, message) {
    global assertions
    if !condition
        throw Error(message)
    assertions += 1
}

AssertRectangle(rect, x, y, width, height, message) {
    Assert(rect.x = x && rect.y = y && rect.width = width && rect.height = height, message)
}

NewSyntheticBitmap(width, height) {
    info := Buffer(40, 0)
    NumPut("UInt", 40, "Int", width, "Int", -height, "UShort", 1, "UShort", 32, info)
    bits := 0
    bitmap := DllCall("gdi32\CreateDIBSection", "Ptr", 0, "Ptr", info, "UInt", 0, "Ptr*", &bits, "Ptr", 0, "UInt", 0, "Ptr")
    if !bitmap || !bits
        throw Error("Could not allocate the synthetic bitmap.")
    ; Every pixel is RGB(204,68,34); all source data is synthetic memory.
    Loop width * height
        NumPut("UInt", 0x00CC4422, bits, (A_Index - 1) * 4)
    return bitmap
}

class SyntheticClipboardWriter {
    __New(path) {
        this.path := path
        this.writes := []
    }

    Call(dib, png) {
        Assert(FileExist(this.path), "Clipboard publication ran before the destination image was saved.")
        this.writes.Push({dib: dib, png: png})
    }
}

AssertClipboardImage(writer, width, height) {
    Assert(writer.writes.Length = 1, "The completed capture was not copied exactly once.")
    payload := writer.writes[1]
    dib := payload.dib
    stride := (width * 3 + 3) & ~3
    Assert(dib.Size = 40 + stride * height, "The clipboard image has an incorrect buffer size.")
    Assert(NumGet(dib, 0, "UInt") = 40, "The clipboard image has no BITMAPINFOHEADER.")
    Assert(NumGet(dib, 4, "Int") = width && NumGet(dib, 8, "Int") = height, "The clipboard image has incorrect dimensions or orientation.")
    Assert(NumGet(dib, 12, "UShort") = 1 && NumGet(dib, 14, "UShort") = 24, "The clipboard image is not a 24-bit image with one plane.")
    Assert(NumGet(dib, 16, "UInt") = 0, "The clipboard image is not uncompressed BI_RGB.")
    Loop height {
        row := A_Index - 1
        Loop width {
            offset := 40 + row * stride + (A_Index - 1) * 3
            Assert(NumGet(dib, offset, "UChar") = 34 && NumGet(dib, offset + 1, "UChar") = 68 && NumGet(dib, offset + 2, "UChar") = 204, "The clipboard image differs from the saved synthetic crop.")
        }
    }
    png := payload.png
    saved := FileRead(writer.path, "RAW")
    Assert(png.Size > 24 && NumGet(png, 0, "UInt64") = 0x0A1A0A0D474E5089, "The clipboard PNG format does not contain PNG image bytes.")
    Assert(png.Size = saved.Size && DllCall("msvcrt\memcmp", "Ptr", png, "Ptr", saved, "UPtr", saved.Size, "Int") = 0, "The clipboard PNG differs from the sole destination file.")
}

try {
    if A_Args.Length != 1
        throw Error("Supply the unique disposable fixture directory created by the PowerShell test.")
    fixture := RTrim(A_Args[1], "\/")
    prefix := RTrim(A_Temp, "\/") "\flowcell-temp-shots-tests-"
    if StrLower(SubStr(fixture, 1, StrLen(prefix))) != StrLower(prefix) || !DirExist(fixture) || InStr(fixture, "..")
        throw Error("Refusing an unexpected fixture directory.")

    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(2, 1, 6, 4, 8, 6), 2, 1, 4, 3, "Forward rectangle is incorrect.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(6, 4, 2, 1, 8, 6), 2, 1, 4, 3, "Reverse rectangle is incorrect.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(6, 1, 2, 4, 8, 6), 2, 1, 4, 3, "Mixed-direction rectangle is incorrect.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(-3, -2, 12, 10, 8, 6), 0, 0, 8, 6, "The rectangle was not clamped to the bitmap.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(12, 10, -3, -2, 8, 6), 0, 0, 8, 6, "A reverse out-of-bounds rectangle was not clamped.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(2, 1, 2, 4, 8, 6), 2, 1, 0, 3, "A zero-width selection was not retained as empty.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(2, 1, 6, 1, 8, 6), 2, 1, 4, 0, "A zero-height selection was not retained as empty.")
    AssertRectangle(FlowCellTempShotsCapture.NormalizeRectangle(1, 1, 8, 6, 0, 0), 0, 0, 0, 0, "An empty bitmap has a nonempty rectangle.")

    names := fixture "\names"
    DirCreate names
    first := FlowCellTempShotsCapture.NextPath(names, "fixed")
    Assert(first = names "\temp-shot-fixed.png", "The initial destination name is incorrect.")
    FileAppend "first placeholder", first, "UTF-8-RAW"
    second := FlowCellTempShotsCapture.NextPath(names "\", "fixed")
    Assert(second = names "\temp-shot-fixed-01.png", "The first collision suffix is incorrect.")
    FileAppend "second placeholder", second, "UTF-8-RAW"
    third := FlowCellTempShotsCapture.NextPath(names, "fixed")
    Assert(third = names "\temp-shot-fixed-02.png", "The second collision suffix is incorrect.")
    Assert(FileRead(first, "UTF-8") = "first placeholder" && FileRead(second, "UTF-8") = "second placeholder", "Naming changed an existing fixture.")
    Assert(!FileExist(third), "Choosing a destination unexpectedly wrote a file.")
    snapshotName := FlowCellTempShotsCapture.NextPath(names, "fixed", "snapshot")
    Assert(snapshotName = names "\snapshot-fixed.png", "Snapshots did not use their own filename prefix.")
    FileAppend "snapshot placeholder", snapshotName, "UTF-8-RAW"
    Assert(FlowCellTempShotsCapture.NextPath(names, "fixed", "snapshot") = names "\snapshot-fixed-01.png", "Snapshots cannot retain shots taken within one second.")

    captureFolder := fixture "\capture"
    DirCreate captureFolder
    output := FlowCellTempShotsCapture.NextPath(captureFolder, "synthetic")
    clipboardWriter := SyntheticClipboardWriter(output)
    bitmap := NewSyntheticBitmap(8, 6)
    try {
        rectangle := FlowCellTempShotsCapture.NormalizeRectangle(6, 4, 2, 1, 8, 6)
        FlowCellTempShotsCapture.SaveBitmapArea(bitmap, rectangle, output, clipboardWriter)
        beforeOverwrite := FileRead(output, "RAW")
        refusedOverwrite := false
        try FlowCellTempShotsCapture.SaveBitmapArea(bitmap, rectangle, output, clipboardWriter)
        catch
            refusedOverwrite := true
        Assert(refusedOverwrite, "The encoder did not refuse an existing output path.")
        Assert(clipboardWriter.writes.Length = 1, "A refused overwrite copied an image to the clipboard mock.")
        afterOverwrite := FileRead(output, "RAW")
        Assert(beforeOverwrite.Size = afterOverwrite.Size && DllCall("msvcrt\memcmp", "Ptr", beforeOverwrite, "Ptr", afterOverwrite, "UPtr", beforeOverwrite.Size, "Int") = 0, "The existing PNG was modified.")
    } finally {
        DllCall("gdi32\DeleteObject", "Ptr", bitmap)
    }
    AssertClipboardImage(clipboardWriter, 4, 3)
    Assert(FileExist(output) && FileGetSize(output) > 0, "The synthetic crop did not produce a PNG.")
    fileCount := 0
    Loop Files captureFolder "\*", "F"
        fileCount += 1
    Assert(fileCount = 1, "The synthetic capture wrote more than one destination file.")

    ; A three-pixel row requires padding in CF_DIB; keep this separate from the
    ; first synthetic capture so each capture still has exactly one image file.
    paddedFolder := fixture "\padded"
    DirCreate paddedFolder
    paddedOutput := FlowCellTempShotsCapture.NextPath(paddedFolder, "synthetic")
    paddedWriter := SyntheticClipboardWriter(paddedOutput)
    paddedBitmap := NewSyntheticBitmap(8, 6)
    try FlowCellTempShotsCapture.SaveBitmapArea(paddedBitmap, {x: 1, y: 1, width: 3, height: 2}, paddedOutput, paddedWriter)
    finally DllCall("gdi32\DeleteObject", "Ptr", paddedBitmap)
    AssertClipboardImage(paddedWriter, 3, 2)
    paddedFileCount := 0
    Loop Files paddedFolder "\*", "F"
        paddedFileCount += 1
    Assert(paddedFileCount = 1, "The padded clipboard capture produced more than one image file.")

    snapshotSession := FlowCellTempShotsCapture()
    snapshotSession.folder := fixture "\temp-shots"
    DirCreate snapshotSession.folder
    snapshotSession.left := -100
    snapshotSession.top := 20
    snapshotSession.mode := "snapshots"
    snapshotSession.BeginSnapshots({x: 5, y: 6, width: 3, height: 2})
    Assert(snapshotSession.snapshotActive && snapshotSession.snapshotRegistered, "The Snapshots key session did not start.")
    Assert(snapshotSession.snapshotRect.x = -95 && snapshotSession.snapshotRect.y = 26, "The remembered box lost its physical desktop coordinates.")
    Assert(snapshotSession.snapshotFolder = fixture "\snapshots" && DirExist(snapshotSession.snapshotFolder), "The Snapshots folder is not beside Temp Shots.")
    snapshotSession.Cancel()
    Assert(!snapshotSession.snapshotActive && !snapshotSession.snapshotRegistered, "Escape cleanup did not stop the Snapshots key session.")

    cancelFolder := fixture "\cancel"
    DirCreate cancelFolder
    cancelled := FlowCellTempShotsCapture()
    cancelled.folder := cancelFolder
    cancelledBitmap := NewSyntheticBitmap(2, 2)
    cancelled.bitmap := cancelledBitmap
    cancelled.active := true
    cancelled.Cancel()
    Assert(!cancelled.active && cancelled.bitmap = 0 && !IsObject(cancelled.window), "Cancellation did not clear the inactive selection state.")
    objectInfo := Buffer(32, 0)
    Assert(DllCall("gdi32\GetObjectW", "Ptr", cancelledBitmap, "Int", objectInfo.Size, "Ptr", objectInfo, "Int") = 0, "Cancellation did not release the synthetic bitmap handle.")
    cancelled.Cancel()
    Assert(!cancelled.active, "Repeated cancellation is not safe.")
    Assert(clipboardWriter.writes.Length = 1 && paddedWriter.writes.Length = 1, "Cancellation copied an image to a clipboard mock.")
    cancelFileCount := 0
    Loop Files cancelFolder "\*", "F"
        cancelFileCount += 1
    Assert(cancelFileCount = 0, "Cancellation wrote a file.")
    FileAppend "Synthetic Temp Shots checks passed: " assertions " assertions." Chr(10), "*"
    ExitApp 0
} catch as err {
    FileAppend err.Message " (line " err.Line ")" Chr(10), "**"
    ExitApp 1
}
