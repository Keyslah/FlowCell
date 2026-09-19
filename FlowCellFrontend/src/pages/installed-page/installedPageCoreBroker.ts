import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, monitorFromPoint } from "@tauri-apps/api/window";

import type { ButtonStateDocument, JsonValue } from "../../button/types";
import type { FlowCellBounds } from "../../types";
import { mappedToolPackageFields } from "../../button/runtime/toolPackageMapping.js";
import {
  createButtonDraftRequestId,
  publishButtonCommit,
  publishButtonDraft,
  requestButtonDraft,
  subscribeButtonDrafts
} from "../../button/state/ButtonDraftBus";
import {
  finalizeButtonSourceUpdate,
  installButtonSource,
  loadButtonStateDocument,
  mergeLegacyInstallsIntoDocument,
  rollbackButtonSourceUpdate,
  saveButtonStateDocument,
  uninstallButtonSource,
  updateButtonSource
} from "../../button/state/ButtonStateRepository";
import { cloneButtonDocument } from "../../button/state/buttonDefaults";
import { expandedButtonPopoutPlacementIds } from "../../button/state/buttonPopoutInteractionOperations";
import { resolvePanelOwnerFanPlacement } from "../../button/state/panelOwnerButtonOperations";
import { applyInstalledSourceUpdate } from "../../button/state/sourceUpdateOperations.js";
import { readRegisteredLayoutWindow } from "../../lib/layoutSnapshots.js";
import { showOpenFileDialog, showOpenFolderDialog, showSaveFileDialog } from "../../lib/tauri";
import {
  applyProgramPopoutPaletteTargets,
  applyProgramPopoutTextColorTargets,
  gradientProgramPopoutPaletteAssignments,
  programPopoutPaletteTargetsHaveTextColor,
  programPopoutPaletteScreenPositions,
  programPopoutPaletteTargetPositions,
  scanProgramPopoutPaletteTargets,
  type ProgramPopoutPaletteAssignment,
  type ProgramPopoutPaletteGradient,
  type ProgramPopoutPaletteGradientItem,
  type ProgramPopoutPaletteScan,
  type ProgramPopoutPaletteTarget,
  type ProgramPopoutTextColor
} from "../../theme/programPopoutPalette.js";

export interface InstalledPageCoreActionPlan {
  kind: "core-action";
  capability: string;
  options: Record<string, JsonValue>;
  payload: JsonValue;
}

export interface InstalledPageCoreIdentity {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
}

interface LoadedToolFields {
  format: string;
  values: Record<string, JsonValue>;
}

interface LoadedToolPackage extends LoadedToolFields {
  name: string;
  manifestPath: string;
  assets: Record<string, string>;
}

interface ToolPackageEntry {
  name: string;
  manifestPath: string;
}

interface AuthorizedGeneratedStage {
  manifestPath: string;
  stageRoot: string;
  packageId: string;
}

const activeToolPackagePaths = new Map<string, string>();

function objectValue(value: unknown, label: string): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, JsonValue>;
}

