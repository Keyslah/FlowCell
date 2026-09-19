; Temp Shots owns capture and saving. No native Snipping Tool or disk intermediary.
class FlowCellTempShotsCapture {
    __New() {
        this.active := false
        this.bitmap := 0
        this.window := ""
        this.timer := ObjBindMethod(this, "Poll")
        this.escape := ObjBindMethod(this, "Cancel")
        this.cursorHandler := ObjBindMethod(this, "SetCursor")
        this.cursorRegistered := false
        this.escapeRegistered := false
        this.callback := ""
    }

    Start(folder, statusCallback) {
        previousCritical := A_IsCritical
        Critical "On"
        previousDpi := 0
        try {
            this.Cancel()
            if !DirExist(folder)
                throw Error("The Temp Shots folder does not exist: " folder)
            this.folder := folder
            this.callback := statusCallback
            previousDpi := DllCall("user32\SetThreadDpiAwarenessContext", "Ptr", -4, "Ptr")
            if !previousDpi
                throw OSError(A_LastError, "SetThreadDpiAwarenessContext")
            this.left := SysGet(76)
            this.top := SysGet(77)
            this.width := SysGet(78)
            this.height := SysGet(79)
            ; Freeze before constructing or showing a window, so focus changes cannot
            ; remove a dropdown from the image the user is about to select.
            this.bitmap := FlowCellTempShotsCapture.CaptureDesktop(this.left, this.top, this.width, this.height)
            this.window := Gui("+AlwaysOnTop -Caption +ToolWindow -DPIScale", "Temp Shots selection")
            this.window.MarginX := 0
            this.window.MarginY := 0
            this.window.AddPicture("x0 y0 w" this.width " h" this.height, "HBITMAP:*" this.bitmap)
            this.borders := []
            Loop 4
                this.borders.Push(this.window.AddProgress("x0 y0 w1 h1 Hidden c42A5F5 Background42A5F5", 100))
            this.window.OnEvent("Escape", this.escape)
            this.window.OnEvent("Close", this.escape)
            this.cursor := DllCall("user32\LoadCursorW", "Ptr", 0, "Ptr", 32515, "Ptr")
            if !this.cursor
                throw OSError(A_LastError, "LoadCursorW")
            OnMessage(0x20, this.cursorHandler)
            this.cursorRegistered := true
            try {
                HotIfWinExist "ahk_id " this.window.Hwnd
                Hotkey "*Escape", this.escape, "On"
                this.escapeRegistered := true
            } finally {
                HotIfWinExist
            }
            this.selecting := false
            this.wasDown := false
            this.ready := !GetKeyState("LButton", "P")
            this.active := true
            this.window.Show("x" this.left " y" this.top " w" this.width " h" this.height)
            SetTimer this.timer, 16
            this.Report("Temp Shots: drag a rectangle; press Escape to cancel.")
            return true
        } catch {
            this.Cleanup()
            throw
        } finally {
            if previousDpi
                DllCall("user32\SetThreadDpiAwarenessContext", "Ptr", previousDpi, "Ptr")
            Critical previousCritical
        }
    }

    Poll() {
        ; This timer runs in the backend's thread, whose original DPI context may
        ; differ from the physical-pixel context of the selection window.
        previousCritical := A_IsCritical
        Critical "On"
        previousDpi := 0
        try {
            if !this.active
                return
            previousDpi := DllCall("user32\SetThreadDpiAwarenessContext", "Ptr", -4, "Ptr")
            if !previousDpi
                throw OSError(A_LastError, "SetThreadDpiAwarenessContext")
            if GetKeyState("Escape", "P") {
                this.Cancel()
                return
            }
            down := GetKeyState("LButton", "P")
            if !this.ready {
                this.ready := !down
                return
            }
            point := Buffer(8)
            if !DllCall("user32\GetCursorPos", "Ptr", point)
                throw OSError(A_LastError, "GetCursorPos")
            x := NumGet(point, 0, "Int") - this.left
            y := NumGet(point, 4, "Int") - this.top
            if down && !this.wasDown {
                this.startX := x
                this.startY := y
                this.selecting := true
            }
            if this.selecting {
                rect := FlowCellTempShotsCapture.NormalizeRectangle(this.startX, this.startY, x, y, this.width, this.height)
                this.DrawBorder(rect)
                if !down && this.wasDown {
                    this.selecting := false
                    if rect.width > 0 && rect.height > 0 {
                        this.Finish(rect)
                        return
                    }
                }
            }
            this.wasDown := down
        } catch as err {
            this.Cleanup()
            this.Report("Temp Shots failed: " err.Message)
        } finally {
            if previousDpi
                DllCall("user32\SetThreadDpiAwarenessContext", "Ptr", previousDpi, "Ptr")
            Critical previousCritical
        }
    }

