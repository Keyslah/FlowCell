import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SetStateAction,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import {
  cursorPosition,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize
} from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { emitCommand } from "./lib/emitCommand";
import {
  broadcastStateSync,
  closePanelPopout,
  clearButtonBinding,
  closeToolPopout,
  getForegroundProcessInfo,
  getWindowContext,
  installBlenderButtons,
  listenForProgrammaticWindowPlacement,
  listenForStateSync,
  listLayoutFiles,
  listRecordedMacros,
  loadLayoutSnapshot,
  loadState,
  logFrontendEvent,
  openButtonAppearanceWindow,
  openLayoutPickerWindow,
  openPanelFanOptionsWindow,
  openPanelPopout,
  openToolPopout,
  saveButtonBinding,
  saveLayoutSnapshot,
  saveState,
  showOpenExeDialog,
  showOpenFileDialog
} from "./lib/tauri";
import {
  addButtonsToPanel,
  addPanel,
  addProgram,
  applyBindingsToState,
  applyLayoutSnapshot,
  buildCommandEnvelope,
  buildLayoutSnapshot,
  buildScriptButtonsFromPaths,
  buildToolActionEnvelope,
  collectAllButtons,
  deleteProgram,
  deleteButtonFromPanel,
  ensureStateDefaults,
  findButton,
  findPanel,
  findProgram,
  findToolPopoutByOwner,
  getAlignmentToolModifiers,
  getSelectedPanel,
  getSelectedProgram,
  getSmartAxisCommandForButton,
  getToolOptionState,
  getToolPopoutButtons,
  isAlignmentOwnerButton,
  isFlattenRevolveOwnerButton,
  isQuickRotateGroupOwnerButton,
  isRegularPopCandidate,
  isSmartAxisButton,
  isSmartAxisOwnerButton,
  removeToolPopout,
  restoreSavedProgram,
  saveProgramSnapshot,
  updateAlignmentToolModifiers,
  updateAppTheme,
  updateAllProgramStyleGroups,
  updateButtonLabel,
  updatePanelButtonStyleGroup,
  updateButtonStyleGroup,
  updateButtonTooltip,
  updateImportedSkins,
  updatePanelFanOptions,
  updatePanelPopout,
  updatePanelSelection,
  updateProgramSelection,
  updateSurfaceStyleAssignment,
  updateStyleGroups,
  updateToolOptionState,
  updateToolPopout,
  upsertToolPopout
} from "./lib/state";
import {
  buildAvailableCandidateShortcuts,
  buildUsedShortcutMap,
  formatShortcutForDisplay,
  normalizeShortcut,
  parseShortcutInput
} from "./lib/bindings";
import { resolveGreenHighlightColor } from "./lib/highlightPalette";
import {
  getImportedSkin,
  renderButtonSkin,
  renderSurfaceSkin,
  resolveStyleGroup
} from "./lib/skins";
import {
  buildAppThemeCssVars,
  buildEggshellImportedSkin,
  getAppThemeVariant,
  getAppThemePreset,
  normalizeAppTheme
} from "./lib/theme";
import { ButtonCard } from "./components/ButtonCard";
import {
  BUTTON_APPEARANCE_ALL_BUTTONS_ID,
  ButtonAppearanceWindow
} from "./components/ButtonAppearanceWindow";
import { MacroLabPage } from "./components/MacroLabPage";
import {
  FanOutButtonCluster,
  type FanClusterEntry,
  type FanClusterFloatingMetrics,
  type FanClusterInteractiveRect,
  type FanClusterPanelMetrics
} from "./components/FanOutButtonCluster";
import { AppearanceTab } from "./components/AppearanceTab";
import { HostSkinButton } from "./components/HostSkinButton";
import {
  OwnerFanoutOverlay,
  type ViewportRect
} from "./components/OwnerFanoutOverlay";
import { PanelFanOptionsWindow } from "./components/PanelFanOptionsWindow";
import {
  AlignmentToolSurface,
  FlattenRevolveToolSurface,
  QuickRotateGroupToolSurface,
  SmartAxisStrip
} from "./components/ToolSurfaces";
import { DEFAULT_PANEL_FAN_OPTIONS } from "./types";
import type {
  CommandEnvelope,
  CommandResult,
  FlowCellButton,
  FlowCellBindingsState,
  FlowCellBounds,
  FlowCellPanel,
  FlowCellProgram,
  FlowCellState,
  ImportedSkin,
  LayoutSnapshot,
  LoadStateResponse,
  PanelFanOptions,
  RecordedMacroChoice,
  RuntimeInfo,
  SavedProgramRecord,
  SavedLayoutFile,
  SavedVisualTheme,
  SurfaceStyleSectionId,
  StyleGroup,
  ToolPopoutLayoutMode,
  ToolPopoutRecord,
  WindowContext
} from "./types";

type SurfaceMode = "panel" | "appearance" | "binds" | "macro-lab";

interface SelectedButtonRef {
  programId: number;
  panelId: string;
  buttonId: string;
}

interface ActiveOwnerFanoutState {
  programId: number;
  panelId: string;
  ownerButtonId: string;
  ownerRect: ViewportRect;
}

interface ActivateButtonOptions {
  ownerButtonId?: string;
  childSlotId?: string;
  toolAction?: string;
}

interface LayoutPickerState {
  files: SavedLayoutFile[];
  selectedPath: string;
}

interface MacroPickerState {
  options: RecordedMacroChoice[];
  selectedId: string;
  purpose: "add-button" | "bind-target";
}

interface PopoutContextMenuState {
  left: number;
  top: number;
}

interface ButtonContextMenuState {
  buttonId: string;
  left: number;
  top: number;
}

interface ProgramContextMenuState {
  programId: number;
  left: number;
  top: number;
}

interface ProgramManagerState {
  programName: string;
  exePath: string;
  selectedSavedProgramId: number | null;
}

interface BindTargetState {
  button: FlowCellButton;
  programId: number;
  panelId?: string;
  source: "workspace" | "script" | "macro";
}

interface BindListItem {
  id: string;
  button: FlowCellButton;
  programId: number;
  panelId?: string;
  programLabel: string;
  label: string;
  target: string;
  shortcut: string;
  source: "workspace" | "macro";
}

interface AnchoredPopoutMetrics {
  windowWidth: number;
  windowHeight: number;
  ownerLeft: number;
  ownerTop: number;
  ownerWidth: number;
  ownerHeight: number;
  childRects: FanClusterInteractiveRect[];
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SmartAxisVisualState {
  Modes: {
    X: string;
    Y: string;
    Z: string;
  };
  LiveEnabled: boolean;
  RunnerActive: boolean;
  Registered: boolean;
  LastMessage: string;
}

interface FlattenRevolveValues {
  FlattenAxis: string;
  RevolveAxis: string;
  CenterMode: string;
  AngleDeg: number;
  RevolveSteps: number;
  MergeDistance: number;
}

interface QuickRotateGroupValues {
  Axis: string;
  AngleDeg: number;
  CenterMode: string;
  OperationMode: string;
}

interface BuildPanelRenderItemsOptions {
  collapseSmartAxisToOwnerButton?: boolean;
}

type PanelRenderItem =
  | {
      kind: "button";
      button: FlowCellButton;
    }
  | {
      kind: "smart-axis";
      ownerButton: FlowCellButton;
      buttons: FlowCellButton[];
    };

const DEFAULT_SMART_AXIS_STATE: SmartAxisVisualState = {
  Modes: {
    X: "NONE",
    Y: "NONE",
    Z: "NONE"
  },
  LiveEnabled: false,
  RunnerActive: false,
  Registered: false,
  LastMessage: "Smart Axis Lock ready."
};

const DEFAULT_FLATTEN_REVOLVE_VALUES: FlattenRevolveValues = {
  FlattenAxis: "Y",
  RevolveAxis: "Z",
  CenterMode: "GEOMETRY",
  AngleDeg: 360,
  RevolveSteps: 128,
  MergeDistance: 0.0001
};

const DEFAULT_QUICK_ROTATE_GROUP_VALUES: QuickRotateGroupValues = {
  Axis: "Z",
  AngleDeg: 15,
  CenterMode: "WORLD",
  OperationMode: "TRANSFORM"
};

const FLOWCELL_WINDOW_PROCESS_NAMES = ["flowcell_frontend", "flowcellfrontend"];

function inferSurfaceName(context: WindowContext): string {
  switch (context.kind) {
    case "panel-popout":
      return "PanelPopout";
    case "panel-fan-options":
      return "PanelFanOptions";
    case "button-appearance":
      return "ButtonAppearance";
    case "layout-picker":
      return "LayoutPicker";
    case "tool-popout":
      switch (context.layoutMode) {
        case "PanelFan":
          return "ToolPopoutPanelFan";
        case "Fanout":
          return "ToolPopoutFanout";
        case "Individual":
          return "ToolPopoutIndividual";
        default:
          return "ToolPopoutGroup";
      }
    default:
      return "MainWindow";
  }
}

function buildChildSlotId(button: FlowCellButton, index: number): string {
  const slotLabel = button.Id || button.Label || `slot-${index + 1}`;
  return `fanout-${slotLabel}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPanelFanOwnerId(panelId: string): string {
  return `panel-fan-${panelId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampBoundsToWorkArea(bounds: FlowCellBounds): FlowCellBounds {
  const workAreaWidth = Math.max(window.screen.availWidth || window.innerWidth, bounds.Width);
  const workAreaHeight = Math.max(window.screen.availHeight || window.innerHeight, bounds.Height);
  return {
    ...bounds,
    Left: clamp(bounds.Left, 0, Math.max(workAreaWidth - bounds.Width, 0)),
    Top: clamp(bounds.Top, 0, Math.max(workAreaHeight - bounds.Height, 0))
  };
}

function areAnchoredRectsEqual(
  left: FanClusterInteractiveRect[],
  right: FanClusterInteractiveRect[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const next = right[index];
    return (
      Math.abs(entry.left - next.left) < 0.5 &&
      Math.abs(entry.top - next.top) < 0.5 &&
      Math.abs(entry.width - next.width) < 0.5 &&
      Math.abs(entry.height - next.height) < 0.5
    );
  });
}

function areAnchoredMetricsEqual(
  left: AnchoredPopoutMetrics | null,
  right: AnchoredPopoutMetrics | null
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    Math.abs(left.windowWidth - right.windowWidth) < 0.5 &&
    Math.abs(left.windowHeight - right.windowHeight) < 0.5 &&
    Math.abs(left.ownerLeft - right.ownerLeft) < 0.5 &&
    Math.abs(left.ownerTop - right.ownerTop) < 0.5 &&
    Math.abs(left.ownerWidth - right.ownerWidth) < 0.5 &&
    Math.abs(left.ownerHeight - right.ownerHeight) < 0.5 &&
    areAnchoredRectsEqual(left.childRects, right.childRects)
  );
}

function resolveScreenFitShift(minEdge: number, maxEdge: number, limit: number): number {
  const span = maxEdge - minEdge;
  if (span <= limit) {
    const minShift = -minEdge;
    const maxShift = limit - maxEdge;
    return clamp(0, minShift, maxShift);
  }
  if (minEdge < 0 && maxEdge > limit) {
    const shiftToLeftEdge = -minEdge;
    const shiftToRightEdge = limit - maxEdge;
    return Math.abs(shiftToLeftEdge) <= Math.abs(shiftToRightEdge)
      ? shiftToLeftEdge
      : shiftToRightEdge;
  }
  if (minEdge < 0) {
    return -minEdge;
  }
  if (maxEdge > limit) {
    return limit - maxEdge;
  }
  return 0;
}

function fitAnchoredMetricsToWorkArea<T extends AnchoredPopoutMetrics>(
  collapsedBounds: FlowCellBounds,
  metrics: T
): T {
  const workAreaWidth = Math.max(window.screen.availWidth || 0, window.innerWidth || 0, collapsedBounds.Width);
  const workAreaHeight = Math.max(
    window.screen.availHeight || 0,
    window.innerHeight || 0,
    collapsedBounds.Height
  );
  const expandedLeft = collapsedBounds.Left - metrics.ownerLeft;
  const expandedTop = collapsedBounds.Top - metrics.ownerTop;
  const childScreenRects = metrics.childRects.map((rect) => ({
    left: expandedLeft + rect.left,
    top: expandedTop + rect.top,
    width: rect.width,
    height: rect.height
  }));
  const shiftedChildRects = (() => {
    if (childScreenRects.length === 0) {
      return childScreenRects;
    }
    const minLeft = Math.min(...childScreenRects.map((rect) => rect.left));
    const maxRight = Math.max(...childScreenRects.map((rect) => rect.left + rect.width));
    const minTop = Math.min(...childScreenRects.map((rect) => rect.top));
    const maxBottom = Math.max(...childScreenRects.map((rect) => rect.top + rect.height));
    const shiftX = resolveScreenFitShift(minLeft, maxRight, workAreaWidth);
    const shiftY = resolveScreenFitShift(minTop, maxBottom, workAreaHeight);
    return childScreenRects.map((rect) => ({
      ...rect,
      left: rect.left + shiftX,
      top: rect.top + shiftY
    }));
  })();
  const minLeft = Math.min(collapsedBounds.Left, ...shiftedChildRects.map((rect) => rect.left));
  const minTop = Math.min(collapsedBounds.Top, ...shiftedChildRects.map((rect) => rect.top));
  const maxRight = Math.max(
    collapsedBounds.Left + metrics.ownerWidth,
    ...shiftedChildRects.map((rect) => rect.left + rect.width)
  );
  const maxBottom = Math.max(
    collapsedBounds.Top + metrics.ownerHeight,
    ...shiftedChildRects.map((rect) => rect.top + rect.height)
  );
  const windowLeft = Math.round(minLeft);
  const windowTop = Math.round(minTop);

  return {
    ...metrics,
    windowWidth: Math.ceil(maxRight - minLeft),
    windowHeight: Math.ceil(maxBottom - minTop),
    ownerLeft: Math.round(collapsedBounds.Left - minLeft),
    ownerTop: Math.round(collapsedBounds.Top - minTop),
    childRects: shiftedChildRects.map((rect) => ({
      left: Math.round(rect.left - windowLeft),
      top: Math.round(rect.top - windowTop),
      width: rect.width,
      height: rect.height
    }))
  };
}

function deriveExpandedAnchoredBounds(
  collapsedBounds: FlowCellBounds,
  metrics: AnchoredPopoutMetrics
): FlowCellBounds {
  return clampBoundsToWorkArea({
    Left: Math.round(collapsedBounds.Left - metrics.ownerLeft),
    Top: Math.round(collapsedBounds.Top - metrics.ownerTop),
    Width: Math.round(metrics.windowWidth),
    Height: Math.round(metrics.windowHeight)
  });
}

function deriveCollapsedAnchoredBounds(args: {
  windowBounds: FlowCellBounds;
  metrics: AnchoredPopoutMetrics;
  open: boolean;
}): FlowCellBounds {
  if (!args.open) {
    return {
      Left: Math.round(args.windowBounds.Left),
      Top: Math.round(args.windowBounds.Top),
      Width: Math.round(args.metrics.ownerWidth),
      Height: Math.round(args.metrics.ownerHeight)
    };
  }

  return {
    Left: Math.round(args.windowBounds.Left + args.metrics.ownerLeft),
    Top: Math.round(args.windowBounds.Top + args.metrics.ownerTop),
    Width: Math.round(args.metrics.ownerWidth),
    Height: Math.round(args.metrics.ownerHeight)
  };
}

function areBoundsEqual(left: FlowCellBounds, right: FlowCellBounds): boolean {
  return (
    Math.abs(left.Left - right.Left) < 0.5 &&
    Math.abs(left.Top - right.Top) < 0.5 &&
    Math.abs(left.Width - right.Width) < 0.5 &&
    Math.abs(left.Height - right.Height) < 0.5
  );
}

function buildBoundsKey(bounds: FlowCellBounds, state: "open" | "closed"): string {
  return `${Math.round(bounds.Left)},${Math.round(bounds.Top)},${Math.round(bounds.Width)}x${Math.round(bounds.Height)}:${state}`;
}

function buildAnchoredInteractiveRects(args: {
  collapsedBounds: FlowCellBounds;
  metrics: AnchoredPopoutMetrics;
  open: boolean;
}): ScreenRect[] {
  const expandedBounds = deriveExpandedAnchoredBounds(args.collapsedBounds, args.metrics);
  const baseBounds = args.open ? expandedBounds : args.collapsedBounds;
  const ownerLeft = args.open ? baseBounds.Left + args.metrics.ownerLeft : args.collapsedBounds.Left;
  const ownerTop = args.open ? baseBounds.Top + args.metrics.ownerTop : args.collapsedBounds.Top;
  const rects: ScreenRect[] = [
    {
      left: ownerLeft,
      top: ownerTop,
      right: ownerLeft + args.metrics.ownerWidth,
      bottom: ownerTop + args.metrics.ownerHeight
    }
  ];
  if (!args.open) {
    return rects;
  }
  args.metrics.childRects.forEach((rect) => {
    const left = baseBounds.Left + rect.left;
    const top = baseBounds.Top + rect.top;
    rects.push({
      left,
      top,
      right: left + rect.width,
      bottom: top + rect.height
    });
  });
  return rects;
}

function inflateRect(rect: ScreenRect, padding: number): ScreenRect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding
  };
}

function screenRectContains(rect: ScreenRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function shouldMoveOriginBeforeResize(
  currentBounds: FlowCellBounds,
  targetBounds: FlowCellBounds
): boolean {
  return (
    Math.abs(targetBounds.Left - currentBounds.Left) >= 0.5 ||
    Math.abs(targetBounds.Top - currentBounds.Top) >= 0.5
  );
}

async function applyAnchoredWindowBounds(
  windowHandle: {
    setPosition: (position: LogicalPosition) => Promise<void>;
    setSize: (size: LogicalSize) => Promise<void>;
    show: () => Promise<void>;
  },
  currentBounds: FlowCellBounds,
  targetBounds: FlowCellBounds
): Promise<void> {
  const moveOriginFirst = shouldMoveOriginBeforeResize(currentBounds, targetBounds);
  if (moveOriginFirst) {
    await windowHandle.setPosition(new LogicalPosition(targetBounds.Left, targetBounds.Top));
  }
  await windowHandle.setSize(new LogicalSize(targetBounds.Width, targetBounds.Height));
  if (!moveOriginFirst) {
    await windowHandle.setPosition(new LogicalPosition(targetBounds.Left, targetBounds.Top));
  }
  await windowHandle.show().catch(() => {});
}

function resolveEffectiveToolPopoutLayoutMode(
  layoutMode: ToolPopoutLayoutMode,
  ownerButton?: FlowCellButton
): ToolPopoutLayoutMode {
  if (
    layoutMode === "Individual" &&
    ownerButton &&
    (ownerButton.fanout?.child_button_ids?.length ?? 0) > 0
  ) {
    return "Fanout";
  }
  return layoutMode;
}

function buildOwnerFanoutKey(programId: number, panelId: string, buttonId: string): string {
  return `${programId}:${panelId}:${buttonId}`;
}

function toViewportRect(rect: DOMRect): ViewportRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.right,
    bottom: rect.bottom
  };
}

function areViewportRectsEqual(
  left: ViewportRect | null | undefined,
  right: ViewportRect | null | undefined
): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    Math.abs(left.top - right.top) < 0.5 &&
    Math.abs(left.left - right.left) < 0.5 &&
    Math.abs(left.width - right.width) < 0.5 &&
    Math.abs(left.height - right.height) < 0.5
  );
}

function sanitizeWindowToken(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9\-/:_]/g, "_");
  return sanitized.length > 0 ? sanitized : "flowcell";
}

function buildDedicatedButtonStyleGroupId(programId: number, panelId: string, buttonId: string): string {
  return `button-style-${programId}-${sanitizeWindowToken(panelId)}-${sanitizeWindowToken(buttonId)}`;
}

function buildDedicatedButtonImportedSkinId(
  programId: number,
  panelId: string,
  buttonId: string
): string {
  return `button-skin-${programId}-${sanitizeWindowToken(panelId)}-${sanitizeWindowToken(buttonId)}`;
}

function buildPanelButtonStyleGroupId(programId: number, panelId: string): string {
  return `button-style-${programId}-${sanitizeWindowToken(panelId)}-all`;
}

function buildPanelButtonImportedSkinId(programId: number, panelId: string): string {
  return `button-skin-${programId}-${sanitizeWindowToken(panelId)}-all`;
}

