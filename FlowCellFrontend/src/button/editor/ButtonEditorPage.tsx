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
  installButtonSource,
  loadButtonStateDocument,
  saveButtonPlacementFile,
  saveButtonSkinFile,
  saveButtonStateDocument,
  uninstallButtonSource,
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
import {
  resolveDiscardedStagedOwnerButtonIds
} from "../state/buttonDocumentOperations";
import {
  reconcileProgramPanelOwners
} from "../state/panelOwnerButtonOperations";
import {
  compactButtonPlacementRows,
  compactButtonPlacements,
  compactUniformButtonPlacements,
  createStarterButtonLayout,
  findFirstAvailableButtonPosition,
  snapToGrid,
  inferButtonPlacementRows,
  validateExactButtonLayoutGeometry,
  type CompactButtonPlacement
} from "../geometry/buttonGeometry";
import { resolveDeterministicLabelGrowth } from "../geometry/labelGrowth";
import { DEFAULT_BUTTON_SKIN_ID } from "../skins/defaultButtonSkin";
import {
  BUTTON_SKIN_FILE_EXTENSION,
  buttonSkinNameFromPath,
  serializeButtonSkinSections
} from "../skins/buttonSkinFormat";
import {
  BUTTON_PLACEMENT_FILE_EXTENSION,
  buildButtonPlacementFile
} from "../state/buttonPlacementFile";
import { ButtonSurfaceSelector } from "./ButtonSurfaceSelector";
import { ButtonWorkspace } from "./ButtonWorkspace";
import { ButtonAnimationPickerPage } from "./ButtonAnimationPickerPage";
import { ButtonSkinEditor } from "./ButtonSkinEditor";
import {
  buttonPlacementSizingPatch,
  resolveAssignedButtonDimensions,
  type ButtonSizeAssignment
} from "./buttonSizeAssignments";
import {
  applyButtonAnimationSavedScope,
  applyButtonBehaviorSavedScope,
  applyButtonPlacementSavedScope,
  applyButtonSkinSavedScope,
  applyButtonTextSavedScope,
  buildButtonAnimationScopedDocument,
  buildButtonBehaviorScopedDocument,
  buildButtonPlacementScopedDocument,
  buildButtonSkinScopedDocument,
  buildButtonTextScopedDocument,
  buttonSkinsEqual,
  skinHasReferencesOutsidePlacements,
  type ButtonSkinSaveScope
} from "./buttonEditorSaveScopes";
import { discardStagedButtonInstalls } from "./stagedInstallCleanup";
import {
  shouldApplyMatchedButtonMeasurement,
  type PendingMatchedMeasurement
} from "./buttonMeasurementReconciliation";
import {
  buildButtonEditorButtonOptions,
  buildButtonEditorPanelOptions,
  buildButtonEditorPlacementOptions,
  buildButtonEditorProgramOptions,
  resolveButtonEditorContextPlacementId,
  resolveButtonEditorIdentity,
  resolveButtonEditorPanelSkinTargetPlacementIds,
  resolveButtonEditorPanelSurfaceId,
  resolveButtonEditorSurfaceIdentity,
  resolvePreferredButtonPlacementId
} from "./buttonEditorSelection";
import "./buttonEditor.css";

