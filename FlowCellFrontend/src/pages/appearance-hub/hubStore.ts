// Appearance Hub persistence. Everything lives under one dedicated
// localStorage key — nothing here touches FlowCellState, ImportedSkins,
// style groups, or any other live FlowCell storage. Deleting the key (or the
// appearance-hub folder) leaves the rest of the app byte-for-byte unchanged.

import { createEmptySlots, type SlotContentMap } from "./compileSkin";
import { KEYFRAMES_SLOT_ID, STRUCTURE_SLOT_ID, STATE_SLOT_IDS, type StateSlotId } from "./slotSpec";

export const HUB_STORAGE_KEY = "flowcell.appearanceHub.v1";

export type HubTextSettings = {
  label: string;
  stacked: boolean;
  fontSizePx: number | null;
};

export type HubSkin = {
  id: string;
  name: string;
  slots: SlotContentMap;
  text: HubTextSettings;
  updatedAt: string;
};

export type HubPreviewContext = "popout" | "fan";
export type HubStageBackground = "main" | "dark" | "light";

export type HubPrefs = {
  context: HubPreviewContext;
  background: HubStageBackground;
  rowCapPx: number;
  showHitbox: boolean;
  fanExpanded: boolean;
  pinnedStates: StateSlotId[];
};

export type HubState = {
  version: 1;
  skins: HubSkin[];
  selectedSkinId: string | null;
  prefs: HubPrefs;
};

const DEFAULT_TEXT_SETTINGS: HubTextSettings = {
  label: "Button",
  stacked: false,
  fontSizePx: null
};

const DEFAULT_PREFS: HubPrefs = {
  context: "popout",
  background: "dark",
  rowCapPx: 640,
  showHitbox: false,
  fanExpanded: true,
  pinnedStates: []
};

export function createSkinId(): string {
  return `skin-${Date.now().toString(36)}-${Math.floor(Math.random() * 46_656).toString(36)}`;
}

// Starter skin: doubles as a live example of the slot format. Decorative
// wrapper styles itself inline; state slots only move CSS variables.
export function createStarterSkin(): HubSkin {
  const slots = createEmptySlots();
  slots[STRUCTURE_SLOT_ID] = [
    '<div style="display:inline-block; padding: 8px;">',
    '  <div data-core style="display:inline-flex; align-items:center; justify-content:center;',
    "    padding: 10px 22px; border-radius: 999px; white-space: nowrap; text-align:center;",
    "    background: var(--fx-bg, rgba(44, 56, 82, 0.9));",
    "    border: 1px solid var(--fx-edge, rgba(126, 150, 210, 0.55));",
    "    color: var(--fx-ink, #e2e9ff);",
    "    font: 600 13px 'Segoe UI', system-ui, sans-serif; letter-spacing: 0.04em;",
    "    transform: scale(var(--fx-push, 1));",
    "    box-shadow: 0 4px 18px var(--fx-halo, rgba(0, 0, 0, 0.35));",
    '    transition: transform 120ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease;">',
    "    {{label}}",
    "  </div>",
    "</div>"
  ].join("\n");
  slots.base = [
    "--fx-bg: rgba(44, 56, 82, 0.9);",
    "--fx-edge: rgba(126, 150, 210, 0.55);",
    "--fx-ink: #e2e9ff;"
  ].join("\n");
  slots.hover = [
    "--fx-bg: rgba(56, 72, 108, 0.95);",
    "--fx-edge: rgba(150, 176, 240, 0.9);",
    "--fx-halo: rgba(90, 120, 220, 0.35);"
  ].join("\n");
  slots.pressed = ["--fx-push: 0.94;", "--fx-bg: rgba(36, 46, 70, 0.95);"].join("\n");
  slots.held = [
    "--fx-edge: rgba(255, 196, 110, 0.9);",
    "--fx-halo: rgba(255, 170, 60, 0.25);"
  ].join("\n");
  slots.release = "--fx-push: 1.03;";
  slots.disabled = [
    "--fx-bg: rgba(40, 44, 54, 0.6);",
    "--fx-ink: rgba(190, 198, 214, 0.45);",
    "--fx-edge: rgba(120, 128, 150, 0.3);"
  ].join("\n");
  slots.error = [
    "--fx-edge: rgba(240, 90, 90, 0.9);",
    "--fx-halo: rgba(240, 80, 80, 0.3);"
  ].join("\n");

  return {
    id: createSkinId(),
    name: "Starter pill",
    slots,
    text: { ...DEFAULT_TEXT_SETTINGS },
    updatedAt: new Date().toISOString()
  };
}

