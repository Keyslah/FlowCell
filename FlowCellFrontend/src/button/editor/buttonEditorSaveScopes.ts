import type {
  ButtonRecord,
  ButtonSkin,
  ButtonStateDocument
} from "../types.js";
import { cloneButtonDocument } from "../state/buttonDefaults.js";
import type { ButtonPlacementSizingMode } from "./buttonSizeAssignments.js";
import {
  applyButtonSettingsFile,
  buildButtonSettingsFile,
  type ButtonSettingsFileApplyContext
} from "../state/buttonSettingsFile.js";

export interface ButtonSkinSaveScope {
  skinIds: readonly string[];
  placementIds?: readonly string[];
  sizingMode?: ButtonPlacementSizingMode;
}

export interface ButtonBehaviorSaveScope {
  buttonId: string;
  placementIds: readonly string[];
}

export interface ButtonTextSaveScope {
  entries: readonly {
    buttonId: string;
    placementId: string;
  }[];
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
 * Builds the geometry/presentation baseline used by the complete Save Settings
 * scope. Existing records contribute geometry/order plus placement-owned sizing,
 * text-fit, and activation-cycle policy; skin assignment/source and animation
 * fields stay on the committed baseline until the settings layer applies them.
 * Newly installed Button graphs are included because their placements cannot
 * exist canonically without their owning records.
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
  const retainedPlacementIds = new Set(placementIds);
  for (const placementId of committedSurface?.placementIds ?? []) {
    if (!retainedPlacementIds.has(placementId)) delete next.placements[placementId];
  }

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
          textOffsetX: draftPlacement.textOffsetX,
          textOffsetY: draftPlacement.textOffsetY,
          allowLabelResize: draftPlacement.allowLabelResize,
          matchHitboxToSkin: draftPlacement.matchHitboxToSkin,
          allowStretching: draftPlacement.allowStretching,
          highlightOnHover: draftPlacement.highlightOnHover,
          activationCycle: structuredClone(draftPlacement.activationCycle)
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

export function buildButtonSettingsScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  surfaceId: string,
  context: ButtonSettingsFileApplyContext,
  editorBaseline: ButtonStateDocument = committed
): ButtonStateDocument {
  const settingsFile = buildButtonSettingsFile(draft, surfaceId, context);
  const scopedBase = buildButtonPlacementScopedDocument(
    committed,
    draft,
    surfaceId,
    editorBaseline
  );
  scopedBase.settings.buttonSpacingMm = draft.settings.buttonSpacingMm;
  const retainedPlacementIds = new Set(scopedBase.surfaces[surfaceId]?.placementIds ?? []);
  const rebasedFile = {
    ...settingsFile,
    entries: settingsFile.entries
      .filter((entry) => retainedPlacementIds.has(entry.placementId))
      .map((entry, index) => ({
        ...entry,
        placement: {
          ...entry.placement,
          zIndex: index
        }
      }))
  };
  return applyButtonSettingsFile(scopedBase, surfaceId, rebasedFile, context);
}

export function applyButtonSettingsSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  surfaceId: string,
  context: ButtonSettingsFileApplyContext
): void {
  if (!saved.surfaces[surfaceId]) return;
  const settingsFile = buildButtonSettingsFile(saved, surfaceId, context);
  const next = applyButtonSettingsFile(target, surfaceId, settingsFile, context);
  next.settings.buttonSpacingMm = saved.settings.buttonSpacingMm;
  Object.assign(target, next);
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
          textOffsetX: savedPlacement.textOffsetX,
          textOffsetY: savedPlacement.textOffsetY,
          allowLabelResize: savedPlacement.allowLabelResize,
          matchHitboxToSkin: savedPlacement.matchHitboxToSkin,
          allowStretching: savedPlacement.allowStretching,
          highlightOnHover: savedPlacement.highlightOnHover,
          activationCycle: structuredClone(savedPlacement.activationCycle)
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
      skinOverrideId: draftPlacement.skinOverrideId,
      ...(scope.sizingMode
        ? {
            matchHitboxToSkin: scope.sizingMode !== "responsive",
            allowStretching: scope.sizingMode === "stretch"
          }
        : {})
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
      if (scope.sizingMode) {
        target.placements[placementId].matchHitboxToSkin = placement.matchHitboxToSkin;
        target.placements[placementId].allowStretching = placement.allowStretching;
      }
    }
  }
}

function buildButtonBehaviorWithoutPendingText(
  committedButton: ButtonRecord,
  draftButton: ButtonRecord
): ButtonRecord["activationBehavior"] {
  const draftBehavior = draftButton.activationBehavior;
  if (!draftBehavior) return null;
  const committedStatesById = new Map(
    (committedButton.activationBehavior?.states ?? []).map((state) => [state.id, state])
  );
  return {
    mode: draftBehavior.mode,
    states: draftBehavior.states.map((state) => {
      const committedState = committedStatesById.get(state.id);
      return {
        ...structuredClone(state),
        label: committedState?.label ?? committedButton.label,
        labelOverrides: structuredClone(committedState?.labelOverrides ?? {})
      };
    })
  };
}

