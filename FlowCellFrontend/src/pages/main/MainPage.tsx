import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
  type Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { CanonicalActionButton } from "../../button/CanonicalActionButton";
import { startButtonActivationStateCoordinator } from "../../button/runtime/ButtonActivationStateBus";
import { ExactPageFrame } from "../../components/ExactPageFrame";
import { RailSurface } from "../../components/RailSurface";
import {
  beginProgramUnregistration,
  finalizePanelDeletion,
  finalizeProgramUnregistration,
  finalizeProgramRename,
  loadLayoutSnapshot,
  listPanelFolders,
  listPanelScriptFiles,
  listProgramFolders,
  PROGRAM_SETUP_COMMITTED_EVENT,
  preparePanelDeletion,
  renamePanelFolder,
  renameProgramFolder,
  recoverProgramRename,
  rollbackProgramRename,
  rollbackProgramUnregistration,
  rollbackPanelDeletion,
  saveLayoutSnapshot,
  showOpenLayoutDialog,
  showSaveLayoutDialog,
  type PanelScriptFileRecord,
  type ProgramSetupCommittedEvent
} from "../../lib/programRails";
import {
  readLastLayoutDirectory,
  readRegisteredLayoutWindow,
  writeLastLayoutDirectory
} from "../../lib/layoutSnapshots";
import {
  readLastLayoutPath,
  readStartupSettings,
  writeLastLayoutPath,
  writeStartupSettings,
  type StartupSettings
} from "../../lib/startupSettings";
import {
  closeInstalledPageWindow,
  openAddPanelWindow,
  openAddProgramWindow,
  openBindsWindow,
  openMacroLabWindow,
  reloadCurrentHostWindow
} from "../../lib/coreWindows";
import {
  closeButtonFanWindow,
  closeButtonPopoutWindow,
  openButtonEditorWindow,
  openButtonFanWindow,
  openButtonPopoutWindow,
  toggleButtonPopoutWindow
} from "../../button/windows/buttonWindows";
import { isUsableButtonWindowBounds } from "../../button/windows/buttonWindowGeometry";
import {
  bootstrapButtonStateDocument,
  loadButtonStateDocument,
  saveButtonStateDocument
} from "../../button/state/ButtonStateRepository";
import {
  removedInstalledPageOwnerIds,
  scopedInstalledPageOwnerIds
} from "../../button/state/installedPageLifecycle";
import {
  publishButtonCommit,
  subscribeButtonCommits
} from "../../button/state/ButtonDraftBus";
import { cloneButtonDocument } from "../../button/state/buttonDefaults";
import {
  ensureFanSetup,
  ensureRegularPopout,
  removeOwnedButtonGraph
} from "../../button/state/buttonDocumentOperations";
import { resolvePanelOwnerMainPlacement } from "../../button/state/panelOwnerButtonOperations";
import {
  removePanelButtonDocumentScope,
  removeProgramButtonDocumentScope,
  renamePanelButtonDocumentScope,
  renameProgramButtonDocumentScope
} from "../../button/state/buttonDocumentScopeOperations";
import {
  executeButtonRecord,
  resolveButtonPressEventPlan
} from "../../button/runtime/ButtonRuntimeAdapter";
import {
  ownerButtonIdFromHotkeyPayload,
  resolveToolSetOwnerActivationTarget,
  TOOL_SET_OWNER_HOTKEY_EVENT,
  type ToolSetOwnerHotkeyPayload
} from "../../button/runtime/toolSetOwnerHotkeyBridge";
import type {
  ButtonRecord as CanonicalButtonRecord,
  ButtonSourceIdentity,
  ButtonStateDocument,
  ToolSetButtonPopoutUnit
} from "../../button/types";
import {
  listFrontendPanelMacros,
  MACRO_PANEL_CHANGED_EVENT,
  runFrontendMacro
} from "../../lib/macros";
import {
  readMotionSettings,
  subscribeMotionSettings,
  type MotionSettings
} from "../../lib/motionSettings";
import mainBackground from "../../assets/backgrounds/main-background.jpeg";
import type { FlowCellBounds, LayoutSnapshot, LayoutSnapshotWindow } from "../../types";
import {
  buildButtonsSurfaceButtons,
  buildPanelRailButtons,
  buildProgramRailButtons,
  page,
  rails,
  staticButtons,
  type ButtonRecord
} from "./mainLayout";
import { MainButtonHost, MainControlHost } from "./MainButtonHost";
import "./mainPage.css";

type ButtonContextMenuState = {
  buttonId: string;
  x: number;
  y: number;
};

type FanSetupMenuState = {
  left: number;
  top: number;
};

type MacroPanelChangedPayload = {
  programName?: string;
  panelName?: string;
};

const BUTTON_CONTEXT_MENU_WIDTH = 168;
const BUTTON_CONTEXT_MENU_HEIGHT = 156;
const BUTTON_CONTEXT_MENU_MARGIN = 8;
const BUTTON_STATE_MUTATION_ATTEMPTS = 3;
// Version 7 marks bounds stored in physical desktop pixels, captured exactly
// as the window sits on its monitor and restored verbatim (position first,
// then size — see applyWindowBounds / windowing's applyWindowPlacement).
const LAYOUT_SNAPSHOT_VERSION = 8;

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ButtonStateMutationResult = boolean | {
  changed: boolean;
  uninstallOwnerButtonIds?: readonly string[];
};

async function commitButtonStateMutationWithRetry(
  mutate: (document: ButtonStateDocument) => ButtonStateMutationResult,
  programRenameToken?: string
): Promise<ButtonStateDocument> {
  let current = await loadButtonStateDocument();
  for (let attempt = 0; attempt < BUTTON_STATE_MUTATION_ATTEMPTS; attempt += 1) {
    const draft = cloneButtonDocument(current);
    const result = mutate(draft);
    const changed = typeof result === "boolean" ? result : result.changed;
    const uninstallOwnerButtonIds = typeof result === "boolean"
      ? []
      : result.uninstallOwnerButtonIds ?? [];
    if (!changed) {
      if (programRenameToken) await finalizeProgramRename(programRenameToken);
      return current;
    }
    let saved: ButtonStateDocument;
    try {
      saved = await saveButtonStateDocument(
        draft,
        current.revision,
        uninstallOwnerButtonIds,
        undefined,
        programRenameToken
      );
    } catch (error) {
      const latest = await loadButtonStateDocument();
      const verificationDraft = cloneButtonDocument(latest);
      const verificationResult = mutate(verificationDraft);
      const mutationAlreadyApplied = typeof verificationResult === "boolean"
        ? !verificationResult
        : !verificationResult.changed;
      if (mutationAlreadyApplied) {
        if (programRenameToken) await recoverProgramRename(programRenameToken);
        return latest;
      }
      if (
        attempt < BUTTON_STATE_MUTATION_ATTEMPTS - 1 &&
        latest.revision !== current.revision
      ) {
        current = latest;
        continue;
      }
      throw error;
    }
    try {
      await publishButtonCommit(saved);
    } catch (error) {
      console.error(
        "Canonical Button state was saved, but its cross-window commit event failed.",
        error
      );
    }
    return saved;
  }
  return current;
}

async function closePanelOwnerFanWindows(ownerButtonIds: readonly string[]): Promise<void> {
  await Promise.all(
    [...new Set(ownerButtonIds)].map((ownerButtonId) => closeButtonFanWindow(ownerButtonId))
  );
}

async function closeRemovedButtonWindows(
  previous: ButtonStateDocument,
  next: ButtonStateDocument
): Promise<void> {
  const operations: Promise<void>[] = [];
  for (const unit of Object.values(previous.popoutUnits)) {
    if (next.popoutUnits[unit.id]) continue;
    operations.push(closeButtonPopoutWindow({
      popoutUnitId: unit.id,
      ownerButtonId: unit.kind === "tool-set" ? unit.ownerButtonId : undefined
    }));
  }
  const removedFanOwnerIds = Object.values(previous.fanSetups)
    .filter((setup) => !next.fanSetups[setup.id])
    .map((setup) => setup.panelOwnerButtonId);
  operations.push(...[...new Set(removedFanOwnerIds)].map(closeButtonFanWindow));
  operations.push(...removedInstalledPageOwnerIds(previous, next).map(closeInstalledPageWindow));
  await Promise.allSettled(operations);
}

function sourceIdentityMatchesFolderScope(
  identity: ButtonSourceIdentity | null,
  programName: string,
  panelName?: string
): boolean {
  return Boolean(
    identity &&
    areFolderNamesEqual(identity.displayProgramName, programName) &&
    (panelName === undefined || areFolderNamesEqual(identity.displayPanelName, panelName))
  );
}

type CanonicalRenameScope = {
  programName: string;
  panelName?: string;
};

function canonicalButtonMatchesRenameScope(
  button: CanonicalButtonRecord,
  scope: CanonicalRenameScope
): boolean {
  if (
    button.role !== "tool-set-child" &&
    sourceIdentityMatchesFolderScope(
      button.sourceIdentity,
      scope.programName,
      scope.panelName
    )
  ) {
    return true;
  }
  return Boolean(
    button.role === "panel-owner" &&
    typeof button.metadata.programName === "string" &&
    areFolderNamesEqual(button.metadata.programName, scope.programName) &&
    (scope.panelName === undefined || (
      typeof button.metadata.panelName === "string" &&
      areFolderNamesEqual(button.metadata.panelName, scope.panelName)
    ))
  );
}

function folderNamesMatchExactly(left: string, right: string): boolean {
  return left.normalize("NFC").trim() === right.normalize("NFC").trim();
}

function canonicalButtonMatchesRenameScopeExactly(
  button: CanonicalButtonRecord,
  scope: CanonicalRenameScope
): boolean {
  if (
    button.role !== "tool-set-child" &&
    button.sourceIdentity &&
    folderNamesMatchExactly(button.sourceIdentity.displayProgramName, scope.programName) &&
    (scope.panelName === undefined ||
      folderNamesMatchExactly(button.sourceIdentity.displayPanelName, scope.panelName))
  ) {
    return true;
  }
  return Boolean(
    button.role === "panel-owner" &&
    typeof button.metadata.programName === "string" &&
    folderNamesMatchExactly(button.metadata.programName, scope.programName) &&
    (scope.panelName === undefined || (
      typeof button.metadata.panelName === "string" &&
      folderNamesMatchExactly(button.metadata.panelName, scope.panelName)
    ))
  );
}

function collectCanonicalRenameButtonIds(
  document: ButtonStateDocument,
  scope: CanonicalRenameScope
): string[] {
  return Object.values(document.buttons)
    .filter((button) => canonicalButtonMatchesRenameScope(button, scope))
    .map((button) => button.id)
    .sort();
}

function canonicalRenameWasPersisted(
  document: ButtonStateDocument,
  buttonIds: readonly string[],
  previousScope: CanonicalRenameScope,
  nextScope: CanonicalRenameScope
): boolean {
  const caseOnlyProgramRename =
    areFolderNamesEqual(previousScope.programName, nextScope.programName) &&
    !folderNamesMatchExactly(previousScope.programName, nextScope.programName);
  const caseOnlyPanelRename =
    previousScope.panelName !== undefined &&
    nextScope.panelName !== undefined &&
    areFolderNamesEqual(previousScope.panelName, nextScope.panelName) &&
    !folderNamesMatchExactly(previousScope.panelName, nextScope.panelName);
  const matchesSide = caseOnlyProgramRename || caseOnlyPanelRename
    ? canonicalButtonMatchesRenameScopeExactly
    : canonicalButtonMatchesRenameScope;
  const trackedButtonsMigratedOrRemoved = buttonIds.every((buttonId) => {
    const button = document.buttons[buttonId];
    return !button || matchesSide(button, nextScope);
  });
  const previousScopeRemains = Object.values(document.buttons).some((button) =>
    matchesSide(button, previousScope)
  );
  return trackedButtonsMigratedOrRemoved && !previousScopeRemains;
}

async function recoverCanonicalRenameOrRollback(
  error: unknown,
  args: {
    affectedButtonIds: readonly string[];
    previousScope: CanonicalRenameScope;
    nextScope: CanonicalRenameScope;
    rollback: () => Promise<unknown>;
    recoverCommitted?: () => Promise<unknown>;
    label: string;
  }
): Promise<ButtonStateDocument> {
  let latest: ButtonStateDocument;
  try {
    latest = await loadButtonStateDocument();
  } catch (verificationError) {
    throw new Error(
      `${formatErrorMessage(error)}\n\nThe canonical Button state could not be verified, so the ${args.label} rename was retained to avoid an unsafe rollback. Verification also failed: ${formatErrorMessage(verificationError)}`
    );
  }
  if (canonicalRenameWasPersisted(
    latest,
    args.affectedButtonIds,
    args.previousScope,
    args.nextScope
  )) {
    if (args.recoverCommitted) await args.recoverCommitted();
    return latest;
  }
  try {
    await args.rollback();
  } catch (rollbackError) {
    throw new Error(
      `${formatErrorMessage(error)}\n\nThe canonical Button update failed and the ${args.label} rename could not be rolled back: ${formatErrorMessage(rollbackError)}`
    );
  }
  throw error;
}

