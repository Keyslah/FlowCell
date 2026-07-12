import type {
  ButtonFanSetup,
  ButtonPlacement,
  ButtonRecord,
  RegularButtonPopoutUnit,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import {
  createStarterButtonLayout,
  findFirstAvailableButtonPosition
} from "../geometry/buttonGeometry.js";
import { cloneButtonDocument, createStableButtonId } from "./buttonDefaults.js";
import { deriveRegularPopoutSelectionKey } from "./sourceIdentity.js";

export interface RemoveOwnedButtonResult {
  removedButtonIds: string[];
  uninstallOwnerButtonIds: string[];
}

function createSurface(
  document: ButtonStateDocument,
  name: string,
  kind: ButtonSurface["kind"],
  width: number,
  height: number
): ButtonSurface {
  const id = createStableButtonId("surface");
  const surface: ButtonSurface = {
    id,
    name,
    kind,
    width,
    height,
    placementIds: [],
    visualOverflowAllowance: 24
  };
  document.surfaces[id] = surface;
  return surface;
}

function addPlacement(
  document: ButtonStateDocument,
  buttonId: string,
  surfaceId: string,
  rect: { x: number; y: number; width: number; height: number }
): ButtonPlacement {
  const id = createStableButtonId("placement");
  const placement: ButtonPlacement = {
    id,
    buttonId,
    surfaceId,
    ...rect,
    zIndex: document.surfaces[surfaceId].placementIds.length,
    skinOverrideId: null,
    textFitMode: document.buttons[buttonId].defaultTextFitMode,
    minimumFontSize: document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  document.placements[id] = placement;
  document.surfaces[surfaceId].placementIds.push(id);
  return placement;
}

export function ensureRegularPopout(
  document: ButtonStateDocument,
  buttons: readonly ButtonRecord[]
): RegularButtonPopoutUnit {
  const eligible = [...new Map(
    buttons
      .filter((button) => button.role === "single-script" && Boolean(button.sourceIdentity))
      .map((button) => [button.id.trim(), button] as const)
  ).values()];
  if (eligible.length === 0) throw new Error("A regular popout needs at least one script Button.");
  const identities = eligible.map((button) => button.sourceIdentity!);
  const selectionKey = deriveRegularPopoutSelectionKey(identities);
  const existing = Object.values(document.popoutUnits).find(
    (unit): unit is RegularButtonPopoutUnit =>
      unit.kind === "regular" && unit.selectionKey === selectionKey
  );
  if (existing) return existing;
  const starter = createStarterButtonLayout(
    eligible.map((button) => ({ id: button.id, width: 160, height: 44 })),
    {
      padding: document.settings.defaultSurfacePadding,
      gap: document.settings.defaultGap,
      maximumColumns: 4
    }
  );
  const surface = createSurface(
    document,
    eligible.length === 1 ? eligible[0].label : `${eligible.length} Buttons`,
    "regular-popout",
    starter.requiredWidth,
    starter.requiredHeight
  );
  eligible.forEach((button) => addPlacement(document, button.id, surface.id, starter.rects[button.id]));
  const id = createStableButtonId("popout");
  const unit: RegularButtonPopoutUnit = {
    id,
    name: surface.name,
    kind: "regular",
    surfaceId: surface.id,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
    desktopBounds: null,
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: surface.width, height: surface.height },
    memberPlacementIds: [...surface.placementIds],
    openRule: "toggle",
    closeRule: "escape",
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    memberSourceIdentities: cloneButtonDocument(identities),
    selectionKey
  };
  document.popoutUnits[id] = unit;
  return unit;
}

function normalizeIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizeIds(left);
  const normalizedRight = normalizeIds(right);
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function nextFanSetupName(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): string {
  const baseName = `${panelName} Fan`;
  const existingNames = new Set(
    Object.values(document.fanSetups)
      .filter((setup) =>
        setup.programName.trim().toLocaleLowerCase("en") === programName.trim().toLocaleLowerCase("en") &&
        setup.panelName.trim().toLocaleLowerCase("en") === panelName.trim().toLocaleLowerCase("en")
      )
      .map((setup) => setup.name.trim().toLocaleLowerCase("en"))
  );
  if (!existingNames.has(baseName.toLocaleLowerCase("en"))) return baseName;
  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = `${baseName} ${suffix}`;
    if (!existingNames.has(candidate.toLocaleLowerCase("en"))) return candidate;
  }
  throw new Error(`A unique fan name could not be created for '${programName} / ${panelName}'.`);
}

