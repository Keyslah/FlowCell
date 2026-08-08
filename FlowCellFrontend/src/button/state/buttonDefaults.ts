import {
  BUTTON_STATE_SCHEMA_VERSION,
  type ButtonDocumentSettings,
  type ButtonStateDocument
} from "../types.js";
import {
  DEFAULT_BUTTON_SKIN,
  DEFAULT_BUTTON_SKIN_ID
} from "../skins/defaultButtonSkin.js";

export const DEFAULT_BUTTON_SURFACE_ID = "surface-button-editor-main";

export const DEFAULT_BUTTON_DOCUMENT_SETTINGS: ButtonDocumentSettings = {
  gridSize: 8,
  snapTolerance: 8,
  buttonSpacingMm: 0,
  defaultGap: 0,
  defaultSurfacePadding: 8,
  defaultSkinId: DEFAULT_BUTTON_SKIN_ID,
  defaultMinimumFontSize: 8,
  allowSurfaceAutoExpansion: false
};

export function cloneButtonDocument<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createButtonStateDocument(): ButtonStateDocument {
  return {
    schemaVersion: BUTTON_STATE_SCHEMA_VERSION,
    revision: 0,
    buttons: {},
    placements: {},
    surfaces: {
      [DEFAULT_BUTTON_SURFACE_ID]: {
        id: DEFAULT_BUTTON_SURFACE_ID,
        name: "Button Workspace",
        kind: "main",
        width: 960,
        height: 640,
        placementIds: [],
        visualOverflowAllowance: 24,
        uniformButtonSize: null
      }
    },
    skins: {
      [DEFAULT_BUTTON_SKIN_ID]: cloneButtonDocument(DEFAULT_BUTTON_SKIN)
    },
    popoutUnits: {},
    fanSetups: {},
    settings: cloneButtonDocument(DEFAULT_BUTTON_DOCUMENT_SETTINGS)
  };
}

export function createStableButtonId(prefix: string): string {
  const normalizedPrefix = prefix.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "id";
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${normalizedPrefix}-${uuid}`;
  }
  return `${normalizedPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
