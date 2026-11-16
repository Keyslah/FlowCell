import type { ButtonPlacement, ButtonStateDocument, ToolSetButtonPopoutUnit } from "../types.js";
import { createStableButtonId } from "../state/buttonDefaults.js";
import { deriveRegularPopoutSelectionKey } from "../state/sourceIdentity.js";
import { findFirstAvailableButtonPosition, buttonSpacingPixelsFromMillimeters } from "../geometry/buttonGeometry.js";
import { DEFAULT_BUTTON_SKIN_ID, getDefaultButtonSize } from "../skins/defaultButtonSkin.js";
import { resolveButtonEditorIdentity } from "./buttonEditorSelection.js";

export function topLeftButtonPlacement(document: ButtonStateDocument, surfaceId: string): string | null {
  return (document.surfaces[surfaceId]?.placementIds ?? []).map(id => document.placements[id])
    .filter(Boolean).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))[0]?.id ?? null;
}

export function popoutAddCandidates(document: ButtonStateDocument, surfaceId: string, programName: string, panelName: string) {
  const unit = Object.values(document.popoutUnits).find(unit => unit.surfaceId === surfaceId);
  if (!unit) return [];
  const placed = new Set(document.surfaces[surfaceId].placementIds.map(id => document.placements[id]?.buttonId));
  return Object.values(document.buttons).filter(button => {
    if (placed.has(button.id) || button.metadata.themeContributionOnly === true) return false;
    if (unit.kind === "tool-set" && button.role === "tool-set-child") return button.toolSetParentId === unit.ownerButtonId;
    if (button.role !== "single-script" && button.role !== "tool-set-owner") return false;
    if (unit.kind === "tool-set" && button.id === unit.ownerButtonId) return false;
    const identity = resolveButtonEditorIdentity(document, button.id);
    return identity?.programName.toLowerCase() === programName.toLowerCase() &&
      identity?.panelName.toLowerCase() === panelName.toLowerCase() &&
      Object.values(document.placements).some(p => p.buttonId === button.id && document.surfaces[p.surfaceId]?.kind === "panel");
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function syncMembers(document: ButtonStateDocument, surfaceId: string) {
  const unit = Object.values(document.popoutUnits).find(unit => unit.surfaceId === surfaceId);
  const surface = document.surfaces[surfaceId];
  if (!unit || !surface) throw new Error("Select a Pop-out placement.");
  if (unit.ownerPlacementId && !surface.placementIds.includes(unit.ownerPlacementId)) {
    unit.ownerPlacementId = null;
    unit.interactionMode = "pop";
    if (unit.kind === "regular") unit.ownerButtonId = null;
  }
  if (unit.kind === "tool-set") {
    unit.childPlacementIds = surface.placementIds.filter(id => id !== unit.ownerPlacementId);
    unit.childButtonIds = unit.childPlacementIds.map(id => document.placements[id].buttonId);
  } else {
    unit.automaticLayout = false;
    unit.memberPlacementIds = surface.placementIds.filter(id => document.buttons[document.placements[id].buttonId]?.sourceIdentity);
    unit.memberSourceIdentities = unit.memberPlacementIds.map(id => document.buttons[document.placements[id].buttonId].sourceIdentity!);
    unit.selectionKey = deriveRegularPopoutSelectionKey(unit.memberSourceIdentities);
  }
  unit.canonicalBounds = { x: 0, y: 0, width: surface.width, height: surface.height };
  unit.desktopBounds = null;
  delete unit.desktopBoundsEnvelope;
}

export function removePopoutButtons(document: ButtonStateDocument, surfaceId: string, placementIds: readonly string[]) {
  const surface = document.surfaces[surfaceId];
  if (!surface || !Object.values(document.popoutUnits).some(unit => unit.surfaceId === surfaceId)) throw new Error("Select a Pop-out placement.");
  for (const id of placementIds) {
    if (document.placements[id]?.surfaceId !== surfaceId) continue;
    surface.placementIds = surface.placementIds.filter(value => value !== id);
    delete document.placements[id];
    if (document.themeOverrides) delete document.themeOverrides[id];
    if (document.programPopoutColorOverrides) delete document.programPopoutColorOverrides[id];
    if (document.programPopoutThemeLocks) delete document.programPopoutThemeLocks[id];
  }
  syncMembers(document, surfaceId);
}

export function addPopoutButtons(document: ButtonStateDocument, surfaceId: string, buttonIds: readonly string[]): string[] {
  const surface = document.surfaces[surfaceId];
  const unit = Object.values(document.popoutUnits).find(unit => unit.surfaceId === surfaceId);
  if (!surface || !unit) throw new Error("Select a Pop-out placement.");
  const added: string[] = [];
  for (const buttonId of new Set(buttonIds)) {
    const button = document.buttons[buttonId];
    if (!button) throw new Error("The selected Button is no longer installed.");
    if (surface.placementIds.some(id => document.placements[id].buttonId === buttonId)) continue;
    if (button.role === "panel-owner" || (button.role === "tool-set-child" &&
        (unit.kind !== "tool-set" || button.toolSetParentId !== unit.ownerButtonId))) throw new Error("This Button belongs to a different Tool Set.");
    const source = Object.values(document.placements).find(p => p.buttonId === buttonId);
    const size = surface.uniformButtonSize ?? (source ? { width: source.width, height: source.height } : getDefaultButtonSize(button.label));
    const padding = document.settings.defaultSurfacePadding;
    const gap = buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
    const otherRects = [...surface.placementIds.map(id => document.placements[id]), ...(unit.kind === "tool-set" ? unit.fields : [])];
    let rect = findFirstAvailableButtonPosition({ ...size, surface, otherRects, padding, gap, gridSize: document.settings.gridSize });
    if (!rect) {
      rect = { ...size, x: padding, y: Math.max(padding, ...otherRects.map(r => r.y + r.height + gap)) };
      surface.width = Math.max(surface.width, rect.x + rect.width + padding);
      surface.height = Math.max(surface.height, rect.y + rect.height + padding);
    }
    const id = createStableButtonId("placement");
    const placement: ButtonPlacement = {
      ...(source ? structuredClone(source) : {
        skinOverrideId: DEFAULT_BUTTON_SKIN_ID, textFitMode: button.defaultTextFitMode, textAlignment: "skin",
        textOffsetX: 0, textOffsetY: 0, minimumFontSize: document.settings.defaultMinimumFontSize,
        textSizeOverride: null, allowLabelResize: false, matchHitboxToSkin: true, allowStretching: false,
        highlightOnHover: false, activationCycle: null, visualStateMap: null, resizeAnchor: "top-left"
      }), id, buttonId, surfaceId, ...rect, zIndex: surface.placementIds.length
    };
    document.placements[id] = placement;
    surface.placementIds.push(id);
    added.push(id);
  }
  syncMembers(document, surfaceId);
  return added;
}

/** A separate surface shares actions/payloads, but never rewrites the package's original layout. */
export function forkToolsetPopout(document: ButtonStateDocument, surfaceId: string) {
  const original = Object.values(document.popoutUnits).find((unit): unit is ToolSetButtonPopoutUnit => unit.kind === "tool-set" && unit.surfaceId === surfaceId);
  if (!original) throw new Error("Select a Tool Set Pop-out.");
  const surface = structuredClone(document.surfaces[surfaceId]);
  surface.id = createStableButtonId("surface");
  surface.name += " copy";
  const ids = new Map<string, string>();
  surface.placementIds = surface.placementIds.map(id => {
    const newId = createStableButtonId("placement");
    ids.set(id, newId);
    document.placements[newId] = { ...structuredClone(document.placements[id]), id: newId, surfaceId: surface.id };
    for (const key of ["themeOverrides", "programPopoutColorOverrides", "programPopoutThemeLocks"] as const) {
      const records = document[key];
      if (records?.[id]) Object.assign(records, { [newId]: structuredClone(records[id]) });
    }
    return newId;
  });
  document.surfaces[surface.id] = surface;
  const unit: ToolSetButtonPopoutUnit = { ...structuredClone(original), id: createStableButtonId("popout"),
    templateUnitId: original.templateUnitId ?? original.id, surfaceId: surface.id, name: surface.name,
    childPlacementIds: original.childPlacementIds.map(id => ids.get(id)!), ownerPlacementId: original.ownerPlacementId ? ids.get(original.ownerPlacementId)! : null,
    desktopBounds: null };
  document.popoutUnits[unit.id] = unit;
  return { surfaceId: surface.id, placementIds: ids };
}

/** Merge newly installed records without saving unrelated editor changes. Also rebases Undo history. */
export function mergeAddedButtonRecords(target: ButtonStateDocument, before: ButtonStateDocument, after: ButtonStateDocument) {
  for (const key of ["buttons", "placements", "surfaces", "skins", "popoutUnits", "fanSetups"] as const) {
    for (const [id, record] of Object.entries(after[key])) {
      if (!before[key][id] && !target[key][id]) Object.assign(target[key], { [id]: structuredClone(record) });
    }
  }
  for (const placement of Object.values(after.placements)) {
    if (before.placements[placement.id]) continue;
    const surface = target.surfaces[placement.surfaceId];
    if (!surface) throw new Error("The destination panel was deleted while adding the Button.");
    if (!surface.placementIds.includes(placement.id)) surface.placementIds.push(placement.id);
    for (const key of ["themeOverrides", "programPopoutColorOverrides", "programPopoutThemeLocks"] as const) {
      if (after[key]?.[placement.id]) {
        target[key] ??= {};
        Object.assign(target[key]!, { [placement.id]: structuredClone(after[key]![placement.id]) });
      }
    }
  }
}

/** Materialize only the selected default/draft Pop-out, without committing other draft surfaces. */
export function hydrateEditorPopout(target: ButtonStateDocument, draft: ButtonStateDocument, surfaceId: string) {
  if (target.surfaces[surfaceId]) return;
  const surface = draft.surfaces[surfaceId];
  const unit = Object.values(draft.popoutUnits).find(unit => unit.surfaceId === surfaceId);
  if (!surface || !unit) throw new Error("The selected Pop-out is no longer available.");
  target.surfaces[surfaceId] = structuredClone(surface);
  target.popoutUnits[unit.id] = structuredClone(unit);
  for (const id of surface.placementIds) {
    const placement = draft.placements[id];
    if (!target.buttons[placement.buttonId]) throw new Error("A Button in this Pop-out was deleted while the editor was open.");
    target.placements[id] = structuredClone(placement);
    const skinId = placement.skinOverrideId ?? target.buttons[placement.buttonId].defaultSkinId;
    if (!target.skins[skinId] && draft.skins[skinId]) target.skins[skinId] = structuredClone(draft.skins[skinId]);
  }
}
