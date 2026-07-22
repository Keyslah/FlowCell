import type {
  ButtonSkin,
  ButtonStateDocument
} from "../types.js";
import { cloneButtonDocument } from "../state/buttonDefaults.js";

export interface ButtonSkinSaveScope {
  skinIds: readonly string[];
  placementIds?: readonly string[];
  buttonIds?: readonly string[];
}

export interface ButtonBehaviorSaveScope {
  buttonId: string;
  placementIds: readonly string[];
}

function copyNewRecords<T>(
  target: Record<string, T>,
  committed: Record<string, T>,
  draft: Record<string, T>
): void {
  for (const [id, record] of Object.entries(draft)) {
    if (!(id in committed)) target[id] = structuredClone(record);
  }
}

function copyMissingRecords<T>(target: Record<string, T>, saved: Record<string, T>): void {
  for (const [id, record] of Object.entries(saved)) {
    if (!(id in target)) target[id] = structuredClone(record);
  }
}

function requireDraftRecord<T>(records: Record<string, T>, id: string, label: string): T {
  const record = records[id];
  if (!record) throw new Error(`${label} '${id}' no longer exists in the Button draft.`);
  return record;
}

/**
 * Builds the canonical Button-state update behind Save placement. Existing
 * records contribute geometry/order plus placement-owned sizing and text-fit
 * policy; skin assignment/source and animation fields stay on the committed
 * baseline. Newly installed Button graphs are included because their placements
 * cannot exist canonically without their owning records.
 */
export function buildButtonPlacementScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  surfaceId: string,
  editorBaseline: ButtonStateDocument = committed
): ButtonStateDocument {
  const draftSurface = requireDraftRecord(draft.surfaces, surfaceId, "Button surface");
  const next = cloneButtonDocument(committed);
  const committedSurface = committed.surfaces[surfaceId];
  const baselineSurface = editorBaseline.surfaces[surfaceId];

  if (!committedSurface && baselineSurface) {
    throw new Error("The selected Button surface was deleted while the editor was open.");
  }

  copyNewRecords(next.buttons, editorBaseline.buttons, draft.buttons);
  copyNewRecords(next.placements, editorBaseline.placements, draft.placements);
  copyNewRecords(next.surfaces, editorBaseline.surfaces, draft.surfaces);
  copyNewRecords(next.popoutUnits, editorBaseline.popoutUnits, draft.popoutUnits);
  copyNewRecords(next.fanSetups, editorBaseline.fanSetups, draft.fanSetups);

  const placementIds = draftSurface.placementIds.filter((placementId) =>
    Boolean(committed.placements[placementId]) || !editorBaseline.placements[placementId]
  );

  next.surfaces[surfaceId] = committedSurface
    ? {
        ...structuredClone(committedSurface),
        width: draftSurface.width,
        height: draftSurface.height,
        placementIds,
        uniformButtonSize: draftSurface.uniformButtonSize
          ? { ...draftSurface.uniformButtonSize }
          : null
      }
    : structuredClone(draftSurface);

  for (const placementId of placementIds) {
    const draftPlacement = requireDraftRecord(draft.placements, placementId, "Button placement");
    const committedPlacement = committed.placements[placementId];
    next.placements[placementId] = committedPlacement
      ? {
          ...structuredClone(committedPlacement),
          surfaceId,
          x: draftPlacement.x,
          y: draftPlacement.y,
          width: draftPlacement.width,
          height: draftPlacement.height,
          zIndex: draftPlacement.zIndex,
          textFitMode: draftPlacement.textFitMode,
          textAlignment: draftPlacement.textAlignment,
          minimumFontSize: draftPlacement.minimumFontSize,
          textSizeOverride: draftPlacement.textSizeOverride,
          allowLabelResize: draftPlacement.allowLabelResize,
          matchHitboxToSkin: draftPlacement.matchHitboxToSkin,
          allowStretching: draftPlacement.allowStretching
        }
      : structuredClone(draftPlacement);
  }

  const requiredSkinIds = new Set<string>([next.settings.defaultSkinId]);
  Object.values(next.buttons).forEach((button) => requiredSkinIds.add(button.defaultSkinId));
  Object.values(next.placements).forEach((placement) => {
    if (placement.skinOverrideId) requiredSkinIds.add(placement.skinOverrideId);
  });
  for (const skinId of requiredSkinIds) {
    if (!next.skins[skinId] && draft.skins[skinId]) {
      next.skins[skinId] = structuredClone(draft.skins[skinId]);
    }
  }

  next.revision = committed.revision;
  return next;
}

export function applyButtonPlacementSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  surfaceId: string
): void {
  copyMissingRecords(target.buttons, saved.buttons);
  copyMissingRecords(target.placements, saved.placements);
  copyMissingRecords(target.surfaces, saved.surfaces);
  copyMissingRecords(target.skins, saved.skins);
  copyMissingRecords(target.popoutUnits, saved.popoutUnits);
  copyMissingRecords(target.fanSetups, saved.fanSetups);

  const savedSurface = saved.surfaces[surfaceId];
  if (!savedSurface) return;
  const targetSurface = target.surfaces[surfaceId];
  target.surfaces[surfaceId] = targetSurface
    ? {
        ...targetSurface,
        width: savedSurface.width,
        height: savedSurface.height,
        placementIds: [...savedSurface.placementIds],
        uniformButtonSize: savedSurface.uniformButtonSize
          ? { ...savedSurface.uniformButtonSize }
          : null
      }
    : structuredClone(savedSurface);

  for (const placementId of savedSurface.placementIds) {
    const savedPlacement = saved.placements[placementId];
    if (!savedPlacement) continue;
    const targetPlacement = target.placements[placementId];
    target.placements[placementId] = targetPlacement
      ? {
          ...targetPlacement,
          surfaceId,
          x: savedPlacement.x,
          y: savedPlacement.y,
          width: savedPlacement.width,
          height: savedPlacement.height,
          zIndex: savedPlacement.zIndex,
          textFitMode: savedPlacement.textFitMode,
          textAlignment: savedPlacement.textAlignment,
          minimumFontSize: savedPlacement.minimumFontSize,
          textSizeOverride: savedPlacement.textSizeOverride,
          allowLabelResize: savedPlacement.allowLabelResize,
          matchHitboxToSkin: savedPlacement.matchHitboxToSkin,
          allowStretching: savedPlacement.allowStretching
        }
      : structuredClone(savedPlacement);
  }
}

