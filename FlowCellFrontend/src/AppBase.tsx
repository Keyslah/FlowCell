import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideFlowTooltip, showFlowTooltipForElement } from "./lib/flowTooltip";
import { getWindowContextFromLocation } from "./lib/windowContext";
import { unregisterLayoutWindow } from "./lib/layoutSnapshots";
import ButtonEditorPage from "./button/editor/ButtonEditorPage";
import ButtonFanWindowPage from "./button/fan/ButtonFanWindowPage";
import ButtonPopoutWindowPage from "./button/popout/ButtonPopoutWindowPage";
import { registerButtonCoreAction } from "./button/runtime/ButtonRuntimeAdapter";
import { registerBuiltinButtonCoreActions } from "./button/runtime/registerBuiltinCoreActions";
import { FRONTEND_MACRO_CORE_ACTION_ID } from "./button/state/frontendMacroButtonOperations";
import {
  getForegroundProcessInfo,
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "./lib/tauri";
import BindsWindowPage from "./pages/binds/BindsWindowPage";
import BuildLayersWindowPage from "./pages/build-layers/BuildLayersWindowPage";
import WindowGridWindowPage from "./pages/window-grid/WindowGridWindowPage";
import MotionSettingsWindowPage from "./pages/motion-settings/MotionSettingsWindowPage";
import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";
import MainPage from "./pages/main/MainPage";
import OrganizationSetupWindowPage from "./pages/organization-setup/OrganizationSetupWindowPage";
import TooltipWindowPage from "./pages/tooltip/TooltipWindowPage";
import { runFrontendMacro } from "./lib/macros";

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

function resolveScopedTopmostProgramName(
  windowContext: ReturnType<typeof getWindowContextFromLocation>
): string {
  if (
    windowContext.kind === "main" ||
    windowContext.kind === "button-editor" ||
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

  useEffect(() => registerButtonCoreAction(
    FRONTEND_MACRO_CORE_ACTION_ID,
    async (target) => {
      const macroId = target.payload?.macroId;
      if (typeof macroId !== "string" || !macroId.trim()) {
        throw new Error("Frontend macro Button is missing its macro ID.");
      }
      return runFrontendMacro(macroId);
    }
  ), []);

  useEffect(() => registerBuiltinButtonCoreActions(), []);

  useEffect(() => {
    if (
      windowContext.kind !== "button-popout" &&
      windowContext.kind !== "button-fan"
    ) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const unlistenPromise = currentWindow.onCloseRequested(() => {
      unregisterLayoutWindow(currentWindow.label);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [windowContext.kind]);

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

    const registerScopedTopmost = async () => {
      try {
        const processNames = await registerScopedWindowTopmost(
          currentWindowLabel,
          programName,
          bindNativeOwner
        ).catch(() => []);
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

  if (windowContext.kind === "button-editor") {
    return <ButtonEditorPage context={windowContext} />;
  }
  if (windowContext.kind === "button-popout") {
    return <ButtonPopoutWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "button-fan") {
    return <ButtonFanWindowPage context={windowContext} />;
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
  if (windowContext.kind === "tooltip") {
    return <TooltipWindowPage context={windowContext} />;
  }

  return <MainPage />;
}