function stringValue(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback = ""
): string {
  const value = object[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(
  object: Readonly<Record<string, JsonValue>>,
  key: string,
  fallback = 0
): number {
  const value = object[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(
  object: Readonly<Record<string, JsonValue>>,
  key: string
): string[] {
  const value = object[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function stringMap(
  object: Readonly<Record<string, JsonValue>>,
  key: string
): Record<string, string> {
  const value = object[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && Boolean(entry[0].trim()) && Boolean(entry[1].trim())
      )
  );
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop()?.trim() ?? "";
  return name.replace(/\.[^.]+$/, "").trim() || "Tool Fields";
}

function sourceCapabilityIdentity(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const capability = stringValue(options, "capability");
  if (!capability) {
    throw new Error("The installed page action is missing its source capability grant.");
  }
  return {
    programName: identity.programName,
    panelName: identity.panelName,
    fileName: identity.fileName,
    capability
  };
}

function toolPackageIdentity(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const storageFolder = stringValue(options, "storageFolder");
  const formatId = stringValue(options, "formatId");
  if (!storageFolder || !formatId) {
    throw new Error("The installed page tool-package action is missing its storage contract.");
  }
  return {
    ...sourceCapabilityIdentity(identity, options),
    storageFolder,
    formatId
  };
}

function packageKey(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
): string {
  const contract = toolPackageIdentity(identity, options);
  return [identity.ownerButtonId, contract.formatId]
    .map((value) => value.toLocaleLowerCase("en"))
    .join("\u0000");
}

function legacyMapping(options: Readonly<Record<string, JsonValue>>) {
  return {
    legacyFormats: stringArray(options, "legacyFormats"),
    fieldMap: stringMap(options, "legacyFieldMap"),
    assetMap: stringMap(options, "legacyAssetMap"),
    fieldTransforms: stringMap(options, "legacyFieldTransforms")
  };
}

async function loadPackageAtPath(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  manifestPath: string
): Promise<Record<string, JsonValue>> {
  const legacy = legacyMapping(options);
  const loaded = await invoke<LoadedToolPackage>("load_tool_package", {
    ...toolPackageIdentity(identity, options),
    manifestPath,
    legacyFormats: legacy.legacyFormats,
    valueFields: stringArray(options, "valueFields"),
    assetFields: stringArray(options, "assetFields"),
    legacyValueKeys: Object.keys(legacy.fieldMap),
    legacyAssetKeys: Object.keys(legacy.assetMap)
  });
  activeToolPackagePaths.set(packageKey(identity, options), loaded.manifestPath);
  return {
    selected: true,
    fieldPatch: mappedToolPackageFields(loaded, legacy),
    packagePath: loaded.manifestPath,
    packageName: loaded.name,
    message: `Loaded ${loaded.name}.`
  };
}

async function runFileSelect(options: Readonly<Record<string, JsonValue>>) {
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Choose a file"),
    filter: stringValue(options, "filter", "All Files (*.*)|*.*"),
    multiselect: false
  });
  const path = paths[0]?.trim() ?? "";
  return { selected: Boolean(path), path };
}

async function runFolderSelect(options: Readonly<Record<string, JsonValue>>) {
  const paths = await showOpenFolderDialog({
    title: stringValue(options, "dialogTitle", "Choose a folder"),
    multiselect: false
  });
  const path = paths[0]?.trim() ?? "";
  return { selected: Boolean(path), path };
}

async function runSamplePalette(
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const imagePath = stringValue(payload, "imagePath");
  if (!imagePath) {
    return {
      selected: false,
      imagePath: "",
      paletteHexes: [],
      fieldPatch: {},
      message: "Choose an image first."
    };
  }
  const sampled = await invoke<Record<string, JsonValue>>("sample_image_palette", { imagePath });
  const fieldPatch: Record<string, JsonValue> = {};
  const imagePathField = stringValue(options, "imagePathField");
  if (imagePathField) fieldPatch[imagePathField] = imagePath;
  for (const fieldId of stringArray(options, "copyPathTo")) fieldPatch[fieldId] = imagePath;
  for (const [fieldId, sampleKey] of Object.entries(stringMap(options, "fieldMap"))) {
    if (sampleKey in sampled) fieldPatch[fieldId] = sampled[sampleKey];
  }
  const paletteHexes = Array.isArray(sampled.paletteHexes)
    ? sampled.paletteHexes.filter((value): value is string => typeof value === "string")
    : [];
  return {
    selected: true,
    imagePath,
    paletteHexes,
    fieldPatch,
    message: "Sampled image palette."
  };
}

function popoutPaletteAssignments(
  payload: Readonly<Record<string, JsonValue>>
): ProgramPopoutPaletteAssignment[] {
  if (!Array.isArray(payload.assignments)) {
    throw new Error("Popped Button palette apply requires assignments.");
  }
  return payload.assignments.map((entry, index) => {
    const assignment = objectValue(entry, `Popped Button assignment ${index + 1}`);
    const placementId = stringValue(assignment, "placementId");
    const colorValue = assignment.color;
    const color = colorValue === undefined || colorValue === null
      ? null
      : typeof colorValue === "string"
        ? colorValue.trim()
        : "";
    if (!placementId || color === "") {
      throw new Error(`Popped Button assignment ${index + 1} is incomplete.`);
    }
    return { placementId, color };
  });
}

function popoutPaletteGradient(
  payload: Readonly<Record<string, JsonValue>>
): { gradient: ProgramPopoutPaletteGradient; screenTopToBottom: boolean } {
  return {
    gradient: {
      colors: Array.isArray(payload.colors)
        ? payload.colors.map((color) => typeof color === "string" ? color.trim() : "")
        : [],
      spread: numberValue(payload, "spread", Number.NaN),
      scatter: numberValue(payload, "scatter", Number.NaN),
      seed: numberValue(payload, "seed", Number.NaN)
    },
    screenTopToBottom: payload.screenTopToBottom === true
  };
}

function popoutPaletteResponse(
  scan: ProgramPopoutPaletteScan,
  revision: number,
  message: string,
  changedCount = 0,
  warnings: readonly string[] = []
): Record<string, JsonValue> {
  return {
    placements: scan.placements.map(({ placementId, color, materialColors = [] }) => ({
      placementId,
      ...(color ? { color } : {}),
      materialColors
    })),
    revision,
    buttonCount: scan.buttonCount,
    colorCount: scan.colorCount,
    changedCount,
    message: `${message}${warnings.length ? ` ${warnings.join(" ")}` : ""}`
  };
}

interface LiveProgramPopoutPaletteGroup {
  backingId: string;
  draftSessionId?: string;
  document: ButtonStateDocument;
  targets: ProgramPopoutPaletteTarget[];
}

interface LiveProgramPopoutPaletteScope {
  groups: LiveProgramPopoutPaletteGroup[];
  windowCount: number;
  screenPositions: ProgramPopoutPaletteGradientItem[] | null;
}

interface LiveProgramPopoutPaletteApplyResult {
  scope: LiveProgramPopoutPaletteScope;
  changedCount: number;
  changedCountByBackingId: Map<string, number>;
}

interface RememberedPopoutPaletteScan {
  revision: number;
  fingerprint: string;
}

const rememberedPopoutPaletteScans = new Map<string, RememberedPopoutPaletteScan>();
let lastPopoutPaletteRevision = Date.now();

function programNamesMatch(left: string | undefined, right: string): boolean {
  return (left ?? "").trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function popoutPaletteIdentityKey(identity: InstalledPageCoreIdentity): string {
  return JSON.stringify([identity.ownerButtonId, identity.pageId]);
}

function rememberPopoutPaletteScan(
  identity: InstalledPageCoreIdentity,
  fingerprint: string
): number {
  lastPopoutPaletteRevision = Math.max(Date.now(), lastPopoutPaletteRevision + 1);
  rememberedPopoutPaletteScans.set(popoutPaletteIdentityKey(identity), {
    revision: lastPopoutPaletteRevision,
    fingerprint
  });
  return lastPopoutPaletteRevision;
}

function assertRememberedPopoutPaletteScan(
  identity: InstalledPageCoreIdentity,
  expectedRevision: number,
  fingerprint: string
): void {
  const remembered = rememberedPopoutPaletteScans.get(popoutPaletteIdentityKey(identity));
  if (
    !Number.isSafeInteger(expectedRevision) ||
    !remembered ||
    remembered.revision !== expectedRevision ||
    remembered.fingerprint !== fingerprint
  ) {
    throw new Error("Popped Button colors changed after the last scan. Press Rescan and try again.");
  }
}

function requestLiveButtonDraft(
  sessionId: string,
  requesterLabel: string
): Promise<ButtonStateDocument> {
  const requestId = createButtonDraftRequestId(requesterLabel);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    let timeoutId: number | undefined;
    const cleanup = () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      unlisten?.();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const accept = (document: ButtonStateDocument) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(document);
    };
    void subscribeButtonDrafts(sessionId, accept, { requesterLabel, requestId })
      .then((stopListening) => {
        if (settled) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        timeoutId = window.setTimeout(() => {
          fail(new Error("An open Blender Pop-out stopped responding. Close it or reopen it, then press Rescan."));
        }, 2000);
        void requestButtonDraft(sessionId, requesterLabel, requestId).catch(fail);
      })
      .catch(fail);
  });
}

function expandedPopoutPlacementIds(
  document: ButtonStateDocument,
  popoutUnitId: string
): string[] {
  const unit = document.popoutUnits[popoutUnitId];
  if (!unit) {
    throw new Error("An open Blender Pop-out no longer has a live Button definition. Reopen it and press Rescan.");
  }
  const surface = document.surfaces[unit.surfaceId];
  if (!surface) {
    throw new Error("An open Blender Pop-out no longer has a live Button surface. Reopen it and press Rescan.");
  }
  const placementIds = expandedButtonPopoutPlacementIds(document, unit);
  const seen = new Set<string>();
  return placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    if (!placement || placement.surfaceId !== unit.surfaceId || seen.has(placementId)) {
      throw new Error("An open Blender Pop-out has stale Button placements. Reopen it and press Rescan.");
    }
    seen.add(placementId);
    return [placementId];
  });
}

