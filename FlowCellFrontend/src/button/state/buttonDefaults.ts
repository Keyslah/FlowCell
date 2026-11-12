import {
  BUTTON_STATE_SCHEMA_VERSION,
  type ButtonDocumentSettings,
  type ButtonStateDocument
} from "../types.js";
import {
  DEFAULT_BUTTON_SKIN,
  DEFAULT_BUTTON_SKIN_ID
} from "../skins/defaultButtonSkin.js";
import {
  CHIPPED_CONCRETE_BUTTON_SKIN,
  CHIPPED_CONCRETE_BUTTON_SKIN_ID
} from "../skins/chippedConcreteButtonSkin.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../skins/buttonSkinFormat.js";

export const DEFAULT_BUTTON_SURFACE_ID = "surface-button-editor-main";

export const DEFAULT_BUTTON_DOCUMENT_SETTINGS: ButtonDocumentSettings = {
  gridSize: 8,
  snapTolerance: 8,
  buttonSpacingMm: 0,
  defaultGap: 0,
  defaultSurfacePadding: 8,
  defaultSkinId: CHIPPED_CONCRETE_BUTTON_SKIN_ID,
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
      [DEFAULT_BUTTON_SKIN_ID]: cloneButtonDocument(DEFAULT_BUTTON_SKIN),
      [CHIPPED_CONCRETE_BUTTON_SKIN_ID]: cloneButtonDocument(CHIPPED_CONCRETE_BUTTON_SKIN)
    },
    themeOverrides: {},
    popoutUnits: {},
    fanSetups: {},
    settings: cloneButtonDocument(DEFAULT_BUTTON_DOCUMENT_SETTINGS)
  };
}

/** Replace the shipped gray default while retaining assigned custom skins and geometry. */
export function ensureChippedConcreteDefaults(document: ButtonStateDocument): boolean {
  const previous = document.skins[DEFAULT_BUTTON_SKIN_ID];
  if (!previous || !BUTTON_SKIN_SECTION_ORDER.every((section) => previous[section] === DEFAULT_BUTTON_SKIN[section])) return false;
  let changed = false;
  const useChipped = () => {
    if (!document.skins[CHIPPED_CONCRETE_BUTTON_SKIN_ID]) {
      document.skins[CHIPPED_CONCRETE_BUTTON_SKIN_ID] = cloneButtonDocument(CHIPPED_CONCRETE_BUTTON_SKIN);
    }
    changed = true;
  };
  if (document.settings.defaultSkinId === DEFAULT_BUTTON_SKIN_ID) {
    useChipped();
    document.settings.defaultSkinId = CHIPPED_CONCRETE_BUTTON_SKIN_ID;
  }
  for (const button of Object.values(document.buttons)) {
    if (button.defaultSkinId !== DEFAULT_BUTTON_SKIN_ID) continue;
    useChipped();
    button.defaultSkinId = CHIPPED_CONCRETE_BUTTON_SKIN_ID;
  }
  for (const placement of Object.values(document.placements)) {
    if (placement.skinOverrideId !== DEFAULT_BUTTON_SKIN_ID) continue;
    useChipped();
    placement.skinOverrideId = CHIPPED_CONCRETE_BUTTON_SKIN_ID;
  }
  return changed;
}

export function createStableButtonId(prefix: string): string {
  const normalizedPrefix = prefix.trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "id";
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${normalizedPrefix}-${uuid}`;
  }
  return `${normalizedPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
