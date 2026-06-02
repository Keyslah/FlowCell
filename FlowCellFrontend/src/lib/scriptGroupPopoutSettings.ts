export type ScriptGroupPopoutType = "4row" | "single";

export const DEFAULT_SCRIPT_GROUP_POPOUT_TYPE: ScriptGroupPopoutType = "4row";

export const SCRIPT_GROUP_POPOUT_TYPE_OPTIONS: ReadonlyArray<{
  value: ScriptGroupPopoutType;
  label: string;
}> = [{ value: "4row", label: "4row" }];

const SCRIPT_GROUP_POPOUT_TYPE_STORAGE_PREFIX =
  "flowcell.script-group-popout-type.v1";
const LEGACY_STORAGE_PREFIX = ["flow", "test", "-bare", "clone"].join("");
const LEGACY_SCRIPT_GROUP_POPOUT_TYPE_STORAGE_PREFIX =
  `${LEGACY_STORAGE_PREFIX}.script-group-popout-type.v1`;

function encodeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function normalizeScriptGroupPopoutType(value: unknown): ScriptGroupPopoutType {
  return value === "4row" || value === "single" ? value : DEFAULT_SCRIPT_GROUP_POPOUT_TYPE;
}

export function getScriptGroupPopoutTypeStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    SCRIPT_GROUP_POPOUT_TYPE_STORAGE_PREFIX,
    encodeStorageSegment(programName),
    encodeStorageSegment(panelName)
  ].join("::");
}

function getLegacyScriptGroupPopoutTypeStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    LEGACY_SCRIPT_GROUP_POPOUT_TYPE_STORAGE_PREFIX,
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

export function readScriptGroupPopoutType(
  programName: string,
  panelName: string
): ScriptGroupPopoutType {
  if (typeof window === "undefined") {
    return DEFAULT_SCRIPT_GROUP_POPOUT_TYPE;
  }

  const storageKey = getScriptGroupPopoutTypeStorageKey(programName, panelName);
  return normalizeScriptGroupPopoutType(
    readMigratedStorageValue(
      storageKey,
      getLegacyScriptGroupPopoutTypeStorageKey(programName, panelName)
    )
  );
}

export function writeScriptGroupPopoutType(
  programName: string,
  panelName: string,
  popoutType: ScriptGroupPopoutType
): void {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getScriptGroupPopoutTypeStorageKey(programName, panelName);
  const legacyStorageKey = getLegacyScriptGroupPopoutTypeStorageKey(programName, panelName);
  window.localStorage.setItem(
    storageKey,
    normalizeScriptGroupPopoutType(popoutType)
  );
  window.localStorage.removeItem(legacyStorageKey);
}