function expandedFanPlacementIds(
  document: ButtonStateDocument,
  fanSetupId: string,
  programName: string
): string[] {
  const setup = document.fanSetups[fanSetupId];
  if (!setup || !programNamesMatch(setup.programName, programName)) {
    throw new Error("An open Blender Fan no longer has a live Button definition. Reopen it and press Rescan.");
  }
  const surface = document.surfaces[setup.fanSurfaceId];
  const ownerPlacement = resolvePanelOwnerFanPlacement(document, setup.id);
  if (!surface || surface.kind !== "fan" || !ownerPlacement) {
    throw new Error("An open Blender Fan no longer has a live Button surface. Reopen it and press Rescan.");
  }
  const expectedPlacementIds = new Set([
    ownerPlacement.id,
    ...setup.fanMemberPlacementIds
  ]);
  if (
    expectedPlacementIds.size !== surface.placementIds.length ||
    surface.placementIds.some((placementId) => !expectedPlacementIds.has(placementId))
  ) {
    throw new Error("An open Blender Fan has stale Button placements. Reopen it and press Rescan.");
  }
  const seen = new Set<string>();
  return surface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    if (!placement || placement.surfaceId !== surface.id || seen.has(placementId)) {
      throw new Error("An open Blender Fan has stale Button placements. Reopen it and press Rescan.");
    }
    seen.add(placementId);
    return [placementId];
  });
}

function flowCellBoundsFromDesktopBounds(
  bounds: { left: number; top: number; width: number; height: number } | null | undefined
): FlowCellBounds | null {
  if (
    !bounds ||
    ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return null;
  }
  return {
    Left: bounds.left,
    Top: bounds.top,
    Width: bounds.width,
    Height: bounds.height
  };
}

function usableFlowCellBounds(bounds: FlowCellBounds | null | undefined): bounds is FlowCellBounds {
  return Boolean(
    bounds &&
    [bounds.Left, bounds.Top, bounds.Width, bounds.Height].every(Number.isFinite) &&
    bounds.Width > 0 &&
    bounds.Height > 0
  );
}

type LiveProgramPopoutPaletteCandidate = {
  windowLabel: string;
  windowKind: "button-popout";
  popoutUnitId: string;
  displayMode: "collapsed" | "expanded";
  draftSessionId?: string;
  snapshotBounds?: FlowCellBounds;
} | {
  windowLabel: string;
  windowKind: "button-fan";
  fanSetupId: string;
  draftSessionId?: undefined;
  snapshotBounds?: FlowCellBounds;
};

