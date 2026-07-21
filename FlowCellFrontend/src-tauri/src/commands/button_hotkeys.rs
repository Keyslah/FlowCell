use super::bindings::{
    is_tool_set_binding, read_bindings_file_state, TOOL_SET_CHILD_BINDING_KIND,
    TOOL_SET_OWNER_BINDING_KIND,
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

const TOOL_SET_CHILD_HOTKEY_EVENT: &str = "flowcell:tool-set-child-hotkey";
const TOOL_SET_OWNER_HOTKEY_EVENT: &str = "flowcell:tool-set-owner-hotkey";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolSetHotkeyPayload {
    binding_id: u64,
    shortcut: String,
    target_kind: String,
    button_id: String,
    owner_button_id: String,
}

#[derive(Clone)]
struct RegisteredToolSetHotkey {
    shortcut: Shortcut,
    payload: ToolSetHotkeyPayload,
}

#[derive(Clone, Default)]
struct ToolSetHotkeyRegistryState {
    by_shortcut_id: HashMap<u32, RegisteredToolSetHotkey>,
    pressed_shortcut_ids: HashSet<u32>,
}

#[derive(Default)]
pub(crate) struct ToolSetHotkeyRegistry {
    synchronize_lock: Mutex<()>,
    state: Mutex<ToolSetHotkeyRegistryState>,
}

fn registry_lock_error() -> String {
    String::from("Tool Set hotkey registry lock failed.")
}

fn replace_registry_state(
    registry: &ToolSetHotkeyRegistry,
    by_shortcut_id: HashMap<u32, RegisteredToolSetHotkey>,
) -> Result<(), String> {
    let mut state = registry.state.lock().map_err(|_| registry_lock_error())?;
    state.by_shortcut_id = by_shortcut_id;
    let registered_ids = state.by_shortcut_id.keys().copied().collect::<HashSet<_>>();
    state
        .pressed_shortcut_ids
        .retain(|shortcut_id| registered_ids.contains(shortcut_id));
    Ok(())
}

fn append_rollback_error(message: &mut String, errors: &[String]) {
    if errors.is_empty() {
        return;
    }
    message.push_str(" Rollback also reported: ");
    message.push_str(&errors.join(" | "));
}

fn should_dispatch_shortcut_event(
    pressed_shortcut_ids: &mut HashSet<u32>,
    shortcut_id: u32,
    state: ShortcutState,
) -> bool {
    if state == ShortcutState::Released {
        pressed_shortcut_ids.remove(&shortcut_id);
        return false;
    }
    state == ShortcutState::Pressed && pressed_shortcut_ids.insert(shortcut_id)
}

fn load_desired_tool_set_hotkeys() -> Result<HashMap<u32, RegisteredToolSetHotkey>, String> {
    let (bindings, _, _) = read_bindings_file_state()?;
    let mut desired = HashMap::new();

    for binding in bindings.script_bindings {
        if !is_tool_set_binding(&binding) {
            continue;
        }

        let target_kind = binding.kind.as_deref().unwrap_or_default();

        let binding_id = binding
            .binding_id
            .or(binding.id)
            .ok_or_else(|| String::from("A Tool Set binding is missing its binding ID."))?;
        let shortcut_text = binding.shortcut.trim();
        if shortcut_text.is_empty() {
            continue;
        }
        let button_id = binding.target.trim();
        if button_id.is_empty() {
            return Err(format!(
                "Tool Set binding {binding_id} is missing its Button ID."
            ));
        }
        let owner_button_id = binding
            .owner_button_id
            .as_deref()
            .unwrap_or_default()
            .trim();
        if owner_button_id.is_empty() {
            return Err(format!(
                "Tool Set binding {binding_id} is missing its owner Button ID."
            ));
        }
        if target_kind == TOOL_SET_OWNER_BINDING_KIND && button_id != owner_button_id {
            return Err(format!(
                "Tool-set owner binding {binding_id} must use the same Button ID and owner Button ID."
            ));
        }

        let accelerator = ahk_shortcut_to_plugin_accelerator(shortcut_text).map_err(|error| {
            format!(
                "Tool Set binding {binding_id} has unsupported shortcut '{shortcut_text}': {error}"
            )
        })?;
        let shortcut = accelerator.parse::<Shortcut>().map_err(|error| {
            format!(
                "Tool Set binding {binding_id} could not parse shortcut '{shortcut_text}' as '{accelerator}': {error}"
            )
        })?;
        let shortcut_id = shortcut.id();
        let entry = RegisteredToolSetHotkey {
            shortcut,
            payload: ToolSetHotkeyPayload {
                binding_id,
                shortcut: shortcut_text.to_string(),
                target_kind: target_kind.to_string(),
                button_id: button_id.to_string(),
                owner_button_id: owner_button_id.to_string(),
            },
        };

        if let Some(existing) = desired.insert(shortcut_id, entry) {
            return Err(format!(
                "Tool Set bindings {} and {} resolve to the same shortcut.",
                existing.payload.binding_id, binding_id
            ));
        }
    }

    Ok(desired)
}

pub(crate) fn synchronize_tool_set_hotkeys(app: &AppHandle) -> Result<(), String> {
    let registry = app.state::<ToolSetHotkeyRegistry>();
    let _synchronize_guard = registry
        .synchronize_lock
        .lock()
        .map_err(|_| registry_lock_error())?;
    // Read the desired snapshot only after this caller owns the synchronization
    // lane. Otherwise an older caller can wait here and apply stale bindings
    // after a newer synchronization has already completed.
    let desired = load_desired_tool_set_hotkeys()?;
    let previous = registry
        .state
        .lock()
        .map_err(|_| registry_lock_error())?
        .clone()
        .by_shortcut_id;
    let manager = app.global_shortcut();

    let mut added = desired
        .iter()
        .filter(|(shortcut_id, _)| !previous.contains_key(shortcut_id))
        .map(|(_, entry)| entry.clone())
        .collect::<Vec<_>>();
    added.sort_by_key(|entry| entry.payload.binding_id);

    let mut registered_added: Vec<RegisteredToolSetHotkey> = Vec::new();
    for entry in &added {
        if let Err(error) = manager.register(entry.shortcut) {
            let mut actual = previous.clone();
            let mut rollback_errors = Vec::new();
            for registered in registered_added.iter().rev() {
                if let Err(rollback_error) = manager.unregister(registered.shortcut) {
                    actual.insert(registered.shortcut.id(), registered.clone());
                    rollback_errors.push(rollback_error.to_string());
                }
            }
            replace_registry_state(&registry, actual)?;

            let mut message = format!(
                "Could not register Tool Set shortcut '{}': {error}",
                entry.payload.shortcut
            );
            append_rollback_error(&mut message, &rollback_errors);
            return Err(message);
        }
        registered_added.push(entry.clone());
    }

    let mut removed = previous
        .iter()
        .filter(|(shortcut_id, _)| !desired.contains_key(shortcut_id))
        .map(|(_, entry)| entry.clone())
        .collect::<Vec<_>>();
    removed.sort_by_key(|entry| entry.payload.binding_id);

    let mut unregistered_removed: Vec<RegisteredToolSetHotkey> = Vec::new();
    for entry in &removed {
        if let Err(error) = manager.unregister(entry.shortcut) {
            let mut actual = previous.clone();
            for registered in &registered_added {
                actual.insert(registered.shortcut.id(), registered.clone());
            }
            for unregistered in &unregistered_removed {
                actual.remove(&unregistered.shortcut.id());
            }

            let mut rollback_errors = Vec::new();
            for unregistered in unregistered_removed.iter().rev() {
                match manager.register(unregistered.shortcut) {
                    Ok(()) => {
                        actual.insert(unregistered.shortcut.id(), unregistered.clone());
                    }
                    Err(rollback_error) => rollback_errors.push(rollback_error.to_string()),
                }
            }
            for registered in registered_added.iter().rev() {
                match manager.unregister(registered.shortcut) {
                    Ok(()) => {
                        actual.remove(&registered.shortcut.id());
                    }
                    Err(rollback_error) => rollback_errors.push(rollback_error.to_string()),
                }
            }
            replace_registry_state(&registry, actual)?;

            let mut message = format!(
                "Could not unregister previous Tool Set shortcut '{}': {error}",
                entry.payload.shortcut
            );
            append_rollback_error(&mut message, &rollback_errors);
            return Err(message);
        }
        unregistered_removed.push(entry.clone());
    }

    replace_registry_state(&registry, desired)
}

pub(crate) fn handle_tool_set_hotkey(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    let shortcut_id = shortcut.id();
    let registry = app.state::<ToolSetHotkeyRegistry>();
    let payload = match registry.state.lock() {
        Ok(mut state) => {
            if !state.by_shortcut_id.contains_key(&shortcut_id)
                || !should_dispatch_shortcut_event(
                    &mut state.pressed_shortcut_ids,
                    shortcut_id,
                    event.state,
                )
            {
                return;
            }
            state
                .by_shortcut_id
                .get(&shortcut_id)
                .map(|entry| entry.payload.clone())
        }
        Err(_) => {
            let message = registry_lock_error();
            eprintln!("{message}");
            crate::append_flowcell_local_log("child_hotkeys.log", &message);
            None
        }
    };
    let Some(payload) = payload else {
        return;
    };

    if payload.target_kind == TOOL_SET_OWNER_BINDING_KIND {
        if app.get_webview_window("main").is_none() {
            let message = format!(
                "Tool-set owner hotkey '{}' was ignored because the main FlowCell window is unavailable.",
                payload.shortcut
            );
            eprintln!("{message}");
            crate::append_flowcell_local_log("child_hotkeys.log", &message);
            return;
        }
        if let Err(error) = app.emit_to("main", TOOL_SET_OWNER_HOTKEY_EVENT, payload.clone()) {
            let message = format!(
                "Tool-set owner hotkey '{}' could not be delivered to the main window: {error}",
                payload.shortcut
            );
            eprintln!("{message}");
            crate::append_flowcell_local_log("child_hotkeys.log", &message);
        }
        return;
    }
    if payload.target_kind != TOOL_SET_CHILD_BINDING_KIND {
        let message = format!(
            "Tool Set hotkey '{}' has unknown target kind '{}'.",
            payload.shortcut, payload.target_kind
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("child_hotkeys.log", &message);
        return;
    }

    let window_label = match build_button_popout_window_label(&payload.owner_button_id) {
        Ok(label) => label,
        Err(error) => {
            eprintln!("{error}");
            crate::append_flowcell_local_log("child_hotkeys.log", &error);
            return;
        }
    };
    if app.get_webview_window(&window_label).is_none() {
        let message = format!(
            "Tool-set child hotkey '{}' was ignored because owner '{}' is not active (missing window '{}').",
            payload.shortcut, payload.owner_button_id, window_label
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("child_hotkeys.log", &message);
        return;
    }

    if let Err(error) = app.emit_to(&window_label, TOOL_SET_CHILD_HOTKEY_EVENT, payload.clone()) {
        let message = format!(
            "Tool-set child hotkey '{}' could not be delivered to '{}': {error}",
            payload.shortcut, window_label
        );
        eprintln!("{message}");
        crate::append_flowcell_local_log("child_hotkeys.log", &message);
    }
}

fn ahk_shortcut_to_plugin_accelerator(value: &str) -> Result<String, String> {
    let shortcut = value.trim();
    if shortcut.is_empty() {
        return Err(String::from("the shortcut is empty"));
    }
    if shortcut.contains(['~', '*', '$']) {
        return Err(String::from(
            "AHK pass-through, wildcard, and hook modifiers are not supported for Tool Set bindings",
        ));
    }
    if shortcut.contains(['<', '>']) {
        return Err(String::from(
            "side-specific modifiers and AltGr are not supported for Tool Set bindings",
        ));
    }
    if shortcut.contains('&') || shortcut.contains("::") {
        return Err(String::from(
            "AHK custom combinations and hotkey declarations are not supported for Tool Set bindings",
        ));
    }

    let mut control = false;
    let mut alt = false;
    let mut shift = false;
    let mut super_key = false;
    let mut key_start = 0;
    for (index, character) in shortcut.char_indices() {
        match character {
            '^' => control = true,
            '!' => alt = true,
            '+' => shift = true,
            '#' => super_key = true,
            _ => {
                key_start = index;
                break;
            }
        }
        key_start = index + character.len_utf8();
    }

    let mut key_token = shortcut[key_start..].trim();
    if key_token.is_empty() {
        return Err(String::from(
            "the shortcut has modifiers but no primary key",
        ));
    }
    if key_token.starts_with('{') || key_token.ends_with('}') {
        if !(key_token.starts_with('{') && key_token.ends_with('}') && key_token.len() >= 2) {
            return Err(String::from("the AHK key braces are malformed"));
        }
        key_token = key_token[1..key_token.len() - 1].trim();
    }
    if key_token.to_ascii_lowercase().ends_with(" up") {
        return Err(String::from(
            "AHK key-up bindings are not supported for Tool Set bindings",
        ));
    }

    let (plugin_key, key_requires_shift) = plugin_key_for_ahk_key(key_token)?;
    shift |= key_requires_shift;

    let mut parts = Vec::new();
    if control {
        parts.push(String::from("Control"));
    }
    if alt {
        parts.push(String::from("Alt"));
    }
    if shift {
        parts.push(String::from("Shift"));
    }
    if super_key {
        parts.push(String::from("Super"));
    }
    parts.push(plugin_key);
    Ok(parts.join("+"))
}

pub(crate) fn validate_tool_set_shortcut(value: &str) -> Result<(), String> {
    let accelerator = ahk_shortcut_to_plugin_accelerator(value)?;
    accelerator
        .parse::<Shortcut>()
        .map(|_| ())
        .map_err(|error| {
            format!(
                "the global shortcut runtime could not parse '{value}' as '{accelerator}': {error}"
            )
        })
}

pub(crate) fn keyboard_shortcut_conflict_key(value: &str) -> Option<u32> {
    let accelerator = ahk_shortcut_to_plugin_accelerator(value).ok()?;
    accelerator
        .parse::<Shortcut>()
        .ok()
        .map(|shortcut| shortcut.id())
}

fn plugin_key_for_ahk_key(value: &str) -> Result<(String, bool), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(String::from("the primary key is empty"));
    }
    let normalized = trimmed.to_ascii_lowercase();
    if normalized.starts_with("wheel")
        || normalized.ends_with("button")
        || normalized.starts_with("joy")
    {
        return Err(format!(
            "mouse, wheel, and joystick key '{trimmed}' is not supported for Tool Set bindings"
        ));
    }
    if normalized == "appskey" || normalized == "menu" {
        return Err(String::from(
            "the Apps/Menu key is not supported by the global shortcut runtime",
        ));
    }
    if normalized.contains(char::is_whitespace) {
        return Err(format!(
            "AHK key options and repeated-key forms such as '{trimmed}' are not supported"
        ));
    }

    if trimmed.len() == 1 {
        let character = trimmed.chars().next().unwrap_or_default();
        if character.is_ascii_alphabetic() {
            return Ok((character.to_ascii_uppercase().to_string(), false));
        }
        if character.is_ascii_digit() {
            return Ok((character.to_string(), false));
        }
    }
    if let Some(function_number) = normalized.strip_prefix('f') {
        if function_number
            .parse::<u8>()
            .ok()
            .filter(|number| (1..=24).contains(number))
            .is_some()
        {
            return Ok((normalized.to_ascii_uppercase(), false));
        }
    }

    let resolved = match normalized.as_str() {
        "-" | "minus" => ("Minus", false),
        "=" | "equal" => ("Equal", false),
        "+" | "plus" => ("Equal", true),
        "`" | "backquote" => ("Backquote", false),
        "\\" | "backslash" => ("Backslash", false),
        "[" | "bracketleft" => ("BracketLeft", false),
        "]" | "bracketright" => ("BracketRight", false),
        "," | "comma" => ("Comma", false),
        "." | "period" => ("Period", false),
        "'" | "quote" => ("Quote", false),
        ";" | "semicolon" => ("Semicolon", false),
        "/" | "slash" => ("Slash", false),
        "esc" | "escape" => ("Escape", false),
        "enter" | "return" => ("Enter", false),
        "tab" => ("Tab", false),
        "space" => ("Space", false),
        "backspace" | "bs" => ("Backspace", false),
        "delete" | "del" => ("Delete", false),
        "insert" | "ins" => ("Insert", false),
        "home" => ("Home", false),
        "end" => ("End", false),
        "pgup" | "prior" | "pageup" => ("PageUp", false),
        "pgdn" | "next" | "pagedown" => ("PageDown", false),
        "up" | "arrowup" => ("ArrowUp", false),
        "down" | "arrowdown" => ("ArrowDown", false),
        "left" | "arrowleft" => ("ArrowLeft", false),
        "right" | "arrowright" => ("ArrowRight", false),
        "capslock" => ("CapsLock", false),
        "numlock" => ("NumLock", false),
        "scrolllock" => ("ScrollLock", false),
        "printscreen" => ("PrintScreen", false),
        "pause" | "break" | "pausebreak" => ("Pause", false),
        "numpad0" | "num0" => ("Numpad0", false),
        "numpad1" | "num1" => ("Numpad1", false),
        "numpad2" | "num2" => ("Numpad2", false),
        "numpad3" | "num3" => ("Numpad3", false),
        "numpad4" | "num4" => ("Numpad4", false),
        "numpad5" | "num5" => ("Numpad5", false),
        "numpad6" | "num6" => ("Numpad6", false),
        "numpad7" | "num7" => ("Numpad7", false),
        "numpad8" | "num8" => ("Numpad8", false),
        "numpad9" | "num9" => ("Numpad9", false),
        "numpadadd" | "numadd" | "numpadplus" | "numplus" => ("NumpadAdd", false),
        "numpaddecimal" | "numdecimal" | "numpaddot" | "numdot" => ("NumpadDecimal", false),
        "numpaddivide" | "numdivide" | "numpaddiv" | "numdiv" => ("NumpadDivide", false),
        "numpadenter" | "numenter" => ("NumpadEnter", false),
        "numpadequal" | "numequal" => ("NumpadEqual", false),
        "numpadmultiply" | "nummultiply" | "numpadmult" | "nummult" => ("NumpadMultiply", false),
        "numpadsubtract" | "numsubtract" | "numpadsub" | "numsub" => ("NumpadSubtract", false),
        "volumedown" | "volume_down" | "audiovolumedown" => ("AudioVolumeDown", false),
        "volumeup" | "volume_up" | "audiovolumeup" => ("AudioVolumeUp", false),
        "volumemute" | "volume_mute" | "audiovolumemute" => ("AudioVolumeMute", false),
        "mediaplay" => ("MediaPlay", false),
        "mediapause" => ("MediaPause", false),
        "mediaplaypause" | "media_play_pause" => ("MediaPlayPause", false),
        "mediastop" => ("MediaStop", false),
        "medianext" | "media_next" | "mediatracknext" => ("MediaTrackNext", false),
        "mediaprev" | "media_prev" | "mediaprevious" | "mediatrackprev" | "mediatrackprevious" => {
            ("MediaTrackPrevious", false)
        }
        _ => {
            return Err(format!(
                "primary key '{trimmed}' is not supported by the global shortcut runtime"
            ))
        }
    };
    Ok((String::from(resolved.0), resolved.1))
}

fn build_button_popout_window_label(owner_button_id: &str) -> Result<String, String> {
    let normalized = owner_button_id.trim();
    if normalized.is_empty() {
        return Err(String::from(
            "A stable owner Button ID is required for a Tool Set hotkey.",
        ));
    }

    let mut hash = 0x811c_9dc5_u32;
    let mut readable = String::new();
    for (index, code_unit) in normalized.encode_utf16().enumerate() {
        hash ^= u32::from(code_unit);
        hash = hash.wrapping_mul(0x0100_0193);
        if index < 72 {
            let ascii_alphanumeric = (u16::from(b'0')..=u16::from(b'9')).contains(&code_unit)
                || (u16::from(b'A')..=u16::from(b'Z')).contains(&code_unit)
                || (u16::from(b'a')..=u16::from(b'z')).contains(&code_unit);
            let allowed_punctuation = code_unit == u16::from(b'-')
                || code_unit == u16::from(b'/')
                || code_unit == u16::from(b':')
                || code_unit == u16::from(b'_');
            let character = if ascii_alphanumeric || allowed_punctuation {
                char::from_u32(u32::from(code_unit)).unwrap_or('_')
            } else {
                '_'
            };
            readable.push(character);
        }
    }
    if readable.is_empty() {
        readable.push_str("button");
    }

    Ok(format!(
        "button-popout-{}-{}",
        readable,
        unsigned_to_base36(hash)
    ))
}

fn unsigned_to_base36(mut value: u32) -> String {
    if value == 0 {
        return String::from("0");
    }
    let mut reversed = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        reversed.push(if digit < 10 {
            char::from(b'0' + digit)
        } else {
            char::from(b'a' + digit - 10)
        });
        value /= 36;
    }
    reversed.into_iter().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::{
        ahk_shortcut_to_plugin_accelerator, build_button_popout_window_label,
        keyboard_shortcut_conflict_key, should_dispatch_shortcut_event,
    };
    use std::collections::HashSet;
    use tauri_plugin_global_shortcut::Shortcut;
    use tauri_plugin_global_shortcut::ShortcutState;

    fn assert_converts(ahk: &str, expected: &str) {
        let converted = ahk_shortcut_to_plugin_accelerator(ahk).unwrap();
        assert_eq!(converted, expected);
        converted.parse::<Shortcut>().unwrap();
    }

    #[test]
    fn converts_supported_ahk_shortcuts_to_plugin_accelerators() {
        assert_converts("^!+F13", "Control+Alt+Shift+F13");
        assert_converts("#^a", "Control+Super+A");
        assert_converts("^!{PgDn}", "Control+Alt+PageDown");
        assert_converts("^!+-", "Control+Alt+Shift+Minus");
        assert_converts("^!{NumpadAdd}", "Control+Alt+NumpadAdd");
        assert_converts("^!{NumpadSub}", "Control+Alt+NumpadSubtract");
        assert_converts("{Media_Play_Pause}", "MediaPlayPause");
        assert_converts("{Volume_Up}", "AudioVolumeUp");
        assert_converts("{+}", "Shift+Equal");
    }

    #[test]
    fn rejects_ahk_only_or_non_keyboard_shortcuts() {
        for shortcut in [
            "~^!F1", "*^!F1", "$^!F1", "<^>!a", "<^a", "^WheelUp", "^LButton", "^a up",
        ] {
            assert!(
                ahk_shortcut_to_plugin_accelerator(shortcut).is_err(),
                "{shortcut} should be rejected"
            );
        }
    }

    #[test]
    fn equivalent_ahk_keyboard_spellings_share_one_conflict_key() {
        assert_eq!(
            keyboard_shortcut_conflict_key("^!A"),
            keyboard_shortcut_conflict_key("!^a")
        );
        assert_eq!(
            keyboard_shortcut_conflict_key("^!{PgDn}"),
            keyboard_shortcut_conflict_key("!^PageDown")
        );
    }

    #[test]
    fn repeated_pressed_events_are_ignored_until_release() {
        let mut pressed = HashSet::new();
        assert!(should_dispatch_shortcut_event(
            &mut pressed,
            42,
            ShortcutState::Pressed
        ));
        assert!(!should_dispatch_shortcut_event(
            &mut pressed,
            42,
            ShortcutState::Pressed
        ));
        assert!(!should_dispatch_shortcut_event(
            &mut pressed,
            42,
            ShortcutState::Released
        ));
        assert!(should_dispatch_shortcut_event(
            &mut pressed,
            42,
            ShortcutState::Pressed
        ));
    }

    #[test]
    fn button_popout_labels_match_the_typescript_contract() {
        assert_eq!(
            build_button_popout_window_label("owner:rotate").unwrap(),
            "button-popout-owner:rotate-vrpp61"
        );
        assert_eq!(
            build_button_popout_window_label("a1b2c3d4-1111-2222-3333-abcdefabcdef").unwrap(),
            "button-popout-a1b2c3d4-1111-2222-3333-abcdefabcdef-ec84up"
        );
        assert_eq!(
            build_button_popout_window_label("owner/Blender Rotate").unwrap(),
            "button-popout-owner/Blender_Rotate-chvgja"
        );
        assert_eq!(
            build_button_popout_window_label("owner:😀:rotate").unwrap(),
            "button-popout-owner:__:rotate-1f4iry4"
        );
    }
}