export function resolveUninstallOwnerButtonIds(
  document: ButtonStateDocument,
  ...candidateGroups: ReadonlyArray<readonly string[]>
): string[] {
  return normalizeIds(candidateGroups.flat()).filter((id) => !document.buttons[id]);
}

export function resolveDiscardedStagedOwnerButtonIds(
  document: ButtonStateDocument,
  stagedOwnerButtonIds: readonly string[]
): string[] {
  return normalizeIds(stagedOwnerButtonIds).filter((id) => !document.buttons[id]);
}

export function ensureFanSetup(args: {
  document: ButtonStateDocument;
  programName: string;
  panelName: string;
  buttons: readonly ButtonRecord[];
}): ButtonFanSetup {
  const uniqueButtons = [...new Map(
    args.buttons.map((button) => [button.id.trim(), button] as const)
  ).values()];
  const members = uniqueButtons.filter((button) => button.role === "single-script");
  const owners = uniqueButtons.filter((button) => button.role === "tool-set-owner");
  if (members.length === 0 && owners.length === 0) {
    throw new Error("A fan needs at least one script Button or tool-set owner.");
  }
  const existing = Object.values(args.document.fanSetups).find(
    (setup) =>
      setup.programName === args.programName &&
      setup.panelName === args.panelName &&
      sameIds(setup.fanMemberButtonIds, members.map((button) => button.id)) &&
      sameIds(setup.selectedToolSetOwnerButtonIds, owners.map((button) => button.id))
  );
  if (existing) return existing;
  let panelOwner = Object.values(args.document.buttons).find(
    (button) =>
      button.role === "panel-owner" &&
      button.metadata.programName === args.programName &&
      button.metadata.panelName === args.panelName
  );
  if (!panelOwner) {
    const id = createStableButtonId("button-panel-owner");
    panelOwner = {
      id,
      role: "panel-owner",
      sourceIdentity: null,
      label: args.panelName,
      tooltip: `${args.programName} ${args.panelName} fan`,
      executionTarget: null,
      defaultSkinId: args.document.settings.defaultSkinId,
      defaultTextFitMode: "shrink-and-stack",
      disabled: false,
      toolSetParentId: null,
      toolSetBehavior: null,
      metadata: { programName: args.programName, panelName: args.panelName }
    };
    args.document.buttons[id] = panelOwner;
  }
  const layoutButtons = [panelOwner, ...members];
  const starter = createStarterButtonLayout(
    layoutButtons.map((button) => ({ id: button.id, width: 160, height: 44 })),
    {
      padding: args.document.settings.defaultSurfacePadding,
      gap: args.document.settings.defaultGap,
      maximumColumns: 4
    }
  );
  const surface = createSurface(
    args.document,
    `${args.panelName} Fan`,
    "fan",
    starter.requiredWidth,
    starter.requiredHeight
  );
  addPlacement(
    args.document,
    panelOwner.id,
    surface.id,
    starter.rects[panelOwner.id]
  );
  const memberPlacements = members.map((button) =>
    addPlacement(args.document, button.id, surface.id, starter.rects[button.id])
  );
  const id = createStableButtonId("fan");
  const setup: ButtonFanSetup = {
    id,
    name: nextFanSetupName(args.document, args.programName, args.panelName),
    programName: args.programName,
    panelName: args.panelName,
    panelOwnerButtonId: panelOwner.id,
    fanMemberButtonIds: members.map((button) => button.id),
    selectedToolSetOwnerButtonIds: owners.map((button) => button.id),
    fanSurfaceId: surface.id,
    fanMemberPlacementIds: memberPlacements.map((placement) => placement.id),
    toolSetOwnerAnchors: Object.fromEntries(
      owners.map((owner, index) => [owner.id, { left: index * 180, top: 0, width: 160, height: 44 }])
    ),
    openRule: "hover",
    closeRule: "hover-out",
    pinnedDefault: false,
    windowFitMode: "surface",
    collapsedBoundsFitMode: "surface",
    collapsedBoundsEnvelope: {
      x: 0,
      y: 0,
      width: starter.rects[panelOwner.id].width,
      height: starter.rects[panelOwner.id].height
    },
    animation: { durationMs: 180, easing: "ease-out", staggerMs: 30 }
  };
  args.document.fanSetups[id] = setup;
  return setup;
}