/**
 * Button activation behavior is Button-owned, while its authored-skin visual
 * mapping is placement-owned. Persisting them together keeps stable state IDs
 * and placement mappings in one explicit Apply action without coupling either
 * to Save skin or Save Settings.
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
    activationBehavior: buildButtonBehaviorWithoutPendingText(committedButton, draftButton)
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
  const targetButton = target.buttons[scope.buttonId];
  if (button && targetButton) {
    const pendingStatesById = new Map(
      (targetButton.activationBehavior?.states ?? []).map((state) => [state.id, state])
    );
    targetButton.activationBehavior = button.activationBehavior
      ? {
          ...structuredClone(button.activationBehavior),
          states: button.activationBehavior.states.map((state) => {
            const pendingState = pendingStatesById.get(state.id);
            return pendingState
              ? {
                  ...structuredClone(state),
                  label: pendingState.label,
                  labelOverrides: structuredClone(pendingState.labelOverrides)
                }
              : structuredClone(state);
          })
        }
      : null;
  }
  for (const placementId of scope.placementIds) {
    const placement = saved.placements[placementId];
    if (placement && target.placements[placementId]) {
      target.placements[placementId].visualStateMap = structuredClone(placement.visualStateMap);
    }
  }
}

/**
 * Button Text owns only rendered labels and each scoped placement's host text
 * policy. A configured placement cycle keeps its labels placement-owned and
 * leaves the shared Button label untouched. Without one, the base label also
 * refreshes legacy activation-state labels so the compatibility runtime renders
 * the value shown in preview. State structure, visual mappings, skin source,
 * and placement geometry remain untouched.
 */
export function buildButtonTextScopedDocument(
  committed: ButtonStateDocument,
  draft: ButtonStateDocument,
  scope: ButtonTextSaveScope
): ButtonStateDocument {
  const next = cloneButtonDocument(committed);
  const baseLabelButtonIds = new Set<string>();

  for (const entry of scope.entries) {
    const committedPlacement = requireDraftRecord(
      committed.placements,
      entry.placementId,
      "Saved Button placement"
    );
    const draftPlacement = requireDraftRecord(draft.placements, entry.placementId, "Button placement");
    if (committedPlacement.buttonId !== entry.buttonId || draftPlacement.buttonId !== entry.buttonId) {
      throw new Error(`Button placement '${entry.placementId}' no longer belongs to '${entry.buttonId}'.`);
    }
    if (committedPlacement.activationCycle === null) {
      baseLabelButtonIds.add(entry.buttonId);
    }
    const draftCycleStatesById = new Map(
      (draftPlacement.activationCycle?.states ?? []).map((state) => [state.id, state])
    );
    next.placements[entry.placementId] = {
      ...structuredClone(committedPlacement),
      textFitMode: draftPlacement.textFitMode,
      textAlignment: draftPlacement.textAlignment,
      minimumFontSize: draftPlacement.minimumFontSize,
      textSizeOverride: draftPlacement.textSizeOverride,
      textOffsetX: draftPlacement.textOffsetX,
      textOffsetY: draftPlacement.textOffsetY,
      activationCycle: committedPlacement.activationCycle
        ? {
            ...structuredClone(committedPlacement.activationCycle),
            states: committedPlacement.activationCycle.states.map((state) => ({
              ...structuredClone(state),
              label: draftCycleStatesById.get(state.id)?.label ?? state.label
            }))
          }
        : null
    };
  }

  for (const buttonId of baseLabelButtonIds) {
    const committedButton = requireDraftRecord(committed.buttons, buttonId, "Saved Button");
    const draftButton = requireDraftRecord(draft.buttons, buttonId, "Button");
    next.buttons[buttonId] = {
        ...structuredClone(committedButton),
        label: draftButton.label,
        activationBehavior: committedButton.activationBehavior
          ? {
              ...structuredClone(committedButton.activationBehavior),
              states: committedButton.activationBehavior.states.map((state) => ({
                ...structuredClone(state),
                label: draftButton.label
              }))
            }
          : null
    };
  }
  next.revision = committed.revision;
  return next;
}

export function applyButtonTextSavedScope(
  target: ButtonStateDocument,
  saved: ButtonStateDocument,
  scope: ButtonTextSaveScope
): void {
  const baseLabelButtonIds = new Set<string>();
  for (const entry of scope.entries) {
    const savedPlacement = saved.placements[entry.placementId];
    if (savedPlacement?.activationCycle === null) {
      baseLabelButtonIds.add(entry.buttonId);
    }
  }
  for (const buttonId of baseLabelButtonIds) {
    const savedButton = saved.buttons[buttonId];
    const targetButton = target.buttons[buttonId];
    if (savedButton && targetButton) {
      targetButton.label = savedButton.label;
      for (const targetState of targetButton.activationBehavior?.states ?? []) {
        targetState.label = savedButton.label;
      }
    }
  }

  for (const entry of scope.entries) {
    const savedPlacement = saved.placements[entry.placementId];
    const targetPlacement = target.placements[entry.placementId];
    if (savedPlacement && targetPlacement) {
      targetPlacement.textFitMode = savedPlacement.textFitMode;
      targetPlacement.textAlignment = savedPlacement.textAlignment;
      targetPlacement.minimumFontSize = savedPlacement.minimumFontSize;
      targetPlacement.textSizeOverride = savedPlacement.textSizeOverride;
      targetPlacement.textOffsetX = savedPlacement.textOffsetX;
      targetPlacement.textOffsetY = savedPlacement.textOffsetY;
      const savedCycleStatesById = new Map(
        (savedPlacement.activationCycle?.states ?? []).map((state) => [state.id, state])
      );
      for (const targetState of targetPlacement.activationCycle?.states ?? []) {
        const savedState = savedCycleStatesById.get(targetState.id);
        if (savedState) targetState.label = savedState.label;
      }
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