export function createDefaultHubState(): HubState {
  const starter = createStarterSkin();
  return {
    version: 1,
    skins: [starter],
    selectedSkinId: starter.id,
    prefs: { ...DEFAULT_PREFS, pinnedStates: [] }
  };
}

export function readHubState(): HubState {
  if (typeof window === "undefined") {
    return createDefaultHubState();
  }
  try {
    const raw = window.localStorage.getItem(HUB_STORAGE_KEY);
    if (!raw) {
      return createDefaultHubState();
    }
    const parsed = JSON.parse(raw) as Partial<HubState> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.skins)) {
      return createDefaultHubState();
    }
    const skins = parsed.skins
      .filter((skin): skin is HubSkin => Boolean(skin) && typeof skin === "object")
      .map(normalizeSkin);
    if (skins.length === 0) {
      return createDefaultHubState();
    }
    const selectedSkinId = skins.some((skin) => skin.id === parsed.selectedSkinId)
      ? (parsed.selectedSkinId as string)
      : skins[0].id;
    return {
      version: 1,
      skins,
      selectedSkinId,
      prefs: normalizePrefs(parsed.prefs)
    };
  } catch {
    return createDefaultHubState();
  }
}

export function writeHubState(state: HubState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(HUB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable — the hub keeps working in memory.
  }
}

function normalizeSkin(candidate: HubSkin): HubSkin {
  const slots = createEmptySlots();
  if (candidate.slots && typeof candidate.slots === "object") {
    slots[STRUCTURE_SLOT_ID] =
      typeof candidate.slots[STRUCTURE_SLOT_ID] === "string" ? candidate.slots[STRUCTURE_SLOT_ID] : "";
    slots[KEYFRAMES_SLOT_ID] =
      typeof candidate.slots[KEYFRAMES_SLOT_ID] === "string" ? candidate.slots[KEYFRAMES_SLOT_ID] : "";
    for (const slotId of STATE_SLOT_IDS) {
      slots[slotId] = typeof candidate.slots[slotId] === "string" ? candidate.slots[slotId] : "";
    }
  }
  const text = candidate.text && typeof candidate.text === "object" ? candidate.text : DEFAULT_TEXT_SETTINGS;
  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : createSkinId(),
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : "Unnamed skin",
    slots,
    text: {
      label: typeof text.label === "string" ? text.label : DEFAULT_TEXT_SETTINGS.label,
      stacked: text.stacked === true,
      fontSizePx:
        typeof text.fontSizePx === "number" && Number.isFinite(text.fontSizePx) && text.fontSizePx > 0
          ? text.fontSizePx
          : null
    },
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString()
  };
}

function normalizePrefs(candidate: Partial<HubPrefs> | undefined): HubPrefs {
  if (!candidate || typeof candidate !== "object") {
    return { ...DEFAULT_PREFS, pinnedStates: [] };
  }
  const pinnedStates = Array.isArray(candidate.pinnedStates)
    ? candidate.pinnedStates.filter(
        (state): state is StateSlotId =>
          typeof state === "string" && (STATE_SLOT_IDS as readonly string[]).includes(state) && state !== "base"
      )
    : [];
  return {
    context: candidate.context === "fan" ? "fan" : "popout",
    background:
      candidate.background === "main" || candidate.background === "light" ? candidate.background : "dark",
    rowCapPx:
      typeof candidate.rowCapPx === "number" && Number.isFinite(candidate.rowCapPx)
        ? Math.min(1400, Math.max(200, Math.round(candidate.rowCapPx)))
        : DEFAULT_PREFS.rowCapPx,
    showHitbox: candidate.showHitbox === true,
    fanExpanded: candidate.fanExpanded !== false,
    pinnedStates
  };
}
