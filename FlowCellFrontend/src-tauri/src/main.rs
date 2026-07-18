#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod button_state;
mod commands;
mod program_sources;

use commands::bindings::*;
use commands::button_hotkeys::*;
use commands::execution::*;
use commands::filesystem::*;
use commands::illustrator::*;
use commands::layouts::*;
use commands::macros::*;
use commands::organization::*;
use commands::programs::*;
use commands::slicers::*;
use commands::themes::*;
use commands::tool_packages::*;
use commands::tool_state::*;
use commands::windows::*;

use image::imageops::FilterType;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::env;
#[cfg(windows)]
use std::ffi::c_void;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use tauri::Manager;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Foundation::HWND as Win32Hwnd;
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{SetForegroundWindow, ShowWindowAsync, SW_RESTORE};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, BOOL, ERROR_ALREADY_EXISTS, HANDLE, HWND, LPARAM, POINT,
};
#[cfg(windows)]
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    CreateMutexW, OpenProcess, QueryFullProcessImageNameW, ReleaseMutex,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON, VK_SPACE,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow,
    GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, SendMessageTimeoutW, SetForegroundWindow as SetForegroundWindowSys,
    SetWindowLongPtrW, ShowWindowAsync as ShowWindowAsyncSys, WindowFromPoint, GA_ROOT,
    GWLP_HWNDPARENT, GWL_EXSTYLE, GW_HWNDNEXT, SMTO_ABORTIFHUNG, SM_SWAPBUTTON,
    SW_RESTORE as SW_RESTORE_SYS, WM_COPYDATA, WS_EX_TOPMOST,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const SCOPED_TOPMOST_POLL_MS: u64 = 180;
const DEFAULT_BLENDER_BRIDGE_TIMEOUT_SECONDS: u64 = 20;
const BLENDER_BRIDGE_RESPONSE_POLL_MS: u64 = 4;
const BLENDER_BRIDGE_NOT_RUNNING_MESSAGE: &str = "Open Blender first, then run the button again.";
const FLOWCELL_CONTROLLER_SCRIPT_TIMEOUT_SECONDS: u64 = 25;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_TITLE: &str = "FlowCellBackendDirectScriptReceiver";
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_CLASS: &str = "AutoHotkeyGUI";
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_COPYDATA_ID: usize = 0x4643_5344;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_ACCEPTED: usize = 1;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BUSY: usize = 2;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BAD_PAYLOAD: usize = 3;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_BAD_SCRIPT: usize = 4;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_SEND_TIMEOUT_MS: u32 = 160;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_STARTUP_WAIT_MS: u64 = 3500;
#[cfg(windows)]
const FLOWCELL_DIRECT_SCRIPT_RECEIVER_POLL_MS: u64 = 40;

#[cfg(windows)]
const FLOWCELL_SINGLE_INSTANCE_MUTEX: &str = "Local\\com.flowcell.frontend.single-instance-v1";

#[cfg(windows)]
struct FlowCellInstanceGuard {
    handle: HANDLE,
}

#[cfg(windows)]
impl Drop for FlowCellInstanceGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = ReleaseMutex(self.handle);
            let _ = CloseHandle(self.handle);
        }
    }
}

