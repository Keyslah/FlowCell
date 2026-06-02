import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  type Window as TauriWindow
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { ButtonHost } from "../../components/ButtonHost";
import { HostSkinButton } from "../../components/HostSkinButton";
import { ExactPageFrame } from "../../components/ExactPageFrame";
import { RailSurface } from "../../components/RailSurface";
import {
  applyButtonLabelOverridesToPanelScriptRecords,
  normalizeButtonLabelInput,
  readButtonLabelOverrides,
  writeButtonLabelOverrides
} from "../../lib/buttonLabelOverrides";
import { writePanelFanDiagnostics } from "../../lib/panelFanDiagnostics";
import {
  applyPanelButtonOrder,
  getPanelButtonOrderStorageKey,
  PANEL_BUTTON_ORDER_CHANGED_EVENT,
  readPanelButtonOrder,
  type PanelButtonOrderChangedPayload
} from "../../lib/panelButtonOrder";
import {
  addPanelScripts,
  createPanelFolder,
  createProgramFolder,
  deletePanelFolder,
  deleteProgramFolder,
  deletePanelScripts,
  loadLayoutSnapshot,
  listPanelFolders,
  listPanelScriptFiles,
  listProgramFolders,
  renamePanelFolder,
  renameProgramFolder,
  runPanelScript,
  saveLayoutSnapshot,
  showOpenLayoutDialog,
  showSaveLayoutDialog,
  updatePanelScriptDescription,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import {
  DEFAULT_SCRIPT_GROUP_POPOUT_TYPE,
  SCRIPT_GROUP_POPOUT_TYPE_OPTIONS,
  getScriptGroupPopoutTypeStorageKey,
  readScriptGroupPopoutType,
  writeScriptGroupPopoutType,
  type ScriptGroupPopoutType
} from "../../lib/scriptGroupPopoutSettings";
import {
  readLastLayoutDirectory,
  readRegisteredLayoutWindow,
  writeLastLayoutDirectory
} from "../../lib/layoutSnapshots";
import {
  openButtonReorderWindow,
  openAlignmentToolboxWindow,
  openBooleanToolboxWindow,
  openDimensionsToolboxWindow,
  openFlattenRevolveToolboxWindow,
  openBindsWindow,
  openCodexUsagePopoutWindow,
  openGenericToolboxWindow,
  openMacroLabWindow,
  openPanelFanOptionsWindow,
  openPanelFanWindow,
  openRemeshToolboxWindow,
  openRotateToolboxWindow,
  openSmartAxisToolboxWindow,
  openScriptGroupPopoutWindow,
  openThemeToolboxWindow,
  openTriPolyToolboxWindow,
  reloadCurrentHostWindow
} from "../../lib/windowing";
import { MACRO_PANEL_CHANGED_EVENT, runFrontendMacro } from "../../lib/macros";
import { showOpenFileDialog } from "../../lib/tauri";
import { DEFAULT_FLOW_IMPORTED_SKIN } from "../../lib/theme";
import mainBackground from "../../assets/backgrounds/main-background.jpeg";
import type { FlowCellBounds, LayoutSnapshot, LayoutSnapshotWindow, StyleGroup } from "../../types";
import {
  buildButtonsSurfaceButtons,
  buttonsSurfacePopTypeControlGeometry,
  buildPanelRailButtons,
  buildProgramRailButtons,
  page,
  rails,
  staticButtons,
  type ButtonRecord
} from "./mainLayout";
import "./mainPage.css";

type ButtonContextMenuState = {
  buttonId: string;
  x: number;
  y: number;
};

type MacroPanelChangedPayload = {
  programName?: string;
  panelName?: string;
};

const BUTTON_CONTEXT_MENU_WIDTH = 168;
const BUTTON_CONTEXT_MENU_HEIGHT = 156;
const BUTTON_CONTEXT_MENU_MARGIN = 8;
const PANEL_SCRIPT_DOUBLE_CLICK_MS = 220;
const LAYOUT_SNAPSHOT_VERSION = 6;
const CONTEXT_MENU_STYLE_GROUP: StyleGroup = {
  id: "main-page-context-menu-style",
  index: 0,
  name: "Context Menu Imported Button",
  skinId: "imported-skin",
  importedSkinId: DEFAULT_FLOW_IMPORTED_SKIN.id,
  accent: "#d2b28a"
};

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inferProgramNameFromExePath(exePath: string): string {
  const exeName = exePath.split(/[\\/]/).pop()?.replace(/\.exe$/i, "").trim() ?? "";
  if (!exeName) {
    return "";
  }

  const normalizedExeName = exeName.toLowerCase();

  if (normalizedExeName.includes("blender")) {
    return "Blender";
  }
  if (normalizedExeName.includes("illustrator")) {
    return "Illustrator";
  }
  if (normalizedExeName.includes("photoshop")) {
    return "Photoshop";
  }
  if (normalizedExeName.includes("explorer")) {
    return "Windows";
  }

  switch (normalizedExeName) {
    case "blender":
      return "Blender";
    default:
      return exeName
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
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

function isRotateToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "rotate_toolset" || record?.kind === "illustrator_rotate_toolset";
}

function isAlignmentToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "alignment_toolset";
}

function isIllustratorAlignmentToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "illustrator_alignment_toolset";
}

function isBooleanToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "boolean_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_boolean") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  const hasBooleanSignature =
    slots.has("operation_intersect") &&
    slots.has("operation_union") &&
    slots.has("operation_difference") &&
    slots.has("toggle_self_intersection") &&
    slots.has("toggle_hole_tolerant") &&
    slots.has("toggle_hide_cutter") &&
    slots.has("toggle_backup_active") &&
    slots.has("run_boolean");
  if (hasBooleanSignature) {
    return true;
  }

  const normalizedLabel = record.label.trim().toLowerCase();
  const normalizedFileName = record.fileName.trim().toLowerCase();
  return (
    (record.children?.length ?? 0) > 0 &&
    (normalizedLabel === "boolean" ||
      normalizedFileName === "boolean.flowcell-panel-item.json" ||
      normalizedFileName.startsWith("boolean."))
  );
}

function isRemeshToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "remesh_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_remesh") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return (
    slots.has("mode_voxel") &&
    slots.has("mode_smooth") &&
    slots.has("mode_sharp") &&
    slots.has("mode_blocks") &&
    slots.has("create_update_remesh") &&
    slots.has("apply_remesh")
  );
}

function isTriPolyToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "tri_poly_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_tri_poly") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return (
    slots.has("triangle_equilateral") &&
    slots.has("triangle_isosceles") &&
    slots.has("triangle_50") &&
    slots.has("triangle_right") &&
    slots.has("triangle_scalene") &&
    slots.has("polygon_create")
  );
}

function isDimensionsToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  if (record.kind === "dimensions_toolset") {
    return true;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_xyz_dimensions") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return slots.has("dimension_x") && slots.has("dimension_y") && slots.has("dimension_z");
}

function isFlattenRevolveToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_flatten_revolve") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  return slots.has("flatten_profile") && slots.has("generate_revolve");
}

function isSmartAxisToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return record?.kind === "smart_axis_toolset";
}

function isThemeToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  if (!record) {
    return false;
  }

  const normalizedBridgeAction = record.bridgeAction?.trim().toLowerCase() ?? "";
  if (normalizedBridgeAction === "flowcell_custom_theme") {
    return true;
  }

  const slots = new Set((record.children ?? []).map((child) => child.slot.trim().toLowerCase()));
  const hasThemeSignature =
    slots.has("browse_theme") &&
    slots.has("absorb_theme") &&
    slots.has("apply_theme") &&
    slots.has("apply_hdri") &&
    slots.has("apply_world_strength");
  if (hasThemeSignature) {
    return true;
  }

  const normalizedLabel = record.label.trim().toLowerCase();
  const normalizedFileName = record.fileName.trim().toLowerCase();
  return (
    (record.children?.length ?? 0) > 0 &&
    (normalizedLabel === "theme" ||
      normalizedFileName === "theme.flowcell-panel-item.json" ||
      normalizedFileName.startsWith("theme."))
  );
}

function isGenericToolboxRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return Boolean(
    record &&
      (record.children?.length ?? 0) > 0 &&
      !isFlattenRevolveToolboxRecord(record) &&
      !isRotateToolboxRecord(record) &&
      !isAlignmentToolboxRecord(record) &&
      !isBooleanToolboxRecord(record) &&
      !isRemeshToolboxRecord(record) &&
      !isTriPolyToolboxRecord(record) &&
      !isDimensionsToolboxRecord(record) &&
      !isThemeToolboxRecord(record) &&
      !isSmartAxisToolboxRecord(record)
  );
}