function removePlacement(document: ButtonStateDocument, placementId: string): void {
  const placement = document.placements[placementId];
  if (!placement) return;
  const surface = document.surfaces[placement.surfaceId];
  if (surface) {
    surface.placementIds = surface.placementIds.filter((id) => id !== placementId);
  }
  delete document.placements[placementId];
}

function nextFanMemberRect(
  document: ButtonStateDocument,
  surface: ButtonSurface
): { x: number; y: number; width: number; height: number } {
  const width = 160;
  const height = 44;
  const padding = document.settings.defaultSurfacePadding;
  const gap = document.settings.defaultGap;
  surface.width = Math.max(surface.width, width + padding * 2);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const otherRects = surface.placementIds
      .map((placementId) => document.placements[placementId])
      .filter((placement): placement is ButtonPlacement => Boolean(placement));
    const rect = findFirstAvailableButtonPosition({
      width,
      height,
      surface,
      otherRects,
      padding,
      gap,
      gridSize: document.settings.gridSize
    });
    if (rect) return rect;
    surface.height += height + gap;
  }
  throw new Error(`Fan surface '${surface.name}' has no room for another Button.`);
}

function nextToolSetOwnerAnchor(
  anchors: Readonly<Record<string, { left: number; top: number; width: number; height: number }>>
): { left: number; top: number; width: number; height: number } {
  const right = Math.max(
    0,
    ...Object.values(anchors).map((anchor) => anchor.left + anchor.width)
  );
  return {
    left: right > 0 ? right + 20 : 0,
    top: 0,
    width: 160,
    height: 44
  };
}

export function updateFanSetupMembers(args: {
  document: ButtonStateDocument;
  setupId: string;
  buttons: readonly ButtonRecord[];
}): ButtonFanSetup {
  const setup = args.document.fanSetups[args.setupId];
  if (!setup) throw new Error(`Fan setup '${args.setupId}' was not found.`);
  const surface = args.document.surfaces[setup.fanSurfaceId];
  if (!surface || surface.kind !== "fan") {
    throw new Error(`Fan setup '${setup.name}' has no canonical Fan surface.`);
  }
  const panelOwnerPlacement = surface.placementIds
    .map((placementId) => args.document.placements[placementId])
    .find((placement) => placement?.buttonId === setup.panelOwnerButtonId);
  if (!panelOwnerPlacement) {
    throw new Error(`Fan setup '${setup.name}' has no panel-owner placement.`);
  }

  const uniqueButtons = [...new Map(
    args.buttons.map((button) => [button.id.trim(), button] as const)
  ).values()];
  const members = uniqueButtons.filter((button) => button.role === "single-script");
  const owners = uniqueButtons.filter((button) => button.role === "tool-set-owner");
  if (members.length + owners.length !== uniqueButtons.length) {
    throw new Error("A fan can contain only single-script Buttons and Tool Set owners.");
  }
  if (members.length === 0 && owners.length === 0) {
    throw new Error("A fan needs at least one script Button or Tool Set owner.");
  }

  const desiredMemberIds = new Set(members.map((button) => button.id));
  const retainedPlacementsByButtonId = new Map<string, ButtonPlacement>();
  for (const placementId of setup.fanMemberPlacementIds) {
    const placement = args.document.placements[placementId];
    if (!placement || placement.surfaceId !== surface.id) {
      throw new Error(`Fan setup '${setup.name}' has an invalid member placement '${placementId}'.`);
    }
    if (
      desiredMemberIds.has(placement.buttonId) &&
      !retainedPlacementsByButtonId.has(placement.buttonId)
    ) {
      retainedPlacementsByButtonId.set(placement.buttonId, placement);
    } else {
      removePlacement(args.document, placementId);
    }
  }

  const nextMemberPlacements = members.map((button) => {
    const retained = retainedPlacementsByButtonId.get(button.id);
    if (retained) return retained;
    return addPlacement(
      args.document,
      button.id,
      surface.id,
      nextFanMemberRect(args.document, surface)
    );
  });

  const nextAnchors: ButtonFanSetup["toolSetOwnerAnchors"] = Object.fromEntries(
    owners.flatMap((owner) => {
      const retained = setup.toolSetOwnerAnchors[owner.id];
      return retained ? [[owner.id, retained] as const] : [];
    })
  );
  for (const owner of owners) {
    if (!nextAnchors[owner.id]) {
      nextAnchors[owner.id] = nextToolSetOwnerAnchor(nextAnchors);
    }
  }

  setup.fanMemberButtonIds = members.map((button) => button.id);
  setup.fanMemberPlacementIds = nextMemberPlacements.map((placement) => placement.id);
  setup.selectedToolSetOwnerButtonIds = owners.map((button) => button.id);
  setup.toolSetOwnerAnchors = nextAnchors;
  return setup;
}

