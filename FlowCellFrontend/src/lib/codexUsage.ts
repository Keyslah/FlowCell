import { invoke } from "@tauri-apps/api/core";

export interface CodexUsageSnapshot {
  fiveHourRemainingPercent: number | null;
  weeklyRemainingPercent: number | null;
  sourceTimestamp?: string | null;
  sourcePath?: string | null;
}

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getCodexUsageSnapshot(): Promise<CodexUsageSnapshot> {
  if (!isTauriWindowHost()) {
    return {
      fiveHourRemainingPercent: null,
      weeklyRemainingPercent: null,
      sourceTimestamp: null,
      sourcePath: null
    };
  }

  return invoke<CodexUsageSnapshot>("get_codex_usage_snapshot");
}