    DrawBorder(rect) {
        if rect.width < 1 || rect.height < 1 {
            for border in this.borders
                border.Visible := false
            return
        }
        thickness := Min(2, rect.width, rect.height)
        this.borders[1].Move(rect.x, rect.y, rect.width, thickness)
        this.borders[2].Move(rect.x, rect.y + rect.height - thickness, rect.width, thickness)
        this.borders[3].Move(rect.x, rect.y, thickness, rect.height)
        this.borders[4].Move(rect.x + rect.width - thickness, rect.y, thickness, rect.height)
        for border in this.borders
            border.Visible := true
    }

    SetCursor(wParam, lParam, msg, hwnd) {
        if this.active && (hwnd = this.window.Hwnd || DllCall("user32\IsChild", "Ptr", this.window.Hwnd, "Ptr", hwnd)) {
            DllCall("user32\SetCursor", "Ptr", this.cursor, "Ptr")
            return true
        }
    }

    Finish(rect) {
        ; Stop selection input before saving. Nothing is written before completion.
        previousCritical := A_IsCritical
        Critical "On"
        try {
            SetTimer this.timer, 0
            path := FlowCellTempShotsCapture.NextPath(this.folder)
            writer := ObjBindMethod(FlowCellTempShotsCapture, "WriteClipboardImage", this.window.Hwnd)
            FlowCellTempShotsCapture.SaveBitmapArea(this.bitmap, rect, path, writer)
            this.Cleanup()
            this.Report("Temp Shots saved and copied to clipboard: " path)
        } finally {
            Critical previousCritical
        }
    }

    Cancel(*) {
        wasActive := this.active
        this.Cleanup()
        if wasActive
            this.Report("Temp Shots cancelled. No image saved.")
    }

    Cleanup() {
        this.active := false
        SetTimer this.timer, 0
        if this.escapeRegistered && IsObject(this.window) {
            try {
                HotIfWinExist "ahk_id " this.window.Hwnd
                Hotkey "*Escape", "Off"
            } finally {
                HotIfWinExist
                this.escapeRegistered := false
            }
        }
        if this.cursorRegistered {
            OnMessage(0x20, this.cursorHandler, 0)
            this.cursorRegistered := false
        }
        if IsObject(this.window) {
            this.window.Destroy()
            this.window := ""
        }
        if this.bitmap {
            DllCall("gdi32\DeleteObject", "Ptr", this.bitmap)
            this.bitmap := 0
        }
    }

    Report(text) {
        if IsObject(this.callback)
            this.callback.Call(text)
    }

    static NormalizeRectangle(x1, y1, x2, y2, width, height) {
        x1 := Max(0, Min(width, x1))
        x2 := Max(0, Min(width, x2))
        y1 := Max(0, Min(height, y1))
        y2 := Max(0, Min(height, y2))
        return {x: Min(x1, x2), y: Min(y1, y2), width: Abs(x2 - x1), height: Abs(y2 - y1)}
    }

    static NextPath(folder, stamp := "") {
        if stamp = ""
            stamp := FormatTime(, "yyyyMMdd-HHmmss")
        stem := RTrim(folder, "\/") "\temp-shot-" stamp
        path := stem ".png"
        suffix := 0
        while FileExist(path) {
            suffix += 1
            path := stem "-" Format("{:02}", suffix) ".png"
        }
        return path
    }