export function buildButtonSkinScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  scope: ButtonSkinSaveScope
): ButtonStateDocument {
  const next = cloneButtonDocument(committed);
  for (const skinId of scope.skinIds) {
    next.skins[skinId] = structuredClone(requireDraftRecord(draft.skins, skinId, "Button skin"));
  }
  for (const placementId of scope.placementIds ?? []) {
    const committedPlacement = requireDraftRecord(
      committed.placements,
      placementId,
      "Saved Button placement"
    );
    const draftPlacement = requireDraftRecord(draft.placements, placementId, "Button placement");
    next.placements[placementId] = {
      ...structuredClone(committedPlacement),
      skinOverrideId: draftPlacement.skinOverrideId
    };
  }
  for (const buttonId of scope.buttonIds ?? []) {
    const committedButton = requireDraftRecord(committed.buttons, buttonId, "Saved Button");
    const draftButton = requireDraftRecord(draft.buttons, buttonId, "Button");
    next.buttons[buttonId] = {
      ...structuredClone(committedButton),
      label: draftButton.label
    };
  }
  next.revision = committed.revision;
  return next;
}

export function applyButtonSkinSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  scope: ButtonSkinSaveScope
): void {
  for (const skinId of scope.skinIds) {
    const skin = saved.skins[skinId];
    if (skin) target.skins[skinId] = structuredClone(skin);
  }
  for (const placementId of scope.placementIds ?? []) {
    const placement = saved.placements[placementId];
    if (placement && target.placements[placementId]) {
      target.placements[placementId].skinOverrideId = placement.skinOverrideId;
    }
  }
  for (const buttonId of scope.buttonIds ?? []) {
    const button = saved.buttons[buttonId];
    if (button && target.buttons[buttonId]) target.buttons[buttonId].label = button.label;
  }
}

/**
 * Button activation behavior is Button-owned, while its authored-skin visual
 * mapping is placement-owned. Persisting them together keeps stable state IDs
 * and placement mappings in one explicit Apply action without coupling either
 * to Save skin or Save placement.
 */
export function buildButtonBehaviorScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  scope: ButtonBehaviorSaveScope
): ButtonStateDocument {
  const committedButton = requireDraftRecord(committed.buttons, scope.buttonId, "Saved Button");
  const draftButton = requireDraftRecord(draft.buttons, scope.buttonId, "Button");
  const next = cloneButtonDocument(committed);
  next.buttons[scope.buttonId] = {
    ...structuredClone(committedButton),
    label: draftButton.label,
    activationBehavior: structuredClone(draftButton.activationBehavior)
  };
  for (const placementId of scope.placementIds) {
    const committedPlacement = requireDraftRecord(
      committed.placements,
      placementId,
      "Saved Button placement"
    );
    const draftPlacement = requireDraftRecord(draft.placements, placementId, "Button placement");
    next.placements[placementId] = {
      ...structuredClone(committedPlacement),
      visualStateMap: structuredClone(draftPlacement.visualStateMap)
    };
  }
  next.revision = committed.revision;
  return next;
}

export function applyButtonBehaviorSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  scope: ButtonBehaviorSaveScope
): void {
  const button = saved.buttons[scope.buttonId];
  if (button && target.buttons[scope.buttonId]) {
    target.buttons[scope.buttonId].label = button.label;
    target.buttons[scope.buttonId].activationBehavior = structuredClone(button.activationBehavior);
  }
  for (const placementId of scope.placementIds) {
    const placement = saved.placements[placementId];
    if (placement && target.placements[placementId]) {
      target.placements[placementId].visualStateMap = structuredClone(placement.visualStateMap);
    }
  }
}

export function buildButtonAnimationScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  buttonId: string
): ButtonStateDocument {
  const committedButton = requireDraftRecord(committed.buttons, buttonId, "Saved Button");
  const draftButton = requireDraftRecord(draft.buttons, buttonId, "Button");
  const next = cloneButtonDocument(committed);
  next.buttons[buttonId] = {
    ...structuredClone(committedButton),
    activationAnimation: structuredClone(draftButton.activationAnimation)
  };
  next.revision = committed.revision;
  return next;
}

export function applyButtonAnimationSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  buttonId: string
): void {
  const savedButton = saved.buttons[buttonId];
  if (savedButton && target.buttons[buttonId]) {
    target.buttons[buttonId].activationAnimation = structuredClone(savedButton.activationAnimation);
  }
}

export function buttonSkinsEqual(left: ButtonSkin, right: ButtonSkin): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function skinHasReferencesOutsidePlacements(
  document: ButtonStateDocument,
  skinId: string,
  allowedPlacementIds: ReadonlySet<string>
): boolean {
  if (document.settings.defaultSkinId === skinId) return true;
  if (Object.values(document.buttons).some((button) => button.defaultSkinId === skinId)) return true;
  return Object.values(document.placements).some((placement) =>
    placement.skinOverrideId === skinId && !allowedPlacementIds.has(placement.id)
  );
}
