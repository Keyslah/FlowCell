import type { FlowCellBounds } from "../types";
import type { ButtonActivationAnimationPresetId } from "../button/types";

export const BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION = 1 as const;
export const BINDS_PREFILL_EVENT = "flowcell:binds-prefill";

export interface ButtonEditorWindowContext {
  kind: "button-editor";
  schemaVersion: typeof BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION;
  programName?: string;
  panelName?: string;
  lockImportDestination?: boolean;
  buttonId?: string;
  surfaceId?: string;
  draftSessionId?: string;
}

export interface ButtonPopoutWindowContext {
  kind: "button-popout";
  schemaVersion: typeof BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION;
  programName: string;
  panelName?: string;
  popoutUnitId: string;
  ownerButtonId?: string;
  fanSetupId?: string;
  initialDisplayMode: "collapsed" | "expanded";
  draftSessionId?: string;
  initialBounds?: FlowCellBounds;
  restoreBounds?: FlowCellBounds;
}

export interface ButtonFanWindowContext {
  kind: "button-fan";
  schemaVersion: typeof BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION;
  programName: string;
  panelName: string;
  fanSetupId: string;
  panelOwnerButtonId: string;
  draftSessionId?: string;
  initialBounds?: FlowCellBounds;
  restoreBounds?: FlowCellBounds;
}

export interface ButtonAnimationWindowContext {
  kind: "button-animation";
  schemaVersion: typeof BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION;
  mode: "edit" | "play";
  requestId: string;
  buttonId: string;
  presetId: ButtonActivationAnimationPresetId;
}

export interface BindsButtonPrefill {
  programName: string;
  panelName: string;
  buttonId: string;
}

export interface BindsWindowContext {
  kind: "binds";
  prefill?: BindsButtonPrefill;
}

export interface AddProgramWindowContext {
  kind: "add-program";
}

export interface AddPanelWindowContext {
  kind: "add-panel";
  programName: string;
}

export interface InstalledPageWindowContext {
  kind: "installed-page";
  schemaVersion: typeof BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION;
  ownerButtonId: string;
  programName: string;
  panelName: string;
  fileName: string;
  pageId: string;
  alwaysOnTop: boolean;
}

export interface WindowGridWindowContext {
  kind: "window-grid";
}

export interface MotionSettingsWindowContext {
  kind: "motion-settings";
}

export interface MacroLabWindowContext {
  kind: "macro-lab";
  programName: string;
  panelName: string;
  macroId?: string;
  attachToPanel?: boolean;
}

export interface TooltipWindowContext {
  kind: "tooltip";
  text?: string;
}

export type FlowCellWindowContext =
  | { kind: "main" }
  | ButtonEditorWindowContext
  | ButtonPopoutWindowContext
  | ButtonFanWindowContext
  | ButtonAnimationWindowContext
  | BindsWindowContext
  | AddProgramWindowContext
  | AddPanelWindowContext
  | InstalledPageWindowContext
  | WindowGridWindowContext
  | MotionSettingsWindowContext
  | MacroLabWindowContext
  | TooltipWindowContext;

const WINDOW_CONTEXT_QUERY_KEY = "flowcellWindowContext";

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalFlowCellBounds(value: unknown): FlowCellBounds | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const bounds = value as Record<string, unknown>;
  return typeof bounds.Left === "number" &&
    Number.isFinite(bounds.Left) &&
    typeof bounds.Top === "number" &&
    Number.isFinite(bounds.Top) &&
    typeof bounds.Width === "number" &&
    Number.isFinite(bounds.Width) &&
    bounds.Width > 0 &&
    typeof bounds.Height === "number" &&
    Number.isFinite(bounds.Height) &&
    bounds.Height > 0
    ? {
        Left: bounds.Left,
        Top: bounds.Top,
        Width: bounds.Width,
        Height: bounds.Height
      }
    : undefined;
}

function parseBindsPrefill(value: unknown): BindsButtonPrefill | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return typeof record.programName === "string" &&
    typeof record.panelName === "string" &&
    typeof record.buttonId === "string"
    ? {
        programName: record.programName,
        panelName: record.panelName,
        buttonId: record.buttonId
      }
    : undefined;
}

