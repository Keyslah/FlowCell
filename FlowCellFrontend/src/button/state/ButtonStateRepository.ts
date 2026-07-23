import { invoke } from "@tauri-apps/api/core";
import type {
  ButtonExecutionTarget,
  ButtonPlacement,
  ButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ButtonSurface,
  ButtonToolField,
  ButtonToolSetChildBehavior,
  ButtonRect
} from "../types.js";
import {
  DEFAULT_BUTTON_SURFACE_ID,
  createButtonStateDocument,
  cloneButtonDocument
} from "./buttonDefaults.js";
import {
  buttonRectsOverlap,
  createStarterButtonLayout
} from "../geometry/buttonGeometry.js";
import {
  normalizeLoadedButtonStateDocument,
  parseButtonStateDocumentJson,
  validateButtonStateDocument
} from "./buttonStateValidation.js";
import { createButtonSourceIdentity } from "./sourceIdentity.js";
import { applyInstalledSourceUpdate } from "./sourceUpdateOperations.js";
import {
  validateButtonPlacementFile,
  type ButtonPlacementFile
} from "./buttonPlacementFile.js";

export interface InstalledButtonChildResult {
  slot: string;
  label: string;
  tooltip?: string;
  executionTarget: ButtonExecutionTarget;
}

export interface InstalledButtonLayout {
  width?: number;
  height?: number;
  placements?: Record<string, ButtonRect>;
  fields?: ButtonToolField[];
  childBehaviors?: Record<string, ButtonToolSetChildBehavior>;
  updatePolicy?: {
    appendMissingChildSlots?: boolean;
  };
}

export interface InstallButtonSourceResult {
  ownerButtonId: string;
  sourceIdentity: ButtonSourceIdentity;
  executionTarget: ButtonExecutionTarget | null;
  label: string;
  tooltip: string;
  children: InstalledButtonChildResult[];
  layout?: InstalledButtonLayout;
}

export interface InstallButtonSourceRequest {
  ownerButtonId: string;
  programName: string;
  panelName: string;
  sourcePath: string;
  importKind: "script" | "tool-set" | "auto";
}

interface LegacyButtonBootstrapResult {
  migrationToken: string;
  installs: Record<string, unknown>[];
}

interface BundledProgramSourceSyncEntry {
  programName: string;
  bundledSourceId: string;
  status: "current" | "updated" | "installed" | "not-installed" | "failed";
  message: string;
  descriptor?: Record<string, unknown>;
}

interface BundledProgramSourceSyncResponse {
  sources: BundledProgramSourceSyncEntry[];
}

export interface SynchronizeBundledButtonSourcesOptions {
  includeStarters?: boolean;
  programName?: string;
}

function isTauriWindowHost(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Early documents stamped collapsedPanelOwnerBounds with a {left: 0, top: 0}
// placeholder at fan creation, which force-placed the fan window at the
// desktop origin. A dragged anchor never lands at exactly (0,0), so treat it
// as "never anchored" and let the fan window fall back to a visible default.
function stripPlaceholderFanAnchors(document: ButtonStateDocument): ButtonStateDocument {
  for (const setup of Object.values(document.fanSetups)) {
    const bounds = setup.collapsedPanelOwnerBounds;
    if (bounds && bounds.left === 0 && bounds.top === 0) {
      delete setup.collapsedPanelOwnerBounds;
    }
  }
  return document;
}

function parseLoadedDocument(value: unknown): ButtonStateDocument {
  if (value === null || value === undefined || value === "") {
    return createButtonStateDocument();
  }
  const result = typeof value === "string"
    ? parseButtonStateDocumentJson(value)
    : validateButtonStateDocument(normalizeLoadedButtonStateDocument(
        typeof value === "object" && value && "document" in value
          ? (value as { document: unknown }).document
          : value
      ));
  if (!result.structurallyValid || !result.document) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }
  return stripPlaceholderFanAnchors(cloneButtonDocument(result.document));
}

