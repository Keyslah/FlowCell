import type { PanelScriptFileRecord } from "./programRails";

const PANEL_BUTTON_ORDER_STORAGE_KEY_PREFIX =
  "flowcell.panel-button-order.v1";
const LEGACY_STORAGE_PREFIX = ["flow", "test", "-bare", "clone"].join("");
const LEGACY_PANEL_BUTTON_ORDER_STORAGE_KEY_PREFIX =
  `${LEGACY_STORAGE_PREFIX}.panel-button-order.v1`;

export const PANEL_BUTTON_ORDER_CHANGED_EVENT =
  "flowcell://panel-button-order-changed";

export interface PanelButtonOrderChangedPayload {
  programName: string;
  panelName: string;
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function encodeScopedPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function normalizeOrderedFileNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

export function getPanelButtonOrderStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    PANEL_BUTTON_ORDER_STORAGE_KEY_PREFIX,
    encodeScopedPart(programName),
    encodeScopedPart(panelName)
  ].join("::");
}

function getLegacyPanelButtonOrderStorageKey(
  programName: string,
  panelName: string
): string {
  return [
    LEGACY_PANEL_BUTTON_ORDER_STORAGE_KEY_PREFIX,
    encodeScopedPart(programName),
    encodeScopedPart(panelName)
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

export function readPanelButtonOrder(
  programName: string,
  panelName: string
): string[] {
  try {
    const storageKey = getPanelButtonOrderStorageKey(programName, panelName);
    return normalizeOrderedFileNames(
      safeParseJson<unknown>(
        readMigratedStorageValue(
          storageKey,
          getLegacyPanelButtonOrderStorageKey(programName, panelName)
        )
      )
    );
  } catch {
    return [];
  }
}

export function writePanelButtonOrder(
  programName: string,
  panelName: string,
  orderedFileNames: readonly string[]
): void {
  const normalized = normalizeOrderedFileNames([...orderedFileNames]);
  const storageKey = getPanelButtonOrderStorageKey(programName, panelName);
  const legacyStorageKey = getLegacyPanelButtonOrderStorageKey(programName, panelName);

  try {
    if (normalized.length === 0) {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(legacyStorageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    window.localStorage.removeItem(legacyStorageKey);
  } catch {
    // Ignore persistence failures in restricted window contexts.
  }
}

export function applyPanelButtonOrder(
  records: readonly PanelScriptFileRecord[],
  orderedFileNames: readonly string[]
): PanelScriptFileRecord[] {
  if (records.length === 0 || orderedFileNames.length === 0) {
    return records as PanelScriptFileRecord[];
  }

  const recordsByKey = new Map(
    records.map((record) => [record.fileName.toLowerCase(), record] as const)
  );
  const seen = new Set<string>();
  const orderedRecords: PanelScriptFileRecord[] = [];

  for (const fileName of normalizeOrderedFileNames([...orderedFileNames])) {
    const key = fileName.toLowerCase();
    const record = recordsByKey.get(key);
    if (!record || seen.has(key)) {
      continue;
    }

    seen.add(key);
    orderedRecords.push(record);
  }

  if (orderedRecords.length === 0) {
    return records as PanelScriptFileRecord[];
  }

  for (const record of records) {
    const key = record.fileName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    orderedRecords.push(record);
  }

  const changed =
    orderedRecords.length !== records.length ||
    orderedRecords.some((record, index) => record !== records[index]);

  return changed ? orderedRecords : (records as PanelScriptFileRecord[]);
}

export function reorderPanelButtonFileNames(
  currentFileNames: readonly string[],
  sourceFileName: string,
  targetFileName: string,
  placement: "before" | "after"
): string[] {
  const normalizedCurrent = normalizeOrderedFileNames([...currentFileNames]);
  const sourceKey = sourceFileName.trim().toLowerCase();
  const targetKey = targetFileName.trim().toLowerCase();
  if (!sourceKey || !targetKey || sourceKey === targetKey) {
    return normalizedCurrent;
  }

  const sourceIndex = normalizedCurrent.findIndex(
    (fileName) => fileName.toLowerCase() === sourceKey
  );
  if (sourceIndex < 0) {
    return normalizedCurrent;
  }

  const sourceEntry = normalizedCurrent[sourceIndex];
  const remaining = normalizedCurrent.filter((_, index) => index !== sourceIndex);
  const targetIndex = remaining.findIndex(
    (fileName) => fileName.toLowerCase() === targetKey
  );
  if (targetIndex < 0) {
    return normalizedCurrent;
  }

  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  const nextOrder = [...remaining];
  nextOrder.splice(insertIndex, 0, sourceEntry);
  return nextOrder;
}