function parseWindowContext(value: unknown): FlowCellWindowContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "main" };
  const parsed = value as Record<string, unknown>;
  if (
    parsed.kind === "button-editor" &&
    parsed.schemaVersion === BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION
  ) {
    return {
      kind: "button-editor",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: optionalString(parsed.programName),
      panelName: optionalString(parsed.panelName),
      lockImportDestination: parsed.lockImportDestination === true,
      buttonId: optionalString(parsed.buttonId),
      surfaceId: optionalString(parsed.surfaceId),
      draftSessionId: optionalString(parsed.draftSessionId)
    };
  }
  if (
    parsed.kind === "button-popout" &&
    parsed.schemaVersion === BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION &&
    typeof parsed.programName === "string" &&
    typeof parsed.popoutUnitId === "string" &&
    (parsed.initialDisplayMode === "collapsed" || parsed.initialDisplayMode === "expanded")
  ) {
    return {
      kind: "button-popout",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: parsed.programName,
      panelName: optionalString(parsed.panelName),
      popoutUnitId: parsed.popoutUnitId,
      ownerButtonId: optionalString(parsed.ownerButtonId),
      fanSetupId: optionalString(parsed.fanSetupId),
      initialDisplayMode: parsed.initialDisplayMode,
      draftSessionId: optionalString(parsed.draftSessionId),
      initialBounds: optionalFlowCellBounds(parsed.initialBounds),
      restoreBounds: optionalFlowCellBounds(parsed.restoreBounds)
    };
  }
  if (
    parsed.kind === "button-fan" &&
    parsed.schemaVersion === BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION &&
    typeof parsed.programName === "string" &&
    typeof parsed.panelName === "string" &&
    typeof parsed.fanSetupId === "string" &&
    typeof parsed.panelOwnerButtonId === "string"
  ) {
    return {
      kind: "button-fan",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      programName: parsed.programName,
      panelName: parsed.panelName,
      fanSetupId: parsed.fanSetupId,
      panelOwnerButtonId: parsed.panelOwnerButtonId,
      draftSessionId: optionalString(parsed.draftSessionId),
      initialBounds: optionalFlowCellBounds(parsed.initialBounds),
      restoreBounds: optionalFlowCellBounds(parsed.restoreBounds)
    };
  }
  if (
    parsed.kind === "button-animation" &&
    parsed.schemaVersion === BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION &&
    (parsed.mode === "edit" || parsed.mode === "play") &&
    typeof parsed.requestId === "string" &&
    parsed.requestId.trim() &&
    typeof parsed.buttonId === "string" &&
    parsed.buttonId.trim() &&
    parsed.presetId === "plus-rise"
  ) {
    return {
      kind: "button-animation",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      mode: parsed.mode,
      requestId: parsed.requestId,
      buttonId: parsed.buttonId,
      presetId: parsed.presetId
    };
  }
  if (parsed.kind === "binds") {
    return { kind: "binds", prefill: parseBindsPrefill(parsed.prefill) };
  }
  if (parsed.kind === "add-program") return { kind: "add-program" };
  if (parsed.kind === "add-panel" && typeof parsed.programName === "string" && parsed.programName.trim()) {
    return { kind: "add-panel", programName: parsed.programName };
  }
  if (
    parsed.kind === "installed-page" &&
    parsed.schemaVersion === BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION &&
    typeof parsed.ownerButtonId === "string" &&
    parsed.ownerButtonId.trim() &&
    typeof parsed.programName === "string" &&
    parsed.programName.trim() &&
    typeof parsed.panelName === "string" &&
    parsed.panelName.trim() &&
    typeof parsed.fileName === "string" &&
    parsed.fileName.trim() &&
    typeof parsed.pageId === "string" &&
    parsed.pageId.trim() &&
    (parsed.alwaysOnTop === undefined || typeof parsed.alwaysOnTop === "boolean")
  ) {
    return {
      kind: "installed-page",
      schemaVersion: BUTTON_WINDOW_CONTEXT_SCHEMA_VERSION,
      ownerButtonId: parsed.ownerButtonId,
      programName: parsed.programName,
      panelName: parsed.panelName,
      fileName: parsed.fileName,
      pageId: parsed.pageId,
      alwaysOnTop: parsed.alwaysOnTop === true
    };
  }
  if (parsed.kind === "window-grid") return { kind: "window-grid" };
  if (parsed.kind === "motion-settings") return { kind: "motion-settings" };
  if (
    parsed.kind === "macro-lab" &&
    typeof parsed.programName === "string" &&
    typeof parsed.panelName === "string"
  ) {
    return {
      kind: "macro-lab",
      programName: parsed.programName,
      panelName: parsed.panelName,
      macroId: optionalString(parsed.macroId),
      attachToPanel: parsed.attachToPanel === true
    };
  }
  if (parsed.kind === "tooltip") {
    return { kind: "tooltip", text: optionalString(parsed.text) };
  }
  return { kind: "main" };
}

export function buildWindowContextUrl(context: FlowCellWindowContext): string {
  return `/?${WINDOW_CONTEXT_QUERY_KEY}=${encodeURIComponent(JSON.stringify(context))}`;
}

export function getWindowContextFromLocation(): FlowCellWindowContext {
  if (typeof window === "undefined") return { kind: "main" };
  const raw = new URLSearchParams(window.location.search).get(WINDOW_CONTEXT_QUERY_KEY);
  if (!raw) return { kind: "main" };
  try {
    const decoded = raw.startsWith("{") ? raw : decodeURIComponent(raw);
    return parseWindowContext(JSON.parse(decoded));
  } catch {
    return { kind: "main" };
  }
}