export function buttonStateDocumentsEqual(
  left: ButtonStateDocument,
  right: ButtonStateDocument
): boolean {
  const valuesEqual = (leftValue: unknown, rightValue: unknown): boolean => {
    if (leftValue === rightValue) return true;
    if (
      !leftValue ||
      !rightValue ||
      typeof leftValue !== "object" ||
      typeof rightValue !== "object"
    ) {
      return false;
    }
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      return Boolean(
        Array.isArray(leftValue) &&
        Array.isArray(rightValue) &&
        leftValue.length === rightValue.length &&
        leftValue.every((value, index) => valuesEqual(value, rightValue[index]))
      );
    }
    const leftRecord = leftValue as Record<string, unknown>;
    const rightRecord = rightValue as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return Boolean(
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key])
      )
    );
  };
  return valuesEqual(left, right);
}

interface ButtonStateSnapshotLoad {
  generation: number;
  promise: Promise<ButtonStateDocument>;
}

export interface ButtonStateBootstrapResult {
  document: ButtonStateDocument;
  changed: boolean;
}

let buttonStateSnapshotGeneration = 0;
let buttonStateSnapshotLoadInFlight: ButtonStateSnapshotLoad | null = null;
let buttonStateBootstrapPromise: Promise<ButtonStateBootstrapResult> | null = null;

async function loadButtonStateSnapshotInner(): Promise<ButtonStateDocument> {
  if (!isTauriWindowHost()) return createButtonStateDocument();
  const response = await invoke<unknown>("load_button_state");
  return parseLoadedDocument(response);
}

/**
 * Reads the recovered canonical document without running source migration or
 * bundled-program synchronization. All secondary windows use this path so a
 * render-time state read cannot mutate global Button state.
 */
export async function loadButtonStateDocument(): Promise<ButtonStateDocument> {
  const generation = buttonStateSnapshotGeneration;
  if (
    !buttonStateSnapshotLoadInFlight ||
    buttonStateSnapshotLoadInFlight.generation !== generation
  ) {
    buttonStateSnapshotLoadInFlight = {
      generation,
      promise: loadButtonStateSnapshotInner()
    };
  }
  const pendingLoad = buttonStateSnapshotLoadInFlight;
  try {
    return cloneButtonDocument(await pendingLoad.promise);
  } finally {
    if (buttonStateSnapshotLoadInFlight === pendingLoad) {
      buttonStateSnapshotLoadInFlight = null;
    }
  }
}

async function bootstrapButtonStateDocumentInner(): Promise<ButtonStateBootstrapResult> {
  if (!isTauriWindowHost()) {
    return { document: createButtonStateDocument(), changed: false };
  }
  const bootstrap = await invoke<LegacyButtonBootstrapResult | null>(
    "prepare_legacy_button_bootstrap"
  );
  let response = await invoke<unknown>("load_button_state");
  let document = parseLoadedDocument(response);
  const initialRevision = document.revision;
  const finishBootstrap = async (
    candidate: ButtonStateDocument
  ): Promise<ButtonStateBootstrapResult> => {
    const synchronized = await synchronizeBundledButtonSources(candidate);
    return {
      document: synchronized,
      changed: synchronized.revision !== initialRevision
    };
  };
  if (!bootstrap) return finishBootstrap(document);

  const installs = bootstrap.installs.map(normalizeLegacyInstallResult);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (installs.every((install) => migrationInstallIsRepresented(document, install))) {
      return finishBootstrap(document);
    }
    const migrated = mergeLegacyInstallsIntoDocument(document, installs);
    try {
      return finishBootstrap(await saveButtonStateDocument(
        migrated,
        document.revision,
        [],
        bootstrap.migrationToken
      ));
    } catch (error) {
      response = await invoke<unknown>("load_button_state");
      const latest = parseLoadedDocument(response);
      if (installs.every((install) => migrationInstallIsRepresented(latest, install))) {
        return finishBootstrap(latest);
      }
      if (attempt === 0 && latest.revision !== document.revision) {
        document = latest;
        continue;
      }
      throw error;
    }
  }
  return finishBootstrap(document);
}