async function closeRenamedButtonWindows(
  document: ButtonStateDocument,
  programName: string,
  panelName?: string
): Promise<void> {
  const operations: Promise<void>[] = [];
  for (const unit of Object.values(document.popoutUnits)) {
    const belongsToScope = unit.kind === "regular"
      ? unit.memberSourceIdentities.some((identity) =>
          sourceIdentityMatchesFolderScope(identity, programName, panelName)
        )
      : sourceIdentityMatchesFolderScope(
          document.buttons[unit.ownerButtonId]?.sourceIdentity ?? null,
          programName,
          panelName
        );
    if (!belongsToScope) continue;
    operations.push(closeButtonPopoutWindow({
      popoutUnitId: unit.id,
      ownerButtonId: unit.kind === "tool-set" ? unit.ownerButtonId : undefined
    }));
  }
  const fanOwnerIds = Object.values(document.fanSetups)
    .filter((setup) =>
      areFolderNamesEqual(setup.programName, programName) &&
      (panelName === undefined || areFolderNamesEqual(setup.panelName, panelName))
    )
    .map((setup) => setup.panelOwnerButtonId);
  operations.push(...[...new Set(fanOwnerIds)].map(closeButtonFanWindow));
  operations.push(...scopedInstalledPageOwnerIds(document, programName, panelName).map(closeInstalledPageWindow));
  await Promise.allSettled(operations);
}

function clampContextMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }

  return {
    x: Math.max(
      BUTTON_CONTEXT_MENU_MARGIN,
      Math.min(x, window.innerWidth - BUTTON_CONTEXT_MENU_WIDTH - BUTTON_CONTEXT_MENU_MARGIN)
    ),
    y: Math.max(
      BUTTON_CONTEXT_MENU_MARGIN,
      Math.min(y, window.innerHeight - BUTTON_CONTEXT_MENU_HEIGHT - BUTTON_CONTEXT_MENU_MARGIN)
    )
  };
}

function serializeDomRect(node: Element | null): Record<string, number> | null {
  if (!(node instanceof Element)) {
    return null;
  }

  const rect = node.getBoundingClientRect();
  return {
    left: Number(rect.left.toFixed(3)),
    top: Number(rect.top.toFixed(3)),
    width: Number(rect.width.toFixed(3)),
    height: Number(rect.height.toFixed(3)),
    right: Number(rect.right.toFixed(3)),
    bottom: Number(rect.bottom.toFixed(3))
  };
}

function serializeButtonLayoutRect(button: ButtonRecord | null | undefined) {
  if (!button) {
    return null;
  }

  return {
    x: button.x,
    y: button.y,
    width: button.width,
    height: button.height
  };
}

function isToolSetRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return Boolean(record && (record.children?.length ?? 0) > 0);
}

async function listPanelButtonRecords(
  programName: string,
  panelName: string
): Promise<PanelScriptFileRecord[]> {
  const [sources, macros] = await Promise.all([
    listPanelScriptFiles(programName, panelName),
    listFrontendPanelMacros(programName, panelName)
  ]);
  return [
    ...sources,
    ...macros.map((macro) => ({
      fileName: `macro:${macro.id}`,
      label: macro.label,
      tooltip: `Run the saved '${macro.label}' macro.`,
      kind: "macro",
      macroId: macro.id
    }))
  ].sort((left, right) => left.label.localeCompare(right.label));
}

function canonicalButtonSourceKey(programName: string, panelName: string, fileName: string): string {
  return [programName, panelName, fileName]
    .map((value) => value.trim().normalize("NFKC").toLocaleLowerCase("en-US"))
    .join("\u001f");
}

function canonicalProgramPanelKey(programName: string, panelName: string): string {
  return [programName, panelName]
    .map((value) => value.trim().normalize("NFKC").toLocaleLowerCase("en-US"))
    .join("\u001f");
}

function canonicalPanelSourceInventorySignature(
  document: ButtonStateDocument,
  programName: string,
  panelName: string
): string {
  const childIdsByOwner = new Map<string, string[]>();
  for (const button of Object.values(document.buttons)) {
    if (!button.toolSetParentId) continue;
    const childIds = childIdsByOwner.get(button.toolSetParentId) ?? [];
    childIds.push(button.id);
    childIdsByOwner.set(button.toolSetParentId, childIds);
  }

  return JSON.stringify(
    Object.values(document.buttons)
      .flatMap((button) => {
        const identity = button.sourceIdentity;
        if (
          button.role === "tool-set-child" ||
          !identity ||
          !areFolderNamesEqual(identity.displayProgramName, programName) ||
          !areFolderNamesEqual(identity.displayPanelName, panelName)
        ) {
          return [];
        }
        return [{
          id: button.id,
          role: button.role,
          fileName: identity.displayFileName,
          childIds: [...(childIdsByOwner.get(button.id) ?? [])].sort()
        }];
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  );
}

function isPanelScriptButtonAction(actionId: string): boolean {
  return actionId === "run-panel-script" || actionId === "run-panel-macro";
}

function resolveFolderSelection(
  names: readonly string[],
  preferredName: string | null | undefined
): string | null {
  if (preferredName) {
    const matchedName = names.find(
      (name) => name.localeCompare(preferredName, undefined, { sensitivity: "accent" }) === 0
    );
    if (matchedName) {
      return matchedName;
    }
  }

  return names[0] ?? null;
}

function areFolderNamesEqual(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0
  );
}

function buildSuggestedLayoutName(): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    "-",
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
    now.getSeconds().toString().padStart(2, "0")
  ].join("");
  return `layout-${stamp}.flowlayout.json`;
}

function getParentDirectory(path: string): string | null {
  const normalized = path.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (separatorIndex <= 0) {
    return null;
  }

  return normalized.slice(0, separatorIndex);
}

function isValidFlowCellBounds(bounds: FlowCellBounds | null | undefined): bounds is FlowCellBounds {
  return isUsableButtonWindowBounds(bounds);
}

type WindowBoundsTarget = Pick<TauriWindow, "outerPosition" | "innerSize">;

async function captureWindowBounds(target: WindowBoundsTarget): Promise<FlowCellBounds | null> {
  const [position, size] = await Promise.all([
    target.outerPosition().catch(() => null),
    target.innerSize().catch(() => null)
  ]);

  if (!position || !size) {
    return null;
  }

  const bounds = {
    Left: Number(position.x.toFixed(3)),
    Top: Number(position.y.toFixed(3)),
    Width: Number(size.width.toFixed(3)),
    Height: Number(size.height.toFixed(3))
  };
  return isValidFlowCellBounds(bounds) ? bounds : null;
}

type WindowPlacementTarget = Pick<TauriWindow, "setPosition" | "setSize">;

async function applyWindowBounds(
  target: WindowPlacementTarget,
  bounds: FlowCellBounds
): Promise<void> {
  // Position before size: a cross-monitor move makes Windows rescale the
  // window by the DPI ratio, which would corrupt a size applied first.
  await target
    .setPosition(new PhysicalPosition(bounds.Left, bounds.Top))
    .catch(() => {});
  await target.setSize(new PhysicalSize(bounds.Width, bounds.Height)).catch(() => {});
}

