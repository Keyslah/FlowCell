import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideFlowTooltip, showFlowTooltipForElement } from "./lib/flowTooltip";
import { getWindowContextFromLocation } from "./lib/windowContext";
import {
  getForegroundProcessInfo,
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "./lib/tauri";
import PanelFanOptionsWindowPage from "./pages/fan/PanelFanOptionsWindowPage";
import PanelFanToolPopoutWindowPage from "./pages/fan/PanelFanToolPopoutWindowPage";
import AlignmentToolboxWindowPage from "./pages/alignment/AlignmentToolboxWindowPage";
import BooleanToolboxWindowPage from "./pages/boolean/BooleanToolboxWindowPage";
import BindsWindowPage from "./pages/binds/BindsWindowPage";
import BuildLayersWindowPage from "./pages/build-layers/BuildLayersWindowPage";
import WindowGridWindowPage from "./pages/window-grid/WindowGridWindowPage";
import MotionSettingsWindowPage from "./pages/motion-settings/MotionSettingsWindowPage";
import ButtonReorderWindowPage from "./pages/button-reorder/ButtonReorderWindowPage";
import CodexUsagePopoutWindowPage from "./pages/codex-usage/CodexUsagePopoutWindowPage";
import DimensionsToolboxWindowPage from "./pages/dimensions/DimensionsToolboxWindowPage";
import FlattenRevolveToolboxWindowPage from "./pages/flatten-revolve/FlattenRevolveToolboxWindowPage";
import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";
import MainPage from "./pages/main/MainPage";
import OrganizationSetupWindowPage from "./pages/organization-setup/OrganizationSetupWindowPage";
import RemeshToolboxWindowPage from "./pages/remesh/RemeshToolboxWindowPage";
import RotateToolboxWindowPage from "./pages/rotate/RotateToolboxWindowPage";
import SmartAxisToolboxWindowPage from "./pages/smart-axis/SmartAxisToolboxWindowPage";
import ScriptGroupPopoutWindowPage from "./pages/script-group/ScriptGroupPopoutWindowPage";
import ThemeToolboxWindowPage from "./pages/theme/ThemeToolboxWindowPage";
import TooltipWindowPage from "./pages/tooltip/TooltipWindowPage";
import TriPolyToolboxWindowPage from "./pages/tri-poly/TriPolyToolboxWindowPage";
import GenericToolboxWindowPage from "./pages/toolbox/GenericToolboxWindowPage";

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

function matchesProcessToken(processNames: string[], candidate: string): boolean {
  const normalizedCandidate = normalizeProcessToken(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  return processNames.some(
    (processName) =>
      processName === normalizedCandidate ||
      processName.includes(normalizedCandidate) ||
      normalizedCandidate.includes(processName)
  );
}

const PROGRAM_PROCESS_ALIASES: Array<{
  match: string;
  processNames: string[];
}> = [
  { match: "blender", processNames: ["blender", "blender-launcher"] },
  { match: "illustrator", processNames: ["illustrator"] },
  { match: "photoshop", processNames: ["photoshop"] },
  { match: "windows", processNames: ["explorer"] }
];

function resolveProgramProcessNames(programName: string | undefined): string[] {
  const normalizedProgramName = normalizeProcessToken(programName);
  if (!normalizedProgramName) {
    return [];
  }

  const names = new Set<string>();
  names.add(normalizedProgramName);

  for (const alias of PROGRAM_PROCESS_ALIASES) {
    if (!normalizedProgramName.includes(alias.match)) {
      continue;
    }
    for (const processName of alias.processNames) {
      names.add(processName);
    }
  }

  return Array.from(names).sort();
}

function resolveScopedTopmostProgramName(
  windowContext: ReturnType<typeof getWindowContextFromLocation>
): string {
  if (
    windowContext.kind === "main" ||
    windowContext.kind === "tooltip" ||
    windowContext.kind === "binds" ||
    windowContext.kind === "organization-setup" ||
    windowContext.kind === "macro-lab" ||
    windowContext.kind === "window-grid" ||
    windowContext.kind === "motion-settings"
  ) {
    return "";
  }

  return windowContext.programName;
}

function shouldBindScopedNativeOwner(
  windowContext: ReturnType<typeof getWindowContextFromLocation>
): boolean {
  return normalizeProcessToken(resolveScopedTopmostProgramName(windowContext)).includes("illustrator");
}

function resolveTooltipElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const element = target.closest<HTMLElement>("[data-flow-tooltip]");
  if (!element) {
    return null;
  }

  return element;
}

export default function App() {
  const windowContext = getWindowContextFromLocation();
  const programName = resolveScopedTopmostProgramName(windowContext);
  const bindNativeOwner = shouldBindScopedNativeOwner(windowContext);

  useEffect(() => {
    const tauriInternals = (
      window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }
    ).__TAURI_INTERNALS__;
    if (windowContext.kind === "tooltip" || !tauriInternals?.metadata) {
      return;
    }

    let activeTooltipElement: HTMLElement | null = null;

    const showTooltip = (element: HTMLElement | null) => {
      const text = element?.dataset.flowTooltip?.trim() ?? "";
      if (!element || !text) {
        activeTooltipElement = null;
        void hideFlowTooltip();
        return;
      }

      activeTooltipElement = element;
      void showFlowTooltipForElement(text, element);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const element = resolveTooltipElement(event.target);
      if (!element || element === activeTooltipElement) {
        return;
      }
      showTooltip(element);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const activeElement = activeTooltipElement;
      if (!activeElement) {
        return;
      }

      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && activeElement.contains(relatedTarget)) {
        return;
      }

      activeTooltipElement = null;
      void hideFlowTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      showTooltip(resolveTooltipElement(event.target));
    };

    const handleFocusOut = () => {
      activeTooltipElement = null;
      void hideFlowTooltip();
    };

    document.addEventListener("pointerover", handlePointerOver, { capture: true });
    document.addEventListener("pointerout", handlePointerOut, { capture: true });
    document.addEventListener("focusin", handleFocusIn, { capture: true });
    document.addEventListener("focusout", handleFocusOut, { capture: true });

    return () => {
      document.removeEventListener("pointerover", handlePointerOver, { capture: true });
      document.removeEventListener("pointerout", handlePointerOut, { capture: true });
      document.removeEventListener("focusin", handleFocusIn, { capture: true });
      document.removeEventListener("focusout", handleFocusOut, { capture: true });
      void hideFlowTooltip();
    };
  }, [windowContext.kind]);

  useEffect(() => {
    const tauriInternals = (
      window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }
    ).__TAURI_INTERNALS__;
    if (windowContext.kind === "tooltip" || !tauriInternals?.metadata) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const currentWindowLabel = currentWindow.label;
    let disposed = false;

    const applyTopmost = async (
      topmost: boolean,
      options?: {
        promote?: boolean;
      }
    ) => {
      const promote = options?.promote ?? false;

      if (topmost && promote) {
        try {
          await setHostWindowTopmost(currentWindowLabel, true, true);
        } catch {
          await currentWindow.show().catch(() => {});
        }
        return;
      }

      try {
        await setHostWindowTopmost(currentWindowLabel, topmost);
      } catch {
        if (topmost) {
          await currentWindow.show().catch(() => {});
        } else {
          await currentWindow.setAlwaysOnTop(false).catch(() => {});
        }
      }
    };

    if (!programName) {
      void unregisterScopedWindowTopmost(currentWindowLabel).catch(() => {});
      void applyTopmost(false);
      return;
    }

    const processNames = resolveProgramProcessNames(programName);
    const registerScopedTopmost = async () => {
      try {
        await registerScopedWindowTopmost(currentWindowLabel, programName, bindNativeOwner).catch(
          () => {}
        );
        const foreground = await getForegroundProcessInfo();
        if (disposed) {
          return;
        }

        const foregroundName = normalizeProcessToken(
          foreground.processName || foreground.processPath
        );
        const foregroundPath = normalizeProcessPath(foreground.processPath);
        const matchesTarget =
          matchesProcessToken(processNames, foregroundName) ||
          matchesProcessToken(processNames, foregroundPath);
        const shouldStayOnTop = matchesTarget;
        await applyTopmost(shouldStayOnTop, { promote: matchesTarget });
      } catch {
      }
    };

    void registerScopedTopmost();

    const refreshScopedTopmost = () => {
      void refreshScopedWindowTopmost(currentWindowLabel).catch(() => {});
    };
    const refreshTimers = [
      window.setTimeout(refreshScopedTopmost, 60),
      window.setTimeout(refreshScopedTopmost, 240)
    ];

    window.addEventListener("focus", refreshScopedTopmost);
    window.addEventListener("pointerdown", refreshScopedTopmost, { capture: true });

    return () => {
      disposed = true;
      refreshTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
      window.removeEventListener("focus", refreshScopedTopmost);
      window.removeEventListener("pointerdown", refreshScopedTopmost, { capture: true });
      void unregisterScopedWindowTopmost(currentWindowLabel).catch(() => {});
      void applyTopmost(false);
    };
  }, [bindNativeOwner, programName]);

  if (windowContext.kind === "alignment-toolbox") {
    return <AlignmentToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "boolean-toolbox") {
    return <BooleanToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "remesh-toolbox") {
    return <RemeshToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "tri-poly-toolbox") {
    return <TriPolyToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "dimensions-toolbox") {
    return <DimensionsToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "flatten-revolve-toolbox") {
    return <FlattenRevolveToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "generic-toolbox") {
    return <GenericToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "theme-toolbox") {
    return <ThemeToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "smart-axis-toolbox") {
    return <SmartAxisToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "rotate-toolbox") {
    return <RotateToolboxWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "panel-fan") {
    return <PanelFanToolPopoutWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "panel-fan-options") {
    return <PanelFanOptionsWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "binds") {
    return <BindsWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "organization-setup") {
    return <OrganizationSetupWindowPage />;
  }
  if (windowContext.kind === "build-layers") {
    return <BuildLayersWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "window-grid") {
    return <WindowGridWindowPage />;
  }
  if (windowContext.kind === "motion-settings") {
    return <MotionSettingsWindowPage />;
  }
  if (windowContext.kind === "macro-lab") {
    return <MacroLabWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "button-reorder") {
    return <ButtonReorderWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "script-group-popout") {
    return <ScriptGroupPopoutWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "codex-usage-popout") {
    return <CodexUsagePopoutWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "tooltip") {
    return <TooltipWindowPage context={windowContext} />;
  }

  return <MainPage />;
}
