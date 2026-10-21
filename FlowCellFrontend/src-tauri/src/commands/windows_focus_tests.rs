use super::{
    is_native_window_topmost, resolve_scoped_window_placement, scoped_group_was_topmost,
    set_scoped_native_hwnd_placement, should_reapply_scoped_window_state, ScopedTopmostEntry,
    ScopedWindowPlacement, Win32Hwnd,
};
use std::cell::Cell;
use std::collections::HashMap;
use std::ptr;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetWindowLongPtrW,
    IsWindowVisible, PeekMessageW, RegisterClassW, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    UnregisterClassW, GWLP_USERDATA, HWND_NOTOPMOST, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE, WINDOWPOS, WM_SHOWWINDOW,
    WM_WINDOWPOSCHANGING, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
};

#[link(name = "user32")]
extern "system" {
    fn CreateDesktopW(
        name: *const u16,
        device: *const u16,
        mode: *const std::ffi::c_void,
        flags: u32,
        access: u32,
        attributes: *const std::ffi::c_void,
    ) -> isize;
    fn SetThreadDesktop(desktop: isize) -> i32;
    fn CloseDesktop(desktop: isize) -> i32;
}

// These windows live on a private desktop which is never made the input desktop.
// The tests exercise native visibility and Z order without activating user apps.
fn on_private_desktop(test: impl FnOnce() + Send + 'static) {
    struct Desktop(isize);
    impl Drop for Desktop {
        fn drop(&mut self) {
            unsafe { CloseDesktop(self.0) };
        }
    }
    let name: Vec<u16> = format!(
        "FlowCellFocusTest{}-{}\0",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
    .encode_utf16()
    .collect();
    let desktop = Desktop(unsafe {
        CreateDesktopW(
            name.as_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            0x01FF,
            ptr::null(),
        )
    });
    assert_ne!(desktop.0, 0, "create isolated test desktop");
    let handle = desktop.0;
    let result = std::thread::spawn(move || {
        assert_ne!(unsafe { SetThreadDesktop(handle) }, 0);
        test();
    })
    .join();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}

#[derive(Default)]
struct Messages {
    placement: Cell<u32>,
    show: Cell<u32>,
    show_flag: Cell<u32>,
}

impl Messages {
    fn reset(&self) {
        self.placement.set(0);
        self.show.set(0);
        self.show_flag.set(0);
    }
}

unsafe extern "system" fn probe_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let messages = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Messages;
    if let Some(messages) = messages.as_ref() {
        if message == WM_WINDOWPOSCHANGING {
            messages.placement.set(messages.placement.get() + 1);
            if (*(lparam as *const WINDOWPOS)).flags & SWP_SHOWWINDOW != 0 {
                messages.show_flag.set(messages.show_flag.get() + 1);
            }
        } else if message == WM_SHOWWINDOW && wparam != 0 {
            messages.show.set(messages.show.get() + 1);
        }
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

struct ProbeClass(Vec<u16>);

impl ProbeClass {
    fn new() -> Self {
        let name: Vec<u16> = format!("FlowCellFocusProbe{:?}\0", std::thread::current().id())
            .encode_utf16()
            .collect();
        let class = WNDCLASSW {
            lpfnWndProc: Some(probe_window_proc),
            hInstance: unsafe { GetModuleHandleW(ptr::null()) },
            lpszClassName: name.as_ptr(),
            ..unsafe { std::mem::zeroed() }
        };
        assert_ne!(unsafe { RegisterClassW(&class) }, 0);
        Self(name)
    }
}

impl Drop for ProbeClass {
    fn drop(&mut self) {
        unsafe { UnregisterClassW(self.0.as_ptr(), GetModuleHandleW(ptr::null())) };
    }
}

struct ProbeWindow {
    hwnd: HWND,
    messages: Box<Messages>,
}

impl ProbeWindow {
    fn new(class: &ProbeClass, owner: HWND) -> Self {
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class.0.as_ptr(),
                class.0.as_ptr(),
                WS_POPUP,
                -30000,
                -30000,
                32,
                32,
                owner,
                ptr::null_mut(),
                GetModuleHandleW(ptr::null()),
                ptr::null(),
            )
        };
        assert!(!hwnd.is_null());
        let messages = Box::<Messages>::default();
        unsafe {
            SetWindowLongPtrW(
                hwnd,
                GWLP_USERDATA,
                (&*messages as *const Messages) as isize,
            )
        };
        Self { hwnd, messages }
    }

    fn apply(&self, placement: ScopedWindowPlacement, promote: bool) {
        set_scoped_native_hwnd_placement(Win32Hwnd(self.hwnd), placement, promote).unwrap();
        drain_messages();
    }

    fn topmost(&self) -> bool {
        is_native_window_topmost(self.hwnd as isize)
    }

    fn visible(&self) -> bool {
        unsafe { IsWindowVisible(self.hwnd) != 0 }
    }
}

impl Drop for ProbeWindow {
    fn drop(&mut self) {
        unsafe { DestroyWindow(self.hwnd) };
    }
}

