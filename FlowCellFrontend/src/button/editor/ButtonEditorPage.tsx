import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { unregisterLayoutWindow } from "../../lib/layoutSnapshots";
import type { ButtonEditorWindowContext } from "../../lib/windowContext";
import {
  listPanelFolders,
  listProgramFolders
} from "../../lib/programRails";
import {
  buildPanelRailOwnerEntries,
  panelRailOwnerSurfaceBounds
} from "../../pages/main/mainLayout";
import {
  showOpenFileDialog,
  showSaveFileDialog
} from "../../lib/tauri";
import {
  hideButtonActivationAnimationEditorWindow,
  openButtonActivationAnimationEditor,
  saveButtonActivationAnimationEditorBounds
} from "../animations/buttonAnimationWindows";
import {
  buildButtonFanWindowLabel,
  buildButtonPopoutWindowLabel,
  closeButtonFanWindow,
  listenForButtonWindowContextUpdates,
  openButtonFanWindow,
  openButtonPopoutWindow
} from "../windows/buttonWindows";
import type {
  ButtonActivationAnimationPresetId,
  ButtonCoreMeasurement,
  ButtonDesktopBounds,
  ButtonPlacement,
  ButtonRecord,
  ButtonRect,
  ButtonSkin,
  ButtonStateDocument,
  ButtonSurface
} from "../types";
import {
  cloneButtonDocument,
  createStableButtonId
} from "../state/buttonDefaults";
import {
  getButtonSkinDirectory,
  getButtonSettingsDirectory,
  initializeButtonSettingsDefault,
  installButtonSource,
  loadButtonSkinFile,
  loadButtonSettingsDefault,
  loadButtonSettingsFile,
  loadButtonStateDocument,
  saveButtonSettingsFile,
  saveButtonSkinFile,
  saveButtonStateDocument,
  uninstallButtonSource,
  updateButtonSettingsDefault,
  type InstallButtonSourceResult
} from "../state/ButtonStateRepository";
import { useButtonEditorStore } from "../state/ButtonEditorStore";
import {
  publishButtonCommit,
  publishButtonDraft,
  publishButtonDraftCancel,
  publishButtonDraftToWindow,
  registerButtonDraftResponder,
  subscribeButtonRestingWindowBounds
} from "../state/ButtonDraftBus";
import { validateButtonStateDocument } from "../state/buttonStateValidation";
import { validateInstalledButtonLayout } from "../state/installedButtonLayoutValidation";
import {
  resolveDiscardedStagedOwnerButtonIds
} from "../state/buttonDocumentOperations";
import { setButtonPopoutFanMode } from "../state/buttonPopoutInteractionOperations";
import {
  reconcileProgramPanelOwners
} from "../state/panelOwnerButtonOperations";
import {
  FLOWCELL_MAIN_PAGE_SECTIONS,
  ensureFlowCellMainPageButtons,
  isFlowCellMainPageProgram
} from "../state/mainPageButtonOperations";
import {
  alignButtonPlacementSelectionToTopLeftButton,
  buttonSpacingPixelsFromMillimeters,
  compactButtonPlacements,
  compactUniformButtonPlacements,
  createStarterButtonLayout,
  findFirstAvailableButtonPosition,
  resizeButtonPlacementSelection,
  snapToGrid,
  translateButtonPlacementRects,
  validateExactButtonLayoutGeometry,
  type CompactButtonPlacement,
  type NamedButtonRect
} from "../geometry/buttonGeometry";
import { DEFAULT_BUTTON_SKIN_ID } from "../skins/defaultButtonSkin";
import {
  BUTTON_SKIN_FILE_EXTENSION,
  buttonSkinNameFromPath,
  serializeButtonSkinSections
} from "../skins/buttonSkinFormat";
import {
  BUTTON_SETTINGS_FILE_EXTENSION,
  applyButtonSettingsFile,
  buildButtonSettingsFile,
  buttonSettingsPlacementKind,
  buttonSettingsPlacementLabel,
  type ButtonSettingsPlacementKind
} from "../state/buttonSettingsFile";
import { ButtonSurfaceSelector } from "./ButtonSurfaceSelector";
import {
  ButtonWorkspace,
  type ButtonWorkspaceSelectionMode
} from "./ButtonWorkspace";
import { ButtonAnimationPickerPage } from "./ButtonAnimationPickerPage";
import { ButtonSkinEditor } from "./ButtonSkinEditor";
import {
  createButtonSkinFromFile,
  findButtonSkinRecentFile,
  findButtonSkinRecentFileByPath,
  readButtonSkinRecentFiles,
  rememberButtonSkinRecentFile,
  writeButtonSkinRecentFiles,
  type ButtonSkinFileResult
} from "./buttonSkinFiles";
import { buttonActivationCycleStructureMatches } from "./buttonActivationStateStructure";
import {
  buttonPlacementSizingMode,
  buttonPlacementSizingPatch,
  resolveAssignedButtonDimensions,
  type ButtonPlacementSizingMode,
  type ButtonSizeAssignment
} from "./buttonSizeAssignments";
import {
  applyButtonAnimationSavedScope,
  applyButtonSettingsSavedScope,
  applyButtonSkinSavedScope,
  applyButtonTextSavedScope,
  buildButtonAnimationScopedDocument,
  buildButtonSettingsScopedDocument,
  buildButtonSkinScopedDocument,
  buildButtonTextScopedDocument,
  buttonSkinsEqual,
  skinHasReferencesOutsidePlacements,
  type ButtonSkinSaveScope
} from "./buttonEditorSaveScopes";
import { discardStagedButtonInstalls } from "./stagedInstallCleanup";
import {
  buildButtonEditorButtonOptions,
  buildButtonEditorPanelOptions,
  buildButtonEditorPlacementOptions,
  buildButtonEditorProgramOptions,
  resolveButtonEditorContextPlacementId,
  resolveButtonEditorIdentity,
  resolveButtonEditorNavigationButtonId,
  resolveButtonEditorSurfaceSkinTargetPlacementIds,
  resolveButtonEditorPanelSurfaceId,
  resolveButtonEditorSurfaceIdentity,
  resolvePreferredButtonPlacementId
} from "./buttonEditorSelection";
import "./buttonEditor.css";

export interface ButtonEditorPageProps {
  context?: ButtonEditorWindowContext;
}

interface CopiedButtonSizing extends ButtonSizeAssignment {
  sourceButtonLabel: string;
}

function desktopBoundsEqual(
  left: ButtonDesktopBounds | null | undefined,
  right: ButtonDesktopBounds
): boolean {
  return Boolean(
    left &&
      Math.abs(left.left - right.left) <= 0.5 &&
      Math.abs(left.top - right.top) <= 0.5 &&
      Math.abs(left.width - right.width) <= 0.5 &&
      Math.abs(left.height - right.height) <= 0.5
  );
}

function buttonRectsEqual(
  left: ButtonRect | null | undefined,
  right: ButtonRect
): boolean {
  return Boolean(
    left &&
      Math.abs(left.x - right.x) <= 0.05 &&
      Math.abs(left.y - right.y) <= 0.05 &&
      Math.abs(left.width - right.width) <= 0.05 &&
      Math.abs(left.height - right.height) <= 0.05
  );
}

function resolveIndependentOwnerPlacementId(
  document: ButtonStateDocument,
  surfaceId: string
): string | null {
  const unit = Object.values(document.popoutUnits).find(
    (candidate) => candidate.surfaceId === surfaceId
  );
  const unitOwnerPlacementId = unit?.ownerPlacementId?.trim();
  if (
    unitOwnerPlacementId &&
    document.placements[unitOwnerPlacementId]?.surfaceId === surfaceId
  ) {
    return unitOwnerPlacementId;
  }
  const setup = Object.values(document.fanSetups).find(
    (candidate) => candidate.fanSurfaceId === surfaceId
  );
  return setup
    ? document.surfaces[surfaceId]?.placementIds.find((placementId) =>
        document.placements[placementId]?.buttonId === setup.panelOwnerButtonId
      ) ?? null
    : null;
}

function formatButtonSize(width: number, height: number): string {
  return `${Number(width.toFixed(2))} × ${Number(height.toFixed(2))} px`;
}

function defaultButtonSettingsFileName(
  placementKind: ButtonSettingsPlacementKind,
  now = new Date()
): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${placementKind}-settings-${timestamp}${BUTTON_SETTINGS_FILE_EXTENSION}`;
}

function defaultButtonSkinFileName(name: string): string {
  const baseName = name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${baseName || "button-skin"}${BUTTON_SKIN_FILE_EXTENSION}`;
}

function isButtonSettingsDefaultRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Button state changed before the settings default was saved.");
}

async function initializeSettingsDefaultWithRetry(args: {
  placementKind: ButtonSettingsPlacementKind;
  surfaceId: string;
  initialDocument: ButtonStateDocument;
  fallbackProgramName: string;
  fallbackPanelName: string;
}): Promise<string> {
  let committed = cloneButtonDocument(args.initialDocument);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const surface = committed.surfaces[args.surfaceId];
    if (!surface || buttonSettingsPlacementKind(surface) !== args.placementKind) {
      throw new Error("The selected Button placement no longer exists.");
    }
    const identity =
      resolveButtonEditorSurfaceIdentity(committed, args.surfaceId) ??
      (
        args.fallbackProgramName.trim() && args.fallbackPanelName.trim()
          ? {
              programName: args.fallbackProgramName,
              panelName: args.fallbackPanelName
            }
          : null
      );
    if (!identity) throw new Error("The selected surface has no Program and Panel identity.");
    const file = buildButtonSettingsFile(committed, args.surfaceId, identity);
    try {
      return await initializeButtonSettingsDefault(
        args.placementKind,
        args.surfaceId,
        file,
        committed.revision
      );
    } catch (error) {
      if (attempt === 2 || !isButtonSettingsDefaultRevisionConflict(error)) throw error;
      committed = await loadButtonStateDocument();
    }
  }
  throw new Error("FlowCell could not initialize the Button settings default.");
}

interface RegisteredProgramPanels {
  programName: string;
  panelNames: string[];
}

interface NaturalCoreMeasurementSnapshot {
  measurement: ButtonCoreMeasurement;
  sourceSkinId: string;
  sourceLabel: string;
  sourceTextSizeOverride: number | null;
}

function currentNaturalCoreMeasurement(
  document: ButtonStateDocument,
  placement: ButtonPlacement,
  measurements: ReadonlyMap<string, NaturalCoreMeasurementSnapshot>
): ButtonCoreMeasurement | null {
  const button = document.buttons[placement.buttonId];
  const source = measurements.get(placement.id);
  if (!button || !source) return null;
  return (
    source.sourceSkinId === (placement.skinOverrideId ?? button.defaultSkinId) &&
    source.sourceLabel === button.label &&
    source.sourceTextSizeOverride === placement.textSizeOverride
  ) ? source.measurement : null;
}

interface ButtonEditorBootstrap {
  document: ButtonStateDocument;
  registeredPanels: RegisteredProgramPanels[];
}

function registeredPanelsForProgram(
  registeredPanels: readonly RegisteredProgramPanels[],
  programName: string
): string[] {
  const normalizedProgramName = programName.normalize("NFC").trim().toLocaleLowerCase("en");
  return registeredPanels.find((entry) =>
    entry.programName.normalize("NFC").trim().toLocaleLowerCase("en") === normalizedProgramName
  )?.panelNames ?? [];
}

async function loadButtonEditorBootstrap(): Promise<ButtonEditorBootstrap> {
  const programNames = await listProgramFolders();
  const registeredPanels = await Promise.all(programNames.map(async (programName) => ({
    programName,
    panelNames: await listPanelFolders(programName)
  })));

  let current = await loadButtonStateDocument();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = cloneButtonDocument(current);
    let changed = false;
    const removedOwnerButtonIds = new Set<string>();
    for (const entry of registeredPanels) {
      const result = reconcileProgramPanelOwners(next, {
        programName: entry.programName,
        panels: buildPanelRailOwnerEntries(entry.panelNames),
        surfaceBounds: panelRailOwnerSurfaceBounds
      });
      changed ||= result.changed;
      result.removedOwnerButtonIds.forEach((buttonId) => removedOwnerButtonIds.add(buttonId));
    }
    const mainPageButtonsChanged = ensureFlowCellMainPageButtons(next, programNames);
    changed ||= mainPageButtonsChanged;
    if (!changed) return { document: current, registeredPanels };

    try {
      const saved = await saveButtonStateDocument(next, current.revision);
      await publishButtonCommit(saved);
      await Promise.all(
        [...removedOwnerButtonIds].map((buttonId) => closeButtonFanWindow(buttonId))
      );
      return { document: saved, registeredPanels };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !message.includes("Button state changed before Save.")) throw error;
      current = await loadButtonStateDocument();
    }
  }
  throw new Error("Panel Buttons could not be reconciled into Button state.");
}

function createButtonRecord(args: {
  id: string;
  role: ButtonRecord["role"];
  label: string;
  tooltip?: string;
  sourceIdentity?: ButtonRecord["sourceIdentity"];
  executionTarget?: ButtonRecord["executionTarget"];
  parentId?: string;
  behavior?: ButtonRecord["toolSetBehavior"];
  metadata?: ButtonRecord["metadata"];
}): ButtonRecord {
  return {
    id: args.id,
    role: args.role,
    sourceIdentity: args.sourceIdentity ?? null,
    label: args.label,
    tooltip: args.tooltip ?? "",
    executionTarget: args.executionTarget ?? null,
    defaultSkinId: DEFAULT_BUTTON_SKIN_ID,
    defaultTextFitMode: "shrink",
    disabled: false,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: args.parentId ?? null,
    toolSetBehavior: args.behavior ?? null,
    metadata: args.metadata ?? {}
  };
}

