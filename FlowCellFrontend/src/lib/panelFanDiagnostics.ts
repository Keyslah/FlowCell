import { invoke } from "@tauri-apps/api/core";

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sanitizeDebugFileName(value: string): string {
  const trimmed = value.trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, "-");
  return safe.endsWith(".json") ? safe : `${safe}.json`;
}

export async function writePanelFanDiagnostics(
  fileName: string,
  payload: unknown
): Promise<void> {
  if (!isTauriWindowHost()) {
    return;
  }

  try {
    await invoke("write_panel_fan_debug_dump", {
      fileName: sanitizeDebugFileName(fileName),
      contents: JSON.stringify(payload, null, 2)
    });
  } catch (error) {
    console.error("Failed to write panel fan diagnostics.", error);
  }
}