    static CaptureDesktop(x, y, width, height) {
        screen := 0, memory := 0, bitmap := 0, previous := 0
        try {
            if width < 1 || height < 1
                throw Error("The desktop dimensions are invalid.")
            screen := DllCall("user32\GetDC", "Ptr", 0, "Ptr")
            if !screen
                throw OSError(A_LastError, "GetDC")
            memory := DllCall("gdi32\CreateCompatibleDC", "Ptr", screen, "Ptr")
            if !memory
                throw OSError(A_LastError, "CreateCompatibleDC")
            bitmap := DllCall("gdi32\CreateCompatibleBitmap", "Ptr", screen, "Int", width, "Int", height, "Ptr")
            if !bitmap
                throw OSError(A_LastError, "CreateCompatibleBitmap")
            previous := DllCall("gdi32\SelectObject", "Ptr", memory, "Ptr", bitmap, "Ptr")
            if !previous || previous = -1
                throw OSError(A_LastError, "SelectObject")
            if !DllCall("gdi32\BitBlt", "Ptr", memory, "Int", 0, "Int", 0, "Int", width, "Int", height, "Ptr", screen, "Int", x, "Int", y, "UInt", 0x40CC0020)
                throw OSError(A_LastError, "BitBlt")
            result := bitmap
            bitmap := 0
            return result
        } finally {
            if previous && previous != -1
                DllCall("gdi32\SelectObject", "Ptr", memory, "Ptr", previous)
            if bitmap
                DllCall("gdi32\DeleteObject", "Ptr", bitmap)
            if memory
                DllCall("gdi32\DeleteDC", "Ptr", memory)
            if screen
                DllCall("user32\ReleaseDC", "Ptr", 0, "Ptr", screen)
        }
    }

    ; Accepts an in-memory HBITMAP, also allowing synthetic bitmap tests without
    ; ever reading the desktop, showing a GUI, or opening the native snipping app.
    static SaveBitmapArea(bitmap, rect, path, clipboardWriter := 0) {
        if FileExist(path)
            throw Error("Refusing to overwrite an existing Temp Shot: " path)
        module := 0, token := 0, source := 0, cropped := 0
        startup := Buffer(A_PtrSize = 8 ? 24 : 16, 0)
        NumPut("UInt", 1, startup)
        try {
            module := DllCall("kernel32\LoadLibraryW", "WStr", "gdiplus.dll", "Ptr")
            if !module
                throw OSError(A_LastError, "LoadLibraryW(gdiplus)")
            FlowCellTempShotsCapture.CheckStatus(DllCall("gdiplus\GdiplusStartup", "Ptr*", &token, "Ptr", startup, "Ptr", 0), "GdiplusStartup")
            FlowCellTempShotsCapture.CheckStatus(DllCall("gdiplus\GdipCreateBitmapFromHBITMAP", "Ptr", bitmap, "Ptr", 0, "Ptr*", &source), "GdipCreateBitmapFromHBITMAP")
            FlowCellTempShotsCapture.CheckStatus(DllCall("gdiplus\GdipCloneBitmapAreaI", "Int", rect.x, "Int", rect.y, "Int", rect.width, "Int", rect.height, "Int", 0x21808, "Ptr", source, "Ptr*", &cropped), "GdipCloneBitmapAreaI")
            encoder := Buffer(16)
            if DllCall("ole32\CLSIDFromString", "WStr", "{557CF406-1A04-11D3-9A73-0000F81EF32E}", "Ptr", encoder) != 0
                throw Error("The PNG encoder identifier is invalid.")
            ; One final destination only. No native autosave, intermediary, or cleanup file.
            FlowCellTempShotsCapture.CheckStatus(DllCall("gdiplus\GdipSaveImageToFile", "Ptr", cropped, "WStr", path, "Ptr", encoder, "Ptr", 0), "GdipSaveImageToFile")
            if IsObject(clipboardWriter) {
                try {
                    dib := FlowCellTempShotsCapture.CreateClipboardDib(cropped, rect.width, rect.height)
                    clipboardWriter.Call(dib, FileRead(path, "RAW"))
                } catch as err {
                    throw Error("Saved " path ", but could not copy the image to the clipboard. " err.Message)
                }
            }
        } finally {
            if cropped
                DllCall("gdiplus\GdipDisposeImage", "Ptr", cropped)
            if source
                DllCall("gdiplus\GdipDisposeImage", "Ptr", source)
            if token
                DllCall("gdiplus\GdiplusShutdown", "Ptr", token)
            if module
                DllCall("kernel32\FreeLibrary", "Ptr", module)
        }
    }

