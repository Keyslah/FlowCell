import { DEFAULT_PANEL_FAN_OPTIONS, type PanelFanOptions } from "../types";

const PANEL_FAN_OPTIONS_STORAGE_PREFIX = "flowcell.panel-fan-options.v1";
const LEGACY_STORAGE_PREFIX = ["flow", "test", "-bare", "clone"].join("");
const LEGACY_PANEL_FAN_OPTIONS_STORAGE_PREFIX =
  `${LEGACY_STORAGE_PREFIX}.panel-fan-options.v1`;

function encodeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function normalizePanelFanLayout(value: unknown): PanelFanOptions["layout"] {
  return value === "radial" || value === "half-radial" ? value : "grid";
}

function normalizePanelFanPlacement(value: unknown): PanelFanOptions["placement"] {
  switch (value) {
    case "top":
    case "bottom":
    case "center":
    case "top-left":
    case "top-right":
    case "bottom-left":
    case "bottom-right":
      return value;
    default:
      return DEFAULT_PANEL_FAN_OPTIONS.placement;
  }
}

export function getPanelFanOptionsStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    PANEL_FAN_OPTIONS_STORAGE_PREFIX,
    encodeStorageSegment(programName),
    encodeStorageSegment(panelName)
  ].join("::");
}

function getLegacyPanelFanOptionsStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    LEGACY_PANEL_FAN_OPTIONS_STORAGE_PREFIX,
    encodeStorageSegment(programName),
    encodeStorageSegment(panelName)
  ].join("::");
}

function readMigratedStorageValue(storageKey: string, legacyStorageKey: string): string | null {
  const currentValue = window.localStorage.getItem(storageKey);
  if (currentValue) {
    return currentValue;
  }

  const legacyValue = window.localStorage.getItem(legacyStorageKey);
  if (legacyValue) {
    window.localStorage.setItem(storageKey, legacyValue);
    window.localStorage.removeItem(legacyStorageKey);
  }
  return legacyValue;
}

export function readPanelFanOptions(
  programName: string,
  panelName: string
): PanelFanOptions {
  if (typeof window === "undefined") {
    return { ...DEFAULT_PANEL_FAN_OPTIONS };
  }

  const storageKey = getPanelFanOptionsStorageKey(programName, panelName);
  const rawValue = readMigratedStorageValue(
    storageKey,
    getLegacyPanelFanOptionsStorageKey(programName, panelName)
  );
  if (!rawValue) {
    return { ...DEFAULT_PANEL_FAN_OPTIONS };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PanelFanOptions>;
    return {
      layout: normalizePanelFanLayout(parsed.layout),
      placement: normalizePanelFanPlacement(parsed.placement)
    };
  } catch {
    return { ...DEFAULT_PANEL_FAN_OPTIONS };
  }
}

export function writePanelFanOptions(
  programName: string,
  panelName: string,
  options: PanelFanOptions
): void {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getPanelFanOptionsStorageKey(programName, panelName);
  const legacyStorageKey = getLegacyPanelFanOptionsStorageKey(programName, panelName);
  const normalized = {
    layout: normalizePanelFanLayout(options.layout),
    placement: normalizePanelFanPlacement(options.placement)
  };
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
  window.localStorage.removeItem(legacyStorageKey);
}
