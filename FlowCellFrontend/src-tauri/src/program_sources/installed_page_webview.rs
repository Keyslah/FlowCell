use serde::Serialize;
use serde_json::Value;
use tauri::WebviewWindow;
#[cfg(windows)]
use tauri::{Emitter, Manager};

const INSTALLED_PAGE_WINDOW_PREFIX: &str = "flowcell-installed-page-";
const INSTALLED_PAGE_EVENT: &str = "flowcell-installed-page-native-message";
const MAX_PAGE_DOCUMENT_BYTES: usize = 128 * 1024 * 1024;
const MAX_PAGE_MESSAGE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPageNativeMessage {
    message_json: String,
}

fn validate_window_label(label: &str) -> Result<(), String> {
    if !label.starts_with(INSTALLED_PAGE_WINDOW_PREFIX)
        || label.len() <= INSTALLED_PAGE_WINDOW_PREFIX.len()
        || label.len() > 160
        || !label
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Installed pages can only mount in their dedicated Core host window.".into());
    }
    Ok(())
}

fn validate_nonce(nonce: &str) -> Result<(), String> {
    if nonce.is_empty()
        || nonce.len() > 160
        || !nonce
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Installed page bridge nonce is invalid.".into());
    }
    Ok(())
}

fn message_field<'a>(object: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn is_valid_page_message(message_json: &str, expected_nonce: &str) -> bool {
    if message_json.len() > MAX_PAGE_MESSAGE_BYTES {
        return false;
    }
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(message_json) else {
        return false;
    };
    if message_field(&object, "channel") != Some("flowcell-installed-page")
        || message_field(&object, "nonce") != Some(expected_nonce)
    {
        return false;
    }
    match message_field(&object, "type") {
        Some("request") => {
            let request_id = message_field(&object, "requestId").unwrap_or_default();
            let action_id = message_field(&object, "actionId").unwrap_or_default();
            object.len() == 6
                && object.contains_key("payload")
                && !request_id.is_empty()
                && request_id.len() <= 160
                && !action_id.is_empty()
                && action_id.len() <= 160
        }
        Some("security-probe") => {
            object.len() == 10
                && message_field(&object, "href").is_some()
                && object
                    .get("hasTauriInternals")
                    .and_then(Value::as_bool)
                    .is_some()
                && object
                    .get("hasTauriInvoke")
                    .and_then(Value::as_bool)
                    .is_some()
                && object
                    .get("hasTauriGlobal")
                    .and_then(Value::as_bool)
                    .is_some()
                && object
                    .get("hasNodeProcess")
                    .and_then(Value::as_bool)
                    .is_some()
                && object
                    .get("hasFlowcellPage")
                    .and_then(Value::as_bool)
                    .is_some()
                && object
                    .get("hasRawWryIpc")
                    .and_then(Value::as_bool)
                    .is_some()
        }
        _ => false,
    }
}