function createClientId(prefix: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}${randomPart}`;
}

function getButtonBindingNumericId(binding: FlowCellBindingsState["scriptBindings"][number]): number {
  return binding.id ?? binding.bindingId ?? 0;
}

function labelFromTargetPath(target: string): string {
  const fileName = target.split(/[\\/]/).pop() ?? target;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const strippedPrefix = withoutExtension.replace(/^(org_|file_|util_)/i, "");
  return strippedPrefix.replace(/[_-]+/g, " ").trim() || withoutExtension;
}

function buildDirectScriptBindButton(target: string): FlowCellButton {
  return {
    Id: `bind_script_${createClientId("")}`,
    Kind: "script",
    command_id: "flowcell.run_script",
    Label: labelFromTargetPath(target),
    Target: target,
    Shortcut: "",
    BindingId: 0,
    style_group_id: ""
  };
}

function buildDirectMacroBindButton(choice: RecordedMacroChoice): FlowCellButton {
  return {
    Id: `bind_macro_${choice.id}`,
    Kind: "macro",
    command_id: "flowcell.run_macro",
    Label: choice.label,
    Target: choice.id,
    Shortcut: "",
    BindingId: 0,
    style_group_id: ""
  };
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback = ""
): string {
  const value = source?.[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: number
): number {
  const value = source?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback = false
): boolean {
  const value = source?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSmartAxisState(values?: Record<string, unknown>): SmartAxisVisualState {
  const modeSource = toObjectRecord(values?.Modes);
  return {
    Modes: {
      X: readString(modeSource, "X", "NONE").toUpperCase() || "NONE",
      Y: readString(modeSource, "Y", "NONE").toUpperCase() || "NONE",
      Z: readString(modeSource, "Z", "NONE").toUpperCase() || "NONE"
    },
    LiveEnabled: readBoolean(values, "LiveEnabled", false),
    RunnerActive: readBoolean(values, "RunnerActive", false),
    Registered: readBoolean(values, "Registered", false),
    LastMessage: readString(values, "LastMessage", "Smart Axis Lock ready.")
  };
}

function normalizeFlattenRevolveValues(values?: Record<string, unknown>): FlattenRevolveValues {
  return {
    FlattenAxis: readString(values, "FlattenAxis", "Y").toUpperCase() || "Y",
    RevolveAxis: readString(values, "RevolveAxis", "Z").toUpperCase() || "Z",
    CenterMode: readString(values, "CenterMode", "GEOMETRY").toUpperCase() || "GEOMETRY",
    AngleDeg: readNumber(values, "AngleDeg", 360),
    RevolveSteps: Math.max(1, Math.round(readNumber(values, "RevolveSteps", 128))),
    MergeDistance: readNumber(values, "MergeDistance", 0.0001)
  };
}

function normalizeQuickRotateGroupValues(values?: Record<string, unknown>): QuickRotateGroupValues {
  return {
    Axis: readString(values, "Axis", "Z").toUpperCase() || "Z",
    AngleDeg: readNumber(values, "AngleDeg", 15),
    CenterMode: readString(values, "CenterMode", "WORLD").toUpperCase() || "WORLD",
    OperationMode:
      readString(values, "OperationMode", "TRANSFORM").toUpperCase() || "TRANSFORM"
  };
}

function buildVirtualToolButton(
  ownerButton: FlowCellButton,
  suffix: string,
  label: string,
  tooltip: string
): FlowCellButton {
  return {
    ...ownerButton,
    Id: `tool_${suffix}`,
    Kind: "tool_action",
    command_id: "flowcell.run_tool_action",
    Label: label,
    Tooltip: tooltip,
    Target: ownerButton.Target
  };
}

function buildPanelRenderItems(
  buttons: FlowCellButton[],
  options?: BuildPanelRenderItemsOptions
): PanelRenderItem[] {
  const smartAxisButtons = buttons.filter(isSmartAxisButton);
  const orderedSmartAxisButtons = [
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "baseline"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_x"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_y"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "cycle_z"),
    smartAxisButtons.find((button) => getSmartAxisCommandForButton(button) === "toggle_live")
  ].filter((button): button is FlowCellButton => Boolean(button));

  const items: PanelRenderItem[] = [];
  let smartAxisRendered = false;
  const smartAxisOwnerButton =
    orderedSmartAxisButtons.find((entry) => isSmartAxisOwnerButton(entry)) ??
    orderedSmartAxisButtons[0];

  buttons.forEach((button) => {
    if (isSmartAxisButton(button)) {
      if (smartAxisRendered) {
        return;
      }
      smartAxisRendered = true;
      if (smartAxisOwnerButton) {
        if (options?.collapseSmartAxisToOwnerButton) {
          items.push({
            kind: "button",
            button: smartAxisOwnerButton
          });
          return;
        }
        items.push({
          kind: "smart-axis",
          ownerButton: smartAxisOwnerButton,
          buttons: orderedSmartAxisButtons
        });
      }
      return;
    }

    items.push({
      kind: "button",
      button
    });
  });

  return items;
}

function extractToolOptionState(result: CommandResult): Record<string, unknown> | undefined {
  const detailState = toObjectRecord(result.details?.tool_option_state);
  if (detailState) {
    return detailState;
  }
  const legacyResult = toObjectRecord(result.details?.legacy_result);
  return toObjectRecord(legacyResult?.ToolOptionState);
}

function isBlenderToolSetPanel(program: FlowCellProgram | null, panel: FlowCellPanel | null): boolean {
  if (!program || !panel) {
    return false;
  }

  const normalizedProgram =
    program.ProgramConfig?.NormalizedName?.trim().toLowerCase() ?? "";
  return normalizedProgram === "blender" && panel.Name.trim().toLowerCase() === "tool set";
}

function isToolOwnerPopCandidate(button: FlowCellButton): boolean {
  return (
    isAlignmentOwnerButton(button) ||
    isFlattenRevolveOwnerButton(button) ||
    isQuickRotateGroupOwnerButton(button) ||
    isSmartAxisOwnerButton(button)
  );
}

function isPersistablePopoutBounds(bounds: FlowCellBounds): boolean {
  return (
    Number.isFinite(bounds.Left) &&
    Number.isFinite(bounds.Top) &&
    Number.isFinite(bounds.Width) &&
    Number.isFinite(bounds.Height) &&
    bounds.Left > -20000 &&
    bounds.Top > -20000 &&
    bounds.Width >= 140 &&
    bounds.Height >= 60
  );
}

function isPersistablePanelFanBounds(bounds: FlowCellBounds): boolean {
  return (
    Number.isFinite(bounds.Left) &&
    Number.isFinite(bounds.Top) &&
    Number.isFinite(bounds.Width) &&
    Number.isFinite(bounds.Height) &&
    bounds.Left > -20000 &&
    bounds.Top > -20000 &&
    bounds.Width >= 24 &&
    bounds.Height >= 24
  );
}

function isPersistableFloatingFanoutBounds(bounds: FlowCellBounds): boolean {
  return (
    Number.isFinite(bounds.Left) &&
    Number.isFinite(bounds.Top) &&
    Number.isFinite(bounds.Width) &&
    Number.isFinite(bounds.Height) &&
    bounds.Left > -20000 &&
    bounds.Top > -20000 &&
    bounds.Width >= 40 &&
    bounds.Height >= 24
  );
}

function normalizeLogicalValue(value: number, scaleFactor: number): number {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return Number((Math.round(value * safeScale) / safeScale).toFixed(3));
}

function resolveCapturedCollapsedFanBounds(
  liveBounds: FlowCellBounds,
  storedCollapsedBounds: FlowCellBounds
): FlowCellBounds {
  const liveLooksCollapsed =
    liveBounds.Width <= storedCollapsedBounds.Width * 1.5 &&
    liveBounds.Height <= storedCollapsedBounds.Height * 1.5;
  return liveLooksCollapsed ? liveBounds : storedCollapsedBounds;
}

async function readLogicalWindowBounds(windowHandle: {
  scaleFactor: () => Promise<number>;
  outerPosition: () => Promise<{ x: number; y: number }>;
  innerSize: () => Promise<{ width: number; height: number }>;
}): Promise<FlowCellBounds | null> {
  const scaleFactor = await windowHandle.scaleFactor().catch(() => 1);
  const [position, size] = await Promise.all([
    windowHandle.outerPosition().catch(() => null),
    windowHandle.innerSize().catch(() => null)
  ]);
  if (!position || !size) {
    return null;
  }

  return {
    Left: normalizeLogicalValue(position.x / scaleFactor, scaleFactor),
    Top: normalizeLogicalValue(position.y / scaleFactor, scaleFactor),
    Width: normalizeLogicalValue(size.width / scaleFactor, scaleFactor),
    Height: normalizeLogicalValue(size.height / scaleFactor, scaleFactor)
  };
}

const COMPACT_POPOUT_BUTTON_WIDTH = 88;
const COMPACT_POPOUT_BUTTON_HEIGHT = 34;
const COMPACT_POPOUT_ROW_GAP = 8;
const COMPACT_POPOUT_SHELL_PADDING = 16;
const COMPACT_SMART_AXIS_WIDTH = 320;
const COMPACT_SMART_AXIS_HEIGHT = 34;

function computeCompactPopoutButtonRowWidth(buttonCount: number): number {
  return Math.max(buttonCount, 1) * COMPACT_POPOUT_BUTTON_WIDTH + COMPACT_POPOUT_SHELL_PADDING;
}

function normalizeProcessToken(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/^"+|"+$/g, "");
  if (!trimmed) {
    return "";
  }
  const fileName = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return fileName.replace(/\.exe$/i, "").toLowerCase();
}

function normalizeProcessPath(value: string | undefined): string {
  return (value ?? "").trim().replace(/\//g, "\\").toLowerCase();
}

function buildOwnerFirstButtonIds(ownerButtonId: string, buttonIds: string[]): string[] {
  return [ownerButtonId, ...buttonIds.filter((buttonId) => buttonId !== ownerButtonId)];
}

async function captureLivePopoutBounds(state: FlowCellState): Promise<FlowCellState> {
  const windows = await getAllWebviewWindows().catch(() => []);
  const openPanelBounds = new Map<string, FlowCellBounds>();
  const existingToolPopoutEntries: Array<[string, ToolPopoutRecord]> = [];
  for (const entry of state.ToolPopouts ?? []) {
    const ownerButtonId = entry.ButtonIds[0];
    if (!ownerButtonId) {
      continue;
    }
    existingToolPopoutEntries.push([
      `${entry.ProgramTabId}:${entry.PanelId}:${ownerButtonId}`,
      entry
    ]);
  }
  const existingToolPopouts = new Map<string, ToolPopoutRecord>(existingToolPopoutEntries);
  const openToolPopouts = new Map<string, ToolPopoutRecord>();

  const parseToolPopoutLabel = (
    label: string
  ): { programId: number; panelId: string; ownerButtonId: string } | null => {
    const match = /^popout-tool-(\d+)-(.+)$/.exec(label);
    if (!match) {
      return null;
    }
    const programId = Number(match[1]);
    const suffix = match[2] ?? "";
    if (!Number.isFinite(programId) || !suffix) {
      return null;
    }

    const program = state.Programs.find((entry) => entry.ProgramTabId === programId);
    if (!program) {
      return null;
    }

    const panelCandidates = [...program.Panels]
      .map((panel) => ({
        panelId: panel.Id,
        panelToken: sanitizeWindowToken(panel.Id),
        ownerIds: [buildPanelFanOwnerId(panel.Id), ...panel.Buttons.map((button) => button.Id)]
      }))
      .sort((left, right) => right.panelToken.length - left.panelToken.length);

    for (const candidate of panelCandidates) {
      const prefix = `${candidate.panelToken}-`;
      if (!suffix.startsWith(prefix)) {
        continue;
      }

      const ownerToken = suffix.slice(prefix.length);
      if (!ownerToken) {
        continue;
      }

      const ownerButtonId =
        candidate.ownerIds.find((entry) => sanitizeWindowToken(entry) === ownerToken) ?? ownerToken;
      return {
        programId,
        panelId: candidate.panelId,
        ownerButtonId
      };
    }

    return null;
  };

  const parsePanelPopoutLabel = (
    label: string
  ): { programId: number; panelId: string } | null => {
    const match = /^popout-panel-(\d+)-(.+)$/.exec(label);
    if (!match) {
      return null;
    }
    const programId = Number(match[1]);
    const panelId = match[2];
    if (!Number.isFinite(programId) || !panelId) {
      return null;
    }
    return {
      programId,
      panelId
    };
  };

  const resolveToolPopoutRecord = (
    programId: number,
    panelId: string,
    ownerButtonId: string,
    bounds: FlowCellBounds
  ): ToolPopoutRecord | null => {
    const panel = findPanel(state, programId, panelId);
    const ownerButton = findButton(state, programId, panelId, ownerButtonId);
    const isPanelFanOwner = ownerButtonId.startsWith("panel-fan-");
    const existing = existingToolPopouts.get(`${programId}:${panelId}:${ownerButtonId}`);
    if (existing) {
      return {
        ...existing,
        LayoutMode: resolveEffectiveToolPopoutLayoutMode(existing.LayoutMode, ownerButton),
        Bounds: bounds
      };
    }

    if (!panel || (!ownerButton && !isPanelFanOwner)) {
      return null;
    }

    const buttonIds = isPanelFanOwner
      ? [ownerButtonId, ...panel.Buttons.map((button) => button.Id)]
      : isSmartAxisOwnerButton(ownerButton!)
      ? buildOwnerFirstButtonIds(
          ownerButtonId,
          panel.Buttons.filter(isSmartAxisButton).map((button) => button.Id)
        )
      : [ownerButtonId];

    return {
      ProgramTabId: programId,
      PanelId: panelId,
      ButtonIds: buttonIds.length > 0 ? buttonIds : [ownerButtonId],
      LayoutMode: isPanelFanOwner
        ? "PanelFan"
        : isSmartAxisOwnerButton(ownerButton!)
          ? "Group"
          : "Individual",
      Bounds: bounds
    };
  };

  for (const window of windows) {
    if (window.label === "main") {
      continue;
    }

    const isVisible = await window.isVisible().catch(() => true);
    if (!isVisible) {
      continue;
    }

    const liveBounds = await readLogicalWindowBounds(window);
    if (!liveBounds) {
      continue;
    }

    const parsedTool =
      window.label.startsWith("popout-tool-") ? parseToolPopoutLabel(window.label) : null;
    let bounds = liveBounds;
    const isPanelFanOwner = parsedTool?.ownerButtonId.startsWith("panel-fan-") ?? false;
    const existingPopoutBounds = parsedTool
      ? existingToolPopouts.get(`${parsedTool.programId}:${parsedTool.panelId}:${parsedTool.ownerButtonId}`)
          ?.Bounds
      : null;
    const liveOwnerButton = parsedTool
      ? findButton(state, parsedTool.programId, parsedTool.panelId, parsedTool.ownerButtonId)
      : undefined;
    const liveLayoutMode = parsedTool
      ? resolveEffectiveToolPopoutLayoutMode(
          existingToolPopouts.get(
            `${parsedTool.programId}:${parsedTool.panelId}:${parsedTool.ownerButtonId}`
          )?.LayoutMode ?? "Individual",
          liveOwnerButton
        )
      : "Individual";
    if (parsedTool && liveLayoutMode === "Fanout") {
      if (existingPopoutBounds && isPersistableFloatingFanoutBounds(existingPopoutBounds)) {
        bounds = resolveCapturedCollapsedFanBounds(liveBounds, existingPopoutBounds);
      }
    } else if (parsedTool && isPanelFanOwner) {
      if (existingPopoutBounds && isPersistablePanelFanBounds(existingPopoutBounds)) {
        bounds = resolveCapturedCollapsedFanBounds(liveBounds, existingPopoutBounds);
      }
    }
    if (
      liveLayoutMode === "Fanout"
        ? !isPersistableFloatingFanoutBounds(bounds)
        : isPanelFanOwner
          ? !isPersistablePanelFanBounds(bounds)
          : !isPersistablePopoutBounds(bounds)
    ) {
      continue;
    }

    if (window.label.startsWith("popout-panel-")) {
      const parsedPanel = parsePanelPopoutLabel(window.label);
      if (parsedPanel) {
        openPanelBounds.set(`${parsedPanel.programId}:${parsedPanel.panelId}`, bounds);
      }
      continue;
    }

    if (!window.label.startsWith("popout-tool-")) {
      continue;
    }

    const parsed = parsedTool;
    if (!parsed) {
      continue;
    }

    const record = resolveToolPopoutRecord(
      parsed.programId,
      parsed.panelId,
      parsed.ownerButtonId,
      bounds
    );
    if (!record) {
      continue;
    }

    openToolPopouts.set(
      `${record.ProgramTabId}:${record.PanelId}:${record.ButtonIds[0]}`,
      record
    );
  }

  return {
      ...state,
      Programs: state.Programs.map((program) => ({
        ...program,
        Panels: program.Panels.map((panel) => ({
          ...panel,
          IsPoppedOut: openPanelBounds.has(`${program.ProgramTabId}:${panel.Id}`),
          PopoutBounds:
            openPanelBounds.get(`${program.ProgramTabId}:${panel.Id}`) ??
            panel.PopoutBounds ??
            null
        }))
      })),
    ToolPopouts: Array.from(openToolPopouts.values())
  };
}

function getProgramTemplateKey(program: FlowCellProgram): string {
  const normalizedName = (program.ProgramConfig?.NormalizedName ?? "").trim().toLowerCase();
  const exePath = (program.ProgramConfig?.ExePath ?? "").trim().toLowerCase();
  const exeName = exePath.split(/[\\/]/).pop() ?? exePath;

  if (normalizedName.includes("blender") || exeName.includes("blender")) {
    return "blender";
  }
  if (normalizedName.includes("illustrator") || exeName.includes("illustrator")) {
    return "illustrator";
  }
  if (normalizedName.includes("photoshop") || exeName.includes("photoshop")) {
    return "photoshop";
  }
  if (normalizedName.includes("windows") || exeName.includes("explorer")) {
    return "windows";
  }
  return "generic";
}

function formatProgramDisplayLabel(
  program: Pick<FlowCellProgram, "ProgramTabId" | "ProgramConfig">
): string {
  return program.ProgramConfig?.NormalizedName?.trim() || `Program ${program.ProgramTabId}`;
}

function formatSavedProgramTimestamp(savedAt: string): string {
  const parsed = new Date(savedAt);
  if (Number.isNaN(parsed.getTime())) {
    return savedAt;
  }
  return parsed.toLocaleString();
}

function buildProgramScriptDialogFilter(program: FlowCellProgram): string {
  const label =
    program.ProgramConfig?.NormalizedName?.trim() || `Program ${program.ProgramTabId}`;
  const allowedExtensions = (program.ProgramConfig?.AllowedScriptExtensions ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (allowedExtensions.length > 0) {
    const filterPattern = allowedExtensions
      .map((value) => (value.startsWith(".") ? `*${value}` : value))
      .join(";");
    return `${label} Scripts (${allowedExtensions.join(";")})|${filterPattern}|All Files (*.*)|*.*`;
  }

  switch (getProgramTemplateKey(program)) {
    case "blender":
      return "Blender Button Sources (*.py;*.ps1)|*.py;*.ps1|All Files (*.*)|*.*";
    case "windows":
      return "Windows Scripts (*.ps1;*.cmd;*.bat;*.exe;*.lnk;*.vbs;*.ahk)|*.ps1;*.cmd;*.bat;*.exe;*.lnk;*.vbs;*.ahk|All Files (*.*)|*.*";
    default:
      return "All Files (*.*)|*.*";
  }
}

function resolveProgramProcessTargets(program: FlowCellProgram): {
  names: string[];
  path: string;
} {
  const config = program.ProgramConfig;
  const names = new Set<string>();
  const configuredPath = normalizeProcessPath(config?.ExePath);

  if (configuredPath) {
    const normalizedFromPath = normalizeProcessToken(configuredPath);
    if (normalizedFromPath) {
      names.add(normalizedFromPath);
    }
  }

  (config?.ProcessNames ?? []).forEach((name) => {
    const normalized = normalizeProcessToken(name);
    if (normalized) {
      names.add(normalized);
    }
  });

  const normalizedName = normalizeProcessToken(config?.NormalizedName);
  const normalizedProgramType = (config?.ProgramType ?? "").trim().toLowerCase();

  if (normalizedName.includes("blender") || normalizedProgramType === "bridge_runner") {
    names.add("blender");
    names.add("blender-launcher");
  }
  if (normalizedName.includes("illustrator")) {
    names.add("illustrator");
  }
  if (normalizedName.includes("photoshop")) {
    names.add("photoshop");
  }

  return {
    names: Array.from(names),
    path: configuredPath
  };
}

function readWindowContextFromLocation(): WindowContext | null {
  const params = new URLSearchParams(window.location.search);
  const rawContext = params.get("flowcellWindowContext");

  if (!rawContext) {
    return null;
  }

  try {
    return JSON.parse(rawContext) as WindowContext;
  } catch {
    return null;
  }
}

export default function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [windowContext, setWindowContext] = useState<WindowContext | null>(null);
  const [state, setState] = useState<FlowCellState | null>(null);
  const [bindingsState, setBindingsState] = useState<FlowCellBindingsState | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>("panel");
  const [selectedButtonRef, setSelectedButtonRef] = useState<SelectedButtonRef | null>(null);
  const [status, setStatus] = useState<CommandResult | null>(null);
  const [frontendEvents, setFrontendEvents] = useState<string[]>([]);
  const [selectedPopButtonIds, setSelectedPopButtonIds] = useState<string[]>([]);
  const [panelFanOptionsDraft, setPanelFanOptionsDraft] = useState<PanelFanOptions | null>(null);
  const [buttonAppearanceButtonId, setButtonAppearanceButtonId] = useState("");
  const [layoutPicker, setLayoutPicker] = useState<LayoutPickerState | null>(null);
  const [programManager, setProgramManager] = useState<ProgramManagerState | null>(null);
  const [macroPicker, setMacroPicker] = useState<MacroPickerState | null>(null);
  const [programContextMenu, setProgramContextMenu] = useState<ProgramContextMenuState | null>(
    null
  );
  const [buttonContextMenu, setButtonContextMenu] = useState<ButtonContextMenuState | null>(null);
  const [popoutContextMenu, setPopoutContextMenu] = useState<PopoutContextMenuState | null>(null);
  const [bindTarget, setBindTarget] = useState<BindTargetState | null>(null);
  const [bindProgramFilter, setBindProgramFilter] = useState("all");
  const [bindShortcutInput, setBindShortcutInput] = useState("");
  const [bindFeedback, setBindFeedback] = useState("Choose a button, script, or macro to bind.");
  const [activeOwnerFanout, setActiveOwnerFanout] = useState<ActiveOwnerFanoutState | null>(null);
  const [spaceDragActive, setSpaceDragActive] = useState(false);
  const [spaceDragInProgress, setSpaceDragInProgress] = useState(false);
  const [floatingFanoutClusterOpen, setFloatingFanoutClusterOpen] = useState(false);
  const [floatingFanoutChildrenVisible, setFloatingFanoutChildrenVisible] = useState(false);
  const [floatingFanoutMetrics, setFloatingFanoutMetrics] =
    useState<FanClusterFloatingMetrics | null>(null);
  const [floatingFanoutWindowMetrics, setFloatingFanoutWindowMetrics] =
    useState<FanClusterFloatingMetrics | null>(null);
  const [panelFanClusterOpen, setPanelFanClusterOpen] = useState(false);
  const [panelFanChildrenVisible, setPanelFanChildrenVisible] = useState(false);
  const [panelFanMetrics, setPanelFanMetrics] = useState<FanClusterPanelMetrics | null>(null);
  const [panelFanWindowMetrics, setPanelFanWindowMetrics] =
    useState<FanClusterPanelMetrics | null>(null);
  const closingWindowRef = useRef(false);
  const activeOwnerFanoutRef = useRef<ActiveOwnerFanoutState | null>(null);
  const ownerFanoutCloseTimerRef = useRef<number | undefined>(undefined);
  const ownerFanoutButtonRefs = useRef(new Map<string, HTMLDivElement>());
  const floatingFanoutCollapsedBoundsRef = useRef<FlowCellBounds | null>(null);
  const floatingFanoutCollapseTimerRef = useRef<number | undefined>(undefined);
  const floatingFanoutProgrammaticResizeRef = useRef(false);
  const floatingFanoutClusterOpenRef = useRef(false);
  const floatingFanoutMetricsRef = useRef<FanClusterFloatingMetrics | null>(null);
  const floatingFanoutWindowMetricsRef = useRef<FanClusterFloatingMetrics | null>(null);
  const floatingFanoutPersistedBoundsKeyRef = useRef<string | null>(null);
  const panelFanCollapsedBoundsRef = useRef<FlowCellBounds | null>(null);
  const panelFanCollapseTimerRef = useRef<number | undefined>(undefined);
  const panelFanProgrammaticResizeRef = useRef(false);
  const panelFanPersistedBoundsKeyRef = useRef<string | null>(null);
  const panelFanClusterOpenRef = useRef(false);
  const panelFanMetricsRef = useRef<FanClusterPanelMetrics | null>(null);
  const panelFanWindowMetricsRef = useRef<FanClusterPanelMetrics | null>(null);
  const transparentFanoutIgnoreCursorRef = useRef<boolean | null>(null);
  const startupPanelRestoreRef = useRef(false);
  const startupToolRestoreRef = useRef(false);
  const toolPopoutAutoFitKeyRef = useRef<string | null>(null);
  const programmaticWindowPlacementUntilRef = useRef(0);
  const layoutLoadInFlightRef = useRef(false);

  floatingFanoutClusterOpenRef.current = floatingFanoutClusterOpen;
  floatingFanoutMetricsRef.current = floatingFanoutMetrics;
  floatingFanoutWindowMetricsRef.current = floatingFanoutWindowMetrics;
  panelFanClusterOpenRef.current = panelFanClusterOpen;
  panelFanMetricsRef.current = panelFanMetrics;
  panelFanWindowMetricsRef.current = panelFanWindowMetrics;

  const markProgrammaticWindowPlacement = (suppressMs = 900) => {
    programmaticWindowPlacementUntilRef.current = Math.max(
      programmaticWindowPlacementUntilRef.current,
      Date.now() + suppressMs
    );
  };

  const isProgrammaticWindowPlacementActive = () =>
    Date.now() < programmaticWindowPlacementUntilRef.current;

  const hydrateLoadedState = async (
    payload: LoadStateResponse,
    context: WindowContext,
    options?: { captureLiveBounds?: boolean }
  ): Promise<FlowCellState> => {
    const normalizedState = applyBindingsToState(
      ensureStateDefaults(payload.state),
      payload.bindings
    );
    const nextState =
      context.kind === "main" && options?.captureLiveBounds !== false
        ? await captureLivePopoutBounds(normalizedState)
        : normalizedState;
    setWindowContext(context);
    setRuntime(payload.runtime);
    setBindingsState(payload.bindings);
    setState(nextState);
    return nextState;
  };

  useEffect(() => {
    const boot = async () => {
      const locationContext = readWindowContextFromLocation();
      const [context, loaded] = await Promise.all([
        locationContext ? Promise.resolve(locationContext) : getWindowContext(),
        loadState()
      ]);
      const payload = loaded as LoadStateResponse;
      const nextState = await hydrateLoadedState(payload, context);
      if (context.kind === "main") {
        void saveState(nextState, { broadcast: false }).catch(() => {});
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (windowContext?.kind !== "layout-picker") {
      return;
    }

    let cancelled = false;
    void (async () => {
      const files = await listLayoutFiles();
      if (cancelled) {
        return;
      }
      setLayoutPicker({
        files,
        selectedPath: files[0]?.path ?? ""
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [windowContext]);

  useEffect(() => {
    if (!windowContext || windowContext.kind !== "main") {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const currentWindowLabel = getCurrentWindow().label;

    void (async () => {
      unlisten = await listenForStateSync(async (sourceWindowLabel) => {
        if (disposed || sourceWindowLabel === currentWindowLabel) {
          return;
        }
        const payload = await loadState();
        if (disposed) {
          return;
        }
        setRuntime(payload.runtime);
        setBindingsState(payload.bindings);
        setState(applyBindingsToState(ensureStateDefaults(payload.state), payload.bindings));
      });
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [windowContext]);

  useEffect(() => {
    if (!windowContext || windowContext.kind === "main") {
      return;
    }

    let unlisten: (() => void) | undefined;
    const currentWindowLabel = getCurrentWindow().label;

    void (async () => {
      unlisten = await listenForProgrammaticWindowPlacement((payload) => {
        if (payload.label !== currentWindowLabel) {
          return;
        }
        markProgrammaticWindowPlacement(payload.suppressMs ?? 900);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [windowContext]);

  const selectedProgram =
    state && windowContext?.kind !== "main" && windowContext?.programId
      ? findProgram(state, windowContext.programId)
      : state
        ? getSelectedProgram(state)
        : undefined;

  const selectedPanel =
    selectedProgram && state && windowContext?.kind !== "main" && windowContext?.panelId
      ? findPanel(state, selectedProgram.ProgramTabId, windowContext.panelId)
      : selectedProgram
        ? getSelectedPanel(selectedProgram)
        : undefined;
  const hasWorkspaceSelection = Boolean(selectedProgram && selectedPanel);
  const savedPrograms = useMemo<SavedProgramRecord[]>(
    () =>
      [...(state?.SavedPrograms ?? [])].sort((left, right) =>
        (right.SavedAt ?? "").localeCompare(left.SavedAt ?? "")
      ),
    [state?.SavedPrograms]
  );
  const selectedSavedProgram = programManager
    ? savedPrograms.find(
        (record) => record.SourceProgramTabId === programManager.selectedSavedProgramId
      ) ?? savedPrograms[0]
    : undefined;
  const selectedSavedProgramInUse = Boolean(
    selectedSavedProgram &&
      state?.Programs.some(
        (program) => program.ProgramTabId === selectedSavedProgram.SourceProgramTabId
      )
  );

  const activeToolPopout =
    state &&
    selectedProgram &&
    selectedPanel &&
    windowContext?.kind === "tool-popout" &&
    windowContext?.ownerButtonId
      ? findToolPopoutByOwner(
          state,
          selectedProgram.ProgramTabId,
          selectedPanel.Id,
          windowContext.ownerButtonId
        )
      : undefined;

  const rawToolPopoutLayoutMode =
    activeToolPopout?.LayoutMode ?? windowContext?.layoutMode ?? "Individual";
  const isSlimPopoutWindow =
    windowContext?.kind === "panel-popout" ||
    windowContext?.kind === "tool-popout" ||
    windowContext?.kind === "panel-fan-options" ||
    windowContext?.kind === "button-appearance" ||
    windowContext?.kind === "layout-picker";
  const toolPopoutButtons =
    state && selectedProgram && selectedPanel && windowContext?.kind === "tool-popout"
      ? rawToolPopoutLayoutMode === "PanelFan"
        ? selectedPanel.Buttons
        : activeToolPopout
          ? getToolPopoutButtons(state, activeToolPopout)
          : (windowContext.buttonIds ?? [])
              .map((buttonId) =>
                findButton(state, selectedProgram.ProgramTabId, selectedPanel.Id, buttonId)
              )
              .filter((button): button is FlowCellButton => Boolean(button))
      : [];
  const toolPopoutOwnerButton =
    toolPopoutButtons.find((button) => button.Id === windowContext?.ownerButtonId) ??
    toolPopoutButtons[0];
  const toolPopoutLayoutMode = resolveEffectiveToolPopoutLayoutMode(
    rawToolPopoutLayoutMode,
    toolPopoutOwnerButton
  );
  const isFloatingFanoutPopout =
    windowContext?.kind === "tool-popout" && toolPopoutLayoutMode === "Fanout";
  const isPanelFanPopout =
    windowContext?.kind === "tool-popout" && toolPopoutLayoutMode === "PanelFan";

  const selectedButton =
    state && selectedButtonRef
      ? findButton(
          state,
          selectedButtonRef.programId,
          selectedButtonRef.panelId,
          selectedButtonRef.buttonId
        )
      : undefined;
  const contextMenuButton =
    state && selectedProgram && selectedPanel && buttonContextMenu
      ? findButton(
          state,
          selectedProgram.ProgramTabId,
          selectedPanel.Id,
          buttonContextMenu.buttonId
        )
      : undefined;
  const contextMenuProgram =
    state && programContextMenu ? findProgram(state, programContextMenu.programId) : undefined;

  const isToolSetPanelSelection = isBlenderToolSetPanel(
    selectedProgram ?? null,
    selectedPanel ?? null
  );
  const collapseSmartAxisToOwnerButton =
    windowContext?.kind === "main" && isToolSetPanelSelection;
  const panelRenderItems = selectedPanel
    ? buildPanelRenderItems(selectedPanel.Buttons, {
        collapseSmartAxisToOwnerButton
      })
    : [];
  const regularPanelRenderItemCount = panelRenderItems.filter((item) => item.kind === "button").length;
  const hasCompactSmartAxisPanelRow = panelRenderItems.some((item) => item.kind === "smart-axis");
  const selectedPopButtons = selectedPanel
    ? selectedPanel.Buttons.filter((button) => selectedPopButtonIds.includes(button.Id))
    : [];
  const selectedRegularButtons = selectedPopButtons.filter((button) => isRegularPopCandidate(button));
  const selectedToolOwnerButtons = selectedPopButtons.filter((button) =>
    isToolOwnerPopCandidate(button)
  );
  const selectedPanelButtonForAppearance =
    selectedButtonRef &&
    selectedButtonRef.programId === selectedProgram?.ProgramTabId &&
    selectedButtonRef.panelId === selectedPanel?.Id
      ? selectedPanel?.Buttons.find((button) => button.Id === selectedButtonRef.buttonId)
      : undefined;
  const buttonAppearanceButtons = isToolSetPanelSelection ? [] : selectedPanel?.Buttons ?? [];
  const buttonAppearanceSelectionIsAll =
    buttonAppearanceButtonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID;
  const buttonAppearanceTargetButton = buttonAppearanceSelectionIsAll
    ? buttonAppearanceButtons[0]
    : buttonAppearanceButtons.find((button) => button.Id === buttonAppearanceButtonId) ??
      selectedPanelButtonForAppearance ??
      buttonAppearanceButtons[0];
  const allButtons = state ? collectAllButtons(state) : [];
  const programOptions = state
    ? state.Programs.map((program) => ({
        id: program.ProgramTabId,
        label:
          program.ProgramConfig?.NormalizedName?.trim() || `Program ${program.ProgramTabId}`,
        scriptFolder: program.ProgramConfig?.ScriptFolder
      }))
    : [];
  const findScriptBindingForTarget = (target: string, programId: number) =>
    bindingsState?.scriptBindings.find(
      (binding) =>
        binding.target === target &&
        ((binding.programTabId ?? 0) === programId || (binding.programTabId ?? 0) <= 0)
    ) ?? null;
  const refreshBindTargetState = (
    targetState: BindTargetState,
    nextBindings: FlowCellBindingsState | null = bindingsState,
    nextState: FlowCellState | null = state
  ): BindTargetState => {
    if (targetState.source === "workspace" && nextState) {
      const matchedButton = findButton(
        nextState,
        targetState.programId,
        targetState.panelId ?? "",
        targetState.button.Id
      );
      if (matchedButton) {
        return {
          ...targetState,
          button: matchedButton
        };
      }
    }

    if (!nextBindings) {
      return targetState;
    }

    if (targetState.button.Kind === "macro") {
      const shortcut = nextBindings.actionHotkeys[targetState.button.Target?.trim() ?? ""] ?? "";
      return {
        ...targetState,
        button: {
          ...targetState.button,
          Shortcut: shortcut,
          BindingId: 0
        }
      };
    }

    if (targetState.button.Kind !== "script") {
      return targetState;
    }

    const binding = findScriptBindingForTarget(
      targetState.button.Target?.trim() ?? "",
      targetState.programId
    );
    return {
      ...targetState,
      button: {
        ...targetState.button,
        Shortcut: binding?.shortcut ?? "",
        BindingId: binding ? getButtonBindingNumericId(binding) : 0
      }
    };
  };
  const currentBindTarget = bindTarget ? refreshBindTargetState(bindTarget) : null;
  const currentBindShortcut = currentBindTarget?.button.Shortcut?.trim() ?? "";
  const parsedBindShortcut = parseShortcutInput(bindShortcutInput);
  const bindUsedShortcuts = useMemo(
    () => buildUsedShortcutMap(bindingsState, currentBindShortcut),
    [bindingsState, currentBindShortcut]
  );
  const bindAvailableShortcuts = useMemo(
    () => buildAvailableCandidateShortcuts(bindingsState, parsedBindShortcut || currentBindShortcut),
    [bindingsState, currentBindShortcut, parsedBindShortcut]
  );
  const bindConflict =
    parsedBindShortcut.length > 0 && bindUsedShortcuts.has(normalizeShortcut(parsedBindShortcut));
  const bindFilterProgramId =
    bindProgramFilter === "all" ? 0 : Number.parseInt(bindProgramFilter, 10) || 0;
  const bindListItems = useMemo<BindListItem[]>(() => {
    if (!state || !bindingsState) {
      return [];
    }

    const programLabelById = new Map(
      state.Programs.map((program) => [
        program.ProgramTabId,
        program.ProgramConfig?.NormalizedName?.trim() || `Program ${program.ProgramTabId}`
      ])
    );
    const buttonEntries = collectAllButtons(state);
    const items: BindListItem[] = [];

    bindingsState.scriptBindings.forEach((binding) => {
      const programId = binding.programTabId ?? 0;
      if (bindFilterProgramId > 0 && programId > 0 && programId !== bindFilterProgramId) {
        return;
      }
      if (bindFilterProgramId > 0 && programId <= 0) {
        return;
      }

      const matchedButton =
        buttonEntries.find(
          (entry) =>
            entry.programId === programId &&
            entry.button.Kind === "script" &&
            entry.button.Target === binding.target
        ) ??
        buttonEntries.find(
          (entry) => entry.button.Kind === "script" && entry.button.Target === binding.target
        );
      const button =
        matchedButton?.button ??
        ({
          ...buildDirectScriptBindButton(binding.target),
          Shortcut: binding.shortcut,
          BindingId: getButtonBindingNumericId(binding)
        } satisfies FlowCellButton);
      items.push({
        id: `script:${programId}:${binding.target}`,
        button: {
          ...button,
          Shortcut: binding.shortcut,
          BindingId: getButtonBindingNumericId(binding)
        },
        programId: matchedButton?.programId ?? programId,
        panelId: matchedButton?.panelId,
        programLabel:
          programLabelById.get(matchedButton?.programId ?? programId) ??
          (programId > 0 ? `Program ${programId}` : "Global"),
        label: matchedButton?.button.Label ?? labelFromTargetPath(binding.target),
        target: binding.target,
        shortcut: binding.shortcut,
        source: matchedButton ? "workspace" : "workspace"
      });
    });

    Object.entries(bindingsState.actionHotkeys).forEach(([actionId, shortcut]) => {
      const matchedButton = buttonEntries.find(
        (entry) => entry.button.Kind === "macro" && entry.button.Target === actionId
      );
      if (bindFilterProgramId > 0 && matchedButton?.programId !== bindFilterProgramId) {
        return;
      }
      if (bindFilterProgramId > 0 && !matchedButton) {
        return;
      }

      const button =
        matchedButton?.button ??
        ({
          Id: `macro_bind_${actionId}`,
          Kind: "macro",
          command_id: "flowcell.run_macro",
          Label: actionId,
          Target: actionId,
          Shortcut: shortcut,
          BindingId: 0,
          style_group_id: ""
        } satisfies FlowCellButton);
      items.push({
        id: `macro:${actionId}`,
        button: {
          ...button,
          Shortcut: shortcut,
          BindingId: 0
        },
        programId: matchedButton?.programId ?? 0,
        panelId: matchedButton?.panelId,
        programLabel:
          matchedButton?.programId
            ? programLabelById.get(matchedButton.programId) ?? `Program ${matchedButton.programId}`
            : "Global",
        label: matchedButton?.button.Label ?? actionId,
        target: actionId,
        shortcut,
        source: "macro"
      });
    });

    return items.sort((left, right) => {
      if (left.programLabel !== right.programLabel) {
        return left.programLabel.localeCompare(right.programLabel);
      }
      return left.label.localeCompare(right.label);
    });
  }, [bindFilterProgramId, bindingsState, state]);
  const resolveFanoutChildEntries = (
    programId: number,
    panelId: string,
    childButtonIds: string[]
  ): FanClusterEntry[] =>
    childButtonIds
      .map((buttonId) =>
        allButtons.find(
          (entry) =>
            entry.programId === programId &&
            entry.panelId === panelId &&
            entry.button.Id === buttonId
        )
      )
      .filter(
        (
          entry
        ): entry is {
          programId: number;
          panelId: string;
          panelName: string;
          button: FlowCellButton;
        } => Boolean(entry)
      )
      .map((entry, index) => ({
        programId: entry.programId,
        panelId: entry.panelId,
        panelName: entry.panelName,
        button: entry.button,
        childSlotId: buildChildSlotId(entry.button, index)
      }));

  useEffect(() => {
    if (windowContext?.kind !== "panel-fan-options" || !selectedPanel) {
      setPanelFanOptionsDraft(null);
      return;
    }

    setPanelFanOptionsDraft({
      ...(selectedPanel.FanOptions ?? DEFAULT_PANEL_FAN_OPTIONS)
    });
  }, [selectedPanel?.Id, windowContext?.kind]);

  useEffect(() => {
    if (windowContext?.kind !== "button-appearance" || !selectedPanel) {
      setButtonAppearanceButtonId("");
      return;
    }

    const candidateIds = selectedPanel.Buttons.map((button) => button.Id);
    if (candidateIds.length === 0) {
      setButtonAppearanceButtonId("");
      return;
    }

    const requestedButtonId = windowContext.buttonId ?? "";
    const selectableIds = [BUTTON_APPEARANCE_ALL_BUTTONS_ID, ...candidateIds];
    setButtonAppearanceButtonId((current) => {
      if (current && selectableIds.includes(current)) {
        return current;
      }
      if (requestedButtonId && candidateIds.includes(requestedButtonId)) {
        return requestedButtonId;
      }
      return candidateIds[0];
    });
  }, [selectedPanel, windowContext?.buttonId, windowContext?.kind]);

  useEffect(() => {
    if (!isFloatingFanoutPopout || !selectedProgram || !selectedPanel || !windowContext?.ownerButtonId) {
      return;
    }

    const surface = inferSurfaceName(windowContext);
    if (!toolPopoutOwnerButton) {
      pushFrontendEvent(
        surface,
        `Floating fanout missing owner. Program=${selectedProgram.ProgramTabId}; Panel=${selectedPanel.Id}; Owner=${windowContext.ownerButtonId}`
      );
      return;
    }

    const assignedChildIds = toolPopoutOwnerButton.fanout?.child_button_ids ?? [];
    if (assignedChildIds.length === 0) {
      pushFrontendEvent(surface, `Floating fanout missing child assignment. Owner=${toolPopoutOwnerButton.Id}`);
      return;
    }

    const resolvedChildren = resolveFanoutChildEntries(
      selectedProgram.ProgramTabId,
      selectedPanel.Id,
      assignedChildIds
    );
    if (resolvedChildren.length !== assignedChildIds.length) {
      pushFrontendEvent(
        surface,
        `Floating fanout blocked or invalid child target. Owner=${toolPopoutOwnerButton.Id}; Assigned=${assignedChildIds.length}; Resolved=${resolvedChildren.length}`
      );
    }
  }, [
    isFloatingFanoutPopout,
    selectedPanel,
    selectedProgram,
    toolPopoutOwnerButton,
    windowContext?.ownerButtonId
  ]);
  const activeOwnerFanoutDetails = useMemo(() => {
    if (
      !state ||
      !selectedProgram ||
      !selectedPanel ||
      !activeOwnerFanout ||
      windowContext?.kind !== "main" ||
      activeOwnerFanout.programId !== selectedProgram.ProgramTabId ||
      activeOwnerFanout.panelId !== selectedPanel.Id
    ) {
      return null;
    }

    const ownerButton = findButton(
      state,
      activeOwnerFanout.programId,
      activeOwnerFanout.panelId,
      activeOwnerFanout.ownerButtonId
    );
    if (!ownerButton) {
      return null;
    }

    const childEntries =
      ownerButton.fanout?.child_button_ids?.length
        ? resolveFanoutChildEntries(
            activeOwnerFanout.programId,
            activeOwnerFanout.panelId,
            ownerButton.fanout.child_button_ids
          )
        : [];

    return {
      ownerButton,
      childEntries,
      layout: ownerButton.fanout?.layout ?? "row"
    };
  }, [
    activeOwnerFanout,
    selectedPanel?.Id,
    selectedProgram?.ProgramTabId,
    state,
    windowContext?.kind
  ]);

  useEffect(() => {
    activeOwnerFanoutRef.current = activeOwnerFanout;
  }, [activeOwnerFanout]);

  useEffect(() => {
    return () => {
      if (ownerFanoutCloseTimerRef.current) {
        window.clearTimeout(ownerFanoutCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isFloatingFanoutPopout) {
      setFloatingFanoutClusterOpen(false);
      setFloatingFanoutChildrenVisible(false);
      setFloatingFanoutMetrics(null);
      setFloatingFanoutWindowMetrics(null);
      if (floatingFanoutCollapseTimerRef.current) {
        window.clearTimeout(floatingFanoutCollapseTimerRef.current);
        floatingFanoutCollapseTimerRef.current = undefined;
      }
      floatingFanoutCollapsedBoundsRef.current = null;
      floatingFanoutProgrammaticResizeRef.current = false;
      floatingFanoutPersistedBoundsKeyRef.current = null;
      transparentFanoutIgnoreCursorRef.current = null;
      return;
    }

    const currentWindow = getCurrentWindow();
    let cancelled = false;

    void (async () => {
      const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
      const [position, size] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.innerSize().catch(() => null)
      ]);
      if (cancelled || !position || !size) {
        return;
      }
      floatingFanoutCollapsedBoundsRef.current = {
        Left: normalizeLogicalValue(position.x / scaleFactor, scaleFactor),
        Top: normalizeLogicalValue(position.y / scaleFactor, scaleFactor),
        Width: normalizeLogicalValue(size.width / scaleFactor, scaleFactor),
        Height: normalizeLogicalValue(size.height / scaleFactor, scaleFactor)
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [isFloatingFanoutPopout]);

  useEffect(() => {
    if (!isPanelFanPopout) {
      setPanelFanClusterOpen(false);
      setPanelFanChildrenVisible(false);
      setPanelFanMetrics(null);
      setPanelFanWindowMetrics(null);
      if (panelFanCollapseTimerRef.current) {
        window.clearTimeout(panelFanCollapseTimerRef.current);
        panelFanCollapseTimerRef.current = undefined;
      }
      panelFanCollapsedBoundsRef.current = null;
      panelFanProgrammaticResizeRef.current = false;
      panelFanPersistedBoundsKeyRef.current = null;
      transparentFanoutIgnoreCursorRef.current = null;
    }
  }, [isPanelFanPopout]);

  useEffect(() => {
    if (!isPanelFanPopout) {
      return;
    }

    const currentWindow = getCurrentWindow();
    let cancelled = false;

    void (async () => {
      const scaleFactor = await currentWindow.scaleFactor().catch(() => 1);
      const [position, size] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.innerSize().catch(() => null)
      ]);
      if (cancelled || !position || !size) {
        return;
      }
      panelFanCollapsedBoundsRef.current = {
        Left: normalizeLogicalValue(position.x / scaleFactor, scaleFactor),
        Top: normalizeLogicalValue(position.y / scaleFactor, scaleFactor),
        Width: normalizeLogicalValue(size.width / scaleFactor, scaleFactor),
        Height: normalizeLogicalValue(size.height / scaleFactor, scaleFactor)
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [isPanelFanPopout]);

  useEffect(() => {
    if (!isFloatingFanoutPopout || !floatingFanoutMetrics || spaceDragInProgress) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const surface = inferSurfaceName(windowContext ?? { kind: "main" });
    let cancelled = false;

    const syncFloatingFanoutWindow = async () => {
      const currentBounds = await readLogicalWindowBounds(currentWindow);
      if (cancelled || !currentBounds) {
        return;
      }
      const liveFloatingMetrics = floatingFanoutWindowMetricsRef.current ?? floatingFanoutMetrics;
      const persistedCollapsedBounds =
        floatingFanoutCollapsedBoundsRef.current ??
        deriveCollapsedAnchoredBounds({
          windowBounds: currentBounds,
          metrics: liveFloatingMetrics,
          open: floatingFanoutClusterOpen
        });
      const collapsedBounds = clampBoundsToWorkArea({
        Left: persistedCollapsedBounds.Left,
        Top: persistedCollapsedBounds.Top,
        Width: floatingFanoutMetrics.ownerWidth,
        Height: floatingFanoutMetrics.ownerHeight
      });
      floatingFanoutCollapsedBoundsRef.current = collapsedBounds;
      const fittedMetrics = fitAnchoredMetricsToWorkArea(collapsedBounds, floatingFanoutMetrics);
      setFloatingFanoutWindowMetrics((current) =>
        areAnchoredMetricsEqual(current, fittedMetrics) ? current : fittedMetrics
      );

      const targetBounds = floatingFanoutClusterOpen
        ? deriveExpandedAnchoredBounds(collapsedBounds, fittedMetrics)
        : collapsedBounds;
      const currentMatchesTarget = areBoundsEqual(currentBounds, targetBounds);

      if (currentMatchesTarget) {
        if (floatingFanoutClusterOpen) {
          setFloatingFanoutChildrenVisible(true);
        } else {
          setFloatingFanoutChildrenVisible(false);
        }
        await persistCollapsedToolPopoutBounds(
          windowContext?.ownerButtonId ?? "",
          collapsedBounds,
          "Fanout",
          floatingFanoutPersistedBoundsKeyRef
        ).catch(() => {});
        return;
      }

      if (floatingFanoutClusterOpen) {
        pushFrontendEvent(
          surface,
          `Floating fanout open. Direction=${fittedMetrics.direction}; ExpandedBounds=${Math.round(targetBounds.Left)},${Math.round(targetBounds.Top)},${Math.round(targetBounds.Width)}x${Math.round(targetBounds.Height)}`
        );
      }

      floatingFanoutProgrammaticResizeRef.current = true;
      try {
        await applyAnchoredWindowBounds(currentWindow, currentBounds, targetBounds);
      } finally {
        window.setTimeout(() => {
          floatingFanoutProgrammaticResizeRef.current = false;
        }, 120);
      }

      if (cancelled) {
        return;
      }

      if (floatingFanoutClusterOpen) {
        setFloatingFanoutChildrenVisible(true);
      } else {
        setFloatingFanoutChildrenVisible(false);
      }

      if (!floatingFanoutClusterOpen) {
        pushFrontendEvent(
          surface,
          `Floating fanout collapsed. RestoredBounds=${Math.round(collapsedBounds.Left)},${Math.round(collapsedBounds.Top)},${Math.round(collapsedBounds.Width)}x${Math.round(collapsedBounds.Height)}`
        );
      }

      await persistCollapsedToolPopoutBounds(
        windowContext?.ownerButtonId ?? "",
        collapsedBounds,
        "Fanout",
        floatingFanoutPersistedBoundsKeyRef
      ).catch((error) => {
        pushFrontendEvent(
          surface,
          `Floating fanout collapsed-bounds save failed. ${error instanceof Error ? error.message : String(error)}`
        );
      });
    };

    void syncFloatingFanoutWindow();

    return () => {
      cancelled = true;
    };
  }, [
    floatingFanoutClusterOpen,
    floatingFanoutChildrenVisible,
    floatingFanoutMetrics,
    isFloatingFanoutPopout,
    spaceDragInProgress,
    windowContext
  ]);

  useEffect(() => {
    if (!isPanelFanPopout || !panelFanMetrics || spaceDragInProgress) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const surface = inferSurfaceName(windowContext ?? { kind: "main" });
    let cancelled = false;

    const syncPanelFanWindow = async () => {
      if (panelFanProgrammaticResizeRef.current) {
        return;
      }

      const currentBounds = await readLogicalWindowBounds(currentWindow);
      if (cancelled || !currentBounds) {
        return;
      }
      const livePanelMetrics = panelFanWindowMetricsRef.current ?? panelFanMetrics;
      const persistedCollapsedBounds =
        panelFanCollapsedBoundsRef.current ??
        deriveCollapsedAnchoredBounds({
          windowBounds: currentBounds,
          metrics: livePanelMetrics,
          open: panelFanClusterOpen
        });
      const collapsedBounds = clampBoundsToWorkArea({
        Left: persistedCollapsedBounds.Left,
        Top: persistedCollapsedBounds.Top,
        Width: panelFanMetrics.ownerWidth,
        Height: panelFanMetrics.ownerHeight
      });
      panelFanCollapsedBoundsRef.current = collapsedBounds;
      const fittedMetrics = fitAnchoredMetricsToWorkArea(collapsedBounds, panelFanMetrics);
      setPanelFanWindowMetrics((current) =>
        areAnchoredMetricsEqual(current, fittedMetrics) ? current : fittedMetrics
      );

      const targetBounds = panelFanClusterOpen
        ? deriveExpandedAnchoredBounds(collapsedBounds, fittedMetrics)
        : collapsedBounds;
      const currentMatchesTarget = areBoundsEqual(currentBounds, targetBounds);

      if (currentMatchesTarget) {
        if (panelFanClusterOpen) {
          setPanelFanChildrenVisible(true);
        } else {
          setPanelFanChildrenVisible(false);
        }
        await persistCollapsedToolPopoutBounds(
          windowContext?.ownerButtonId ?? "",
          collapsedBounds,
          "PanelFan",
          panelFanPersistedBoundsKeyRef
        ).catch(() => {});
        return;
      }

      if (panelFanClusterOpen) {
        pushFrontendEvent(
          surface,
          `Panel fan open. ExpandedBounds=${Math.round(targetBounds.Left)},${Math.round(targetBounds.Top)},${Math.round(targetBounds.Width)}x${Math.round(targetBounds.Height)}`
        );
      }

      panelFanProgrammaticResizeRef.current = true;
      try {
        await applyAnchoredWindowBounds(currentWindow, currentBounds, targetBounds);
      } finally {
        window.setTimeout(() => {
          panelFanProgrammaticResizeRef.current = false;
        }, 120);
      }

      if (cancelled) {
        return;
      }

      if (panelFanClusterOpen) {
        setPanelFanChildrenVisible(true);
      } else {
        setPanelFanChildrenVisible(false);
      }

      if (!panelFanClusterOpen) {
        pushFrontendEvent(
          surface,
          `Panel fan collapsed. RestoredBounds=${Math.round(collapsedBounds.Left)},${Math.round(collapsedBounds.Top)},${Math.round(collapsedBounds.Width)}x${Math.round(collapsedBounds.Height)}`
        );
      }

      await persistCollapsedToolPopoutBounds(
        windowContext?.ownerButtonId ?? "",
        collapsedBounds,
        "PanelFan",
        panelFanPersistedBoundsKeyRef
      ).catch((error) => {
        pushFrontendEvent(
          surface,
          `Panel fan collapsed-bounds save failed. ${error instanceof Error ? error.message : String(error)}`
        );
      });
    };

    void syncPanelFanWindow();

    return () => {
      cancelled = true;
    };
  }, [
    isPanelFanPopout,
    panelFanClusterOpen,
    panelFanChildrenVisible,
    panelFanMetrics,
    spaceDragInProgress,
    windowContext
  ]);

  useEffect(() => {
    const activeMetrics = isFloatingFanoutPopout
      ? floatingFanoutWindowMetrics ?? floatingFanoutMetrics
      : isPanelFanPopout
        ? panelFanWindowMetrics ?? panelFanMetrics
        : null;
    if (!activeMetrics) {
      transparentFanoutIgnoreCursorRef.current = null;
      return;
    }

    const currentWindow = getCurrentWindow();
    const surface = inferSurfaceName(windowContext ?? { kind: "main" });
    let cancelled = false;
    let timer: number | undefined;
    let ignoreCursorUnavailable = false;

    const syncIgnoreCursorEvents = async () => {
      if (cancelled || ignoreCursorUnavailable) {
        return;
      }

      const setIgnoreCursorEvents = async (ignore: boolean) => {
        if (transparentFanoutIgnoreCursorRef.current === ignore) {
          return;
        }
        try {
          await currentWindow.setIgnoreCursorEvents(ignore);
          transparentFanoutIgnoreCursorRef.current = ignore;
        } catch (error) {
          ignoreCursorUnavailable = true;
          transparentFanoutIgnoreCursorRef.current = null;
          pushFrontendEvent(
            surface,
            `Transparent fanout cursor-ignore update failed. ${error instanceof Error ? error.message : String(error)}`
          );
        }
      };

      if (spaceDragActive || spaceDragInProgress) {
        await setIgnoreCursorEvents(false);
        return;
      }

      const collapsedBounds = isFloatingFanoutPopout
        ? floatingFanoutCollapsedBoundsRef.current
        : panelFanCollapsedBoundsRef.current;
      if (!collapsedBounds) {
        await setIgnoreCursorEvents(false);
        return;
      }

      const [scaleFactor, pointer] = await Promise.all([
        currentWindow.scaleFactor().catch(() => 1),
        cursorPosition().catch(() => null)
      ]);
      if (cancelled || !pointer) {
        return;
      }

      const interactiveRects = buildAnchoredInteractiveRects({
        collapsedBounds,
        metrics: activeMetrics,
        open: isFloatingFanoutPopout
          ? floatingFanoutChildrenVisible
          : panelFanChildrenVisible
      });
      const hitInteractivePill = interactiveRects.some((rect) => {
        const scaledRect = inflateRect(
          {
            left: rect.left * scaleFactor,
            top: rect.top * scaleFactor,
            right: rect.right * scaleFactor,
            bottom: rect.bottom * scaleFactor
          },
          6
        );
        return screenRectContains(scaledRect, pointer.x, pointer.y);
      });

      await setIgnoreCursorEvents(!hitInteractivePill);
    };

    void syncIgnoreCursorEvents();
    timer = window.setInterval(() => {
      void syncIgnoreCursorEvents();
    }, 32);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
      transparentFanoutIgnoreCursorRef.current = null;
      void currentWindow.setIgnoreCursorEvents(false).catch(() => {});
    };
  }, [
    floatingFanoutClusterOpen,
    floatingFanoutChildrenVisible,
    floatingFanoutMetrics,
    floatingFanoutWindowMetrics,
    isFloatingFanoutPopout,
    isPanelFanPopout,
    panelFanClusterOpen,
    panelFanChildrenVisible,
    panelFanMetrics,
    panelFanWindowMetrics,
    spaceDragActive,
    spaceDragInProgress,
    windowContext
  ]);

  useEffect(() => {
    if (!isSlimPopoutWindow) {
      setSpaceDragActive(false);
      setSpaceDragInProgress(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      setSpaceDragActive(true);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") {
        return;
      }
      event.preventDefault();
      setSpaceDragActive(false);
      setSpaceDragInProgress(false);
    };

    const handleBlur = () => {
      setSpaceDragActive(false);
      setSpaceDragInProgress(false);
    };

    const handlePointerUp = () => {
      setSpaceDragInProgress(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isSlimPopoutWindow]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const previousHtmlBackground = html.style.background;
    const previousBodyBackground = body.style.background;
    const previousRootBackground = root?.style.background ?? "";

    if (isPanelFanPopout || isFloatingFanoutPopout) {
      html.style.background = "transparent";
      body.style.background = "transparent";
      if (root) {
        root.style.background = "transparent";
      }
    }

    return () => {
      html.style.background = previousHtmlBackground;
      body.style.background = previousBodyBackground;
      if (root) {
        root.style.background = previousRootBackground;
      }
    };
  }, [isFloatingFanoutPopout, isPanelFanPopout]);

  useEffect(() => {
    if (!isFloatingFanoutPopout) {
      return;
    }

    const surface = inferSurfaceName(windowContext);
    const currentWindow = getCurrentWindow() as unknown as {
      setShadow?: (enabled: boolean) => Promise<void>;
    };

    if (typeof currentWindow.setShadow === "function") {
      void currentWindow.setShadow(false).catch((error) => {
        pushFrontendEvent(
          surface,
          `Floating fanout shadow fallback detected. ${error instanceof Error ? error.message : String(error)}`
        );
      });
    } else {
      pushFrontendEvent(surface, "Floating fanout shadow fallback detected. setShadow unavailable.");
    }

    window.requestAnimationFrame(() => {
      const root = document.getElementById("root");
      const htmlStyle = window.getComputedStyle(document.documentElement);
      const bodyStyle = window.getComputedStyle(document.body);
      const rootStyle = root ? window.getComputedStyle(root) : null;
      const backgrounds = [
        htmlStyle.backgroundColor,
        bodyStyle.backgroundColor,
        rootStyle?.backgroundColor ?? "transparent"
      ];
      const nonTransparent = backgrounds.some(
        (value) => value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent"
      );
      if (nonTransparent) {
        pushFrontendEvent(
          surface,
          `Floating fanout nontransparent background fallback detected. html=${backgrounds[0]}; body=${backgrounds[1]}; root=${backgrounds[2]}`
        );
      }
    });
  }, [isFloatingFanoutPopout, windowContext]);

  useEffect(() => {
    if (!windowContext) {
      return;
    }

    setSelectedPopButtonIds([]);
  }, [selectedProgram?.ProgramTabId, selectedPanel?.Id, windowContext?.kind]);

  useEffect(() => {
    if (windowContext?.kind === "main" && !hasWorkspaceSelection && surfaceMode !== "panel") {
      setSurfaceMode("panel");
    }
  }, [hasWorkspaceSelection, surfaceMode, windowContext?.kind]);

  useEffect(() => {
    if (!state || !windowContext || !runtime || !selectedProgram || !selectedPanel) {
      return;
    }

    const surface = inferSurfaceName(windowContext);
    const message = `Frontend rendered surface. ProgramId=${selectedProgram.ProgramTabId}; PanelId=${selectedPanel.Id}; Mode=${windowContext.kind}`;
    setFrontendEvents((current) => [message, ...current].slice(0, 12));
    void logFrontendEvent(surface, message);
  }, [runtime, selectedPanel?.Id, selectedProgram?.ProgramTabId, windowContext?.kind]);

  useEffect(() => {
    if (
      !state ||
      !windowContext ||
      windowContext.kind !== "main" ||
      state.StartupRestorePopoutsOnly !== true
    ) {
      return;
    }
    if (startupPanelRestoreRef.current) {
      return;
    }
    startupPanelRestoreRef.current = true;

    state.Programs.forEach((program) => {
      program.Panels.filter((panel) => panel.IsPoppedOut).forEach((panel) => {
        void openPanelPopout({
          programId: program.ProgramTabId,
          panelId: panel.Id,
          panelName: panel.Name,
          buttonCount: panel.Buttons.length,
          bounds: panel.PopoutBounds
        });
      });
    });
  }, [state, windowContext]);

  useEffect(() => {
    if (
      !state ||
      !windowContext ||
      windowContext.kind !== "main" ||
      state.StartupRestorePopoutsOnly !== true
    ) {
      return;
    }
    if (startupToolRestoreRef.current) {
      return;
    }
    startupToolRestoreRef.current = true;

    void (async () => {
      const windows = await getAllWebviewWindows().catch(() => []);
      const openLabels = new Set(windows.map((window) => window.label));

      (state.ToolPopouts ?? []).forEach((toolPopout) => {
        const ownerButtonId = toolPopout.ButtonIds[0];
        if (!ownerButtonId) {
          return;
        }

        const label = `popout-tool-${toolPopout.ProgramTabId}-${sanitizeWindowToken(toolPopout.PanelId)}-${sanitizeWindowToken(ownerButtonId)}`;
        if (openLabels.has(label)) {
          return;
        }

        const panel = findPanel(state, toolPopout.ProgramTabId, toolPopout.PanelId);
        const ownerButton = findButton(
          state,
          toolPopout.ProgramTabId,
          toolPopout.PanelId,
          ownerButtonId
        );
        if (!panel || (toolPopout.LayoutMode !== "PanelFan" && !ownerButton)) {
          return;
        }
        const layoutMode = resolveEffectiveToolPopoutLayoutMode(
          toolPopout.LayoutMode,
          ownerButton ?? undefined
        );

        void openToolPopout({
          programId: toolPopout.ProgramTabId,
          panelId: toolPopout.PanelId,
          panelName: panel.Name,
          ownerButtonId,
          buttonIds: toolPopout.ButtonIds,
          layoutMode,
          buttonLabel:
            layoutMode === "PanelFan" ? panel.Name : ownerButton!.Label,
          bounds: toolPopout.Bounds ?? null
        });
      });
    })();
  }, [state, windowContext]);

  useLayoutEffect(() => {
    if (!windowContext || windowContext.kind !== "tool-popout") {
      toolPopoutAutoFitKeyRef.current = null;
      return;
    }
    if (!selectedProgram || !selectedPanel) {
      toolPopoutAutoFitKeyRef.current = null;
      return;
    }
    if (toolPopoutLayoutMode === "PanelFan" || toolPopoutLayoutMode === "Fanout") {
      toolPopoutAutoFitKeyRef.current = null;
      return;
    }

    let cancelled = false;
    const currentWindow = getCurrentWindow();
    const autoFitKey = `${selectedProgram.ProgramTabId}:${selectedPanel.Id}:${toolPopoutOwnerButton?.Id ?? ""}:${toolPopoutLayoutMode}`;

    if (toolPopoutAutoFitKeyRef.current === autoFitKey) {
      return;
    }
    toolPopoutAutoFitKeyRef.current = autoFitKey;

    if (activeToolPopout?.Bounds && isPersistablePopoutBounds(activeToolPopout.Bounds)) {
      return;
    }

    const ensureWindowCoversButtonSpread = async () => {
      const currentBounds = await readLogicalWindowBounds(currentWindow);
      if (!currentBounds || cancelled) {
        return;
      }

      let requiredWidth = 0;
      let requiredHeight = 0;

      if (windowContext.kind === "panel-popout") {
        requiredWidth = computeCompactPopoutButtonRowWidth(regularPanelRenderItemCount);
        requiredHeight = COMPACT_POPOUT_BUTTON_HEIGHT + COMPACT_POPOUT_SHELL_PADDING;
        if (hasCompactSmartAxisPanelRow) {
          requiredWidth = Math.max(
            requiredWidth,
            COMPACT_SMART_AXIS_WIDTH + COMPACT_POPOUT_SHELL_PADDING
          );
          requiredHeight +=
            (regularPanelRenderItemCount > 0 ? COMPACT_POPOUT_ROW_GAP : 0) +
            COMPACT_SMART_AXIS_HEIGHT;
        }
      } else if (windowContext.kind === "tool-popout") {
        if (toolPopoutOwnerButton && isAlignmentOwnerButton(toolPopoutOwnerButton)) {
          requiredWidth = 336;
          requiredHeight = 166;
        } else if (toolPopoutOwnerButton && isFlattenRevolveOwnerButton(toolPopoutOwnerButton)) {
          requiredWidth = 360;
          requiredHeight = 240;
        } else if (toolPopoutOwnerButton && isQuickRotateGroupOwnerButton(toolPopoutOwnerButton)) {
          requiredWidth = 560;
          requiredHeight = 170;
        } else if (toolPopoutButtons.some((button) => isSmartAxisButton(button))) {
          requiredWidth = COMPACT_SMART_AXIS_WIDTH + COMPACT_POPOUT_SHELL_PADDING;
          requiredHeight = 72;
        } else {
          requiredWidth = computeCompactPopoutButtonRowWidth(toolPopoutButtons.length || 1);
          requiredHeight = COMPACT_POPOUT_BUTTON_HEIGHT + COMPACT_POPOUT_SHELL_PADDING;
        }
      }

      if (requiredWidth <= 0 || requiredHeight <= 0) {
        return;
      }

      if (
        currentBounds.Width >= requiredWidth - 0.5 &&
        currentBounds.Height >= requiredHeight - 0.5
      ) {
        return;
      }

      markProgrammaticWindowPlacement(700);
      await currentWindow.setSize(
        new LogicalSize(
          Math.max(currentBounds.Width, requiredWidth),
          Math.max(currentBounds.Height, requiredHeight)
        )
      );
    };

    void ensureWindowCoversButtonSpread();

    return () => {
      cancelled = true;
    };
  }, [
    hasCompactSmartAxisPanelRow,
    regularPanelRenderItemCount,
    activeToolPopout?.Bounds,
    selectedPanel?.Id,
    selectedProgram?.ProgramTabId,
    toolPopoutButtons,
    toolPopoutLayoutMode,
    toolPopoutOwnerButton,
    windowContext
  ]);

  useEffect(() => {
    if (!state || !windowContext || windowContext.kind !== "main") {
      return;
    }

    let disposed = false;

    const expectedLabels = new Set<string>(["main"]);
    state.Programs.forEach((program) => {
      program.Panels.forEach((panel) => {
        if (panel.IsPoppedOut) {
          expectedLabels.add(
            `popout-panel-${program.ProgramTabId}-${sanitizeWindowToken(panel.Id)}`
          );
        }
      });
    });
    (state.ToolPopouts ?? []).forEach((toolPopout) => {
      const ownerButtonId = toolPopout.ButtonIds[0];
      if (!ownerButtonId) {
        return;
      }
      expectedLabels.add(
        `popout-tool-${toolPopout.ProgramTabId}-${sanitizeWindowToken(toolPopout.PanelId)}-${sanitizeWindowToken(ownerButtonId)}`
      );
    });

    void (async () => {
      const windows = await getAllWebviewWindows().catch(() => []);
      for (const candidate of windows) {
        if (disposed) {
          return;
        }
        if (candidate.label.startsWith("panel-fan-options-")) {
          continue;
        }
        if (candidate.label.startsWith("button-appearance-")) {
          continue;
        }
        if (!expectedLabels.has(candidate.label)) {
          await candidate.close().catch(() => {});
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [state, windowContext]);

  useEffect(() => {
    if (
      !selectedProgram ||
      !selectedPanel ||
      !toolPopoutOwnerButton ||
      windowContext?.kind !== "tool-popout"
    ) {
      return;
    }

    setSelectedButtonRef((current) =>
      current ?? {
        programId: selectedProgram.ProgramTabId,
        panelId: selectedPanel.Id,
        buttonId: toolPopoutOwnerButton.Id
      }
    );
  }, [selectedPanel, selectedProgram, toolPopoutOwnerButton, windowContext]);

  useEffect(() => {
    if (!state || !windowContext || windowContext.kind !== "panel-popout" || !selectedProgram || !selectedPanel) {
      return;
    }

    const currentWindow = getCurrentWindow();
    let persistTimer: number | undefined;

    const persistBounds = async () => {
      const nextBounds = await readLogicalWindowBounds(currentWindow);
      if (!nextBounds) {
        return;
      }
      if (!isPersistablePopoutBounds(nextBounds)) {
        return;
      }
      await persistLatestMutation(
        (currentState) =>
          updatePanelPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            (currentPanel) => ({
              ...currentPanel,
              IsPoppedOut: true,
              PopoutBounds: nextBounds
            })
          ),
        { broadcast: false, syncLocalState: false }
      );
    };

    const schedulePersistBounds = () => {
      if (persistTimer) {
        window.clearTimeout(persistTimer);
      }
      persistTimer = window.setTimeout(() => {
        void persistBounds();
      }, 140);
    };

    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;

    void currentWindow
      .onMoved(() => {
        if (isProgrammaticWindowPlacementActive()) {
          return;
        }
        schedulePersistBounds();
      })
      .then((fn) => {
        unlistenMove = fn;
      });

    void currentWindow
      .onResized(() => {
        if (isProgrammaticWindowPlacementActive()) {
          return;
        }
        schedulePersistBounds();
      })
      .then((fn) => {
        unlistenResize = fn;
      });

    void currentWindow
      .onCloseRequested(async (event) => {
        if (closingWindowRef.current) {
          event.preventDefault();
          return;
        }
        closingWindowRef.current = true;
        await persistLatestMutation((currentState) =>
          updatePanelPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            (currentPanel) => ({
              ...currentPanel,
              IsPoppedOut: false
            })
          )
        , { broadcast: false, syncLocalState: false });
        void broadcastStateSync(currentWindow.label).catch(() => {});
        event.preventDefault();
        await currentWindow.destroy();
      })
      .then((fn) => {
        unlistenClose = fn;
      });

    return () => {
      if (persistTimer) {
        window.clearTimeout(persistTimer);
      }
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [
    isPanelFanPopout,
    panelFanClusterOpen,
    selectedPanel,
    selectedProgram,
    state,
    windowContext
  ]);

  useEffect(() => {
    if (
      !state ||
      !windowContext ||
      windowContext.kind !== "tool-popout" ||
      !selectedProgram ||
      !selectedPanel ||
      !windowContext.ownerButtonId
    ) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const surface = inferSurfaceName(windowContext);
    let persistTimer: number | undefined;

    const persistBounds = async () => {
      const currentBounds = await readLogicalWindowBounds(currentWindow);
      if (!currentBounds) {
        return;
      }
      const liveFloatingFanoutOpen = isFloatingFanoutPopout && floatingFanoutClusterOpenRef.current;
      const liveFloatingFanoutMetrics = isFloatingFanoutPopout
        ? floatingFanoutWindowMetricsRef.current ?? floatingFanoutMetricsRef.current
        : null;
      const livePanelFanOpen = isPanelFanPopout && panelFanClusterOpenRef.current;
      const livePanelFanMetrics = isPanelFanPopout
        ? panelFanWindowMetricsRef.current ?? panelFanMetricsRef.current
        : null;
      if (isFloatingFanoutPopout && !liveFloatingFanoutMetrics) {
        return;
      }
      if (isPanelFanPopout && !livePanelFanMetrics) {
        return;
      }
      const nextBounds =
        isFloatingFanoutPopout && liveFloatingFanoutMetrics
          ? clampBoundsToWorkArea(
              deriveCollapsedAnchoredBounds({
                windowBounds: currentBounds,
                metrics: liveFloatingFanoutMetrics,
                open: liveFloatingFanoutOpen
              })
            )
          : isPanelFanPopout && livePanelFanMetrics
            ? clampBoundsToWorkArea(
                deriveCollapsedAnchoredBounds({
                  windowBounds: currentBounds,
                metrics: livePanelFanMetrics,
                open: livePanelFanOpen
              })
            )
          : currentBounds;
      if (
        isFloatingFanoutPopout
          ? !isPersistableFloatingFanoutBounds(nextBounds)
          : isPanelFanPopout
            ? !isPersistablePanelFanBounds(nextBounds)
            : !isPersistablePopoutBounds(nextBounds)
      ) {
        return;
      }
      if (isFloatingFanoutPopout) {
        floatingFanoutCollapsedBoundsRef.current = nextBounds;
        floatingFanoutPersistedBoundsKeyRef.current = buildBoundsKey(nextBounds, "closed");
        pushFrontendEvent(
          surface,
          `Floating fanout move save. CollapsedBounds=${Math.round(nextBounds.Left)},${Math.round(nextBounds.Top)},${Math.round(nextBounds.Width)}x${Math.round(nextBounds.Height)}`
        );
      } else if (isPanelFanPopout) {
        panelFanCollapsedBoundsRef.current = nextBounds;
        panelFanPersistedBoundsKeyRef.current = buildBoundsKey(nextBounds, "closed");
        pushFrontendEvent(
          surface,
          `Panel fan move save. CollapsedBounds=${Math.round(nextBounds.Left)},${Math.round(nextBounds.Top)},${Math.round(nextBounds.Width)}x${Math.round(nextBounds.Height)}`
        );
      }
      await persistLatestMutation(
        (currentState) =>
          updateToolPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            windowContext.ownerButtonId!,
            nextBounds
          ),
        { broadcast: false, syncLocalState: false }
      );
    };

    const schedulePersistBounds = () => {
      if (persistTimer) {
        window.clearTimeout(persistTimer);
      }
      persistTimer = window.setTimeout(() => {
        void persistBounds();
      }, 140);
    };

    let unlistenMove: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;

    void currentWindow
      .onMoved(() => {
        if (isProgrammaticWindowPlacementActive()) {
          return;
        }
        if (
          (isFloatingFanoutPopout && floatingFanoutProgrammaticResizeRef.current) ||
          (isPanelFanPopout && panelFanProgrammaticResizeRef.current)
        ) {
          return;
        }
        schedulePersistBounds();
      })
      .then((fn) => {
        unlistenMove = fn;
      });

    if (!isFloatingFanoutPopout && !isPanelFanPopout) {
      void currentWindow
        .onResized(() => {
          if (isProgrammaticWindowPlacementActive()) {
            return;
          }
          schedulePersistBounds();
        })
        .then((fn) => {
          unlistenResize = fn;
        });
    }

    void currentWindow
      .onCloseRequested(async (event) => {
        if (closingWindowRef.current) {
          event.preventDefault();
          return;
        }
        closingWindowRef.current = true;
        await persistLatestMutation((currentState) =>
          removeToolPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            windowContext.ownerButtonId!
          )
        , { broadcast: false, syncLocalState: false });
        void broadcastStateSync(currentWindow.label).catch(() => {});
        event.preventDefault();
        await currentWindow.destroy();
      })
      .then((fn) => {
        unlistenClose = fn;
      });

    return () => {
      if (persistTimer) {
        window.clearTimeout(persistTimer);
      }
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [
    floatingFanoutClusterOpen,
    floatingFanoutMetrics,
    isFloatingFanoutPopout,
    isPanelFanPopout,
    panelFanClusterOpen,
    panelFanMetrics,
    selectedPanel,
    selectedProgram,
    state,
    windowContext
  ]);

  useEffect(() => {
    if (!windowContext || windowContext.kind === "main") {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isFloatingFanoutPopout) {
          requestFloatingFanoutCollapse();
          return;
        }
        if (isPanelFanPopout) {
          requestPanelFanCollapse();
          return;
        }
        void handleWindowClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isFloatingFanoutPopout, isPanelFanPopout, selectedPanel?.Id, windowContext?.kind]);

  useEffect(() => {
    if (!windowContext || windowContext.kind === "main") {
      setPopoutContextMenu(null);
    }
  }, [windowContext]);

  useEffect(() => {
    if (!windowContext || windowContext.kind !== "main" || surfaceMode !== "panel") {
      setButtonContextMenu(null);
      setProgramContextMenu(null);
    }
  }, [surfaceMode, selectedPanel?.Id, selectedProgram?.ProgramTabId, windowContext]);

  useEffect(() => {
    if (!windowContext || windowContext.kind !== "main") {
      return;
    }

    const suppressNativeContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
    };

    document.addEventListener("contextmenu", suppressNativeContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", suppressNativeContextMenu, true);
    };
  }, [windowContext?.kind]);

  useEffect(() => {
    if (!windowContext || windowContext.kind !== "main") {
      return;
    }

    void getCurrentWindow().setAlwaysOnTop(false).catch(() => {});
  }, [windowContext?.kind]);

  useEffect(() => {
    if (!windowContext || windowContext.kind === "main" || !selectedProgram) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const processTargets = resolveProgramProcessTargets(selectedProgram);

    if (processTargets.names.length === 0 && !processTargets.path) {
      void currentWindow.setAlwaysOnTop(false).catch(() => {});
      return;
    }

    let disposed = false;
    let lastApplied: boolean | undefined;
    let lastTargetMatch: boolean | undefined;

    const syncTopmost = async () => {
      try {
        const foreground = await getForegroundProcessInfo();
        if (disposed) {
          return;
        }

        const foregroundName = normalizeProcessToken(
          foreground.processName || foreground.processPath
        );
        const foregroundPath = normalizeProcessPath(foreground.processPath);
        const matchesTarget =
          (processTargets.path.length > 0 && foregroundPath === processTargets.path) ||
          processTargets.names.includes(foregroundName);
        const isCurrentWindowFocused = await currentWindow.isFocused().catch(() => false);
        const shouldStayOnTop = matchesTarget || isCurrentWindowFocused;

        if (shouldStayOnTop === lastApplied && matchesTarget === lastTargetMatch && !matchesTarget) {
          return;
        }

        lastApplied = shouldStayOnTop;
        lastTargetMatch = matchesTarget;
        await currentWindow.setAlwaysOnTop(shouldStayOnTop);
      } catch {
      }
    };

    void syncTopmost();
    const intervalId = window.setInterval(() => {
      void syncTopmost();
    }, 180);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      void currentWindow.setAlwaysOnTop(false).catch(() => {});
    };
  }, [
    selectedProgram?.ProgramTabId,
    selectedProgram?.ProgramConfig?.ExePath,
    selectedProgram?.ProgramConfig?.NormalizedName,
    selectedProgram?.ProgramConfig?.ProgramType,
    JSON.stringify(selectedProgram?.ProgramConfig?.ProcessNames ?? []),
    windowContext?.kind
  ]);

  useEffect(() => {
    if (!windowContext || windowContext.kind === "main") {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      return;
    }

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [windowContext?.kind]);

  if (!state || !runtime || !windowContext || !selectedProgram || !selectedPanel) {
    return <div className="boot-screen">FlowCell frontend is loading state.</div>;
  }

  const appTheme = normalizeAppTheme(state.AppTheme);
  const appThemeStyle = buildAppThemeCssVars(appTheme);
  const appThemeVariant = getAppThemeVariant(appTheme);

  const applyShellThemePreset = async (presetId: string) => {
    const presetTheme = getAppThemePreset(presetId);
    if (!presetTheme) {
      return;
    }
    await persistState(updateAppTheme(state, presetTheme));
  };

  const applyDarkTheme = async () => {
    await applyShellThemePreset("signal-night");
  };

  const applyBlackTintCards = async () => {
    await persistState(updateSurfaceStyleAssignment(state, "main-cards", "style-group-05"));
  };

  const applyNatureTheme = async () => {
    await applyShellThemePreset("nature-frost");
  };

  const applyEggshellTheme = async () => {
    const presetTheme = getAppThemePreset("eggshell-paper");
    if (!presetTheme) {
      return;
    }
    const importedSkins = state.ImportedSkins ?? [];
    const targetSkinId =
      state.StyleGroups?.find((entry) => entry.id === "style-group-03")?.importedSkinId ??
      importedSkins[0]?.id ??
      "imported-skin-01";
    const nextImportedSkins =
      importedSkins.length > 0
        ? importedSkins.map((skin) =>
            skin.id === targetSkinId ? buildEggshellImportedSkin(targetSkinId) : skin
          )
        : [buildEggshellImportedSkin(targetSkinId)];

    await persistState(
      updateImportedSkins(updateAppTheme(state, presetTheme), nextImportedSkins)
    );
  };

  const handleSaveVisualTheme = async () => {
    const defaultThemeName = `${appTheme.name} Snapshot`;
    const nextThemeName = window.prompt("Save Theme As", defaultThemeName)?.trim();
    if (!nextThemeName) {
      return;
    }

    await persistLatestMutation((currentState) => {
      const savedThemes = currentState.SavedVisualThemes ?? [];
      const existingTheme = savedThemes.find(
        (theme) => theme.name.trim().toLowerCase() === nextThemeName.toLowerCase()
      );
      const nextTheme: SavedVisualTheme = {
        id: existingTheme?.id ?? createClientId("visual_theme_"),
        name: nextThemeName,
        savedAt: new Date().toISOString(),
        appTheme: { ...normalizeAppTheme(currentState.AppTheme) },
        styleGroups: (currentState.StyleGroups ?? []).map((styleGroup) => ({ ...styleGroup })),
        importedSkins: (currentState.ImportedSkins ?? []).map((skin) => ({ ...skin })),
        surfaceStyleAssignments: (currentState.SurfaceStyleAssignments ?? []).map((assignment) => ({
          ...assignment
        })),
        programStyleAssignments: currentState.Programs.map((program) => ({
          programId: program.ProgramTabId,
          style_group_id: program.style_group_id ?? ""
        })),
        buttonStyleAssignments: currentState.Programs.flatMap((program) =>
          program.Panels.flatMap((panel) =>
            panel.Buttons.map((button) => ({
              programId: program.ProgramTabId,
              panelId: panel.Id,
              buttonId: button.Id,
              style_group_id: button.style_group_id ?? ""
            }))
          )
        )
      };
      const nextSavedThemes = existingTheme
        ? savedThemes.map((theme) => (theme.id === existingTheme.id ? nextTheme : theme))
        : [...savedThemes, nextTheme];

      return {
        ...currentState,
        SavedVisualThemes: nextSavedThemes
      };
    });

    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Saved visual theme snapshot "${nextThemeName}".`
    );
  };

  const resolveSectionStyleGroup = (surfaceId: SurfaceStyleSectionId) =>
    resolveStyleGroup(
      state.StyleGroups,
      state.SurfaceStyleAssignments?.find((assignment) => assignment.surface_id === surfaceId)
        ?.style_group_id ?? ""
    );

  const resolveSectionImportedSkin = (surfaceId: SurfaceStyleSectionId) => {
    const styleGroup = resolveSectionStyleGroup(surfaceId);
    return getImportedSkin(state.ImportedSkins, styleGroup?.importedSkinId);
  };

  const buildSurfaceSkinStyle = (styleGroup?: StyleGroup) =>
    styleGroup
      ? ({
          ["--surface-style-accent" as string]: styleGroup.accent
        } as const)
      : undefined;

  const panelsStyleGroup = resolveSectionStyleGroup("main-panels");
  const panelsImportedSkin = resolveSectionImportedSkin("main-panels");
  const panelSurfaceStyleGroup = resolveSectionStyleGroup("main-panel-surface");
  const panelSurfaceImportedSkin = resolveSectionImportedSkin("main-panel-surface");
  const cardsStyleGroup = resolveSectionStyleGroup("main-cards");
  const cardsImportedSkin = resolveSectionImportedSkin("main-cards");
  const miscStyleGroup = resolveSectionStyleGroup("main-misc");
  const miscImportedSkin = resolveSectionImportedSkin("main-misc");
  const popoutRegularStyleGroup = resolveSectionStyleGroup("popout-regular-buttons");
  const popoutRegularImportedSkin = resolveSectionImportedSkin("popout-regular-buttons");
  const popoutToolStyleGroup = resolveSectionStyleGroup("popout-tools");
  const popoutToolImportedSkin = resolveSectionImportedSkin("popout-tools");

  const renderSurfaceSkinBackdrop = (
    label: string,
    styleGroup?: StyleGroup,
    importedSkin = getImportedSkin(state.ImportedSkins, styleGroup?.importedSkinId)
  ) => {
    const surfaceSkin = renderSurfaceSkin({
      label,
      styleGroup,
      importedSkin
    });

    return surfaceSkin ? (
      <div className="surface-skin-visual" aria-hidden="true">
        {surfaceSkin}
      </div>
    ) : null;
  };

  const persistState = async (
    nextState: FlowCellState,
    options?: { broadcast?: boolean }
  ) => {
    setState(nextState);
    await saveState(nextState, options);
  };

  const scheduleSelectedButtonRef = (
    nextSelectedButtonRef: SetStateAction<SelectedButtonRef | null>
  ) => {
    startTransition(() => {
      setSelectedButtonRef(nextSelectedButtonRef);
    });
  };

  const pushFrontendEvent = (surface: string, message: string) => {
    startTransition(() => {
      setFrontendEvents((current) => [message, ...current].slice(0, 12));
    });
    void logFrontendEvent(surface, message);
  };

  const persistLatestMutation = async (
    mutator: (currentState: FlowCellState) => FlowCellState,
    options?: { broadcast?: boolean; syncLocalState?: boolean }
  ) => {
    const latest = await loadState();
    const currentState = applyBindingsToState(ensureStateDefaults(latest.state), latest.bindings);
    const nextState = mutator(currentState);
    if (options?.syncLocalState !== false) {
      setRuntime(latest.runtime);
      setBindingsState(latest.bindings);
      setState(nextState);
    }
    await saveState(nextState, options);
    return nextState;
  };

  const persistLatestLocalMutation = (
    mutator: (currentState: FlowCellState) => FlowCellState
  ) => {
    const optimisticState = mutator(state);
    setState(optimisticState);
    void persistLatestMutation(mutator, { broadcast: false }).catch((error) => {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Local state save failed. ${error instanceof Error ? error.message : String(error)}`
      );
    });
  };

  const closeProgramWindows = async (programId: number) => {
    const windows = await getAllWebviewWindows().catch(() => []);
    await Promise.all(
      windows
        .filter(
          (candidate) =>
            candidate.label.startsWith(`popout-panel-${programId}-`) ||
            candidate.label.startsWith(`popout-tool-${programId}-`) ||
            candidate.label.startsWith(`panel-fan-options-${programId}-`) ||
            candidate.label.startsWith(`button-appearance-${programId}-`)
        )
        .map((candidate) => candidate.close().catch(() => {}))
    );
  };

  const reopenProgramWindows = async (nextState: FlowCellState, programId: number) => {
    const program = findProgram(nextState, programId);
    if (!program) {
      return;
    }

    const windows = await getAllWebviewWindows().catch(() => []);
    const openLabels = new Set(windows.map((window) => window.label));

    for (const panel of program.Panels) {
      if (!panel.IsPoppedOut) {
        continue;
      }

      const label = `popout-panel-${programId}-${sanitizeWindowToken(panel.Id)}`;
      if (openLabels.has(label)) {
        continue;
      }

      await openPanelPopout({
        programId,
        panelId: panel.Id,
        panelName: panel.Name,
        buttonCount: panel.Buttons.length,
        bounds: panel.PopoutBounds
      }).catch(() => {});
      openLabels.add(label);
    }

    for (const toolPopout of (nextState.ToolPopouts ?? []).filter(
      (entry) => entry.ProgramTabId === programId
    )) {
      const ownerButtonId = toolPopout.ButtonIds[0];
      if (!ownerButtonId) {
        continue;
      }

      const label = `popout-tool-${programId}-${sanitizeWindowToken(toolPopout.PanelId)}-${sanitizeWindowToken(ownerButtonId)}`;
      if (openLabels.has(label)) {
        continue;
      }

      const panel = findPanel(nextState, toolPopout.ProgramTabId, toolPopout.PanelId);
      const ownerButton = findButton(
        nextState,
        toolPopout.ProgramTabId,
        toolPopout.PanelId,
        ownerButtonId
      );
      if (!panel || (toolPopout.LayoutMode !== "PanelFan" && !ownerButton)) {
        continue;
      }

      const layoutMode = resolveEffectiveToolPopoutLayoutMode(
        toolPopout.LayoutMode,
        ownerButton ?? undefined
      );

      await openToolPopout({
        programId: toolPopout.ProgramTabId,
        panelId: toolPopout.PanelId,
        panelName: panel.Name,
        ownerButtonId,
        buttonIds: toolPopout.ButtonIds,
        layoutMode,
        buttonLabel: layoutMode === "PanelFan" ? panel.Name : ownerButton!.Label,
        bounds: toolPopout.Bounds ?? null
      }).catch(() => {});
      openLabels.add(label);
    }
  };

  const persistCollapsedToolPopoutBounds = async (
    ownerButtonId: string,
    collapsedBounds: FlowCellBounds,
    layoutMode: "Fanout" | "PanelFan",
    persistedKeyRef: { current: string | null }
  ) => {
    if (!ownerButtonId || !selectedProgram || !selectedPanel) {
      return;
    }
    const isValidBounds =
      layoutMode === "Fanout"
        ? isPersistableFloatingFanoutBounds(collapsedBounds)
        : isPersistablePanelFanBounds(collapsedBounds);
    if (!isValidBounds) {
      return;
    }
    const collapsedKey = buildBoundsKey(collapsedBounds, "closed");
    if (persistedKeyRef.current === collapsedKey) {
      return;
    }
    await persistLatestMutation(
      (currentState) =>
        updateToolPopout(
          currentState,
          selectedProgram.ProgramTabId,
          selectedPanel.Id,
          ownerButtonId,
          collapsedBounds
        ),
      { broadcast: false, syncLocalState: false }
    );
    persistedKeyRef.current = collapsedKey;
  };

  const clearFloatingFanoutCollapseTimer = () => {
    if (floatingFanoutCollapseTimerRef.current) {
      window.clearTimeout(floatingFanoutCollapseTimerRef.current);
      floatingFanoutCollapseTimerRef.current = undefined;
    }
  };

  const clearPanelFanCollapseTimer = () => {
    if (panelFanCollapseTimerRef.current) {
      window.clearTimeout(panelFanCollapseTimerRef.current);
      panelFanCollapseTimerRef.current = undefined;
    }
  };

  const requestFloatingFanoutExpand = () => {
    clearFloatingFanoutCollapseTimer();
    if (!floatingFanoutClusterOpen) {
      setFloatingFanoutChildrenVisible(false);
      setFloatingFanoutClusterOpen(true);
      return;
    }
    setFloatingFanoutChildrenVisible(true);
  };

  const requestFloatingFanoutCollapse = () => {
    clearFloatingFanoutCollapseTimer();
    setFloatingFanoutChildrenVisible(false);
    if (!floatingFanoutClusterOpen) {
      return;
    }
    floatingFanoutCollapseTimerRef.current = window.setTimeout(() => {
      setFloatingFanoutClusterOpen(false);
      floatingFanoutCollapseTimerRef.current = undefined;
    }, 140);
  };

  const requestPanelFanExpand = () => {
    clearPanelFanCollapseTimer();
    if (!panelFanClusterOpen) {
      setPanelFanChildrenVisible(false);
      setPanelFanClusterOpen(true);
      return;
    }
    setPanelFanChildrenVisible(true);
  };

  const requestPanelFanCollapse = () => {
    clearPanelFanCollapseTimer();
    setPanelFanChildrenVisible(false);
    if (!panelFanClusterOpen) {
      return;
    }
    panelFanCollapseTimerRef.current = window.setTimeout(() => {
      setPanelFanClusterOpen(false);
      panelFanCollapseTimerRef.current = undefined;
    }, 140);
  };

  const dispatchEnvelope = async (
    commandEnvelope: CommandEnvelope,
    selectedButtonId: string
  ): Promise<CommandResult> => {
    const surface = inferSurfaceName(windowContext);

    scheduleSelectedButtonRef({
      programId: commandEnvelope.program_id,
      panelId: commandEnvelope.panel_id,
      buttonId: selectedButtonId
    });

    const emittedMessage = `Frontend emitted command. RequestId=${commandEnvelope.request_id ?? ""}; CommandId=${commandEnvelope.command_id}; ButtonId=${commandEnvelope.button_id}; ChildSlotId=${commandEnvelope.child_slot_id ?? ""}`;
    pushFrontendEvent(surface, emittedMessage);

    let result: CommandResult;

    try {
      result = await emitCommand(commandEnvelope);
    } catch (error) {
      result = {
        ok: false,
        request_id: commandEnvelope.request_id ?? "frontend-error",
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        details: {
          source: "frontend"
        },
        logs: [],
        exit_code: -1,
        duration_ms: 0
      };
    }

    const receivedMessage = `Frontend received command result. RequestId=${result.request_id}; Ok=${String(result.ok)}; Message=${result.message}`;
    pushFrontendEvent(surface, receivedMessage);
    startTransition(() => {
      setStatus(result);
    });
    pushFrontendEvent(
      surface,
      `Final UI status updated. RequestId=${result.request_id}; Status=${result.status}; Message=${result.message}`
    );
    return result;
  };

  const handleWindowMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Window minimize failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleWindowToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Window maximize toggle failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleWindowClose = async () => {
    try {
      closingWindowRef.current = true;
      const currentWindow = getCurrentWindow();
      if (
        windowContext.kind === "panel-fan-options" ||
        windowContext.kind === "button-appearance" ||
        windowContext.kind === "layout-picker"
      ) {
        await currentWindow.close();
        return;
      }
      if (windowContext.kind === "panel-popout") {
        await persistLatestMutation((currentState) =>
          updatePanelPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            (currentPanel) => ({
              ...currentPanel,
              IsPoppedOut: false
            })
          )
        , { broadcast: false });
        void broadcastStateSync(currentWindow.label).catch(() => {});
        await currentWindow.destroy();
        return;
      }
      if (windowContext.kind === "tool-popout" && windowContext.ownerButtonId) {
        const ownerButtonId = windowContext.ownerButtonId;
        await persistLatestMutation((currentState) =>
          removeToolPopout(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            ownerButtonId
          )
        , { broadcast: false });
        void broadcastStateSync(currentWindow.label).catch(() => {});
      }
      await currentWindow.destroy();
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Window close failed. ${error instanceof Error ? error.message : String(error)}`
      );
      closingWindowRef.current = false;
    }
  };

  const activateButton = async (
    program: FlowCellProgram,
    panel: FlowCellPanel,
    button: FlowCellButton,
    options: ActivateButtonOptions = {}
  ) => {
    const commandEnvelope = buildCommandEnvelope({
      runtime,
      program,
      panel,
      button,
      sourceSurface: inferSurfaceName(windowContext),
      ownerButtonId: options.ownerButtonId,
      childSlotId: options.childSlotId,
      toolAction: options.toolAction
    });

    return dispatchEnvelope(commandEnvelope, button.Id);
  };

  const activateToolAction = async (args: {
    program: FlowCellProgram;
    panel: FlowCellPanel;
    ownerButton: FlowCellButton;
    sourceButton: FlowCellButton;
    toolId: string;
    toolCommand: string;
    childSlotId: string;
    toolAction: string;
    selectedButtonId: string;
    kind?: string;
    payload?: Record<string, unknown>;
    toolOptionState?: Record<string, unknown>;
  }) => {
    const commandEnvelope = buildToolActionEnvelope({
      runtime,
      program: args.program,
      panel: args.panel,
      ownerButton: args.ownerButton,
      sourceButton: args.sourceButton,
      sourceSurface: inferSurfaceName(windowContext),
      toolId: args.toolId,
      toolCommand: args.toolCommand,
      childSlotId: args.childSlotId,
      toolAction: args.toolAction,
      kind: args.kind,
      payload: args.payload,
      toolOptionState: args.toolOptionState
    });

    return dispatchEnvelope(commandEnvelope, args.selectedButtonId);
  };

  const handleFanoutChildActivate = async (
    ownerButton: FlowCellButton,
    entry: FanClusterEntry
  ) => {
    const childProgram = findProgram(state, entry.programId);
    const childPanel = childProgram ? findPanel(state, entry.programId, entry.panelId) : undefined;

    if (!childProgram || !childPanel) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Fanout child resolution failed. Owner=${ownerButton.Id}; Child=${entry.button.Id}`
      );
      return;
    }

    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Floating fanout child command emit. Owner=${ownerButton.Id}; Child=${entry.button.Id}; ChildSlot=${entry.childSlotId}`
    );
    await activateButton(childProgram, childPanel, entry.button, {
      ownerButtonId: ownerButton.Id,
      childSlotId: entry.childSlotId
    });
  };

  const togglePanelPopout = async (panel: FlowCellPanel) => {
    const nextState = updatePanelPopout(
      state,
      selectedProgram.ProgramTabId,
      panel.Id,
      (currentPanel) => ({
        ...currentPanel,
        IsPoppedOut: !currentPanel.IsPoppedOut
      })
    );
    await persistState(nextState);

    if (panel.IsPoppedOut) {
      await closePanelPopout(selectedProgram.ProgramTabId, panel.Id);
    } else {
      await openPanelPopout({
        programId: selectedProgram.ProgramTabId,
        panelId: panel.Id,
        panelName: panel.Name,
        buttonCount: panel.Buttons.length,
        bounds: panel.PopoutBounds
      });
    }
  };

  const openToolWindow = async (args: {
    program: FlowCellProgram;
    panel: FlowCellPanel;
    ownerButton: FlowCellButton;
    buttons: FlowCellButton[];
    layoutMode: "Group" | "Individual" | "PanelFan";
    buttonLabel: string;
  }) => {
    const surface = inferSurfaceName(windowContext);
    const resolvedLayoutMode: ToolPopoutLayoutMode =
      args.layoutMode === "Individual" && (args.ownerButton.fanout?.child_button_ids?.length ?? 0) > 0
        ? "Fanout"
        : args.layoutMode;
    const buttonIds =
      resolvedLayoutMode === "PanelFan"
        ? [args.ownerButton.Id, ...args.buttons.map((button) => button.Id)]
        : buildOwnerFirstButtonIds(
            args.ownerButton.Id,
            args.buttons.map((button) => button.Id)
          );
    let resolvedRecord!: ToolPopoutRecord;
    await persistLatestMutation((currentState) => {
      const existing = findToolPopoutByOwner(
        currentState,
        args.program.ProgramTabId,
        args.panel.Id,
        args.ownerButton.Id
      );
      const nextRecord: ToolPopoutRecord = {
        ProgramTabId: args.program.ProgramTabId,
        PanelId: args.panel.Id,
        ButtonIds: buttonIds,
        LayoutMode: resolvedLayoutMode,
        Bounds: existing?.Bounds ?? null
      };
      resolvedRecord = nextRecord;
      return upsertToolPopout(currentState, nextRecord);
    });
    pushFrontendEvent(
      surface,
      `Opening tool popout. Owner=${args.ownerButton.Id}; Buttons=${resolvedRecord.ButtonIds.join(",")}; Layout=${resolvedRecord.LayoutMode}`
    );
    await openToolPopout({
      programId: args.program.ProgramTabId,
      panelId: args.panel.Id,
      panelName: args.panel.Name,
      ownerButtonId: args.ownerButton.Id,
      buttonIds: resolvedRecord.ButtonIds,
      layoutMode: resolvedRecord.LayoutMode,
      buttonLabel: args.buttonLabel,
      bounds: resolvedRecord.Bounds
    });
    pushFrontendEvent(
      surface,
      `Tool popout opened. Owner=${args.ownerButton.Id}; Layout=${resolvedRecord.LayoutMode}`
    );
  };

  const openIndividualPopoutsForButtons = async (buttons: FlowCellButton[]) => {
    for (const button of buttons) {
      const popoutButtons = isSmartAxisOwnerButton(button)
        ? selectedPanel.Buttons.filter((entry) => isSmartAxisButton(entry))
        : [button];
      await openToolWindow({
        program: selectedProgram,
        panel: selectedPanel,
        ownerButton: button,
        buttons: popoutButtons,
        layoutMode: "Individual",
        buttonLabel: button.Label
      });
    }
  };

  const openSelectedIndividualPopouts = async () => {
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Pop Tools Individual requested. Count=${selectedPopButtons.length}`
    );
    await openIndividualPopoutsForButtons(selectedPopButtons);
    setSelectedPopButtonIds([]);
  };

  const openSelectedGroupedPopout = async () => {
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Pop Tools Group requested. Count=${selectedRegularButtons.length}`
    );
    if (selectedRegularButtons.length === 0) {
      return;
    }

    await openToolWindow({
      program: selectedProgram,
      panel: selectedPanel,
      ownerButton: selectedRegularButtons[0],
      buttons: selectedRegularButtons,
      layoutMode: "Group",
      buttonLabel:
        selectedRegularButtons.length === 1
          ? selectedRegularButtons[0].Label
          : `${selectedRegularButtons.length} Buttons`
    });
    setSelectedPopButtonIds([]);
  };

  const openSelectedPopoutsIfAny = async (): Promise<boolean> => {
    if (selectedPopButtons.length === 0) {
      return false;
    }
    if (selectedToolOwnerButtons.length > 0 || selectedRegularButtons.length <= 1) {
      await openSelectedIndividualPopouts();
      return true;
    }
    await openSelectedGroupedPopout();
    return true;
  };

  const openAllToolSetPopoutsIfEligible = async (panel: FlowCellPanel): Promise<boolean> => {
    if (windowContext.kind !== "main" || !isBlenderToolSetPanel(selectedProgram, panel)) {
      return false;
    }

    const toolOwnerButtons = panel.Buttons.filter((button) => isToolOwnerPopCandidate(button));
    if (toolOwnerButtons.length === 0) {
      return false;
    }

    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Pop Tool Set requested. Count=${toolOwnerButtons.length}`
    );
    await openIndividualPopoutsForButtons(toolOwnerButtons);
    setSelectedPopButtonIds([]);
    return true;
  };

  const openPanelFanPopout = async (panel: FlowCellPanel) => {
    if (panel.Buttons.length === 0) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Fan requested for ${panel.Name}, but the panel has no buttons.`
      );
      return;
    }

    const ownerButtonId = buildPanelFanOwnerId(panel.Id);
    const existing = findToolPopoutByOwner(
      state,
      selectedProgram.ProgramTabId,
      panel.Id,
      ownerButtonId
    );
    if (existing?.LayoutMode === "PanelFan") {
      const nextState = removeToolPopout(
        state,
        selectedProgram.ProgramTabId,
        panel.Id,
        ownerButtonId
      );
      await persistState(nextState);
      await closeToolPopout(selectedProgram.ProgramTabId, panel.Id, ownerButtonId);
      return;
    }

    const ownerButton: FlowCellButton = {
      Id: ownerButtonId,
      Kind: "host_action",
      command_id: "flowcell.run_builtin",
      Label: panel.Name,
      Target: "panel-fan-owner",
      Tooltip: `Fan out ${panel.Name}`,
      style_group_id: miscStyleGroup?.id
    };

    await openToolWindow({
      program: selectedProgram,
      panel,
      ownerButton,
      buttons: panel.Buttons,
      layoutMode: "PanelFan",
      buttonLabel: panel.Name
    });
  };

  const openCompoundToolPopout = async (
    program: FlowCellProgram,
    panel: FlowCellPanel,
    button: FlowCellButton
  ) => {
    const popoutButtons = isSmartAxisOwnerButton(button)
      ? panel.Buttons.filter((entry) => isSmartAxisButton(entry))
      : [button];
    await openToolWindow({
      program,
      panel,
      ownerButton: button,
      buttons: popoutButtons,
      layoutMode: "Individual",
      buttonLabel: button.Label
    });
  };

  const openSmartAxisPopout = async (
    program: FlowCellProgram,
    panel: FlowCellPanel,
    buttons: FlowCellButton[]
  ) => {
    const ownerButton = buttons.find((button) => isSmartAxisOwnerButton(button)) ?? buttons[0];
    if (!ownerButton) {
      return;
    }

    await openToolWindow({
      program,
      panel,
      ownerButton,
      buttons,
      layoutMode: "Group",
      buttonLabel: ownerButton.Label
    });
  };

  const togglePopSelection = (buttonId: string) => {
    setSelectedPopButtonIds((current) =>
      current.includes(buttonId)
        ? current.filter((entry) => entry !== buttonId)
        : [...current, buttonId]
    );
  };

  const handlePanelButtonActivate = async (
    program: FlowCellProgram,
    panel: FlowCellPanel,
    button: FlowCellButton
  ) => {
    if (
      isAlignmentOwnerButton(button) ||
      isFlattenRevolveOwnerButton(button) ||
      isQuickRotateGroupOwnerButton(button) ||
      isSmartAxisOwnerButton(button)
    ) {
      await openCompoundToolPopout(program, panel, button);
      return;
    }

    await activateButton(program, panel, button);
  };

  const handleHostButtonActivate = async (button: FlowCellButton) => {
    await handlePanelButtonActivate(selectedProgram, selectedPanel, button);
  };

  const updateFlattenRevolveValue = async (
    ownerButton: FlowCellButton,
    field: keyof FlattenRevolveValues,
    value: string | number
  ) => {
    persistLatestLocalMutation((currentState) =>
      updateToolOptionState(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        ownerButton.Id,
        "flatten_revolve",
        {
          ...normalizeFlattenRevolveValues(
            getToolOptionState(
              currentState,
              selectedProgram.ProgramTabId,
              selectedPanel.Id,
              ownerButton.Id,
              "flatten_revolve"
            )?.Values
          ),
          [field]: value
        }
      )
    );
  };

  const updateQuickRotateGroupValue = (
    ownerButton: FlowCellButton,
    field: keyof QuickRotateGroupValues,
    value: string | number
  ) => {
    persistLatestLocalMutation((currentState) =>
      updateToolOptionState(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        ownerButton.Id,
        "quick_rotate_group",
        {
          ...normalizeQuickRotateGroupValues(
            getToolOptionState(
              currentState,
              selectedProgram.ProgramTabId,
              selectedPanel.Id,
              ownerButton.Id,
              "quick_rotate_group"
            )?.Values
          ),
          [field]: value
        }
      )
    );
  };

  const handleQuickRotateGroupApply = async (
    ownerButton: FlowCellButton,
    direction: "negative" | "positive",
    angleOverride?: number
  ) => {
    setPopoutContextMenu(null);
    const values = normalizeQuickRotateGroupValues(
      getToolOptionState(
        state,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        ownerButton.Id,
        "quick_rotate_group"
      )?.Values
    );
    const resolvedAngle = Math.abs(
      Number.isFinite(angleOverride ?? NaN) ? Number(angleOverride) : values.AngleDeg
    );
    const signedAngle = direction === "negative" ? -resolvedAngle : resolvedAngle;
    const sourceButton = buildVirtualToolButton(
      ownerButton,
      `${ownerButton.Id}_quick_rotate_group_go_${direction}`,
      direction === "negative" ? "Negative" : "Positive",
      direction === "negative"
        ? "Rotate by the entered negative angle."
        : "Rotate by the entered positive angle."
    );
    await activateToolAction({
      program: selectedProgram,
      panel: selectedPanel,
      ownerButton,
      sourceButton,
      toolId: "quick_rotate_group",
      toolCommand: "apply",
      childSlotId: `quick-rotate-${direction}`,
      toolAction: `quick_rotate_group.${direction}`,
      selectedButtonId: ownerButton.Id,
      kind: "tool_surface",
      toolOptionState: {
        ...values,
        AngleDeg: resolvedAngle
      },
      payload: {
        command: "apply",
        axis: values.Axis,
        center_mode: values.CenterMode,
        operation_mode: values.OperationMode,
        angle_deg: signedAngle
      }
    });
  };

  const handleQuickRotateGroupPreset = async (
    ownerButton: FlowCellButton,
    angleDeg: number
  ) => {
    setPopoutContextMenu(null);
    updateQuickRotateGroupValue(ownerButton, "AngleDeg", angleDeg);
    await handleQuickRotateGroupApply(ownerButton, "positive", angleDeg);
  };

  const handleFlattenRevolveAction = async (
    ownerButton: FlowCellButton,
    action: "flatten_profile" | "generate_revolve"
  ) => {
    setPopoutContextMenu(null);
    const values = normalizeFlattenRevolveValues(
      getToolOptionState(
        state,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        ownerButton.Id,
        "flatten_revolve"
      )?.Values
    );
    const sourceButton = buildVirtualToolButton(
      ownerButton,
      `${ownerButton.Id}_${action}`,
      action === "flatten_profile" ? "Flatten" : "Revolve",
      action === "flatten_profile"
        ? "Flatten the active mesh into a profile."
        : "Generate the revolve output."
    );
    await activateToolAction({
      program: selectedProgram,
      panel: selectedPanel,
      ownerButton,
      sourceButton,
      toolId: "flatten_revolve",
      toolCommand: action,
      childSlotId:
        action === "flatten_profile"
          ? "flatten-revolve-flatten"
          : "flatten-revolve-revolve",
      toolAction: action,
      selectedButtonId: ownerButton.Id,
      kind: "tool_surface",
      toolOptionState: {
        ...values
      },
      payload: {
        flatten_axis: values.FlattenAxis,
        revolve_axis: values.RevolveAxis,
        center_mode: values.CenterMode,
        angle_deg: values.AngleDeg,
        revolve_steps: values.RevolveSteps,
        merge_distance: values.MergeDistance
      }
    });
  };

  const handleAlignmentAction = async (
    ownerButton: FlowCellButton,
    axis: "X" | "Y" | "Z" | "ALL",
    action: "min" | "center" | "max" | "surface" | "geo" | "center_everything"
  ) => {
    setPopoutContextMenu(null);
    const currentModifiers = getAlignmentToolModifiers(
      state,
      selectedProgram.ProgramTabId,
      selectedPanel.Id,
      ownerButton.Id
    );

    if (action === "center_everything") {
      const sourceButton = buildVirtualToolButton(
        ownerButton,
        `${ownerButton.Id}_alignment_center_everything`,
        "Center Everything",
        "Center all moved objects to the active reference object."
      );
      await activateToolAction({
        program: selectedProgram,
        panel: selectedPanel,
        ownerButton,
        sourceButton,
        toolId: "alignment",
        toolCommand: "center_all",
        childSlotId: "alignment-center-everything",
        toolAction: "alignment.center_everything",
        selectedButtonId: ownerButton.Id,
        kind: "tool_action",
        payload: {
          action_type: "center_all"
        }
      });
      return;
    }

    if (axis === "ALL") {
      return;
    }

    const slotId = `alignment-${axis.toLowerCase()}-${action}`;
    const sourceButton = buildVirtualToolButton(
      ownerButton,
      `${ownerButton.Id}_${slotId}`,
      `${axis} ${action}`,
      `${axis} ${action} alignment action`
    );

    if (action === "surface" || action === "geo") {
      const desiredModifier = action === "surface" ? "SURFACE" : "GEOCENTER";
      const nextModifier = currentModifiers[axis] === desiredModifier ? "" : desiredModifier;
      const result = await activateToolAction({
        program: selectedProgram,
        panel: selectedPanel,
        ownerButton,
        sourceButton,
        toolId: "alignment",
        toolCommand: "toggle_modifier",
        childSlotId: slotId,
        toolAction: `alignment.${axis.toLowerCase()}.${action}`,
        selectedButtonId: ownerButton.Id,
        kind: "tool_action",
        payload: {
          action_type: "toggle_modifier",
          axis,
          modifier: desiredModifier
        }
      });

      if (result.ok) {
        persistLatestLocalMutation((currentState) =>
          updateAlignmentToolModifiers(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            ownerButton.Id,
            {
              ...getAlignmentToolModifiers(
                currentState,
                selectedProgram.ProgramTabId,
                selectedPanel.Id,
                ownerButton.Id
              ),
              [axis]: nextModifier
            }
          )
        );
      }
      return;
    }

    await activateToolAction({
      program: selectedProgram,
      panel: selectedPanel,
      ownerButton,
      sourceButton,
      toolId: "alignment",
      toolCommand: "align_axis",
      childSlotId: slotId,
      toolAction: `alignment.${axis.toLowerCase()}.${action}`,
      selectedButtonId: ownerButton.Id,
      kind: "tool_action",
      payload: {
        action_type: "align_axis",
        axis,
        mode: action.toUpperCase(),
        modifier: currentModifiers[axis]
      }
    });
  };

  const handleSmartAxisAction = async (
    buttons: FlowCellButton[],
    action: "baseline" | "cycle_x" | "cycle_y" | "cycle_z" | "toggle_live"
  ) => {
    setPopoutContextMenu(null);
    const ownerButton = buttons.find((button) => isSmartAxisOwnerButton(button)) ?? buttons[0];
    if (!ownerButton) {
      return;
    }

    const sourceButton =
      buttons.find((button) => getSmartAxisCommandForButton(button) === action) ?? ownerButton;
    const currentOptionState = toObjectRecord(
      getToolOptionState(
        state,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        ownerButton.Id,
        "smart_axis_lock"
      )?.Values
    );
    const currentSmartAxisState = normalizeSmartAxisState(currentOptionState);
    const result = await activateToolAction({
      program: selectedProgram,
      panel: selectedPanel,
      ownerButton,
      sourceButton,
      toolId: "smart_axis_lock",
      toolCommand: action,
      childSlotId: `smart-axis-${action.replace(/_/g, "-")}`,
      toolAction: action,
      selectedButtonId: sourceButton.Id,
      kind: "tool_surface",
      toolOptionState: currentOptionState,
      payload: {}
    });

    if (result.ok) {
      const nextToolOptionState = extractToolOptionState(result);
      if (nextToolOptionState) {
        const resolvedToolOptionState =
          action === "baseline"
            ? {
                ...nextToolOptionState,
                Modes: currentSmartAxisState.Modes,
                LiveEnabled: currentSmartAxisState.LiveEnabled
              }
            : nextToolOptionState;
        persistLatestLocalMutation((currentState) =>
          updateToolOptionState(
            currentState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            ownerButton.Id,
            "smart_axis_lock",
            resolvedToolOptionState
          )
        );
      }
    }
  };

  const savePanelFanOptions = async () => {
    if (!selectedProgram || !selectedPanel) {
      return;
    }
    const surface = inferSurfaceName(windowContext);
    const nextOptions =
      panelFanOptionsDraft ?? selectedPanel.FanOptions ?? DEFAULT_PANEL_FAN_OPTIONS;

    await logFrontendEvent(
      surface,
      `Saving panel fan options. Panel=${selectedPanel.Name}; Layout=${nextOptions.layout}; Placement=${nextOptions.placement}`
    ).catch(() => {});
    await persistLatestMutation((currentState) =>
      updatePanelFanOptions(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        nextOptions
      )
    );
    pushFrontendEvent(
      surface,
      `Saved panel fan options. Panel=${selectedPanel.Name}; Layout=${nextOptions.layout}; Placement=${nextOptions.placement}`
    );
    await getCurrentWindow().close().catch((error) => {
      pushFrontendEvent(
        surface,
        `Panel fan options close failed. ${error instanceof Error ? error.message : String(error)}`
      );
    });
  };

  const selectPanel = async (panel: FlowCellPanel) => {
    setSurfaceMode("panel");
    await persistState(updatePanelSelection(state, selectedProgram.ProgramTabId, panel.Id));
  };

  const handlePanelPopAction = async (panel: FlowCellPanel) => {
    if (windowContext.kind === "main" && panel.Id === selectedPanel.Id) {
      if (await openSelectedPopoutsIfAny()) {
        return;
      }
      if (await openAllToolSetPopoutsIfEligible(panel)) {
        return;
      }
    }

    await togglePanelPopout(panel);
  };

  const handlePanelFanAction = async (panel: FlowCellPanel) => {
    await openPanelFanPopout(panel);
  };

  const handlePanelFanOptionsAction = async (panel: FlowCellPanel) => {
    if (!selectedProgram) {
      return;
    }
    await openPanelFanOptionsWindow({
      programId: selectedProgram.ProgramTabId,
      panelId: panel.Id,
      panelName: panel.Name
    });
  };

  const handleOpenButtonAppearanceAction = async () => {
    if (
      !selectedProgram ||
      !selectedPanel ||
      !buttonAppearanceTargetButton ||
      isToolSetPanelSelection
    ) {
      return;
    }

    await openButtonAppearanceWindow({
      programId: selectedProgram.ProgramTabId,
      panelId: selectedPanel.Id,
      panelName: selectedPanel.Name,
      buttonId: buttonAppearanceTargetButton.Id
    });
  };

  const handleSaveButtonAppearance = async (buttonId: string, draft: ImportedSkin) => {
    if (!selectedProgram || !selectedPanel) {
      return;
    }

    const applyToAllButtons = buttonId === BUTTON_APPEARANCE_ALL_BUTTONS_ID;
    const savedButtonLabel = applyToAllButtons
      ? `${selectedPanel.Name} / all buttons`
      : selectedPanel.Buttons.find((button) => button.Id === buttonId)?.Label ?? buttonId;
    const importedSkinId = applyToAllButtons
      ? buildPanelButtonImportedSkinId(selectedProgram.ProgramTabId, selectedPanel.Id)
      : buildDedicatedButtonImportedSkinId(
          selectedProgram.ProgramTabId,
          selectedPanel.Id,
          buttonId
        );
    const styleGroupId = applyToAllButtons
      ? buildPanelButtonStyleGroupId(selectedProgram.ProgramTabId, selectedPanel.Id)
      : buildDedicatedButtonStyleGroupId(selectedProgram.ProgramTabId, selectedPanel.Id, buttonId);

    await persistLatestMutation((currentState) => {
      const currentPanel = findPanel(currentState, selectedProgram.ProgramTabId, selectedPanel.Id);
      if (!currentPanel) {
        return currentState;
      }

      const targetButtons = applyToAllButtons
        ? currentPanel.Buttons
        : currentPanel.Buttons.filter((button) => button.Id === buttonId);
      if (targetButtons.length === 0) {
        return currentState;
      }
      const targetButton = targetButtons[0];

      const currentStyleGroups = currentState.StyleGroups ?? [];
      const currentImportedSkins = currentState.ImportedSkins ?? [];
      const existingDedicatedGroup = resolveStyleGroup(currentStyleGroups, styleGroupId);
      const sourceStyleGroup = resolveStyleGroup(
        currentStyleGroups,
        targetButtons.find((button) => (button.style_group_id ?? "").trim().length > 0)
          ?.style_group_id ?? ""
      );
      const primaryLabel = applyToAllButtons ? selectedPanel.Name : targetButtons[0].Label;
      const nextImportedSkin: ImportedSkin = {
        ...draft,
        id: importedSkinId,
        name: draft.name.trim() || `${primaryLabel} Skin`
      };
      const nextStyleGroup: StyleGroup = {
        id: styleGroupId,
        index:
          existingDedicatedGroup?.index ??
          currentStyleGroups.reduce((maxIndex, entry) => Math.max(maxIndex, entry.index ?? 0), 0) +
            1,
        name: `Button · ${targetButton.Label}`,
        skinId: "imported-skin",
        importedSkinId,
        accent:
          existingDedicatedGroup?.accent ??
          sourceStyleGroup?.accent ??
          "#ffb870"
      };
      const nextStyleGroups = currentStyleGroups.some((entry) => entry.id === styleGroupId)
        ? currentStyleGroups.map((entry) =>
            entry.id === styleGroupId ? nextStyleGroup : entry
          )
        : [...currentStyleGroups, nextStyleGroup];
      const nextImportedSkins = currentImportedSkins.some((entry) => entry.id === importedSkinId)
        ? currentImportedSkins.map((entry) =>
            entry.id === importedSkinId ? nextImportedSkin : entry
          )
        : [...currentImportedSkins, nextImportedSkin];

      const nextState = updateStyleGroups(
        updateImportedSkins(currentState, nextImportedSkins),
        nextStyleGroups
      );
      return applyToAllButtons
        ? updatePanelButtonStyleGroup(
            nextState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            styleGroupId
          )
        : updateButtonStyleGroup(
            nextState,
            selectedProgram.ProgramTabId,
            selectedPanel.Id,
            buttonId,
            styleGroupId
          );
    });

    setButtonAppearanceButtonId(buttonId);
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      applyToAllButtons
        ? `Saved shared button appearance for ${savedButtonLabel}.`
        : `Saved dedicated appearance for ${selectedPanel.Name} / ${savedButtonLabel}.`
    );
  };

  const handleAddProgram = () => {
    const defaultSavedProgram =
      savedPrograms.find(
        (record) =>
          !state?.Programs.some((program) => program.ProgramTabId === record.SourceProgramTabId)
      ) ?? savedPrograms[0];
    setProgramManager({
      programName: "",
      exePath: "",
      selectedSavedProgramId: defaultSavedProgram?.SourceProgramTabId ?? null
    });
  };

  const handleBrowseProgramExe = async () => {
    const initialExeFolder =
      programManager?.exePath.trim().replace(/[\\/][^\\/]+$/, "") ||
      selectedProgram?.ProgramConfig?.ExePath?.replace(/[\\/][^\\/]+$/, "") ||
      "";
    const exePath = await showOpenExeDialog(initialExeFolder);
    if (!exePath) {
      return;
    }

    setProgramManager((current) =>
      current
        ? {
            ...current,
            exePath
          }
        : current
    );
  };

  const handleCreateProgram = async () => {
    if (!programManager || !runtime) {
      return;
    }

    const programName = programManager.programName.trim();
    const exePath = programManager.exePath.trim();
    if (!programName || !exePath) {
      return;
    }

    try {
      const nextState = await persistLatestMutation((currentState) =>
        addProgram(currentState, {
          programName,
          exePath,
          repoRoot: runtime.repoRoot
        })
      );
      setProgramManager(null);
      setSurfaceMode("panel");
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Added program tab ${formatProgramDisplayLabel(getSelectedProgram(nextState))}.`
      );
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Add Program failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleRestoreSavedProgram = async () => {
    const sourceProgramTabId = programManager?.selectedSavedProgramId ?? 0;
    const recordLabel = selectedSavedProgram
      ? formatProgramDisplayLabel(selectedSavedProgram.Program)
      : `Program ${sourceProgramTabId}`;
    if (!sourceProgramTabId) {
      return;
    }

    try {
      const nextState = await persistLatestMutation((currentState) =>
        restoreSavedProgram(currentState, sourceProgramTabId)
      );
      await reopenProgramWindows(nextState, sourceProgramTabId);
      setProgramManager(null);
      setSurfaceMode("panel");
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Restored ${recordLabel}.`
      );
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Restore Program failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleSaveProgram = async (program: FlowCellProgram) => {
    setProgramContextMenu(null);
    try {
      const latest = await loadState();
      const currentState = await captureLivePopoutBounds(
        applyBindingsToState(ensureStateDefaults(latest.state), latest.bindings)
      );
      const nextState = saveProgramSnapshot(currentState, program.ProgramTabId);
      setRuntime(latest.runtime);
      setBindingsState(latest.bindings);
      await persistState(nextState);
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Saved ${formatProgramDisplayLabel(program)} for restore.`
      );
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Save Program failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleDeleteProgram = async (program: FlowCellProgram) => {
    setProgramContextMenu(null);
    if (!window.confirm(`Delete "${formatProgramDisplayLabel(program)}" from the live workspace?`)) {
      return;
    }

    try {
      const nextState = await persistLatestMutation((currentState) =>
        deleteProgram(currentState, program.ProgramTabId)
      );
      await closeProgramWindows(program.ProgramTabId);
      setSelectedPopButtonIds([]);
      setButtonContextMenu(null);
      scheduleSelectedButtonRef(null);
      setBindTarget((current) =>
        current?.programId === program.ProgramTabId ? null : current
      );
      if (nextState.Programs.length === 0) {
        setSurfaceMode("panel");
      }
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Deleted live program ${formatProgramDisplayLabel(program)}.`
      );
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Delete Program failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleAddPanel = async () => {
    if (!selectedProgram) {
      return;
    }
    const panelName = window.prompt("Add Panel", "")?.trim();
    if (!panelName) {
      return;
    }

    await persistState(addPanel(state, selectedProgram.ProgramTabId, panelName));
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Added panel ${panelName}.`
    );
  };

  const handleAddScriptButton = async () => {
    try {
      pushFrontendEvent(inferSurfaceName(windowContext), "Add Script dialog opened.");
      const isBlender = getProgramTemplateKey(selectedProgram) === "blender";
      const title = isBlender
        ? `Choose ${selectedProgram.ProgramConfig?.NormalizedName ?? "Blender"} button source (.py or .ps1)`
        : `Choose ${selectedProgram.ProgramConfig?.NormalizedName ?? `Program ${selectedProgram.ProgramTabId}`} script`;
      const selectedPaths = await showOpenFileDialog({
        title,
        filter: buildProgramScriptDialogFilter(selectedProgram),
        initialDirectory: selectedProgram.ProgramConfig?.ScriptFolder,
        multiselect: true
      });

      if (selectedPaths.length === 0) {
        pushFrontendEvent(
          inferSurfaceName(windowContext),
          "Add Script dialog cancelled."
        );
        return;
      }

      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Add Script dialog returned ${selectedPaths.length} path(s).`
      );

      if (isBlender) {
        const installResult = await installBlenderButtons({
          selectedPaths,
          panelName: selectedPanel.Name
        });
        const installedCountValue = installResult["InstalledCount"];
        const installedCount =
          typeof installedCountValue === "number"
            ? installedCountValue
            : Number(installedCountValue ?? 0);
        const statusMessage =
          typeof installResult["StatusMessage"] === "string"
            ? installResult["StatusMessage"]
            : typeof installResult["status_message"] === "string"
              ? installResult["status_message"]
              : `Installed ${Number.isFinite(installedCount) ? installedCount : 0} Blender button(s).`;
        const reloaded = await loadState();
        if (windowContext) {
          await hydrateLoadedState(reloaded, windowContext, {
            captureLiveBounds: false
          });
        }
        pushFrontendEvent(
          inferSurfaceName(windowContext),
          statusMessage
        );
        return;
      }

      const nextButtons = buildScriptButtonsFromPaths(
        selectedPaths,
        "flowcell.run_script"
      );
      await persistState(
        addButtonsToPanel(
          state,
          selectedProgram.ProgramTabId,
          selectedPanel.Id,
          nextButtons
        )
      );
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Added ${nextButtons.length} script button(s) to ${selectedPanel.Name}.`
      );
    } catch (error) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Add Script failed. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const selectBindTarget = (targetState: BindTargetState, message?: string) => {
    const refreshed = refreshBindTargetState(targetState);
    setBindTarget(refreshed);
    setBindProgramFilter(String(refreshed.programId));
    setBindShortcutInput(formatShortcutForDisplay(refreshed.button.Shortcut?.trim() ?? ""));
    setBindFeedback(
      message ??
        `Binding target: ${refreshed.button.Label || refreshed.button.Target || "Unnamed target"}.`
    );
    setSurfaceMode("binds");
  };

  const handleSelectWorkspaceBindTarget = (button: FlowCellButton) => {
    selectBindTarget(
      {
        button,
        programId: selectedProgram.ProgramTabId,
        panelId: selectedPanel.Id,
        source: "workspace"
      },
      `Binding target: ${button.Label}.`
    );
  };

  const handleOpenMacroPicker = async (purpose: MacroPickerState["purpose"]) => {
    const options = await listRecordedMacros();
    if (options.length === 0) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        "No recorded macros exist yet."
      );
      return;
    }

    setMacroPicker({
      options,
      selectedId: options[0].id,
      purpose
    });
  };

  const handleConfirmMacroPicker = async () => {
    if (!macroPicker) {
      return;
    }
    const choice =
      macroPicker.options.find((entry) => entry.id === macroPicker.selectedId) ?? null;
    if (!choice) {
      return;
    }

    if (macroPicker.purpose === "bind-target") {
      setMacroPicker(null);
      selectBindTarget(
        {
          button: buildDirectMacroBindButton(choice),
          programId: selectedProgram.ProgramTabId,
          source: "macro"
        },
        `Binding target: ${choice.label}.`
      );
      return;
    }

    const nextButton: FlowCellButton = {
      Id: `button_${createClientId("")}`,
      Kind: "macro",
      command_id: "flowcell.run_macro",
      Label: choice.label,
      Target: choice.id,
      Shortcut: "",
      BindingId: 0,
      style_group_id: ""
    };

    await persistState(
      addButtonsToPanel(
        state,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        [nextButton]
      )
    );
    setMacroPicker(null);
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Added macro button ${choice.label} to ${selectedPanel.Name}.`
    );
  };

  const handleChooseScriptBindTarget = async () => {
    try {
      const selectedPaths = await showOpenFileDialog({
        title: `Choose ${selectedProgram.ProgramConfig?.NormalizedName ?? "Program"} script to bind`,
        filter: buildProgramScriptDialogFilter(selectedProgram),
        initialDirectory: selectedProgram.ProgramConfig?.ScriptFolder,
        multiselect: false
      });
      if (selectedPaths.length === 0) {
        return;
      }

      selectBindTarget(
        {
          button: buildDirectScriptBindButton(selectedPaths[0]),
          programId: selectedProgram.ProgramTabId,
          source: "script"
        },
        `Binding target: ${labelFromTargetPath(selectedPaths[0])}.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindFeedback(message);
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Choose bind script failed. ${message}`
      );
    }
  };

  const reloadAppFromDisk = async (options?: {
    captureLiveBounds?: boolean;
  }): Promise<LoadStateResponse> => {
    const payload = await loadState();
    if (windowContext) {
      await hydrateLoadedState(payload, windowContext, options);
    }
    return payload;
  };

  const handleSaveCurrentBind = async () => {
    if (!currentBindTarget) {
      setBindFeedback("Choose a button, script, or macro first.");
      return;
    }
    if (!parsedBindShortcut.trim()) {
      setBindFeedback("Enter a shortcut before binding.");
      return;
    }
    if (bindConflict) {
      setBindFeedback("That shortcut is already in use.");
      return;
    }

    try {
      const shortcut = normalizeShortcut(parsedBindShortcut);
      const result = await saveButtonBinding({
        button: currentBindTarget.button,
        programId: currentBindTarget.programId,
        shortcut
      });
      await reloadAppFromDisk({ captureLiveBounds: false });
      setBindTarget((current) => (current ? refreshBindTargetState(current) : current));
      setBindShortcutInput(formatShortcutForDisplay(shortcut));
      setBindFeedback(result.message);
      pushFrontendEvent(inferSurfaceName(windowContext), result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindFeedback(message);
      pushFrontendEvent(inferSurfaceName(windowContext), `Save bind failed. ${message}`);
    }
  };

  const handleClearCurrentBind = async () => {
    if (!currentBindTarget) {
      setBindFeedback("Choose a button, script, or macro first.");
      return;
    }

    try {
      const result = await clearButtonBinding({
        button: currentBindTarget.button,
        programId: currentBindTarget.programId
      });
      await reloadAppFromDisk({ captureLiveBounds: false });
      setBindTarget((current) => (current ? refreshBindTargetState(current) : current));
      setBindShortcutInput("");
      setBindFeedback(result.message);
      pushFrontendEvent(inferSurfaceName(windowContext), result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindFeedback(message);
      pushFrontendEvent(inferSurfaceName(windowContext), `Clear bind failed. ${message}`);
    }
  };

  const handleSaveLayout = async () => {
    const nameInput = window.prompt("Save Layout As (optional)", "") ?? "";
    const refreshed = await loadState();
    const latestState = await captureLivePopoutBounds(
      applyBindingsToState(ensureStateDefaults(refreshed.state), refreshed.bindings)
    );
    await saveState(latestState, { broadcast: false });
    const layoutPath = await saveLayoutSnapshot(
      nameInput.trim() || null,
      buildLayoutSnapshot(latestState, refreshed.runtime)
    );
    pushFrontendEvent(
      inferSurfaceName(windowContext),
      `Saved layout to ${layoutPath}.`
    );
  };

  const handleOpenLayoutPicker = async () => {
    const files = await listLayoutFiles();
    if (files.length === 0) {
      pushFrontendEvent(
        inferSurfaceName(windowContext),
        "No saved layouts were found."
      );
      return;
    }

    await openLayoutPickerWindow();
  };

  const handleLoadLayout = async () => {
    if (!layoutPicker || layoutLoadInFlightRef.current) {
      return;
    }

    layoutLoadInFlightRef.current = true;
    const selectedPath = layoutPicker.selectedPath;
    if (!selectedPath) {
      layoutLoadInFlightRef.current = false;
      return;
    }
    try {
      const snapshot = (await loadLayoutSnapshot(selectedPath)) as LayoutSnapshot;
      const nextState = applyLayoutSnapshot(state, snapshot);
      if (windowContext.kind === "main") {
        setLayoutPicker(null);
      }
      await persistState(nextState);

      for (const panelPopout of snapshot.PanelPopouts ?? []) {
        const panel = findPanel(nextState, panelPopout.ProgramTabId, panelPopout.PanelId);
        if (!panel) {
          continue;
        }
        await openPanelPopout({
          programId: panelPopout.ProgramTabId,
          panelId: panelPopout.PanelId,
          panelName: panel.Name,
          buttonCount: panel.Buttons.length,
          bounds: panelPopout.Bounds
        });
      }

      for (const toolPopout of snapshot.ToolPopouts ?? []) {
        const ownerButtonId = toolPopout.ButtonIds[0];
        if (!ownerButtonId) {
          continue;
        }
        const panel = findPanel(nextState, toolPopout.ProgramTabId, toolPopout.PanelId);
        const ownerButton = findButton(
          nextState,
          toolPopout.ProgramTabId,
          toolPopout.PanelId,
          ownerButtonId
        );
        if (!panel || (toolPopout.LayoutMode !== "PanelFan" && !ownerButton)) {
          continue;
        }
        const layoutMode = resolveEffectiveToolPopoutLayoutMode(
          toolPopout.LayoutMode,
          ownerButton ?? undefined
        );
        await openToolPopout({
          programId: toolPopout.ProgramTabId,
          panelId: toolPopout.PanelId,
          panelName: panel.Name,
          ownerButtonId,
          buttonIds: toolPopout.ButtonIds,
          layoutMode,
          buttonLabel:
            layoutMode === "PanelFan" ? panel.Name : ownerButton!.Label,
          bounds: toolPopout.Bounds ?? null
        });
      }

      pushFrontendEvent(
        inferSurfaceName(windowContext),
        `Loaded layout from ${selectedPath}.`
      );
      if (windowContext.kind === "layout-picker") {
        await getCurrentWindow().close().catch(() => {});
      }
    } finally {
      layoutLoadInFlightRef.current = false;
    }
  };

  const openButtonContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    button: FlowCellButton
  ) => {
    if (windowContext.kind !== "main" || !selectedProgram || !selectedPanel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    scheduleSelectedButtonRef({
      programId: selectedProgram.ProgramTabId,
      panelId: selectedPanel.Id,
      buttonId: button.Id
    });
    setPopoutContextMenu(null);
    setProgramContextMenu(null);
    setButtonContextMenu({
      buttonId: button.Id,
      left: clamp(event.clientX, 8, Math.max(window.innerWidth - 204, 8)),
      top: clamp(event.clientY, 8, Math.max(window.innerHeight - 188, 8))
    });
  };

  const openProgramContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    program: FlowCellProgram
  ) => {
    if (windowContext.kind !== "main") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setPopoutContextMenu(null);
    setButtonContextMenu(null);
    setProgramContextMenu({
      programId: program.ProgramTabId,
      left: clamp(event.clientX, 8, Math.max(window.innerWidth - 204, 8)),
      top: clamp(event.clientY, 8, Math.max(window.innerHeight - 144, 8))
    });
  };

  const handleRenameButton = async (button: FlowCellButton) => {
    setButtonContextMenu(null);
    const nextLabel = window.prompt("Rename Button", button.Label)?.trim();
    if (!nextLabel || nextLabel === button.Label) {
      return;
    }

    await persistLatestMutation((currentState) =>
      updateButtonLabel(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        button.Id,
        nextLabel
      )
    );
  };

  const handleEditButtonDescription = async (button: FlowCellButton) => {
    setButtonContextMenu(null);
    const nextTooltipRaw = window.prompt("Edit Description", button.Tooltip ?? "");
    if (nextTooltipRaw === null) {
      return;
    }
    const nextTooltip = nextTooltipRaw.trim();
    if (nextTooltip === (button.Tooltip ?? "")) {
      return;
    }

    await persistLatestMutation((currentState) =>
      updateButtonTooltip(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        button.Id,
        nextTooltip
      )
    );
  };

  const handleBindButtonShortcut = (button: FlowCellButton) => {
    setButtonContextMenu(null);
    handleSelectWorkspaceBindTarget(button);
  };

  const handleDeleteButton = async (button: FlowCellButton) => {
    setButtonContextMenu(null);
    if (!window.confirm(`Delete "${button.Label}" from ${selectedPanel.Name}?`)) {
      return;
    }

    await persistLatestMutation((currentState) =>
      deleteButtonFromPanel(
        currentState,
        selectedProgram.ProgramTabId,
        selectedPanel.Id,
        button.Id
      )
    );

    setSelectedPopButtonIds((current) => current.filter((entry) => entry !== button.Id));
    scheduleSelectedButtonRef((current) =>
      current?.buttonId === button.Id ? null : current
    );
  };

  const renderButtonHost = (button: FlowCellButton, compact = false) => {
    const checkedForPop = selectedPopButtonIds.includes(button.Id);
    const canPop =
      !compact &&
      windowContext.kind === "main" &&
      (isRegularPopCandidate(button) ||
        (isBlenderToolSetPanel(selectedProgram, selectedPanel) && isToolOwnerPopCandidate(button)));
    const popoutStyleOverride = compact ? popoutRegularStyleGroup : undefined;
    const popoutImportedSkinOverride = compact ? popoutRegularImportedSkin : undefined;
    const buttonStyleGroup =
      popoutStyleOverride ?? resolveStyleGroup(state.StyleGroups, button.style_group_id ?? "");
    const buttonImportedSkin =
      popoutImportedSkinOverride ??
      getImportedSkin(state.ImportedSkins, buttonStyleGroup?.importedSkinId);

    return (
      <div
        key={button.Id}
        className={`button-host ${isAlignmentOwnerButton(button) || isFlattenRevolveOwnerButton(button) || isQuickRotateGroupOwnerButton(button) || isSmartAxisOwnerButton(button) ? "button-host--compound" : ""} ${compact ? "button-host--compact" : ""}`}
      >
        {!compact && canPop ? (
          <div className="button-host__toolbar">
            <label className="button-host__toggle">
              <input
                type="checkbox"
                checked={checkedForPop}
                onChange={() => togglePopSelection(button.Id)}
              />
              <span>Pop</span>
            </label>
          </div>
        ) : null}
        {!compact ? (
          <HostSkinButton
            type="button"
            label={button.Label}
            title={button.Tooltip || button.Label}
            className={
              selectedButton?.Id === button.Id
                ? "button-host__surface-button is-selected"
                : "button-host__surface-button"
            }
            styleGroup={buttonStyleGroup}
            importedSkin={buttonImportedSkin}
            selected={selectedButton?.Id === button.Id}
            highlightKey={`button:${selectedProgram.ProgramTabId}:${selectedPanel.Id}:${button.Id}`}
            onFocus={() =>
              scheduleSelectedButtonRef({
                programId: selectedProgram.ProgramTabId,
                panelId: selectedPanel.Id,
                buttonId: button.Id
              })
            }
            onClick={() => void handleHostButtonActivate(button)}
            onContextMenuCapture={(event) => openButtonContextMenu(event, button)}
          />
        ) : (
          <ButtonCard
            button={button}
            selected={!compact && selectedButton?.Id === button.Id}
            compact={compact}
            styleGroups={state.StyleGroups}
            importedSkins={state.ImportedSkins}
            styleGroupOverride={popoutStyleOverride}
            importedSkinOverride={popoutImportedSkinOverride}
              onSelect={() =>
                scheduleSelectedButtonRef({
                  programId: selectedProgram.ProgramTabId,
                  panelId: selectedPanel.Id,
                  buttonId: button.Id
                })
              }
            onActivate={() => void handleHostButtonActivate(button)}
          />
        )}
      </div>
    );
  };

  const renderPanelButtonGrid = (compact = false) => (
    <div className={compact ? "button-grid button-grid--slim-popout" : "button-grid"}>
      {panelRenderItems.map((item) =>
        item.kind === "smart-axis" ? (
          <div
            key={item.ownerButton.Id}
            className={`button-host button-host--smart-axis ${compact ? "button-host--compact" : ""}`}
          >
            <SmartAxisStrip
              compact={compact}
              label={item.ownerButton.Label}
              panelName={selectedPanel.Name}
              state={normalizeSmartAxisState(
                toObjectRecord(
                  getToolOptionState(
                    state,
                    selectedProgram.ProgramTabId,
                    selectedPanel.Id,
                    item.ownerButton.Id,
                    "smart_axis_lock"
                  )?.Values
                )
              )}
              onAction={(action) => {
                void handleSmartAxisAction(item.buttons, action);
              }}
              styleGroup={compact ? popoutToolStyleGroup : undefined}
              importedSkin={compact ? popoutToolImportedSkin : undefined}
              onPopout={
                compact
                  ? undefined
                  : () => {
                      void openSmartAxisPopout(
                        selectedProgram,
                        selectedPanel,
                        item.buttons
                      );
                    }
              }
            />
          </div>
        ) : (
          renderButtonHost(item.button, compact)
        )
      )}
    </div>
  );

  const renderBindsSurface = () => (
    <div className="binds-page">
      <div className="surface-header">
        <div className="surface-header__meta">
          <h1>Binds</h1>
          <span className="surface-header__panel-name">
            {currentBindTarget?.button.Label ?? "No target selected"}
          </span>
        </div>
        <div className="surface-toolbar">
          <HostSkinButton
            type="button"
            label="Add Script"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={() => void handleChooseScriptBindTarget()}
          />
          <HostSkinButton
            type="button"
            label="Add Macro"
            className="surface-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={() => void handleOpenMacroPicker("bind-target")}
          />
        </div>
      </div>

      <section className="surface-card binds-card">
        <div className="binds-toolbar">
          <label className="bind-editor-field">
            <span>Show</span>
            <select
              value={bindProgramFilter}
              onChange={(event) => setBindProgramFilter(event.target.value)}
            >
              <option value="all">All Binds</option>
              {state.Programs.map((program) => (
                <option key={program.ProgramTabId} value={String(program.ProgramTabId)}>
                  {program.ProgramConfig?.NormalizedName?.trim() ||
                    `Program ${program.ProgramTabId}`}
                </option>
              ))}
            </select>
          </label>
          <label className="bind-editor-field binds-toolbar__target">
            <span>Target</span>
            <input
              type="text"
              readOnly
              value={currentBindTarget?.button.Label ?? ""}
              title={currentBindTarget?.button.Target ?? ""}
              placeholder="Right-click a button or choose Add Script / Add Macro"
            />
          </label>
          <label className="bind-editor-field binds-toolbar__shortcut">
            <span>Shortcut Input</span>
            <input
              type="text"
              value={bindShortcutInput}
              placeholder="Control + Alt + K"
              onChange={(event) => setBindShortcutInput(event.target.value)}
            />
          </label>
          <label className="bind-editor-field binds-toolbar__available">
            <span>Available Shortcuts</span>
            <select
              value=""
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }
                setBindShortcutInput(formatShortcutForDisplay(event.target.value));
              }}
            >
              <option value="">Pick an available shortcut</option>
              {bindAvailableShortcuts.map((shortcut) => (
                <option key={shortcut} value={shortcut}>
                  {formatShortcutForDisplay(shortcut)}
                </option>
              ))}
            </select>
          </label>
          <div className="binds-toolbar__status">
            <span>Current {formatShortcutForDisplay(currentBindShortcut) || "None"}</span>
            <span>{currentBindTarget?.button.Kind ?? "No target"}</span>
          </div>
          <div className="bind-editor-actions">
            <button
              type="button"
              className="surface-action"
              disabled={!currentBindTarget || !bindShortcutInput.trim()}
              onClick={() => void handleSaveCurrentBind()}
            >
              Bind Shortcut
            </button>
            <button
              type="button"
              className="surface-action"
              disabled={!currentBindTarget || !currentBindShortcut}
              onClick={() => void handleClearCurrentBind()}
            >
              Clear Shortcut
            </button>
          </div>
        </div>
        <div className="binds-feedback-row">
          <span className="caption">
            {currentBindTarget?.button.Target ??
              "Select a workspace button, or add a direct script or macro target."}
          </span>
          <span
            className={bindConflict ? "caption bind-editor-feedback is-error" : "caption bind-editor-feedback"}
          >
            {bindConflict ? "That shortcut is already in use." : bindFeedback}
          </span>
        </div>
      </section>

      <section className="surface-card binds-card binds-list-card">
        <div className="binds-list-header">
          <div>
            <span className="eyebrow">Saved Binds</span>
            <h2>{bindListItems.length} Entry{bindListItems.length === 1 ? "" : "ies"}</h2>
          </div>
          <span className="caption">
            {bindProgramFilter === "all"
              ? "Showing every saved script and macro shortcut."
              : "Showing saved binds for the selected program."}
          </span>
        </div>
        {bindListItems.length > 0 ? (
          <div className="binds-list">
            {bindListItems.map((item) => {
              const isSelected =
                currentBindTarget?.button.Target === item.button.Target &&
                currentBindTarget?.button.Kind === item.button.Kind &&
                currentBindTarget?.programId === item.programId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={isSelected ? "binds-list__item is-selected" : "binds-list__item"}
                  onClick={() =>
                    selectBindTarget(
                      {
                        button: item.button,
                        programId: item.programId,
                        panelId: item.panelId,
                        source: item.source
                      },
                      `Binding target: ${item.label}.`
                    )
                  }
                >
                  <span className="binds-list__label">{item.label}</span>
                  <span className="binds-list__meta">{item.programLabel}</span>
                  <span className="binds-list__shortcut">
                    {formatShortcutForDisplay(item.shortcut) || "None"}
                  </span>
                  <span className="binds-list__target" title={item.target}>
                    {item.target}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="binds-empty">
            <span className="caption">
              No binds match this filter yet.
            </span>
          </div>
        )}
      </section>
    </div>
  );

  const renderSlimPopoutShell = (
    content: ReactNode,
    kind: "panel" | "tool",
    variant: "default" | "panel-fan" | "floating-fanout" = "default"
  ) => {
    const shellModeClass =
      windowContext.kind === "button-appearance"
        ? "app-shell--editor-popout"
        : windowContext.kind === "layout-picker"
          ? "app-shell--picker-popout"
          : "";
    const contentModeClass =
      windowContext.kind === "button-appearance"
        ? "slim-popout-shell__content--editor"
        : windowContext.kind === "layout-picker"
          ? "slim-popout-shell__content--picker"
          : "";

    return (
      <div
        className={`app-shell app-shell--${kind}-popout app-shell--slim-popout ${shellModeClass} ${variant === "panel-fan" ? "app-shell--panel-fan-popout" : ""} ${variant === "floating-fanout" ? "app-shell--floating-fanout-popout" : ""}`}
      style={appThemeStyle}
      data-theme-variant={appThemeVariant}
    >
      <main
        className={`slim-popout-shell slim-popout-shell--${kind} ${windowContext.kind === "button-appearance" ? "slim-popout-shell--editor" : ""} ${windowContext.kind === "layout-picker" ? "slim-popout-shell--picker" : ""} ${variant === "panel-fan" ? "slim-popout-shell--panel-fan" : ""} ${variant === "floating-fanout" ? "slim-popout-shell--floating-fanout" : ""}`}
        onPointerDown={() => {
          if (popoutContextMenu) {
            setPopoutContextMenu(null);
          }
        }}
        onPointerDownCapture={(event: ReactPointerEvent<HTMLElement>) => {
          const target = event.target as HTMLElement | null;
          if (
            !spaceDragActive ||
            event.button !== 0 ||
            target?.closest(".button-context-menu")
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setSpaceDragInProgress(true);
          void getCurrentWindow().startDragging().catch((error) => {
            setSpaceDragInProgress(false);
            pushFrontendEvent(
              inferSurfaceName(windowContext),
              `Window drag failed. ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }}
        onContextMenuCapture={(event: ReactMouseEvent<HTMLElement>) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("input, textarea, select, [contenteditable='true']")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (variant === "panel-fan" || variant === "floating-fanout") {
            return;
          }
          const menuWidth = 132;
          const menuHeight = 58;
          const padding = 8;
          setPopoutContextMenu({
            left: Math.max(
              padding,
              Math.min(event.clientX, window.innerWidth - menuWidth - padding)
            ),
            top: Math.max(
              padding,
              Math.min(event.clientY, window.innerHeight - menuHeight - padding)
            )
          });
        }}
      >
        {popoutContextMenu && variant !== "panel-fan" && variant !== "floating-fanout" ? (
          <div
            className="button-context-menu button-context-menu--popout"
            style={{
              left: `${popoutContextMenu.left}px`,
              top: `${popoutContextMenu.top}px`
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPopoutContextMenu(null);
                void handleWindowClose();
              }}
            >
              Close
            </button>
          </div>
        ) : null}
        {variant === "panel-fan" || variant === "floating-fanout" ? null : (
          <div className="slim-popout-shell__controls">
          <div
            className="slim-popout-shell__grabber"
            data-tauri-drag-region="true"
            title="Drag popout"
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              void getCurrentWindow().startDragging().catch((error) => {
                pushFrontendEvent(
                  inferSurfaceName(windowContext),
                  `Window drag failed. ${error instanceof Error ? error.message : String(error)}`
                );
              });
            }}
            >
              <span />
              <span />
              <span />
            </div>
          <button
            type="button"
            className="slim-popout-shell__close"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleWindowClose();
            }}
            aria-label="Close popout"
            title="Close popout"
          >
            ×
          </button>
          </div>
        )}
        <div
          className={`slim-popout-shell__content ${contentModeClass} ${variant === "panel-fan" ? "slim-popout-shell__content--panel-fan" : ""} ${variant === "floating-fanout" ? "slim-popout-shell__content--floating-fanout" : ""} ${spaceDragActive ? "is-space-drag" : ""} ${spaceDragInProgress ? "is-space-dragging" : ""}`}
        >
          {content}
        </div>
      </main>
      </div>
    );
  };

  const renderBareFanoutShell = (
    content: ReactNode,
    variant: "panel-fan" | "floating-fanout"
  ) => (
    <div
      className={`fanout-popout-root fanout-popout-root--${variant}`}
      style={appThemeStyle}
      data-theme-variant={appThemeVariant}
      onPointerDownCapture={(event: ReactPointerEvent<HTMLElement>) => {
        const target = event.target as HTMLElement | null;
        if (
          !spaceDragActive ||
          event.button !== 0 ||
          target?.closest(".button-context-menu")
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setSpaceDragInProgress(true);
        void getCurrentWindow().startDragging().catch((error) => {
          setSpaceDragInProgress(false);
          pushFrontendEvent(
            inferSurfaceName(windowContext),
            `Window drag failed. ${error instanceof Error ? error.message : String(error)}`
          );
        });
      }}
      onContextMenuCapture={(event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        className={`fanout-popout-root__content fanout-popout-root__content--${variant} ${spaceDragActive ? "is-space-drag" : ""} ${spaceDragInProgress ? "is-space-dragging" : ""}`}
      >
        {content}
      </div>
    </div>
  );

  const renderToolPopoutSurface = () => {
    if (toolPopoutLayoutMode === "PanelFan") {
      if (!selectedPanel || !selectedProgram || toolPopoutButtons.length === 0) {
        return (
          <div className="tool-popout-surface">
            <p className="caption">No panel buttons were available for this fan popout.</p>
          </div>
        );
      }

      const ownerButton: FlowCellButton = {
        Id: buildPanelFanOwnerId(selectedPanel.Id),
        Kind: "host_action",
        command_id: "flowcell.run_builtin",
        Label: selectedPanel.Name,
        Target: "panel-fan-owner",
        Tooltip: `Fan out ${selectedPanel.Name}`,
        style_group_id: miscStyleGroup?.id
        };
      const panelFanOptions = selectedPanel.FanOptions ?? DEFAULT_PANEL_FAN_OPTIONS;

      return (
        <div className="panel-fan-popout-surface">
          <FanOutButtonCluster
            ownerButton={ownerButton}
            layout={panelFanOptions.layout}
            placement={panelFanOptions.placement}
            variant="panel-fan"
            layoutMetricsOverride={panelFanWindowMetrics}
            windowExpanded={panelFanClusterOpen}
            childrenVisible={panelFanChildrenVisible}
            suspendInteraction={spaceDragActive || spaceDragInProgress}
            onExpandRequest={requestPanelFanExpand}
            onCollapseRequest={requestPanelFanCollapse}
            onPanelFanMetricsChange={setPanelFanMetrics}
            childButtons={toolPopoutButtons.map((button, index) => ({
              programId: selectedProgram.ProgramTabId,
              panelId: selectedPanel.Id,
              panelName: selectedPanel.Name,
              button,
              childSlotId: buildChildSlotId(button, index)
            }))}
            styleGroups={state.StyleGroups}
            importedSkins={state.ImportedSkins}
            ownerStyleGroupOverride={miscStyleGroup}
            ownerImportedSkinOverride={miscImportedSkin}
            onOwnerClick={() => {}}
            onChildClick={(entry) => {
              void handlePanelButtonActivate(selectedProgram, selectedPanel, entry.button);
            }}
          />
        </div>
      );
    }

    if (!toolPopoutOwnerButton) {
      return (
        <div className="tool-popout-surface">
          <p className="caption">No tool-popout owner was resolved from FlowCell state.</p>
        </div>
      );
    }

    if (toolPopoutLayoutMode === "Fanout") {
      const childEntries =
        toolPopoutOwnerButton.fanout?.child_button_ids?.length
          ? resolveFanoutChildEntries(
              selectedProgram.ProgramTabId,
              selectedPanel.Id,
              toolPopoutOwnerButton.fanout.child_button_ids
            )
          : [];
      return (
        <div className="floating-fanout-popout-surface">
          <FanOutButtonCluster
            ownerButton={toolPopoutOwnerButton}
            layout={toolPopoutOwnerButton.fanout?.layout ?? "row"}
            direction={toolPopoutOwnerButton.fanout?.direction ?? "up"}
            variant="floating-fanout"
            layoutMetricsOverride={floatingFanoutWindowMetrics}
            windowExpanded={floatingFanoutClusterOpen}
            childrenVisible={floatingFanoutChildrenVisible}
            suspendInteraction={spaceDragActive || spaceDragInProgress}
            onExpandRequest={requestFloatingFanoutExpand}
            onCollapseRequest={requestFloatingFanoutCollapse}
            onFloatingMetricsChange={setFloatingFanoutMetrics}
            childButtons={childEntries}
            styleGroups={state.StyleGroups}
            importedSkins={state.ImportedSkins}
            styleGroupOverride={popoutRegularStyleGroup}
            importedSkinOverride={popoutRegularImportedSkin}
            onOwnerClick={() => {
              void handleHostButtonActivate(toolPopoutOwnerButton);
            }}
            onChildClick={(entry) => {
              void (async () => {
                await handleFanoutChildActivate(toolPopoutOwnerButton, entry);
                requestFloatingFanoutCollapse();
              })();
            }}
          />
        </div>
      );
    }

    if (isAlignmentOwnerButton(toolPopoutOwnerButton)) {
      return (
        <div className="tool-popout-surface">
          <div className="surface-skin-content">
            <AlignmentToolSurface
              ownerLabel={toolPopoutOwnerButton.Label}
              panelName={selectedPanel.Name}
              compact
              styleGroup={popoutToolStyleGroup}
              importedSkin={popoutToolImportedSkin}
              modifiers={getAlignmentToolModifiers(
                state,
                selectedProgram.ProgramTabId,
                selectedPanel.Id,
                toolPopoutOwnerButton.Id
              )}
              onAction={(axis, action) => {
                void handleAlignmentAction(toolPopoutOwnerButton, axis, action);
              }}
            />
          </div>
        </div>
      );
    }

    if (isFlattenRevolveOwnerButton(toolPopoutOwnerButton)) {
      return (
        <div className="tool-popout-surface">
          <div className="surface-skin-content">
            <FlattenRevolveToolSurface
              ownerLabel={toolPopoutOwnerButton.Label}
              panelName={selectedPanel.Name}
              compact
              styleGroup={popoutToolStyleGroup}
              importedSkin={popoutToolImportedSkin}
              values={normalizeFlattenRevolveValues(
                getToolOptionState(
                  state,
                  selectedProgram.ProgramTabId,
                  selectedPanel.Id,
                  toolPopoutOwnerButton.Id,
                  "flatten_revolve"
                )?.Values
              )}
              onValueChange={(field, value) => {
                void updateFlattenRevolveValue(toolPopoutOwnerButton, field, value);
              }}
              onAction={(action) => {
                void handleFlattenRevolveAction(toolPopoutOwnerButton, action);
              }}
            />
          </div>
        </div>
      );
    }

    if (isQuickRotateGroupOwnerButton(toolPopoutOwnerButton)) {
      return (
        <div
          className="tool-popout-surface"
          onPointerDownCapture={() => {
            if (popoutContextMenu) {
              setPopoutContextMenu(null);
            }
          }}
        >
          <div className="surface-skin-content">
            <QuickRotateGroupToolSurface
              ownerLabel={toolPopoutOwnerButton.Label}
              panelName={selectedPanel.Name}
              compact
              styleGroup={popoutToolStyleGroup}
              importedSkin={popoutToolImportedSkin}
              values={normalizeQuickRotateGroupValues(
                getToolOptionState(
                  state,
                  selectedProgram.ProgramTabId,
                  selectedPanel.Id,
                  toolPopoutOwnerButton.Id,
                  "quick_rotate_group"
                )?.Values
              )}
              onValueChange={(field, value) => {
                updateQuickRotateGroupValue(toolPopoutOwnerButton, field, value);
              }}
              onPresetApply={(angleDeg) => {
                void handleQuickRotateGroupPreset(toolPopoutOwnerButton, angleDeg);
              }}
              onApply={(direction) => {
                void handleQuickRotateGroupApply(toolPopoutOwnerButton, direction);
              }}
            />
          </div>
        </div>
      );
    }

    if (toolPopoutButtons.some((button) => isSmartAxisButton(button))) {
      const smartAxisOwnerButton =
        toolPopoutButtons.find((button) => isSmartAxisOwnerButton(button)) ??
        toolPopoutOwnerButton;
      return (
        <div className="tool-popout-surface">
          <div className="surface-skin-content">
            <SmartAxisStrip
              compact
              label={smartAxisOwnerButton.Label}
              styleGroup={popoutToolStyleGroup}
              importedSkin={popoutToolImportedSkin}
              state={normalizeSmartAxisState(
                toObjectRecord(
                  getToolOptionState(
                    state,
                    selectedProgram.ProgramTabId,
                    selectedPanel.Id,
                    smartAxisOwnerButton.Id,
                    "smart_axis_lock"
                  )?.Values
                )
              )}
              onAction={(action) => {
                void handleSmartAxisAction(toolPopoutButtons, action);
              }}
            />
          </div>
        </div>
      );
    }

    if (toolPopoutLayoutMode === "Group" && toolPopoutButtons.length > 1) {
      return (
        <div className="button-grid button-grid--tool-popout button-grid--slim-popout">
          {toolPopoutButtons.map((button) => renderButtonHost(button, true))}
        </div>
      );
    }

    return (
      <div className="single-popout-button">{renderButtonHost(toolPopoutOwnerButton, true)}</div>
    );
  };

  const renderPanelFanOptionsSurface = () => {
    if (!selectedPanel || !selectedProgram) {
      return (
        <div className="tool-popout-surface">
          <p className="caption">This panel could not be resolved for fan options.</p>
        </div>
      );
    }

    const draft = panelFanOptionsDraft ?? selectedPanel.FanOptions ?? DEFAULT_PANEL_FAN_OPTIONS;
    return (
      <div className="tool-popout-surface">
        <PanelFanOptionsWindow
          panelName={selectedPanel.Name}
          layout={draft.layout}
          placement={draft.placement}
          onLayoutChange={(layout) =>
            setPanelFanOptionsDraft((current) => ({
              ...(current ?? draft),
              layout
            }))
          }
          onPlacementChange={(placement) =>
            setPanelFanOptionsDraft((current) => ({
              ...(current ?? draft),
              placement
            }))
          }
          onSave={() => {
            void savePanelFanOptions();
          }}
        />
      </div>
    );
  };

  const renderButtonAppearanceSurface = () => (
    <ButtonAppearanceWindow
      panelName={selectedPanel.Name}
      buttons={buttonAppearanceButtons}
      importedSkins={state.ImportedSkins ?? []}
      styleGroups={state.StyleGroups ?? []}
      selectedButtonId={buttonAppearanceButtonId || buttonAppearanceTargetButton?.Id || ""}
      onSelectedButtonChange={setButtonAppearanceButtonId}
      onSave={(buttonId, draft) => {
        void handleSaveButtonAppearance(buttonId, draft);
      }}
      onClose={() => {
        void handleWindowClose();
      }}
    />
  );

  const renderLayoutPickerSurface = () => {
    const closeWindow = () => {
      void getCurrentWindow().close().catch(() => {});
    };

    return (
      <div className="tool-popout-surface">
        <div className="layout-picker-window">
          <div className="layout-picker-window__header">
            <div>
              <span className="eyebrow">Load Layout</span>
              <h2>Saved Popout Layouts</h2>
            </div>
            <button
              type="button"
              className="modal-card__close"
              onClick={closeWindow}
            >
              Close
            </button>
          </div>
          {layoutPicker === null ? (
            <div className="status-block">
              <span className="caption">Loading saved layouts...</span>
            </div>
          ) : layoutPicker.files.length ? (
            <>
              <label className="compound-field">
                <span>Layout</span>
                <select
                  value={layoutPicker.selectedPath}
                  onChange={(event) =>
                    setLayoutPicker((current) =>
                      current
                        ? {
                            ...current,
                            selectedPath: event.target.value
                          }
                        : current
                    )
                  }
                >
                  {layoutPicker.files.map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {layoutPicker.files
                .filter((file) => file.path === layoutPicker.selectedPath)
                .map((file) => (
                  <div className="status-block" key={file.path}>
                    <span className="caption">{file.details}</span>
                    <span className="caption">{file.savedAt ?? file.modifiedAt ?? ""}</span>
                  </div>
                ))}
              <div className="layout-picker-window__actions">
                <button
                  type="button"
                  className="surface-action"
                  disabled={!layoutPicker.selectedPath}
                  onClick={() => void handleLoadLayout()}
                >
                  Load Layout
                </button>
                <button
                  type="button"
                  className="surface-action"
                  onClick={closeWindow}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="status-block">
              <span className="caption">No saved layouts were found.</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const showMainRails = windowContext.kind === "main" && surfaceMode !== "macro-lab";
  const showStatusRail = windowContext.kind === "main" && surfaceMode !== "macro-lab";

  if (windowContext.kind === "panel-popout") {
    return renderSlimPopoutShell(renderPanelButtonGrid(true), "panel");
  }

  if (windowContext.kind === "panel-fan-options") {
    return renderSlimPopoutShell(renderPanelFanOptionsSurface(), "tool", "default");
  }

  if (windowContext.kind === "button-appearance") {
    return renderSlimPopoutShell(renderButtonAppearanceSurface(), "tool", "default");
  }

  if (windowContext.kind === "layout-picker") {
    return renderSlimPopoutShell(renderLayoutPickerSurface(), "tool", "default");
  }

  if (windowContext.kind === "tool-popout") {
    if (toolPopoutLayoutMode === "PanelFan") {
      return renderBareFanoutShell(renderToolPopoutSurface(), "panel-fan");
    }

    if (toolPopoutLayoutMode === "Fanout") {
      return renderBareFanoutShell(renderToolPopoutSurface(), "floating-fanout");
    }

    return renderSlimPopoutShell(
      renderToolPopoutSurface(),
      "tool",
      "default"
    );
  }

  return (
    <div
      className={`app-shell app-shell--${windowContext.kind}`}
      style={appThemeStyle}
      data-theme-variant={appThemeVariant}
      onPointerDownCapture={(event) => {
        if (windowContext.kind !== "main" || (!buttonContextMenu && !programContextMenu)) {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest(".button-context-menu")) {
          return;
        }
        setButtonContextMenu(null);
        setProgramContextMenu(null);
      }}
    >
      <header className="chrome-bar">
        {windowContext.kind === "main" ? (
          <div className="chrome-bar__layout-actions">
            <HostSkinButton
              type="button"
              label="Save Layout"
              className="chrome-action"
              styleGroup={miscStyleGroup}
              importedSkin={miscImportedSkin}
              disabled={!hasWorkspaceSelection}
              onClick={() => void handleSaveLayout()}
            />
            <HostSkinButton
              type="button"
              label="Load Layout"
              className="chrome-action"
              styleGroup={miscStyleGroup}
              importedSkin={miscImportedSkin}
              disabled={!hasWorkspaceSelection}
              onClick={() => void handleOpenLayoutPicker()}
            />
            <HostSkinButton
              type="button"
              label="Binds"
              className={
                surfaceMode === "binds" && hasWorkspaceSelection
                  ? "chrome-action is-active"
                  : "chrome-action"
              }
              styleGroup={miscStyleGroup}
              importedSkin={miscImportedSkin}
              selected={surfaceMode === "binds" && hasWorkspaceSelection}
              disabled={!hasWorkspaceSelection}
              onClick={() =>
                setSurfaceMode((current) => (current === "binds" ? "panel" : "binds"))
              }
            />
            <HostSkinButton
              type="button"
              label="Macro Lab"
              className={
                surfaceMode === "macro-lab" && hasWorkspaceSelection
                  ? "chrome-action is-active"
                  : "chrome-action"
              }
              styleGroup={miscStyleGroup}
              importedSkin={miscImportedSkin}
              selected={surfaceMode === "macro-lab" && hasWorkspaceSelection}
              disabled={!hasWorkspaceSelection}
              onClick={() =>
                setSurfaceMode((current) => (current === "macro-lab" ? "panel" : "macro-lab"))
              }
            />
          </div>
        ) : null}
        <div className="chrome-bar__drag-region" data-tauri-drag-region="true">
          <div className="chrome-bar__title">
            <span className="eyebrow">FlowCell</span>
            <strong>{selectedProgram?.ProgramConfig?.NormalizedName ?? "Workspace"}</strong>
          </div>
          <span className="chrome-bar__grabber">Drag</span>
        </div>
        <div className="chrome-bar__window-actions">
          <HostSkinButton
            type="button"
            label="Min"
            className="chrome-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={() => void handleWindowMinimize()}
          />
          <HostSkinButton
            type="button"
            label="Max"
            className="chrome-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={() => void handleWindowToggleMaximize()}
          />
          <HostSkinButton
            type="button"
            label="Close"
            className="chrome-action"
            styleGroup={miscStyleGroup}
            importedSkin={miscImportedSkin}
            onClick={() => void handleWindowClose()}
          />
        </div>
      </header>

      <div
        className={
          surfaceMode === "macro-lab"
            ? "workspace-grid workspace-grid--macro-lab"
            : "workspace-grid"
        }
      >
        {showMainRails ? (
          <>
            <aside className="program-rail surface-card">
              <h2>Programs</h2>
              <div className="program-rail__list">
                {state.Programs.map((program) => {
                  const styleGroup = resolveStyleGroup(
                    state.StyleGroups,
                    program.style_group_id ?? ""
                  );
                  const importedSkin = getImportedSkin(
                    state.ImportedSkins,
                    styleGroup?.importedSkinId
                  );
                  const selected = program.ProgramTabId === selectedProgram?.ProgramTabId;
                  const highlightStyle = {
                    ["--fc-selected-highlight" as string]: resolveGreenHighlightColor(
                      `program:${program.ProgramTabId}`
                    )
                  } as CSSProperties;

                  return (
                    <button
                      key={program.ProgramTabId}
                      type="button"
                      className={
                        selected
                          ? "program-rail__button is-active"
                          : "program-rail__button"
                      }
                      onContextMenuCapture={(event) => openProgramContextMenu(event, program)}
                      onClick={() =>
                        void persistState(updateProgramSelection(state, program.ProgramTabId))
                      }
                    >
                      <div
                        className="program-rail__skin"
                        data-selected={selected ? "true" : "false"}
                        style={highlightStyle}
                      >
                        {renderButtonSkin({
                          label:
                            program.ProgramConfig?.NormalizedName ??
                            `Program ${program.ProgramTabId}`,
                          styleGroup,
                          importedSkin,
                          selected
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
              <HostSkinButton
                type="button"
                label="+ Add Program"
                className="rail-footer-action"
                styleGroup={miscStyleGroup}
                importedSkin={miscImportedSkin}
                onClick={() => void handleAddProgram()}
              />
            </aside>

            <aside className="panel-rail surface-card">
              <h2>Panels</h2>
              {selectedProgram ? (
                selectedProgram.Panels.map((panel) => (
                  <div className="panel-rail__row" key={panel.Id}>
                    <HostSkinButton
                      type="button"
                      label={panel.Name}
                      className={
                        surfaceMode !== "appearance" && selectedPanel?.Id === panel.Id
                          ? "rail-button is-active"
                          : "rail-button"
                      }
                      styleGroup={panelsStyleGroup}
                      importedSkin={panelsImportedSkin}
                      selected={surfaceMode !== "appearance" && selectedPanel?.Id === panel.Id}
                      onClick={() => {
                        void selectPanel(panel);
                      }}
                    />
                  </div>
                ))
              ) : (
                <span className="caption">No live program is open.</span>
              )}
              <HostSkinButton
                type="button"
                label="Appearance"
                className={
                  surfaceMode === "appearance" && hasWorkspaceSelection
                    ? "rail-button is-active"
                    : "rail-button"
                }
                styleGroup={panelsStyleGroup}
                importedSkin={panelsImportedSkin}
                selected={surfaceMode === "appearance" && hasWorkspaceSelection}
                disabled={!hasWorkspaceSelection}
                onClick={() =>
                  setSurfaceMode((current) =>
                    current === "appearance" ? "panel" : "appearance"
                  )
                }
              />
              <HostSkinButton
                type="button"
                label="+ Add Panel"
                className="rail-footer-action"
                styleGroup={miscStyleGroup}
                importedSkin={miscImportedSkin}
                disabled={!selectedProgram}
                onClick={() => void handleAddPanel()}
              />
            </aside>
          </>
        ) : null}

        <main
          className={
            surfaceMode === "panel" && hasWorkspaceSelection && panelSurfaceStyleGroup
              ? "main-surface surface-card has-surface-skin"
              : surfaceMode === "macro-lab"
                ? "main-surface main-surface--macro-lab surface-card"
                : "main-surface surface-card"
          }
          style={
            surfaceMode === "panel" && hasWorkspaceSelection
              ? buildSurfaceSkinStyle(panelSurfaceStyleGroup)
              : undefined
          }
          data-surface-skin={
            surfaceMode === "panel" && hasWorkspaceSelection
              ? panelSurfaceStyleGroup?.skinId ?? ""
              : ""
          }
        >
          {surfaceMode === "panel" && hasWorkspaceSelection
            ? renderSurfaceSkinBackdrop(
                selectedPanel.Name,
                panelSurfaceStyleGroup,
                panelSurfaceImportedSkin
              )
            : null}
          <div className={surfaceMode === "panel" ? "main-surface__content" : undefined}>
            {windowContext.kind === "main" && !hasWorkspaceSelection ? (
              <div className="workspace-empty-state">
                <strong>No program is open.</strong>
                <span className="caption">
                  Add a new program or restore one you saved earlier.
                </span>
                <div className="workspace-empty-state__actions">
                  <HostSkinButton
                    type="button"
                    label="Add Or Restore Program"
                    className="surface-action"
                    styleGroup={miscStyleGroup}
                    importedSkin={miscImportedSkin}
                    onClick={() => handleAddProgram()}
                  />
                </div>
              </div>
            ) : !hasWorkspaceSelection ? (
              <div className="workspace-empty-state">
                <strong>Program content is unavailable.</strong>
                <span className="caption">
                  This window will close once the workspace refresh finishes.
                </span>
              </div>
            ) : surfaceMode === "appearance" && windowContext.kind === "main" ? (
              <AppearanceTab
                state={state}
                appTheme={appTheme}
                selectedProgram={selectedProgram}
                selectedPanelName={selectedPanel.Name}
                onClose={() => setSurfaceMode("panel")}
                onSaveTheme={() => {
                  void handleSaveVisualTheme();
                }}
                onApplyDarkTheme={() => {
                  void applyDarkTheme();
                }}
                onApplyBlackTintCards={() => {
                  void applyBlackTintCards();
                }}
                onApplyNatureTheme={() => {
                  void applyNatureTheme();
                }}
                onApplyEggshellTheme={() => {
                  void applyEggshellTheme();
                }}
                onUpdateAppTheme={(nextTheme) => {
                  void persistState(updateAppTheme(state, nextTheme));
                }}
                onApplyProgramStyleGroup={(styleGroupId) => {
                  void persistState(updateAllProgramStyleGroups(state, styleGroupId));
                }}
                onUpdateSurfaceStyleAssignment={(surfaceId, styleGroupId) => {
                  void persistState(updateSurfaceStyleAssignment(state, surfaceId, styleGroupId));
                }}
                onSaveImportedSkin={(skin) => {
                  const nextImportedSkins = (state.ImportedSkins ?? []).map((entry) =>
                    entry.id === skin.id ? skin : entry
                  );
                  void persistState(updateImportedSkins(state, nextImportedSkins));
                }}
              />
            ) : surfaceMode === "macro-lab" && windowContext.kind === "main" ? (
              <MacroLabPage
                bindingsState={bindingsState}
                selectedProgramId={selectedProgram.ProgramTabId}
                selectedProgramName={selectedProgram.ProgramConfig?.NormalizedName ?? "Program"}
                selectedProgramScriptFolder={selectedProgram.ProgramConfig?.ScriptFolder}
                programOptions={programOptions}
                onSelectProgram={(programId) => {
                  void persistState(updateProgramSelection(state, programId));
                }}
                onReloadAppFromDisk={() => reloadAppFromDisk({ captureLiveBounds: false })}
                onFrontendEvent={(message) => {
                  pushFrontendEvent(inferSurfaceName(windowContext), message);
                }}
              />
            ) : surfaceMode === "binds" && windowContext.kind === "main" ? (
              renderBindsSurface()
            ) : (
              <>
                <div className="surface-header">
                  <div className="surface-header__meta">
                    <h1>Buttons</h1>
                    <span className="surface-header__panel-name">{selectedPanel.Name}</span>
                  </div>
                  {windowContext.kind === "main" ? (
                    <div className="surface-toolbar">
                      <HostSkinButton
                        type="button"
                        label="Add Script"
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        onClick={() => void handleAddScriptButton()}
                      />
                      <HostSkinButton
                        type="button"
                        label="Fan"
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        disabled={isToolSetPanelSelection}
                        onClick={() => void handlePanelFanAction(selectedPanel)}
                      />
                      <HostSkinButton
                        type="button"
                        label={selectedPanel.IsPoppedOut ? "Dock" : "Pop"}
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        disabled={isToolSetPanelSelection}
                        onClick={() => void handlePanelPopAction(selectedPanel)}
                      />
                      <HostSkinButton
                        type="button"
                        label="Appearance"
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        disabled={!buttonAppearanceTargetButton || isToolSetPanelSelection}
                        onClick={() => void handleOpenButtonAppearanceAction()}
                      />
                      <HostSkinButton
                        type="button"
                        label="Fan Options"
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        disabled={isToolSetPanelSelection}
                        onClick={() => void handlePanelFanOptionsAction(selectedPanel)}
                      />
                      <HostSkinButton
                        type="button"
                        label="Add Macro"
                        className="surface-action"
                        styleGroup={miscStyleGroup}
                        importedSkin={miscImportedSkin}
                        onClick={() => void handleOpenMacroPicker("add-button")}
                      />
                    </div>
                  ) : null}
                </div>
                {renderPanelButtonGrid()}
              </>
            )}
          </div>
        </main>

        {showStatusRail ? (
        <aside className="status-rail surface-card">
          <h2>Info</h2>
          <div
            className={cardsStyleGroup ? "status-block has-surface-skin" : "status-block"}
            style={buildSurfaceSkinStyle(cardsStyleGroup)}
            data-surface-skin={cardsStyleGroup?.skinId ?? ""}
          >
            {renderSurfaceSkinBackdrop("Result", cardsStyleGroup, cardsImportedSkin)}
            <div className="status-block__content">
              <span className="eyebrow">Result</span>
              <strong>
                {status ? (status.ok ? "Success" : "Error") : "Idle"}
              </strong>
              <span className="caption">{status?.message ?? "No command sent yet."}</span>
              {status ? (
                <span className="caption">
                  Request {status.request_id} | exit {status.exit_code} | {status.duration_ms}ms
                </span>
              ) : null}
            </div>
          </div>
          <div
            className={cardsStyleGroup ? "status-block has-surface-skin" : "status-block"}
            style={buildSurfaceSkinStyle(cardsStyleGroup)}
            data-surface-skin={cardsStyleGroup?.skinId ?? ""}
          >
            {renderSurfaceSkinBackdrop("Recent", cardsStyleGroup, cardsImportedSkin)}
            <div className="status-block__content">
              <span className="eyebrow">Recent</span>
              <strong>{frontendEvents[0] ? "Latest Event" : "No Events Yet"}</strong>
              <span className="caption">
                {frontendEvents[0] ?? "Frontend actions will appear here."}
              </span>
            </div>
          </div>
        </aside>
        ) : null}
      </div>

      {windowContext.kind === "main" && programContextMenu && contextMenuProgram ? (
        <div
          className="button-context-menu program-context-menu"
          style={{
            left: `${programContextMenu.left}px`,
            top: `${programContextMenu.top}px`
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDeleteProgram(contextMenuProgram);
            }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleSaveProgram(contextMenuProgram);
            }}
          >
            Save
          </button>
        </div>
      ) : null}

      {windowContext.kind === "main" && buttonContextMenu && contextMenuButton ? (
        <div
          className="button-context-menu"
          style={{
            left: `${buttonContextMenu.left}px`,
            top: `${buttonContextMenu.top}px`
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleRenameButton(contextMenuButton);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleEditButtonDescription(contextMenuButton);
            }}
          >
            Edit Description
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleBindButtonShortcut(contextMenuButton);
            }}
          >
            Bind Shortcut
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDeleteButton(contextMenuButton);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      {programManager ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setProgramManager(null)}>
          <div
            className="modal-card program-manager"
            role="dialog"
            aria-modal="true"
            aria-label="Add or restore FlowCell program"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-card__header">
              <div>
                <h2>Add Or Restore Program</h2>
                <span className="caption">
                  Create a new live program tab or reopen one you saved earlier.
                </span>
              </div>
              <button
                type="button"
                className="modal-card__close"
                onClick={() => setProgramManager(null)}
              >
                Close
              </button>
            </div>

            <section className="program-manager__section">
              <div className="program-manager__section-header">
                <strong>New Program</strong>
                <span className="caption">Choose a name and the EXE that owns it.</span>
              </div>
              <label className="program-manager__field">
                <span>Name</span>
                <input
                  type="text"
                  value={programManager.programName}
                  onChange={(event) =>
                    setProgramManager((current) =>
                      current
                        ? {
                            ...current,
                            programName: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
              <label className="program-manager__field">
                <span>EXE Path</span>
                <input
                  type="text"
                  value={programManager.exePath}
                  onChange={(event) =>
                    setProgramManager((current) =>
                      current
                        ? {
                            ...current,
                            exePath: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
              <div className="program-manager__actions">
                <HostSkinButton
                  type="button"
                  label="Browse EXE"
                  className="surface-action"
                  styleGroup={miscStyleGroup}
                  importedSkin={miscImportedSkin}
                  onClick={() => void handleBrowseProgramExe()}
                />
                <HostSkinButton
                  type="button"
                  label="Add Program"
                  className="surface-action"
                  styleGroup={miscStyleGroup}
                  importedSkin={miscImportedSkin}
                  disabled={
                    !programManager.programName.trim() || !programManager.exePath.trim()
                  }
                  onClick={() => void handleCreateProgram()}
                />
              </div>
            </section>

            <section className="program-manager__section">
              <div className="program-manager__section-header">
                <strong>Restore Program</strong>
                <span className="caption">
                  Bring back a saved program with its panels and saved popouts.
                </span>
              </div>
              {savedPrograms.length > 0 ? (
                <>
                  <label className="program-manager__field">
                    <span>Saved Program</span>
                    <select
                      value={selectedSavedProgram?.SourceProgramTabId?.toString() ?? ""}
                      onChange={(event) =>
                        setProgramManager((current) =>
                          current
                            ? {
                                ...current,
                                selectedSavedProgramId: event.target.value
                                  ? Number(event.target.value)
                                  : null
                              }
                            : current
                        )
                      }
                    >
                      {savedPrograms.map((record) => (
                        <option
                          key={record.SourceProgramTabId}
                          value={record.SourceProgramTabId.toString()}
                        >
                          {formatProgramDisplayLabel(record.Program)} |{" "}
                          {formatSavedProgramTimestamp(record.SavedAt)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedSavedProgram ? (
                    <div className="program-manager__saved-summary">
                      <strong>{formatProgramDisplayLabel(selectedSavedProgram.Program)}</strong>
                      <span className="caption">
                        Saved {formatSavedProgramTimestamp(selectedSavedProgram.SavedAt)}
                      </span>
                      <span className="caption">
                        Panels {selectedSavedProgram.Program.Panels.length} | Tool popouts{" "}
                        {selectedSavedProgram.ToolPopouts.length}
                      </span>
                      <span className="caption">
                        {selectedSavedProgramInUse
                          ? "This program is already live."
                          : "Ready to restore into the workspace."}
                      </span>
                    </div>
                  ) : null}
                  <div className="program-manager__actions">
                    <HostSkinButton
                      type="button"
                      label="Restore Program"
                      className="surface-action"
                      styleGroup={miscStyleGroup}
                      importedSkin={miscImportedSkin}
                      disabled={!selectedSavedProgram || selectedSavedProgramInUse}
                      onClick={() => void handleRestoreSavedProgram()}
                    />
                  </div>
                </>
              ) : (
                <span className="caption">No saved programs are available yet.</span>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {macroPicker ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setMacroPicker(null)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={
              macroPicker.purpose === "bind-target"
                ? "Choose FlowCell macro bind target"
                : "Add FlowCell macro button"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-card__header">
              <div>
                <span className="eyebrow">
                  {macroPicker.purpose === "bind-target" ? "Bind Macro" : "Add Macro"}
                </span>
                <h2>Recorded Macros</h2>
              </div>
              <button
                type="button"
                className="modal-card__close"
                onClick={() => setMacroPicker(null)}
              >
                Close
              </button>
            </div>
            <label className="compound-field">
              <span>Macro</span>
              <select
                value={macroPicker.selectedId}
                onChange={(event) =>
                  setMacroPicker((current) =>
                    current
                      ? {
                          ...current,
                          selectedId: event.target.value
                        }
                      : current
                  )
                }
              >
                {macroPicker.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {macroPicker.options
              .filter((option) => option.id === macroPicker.selectedId)
              .map((option) => (
                <div className="status-block" key={option.id}>
                  <span className="caption">{option.path}</span>
                  <span className="caption">{option.createdAt ?? ""}</span>
                </div>
              ))}
            <div className="modal-card__actions">
              <button
                type="button"
                className="surface-action"
                onClick={() => void handleConfirmMacroPicker()}
              >
                {macroPicker.purpose === "bind-target" ? "Use Macro Target" : "Add Macro"}
              </button>
              <button
                type="button"
                className="surface-action"
                onClick={() => setMacroPicker(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