function addPlacement(
  document: ButtonStateDocument,
  buttonId: string,
  surfaceId: string,
  desired?: Partial<ButtonRect>
): ButtonPlacement {
  const surface = document.surfaces[surfaceId];
  if (!surface) throw new Error("The selected Button surface no longer exists.");
  const width = surface.uniformButtonSize?.width ?? desired?.width ?? 160;
  const height = surface.uniformButtonSize?.height ?? desired?.height ?? 44;
  const buttonSpacing = buttonSpacingPixelsFromMillimeters(
    document.settings.buttonSpacingMm
  );
  const otherRects = surface.placementIds.map((id) => document.placements[id]).filter(Boolean);
  const available = !surface.uniformButtonSize && desired?.x !== undefined && desired?.y !== undefined
    ? { x: desired.x, y: desired.y, width, height }
    : findFirstAvailableButtonPosition({
        width,
        height,
        surface,
        otherRects,
        padding: surface.uniformButtonSize ? 0 : document.settings.defaultSurfacePadding,
        gap: buttonSpacing,
        gridSize: document.settings.gridSize
      });
  if (!available) throw new Error("The selected surface has no non-overlapping space for another Button.");
  const id = createStableButtonId("placement");
  const placement: ButtonPlacement = {
    id,
    buttonId,
    surfaceId,
    ...available,
    zIndex: surface.placementIds.length,
    skinOverrideId: null,
    textFitMode: document.buttons[buttonId]?.defaultTextFitMode ?? "shrink",
    textAlignment: "skin",
    minimumFontSize: document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    textOffsetX: 0,
    textOffsetY: 0,
    allowLabelResize: false,
    matchHitboxToSkin: !surface.uniformButtonSize,
    allowStretching: false,
    highlightOnHover: false,
    visualStateMap: null,
    activationCycle: null,
    resizeAnchor: "top-left"
  };
  document.placements[id] = placement;
  surface.placementIds.push(id);
  return placement;
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
    visualOverflowAllowance: 24,
    uniformButtonSize: null
  };
  document.surfaces[id] = surface;
  return surface;
}

function addInstalledSingle(
  document: ButtonStateDocument,
  result: InstallButtonSourceResult,
  surfaceId: string
): ButtonPlacement {
  if (!result.executionTarget) throw new Error("The installed script did not return an execution target.");
  document.buttons[result.ownerButtonId] = createButtonRecord({
    id: result.ownerButtonId,
    role: "single-script",
    label: result.label,
    tooltip: result.tooltip,
    sourceIdentity: result.sourceIdentity,
    executionTarget: result.executionTarget
  });
  return addPlacement(document, result.ownerButtonId, surfaceId);
}

function addInstalledToolSet(
  document: ButtonStateDocument,
  result: InstallButtonSourceResult,
  ownerSurfaceId: string
): { ownerPlacement: ButtonPlacement; popoutSurfaceId: string } {
  if (result.children.length === 0) throw new Error("The installed tool set contains no child buttons.");
  const layout = validateInstalledButtonLayout(result.layout);
  const slots = result.children.map((child) => child.slot);
  if (new Set(slots).size !== slots.length) {
    throw new Error("The installed tool set contains duplicate child placement slots.");
  }
  const childItems = result.children.map((child) => ({ id: child.slot, width: 144, height: 42 }));
  const starter = createStarterButtonLayout(childItems, {
    padding: document.settings.defaultSurfacePadding,
    gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
    maximumColumns: 4
  });
  const fieldWidth = Math.max(0, ...(layout?.fields ?? []).map((field) => field.x + field.width));
  const fieldHeight = Math.max(0, ...(layout?.fields ?? []).map((field) => field.y + field.height));
  const childRects = Object.fromEntries(result.children.map((child) => [
    child.slot,
    layout?.placements?.[child.slot] ?? starter.rects[child.slot]
  ]));
  const childWidth = Math.max(0, ...Object.values(childRects).map((rect) => rect.x + rect.width));
  const childHeight = Math.max(0, ...Object.values(childRects).map((rect) => rect.y + rect.height));
  const width = layout?.width ?? Math.max(
    240,
    starter.requiredWidth,
    childWidth + document.settings.defaultSurfacePadding,
    fieldWidth + document.settings.defaultSurfacePadding
  );
  const height = layout?.height ?? Math.max(
    120,
    starter.requiredHeight,
    childHeight + document.settings.defaultSurfacePadding,
    fieldHeight + document.settings.defaultSurfacePadding
  );
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The installed tool set declares invalid surface dimensions.");
  }
  const geometryIssues = validateExactButtonLayoutGeometry(
    result.children.map((child) => ({ id: child.slot, rect: childRects[child.slot] })),
    { width, height }
  );
  if (geometryIssues.length > 0) {
    throw new Error(geometryIssues.map((issue) => issue.message).join("\n"));
  }
  const surface = createSurface(document, `${result.label} Tool Set`, "tool-set-popout", width, height);
  document.buttons[result.ownerButtonId] = createButtonRecord({
    id: result.ownerButtonId,
    role: "tool-set-owner",
    label: result.label,
    tooltip: result.tooltip,
    sourceIdentity: result.sourceIdentity
  });
  const ownerPlacement = addPlacement(document, result.ownerButtonId, ownerSurfaceId);
  const childButtonIds: string[] = [];
  for (const child of result.children) {
    const childId = createStableButtonId("button-child");
    childButtonIds.push(childId);
    document.buttons[childId] = createButtonRecord({
      id: childId,
      role: "tool-set-child",
      label: child.label,
      tooltip: child.tooltip,
      executionTarget: child.executionTarget,
      parentId: result.ownerButtonId,
      behavior: layout?.childBehaviors?.[child.slot] ?? null,
      metadata: { toolSetSlot: child.slot }
    });
    const exact = childRects[child.slot];
    addPlacement(document, childId, surface.id, exact);
  }
  const unitId = createStableButtonId("popout");
  document.popoutUnits[unitId] = {
    id: unitId,
    name: result.label,
    kind: "tool-set",
    surfaceId: surface.id,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height },
    desktopBounds: null,
    desktopBoundsFitMode: "surface",
    desktopBoundsEnvelope: { x: 0, y: 0, width: surface.width, height: surface.height },
    childPlacementIds: [...surface.placementIds],
    openRule: "toggle",
    closeRule: "toggle",
    interactionMode: "pop",
    ownerPlacementId: null,
    transparency: 1,
    pinnedDefault: false,
    windowFitMode: "surface",
    ownerButtonId: result.ownerButtonId,
    childButtonIds,
    fields: cloneButtonDocument(layout?.fields ?? [])
  };
  return { ownerPlacement, popoutSurfaceId: surface.id };
}

function ensureProgramPanelSurface(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): ButtonSurface {
  const existingId = resolveButtonEditorPanelSurfaceId(document, programName, panelName);
  if (existingId && document.surfaces[existingId]?.kind === "panel") {
    return document.surfaces[existingId];
  }
  return createSurface(document, `${programName} / ${panelName}`, "panel", 960, 640);
}

function resolveInitialEditorSelection(
  document: ButtonStateDocument,
  context?: ButtonEditorWindowContext
): {
  programName: string;
  panelName: string;
  surfaceId: string;
  placementId: string | null;
} {
  const placementId = context
    ? resolveButtonEditorContextPlacementId(document, context)
    : null;
  const placement = placementId ? document.placements[placementId] : null;
  const buttonIdentity = placement
    ? resolveButtonEditorIdentity(document, placement.buttonId)
    : null;
  const surfaceIdentity = context?.surfaceId
    ? resolveButtonEditorSurfaceIdentity(document, context.surfaceId)
    : null;
  const programOptions = buildButtonEditorProgramOptions(document, []);
  const programName = buttonIdentity?.programName ||
    context?.programName ||
    surfaceIdentity?.programName ||
    programOptions[0] ||
    "";
  const panelOptions = buildButtonEditorPanelOptions(document, programName, []);
  const panelName = buttonIdentity?.panelName ||
    context?.panelName ||
    surfaceIdentity?.panelName ||
    panelOptions[0] ||
    "";
  const contextSurfaceId = context?.surfaceId && document.surfaces[context.surfaceId]
    ? context.surfaceId
    : "";
  const surfaceId = placement?.surfaceId ||
    contextSurfaceId ||
    resolveButtonEditorPanelSurfaceId(document, programName, panelName) ||
    "";
  return { programName, panelName, surfaceId, placementId };
}