export interface ButtonEditorPageProps {
  context?: ButtonEditorWindowContext;
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

function defaultButtonPlacementFileName(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `button-placement-${timestamp}${BUTTON_PLACEMENT_FILE_EXTENSION}`;
}

function defaultButtonSkinFileName(name: string): string {
  const baseName = name
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${baseName || "button-skin"}${BUTTON_SKIN_FILE_EXTENSION}`;
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
  const otherRects = surface.placementIds.map((id) => document.placements[id]).filter(Boolean);
  const available = !surface.uniformButtonSize && desired?.x !== undefined && desired?.y !== undefined
    ? { x: desired.x, y: desired.y, width, height }
    : findFirstAvailableButtonPosition({
        width,
        height,
        surface,
        otherRects,
        padding: surface.uniformButtonSize ? 0 : document.settings.defaultSurfacePadding,
        gap: surface.uniformButtonSize ? 0 : document.settings.defaultGap,
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
    visualStateMap: null,
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
  const layout = result.layout;
  const slots = result.children.map((child) => child.slot);
  if (new Set(slots).size !== slots.length) {
    throw new Error("The installed tool set contains duplicate child placement slots.");
  }
  const childItems = result.children.map((child) => ({ id: child.slot, width: 144, height: 42 }));
  const starter = createStarterButtonLayout(childItems, {
    padding: document.settings.defaultSurfacePadding,
    gap: document.settings.defaultGap,
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
  const freshPlacementsRef = useRef(new Set<string>());
  const naturalCoreMeasurementsRef = useRef(new Map<string, NaturalCoreMeasurementSnapshot>());
  const pendingMatchedMeasurementsRef = useRef(new Map<string, PendingMatchedMeasurement>());
  const matchedMeasurementFrameRef = useRef<number | null>(null);
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
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);

  const selectedPlacement = focusedPlacementId ? store.draft.placements[focusedPlacementId] ?? null : null;
  const selectedButton = selectedPlacement ? store.draft.buttons[selectedPlacement.buttonId] ?? null : null;
  const selectedSurfacePlacements = store.draft.surfaces[selectedSurfaceId]?.placementIds
    .map((placementId) => store.draft.placements[placementId])
    .filter((placement): placement is ButtonPlacement => Boolean(placement)) ?? [];
  const selectedSurfaceButtonCount = selectedSurfacePlacements.length;
  const allSurfaceButtonsSameSize = Boolean(
    store.draft.surfaces[selectedSurfaceId]?.uniformButtonSize
  );
  const selectedSkin = selectedButton && selectedPlacement
    ? store.draft.skins[selectedPlacement.skinOverrideId ?? selectedButton.defaultSkinId] ?? null
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
  const placementOptions = useMemo(
    () => buildButtonEditorPlacementOptions(store.draft, selectedButton?.id ?? ""),
    [store.draft, selectedButton?.id]
  );

  const focusPlacement = useCallback((placementId: string, replaceSelection = true) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement || !document.surfaces[placement.surfaceId]) return;
    const identity = resolveButtonEditorIdentity(document, placement.buttonId);
    setFocusedPlacementId(placement.id);
    setSelectedSurfaceId(placement.surfaceId);
    if (identity && !lockedImportDestination) {
      setProgramName(identity.programName);
      setPanelName(identity.panelName);
    }
    if (replaceSelection) setSelectedPlacementIds(new Set([placement.id]));
  }, [lockedImportDestination, store]);

  const selectButton = useCallback((buttonId: string) => {
    if (!buttonId) {
      setFocusedPlacementId(null);
      setSelectedPlacementIds(new Set());
      return;
    }
    const placementId = resolvePreferredButtonPlacementId(
      store.current(),
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
    next: ButtonStateDocument,
    applySavedScope: (draft: ButtonStateDocument, saved: ButtonStateDocument) => void,
    successMessage: string
  ): Promise<ButtonStateDocument | null> => {
    const validation = validateButtonStateDocument(next);
    if (!validation.valid) {
      setMessage(validation.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
      return null;
    }
    setBusy(true);
    try {
      const saved = await saveButtonStateDocument(next, store.committed.revision);
      store.acceptScopedSaved(saved, applySavedScope);
      await publishButtonCommit(saved);
      setMessage(successMessage);
      return saved;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const savePlacement = async () => {
    if (busyRef.current) return;
    setBusy(true);
    let writtenPath: string | null = null;
    try {
      const placementDraft = cloneButtonDocument(store.current());
      const editorBaseline = cloneButtonDocument(store.committed);
      const placementFile = buildButtonPlacementFile(placementDraft, selectedSurfaceId, {
        programName,
        panelName
      });
      const initialNext = buildButtonPlacementScopedDocument(
        editorBaseline,
        placementDraft,
        selectedSurfaceId
      );
      const validation = validateButtonStateDocument(initialNext);
      if (!validation.valid) {
        throw new Error(validation.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
      }
      const targetPath = await showSaveFileDialog({
        title: "Save Button Placement",
        filter: "FlowCell Button Placement (*.flowcell-button-placement.json)|*.flowcell-button-placement.json|JSON Files (*.json)|*.json",
        defaultFileName: defaultButtonPlacementFileName()
      });
      if (!targetPath) return;

      const discardedStagedOwnerIds = resolveDiscardedStagedOwnerButtonIds(
        placementDraft,
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
      writtenPath = await saveButtonPlacementFile(targetPath, placementFile);
      let committedDocument = editorBaseline;
      let saved: ButtonStateDocument | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const next = buildButtonPlacementScopedDocument(
          committedDocument,
          placementDraft,
          selectedSurfaceId,
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
      store.acceptScopedSaved(saved, (draft, canonical) => {
        applyButtonPlacementSavedScope(draft, canonical, selectedSurfaceId);
      });
      stagedInstallsRef.current.clear();
      await publishButtonCommit(saved);
      setMessage(`Button placement saved to ${writtenPath}.`);
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      setMessage(writtenPath
        ? `The placement file was saved to ${writtenPath}, but FlowCell could not commit the live Button arrangement:\n${failure}`
        : failure);
    } finally {
      setBusy(false);
    }
  };

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
    const geometryIssues = validateExactButtonLayoutGeometry(orderedPlacements, surface);
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
          ...placementPatch
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
    const placements = orderedPlacementIds.flatMap((placementId) => {
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
      { gap: 0 }
    );
    if (!compacted.success) {
      setMessage(compacted.reason ?? "The equal-size Buttons do not fit inside the selected surface.");
      return false;
    }
    return applyPlacementOrder(
      surface.id,
      orderedPlacementIds,
      compacted.placements,
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

  const updatePlacementRect = useCallback((placementId: string, rect: ButtonRect) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement) return;
    const changesSize = Math.abs(placement.width - rect.width) > 0.05 ||
      Math.abs(placement.height - rect.height) > 0.05;
    if (document.surfaces[placement.surfaceId]?.uniformButtonSize && changesSize) {
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
      (draft) => { Object.assign(draft.placements[placementId], rect); },
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
      naturalMeasurement ?? placement
    );
    const candidate = {
      ...placement,
      ...assignedDimensions
    };
    const geometryIssues = validateExactButtonLayoutGeometry(
      surface.placementIds.flatMap((placementId) => {
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
    setMessage("Size assigned to this Button. Use Save placement to commit it.");
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
      { gap: 0 }
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
        `Size assigned once to ${orderedPlacementIds.length} Button${orderedPlacementIds.length === 1 ? "" : "s"} next to the edited Button on '${surface.name}'. Use Save placement to commit it.`
      );
    }
  }, [applyPlacementOrder, focusedPlacementId, store]);

  const snapSelectedSurfaceToTopLeft = useCallback(() => {
    const document = store.current();
    const surface = document.surfaces[selectedSurfaceId];
    if (!surface) {
      setMessage("Select a Button surface before snapping its Buttons.");
      return;
    }
    const orderedPlacementIds = [...surface.placementIds].sort((left, right) => {
      const leftPlacement = document.placements[left];
      const rightPlacement = document.placements[right];
      return (leftPlacement?.zIndex ?? 0) - (rightPlacement?.zIndex ?? 0) ||
        left.localeCompare(right);
    });
    const items = orderedPlacementIds.flatMap((placementId) => {
      const placement = document.placements[placementId];
      return placement
        ? [{ id: placement.id, rect: placement }]
        : [];
    });
    if (items.length === 0) {
      setMessage("The selected surface has no Buttons to snap.");
      return;
    }
    if (items.length !== orderedPlacementIds.length) {
      setMessage("The selected surface contains a missing Button placement.");
      return;
    }
    const rows = inferButtonPlacementRows(items);
    const rowOrderedPlacementIds = rows.flatMap((row) =>
      row.placements.map((placement) => placement.id)
    );
    const compacted = compactButtonPlacementRows(rows, surface, {
      gap: 0,
      preserveRowTopOffsets: false
    });
    if (!compacted.success) {
      setMessage(compacted.reason ?? "The Buttons do not fit inside the selected surface.");
      return;
    }
    applyPlacementOrder(
      surface.id,
      rowOrderedPlacementIds,
      compacted.placements,
      "Snap Buttons to top left corner"
    );
  }, [applyPlacementOrder, selectedSurfaceId, store]);

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
      pendingMatchedMeasurementsRef.current.delete(placementId);
      return;
    }
    const desiredWidth = Math.max(1, snapToGrid(Math.ceil(measurement.width), document.settings.gridSize));
    const desiredHeight = Math.max(1, snapToGrid(Math.ceil(measurement.height), document.settings.gridSize));
    const isFresh = freshPlacementsRef.current.delete(placementId);
    if (
      !isFresh &&
      (!placement.allowLabelResize || (desiredWidth <= placement.width && desiredHeight <= placement.height))
    ) return;
    pendingMatchedMeasurementsRef.current.delete(placementId);
    if (isFresh) {
      const otherRects = surface.placementIds.filter((id) => id !== placementId).map((id) => document.placements[id]).filter(Boolean);
      const target = findFirstAvailableButtonPosition({
        width: desiredWidth,
        height: desiredHeight,
        surface,
        otherRects,
        padding: document.settings.defaultSurfacePadding,
        gap: document.settings.defaultGap,
        gridSize: document.settings.gridSize
      });
      if (target) store.transact((draft) => { Object.assign(draft.placements[placementId], target); }, { label: "Measure new Button" });
      return;
    }
    const result = resolveDeterministicLabelGrowth({
      placements: surface.placementIds.map((id) => document.placements[id]),
      selectedPlacementId: placementId,
      grownWidth: desiredWidth,
      grownHeight: desiredHeight,
      surface,
      gridSize: document.settings.gridSize,
      allowSurfaceExpansion: document.settings.allowSurfaceAutoExpansion
    });
    if (!result.success) {
      setMessage(result.warning ?? "Label growth could not be placed safely.");
      return;
    }
    store.transact((draft) => {
      result.placements.forEach((item) => Object.assign(draft.placements[item.id], item));
      Object.assign(draft.surfaces[surface.id], result.surface);
    }, {
      label: "Grow Button label and resolve collisions",
      coalesceKey: `label-growth:${placementId}`
    });
  };

  const handlePlacementMeasurement = (placementId: string, measurement: ButtonCoreMeasurement) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (
      !placement?.matchHitboxToSkin ||
      document.surfaces[placement.surfaceId]?.uniformButtonSize
    ) return;
    if (
      Math.abs(placement.width - measurement.width) <= 0.5 &&
      Math.abs(placement.height - measurement.height) <= 0.5
    ) return;
    const button = document.buttons[placement.buttonId];
    const sourceSkinId = placement.skinOverrideId ?? button?.defaultSkinId;
    if (!button || !sourceSkinId) return;
    pendingMatchedMeasurementsRef.current.set(placementId, {
      measurement,
      sourceWidth: placement.width,
      sourceHeight: placement.height,
      sourceAllowStretching: placement.allowStretching,
      sourceTextFitMode: placement.textFitMode,
      sourceTextAlignment: placement.textAlignment,
      sourceMinimumFontSize: placement.minimumFontSize,
      sourceTextSizeOverride: placement.textSizeOverride,
      sourceSkinId,
      sourceLabel: button.label
    });
    if (matchedMeasurementFrameRef.current !== null) return;
    matchedMeasurementFrameRef.current = window.requestAnimationFrame(() => {
      matchedMeasurementFrameRef.current = null;
      const pending = new Map(pendingMatchedMeasurementsRef.current);
      pendingMatchedMeasurementsRef.current.clear();
      const current = store.current();
      const updates = [...pending.entries()].filter(([id, source]) => {
        const item = current.placements[id];
        const button = item && current.buttons[item.buttonId];
        return shouldApplyMatchedButtonMeasurement(item, button, source);
      });
      if (updates.length === 0) return;
      store.transact((draft) => {
        for (const [id, source] of updates) {
          const item = draft.placements[id];
          if (!item?.matchHitboxToSkin) continue;
          item.width = Math.max(1, source.measurement.width);
          item.height = Math.max(1, source.measurement.height);
        }
      }, {
        label: "Match Button hitboxes to skins",
        coalesceKey: "match-hitboxes-to-skins"
      });
    });
  };

  useEffect(() => () => {
    if (matchedMeasurementFrameRef.current !== null) {
      window.cancelAnimationFrame(matchedMeasurementFrameRef.current);
    }
  }, []);

  const selectedSetForSurface = new Set([...selectedPlacementIds].filter((id) => store.draft.placements[id]?.surfaceId === selectedSurfaceId));

  const selectWorkspacePlacement = (
    placementId: string,
    _event: PointerEvent | KeyboardEvent
  ) => {
    focusPlacement(placementId);
  };

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
      setMessage(`${successMessage} Save placement first because this is a new Button.`);
      return false;
    }
    const next = buildButtonAnimationScopedDocument(store.committed, nextDraft, buttonId);
    return Boolean(await commitScopedDocument(
      next,
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

  const applyButtonStateSetup = async () => {
    const button = selectedButton;
    if (!button) return;
    if (!store.committed.buttons[button.id]) {
      setMessage("Save placement first because this is a new Button.");
      return;
    }
    const placementIds = Object.values(store.current().placements)
      .filter((placement) => placement.buttonId === button.id)
      .map((placement) => placement.id);
    const unsavedPlacement = placementIds.find((placementId) => !store.committed.placements[placementId]);
    if (unsavedPlacement) {
      setMessage("Save placement first because this Button has a new placement.");
      return;
    }
    const scope = { buttonId: button.id, placementIds };
    const next = buildButtonBehaviorScopedDocument(store.committed, store.current(), scope);
    await commitScopedDocument(
      next,
      (draft, saved) => applyButtonBehaviorSavedScope(draft, saved, scope),
      `Button state setup applied to '${button.label}'.`
    );
  };

  const applyAllButtonText = async () => {
    const button = selectedButton;
    const placement = selectedPlacement;
    if (!button || !placement) return;
    if (!store.committed.buttons[button.id] || !store.committed.placements[placement.id]) {
      setMessage("Save placement first because this is a new Button placement.");
      return;
    }
    const scope = { buttonId: button.id, placementId: placement.id };
    const next = buildButtonTextScopedDocument(store.committed, store.current(), scope);
    await commitScopedDocument(
      next,
      (draft, saved) => applyButtonTextSavedScope(draft, saved, scope),
      `Button Text applied to '${button.label}'.`
    );
  };

  const saveWorkingSkin = async (workingSkin: ButtonSkin) => {
    const nextDraft = cloneButtonDocument(store.current());
    nextDraft.skins[workingSkin.id] = cloneButtonDocument(workingSkin);
    const scope: ButtonSkinSaveScope = {
      skinIds: [workingSkin.id]
    };
    const next = buildButtonSkinScopedDocument(store.committed, nextDraft, scope);
    await commitScopedDocument(
      next,
      (draft, saved) => applyButtonSkinSavedScope(draft, saved, scope),
      `Skin '${workingSkin.name}' saved.`
    );
  };

  const saveWorkingSkinAsNew = async (workingSkin: ButtonSkin) => {
    try {
      const id = createStableButtonId("skin");
      const targetPath = await showSaveFileDialog({
        title: "Save Button Skin As",
        filter: "FlowCell Button Skin (*.flowcell-button-skin.txt)|*.flowcell-button-skin.txt|Text Files (*.txt)|*.txt",
        defaultFileName: defaultButtonSkinFileName(workingSkin.name)
      });
      if (!targetPath) return;

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
      const next = buildButtonSkinScopedDocument(store.committed, nextDraft, scope);
      await commitScopedDocument(
        next,
        (draft, saved) => applyButtonSkinSavedScope(draft, saved, scope),
        `Skin '${duplicate.name}' saved as a new skin at ${writtenPath}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const assignWorkingSkin = async (
    workingSkin: ButtonSkin,
    targetPlacementIds: readonly string[],
    assignmentName: string,
    forkName: string
  ) => {
    if (targetPlacementIds.length === 0) {
      setMessage("The selected Button is not on the Main panel for this Program and Panel.");
      return;
    }
    const unsavedTarget = targetPlacementIds.find((placementId) =>
      !store.committed.placements[placementId]
    );
    if (unsavedTarget) {
      setMessage("Save placement for this new Button before assigning its skin.");
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
      placementIds: targetPlacementIds
    };
    const next = buildButtonSkinScopedDocument(store.committed, nextDraft, scope);
    await commitScopedDocument(
      next,
      (draft, saved) => applyButtonSkinSavedScope(draft, saved, scope),
      assignmentName
    );
  };

  const activateOwnerButton = async (_placementId: string, button: ButtonRecord) => {
    try {
      if (button.role === "tool-set-owner") {
        const unit = Object.values(store.current().popoutUnits).find(
          (candidate) => candidate.kind === "tool-set" && candidate.ownerButtonId === button.id
        );
        if (!unit) throw new Error(`Tool-set owner '${button.label}' has no canonical popout unit.`);
        const identity = button.sourceIdentity;
        const ownerProgramName = identity?.displayProgramName || programName;
        const ownerPanelName = identity?.displayPanelName || panelName;
        if (!ownerProgramName) throw new Error(`Tool-set owner '${button.label}' has no program identity.`);
        await openButtonPopoutWindow({
          programName: ownerProgramName,
          panelName: ownerPanelName || undefined,
          popoutUnitId: unit.id,
          ownerButtonId: button.id,
          draftSessionId: sessionIdRef.current,
          bounds: unit.desktopBounds
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
            buttonId={selectedButton?.id ?? ""}
            placementId={focusedPlacementId ?? ""}
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
            onPlacementChange={(placementId) => {
              if (placementId) focusPlacement(placementId);
              else {
                setFocusedPlacementId(null);
                setSelectedPlacementIds(new Set());
              }
            }}
          />
          <div className="button-editor-sidebar__actions">
            <button
              type="button"
              className="button-editor-sidebar__save"
              disabled={busy}
              onClick={() => void savePlacement()}
            >
              Save placement
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
              disabled={mode !== "edit" || selectedSurfaceButtonCount < 2 || busy}
              onClick={() => {
                if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                setActivePage("placement");
                setReorderMode((current) => !current);
              }}
            >
              Re-order
            </button>
            <button
              type="button"
              disabled={mode !== "edit" || selectedSurfaceButtonCount === 0 || busy}
              onClick={() => {
                if (activeAnimationEditorButtonId) void closeButtonAnimationEditor();
                setActivePage("placement");
                setReorderMode(false);
                snapSelectedSurfaceToTopLeft();
              }}
            >
              Snap to top left corner
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
            onSelectPlacement={selectWorkspacePlacement}
            onPlacementRectChange={updatePlacementRect}
            onPlacementMeasurement={handlePlacementMeasurement}
            onPlacementNaturalMeasurement={handleNaturalMeasurement}
            onOwnerActivate={activateOwnerButton}
            reorderMode={reorderMode}
            onPlacementOrderChange={applyPlacementOrder}
          />
        )}
        <ButtonSkinEditor
          skin={selectedSkin}
          skins={Object.values(store.draft.skins)}
          skinContextKey={selectedPlacement?.id ?? ""}
          busy={busy}
          placement={selectedPlacement}
          surfaceButtonCount={selectedSurfaceButtonCount}
          allSurfaceButtonsSameSize={allSurfaceButtonsSameSize}
          buttonLabel={selectedButton?.label ?? "Button Preview"}
          activationBehavior={selectedButton?.activationBehavior ?? null}
          visualStateMap={selectedPlacement?.visualStateMap ?? null}
          onButtonLabelChange={(label) => {
            if (!selectedButton) return;
            store.transact((draft) => {
              const target = draft.buttons[selectedButton.id];
              target.label = label;
              if (target.activationBehavior?.states[0]) {
                target.activationBehavior.states[0].label = label;
              }
            }, { label: "Edit Button label", coalesceKey: `label:${selectedButton.id}` });
          }}
          onActivationBehaviorChange={(behavior, removedStateIds = []) => {
            if (!selectedButton) return;
            store.transact((draft) => {
              const target = draft.buttons[selectedButton.id];
              target.activationBehavior = cloneButtonDocument(behavior);
              if (behavior.states[0]) target.label = behavior.states[0].label;
              if (removedStateIds.length > 0) {
                for (const placement of Object.values(draft.placements)) {
                  if (placement.buttonId !== selectedButton.id || !placement.visualStateMap) continue;
                  for (const stateId of removedStateIds) delete placement.visualStateMap[stateId];
                  if (Object.keys(placement.visualStateMap).length === 0) {
                    placement.visualStateMap = null;
                  }
                }
              }
            }, {
              label: "Edit Button activation states",
              coalesceKey: `activation-behavior:${selectedButton.id}`
            });
          }}
          onVisualStateMapChange={(visualStateMap) => {
            if (!selectedPlacement) return;
            store.transact((draft) => {
              draft.placements[selectedPlacement.id].visualStateMap = cloneButtonDocument(visualStateMap);
            }, {
              label: "Map Button visual state",
              coalesceKey: `visual-state-map:${selectedPlacement.id}`
            });
          }}
          onApplyButtonStateSetup={() => void applyButtonStateSetup()}
          onApplyAllButtonText={() => void applyAllButtonText()}
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
          onAssignSkin={(skin) => {
            if (!selectedPlacement || !selectedButton) return;
            void assignWorkingSkin(
              skin,
              [selectedPlacement.id],
              `Skin assigned only to '${selectedButton.label}'.`,
              selectedButton.label || "Button"
            );
          }}
          onAssignSkinToPanel={(skin) => {
            if (!selectedPlacement) return;
            const placementIds = resolveButtonEditorPanelSkinTargetPlacementIds(
              store.current(),
              programName,
              panelName,
              selectedPlacement.id
            );
            void assignWorkingSkin(
              skin,
              placementIds,
              `Skin assigned to ${placementIds.length} Button${placementIds.length === 1 ? "" : "s"} on '${panelName}'.`,
              panelName || "Panel"
            );
          }}
          onSaveSkin={(skin) => void saveWorkingSkin(skin)}
          onSaveAsNewSkin={(skin) => void saveWorkingSkinAsNew(skin)}
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