fn security_probe_passed(message_json: &str) -> Option<bool> {
    let Value::Object(object) = serde_json::from_str::<Value>(message_json).ok()? else {
        return None;
    };
    if message_field(&object, "type") != Some("security-probe") {
        return None;
    }
    Some(
        message_field(&object, "href") == Some("https://flowcell-page.localhost/index.html")
            && !object.get("hasTauriInternals")?.as_bool()?
            && !object.get("hasTauriInvoke")?.as_bool()?
            && !object.get("hasTauriGlobal")?.as_bool()?
            && !object.get("hasNodeProcess")?.as_bool()?
            && object.get("hasFlowcellPage")?.as_bool()?
            && object.get("hasRawWryIpc")?.as_bool()?,
    )
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::borrow::Cow;
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Arc;
    use wry::dpi::{PhysicalPosition, PhysicalSize};
    use wry::http::{header, Response, StatusCode};
    use wry::{NewWindowResponse, Rect, WebView, WebViewBuilder, WebViewBuilderExtWindows};

    const PAGE_SCHEME: &str = "flowcell-page";
    const PAGE_URL: &str = "flowcell-page://localhost/index.html";
    const ISOLATION_PENDING: u8 = 0;
    const ISOLATION_VERIFIED: u8 = 1;
    const ISOLATION_REJECTED: u8 = 2;
    const PAGE_CSP: &str = "default-src 'none'; base-uri 'none'; connect-src 'none'; child-src 'none'; font-src data:; form-action 'none'; frame-src 'none'; img-src data: blob:; manifest-src 'none'; media-src data: blob:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'none'";
    thread_local! {
        static PAGE_WEBVIEWS: RefCell<BTreeMap<String, WebView>> = RefCell::new(BTreeMap::new());
    }

    fn is_page_url(url: &str) -> bool {
        matches!(
            url,
            "flowcell-page://localhost/index.html"
                | "http://flowcell-page.localhost/index.html"
                | "https://flowcell-page.localhost/index.html"
        )
    }

    fn page_bounds(width: u32, height: u32) -> Rect {
        Rect {
            position: PhysicalPosition::new(0, 0).into(),
            size: PhysicalSize::new(width.max(1), height.max(1)).into(),
        }
    }

    async fn run_on_main_thread<T, F>(window: &WebviewWindow, operation: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window
            .run_on_main_thread(move || {
                let _ = sender.blocking_send(operation());
            })
            .map_err(|error| format!("Failed to schedule installed page webview work: {error}"))?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "Installed page webview worker stopped before replying.".to_string())?
    }

    async fn run_with_parent_webview<T, F>(
        window: &WebviewWindow,
        operation: F,
    ) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(tauri::webview::PlatformWebview) -> Result<T, String> + Send + 'static,
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window
            .with_webview(move |parent_webview| {
                let _ = sender.blocking_send(operation(parent_webview));
            })
            .map_err(|error| format!("Failed to schedule installed page webview work: {error}"))?;
        receiver
            .recv()
            .await
            .ok_or_else(|| "Installed page webview worker stopped before replying.".to_string())?
    }

    pub(super) async fn mount(
        window: WebviewWindow,
        html: String,
        nonce: String,
    ) -> Result<(), String> {
        let label = window.label().to_string();
        validate_window_label(&label)?;
        validate_nonce(&nonce)?;
        if html.is_empty() || html.len() > MAX_PAGE_DOCUMENT_BYTES {
            return Err("Installed page document is empty or exceeds the 128 MiB limit.".into());
        }
        let size = window
            .inner_size()
            .map_err(|error| format!("Failed to read installed page host size: {error}"))?;
        let app = window.app_handle().clone();
        let parent = window.clone();
        run_with_parent_webview(&window, move |parent_webview| {
            let page_html = Arc::new(html.into_bytes());
            let protocol_html = page_html.clone();
            let ipc_label = label.clone();
            let ipc_nonce = nonce.clone();
            let ipc_app = app.clone();
            let isolation_state = Arc::new(AtomicU8::new(ISOLATION_PENDING));
            let ipc_isolation_state = isolation_state.clone();
            let parent_environment = parent_webview.environment();
            let webview = WebViewBuilder::new()
                .with_environment(parent_environment)
                .with_bounds(page_bounds(size.width, size.height))
                .with_custom_protocol(PAGE_SCHEME.into(), move |_webview_id, request| {
                    let is_entry = request.uri().path() == "/index.html";
                    let status = if is_entry {
                        StatusCode::OK
                    } else {
                        StatusCode::NOT_FOUND
                    };
                    let body = if is_entry {
                        Cow::<[u8]>::Owned(protocol_html.as_ref().clone())
                    } else {
                        Cow::<[u8]>::Borrowed(&[])
                    };
                    Response::builder()
                        .status(status)
                        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                        .header("Content-Security-Policy", PAGE_CSP)
                        .header("Referrer-Policy", "no-referrer")
                        .header("X-Content-Type-Options", "nosniff")
                        .header("X-DNS-Prefetch-Control", "off")
                        .body(body)
                        .expect("static installed page response headers are valid")
                })
                .with_url(PAGE_URL)
                .with_https_scheme(true)
                .with_navigation_handler(|url| is_page_url(&url))
                .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
                .with_download_started_handler(|_, _| false)
                .with_drag_drop_handler(|_| true)
                .with_clipboard(false)
                .with_incognito(true)
                .with_general_autofill_enabled(false)
                .with_hotkeys_zoom(false)
                .with_back_forward_navigation_gestures(false)
                .with_devtools(false)
                .with_browser_accelerator_keys(false)
                .with_default_context_menus(false)
                .with_browser_extensions_enabled(false)
                .with_ipc_handler(move |request| {
                    if !is_page_url(&request.uri().to_string())
                        || !is_valid_page_message(request.body(), &ipc_nonce)
                    {
                        return;
                    }
                    if let Some(passed) = security_probe_passed(request.body()) {
                        let next_state = if passed {
                            ISOLATION_VERIFIED
                        } else {
                            ISOLATION_REJECTED
                        };
                        if ipc_isolation_state
                            .compare_exchange(
                                ISOLATION_PENDING,
                                next_state,
                                Ordering::AcqRel,
                                Ordering::Acquire,
                            )
                            .is_err()
                        {
                            return;
                        }
                    } else if ipc_isolation_state.load(Ordering::Acquire) != ISOLATION_VERIFIED {
                        return;
                    }
                    let _ = ipc_app.emit_to(
                        &ipc_label,
                        INSTALLED_PAGE_EVENT,
                        InstalledPageNativeMessage {
                            message_json: request.body().clone(),
                        },
                    );
                })
                .build_as_child(&parent)
                .map_err(|error| {
                    format!("Failed to create isolated installed page webview: {error}")
                })?;
            PAGE_WEBVIEWS.with(|webviews| {
                webviews.borrow_mut().insert(label, webview);
            });
            Ok(())
        })
        .await
    }

    pub(super) async fn resize(
        window: WebviewWindow,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        let label = window.label().to_string();
        validate_window_label(&label)?;
        run_on_main_thread(&window, move || {
            PAGE_WEBVIEWS.with(|webviews| {
                let webviews = webviews.borrow();
                let webview = webviews
                    .get(&label)
                    .ok_or_else(|| "Installed page webview is not mounted.".to_string())?;
                webview
                    .set_bounds(page_bounds(width, height))
                    .map_err(|error| format!("Failed to resize installed page webview: {error}"))
            })
        })
        .await
    }

    pub(super) async fn post_message(
        window: WebviewWindow,
        message_json: String,
    ) -> Result<(), String> {
        let label = window.label().to_string();
        validate_window_label(&label)?;
        if message_json.len() > MAX_PAGE_MESSAGE_BYTES {
            return Err("Installed page response exceeds the 1 MiB message limit.".into());
        }
        let message = serde_json::from_str::<Value>(&message_json)
            .map_err(|error| format!("Installed page response is not valid JSON: {error}"))?;
        let script = format!(
            "window.postMessage(JSON.parse({}), '*');",
            serde_json::to_string(&message_json)
                .map_err(|error| format!("Failed to encode installed page response: {error}"))?
        );
        if !message.is_object() {
            return Err("Installed page response must be a JSON object.".into());
        }
        run_on_main_thread(&window, move || {
            PAGE_WEBVIEWS.with(|webviews| {
                let webviews = webviews.borrow();
                let webview = webviews
                    .get(&label)
                    .ok_or_else(|| "Installed page webview is not mounted.".to_string())?;
                webview
                    .evaluate_script(&script)
                    .map_err(|error| format!("Failed to deliver installed page response: {error}"))
            })
        })
        .await
    }

    pub(super) async fn unmount(window: WebviewWindow) -> Result<(), String> {
        let label = window.label().to_string();
        validate_window_label(&label)?;
        run_on_main_thread(&window, move || {
            PAGE_WEBVIEWS.with(|webviews| {
                webviews.borrow_mut().remove(&label);
            });
            Ok(())
        })
        .await
    }
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn mount_installed_page_webview(
    window: WebviewWindow,
    html: String,
    nonce: String,
) -> Result<(), String> {
    platform::mount(window, html, nonce).await
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn resize_installed_page_webview(
    window: WebviewWindow,
    width: u32,
    height: u32,
) -> Result<(), String> {
    platform::resize(window, width, height).await
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn post_installed_page_webview_message(
    window: WebviewWindow,
    message_json: String,
) -> Result<(), String> {
    platform::post_message(window, message_json).await
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn unmount_installed_page_webview(window: WebviewWindow) -> Result<(), String> {
    platform::unmount(window).await
}

#[cfg(not(windows))]
#[tauri::command]
pub(crate) async fn mount_installed_page_webview(
    _window: WebviewWindow,
    _html: String,
    _nonce: String,
) -> Result<(), String> {
    Err("Isolated installed page webviews are currently supported only on Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub(crate) async fn resize_installed_page_webview(
    _window: WebviewWindow,
    _width: u32,
    _height: u32,
) -> Result<(), String> {
    Err("Isolated installed page webviews are currently supported only on Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub(crate) async fn post_installed_page_webview_message(
    _window: WebviewWindow,
    _message_json: String,
) -> Result<(), String> {
    Err("Isolated installed page webviews are currently supported only on Windows.".into())
}

#[cfg(not(windows))]
#[tauri::command]
pub(crate) async fn unmount_installed_page_webview(_window: WebviewWindow) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_messages_are_nonce_bound_and_shape_checked() {
        let nonce = "probe-123";
        assert!(is_valid_page_message(
            r#"{"channel":"flowcell-installed-page","type":"request","nonce":"probe-123","requestId":"1","actionId":"read","payload":{}}"#,
            nonce
        ));
        assert!(is_valid_page_message(
            r#"{"channel":"flowcell-installed-page","type":"security-probe","nonce":"probe-123","href":"https://flowcell-page.localhost/index.html","hasTauriInternals":false,"hasTauriInvoke":false,"hasTauriGlobal":false,"hasNodeProcess":false,"hasFlowcellPage":true,"hasRawWryIpc":true}"#,
            nonce
        ));
        assert!(!is_valid_page_message(
            r#"{"channel":"flowcell-installed-page","type":"request","nonce":"wrong","requestId":"1","actionId":"read","payload":{}}"#,
            nonce
        ));
        assert!(!is_valid_page_message(
            r#"{"channel":"flowcell-installed-page","type":"request","nonce":"probe-123","requestId":"1","actionId":"read","payload":{},"command":"raw"}"#,
            nonce
        ));
        assert_eq!(
            security_probe_passed(
                r#"{"channel":"flowcell-installed-page","type":"security-probe","nonce":"probe-123","href":"https://flowcell-page.localhost/index.html","hasTauriInternals":false,"hasTauriInvoke":false,"hasTauriGlobal":false,"hasNodeProcess":false,"hasFlowcellPage":true,"hasRawWryIpc":true}"#
            ),
            Some(true)
        );
        assert_eq!(
            security_probe_passed(
                r#"{"channel":"flowcell-installed-page","type":"security-probe","nonce":"probe-123","href":"https://flowcell-page.localhost/index.html","hasTauriInternals":true,"hasTauriInvoke":true,"hasTauriGlobal":false,"hasNodeProcess":false,"hasFlowcellPage":true,"hasRawWryIpc":true}"#
            ),
            Some(false)
        );
        assert_eq!(
            security_probe_passed(
                r#"{"channel":"flowcell-installed-page","type":"security-probe","nonce":"probe-123","href":"https://example.invalid/","hasTauriInternals":false,"hasTauriInvoke":false,"hasTauriGlobal":false,"hasNodeProcess":false,"hasFlowcellPage":true,"hasRawWryIpc":true}"#
            ),
            Some(false)
        );
        assert!(!is_valid_page_message(
            r#"{"channel":"flowcell-installed-page","type":"security-probe","nonce":"probe-123","hasTauriInternals":false,"hasTauriInvoke":false,"hasTauriGlobal":false,"hasNodeProcess":false}"#,
            nonce
        ));
    }
}