function ButtonEditorContent({
  initialDocument,
  initialContext,
  initialRegisteredPanels
}: {
  initialDocument: ButtonStateDocument;
  initialContext?: ButtonEditorWindowContext;
  initialRegisteredPanels: readonly RegisteredProgramPanels[];
}) {
  const store = useButtonEditorStore(initialDocument);
  const storeRef = useRef(store);
  const draftDocumentRef = useRef(store.draft);
  storeRef.current = store;
  draftDocumentRef.current = store.draft;
  const [initialSelection] = useState(() => resolveInitialEditorSelection(initialDocument, initialContext));
  const sessionIdRef = useRef(initialContext?.draftSessionId ?? createStableButtonId("editor-session"));
  const stagedInstallsRef = useRef(new Map<string, InstallButtonSourceResult>());
  const initializedSettingsDefaultsRef = useRef(new Set<string>());
  const freshPlacementsRef = useRef(new Set<string>());
  const naturalCoreMeasurementsRef = useRef(new Map<string, NaturalCoreMeasurementSnapshot>());
  const closeInProgressRef = useRef(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<() => Promise<boolean>>(async () => false);
  const handledAutoImportRequestRef = useRef(0);
  const [activePage, setActivePage] = useState<"placement" | "animation">("placement");
  const [mode, setMode] = useState<"run" | "edit">("edit");
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState(initialSelection.surfaceId);
  const [focusedPlacementId, setFocusedPlacementId] = useState<string | null>(initialSelection.placementId);
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    () => new Set(initialSelection.placementId ? [initialSelection.placementId] : [])
  );
  const [programs, setPrograms] = useState<string[]>(
    () => initialRegisteredPanels.map((entry) => entry.programName)
  );
  const [panels, setPanels] = useState<string[]>(
    () => registeredPanelsForProgram(initialRegisteredPanels, initialSelection.programName)
  );
  const [programName, setProgramName] = useState(initialSelection.programName);
  const [panelName, setPanelName] = useState(initialSelection.panelName);
  const [lockedImportDestination, setLockedImportDestination] = useState<{
    programName: string;
    panelName: string;
  } | null>(() => initialContext?.lockImportDestination && initialSelection.programName && initialSelection.panelName
    ? { programName: initialSelection.programName, panelName: initialSelection.panelName }
    : null);
  const [autoImportRequest, setAutoImportRequest] = useState(
    initialContext?.lockImportDestination && initialSelection.programName && initialSelection.panelName ? 1 : 0
  );
  const [busy, setBusyState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeAnimationEditorButtonId, setActiveAnimationEditorButtonId] = useState<string | null>(null);
  const [recentSkinFiles, setRecentSkinFiles] = useState(readButtonSkinRecentFiles);
  const [workingSizingModeOverride, setWorkingSizingModeOverride] = useState<{
    placementId: string;
    sizingMode: ButtonPlacementSizingMode;
  } | null>(null);
  const [copiedButtonSizing, setCopiedButtonSizing] = useState<CopiedButtonSizing | null>(null);
  const [buttonSpacingInput, setButtonSpacingInput] = useState(
    () => String(initialDocument.settings.buttonSpacingMm)
  );
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);
  const rememberSkinFile = useCallback((path: string, skinId: string) => {
    setRecentSkinFiles((current) => {
      const next = rememberButtonSkinRecentFile(current, path, skinId);
      writeButtonSkinRecentFiles(next);
      return next;
    });
  }, []);

  const selectedPlacement = focusedPlacementId ? store.draft.placements[focusedPlacementId] ?? null : null;
  useEffect(() => {
    setButtonSpacingInput(String(store.draft.settings.buttonSpacingMm));
  }, [store.draft.settings.buttonSpacingMm]);
  const allSurfaceButtonsSameSize = Boolean(
    store.draft.surfaces[selectedSurfaceId]?.uniformButtonSize
  );
  useEffect(() => {
    setWorkingSizingModeOverride(null);
  }, [
    selectedPlacement?.id,
    allSurfaceButtonsSameSize
  ]);
  const selectedWorkingSizingMode = allSurfaceButtonsSameSize
    ? "responsive"
    : (
        workingSizingModeOverride?.placementId === selectedPlacement?.id
          ? workingSizingModeOverride?.sizingMode
          : "responsive"
      );
  const selectedButton = selectedPlacement ? store.draft.buttons[selectedPlacement.buttonId] ?? null : null;
  const navigationButtonId = resolveButtonEditorNavigationButtonId(
    store.draft,
    selectedButton?.id ?? ""
  );
  const selectedCommittedPlacement = selectedPlacement
    ? store.committed.placements[selectedPlacement.id] ?? null
    : null;
  const selectedStateStructureApplied = buttonActivationCycleStructureMatches(
    selectedCommittedPlacement?.activationCycle ?? null,
    selectedPlacement?.activationCycle ?? null
  );
  const selectedSurfacePlacements = store.draft.surfaces[selectedSurfaceId]?.placementIds
    .map((placementId) => store.draft.placements[placementId])
    .filter((placement): placement is ButtonPlacement => Boolean(placement)) ?? [];
  const selectedSurfaceButtonCount = selectedSurfacePlacements.length;
  const selectedSurface = store.draft.surfaces[selectedSurfaceId] ?? null;
  const selectedSurfaceUnit = Object.values(store.draft.popoutUnits).find(
    (candidate) => candidate.surfaceId === selectedSurfaceId
  );
  const selectedSurfaceOwnerPlacementId = selectedSurfaceUnit &&
    "ownerPlacementId" in selectedSurfaceUnit &&
    typeof selectedSurfaceUnit.ownerPlacementId === "string"
      ? selectedSurfaceUnit.ownerPlacementId
      : null;
  const selectedSurfaceShowsOwner = Boolean(
    selectedSurfaceUnit &&
    "interactionMode" in selectedSurfaceUnit &&
    selectedSurfaceUnit.interactionMode === "fan"
  );
  const selectedSetForSurface = new Set([...selectedPlacementIds].filter((id) => {
    const placement = store.draft.placements[id];
    return Boolean(
      placement?.surfaceId === selectedSurfaceId &&
      !(
        id === selectedSurfaceOwnerPlacementId &&
        !selectedSurfaceShowsOwner
      )
    );
  }));
  const selectedPlacementSummaries = selectedSurfacePlacements
    .filter((placement) => selectedSetForSurface.has(placement.id))
    .map((placement) => ({
      placementId: placement.id,
      label: store.draft.buttons[placement.buttonId]?.label ?? "Unknown Button"
    }));
  const settingsPlacementKind = selectedSurface
    ? buttonSettingsPlacementKind(selectedSurface)
    : null;
  const settingsPlacementLabel = buttonSettingsPlacementLabel(
    settingsPlacementKind ?? "main-page"
  );
  const mainPageControlScope = isFlowCellMainPageProgram(programName);
  useEffect(() => {
    if (mainPageControlScope && reorderMode) setReorderMode(false);
  }, [mainPageControlScope, reorderMode]);
  const selectedSkin = selectedButton && selectedPlacement
    ? store.draft.skins[selectedPlacement.skinOverrideId ?? selectedButton.defaultSkinId] ?? null
    : null;
  const selectedSkinFilePath = selectedSkin
    ? findButtonSkinRecentFile(recentSkinFiles, selectedSkin.id)?.path ?? null
    : null;
  const programOptions = useMemo(
    () => buildButtonEditorProgramOptions(store.draft, programs),
    [store.draft, programs]
  );
  const panelOptions = useMemo(
    () => buildButtonEditorPanelOptions(store.draft, programName, panels),
    [store.draft, programName, panels]
  );
  const buttonOptions = useMemo(
    () => buildButtonEditorButtonOptions(store.draft, programName, panelName),
    [store.draft, programName, panelName]
  );
  const placementOptions = useMemo(() => {
    const options = buildButtonEditorPlacementOptions(store.draft, navigationButtonId);
    if (!isFlowCellMainPageProgram(programName)) return options;
    return options.filter(
      (option) => store.draft.surfaces[option.surfaceId]?.kind === "main"
    );
  }, [navigationButtonId, programName, store.draft]);
  const selectedPlacementOptionId = useMemo(() => {
    const toolSetView = placementOptions.find((option) =>
      option.surfaceId === selectedSurfaceId &&
      option.view === (selectedSurfaceShowsOwner ? "tool-set-fan" : "tool-set-popout")
    );
    if (toolSetView) return toolSetView.id;
    return placementOptions.find((option) =>
      option.view === "placement" && option.placementId === focusedPlacementId
    )?.id ?? "";
  }, [focusedPlacementId, placementOptions, selectedSurfaceId, selectedSurfaceShowsOwner]);

  const focusPlacement = useCallback((placementId: string, replaceSelection = true) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement || !document.surfaces[placement.surfaceId]) return;
    const identity = resolveButtonEditorIdentity(document, placement.buttonId);
    setFocusedPlacementId(placement.id);
    setSelectedSurfaceId(placement.surfaceId);
    if (
      identity &&
      !lockedImportDestination &&
      !isFlowCellMainPageProgram(programName)
    ) {
      setProgramName(identity.programName);
      setPanelName(identity.panelName);
    }
    if (replaceSelection) setSelectedPlacementIds(new Set([placement.id]));
  }, [lockedImportDestination, programName, store]);

  const selectButton = useCallback((buttonId: string) => {
    if (!buttonId) {
      setFocusedPlacementId(null);
      setSelectedPlacementIds(new Set());
      return;
    }
    const document = store.current();
    const button = document.buttons[buttonId];
    const matchingSelectedToolSetUnit = button?.role === "tool-set-owner"
      ? Object.values(document.popoutUnits).find(
          (candidate) =>
            candidate.kind === "tool-set" &&
            candidate.ownerButtonId === buttonId &&
            candidate.surfaceId === selectedSurfaceId
        )
      : undefined;
    const selectedToolSetUnit = matchingSelectedToolSetUnit?.kind === "tool-set"
      ? matchingSelectedToolSetUnit
      : undefined;
    const selectedToolSetPlacementId = selectedToolSetUnit
      ? selectedToolSetUnit.interactionMode === "fan" && selectedToolSetUnit.ownerPlacementId
        ? selectedToolSetUnit.ownerPlacementId
        : selectedToolSetUnit.childPlacementIds[0] ?? null
      : null;
    const placementId = selectedToolSetPlacementId ?? resolvePreferredButtonPlacementId(
      document,
      buttonId,
      selectedSurfaceId
    );
    if (placementId) focusPlacement(placementId);
  }, [focusPlacement, selectedSurfaceId, store]);

  const applyEditorContext = useCallback((context: ButtonEditorWindowContext) => {
    setLockedImportDestination(
      context.lockImportDestination && context.programName && context.panelName
        ? { programName: context.programName, panelName: context.panelName }
        : null
    );
    if (context.lockImportDestination && context.programName && context.panelName) {
      setAutoImportRequest((current) => current + 1);
    }
    const document = store.current();
    const placementId = resolveButtonEditorContextPlacementId(document, context);
    if (placementId) {
      const placement = document.placements[placementId];
      const surface = placement ? document.surfaces[placement.surfaceId] : null;
      const identity = placement
        ? resolveButtonEditorIdentity(document, placement.buttonId)
        : null;
      if (context.programName) {
        setProgramName(context.programName);
      } else if (surface?.kind !== "main" && identity?.programName) {
        setProgramName(identity.programName);
      }
      if (context.panelName) {
        setPanelName(context.panelName);
      } else if (surface?.kind !== "main" && identity?.panelName) {
        setPanelName(identity.panelName);
      }
      focusPlacement(placementId);
      return;
    }
    const surfaceId = context.surfaceId && document.surfaces[context.surfaceId]
      ? context.surfaceId
      : resolveButtonEditorPanelSurfaceId(
          document,
          context.programName ?? programName,
          context.panelName ?? panelName
        ) ?? "";
    const identity = surfaceId ? resolveButtonEditorSurfaceIdentity(document, surfaceId) : null;
    setProgramName(context.programName ?? identity?.programName ?? programName);
    setPanelName(context.panelName ?? identity?.panelName ?? panelName);
    setSelectedSurfaceId(surfaceId);
    setFocusedPlacementId(null);
    setSelectedPlacementIds(new Set());
  }, [focusPlacement, panelName, programName, store]);

  useEffect(() => {
    void listProgramFolders().then(setPrograms).catch((error) => setMessage(String(error)));
  }, []);
  useEffect(() => {
    if (!programName) {
      setPanels([]);
      return;
    }
    if (isFlowCellMainPageProgram(programName)) {
      setPanels([...FLOWCELL_MAIN_PAGE_SECTIONS]);
      return;
    }
    let disposed = false;
    void listPanelFolders(programName)
      .then((next) => { if (!disposed) setPanels(next); })
      .catch((error) => { if (!disposed) setMessage(String(error)); });
    return () => { disposed = true; };
  }, [programName]);
  useEffect(() => {
    const placement = focusedPlacementId
      ? store.draft.placements[focusedPlacementId]
      : null;
    if (placement && store.draft.surfaces[placement.surfaceId]) {
      if (selectedSurfaceId !== placement.surfaceId) setSelectedSurfaceId(placement.surfaceId);
    } else if (focusedPlacementId) {
      setFocusedPlacementId(null);
    }
    if (!selectedSurfaceId || !store.draft.surfaces[selectedSurfaceId]) {
      setSelectedSurfaceId(
        resolveButtonEditorPanelSurfaceId(store.draft, programName, panelName) ?? ""
      );
    }
    setSelectedPlacementIds((current) => {
      const next = new Set([...current].filter((id) => {
        const candidate = store.draft.placements[id];
        return Boolean(candidate && candidate.surfaceId === selectedSurfaceId);
      }));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [focusedPlacementId, panelName, programName, selectedSurfaceId, store.draft]);
  useEffect(() => {
    const surface = store.committed.surfaces[selectedSurfaceId];
    const identity = surface
      ? resolveButtonEditorSurfaceIdentity(store.committed, surface.id) ??
        (programName.trim() && panelName.trim() ? { programName, panelName } : null)
      : null;
    if (!surface || !identity) return;
    const placementKind = buttonSettingsPlacementKind(surface);
    const initializationKey = `${placementKind}:${surface.id}`;
    if (initializedSettingsDefaultsRef.current.has(initializationKey)) return;
    initializedSettingsDefaultsRef.current.add(initializationKey);
    let disposed = false;
    void initializeSettingsDefaultWithRetry({
      placementKind,
      surfaceId: surface.id,
      initialDocument: store.committed,
      fallbackProgramName: identity.programName,
      fallbackPanelName: identity.panelName
    }).catch((error) => {
      initializedSettingsDefaultsRef.current.delete(initializationKey);
      if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
    };
  }, [panelName, programName, selectedSurfaceId, store.committed]);

  useEffect(() => {
    void publishButtonDraft(sessionIdRef.current, store.draft);
  }, [store.draft]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void registerButtonDraftResponder(
      sessionIdRef.current,
      () => draftDocumentRef.current
    ).then((next) => {
      if (disposed) next(); else unlisten = next;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    if (!activeAnimationEditorButtonId) return;
    if (
      selectedButton?.id === activeAnimationEditorButtonId &&
      selectedButton.activationAnimation
    ) {
      return;
    }
    setActiveAnimationEditorButtonId(null);
    void hideButtonActivationAnimationEditorWindow();
  }, [activeAnimationEditorButtonId, selectedButton?.id, selectedButton?.activationAnimation]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeButtonRestingWindowBounds(sessionIdRef.current, (update) => {
      const activeStore = storeRef.current;
      const current = activeStore.current();
      if (update.kind === "popout") {
        const unit = current.popoutUnits[update.popoutUnitId];
        if (
          !unit ||
          (unit.desktopBoundsFitMode === update.fitMode &&
            desktopBoundsEqual(unit.desktopBounds, update.bounds) &&
            buttonRectsEqual(unit.desktopBoundsEnvelope, update.envelope))
        ) {
          return;
        }
        activeStore.transact((draft) => {
          const target = draft.popoutUnits[update.popoutUnitId];
          if (!target) return;
          target.desktopBounds = update.bounds;
          target.desktopBoundsFitMode = update.fitMode;
          target.desktopBoundsEnvelope = update.envelope;
        }, {
          label: "Sync live Pop window bounds",
          coalesceKey: `live-pop-bounds:${update.popoutUnitId}`
        });
        return;
      }
      const setup = current.fanSetups[update.fanSetupId];
      if (
        !setup ||
        (setup.collapsedBoundsFitMode === update.fitMode &&
          desktopBoundsEqual(setup.collapsedPanelOwnerBounds, update.bounds) &&
          buttonRectsEqual(setup.collapsedBoundsEnvelope, update.envelope))
      ) {
        return;
      }
      activeStore.transact((draft) => {
        const target = draft.fanSetups[update.fanSetupId];
        if (!target) return;
        target.collapsedPanelOwnerBounds = update.bounds;
        target.collapsedBoundsFitMode = update.fitMode;
        target.collapsedBoundsEnvelope = update.envelope;
      }, {
        label: "Sync live Fan window bounds",
        coalesceKey: `live-fan-bounds:${update.fanSetupId}`
      });
    }).then((next) => {
      if (disposed) next(); else unlisten = next;
    });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForButtonWindowContextUpdates(getCurrentWindow().label, (context) => {
      if (context.kind !== "button-editor") return;
      applyEditorContext(context);
    }).then((next) => { if (disposed) next(); else unlisten = next; });
    return () => { disposed = true; unlisten?.(); };
  }, [applyEditorContext]);

  const importSource = useCallback(async () => {
    const importProgramName = lockedImportDestination?.programName ?? programName;
    const importPanelName = lockedImportDestination?.panelName ?? panelName;
    if (!importProgramName || !importPanelName || busyRef.current) return;
    if (isFlowCellMainPageProgram(importProgramName)) {
      setMessage("FlowCell Main Page contains application controls only and cannot receive deployable Button content.");
      return;
    }
    setBusy(true);
    setMessage(null);
    let installed: InstallButtonSourceResult | null = null;
    try {
      const paths = await showOpenFileDialog({
        title: "Choose FlowCell Button Content",
        filter: "FlowCell Buttons (*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json)|*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json|All Files (*.*)|*.*",
        multiselect: false
      });
      const sourcePath = paths[0];
      if (!sourcePath) return;
      const ownerButtonId = createStableButtonId("button");
      installed = await installButtonSource({
        ownerButtonId,
        programName: importProgramName,
        panelName: importPanelName,
        sourcePath,
        importKind: "auto"
      });
      stagedInstallsRef.current.set(ownerButtonId, installed);
      let nextSurface = "";
      let selectedPlacement = "";
      store.transact((draft) => {
        const panelSurface = ensureProgramPanelSurface(draft, importProgramName, importPanelName);
        nextSurface = panelSurface.id;
        if (installed!.children.length === 0) {
          const placement = addInstalledSingle(draft, installed!, panelSurface.id);
          selectedPlacement = placement.id;
          freshPlacementsRef.current.add(placement.id);
        } else {
          const created = addInstalledToolSet(draft, installed!, panelSurface.id);
          selectedPlacement = created.ownerPlacement.id;
          freshPlacementsRef.current.add(created.ownerPlacement.id);
        }
      }, { label: "Add Button content" });
      setSelectedSurfaceId(nextSurface);
      setFocusedPlacementId(selectedPlacement);
      setSelectedPlacementIds(new Set([selectedPlacement]));
    } catch (error) {
      let cleanupError: unknown = null;
      if (installed) {
        try {
          await uninstallButtonSource({
            ownerButtonId: installed.ownerButtonId,
            sourceIdentity: installed.sourceIdentity
          });
          stagedInstallsRef.current.delete(installed.ownerButtonId);
        } catch (uninstallError) {
          cleanupError = uninstallError;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      setMessage(cleanupError
        ? `${message}\n\nThe staged local source package could not be discarded. It remains tracked in this Editor so Cancel or window close can retry cleanup.`
        : message);
    } finally {
      setBusy(false);
    }
  }, [lockedImportDestination, panelName, programName, setBusy, store]);

  useEffect(() => {
    if (autoImportRequest <= handledAutoImportRequestRef.current || busy) return;
    handledAutoImportRequestRef.current = autoImportRequest;
    void importSource();
  }, [autoImportRequest, busy, importSource]);

  const commitScopedDocument = async (
    buildNext: (committed: ButtonStateDocument) => ButtonStateDocument,
    applySavedScope: (draft: ButtonStateDocument, saved: ButtonStateDocument) => void,
    successMessage: string,
    failurePrefix?: string,
    canonicalSavedFailurePrefix?: string
  ): Promise<ButtonStateDocument | null> => {
    setBusy(true);
    let canonicalSaved = false;
    try {
      let committed = cloneButtonDocument(store.committed);
      let saved: ButtonStateDocument | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const next = buildNext(committed);
        const validation = validateButtonStateDocument(next);
        if (!validation.valid) {
          throw new Error(
            validation.issues
              .slice(0, 8)
              .map((issue) => `${issue.path}: ${issue.message}`)
              .join("\n")
          );
        }
        try {
          saved = await saveButtonStateDocument(next, committed.revision);
          break;
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          if (
            attempt === 2 ||
            !details.includes("Button state changed before Save.")
          ) {
            throw error;
          }
          committed = await loadButtonStateDocument();
        }
      }
      if (!saved) throw new Error("FlowCell could not commit the scoped Button change.");
      canonicalSaved = true;
      store.acceptScopedSaved(saved, applySavedScope);
      await publishButtonCommit(saved);
      setMessage(successMessage);
      return saved;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const prefix = canonicalSaved
        ? canonicalSavedFailurePrefix
        : failurePrefix;
      setMessage(prefix ? `${prefix}\n${details}` : details);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (busyRef.current) return;
    setBusy(true);
    let targetPath: string | null = null;
    let writtenPath: string | null = null;
    let canonicalSaved = false;
    try {
      const settingsDraft = cloneButtonDocument(store.current());
      const editorBaseline = cloneButtonDocument(store.committed);
      const surface = settingsDraft.surfaces[selectedSurfaceId];
      if (!surface) throw new Error("Select a Button placement before saving its settings.");
      const placementKind = buttonSettingsPlacementKind(surface);
      const placementLabel = buttonSettingsPlacementLabel(placementKind);
      const initialNext = buildButtonSettingsScopedDocument(
        editorBaseline,
        settingsDraft,
        selectedSurfaceId,
        { programName, panelName }
      );
      const validation = validateButtonStateDocument(initialNext);
      if (!validation.valid) {
        throw new Error(validation.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
      }
      const settingsDirectory = await getButtonSettingsDirectory(placementKind);
      targetPath = await showSaveFileDialog({
        title: `Save ${placementLabel} Settings`,
        filter: "FlowCell Button Settings (*.flowcell-button-settings.json)|*.flowcell-button-settings.json|JSON Files (*.json)|*.json",
        defaultFileName: defaultButtonSettingsFileName(placementKind),
        initialDirectory: settingsDirectory
      });
      if (!targetPath) {
        // Say so explicitly; a silent return reads as a dead Save action.
        setMessage(`${placementLabel} settings were not saved because no file was chosen.`);
        return;
      }

      const discardedStagedOwnerIds = resolveDiscardedStagedOwnerButtonIds(
        settingsDraft,
        [...stagedInstallsRef.current.keys()]
      );
      for (const ownerButtonId of discardedStagedOwnerIds) {
        const installed = stagedInstallsRef.current.get(ownerButtonId);
        if (!installed) continue;
        await uninstallButtonSource({
          ownerButtonId: installed.ownerButtonId,
          sourceIdentity: installed.sourceIdentity
        });
        stagedInstallsRef.current.delete(ownerButtonId);
      }
      let committedDocument = editorBaseline;
      let saved: ButtonStateDocument | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const next = buildButtonSettingsScopedDocument(
          committedDocument,
          settingsDraft,
          selectedSurfaceId,
          { programName, panelName },
          editorBaseline
        );
        const retryValidation = validateButtonStateDocument(next);
        if (!retryValidation.valid) {
          throw new Error(retryValidation.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
        }
        try {
          saved = await saveButtonStateDocument(next, committedDocument.revision);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === 2 || !message.includes("Button state changed before Save.")) throw error;
          committedDocument = await loadButtonStateDocument();
        }
      }
      if (!saved) throw new Error("FlowCell could not commit the live Button arrangement.");
      canonicalSaved = true;
      store.acceptScopedSaved(saved, (draft, canonical) => {
        applyButtonSettingsSavedScope(
          draft,
          canonical,
          selectedSurfaceId,
          { programName, panelName }
        );
      });
      stagedInstallsRef.current.clear();
      const committedSettingsFile = buildButtonSettingsFile(saved, selectedSurfaceId, {
        programName,
        panelName
      });
      writtenPath = await saveButtonSettingsFile(targetPath, committedSettingsFile);
      await publishButtonCommit(saved);
      setMessage(`${placementLabel} settings saved to ${writtenPath}.`);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      setMessage(
        canonicalSaved && !writtenPath && targetPath
          ? `The Button settings were committed, but FlowCell could not write the settings file to ${targetPath}:\n${failure}`
          : canonicalSaved && writtenPath
            ? `The Button settings and file were saved, but FlowCell could not finish synchronizing other windows:\n${failure}`
            : failure
      );
    } finally {
      setBusy(false);
    }
  };

  const stageSettingsFile = (
    settingsFile: Parameters<typeof applyButtonSettingsFile>[2],
    sourceLabel: string
  ) => {
    const loadedDocument = applyButtonSettingsFile(
      store.current(),
      selectedSurfaceId,
      settingsFile,
      { programName, panelName }
    );
    store.transact(() => loadedDocument, { label: `Load ${settingsPlacementLabel} settings` });
    const firstPlacementId = loadedDocument.surfaces[selectedSurfaceId]?.placementIds[0] ?? null;
    setSelectedSurfaceId(selectedSurfaceId);
    setFocusedPlacementId(firstPlacementId);
    setSelectedPlacementIds(new Set(firstPlacementId ? [firstPlacementId] : []));
    setActivePage("placement");
    setReorderMode(false);
    setMessage(
      `${settingsPlacementLabel} settings loaded from ${sourceLabel}. ` +
      `Use Save ${settingsPlacementLabel} Settings to commit them.`
    );
  };

  const loadSettings = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      if (stagedInstallsRef.current.size > 0) {
        throw new Error("Save or cancel the newly added Button before loading different settings.");
      }
      if (!settingsPlacementKind) {
        throw new Error("Select a Button placement before loading settings.");
      }
      const settingsDirectory = await getButtonSettingsDirectory(settingsPlacementKind);
      const paths = await showOpenFileDialog({
        title: `Load ${settingsPlacementLabel} Settings`,
        filter: "FlowCell Button Settings (*.flowcell-button-settings.json)|*.flowcell-button-settings.json|JSON Files (*.json)|*.json",
        initialDirectory: settingsDirectory,
        multiselect: false
      });
      const selectedPath = paths[0]?.trim();
      if (!selectedPath) return;

      const settingsFile = await loadButtonSettingsFile(selectedPath);
      stageSettingsFile(settingsFile, selectedPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const loadDefaultSettings = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      if (stagedInstallsRef.current.size > 0) {
        throw new Error("Save or cancel the newly added Button before loading default settings.");
      }
      const surface = store.committed.surfaces[selectedSurfaceId];
      if (!surface || !settingsPlacementKind) {
        throw new Error("Select a Button placement before loading its default.");
      }
      let settingsFile = await loadButtonSettingsDefault(
        settingsPlacementKind,
        selectedSurfaceId
      );
      if (!settingsFile) {
        await initializeSettingsDefaultWithRetry({
          placementKind: settingsPlacementKind,
          surfaceId: selectedSurfaceId,
          initialDocument: store.committed,
          fallbackProgramName: programName,
          fallbackPanelName: panelName
        });
        settingsFile = await loadButtonSettingsDefault(
          settingsPlacementKind,
          selectedSurfaceId
        );
      }
      if (!settingsFile) throw new Error(`${settingsPlacementLabel} has no saved default.`);
      stageSettingsFile(settingsFile, `${settingsPlacementLabel} default`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateDefaultSettings = async () => {
    if (busyRef.current) return;
    setBusy(true);
    setMessage(null);
    try {
      if (stagedInstallsRef.current.size > 0) {
        throw new Error("Save the newly added Button before updating the default settings.");
      }
      const settingsDraft = cloneButtonDocument(store.current());
      const editorBaseline = cloneButtonDocument(store.committed);
      const surface = settingsDraft.surfaces[selectedSurfaceId];
      if (!surface || !settingsPlacementKind) {
        throw new Error("Select a Button placement before updating its default.");
      }
      let committed = editorBaseline;
      let savedPath: string | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const rebased = buildButtonSettingsScopedDocument(
          committed,
          settingsDraft,
          selectedSurfaceId,
          { programName, panelName },
          editorBaseline
        );
        const settingsFile = buildButtonSettingsFile(rebased, selectedSurfaceId, {
          programName,
          panelName
        });
        try {
          savedPath = await updateButtonSettingsDefault(
            settingsPlacementKind,
            selectedSurfaceId,
            settingsFile,
            committed.revision
          );
          break;
        } catch (error) {
          if (attempt === 2 || !isButtonSettingsDefaultRevisionConflict(error)) throw error;
          committed = await loadButtonStateDocument();
        }
      }
      if (!savedPath) throw new Error("FlowCell could not update the Button settings default.");
      setMessage(`${settingsPlacementLabel} default updated at ${savedPath}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const selectPopoutPlacementMode = useCallback((surfaceId: string, mode: "pop" | "fan") => {
    const current = store.current();
    const unit = Object.values(current.popoutUnits).find(
      (candidate) => candidate.surfaceId === surfaceId
    );
    if (!unit) {
      setMessage("Select a Pop-out before changing its Fan behavior.");
      return;
    }
    const currentContentPlacementIds = unit.kind === "tool-set"
      ? unit.childPlacementIds
      : unit.memberPlacementIds;
    const currentOwnerPlacementId = unit.ownerPlacementId?.trim();
    const hasCurrentOwnerPlacement = Boolean(
      currentOwnerPlacementId &&
      current.placements[currentOwnerPlacementId]?.surfaceId === surfaceId
    );
    if (
      (unit.interactionMode ?? "pop") === mode &&
      (mode === "pop" || hasCurrentOwnerPlacement)
    ) {
      const currentFocusIsContent = Boolean(
        focusedPlacementId && currentContentPlacementIds.includes(focusedPlacementId)
      );
      const nextFocusedPlacementId = mode === "fan"
        ? currentOwnerPlacementId ?? null
        : currentFocusIsContent
          ? focusedPlacementId
          : currentContentPlacementIds[0] ?? null;
      setActivePage("placement");
      setReorderMode(false);
      setSelectedSurfaceId(surfaceId);
      setFocusedPlacementId(nextFocusedPlacementId);
      setSelectedPlacementIds(new Set(nextFocusedPlacementId ? [nextFocusedPlacementId] : []));
      setMessage(
        mode === "fan"
          ? `Fan placement selected. The owner Button is editable anywhere around the ${unit.kind === "tool-set" ? "Tool Set" : "Pop-out contents"}; its position controls where the contents open on click or hover.`
          : `${unit.kind === "tool-set" ? "Pop-out placement selected. Tool Set children" : "Pop-out contents"} remain editable and the retained Fan owner is hidden.`
      );
      return;
    }
    try {
      const next = cloneButtonDocument(current);
      const result = setButtonPopoutFanMode({
        document: next,
        surfaceId,
        enabled: mode === "fan",
        programName,
        panelName
      });
      const nextUnit = next.popoutUnits[result.unitId];
      const contentPlacementIds = nextUnit.kind === "tool-set"
        ? nextUnit.childPlacementIds
        : nextUnit.memberPlacementIds;
      const currentFocusIsContent = Boolean(
        focusedPlacementId && contentPlacementIds.includes(focusedPlacementId)
      );
      const nextFocusedPlacementId = mode === "fan"
        ? result.ownerPlacementId
        : currentFocusIsContent
          ? focusedPlacementId
          : contentPlacementIds[0] ?? null;
      store.transact(() => next, {
        label: mode === "fan" ? "Enable Pop-out Fan" : "Disable Pop-out Fan"
      });
      setActivePage("placement");
      setReorderMode(false);
      setSelectedSurfaceId(surfaceId);
      setFocusedPlacementId(nextFocusedPlacementId);
      setSelectedPlacementIds(new Set(nextFocusedPlacementId ? [nextFocusedPlacementId] : []));
      setMessage(
        mode === "fan"
          ? `Fan placement selected. The owner Button is editable anywhere around the ${nextUnit.kind === "tool-set" ? "Tool Set" : "Pop-out contents"}; its position controls where the contents open on click or hover.`
          : `${nextUnit.kind === "tool-set" ? "Pop-out placement selected. Tool Set children" : "Pop-out contents"} remain editable and the retained Fan owner is hidden.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [focusedPlacementId, panelName, programName, store]);

  const cancel = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      const cleanupFailures = await discardStagedButtonInstalls(
        stagedInstallsRef.current,
        (installed) => uninstallButtonSource({
          ownerButtonId: installed.ownerButtonId,
          sourceIdentity: installed.sourceIdentity
        })
      );
      if (cleanupFailures.length > 0) {
        const owners = cleanupFailures.map(({ installed }) => installed.ownerButtonId).join(", ");
        setMessage(
          `Could not discard ${cleanupFailures.length} staged local source package${cleanupFailures.length === 1 ? "" : "s"}. ` +
          `The Editor remains open so cleanup can be retried. Owner IDs: ${owners}`
        );
        return false;
      }

      await publishButtonDraftCancel(sessionIdRef.current);
      await hideButtonActivationAnimationEditorWindow().catch(() => {});
      setActiveAnimationEditorButtonId(null);
      store.cancel();
      setFocusedPlacementId(null);
      setSelectedPlacementIds(new Set());
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [setBusy, store.cancel]);
  cancelRef.current = cancel;

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void currentWindow.onCloseRequested((event) => {
      event.preventDefault();
      if (closeInProgressRef.current) return;
      if (busyRef.current) {
        setMessage("Finish the current Button operation before closing the Editor.");
        return;
      }

      closeInProgressRef.current = true;
      void cancelRef.current().then(async (discarded) => {
        if (!discarded || disposed) return;
        unregisterLayoutWindow(currentWindow.label);
        await currentWindow.destroy();
      }).catch((error) => {
        if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
      }).finally(() => {
        closeInProgressRef.current = false;
      });
    }).then((next) => {
      if (disposed) next(); else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const applyPlacementOrder = useCallback((
    surfaceId: string,
    orderedPlacementIds: readonly string[],
    placements: readonly CompactButtonPlacement[],
    label = "Reorder Buttons",
    placementPatch?: Pick<ButtonPlacement, "matchHitboxToSkin" | "allowStretching" | "allowLabelResize">,
    surfacePatch?: Partial<Pick<ButtonSurface, "uniformButtonSize">>,
    coalesceKey?: string
  ): boolean => {
    const document = store.current();
    const surface = document.surfaces[surfaceId];
    if (!surface) {
      setMessage("The selected Button surface no longer exists.");
      return false;
    }
    const memberIds = surface.placementIds;
    const memberSet = new Set(memberIds);
    if (
      orderedPlacementIds.length !== memberIds.length ||
      new Set(orderedPlacementIds).size !== memberIds.length ||
      orderedPlacementIds.some((placementId) => !memberSet.has(placementId))
    ) {
      setMessage("The Button surface changed while its order was being edited.");
      return false;
    }
    const placementById = new Map(placements.map((placement) => [placement.id, placement]));
    const orderedPlacements = orderedPlacementIds.flatMap((placementId, index) => {
      const placement = placementById.get(placementId);
      return placement
        ? [{ ...placement, zIndex: index }]
        : [];
    });
    if (orderedPlacements.length !== orderedPlacementIds.length) {
      setMessage("A Button placement disappeared while its order was being edited.");
      return false;
    }
    const independentOwnerPlacementId = resolveIndependentOwnerPlacementId(document, surfaceId);
    const geometryIssues = validateExactButtonLayoutGeometry(
      orderedPlacements.filter((placement) => placement.id !== independentOwnerPlacementId),
      surface
    );
    if (geometryIssues.length > 0) {
      setMessage(geometryIssues[0].message);
      return false;
    }

    store.transact((draft) => {
      Object.assign(draft.surfaces[surfaceId], surfacePatch, {
        placementIds: [...orderedPlacementIds]
      });
      orderedPlacements.forEach((placement) => {
        Object.assign(draft.placements[placement.id], placement.rect, {
          zIndex: placement.zIndex,
          ...(placement.id === independentOwnerPlacementId ? {} : placementPatch)
        });
      });
    }, { label, coalesceKey });
    setMessage(null);
    return true;
  }, [store]);

  const applyUniformSizeToSurface = useCallback((
    surfaceId: string,
    targetSize: Pick<ButtonRect, "width" | "height">,
    label: string,
    coalesceKey?: string
  ): boolean => {
    const document = store.current();
    const surface = document.surfaces[surfaceId];
    if (!surface) {
      setMessage("The selected Button surface no longer exists.");
      return false;
    }
    const orderedPlacementIds = [...surface.placementIds].sort((left, right) => {
      const leftPlacement = document.placements[left];
      const rightPlacement = document.placements[right];
      return (leftPlacement?.zIndex ?? 0) - (rightPlacement?.zIndex ?? 0) ||
        left.localeCompare(right);
    });
    const independentOwnerPlacementId = resolveIndependentOwnerPlacementId(document, surfaceId);
    const contentPlacementIds = orderedPlacementIds.filter(
      (placementId) => placementId !== independentOwnerPlacementId
    );
    const placements = contentPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement ? [{ id: placement.id, rect: placement }] : [];
    });
    if (placements.length === 0) {
      setMessage("The selected surface has no Buttons to resize.");
      return false;
    }
    const compacted = compactUniformButtonPlacements(
      placements,
      targetSize,
      surface,
      { gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm) }
    );
    if (!compacted.success) {
      setMessage(compacted.reason ?? "The equal-size Buttons do not fit inside the selected surface.");
      return false;
    }
    const compactedById = new Map(
      compacted.placements.map((placement) => [placement.id, placement])
    );
    const mergedPlacements = orderedPlacementIds.flatMap((placementId, zIndex) => {
      const compactedPlacement = compactedById.get(placementId);
      if (compactedPlacement) return [{ ...compactedPlacement, zIndex }];
      const placement = document.placements[placementId];
      return placement
        ? [{ id: placement.id, rect: placement, zIndex }]
        : [];
    });
    return applyPlacementOrder(
      surface.id,
      orderedPlacementIds,
      mergedPlacements,
      label,
      { matchHitboxToSkin: false, allowStretching: false, allowLabelResize: false },
      { uniformButtonSize: { width: targetSize.width, height: targetSize.height } },
      coalesceKey
    );
  }, [applyPlacementOrder, store]);

  const setAllSurfaceButtonsSameSize = useCallback((enabled: boolean) => {
    const document = store.current();
    const placement = focusedPlacementId
      ? document.placements[focusedPlacementId]
      : null;
    if (!placement) {
      setMessage("Select a Button placement before setting the surface size.");
      return;
    }
    if (enabled) {
      applyUniformSizeToSurface(
        placement.surfaceId,
        { width: placement.width, height: placement.height },
        "Set every Button on the surface to the same size"
      );
      return;
    }
    const surface = document.surfaces[placement.surfaceId];
    if (!surface) return;
    store.transact((draft) => {
      draft.surfaces[surface.id].uniformButtonSize = null;
    }, { label: "Stop linking Button sizes" });
    setMessage(null);
  }, [applyUniformSizeToSurface, focusedPlacementId, store]);

  const commitButtonSpacing = useCallback(() => {
    const nextMillimeters = Number(buttonSpacingInput.trim());
    if (!Number.isFinite(nextMillimeters) || nextMillimeters < 0) {
      setButtonSpacingInput(String(store.current().settings.buttonSpacingMm));
      setMessage("Button spacing must be zero or a positive millimeter value.");
      return;
    }
    if (nextMillimeters === store.current().settings.buttonSpacingMm) {
      setButtonSpacingInput(String(nextMillimeters));
      return;
    }
    store.transact((draft) => {
      draft.settings.buttonSpacingMm = nextMillimeters;
    }, {
      label: "Set Button spacing",
      coalesceKey: "button-spacing-mm"
    });
    setButtonSpacingInput(String(nextMillimeters));
    setMessage(null);
  }, [buttonSpacingInput, store]);

  const updatePlacementRect = useCallback((
    placementId: string,
    rect: ButtonRect,
    sizingMode?: ButtonPlacementSizingMode
  ) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement) return;
    const changesSize = Math.abs(placement.width - rect.width) > 0.05 ||
      Math.abs(placement.height - rect.height) > 0.05;
    const independentOwnerPlacementId = resolveIndependentOwnerPlacementId(
      document,
      placement.surfaceId
    );
    if (
      document.surfaces[placement.surfaceId]?.uniformButtonSize &&
      changesSize &&
      placement.id !== independentOwnerPlacementId
    ) {
      applyUniformSizeToSurface(
        placement.surfaceId,
        { width: rect.width, height: rect.height },
        "Resize every Button on the surface",
        `uniform-size:${placement.surfaceId}`
      );
      return;
    }
    setMessage(null);
    store.transact(
      (draft) => {
        Object.assign(
          draft.placements[placementId],
          rect,
          sizingMode
            ? buttonPlacementSizingPatch({
                width: rect.width,
                height: rect.height,
                sizingMode
              })
            : {}
        );
      },
      { label: "Move or resize Button" }
    );
  }, [applyUniformSizeToSurface, store]);

  const assignSizeToSelectedPlacement = useCallback((assignment: ButtonSizeAssignment) => {
    if (
      !Number.isFinite(assignment.width) ||
      !Number.isFinite(assignment.height) ||
      assignment.width <= 0 ||
      assignment.height <= 0
    ) return;
    const document = store.current();
    const placement = focusedPlacementId
      ? document.placements[focusedPlacementId]
      : null;
    const surface = placement ? document.surfaces[placement.surfaceId] : null;
    if (!placement || !surface) return;
    if (surface.uniformButtonSize) {
      setMessage("Turn off the separate Same size Buttons format before assigning an Editor size.");
      return;
    }

    const naturalMeasurement = currentNaturalCoreMeasurement(
      document,
      placement,
      naturalCoreMeasurementsRef.current
    );
    const assignedDimensions = resolveAssignedButtonDimensions(
      assignment,
      assignment.proportionalBasis ?? naturalMeasurement ?? placement
    );
    const candidate = {
      ...placement,
      ...assignedDimensions
    };
    const independentOwnerPlacementId = resolveIndependentOwnerPlacementId(
      document,
      surface.id
    );
    const geometryIssues = validateExactButtonLayoutGeometry(
      surface.placementIds.flatMap((placementId) => {
        if (placementId === independentOwnerPlacementId) return [];
        const item = document.placements[placementId];
        if (!item) return [];
        return [{ id: item.id, rect: item.id === placement.id ? candidate : item }];
      }),
      surface
    );
    if (geometryIssues.length > 0) {
      setMessage(
        geometryIssues[0].placementIds.length > 1
          ? "That Button size would overlap another Button."
          : "That Button size would leave the selected surface."
      );
      return;
    }

    setMessage(null);
    store.transact((draft) => {
      Object.assign(draft.placements[placement.id], {
        width: candidate.width,
        height: candidate.height,
        ...buttonPlacementSizingPatch(assignment)
      });
    }, {
      label: "Assign Button size"
    });
    setMessage("Size assigned to this Button. Use Save Settings to commit it.");
  }, [focusedPlacementId, store]);

  const assignSizeToPanel = useCallback((assignment: ButtonSizeAssignment) => {
    if (
      !Number.isFinite(assignment.width) ||
      !Number.isFinite(assignment.height) ||
      assignment.width <= 0 ||
      assignment.height <= 0
    ) return;
    const document = store.current();
    const placement = focusedPlacementId
      ? document.placements[focusedPlacementId]
      : null;
    if (!placement) {
      setMessage("Select a Button before assigning its size to the panel.");
      return;
    }
    const surface = document.surfaces[placement.surfaceId];
    if (!surface) {
      setMessage("The current Button placement surface no longer exists.");
      return;
    }
    if (surface.uniformButtonSize) {
      setMessage("Turn off the separate Same size Buttons format before assigning an Editor size.");
      return;
    }
    const orderedPlacementIds = [...surface.placementIds].sort((left, right) => {
      const leftPlacement = document.placements[left];
      const rightPlacement = document.placements[right];
      return (leftPlacement?.zIndex ?? 0) - (rightPlacement?.zIndex ?? 0) ||
        left.localeCompare(right);
    });
    const placements = orderedPlacementIds.flatMap((placementId) => {
      const item = document.placements[placementId];
      if (!item) return [];
      const naturalMeasurement = currentNaturalCoreMeasurement(
        document,
        item,
        naturalCoreMeasurementsRef.current
      );
      const assignedDimensions = resolveAssignedButtonDimensions(
        assignment,
        naturalMeasurement ?? item
      );
      return [{
        id: item.id,
        rect: { ...item, ...assignedDimensions }
      }];
    });
    if (placements.length !== orderedPlacementIds.length || placements.length === 0) {
      setMessage("The current placement surface contains a missing Button placement.");
      return;
    }
    const compacted = compactButtonPlacements(
      placements,
      surface,
      { gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm) }
    );
    if (!compacted.success) {
      setMessage(compacted.reason ?? "That Button size does not fit every Button beside it on the current surface.");
      return;
    }
    const applied = applyPlacementOrder(
      surface.id,
      orderedPlacementIds,
      compacted.placements,
      "Assign Button size to current surface",
      buttonPlacementSizingPatch(assignment)
    );
    if (applied) {
      setMessage(
        `Size assigned once to ${orderedPlacementIds.length} Button${orderedPlacementIds.length === 1 ? "" : "s"} next to the edited Button on '${surface.name}'. Use Save Settings to commit it.`
      );
    }
  }, [applyPlacementOrder, focusedPlacementId, store]);

  const copyFocusedButtonDimensions = useCallback(() => {
    const document = store.current();
    const placement = focusedPlacementId
      ? document.placements[focusedPlacementId]
      : null;
    if (!placement || placement.surfaceId !== selectedSurfaceId) {
      setMessage("Select a Button before copying its dimensions.");
      return;
    }
    const button = document.buttons[placement.buttonId];
    const copied: CopiedButtonSizing = {
      width: placement.width,
      height: placement.height,
      sizingMode: buttonPlacementSizingMode(placement),
      sourceButtonLabel: button?.label ?? "Button"
    };
    setCopiedButtonSizing(copied);
    setMessage(
      `Copied ${formatButtonSize(copied.width, copied.height)} from '${copied.sourceButtonLabel}'.`
    );
  }, [focusedPlacementId, selectedSurfaceId, store]);

  const addCopiedSizeToSelection = useCallback(() => {
    if (!copiedButtonSizing) {
      setMessage("Copy a Button's dimensions before adding that size to the selection.");
      return;
    }
    const document = store.current();
    const surface = document.surfaces[selectedSurfaceId];
    if (!surface) {
      setMessage("The selected Button surface no longer exists.");
      return;
    }
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === surface.id
    );
    const unitOwnerPlacementId = unit &&
      "ownerPlacementId" in unit &&
      typeof unit.ownerPlacementId === "string"
        ? unit.ownerPlacementId
        : null;
    const legacyFanSetup = Object.values(document.fanSetups).find(
      (candidate) => candidate.fanSurfaceId === surface.id
    );
    const legacyFanOwnerPlacementId = legacyFanSetup
      ? surface.placementIds.find((placementId) =>
          document.placements[placementId]?.buttonId === legacyFanSetup.panelOwnerButtonId
        ) ?? null
      : null;
    const ownerPlacementId = unitOwnerPlacementId ?? legacyFanOwnerPlacementId;
    const unitShowsOwner = Boolean(
      unit && "interactionMode" in unit && unit.interactionMode === "fan"
    );
    const hiddenOwnerPlacementId = unitOwnerPlacementId && !unitShowsOwner
        ? unitOwnerPlacementId
        : null;
    const visiblePlacementIds = surface.placementIds.filter(
      (placementId) => placementId !== hiddenOwnerPlacementId
    );
    const targetPlacementIds = visiblePlacementIds.filter((placementId) =>
      selectedPlacementIds.has(placementId)
    );
    if (targetPlacementIds.length === 0) {
      setMessage("Select one or more Buttons before adding the copied size.");
      return;
    }
    const targetSet = new Set(targetPlacementIds);
    const currentLayout = visiblePlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      if (!placement) return [];
      return [{ id: placement.id, rect: placement }];
    });
    if (currentLayout.length !== visiblePlacementIds.length) {
      setMessage("The selected surface contains a missing Button placement.");
      return;
    }
    const sizeResolution = resizeButtonPlacementSelection({
      placements: currentLayout,
      selectedPlacementIds: targetPlacementIds,
      targetSize: copiedButtonSizing,
      surface,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      independentPlacementIds: ownerPlacementId && visiblePlacementIds.includes(ownerPlacementId)
        ? [ownerPlacementId]
        : []
    });
    if (!sizeResolution.success) {
      setMessage(sizeResolution.reason ?? "The copied size does not fit the selected surface.");
      return;
    }

    const sizingPatch = buttonPlacementSizingPatch(copiedButtonSizing);
    store.transact((draft) => {
      draft.surfaces[surface.id].uniformButtonSize = null;
      sizeResolution.placements.forEach((placement) => {
        const target = draft.placements[placement.id];
        if (!target) return;
        Object.assign(target, {
          ...placement.rect,
          ...(targetSet.has(placement.id) ? sizingPatch : {})
        });
      });
    }, { label: "Add copied Button size to selection" });
    setMessage(
      `Added ${formatButtonSize(copiedButtonSizing.width, copiedButtonSizing.height)} to ${targetPlacementIds.length} selected Button${targetPlacementIds.length === 1 ? "" : "s"}.${sizeResolution.reflowed ? " Neighbor positions were adjusted within the existing rows." : ""} Use Save Settings to commit it.`
    );
  }, [copiedButtonSizing, selectedPlacementIds, selectedSurfaceId, store]);

  const snapSelectedSurfaceToTopLeft = useCallback(() => {
    const document = store.current();
    const surface = document.surfaces[selectedSurfaceId];
    if (!surface) {
      setMessage("Select a Button surface before aligning its Buttons.");
      return;
    }
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === surface.id
    );
    const unitOwnerPlacementId = unit &&
      "ownerPlacementId" in unit &&
      typeof unit.ownerPlacementId === "string"
        ? unit.ownerPlacementId
        : null;
    const legacyFanSetup = Object.values(document.fanSetups).find(
      (candidate) => candidate.fanSurfaceId === surface.id
    );
    const legacyFanOwnerPlacementId = legacyFanSetup
      ? surface.placementIds.find((placementId) =>
          document.placements[placementId]?.buttonId === legacyFanSetup.panelOwnerButtonId
        ) ?? null
      : null;
    const ownerPlacementId = unitOwnerPlacementId ?? legacyFanOwnerPlacementId;
    const unitShowsOwner = Boolean(
      unit && "interactionMode" in unit && unit.interactionMode === "fan"
    );
    const hiddenOwnerPlacementId = unitOwnerPlacementId && !unitShowsOwner
      ? unitOwnerPlacementId
      : null;
    const layoutPlacementIds = surface.placementIds.filter(
      (placementId) => placementId !== hiddenOwnerPlacementId
    );
    const selectedIds = layoutPlacementIds.filter((placementId) =>
      selectedPlacementIds.has(placementId) && placementId !== ownerPlacementId
    );
    const items = selectedIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement
        ? [{ id: placement.id, rect: placement }]
        : [];
    });
    if (items.length === 0) {
      setMessage("Select one or more content Buttons; the Fan owner stays independent.");
      return;
    }
    if (items.length !== selectedIds.length) {
      setMessage("A selected Button placement disappeared before it could be aligned.");
      return;
    }
    const anchor = [...items].sort((left, right) =>
      left.rect.y - right.rect.y ||
      left.rect.x - right.rect.x ||
      (document.placements[left.id]?.zIndex ?? 0) -
        (document.placements[right.id]?.zIndex ?? 0) ||
      left.id.localeCompare(right.id)
    )[0];
    const translated = translateButtonPlacementRects(items, {
      x: -anchor.rect.x,
      y: -anchor.rect.y
    });
    const translatedById = new Map(translated.map((placement) => [placement.id, placement.rect]));
    const completeLayout = layoutPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      if (!placement) return [];
      return [{
        id: placement.id,
        rect: translatedById.get(placement.id) ?? placement
      }];
    });
    if (completeLayout.length !== layoutPlacementIds.length) {
      setMessage("The selected surface contains a missing Button placement.");
      return;
    }
    const geometryIssues = validateExactButtonLayoutGeometry(
      completeLayout.filter((placement) => placement.id !== ownerPlacementId),
      surface
    );
    if (geometryIssues.length > 0) {
      setMessage(
        "The selected Buttons cannot align by their top-left Button without leaving the surface or overlapping another Button."
      );
      return;
    }
    if (translated.every((placement) => {
      const current = document.placements[placement.id];
      return current &&
        Math.abs(current.x - placement.rect.x) <= 0.001 &&
        Math.abs(current.y - placement.rect.y) <= 0.001;
    })) {
      setMessage(null);
      return;
    }
    store.transact((draft) => {
      translated.forEach((placement) => {
        const target = draft.placements[placement.id];
        if (!target) return;
        target.x = placement.rect.x;
        target.y = placement.rect.y;
      });
    }, { label: "Align top-left Button to corner" });
    setMessage(null);
  }, [selectedPlacementIds, selectedSurfaceId, store]);

  const alignSelectionToTopLeftButton = useCallback(() => {
    const document = store.current();
    const surface = document.surfaces[selectedSurfaceId];
    if (!surface) {
      setMessage("Select a Button surface before aligning its Buttons.");
      return;
    }
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === surface.id
    );
    const unitOwnerPlacementId = unit &&
      "ownerPlacementId" in unit &&
      typeof unit.ownerPlacementId === "string"
        ? unit.ownerPlacementId
        : null;
    const legacyFanSetup = Object.values(document.fanSetups).find(
      (candidate) => candidate.fanSurfaceId === surface.id
    );
    const legacyFanOwnerPlacementId = legacyFanSetup
      ? surface.placementIds.find((placementId) =>
          document.placements[placementId]?.buttonId === legacyFanSetup.panelOwnerButtonId
        ) ?? null
      : null;
    const ownerPlacementId = unitOwnerPlacementId ?? legacyFanOwnerPlacementId;
    const unitShowsOwner = Boolean(
      unit && "interactionMode" in unit && unit.interactionMode === "fan"
    );
    const hiddenOwnerPlacementId = unitOwnerPlacementId && !unitShowsOwner
      ? unitOwnerPlacementId
      : null;
    const visiblePlacementIds = surface.placementIds.filter(
      (placementId) => placementId !== hiddenOwnerPlacementId
    );
    const targetPlacementIds = visiblePlacementIds.filter((placementId) =>
      selectedPlacementIds.has(placementId)
    );
    if (targetPlacementIds.length === 0) {
      setMessage("Select one or more Buttons before aligning to the top-left Button.");
      return;
    }
    const currentLayout = visiblePlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement ? [{ id: placement.id, rect: placement }] : [];
    });
    if (currentLayout.length !== visiblePlacementIds.length) {
      setMessage("The selected surface contains a missing Button placement.");
      return;
    }
    const alignment = alignButtonPlacementSelectionToTopLeftButton({
      placements: currentLayout,
      selectedPlacementIds: targetPlacementIds,
      surface,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      independentPlacementIds: ownerPlacementId && visiblePlacementIds.includes(ownerPlacementId)
        ? [ownerPlacementId]
        : []
    });
    if (!alignment.success) {
      setMessage(alignment.reason ?? "The selected Buttons cannot align to their top-left Button.");
      return;
    }
    if (!alignment.changed) {
      setMessage(null);
      return;
    }
    const targetSet = new Set(targetPlacementIds);
    store.transact((draft) => {
      alignment.placements.forEach((placement) => {
        if (!targetSet.has(placement.id) || placement.id === ownerPlacementId) return;
        const target = draft.placements[placement.id];
        if (!target) return;
        target.x = placement.rect.x;
        target.y = placement.rect.y;
      });
    }, { label: "Align to the Top Left button" });
    setMessage(null);
  }, [selectedPlacementIds, selectedSurfaceId, store]);

  const handleNaturalMeasurement = (placementId: string, measurement: ButtonCoreMeasurement) => {
    const document = store.current();
    const placement = document.placements[placementId];
    const surface = placement && document.surfaces[placement.surfaceId];
    if (!placement || !surface) return;
    const button = document.buttons[placement.buttonId];
    const sourceSkinId = placement.skinOverrideId ?? button?.defaultSkinId;
    if (!button || !sourceSkinId) return;
    naturalCoreMeasurementsRef.current.set(placementId, {
      measurement,
      sourceSkinId,
      sourceLabel: button.label,
      sourceTextSizeOverride: placement.textSizeOverride
    });
    if (surface.uniformButtonSize) {
      return;
    }
    const desiredWidth = Math.max(1, snapToGrid(Math.ceil(measurement.width), document.settings.gridSize));
    const desiredHeight = Math.max(1, snapToGrid(Math.ceil(measurement.height), document.settings.gridSize));
    const isFresh = freshPlacementsRef.current.delete(placementId);
    if (!isFresh) return;
    const otherRects = surface.placementIds.filter((id) => id !== placementId).map((id) => document.placements[id]).filter(Boolean);
    const target = findFirstAvailableButtonPosition({
      width: desiredWidth,
      height: desiredHeight,
      surface,
      otherRects,
      padding: document.settings.defaultSurfacePadding,
      gap: buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm),
      gridSize: document.settings.gridSize
    });
    if (target) store.transact((draft) => { Object.assign(draft.placements[placementId], target); }, { label: "Measure new Button" });
  };

  const selectWorkspacePlacement = useCallback((
    placementId: string,
    event: PointerEvent | KeyboardEvent
  ) => {
    const current = new Set(selectedSetForSurface);
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      const next = new Set(current);
      if (next.has(placementId)) next.delete(placementId);
      else next.add(placementId);
      setSelectedPlacementIds(next);
      if (next.has(placementId)) {
        focusPlacement(placementId, false);
      } else if (focusedPlacementId === placementId) {
        const fallbackId = [...next][0] ?? null;
        if (fallbackId) focusPlacement(fallbackId, false);
        else setFocusedPlacementId(null);
      }
      return;
    }
    if (current.size > 1 && current.has(placementId)) {
      focusPlacement(placementId, false);
      return;
    }
    focusPlacement(placementId);
  }, [focusPlacement, focusedPlacementId, selectedSetForSurface]);

  const selectWorkspacePlacements = useCallback((
    placementIds: readonly string[],
    selectionMode: ButtonWorkspaceSelectionMode
  ) => {
    const document = store.current();
    const candidates = placementIds.filter((placementId) =>
      document.placements[placementId]?.surfaceId === selectedSurfaceId
    );
    const next = selectionMode === "replace"
      ? new Set<string>()
      : new Set(selectedSetForSurface);
    if (selectionMode === "toggle") {
      candidates.forEach((placementId) => {
        if (next.has(placementId)) next.delete(placementId);
        else next.add(placementId);
      });
    } else {
      candidates.forEach((placementId) => next.add(placementId));
    }
    setSelectedPlacementIds(next);
    const nextFocusId = focusedPlacementId && next.has(focusedPlacementId)
      ? focusedPlacementId
      : [...candidates].reverse().find((placementId) => next.has(placementId)) ??
        [...next][0] ??
        null;
    if (nextFocusId) focusPlacement(nextFocusId, false);
    else setFocusedPlacementId(null);
  }, [focusPlacement, focusedPlacementId, selectedSetForSurface, selectedSurfaceId, store]);

  const updatePlacementRects = useCallback((
    surfaceId: string,
    placements: readonly NamedButtonRect[]
  ) => {
    if (placements.length === 0) return;
    const document = store.current();
    const surface = document.surfaces[surfaceId];
    if (!surface) {
      setMessage("The selected Button surface no longer exists.");
      return;
    }
    const placementById = new Map(placements.map((placement) => [placement.id, placement.rect]));
    if (
      placementById.size !== placements.length ||
      placements.some((placement) => document.placements[placement.id]?.surfaceId !== surfaceId)
    ) {
      setMessage("The Button selection changed while it was being moved.");
      return;
    }
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === surfaceId
    );
    const ownerPlacementId = unit && "ownerPlacementId" in unit && typeof unit.ownerPlacementId === "string"
      ? unit.ownerPlacementId
      : null;
    const ownerVisible = Boolean(
      unit && "interactionMode" in unit && unit.interactionMode === "fan"
    );
    const layoutPlacementIds = surface.placementIds.filter((placementId) =>
      !(placementId === ownerPlacementId && !ownerVisible)
    );
    const completeLayout = layoutPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      if (!placement) return [];
      const moved = placementById.get(placementId);
      return [{
        id: placement.id,
        rect: moved
          ? { ...placement, x: moved.x, y: moved.y }
          : placement
      }];
    });
    if (completeLayout.length !== layoutPlacementIds.length) {
      setMessage("A Button placement disappeared while the selection was being moved.");
      return;
    }
    const geometryIssues = validateExactButtonLayoutGeometry(
      completeLayout.filter((placement) => placement.id !== ownerPlacementId),
      surface
    );
    if (geometryIssues.length > 0) {
      setMessage(geometryIssues[0].message);
      return;
    }
    const changed = placements.some((placement) => {
      const current = document.placements[placement.id];
      return current && (
        Math.abs(current.x - placement.rect.x) > 0.001 ||
        Math.abs(current.y - placement.rect.y) > 0.001
      );
    });
    if (!changed) return;
    store.transact((draft) => {
      placements.forEach((placement) => {
        const target = draft.placements[placement.id];
        if (!target || target.surfaceId !== surfaceId) return;
        target.x = placement.rect.x;
        target.y = placement.rect.y;
      });
    }, { label: "Move selected Buttons" });
    setMessage(null);
  }, [store]);

  const persistButtonAnimation = async (
    nextDraft: ButtonStateDocument,
    buttonId: string,
    successMessage: string
  ): Promise<boolean> => {
    const animation = structuredClone(nextDraft.buttons[buttonId]?.activationAnimation ?? null);
    if (!store.committed.buttons[buttonId]) {
      store.transact((draft) => {
        const target = draft.buttons[buttonId];
        if (target) target.activationAnimation = animation;
      }, { label: "Edit Button animation" });
      setMessage(`${successMessage} Save Settings first because this is a new Button.`);
      return false;
    }
    const frozenDraft = cloneButtonDocument(nextDraft);
    return Boolean(await commitScopedDocument(
      (committed) => buildButtonAnimationScopedDocument(committed, frozenDraft, buttonId),
      (draft, saved) => applyButtonAnimationSavedScope(draft, saved, buttonId),
      successMessage
    ));
  };

  const configureButtonAnimation = async (
    button: ButtonRecord,
    presetId: ButtonActivationAnimationPresetId,
    bounds = button.activationAnimation?.presetId === presetId
      ? button.activationAnimation.desktopBounds
      : null
  ) => {
    try {
      setMessage(null);
      const resolvedBounds = await openButtonActivationAnimationEditor({
        buttonId: button.id,
        presetId,
        bounds
      });
      const current = store.current().buttons[button.id];
      if (!current) return;
      const draftAlreadyMatches = current.activationAnimation?.presetId === presetId &&
        desktopBoundsEqual(current.activationAnimation.desktopBounds, resolvedBounds);
      const committedAnimation = store.committed.buttons[button.id]?.activationAnimation;
      const committedAlreadyMatches = committedAnimation?.presetId === presetId &&
        desktopBoundsEqual(committedAnimation.desktopBounds, resolvedBounds);
      if (draftAlreadyMatches && committedAlreadyMatches) {
        setActiveAnimationEditorButtonId(button.id);
        return;
      }
      const nextDraft = cloneButtonDocument(store.current());
      nextDraft.buttons[button.id].activationAnimation = {
        presetId,
        desktopBounds: resolvedBounds
      };
      await persistButtonAnimation(nextDraft, button.id, "Animation applied.");
      setActiveAnimationEditorButtonId(button.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const saveButtonAnimationBounds = async (button: ButtonRecord) => {
    const animation = button.activationAnimation;
    if (!animation) return;
    try {
      const bounds = await saveButtonActivationAnimationEditorBounds();
      const nextDraft = cloneButtonDocument(store.current());
      const target = nextDraft.buttons[button.id];
      if (!target?.activationAnimation) return;
      target.activationAnimation.desktopBounds = bounds;
      await persistButtonAnimation(
        nextDraft,
        button.id,
        "Animation position and size saved."
      );
      setActiveAnimationEditorButtonId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const closeButtonAnimationEditor = async () => {
    await hideButtonActivationAnimationEditorWindow().catch(() => {});
    setActiveAnimationEditorButtonId(null);
  };

  const applyAnimationSelection = async (
    presetId: ButtonActivationAnimationPresetId | null
  ) => {
    const button = selectedButton;
    if (!button) return;
    if (!presetId) {
      const nextDraft = cloneButtonDocument(store.current());
      const target = nextDraft.buttons[button.id];
      if (target) target.activationAnimation = null;
      await persistButtonAnimation(nextDraft, button.id, "No animation applied.");
      await hideButtonActivationAnimationEditorWindow().catch(() => {});
      setActiveAnimationEditorButtonId(null);
      return;
    }
    if (
      activeAnimationEditorButtonId === button.id &&
      button.activationAnimation?.presetId === presetId
    ) {
      setMessage("This animation is already applied and its position-and-size setup is open.");
      return;
    }
    await configureButtonAnimation(button, presetId);
  };

  const applyAllButtonText = async () => {
    const draft = store.current();
    const committed = store.committed;
    const draftPlacements = Object.values(draft.placements);
    if (draftPlacements.some((placement) =>
      !committed.placements[placement.id] ||
      !committed.buttons[placement.buttonId]
    )) {
      setMessage("Save Settings first because the editor contains a new Button placement.");
      return;
    }
    if (draftPlacements.some((placement) =>
      !buttonActivationCycleStructureMatches(
        committed.placements[placement.id]?.activationCycle ?? null,
        placement.activationCycle
      )
    )) {
      setMessage("Save Settings first because one or more cycle state structures changed.");
      return;
    }
    const scope = {
      entries: draftPlacements.map((placement) => ({
        buttonId: placement.buttonId,
        placementId: placement.id
      }))
    };
    const frozenDraft = cloneButtonDocument(draft);
    await commitScopedDocument(
      (latest) => buildButtonTextScopedDocument(latest, frozenDraft, scope),
      (draft, saved) => applyButtonTextSavedScope(draft, saved, scope),
      `Button Text applied to ${scope.entries.length} placement${scope.entries.length === 1 ? "" : "s"}.`
    );
  };

  const chooseWorkingSkinSavePath = async (workingSkin: ButtonSkin): Promise<string | null> => {
    const skinDirectory = await getButtonSkinDirectory();
    return showSaveFileDialog({
      title: "Save Button Skin As",
      filter: "FlowCell Button Skin (*.flowcell-button-skin.txt)|*.flowcell-button-skin.txt|Text Files (*.txt)|*.txt",
      defaultFileName: defaultButtonSkinFileName(workingSkin.name),
      initialDirectory: skinDirectory
    });
  };

  const loadWorkingSkinFile = async (
    requestedPath: string | null,
    preferredSkinId?: string
  ): Promise<ButtonSkinFileResult | null> => {
    if (busyRef.current) return null;
    setBusy(true);
    setMessage(null);
    try {
      let selectedPath = requestedPath;
      if (!selectedPath) {
        const skinDirectory = await getButtonSkinDirectory();
        selectedPath = (await showOpenFileDialog({
          title: "Load Button Skin",
          filter: "FlowCell Button Skin (*.flowcell-button-skin.txt)|*.flowcell-button-skin.txt|Text Files (*.txt)|*.txt",
          initialDirectory: skinDirectory,
          multiselect: false
        }))[0] ?? null;
      }
      if (!selectedPath?.trim()) return null;

      const document = store.current();
      const linkedSkinId = preferredSkinId ??
        findButtonSkinRecentFileByPath(recentSkinFiles, selectedPath)?.skinId;
      const existingSkin = linkedSkinId
        ? document.skins[linkedSkinId] ?? null
        : null;
      const skinId = existingSkin?.id ?? createStableButtonId("skin");
      const source = await loadButtonSkinFile(selectedPath);
      const loadedSkin = createButtonSkinFromFile(
        source,
        selectedPath,
        skinId,
        existingSkin
      );
      rememberSkinFile(selectedPath, loadedSkin.id);
      setMessage(
        `Skin '${loadedSkin.name}' loaded from ${selectedPath} as a working copy. Use Assign Skin to apply it.`
      );
      return { skin: loadedSkin, path: selectedPath };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveWorkingSkin = async (
    workingSkin: ButtonSkin,
    currentPath: string | null
  ): Promise<ButtonSkinFileResult | null> => {
    if (busyRef.current) return null;
    setBusy(true);
    try {
      const targetPath = currentPath ?? await chooseWorkingSkinSavePath(workingSkin);
      if (!targetPath) return null;
      const writtenPath = await saveButtonSkinFile(
        targetPath,
        serializeButtonSkinSections(workingSkin)
      );
      const nextDraft = cloneButtonDocument(store.current());
      nextDraft.skins[workingSkin.id] = cloneButtonDocument(workingSkin);
      const scope: ButtonSkinSaveScope = {
        skinIds: [workingSkin.id]
      };
      const frozenDraft = cloneButtonDocument(nextDraft);
      await commitScopedDocument(
        (committed) => buildButtonSkinScopedDocument(committed, frozenDraft, scope),
        (draft, canonical) => applyButtonSkinSavedScope(draft, canonical, scope),
        `Skin '${workingSkin.name}' saved to ${writtenPath}.`,
        `The skin file was saved to ${writtenPath}, but FlowCell could not update its skin library.`,
        `The skin file and skin library were saved, but FlowCell could not finish refreshing the editor and other windows.`
      );
      rememberSkinFile(writtenPath, workingSkin.id);
      return {
        skin: cloneButtonDocument(workingSkin),
        path: writtenPath
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveWorkingSkinAsNew = async (
    workingSkin: ButtonSkin
  ): Promise<ButtonSkinFileResult | null> => {
    if (busyRef.current) return null;
    setBusy(true);
    try {
      const id = createStableButtonId("skin");
      const targetPath = await chooseWorkingSkinSavePath(workingSkin);
      if (!targetPath) return null;
      const writtenPath = await saveButtonSkinFile(
        targetPath,
        serializeButtonSkinSections(workingSkin)
      );
      const duplicate: ButtonSkin = {
        ...cloneButtonDocument(workingSkin),
        id,
        name: buttonSkinNameFromPath(writtenPath)
      };
      const nextDraft = cloneButtonDocument(store.current());
      nextDraft.skins[id] = duplicate;
      const scope: ButtonSkinSaveScope = { skinIds: [id] };
      const frozenDraft = cloneButtonDocument(nextDraft);
      await commitScopedDocument(
        (committed) => buildButtonSkinScopedDocument(committed, frozenDraft, scope),
        (draft, canonical) => applyButtonSkinSavedScope(draft, canonical, scope),
        `Skin '${duplicate.name}' saved as a new skin at ${writtenPath}.`,
        `The new skin file was saved to ${writtenPath}, but FlowCell could not add it to the skin library.`,
        `The new skin file and skin library entry were saved, but FlowCell could not finish refreshing the editor and other windows.`
      );
      rememberSkinFile(writtenPath, duplicate.id);
      return {
        skin: duplicate,
        path: writtenPath
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const assignWorkingSkin = async (
    workingSkin: ButtonSkin,
    targetPlacementIds: readonly string[],
    assignmentName: string,
    forkName: string,
    sizingMode: ButtonPlacementSizingMode
  ) => {
    if (targetPlacementIds.length === 0) {
      setMessage("The selected placement surface has no Buttons to assign.");
      return;
    }
    const unsavedTarget = targetPlacementIds.find((placementId) =>
      !store.committed.placements[placementId]
    );
    if (unsavedTarget) {
      const placement = store.current().placements[unsavedTarget];
      const surface = placement ? store.current().surfaces[placement.surfaceId] : null;
      const saveLabel = surface
        ? `Save ${buttonSettingsPlacementLabel(buttonSettingsPlacementKind(surface))} Settings`
        : "Save Settings";
      setMessage(`Finish adding this new Button with ${saveLabel} before assigning its skin.`);
      return;
    }

    const nextDraft = cloneButtonDocument(store.current());
    const storedSkin = nextDraft.skins[workingSkin.id];
    const allowedPlacementIds = new Set(targetPlacementIds);
    const mustFork = Boolean(
      storedSkin &&
      !buttonSkinsEqual(storedSkin, workingSkin) &&
      skinHasReferencesOutsidePlacements(nextDraft, workingSkin.id, allowedPlacementIds)
    );
    const assignedSkin: ButtonSkin = mustFork
      ? {
          ...cloneButtonDocument(workingSkin),
          id: createStableButtonId("skin"),
          name: `${workingSkin.name} — ${forkName}`
        }
      : cloneButtonDocument(workingSkin);
    nextDraft.skins[assignedSkin.id] = assignedSkin;
    targetPlacementIds.forEach((placementId) => {
      nextDraft.placements[placementId].skinOverrideId = assignedSkin.id;
    });
    const scope: ButtonSkinSaveScope = {
      skinIds: [assignedSkin.id],
      placementIds: targetPlacementIds,
      sizingMode
    };
    const frozenDraft = cloneButtonDocument(nextDraft);
    await commitScopedDocument(
      (committed) => buildButtonSkinScopedDocument(committed, frozenDraft, scope),
      (draft, saved) => applyButtonSkinSavedScope(draft, saved, scope),
      assignmentName
    );
  };

  const activateOwnerButton = async (placementId: string, button: ButtonRecord) => {
    try {
      const exactFanUnit = Object.values(store.current().popoutUnits).find(
        (candidate) =>
          candidate.interactionMode === "fan" &&
          candidate.ownerPlacementId === placementId &&
          candidate.ownerButtonId === button.id
      );
      if (exactFanUnit) {
        const identity = resolveButtonEditorIdentity(store.current(), button.id);
        const ownerProgramName = identity?.programName || programName;
        const ownerPanelName = identity?.panelName || panelName;
        if (!ownerProgramName) {
          throw new Error(`Fan owner '${button.label}' has no program identity.`);
        }
        await openButtonPopoutWindow({
          programName: ownerProgramName,
          panelName: ownerPanelName || undefined,
          popoutUnitId: exactFanUnit.id,
          ownerButtonId: button.id,
          draftSessionId: sessionIdRef.current,
          displayMode: "collapsed"
        });
        await publishButtonDraftToWindow(
          sessionIdRef.current,
          buildButtonPopoutWindowLabel({
            popoutUnitId: exactFanUnit.id,
            ownerButtonId: button.id
          }),
          store.current()
        );
        return;
      }
      if (button.role === "tool-set-owner") {
        const unit = Object.values(store.current().popoutUnits).find(
          (candidate) => candidate.kind === "tool-set" && candidate.ownerButtonId === button.id
        );
        if (!unit) throw new Error(`Tool-set owner '${button.label}' has no canonical popout unit.`);
        const identity = button.sourceIdentity;
        const ownerProgramName = identity?.displayProgramName || programName;
        const ownerPanelName = identity?.displayPanelName || panelName;
        const authoredFan = "interactionMode" in unit &&
          unit.interactionMode === "fan" &&
          "ownerPlacementId" in unit &&
          typeof unit.ownerPlacementId === "string";
        if (!ownerProgramName) throw new Error(`Tool-set owner '${button.label}' has no program identity.`);
        await openButtonPopoutWindow({
          programName: ownerProgramName,
          panelName: ownerPanelName || undefined,
          popoutUnitId: unit.id,
          ownerButtonId: button.id,
          draftSessionId: sessionIdRef.current,
          displayMode: authoredFan ? "collapsed" : "expanded",
          bounds: !authoredFan && unit.desktopBounds
            ? {
                Left: unit.desktopBounds.left,
                Top: unit.desktopBounds.top,
                Width: unit.desktopBounds.width,
                Height: unit.desktopBounds.height
              }
            : undefined
        });
        await publishButtonDraftToWindow(
          sessionIdRef.current,
          buildButtonPopoutWindowLabel({ popoutUnitId: unit.id, ownerButtonId: button.id }),
          store.current()
        );
        return;
      }
      if (button.role === "panel-owner") {
        const setups = Object.values(store.current().fanSetups).filter(
          (candidate) => candidate.panelOwnerButtonId === button.id
        );
        const setup = setups.find(
          (candidate) => candidate.fanSurfaceId === selectedSurfaceId
        ) ?? setups[0];
        if (!setup) throw new Error(`Panel owner '${button.label}' has no canonical fan setup.`);
        await openButtonFanWindow({
          programName: setup.programName,
          panelName: setup.panelName,
          fanSetupId: setup.id,
          panelOwnerButtonId: button.id,
          draftSessionId: sessionIdRef.current,
          collapsedBounds: setup.collapsedPanelOwnerBounds
            ? {
                Left: setup.collapsedPanelOwnerBounds.left,
                Top: setup.collapsedPanelOwnerBounds.top,
                Width: setup.collapsedPanelOwnerBounds.width,
                Height: setup.collapsedPanelOwnerBounds.height
              }
            : null
        });
        await publishButtonDraftToWindow(
          sessionIdRef.current,
          buildButtonFanWindowLabel(button.id),
          store.current()
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  return (
    <main className="button-editor-page">
      <ButtonEditorTitlebar />
      <div className="button-editor-layout">
        <aside className="button-editor-sidebar">
          <div className="button-editor-sidebar__heading">
            <span>Editor</span>
            <h1>Buttons</h1>
          </div>
          <ButtonSurfaceSelector
            programs={programOptions}
            panels={panelOptions}
            buttonOptions={buttonOptions}
            placementOptions={placementOptions}
            programName={programName}
            panelName={panelName}
            navigationLocked={Boolean(lockedImportDestination)}
            buttonId={navigationButtonId}
            placementId={selectedPlacementOptionId}
            onProgramChange={(value) => {
              setProgramName(value);
              setPanelName("");
              setPanels([]);
              setSelectedSurfaceId("");
              setFocusedPlacementId(null);
              setSelectedPlacementIds(new Set());
            }}
            onPanelChange={(value) => {
              setPanelName(value);
              setSelectedSurfaceId(
                resolveButtonEditorPanelSurfaceId(store.current(), programName, value) ?? ""
              );
              setFocusedPlacementId(null);
              setSelectedPlacementIds(new Set());
            }}
            onButtonChange={selectButton}
            onPlacementChange={(optionId) => {
              const option = placementOptions.find((candidate) => candidate.id === optionId);
              if (option?.view === "tool-set-popout") {
                selectPopoutPlacementMode(option.surfaceId, "pop");
              } else if (option?.view === "tool-set-fan") {
                selectPopoutPlacementMode(option.surfaceId, "fan");
              } else if (option?.placementId) {
                focusPlacement(option.placementId);
              } else {
                setFocusedPlacementId(null);
                setSelectedPlacementIds(new Set());
              }
            }}
          />
          <div className="button-editor-sidebar__actions">
            {settingsPlacementKind === "pop-out" && selectedSurfaceUnit?.kind === "regular" ? (
              <label className="button-editor-check button-editor-sidebar__fan">
                <input
                  type="checkbox"
                  checked={selectedSurfaceShowsOwner}
                  disabled={busy}
                  onChange={(event) => selectPopoutPlacementMode(
                    selectedSurfaceId,
                    event.currentTarget.checked ? "fan" : "pop"
                  )}
                />
                <span>Fan</span>
              </label>
            ) : null}
            <button
              type="button"
              className="button-editor-sidebar__placement-file"
              disabled={busy || !settingsPlacementKind}
              onClick={() => void saveSettings()}
            >
              Save {settingsPlacementLabel} Settings
            </button>
            <button
              type="button"
              className="button-editor-sidebar__placement-file"
              disabled={busy || !settingsPlacementKind}
              onClick={() => void loadSettings()}
            >
              Load {settingsPlacementLabel} Settings
            </button>
            <button
              type="button"
              className="button-editor-sidebar__placement-file"
              disabled={busy || !settingsPlacementKind}
              onClick={() => void loadDefaultSettings()}
            >
              Load {settingsPlacementLabel} Default
            </button>
            <button
              type="button"
              className="button-editor-sidebar__placement-file"
              disabled={busy || !settingsPlacementKind}
              onClick={() => void updateDefaultSettings()}
            >
              Update {settingsPlacementLabel} Default
            </button>
            <label className="button-editor-mode button-editor-sidebar__mode">
              <span>Edit</span>
              <input
                type="checkbox"
                checked={mode === "run"}
                disabled={busy}
                onChange={(event) => {
                  if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                  const nextMode = event.currentTarget.checked ? "run" : "edit";
                  setActivePage("placement");
                  setMode(nextMode);
                  if (nextMode === "run") setReorderMode(false);
                }}
              />
              <span>Run</span>
            </label>
            <button
              type="button"
              className={activePage === "placement" && reorderMode ? "is-active" : undefined}
              aria-pressed={reorderMode}
              disabled={mainPageControlScope || mode !== "edit" || selectedSurfaceButtonCount < 2 || busy}
              onClick={() => {
                if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                setActivePage("placement");
                setReorderMode((current) => !current);
              }}
            >
              Re-order
            </button>
            <section
              className="button-editor-sidebar__selection"
              aria-live="polite"
              aria-label="Selected Buttons"
            >
              <div className="button-editor-sidebar__selection-heading">
                <strong>Selected Buttons</strong>
                <span>{selectedPlacementSummaries.length}</span>
              </div>
              {selectedPlacementSummaries.length > 0 ? (
                <ul>
                  {selectedPlacementSummaries.map((entry) => (
                    <li
                      key={entry.placementId}
                      className={entry.placementId === focusedPlacementId ? "is-focused" : undefined}
                    >
                      <span>{entry.label}</span>
                      {entry.placementId === focusedPlacementId ? <em>editing</em> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No Buttons selected.</p>
              )}
              <small>Shift-click or Shift-drag toggles Buttons in this selection.</small>
            </section>
            <button
              type="button"
              disabled={mainPageControlScope || mode !== "edit" || selectedSetForSurface.size === 0 || busy}
              onClick={() => {
                if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                setActivePage("placement");
                setReorderMode(false);
                snapSelectedSurfaceToTopLeft();
              }}
            >
              Align top-left Button to corner
            </button>
            <button
              type="button"
              disabled={mainPageControlScope || mode !== "edit" || selectedSetForSurface.size === 0 || busy}
              onClick={() => {
                if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                setActivePage("placement");
                setReorderMode(false);
                alignSelectionToTopLeftButton();
              }}
            >
              Align to the Top Left button
            </button>
            <button
              type="button"
              className={activePage === "animation" ? "is-active" : undefined}
              aria-pressed={activePage === "animation"}
              disabled={!selectedButton || busy}
              onClick={() => {
                setActivePage("animation");
                setReorderMode(false);
              }}
            >
              Animation
            </button>
            <label className="button-editor-check button-editor-sidebar__same-size">
              <input
                type="checkbox"
                checked={allSurfaceButtonsSameSize}
                disabled={!selectedPlacement || busy}
                onChange={(event) => setAllSurfaceButtonsSameSize(event.currentTarget.checked)}
              />
              <span>Same size Buttons</span>
            </label>
            <fieldset className="button-editor-sidebar__sizing">
              <legend>Button Sizing</legend>
              <div className="button-editor-sidebar__size-copy-actions">
                <button
                  type="button"
                  title="Copy the focused Button's exact width, height, and sizing behavior."
                  disabled={!selectedPlacement || busy}
                  onClick={copyFocusedButtonDimensions}
                >
                  Copy dimensions
                </button>
                <button
                  type="button"
                  title={!copiedButtonSizing
                    ? "Copy a Button's dimensions first."
                    : "Apply the copied width, height, and sizing behavior to every selected Button without moving them."}
                  disabled={
                    !copiedButtonSizing ||
                    selectedSetForSurface.size === 0 ||
                    busy
                  }
                  onClick={addCopiedSizeToSelection}
                >
                  Add size to selection
                </button>
              </div>
              <span className="button-editor-sidebar__copied-size">
                {copiedButtonSizing
                  ? `Copied: ${formatButtonSize(copiedButtonSizing.width, copiedButtonSizing.height)} from '${copiedButtonSizing.sourceButtonLabel}' (${copiedButtonSizing.sizingMode}).`
                  : "No Button dimensions copied yet."}
              </span>
              <label htmlFor="button-spacing-mm">
                <span>Button spacing (mm)</span>
                <input
                  id="button-spacing-mm"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={buttonSpacingInput}
                  disabled={busy}
                  aria-describedby="button-spacing-mm-help"
                  onChange={(event) => setButtonSpacingInput(event.currentTarget.value)}
                  onBlur={commitButtonSpacing}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitButtonSpacing();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      setButtonSpacingInput(String(store.current().settings.buttonSpacingMm));
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <span id="button-spacing-mm-help">
                Horizontal and vertical for layout actions and new Buttons. Zero
                keeps Button edges flush.
              </span>
            </fieldset>
          </div>
          {message && <pre className="button-editor-message">{message}</pre>}
        </aside>
        {activePage === "animation" ? (
          <ButtonAnimationPickerPage
            button={selectedButton}
            busy={busy}
            setupOpen={activeAnimationEditorButtonId === selectedButton?.id}
            onClose={() => {
              void closeButtonAnimationEditor();
              setActivePage("placement");
            }}
            onApply={applyAnimationSelection}
            onPositionAndSize={() => {
              if (!selectedButton?.activationAnimation) return;
              void configureButtonAnimation(
                selectedButton,
                selectedButton.activationAnimation.presetId,
                selectedButton.activationAnimation.desktopBounds
              );
            }}
            onSavePositionAndSize={() => {
              if (!selectedButton) return;
              void saveButtonAnimationBounds(selectedButton);
            }}
            onCloseSetup={() => void closeButtonAnimationEditor()}
          />
        ) : (
          <ButtonWorkspace
            document={store.draft}
            surfaceId={selectedSurfaceId}
            mode={mode}
            selectedPlacementIds={selectedSetForSurface}
            focusedPlacementId={focusedPlacementId}
            onSelectPlacement={selectWorkspacePlacement}
            onSelectPlacements={selectWorkspacePlacements}
            onPlacementRectChange={updatePlacementRect}
            onPlacementRectsChange={updatePlacementRects}
            onPlacementNaturalMeasurement={handleNaturalMeasurement}
            onOwnerActivate={activateOwnerButton}
            selectedPlacementSizingMode={selectedWorkingSizingMode}
            reorderMode={reorderMode}
            onPlacementOrderChange={applyPlacementOrder}
          />
        )}
        <ButtonSkinEditor
          skin={selectedSkin}
          skins={Object.values(store.draft.skins)}
          recentSkinFiles={recentSkinFiles}
          skinFilePath={selectedSkinFilePath}
          skinContextKey={selectedPlacement?.id ?? ""}
          busy={busy}
          placement={selectedPlacement}
          surfaceButtonCount={selectedSurfaceButtonCount}
          selectionButtonCount={selectedPlacementSummaries.length}
          allSurfaceButtonsSameSize={allSurfaceButtonsSameSize}
          buttonLabel={selectedButton?.label ?? "Button Preview"}
          buttonTooltip={selectedButton?.tooltip ?? ""}
          activationCycle={selectedPlacement?.activationCycle ?? null}
          stateStructureApplied={selectedStateStructureApplied}
          onButtonLabelChange={(label) => {
            if (!selectedButton) return;
            store.transact((draft) => {
              const target = draft.buttons[selectedButton.id];
              target.label = label;
            }, { label: "Edit Button label", coalesceKey: `label:${selectedButton.id}` });
          }}
          onButtonTooltipChange={(tooltip) => {
            if (!selectedButton) return;
            store.transact((draft) => {
              const target = draft.buttons[selectedButton.id];
              target.tooltip = tooltip;
            }, { label: "Edit Button tooltip", coalesceKey: `tooltip:${selectedButton.id}` });
          }}
          onActivationCycleChange={(activationCycle) => {
            if (!selectedPlacement) return;
            store.transact((draft) => {
              draft.placements[selectedPlacement.id].activationCycle = cloneButtonDocument(activationCycle);
            }, {
              label: "Edit Button placement cycle",
              coalesceKey: `activation-cycle:${selectedPlacement.id}`
            });
          }}
          onApplyAllButtonText={() => void applyAllButtonText()}
          onSizingModePreviewChange={(sizingMode) => {
            if (!selectedPlacement) return;
            setWorkingSizingModeOverride({
              placementId: selectedPlacement.id,
              sizingMode
            });
          }}
          onAssignSize={assignSizeToSelectedPlacement}
          onAssignSizeToPanel={assignSizeToPanel}
          onPlacementTextChange={(patch, coalesceKey) => {
            if (!selectedPlacement) return;
            store.transact((draft) => {
              Object.assign(draft.placements[selectedPlacement.id], patch);
            }, {
              label: "Edit Button text fitting",
              coalesceKey
            });
          }}
          onAssignSkin={(skin, sizingMode) => {
            if (!selectedPlacement || !selectedButton) return;
            void assignWorkingSkin(
              skin,
              [selectedPlacement.id],
              `Skin assigned only to '${selectedButton.label}'.`,
              selectedButton.label || "Button",
              sizingMode
            );
          }}
          onAssignSkinToSelection={(skin, sizingMode) => {
            const document = store.current();
            const surface = document.surfaces[selectedSurfaceId];
            if (!surface) return;
            const placementIds = surface.placementIds.filter((placementId) =>
              selectedSetForSurface.has(placementId)
            );
            void assignWorkingSkin(
              skin,
              placementIds,
              `Skin assigned to ${placementIds.length} selected Button${placementIds.length === 1 ? "" : "s"}.`,
              `${selectedButton?.label || "Button"} selection`,
              sizingMode
            );
          }}
          onAssignSkinToPanel={(skin, sizingMode) => {
            if (!selectedPlacement) return;
            const document = store.current();
            const surface = document.surfaces[selectedPlacement.surfaceId];
            const placementIds = resolveButtonEditorSurfaceSkinTargetPlacementIds(
              document,
              selectedPlacement.id
            );
            const surfaceName = surface?.name || panelName || "current surface";
            void assignWorkingSkin(
              skin,
              placementIds,
              `Skin assigned to ${placementIds.length} Button${placementIds.length === 1 ? "" : "s"} on '${surfaceName}'.`,
              surfaceName,
              sizingMode
            );
          }}
          onLoadSkinFile={loadWorkingSkinFile}
          onSaveSkin={saveWorkingSkin}
          onSaveAsNewSkin={saveWorkingSkinAsNew}
        />
      </div>
    </main>
  );
}

function isTitlebarWindowControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".button-editor-titlebar__controls"));
}

function ButtonEditorTitlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncMaximized = () => {
      void currentWindow.isMaximized()
        .then((value) => { if (!disposed) setMaximized(value); })
        .catch(() => {});
    };
    syncMaximized();
    void currentWindow.onResized(syncMaximized).then((next) => {
      if (disposed) next(); else unlisten = next;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return (
    <header
      className="button-editor-titlebar"
      onPointerDown={(event) => {
        if (event.button !== 0 || isTitlebarWindowControl(event.target)) return;
        event.preventDefault();
        const currentWindow = getCurrentWindow();
        // event.detail counts consecutive clicks: a double-click on the bar
        // toggles maximize (native title-bar behavior); a single press drags.
        if (event.detail === 2) {
          void currentWindow.toggleMaximize().catch(() => {});
          return;
        }
        void currentWindow.startDragging().catch(() => {});
      }}
    >
      <span className="button-editor-titlebar__title">FlowCell — Buttons Editor</span>
      <div className="button-editor-titlebar__controls">
        <button
          type="button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void getCurrentWindow().minimize().catch(() => {})}
        >
          &#x2013;
        </button>
        <button
          type="button"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}
        >
          {maximized ? "❏" : "▢"}
        </button>
        <button
          type="button"
          className="button-editor-titlebar__close"
          title="Close"
          aria-label="Close"
          onClick={() => void getCurrentWindow().close().catch(() => {})}
        >
          &#xD7;
        </button>
      </div>
    </header>
  );
}

export function ButtonEditorPage({ context }: ButtonEditorPageProps) {
  const [bootstrap, setBootstrap] = useState<ButtonEditorBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (bootstrap) return;
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void currentWindow.onCloseRequested(() => {
      unregisterLayoutWindow(currentWindow.label);
    }).then((next) => {
      if (disposed) next(); else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [bootstrap]);
  useEffect(() => {
    let active = true;
    void loadButtonEditorBootstrap()
      .then((loaded) => { if (active) setBootstrap(loaded); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : String(loadError)); });
    return () => { active = false; };
  }, []);
  if (error) return <main className="button-editor-page"><ButtonEditorTitlebar /><h1>Buttons</h1><pre className="button-editor-error">{error}</pre></main>;
  if (!bootstrap) return <main className="button-editor-page"><ButtonEditorTitlebar /><p>Loading Button state…</p></main>;
  return (
    <ButtonEditorContent
      initialDocument={bootstrap.document}
      initialContext={context}
      initialRegisteredPanels={bootstrap.registeredPanels}
    />
  );
}

export default ButtonEditorPage;
