// Appearance Hub live bridge.
//
// Hub-authored skins are stored per address (program → panel → button →
// placement) in their own localStorage key and compiled at runtime into
// ImportedSkin objects that the existing HostSkinButton imported-skin pipeline
// renders — no new render machinery on the live side. Live surfaces call
// resolveHubLiveSkin(...) (or the useHubSkinRevision hook to re-render on
// changes); the hub window writes assignments and broadcasts.
//
// Nothing here touches FlowCellState, StyleGroups, or the persisted
// ImportedSkins array. Removing the appearance-hub folder plus the few
// resolve hooks restores stock behavior; stored assignments become inert.

import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { ImportedSkin } from "../../types";
import {
  createEmptySlots,
  partitionStateDeclarations,
  sanitizeStructureMarkup,
  validateKeyframesSlot,
  validateStateSlot,
  validateStructure,
  type SlotContentMap
} from "./compileSkin";
import {
  KEYFRAMES_SLOT_ID,
  STATE_SLOT_IDS,
  STRUCTURE_SLOT_ID,
  type StateSlotId
} from "./slotSpec";

export const HUB_ASSIGNMENTS_STORAGE_KEY = "flowcell.appearanceHub.assignments.v1";
export const HUB_SKINS_CHANGED_EVENT = "flowcell:appearance-hub-skins-changed";
export const HUB_PANEL_BUTTON_KEY = "__panel__";

export type HubPlacement = "main" | "popped-single" | "popped-group" | "fan";

export const HUB_PLACEMENTS: ReadonlyArray<{ id: HubPlacement; label: string }> = [
  { id: "main", label: "Main page" },
  { id: "popped-single", label: "Single popped" },
  { id: "popped-group", label: "Group popped" },
  { id: "fan", label: "Fan" }
];

export type HubTextStyle = {
  fontFamily: string | null;
  fontSizePx: number | null;
  lines: 1 | 2;
  labelOverride: string | null;
};

export const DEFAULT_HUB_TEXT_STYLE: HubTextStyle = {
  fontFamily: null,
  fontSizePx: null,
  lines: 1,
  labelOverride: null
};

export type HubAssignment = {
  slots: SlotContentMap;
  text: HubTextStyle;
  updatedAt: string;
};

export type HubAssignmentMap = Record<string, HubAssignment>;

function normalizeAddressPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

// Same normalization family as buildPanelScriptButtonId (trim + lowercase +
// encodeURIComponent) so live surfaces and the hub agree on identity.
export function buildHubAddressKey(
  programName: string,
  panelName: string,
  buttonKey: string,
  placement: HubPlacement
): string {
  return [
    normalizeAddressPart(programName),
    normalizeAddressPart(panelName),
    normalizeAddressPart(buttonKey),
    placement
  ].join("::");
}

export function normalizeHubTextStyle(candidate: Partial<HubTextStyle> | undefined): HubTextStyle {
  if (!candidate || typeof candidate !== "object") {
    return { ...DEFAULT_HUB_TEXT_STYLE };
  }
  return {
    fontFamily:
      typeof candidate.fontFamily === "string" && candidate.fontFamily.trim()
        ? candidate.fontFamily.trim()
        : null,
    fontSizePx:
      typeof candidate.fontSizePx === "number" &&
      Number.isFinite(candidate.fontSizePx) &&
      candidate.fontSizePx > 0
        ? candidate.fontSizePx
        : null,
    lines: candidate.lines === 2 ? 2 : 1,
    labelOverride: typeof candidate.labelOverride === "string" ? candidate.labelOverride : null
  };
}

function normalizeAssignment(candidate: unknown): HubAssignment | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const record = candidate as Partial<HubAssignment>;
  const slots = createEmptySlots();
  if (record.slots && typeof record.slots === "object") {
    slots[STRUCTURE_SLOT_ID] =
      typeof record.slots[STRUCTURE_SLOT_ID] === "string" ? record.slots[STRUCTURE_SLOT_ID] : "";
    slots[KEYFRAMES_SLOT_ID] =
      typeof record.slots[KEYFRAMES_SLOT_ID] === "string" ? record.slots[KEYFRAMES_SLOT_ID] : "";
    for (const slotId of STATE_SLOT_IDS) {
      slots[slotId] = typeof record.slots[slotId] === "string" ? record.slots[slotId] : "";
    }
  }
  if (!slots[STRUCTURE_SLOT_ID].trim()) {
    return null;
  }
  return {
    slots,
    text: normalizeHubTextStyle(record.text),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString()
  };
}

export function readHubAssignments(): HubAssignmentMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(HUB_ASSIGNMENTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const assignments: HubAssignmentMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const assignment = normalizeAssignment(value);
      if (assignment) {
        assignments[key] = assignment;
      }
    }
    return assignments;
  } catch {
    return {};
  }
}

export function writeHubAssignments(assignments: HubAssignmentMap): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(HUB_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // Storage unavailable — assignments stay in memory for this session.
  }
  invalidateResolveCache();
  void emit(HUB_SKINS_CHANGED_EVENT).catch(() => {});
}

// ---- change subscription -------------------------------------------------

type HubChangeListener = () => void;

const changeListeners = new Set<HubChangeListener>();
let subscriptionsInstalled = false;

function notifyChangeListeners() {
  invalidateResolveCache();
  for (const listener of Array.from(changeListeners)) {
    try {
      listener();
    } catch {
      // Listener errors must not break sibling subscribers.
    }
  }
}

function installGlobalSubscriptions() {
  if (subscriptionsInstalled || typeof window === "undefined") {
    return;
  }
  subscriptionsInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === HUB_ASSIGNMENTS_STORAGE_KEY) {
      notifyChangeListeners();
    }
  });
  void listen(HUB_SKINS_CHANGED_EVENT, () => {
    notifyChangeListeners();
  }).catch(() => {});
}