function isToolPopoutRecord(record: PanelScriptFileRecord | null | undefined): boolean {
  return (
    isFlattenRevolveToolboxRecord(record) ||
    isRotateToolboxRecord(record) ||
    isAlignmentToolboxRecord(record) ||
    isIllustratorAlignmentToolboxRecord(record) ||
    isBooleanToolboxRecord(record) ||
    isRemeshToolboxRecord(record) ||
    isTriPolyToolboxRecord(record) ||
    isDimensionsToolboxRecord(record) ||
    isSmartAxisToolboxRecord(record) ||
    isThemeToolboxRecord(record) ||
    isGenericToolboxRecord(record)
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

function isCodexUsageLauncher(
  programName: string,
  panelName: string,
  fileName: string
): boolean {
  return (
    areFolderNamesEqual(programName, "Windows") &&
    areFolderNamesEqual(panelName, "Utility") &&
    fileName.trim().localeCompare("codex_usage.vbs", undefined, { sensitivity: "accent" }) === 0
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
  return Boolean(
    bounds &&
      Number.isFinite(bounds.Left) &&
      Number.isFinite(bounds.Top) &&
      Number.isFinite(bounds.Width) &&
      Number.isFinite(bounds.Height) &&
      bounds.Width > 0 &&
      bounds.Height > 0
  );
}

type WindowBoundsTarget = Pick<TauriWindow, "scaleFactor" | "outerPosition" | "innerSize">;

async function captureWindowBounds(target: WindowBoundsTarget): Promise<FlowCellBounds | null> {
  const [scaleFactor, position, size] = await Promise.all([
    target.scaleFactor().catch(() => 1),
    target.outerPosition().catch(() => null),
    target.innerSize().catch(() => null)
  ]);

  if (!position || !size) {
    return null;
  }

  return {
    Left: Number((position.x / scaleFactor).toFixed(3)),
    Top: Number((position.y / scaleFactor).toFixed(3)),
    Width: Number((size.width / scaleFactor).toFixed(3)),
    Height: Number((size.height / scaleFactor).toFixed(3))
  };
}

type WindowPlacementTarget = Pick<TauriWindow, "setPosition" | "setSize">;

async function applyWindowBounds(
  target: WindowPlacementTarget,
  bounds: FlowCellBounds
): Promise<void> {
  await target.setSize(new LogicalSize(bounds.Width, bounds.Height)).catch(() => {});
  await target
    .setPosition(new LogicalPosition(bounds.Left, bounds.Top))
    .catch(() => {});
}

export default function MainPage() {
  const topLeftActionGroupRef = useRef<HTMLDivElement | null>(null);
  const pendingPanelScriptActionTimersRef = useRef<Record<string, number>>({});
  const preferredPanelSelectionRef = useRef<string | null>(null);
  const preferredSelectedPanelScriptFileNamesRef = useRef<string[] | null>(null);
  const [labelOverrides, setLabelOverrides] = useState(() => readButtonLabelOverrides());
  const [contextMenu, setContextMenu] = useState<ButtonContextMenuState | null>(null);
  const [programNames, setProgramNames] = useState<string[]>([]);
  const [selectedProgramName, setSelectedProgramName] = useState<string | null>(null);
  const [panelNames, setPanelNames] = useState<string[]>([]);
  const [selectedPanelName, setSelectedPanelName] = useState<string | null>(null);
  const [panelScripts, setPanelScripts] = useState<PanelScriptFileRecord[]>([]);
  const [panelButtonOrder, setPanelButtonOrder] = useState<string[]>([]);
  const [selectedPanelScriptFileNames, setSelectedPanelScriptFileNames] = useState<string[]>([]);
  const [selectedScriptGroupPopoutType, setSelectedScriptGroupPopoutType] =
    useState<ScriptGroupPopoutType>(DEFAULT_SCRIPT_GROUP_POPOUT_TYPE);

  useEffect(() => {
    writeButtonLabelOverrides(labelOverrides);
  }, [labelOverrides]);

  useEffect(() => {
    if (!selectedProgramName || !selectedPanelName) {
      setSelectedScriptGroupPopoutType(DEFAULT_SCRIPT_GROUP_POPOUT_TYPE);
      return;
    }

    const storageKey = getScriptGroupPopoutTypeStorageKey(selectedProgramName, selectedPanelName);
    const syncPopoutType = () => {
      setSelectedScriptGroupPopoutType(
        readScriptGroupPopoutType(selectedProgramName, selectedPanelName)
      );
    };

    syncPopoutType();

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== storageKey) {
        return;
      }

      syncPopoutType();
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [selectedPanelName, selectedProgramName]);

  useEffect(() => {
    if (!selectedProgramName || !selectedPanelName) {
      setPanelButtonOrder([]);
      return;
    }

    const storageKey = getPanelButtonOrderStorageKey(
      selectedProgramName,
      selectedPanelName
    );
    const syncButtonOrder = () => {
      setPanelButtonOrder(readPanelButtonOrder(selectedProgramName, selectedPanelName));
    };

    syncButtonOrder();

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== storageKey) {
        return;
      }

      syncButtonOrder();
    };

    const unlistenPromise = listen<PanelButtonOrderChangedPayload>(
      PANEL_BUTTON_ORDER_CHANGED_EVENT,
      (event) => {
        if (
          event.payload?.programName !== selectedProgramName ||
          event.payload?.panelName !== selectedPanelName
        ) {
          return;
        }

        syncButtonOrder();
      }
    );

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [selectedPanelName, selectedProgramName]);

  useEffect(
    () => () => {
      Object.values(pendingPanelScriptActionTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      pendingPanelScriptActionTimersRef.current = {};
    },
    []
  );

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
    if (!selectedProgramName) {
      setPanelNames([]);
      preferredPanelSelectionRef.current = null;
      setSelectedPanelName(null);
      return;
    }

    let cancelled = false;
    const preferredPanelName = preferredPanelSelectionRef.current;
    setPanelNames([]);
    if (!preferredPanelName) {
      setSelectedPanelName(null);
    }

    void (async () => {
      try {
        const nextPanelNames = await listPanelFolders(selectedProgramName);
        if (cancelled) {
          return;
        }

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
        if (cancelled) {
          return;
        }

        console.error(`Failed to load panel folders for ${selectedProgramName}.`, error);
        window.alert(`Panel folders failed to load.\n\n${formatErrorMessage(error)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProgramName]);

  useEffect(() => {
    if (!selectedProgramName || !selectedPanelName) {
      preferredSelectedPanelScriptFileNamesRef.current = null;
      setPanelScripts([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextPanelScripts = await listPanelScriptFiles(selectedProgramName, selectedPanelName);
        if (cancelled) {
          return;
        }

        setPanelScripts(nextPanelScripts);
        setSelectedPanelScriptFileNames((current) => {
          const preferredSelection = preferredSelectedPanelScriptFileNamesRef.current;
          if (!preferredSelection) {
            return current;
          }

          preferredSelectedPanelScriptFileNamesRef.current = null;
          const nextSelectableFileNames = new Set(
            nextPanelScripts.map((record) => record.fileName)
          );
          return preferredSelection.filter((fileName) =>
            nextSelectableFileNames.has(fileName)
          );
        });
      } catch (error) {
        if (cancelled) {
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
  }, [selectedPanelName, selectedProgramName]);

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

        void (async () => {
          try {
            const nextPanelScripts = await listPanelScriptFiles(
              selectedProgramName,
              selectedPanelName
            );
            setPanelScripts(nextPanelScripts);
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
  }, [selectedPanelName, selectedProgramName]);

  const programRailButtons = useMemo(
    () => buildProgramRailButtons(programNames, selectedProgramName),
    [programNames, selectedProgramName]
  );

  const orderedPanelScripts = useMemo(
    () => applyPanelButtonOrder(panelScripts, panelButtonOrder),
    [panelButtonOrder, panelScripts]
  );
  const selectablePanelScriptFileNames = useMemo(
    () => orderedPanelScripts.map((record) => record.fileName),
    [orderedPanelScripts]
  );
  const resolvedPanelScripts = useMemo(
    () =>
      applyButtonLabelOverridesToPanelScriptRecords(
        orderedPanelScripts,
        labelOverrides,
        selectedProgramName,
        selectedPanelName
      ),
    [labelOverrides, orderedPanelScripts, selectedPanelName, selectedProgramName]
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
  const selectedToolPopoutRecords = useMemo(
    () => selectedPanelScriptRecords.filter((record) => isToolPopoutRecord(record)),
    [selectedPanelScriptRecords]
  );
  const selectedCodexUsageLauncherRecords = useMemo(
    () =>
      selectedPanelScriptRecords.filter(
        (record) =>
          selectedProgramName &&
          selectedPanelName &&
          isCodexUsageLauncher(selectedProgramName, selectedPanelName, record.fileName)
      ),
    [selectedPanelName, selectedPanelScriptRecords, selectedProgramName]
  );
  const selectedRegularPanelScriptRecords = useMemo(
    () =>
      selectedPanelScriptRecords.filter(
        (record) =>
          !isToolPopoutRecord(record) &&
          !(
            selectedProgramName &&
            selectedPanelName &&
            isCodexUsageLauncher(selectedProgramName, selectedPanelName, record.fileName)
          )
      ),
    [selectedPanelName, selectedPanelScriptRecords, selectedProgramName]
  );
  const popSelectionDisabled = selectedPanelScriptRecords.length === 0;
  const fanSelectionDisabled = selectedPanelScriptRecords.length === 0;
  const fanOptionsDisabled = !selectedProgramName || !selectedPanelName;
  const orderButtonDisabled =
    !selectedProgramName || !selectedPanelName || orderedPanelScripts.length <= 1;

  useEffect(() => {
    const nextSelectableScriptFileNames = new Set(selectablePanelScriptFileNames);
    setSelectedPanelScriptFileNames((current) => {
      const next = current.filter((fileName) => nextSelectableScriptFileNames.has(fileName));
      return next.length === current.length ? current : next;
    });
  }, [selectablePanelScriptFileNames]);

  const panelRailButtons = useMemo(
    () => buildPanelRailButtons(panelNames, selectedPanelName),
    [panelNames, selectedPanelName]
  );

  const baseButtons = useMemo(
    () => [
      ...staticButtons,
      ...programRailButtons,
      ...panelRailButtons,
      ...buildButtonsSurfaceButtons(
        selectedProgramName,
        selectedPanelName,
        orderedPanelScripts,
        {
          selectedScriptFileNames: selectedPanelScriptFileNames,
          deleteSelectionDisabled: deleteSelectedPanelScriptsDisabled,
          selectAllDisabled: toggleAllPanelScriptsDisabled,
          allSelectableScriptsSelected: allSelectablePanelScriptsSelected,
          orderDisabled: orderButtonDisabled,
          popDisabled: popSelectionDisabled,
          fanDisabled: fanSelectionDisabled,
          fanOptionsDisabled
        }
      )
    ],
    [
      allSelectablePanelScriptsSelected,
      deleteSelectedPanelScriptsDisabled,
      fanOptionsDisabled,
      fanSelectionDisabled,
      orderButtonDisabled,
      panelRailButtons,
      popSelectionDisabled,
      programRailButtons,
      selectedPanelName,
      selectedProgramName,
      selectedPanelScriptFileNames,
      orderedPanelScripts,
      toggleAllPanelScriptsDisabled
    ]
  );

  const baseButtonsById = useMemo(
    () => new Map(baseButtons.map((button) => [button.id, button])),
    [baseButtons]
  );
  const allButtons = useMemo(
    () =>
      baseButtons.map((button) => {
        const overrideLabel = labelOverrides[button.id];
        return overrideLabel && overrideLabel !== button.label
          ? {
              ...button,
              label: overrideLabel
            }
          : button;
      }),
    [baseButtons, labelOverrides]
  );
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
    event: ReactMouseEvent<HTMLElement>
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

    if (isPanelScriptButton && button.scriptFileName) {
      clearPendingPanelScriptAction(button.scriptFileName);
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

  const clearPendingPanelScriptAction = (fileName: string) => {
    const timerId = pendingPanelScriptActionTimersRef.current[fileName];
    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    delete pendingPanelScriptActionTimersRef.current[fileName];
  };

  const handleRunPanelScript = async (fileName: string) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before running a script.");
      return;
    }

    if (isCodexUsageLauncher(selectedProgramName, selectedPanelName, fileName)) {
      try {
        await openCodexUsagePopoutWindow({
          programName: selectedProgramName,
          panelName: selectedPanelName
        });
      } catch (error) {
        console.error("Failed to open Codex usage popout.", error);
        window.alert(`Pop window could not be opened.\n\n${formatErrorMessage(error)}`);
      }
      return;
    }

    try {
      await runPanelScript(selectedProgramName, selectedPanelName, fileName);
    } catch (error) {
      console.error(`Failed to run panel script for ${selectedProgramName}.`, error);
      window.alert(`Script could not be run.\n\n${formatErrorMessage(error)}`);
    }
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

      const bounds =
        registeredWindow.kind === "panel-fan" && isValidFlowCellBounds(registeredWindow.snapshotBounds)
          ? registeredWindow.snapshotBounds
          : await captureWindowBounds(windowHandle);
      if (!isValidFlowCellBounds(bounds)) {
        continue;
      }

      managedWindows.push({
        Kind: registeredWindow.kind,
        ProgramName: registeredWindow.programName,
        PanelName: registeredWindow.panelName,
        FileName: registeredWindow.fileName,
        Label: registeredWindow.label,
        SelectedFileNames: registeredWindow.selectedFileNames,
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
    await closeManagedLayoutWindows();

    if (isValidFlowCellBounds(snapshot.MainWindowBounds)) {
      await applyWindowBounds(getCurrentWindow(), snapshot.MainWindowBounds);
    }

    const nextProgramNames = await listProgramFolders();
    setProgramNames(nextProgramNames);

    preferredPanelSelectionRef.current = snapshot.SelectedPanelName ?? null;
    preferredSelectedPanelScriptFileNamesRef.current =
      snapshot.SelectedFileNames && snapshot.SelectedFileNames.length > 0
        ? [...snapshot.SelectedFileNames]
        : null;

    const nextProgramName = resolveFolderSelection(
      nextProgramNames,
      snapshot.SelectedProgramName
    );
    setSelectedProgramName(nextProgramName);
    let nextPanelName: string | null = null;
    let nextPanelScripts: PanelScriptFileRecord[] = [];

    if (!nextProgramName) {
      setPanelNames([]);
      setSelectedPanelName(null);
      setPanelScripts([]);
      setSelectedPanelScriptFileNames([]);
    } else {
      const nextPanelNames = await listPanelFolders(nextProgramName);
      setPanelNames(nextPanelNames);

      nextPanelName = resolveFolderSelection(
        nextPanelNames,
        snapshot.SelectedPanelName
      );
      setSelectedPanelName(nextPanelName);

      if (!nextPanelName) {
        setPanelScripts([]);
        setSelectedPanelScriptFileNames([]);
      } else {
        nextPanelScripts = await listPanelScriptFiles(nextProgramName, nextPanelName);
        setPanelScripts(nextPanelScripts);
        const nextSelectableFileNames = new Set(
          nextPanelScripts.map((record) => record.fileName)
        );
        setSelectedPanelScriptFileNames(
          (snapshot.SelectedFileNames ?? []).filter((fileName) =>
            nextSelectableFileNames.has(fileName)
          )
        );
      }
    }

    for (const windowEntry of snapshot.Windows ?? []) {
      if (!isValidFlowCellBounds(windowEntry.Bounds)) {
        continue;
      }

      switch (windowEntry.Kind) {
        case "flatten-revolve-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openFlattenRevolveToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "generic-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openGenericToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "theme-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openThemeToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "rotate-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openRotateToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "alignment-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openAlignmentToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "boolean-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openBooleanToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "remesh-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openRemeshToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "tri-poly-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openTriPolyToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "dimensions-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openDimensionsToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "smart-axis-toolbox":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.FileName
          ) {
            await openSmartAxisToolboxWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              fileName: windowEntry.FileName,
              label: windowEntry.Label ?? windowEntry.FileName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "panel-fan":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.SelectedFileNames &&
            windowEntry.SelectedFileNames.length > 0
          ) {
            await openPanelFanWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              selectedFileNames: windowEntry.SelectedFileNames,
              label: windowEntry.Label ?? windowEntry.PanelName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "panel-fan-options":
          if (windowEntry.ProgramName && windowEntry.PanelName) {
            await openPanelFanOptionsWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "codex-usage-popout":
          if (windowEntry.ProgramName && windowEntry.PanelName) {
            await openCodexUsagePopoutWindow({
              programName: windowEntry.ProgramName,
              panelName: windowEntry.PanelName,
              bounds: windowEntry.Bounds
            });
          }
          break;
        case "script-group-popout":
          if (
            windowEntry.ProgramName &&
            windowEntry.PanelName &&
            windowEntry.SelectedFileNames &&
            windowEntry.SelectedFileNames.length > 0
          ) {
            const availableScripts = applyButtonLabelOverridesToPanelScriptRecords(
              nextProgramName === windowEntry.ProgramName &&
                nextPanelName === windowEntry.PanelName
                ? nextPanelScripts
                : await listPanelScriptFiles(windowEntry.ProgramName, windowEntry.PanelName),
              labelOverrides,
              windowEntry.ProgramName,
              windowEntry.PanelName
            );
            const selectedScripts = windowEntry.SelectedFileNames.map((fileName) => {
              const matchedRecord =
                availableScripts.find((record) => record.fileName === fileName) ?? null;
              if (
                isCodexUsageLauncher(
                  windowEntry.ProgramName ?? "",
                  windowEntry.PanelName ?? "",
                  fileName
                )
              ) {
                return null;
              }
              return matchedRecord && !isToolPopoutRecord(matchedRecord)
                ? {
                    fileName: matchedRecord.fileName,
                    label: matchedRecord.label
                  }
                : null;
            }).filter((record): record is { fileName: string; label: string } => Boolean(record));

            if (selectedScripts.length > 0) {
              const popoutType = readScriptGroupPopoutType(
                windowEntry.ProgramName,
                windowEntry.PanelName
              );
              await openScriptGroupPopoutWindow({
                programName: windowEntry.ProgramName,
                panelName: windowEntry.PanelName,
                scripts: selectedScripts,
                popoutType,
                label:
                  windowEntry.Label ??
                  (selectedScripts.length === 1
                    ? selectedScripts[0].label
                    : `${selectedScripts.length} Buttons`),
                bounds: windowEntry.Bounds
              });
            } else if (
              windowEntry.SelectedFileNames.some((fileName) =>
                isCodexUsageLauncher(
                  windowEntry.ProgramName ?? "",
                  windowEntry.PanelName ?? "",
                  fileName
                )
              )
            ) {
              await openCodexUsagePopoutWindow({
                programName: windowEntry.ProgramName,
                panelName: windowEntry.PanelName,
                bounds: windowEntry.Bounds
              });
            }
          }
          break;
      }
    }
  };

  const handleSaveLayout = async () => {
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
  };

  const handleLoadLayout = async () => {
    const selectedPath = await showOpenLayoutDialog(readLastLayoutDirectory() ?? undefined);
    if (!selectedPath) {
      return;
    }

    const snapshot = await loadLayoutSnapshot(selectedPath);
    writeLastLayoutDirectory(getParentDirectory(selectedPath));
    await restoreLayoutSnapshotState(snapshot);
  };

  const handleOpenRotateToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the rotate tool.");
      return;
    }

    await openRotateToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenAlignmentToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the alignment tool.");
      return;
    }

    await openAlignmentToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenBooleanToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the Boolean tool.");
      return;
    }

    await openBooleanToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenRemeshToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the Remesh tool.");
      return;
    }

    await openRemeshToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenTriPolyToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the Tri & Poly tool.");
      return;
    }

    await openTriPolyToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenDimensionsToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the XYZ Dimensions tool.");
      return;
    }

    await openDimensionsToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenFlattenRevolveToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the flatten revolve tool.");
      return;
    }

    await openFlattenRevolveToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenSmartAxisToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the Smart Axis tool.");
      return;
    }

    await openSmartAxisToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenThemeToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the theme tool.");
      return;
    }

    await openThemeToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenGenericToolbox = async (record: PanelScriptFileRecord) => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the tool set.");
      return;
    }

    await openGenericToolboxWindow({
      programName: selectedProgramName,
      panelName: selectedPanelName,
      fileName: record.fileName,
      label: record.label
    });
  };

  const handleOpenToolPopout = async (record: PanelScriptFileRecord) => {
    if (isFlattenRevolveToolboxRecord(record)) {
      await handleOpenFlattenRevolveToolbox(record);
      return;
    }

    if (isRotateToolboxRecord(record)) {
      await handleOpenRotateToolbox(record);
      return;
    }

    if (isAlignmentToolboxRecord(record)) {
      await handleOpenAlignmentToolbox(record);
      return;
    }

    if (isIllustratorAlignmentToolboxRecord(record)) {
      await handleOpenAlignmentToolbox(record);
      return;
    }

    if (isBooleanToolboxRecord(record)) {
      await handleOpenBooleanToolbox(record);
      return;
    }

    if (isRemeshToolboxRecord(record)) {
      await handleOpenRemeshToolbox(record);
      return;
    }

    if (isTriPolyToolboxRecord(record)) {
      await handleOpenTriPolyToolbox(record);
      return;
    }

    if (isDimensionsToolboxRecord(record)) {
      await handleOpenDimensionsToolbox(record);
      return;
    }

    if (isSmartAxisToolboxRecord(record)) {
      await handleOpenSmartAxisToolbox(record);
      return;
    }

    if (isThemeToolboxRecord(record)) {
      await handleOpenThemeToolbox(record);
      return;
    }

    if (isGenericToolboxRecord(record)) {
      await handleOpenGenericToolbox(record);
    }
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

    if (matchedRecord && isToolPopoutRecord(matchedRecord)) {
      await handleOpenToolPopout(matchedRecord);
      return;
    }

    await handleRunPanelScript(fileName);
  };

  const queuePanelScriptSelectionToggle = (fileName: string) => {
    clearPendingPanelScriptAction(fileName);
    pendingPanelScriptActionTimersRef.current[fileName] = window.setTimeout(() => {
      delete pendingPanelScriptActionTimersRef.current[fileName];
      togglePanelScriptSelection(fileName);
    }, PANEL_SCRIPT_DOUBLE_CLICK_MS);
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
        ? "Delete the selected button? Its backing file will be moved to the Recycle Bin."
        : `Delete ${normalizedFileNames.length} selected buttons? Their backing files will be moved to the Recycle Bin.`;
    if (!window.confirm(confirmMessage)) {
      return false;
    }

    try {
      const nextPanelScripts = await deletePanelScripts(
        selectedProgramName,
        selectedPanelName,
        normalizedFileNames
      );
      const deletedFileNameSet = new Set(normalizedFileNames);
      const deletedButtonIds = new Set(
        baseButtons
          .filter(
            (button) =>
              isPanelScriptButtonAction(button.actionId) &&
              button.scriptFileName &&
              deletedFileNameSet.has(button.scriptFileName)
          )
          .map((button) => button.id)
      );
      setPanelScripts(nextPanelScripts);
      setSelectedPanelScriptFileNames((current) =>
        current.filter((fileName) => !deletedFileNameSet.has(fileName))
      );
      if (deletedButtonIds.size > 0) {
        setLabelOverrides((current) => {
          const next = { ...current };
          deletedButtonIds.forEach((buttonId) => {
            delete next[buttonId];
          });
          return next;
        });
      }
      return true;
    } catch (error) {
      console.error(`Failed to delete panel scripts for ${selectedProgramName}.`, error);
      window.alert(`Selected buttons could not be deleted.\n\n${formatErrorMessage(error)}`);
      return false;
    }
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

    const matchedRecord = resolvedPanelScriptsByFileName.get(scriptFileName) ?? null;
    const currentDescription =
      matchedRecord?.tooltip?.trim() || contextMenuButton.tooltip?.trim() || "";
    closeContextMenu();

    const requestedDescription = window.prompt(
      "Enter the new hover description.",
      currentDescription
    );
    if (requestedDescription === null) {
      return;
    }

    try {
      const nextPanelScripts = await updatePanelScriptDescription(
        selectedProgramName,
        selectedPanelName,
        scriptFileName,
        requestedDescription
      );
      setPanelScripts(nextPanelScripts);
    } catch (error) {
      console.error(
        `Failed to update panel script description for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Button description could not be updated.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleRenameContextMenuButton = () => {
    if (!contextMenuButton || !isPanelScriptButtonAction(contextMenuButton.actionId)) {
      closeContextMenu();
      return;
    }

    const currentButton = contextMenuButton;
    const baseButton = baseButtonsById.get(currentButton.id) ?? currentButton;
    closeContextMenu();

    const requestedLabel = window.prompt("Enter the new button name.", currentButton.label);
    if (requestedLabel === null) {
      return;
    }

    const normalizedLabel = normalizeButtonLabelInput(requestedLabel);
    if (!normalizedLabel) {
      window.alert("Button name cannot be empty.");
      return;
    }

    setLabelOverrides((current) => {
      const next = { ...current };
      if (normalizedLabel === baseButton.label) {
        delete next[currentButton.id];
      } else {
        next[currentButton.id] = normalizedLabel;
      }
      return next;
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

    if (areFolderNamesEqual(currentName, trimmedName)) {
      return;
    }

    try {
      const renamedProgramName = await renameProgramFolder(currentName, trimmedName);
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
      console.error(`Failed to rename program folder ${currentName}.`, error);
      window.alert(`Program folder could not be renamed.\n\n${formatErrorMessage(error)}`);
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
        `Delete program ${currentName}? Its folder, panels, and buttons will be moved to the Recycle Bin.`
      )
    ) {
      return;
    }

    try {
      await deleteProgramFolder(currentName);
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
      console.error(`Failed to delete program folder ${currentName}.`, error);
      window.alert(`Program folder could not be deleted.\n\n${formatErrorMessage(error)}`);
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
      const renamedPanelName = await renamePanelFolder(
        selectedProgramName,
        currentName,
        trimmedName
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
        `Failed to rename panel folder ${selectedProgramName}/${currentName}.`,
        error
      );
      window.alert(`Panel folder could not be renamed.\n\n${formatErrorMessage(error)}`);
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
      await deletePanelFolder(selectedProgramName, currentName);
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
        `Failed to delete panel folder ${selectedProgramName}/${currentName}.`,
        error
      );
      window.alert(`Panel folder could not be deleted.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenPanelFan = async () => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening the panel fan.");
      return;
    }

    if (fanSelectionDisabled) {
      return;
    }

    try {
      const fanButtonRecord =
        resolvedButtonsById.get("buttons-fan-selection") ?? null;
      const selectAllButtonRecord =
        resolvedButtonsById.get("buttons-select-all") ?? null;
      const filesPanelButtonRecord =
        panelRailButtons.find((button) => button.folderName === selectedPanelName) ?? null;
      void writePanelFanDiagnostics("panel-fan-main-debug.json", {
        capturedAt: new Date().toISOString(),
        surface: "main",
        selectedProgramName,
        selectedPanelName,
        selectedFileNames: selectedPanelScriptRecords.map((record) => record.fileName),
        selectedLabels: selectedPanelScriptRecords.map((record) => record.label),
        window: {
          screenX: window.screenX,
          screenY: window.screenY,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          outerWidth: window.outerWidth,
          outerHeight: window.outerHeight
        },
        fanButton: {
          buttonId: fanButtonRecord?.id ?? null,
          label: fanButtonRecord?.label ?? null,
          layoutRect: serializeButtonLayoutRect(fanButtonRecord),
          viewportRect: serializeDomRect(
            document.querySelector("[data-button-id='buttons-fan-selection']")
          )
        },
        selectAllButton: {
          buttonId: selectAllButtonRecord?.id ?? null,
          label: selectAllButtonRecord?.label ?? null,
          layoutRect: serializeButtonLayoutRect(selectAllButtonRecord),
          viewportRect: serializeDomRect(
            document.querySelector("[data-button-id='buttons-select-all']")
          )
        },
        selectedPanelButton: {
          buttonId: filesPanelButtonRecord?.id ?? null,
          label: filesPanelButtonRecord?.label ?? null,
          layoutRect: serializeButtonLayoutRect(filesPanelButtonRecord),
          viewportRect: filesPanelButtonRecord
            ? serializeDomRect(
                document.querySelector(
                  `[data-button-id='${CSS.escape(filesPanelButtonRecord.id)}']`
                )
              )
            : null
        }
      });

      if (selectedToolPopoutRecords.length > 0) {
        await Promise.all(
          selectedToolPopoutRecords.map((record) => handleOpenToolPopout(record))
        );
      }
      if (selectedCodexUsageLauncherRecords.length > 0) {
        await Promise.all(
          selectedCodexUsageLauncherRecords.map(() =>
            openCodexUsagePopoutWindow({
              programName: selectedProgramName,
              panelName: selectedPanelName
            })
          )
        );
      }

      if (selectedRegularPanelScriptRecords.length === 0) {
        return;
      }

      await openPanelFanWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName,
        selectedFileNames: selectedRegularPanelScriptRecords.map((record) => record.fileName),
        label: selectedPanelName
      });
    } catch (error) {
      console.error(`Failed to open panel fan for ${selectedProgramName}/${selectedPanelName}.`, error);
      window.alert(`Panel fan could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleOpenPanelFanOptions = async () => {
    if (!selectedProgramName || !selectedPanelName) {
      window.alert("Select a program and panel before opening fan options.");
      return;
    }

    try {
      await openPanelFanOptionsWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName
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
      await openButtonReorderWindow({
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
      if (selectedToolPopoutRecords.length > 0) {
        await Promise.all(
          selectedToolPopoutRecords.map((record) => handleOpenToolPopout(record))
        );
      }
      if (selectedCodexUsageLauncherRecords.length > 0) {
        await Promise.all(
          selectedCodexUsageLauncherRecords.map(() =>
            openCodexUsagePopoutWindow({
              programName: selectedProgramName,
              panelName: selectedPanelName
            })
          )
        );
      }

      if (selectedRegularPanelScriptRecords.length === 0) {
        return;
      }

      await openScriptGroupPopoutWindow({
        programName: selectedProgramName,
        panelName: selectedPanelName,
        scripts: selectedRegularPanelScriptRecords.map((record) => ({
          fileName: record.fileName,
          label: record.label
        })),
        popoutType: selectedScriptGroupPopoutType,
        label:
          selectedRegularPanelScriptRecords.length === 1
            ? selectedRegularPanelScriptRecords[0].label
            : `${selectedRegularPanelScriptRecords.length} Buttons`
      });
    } catch (error) {
      console.error(
        `Failed to open grouped script popout for ${selectedProgramName}/${selectedPanelName}.`,
        error
      );
      window.alert(`Pop window could not be opened.\n\n${formatErrorMessage(error)}`);
    }
  };

  const handleScriptGroupPopoutTypeChange = (popoutType: ScriptGroupPopoutType) => {
    if (!selectedProgramName || !selectedPanelName) {
      setSelectedScriptGroupPopoutType(popoutType);
      return;
    }

    writeScriptGroupPopoutType(selectedProgramName, selectedPanelName, popoutType);
    setSelectedScriptGroupPopoutType(popoutType);
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
    event: ReactMouseEvent<HTMLElement>
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
      const selectedPaths = await showOpenFileDialog({
        title: "Choose Program EXE",
        filter: "Program EXE (*.exe)|*.exe|All Files (*.*)|*.*"
      });
      const exePath = selectedPaths[0]?.trim() ?? "";
      if (!exePath) {
        return;
      }

      const requestedName = window.prompt(
        "Name the new program folder.",
        inferProgramNameFromExePath(exePath)
      );
      if (requestedName === null) {
        return;
      }

      const trimmedName = requestedName.trim();
      if (!trimmedName) {
        window.alert("Program name cannot be empty.");
        return;
      }

      try {
        const nextProgramNames = await listProgramFolders();
        const existingProgramName =
          nextProgramNames.find((programName) => programName.toLowerCase() === trimmedName.toLowerCase()) ??
          null;
        if (existingProgramName) {
          setProgramNames(nextProgramNames);
          setSelectedProgramName(resolveFolderSelection(nextProgramNames, existingProgramName));
          return;
        }

        const createdProgram = await createProgramFolder(trimmedName, exePath);
        const refreshedProgramNames = await listProgramFolders();
        setProgramNames(refreshedProgramNames);
        setSelectedProgramName(
          resolveFolderSelection(refreshedProgramNames, createdProgram.programName)
        );
        if (createdProgram.statusMessage?.trim()) {
          window.alert(createdProgram.statusMessage);
        }
      } catch (error) {
        console.error("Failed to create program folder.", error);
        window.alert(`Program folder could not be created.\n\n${formatErrorMessage(error)}`);
      }

      return;
    }

    if (button.actionId === "add-panel-folder") {
      if (!selectedProgramName) {
        window.alert("Select a program before adding a panel.");
        return;
      }

      const requestedName = window.prompt(
        `Enter the new panel folder name for ${selectedProgramName}.`,
        ""
      );
      if (requestedName === null) {
        return;
      }

      const trimmedName = requestedName.trim();
      if (!trimmedName) {
        window.alert("Panel name cannot be empty.");
        return;
      }

      try {
        const createdPanelName = await createPanelFolder(selectedProgramName, trimmedName);
        const nextPanelNames = await listPanelFolders(selectedProgramName);
        setPanelNames(nextPanelNames);
        setSelectedPanelName(resolveFolderSelection(nextPanelNames, createdPanelName));
      } catch (error) {
        console.error("Failed to create panel folder.", error);
        window.alert(`Panel folder could not be created.\n\n${formatErrorMessage(error)}`);
      }

      return;
    }

    if (button.actionId === "add-panel-script") {
      if (!selectedProgramName) {
        window.alert("Select a program before adding a script.");
        return;
      }

      if (!selectedPanelName) {
        window.alert("Select a panel before adding a script.");
        return;
      }

      try {
        const nextPanelScripts = await addPanelScripts(selectedProgramName, selectedPanelName);
        setPanelScripts(nextPanelScripts);
      } catch (error) {
        console.error(`Failed to add panel script for ${selectedProgramName}.`, error);
        window.alert(`Script could not be added.\n\n${formatErrorMessage(error)}`);
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

    if (button.actionId === "fan-panel-script-selection") {
      await handleOpenPanelFan();
      return;
    }

    if (button.actionId === "open-panel-fan-options") {
      await handleOpenPanelFanOptions();
      return;
    }

    if (button.actionId === "open-button-order") {
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
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        clearPendingPanelScriptAction(button.scriptFileName);
        togglePanelScriptSelection(button.scriptFileName);
        return;
      }

      queuePanelScriptSelectionToggle(button.scriptFileName);
    }
  };

  const handleButtonDoubleActivate = async (
    button: ButtonRecord,
    _event: ReactMouseEvent<HTMLElement>
  ) => {
    if (!isPanelScriptButtonAction(button.actionId) || !button.scriptFileName) {
      return;
    }

    clearPendingPanelScriptAction(button.scriptFileName);
    const matchedRecord =
      resolvedPanelScriptsByFileName.get(button.scriptFileName) ?? null;
    await handlePerformPanelScriptPrimaryAction(button.scriptFileName, matchedRecord);
  };

  return (
    <main className="main-page">
      <ExactPageFrame page={page}>
        <div className="main-page__page">
          <div
            className="main-page__background"
            aria-hidden="true"
            style={{ backgroundImage: `url(${mainBackground})` }}
          />
          {rails.map((rail) => (
            <RailSurface key={rail.id} rail={rail} />
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
                <ButtonHost
                  key={button.id}
                  button={button}
                  absolute={false}
                  targetHeightOverride={topLeftActionHeight}
                  onActivate={handleButtonActivate}
                  onDoubleActivate={handleButtonDoubleActivate}
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
                <ButtonHost
                  key={button.id}
                  button={button}
                  absolute={false}
                  onActivate={handleButtonActivate}
                  onDoubleActivate={handleButtonDoubleActivate}
                  onRequestContextMenu={handleButtonContextMenu}
                />
              ))}
            </div>
          ) : null}
          {independentlyPositionedButtons.map((button) => (
            <ButtonHost
              key={button.id}
              button={button}
              onActivate={handleButtonActivate}
              onDoubleActivate={handleButtonDoubleActivate}
              onRequestContextMenu={handleButtonContextMenu}
            />
          ))}
          <label
            className="main-page__poptype-control"
            style={{
              left: `${buttonsSurfacePopTypeControlGeometry.x}px`,
              top: `${buttonsSurfacePopTypeControlGeometry.y}px`,
              width: `${buttonsSurfacePopTypeControlGeometry.width}px`,
              height: `${buttonsSurfacePopTypeControlGeometry.height}px`,
              borderRadius: `${buttonsSurfacePopTypeControlGeometry.radius}px`
            }}
          >
            <span className="main-page__poptype-label">PopType</span>
            <select
              className="main-page__poptype-select"
              aria-label="Popout type"
              value={selectedScriptGroupPopoutType}
              disabled={!selectedProgramName || !selectedPanelName}
              onChange={(event) =>
                handleScriptGroupPopoutTypeChange(
                  event.target.value as ScriptGroupPopoutType
                )
              }
            >
              {SCRIPT_GROUP_POPOUT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
                    <HostSkinButton
                      type="button"
                      label="Update Description"
                      flowId={`button-context-description:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleUpdateDescriptionContextMenuButton();
                      }}
                    />
                    <HostSkinButton
                      type="button"
                      label="Rename Button"
                      flowId={`button-context-rename:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={handleRenameContextMenuButton}
                    />
                    <HostSkinButton
                      type="button"
                      label="Delete Button"
                      flowId={`button-context-delete:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleDeleteContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
                {isProgramFolderContextMenu ? (
                  <>
                    <HostSkinButton
                      type="button"
                      label="Rename Program"
                      flowId={`button-context-rename-program:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleRenameProgramContextMenuButton();
                      }}
                    />
                    <HostSkinButton
                      type="button"
                      label="Delete Program"
                      flowId={`button-context-delete-program:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleDeleteProgramContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
                {isPanelFolderContextMenu ? (
                  <>
                    <HostSkinButton
                      type="button"
                      label="Rename Panel"
                      flowId={`button-context-rename-panel:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleRenamePanelContextMenuButton();
                      }}
                    />
                    <HostSkinButton
                      type="button"
                      label="Delete Panel"
                      flowId={`button-context-delete-panel:${contextMenuButton.id}`}
                      className="button-context-menu__item"
                      styleGroup={CONTEXT_MENU_STYLE_GROUP}
                      importedSkin={DEFAULT_FLOW_IMPORTED_SKIN}
                      hostMode="neutral"
                      targetHeight={44}
                      onClick={() => {
                        void handleDeletePanelContextMenuButton();
                      }}
                    />
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </ExactPageFrame>
    </main>
  );
}