/** Runs legacy migration and bundled-source synchronization once from Main. */
export async function bootstrapButtonStateDocument(): Promise<ButtonStateBootstrapResult> {
  if (!buttonStateBootstrapPromise) {
    buttonStateBootstrapPromise = (async () => {
      try {
        const result = await bootstrapButtonStateDocumentInner();
        if (isTauriWindowHost()) {
          await invoke("set_button_bootstrap_failure", { message: null }).catch(() => {});
        }
        return result;
      } catch (error) {
        buttonStateBootstrapPromise = null;
        if (isTauriWindowHost()) {
          const message = error instanceof Error ? error.message : String(error);
          await invoke("set_button_bootstrap_failure", { message }).catch(() => {});
        }
        throw error;
      }
    })();
  }
  const result = await buttonStateBootstrapPromise;
  return {
    document: cloneButtonDocument(result.document),
    changed: result.changed
  };
}

export async function saveButtonStateDocument(
  document: ButtonStateDocument,
  expectedRevision: number,
  uninstallOwnerButtonIds: readonly string[] = [],
  migrationToken?: string,
  programRenameToken?: string
): Promise<ButtonStateDocument> {
  const next = cloneButtonDocument(document);
  next.revision = expectedRevision + 1;
  const validation = validateButtonStateDocument(next);
  if (!validation.valid) {
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  }
  if (!isTauriWindowHost()) return next;
  buttonStateSnapshotGeneration += 1;
  let response: unknown;
  try {
    response = await invoke<unknown>("commit_button_state", {
      request: {
        document: next,
        expectedRevision,
        uninstallOwnerButtonIds: [...uninstallOwnerButtonIds],
        migrationToken,
        programRenameToken
      }
    });
  } finally {
    // A native commit can report a post-commit cleanup error after canonical
    // state was already persisted, so every attempt invalidates snapshot reads.
    buttonStateSnapshotGeneration += 1;
  }
  if (response === null || response === undefined) return next;
  if (typeof response === "number") return { ...next, revision: response };
  return parseLoadedDocument(response);
}

export async function saveButtonPlacementFile(
  path: string,
  file: ButtonPlacementFile
): Promise<string> {
  const validation = validateButtonPlacementFile(file);
  if (!validation.valid) {
    throw new Error(validation.issues.join("\n"));
  }
  if (!isTauriWindowHost()) {
    throw new Error("Button placement files can only be saved from the FlowCell desktop host.");
  }
  return invoke<string>("save_button_placement_file", { path, file });
}

export async function getButtonEditorDirectory(): Promise<string> {
  if (!isTauriWindowHost()) {
    throw new Error("The Button editor directory is only available from the FlowCell desktop host.");
  }
  return invoke<string>("get_button_editor_directory");
}

export async function loadButtonPlacementFile(path: string): Promise<ButtonPlacementFile> {
  if (!path.trim()) throw new Error("Button placement load path cannot be empty.");
  if (!isTauriWindowHost()) {
    throw new Error("Button placement files can only be loaded from the FlowCell desktop host.");
  }
  const file = await invoke<unknown>("load_button_placement_file", { path });
  const validation = validateButtonPlacementFile(file);
  if (!validation.valid) {
    throw new Error(validation.issues.join("\n"));
  }
  return file as ButtonPlacementFile;
}

export async function saveButtonSkinFile(path: string, source: string): Promise<string> {
  if (!path.trim()) throw new Error("Button skin save path cannot be empty.");
  if (!source.trim()) throw new Error("Button skin source cannot be empty.");
  if (!isTauriWindowHost()) {
    throw new Error("Button skin files can only be saved from the FlowCell desktop host.");
  }
  return invoke<string>("save_button_skin_file", { path, source });
}

