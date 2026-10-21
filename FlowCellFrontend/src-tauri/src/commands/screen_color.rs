use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

static PICKER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
pub(crate) struct ScreenColorSelection {
    color: Option<String>,
}

struct PickerGuard;

impl PickerGuard {
    fn acquire() -> Result<Self, String> {
        PICKER_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| "A screen color picker is already open.".to_string())
    }
}

impl Drop for PickerGuard {
    fn drop(&mut self) {
        PICKER_ACTIVE.store(false, Ordering::Release);
    }
}

fn colorref_hex(color: u32) -> String {
    format!(
        "#{:02X}{:02X}{:02X}",
        color & 255,
        (color >> 8) & 255,
        (color >> 16) & 255
    )
}

#[tauri::command]
pub(crate) async fn pick_screen_color() -> Result<ScreenColorSelection, String> {
    let guard = PickerGuard::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        #[cfg(windows)]
        {
            platform::pick().map(|color| ScreenColorSelection { color })
        }
        #[cfg(not(windows))]
        {
            Err("Screen color picking is currently available on Windows.".to_string())
        }
    })
    .await
    .map_err(|error| format!("The screen color picker stopped unexpectedly: {error}"))?
}

#[cfg(windows)]
mod platform {
    use super::colorref_hex;
    use std::mem::zeroed;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{
        GetLastError, ERROR_CLASS_ALREADY_EXISTS, HWND, LPARAM, LRESULT, POINT, WPARAM,
    };
    use windows_sys::Win32::Graphics::Gdi::{
        BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        EndPaint, GetDC, GetPixel, ReleaseDC, SelectObject, CAPTUREBLT, CLR_INVALID, HBITMAP, HDC,
        HGDIOBJ, PAINTSTRUCT, SRCCOPY,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetCapture, ReleaseCapture, SetCapture, SetFocus, VK_ESCAPE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
        GetMessageW, GetSystemMetrics, GetWindowLongPtrW, IsWindow, KillTimer, LoadCursorW,
        PeekMessageW, PostQuitMessage, RegisterClassW, SetCursor, SetForegroundWindow, SetTimer,
        SetWindowLongPtrW, ShowWindow, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, IDC_CROSS,
        MSG, PM_REMOVE, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SW_SHOW, WA_INACTIVE, WM_ACTIVATE, WM_CLOSE, WM_DESTROY,
        WM_DISPLAYCHANGE, WM_ERASEBKGND, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_NCCREATE, WM_PAINT, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_TIMER, WNDCLASSW,
        WS_EX_APPWINDOW, WS_EX_TOPMOST, WS_POPUP,
    };

    const PICKER_TIMER: usize = 1;
    const PICKER_TIMEOUT_MS: u32 = 60_000;

    unsafe fn clear_picker_quit_message() {
        let mut message: MSG = zeroed();
        while PeekMessageW(&mut message, null_mut(), WM_QUIT, WM_QUIT, PM_REMOVE) != 0 {}
    }

    struct DpiGuard(DPI_AWARENESS_CONTEXT);

