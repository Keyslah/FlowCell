import type {
  ButtonExecutionTarget,
  ButtonPlacement,
  ButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";
import { findFirstAvailableButtonPosition } from "../geometry/buttonGeometry.js";
import { createButtonSourceIdentity } from "./sourceIdentity.js";

export const ORGANIZATION_PROFILE_SOURCE_KIND = "organization-profile";
export const ORGANIZATION_PROFILE_PROGRAM_NAME = "Windows";
export const ORGANIZATION_PROFILE_PANEL_NAME = "Files";

export interface InstalledOrganizationProfileButtonSource {
  ownerButtonId: string;
  sourceIdentity: ButtonSourceIdentity;
  executionTarget: ButtonExecutionTarget | null;
}

export interface AttachCanonicalOrganizationProfileButtonResult {
  buttonId: string;
  placementId: string;
  surfaceId: string;
  changed: boolean;
}

function normalizedProfileName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function stableDocumentIdSegment(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return Array.from(normalized)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

export function organizationProfileOwnerButtonId(profileNameValue: string): string {
  const profileName = normalizedProfileName(profileNameValue);
  if (!profileName) throw new Error("Organization profile Button requires a profile name.");
  return `button-organization-profile-${fnv1a64(profileName)}`;
}

function organizationProfilePlacementId(profileName: string): string {
  return `placement-organization-profile-${fnv1a64(normalizedProfileName(profileName))}`;
}

function panelSurfaceId(identity: ButtonSourceIdentity): string {
  return `surface-panel-${stableDocumentIdSegment(identity.displayProgramName)}-${stableDocumentIdSegment(identity.displayPanelName)}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isCanonicalOrganizationProfileButton(
  button: ButtonRecord,
  profileNameValue: string
): boolean {
  const storedProfileName = typeof button.metadata.organizationProfileName === "string"
    ? button.metadata.organizationProfileName
    : "";
  return button.role === "single-script" &&
    button.metadata.sourceKind === ORGANIZATION_PROFILE_SOURCE_KIND &&
    normalizedProfileName(storedProfileName) === normalizedProfileName(profileNameValue);
}

export function resolveOrganizationProfileOwnerButtonId(
  document: ButtonStateDocument,
  profileNameValue: string
): string | null {
  const matches = Object.values(document.buttons).filter((button) =>
    isCanonicalOrganizationProfileButton(button, profileNameValue)
  );
  if (matches.length > 1) {
    throw new Error(
      `Organization profile '${profileNameValue.trim()}' owns more than one canonical Button.`
    );
  }
  return matches[0]?.id ?? null;
}

function validateInstalledSource(
  installed: InstalledOrganizationProfileButtonSource
): asserts installed is InstalledOrganizationProfileButtonSource & {
  executionTarget: Extract<ButtonExecutionTarget, { kind: "panel-script" }>;
} {
  if (!installed.ownerButtonId.trim()) {
    throw new Error("Installed organization profile source has no owner Button ID.");
  }
  const identity = installed.sourceIdentity;
  if (
    identity.normalizedProgramName !== ORGANIZATION_PROFILE_PROGRAM_NAME.toLowerCase() ||
    identity.normalizedPanelName !== ORGANIZATION_PROFILE_PANEL_NAME.toLowerCase()
  ) {
    throw new Error("Organization profile Buttons must install into Windows / Files.");
  }
  const target = installed.executionTarget;
  if (!target || target.kind !== "panel-script") {
    throw new Error("Installed organization profile source has no panel-script execution target.");
  }
  const targetIdentity = createButtonSourceIdentity(
    target.programName,
    target.panelName,
    target.fileName
  );
  if (
    targetIdentity.normalizedProgramName !== identity.normalizedProgramName ||
    targetIdentity.normalizedPanelName !== identity.normalizedPanelName ||
    targetIdentity.normalizedFileName !== identity.normalizedFileName
  ) {
    throw new Error("Organization profile execution target does not match its installed source identity.");
  }
}

function ensurePanelSurface(
  document: ButtonStateDocument,
  identity: ButtonSourceIdentity
): { surface: ButtonSurface; changed: boolean } {
  const id = panelSurfaceId(identity);
  const existing = document.surfaces[id];
  if (existing) {
    if (existing.kind !== "panel") {
      throw new Error(`Canonical organization profile surface '${id}' is not a panel surface.`);
    }
    return { surface: existing, changed: false };
  }
  const surface: ButtonSurface = {
    id,
    name: `${identity.displayProgramName} / ${identity.displayPanelName}`,
    kind: "panel",
    width: 960,
    height: 640,
    placementIds: [],
    visualOverflowAllowance: 24
  };
  document.surfaces[id] = surface;
  return { surface, changed: true };
}

function nextPlacementRect(document: ButtonStateDocument, surface: ButtonSurface) {
  const width = 160;
  const height = 44;
  const padding = document.settings.defaultSurfacePadding;
  const gap = document.settings.defaultGap;
  surface.width = Math.max(surface.width, width + padding * 2);
  const otherRects = surface.placementIds
    .map((id) => document.placements[id])
    .filter((placement): placement is ButtonPlacement => Boolean(placement));
  let rect = findFirstAvailableButtonPosition({
    width,
    height,
    surface,
    otherRects,
    padding,
    gap,
    gridSize: document.settings.gridSize
  });
  if (!rect) {
    surface.height += height + gap;
    rect = findFirstAvailableButtonPosition({
      width,
      height,
      surface,
      otherRects,
      padding,
      gap,
      gridSize: document.settings.gridSize
    });
  }
  if (!rect) {
    throw new Error("Windows / Files has no room for another organization profile Button.");
  }
  return rect;
}

function ensurePrimaryPlacement(args: {
  document: ButtonStateDocument;
  button: ButtonRecord;
  surface: ButtonSurface;
  profileName: string;
}): { placement: ButtonPlacement; changed: boolean } {
  const existing = args.surface.placementIds
    .map((id) => args.document.placements[id])
    .find((placement) => placement?.buttonId === args.button.id);
  if (existing) return { placement: existing, changed: false };

  const id = organizationProfilePlacementId(args.profileName);
  const stablePlacement = args.document.placements[id];
  if (stablePlacement && stablePlacement.buttonId !== args.button.id) {
    throw new Error(`Canonical organization profile placement '${id}' belongs to another Button.`);
  }
  const movablePlacement = stablePlacement ?? Object.values(args.document.placements).find(
    (placement) =>
      placement.buttonId === args.button.id &&
      ["main", "panel"].includes(args.document.surfaces[placement.surfaceId]?.kind ?? "")
  );
  const rect = nextPlacementRect(args.document, args.surface);
  if (movablePlacement) {
    const oldSurface = args.document.surfaces[movablePlacement.surfaceId];
    if (oldSurface) {
      oldSurface.placementIds = oldSurface.placementIds.filter(
        (placementId) => placementId !== movablePlacement.id
      );
    }
    Object.assign(movablePlacement, {
      surfaceId: args.surface.id,
      ...rect,
      zIndex: args.surface.placementIds.length
    });
    args.surface.placementIds.push(movablePlacement.id);
    return { placement: movablePlacement, changed: true };
  }

  const placement: ButtonPlacement = {
    id,
    buttonId: args.button.id,
    surfaceId: args.surface.id,
    ...rect,
    zIndex: args.surface.placementIds.length,
    skinOverrideId: null,
    textFitMode: args.button.defaultTextFitMode,
    minimumFontSize: args.document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  };
  args.document.placements[id] = placement;
  args.surface.placementIds.push(id);
  return { placement, changed: true };
}

export function attachCanonicalOrganizationProfileButton(
  document: ButtonStateDocument,
  profileNameValue: string,
  installed: InstalledOrganizationProfileButtonSource
): AttachCanonicalOrganizationProfileButtonResult {
  const profileName = profileNameValue.trim();
  if (!profileName) throw new Error("Organization profile Button requires a profile name.");
  validateInstalledSource(installed);

  const currentOwnerId = resolveOrganizationProfileOwnerButtonId(document, profileName);
  const expectedOwnerId = currentOwnerId ?? organizationProfileOwnerButtonId(profileName);
  if (installed.ownerButtonId !== expectedOwnerId) {
    throw new Error(
      `Installed organization profile source belongs to '${installed.ownerButtonId}', expected '${expectedOwnerId}'.`
    );
  }

  let button = document.buttons[installed.ownerButtonId];
  if (button && !isCanonicalOrganizationProfileButton(button, profileName)) {
    throw new Error(`Canonical organization profile Button ID '${installed.ownerButtonId}' is already in use.`);
  }

  let changed = false;
  const nextButton: ButtonRecord = {
    ...(button ?? {
      id: installed.ownerButtonId,
      defaultSkinId: document.settings.defaultSkinId,
      defaultTextFitMode: "shrink",
      disabled: false,
      activationAnimation: null,
      metadata: {}
    }),
    id: installed.ownerButtonId,
    role: "single-script",
    sourceIdentity: installed.sourceIdentity,
    label: profileName,
    tooltip: `Apply the saved '${profileName}' organization profile to the clipboard folder.`,
    executionTarget: installed.executionTarget,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {
      ...(button?.metadata ?? {}),
      sourceKind: ORGANIZATION_PROFILE_SOURCE_KIND,
      organizationProfileName: profileName
    }
  };
  if (!button || !sameJson(button, nextButton)) {
    document.buttons[installed.ownerButtonId] = nextButton;
    button = nextButton;
    changed = true;
  }

  const ensuredSurface = ensurePanelSurface(document, installed.sourceIdentity);
  const ensuredPlacement = ensurePrimaryPlacement({
    document,
    button,
    surface: ensuredSurface.surface,
    profileName
  });
  return {
    buttonId: button.id,
    placementId: ensuredPlacement.placement.id,
    surfaceId: ensuredSurface.surface.id,
    changed: changed || ensuredSurface.changed || ensuredPlacement.changed
  };
}