function normalizeInstallResult(
  request: InstallButtonSourceRequest,
  response: Record<string, unknown>
): InstallButtonSourceResult {
  const rawIdentity = (response.sourceIdentity ?? {}) as Record<string, unknown>;
  const owner = (response.owner ?? {}) as Record<string, unknown>;
  const sharedEvents = response.events && typeof response.events === "object"
    ? response.events as Record<string, never>
    : undefined;
  const identity = createButtonSourceIdentity(
    String(rawIdentity.programName ?? rawIdentity.displayProgramName ?? request.programName),
    String(rawIdentity.panelName ?? rawIdentity.displayPanelName ?? request.panelName),
    String(rawIdentity.fileName ?? rawIdentity.displayFileName ?? "")
  );
  if (!identity.normalizedFileName) {
    throw new Error("The installed Button source did not return a stable file identity.");
  }
  const ownerTarget = (owner.executionTarget ?? null) as ButtonExecutionTarget | null;
  return {
    ownerButtonId: String(response.ownerButtonId ?? request.ownerButtonId),
    sourceIdentity: identity,
    executionTarget: ownerTarget && sharedEvents
      ? { ...ownerTarget, events: { ...(ownerTarget.events ?? {}), ...sharedEvents } }
      : ownerTarget,
    label: String(owner.label ?? identity.displayFileName),
    tooltip: String(owner.tooltip ?? ""),
    children: Array.isArray(response.children)
      ? response.children.map((child) => {
          const record = child as Record<string, unknown>;
          return {
            slot: String(record.slot ?? record.command ?? ""),
            label: String(record.label ?? record.slot ?? "Button"),
            tooltip: typeof record.tooltip === "string" ? record.tooltip : undefined,
            executionTarget: (() => {
              const target = (record.executionTarget ?? record.target) as ButtonExecutionTarget;
              const childEvents = record.events && typeof record.events === "object"
                ? record.events as Record<string, never>
                : sharedEvents;
              return childEvents
                ? { ...target, events: { ...(target.events ?? {}), ...childEvents } }
                : target;
            })()
          };
        })
      : [],
    layout: response.layout as InstalledButtonLayout | undefined
  };
}

export function normalizeLegacyInstallResult(
  response: Record<string, unknown>
): InstallButtonSourceResult {
  const identity = (response.sourceIdentity ?? {}) as Record<string, unknown>;
  return normalizeInstallResult(
    {
      ownerButtonId: String(response.ownerButtonId ?? ""),
      programName: String(identity.programName ?? identity.displayProgramName ?? ""),
      panelName: String(identity.panelName ?? identity.displayPanelName ?? ""),
      sourcePath: "",
      importKind: Array.isArray(response.children) && response.children.length > 0
        ? "tool-set"
        : "script"
    },
    response
  );
}

function migrationInstallIsRepresented(
  document: ButtonStateDocument,
  install: InstallButtonSourceResult
): boolean {
  const identity = document.buttons[install.ownerButtonId]?.sourceIdentity;
  return Boolean(identity &&
    identity.normalizedProgramName === install.sourceIdentity.normalizedProgramName &&
    identity.normalizedPanelName === install.sourceIdentity.normalizedPanelName &&
    identity.normalizedFileName === install.sourceIdentity.normalizedFileName);
}

