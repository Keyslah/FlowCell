import type { CodexUsageSnapshot } from "./codexUsage";
import {
  normalizeScriptGroupPopoutType,
  type ScriptGroupPopoutType
} from "./scriptGroupPopoutSettings";

export type RotateToolboxWindowContext = {
  kind: "rotate-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type FlattenRevolveToolboxWindowContext = {
  kind: "flatten-revolve-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type GenericToolboxWindowContext = {
  kind: "generic-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type DimensionsToolboxWindowContext = {
  kind: "dimensions-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type ThemeToolboxWindowContext = {
  kind: "theme-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type AlignmentToolboxWindowContext = {
  kind: "alignment-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type BooleanToolboxWindowContext = {
  kind: "boolean-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type RemeshToolboxWindowContext = {
  kind: "remesh-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type TriPolyToolboxWindowContext = {
  kind: "tri-poly-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type SmartAxisToolboxWindowContext = {
  kind: "smart-axis-toolbox";
  programName: string;
  panelName: string;
  fileName: string;
  label?: string;
};

export type PanelFanWindowContext = {
  kind: "panel-fan";
  programName: string;
  panelName: string;
  selectedFileNames: string[];
  label?: string;
};

export type PanelFanOptionsWindowContext = {
  kind: "panel-fan-options";
  programName: string;
  panelName: string;
};

export type ButtonReorderWindowContext = {
  kind: "button-reorder";
  programName: string;
  panelName: string;
};

export type BindsButtonPrefill = {
  programName: string;
  panelName: string;
  buttonId: string;
};

export const BINDS_PREFILL_EVENT = "flowcell:binds-prefill";

export type BindsWindowContext = {
  kind: "binds";
  prefill?: BindsButtonPrefill;
};

export type OrganizationSetupWindowContext = {
  kind: "organization-setup";
};

export type BuildLayersWindowContext = {
  kind: "build-layers";
  programName: string;
  panelName: string;
  label?: string;
};

export type WindowGridWindowContext = {
  kind: "window-grid";
};

export type AppearanceWindowContext = {
  kind: "appearance";
};

export type AppearanceHubWindowContext = {
  kind: "appearance-hub";
};

export type MacroLabWindowContext = {
  kind: "macro-lab";
  programName: string;
  panelName: string;
  macroId?: string;
  attachToPanel?: boolean;
};

export type ScriptGroupPopoutScript = {
  fileName: string;
  label: string;
  tooltip?: string;
  events?: Record<string, { type?: string; action?: string; data?: unknown }>;
};

export type ScriptGroupPopoutWindowContext = {
  kind: "script-group-popout";
  programName: string;
  panelName: string;
  scripts: ScriptGroupPopoutScript[];
  popoutType: ScriptGroupPopoutType;
  label?: string;
};

export type CodexUsagePopoutWindowContext = {
  kind: "codex-usage-popout";
  programName: string;
  panelName: string;
  label?: string;
  initialSnapshot?: CodexUsageSnapshot | null;
};

export type TooltipWindowContext = {
  kind: "tooltip";
  text?: string;
};

export type FlowCellWindowContext =
  | {
      kind: "main";
    }
  | TooltipWindowContext
  | FlattenRevolveToolboxWindowContext
  | GenericToolboxWindowContext
  | DimensionsToolboxWindowContext
  | ThemeToolboxWindowContext
  | AlignmentToolboxWindowContext
  | BooleanToolboxWindowContext
  | RemeshToolboxWindowContext
  | TriPolyToolboxWindowContext
  | SmartAxisToolboxWindowContext
  | RotateToolboxWindowContext
  | PanelFanWindowContext
  | PanelFanOptionsWindowContext
  | ButtonReorderWindowContext
  | BindsWindowContext
  | OrganizationSetupWindowContext
  | BuildLayersWindowContext
  | WindowGridWindowContext
  | AppearanceWindowContext
  | AppearanceHubWindowContext
  | MacroLabWindowContext
  | ScriptGroupPopoutWindowContext
  | CodexUsagePopoutWindowContext;

const WINDOW_CONTEXT_QUERY_KEY = "flowcellWindowContext";
const WINDOW_CONTEXT_BOOTSTRAP_RETRY_COUNT = 100;
const WINDOW_CONTEXT_BOOTSTRAP_RETRY_DELAY_MS = 50;

type TauriWindowMetadata = {
  __TAURI_INTERNALS__?: {
    metadata?: {
      currentWindow?: {
        label?: string;
      };
    };
  };
};

