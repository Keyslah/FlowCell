import type { PanelScriptFileRecord } from "./programRails";

export type ButtonLabelOverrides = Record<string, string>;

const BUTTON_LABEL_OVERRIDES_KEY = "flowcell.button-label-overrides.v1";
const LEGACY_STORAGE_PREFIX = ["flow", "test", "-bare", "clone"].join("");
const LEGACY_BUTTON_LABEL_OVERRIDES_KEY =
  `${LEGACY_STORAGE_PREFIX}.button-label-overrides.v1`;
const LEGACY_STATIC_LABEL_MIGRATIONS: Record<string, string> = {
  "Save\nLayout": "Save Layout",
  "Load\nLayout": "Load Layout"
};

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

export function normalizeButtonLabelInput(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n").trim();
}

function encodeScopedButtonIdPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function buildPanelScriptButtonId(
  programName: string,
  panelName: string,
  fileName: string
): string {
  return [
    "panel-script",
    encodeScopedButtonIdPart(programName),
    encodeScopedButtonIdPart(panelName),
    encodeScopedButtonIdPart(fileName)
  ].join("::");
}

function migrateLegacyStaticLabel(value: string): string {
  return LEGACY_STATIC_LABEL_MIGRATIONS[value] ?? value;
}

export function resolveButtonLabelOverride(
  buttonId: string,
  fallbackLabel: string,
  overrides: ButtonLabelOverrides
): string {
  const overrideLabel = overrides[buttonId];
  return overrideLabel && overrideLabel !== fallbackLabel ? overrideLabel : fallbackLabel;
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

export function readButtonLabelOverrides(): ButtonLabelOverrides {
  try {
    const parsed = safeParseJson<Record<string, unknown>>(
      readMigratedStorageValue(
        BUTTON_LABEL_OVERRIDES_KEY,
        LEGACY_BUTTON_LABEL_OVERRIDES_KEY
      )
    );
    if (!parsed) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([buttonId, label]) => {
        if (typeof label !== "string") {
          return [];
        }

        const normalizedLabel = migrateLegacyStaticLabel(normalizeButtonLabelInput(label));
        if (!normalizedLabel) {
          return [];
        }

        return [[buttonId, normalizedLabel]];
      })
    );
  } catch {
    return {};
  }
}

export function writeButtonLabelOverrides(overrides: ButtonLabelOverrides): void {
  try {
    window.localStorage.setItem(BUTTON_LABEL_OVERRIDES_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore persistence failures in restricted window contexts.
  }
}

export function applyButtonLabelOverridesToPanelScriptRecords(
  records: readonly PanelScriptFileRecord[],
  overrides: ButtonLabelOverrides,
  programName: string | null | undefined,
  panelName: string | null | undefined
): PanelScriptFileRecord[] {
  if (!programName || !panelName || records.length === 0) {
    return records as PanelScriptFileRecord[];
  }

  let changed = false;
  const nextRecords = records.map((record) => {
    const nextLabel = resolveButtonLabelOverride(
      buildPanelScriptButtonId(programName, panelName, record.fileName),
      record.label,
      overrides
    );
    if (nextLabel === record.label) {
      return record;
    }

    changed = true;
    const trimmedTooltip = record.tooltip?.trim() ?? "";
    return {
      ...record,
      label: nextLabel,
      tooltip:
        trimmedTooltip.length === 0 || trimmedTooltip === record.label
          ? nextLabel
          : record.tooltip
    };
  });

  return changed ? nextRecords : (records as PanelScriptFileRecord[]);
}