function removeSurface(document: ButtonStateDocument, surfaceId: string): void {
  const surface = document.surfaces[surfaceId];
  if (!surface) return;
  [...surface.placementIds].forEach((placementId) => removePlacement(document, placementId));
  delete document.surfaces[surfaceId];
}

export function removeOwnedButtonGraph(
  document: ButtonStateDocument,
  rootButtonId: string
): RemoveOwnedButtonResult {
  const root = document.buttons[rootButtonId];
  if (!root) return { removedButtonIds: [], uninstallOwnerButtonIds: [] };

  const removed = new Set<string>([rootButtonId]);
  if (root.role === "tool-set-owner") {
    for (const button of Object.values(document.buttons)) {
      if (button.toolSetParentId === rootButtonId) removed.add(button.id);
    }
  }
  const removedSourceIdentities = [...removed]
    .map((id) => document.buttons[id]?.sourceIdentity)
    .filter((identity): identity is NonNullable<typeof identity> => Boolean(identity));

  for (const placement of Object.values(document.placements)) {
    if (removed.has(placement.buttonId)) removePlacement(document, placement.id);
  }

  for (const [unitId, unit] of Object.entries(document.popoutUnits)) {
    if (unit.kind === "tool-set") {
      if (unit.ownerButtonId === rootButtonId) {
        removeSurface(document, unit.surfaceId);
        delete document.popoutUnits[unitId];
        continue;
      }
      unit.childButtonIds = unit.childButtonIds.filter((id) => !removed.has(id));
      unit.childPlacementIds = unit.childPlacementIds.filter((id) => Boolean(document.placements[id]));
      continue;
    }
    unit.memberPlacementIds = unit.memberPlacementIds.filter((id) => Boolean(document.placements[id]));
    unit.memberSourceIdentities = unit.memberSourceIdentities.filter((identity) =>
      !removedSourceIdentities.some((removedIdentity) =>
        removedIdentity.normalizedProgramName === identity.normalizedProgramName &&
        removedIdentity.normalizedPanelName === identity.normalizedPanelName &&
        removedIdentity.normalizedFileName === identity.normalizedFileName
      )
    );
    if (unit.memberPlacementIds.length === 0) {
      removeSurface(document, unit.surfaceId);
      delete document.popoutUnits[unitId];
    } else {
      unit.selectionKey = deriveRegularPopoutSelectionKey(unit.memberSourceIdentities);
    }
  }

  for (const [setupId, setup] of Object.entries(document.fanSetups)) {
    if (setup.panelOwnerButtonId === rootButtonId) {
      removeSurface(document, setup.fanSurfaceId);
      delete document.fanSetups[setupId];
      continue;
    }
    setup.fanMemberButtonIds = setup.fanMemberButtonIds.filter((id) => !removed.has(id));
    setup.selectedToolSetOwnerButtonIds = setup.selectedToolSetOwnerButtonIds.filter(
      (id) => !removed.has(id)
    );
    for (const id of removed) delete setup.toolSetOwnerAnchors[id];
    setup.fanMemberPlacementIds = setup.fanMemberPlacementIds.filter(
      (placementId) => Boolean(document.placements[placementId])
    );
    if (
      setup.fanMemberButtonIds.length === 0 &&
      setup.selectedToolSetOwnerButtonIds.length === 0
    ) {
      removeSurface(document, setup.fanSurfaceId);
      delete document.fanSetups[setupId];
    }
  }

  for (const button of Object.values(document.buttons)) {
    if (button.role !== "panel-owner" || removed.has(button.id)) continue;
    const stillOwned = Object.values(document.fanSetups).some(
      (setup) => setup.panelOwnerButtonId === button.id
    );
    const stillPlaced = Object.values(document.placements).some(
      (placement) => placement.buttonId === button.id
    );
    if (!stillOwned && !stillPlaced) removed.add(button.id);
  }

  removed.forEach((id) => delete document.buttons[id]);
  return {
    removedButtonIds: [...removed],
    uninstallOwnerButtonIds:
      root.sourceIdentity &&
      root.role !== "panel-owner" &&
      root.metadata.sourceKind !== "frontend-macro"
        ? [rootButtonId]
        : []
  };
}
