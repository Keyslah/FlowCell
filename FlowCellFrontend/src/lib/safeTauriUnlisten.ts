import type { UnlistenFn } from "@tauri-apps/api/event";

export function makeSafeTauriUnlisten(unlisten: UnlistenFn): UnlistenFn {
  let started = false;
  return () => {
    if (started) return;
    started = true;
    // Tauri types this callback as returning void, but its implementation is
    // async. Observe that hidden Promise and retry once when listener-table
    // installation races a fast WebView teardown.
    const attempt = () => Promise.resolve().then(() => unlisten());
    void attempt().catch(() => {
      globalThis.setTimeout(() => {
        void attempt().catch(() => {});
      }, 0);
    });
  };
}
