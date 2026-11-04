import tauriConfig from "../../src-tauri/tauri.conf.json";

// WebView2 requires windows sharing its profile to use the same browser arguments.
// Keep the native color popup workaround in one place, with the main window config.
export const webviewBrowserOptions = {
  additionalBrowserArgs: tauriConfig.app.windows[0].additionalBrowserArgs
};
