import type {
  ButtonPlacement,
  ButtonRect,
  ButtonRecord,
  ButtonStateDocument,
  ToolSetActionExecutionTarget,
  ToolSetButtonPopoutUnit
} from "../types.js";
import {
  buttonRectsOverlap,
  buttonSpacingPixelsFromMillimeters,
  createStarterButtonLayout
} from "../geometry/buttonGeometry.js";
import type { InstallButtonSourceResult } from "./ButtonStateRepository.js";
import { cloneButtonDocument } from "./buttonDefaults.js";
import { validateInstalledButtonLayout } from "./installedButtonLayoutValidation.js";
import { resolveInstalledToolFields } from "./installedToolFields.js";
import { assignInstalledToolSetSkins } from "./installedToolSetSkins.js";
import { hideThemeContributionOwner } from "./buttonDocumentOperations.js";
import { DEFAULT_BUTTON_SKIN, getDefaultButtonSize } from "../skins/defaultButtonSkin.js";

function stableDocumentIdSegment(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return Array.from(normalized)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

function toolSetChildSlot(
  child: ButtonRecord,
  ownerButtonId: string,
  incomingChildren: InstallButtonSourceResult["children"]
): string {
  const metadataSlot = child.metadata.toolSetSlot;
  if (typeof metadataSlot === "string" && metadataSlot.trim()) {
    return metadataSlot.trim();
  }

  const candidate = child.executionTarget as Partial<ToolSetActionExecutionTarget> | null;
  return candidate?.kind === "tool-set-action" && typeof candidate.command === "string"
    ? candidate.command.trim()
    : incomingChildren.find((incoming, index) =>
        child.id === `button-child-${ownerButtonId}-${stableDocumentIdSegment(incoming.slot)}-${index}`
      )?.slot.trim() ?? "";
}

const normalizedSlot = (value: string) => value.trim().toLocaleLowerCase("en-US");

function appendMissingToolSetChildren(
  document: ButtonStateDocument,
  owner: ButtonRecord,
  unit: ToolSetButtonPopoutUnit,
  installed: InstallButtonSourceResult,
  childIdBySlot: Map<string, string>
): void {
  const surface = document.surfaces[unit.surfaceId];
  if (!surface) throw new Error(`Tool-set owner '${owner.id}' is missing its canonical surface.`);
  const existingPlacements = new Map(unit.childPlacementIds.map((id) => document.placements[id])
    .filter(Boolean).map((placement) => [placement.buttonId, placement]));
  const starter = createStarterButtonLayout(
    installed.children.map((child) => {
      const existing = existingPlacements.get(childIdBySlot.get(normalizedSlot(child.slot)) ?? "");
      return { id: child.slot,
      ...(existing ? { width: existing.width, height: existing.height }
        : document.skins[document.settings.defaultSkinId]?.structure === DEFAULT_BUTTON_SKIN.structure &&
        !installed.layout?.appearance?.children?.[child.slot]
        ? getDefaultButtonSize(child.label, 42, 144, installed.layout?.placementPresentation?.[child.slot]?.textSizeOverride ?? undefined)
        : { width: 144, height: 42 }) };
    }),
    {
      padding: document.settings.defaultSurfacePadding,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      maximumColumns: 4
    }
  );

  const appearanceTargets: { placement: ButtonPlacement; skinKey?: string }[] = [];
  installed.children.forEach((child, index) => {
    const slot = normalizedSlot(child.slot);
    if (childIdBySlot.has(slot)) return;
    const childId = `button-child-${owner.id}-${stableDocumentIdSegment(child.slot)}-${index}`;
    const placementId = `placement-${childId}`;
    if (document.buttons[childId] || document.placements[placementId]) {
      throw new Error(`Tool-set child migration ID '${childId}' is already in use.`);
    }
    let rect: (ButtonRect & { zIndex?: number }) | undefined = installed.layout?.placements?.[child.slot] ?? starter.rects[child.slot];
    if (!rect) throw new Error(`Tool-set child '${child.slot}' has no placement.`);
    if (!installed.layout?.placements?.[child.slot]) {
      const occupied = [
        ...surface.placementIds.map((id) => document.placements[id]).filter(Boolean),
        ...unit.fields,
        ...(installed.layout?.fields ?? [])
      ];
      if (occupied.some((item) => buttonRectsOverlap(rect!, item))) {
        rect = { ...rect, x: document.settings.defaultSurfacePadding,
          y: Math.max(document.settings.defaultSurfacePadding, ...occupied.map((item) => item.y + item.height)) +
            buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm) };
      }
    }
    document.buttons[childId] = {
      id: childId,
      role: "tool-set-child",
      sourceIdentity: null,
      label: child.label,
      tooltip: child.tooltip ?? "",
      executionTarget: child.executionTarget,
      defaultSkinId: document.settings.defaultSkinId,
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      activationBehavior: null,
      toolSetParentId: owner.id,
      toolSetBehavior: cloneButtonDocument(installed.layout?.childBehaviors?.[child.slot] ?? null),
      metadata: { toolSetSlot: child.slot }
    };
    const placement: ButtonPlacement = {
      id: placementId,
      buttonId: childId,
      surfaceId: surface.id,
      ...rect,
      zIndex: rect.zIndex ?? surface.placementIds.length,
      skinOverrideId: null,
      textFitMode: "shrink",
      textAlignment: "skin",
      textOffsetX: 0,
      textOffsetY: 0,
      minimumFontSize: document.settings.defaultMinimumFontSize,
      textSizeOverride: null,
      allowLabelResize: false,
      matchHitboxToSkin: true,
      allowStretching: false,
      highlightOnHover: false,
      activationCycle: null,
      visualStateMap: null,
      resizeAnchor: "top-left"
    };
    Object.assign(placement, cloneButtonDocument(installed.layout?.placementPresentation?.[child.slot] ?? {}));
    document.placements[placementId] = placement;
    appearanceTargets.push({ placement, skinKey: installed.layout?.appearance?.children?.[child.slot] });
    surface.placementIds.push(placementId);
    surface.width = Math.max(surface.width, rect.x + rect.width + document.settings.defaultSurfacePadding);
    surface.height = Math.max(surface.height, rect.y + rect.height + document.settings.defaultSurfacePadding);
    unit.childButtonIds.push(childId);
    unit.childPlacementIds.push(placementId);
    childIdBySlot.set(slot, childId);
  });
  if (appearanceTargets.length) assignInstalledToolSetSkins(document, installed.layout?.appearance, appearanceTargets);
  unit.canonicalBounds = { ...unit.canonicalBounds, width: surface.width, height: surface.height };
}