    impl Drop for DpiGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    SetThreadDpiAwarenessContext(self.0);
                }
            }
        }
    }

    struct DesktopCapture {
        dc: HDC,
        bitmap: HBITMAP,
        previous_bitmap: HGDIOBJ,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    }

    impl Drop for DesktopCapture {
        fn drop(&mut self) {
            unsafe {
                if !self.previous_bitmap.is_null() {
                    SelectObject(self.dc, self.previous_bitmap);
                }
                if !self.bitmap.is_null() {
                    DeleteObject(self.bitmap);
                }
                if !self.dc.is_null() {
                    DeleteDC(self.dc);
                }
            }
        }
    }

    impl DesktopCapture {
        unsafe fn capture() -> Result<Self, String> {
            let mut capture = Self {
                dc: null_mut(),
                bitmap: null_mut(),
                previous_bitmap: null_mut(),
                x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
                height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
            };
            if capture.width <= 0 || capture.height <= 0 {
                return Err("The desktop has no screen area to sample.".to_string());
            }
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return Err("Could not access the desktop for color picking.".to_string());
            }
            capture.dc = CreateCompatibleDC(screen);
            capture.bitmap = CreateCompatibleBitmap(screen, capture.width, capture.height);
            let copied = if capture.dc.is_null() || capture.bitmap.is_null() {
                false
            } else {
                capture.previous_bitmap = SelectObject(capture.dc, capture.bitmap);
                !capture.previous_bitmap.is_null()
                    && BitBlt(
                        capture.dc,
                        0,
                        0,
                        capture.width,
                        capture.height,
                        screen,
                        capture.x,
                        capture.y,
                        SRCCOPY | CAPTUREBLT,
                    ) != 0
            };
            ReleaseDC(null_mut(), screen);
            if !copied {
                return Err("Could not capture the desktop for color picking.".to_string());
            }
            Ok(capture)
        }

        unsafe fn sample_cursor(&self) -> Result<Option<String>, String> {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point) == 0 {
                return Err("Could not read the screen color position.".to_string());
            }
            self.sample_point(point)
        }

        unsafe fn sample_point(&self, point: POINT) -> Result<Option<String>, String> {
            let x = point.x - self.x;
            let y = point.y - self.y;
            if x < 0 || y < 0 || x >= self.width || y >= self.height {
                return Ok(None);
            }
            let color = GetPixel(self.dc, x, y);
            if color == CLR_INVALID {
                return Err("Could not read the selected screen color.".to_string());
            }
            Ok(Some(colorref_hex(color)))
        }
    }

    struct PickerState {
        capture: DesktopCapture,
        result: Result<Option<String>, String>,
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_NCCREATE {
            let create = &*(lparam as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        }
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut PickerState;
        if state.is_null() {
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }
        match message {
            WM_PAINT => {
                let mut paint: PAINTSTRUCT = zeroed();
                let destination = BeginPaint(hwnd, &mut paint);
                let capture = &(*state).capture;
                BitBlt(
                    destination,
                    0,
                    0,
                    capture.width,
                    capture.height,
                    capture.dc,
                    0,
                    0,
                    SRCCOPY,
                );
                EndPaint(hwnd, &paint);
                0
            }
            WM_ERASEBKGND => 1,
            // Consume both halves of the selection click before removing the overlay.
            WM_LBUTTONDOWN | WM_RBUTTONDOWN => 0,
            WM_LBUTTONUP => {
                (*state).result = (*state).capture.sample_cursor();
                DestroyWindow(hwnd);
                0
            }
            WM_KEYDOWN if wparam == VK_ESCAPE as usize => 0,
            WM_KEYUP if wparam == VK_ESCAPE as usize => {
                DestroyWindow(hwnd);
                0
            }
            WM_RBUTTONUP | WM_CLOSE | WM_DISPLAYCHANGE => {
                DestroyWindow(hwnd);
                0
            }
            WM_TIMER if wparam == PICKER_TIMER => {
                DestroyWindow(hwnd);
                0
            }
            WM_ACTIVATE if (wparam & 0xffff) == WA_INACTIVE as usize => {
                DestroyWindow(hwnd);
                0
            }
            WM_DESTROY => {
                KillTimer(hwnd, PICKER_TIMER);
                if GetCapture() == hwnd {
                    ReleaseCapture();
                }
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }

    pub(super) fn pick() -> Result<Option<String>, String> {
        unsafe {
            let _dpi = DpiGuard(SetThreadDpiAwarenessContext(
                DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
            ));
            let mut state = Box::new(PickerState {
                capture: DesktopCapture::capture()?,
                result: Ok(None),
            });
            let class_name: Vec<u16> = "FlowCellScreenColorPicker\0".encode_utf16().collect();
            let title: Vec<u16> = "FlowCell Screen Color Picker — click color / Esc cancel\0"
                .encode_utf16()
                .collect();
            let instance = GetModuleHandleW(null());
            let class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                hCursor: LoadCursorW(null_mut(), IDC_CROSS),
                lpszClassName: class_name.as_ptr(),
                ..zeroed()
            };
            if RegisterClassW(&class) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
                return Err("Could not create the screen color picker window class.".to_string());
            }
            let capture = &state.capture;
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_APPWINDOW,
                class_name.as_ptr(),
                title.as_ptr(),
                WS_POPUP,
                capture.x,
                capture.y,
                capture.width,
                capture.height,
                null_mut(),
                null_mut(),
                instance,
                (&mut *state as *mut PickerState).cast(),
            );
            if hwnd.is_null() {
                return Err("Could not open the screen color picker.".to_string());
            }
            if SetTimer(hwnd, PICKER_TIMER, PICKER_TIMEOUT_MS, None) == 0 {
                DestroyWindow(hwnd);
                // Consume WM_QUIT before this pooled worker handles another picker.
                clear_picker_quit_message();
                return Err("Could not start the screen color picker timeout.".to_string());
            }
            ShowWindow(hwnd, SW_SHOW);
            SetForegroundWindow(hwnd);
            SetFocus(hwnd);
            SetCapture(hwnd);
            let previous_cursor = SetCursor(class.hCursor);
            let mut message: MSG = zeroed();
            loop {
                let received = GetMessageW(&mut message, null_mut(), 0, 0);
                if received <= 0 {
                    if received < 0 {
                        state.result =
                            Err("The screen color picker message loop failed.".to_string());
                    }
                    break;
                }
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            if IsWindow(hwnd) != 0 {
                DestroyWindow(hwnd);
            }
            clear_picker_quit_message();
            SetCursor(previous_cursor);
            state.result.clone()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::Graphics::Gdi::SetPixel;

        #[test]
        fn samples_frozen_bitmap_at_negative_monitor_origin() {
            unsafe {
                let screen = GetDC(null_mut());
                assert!(!screen.is_null());
                let mut capture = DesktopCapture {
                    dc: CreateCompatibleDC(screen),
                    bitmap: CreateCompatibleBitmap(screen, 2, 1),
                    previous_bitmap: null_mut(),
                    x: -1920,
                    y: -300,
                    width: 2,
                    height: 1,
                };
                ReleaseDC(null_mut(), screen);
                assert!(!capture.dc.is_null() && !capture.bitmap.is_null());
                capture.previous_bitmap = SelectObject(capture.dc, capture.bitmap);
                assert!(!capture.previous_bitmap.is_null());
                assert_ne!(SetPixel(capture.dc, 0, 0, 0x00332211), CLR_INVALID);
                assert_ne!(SetPixel(capture.dc, 1, 0, 0x00C0B0A0), CLR_INVALID);
                assert_eq!(
                    capture.sample_point(POINT { x: -1920, y: -300 }).unwrap(),
                    Some("#112233".into())
                );
                assert_eq!(
                    capture.sample_point(POINT { x: -1919, y: -300 }).unwrap(),
                    Some("#A0B0C0".into())
                );
                assert_eq!(
                    capture.sample_point(POINT { x: -1921, y: -300 }).unwrap(),
                    None
                );
                assert_eq!(
                    capture.sample_point(POINT { x: -1918, y: -300 }).unwrap(),
                    None
                );
                assert_eq!(
                    capture.sample_point(POINT { x: -1920, y: -299 }).unwrap(),
                    None
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_colorref_converts_red_green_blue_in_screen_order() {
        assert_eq!(colorref_hex(0x00332211), "#112233");
        assert_eq!(colorref_hex(0x000000ff), "#FF0000");
        assert_eq!(colorref_hex(0x00ffffff), "#FFFFFF");
    }

    #[test]
    fn only_one_picker_can_open_and_drop_releases_it() {
        let guard = PickerGuard::acquire().unwrap();
        assert!(PickerGuard::acquire().is_err());
        drop(guard);
        assert!(PickerGuard::acquire().is_ok());
    }
}