function normalizeCodexUsageSnapshot(value: unknown): CodexUsageSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<CodexUsageSnapshot>;
  return {
    fiveHourRemainingPercent:
      typeof snapshot.fiveHourRemainingPercent === "number" &&
      Number.isFinite(snapshot.fiveHourRemainingPercent)
        ? snapshot.fiveHourRemainingPercent
        : null,
    weeklyRemainingPercent:
      typeof snapshot.weeklyRemainingPercent === "number" &&
      Number.isFinite(snapshot.weeklyRemainingPercent)
        ? snapshot.weeklyRemainingPercent
        : null,
    sourceTimestamp:
      typeof snapshot.sourceTimestamp === "string" ? snapshot.sourceTimestamp : null,
    sourcePath: typeof snapshot.sourcePath === "string" ? snapshot.sourcePath : null
  };
}

function readCurrentTauriWindowLabel(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const currentWindowLabel = (window as Window & TauriWindowMetadata).__TAURI_INTERNALS__?.metadata
    ?.currentWindow?.label;

  return typeof currentWindowLabel === "string" ? currentWindowLabel : "";
}

function normalizeScriptGroupPopoutScriptEvents(
  value: unknown
): ScriptGroupPopoutScript["events"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const normalizedEvents: NonNullable<ScriptGroupPopoutScript["events"]> = {};
  Object.entries(value as Record<string, unknown>).forEach(([eventName, eventAction]) => {
    const normalizedEventName = eventName.trim();
    if (
      !normalizedEventName ||
      !eventAction ||
      typeof eventAction !== "object" ||
      Array.isArray(eventAction)
    ) {
      return;
    }

    const eventActionRecord = eventAction as Record<string, unknown>;
    normalizedEvents[normalizedEventName] = {
      type: typeof eventActionRecord.type === "string" ? eventActionRecord.type : undefined,
      action:
        typeof eventActionRecord.action === "string" ? eventActionRecord.action : undefined,
      data: Object.prototype.hasOwnProperty.call(eventActionRecord, "data")
        ? eventActionRecord.data
        : undefined
    };
  });

  return Object.keys(normalizedEvents).length > 0 ? normalizedEvents : undefined;
}

export function buildWindowContextUrl(context: FlowCellWindowContext): string {
  const encodedContext = encodeURIComponent(JSON.stringify(context));
  return `/?${WINDOW_CONTEXT_QUERY_KEY}=${encodedContext}`;
}

