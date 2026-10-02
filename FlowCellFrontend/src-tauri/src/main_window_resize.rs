use tauri::{Manager, WebviewWindow};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::UI::Shell::{
    DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowRect, WMSZ_BOTTOM, WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT, WMSZ_LEFT,
    WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT, WM_NCDESTROY, WM_SIZING,
};

const MAIN_RESIZE_SUBCLASS_ID: usize = 0x46434d52;

struct MainAspectRatio(f64);

pub(crate) fn install<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() != "main" {
        return Err("The uniform resize constraint belongs to the Main window.".to_string());
    }
    let config = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or("The Main window configuration is missing.")?;
    if !config.width.is_finite()
        || !config.height.is_finite()
        || config.width <= 0.0
        || config.height <= 0.0
    {
        return Err("The Main window dimensions must be finite and positive.".to_string());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    install_native(hwnd.0 as HWND, config.width / config.height)
}

fn install_native(hwnd: HWND, ratio: f64) -> Result<(), String> {
    if !ratio.is_finite() || ratio <= 0.0 {
        return Err("The Main window aspect ratio must be finite and positive.".to_string());
    }
    let mut existing = 0;
    if unsafe {
        GetWindowSubclass(
            hwnd,
            Some(resize_subclass),
            MAIN_RESIZE_SUBCLASS_ID,
            &mut existing,
        )
    } != 0
    {
        return Ok(());
    }
    let data = Box::into_raw(Box::new(MainAspectRatio(ratio)));
    if unsafe {
        SetWindowSubclass(
            hwnd,
            Some(resize_subclass),
            MAIN_RESIZE_SUBCLASS_ID,
            data as usize,
        )
    } == 0
    {
        unsafe {
            drop(Box::from_raw(data));
        }
        return Err(
            "The Main window uniform resize constraint could not be installed.".to_string(),
        );
    }
    Ok(())
}

unsafe extern "system" fn resize_subclass(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    data: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        RemoveWindowSubclass(hwnd, Some(resize_subclass), subclass_id);
        drop(Box::from_raw(data as *mut MainAspectRatio));
    } else if message == WM_SIZING && lparam != 0 {
        // Measure the current native frame on every drag, including after a DPI change.
        if let Some(insets) = client_insets(hwnd) {
            let ratio = (*(data as *const MainAspectRatio)).0;
            if constrain_sizing_rect(&mut *(lparam as *mut RECT), wparam as u32, ratio, insets) {
                return 1;
            }
        }
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

fn client_insets(hwnd: HWND) -> Option<(i32, i32)> {
    let mut outer: RECT = unsafe { std::mem::zeroed() };
    let mut client: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut outer) } == 0
        || unsafe { GetClientRect(hwnd, &mut client) } == 0
    {
        return None;
    }
    let width = i64::from(outer.right)
        - i64::from(outer.left)
        - (i64::from(client.right) - i64::from(client.left));
    let height = i64::from(outer.bottom)
        - i64::from(outer.top)
        - (i64::from(client.bottom) - i64::from(client.top));
    Some((
        width.clamp(0, i64::from(i32::MAX)) as i32,
        height.clamp(0, i64::from(i32::MAX)) as i32,
    ))
}

fn constrain_sizing_rect(rect: &mut RECT, edge: u32, ratio: f64, insets: (i32, i32)) -> bool {
    let width = (f64::from(rect.right) - f64::from(rect.left) - f64::from(insets.0)).max(1.0);
    let height = (f64::from(rect.bottom) - f64::from(rect.top) - f64::from(insets.1)).max(1.0);
    let (width, height) = match edge {
        WMSZ_LEFT | WMSZ_RIGHT => (width, (width / ratio).max(1.0)),
        WMSZ_TOP | WMSZ_BOTTOM => ((height * ratio).max(1.0), height),
        WMSZ_TOPLEFT | WMSZ_TOPRIGHT | WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT => {
            // Project the proposed cursor corner onto the configured aspect-ratio line.
            let height = ((width * ratio + height) / (ratio * ratio + 1.0))
                .max(1.0)
                .max(1.0 / ratio);
            (height * ratio, height)
        }
        _ => return false,
    };
    let width = (width.round() as i32).saturating_add(insets.0);
    let height = (height.round() as i32).saturating_add(insets.1);
    if matches!(edge, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
        rect.left = rect.right.saturating_sub(width);
    } else {
        rect.right = rect.left.saturating_add(width);
    }
    if matches!(edge, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
        rect.top = rect.bottom.saturating_sub(height);
    } else {
        rect.bottom = rect.top.saturating_add(height);
    }
    true
}