#[cfg(windows)]
fn focus_existing_flowcell_window() {
    let mut title = "FlowCell".encode_utf16().collect::<Vec<_>>();
    title.push(0);
    for _ in 0..20 {
        let window = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        if !window.is_null() {
            unsafe {
                let _ = ShowWindowAsyncSys(window, SW_RESTORE_SYS);
                let _ = SetForegroundWindowSys(window);
            }
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(windows)]
fn acquire_flowcell_instance_guard() -> Result<Option<FlowCellInstanceGuard>, String> {
    let mut name = FLOWCELL_SINGLE_INSTANCE_MUTEX
        .encode_utf16()
        .collect::<Vec<_>>();
    name.push(0);
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if handle.is_null() {
        return Err(format!(
            "Failed to create FlowCell single-instance mutex: {}",
            std::io::Error::last_os_error()
        ));
    }
    let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if already_exists {
        unsafe {
            let _ = CloseHandle(handle);
        }
        focus_existing_flowcell_window();
        return Ok(None);
    }
    Ok(Some(FlowCellInstanceGuard { handle }))
}

fn main() {
    #[cfg(windows)]
    let Some(_instance_guard) = acquire_flowcell_instance_guard()
        .expect("failed to initialize FlowCell single-instance protection")
    else {
        return;
    };

    tauri::Builder::default()
        .manage(ToolSetHotkeyRegistry::default())
        .manage(ScopedTopmostRegistry::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    handle_tool_set_hotkey(app, shortcut, event);
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_host_window_topmost,
            register_scoped_window_topmost,
            refresh_scoped_window_topmost,
            unregister_scoped_window_topmost,
            get_scoped_window_input_state,
            refresh_frontend_host,
            get_foreground_process_info,
            get_native_input_snapshot,
            show_save_layout_dialog,
            show_open_layout_dialog,
            show_open_file_dialog,
            show_open_folder_dialog,
            show_save_file_dialog,
            sample_photo_theme_colors,
            sample_image_palette,
            save_blender_theme_file,
            load_blender_theme_file,
            save_tool_field_file,
            load_tool_field_file,
            resolve_tool_package_root,
            save_tool_package,
            load_tool_package,
            list_tool_packages,
            load_legacy_tool_state,
            load_slicer_executable,
            launch_slicer,
            run_illustrator_layers_action,
            set_illustrator_layers_highlight,
            save_layout_snapshot,
            load_layout_snapshot,
            list_program_folders,
            list_panel_folders,
            create_program_folder,
            rename_program_folder,
            rollback_program_rename,
            finalize_program_rename,
            recover_program_rename,
            begin_program_unregistration,
            rollback_program_unregistration,
            finalize_program_unregistration,
            create_panel_folder,
            rename_panel_folder,
            delete_panel_folder,
            list_panel_script_files,
            load_binds_workspace,
            save_bind_shortcut,
            get_cursor_position,
            is_space_key_down,
            is_primary_mouse_button_down,
            list_frontend_macros,
            list_frontend_panel_macros,
            load_frontend_macro,
            load_frontend_macro_from_path,
            get_frontend_macro_directory,
            save_frontend_macro,
            delete_frontend_macro,
            run_frontend_macro,
            record_frontend_macro,
            save_macro_shortcut,
            button_state::load_button_state,
            button_state::commit_button_state,
            button_state::set_button_bootstrap_failure,
            program_sources::install::install_button_source,
            program_sources::install::update_button_source,
            program_sources::synchronize::synchronize_bundled_program_sources,
            program_sources::delete::uninstall_button_source,
            program_sources::migrate::prepare_legacy_button_bootstrap,
            run_panel_script_response,
            run_panel_button_event,
            run_toolset_action,
            program_sources::execute::run_program_capability_action,
            program_sources::execute::set_program_capability_state,
            scan_organization_project,
            read_organization_profile,
            write_organization_profile,
            list_organization_profiles,
            read_organization_profile_named,
            save_organization_profile_as,
            apply_organization_profile_to_root,
            apply_organization_profile_folders,
            make_organization_profile_script,
            create_organization_folder,
            recycle_organization_folder,
            restore_recycled_folder
        ])
        .setup(|app| {
            program_sources::rename::recover_rename_transactions_on_startup()
                .map_err(std::io::Error::other)?;
            let recovered_program_renames =
                button_state::recover_program_rename_transactions_on_startup()
                    .map_err(std::io::Error::other)?;
            if recovered_program_renames > 0 {
                restart_flowcell_headless_backend().map_err(std::io::Error::other)?;
            }
            program_sources::install::recover_install_transactions_on_startup()
                .map_err(std::io::Error::other)?;
            button_state::recover_button_source_transactions_on_startup()
                .map_err(std::io::Error::other)?;

            if let Err(error) = synchronize_tool_set_hotkeys(app.handle()) {
                let message =
                    format!("Tool Set hotkeys could not be synchronized at startup: {error}");
                eprintln!("{message}");
                append_flowcell_local_log("child_hotkeys.log", &message);
            }

            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_square_corner_preference(&window);
            }

            #[cfg(windows)]
            {
                let registry = app.state::<ScopedTopmostRegistry>().inner().clone();
                start_scoped_topmost_worker(app.handle().clone(), registry);
                start_native_input_worker(app.handle().clone());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FlowCell");
}
