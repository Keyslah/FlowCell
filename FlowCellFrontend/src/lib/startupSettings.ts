const STARTUP_SETTINGS_STORAGE_KEY = "flowcell.startup-settings.v1";
const LAST_LAYOUT_PATH_STORAGE_KEY = "flowcell.last-layout-path.v1";

export interface StartupSettings {
  loadLastLayoutOnStartup: boolean;
  minimizeMainOnStartup: boolean;
}

export const DEFAULT_STARTUP_SETTINGS: StartupSettings = {
  loadLastLayoutOnStartup: false,
  minimizeMainOnStartup: false
};

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readStartupSettings(): StartupSettings {
  if (!canUseStorage()) {
    return { ...DEFAULT_STARTUP_SETTINGS };
  }

  const rawValue = window.localStorage.getItem(STARTUP_SETTINGS_STORAGE_KEY);
  if (!rawValue) {
    return { ...DEFAULT_STARTUP_SETTINGS };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StartupSettings>;
    return {
      loadLastLayoutOnStartup: parsed.loadLastLayoutOnStartup === true,
      minimizeMainOnStartup: parsed.minimizeMainOnStartup === true
    };
  } catch {
    return { ...DEFAULT_STARTUP_SETTINGS };
  }
}

export function writeStartupSettings(settings: StartupSettings): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(
    STARTUP_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      loadLastLayoutOnStartup: settings.loadLastLayoutOnStartup === true,
      minimizeMainOnStartup: settings.minimizeMainOnStartup === true
    })
  );
}

export function readLastLayoutPath(): string | null {
  if (!canUseStorage()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(LAST_LAYOUT_PATH_STORAGE_KEY)?.trim();
  return rawValue ? rawValue : null;
}

export function writeLastLayoutPath(path: string | null | undefined): void {
  if (!canUseStorage()) {
    return;
  }

  const normalized = path?.trim();
  if (!normalized) {
    window.localStorage.removeItem(LAST_LAYOUT_PATH_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LAST_LAYOUT_PATH_STORAGE_KEY, normalized);
}