function stableDocumentIdSegment(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return Array.from(normalized)
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

function createMigratedButtonRecord(args: {
  document: ButtonStateDocument;
  id: string;
  role: ButtonRecord["role"];
  label: string;
  tooltip?: string;
  sourceIdentity?: ButtonSourceIdentity;
  executionTarget?: ButtonExecutionTarget | null;
  parentId?: string;
  behavior?: ButtonToolSetChildBehavior | null;
  metadata?: ButtonRecord["metadata"];
}): ButtonRecord {
  return {
    id: args.id,
    role: args.role,
    sourceIdentity: args.sourceIdentity ?? null,
    label: args.label,
    tooltip: args.tooltip ?? "",
    executionTarget: args.executionTarget ?? null,
    defaultSkinId: args.document.settings.defaultSkinId,
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: args.parentId ?? null,
    toolSetBehavior: args.behavior ?? null,
    metadata: args.metadata ?? {}
  };
}

function ensureMigrationPanelSurface(
  document: ButtonStateDocument,
  identity: ButtonSourceIdentity
): ButtonSurface {
  const id = `surface-panel-${stableDocumentIdSegment(identity.displayProgramName)}-${stableDocumentIdSegment(identity.displayPanelName)}`;
  const existing = document.surfaces[id];
  if (existing) return existing;
  const surface: ButtonSurface = {
    id,
    name: `${identity.displayProgramName} / ${identity.displayPanelName}`,
    kind: "panel",
    width: 960,
    height: 640,
    placementIds: [],
    visualOverflowAllowance: 24,
    uniformButtonSize: null
  };
  document.surfaces[id] = surface;
  return surface;
}

function addMigratedPlacement(
  document: ButtonStateDocument,
  surface: ButtonSurface,
  buttonId: string,
  id: string,
  rect: ButtonRect
): ButtonPlacement {
  if (document.placements[id]) {
    throw new Error(`Migration placement '${id}' already exists.`);
  }
  const placement: ButtonPlacement = {
    id,
    buttonId,
    surfaceId: surface.id,
    ...rect,
    zIndex: surface.placementIds.length,
    skinOverrideId: null,
    textFitMode: document.buttons[buttonId]?.defaultTextFitMode ?? "shrink",
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
  document.placements[id] = placement;
  surface.placementIds.push(id);
  surface.width = Math.max(surface.width, rect.x + rect.width + document.settings.defaultSurfacePadding);
  surface.height = Math.max(surface.height, rect.y + rect.height + document.settings.defaultSurfacePadding);
  return placement;
}

function addMigratedSingle(
  document: ButtonStateDocument,
  install: InstallButtonSourceResult,
  panelSurface: ButtonSurface
): void {
  if (!install.executionTarget) {
    throw new Error(`Migrated script '${install.label}' has no execution target.`);
  }
  document.buttons[install.ownerButtonId] = createMigratedButtonRecord({
    document,
    id: install.ownerButtonId,
    role: "single-script",
    label: install.label,
    tooltip: install.tooltip,
    sourceIdentity: install.sourceIdentity,
    executionTarget: install.executionTarget
  });
  const rect = nextMigrationPanelRect(document, panelSurface);
  addMigratedPlacement(
    document,
    panelSurface,
    install.ownerButtonId,
    `placement-${install.ownerButtonId}`,
    rect
  );
}

function nextMigrationPanelRect(
  document: ButtonStateDocument,
  panelSurface: ButtonSurface
): ButtonRect {
  const occupied = panelSurface.placementIds.flatMap((placementId) => {
    const placement = document.placements[placementId];
    return placement ? [placement] : [];
  });
  for (let index = 0; index < occupied.length + 10_000; index += 1) {
    const candidate = {
      x: 8 + (index % 5) * 168,
      y: 8 + Math.floor(index / 5) * 52,
      width: 160,
      height: 44
    };
    if (!occupied.some((placement) => buttonRectsOverlap(candidate, placement))) {
      return candidate;
    }
  }
  throw new Error(`No free placement slot is available on '${panelSurface.name}'.`);
}

function addMigratedToolSet(
  document: ButtonStateDocument,
  install: InstallButtonSourceResult,
  panelSurface: ButtonSurface
): void {
  if (install.children.length === 0) {
    throw new Error(`Migrated tool set '${install.label}' has no child Buttons.`);
  }
  document.buttons[install.ownerButtonId] = createMigratedButtonRecord({
    document,
    id: install.ownerButtonId,
    role: "tool-set-owner",
    label: install.label,
    tooltip: install.tooltip,
    sourceIdentity: install.sourceIdentity
  });
  const ownerRect = nextMigrationPanelRect(document, panelSurface);
  addMigratedPlacement(
    document,
    panelSurface,
    install.ownerButtonId,
    `placement-${install.ownerButtonId}`,
    ownerRect
  );

  const layout = install.layout;
  const starter = createStarterButtonLayout(
    install.children.map((child) => ({ id: child.slot, width: 144, height: 42 })),
    {
      padding: document.settings.defaultSurfacePadding,
      gap: document.settings.defaultGap,
      maximumColumns: 4
    }
  );
  const childRects = install.children.map((child) =>
    layout?.placements?.[child.slot] ?? starter.rects[child.slot]
  );
  const fieldWidth = Math.max(0, ...(layout?.fields ?? []).map((field) => field.x + field.width));
  const fieldHeight = Math.max(0, ...(layout?.fields ?? []).map((field) => field.y + field.height));
  const childWidth = Math.max(0, ...childRects.map((rect) => rect.x + rect.width));
  const childHeight = Math.max(0, ...childRects.map((rect) => rect.y + rect.height));
  const surfaceId = `surface-toolset-${install.ownerButtonId}`;
  const surface: ButtonSurface = {
    id: surfaceId,
    name: `${install.label} Tool Set`,
    kind: "tool-set-popout",
    width: Math.max(240, layout?.width ?? 0, starter.requiredWidth, childWidth + 8, fieldWidth + 8),
    height: Math.max(120, layout?.height ?? 0, starter.requiredHeight, childHeight + 8, fieldHeight + 8),
    placementIds: [],
    visualOverflowAllowance: 24,
    uniformButtonSize: null
  };
  if (document.surfaces[surfaceId]) {
    throw new Error(`Migration surface '${surfaceId}' already exists.`);
  }
  document.surfaces[surfaceId] = surface;

  const childButtonIds: string[] = [];
  install.children.forEach((child, index) => {
    const childId = `button-child-${install.ownerButtonId}-${stableDocumentIdSegment(child.slot)}-${index}`;
    childButtonIds.push(childId);
    document.buttons[childId] = createMigratedButtonRecord({
      document,
      id: childId,
      role: "tool-set-child",
      label: child.label,
      tooltip: child.tooltip,
      executionTarget: child.executionTarget,
      parentId: install.ownerButtonId,
      behavior: layout?.childBehaviors?.[child.slot] ?? null,
      metadata: { toolSetSlot: child.slot }
    });
    addMigratedPlacement(
      document,
      surface,
      childId,
      `placement-${childId}`,
      childRects[index]
    );
  });
  const unitId = `popout-${install.ownerButtonId}`;
  document.popoutUnits[unitId] = {
    id: unitId,
    name: install.label,
    kind: "tool-set",
    surfaceId,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
    desktopBounds: null,
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: surface.width, height: surface.height },
    childPlacementIds: [...surface.placementIds],
    openRule: "toggle",
    closeRule: "toggle",
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    ownerButtonId: install.ownerButtonId,
    childButtonIds,
    fields: cloneButtonDocument(layout?.fields ?? [])
  };
}

export function mergeLegacyInstallsIntoDocument(
  base: ButtonStateDocument,
  installs: readonly InstallButtonSourceResult[]
): ButtonStateDocument {
  const document = cloneButtonDocument(base);
  for (const install of installs) {
    if (migrationInstallIsRepresented(document, install)) continue;
    if (document.buttons[install.ownerButtonId]) {
      throw new Error(`Migration owner '${install.ownerButtonId}' conflicts with an existing Button.`);
    }
    const panelSurface = ensureMigrationPanelSurface(document, install.sourceIdentity);
    if (install.children.length > 0) {
      addMigratedToolSet(document, install, panelSurface);
    } else {
      addMigratedSingle(document, install, panelSurface);
    }
  }
  if (!document.surfaces[DEFAULT_BUTTON_SURFACE_ID]) {
    throw new Error("Canonical Button state is missing its main surface.");
  }
  return document;
}

export function reconcileBundledProgramSources(
  base: ButtonStateDocument,
  descriptors: readonly Record<string, unknown>[]
): ButtonStateDocument {
  let document = cloneButtonDocument(base);
  const missing: InstallButtonSourceResult[] = [];
  const seenOwners = new Set<string>();
  for (const descriptor of descriptors) {
    const installed = normalizeLegacyInstallResult(descriptor);
    if (!installed.ownerButtonId || seenOwners.has(installed.ownerButtonId)) {
      throw new Error(
        installed.ownerButtonId
          ? `Bundled source synchronization returned owner '${installed.ownerButtonId}' more than once.`
          : "Bundled source synchronization returned a descriptor without an owner Button ID."
      );
    }
    seenOwners.add(installed.ownerButtonId);
    if (document.buttons[installed.ownerButtonId]) {
      applyInstalledSourceUpdate(document, installed);
    } else {
      missing.push(installed);
    }
  }
  if (missing.length > 0) {
    document = mergeLegacyInstallsIntoDocument(document, missing);
  }
  return document;
}

export async function synchronizeBundledButtonSources(
  base: ButtonStateDocument,
  options: SynchronizeBundledButtonSourcesOptions = {}
): Promise<ButtonStateDocument> {
  if (!isTauriWindowHost()) return base;
  const programName = options.programName?.trim();
  const response = await invoke<BundledProgramSourceSyncResponse>(
    "synchronize_bundled_program_sources",
    {
      includeStarters: options.includeStarters ?? false,
      ...(programName ? { programName } : {})
    }
  );
  for (const source of response.sources) {
    if (source.status !== "failed") continue;
    console.error(
      `Bundled Button source '${source.programName}/${source.bundledSourceId}' failed to synchronize.`,
      source.message
    );
  }
  const descriptors = response.sources.flatMap((source) =>
    source.status !== "failed" && source.descriptor ? [source.descriptor] : []
  );
  if (descriptors.length === 0) return base;

  let current = base;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = reconcileBundledProgramSources(current, descriptors);
    if (buttonStateDocumentsEqual(next, current)) return current;
    try {
      return await saveButtonStateDocument(next, current.revision);
    } catch (error) {
      const latest = parseLoadedDocument(await invoke<unknown>("load_button_state"));
      const verified = reconcileBundledProgramSources(latest, descriptors);
      if (buttonStateDocumentsEqual(verified, latest)) return latest;
      if (attempt === 0 && latest.revision !== current.revision) {
        current = latest;
        continue;
      }
      throw error;
    }
  }
  return current;
}

export async function installButtonSource(
  request: InstallButtonSourceRequest
): Promise<InstallButtonSourceResult> {
  if (!isTauriWindowHost()) {
    throw new Error("Button sources can only be installed from the FlowCell desktop host.");
  }
  const response = await invoke<Record<string, unknown>>("install_button_source", { request: { ...request } });
  return normalizeInstallResult(request, response);
}

export const commitButtonStateDocument = saveButtonStateDocument;

export async function uninstallButtonSource(args: {
  ownerButtonId: string;
  sourceIdentity: ButtonSourceIdentity;
}): Promise<void> {
  if (!isTauriWindowHost()) return;
  await invoke("uninstall_button_source", {
    request: {
      ownerButtonId: args.ownerButtonId,
      programName: args.sourceIdentity.displayProgramName,
      panelName: args.sourceIdentity.displayPanelName,
      fileName: args.sourceIdentity.displayFileName
    }
  });
}
