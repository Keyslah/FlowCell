pub(crate) mod bind_actions;
pub(crate) mod delete;
pub(crate) mod execute;
pub(crate) mod install;
pub(crate) mod installed_page;
pub(crate) mod installed_page_webview;
pub(crate) mod manifest;
pub(crate) mod migrate;
pub(crate) mod pending_install;
pub(crate) mod records;
pub(crate) mod rename;
pub(crate) mod synchronize;
pub(crate) mod transaction;

pub(crate) use delete::{
    quarantine_owned_source, recover_standalone_source_transactions_locked,
    rollback_quarantined_transaction, source_quarantine_guard,
};
pub(crate) use migrate::finalize_migration_token_locked;
pub(crate) use records::validate_owner_button_id;

pub(crate) async fn run_source_blocking<T: Send + 'static>(
    action: &'static str,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    // Installing a Program owns the source lock across host-adapter calls.
    // IPC callers must wait for that lane outside the WebView event thread.
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("Program source {action} worker failed: {error}"))?
}
