import { convertFileSrc } from "@tauri-apps/api/core";
import {
  defaultMainThemeAppearance,
  type MainThemeAppearance
} from "./themeModel.js";

export const ACTIVE_MAIN_THEME_STORAGE_KEY = "flowcell.active-main-theme.v1";
export const MAIN_THEME_CHANGED_EVENT = "flowcell:main-theme-changed";

function safeCssUrl(path: string): string {
  try {
    return `url("${convertFileSrc(path).replaceAll('"', '%22')}")`;
  } catch {
    return "none";
  }
}

export function readActiveMainThemeAppearance(): MainThemeAppearance {
  const fallback = defaultMainThemeAppearance();
  try {
    const raw = localStorage.getItem(ACTIVE_MAIN_THEME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MainThemeAppearance>;
    return {
      backgroundColor: typeof parsed.backgroundColor === "string"
        ? parsed.backgroundColor
        : fallback.backgroundColor,
      backgroundImageMode:
        parsed.backgroundImageMode === "none" ||
        parsed.backgroundImageMode === "custom" ||
        parsed.backgroundImageMode === "default"
          ? parsed.backgroundImageMode
          : fallback.backgroundImageMode,
      backgroundImagePath: typeof parsed.backgroundImagePath === "string"
        ? parsed.backgroundImagePath
        : null,
      rails: {
        ...fallback.rails,
        ...(parsed.rails ?? {})
      }
    };
  } catch {
    return fallback;
  }
}

export function applyMainThemeAppearance(
  appearance: MainThemeAppearance,
  root: HTMLElement = document.documentElement
): void {
  root.style.setProperty("--flowcell-main-background-color", appearance.backgroundColor);
  if (appearance.backgroundImageMode === "none") {
    root.style.setProperty("--flowcell-main-background-image", "none");
  } else if (appearance.backgroundImageMode === "custom" && appearance.backgroundImagePath?.trim()) {
    root.style.setProperty(
      "--flowcell-main-background-image",
      safeCssUrl(appearance.backgroundImagePath.trim())
    );
  } else {
    root.style.removeProperty("--flowcell-main-background-image");
  }

  Object.entries(appearance.rails).forEach(([railId, rail]) => {
    const cssId = railId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    root.style.setProperty(`--flowcell-main-rail-${cssId}-background`, rail.background);
    root.style.setProperty(`--flowcell-main-rail-${cssId}-border`, rail.border);
  });
}

export function writeActiveMainThemeAppearance(appearance: MainThemeAppearance): void {
  localStorage.setItem(ACTIVE_MAIN_THEME_STORAGE_KEY, JSON.stringify(appearance));
  applyMainThemeAppearance(appearance);
  window.dispatchEvent(new CustomEvent(MAIN_THEME_CHANGED_EVENT, {
    detail: structuredClone(appearance)
  }));
}

export function installThemeRuntime(): () => void {
  const applyStored = () => applyMainThemeAppearance(readActiveMainThemeAppearance());
  applyStored();

  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_MAIN_THEME_STORAGE_KEY) applyStored();
  };
  const handleThemeChanged = () => applyStored();
  window.addEventListener("storage", handleStorage);
  window.addEventListener(MAIN_THEME_CHANGED_EVENT, handleThemeChanged);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(MAIN_THEME_CHANGED_EVENT, handleThemeChanged);
  };
}
