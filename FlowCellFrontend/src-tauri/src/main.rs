#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod button_state;
mod commands;
mod program_sources;

use commands::bindings::*;
use commands::execution::*;
use commands::filesystem::*;
use commands::illustrator::*;
use commands::layouts::*;
use commands::macros::*;
use commands::organization::*;
use commands::programs::*;
use commands::slicers::*;
use commands::themes::*;
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
use tauri::{AppHandle, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    DWM_WINDOW_CORNER_PREFERENCE,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{SetForegroundWindow, ShowWindowAsync, SW_RESTORE};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, POINT};
#[cfg(windows)]
use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(windows)]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON, VK_SPACE,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowW, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow,
    GetSystemMetrics, GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, SendMessageTimeoutW, SetWindowLongPtrW, WindowFromPoint, GA_ROOT,
    GWLP_HWNDPARENT, GW_HWNDNEXT, SMTO_ABORTIFHUNG, SM_SWAPBUTTON, WM_COPYDATA,
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

fn main() {
    tauri::Builder::default()
        .manage(ScopedTopmostRegistry::default())
        .invoke_handler(tauri::generate_handler![
            set_host_window_topmost,
            register_scoped_window_topmost,
            refresh_scoped_window_topmost,
            unregister_scoped_window_topmost,
            refresh_frontend_host,
            get_foreground_process_info,
            show_save_layout_dialog,
            show_open_layout_dialog,
            show_open_file_dialog,
            show_open_folder_dialog,
            show_save_file_dialog,
            sample_photo_theme_colors,
            save_blender_theme_file,
            load_blender_theme_file,
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
            delete_program_folder,
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
            program_sources::delete::uninstall_button_source,
            program_sources::migrate::prepare_legacy_button_bootstrap,
            run_panel_script_response,
            run_panel_button_event,
            run_toolset_action,
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
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_square_corner_preference(&window);
            }

            #[cfg(windows)]
            {
                let registry = app.state::<ScopedTopmostRegistry>().inner().clone();
                start_scoped_topmost_worker(app.handle().clone(), registry);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FlowCell");
}