export function applyInstalledSourceUpdate(
  document: ButtonStateDocument,
  installed: InstallButtonSourceResult
): void {
  const layout = validateInstalledButtonLayout(installed.layout, installed.children.map((child) => child.slot));
  const owner = document.buttons[installed.ownerButtonId];
  if (!owner?.sourceIdentity) {
    throw new Error(`Button '${installed.ownerButtonId}' is not an installed source owner.`);
  }
  const usesPreviousDefaultLabel = installed.previousDefaultLabel !== undefined &&
    owner.label === installed.previousDefaultLabel;

  if (installed.children.length === 0) {
    if (owner.role !== "single-script" || !installed.executionTarget) {
      throw new Error("The selected update no longer matches this single-script Button.");
    }
    owner.sourceIdentity = installed.sourceIdentity;
    owner.executionTarget = installed.executionTarget;
    if (usesPreviousDefaultLabel) owner.label = installed.label;
    if (installed.themeContributionOnly) hideThemeContributionOwner(document, owner.id);
    if (installed.updateTransactionToken) {
      owner.metadata = {
        ...owner.metadata,
        flowcellSourceRevision: installed.updateTransactionToken
      };
    }
    return;
  }

  if (owner.role !== "tool-set-owner" || installed.executionTarget) {
    throw new Error("The selected update no longer matches this tool-set owner.");
  }
  const units = Object.values(document.popoutUnits).filter(
    (unit): unit is ToolSetButtonPopoutUnit =>
      unit.kind === "tool-set" && unit.ownerButtonId === owner.id
  );
  if (units.length !== 1) {
    throw new Error(`Tool-set owner '${owner.id}' must own exactly one canonical popout.`);
  }
  const unit = units[0];
  const childIdBySlot = new Map<string, string>();
  for (const childId of unit.childButtonIds) {
    const child = document.buttons[childId];
    if (!child || child.role !== "tool-set-child" || child.toolSetParentId !== owner.id) {
      throw new Error(`Tool-set owner '${owner.id}' has an invalid child graph.`);
    }
    const slot = normalizedSlot(toolSetChildSlot(child, owner.id, installed.children));
    if (!slot || childIdBySlot.has(slot)) {
      throw new Error(`Tool-set owner '${owner.id}' has missing or duplicate child slots.`);
    }
    childIdBySlot.set(slot, childId);
  }
  const incomingSlots = new Set(installed.children.map((child) => normalizedSlot(child.slot)));
  const appendMissingSlots = layout?.updatePolicy?.appendMissingChildSlots === true;
  if (
    incomingSlots.size !== installed.children.length ||
    [...childIdBySlot.keys()].some((slot) => !incomingSlots.has(slot)) ||
    (!appendMissingSlots && incomingSlots.size !== childIdBySlot.size)
  ) {
    throw new Error("Update cannot add, remove, or rename tool-set child slots. Delete and re-add the tool set to change its Button graph.");
  }
  if (appendMissingSlots) {
    appendMissingToolSetChildren(document, owner, unit, installed, childIdBySlot);
  }

  owner.sourceIdentity = installed.sourceIdentity;
  owner.executionTarget = null;
  for (const child of installed.children) {
    const childButton = document.buttons[childIdBySlot.get(normalizedSlot(child.slot))!];
    childButton.executionTarget = child.executionTarget;
    childButton.toolSetBehavior = cloneButtonDocument(
      layout?.childBehaviors?.[child.slot] ?? null
    );
    childButton.metadata = {
      ...childButton.metadata,
      toolSetSlot: child.slot
    };
  }
  const previousFields = new Map(unit.fields.map((field) => [field.id.trim().toLocaleLowerCase("en-US"), field]));
  unit.fields = resolveInstalledToolFields(layout?.fields, installed.children).map((field) => {
    const previous = previousFields.get(field.id.trim().toLocaleLowerCase("en-US"));
    return previous ? { ...field, x: previous.x, y: previous.y, width: previous.width, height: previous.height, zIndex: previous.zIndex } : field;
  });
  if (usesPreviousDefaultLabel) owner.label = installed.label;
}