fn drain_messages() {
    let mut message: MSG = unsafe { std::mem::zeroed() };
    while unsafe { PeekMessageW(&mut message, ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
        unsafe { DispatchMessageW(&message) };
    }
}

#[test]
fn native_established_group_handoff_sends_no_placement_or_show_messages() {
    on_private_desktop(|| {
        let class = ProbeClass::new();
        let owner = ProbeWindow::new(&class, ptr::null_mut());
        let owned = ProbeWindow::new(&class, owner.hwnd);
        let unowned = ProbeWindow::new(&class, ptr::null_mut());
        let names = vec!["blender.exe".to_string()];
        let mut entries = HashMap::new();
        for (label, window) in [("owned", &owned), ("unowned", &unowned)] {
            window.apply(ScopedWindowPlacement::Topmost, true);
            entries.insert(
                label.to_string(),
                ScopedTopmostEntry {
                    process_names: names.clone(),
                    last_placement: Some(ScopedWindowPlacement::Topmost),
                    ..Default::default()
                },
            );
        }
        drain_messages();
        owned.messages.reset();
        unowned.messages.reset();
        for foreground in [owner.hwnd, owned.hwnd, unowned.hwnd, owner.hwnd] {
            let in_controls = foreground != owner.hwnd;
            let was_topmost = scoped_group_was_topmost(
                &entries,
                if in_controls {
                    Some(names.as_slice())
                } else {
                    None
                },
            );
            for window in [&owned, &unowned] {
                let (placement, active) = resolve_scoped_window_placement(
                    !in_controls,
                    in_controls,
                    in_controls,
                    true,
                    false,
                    false,
                    foreground as isize,
                    window.hwnd as isize,
                    was_topmost,
                );
                assert_eq!(placement, ScopedWindowPlacement::Topmost);
                let apply = should_reapply_scoped_window_state(
                    !window.topmost(),
                    Some(ScopedWindowPlacement::Topmost),
                    placement,
                    Some(true),
                    active,
                    Some(false),
                    false,
                );
                assert!(
                    !apply,
                    "an established owner/control handoff must be a native no-op"
                );
                if apply {
                    window.apply(placement, !in_controls);
                }
            }
        }
        drain_messages();
        for window in [&owned, &unowned] {
            assert!(window.topmost());
            assert!(window.visible());
            assert_eq!(window.messages.placement.get(), 0);
            assert_eq!(window.messages.show.get(), 0);
            assert_eq!(window.messages.show_flag.get(), 0);
        }
    });
}

#[test]
fn native_promotion_shows_hidden_window_once_without_reshowing_visible_window() {
    on_private_desktop(|| {
        let class = ProbeClass::new();
        let window = ProbeWindow::new(&class, ptr::null_mut());
        window.apply(ScopedWindowPlacement::Topmost, false);
        assert!(
            !window.visible(),
            "placement alone must not reveal a hidden window"
        );
        window.apply(ScopedWindowPlacement::Topmost, true);
        assert!(
            window.visible(),
            "legitimate owner promotion must show its window"
        );
        assert!(window.messages.show.get() > 0 || window.messages.show_flag.get() > 0);
        window.messages.reset();
        window.apply(ScopedWindowPlacement::Topmost, true);
        assert!(window.visible());
        assert!(
            window.messages.placement.get() > 0,
            "the explicit setter was exercised"
        );
        assert_eq!(window.messages.show.get(), 0);
        assert_eq!(window.messages.show_flag.get(), 0);
    });
}

#[test]
fn native_new_control_inherits_active_group_without_demoting_existing_anchor() {
    on_private_desktop(|| {
        let class = ProbeClass::new();
        let anchor = ProbeWindow::new(&class, ptr::null_mut());
        let new_control = ProbeWindow::new(&class, ptr::null_mut());
        anchor.apply(ScopedWindowPlacement::Topmost, true);
        unsafe { ShowWindow(new_control.hwnd, SW_SHOWNOACTIVATE) };
        drain_messages();
        let names = vec!["blender.exe".to_string()];
        let entries = HashMap::from([
            (
                "anchor".to_string(),
                ScopedTopmostEntry {
                    process_names: names.clone(),
                    last_placement: Some(ScopedWindowPlacement::Topmost),
                    ..Default::default()
                },
            ),
            (
                "new".to_string(),
                ScopedTopmostEntry {
                    process_names: names.clone(),
                    ..Default::default()
                },
            ),
        ]);
        let (placement, _) = resolve_scoped_window_placement(
            false,
            true,
            true,
            true,
            true,
            false,
            anchor.hwnd as isize,
            new_control.hwnd as isize,
            scoped_group_was_topmost(&entries, Some(&names)),
        );
        assert_eq!(placement, ScopedWindowPlacement::Topmost);
        new_control.apply(placement, false);
        assert!(
            anchor.topmost(),
            "opening a control must not demote its active anchor"
        );
        assert!(new_control.topmost());
    });
}

#[test]
fn native_topmost_drift_is_repaired_without_repeating_show() {
    on_private_desktop(|| {
        let class = ProbeClass::new();
        let window = ProbeWindow::new(&class, ptr::null_mut());
        window.apply(ScopedWindowPlacement::Topmost, true);
        assert_ne!(
            unsafe {
                SetWindowPos(
                    window.hwnd,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
                )
            },
            0
        );
        assert!(
            !window.topmost(),
            "simulate native placement changing outside the cache"
        );
        window.messages.reset();
        assert!(should_reapply_scoped_window_state(
            !window.topmost(),
            Some(ScopedWindowPlacement::Topmost),
            ScopedWindowPlacement::Topmost,
            Some(true),
            true,
            Some(false),
            false,
        ));
        window.apply(ScopedWindowPlacement::Topmost, true);
        assert!(window.topmost());
        assert!(window.messages.placement.get() > 0);
        assert_eq!(window.messages.show.get(), 0);
        assert_eq!(window.messages.show_flag.get(), 0);
        assert!(!should_reapply_scoped_window_state(
            !window.topmost(),
            Some(ScopedWindowPlacement::Topmost),
            ScopedWindowPlacement::Topmost,
            Some(true),
            true,
            Some(false),
            false,
        ));
    });
}
