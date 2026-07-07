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

// Popout placement rules. "natural" renders the skin at its own size (the
// default, current behavior); "cell" stretches the skin's core to fill the
// popout's uniform template cell so every button in the group is identical —
// the label then fits per-button via font shrinking and/or two-word stacking.
export type HubPopoutSizing = "natural" | "cell";
export type HubPopoutTextFit = "shrink" | "stack" | "shrink-stack";
export type HubPopoutRules = {
  sizing: HubPopoutSizing;
  textFit: HubPopoutTextFit;
};

export const DEFAULT_HUB_POPOUT_RULES: HubPopoutRules = {
  sizing: "natural",
  textFit: "shrink-stack"
};

export function normalizeHubPopoutRules(candidate: unknown): HubPopoutRules {
  if (!candidate || typeof candidate !== "object") {
    return { ...DEFAULT_HUB_POPOUT_RULES };
  }
  const record = candidate as Partial<HubPopoutRules>;
  return {
    sizing: record.sizing === "cell" ? "cell" : "natural",
    textFit:
      record.textFit === "shrink" || record.textFit === "stack"
        ? record.textFit
        : "shrink-stack"
  };
}

export type HubAssignment = {
  slots: SlotContentMap;
  text: HubTextStyle;
  // Uniform user scale (1 = the skin's natural size). The skin dictates its
  // shape and natural size; this multiplies it — nothing else touches size.
  scale: number;
  // Natural core size measured by the bench at scale 1 with the real label.
  // The live compile derives every footprint (fan slots, window bounds) from
  // natural × scale; when null the skin renders intrinsic and unplaced hosts
  // fall back to their stock behavior for layout.
  natural: { width: number; height: number } | null;
  // How the skin behaves inside popout placements (only consumed by
  // popped-single/popped-group addresses; inert elsewhere).
  popout: HubPopoutRules;
  updatedAt: string;
};

export function normalizeHubScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(8, Math.max(0.1, value));
}

function normalizeHubNatural(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { width?: unknown; height?: unknown };
  if (
    typeof record.width !== "number" ||
    typeof record.height !== "number" ||
    !Number.isFinite(record.width) ||
    !Number.isFinite(record.height) ||
    record.width <= 0 ||
    record.height <= 0
  ) {
    return null;
  }
  return { width: Math.round(record.width), height: Math.round(record.height) };
}

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

export function normalizeHubAssignment(candidate: unknown): HubAssignment | null {
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
    scale: normalizeHubScale(record.scale),
    natural: normalizeHubNatural(record.natural),
    popout: normalizeHubPopoutRules(record.popout),
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
      const assignment = normalizeHubAssignment(value);
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
  // Exactly one data-core is enforced at authoring time. The core is BOTH the
  // interactive element (its own shape — border-radius/clip-path/SVG — is the
  // hitbox) and the measured element. The imported source is otherwise left
  // literal; the host owns scaling via fit-uniform (never baked into markup).
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

// Cell mode: stretch the imported structure so the interactive core fills the
// host box (the popout's uniform template cell). Author inline display wins
// where set; width/height land either way because the paste contract forbids
// fixed core widths.
const POPOUT_CELL_FILL_CSS = [
  ".button-skin [data-flow-imported-html] > :first-child { width: 100%; height: 100%; box-sizing: border-box; }",
  ".button-skin [data-flow-interactive] { width: 100%; height: 100%; box-sizing: border-box; min-width: 0; min-height: 0; }"
].join("\n");

export function compileHubAssignmentToImportedSkin(
  addressKey: string,
  assignment: HubAssignment
): ImportedSkin | null {
  const structure = assignment.slots[STRUCTURE_SLOT_ID];
  if (validateStructure(structure).length > 0) {
    return null;
  }

  // The address key ends in the placement. Script-group popout windows use a
  // fixed SVG/template cell grid; letting a hub skin render at natural size
  // there can collide with adjacent cells and expose pasted demo-page backing.
  const placement = addressKey.split("::").pop() ?? "";
  const cellFit =
    placement === "popped-single" || placement === "popped-group";

  const scale = normalizeHubScale(assignment.scale);
  // Render the imported source LITERALLY. The host applies the uniform user
  // scale via fit-uniform (transform: scale on the skin's own first child),
  // measuring the untransformed core — never cram the skin into a fixed box.
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
  if (cellFit) {
    cssParts.push(POPOUT_CELL_FILL_CSS);
  }

  const footprint =
    assignment.natural !== null
      ? {
          width: Math.max(1, Math.round(assignment.natural.width * scale)),
          height: Math.max(1, Math.round(assignment.natural.height * scale))
        }
      : null;

  if (cellFit) {
    return {
      id: `hub::${addressKey}`,
      name: `Appearance hub skin (${addressKey})`,
      html,
      css: cssParts.join("\n"),
      // fill-stretch: the host box (the popout hands over the uniform template
      // cell as the footprint) is the size; the fill CSS above stretches the
      // core into it and the label fits itself per button.
      sizingMode: "fill-stretch",
      allowOverflow: true,
      hubPlayLatch: true,
      hubPopoutFit: "cell",
      // textFit: "shrink" scales the font down (min scale 0.58), "stack"
      // keeps the font and stacks two-word labels, "shrink-stack" does both.
      labelMinScale: assignment.popout.textFit === "stack" ? 1 : 0.58,
      ...(assignment.popout.textFit === "shrink" ? { labelStack: false } : {})
    };
  }

  return {
    id: `hub::${addressKey}`,
    name: `Appearance hub skin (${addressKey})`,
    html,
    css: cssParts.join("\n"),
    // fit-uniform: the host measures the literal core (natural) and scales it
    // to the natural × userScale footprint below — a clean uniform scale
    // (same aspect ratio, no distortion, no cramming).
    sizingMode: "fit-uniform",
    allowOverflow: true,
    hubPlayLatch: true,
    // The measured natural size × user scale IS the footprint every host
    // consumes — fan slots and collapsed window bounds read these fields
    // through the existing pipeline instead of falling back to pill baselines.
    ...(footprint
      ? {
          fanOwnerWidth: footprint.width,
          fanOwnerHeight: footprint.height,
          fanChildWidth: footprint.width,
          fanChildHeight: footprint.height,
          fixedWidth: footprint.width,
          fixedHeight: footprint.height
        }
      : {})
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