    static CreateClipboardDib(image, width, height) {
        bitmap := 0, memory := 0
        try {
            FlowCellTempShotsCapture.CheckStatus(DllCall("gdiplus\GdipCreateHBITMAPFromBitmap", "Ptr", image, "Ptr*", &bitmap, "UInt", 0xFFFFFFFF), "GdipCreateHBITMAPFromBitmap")
            memory := DllCall("gdi32\CreateCompatibleDC", "Ptr", 0, "Ptr")
            if !memory
                throw OSError(A_LastError, "CreateCompatibleDC")
            ; CF_DIB is a bitmap header followed by bottom-up, padded BGR rows.
            ; 24-bit RGB avoids undefined alpha bytes in older paste destinations.
            stride := (width * 3 + 3) & ~3
            dib := Buffer(40 + stride * height, 0)
            NumPut("UInt", 40, "Int", width, "Int", height, "UShort", 1, "UShort", 24, "UInt", 0, "UInt", stride * height, dib)
            if DllCall("gdi32\GetDIBits", "Ptr", memory, "Ptr", bitmap, "UInt", 0, "UInt", height, "Ptr", dib.Ptr + 40, "Ptr", dib, "UInt", 0) != height
                throw OSError(A_LastError, "GetDIBits")
            return dib
        } finally {
            if memory
                DllCall("gdi32\DeleteDC", "Ptr", memory)
            if bitmap
                DllCall("gdi32\DeleteObject", "Ptr", bitmap)
        }
    }

    static WriteClipboardImage(ownerHwnd, dib, png) {
        pngFormat := DllCall("user32\RegisterClipboardFormatW", "WStr", "PNG", "UInt")
        if !pngFormat
            throw OSError(A_LastError, "RegisterClipboardFormatW")
        blocks := [{format: 8, data: dib, handle: 0}, {format: pngFormat, data: png, handle: 0}]
        opened := false
        try {
            ; Prepare both image formats before touching the existing clipboard.
            for block in blocks {
                block.handle := DllCall("kernel32\GlobalAlloc", "UInt", 0x2, "UPtr", block.data.Size, "Ptr")
                if !block.handle
                    throw OSError(A_LastError, "GlobalAlloc")
                address := DllCall("kernel32\GlobalLock", "Ptr", block.handle, "Ptr")
                if !address
                    throw OSError(A_LastError, "GlobalLock")
                try DllCall("ntdll\RtlMoveMemory", "Ptr", address, "Ptr", block.data, "UPtr", block.data.Size)
                finally DllCall("kernel32\GlobalUnlock", "Ptr", block.handle)
            }
            Loop 10 {
                if DllCall("user32\OpenClipboard", "Ptr", ownerHwnd) {
                    opened := true
                    break
                }
                Sleep 20
            }
            if !opened
                throw Error("The clipboard is busy.")
            if !DllCall("user32\EmptyClipboard")
                throw OSError(A_LastError, "EmptyClipboard")
            for block in blocks {
                if !DllCall("user32\SetClipboardData", "UInt", block.format, "Ptr", block.handle, "Ptr")
                    throw OSError(A_LastError, "SetClipboardData")
                block.handle := 0 ; Windows owns the memory after successful publication.
            }
        } finally {
            if opened
                DllCall("user32\CloseClipboard")
            for block in blocks {
                if block.handle
                    DllCall("kernel32\GlobalFree", "Ptr", block.handle)
            }
        }
    }

    static CheckStatus(status, operation) {
        if status != 0
            throw Error(operation " failed (GDI+ status " status ").")
    }
}
