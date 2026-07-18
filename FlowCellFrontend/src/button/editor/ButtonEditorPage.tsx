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
  showOpenFolderDialog
} from "../../lib/tauri";
import { openMotionSettingsWindow } from "../../lib/coreWindows";
import {
  hideButtonActivationAnimationEditorWindow,
  openButtonActivationAnimationEditor,
  saveButtonActivationAnimationEditorBounds
} from "../animations/buttonAnimationWindows";
import {
  buildButtonFanWindowLabel,
  buildButtonPopoutWindowLabel,
  closeButtonFanWindow,
  closeButtonPopoutWindow,
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
  ButtonSurface,
  ButtonTextFitMode
} from "../types";
import {
  cloneButtonDocument,
  createStableButtonId
} from "../state/buttonDefaults";
import {
  installButtonSource,
  loadButtonStateDocument,
  saveButtonStateDocument,
  uninstallButtonSource,
  updateButtonSource,
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
  ensureFanSetup,
  removeOwnedButtonGraph,
  resolveDiscardedStagedOwnerButtonIds,
  resolveUninstallOwnerButtonIds,
  updateFanSetupMembers
} from "../state/buttonDocumentOperations";
import { deriveRegularPopoutSelectionKey } from "../state/sourceIdentity";
import { applyInstalledSourceUpdate } from "../state/sourceUpdateOperations";
import {
  reconcileProgramPanelOwners,
  resolvePanelOwnerFanPlacement
} from "../state/panelOwnerButtonOperations";
import {
  buttonRectsOverlap,
  compactButtonPlacements,
  createStarterButtonLayout,
  findFirstAvailableButtonPosition,
  isButtonRectInsideSurface,
  snapToGrid,
  validateExactButtonLayoutGeometry,
  type CompactButtonPlacement
} from "../geometry/buttonGeometry";
import { resolveDeterministicLabelGrowth } from "../geometry/labelGrowth";
import { DEFAULT_BUTTON_SKIN_ID } from "../skins/defaultButtonSkin";
import { ButtonLibrary } from "./ButtonLibrary";
import { ButtonSurfaceSelector } from "./ButtonSurfaceSelector";
import { ButtonWorkspace } from "./ButtonWorkspace";
import { ButtonInspector } from "./ButtonInspector";
import { ButtonSkinEditor } from "./ButtonSkinEditor";
import { FanBuilder } from "./FanBuilder";
import { discardStagedButtonInstalls } from "./stagedInstallCleanup";
import {
  shouldApplyMatchedButtonMeasurement,
  type PendingMatchedMeasurement
} from "./buttonMeasurementReconciliation";
import {
  buildButtonEditorButtonOptions,
  buildButtonEditorFanCandidates,
  buildButtonEditorPanelOptions,
  buildButtonEditorPlacementOptions,
  buildButtonEditorProgramOptions,
  resolveButtonEditorContextPlacementId,
  resolveButtonEditorDefaultFanMembers,
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

interface RegisteredProgramPanels {
  programName: string;
  panelNames: string[];
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
  const width = desired?.width ?? 160;
  const height = desired?.height ?? 44;
  const otherRects = surface.placementIds.map((id) => document.placements[id]).filter(Boolean);
  const available = desired?.x !== undefined && desired?.y !== undefined
    ? { x: desired.x, y: desired.y, width, height }
    : findFirstAvailableButtonPosition({
        width,
        height,
        surface,
        otherRects,
        padding: document.settings.defaultSurfacePadding,
        gap: document.settings.defaultGap,
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
    minimumFontSize: document.settings.defaultMinimumFontSize,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
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
    visualOverflowAllowance: 24
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
    fields: cloneButtonDocument(layout?.fields ?? []),
    presentation: cloneButtonDocument(layout?.presentation ?? null)
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
  const pendingUninstallsRef = useRef(new Set<string>());
  const freshPlacementsRef = useRef(new Set<string>());
  const pendingMatchedMeasurementsRef = useRef(new Map<string, PendingMatchedMeasurement>());
  const pendingTextSizeResizeRef = useRef(new Map<string, number | null>());
  const matchedMeasurementFrameRef = useRef<number | null>(null);
  const closeInProgressRef = useRef(false);
  const busyRef = useRef(false);
  const cancelRef = useRef<(reload?: boolean) => Promise<boolean>>(async () => false);
  const [mode, setMode] = useState<"run" | "edit">("edit");
  const [reorderMode, setReorderMode] = useState(false);
  const [selectedSurfaceId, setSelectedSurfaceId] = useState(initialSelection.surfaceId);
  const [focusedPlacementId, setFocusedPlacementId] = useState<string | null>(initialSelection.placementId);
  const [selectedPlacementIds, setSelectedPlacementIds] = useState<Set<string>>(
    () => new Set(initialSelection.placementId ? [initialSelection.placementId] : [])
  );
  const [fanBuilderButtonIds, setFanBuilderButtonIds] = useState<Set<string>>(new Set());
  const [programs, setPrograms] = useState<string[]>(
    () => initialRegisteredPanels.map((entry) => entry.programName)
  );
  const [panels, setPanels] = useState<string[]>(
    () => registeredPanelsForProgram(initialRegisteredPanels, initialSelection.programName)
  );
  const [programName, setProgramName] = useState(initialSelection.programName);
  const [panelName, setPanelName] = useState(initialSelection.panelName);
  const [busy, setBusyState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeAnimationEditorButtonId, setActiveAnimationEditorButtonId] = useState<string | null>(null);
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyState(next);
  }, []);

  const selectedPlacement = focusedPlacementId ? store.draft.placements[focusedPlacementId] ?? null : null;
  const selectedButton = selectedPlacement ? store.draft.buttons[selectedPlacement.buttonId] ?? null : null;
  const selectedSurfaceButtonCount = store.draft.surfaces[selectedSurfaceId]?.placementIds
    .filter((placementId) => Boolean(store.draft.placements[placementId]))
    .length ?? 0;
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
  const fanCandidates = useMemo(
    () => buildButtonEditorFanCandidates(store.draft, programName, panelName),
    [store.draft, programName, panelName]
  );
  const activeFanSetup = useMemo(
    () => Object.values(store.draft.fanSetups).find(
      (setup) => setup.fanSurfaceId === selectedSurfaceId
    ) ?? null,
    [selectedSurfaceId, store.draft.fanSetups]
  );
  const fanCandidateIdKey = fanCandidates.map((candidate) => candidate.id).join("\u0000");

  const focusPlacement = useCallback((placementId: string, replaceSelection = true) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement || !document.surfaces[placement.surfaceId]) return;
    const identity = resolveButtonEditorIdentity(document, placement.buttonId);
    setFocusedPlacementId(placement.id);
    setSelectedSurfaceId(placement.surfaceId);
    if (identity) {
      setProgramName(identity.programName);
      setPanelName(identity.panelName);
    }
    if (replaceSelection) setSelectedPlacementIds(new Set([placement.id]));
  }, [store]);

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

  const showToolSetPopoutSurface = useCallback((surfaceId: string) => {
    const document = store.current();
    const surface = document.surfaces[surfaceId];
    if (!surface) return;
    const firstChildPlacementId = surface.placementIds.find((id) => document.placements[id]);
    if (firstChildPlacementId) {
      focusPlacement(firstChildPlacementId);
      return;
    }
    setSelectedSurfaceId(surfaceId);
    setFocusedPlacementId(null);
    setSelectedPlacementIds(new Set());
  }, [focusPlacement, store]);

  const applyEditorContext = useCallback((context: ButtonEditorWindowContext) => {
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
    setFanBuilderButtonIds(new Set(
      activeFanSetup
        ? [
            ...activeFanSetup.fanMemberButtonIds,
            ...activeFanSetup.selectedToolSetOwnerButtonIds
          ]
        : []
    ));
  }, [activeFanSetup?.id, panelName, programName]);

  useEffect(() => {
    const candidateIds = new Set(fanCandidates.map((candidate) => candidate.id));
    setFanBuilderButtonIds((current) => {
      const next = new Set([...current].filter((buttonId) => candidateIds.has(buttonId)));
      return next.size === current.size && [...next].every((buttonId) => current.has(buttonId))
        ? current
        : next;
    });
  }, [fanCandidateIdKey]);

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

  const importSource = async (kind: "script" | "tool-set", folder = false) => {
    if (!programName || !panelName) return;
    setBusy(true);
    setMessage(null);
    let installed: InstallButtonSourceResult | null = null;
    try {
      const paths = folder
        ? await showOpenFolderDialog({ title: "Choose FlowCell Tool-Set Package", multiselect: false })
        : await showOpenFileDialog({
            title: kind === "script" ? "Choose Script or Script-Package Manifest" : "Choose Tool-Set Manifest or Script",
            filter: kind === "script"
              ? "FlowCell scripts and packages (*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json)|*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json|All Files (*.*)|*.*"
              : "FlowCell tool sets (*.json;*.py;*.jsx)|*.json;*.py;*.jsx|All Files (*.*)|*.*",
            multiselect: false
          });
      const sourcePath = paths[0];
      if (!sourcePath) return;
      const ownerButtonId = createStableButtonId("button");
      installed = await installButtonSource({ ownerButtonId, programName, panelName, sourcePath, importKind: kind });
      stagedInstallsRef.current.set(ownerButtonId, installed);
      let nextSurface = "";
      let selectedPlacement = "";
      store.transact((draft) => {
        const panelSurface = ensureProgramPanelSurface(draft, programName, panelName);
        nextSurface = panelSurface.id;
        if (kind === "script") {
          const placement = addInstalledSingle(draft, installed!, panelSurface.id);
          selectedPlacement = placement.id;
          freshPlacementsRef.current.add(placement.id);
        } else {
          const created = addInstalledToolSet(draft, installed!, panelSurface.id);
          selectedPlacement = created.ownerPlacement.id;
          freshPlacementsRef.current.add(created.ownerPlacement.id);
        }
      }, { label: kind === "script" ? "Import script Button" : "Import tool set" });
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
  };

  const updateSelectedSource = async () => {
    if (
      !selectedButton?.sourceIdentity ||
      (selectedButton.role !== "single-script" && selectedButton.role !== "tool-set-owner")
    ) {
      setMessage("Select an installed single-script Button or tool-set owner first.");
      return;
    }
    if (
      store.canUndo ||
      stagedInstallsRef.current.size > 0 ||
      pendingUninstallsRef.current.size > 0
    ) {
      setMessage("Save or Cancel the current Button draft before updating an installed source package.");
      return;
    }

    const importKind = selectedButton.role === "tool-set-owner" ? "tool-set" : "script";
    const chooseFolder = importKind === "tool-set" && window.confirm(
      "Choose an entire updated tool-set package folder?\n\nOK = folder, Cancel = manifest/script file."
    );
    setBusy(true);
    setMessage(null);
    try {
      const paths = chooseFolder
        ? await showOpenFolderDialog({ title: "Choose Updated Tool-Set Package", multiselect: false })
        : await showOpenFileDialog({
            title: importKind === "script"
              ? "Choose Updated Script or Script-Package Manifest"
              : "Choose Updated Tool-Set Manifest or Script",
            filter: importKind === "script"
              ? "FlowCell scripts and packages (*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json)|*.py;*.jsx;*.ps1;*.ahk;*.vbs;*.js;*.json|All Files (*.*)|*.*"
              : "FlowCell tool sets (*.json;*.py;*.jsx)|*.json;*.py;*.jsx|All Files (*.*)|*.*",
            multiselect: false
          });
      const sourcePath = paths[0];
      if (!sourcePath) return;
      const installed = await updateButtonSource({
        ownerButtonId: selectedButton.id,
        programName: selectedButton.sourceIdentity.displayProgramName,
        panelName: selectedButton.sourceIdentity.displayPanelName,
        sourcePath,
        importKind
      });

      let current = store.committed;
      let saved: ButtonStateDocument | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const next = cloneButtonDocument(current);
        applyInstalledSourceUpdate(next, installed);
        try {
          saved = await saveButtonStateDocument(next, current.revision);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === 2 || !message.includes("Button state changed before Save.")) throw error;
          current = await loadButtonStateDocument();
        }
      }
      if (!saved) throw new Error("The updated source package could not be committed to Button state.");
      store.acceptSaved(saved);
      await publishButtonCommit(saved);
      setMessage("Source package updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const createRegularPopout = () => {
    const selectedButtons = [...selectedPlacementIds]
      .map((id) => store.draft.placements[id])
      .map((placement) => placement && store.draft.buttons[placement.buttonId])
      .filter((button): button is ButtonRecord => Boolean(button && button.role === "single-script" && button.sourceIdentity));
    if (selectedButtons.length === 0) {
      setMessage("Select one or more single-script Buttons first.");
      return;
    }
    let createdSurfaceId = "";
    let createdPlacementId = "";
    store.transact((draft) => {
      const items = selectedButtons.map((button) => ({ id: button.id, width: 160, height: 44 }));
      const starter = createStarterButtonLayout(items, { padding: draft.settings.defaultSurfacePadding, gap: draft.settings.defaultGap, maximumColumns: 4 });
      const surface = createSurface(draft, "Regular Popout", "regular-popout", starter.requiredWidth, starter.requiredHeight);
      createdSurfaceId = surface.id;
      selectedButtons.forEach((button, index) => {
        const placement = addPlacement(draft, button.id, surface.id, starter.rects[button.id]);
        if (index === 0) createdPlacementId = placement.id;
      });
      const identities = selectedButtons.map((button) => button.sourceIdentity!);
      const id = createStableButtonId("popout");
      draft.popoutUnits[id] = {
        id,
        name: "Regular Popout",
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
        memberSourceIdentities: identities,
        selectionKey: deriveRegularPopoutSelectionKey(identities)
      };
    }, { label: "Create regular popout" });
    setSelectedSurfaceId(createdSurfaceId);
    setFocusedPlacementId(createdPlacementId || null);
    setSelectedPlacementIds(new Set(createdPlacementId ? [createdPlacementId] : []));
  };

  const createFanSetup = () => {
    if (!programName || !panelName) {
      setMessage("Choose the program and panel for this fan setup.");
      return;
    }
    const selectedButtonIds = fanCandidates
      .filter((candidate) => fanBuilderButtonIds.has(candidate.id))
      .map((candidate) => candidate.id);
    if (selectedButtonIds.length === 0) {
      setMessage("Select one or more script Buttons or Tool Set owners in Fan Builder first.");
      return;
    }
    let fanSurfaceId = "";
    let fanPlacementId = "";
    store.transact((draft) => {
      reconcileProgramPanelOwners(draft, {
        programName,
        panels: buildPanelRailOwnerEntries(panels),
        surfaceBounds: panelRailOwnerSurfaceBounds
      });
      const setup = ensureFanSetup({
        document: draft,
        programName,
        panelName,
        buttons: selectedButtonIds.map((buttonId) => draft.buttons[buttonId]).filter(Boolean)
      });
      const panelOwnerPlacement = resolvePanelOwnerFanPlacement(draft, setup.id);
      if (!panelOwnerPlacement) throw new Error(`Fan '${setup.name}' is missing its panel-owner placement.`);
      fanSurfaceId = setup.fanSurfaceId;
      fanPlacementId = panelOwnerPlacement.id;
    }, { label: "Create fan setup" });
    setMessage(null);
    setSelectedSurfaceId(fanSurfaceId);
    setFocusedPlacementId(fanPlacementId || null);
    setSelectedPlacementIds(new Set(fanPlacementId ? [fanPlacementId] : []));
  };

  const updateActiveFanSetupMembers = () => {
    if (!activeFanSetup) {
      setMessage("Choose a saved Fan placement before updating its members.");
      return;
    }
    const selectedButtonIds = fanCandidates
      .filter((candidate) => fanBuilderButtonIds.has(candidate.id))
      .map((candidate) => candidate.id);
    if (selectedButtonIds.length === 0) {
      setMessage("A Fan needs at least one script Button or Tool Set owner.");
      return;
    }
    const setupId = activeFanSetup.id;
    let panelOwnerPlacementId = "";
    store.transact((draft) => {
      const setup = updateFanSetupMembers({
        document: draft,
        setupId,
        buttons: selectedButtonIds.map((buttonId) => draft.buttons[buttonId]).filter(Boolean)
      });
      const panelOwnerPlacement = resolvePanelOwnerFanPlacement(draft, setup.id);
      if (!panelOwnerPlacement) throw new Error(`Fan '${setup.name}' is missing its panel-owner placement.`);
      panelOwnerPlacementId = panelOwnerPlacement.id;
    }, { label: "Update Fan members", coalesceKey: `fan-members:${setupId}` });
    setMessage(null);
    setFocusedPlacementId(panelOwnerPlacementId || null);
    setSelectedPlacementIds(new Set(panelOwnerPlacementId ? [panelOwnerPlacementId] : []));
  };

  const createDefaultFanSetup = () => {
    if (!programName || !panelName) {
      setMessage("Choose the program and panel for this fan setup.");
      return;
    }
    const members = resolveButtonEditorDefaultFanMembers(
      store.current(),
      programName,
      panelName
    );
    if (members.length === 0) {
      setMessage("This panel has no single-script Buttons for a default fan grid.");
      return;
    }

    const memberIds = members.map((button) => button.id);
    let fanSurfaceId = "";
    let fanPlacementId = "";
    store.transact((draft) => {
      const setup = ensureFanSetup({
        document: draft,
        programName,
        panelName,
        buttons: memberIds.map((buttonId) => draft.buttons[buttonId]).filter(Boolean)
      });
      const panelOwnerPlacement = resolvePanelOwnerFanPlacement(draft, setup.id);
      if (!panelOwnerPlacement) {
        throw new Error(`Default fan '${setup.name}' is missing its panel-owner placement.`);
      }
      fanSurfaceId = setup.fanSurfaceId;
      fanPlacementId = panelOwnerPlacement.id;
    }, { label: "Create default fan grid" });
    setMessage(null);
    setSelectedSurfaceId(fanSurfaceId);
    setFocusedPlacementId(fanPlacementId);
    setSelectedPlacementIds(new Set([fanPlacementId]));
  };

  const save = async () => {
    const validation = validateButtonStateDocument(store.draft);
    if (!validation.valid) {
      setMessage(validation.issues.slice(0, 8).map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
      return;
    }
    setBusy(true);
    try {
      const discardedStagedOwnerIds = resolveDiscardedStagedOwnerButtonIds(
        store.draft,
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
        pendingUninstallsRef.current.delete(ownerButtonId);
      }
      const uninstallIds = resolveUninstallOwnerButtonIds(
        store.draft,
        [...pendingUninstallsRef.current]
      );
      const saved = await saveButtonStateDocument(store.draft, store.committed.revision, uninstallIds);
      store.acceptSaved(saved);
      stagedInstallsRef.current.clear();
      pendingUninstallsRef.current.clear();
      await publishButtonCommit(saved);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const cancel = useCallback(async (reload = false): Promise<boolean> => {
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

      pendingUninstallsRef.current.clear();
      await publishButtonDraftCancel(sessionIdRef.current);
      await hideButtonActivationAnimationEditorWindow().catch(() => {});
      setActiveAnimationEditorButtonId(null);
      if (reload) {
        const bootstrap = await loadButtonEditorBootstrap();
        const loaded = bootstrap.document;
        store.resetFromRepository(loaded);
        setPrograms(bootstrap.registeredPanels.map((entry) => entry.programName));
        setPanels(registeredPanelsForProgram(bootstrap.registeredPanels, programName));
        setSelectedSurfaceId(
          resolveButtonEditorPanelSurfaceId(loaded, programName, panelName) ?? ""
        );
      } else {
        store.cancel();
      }
      setFocusedPlacementId(null);
      setSelectedPlacementIds(new Set());
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [panelName, programName, setBusy, store.cancel, store.resetFromRepository]);
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
      void cancelRef.current(false).then(async (discarded) => {
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

  const updatePlacementRect = (placementId: string, rect: ButtonRect) => {
    setMessage(null);
    store.transact((draft) => { Object.assign(draft.placements[placementId], rect); }, { label: "Move or resize Button" });
  };

  const applyPlacementOrder = useCallback((
    surfaceId: string,
    orderedPlacementIds: readonly string[],
    placements: readonly CompactButtonPlacement[],
    label = "Reorder Buttons"
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
      draft.surfaces[surfaceId].placementIds = [...orderedPlacementIds];
      orderedPlacements.forEach((placement) => {
        Object.assign(draft.placements[placement.id], placement.rect, {
          zIndex: placement.zIndex
        });
      });
    }, { label });
    setMessage(null);
    return true;
  }, [store]);

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
    const compacted = compactButtonPlacements(items, surface, { gap: 0 });
    if (!compacted.success) {
      setMessage(compacted.reason ?? "The Buttons do not fit inside the selected surface.");
      return;
    }
    applyPlacementOrder(
      surface.id,
      orderedPlacementIds,
      compacted.placements,
      "Snap Buttons to top left corner"
    );
  }, [applyPlacementOrder, selectedSurfaceId, store]);

  const handleNaturalMeasurement = (placementId: string, measurement: ButtonCoreMeasurement) => {
    const document = store.current();
    const placement = document.placements[placementId];
    const surface = placement && document.surfaces[placement.surfaceId];
    if (!placement || !surface) return;
    const pendingTextSize = pendingTextSizeResizeRef.current.get(placementId);
    const resizesForTextSize = pendingTextSizeResizeRef.current.has(placementId) &&
      pendingTextSize === placement.textSizeOverride;
    pendingTextSizeResizeRef.current.delete(placementId);
    const desiredWidth = resizesForTextSize
      ? Math.max(1, measurement.width)
      : Math.max(1, snapToGrid(Math.ceil(measurement.width), document.settings.gridSize));
    const desiredHeight = resizesForTextSize
      ? Math.max(1, measurement.height)
      : Math.max(1, snapToGrid(Math.ceil(measurement.height), document.settings.gridSize));
    const isFresh = freshPlacementsRef.current.delete(placementId);
    if (
      !isFresh &&
      !resizesForTextSize &&
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
      if (resizesForTextSize) {
        Object.assign(draft.placements[placementId], {
          width: desiredWidth,
          height: desiredHeight
        });
      }
      Object.assign(draft.surfaces[surface.id], result.surface);
    }, {
      label: resizesForTextSize ? "Resize Button text" : "Grow Button label and resolve collisions",
      coalesceKey: resizesForTextSize ? `font-size:${placementId}` : `label-growth:${placementId}`
    });
  };

  const handlePlacementMeasurement = (placementId: string, measurement: ButtonCoreMeasurement) => {
    const document = store.current();
    const placement = document.placements[placementId];
    if (!placement?.matchHitboxToSkin) return;
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

  const selectWorkspacePlacement = (placementId: string, event: PointerEvent | KeyboardEvent) => {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive) {
      focusPlacement(placementId);
      return;
    }
    const next = new Set(selectedPlacementIds);
    if (next.has(placementId)) {
      next.delete(placementId);
      setSelectedPlacementIds(next);
      const fallback = [...next][0];
      if (fallback) focusPlacement(fallback, false);
      else setFocusedPlacementId(null);
      return;
    }
    next.add(placementId);
    setSelectedPlacementIds(next);
    focusPlacement(placementId, false);
  };

  const openSelectedNativeWindow = async () => {
    const document = store.current();
    const unit = Object.values(document.popoutUnits).find(
      (candidate) => candidate.surfaceId === selectedSurfaceId
    );
    try {
      setMessage(null);
      if (unit) {
        const identity = resolveButtonEditorSurfaceIdentity(document, unit.surfaceId);
        const ownerButtonId = unit.kind === "tool-set" ? unit.ownerButtonId : undefined;
        const ownerButton = ownerButtonId ? document.buttons[ownerButtonId] : null;
        const liveProgramName = identity?.programName ||
          ownerButton?.sourceIdentity?.displayProgramName || programName;
        const livePanelName = identity?.panelName ||
          ownerButton?.sourceIdentity?.displayPanelName || panelName;
        if (!liveProgramName) {
          throw new Error(`Pop '${unit.name}' has no program identity.`);
        }
        await closeButtonPopoutWindow({
          popoutUnitId: unit.id,
          ownerButtonId
        }).catch(() => {});
        await openButtonPopoutWindow({
          programName: liveProgramName,
          panelName: livePanelName || undefined,
          popoutUnitId: unit.id,
          ownerButtonId,
          displayMode: "expanded",
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
          buildButtonPopoutWindowLabel({ popoutUnitId: unit.id, ownerButtonId }),
          document
        );
        return;
      }

      const setup = Object.values(document.fanSetups).find(
        (candidate) => candidate.fanSurfaceId === selectedSurfaceId
      );
      if (!setup) {
        throw new Error("Choose a Pop or saved Fan placement before opening its live window.");
      }
      await closeButtonFanWindow(setup.panelOwnerButtonId).catch(() => {});
      await openButtonFanWindow({
        programName: setup.programName,
        panelName: setup.panelName,
        fanSetupId: setup.id,
        panelOwnerButtonId: setup.panelOwnerButtonId,
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
        buildButtonFanWindowLabel(setup.panelOwnerButtonId),
        document
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
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
      if (
        current.activationAnimation?.presetId === presetId &&
        desktopBoundsEqual(current.activationAnimation.desktopBounds, resolvedBounds)
      ) {
        setActiveAnimationEditorButtonId(button.id);
        return;
      }
      store.transact((draft) => {
        const target = draft.buttons[button.id];
        if (!target) return;
        target.activationAnimation = {
          presetId,
          desktopBounds: resolvedBounds
        };
      }, { label: "Assign Button animation" });
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
      store.transact((draft) => {
        const target = draft.buttons[button.id];
        if (!target?.activationAnimation) return;
        target.activationAnimation.desktopBounds = bounds;
      }, {
        label: "Position Button animation",
        coalesceKey: `button-animation-bounds:${button.id}`
      });
      setActiveAnimationEditorButtonId(null);
      setMessage("Animation position and size updated. Click the main Save button to commit the Button draft.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const closeButtonAnimationEditor = async () => {
    await hideButtonActivationAnimationEditorWindow().catch(() => {});
    setActiveAnimationEditorButtonId(null);
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
        const setup = setups.find((candidate) => candidate.fanSurfaceId === selectedSurfaceId) ?? setups[0];
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
      <header className="button-editor-header">
        <h1>Buttons</h1>
        <ButtonSurfaceSelector
          document={store.draft}
          surfaceId={selectedSurfaceId}
          programs={programOptions}
          panels={panelOptions}
          buttonOptions={buttonOptions}
          placementOptions={placementOptions}
          programName={programName}
          panelName={panelName}
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
            const option = placementOptions.find((candidate) => candidate.id === placementId);
            if (option?.action === "create-default-fan") {
              createDefaultFanSetup();
              return;
            }
            if (option?.action === "show-tool-set-popout") {
              showToolSetPopoutSurface(option.surfaceId);
              return;
            }
            if (placementId) focusPlacement(placementId);
            else {
              setFocusedPlacementId(null);
              setSelectedPlacementIds(new Set());
            }
          }}
          onSurfaceSizeChange={(surfaceId, width, height) => store.transact((draft) => {
            draft.surfaces[surfaceId].width = Math.max(1, width);
            draft.surfaces[surfaceId].height = Math.max(1, height);
            const unit = Object.values(draft.popoutUnits).find((candidate) => candidate.surfaceId === surfaceId);
            if (unit) unit.canonicalBounds = { ...unit.canonicalBounds, width: Math.max(1, width), height: Math.max(1, height) };
          }, { label: "Resize Button surface", coalesceKey: `surface:${surfaceId}` })}
          onDesktopBoundsChange={(unitId, bounds) => store.transact((draft) => {
            const unit = draft.popoutUnits[unitId];
            unit.desktopBounds = bounds;
            unit.desktopBoundsFitMode = unit.windowFitMode ?? "surface";
          }, { label: "Place Button window", coalesceKey: `desktop:${unitId}` })}
          onPopoutChange={(unitId, patch) => store.transact((draft) => {
            Object.assign(draft.popoutUnits[unitId], patch);
          }, { label: "Edit popout configuration", coalesceKey: `popout:${unitId}` })}
          onFanSetupChange={(setupId, patch) => store.transact((draft) => {
            const setup = draft.fanSetups[setupId];
            Object.assign(setup, patch);
            if (patch.collapsedPanelOwnerBounds) {
              setup.collapsedBoundsFitMode = setup.windowFitMode ?? "surface";
            }
          }, { label: "Edit fan setup", coalesceKey: `fan:${setupId}` })}
          onFanToolSetAnchorChange={(setupId, ownerButtonId, bounds) => store.transact((draft) => {
            draft.fanSetups[setupId].toolSetOwnerAnchors[ownerButtonId] = bounds;
          }, {
            label: "Place fan tool-set owner",
            coalesceKey: `fan-anchor:${setupId}:${ownerButtonId}`
          })}
          onOpenWindow={openSelectedNativeWindow}
        />
        <div className="button-editor-toolbar">
          <label className="button-editor-mode"><span>Edit</span><input type="checkbox" checked={mode === "run"} onChange={(event) => {
            const nextMode = event.currentTarget.checked ? "run" : "edit";
            setMode(nextMode);
            if (nextMode === "run") setReorderMode(false);
          }} /><span>Run</span></label>
          <button
            type="button"
            className={reorderMode ? "button-editor-toolbar__toggle is-active" : "button-editor-toolbar__toggle"}
            aria-pressed={reorderMode}
            disabled={mode !== "edit" || selectedSurfaceButtonCount < 2 || busy}
            onClick={() => setReorderMode((current) => !current)}
          >
            Reorder
          </button>
          <button
            type="button"
            disabled={mode !== "edit" || selectedSurfaceButtonCount === 0 || busy}
            onClick={snapSelectedSurfaceToTopLeft}
          >
            Snap to top left corner
          </button>
          <button type="button" disabled={!store.canUndo || busy} onClick={store.undo}>Undo</button>
          <button type="button" disabled={!store.canRedo || busy} onClick={store.redo}>Redo</button>
          <button type="button" onClick={() => void openMotionSettingsWindow()}>Motion Settings</button>
          <button type="button" disabled={busy} onClick={() => void save()}>Save</button>
          <button type="button" disabled={busy} onClick={() => void cancel(false)}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void cancel(true)}>Reset</button>
        </div>
      </header>
      {message && <pre className="button-editor-message">{message}</pre>}
      <div className="button-editor-layout">
        <ButtonLibrary
          document={store.draft}
          programName={programName}
          panelName={panelName}
          selectedButtonId={selectedButton?.id ?? null}
          canUpdateSource={Boolean(
            selectedButton?.sourceIdentity &&
            (selectedButton.role === "single-script" || selectedButton.role === "tool-set-owner")
          )}
          busy={busy}
          onImportSingle={() => void importSource("script")}
          onImportToolSet={() => void importSource("tool-set", window.confirm("Choose an entire tool-set package folder?\n\nOK = folder, Cancel = manifest/script file."))}
          onUpdateSource={() => void updateSelectedSource()}
          onDeleteButton={() => {
            if (!selectedButton) return;
            if (selectedButton.role === "panel-owner") {
              setMessage("Panel Buttons are owned by their registered panel and cannot be deleted here.");
              return;
            }
            void hideButtonActivationAnimationEditorWindow();
            setActiveAnimationEditorButtonId(null);
            store.transact((draft) => {
              const result = removeOwnedButtonGraph(draft, selectedButton.id);
              result.uninstallOwnerButtonIds.forEach((id) => pendingUninstallsRef.current.add(id));
              for (const placementId of freshPlacementsRef.current) {
                if (!draft.placements[placementId]) freshPlacementsRef.current.delete(placementId);
              }
            }, { label: "Delete Button" });
            setFocusedPlacementId(null);
            setSelectedPlacementIds(new Set());
          }}
          onNewRegularPopout={createRegularPopout}
          fanBuilder={(
            <FanBuilder
              programName={programName}
              panelName={panelName}
              candidates={fanCandidates}
              selectedButtonIds={fanBuilderButtonIds}
              activeFanName={activeFanSetup?.name}
              busy={busy}
              onToggleButton={(buttonId, selected) => setFanBuilderButtonIds((current) => {
                const next = new Set(current);
                if (selected) next.add(buttonId);
                else next.delete(buttonId);
                return next;
              })}
              onSelectAll={() => setFanBuilderButtonIds(new Set(
                fanCandidates.map((candidate) => candidate.id)
              ))}
              onClear={() => setFanBuilderButtonIds(new Set())}
              onBuildNewFan={createFanSetup}
              onUpdateActiveFan={activeFanSetup ? updateActiveFanSetupMembers : undefined}
            />
          )}
        />
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
        <ButtonInspector
          button={selectedButton}
          placement={selectedPlacement}
          skins={Object.values(store.draft.skins)}
          onButtonChange={(patch, coalesceKey) => {
            if (selectedButton) store.transact((draft) => { Object.assign(draft.buttons[selectedButton.id], patch); }, { label: "Edit Button", coalesceKey });
          }}
          onPlacementChange={(patch, coalesceKey) => {
            if (!selectedPlacement) return;
            const changesGeometry = ["x", "y", "width", "height"].some((key) => Object.hasOwn(patch, key));
            if (changesGeometry) {
              const candidate = { ...selectedPlacement, ...patch };
              const surface = store.draft.surfaces[selectedPlacement.surfaceId];
              const others = surface.placementIds.filter((id) => id !== selectedPlacement.id).map((id) => store.draft.placements[id]);
              const valid = isButtonRectInsideSurface(candidate, surface) &&
                !others.some((other) => buttonRectsOverlap(candidate, other));
              if (!valid) {
                setMessage("That geometry would overlap another Button or leave the surface.");
                return;
              }
            }
            setMessage(null);
            if (Object.hasOwn(patch, "textSizeOverride")) {
              pendingTextSizeResizeRef.current.set(
                selectedPlacement.id,
                patch.textSizeOverride ?? null
              );
            }
            store.transact((draft) => { Object.assign(draft.placements[selectedPlacement.id], patch); }, { label: "Edit placement", coalesceKey });
          }}
          onActivationAnimationChange={(presetId) => {
            if (!selectedButton) return;
            if (!presetId) {
              store.transact((draft) => {
                draft.buttons[selectedButton.id].activationAnimation = null;
              }, { label: "Remove Button animation" });
              void hideButtonActivationAnimationEditorWindow();
              setActiveAnimationEditorButtonId(null);
              return;
            }
            void configureButtonAnimation(selectedButton, presetId);
          }}
          onConfigureActivationAnimation={() => {
            if (!selectedButton?.activationAnimation) return;
            void configureButtonAnimation(
              selectedButton,
              selectedButton.activationAnimation.presetId,
              selectedButton.activationAnimation.desktopBounds
            );
          }}
          activationAnimationEditorOpen={activeAnimationEditorButtonId === selectedButton?.id}
          onSaveActivationAnimationBounds={() => {
            if (!selectedButton) return;
            void saveButtonAnimationBounds(selectedButton);
          }}
          onCloseActivationAnimationEditor={() => {
            void closeButtonAnimationEditor();
          }}
        />
        <ButtonSkinEditor
          skin={selectedSkin}
          onSkinChange={(skin, label, coalesceKey) => store.transact((draft) => {
            draft.skins[skin.id] = skin;
            resolveButtonEditorPanelSkinTargetPlacementIds(
              draft,
              programName,
              panelName,
              selectedPlacement?.id ?? ""
            ).forEach((placementId) => {
              draft.placements[placementId].skinOverrideId = skin.id;
            });
          }, { label, coalesceKey })}
          onCreateSkin={() => {
            const id = createStableButtonId("skin");
            const base = cloneButtonDocument(store.draft.skins[store.draft.settings.defaultSkinId]);
            const skin: ButtonSkin = { ...base, id, name: `New Skin ${Object.keys(store.draft.skins).length + 1}`, compileCache: null, metadata: {} };
            store.transact((draft) => { draft.skins[id] = skin; if (selectedPlacement) draft.placements[selectedPlacement.id].skinOverrideId = id; }, { label: "Create skin" });
          }}
          onDuplicateSkin={() => {
            if (!selectedSkin || !selectedPlacement) return;
            const id = createStableButtonId("skin");
            const duplicate = { ...cloneButtonDocument(selectedSkin), id, name: `${selectedSkin.name} Copy` };
            store.transact((draft) => { draft.skins[id] = duplicate; draft.placements[selectedPlacement.id].skinOverrideId = id; }, { label: "Duplicate skin" });
          }}
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