#[cfg(test)]
thread_local! {
    static DROPPED_ASPECT_RATIOS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
impl Drop for MainAspectRatio {
    fn drop(&mut self) {
        DROPPED_ASPECT_RATIOS.with(|count| count.set(count.get() + 1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATIO: f64 = 1225.0 / 721.0;
    const EDGES: [u32; 8] = [
        WMSZ_LEFT,
        WMSZ_RIGHT,
        WMSZ_TOP,
        WMSZ_BOTTOM,
        WMSZ_TOPLEFT,
        WMSZ_TOPRIGHT,
        WMSZ_BOTTOMLEFT,
        WMSZ_BOTTOMRIGHT,
    ];

    fn coords(rect: &RECT) -> (i32, i32, i32, i32) {
        (rect.left, rect.top, rect.right, rect.bottom)
    }

    fn assert_ratio(rect: &RECT, insets: (i32, i32)) {
        let width = f64::from(rect.right - rect.left - insets.0);
        let height = f64::from(rect.bottom - rect.top - insets.1);
        assert!(width > 0.0 && height > 0.0);
        assert!(
            (width - height * RATIO).abs() <= (1.0 + RATIO) / 2.0,
            "client {width} x {height} is not uniformly scaled"
        );
    }

    fn assert_anchor(before: &RECT, after: &RECT, edge: u32) {
        if matches!(edge, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
            assert_eq!(after.right, before.right);
        } else {
            assert_eq!(after.left, before.left);
        }
        if matches!(edge, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
            assert_eq!(after.bottom, before.bottom);
        } else {
            assert_eq!(after.top, before.top);
        }
    }

    #[test]
    fn every_edge_grows_and_shrinks_uniformly_without_moving_its_anchor() {
        for insets in [(0, 0), (16, 39), (24, 58)] {
            for edge in EDGES {
                for (width, height) in [(612, 300), (1838, 1200)] {
                    let before = RECT {
                        left: -200,
                        top: 45,
                        right: -200 + width + insets.0,
                        bottom: 45 + height + insets.1,
                    };
                    let mut after = before;
                    assert!(constrain_sizing_rect(&mut after, edge, RATIO, insets));
                    assert_ratio(&after, insets);
                    assert_anchor(&before, &after, edge);
                    if matches!(edge, WMSZ_LEFT | WMSZ_RIGHT) {
                        assert_eq!(after.right - after.left - insets.0, width);
                    } else if matches!(edge, WMSZ_TOP | WMSZ_BOTTOM) {
                        assert_eq!(after.bottom - after.top - insets.1, height);
                    }
                }
            }
        }
    }

    #[test]
    fn corner_projection_responds_to_horizontal_and_vertical_cursor_movement() {
        for edge in [
            WMSZ_TOPLEFT,
            WMSZ_TOPRIGHT,
            WMSZ_BOTTOMLEFT,
            WMSZ_BOTTOMRIGHT,
        ] {
            for (width, height) in [(1500, 721), (1225, 950), (800, 721), (1225, 450)] {
                let before = RECT {
                    left: 10,
                    top: 20,
                    right: 10 + width,
                    bottom: 20 + height,
                };
                let mut after = before;
                constrain_sizing_rect(&mut after, edge, RATIO, (0, 0));
                let projected_height =
                    (f64::from(width) * RATIO + f64::from(height)) / (RATIO * RATIO + 1.0);
                assert_eq!(after.bottom - after.top, projected_height.round() as i32);
                assert_eq!(
                    after.right - after.left,
                    (projected_height * RATIO).round() as i32
                );
                assert_anchor(&before, &after, edge);
                assert_ratio(&after, (0, 0));
            }
        }
    }

    #[test]
    fn unknown_edge_leaves_the_proposed_rectangle_unchanged() {
        let mut rect = RECT {
            left: 3,
            top: 8,
            right: 456,
            bottom: 789,
        };
        let before = coords(&rect);
        assert!(!constrain_sizing_rect(&mut rect, 0, RATIO, (16, 39)));
        assert_eq!(coords(&rect), before);
    }

    #[test]
    fn configured_native_ratio_matches_the_main_page_design() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "main")
            .unwrap();
        let layout = include_str!("../../src/pages/main/mainLayout.ts");
        let page = layout
            .split("export const page: PageRecord = {")
            .nth(1)
            .unwrap()
            .split("};")
            .next()
            .unwrap();
        let dimension = |name: &str| -> f64 {
            let prefix = format!("{name}: ");
            page.lines()
                .find_map(|line| line.trim().strip_prefix(prefix.as_str()))
                .unwrap()
                .trim_end_matches(',')
                .parse()
                .unwrap()
        };
        assert_eq!(main["width"].as_f64().unwrap(), dimension("width"));
        assert_eq!(main["height"].as_f64().unwrap(), dimension("height"));
        assert_eq!(
            main["width"].as_f64().unwrap() / main["height"].as_f64().unwrap(),
            RATIO
        );
    }

    #[test]
    fn native_subclass_constrains_only_its_window_and_releases_its_data_on_destroy() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, GetForegroundWindow, IsWindow, SendMessageW,
            WS_EX_TOOLWINDOW, WS_OVERLAPPEDWINDOW,
        };
        struct HiddenWindow(HWND);
        impl Drop for HiddenWindow {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe {
                        DestroyWindow(self.0);
                    }
                }
            }
        }
        let create = || {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class.as_ptr(),
                    class.as_ptr(),
                    WS_OVERLAPPEDWINDOW,
                    -30000,
                    -30000,
                    320,
                    240,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            HiddenWindow(hwnd)
        };
        let foreground = unsafe { GetForegroundWindow() };
        let dropped_before = DROPPED_ASPECT_RATIOS.with(|count| count.get());
        assert!(install_native(std::ptr::null_mut(), RATIO).is_err());
        assert_eq!(
            DROPPED_ASPECT_RATIOS.with(|count| count.get()),
            dropped_before + 1
        );
        let mut main = create();
        let unrelated = create();
        install_native(main.0, RATIO).unwrap();
        install_native(main.0, RATIO).unwrap();
        let insets = client_insets(main.0).unwrap();
        assert!(insets.0 > 0 && insets.1 > 0);
        for edge in EDGES {
            let before = RECT {
                left: -250,
                top: 75,
                right: 1400,
                bottom: 700,
            };
            let mut rect = before;
            assert_eq!(
                unsafe {
                    SendMessageW(
                        main.0,
                        WM_SIZING,
                        edge as usize,
                        &mut rect as *mut RECT as isize,
                    )
                },
                1
            );
            assert_anchor(&before, &rect, edge);
            assert_ratio(&rect, insets);
            let mut other_rect = before;
            unsafe {
                SendMessageW(
                    unrelated.0,
                    WM_SIZING,
                    edge as usize,
                    &mut other_rect as *mut RECT as isize,
                );
            }
            assert_eq!(coords(&other_rect), coords(&before));
        }
        let mut registered_data = 0;
        assert_ne!(
            unsafe {
                GetWindowSubclass(
                    main.0,
                    Some(resize_subclass),
                    MAIN_RESIZE_SUBCLASS_ID,
                    &mut registered_data,
                )
            },
            0
        );
        assert_ne!(registered_data, 0);
        assert_eq!(
            DROPPED_ASPECT_RATIOS.with(|count| count.get()),
            dropped_before + 1
        );
        let hwnd = main.0;
        assert_ne!(unsafe { DestroyWindow(hwnd) }, 0);
        main.0 = std::ptr::null_mut();
        assert_eq!(unsafe { IsWindow(hwnd) }, 0);
        assert_eq!(
            DROPPED_ASPECT_RATIOS.with(|count| count.get()),
            dropped_before + 2
        );
        assert_eq!(unsafe { GetForegroundWindow() }, foreground);
    }
}