export function subscribeHubSkins(listener: HubChangeListener): () => void {
  installGlobalSubscriptions();
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

// Re-renders the caller whenever hub assignments change in any window.
export function useHubSkinRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeHubSkins(() => setRevision((value) => value + 1)), []);
  return revision;
}

// ---- live compile ---------------------------------------------------------

// Live selector conventions: `.button-skin` + state classes are rewritten by
// the existing imported-skin pipeline (mapButtonSkinSelectorToHost) into
// :host([data-*]) selectors against the HostSkinButton contract.
const LIVE_STATE_SELECTOR: Record<StateSlotId, string> = {
  base: ".button-skin",
  hover: ".button-skin.is-hovered",
  play: ".button-skin.is-playing",
  pressed: ".button-skin.is-pressed",
  held: ".button-skin.is-held",
  release: ".button-skin.is-release",
  disabled: ".button-skin.is-disabled",
  error: ".button-skin.is-error"
};

function markCoreElement(markup: string): string {
  // Exactly one data-core is enforced at authoring time; mark it as the
  // pipeline's interactive + measure element.
  return markup.replace(
    /\bdata-core\b/,
    'data-core data-flow-interactive="true" data-flow-measure="true"'
  );
}

function wrapLabelPlaceholder(markup: string): string {
  if (markup.includes("data-flow-label-node")) {
    return markup;
  }
  return markup.replace(
    /\{\{label\}\}/g,
    '<span data-flow-label-node="true">{{label}}</span>'
  );
}

function buildLiveTextCss(text: HubTextStyle): string[] {
  const rules: string[] = [];
  const labelDeclarations: string[] = [];
  if (text.fontFamily) {
    labelDeclarations.push(`font-family: ${JSON.stringify(text.fontFamily)}`);
  }
  if (typeof text.fontSizePx === "number") {
    labelDeclarations.push(`font-size: ${text.fontSizePx}px`);
  }
  if (labelDeclarations.length > 0) {
    rules.push(
      `.button-skin [data-flow-interactive], .button-skin [data-flow-label-node] { ${labelDeclarations.join("; ")}; }`
    );
  }
  if (text.lines === 2) {
    rules.push(
      `.button-skin [data-flow-label-node] { white-space: normal; text-wrap: balance; display: inline-block; }`
    );
  } else {
    rules.push(`.button-skin [data-flow-label-node] { white-space: nowrap; }`);
  }
  return rules;
}

export function compileHubAssignmentToImportedSkin(
  addressKey: string,
  assignment: HubAssignment
): ImportedSkin | null {
  const structure = assignment.slots[STRUCTURE_SLOT_ID];
  if (validateStructure(structure).length > 0) {
    return null;
  }

  const html = wrapLabelPlaceholder(markCoreElement(sanitizeStructureMarkup(structure)));

  const cssParts: string[] = [];
  const keyframes = assignment.slots[KEYFRAMES_SLOT_ID].trim();
  if (keyframes && validateKeyframesSlot(keyframes).length === 0) {
    cssParts.push(keyframes);
  }
  for (const slotId of STATE_SLOT_IDS) {
    const content = assignment.slots[slotId].trim();
    if (!content || validateStateSlot(content).length > 0) {
      continue;
    }
    const selector = LIVE_STATE_SELECTOR[slotId];
    const { varDeclarations, coreDeclarations, animations } = partitionStateDeclarations(content);
    if (varDeclarations.length > 0) {
      cssParts.push(`${selector} { ${varDeclarations.join("; ")}; }`);
    }
    if (coreDeclarations.length > 0) {
      cssParts.push(`${selector} [data-flow-interactive] { ${coreDeclarations.join("; ")}; }`);
    }
    for (const animation of animations) {
      cssParts.push(
        `${selector} [data-anim="${animation.token}"] { animation: ${animation.value}; }`
      );
    }
  }
  cssParts.push(...buildLiveTextCss(assignment.text));

  return {
    id: `hub::${addressKey}`,
    name: `Appearance hub skin (${addressKey})`,
    html,
    css: cssParts.join("\n"),
    sizingMode: "intrinsic",
    allowOverflow: true,
    hubPlayLatch: true
  };
}

// ---- resolve --------------------------------------------------------------

let resolveCache: Map<string, ImportedSkin | null> | null = null;
let cachedAssignments: HubAssignmentMap | null = null;

function invalidateResolveCache() {
  resolveCache = null;
  cachedAssignments = null;
}

export function resolveHubLiveSkin(
  programName: string,
  panelName: string,
  buttonKey: string,
  placement: HubPlacement
): ImportedSkin | undefined {
  installGlobalSubscriptions();
  if (!cachedAssignments) {
    cachedAssignments = readHubAssignments();
    resolveCache = new Map();
  }
  const addressKey = buildHubAddressKey(programName, panelName, buttonKey, placement);
  const cached = resolveCache?.get(addressKey);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  const assignment = cachedAssignments[addressKey];
  const compiled = assignment
    ? compileHubAssignmentToImportedSkin(addressKey, assignment)
    : null;
  resolveCache?.set(addressKey, compiled);
  return compiled ?? undefined;
}

// Resolve the label to render for an assignment (hub label override wins).
export function resolveHubLabelOverride(
  programName: string,
  panelName: string,
  buttonKey: string,
  placement: HubPlacement
): string | undefined {
  if (!cachedAssignments) {
    cachedAssignments = readHubAssignments();
    resolveCache = new Map();
  }
  const assignment =
    cachedAssignments[buildHubAddressKey(programName, panelName, buttonKey, placement)];
  return assignment?.text.labelOverride ?? undefined;
}