export function getWindowContextFromLocation(): FlowCellWindowContext {
  if (typeof window === "undefined") {
    return { kind: "main" };
  }

  const searchParams = new URLSearchParams(window.location.search);
  const rawContext = searchParams.get(WINDOW_CONTEXT_QUERY_KEY);
  if (!rawContext) {
    return { kind: "main" };
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(rawContext)) as Partial<FlowCellWindowContext>;
    if (
      parsed.kind === "flatten-revolve-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "flatten-revolve-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "generic-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "generic-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "dimensions-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "dimensions-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "theme-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "theme-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "alignment-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "alignment-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "boolean-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "boolean-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "remesh-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "remesh-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "tri-poly-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "tri-poly-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "smart-axis-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "smart-axis-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "rotate-toolbox" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      typeof parsed.fileName === "string"
    ) {
      return {
        kind: "rotate-toolbox",
        programName: parsed.programName,
        panelName: parsed.panelName,
        fileName: parsed.fileName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "panel-fan" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      Array.isArray(parsed.selectedFileNames)
    ) {
      return {
        kind: "panel-fan",
        programName: parsed.programName,
        panelName: parsed.panelName,
        selectedFileNames: parsed.selectedFileNames.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
        ),
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "panel-fan-options" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string"
    ) {
      return {
        kind: "panel-fan-options",
        programName: parsed.programName,
        panelName: parsed.panelName
      };
    }
    if (
      parsed.kind === "binds"
    ) {
      const prefillRaw = (parsed as { prefill?: unknown }).prefill;
      const prefill =
        prefillRaw &&
        typeof prefillRaw === "object" &&
        typeof (prefillRaw as BindsButtonPrefill).programName === "string" &&
        typeof (prefillRaw as BindsButtonPrefill).panelName === "string" &&
        typeof (prefillRaw as BindsButtonPrefill).buttonId === "string"
          ? {
              programName: (prefillRaw as BindsButtonPrefill).programName,
              panelName: (prefillRaw as BindsButtonPrefill).panelName,
              buttonId: (prefillRaw as BindsButtonPrefill).buttonId
            }
          : undefined;
      return prefill ? { kind: "binds", prefill } : { kind: "binds" };
    }
    if (parsed.kind === "organization-setup") {
      return {
        kind: "organization-setup"
      };
    }
    if (
      parsed.kind === "build-layers" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string"
    ) {
      return {
        kind: "build-layers",
        programName: parsed.programName,
        panelName: parsed.panelName,
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (parsed.kind === "window-grid") {
      return {
        kind: "window-grid"
      };
    }
    if (parsed.kind === "appearance") {
      return {
        kind: "appearance"
      };
    }
    if (parsed.kind === "appearance-hub") {
      return {
        kind: "appearance-hub"
      };
    }
    if (
      parsed.kind === "macro-lab" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string"
    ) {
      return {
        kind: "macro-lab",
        programName: parsed.programName,
        panelName: parsed.panelName,
        macroId: typeof parsed.macroId === "string" ? parsed.macroId : undefined,
        attachToPanel: parsed.attachToPanel === true
      };
    }
    if (
      parsed.kind === "button-reorder" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string"
    ) {
      return {
        kind: "button-reorder",
        programName: parsed.programName,
        panelName: parsed.panelName
      };
    }
    if (
      parsed.kind === "script-group-popout" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string" &&
      Array.isArray(parsed.scripts)
    ) {
      return {
        kind: "script-group-popout",
        programName: parsed.programName,
        panelName: parsed.panelName,
        scripts: parsed.scripts
          .filter(
            (entry): entry is ScriptGroupPopoutScript =>
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof entry.fileName === "string" &&
              entry.fileName.trim().length > 0 &&
              typeof entry.label === "string" &&
              entry.label.trim().length > 0
          )
          .map((entry) => ({
            fileName: entry.fileName.trim(),
            label: entry.label.trim(),
            tooltip:
              typeof entry.tooltip === "string" && entry.tooltip.trim().length > 0
                ? entry.tooltip.trim()
                : undefined,
            events: normalizeScriptGroupPopoutScriptEvents(entry.events)
          })),
        popoutType: normalizeScriptGroupPopoutType(parsed.popoutType),
        label: typeof parsed.label === "string" ? parsed.label : undefined
      };
    }
    if (
      parsed.kind === "codex-usage-popout" &&
      typeof parsed.programName === "string" &&
      typeof parsed.panelName === "string"
    ) {
      return {
        kind: "codex-usage-popout",
        programName: parsed.programName,
        panelName: parsed.panelName,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
        initialSnapshot: normalizeCodexUsageSnapshot(parsed.initialSnapshot)
      };
    }
    if (parsed.kind === "tooltip") {
      return {
        kind: "tooltip",
        text: typeof parsed.text === "string" ? parsed.text : undefined
      };
    }
  } catch {
    // Fall through to the main window context.
  }

  return { kind: "main" };
}

export function resolveWindowContextAfterBootstrap(
  onResolved: (context: FlowCellWindowContext) => void
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let cancelled = false;
  let attempts = 0;

  const checkWindowContext = () => {
    if (cancelled) {
      return;
    }

    const nextContext = getWindowContextFromLocation();
    onResolved(nextContext);

    if (
      nextContext.kind === "flatten-revolve-toolbox" ||
      nextContext.kind === "generic-toolbox" ||
      nextContext.kind === "dimensions-toolbox" ||
      nextContext.kind === "theme-toolbox" ||
      nextContext.kind === "alignment-toolbox" ||
      nextContext.kind === "boolean-toolbox" ||
      nextContext.kind === "remesh-toolbox" ||
      nextContext.kind === "tri-poly-toolbox" ||
      nextContext.kind === "smart-axis-toolbox" ||
      nextContext.kind === "rotate-toolbox" ||
      nextContext.kind === "panel-fan" ||
      nextContext.kind === "panel-fan-options" ||
      nextContext.kind === "binds" ||
      nextContext.kind === "organization-setup" ||
      nextContext.kind === "build-layers" ||
      nextContext.kind === "window-grid" ||
      nextContext.kind === "appearance" ||
      nextContext.kind === "appearance-hub" ||
      nextContext.kind === "macro-lab" ||
      nextContext.kind === "button-reorder" ||
      nextContext.kind === "script-group-popout" ||
      nextContext.kind === "codex-usage-popout" ||
      nextContext.kind === "tooltip" ||
      readCurrentTauriWindowLabel() ||
      attempts >= WINDOW_CONTEXT_BOOTSTRAP_RETRY_COUNT
    ) {
      return;
    }

    attempts += 1;
    window.setTimeout(checkWindowContext, WINDOW_CONTEXT_BOOTSTRAP_RETRY_DELAY_MS);
  };

  window.setTimeout(checkWindowContext, 0);

  return () => {
    cancelled = true;
  };
}