export default function MainPage() {
  const topLeftActionGroupRef = useRef<HTMLDivElement | null>(null);
  const layoutActionPendingRef = useRef(false);
  const preferredPanelSelectionRef = useRef<string | null>(null);
  const preferredSelectedPanelScriptFileNamesRef = useRef<{
    programName: string;
    panelName: string;
    fileNames: string[];
  } | null>(null);
  const panelFolderLoadRequestRef = useRef(0);
  const panelScriptLoadRequestRef = useRef(0);
  const [contextMenu, setContextMenu] = useState<ButtonContextMenuState | null>(null);
  const [fanSetupMenu, setFanSetupMenu] = useState<FanSetupMenuState | null>(null);
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [selectedProgramName, setSelectedProgramName] = useState<string | null>(null);
  const [panelNames, setPanelNames] = useState<string[]>([]);
  const [selectedPanelName, setSelectedPanelName] = useState<string | null>(null);
  const [panelScripts, setPanelScripts] = useState<PanelScriptFileRecord[]>([]);
  const [selectedPanelScriptFileNames, setSelectedPanelScriptFileNames] = useState<string[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [startupSettings, setStartupSettings] = useState<StartupSettings>(() =>
    readStartupSettings()
  );
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragging, setSpaceDragging] = useState(false);
  const [motionSettings, setMotionSettings] = useState<MotionSettings>(() =>
    readMotionSettings()
  );
  const [hoveredRailId, setHoveredRailId] = useState<string | null>(null);
  const [buttonDocument, setButtonDocument] = useState<ButtonStateDocument | null>(null);
  const buttonDocumentRef = useRef<ButtonStateDocument | null>(null);
  const previousButtonDocumentRef = useRef<ButtonStateDocument | null>(null);
  const selectedProgramNameRef = useRef<string | null>(selectedProgramName);
  const selectedPanelNameRef = useRef<string | null>(selectedPanelName);
  selectedProgramNameRef.current = selectedProgramName;
  selectedPanelNameRef.current = selectedPanelName;

  useEffect(() => {
    let disposed = false;
    let stopCoordinator: (() => void) | null = null;
    void startButtonActivationStateCoordinator()
      .then((stop) => {
        if (disposed) stop();
        else stopCoordinator = stop;
      })
      .catch((error) => {
        console.error("Button activation state coordinator could not start.", error);
      });
    return () => {
      disposed = true;
      stopCoordinator?.();
    };
  }, []);

  const applyPanelScriptRecords = useCallback((
    programName: string,
    panelName: string,
    records: PanelScriptFileRecord[]
  ) => {
    setPanelScripts(records);
    const preferredSelection = preferredSelectedPanelScriptFileNamesRef.current;
    if (
      !preferredSelection ||
      !areFolderNamesEqual(preferredSelection.programName, programName) ||
      !areFolderNamesEqual(preferredSelection.panelName, panelName)
    ) {
      return;
    }
    preferredSelectedPanelScriptFileNamesRef.current = null;
    const selectableFileNames = new Set(records.map((record) => record.fileName));
    setSelectedPanelScriptFileNames(
      preferredSelection.fileNames.filter((fileName) => selectableFileNames.has(fileName))
    );
  }, []);
  const acceptButtonDocument = useCallback((document: ButtonStateDocument) => {
    const current = buttonDocumentRef.current;
    if (current && document.revision <= current.revision) return false;
    buttonDocumentRef.current = document;
    setButtonDocument(document);
    return true;
  }, []);
  const commitButtonDocumentMutation = useCallback(async (
    mutate: (document: ButtonStateDocument) => ButtonStateMutationResult,
    programRenameToken?: string
  ) => {
    const saved = await commitButtonStateMutationWithRetry(mutate, programRenameToken);
    acceptButtonDocument(saved);
    return saved;
  }, [acceptButtonDocument]);

  useEffect(() => {
    const previous = previousButtonDocumentRef.current;
    previousButtonDocumentRef.current = buttonDocument;
    if (!previous || !buttonDocument) return;
    void closeRemovedButtonWindows(previous, buttonDocument);
  }, [buttonDocument]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const refreshPanelSourceRecords = (programName: string, panelName: string) => {
      const requestId = panelScriptLoadRequestRef.current + 1;
      panelScriptLoadRequestRef.current = requestId;
      void listPanelButtonRecords(programName, panelName)
        .then((records) => {
          if (
            disposed ||
            panelScriptLoadRequestRef.current !== requestId ||
            !areFolderNamesEqual(selectedProgramNameRef.current, programName) ||
            !areFolderNamesEqual(selectedPanelNameRef.current, panelName)
          ) {
            return;
          }
          applyPanelScriptRecords(programName, panelName, records);
        })
        .catch((error) => {
          console.error(
            `Failed to refresh panel scripts for ${programName}/${panelName}.`,
            error
          );
        });
    };

    void (async () => {
      try {
        unlisten = await subscribeButtonCommits((document) => {
          if (disposed) return;
          const previous = buttonDocumentRef.current;
          const programName = selectedProgramNameRef.current;
          const panelName = selectedPanelNameRef.current;
          const sourceInventoryChanged = Boolean(
            programName &&
            panelName &&
            (
              !previous ||
              canonicalPanelSourceInventorySignature(previous, programName, panelName) !==
                canonicalPanelSourceInventorySignature(document, programName, panelName)
            )
          );
          if (
            !acceptButtonDocument(document) ||
            !sourceInventoryChanged ||
            !programName ||
            !panelName
          ) {
            return;
          }

          refreshPanelSourceRecords(programName, panelName);
        });
        if (disposed) {
          unlisten();
          unlisten = null;
          return;
        }

        const { document, changed } = await bootstrapButtonStateDocument();
        if (disposed) return;
        const accepted = acceptButtonDocument(document);
        const programName = selectedProgramNameRef.current;
        const panelName = selectedPanelNameRef.current;
        if (programName && panelName) {
          refreshPanelSourceRecords(programName, panelName);
        }
        if (accepted && changed) {
          await publishButtonCommit(document).catch((error) => {
            console.error("Failed to publish bootstrapped Button state.", error);
          });
        }
      } catch (error) {
        if (!disposed) {
          console.error("Failed to bootstrap canonical Button state.", error);
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    };
  }, [acceptButtonDocument, applyPanelScriptRecords]);

  // Motion settings are edited in their own window and applied live here.
  useEffect(() => subscribeMotionSettings(setMotionSettings), []);

  // Rails are pointer-events:none (so buttons on top keep their clicks). Detect the
  // hovered rail by hit-testing the pointer against each rail rect — no clicks are
  // intercepted, and it works through the scaled page plane since rects are viewport.
  const handleRailHoverPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const { clientX, clientY } = event;
    let nextRailId: string | null = null;
    document.querySelectorAll<HTMLElement>(".rail-surface").forEach((node) => {
      if (nextRailId) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        nextRailId = node.dataset.railId ?? null;
      }
    });
    setHoveredRailId((current) => (current === nextRailId ? current : nextRailId));
  };

  // Frameless window: hold Space then drag to move it.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      if (!event.repeat) {
        setSpaceDragActive(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    const handleBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragging(false);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const handleMainShellPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !spaceDragActive) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSpaceDragging(true);
    void getCurrentWindow()
      .startDragging()
      .catch(() => setSpaceDragging(false));
  };

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    const restoreCursorEvents = () => {
      void currentWindow.setIgnoreCursorEvents(false).catch(() => {});
    };

    restoreCursorEvents();
    window.addEventListener("focus", restoreCursorEvents);
    window.addEventListener("pointerenter", restoreCursorEvents);
    return () => {
      window.removeEventListener("focus", restoreCursorEvents);
      window.removeEventListener("pointerenter", restoreCursorEvents);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextProgramNames = await listProgramFolders();
        if (cancelled) {
          return;
        }

        setProgramNames(nextProgramNames);
        setSelectedProgramName((current) => resolveFolderSelection(nextProgramNames, current));
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load program folders.", error);
        window.alert(`Program folders failed to load.\n\n${formatErrorMessage(error)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (getCurrentWindow().label !== "main") return;
    const unlistenPromise = listen<ProgramSetupCommittedEvent>(
      PROGRAM_SETUP_COMMITTED_EVENT,
      (event) => {
        void (async () => {
          const nextProgramNames = await listProgramFolders();
          const programName = resolveFolderSelection(nextProgramNames, event.payload.programName);
          const nextPanelNames = programName ? await listPanelFolders(programName) : [];
          const panelName = event.payload.panelName
            ? resolveFolderSelection(nextPanelNames, event.payload.panelName)
            : resolveFolderSelection(nextPanelNames, selectedPanelNameRef.current);
          preferredPanelSelectionRef.current = panelName;
          selectedProgramNameRef.current = programName;
          selectedPanelNameRef.current = panelName;
          setProgramNames(nextProgramNames);
          setSelectedProgramName(programName);
          setPanelNames(nextPanelNames);
          setSelectedPanelName(panelName);
        })().catch((error) => {
          console.error("Failed to refresh navigation after managed Program setup.", error);
        });
      }
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!selectedProgramName) {
      panelFolderLoadRequestRef.current += 1;
      setPanelNames([]);
      preferredPanelSelectionRef.current = null;
      setSelectedPanelName(null);
      return;
    }

    let cancelled = false;
    const requestId = panelFolderLoadRequestRef.current + 1;
    panelFolderLoadRequestRef.current = requestId;
    const preferredPanelName = preferredPanelSelectionRef.current;
    setPanelNames([]);
    if (!preferredPanelName) {
      setSelectedPanelName(null);
    }

    void (async () => {
      try {
        const nextPanelNames = await listPanelFolders(selectedProgramName);
        if (cancelled || panelFolderLoadRequestRef.current !== requestId) {
          return;
        }

        // Panel folders are the navigation source of truth. Ordinary program
        // navigation must not wait on or mutate canonical Button-owner state.
        setPanelNames(nextPanelNames);
        setSelectedPanelName((current) => {
          const resolved = resolveFolderSelection(
            nextPanelNames,
            preferredPanelName ?? current
          );
          if (preferredPanelSelectionRef.current === preferredPanelName) {
            preferredPanelSelectionRef.current = null;
          }
          return resolved;
        });
      } catch (error) {
        if (cancelled || panelFolderLoadRequestRef.current !== requestId) {
          return;
        }

        console.error(
          `Failed to load panel folders for ${selectedProgramName}.`,
          error
        );
        window.alert(
          `Panel folders failed to load.\n\n${formatErrorMessage(error)}`
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProgramName]);

  useEffect(() => {
    if (!selectedProgramName || !selectedPanelName) {
      panelScriptLoadRequestRef.current += 1;
      preferredSelectedPanelScriptFileNamesRef.current = null;
      setPanelScripts([]);
      return;
    }

    let cancelled = false;
    const requestId = panelScriptLoadRequestRef.current + 1;
    panelScriptLoadRequestRef.current = requestId;

    void (async () => {
      try {
        const nextPanelScripts = await listPanelButtonRecords(selectedProgramName, selectedPanelName);
        if (cancelled || panelScriptLoadRequestRef.current !== requestId) {
          return;
        }

        applyPanelScriptRecords(selectedProgramName, selectedPanelName, nextPanelScripts);
      } catch (error) {
        if (cancelled || panelScriptLoadRequestRef.current !== requestId) {
          return;
        }

        console.error(
          `Failed to load panel scripts for ${selectedProgramName}/${selectedPanelName}.`,
          error
        );
        window.alert(`Panel scripts failed to load.\n\n${formatErrorMessage(error)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyPanelScriptRecords, selectedPanelName, selectedProgramName]);

  useEffect(() => {
    if (!selectedProgramName || !selectedPanelName) {
      return;
    }

    const unlistenPromise = listen<MacroPanelChangedPayload>(
      MACRO_PANEL_CHANGED_EVENT,
      (event) => {
        if (
          event.payload?.programName !== selectedProgramName ||
          event.payload?.panelName !== selectedPanelName
        ) {
          return;
        }

        const requestId = panelScriptLoadRequestRef.current + 1;
        panelScriptLoadRequestRef.current = requestId;
        void (async () => {
          try {
            const nextPanelScripts = await listPanelButtonRecords(
              selectedProgramName,
              selectedPanelName
            );
            if (
              panelScriptLoadRequestRef.current !== requestId ||
              !areFolderNamesEqual(selectedProgramNameRef.current, selectedProgramName) ||
              !areFolderNamesEqual(selectedPanelNameRef.current, selectedPanelName)
            ) {
              return;
            }
            applyPanelScriptRecords(selectedProgramName, selectedPanelName, nextPanelScripts);
          } catch (error) {
            console.error(
              `Failed to refresh macro panel scripts for ${selectedProgramName}/${selectedPanelName}.`,
              error
            );
          }
        })();
      }
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [applyPanelScriptRecords, selectedPanelName, selectedProgramName]);

  const programRailButtons = useMemo(
    () => buildProgramRailButtons(programNames, selectedProgramName),
    [programNames, selectedProgramName]
  );

  const orderedPanelScripts = useMemo(
    () => {
      if (!buttonDocument || !selectedProgramName || !selectedPanelName) return panelScripts;
      const placementRank = (record: PanelScriptFileRecord) => {
        const button = Object.values(buttonDocument.buttons).find((candidate) => {
          const identity = candidate.sourceIdentity;
          return Boolean(identity && canonicalButtonSourceKey(
            identity.displayProgramName,
            identity.displayPanelName,
            identity.displayFileName
          ) === canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName));
        });
        const placement = button && Object.values(buttonDocument.placements)
          .filter((candidate) => candidate.buttonId === button.id)
          .find((candidate) => {
            const kind = buttonDocument.surfaces[candidate.surfaceId]?.kind;
            return kind === "main" || kind === "panel";
          });
        return placement
          ? [placement.y, placement.x, placement.zIndex]
          : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      };
      return [...panelScripts].sort((left, right) => {
        const leftRank = placementRank(left);
        const rightRank = placementRank(right);
        return leftRank[0] - rightRank[0] || leftRank[1] - rightRank[1] ||
          leftRank[2] - rightRank[2] || left.label.localeCompare(right.label);
      });
    },
    [buttonDocument, panelScripts, selectedPanelName, selectedProgramName]
  );
  const canonicalButtonsBySource = useMemo(() => {
    const entries = new Map<string, CanonicalButtonRecord>();
    if (!buttonDocument) return entries;
    for (const button of Object.values(buttonDocument.buttons)) {
      const identity = button.sourceIdentity;
      if (!identity || button.role === "tool-set-child") continue;
      entries.set(
        canonicalButtonSourceKey(
          identity.displayProgramName,
          identity.displayPanelName,
          identity.displayFileName
        ),
        button
      );
    }
    return entries;
  }, [buttonDocument]);
  const canonicalPresentationsBySource = useMemo(() => {
    const entries = new Map<string, {
      button: CanonicalButtonRecord;
      placement: ButtonStateDocument["placements"][string];
      skin: ButtonStateDocument["skins"][string];
    }>();
    if (!buttonDocument) return entries;
    for (const button of Object.values(buttonDocument.buttons)) {
      const identity = button.sourceIdentity;
      if (!identity || button.role === "tool-set-child") continue;
      const placement = Object.values(buttonDocument.placements)
        .filter((candidate) => candidate.buttonId === button.id)
        .sort((left, right) => {
          const rank = (placementId: string) => {
            const kind = buttonDocument.surfaces[buttonDocument.placements[placementId]?.surfaceId]?.kind;
            return kind === "panel" ? 0 : kind === "main" ? 1 : 2;
          };
          return rank(left.id) - rank(right.id) || left.id.localeCompare(right.id);
        })[0];
      if (!placement) continue;
      const skin = buttonDocument.skins[placement.skinOverrideId ?? button.defaultSkinId];
      if (!skin) continue;
      entries.set(
        canonicalButtonSourceKey(
          identity.displayProgramName,
          identity.displayPanelName,
          identity.displayFileName
        ),
        { button, placement, skin }
      );
    }
    return entries;
  }, [buttonDocument]);
  const canonicalPanelOwnerPresentations = useMemo(() => {
    const byPanel = new Map<string, {
      button: CanonicalButtonRecord;
      placement: ButtonStateDocument["placements"][string];
      skin: ButtonStateDocument["skins"][string];
    }>();
    const byButtonId = new Map<string, {
      button: CanonicalButtonRecord;
      placement: ButtonStateDocument["placements"][string];
      skin: ButtonStateDocument["skins"][string];
    }>();
    if (!buttonDocument) return { byPanel, byButtonId };
    for (const button of Object.values(buttonDocument.buttons)) {
      if (button.role !== "panel-owner") continue;
      const programName = typeof button.metadata.programName === "string"
        ? button.metadata.programName.trim()
        : "";
      const panelName = typeof button.metadata.panelName === "string"
        ? button.metadata.panelName.trim()
        : "";
      if (!programName || !panelName) continue;
      const placement = resolvePanelOwnerMainPlacement(
        buttonDocument,
        programName,
        panelName
      );
      if (!placement || placement.buttonId !== button.id) continue;
      const skin = buttonDocument.skins[placement.skinOverrideId ?? button.defaultSkinId];
      if (!skin) continue;
      const presentation = { button, placement, skin };
      byPanel.set(canonicalProgramPanelKey(programName, panelName), presentation);
      byButtonId.set(button.id, presentation);
    }
    return { byPanel, byButtonId };
  }, [buttonDocument]);
  const resolvedPanelScripts = useMemo(
    () => {
      if (!selectedProgramName || !selectedPanelName) return [];
      return orderedPanelScripts.flatMap((record) => {
        const presentation = canonicalPresentationsBySource.get(
          canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName)
        );
        if (!presentation) return [];
        return [{
          ...record,
          canonicalButtonId: presentation.button.id,
          label: presentation.button.label,
          tooltip: presentation.button.tooltip,
          canonicalPlacement: {
            x: presentation.placement.x,
            y: presentation.placement.y,
            width: presentation.placement.width,
            height: presentation.placement.height
          }
        }];
      });
    },
    [canonicalPresentationsBySource, orderedPanelScripts, selectedPanelName, selectedProgramName]
  );
  const selectablePanelScriptFileNames = useMemo(
    () => resolvedPanelScripts.map((record) => record.fileName),
    [resolvedPanelScripts]
  );
  const resolvedPanelScriptsByFileName = useMemo(
    () => new Map(resolvedPanelScripts.map((record) => [record.fileName, record])),
    [resolvedPanelScripts]
  );
  const selectedPanelScriptFileNameSet = useMemo(
    () => new Set(selectedPanelScriptFileNames),
    [selectedPanelScriptFileNames]
  );
  const allSelectablePanelScriptsSelected = useMemo(
    () =>
      selectablePanelScriptFileNames.length > 0 &&
      selectablePanelScriptFileNames.every((fileName) =>
        selectedPanelScriptFileNameSet.has(fileName)
      ),
    [selectablePanelScriptFileNames, selectedPanelScriptFileNameSet]
  );
  const deleteSelectedPanelScriptsDisabled = selectedPanelScriptFileNames.length === 0;
  const toggleAllPanelScriptsDisabled = selectablePanelScriptFileNames.length === 0;
  const selectedPanelScriptRecords = useMemo(
    () =>
      resolvedPanelScripts.filter((record) => selectedPanelScriptFileNameSet.has(record.fileName)),
    [resolvedPanelScripts, selectedPanelScriptFileNameSet]
  );
  const selectedToolSetRecords = useMemo(
    () => selectedPanelScriptRecords.filter((record) => isToolSetRecord(record)),
    [selectedPanelScriptRecords]
  );
  const selectedRegularPanelScriptRecords = useMemo(
    () => selectedPanelScriptRecords.filter((record) => !isToolSetRecord(record)),
    [selectedPanelScriptRecords]
  );
  const popSelectionDisabled = selectedPanelScriptRecords.length === 0;
  const fanMenuDisabled = !selectedProgramName || !selectedPanelName;
  const fanOptionsDisabled = !selectedProgramName || !selectedPanelName;
  const orderButtonDisabled =
    !selectedProgramName || !selectedPanelName || resolvedPanelScripts.length <= 1;
  const panelFanSetups = useMemo(
    () =>
      Object.values(buttonDocument?.fanSetups ?? {})
        .filter(
          (setup) =>
            areFolderNamesEqual(setup.programName, selectedProgramName) &&
            areFolderNamesEqual(setup.panelName, selectedPanelName)
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [buttonDocument, selectedPanelName, selectedProgramName]
  );

  useEffect(() => {
    setFanSetupMenu(null);
  }, [selectedPanelName, selectedProgramName]);

  useEffect(() => {
    const nextSelectableScriptFileNames = new Set(selectablePanelScriptFileNames);
    setSelectedPanelScriptFileNames((current) => {
      const next = current.filter((fileName) => nextSelectableScriptFileNames.has(fileName));
      return next.length === current.length ? current : next;
    });
  }, [selectablePanelScriptFileNames]);

  const panelRailButtons = useMemo(
    () => buildPanelRailButtons(panelNames, selectedPanelName).map((button) => {
      if (
        button.actionId !== "select-panel-folder" ||
        !button.folderName ||
        !selectedProgramName
      ) {
        return button;
      }
      const presentation = canonicalPanelOwnerPresentations.byPanel.get(
        canonicalProgramPanelKey(selectedProgramName, button.folderName)
      );
      if (!presentation) return button;
      return {
        ...button,
        id: presentation.button.id,
        x: presentation.placement.x,
        y: presentation.placement.y,
        width: presentation.placement.width,
        height: presentation.placement.height,
        label: presentation.button.label,
        tooltip: presentation.button.tooltip
      };
    }),
    [
      canonicalPanelOwnerPresentations,
      panelNames,
      selectedPanelName,
      selectedProgramName
    ]
  );

  const baseButtons = useMemo(
    () => [
      ...staticButtons,
      ...programRailButtons,
      ...panelRailButtons,
      ...buildButtonsSurfaceButtons(
        resolvedPanelScripts,
        {
          selectedScriptFileNames: selectedPanelScriptFileNames,
          fanSelectionCount: selectedPanelScriptRecords.length,
          deleteSelectionDisabled: deleteSelectedPanelScriptsDisabled,
          selectAllDisabled: toggleAllPanelScriptsDisabled,
          allSelectableScriptsSelected: allSelectablePanelScriptsSelected,
          orderDisabled: orderButtonDisabled,
          popDisabled: popSelectionDisabled,
          fanDisabled: fanMenuDisabled,
          fanOptionsDisabled
        }
      )
    ],
    [
      allSelectablePanelScriptsSelected,
      deleteSelectedPanelScriptsDisabled,
      fanOptionsDisabled,
      fanMenuDisabled,
      orderButtonDisabled,
      panelRailButtons,
      popSelectionDisabled,
      programRailButtons,
      selectedPanelName,
      selectedProgramName,
      selectedPanelScriptFileNames,
      selectedPanelScriptRecords.length,
      resolvedPanelScripts,
      toggleAllPanelScriptsDisabled
    ]
  );

  const allButtons = baseButtons;
  const topLeftActionButtons = useMemo(
    () => allButtons.filter((button) => button.groupId === "top-left-actions"),
    [allButtons]
  );
  const topRightActionButtons = useMemo(
    () => allButtons.filter((button) => button.groupId === "top-right-actions"),
    [allButtons]
  );
  const independentlyPositionedButtons = useMemo(
    () =>
      allButtons.filter(
        (button) =>
          button.groupId !== "top-left-actions" && button.groupId !== "top-right-actions"
      ),
    [allButtons]
  );
  const topLeftActionGap = useMemo(() => {
    if (topLeftActionButtons.length < 2) {
      return 16;
    }
    return Math.max(
      0,
      topLeftActionButtons[1].x -
        topLeftActionButtons[0].x -
        topLeftActionButtons[0].width
    );
  }, [topLeftActionButtons]);
  const topLeftActionAnchor = useMemo(() => {
    if (topLeftActionButtons.length === 0) {
      return null;
    }
    return {
      x: topLeftActionButtons[0].x,
      y: topLeftActionButtons[0].y
    };
  }, [topLeftActionButtons]);
  const topLeftBaselineHeight = useMemo(
    () => topLeftActionButtons[0]?.height ?? 0,
    [topLeftActionButtons]
  );
  const [topLeftActionHeight, setTopLeftActionHeight] = useState(topLeftBaselineHeight);
  useEffect(() => {
    setTopLeftActionHeight(topLeftBaselineHeight);
  }, [topLeftBaselineHeight, topLeftActionButtons.length]);
  const topLeftActionMaxRight = useMemo(() => {
    const buttonWidth = topLeftActionButtons[topLeftActionButtons.length - 1]?.width ?? 0;
    return page.width / 2 + buttonWidth;
  }, [topLeftActionButtons]);
  const topRightActionGap = useMemo(() => {
    if (topRightActionButtons.length < 2) {
      return 16;
    }
    return Math.max(
      0,
      topRightActionButtons[1].x -
        topRightActionButtons[0].x -
        topRightActionButtons[0].width
    );
  }, [topRightActionButtons]);
  const topRightActionAnchor = useMemo(() => {
    if (topRightActionButtons.length === 0) {
      return null;
    }
    const lastButton = topRightActionButtons[topRightActionButtons.length - 1];
    return {
      right: page.width - (lastButton.x + lastButton.width),
      y: topRightActionButtons[0].y
    };
  }, [topRightActionButtons]);

  useLayoutEffect(() => {
    const groupNode = topLeftActionGroupRef.current;
    if (
      !groupNode ||
      !topLeftActionAnchor ||
      topLeftBaselineHeight <= 0 ||
      topLeftActionButtons.length === 0
    ) {
      return;
    }

    const gapTotal = topLeftActionGap * Math.max(topLeftActionButtons.length - 1, 0);
    const availableContentWidth = Math.max(
      1,
      topLeftActionMaxRight - topLeftActionAnchor.x - gapTotal
    );
    const minHeight = Math.max(18, topLeftBaselineHeight * 0.72);

    const updateHeight = () => {
      const childButtons = Array.from(groupNode.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      const totalChildWidth = childButtons.reduce(
        (sum, child) => sum + child.offsetWidth,
        0
      );
      if (totalChildWidth <= 0) {
        return;
      }

      const currentHeight = topLeftActionHeight > 0 ? topLeftActionHeight : topLeftBaselineHeight;
      const baselineEstimatedWidth =
        totalChildWidth * (topLeftBaselineHeight / currentHeight);
      const nextHeight =
        baselineEstimatedWidth <= availableContentWidth
          ? topLeftBaselineHeight
          : Math.max(
              minHeight,
              topLeftBaselineHeight * (availableContentWidth / baselineEstimatedWidth)
            );
      const roundedHeight = Number(nextHeight.toFixed(3));
      if (Math.abs(roundedHeight - currentHeight) > 0.25) {
        setTopLeftActionHeight(roundedHeight);
      }
    };

    const animationFrameId = window.requestAnimationFrame(updateHeight);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(animationFrameId);
      };
    }

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(groupNode);
    Array.from(groupNode.children).forEach((child) => {
      if (child instanceof HTMLElement) {
        observer.observe(child);
      }
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      observer.disconnect();
    };
  }, [
    topLeftActionAnchor,
    topLeftActionButtons,
    topLeftActionGap,
    topLeftActionHeight,
    topLeftActionMaxRight,
    topLeftBaselineHeight
  ]);

  const resolvedButtonsById = useMemo(
    () => new Map(allButtons.map((button) => [button.id, button])),
    [allButtons]
  );
  const contextMenuButton = contextMenu ? (resolvedButtonsById.get(contextMenu.buttonId) ?? null) : null;
  const isScriptContextMenu =
    contextMenuButton &&
    isPanelScriptButtonAction(contextMenuButton.actionId) &&
    Boolean(contextMenuButton.scriptFileName);
  const isProgramFolderContextMenu =
    contextMenuButton?.actionId === "select-program-folder" && Boolean(contextMenuButton.folderName);
  const isPanelFolderContextMenu =
    contextMenuButton?.actionId === "select-panel-folder" && Boolean(contextMenuButton.folderName);

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleButtonContextMenu = (
    button: ButtonRecord,
    event: MouseEvent
  ) => {
    const isPanelScriptButton =
      isPanelScriptButtonAction(button.actionId) && Boolean(button.scriptFileName);
    const isFolderRailButton =
      (button.actionId === "select-program-folder" ||
        button.actionId === "select-panel-folder") &&
      button.folderName;

    if (!isPanelScriptButton && !isFolderRailButton) {
      return;
    }

    const nextPosition = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      buttonId: button.id,
      x: nextPosition.x,
      y: nextPosition.y
    });
  };

  const togglePanelScriptSelection = (fileName: string) => {
    setSelectedPanelScriptFileNames((current) =>
      current.includes(fileName)
        ? current.filter((candidate) => candidate !== fileName)
        : [...current, fileName]
    );
  };

  const handleRunPanelMacro = async (macroId: string) => {
    if (!macroId.trim()) {
      window.alert("This macro button is missing its macro id.");
      return;
    }

    try {
      await runFrontendMacro(macroId);
    } catch (error) {
      console.error(`Failed to run macro ${macroId}.`, error);
      window.alert(`Macro could not be run.\n\n${formatErrorMessage(error)}`);
    }
  };

  const closeManagedLayoutWindows = async () => {
    const currentWindow = getCurrentWindow();
    const openWindows = await WebviewWindow.getAll();
    await Promise.all(
      openWindows
        .filter((windowHandle) => windowHandle.label !== currentWindow.label)
        .filter((windowHandle) => readRegisteredLayoutWindow(windowHandle.label))
        .map((windowHandle) => windowHandle.close().catch(() => {}))
    );
  };

  const captureLayoutSnapshotState = async (): Promise<LayoutSnapshot> => {
    const currentWindow = getCurrentWindow();
    const mainWindowBounds = await captureWindowBounds(currentWindow);
    const managedWindows: LayoutSnapshotWindow[] = [];

    for (const windowHandle of (await WebviewWindow.getAll()).sort((left, right) =>
      left.label.localeCompare(right.label)
    )) {
      if (windowHandle.label === currentWindow.label) {
        continue;
      }

      const registeredWindow = readRegisteredLayoutWindow(windowHandle.label);
      if (!registeredWindow) {
        continue;
      }

      const isFixedButtonCanvas =
        registeredWindow.kind === "button-popout" ||
        registeredWindow.kind === "button-fan";
      const bounds = isFixedButtonCanvas
        ? isValidFlowCellBounds(registeredWindow.snapshotBounds)
          ? registeredWindow.snapshotBounds
          : null
        : await captureWindowBounds(windowHandle);
      if (!isValidFlowCellBounds(bounds)) {
        continue;
      }
      managedWindows.push({
        Kind: registeredWindow.kind,
        ProgramName: registeredWindow.programName,
        PanelName: registeredWindow.panelName,
        ButtonPopoutUnitId: registeredWindow.buttonPopoutUnitId,
        ButtonFanSetupId: registeredWindow.buttonFanSetupId,
        ButtonOwnerId: registeredWindow.buttonOwnerId,
        ButtonDisplayMode: registeredWindow.buttonDisplayMode,
        Bounds: bounds
      });
    }

    return {
      SavedAt: new Date().toISOString(),
      Version: LAYOUT_SNAPSHOT_VERSION,
      LayoutKind: "FlowCellWindowLayout",
      SelectedProgramName: selectedProgramName ?? undefined,
      SelectedPanelName: selectedPanelName ?? undefined,
      SelectedFileNames:
        selectedPanelScriptFileNames.length > 0 ? [...selectedPanelScriptFileNames] : undefined,
      MainWindowBounds: mainWindowBounds,
      Windows: managedWindows
    };
  };

  const restoreLayoutSnapshotState = async (snapshot: LayoutSnapshot) => {
    preferredPanelSelectionRef.current = null;
    preferredSelectedPanelScriptFileNamesRef.current = null;
    await closeManagedLayoutWindows();

    if (isValidFlowCellBounds(snapshot.MainWindowBounds)) {
      await applyWindowBounds(getCurrentWindow(), snapshot.MainWindowBounds);
    }

    const nextProgramNames = await listProgramFolders();
    const previousProgramName = selectedProgramNameRef.current;
    const nextProgramName = resolveFolderSelection(
      nextProgramNames,
      snapshot.SelectedProgramName
    );
    const nextPanelNames = nextProgramName
      ? await listPanelFolders(nextProgramName)
      : [];
    const nextPanelName = nextProgramName
      ? resolveFolderSelection(nextPanelNames, snapshot.SelectedPanelName)
      : null;

    preferredPanelSelectionRef.current =
      nextProgramName && !areFolderNamesEqual(previousProgramName, nextProgramName)
        ? nextPanelName
        : null;
    preferredSelectedPanelScriptFileNamesRef.current =
      nextProgramName && nextPanelName
        ? {
            programName: nextProgramName,
            panelName: nextPanelName,
            fileNames: [...(snapshot.SelectedFileNames ?? [])]
          }
        : null;

    selectedProgramNameRef.current = nextProgramName;
    selectedPanelNameRef.current = nextPanelName;
    setProgramNames(nextProgramNames);
    setSelectedProgramName(nextProgramName);
    setPanelNames(nextPanelNames);
    setSelectedPanelName(nextPanelName);

    if (!nextProgramName || !nextPanelName) {
      setPanelScripts([]);
      setSelectedPanelScriptFileNames([]);
    } else {
      setPanelScripts([]);
      const requestId = panelScriptLoadRequestRef.current + 1;
      panelScriptLoadRequestRef.current = requestId;
      const nextPanelScripts = await listPanelButtonRecords(nextProgramName, nextPanelName);
      if (
        panelScriptLoadRequestRef.current === requestId &&
        areFolderNamesEqual(selectedProgramNameRef.current, nextProgramName) &&
        areFolderNamesEqual(selectedPanelNameRef.current, nextPanelName)
      ) {
        applyPanelScriptRecords(nextProgramName, nextPanelName, nextPanelScripts);
      }
    }

    for (const windowEntry of snapshot.Windows ?? []) {
      if (!isValidFlowCellBounds(windowEntry.Bounds)) {
        continue;
      }

      switch (windowEntry.Kind) {
        case "button-editor":
          await openButtonEditorWindow({
            programName: windowEntry.ProgramName,
            panelName: windowEntry.PanelName,
            bounds: windowEntry.Bounds
          });
          break;
        case "button-popout":
          if (windowEntry.ProgramName && windowEntry.ButtonPopoutUnitId) {
            await openButtonPopoutWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              popoutUnitId: windowEntry.ButtonPopoutUnitId,
              ownerButtonId: windowEntry.ButtonOwnerId,
              displayMode: windowEntry.ButtonDisplayMode,
              bounds: windowEntry.Bounds,
              reveal: false
            });
          }
          break;
        case "button-fan":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.ButtonFanSetupId &&
            windowEntry.ButtonOwnerId
          ) {
            await openButtonFanWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fanSetupId: windowEntry.ButtonFanSetupId,
              panelOwnerButtonId: windowEntry.ButtonOwnerId,
              collapsedBounds: windowEntry.Bounds,
              reveal: false
            });
          }
          break;
      }
    }
  };

  const handleSaveLayout = async () => {
    if (layoutActionPendingRef.current) {
      return;
    }

    layoutActionPendingRef.current = true;
    try {
      const snapshot = await captureLayoutSnapshotState();
      const targetPath = await showSaveLayoutDialog(
        buildSuggestedLayoutName(),
        readLastLayoutDirectory() ?? undefined
      );
      if (!targetPath) {
        return;
      }

      const savedPath = await saveLayoutSnapshot(targetPath, snapshot);
      writeLastLayoutDirectory(getParentDirectory(savedPath));
      writeLastLayoutPath(savedPath);
    } finally {
      layoutActionPendingRef.current = false;
    }
  };

  const handleLoadLayout = async () => {
    if (layoutActionPendingRef.current) {
      return;
    }

    layoutActionPendingRef.current = true;
    try {
      const selectedPath = await showOpenLayoutDialog(readLastLayoutDirectory() ?? undefined);
      if (!selectedPath) {
        return;
      }

      const snapshot = await loadLayoutSnapshot(selectedPath);
      writeLastLayoutDirectory(getParentDirectory(selectedPath));
      await restoreLayoutSnapshotState(snapshot);
      writeLastLayoutPath(selectedPath);
    } finally {
      layoutActionPendingRef.current = false;
    }
  };

  const handleStartupSettingChange = (changes: Partial<StartupSettings>) => {
    setStartupSettings((current) => {
      const next = { ...current, ...changes };
      writeStartupSettings(next);
      return next;
    });
  };

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    if (currentWindow.label !== "main") {
      return;
    }

    let cancelled = false;

    void (async () => {
      const settings = readStartupSettings();

      if (settings.loadLastLayoutOnStartup) {
        const lastLayoutPath = readLastLayoutPath();
        if (lastLayoutPath) {
          try {
            const snapshot = await loadLayoutSnapshot(lastLayoutPath);
            if (!cancelled) {
              await restoreLayoutSnapshotState(snapshot);
              writeLastLayoutPath(lastLayoutPath);
            }
          } catch (error) {
            writeLastLayoutPath(null);
            console.error("Failed to load last layout on startup.", error);
          }
        }
      }

      if (!cancelled && settings.minimizeMainOnStartup) {
        try {
          await currentWindow.minimize();
        } catch (error) {
          console.error("Failed to minimize main window on startup.", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateToolSetOwner = useCallback(async (
    ownerButtonId: string,
    sourceDocument?: ButtonStateDocument,
    behavior: "toggle" | "open" = "toggle"
  ) => {
    const document = sourceDocument ?? buttonDocumentRef.current ?? await loadButtonStateDocument();
    if (!buttonDocumentRef.current) acceptButtonDocument(document);
    const target = resolveToolSetOwnerActivationTarget(document, ownerButtonId);
    const windowArgs = {
      programName: target.programName,
      panelName: target.panelName,
      popoutUnitId: target.popoutUnitId,
      ownerButtonId: target.ownerButtonId,
      bounds: target.bounds
    };
    if (behavior === "open") {
      await openButtonPopoutWindow(windowArgs);
    } else {
      await toggleButtonPopoutWindow(windowArgs);
    }
  }, [acceptButtonDocument]);

  useEffect(() => {
    if (getCurrentWindow().label !== "main") return;
    const unlistenPromise = listen<ToolSetOwnerHotkeyPayload>(
      TOOL_SET_OWNER_HOTKEY_EVENT,
      (event) => {
        try {
          const ownerButtonId = ownerButtonIdFromHotkeyPayload(event.payload);
          void activateToolSetOwner(ownerButtonId).catch((error) => {
            console.error("Tool-set owner hotkey activation failed.", error);
          });
        } catch (error) {
          console.error("Tool-set owner hotkey activation failed.", error);
        }
      }
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [activateToolSetOwner]);

  const handleOpenToolSet = async (
    record: PanelScriptFileRecord,
    behavior: "toggle" | "open" = "toggle"
  ) => {
    if (!selectedProgramName || !selectedPanelName) {
      throw new Error("Select a program and panel before opening a tool set.");
    }
    const document = buttonDocument ?? await loadButtonStateDocument();
    if (!buttonDocument) acceptButtonDocument(document);
    const owner = canonicalButtonsBySource.get(
      canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName)
    ) ?? Object.values(document.buttons).find((button) => {
      const identity = button.sourceIdentity;
      return Boolean(
        identity &&
        canonicalButtonSourceKey(
          identity.displayProgramName,
          identity.displayPanelName,
          identity.displayFileName
        ) === canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName)
      );
    });
    if (!owner || owner.role !== "tool-set-owner") {
      throw new Error(`Canonical tool-set owner was not found for '${record.label}'.`);
    }
    await activateToolSetOwner(owner.id, document, behavior);
  };

  const handlePerformPanelScriptPrimaryAction = async (
    fileName: string,
    record: PanelScriptFileRecord | null = null
  ) => {
    const matchedRecord =
      record ?? resolvedPanelScriptsByFileName.get(fileName) ?? null;
    if (matchedRecord?.kind?.trim().toLowerCase() === "macro") {
      await handleRunPanelMacro(matchedRecord.macroId ?? "");
      return;
    }

    if (matchedRecord && isToolSetRecord(matchedRecord)) {
      await handleOpenToolSet(matchedRecord);
      return;
    }

    if (!selectedProgramName || !selectedPanelName) {
      throw new Error("Select a program and panel before running a Button.");
    }
    let canonical = canonicalButtonsBySource.get(
      canonicalButtonSourceKey(selectedProgramName, selectedPanelName, fileName)
    );
    if (!canonical) {
      const document = buttonDocument ?? await loadButtonStateDocument();
      if (!buttonDocument) acceptButtonDocument(document);
      canonical = Object.values(document.buttons).find((button) => {
        const identity = button.sourceIdentity;
        return Boolean(
          identity &&
          canonicalButtonSourceKey(
            identity.displayProgramName,
            identity.displayPanelName,
            identity.displayFileName
          ) === canonicalButtonSourceKey(selectedProgramName, selectedPanelName, fileName)
        );
      });
    }
    if (!canonical) {
      throw new Error(`Installed source '${fileName}' has no canonical Button record.`);
    }
    const pressPlan = resolveButtonPressEventPlan(canonical);
    let firstExecutionError: unknown;
    const executeLifecycleEvent = async (eventName: string) => {
      try {
        await executeButtonRecord(canonical, eventName);
      } catch (error) {
        firstExecutionError ??= error;
      }
    };
    if (pressPlan.synthesizeHoverSessionForKeyboard) {
      await executeLifecycleEvent("hoverEnter");
    }
    if (pressPlan.dispatchPressDown) {
      await executeLifecycleEvent("pressDown");
    }
    if (pressPlan.runClickOnRelease) {
      await executeLifecycleEvent("click");
    }
    if (pressPlan.dispatchPressUp) {
      await executeLifecycleEvent("pressUp");
    }
    if (pressPlan.synthesizeHoverSessionForKeyboard) {
      await executeLifecycleEvent("hoverLeave");
    }
    if (firstExecutionError !== undefined) {
      throw firstExecutionError;
    }
  };

  const deletePanelScriptFileNames = async (fileNames: string[]) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before deleting buttons.");
      return false;
    }

    const normalizedFileNames = Array.from(
      new Set(
        fileNames
          .map((fileName) => fileName.trim())
          .filter((fileName) => fileName.length > 0)
      )
    );
    if (normalizedFileNames.length === 0) {
      return false;
    }

    const confirmMessage =
      normalizedFileNames.length === 1
        ? "Delete the selected Button and its owned Local Scripts package?"
        : `Delete ${normalizedFileNames.length} selected Buttons and their owned Local Scripts packages?`;
    if (!window.confirm(confirmMessage)) {
      return false;
    }

    try {
      const currentDocument = buttonDocument ?? await loadButtonStateDocument();
      const nextDocument = cloneButtonDocument(currentDocument);
      const uninstallOwnerIds = new Set<string>();
      for (const fileName of normalizedFileNames) {
        const key = canonicalButtonSourceKey(selectedProgramName, selectedPanelName, fileName);
        const root = Object.values(nextDocument.buttons).find((button) => {
          const identity = button.sourceIdentity;
          return Boolean(
            identity &&
            button.role !== "tool-set-child" &&
            canonicalButtonSourceKey(
              identity.displayProgramName,
              identity.displayPanelName,
              identity.displayFileName
            ) === key
          );
        });
        if (!root) throw new Error(`Canonical Button owner was not found for '${fileName}'.`);
        const removed = removeOwnedButtonGraph(nextDocument, root.id);
        removed.uninstallOwnerButtonIds.forEach((ownerId) => uninstallOwnerIds.add(ownerId));
      }
      const saved = await saveButtonStateDocument(
        nextDocument,
        currentDocument.revision,
        [...uninstallOwnerIds]
      );
      acceptButtonDocument(saved);
      await publishButtonCommit(saved);
      const requestId = panelScriptLoadRequestRef.current + 1;
      panelScriptLoadRequestRef.current = requestId;
      const nextPanelScripts = await listPanelButtonRecords(selectedProgramName, selectedPanelName);
      if (
        panelScriptLoadRequestRef.current !== requestId ||
        !areFolderNamesEqual(selectedProgramNameRef.current, selectedProgramName) ||
        !areFolderNamesEqual(selectedPanelNameRef.current, selectedPanelName)
      ) {
        return true;
      }
      const deletedFileNameSet = new Set(normalizedFileNames);
      setPanelScripts(nextPanelScripts);
      setSelectedPanelScriptFileNames((current) =>
        current.filter((fileName) => !deletedFileNameSet.has(fileName))
      );
      return true;
    } catch (error) {
      console.error(`Failed to delete panel scripts for ${selectedProgramName}.`, error);
      window.alert(`Selected buttons could not be deleted.\n\n${formatErrorMessage(error)}`);
      return false;
    }
  };

  const handleBindsContextMenuButton = () => {
    if (!contextMenuButton || !isPanelScriptButtonAction(contextMenuButton.actionId)) {
      closeContextMenu();
      return;
    }

    const { scriptFileName } = contextMenuButton;
    if (!selectedProgramName || !selectedPanelName || !scriptFileName) {
      closeContextMenu();
      window.alert("Select a program and panel before assigning a bind.");
      return;
    }

    // Matches the binds workspace button id built by the backend.
    const buttonId = `${selectedProgramName}::${selectedPanelName}::${scriptFileName}`;
    closeContextMenu();
    void openBindsWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      buttonId
    }).catch((error) => {
      console.error("Failed to open Binds.", error);
      window.alert(`Binds could not be opened.\n\n${formatErrorMessage(error)}`);
    });
  };

  const handleDeleteContextMenuButton = async () => {
    if (!contextMenuButton || !isPanelScriptButtonAction(contextMenuButton.actionId)) {
      closeContextMenu();
      return;
    }

    const { scriptFileName } = contextMenuButton;
    closeContextMenu();
    if (!scriptFileName) {
      return;
    }

    await deletePanelScriptFileNames([scriptFileName]);
  };

  const handleUpdateDescriptionContextMenuButton = async () => {
    if (!contextMenuButton || !isPanelScriptButtonAction(contextMenuButton.actionId)) {
      closeContextMenu();
      return;
    }

    if (!selectedProgramName || !selectedPanelName) {
      closeContextMenu();
      window.alert("Select a program and panel before updating a button description.");
      return;
    }

    const { scriptFileName } = contextMenuButton;
    if (!scriptFileName) {
      closeContextMenu();
      return;
    }

    closeContextMenu();
    const owner = canonicalButtonsBySource.get(
      canonicalButtonSourceKey(selectedProgramName, selectedPanelName, scriptFileName)
    );
    await openButtonEditorWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      buttonId: owner?.id
    });
  };

  const handleRenameContextMenuButton = async () => {
    if (!contextMenuButton || !isPanelScriptButtonAction(contextMenuButton.actionId)) {
      closeContextMenu();
      return;
    }

    const scriptFileName = contextMenuButton.scriptFileName;
    closeContextMenu();
    if (!selectedProgramName || !selectedPanelName || !scriptFileName) return;
    const owner = canonicalButtonsBySource.get(
      canonicalButtonSourceKey(selectedProgramName, selectedPanelName, scriptFileName)
    );
    await openButtonEditorWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      buttonId: owner?.id
    });
  };

  const handleRenameProgramContextMenuButton = async () => {
    if (
      !contextMenuButton ||
      contextMenuButton.actionId !== "select-program-folder" ||
      !contextMenuButton.folderName
    ) {
      closeContextMenu();
      return;
    }

    const currentName = contextMenuButton.folderName;
    closeContextMenu();

    const requestedName = window.prompt("Enter the new program folder name.", currentName);
    if (requestedName === null) {
      return;
    }

    const trimmedName = requestedName.trim();
    if (!trimmedName) {
      window.alert("Program name cannot be empty.");
      return;
    }

    if (currentName === trimmedName) {
      return;
    }

    try {
      const currentDocument = await loadButtonStateDocument();
      const affectedButtonIds = collectCanonicalRenameButtonIds(currentDocument, {
        programName: currentName
      });
      const rename = await renameProgramFolder(currentName, trimmedName);
      const renamedProgramName = rename.programName;
      try {
        await commitButtonDocumentMutation((document) =>
          renameProgramButtonDocumentScope(document, {
            currentProgramName: currentName,
            nextProgramName: renamedProgramName
          }).changed,
          rename.renameToken
        );
      } catch (error) {
        const recoveredDocument = await recoverCanonicalRenameOrRollback(error, {
          affectedButtonIds,
          previousScope: { programName: currentName },
          nextScope: { programName: renamedProgramName },
          rollback: () => rollbackProgramRename(rename.renameToken),
          recoverCommitted: () => recoverProgramRename(rename.renameToken),
          label: "program folder"
        });
        acceptButtonDocument(recoveredDocument);
      }
      await closeRenamedButtonWindows(currentDocument, currentName);
      const nextProgramNames = await listProgramFolders();
      const selectedProgramWasRenamed = areFolderNamesEqual(selectedProgramName, currentName);
      setProgramNames(nextProgramNames);
      setSelectedProgramName(
        resolveFolderSelection(
          nextProgramNames,
          selectedProgramWasRenamed ? renamedProgramName : selectedProgramName
        )
      );
    } catch (error) {
      console.error(`Failed to rename program folder or its canonical Buttons for ${currentName}.`, error);
      window.alert(`Program rename or canonical Button update failed.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleDeleteProgramContextMenuButton = async () => {
    if (
      !contextMenuButton ||
      contextMenuButton.actionId !== "select-program-folder" ||
      !contextMenuButton.folderName
    ) {
      closeContextMenu();
      return;
    }

    const currentName = contextMenuButton.folderName;
    closeContextMenu();

    if (
      !window.confirm(
        `Remove ${currentName} from FlowCell? Its installed Buttons and bindings will be removed, but the available program package will be kept so it can be added again.`
      )
    ) {
      return;
    }

    try {
      const currentDocument = await loadButtonStateDocument();
      const expectedOwnerButtonIds = collectCanonicalRenameButtonIds(currentDocument, {
        programName: currentName
      });
      const rollbackToken = await beginProgramUnregistration(currentName, expectedOwnerButtonIds);
      let savedDocument: ButtonStateDocument;
      try {
        savedDocument = await commitButtonDocumentMutation((document) =>
          removeProgramButtonDocumentScope(document, { programName: currentName })
        );
      } catch (canonicalError) {
        try {
          await rollbackProgramUnregistration(rollbackToken);
        } catch (rollbackError) {
          console.error(
            `Program registration rollback failed for ${currentName}; token ${rollbackToken} remains pending.`,
            rollbackError
          );
          throw new Error(
            `Canonical Button cleanup failed, and FlowCell could not restore the program registration. ` +
            `The rollback remains pending under token '${rollbackToken}'. ` +
            `Original error: ${formatErrorMessage(canonicalError)} ` +
            `Rollback error: ${formatErrorMessage(rollbackError)}`
          );
        }
        throw canonicalError;
      }
      await finalizeProgramUnregistration(rollbackToken);
      try {
        await closeRemovedButtonWindows(currentDocument, savedDocument);
      } catch (windowError) {
        console.error(
          `Program ${currentName} was removed, but one or more obsolete Button windows could not be closed.`,
          windowError
        );
      }
      const nextProgramNames = await listProgramFolders();
      const selectedProgramWasDeleted = areFolderNamesEqual(selectedProgramName, currentName);
      const nextSelectedProgramName = resolveFolderSelection(
        nextProgramNames,
        selectedProgramWasDeleted ? null : selectedProgramName
      );
      setProgramNames(nextProgramNames);
      setSelectedProgramName(nextSelectedProgramName);
      if (selectedProgramWasDeleted) {
        preferredPanelSelectionRef.current = null;
        setPanelNames([]);
        setSelectedPanelName(null);
        setPanelScripts([]);
        setSelectedPanelScriptFileNames([]);
      }
    } catch (error) {
      console.error(`Failed to delete program folder or clean up its canonical Buttons for ${currentName}.`, error);
      window.alert(`Program deletion or canonical Button cleanup failed.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleRenamePanelContextMenuButton = async () => {
    if (
      !contextMenuButton ||
      contextMenuButton.actionId !== "select-panel-folder" ||
      !contextMenuButton.folderName
    ) {
      closeContextMenu();
      return;
    }

    if (!selectedProgramName) {
      closeContextMenu();
      window.alert("Select a program before renaming a panel.");
      return;
    }

    const currentName = contextMenuButton.folderName;
    closeContextMenu();

    const requestedName = window.prompt("Enter the new panel folder name.", currentName);
    if (requestedName === null) {
      return;
    }

    const trimmedName = requestedName.trim();
    if (!trimmedName) {
      window.alert("Panel name cannot be empty.");
      return;
    }

    if (areFolderNamesEqual(currentName, trimmedName)) {
      return;
    }

    try {
      const currentDocument = await loadButtonStateDocument();
      const affectedButtonIds = collectCanonicalRenameButtonIds(currentDocument, {
        programName: selectedProgramName,
        panelName: currentName
      });
      const renamedPanelName = await renamePanelFolder(
        selectedProgramName,
        currentName,
        trimmedName
      );
      try {
        await commitButtonDocumentMutation((document) =>
          renamePanelButtonDocumentScope(document, {
            programName: selectedProgramName,
            currentPanelName: currentName,
            nextPanelName: renamedPanelName
          }).changed
        );
      } catch (error) {
        const recoveredDocument = await recoverCanonicalRenameOrRollback(error, {
          affectedButtonIds,
          previousScope: {
            programName: selectedProgramName,
            panelName: currentName
          },
          nextScope: {
            programName: selectedProgramName,
            panelName: renamedPanelName
          },
          rollback: () => renamePanelFolder(
            selectedProgramName,
            renamedPanelName,
            currentName
          ),
          label: "panel folder"
        });
        acceptButtonDocument(recoveredDocument);
      }
      await closeRenamedButtonWindows(
        currentDocument,
        selectedProgramName,
        currentName
      );
      const nextPanelNames = await listPanelFolders(selectedProgramName);
      const selectedPanelWasRenamed = areFolderNamesEqual(selectedPanelName, currentName);
      setPanelNames(nextPanelNames);
      setSelectedPanelName(
        resolveFolderSelection(
          nextPanelNames,
          selectedPanelWasRenamed ? renamedPanelName : selectedPanelName
        )
      );
    } catch (error) {
      console.error(
        `Failed to rename panel folder or its canonical Buttons ${selectedProgramName}/${currentName}.`,
        error
      );
      window.alert(`Panel rename or canonical Button updates failed.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleDeletePanelContextMenuButton = async () => {
    if (
      !contextMenuButton ||
      contextMenuButton.actionId !== "select-panel-folder" ||
      !contextMenuButton.folderName
    ) {
      closeContextMenu();
      return;
    }

    if (!selectedProgramName) {
      closeContextMenu();
      window.alert("Select a program before deleting a panel.");
      return;
    }

    const currentName = contextMenuButton.folderName;
    closeContextMenu();

    if (
      !window.confirm(
        `Delete panel ${currentName}? Its folder and buttons will be moved to the Recycle Bin.`
      )
    ) {
      return;
    }

    try {
      const currentDocument = await loadButtonStateDocument();
      const expectedOwnerButtonIds = collectCanonicalRenameButtonIds(currentDocument, {
        programName: selectedProgramName,
        panelName: currentName
      });
      const transactionToken = await preparePanelDeletion(
        selectedProgramName,
        currentName,
        expectedOwnerButtonIds
      );
      let savedDocument: ButtonStateDocument;
      try {
        savedDocument = await commitButtonDocumentMutation((document) =>
          removePanelButtonDocumentScope(document, {
            programName: selectedProgramName,
            panelName: currentName
          })
        );
      } catch (canonicalError) {
        try {
          await rollbackPanelDeletion(transactionToken);
        } catch (rollbackError) {
          console.error(
            `Panel deletion rollback failed for ${selectedProgramName}/${currentName}; ` +
              `transaction ${transactionToken} remains pending.`,
            rollbackError
          );
          throw new Error(
            `Canonical Button cleanup failed, and FlowCell could not cancel the panel deletion. ` +
              `The transaction remains pending under token '${transactionToken}'. ` +
              `Original error: ${formatErrorMessage(canonicalError)} ` +
              `Rollback error: ${formatErrorMessage(rollbackError)}`
          );
        }
        throw canonicalError;
      }
      await finalizePanelDeletion(transactionToken);
      await closeRemovedButtonWindows(currentDocument, savedDocument);
      const nextPanelNames = await listPanelFolders(selectedProgramName);
      const selectedPanelWasDeleted = areFolderNamesEqual(selectedPanelName, currentName);
      const nextSelectedPanelName = resolveFolderSelection(
        nextPanelNames,
        selectedPanelWasDeleted ? null : selectedPanelName
      );
      setPanelNames(nextPanelNames);
      setSelectedPanelName(nextSelectedPanelName);
      if (selectedPanelWasDeleted) {
        preferredSelectedPanelScriptFileNamesRef.current = null;
        setSelectedPanelScriptFileNames([]);
        setPanelScripts([]);
      }
    } catch (error) {
      console.error(
        `Failed to delete panel folder or clean up its canonical Buttons ${selectedProgramName}/${currentName}.`,
        error
      );
      window.alert(`Panel deletion or canonical Button cleanup failed.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenSavedFanSetup = async (
    fanSetupId: string,
    sourceDocument?: ButtonStateDocument
  ) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening a fan setup.");
      return;
    }

    try {
      const document = sourceDocument ?? buttonDocument ?? await loadButtonStateDocument();
      const setup = document.fanSetups[fanSetupId];
      if (
        !setup ||
        !areFolderNamesEqual(setup.programName, selectedProgramName) ||
        !areFolderNamesEqual(setup.panelName, selectedPanelName)
      ) {
        throw new Error("That saved fan setup no longer belongs to the selected panel.");
      }

      const selectedToolSetOwnerIds = new Set(setup.selectedToolSetOwnerButtonIds);
      const panelToolSetUnits = Object.values(document.popoutUnits).filter(
        (unit): unit is ToolSetButtonPopoutUnit => {
        if (unit.kind !== "tool-set") return false;
        const owner = document.buttons[unit.ownerButtonId];
        const identity = owner?.sourceIdentity;
        return Boolean(
          identity &&
            areFolderNamesEqual(identity.displayProgramName, selectedProgramName) &&
            areFolderNamesEqual(identity.displayPanelName, selectedPanelName)
        );
      });

      await Promise.all(
        panelToolSetUnits
          .filter((unit) => !selectedToolSetOwnerIds.has(unit.ownerButtonId))
          .map((unit) =>
            closeButtonPopoutWindow({
              popoutUnitId: unit.id,
              ownerButtonId: unit.ownerButtonId
            })
          )
      );

      const fanWindowPromise = setup.fanMemberButtonIds.length > 0
        ? openButtonFanWindow({
            programName: setup.programName,
            panelName: setup.panelName,
            fanSetupId: setup.id,
            panelOwnerButtonId: setup.panelOwnerButtonId,
            collapsedBounds: setup.collapsedPanelOwnerBounds
              ? {
                  Left: setup.collapsedPanelOwnerBounds.left,
                  Top: setup.collapsedPanelOwnerBounds.top,
                  Width: setup.collapsedPanelOwnerBounds.width,
                  Height: setup.collapsedPanelOwnerBounds.height
                }
              : null
          })
        : closeButtonFanWindow(setup.panelOwnerButtonId);

      const toolSetWindowPromises = setup.selectedToolSetOwnerButtonIds.map((ownerButtonId) => {
        const unit = panelToolSetUnits.find(
          (candidate) => candidate.ownerButtonId === ownerButtonId
        );
        const anchor = setup.toolSetOwnerAnchors[ownerButtonId];
        if (!unit) {
          throw new Error(`Tool-set owner '${ownerButtonId}' has no canonical popout unit.`);
        }
        if (!anchor) {
          throw new Error(`Fan setup '${setup.name}' is missing the saved anchor for '${ownerButtonId}'.`);
        }
        return openButtonPopoutWindow({
          programName: setup.programName,
          panelName: setup.panelName,
          popoutUnitId: unit.id,
          ownerButtonId,
          displayMode: "collapsed",
          bounds: {
            Left: anchor.left,
            Top: anchor.top,
            Width: anchor.width,
            Height: anchor.height
          }
        });
      });

      await Promise.all([fanWindowPromise, ...toolSetWindowPromises]);
      setFanSetupMenu(null);
    } catch (error) {
      console.error(
        `Failed to open saved fan setup for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Fan setup could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleEditFanSetups = async () => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening fan options.");
      return;
    }

    try {
      const document = buttonDocument ?? await loadButtonStateDocument();
      const setup = Object.values(document.fanSetups).find(
        (candidate) =>
          candidate.programName === selectedProgramName && candidate.panelName === selectedPanelName
      );
      await openButtonEditorWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName,
        surfaceId: setup?.fanSurfaceId
      });
    } catch (error) {
      console.error(
        `Failed to open panel fan options for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Fan options could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenButtonOrder = async () => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening button order.");
      return;
    }

    try {
      await openButtonEditorWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName
      });
    } catch (error) {
      console.error(
        `Failed to open button order for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Button order could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenSelectedScriptPopout = async () => {
    if (!selectedProgramName || !selectedPanelName || popSelectionDisabled) {
      return;
    }

    try {
      if (selectedToolSetRecords.length > 0) {
        await Promise.all(
          selectedToolSetRecords.map((record) => handleOpenToolSet(record, "open"))
        );
      }
      if (selectedRegularPanelScriptRecords.length === 0) {
        return;
      }
      const currentDocument = buttonDocument ?? await loadButtonStateDocument();
      const draft = cloneButtonDocument(currentDocument);
      const selectedButtons = selectedRegularPanelScriptRecords.map((record) => {
        const button = canonicalButtonsBySource.get(
          canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName)
        ) ?? Object.values(draft.buttons).find((candidate) => {
          const identity = candidate.sourceIdentity;
          return Boolean(identity && canonicalButtonSourceKey(
            identity.displayProgramName,
            identity.displayPanelName,
            identity.displayFileName
          ) === canonicalButtonSourceKey(selectedProgramName, selectedPanelName, record.fileName));
        });
        if (!button) throw new Error(`Canonical Button was not found for '${record.label}'.`);
        return button;
      });
      const unit = ensureRegularPopout(draft, selectedButtons);
      const document = currentDocument.popoutUnits[unit.id]
        ? currentDocument
        : await saveButtonStateDocument(draft, currentDocument.revision);
      if (document !== currentDocument) {
        acceptButtonDocument(document);
        await publishButtonCommit(document);
      }
      const storedUnit = document.popoutUnits[unit.id];
      await openButtonPopoutWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName,
        popoutUnitId: storedUnit.id,
        bounds: storedUnit.desktopBounds
          ? {
              Left: storedUnit.desktopBounds.left,
              Top: storedUnit.desktopBounds.top,
              Width: storedUnit.desktopBounds.width,
              Height: storedUnit.desktopBounds.height
            }
          : undefined
      });
    } catch (error) {
      console.error(
        `Failed to open grouped script popout for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Pop window could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenGenericFanSetup = async () => {
    if (!selectedProgramName || !selectedPanelName) {
      return;
    }

    try {
      const currentDocument = buttonDocument ?? await loadButtonStateDocument();
      const draft = cloneButtonDocument(currentDocument);
      const memberButtons = Object.values(draft.buttons).filter(
        (candidate) =>
          candidate.role === "single-script" &&
          sourceIdentityMatchesFolderScope(
            candidate.sourceIdentity,
            selectedProgramName,
            selectedPanelName
          )
      );
      const setup = ensureFanSetup({
        document: draft,
        programName: selectedProgramName,
        panelName: selectedPanelName,
        buttons: memberButtons
      });
      const document = currentDocument.fanSetups[setup.id]
        ? currentDocument
        : await saveButtonStateDocument(draft, currentDocument.revision);
      if (document !== currentDocument) {
        acceptButtonDocument(document);
        await publishButtonCommit(document);
      }
      const storedSetup = document.fanSetups[setup.id];
      await openButtonFanWindow({
        programName: storedSetup.programName,
        panelName: storedSetup.panelName,
        fanSetupId: storedSetup.id,
        panelOwnerButtonId: storedSetup.panelOwnerButtonId,
        collapsedBounds: storedSetup.collapsedPanelOwnerBounds
          ? {
              Left: storedSetup.collapsedPanelOwnerBounds.left,
              Top: storedSetup.collapsedPanelOwnerBounds.top,
              Width: storedSetup.collapsedPanelOwnerBounds.width,
              Height: storedSetup.collapsedPanelOwnerBounds.height
            }
          : null
      });
    } catch (error) {
      console.error(
        `Failed to open a generic fan for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Fan could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenSelectedFanSetup = async () => {
    if (
      !selectedProgramName ||
      !selectedPanelName ||
      selectedPanelScriptRecords.length === 0
    ) {
      return;
    }

    try {
      const currentDocument = buttonDocument ?? await loadButtonStateDocument();
      const draft = cloneButtonDocument(currentDocument);
      const selectedButtons = selectedPanelScriptRecords.map((record) => {
        const sourceKey = canonicalButtonSourceKey(
          selectedProgramName,
          selectedPanelName,
          record.fileName
        );
        const button = canonicalButtonsBySource.get(sourceKey) ??
          Object.values(draft.buttons).find((candidate) => {
            const identity = candidate.sourceIdentity;
            return Boolean(
              identity &&
              candidate.role !== "tool-set-child" &&
              canonicalButtonSourceKey(
                identity.displayProgramName,
                identity.displayPanelName,
                identity.displayFileName
              ) === sourceKey
            );
          });
        if (
          !button ||
          (button.role !== "single-script" && button.role !== "tool-set-owner")
        ) {
          throw new Error(`Canonical Button was not found for '${record.label}'.`);
        }
        return button;
      });
      const setup = ensureFanSetup({
        document: draft,
        programName: selectedProgramName,
        panelName: selectedPanelName,
        buttons: selectedButtons
      });
      const document = currentDocument.fanSetups[setup.id]
        ? currentDocument
        : await saveButtonStateDocument(draft, currentDocument.revision);
      if (document !== currentDocument) {
        acceptButtonDocument(document);
        await publishButtonCommit(document);
      }
      await handleOpenSavedFanSetup(setup.id, document);
    } catch (error) {
      console.error(
        `Failed to open a selected Fan for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Selected Fan could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const getMainChromeWindow = () => {
    const currentWindow = getCurrentWindow();
    return currentWindow.label === "main" ? currentWindow : null;
  };

  const handleMinimizeMainWindow = async () => {
    await getMainChromeWindow()?.minimize();
  };

  const handleToggleMaximizeMainWindow = async () => {
    const mainWindow = getMainChromeWindow();
    if (!mainWindow) {
      return;
    }

    if (await mainWindow.isMaximized()) {
      await mainWindow.unmaximize();
      return;
    }

    await mainWindow.maximize();
  };

  const handleCloseMainWindow = async () => {
    await getMainChromeWindow()?.close();
  };

  const handleButtonActivate = async (
    button: ButtonRecord,
    event: PointerEvent | KeyboardEvent
  ) => {
    if (button.actionId === "top-left-button-1") {
      try {
        await handleSaveLayout();
      } catch (error) {
        console.error("Failed to save layout.", error);
        window.alert(`Layout could not be saved.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "top-left-button-2") {
      try {
        await handleLoadLayout();
      } catch (error) {
        console.error("Failed to load layout.", error);
        window.alert(`Layout could not be loaded.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "top-left-button-3") {
      try {
        await openBindsWindow();
      } catch (error) {
        console.error("Failed to open Binds.", error);
        window.alert(`Binds could not be opened.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "top-left-button-7") {
      await reloadCurrentHostWindow();
      return;
    }

    if (button.actionId === "open-settings") {
      setIsSettingsOpen(true);
      return;
    }

    if (button.actionId === "open-button-editor") {
      try {
        await openButtonEditorWindow();
      } catch (error) {
        console.error("Failed to open Buttons Editor.", error);
        window.alert(`Buttons Editor could not be opened.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "top-right-button-1") {
      await handleMinimizeMainWindow();
      return;
    }

    if (button.actionId === "top-right-button-2") {
      await handleToggleMaximizeMainWindow();
      return;
    }

    if (button.actionId === "top-right-button-3") {
      await handleCloseMainWindow();
      return;
    }

    if (button.actionId === "select-program-folder" && button.folderName) {
      setSelectedProgramName(button.folderName);
      return;
    }

    if (button.actionId === "select-panel-folder" && button.folderName) {
      setSelectedPanelName(button.folderName);
      return;
    }

    if (button.actionId === "add-program-folder") {
      try {
        await openAddProgramWindow();
      } catch (error) {
        console.error("Failed to open Add Program.", error);
        window.alert(`Add Program could not be opened.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "add-panel-folder") {
      if (!selectedProgramName) {
        window.alert("Select a program before adding a panel.");
        return;
      }

      try {
        await openAddPanelWindow(selectedProgramName);
      } catch (error) {
        console.error("Failed to open Add Panel.", error);
        window.alert(`Add Panel could not be opened.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    if (button.actionId === "add-panel-script") {
      if (!selectedProgramName) {
        window.alert("Select a program before adding a Button.");
        return;
      }

      if (!selectedPanelName) {
        window.alert("Select a panel before adding a Button.");
        return;
      }

      try {
        await openButtonEditorWindow({
          programName: selectedProgramName,
          panelName: selectedPanelName,
          lockImportDestination: true
        });
      } catch (error) {
        console.error(`Failed to add Button for ${selectedProgramName}.`, error);
        window.alert(`Button could not be added.\n\n${formatErrorMessage(error)}`);
      }

      return;
    }

    if (button.actionId === "add-panel-macro") {
      if (!selectedProgramName) {
        window.alert("Select a program before adding a macro.");
        return;
      }

      if (!selectedPanelName) {
        window.alert("Select a panel before adding a macro.");
        return;
      }

      await openMacroLabWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName,
        attachToPanel: true
      });
      return;
    }

    if (button.actionId === "open-macro-lab") {
      if (!selectedProgramName) {
        window.alert("Select a program before opening Macro Lab.");
        return;
      }

      if (!selectedPanelName) {
        window.alert("Select a panel before opening Macro Lab.");
        return;
      }

      await openMacroLabWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName
      });
      return;
    }

    if (button.actionId === "pop-panel-script") {
      await handleOpenSelectedScriptPopout();
      return;
    }

    if (button.actionId === "open-fan-setup-menu") {
      if (fanMenuDisabled) return;
      if (selectedPanelScriptRecords.length > 0) {
        await handleOpenSelectedFanSetup();
        return;
      }
      if (panelFanSetups.length === 0) {
        await handleOpenGenericFanSetup();
        return;
      }
      if (panelFanSetups.length === 1) {
        await handleOpenSavedFanSetup(panelFanSetups[0].id);
        return;
      }
      const target = event.currentTarget;
      const rect = target instanceof Element ? target.getBoundingClientRect() : null;
      setFanSetupMenu((current) =>
        current
          ? null
          : {
              left: rect?.left ?? button.x,
              top: (rect?.bottom ?? button.y + button.height) + 6
            }
      );
      return;
    }

    if (button.actionId === "edit-fan-setups") {
      await handleEditFanSetups();
      return;
    }

    if (button.actionId === "edit-button-layout") {
      if (orderButtonDisabled) {
        return;
      }

      await handleOpenButtonOrder();
      return;
    }

    if (button.actionId === "toggle-all-panel-scripts") {
      if (toggleAllPanelScriptsDisabled) {
        return;
      }

      setSelectedPanelScriptFileNames((current) => {
        const currentSelection = new Set(current);
        const hasEverySelectableScript =
          selectablePanelScriptFileNames.length > 0 &&
          selectablePanelScriptFileNames.every((fileName) => currentSelection.has(fileName));
        return hasEverySelectableScript ? [] : [...selectablePanelScriptFileNames];
      });
      return;
    }

    if (button.actionId === "delete-selected-panel-scripts") {
      if (deleteSelectedPanelScriptsDisabled) {
        return;
      }

      await deletePanelScriptFileNames(selectedPanelScriptFileNames);
      return;
    }

    if (isPanelScriptButtonAction(button.actionId) && button.scriptFileName) {
      togglePanelScriptSelection(button.scriptFileName);
      return;
    }
  };

  const handleButtonDoubleActivate = async (
    button: ButtonRecord,
    event: MouseEvent
  ) => {
    if (
      button.disabled ||
      !isPanelScriptButtonAction(button.actionId) ||
      !button.scriptFileName
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const matchedRecord =
      resolvedPanelScriptsByFileName.get(button.scriptFileName) ?? null;
    try {
      await handlePerformPanelScriptPrimaryAction(button.scriptFileName, matchedRecord);
    } catch (error) {
      console.error(`Button '${button.label}' could not run.`, error);
      window.alert(`Button '${button.label}' could not run.\n\n${formatErrorMessage(error)}`);
      throw error;
    }
  };

  const canonicalPresentationForMainButton = (button: ButtonRecord) => {
    if (button.scriptFileName && selectedProgramName && selectedPanelName) {
      return canonicalPresentationsBySource.get(
        canonicalButtonSourceKey(
          selectedProgramName,
          selectedPanelName,
          button.scriptFileName
        )
      );
    }
    return canonicalPanelOwnerPresentations.byButtonId.get(button.id);
  };

  return (
    <main
      className={[
        "main-page",
        spaceDragActive ? "main-page--space-drag" : "",
        spaceDragging ? "main-page--dragging" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={handleMainShellPointerDown}
      onPointerMove={handleRailHoverPointerMove}
      onPointerLeave={() => {
        setHoveredRailId(null);
      }}
      onPointerUp={() => setSpaceDragging(false)}
      onPointerCancel={() => {
        setSpaceDragging(false);
      }}
    >
      <ExactPageFrame page={page}>
        <div className="main-page__page">
          <div
            className="main-page__background"
            aria-hidden="true"
            style={{ backgroundImage: `url(${mainBackground})` }}
          />
          {rails.map((rail) => (
            <RailSurface
              key={rail.id}
              rail={rail}
              isHovered={hoveredRailId === rail.id}
              motion={motionSettings.railHover}
            />
          ))}
          {topLeftActionAnchor ? (
            <div
              ref={topLeftActionGroupRef}
              className="main-page__button-group"
              style={{
                left: `${topLeftActionAnchor.x}px`,
                top: `${topLeftActionAnchor.y}px`,
                gap: `${topLeftActionGap}px`
              }}
            >
              {topLeftActionButtons.map((button) => (
                <MainControlHost
                  key={button.id}
                  control={button}
                  absolute={false}
                  targetHeightOverride={topLeftActionHeight}
                  onActivate={handleButtonActivate}
                  onRequestContextMenu={handleButtonContextMenu}
                />
              ))}
            </div>
          ) : null}
          {topRightActionAnchor ? (
            <div
              className="main-page__button-group"
              style={{
                right: `${topRightActionAnchor.right}px`,
                top: `${topRightActionAnchor.y}px`,
                gap: `${topRightActionGap}px`
              }}
            >
              {topRightActionButtons.map((button) => (
                <MainControlHost
                  key={button.id}
                  control={button}
                  absolute={false}
                  onActivate={handleButtonActivate}
                  onRequestContextMenu={handleButtonContextMenu}
                />
              ))}
            </div>
          ) : null}
          {independentlyPositionedButtons.map((button) => {
            const canonicalPresentation = canonicalPresentationForMainButton(button);
            const requiresCanonicalPresentation = Boolean(button.scriptFileName);
            return canonicalPresentation ? (
              <MainButtonHost
                key={button.id}
                button={button}
                canonicalPresentation={canonicalPresentation}
                onActivate={handleButtonActivate}
                onDoubleActivate={handleButtonDoubleActivate}
                onRequestContextMenu={handleButtonContextMenu}
              />
            ) : requiresCanonicalPresentation ? null : (
              <MainControlHost
                key={button.id}
                control={button}
                onActivate={handleButtonActivate}
                onRequestContextMenu={handleButtonContextMenu}
              />
            );
          })}
          {fanSetupMenu ? (
            <>
              <div
                className="fan-setup-menu__backdrop"
                aria-hidden="true"
                onMouseDown={() => setFanSetupMenu(null)}
              />
              <div
                className="fan-setup-menu"
                role="menu"
                aria-label={`Saved fan setups for ${selectedPanelName ?? "panel"}`}
                style={{ left: fanSetupMenu.left, top: fanSetupMenu.top }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="fan-setup-menu__title">Fan setups</div>
                {panelFanSetups.length > 0 ? (
                  panelFanSetups.map((setup) => (
                    <CanonicalActionButton
                      key={setup.id}
                      id={`fan-setup-menu:${setup.id}`}
                      label={setup.name}
                      tooltip={`Open the exact saved '${setup.name}' fan arrangement.`}
                      className="fan-setup-menu__item"
                      onActivate={() => handleOpenSavedFanSetup(setup.id)}
                    />
                  ))
                ) : (
                  <>
                    <p className="fan-setup-menu__empty">
                      No saved fan setup exists for this panel.
                    </p>
                    <CanonicalActionButton
                      id="fan-setup-menu:open-editor"
                      label="Open Buttons Editor"
                      className="fan-setup-menu__item"
                      onActivate={async () => {
                        setFanSetupMenu(null);
                        await openButtonEditorWindow({
                          programName: selectedProgramName ?? undefined,
                          panelName: selectedPanelName ?? undefined
                        });
                      }}
                    />
                  </>
                )}
              </div>
            </>
          ) : null}
          {contextMenu &&
          contextMenuButton &&
          (isScriptContextMenu || isProgramFolderContextMenu || isPanelFolderContextMenu) ? (
            <>
              <div
                className="button-context-menu__backdrop"
                aria-hidden="true"
                onMouseDown={closeContextMenu}
              />
              <div
                className="button-context-menu"
                role="menu"
                aria-label={`Actions for ${contextMenuButton.label}`}
                style={{
                  left: `${contextMenu.x}px`,
                  top: `${contextMenu.y}px`
                }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {isScriptContextMenu ? (
                  <>
                    <CanonicalActionButton
                      id={`button-context-description:${contextMenuButton.id}`}
                      label="Update Description"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleUpdateDescriptionContextMenuButton();
                      }}
                    />
                    <CanonicalActionButton
                      id={`button-context-rename:${contextMenuButton.id}`}
                      label="Rename Button"
                      className="button-context-menu__item"
                      onActivate={handleRenameContextMenuButton}
                    />
                    <CanonicalActionButton
                      id={`button-context-binds:${contextMenuButton.id}`}
                      label="Binds"
                      className="button-context-menu__item"
                      onActivate={handleBindsContextMenuButton}
                    />
                    <CanonicalActionButton
                      id={`button-context-delete:${contextMenuButton.id}`}
                      label="Delete Button"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleDeleteContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
                {isProgramFolderContextMenu ? (
                  <>
                    <CanonicalActionButton
                      id={`button-context-rename-program:${contextMenuButton.id}`}
                      label="Rename Program"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleRenameProgramContextMenuButton();
                      }}
                    />
                    <CanonicalActionButton
                      id={`button-context-delete-program:${contextMenuButton.id}`}
                      label="Delete Program"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleDeleteProgramContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
                {isPanelFolderContextMenu ? (
                  <>
                    <CanonicalActionButton
                      id={`button-context-rename-panel:${contextMenuButton.id}`}
                      label="Rename Panel"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleRenamePanelContextMenuButton();
                      }}
                    />
                    <CanonicalActionButton
                      id={`button-context-delete-panel:${contextMenuButton.id}`}
                      label="Delete Panel"
                      className="button-context-menu__item"
                      onActivate={() => {
                        void handleDeletePanelContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
              </div>
            </>
          ) : null}
          {isSettingsOpen ? (
            <>
              <div
                className="main-page__settings-backdrop"
                aria-hidden="true"
                onMouseDown={() => setIsSettingsOpen(false)}
              />
              <section
                className="main-page__settings"
                role="dialog"
                aria-modal="true"
                aria-label="FlowCell Settings"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header className="main-page__settings-header">
                  <h2>Settings</h2>
                  <button
                    type="button"
                    className="main-page__settings-close"
                    aria-label="Close settings"
                    onClick={() => setIsSettingsOpen(false)}
                  >
                    X
                  </button>
                </header>
                <label className="main-page__settings-option">
                  <input
                    type="checkbox"
                    checked={startupSettings.loadLastLayoutOnStartup}
                    onChange={(event) =>
                      handleStartupSettingChange({
                        loadLastLayoutOnStartup: event.target.checked
                      })
                    }
                  />
                  <span>Load last layout on startup</span>
                </label>
                <label className="main-page__settings-option">
                  <input
                    type="checkbox"
                    checked={startupSettings.minimizeMainOnStartup}
                    onChange={(event) =>
                      handleStartupSettingChange({
                        minimizeMainOnStartup: event.target.checked
                      })
                    }
                  />
                  <span>Minimize main page on startup</span>
                </label>
              </section>
            </>
          ) : null}
        </div>
      </ExactPageFrame>
    </main>
  );
}