async function liveProgramPopoutPaletteScope(
  current: ButtonStateDocument,
  programName: string,
  screenTopToBottom = false
): Promise<LiveProgramPopoutPaletteScope> {
  const handles = (await WebviewWindow.getAll()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
  const candidates: LiveProgramPopoutPaletteCandidate[] = [];
  for (const handle of handles) {
    const registered = readRegisteredLayoutWindow(handle.label);
    if (
      !registered ||
      !programNamesMatch(registered.programName, programName) ||
      (registered.kind !== "button-popout" && registered.kind !== "button-fan")
    ) {
      continue;
    }
    const [visible, minimized] = await Promise.all([
      handle.isVisible().catch(() => false),
      handle.isMinimized().catch(() => false)
    ]);
    if (!visible || minimized) continue;
    if (registered.kind === "button-popout") {
      const popoutUnitId = registered.buttonPopoutUnitId?.trim();
      const displayMode = registered.buttonDisplayMode;
      if (!popoutUnitId || (displayMode !== "collapsed" && displayMode !== "expanded")) {
        throw new Error("An open Blender Pop-out is missing its live Button identity. Reopen it and press Rescan.");
      }
      const draftSessionId = registered.buttonDraftSessionId?.trim();
      if (draftSessionId && !registered.buttonPopoutSettingsPath?.trim()) {
        continue;
      }
      if (!draftSessionId && registered.buttonPopoutSettingsPath?.trim()) {
        throw new Error("An open Blender Pop-out lost its live settings session. Reopen it and press Rescan.");
      }
      candidates.push({
        windowLabel: handle.label,
        windowKind: "button-popout",
        popoutUnitId,
        displayMode,
        draftSessionId,
        snapshotBounds: registered.snapshotBounds
      });
      continue;
    }

    if (registered.buttonDraftSessionId?.trim()) {
      continue;
    }
    const fanSetupId = registered.buttonFanSetupId?.trim();
    if (!fanSetupId) {
      throw new Error("An open Blender Fan is missing its live Button identity. Reopen it and press Rescan.");
    }
    candidates.push({
      windowLabel: handle.label,
      windowKind: "button-fan",
      fanSetupId,
      snapshotBounds: registered.snapshotBounds
    });
  }

  const requesterLabel = getCurrentWindow().label;
  const draftDocuments = new Map<string, ButtonStateDocument>();
  await Promise.all([...new Set(candidates.flatMap(({ draftSessionId }) =>
    draftSessionId ? [draftSessionId] : []
  ))].map(async (sessionId) => {
    draftDocuments.set(sessionId, await requestLiveButtonDraft(sessionId, requesterLabel));
  }));

  const groups = new Map<string, LiveProgramPopoutPaletteGroup>();
  const screenPositions: ProgramPopoutPaletteGradientItem[] = [];
  let windowCount = 0;
  for (const candidate of candidates) {
    const document = candidate.draftSessionId
      ? draftDocuments.get(candidate.draftSessionId)
      : current;
    if (!document) {
      throw new Error("An open Blender popped Button session could not be read. Reopen it and press Rescan.");
    }
    const popoutUnit = candidate.windowKind === "button-popout"
      ? document.popoutUnits[candidate.popoutUnitId]
      : null;
    if (candidate.windowKind === "button-popout") {
      if (!popoutUnit) {
        throw new Error(
          "An open Blender Pop-out no longer has a live Button definition. Reopen it and press Rescan."
        );
      }
      if (candidate.displayMode === "collapsed" && popoutUnit.interactionMode !== "fan") {
        continue;
      }
    }
    const placementIds = candidate.windowKind === "button-popout"
      ? expandedPopoutPlacementIds(document, candidate.popoutUnitId)
      : expandedFanPlacementIds(document, candidate.fanSetupId, programName);
    windowCount += 1;
    const backingId = candidate.draftSessionId
      ? `draft:${candidate.draftSessionId}`
      : "canonical";
    let group = groups.get(backingId);
    if (!group) {
      group = {
        backingId,
        draftSessionId: candidate.draftSessionId,
        document,
        targets: []
      };
      groups.set(backingId, group);
    }
    const targets = placementIds.map(
      (placementId): ProgramPopoutPaletteTarget => ({
        paletteId: JSON.stringify([candidate.windowLabel, placementId]),
        placementId
      })
    );
    group.targets.push(...targets);
    if (screenTopToBottom && targets.length > 0) {
      let visibleBounds: FlowCellBounds | null = null;
      let envelope: { y: number; height: number } | null = null;
      const items = programPopoutPaletteTargetPositions(document, programName, targets);
      if (candidate.windowKind === "button-popout") {
        const unit = popoutUnit;
        if (!unit) {
          throw new Error(
            "An open Blender Pop-out no longer has live screen-gradient geometry. Reopen it and press Rescan."
          );
        }
        if (candidate.displayMode === "collapsed") {
          throw new Error(
            "Expand this Blender Fan while applying Screen Top-to-Bottom so its live Button positions are available."
          );
        } else {
          visibleBounds = candidate.snapshotBounds ?? flowCellBoundsFromDesktopBounds(unit.desktopBounds);
          envelope = unit.desktopBoundsEnvelope ?? unit.canonicalBounds;
        }
      } else {
        const setup = document.fanSetups[candidate.fanSetupId];
        const ownerPlacement = setup
          ? resolvePanelOwnerFanPlacement(document, setup.id)
          : null;
        const collapsedEnvelope = setup?.collapsedBoundsEnvelope;
        if (!setup || !ownerPlacement || !collapsedEnvelope) {
          throw new Error(
            "An open Blender Fan is missing live screen-gradient geometry. Reopen it and press Rescan."
          );
        }
        visibleBounds = candidate.snapshotBounds ?? null;
        envelope = {
          y: ownerPlacement.y + collapsedEnvelope.y,
          height: collapsedEnvelope.height
        };
      }
      if (!usableFlowCellBounds(visibleBounds) || !envelope) {
        throw new Error(
          "An open Blender popped Button window is missing live screen-gradient bounds. Reopen it and press Rescan."
        );
      }
      const monitor = await monitorFromPoint(
        visibleBounds.Left + visibleBounds.Width / 2,
        visibleBounds.Top + visibleBounds.Height / 2
      ).catch(() => null);
      if (!monitor) {
        throw new Error(
          "An open Blender popped Button window's screen could not be resolved. Reopen it and press Rescan."
        );
      }
      try {
        screenPositions.push(...programPopoutPaletteScreenPositions({
          items,
          visibleBounds,
          envelope,
          monitorWorkArea: {
            Top: monitor.workArea.position.y,
            Height: monitor.workArea.size.height
          }
        }));
      } catch {
        throw new Error(
          "An open Blender popped Button window has invalid screen-gradient geometry. Reopen it and press Rescan."
        );
      }
    }
  }
  return {
    groups: [...groups.values()].sort((left, right) => left.backingId.localeCompare(right.backingId)),
    windowCount,
    screenPositions: screenTopToBottom ? screenPositions : null
  };
}

function scanLiveProgramPopoutPalette(
  scope: LiveProgramPopoutPaletteScope,
  programName: string
): ProgramPopoutPaletteScan {
  const placements = scope.groups.flatMap((group) =>
    scanProgramPopoutPaletteTargets(group.document, programName, group.targets).placements
  );
  const colors = new Set(placements.flatMap(({ color, materialColors = [] }) =>
    color ? [color] : materialColors
  ));
  return { placements, buttonCount: placements.length, colorCount: colors.size };
}

function liveProgramPopoutPaletteFingerprint(
  scope: LiveProgramPopoutPaletteScope,
  programName: string
): string {
  return JSON.stringify({
    windowCount: scope.windowCount,
    groups: scope.groups.map((group) => {
    const scanByPaletteId = new Map(
      scanProgramPopoutPaletteTargets(group.document, programName, group.targets)
        .placements.map((entry) => [entry.placementId, entry])
    );
    return {
      backingId: group.backingId,
      revision: group.document.revision,
      targets: [...group.targets]
        .sort((left, right) => left.paletteId.localeCompare(right.paletteId))
        .map((target) => {
          const placement = group.document.placements[target.placementId];
          const scan = scanByPaletteId.get(target.paletteId);
          return {
            paletteId: target.paletteId,
            placementId: target.placementId,
            buttonId: placement?.buttonId ?? "",
            surfaceId: placement?.surfaceId ?? "",
            skinOverrideId: placement?.skinOverrideId ?? null,
            x: placement?.x ?? null,
            y: placement?.y ?? null,
            width: placement?.width ?? null,
            height: placement?.height ?? null,
            color: scan?.color ?? null,
            materialColors: scan?.materialColors ?? []
          };
        })
      };
    })
  });
}

function applyLiveProgramPopoutPalette(
  scope: LiveProgramPopoutPaletteScope,
  programName: string,
  assignments: readonly ProgramPopoutPaletteAssignment[]
): LiveProgramPopoutPaletteApplyResult {
  const groupByPaletteId = new Map<string, LiveProgramPopoutPaletteGroup>();
  for (const group of scope.groups) {
    for (const target of group.targets) {
      if (groupByPaletteId.has(target.paletteId)) {
        throw new Error("Popped Button colors are stale. Press Rescan and try again.");
      }
      groupByPaletteId.set(target.paletteId, group);
    }
  }
  const assignmentByPaletteId = new Map<string, ProgramPopoutPaletteAssignment>();
  for (const assignment of assignments) {
    if (
      !groupByPaletteId.has(assignment.placementId) ||
      assignmentByPaletteId.has(assignment.placementId)
    ) {
      throw new Error("Popped Button colors are stale. Press Rescan and try again.");
    }
    assignmentByPaletteId.set(assignment.placementId, assignment);
  }
  if (assignmentByPaletteId.size !== groupByPaletteId.size) {
    throw new Error("Popped Button colors are stale. Press Rescan and try again.");
  }

  const changedCountByBackingId = new Map<string, number>();
  let changedCount = 0;
  const groups = scope.groups.map((group): LiveProgramPopoutPaletteGroup => {
    const result = applyProgramPopoutPaletteTargets(
      group.document,
      programName,
      group.targets,
      group.targets.map(({ paletteId }) => assignmentByPaletteId.get(paletteId)!)
    );
    changedCount += result.changedCount;
    changedCountByBackingId.set(group.backingId, result.changedCount);
    return { ...group, document: result.document };
  });
  return {
    scope: { ...scope, groups },
    changedCount,
    changedCountByBackingId
  };
}

function nextLiveProgramPopoutTextColor(
  scope: LiveProgramPopoutPaletteScope,
  programName: string
): ProgramPopoutTextColor {
  const hasTargets = scope.groups.some((group) => group.targets.length > 0);
  const allBlack = hasTargets && scope.groups.every((group) =>
    programPopoutPaletteTargetsHaveTextColor(
      group.document,
      programName,
      group.targets,
      "#000000"
    )
  );
  return allBlack ? "#FFFFFF" : "#000000";
}

function applyLiveProgramPopoutTextColor(
  scope: LiveProgramPopoutPaletteScope,
  programName: string,
  textColor: ProgramPopoutTextColor
): LiveProgramPopoutPaletteApplyResult {
  const changedCountByBackingId = new Map<string, number>();
  let changedCount = 0;
  const groups = scope.groups.map((group): LiveProgramPopoutPaletteGroup => {
    const result = applyProgramPopoutTextColorTargets(
      group.document,
      programName,
      group.targets,
      textColor
    );
    changedCount += result.changedCount;
    changedCountByBackingId.set(group.backingId, result.changedCount);
    return { ...group, document: result.document };
  });
  return {
    scope: { ...scope, groups },
    changedCount,
    changedCountByBackingId
  };
}

function refillLiveProgramPopoutPalette(
  scope: LiveProgramPopoutPaletteScope,
  programName: string,
  gradient: ProgramPopoutPaletteGradient,
  screenTopToBottom: boolean
): LiveProgramPopoutPaletteApplyResult {
  const positions = screenTopToBottom
    ? scope.screenPositions
    : scope.groups.flatMap((group) =>
        programPopoutPaletteTargetPositions(group.document, programName, group.targets)
      );
  if (!positions) {
    throw new Error("Popped Button screen-gradient positions are unavailable. Reopen the Pop-out or Fan windows and try again.");
  }
  return applyLiveProgramPopoutPalette(
    scope,
    programName,
    gradientProgramPopoutPaletteAssignments(
      positions,
      gradient,
      screenTopToBottom ? { minimumY: 0, maximumY: 1 } : undefined
    )
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

async function commitLiveProgramPopoutPalette(
  current: ButtonStateDocument,
  result: LiveProgramPopoutPaletteApplyResult
): Promise<{ scope: LiveProgramPopoutPaletteScope; warnings: string[] }> {
  let scope = result.scope;
  const warnings: string[] = [];
  const canonicalGroup = scope.groups.find(({ backingId }) => backingId === "canonical");
  const canonicalChangedCount = result.changedCountByBackingId.get("canonical") ?? 0;
  let savedCanonical = current;
  if (canonicalGroup && canonicalChangedCount > 0) {
    const expectedSaved = cloneButtonDocument(canonicalGroup.document);
    expectedSaved.revision = current.revision + 1;
    try {
      savedCanonical = await saveButtonStateDocument(canonicalGroup.document, current.revision);
    } catch (saveError) {
      const recovered = await loadButtonStateDocument().catch(() => null);
      if (!recovered || stableJson(recovered) !== stableJson(expectedSaved)) throw saveError;
      savedCanonical = recovered;
      warnings.push(`Buttons were saved, but native cleanup reported: ${
        saveError instanceof Error ? saveError.message : String(saveError)
      }`);
    }
    scope = {
      ...scope,
      groups: scope.groups.map((group) => group.backingId === "canonical"
        ? { ...group, document: savedCanonical }
        : group)
    };
  }

  const changedDraftGroups = scope.groups.filter((group) =>
    Boolean(group.draftSessionId) &&
    (result.changedCountByBackingId.get(group.backingId) ?? 0) > 0
  );
  const draftPublishErrors: string[] = [];
  for (const group of changedDraftGroups) {
    try {
      await publishButtonDraft(group.draftSessionId!, group.document);
    } catch (error) {
      draftPublishErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (canonicalGroup && canonicalChangedCount > 0) {
    try {
      await publishButtonCommit(savedCanonical);
    } catch (publishError) {
      warnings.push(`Buttons were saved, but live updates could not be published: ${
        publishError instanceof Error ? publishError.message : String(publishError)
      }`);
    }
    for (const group of changedDraftGroups) {
      try {
        await publishButtonDraft(group.draftSessionId!, group.document);
      } catch (publishError) {
        warnings.push(`A live settings-backed Pop-out was updated, but its final repaint could not be repeated: ${
          publishError instanceof Error ? publishError.message : String(publishError)
        }`);
      }
    }
  }
  if (draftPublishErrors.length > 0) {
    throw new Error(
      `One or more open Blender Pop-outs could not be recolored: ${draftPublishErrors.join(" ")}`
    );
  }
  return { scope, warnings };
}

function popoutPaletteResultMessage(scan: ProgramPopoutPaletteScan, changedCount: number): string {
  if (scan.buttonCount === 0) return "No open Blender popped Buttons were found.";
  return changedCount === 0
    ? `No popped Button colors changed; all ${scan.buttonCount} already matched.`
    : `Changed ${changedCount} of ${scan.buttonCount} open popped Button color${changedCount === 1 ? "" : "s"}.`;
}

function popoutTextResultMessage(
  scan: ProgramPopoutPaletteScan,
  changedCount: number,
  textColor: ProgramPopoutTextColor
): string {
  if (scan.buttonCount === 0) return "No open Blender popped Buttons were found.";
  const colorName = textColor === "#000000" ? "black" : "white";
  return changedCount === 0
    ? `All ${scan.buttonCount} open popped Button texts already matched ${colorName}.`
    : `Changed ${changedCount} of ${scan.buttonCount} open popped Button text color${changedCount === 1 ? "" : "s"} to ${colorName}.`;
}

async function runButtonThemePalette(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
): Promise<Record<string, JsonValue>> {
  const operation = stringValue(options, "operation");
  const gradientRequest = operation === "refill" ? popoutPaletteGradient(payload) : null;
  const current = await loadButtonStateDocument();
  const live = await liveProgramPopoutPaletteScope(
    current,
    identity.programName,
    gradientRequest?.screenTopToBottom ?? false
  );
  if (operation === "scan") {
    const scan = scanLiveProgramPopoutPalette(live, identity.programName);
    const revision = rememberPopoutPaletteScan(
      identity,
      liveProgramPopoutPaletteFingerprint(live, identity.programName)
    );
    return popoutPaletteResponse(
      scan,
      revision,
      scan.buttonCount === 0
        ? "No open Blender popped Buttons were found."
        : `Found ${scan.colorCount} color${scan.colorCount === 1 ? "" : "s"} across ${scan.buttonCount} Button${scan.buttonCount === 1 ? "" : "s"} in ${live.windowCount} open Blender Pop-out/Fan window${live.windowCount === 1 ? "" : "s"}.`
    );
  }
  if (operation === "toggle-text") {
    const textColor = nextLiveProgramPopoutTextColor(live, identity.programName);
    const result = applyLiveProgramPopoutTextColor(live, identity.programName, textColor);
    const committed = await commitLiveProgramPopoutPalette(current, result);
    const scan = scanLiveProgramPopoutPalette(committed.scope, identity.programName);
    const revision = rememberPopoutPaletteScan(
      identity,
      liveProgramPopoutPaletteFingerprint(committed.scope, identity.programName)
    );
    return popoutPaletteResponse(
      scan,
      revision,
      popoutTextResultMessage(scan, result.changedCount, textColor),
      result.changedCount,
      committed.warnings
    );
  }
  if (operation === "apply") {
    const expectedRevision = numberValue(payload, "expectedRevision", Number.NaN);
    assertRememberedPopoutPaletteScan(
      identity,
      expectedRevision,
      liveProgramPopoutPaletteFingerprint(live, identity.programName)
    );
    const result = applyLiveProgramPopoutPalette(
      live,
      identity.programName,
      popoutPaletteAssignments(payload)
    );
    const committed = await commitLiveProgramPopoutPalette(current, result);
    const scan = scanLiveProgramPopoutPalette(committed.scope, identity.programName);
    const revision = rememberPopoutPaletteScan(
      identity,
      liveProgramPopoutPaletteFingerprint(committed.scope, identity.programName)
    );
    return popoutPaletteResponse(
      scan,
      revision,
      popoutPaletteResultMessage(scan, result.changedCount),
      result.changedCount,
      committed.warnings
    );
  }
  if (operation === "refill") {
    const result = refillLiveProgramPopoutPalette(
      live,
      identity.programName,
      gradientRequest!.gradient,
      gradientRequest!.screenTopToBottom
    );
    const committed = await commitLiveProgramPopoutPalette(current, result);
    const scan = scanLiveProgramPopoutPalette(committed.scope, identity.programName);
    const revision = rememberPopoutPaletteScan(
      identity,
      liveProgramPopoutPaletteFingerprint(committed.scope, identity.programName)
    );
    return popoutPaletteResponse(
      scan,
      revision,
      popoutPaletteResultMessage(scan, result.changedCount),
      result.changedCount,
      committed.warnings
    );
  }
  throw new Error("The installed page Button-theme palette operation is unavailable.");
}

async function runSaveFields(
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const formatId = stringValue(options, "formatId");
  if (!formatId) throw new Error("The installed page field action is missing formatId.");
  const values = objectValue(payload.values, "Tool-field values");
  const sourceName = stringValue(values, stringValue(options, "sourceNameField"));
  const suggestedName = `${sourceName ? fileStem(sourceName) : stringValue(options, "defaultName", "Tool Fields")}${stringValue(options, "nameSuffix")}`;
  const path = await showSaveFileDialog({
    title: stringValue(options, "dialogTitle", "Save Tool Fields"),
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}.json`
  });
  if (!path) return { saved: false, savedPath: "", message: "Save cancelled." };
  const savedPath = await invoke<string>("save_tool_field_file", {
    formatId,
    path,
    valueFields: stringArray(options, "valueFields"),
    values
  });
  return { saved: true, savedPath, message: "Saved tool fields." };
}

async function runLoadFields(options: Readonly<Record<string, JsonValue>>) {
  const formatId = stringValue(options, "formatId");
  if (!formatId) throw new Error("The installed page field action is missing formatId.");
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Load Tool Fields"),
    filter: "JSON Files (*.json)|*.json|All Files (*.*)|*.*",
    multiselect: false
  });
  const sourcePath = paths[0]?.trim() ?? "";
  if (!sourcePath) {
    return { selected: false, fieldPatch: {}, sourcePath: "", message: "Load cancelled." };
  }
  const legacy = legacyMapping(options);
  const loaded = await invoke<LoadedToolFields>("load_tool_field_file", {
    formatId,
    path: sourcePath,
    legacyFormats: legacy.legacyFormats,
    valueFields: stringArray(options, "valueFields"),
    legacyValueKeys: Object.keys(legacy.fieldMap)
  });
  return {
    selected: true,
    fieldPatch: mappedToolPackageFields({ ...loaded, assets: {} }, legacy),
    sourcePath,
    message: "Loaded tool fields."
  };
}

async function runSavePackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const values = objectValue(payload.values, "Tool-package values");
  const contract = toolPackageIdentity(identity, options);
  const root = await invoke<string>("resolve_tool_package_root", contract);
  const sourceName = stringValue(values, stringValue(options, "sourceNameField"));
  const suggestedName = fileStem(sourceName || stringValue(options, "defaultName", "Tool Package"));
  const suffix = stringValue(options, "manifestSuffix", ".flowcell-tool-package.json");
  const selectedPath = await showSaveFileDialog({
    title: stringValue(options, "dialogTitle", "Save Tool Package"),
    filter: "Tool Package (*.json)|*.json|All Files (*.*)|*.*",
    defaultFileName: `${suggestedName}${suffix}`,
    initialDirectory: root
  });
  if (!selectedPath) {
    return {
      saved: false,
      savedPath: "",
      packagePath: "",
      packageName: "",
      message: "Save cancelled."
    };
  }
  const savedPath = await invoke<string>("save_tool_package", {
    ...contract,
    manifestPath: selectedPath,
    manifestSuffix: suffix,
    valueFields: stringArray(options, "valueFields"),
    assetFields: stringArray(options, "assetFields"),
    values
  });
  activeToolPackagePaths.set(packageKey(identity, options), savedPath);
  return {
    saved: true,
    savedPath,
    packagePath: savedPath,
    packageName: suggestedName,
    message: `Saved ${suggestedName}.`
  };
}

async function runOpenPackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>
) {
  const root = await invoke<string>("resolve_tool_package_root", toolPackageIdentity(identity, options));
  const suffix = stringValue(options, "manifestSuffix", ".flowcell-tool-package.json");
  const paths = await showOpenFileDialog({
    title: stringValue(options, "dialogTitle", "Open Tool Package"),
    filter: `Tool Package (*${suffix})|*${suffix}|JSON Files (*.json)|*.json|All Files (*.*)|*.*`,
    initialDirectory: root,
    multiselect: false
  });
  const selectedPath = paths[0]?.trim() ?? "";
  return selectedPath
    ? loadPackageAtPath(identity, options, selectedPath)
    : { selected: false, fieldPatch: {}, packagePath: "", packageName: "", message: "Open cancelled." };
}

async function runCyclePackage(
  identity: InstalledPageCoreIdentity,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const entries = await invoke<ToolPackageEntry[]>("list_tool_packages", {
    ...toolPackageIdentity(identity, options),
    manifestSuffix: stringValue(options, "manifestSuffix", ".flowcell-tool-package.json")
  });
  if (entries.length === 0) throw new Error("No saved tool packages were found.");
  const direction = numberValue(options, "direction", 1) < 0 ? -1 : 1;
  const activePath = stringValue(payload, "activePackagePath") ||
    activeToolPackagePaths.get(packageKey(identity, options)) ||
    "";
  const activeIndex = entries.findIndex((entry) => entry.manifestPath === activePath);
  const startIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + entries.length) % entries.length;
  return loadPackageAtPath(identity, options, entries[nextIndex].manifestPath);
}

function isButtonRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Button state changed before Save.");
}

async function generatedOwnerButtonId(
  identity: InstalledPageCoreIdentity,
  packageId: string
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Generated Button identity requires Web Crypto support.");
  }
  const identityKey = [
    "flowcell-installed-page-generated-button-v1",
    identity.programName.toLocaleLowerCase("en"),
    identity.pageId.toLocaleLowerCase("en"),
    packageId.toLocaleLowerCase("en")
  ].join("\u0000");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(identityKey));
  const digestHex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `button-generated-${digestHex.slice(0, 32)}`;
}

function mergeGeneratedInstallIntoDocument(
  base: Awaited<ReturnType<typeof loadButtonStateDocument>>,
  installed: Awaited<ReturnType<typeof installButtonSource>>
) {
  if (!base.buttons[installed.ownerButtonId]) {
    return mergeLegacyInstallsIntoDocument(base, [installed]);
  }
  const next = cloneButtonDocument(base);
  applyInstalledSourceUpdate(next, installed);
  return next;
}

async function runInstallGeneratedButton(
  identity: InstalledPageCoreIdentity,
  actionId: string,
  options: Readonly<Record<string, JsonValue>>,
  payload: Readonly<Record<string, JsonValue>>
) {
  const programName = stringValue(options, "programName");
  const importKind = stringValue(options, "importKind");
  const panelName = stringValue(payload, "panelName");
  const stageToken = stringValue(payload, "stageToken");
  const stagedSourcePath = stringValue(payload, "stagedSourcePath");
  if (!programName || programName.toLocaleLowerCase("en") !== identity.programName.toLocaleLowerCase("en")) {
    throw new Error("Generated Button program must match the installed page owner program.");
  }
  if (importKind !== "script") {
    throw new Error("Generated page Buttons must use the ordinary script source lifecycle.");
  }
  if (!panelName || !stageToken || !stagedSourcePath) {
    throw new Error(
      "Generated Button installation requires a destination panel, stage token, and staged manifest."
    );
  }
  const authorizedStage = await invoke<AuthorizedGeneratedStage>(
    "authorize_installed_page_generated_stage",
    {
      ...identity,
      actionId,
      stageToken,
      stagedSourcePath
    }
  );
  if (!authorizedStage.manifestPath || !authorizedStage.stageRoot) {
    throw new Error("Generated Button stage authorization returned an incomplete result.");
  }
  if (!authorizedStage.packageId) {
    throw new Error("Generated Button stage authorization did not return its package identity.");
  }
  const ownerButtonId = await generatedOwnerButtonId(identity, authorizedStage.packageId);
  let current = await loadButtonStateDocument();
  const existingOwner = current.buttons[ownerButtonId] ?? null;
  if (existingOwner && !existingOwner.sourceIdentity) {
    throw new Error(`Generated Button identity '${ownerButtonId}' conflicts with a non-source Button.`);
  }
  if (
    existingOwner?.sourceIdentity &&
    existingOwner.sourceIdentity.normalizedProgramName !== programName.toLocaleLowerCase("en")
  ) {
    throw new Error(`Generated Button identity '${ownerButtonId}' belongs to another program.`);
  }
  const installPanelName = existingOwner?.sourceIdentity?.displayPanelName || panelName;
  let installed: Awaited<ReturnType<typeof installButtonSource>> | null = null;
  let savedCanonical: Awaited<ReturnType<typeof saveButtonStateDocument>> | null = null;
  let committed = false;
  const resultFor = (result: Awaited<ReturnType<typeof installButtonSource>>) => ({
    installed: true,
    ownerButtonId: result.ownerButtonId,
    programName: result.sourceIdentity.displayProgramName,
    panelName: result.sourceIdentity.displayPanelName
  });
  try {
    const installGeneratedSource = existingOwner ? updateButtonSource : installButtonSource;
    installed = await installGeneratedSource({
      ownerButtonId,
      programName,
      panelName: installPanelName,
      sourcePath: authorizedStage.manifestPath,
      importKind: "script"
    });
    if (!installed.executionTarget || installed.children.length > 0) {
      throw new Error("Generated source did not install as one ordinary single-script Button.");
    }
    if (existingOwner && !installed.updateTransactionToken) {
      throw new Error("Generated Button update did not return a canonical transaction token.");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = mergeGeneratedInstallIntoDocument(current, installed);
      try {
        const saved = await saveButtonStateDocument(next, current.revision);
        savedCanonical = saved;
        if (installed.updateTransactionToken) {
          const outcome = await finalizeButtonSourceUpdate(
            installed.ownerButtonId,
            installed.updateTransactionToken
          );
          if (outcome !== "finalized") {
            throw new Error("Generated Button update rolled back after canonical Save.");
          }
        }
        committed = true;
        await publishButtonCommit(saved).catch((error) => {
          console.error("Generated Button committed but its cross-window event failed.", error);
        });
        return resultFor(installed);
      } catch (error) {
        if (attempt === 2 || !isButtonRevisionConflict(error)) throw error;
        current = await loadButtonStateDocument();
      }
    }
    throw new Error("Generated Button canonical state could not be committed.");
  } catch (error) {
    if (installed?.updateTransactionToken && !committed) {
      try {
        const outcome = await rollbackButtonSourceUpdate(
          installed.ownerButtonId,
          installed.updateTransactionToken
        );
        if (outcome === "finalized") {
          committed = true;
          const durable = savedCanonical ?? await loadButtonStateDocument();
          await publishButtonCommit(durable).catch((publishError) => {
            console.error("Generated Button committed but its cross-window event failed.", publishError);
          });
          return resultFor(installed);
        }
      } catch (rollbackError) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        throw new Error(`${originalMessage} Native update recovery also failed: ${rollbackMessage}`);
      }
    }
    if (installed && !committed && !existingOwner) {
      await uninstallButtonSource({
        ownerButtonId: installed.ownerButtonId,
        sourceIdentity: installed.sourceIdentity
      }).catch((cleanupError) => {
        console.error("Generated Button rollback could not uninstall its staged owner.", cleanupError);
      });
    }
    throw error;
  } finally {
    await invoke("discard_installed_page_generated_stage", {
      ...identity,
      actionId,
      stageToken,
      stagedSourcePath: authorizedStage.manifestPath
    }).catch((cleanupError) => {
      console.error("Generated Button staging cleanup failed.", cleanupError);
    });
  }
}

export function isInstalledPageCoreActionPlan(value: unknown): value is InstalledPageCoreActionPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "core-action" &&
    typeof record.capability === "string" &&
    Boolean(record.options) &&
    typeof record.options === "object" &&
    !Array.isArray(record.options);
}

export async function runInstalledPageCoreAction(
  identity: InstalledPageCoreIdentity,
  actionId: string,
  plan: InstalledPageCoreActionPlan
): Promise<JsonValue> {
  const options = objectValue(plan.options, "Installed page Core action options");
  const payload = objectValue(plan.payload, "Installed page Core action payload");
  switch (plan.capability) {
    case "file.select": return runFileSelect(options);
    case "folder.select": return runFolderSelect(options);
    case "image.sample-palette": return runSamplePalette(options, payload);
    case "button-theme.palette": return runButtonThemePalette(identity, options, payload);
    case "tool-fields.save": return runSaveFields(options, payload);
    case "tool-fields.load": return runLoadFields(options);
    case "tool-package.save": return runSavePackage(identity, options, payload);
    case "tool-package.open": return runOpenPackage(identity, options);
    case "tool-package.cycle": return runCyclePackage(identity, options, payload);
    case "button.install-generated":
      return runInstallGeneratedButton(identity, actionId, options, payload);
    default:
      throw new Error(`Installed page Core capability '${plan.capability}' is unavailable.`);
  }
}
