import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideFlowTooltip, showFlowTooltipForElement } from "./lib/flowTooltip";
import { getWindowContextFromLocation } from "./lib/windowContext";
import {
  unregisterLayoutWindow,
  writeRegisteredLayoutWindowSnapshotBounds
} from "./lib/layoutSnapshots";
import ButtonEditorPage from "./button/editor/ButtonEditorPage";
import ButtonFanWindowPage from "./button/fan/ButtonFanWindowPage";
import ButtonPopoutWindowPage from "./button/popout/ButtonPopoutWindowPage";
import ButtonAnimationWindowPage from "./button/animations/ButtonAnimationWindowPage";
import { registerButtonCoreAction } from "./button/runtime/ButtonRuntimeAdapter";
import { registerButtonActivationEffectHandler } from "./button/runtime/buttonActivationEffects";
import {
  coordinateButtonActivationAnimationRequest,
  listenForButtonActivationAnimationRequests,
  requestButtonActivationAnimation
} from "./button/animations/buttonAnimationWindows";
import { registerBuiltinButtonCoreActions } from "./button/runtime/registerBuiltinCoreActions";
import { FRONTEND_MACRO_CORE_ACTION_ID } from "./button/state/frontendMacroButtonOperations";
import {
  registerScopedWindowTopmost,
  refreshScopedWindowTopmost,
  setHostWindowTopmost,
  unregisterScopedWindowTopmost
} from "./lib/tauri";
import BindsWindowPage from "./pages/binds/BindsWindowPage";
import WindowGridWindowPage from "./pages/window-grid/WindowGridWindowPage";
import MotionSettingsWindowPage from "./pages/motion-settings/MotionSettingsWindowPage";
import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";
import MainPage from "./pages/main/MainPage";
import InstalledPageWindowPage from "./pages/installed-page/InstalledPageWindowPage";
import AddProgramWindowPage from "./pages/program-setup/AddProgramWindowPage";
import AddPanelWindowPage from "./pages/program-setup/AddPanelWindowPage";
import TooltipWindowPage from "./pages/tooltip/TooltipWindowPage";
import { runFrontendMacro } from "./lib/macros";

function resolveScopedTopmostProgramName(
  windowContext: ReturnType<typeof getWindowContextFromLocation>
): string {
  if (
    windowContext.kind === "main" ||
    windowContext.kind === "button-editor" ||
    windowContext.kind === "button-animation" ||
    windowContext.kind === "tooltip" ||
    windowContext.kind === "binds" ||
    windowContext.kind === "add-program" ||
    windowContext.kind === "add-panel" ||
    windowContext.kind === "macro-lab" ||
    windowContext.kind === "window-grid" ||
    windowContext.kind === "motion-settings"
  ) {
    return "";
  }

  return windowContext.programName;
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
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForButtonActivationAnimationRequests(
      coordinateButtonActivationAnimationRequest
    ).then((next) => {
      if (disposed) next(); else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => registerButtonActivationEffectHandler(
    requestButtonActivationAnimation
  ), []);

  useEffect(() => {
    if (
      windowContext.kind !== "button-popout" &&
      windowContext.kind !== "button-fan" &&
      windowContext.kind !== "installed-page"
    ) {
      return;
    }
    const currentWindow = getCurrentWindow();
    const unlistenPromise = windowContext.kind === "installed-page"
      ? currentWindow.once("tauri://destroyed", () => {
          unregisterLayoutWindow(currentWindow.label);
        })
      : currentWindow.onCloseRequested(() => {
          unregisterLayoutWindow(currentWindow.label);
        });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [windowContext.kind]);

  useEffect(() => {
    if (
      windowContext.kind !== "button-editor" &&
      windowContext.kind !== "installed-page"
    ) {
      return;
    }
    const currentWindow = getCurrentWindow();
    let disposed = false;
    let stopMoved: (() => void) | undefined;
    let stopResized: (() => void) | undefined;
    const captureNormalBounds = async () => {
      if (disposed || await currentWindow.isMinimized().catch(() => false)) {
        return;
      }
      const [position, size] = await Promise.all([
        currentWindow.outerPosition().catch(() => null),
        currentWindow.innerSize().catch(() => null)
      ]);
      if (disposed || !position || !size) {
        return;
      }
      writeRegisteredLayoutWindowSnapshotBounds(currentWindow.label, {
        Left: position.x,
        Top: position.y,
        Width: size.width,
        Height: size.height
      });
    };
    void currentWindow.onMoved(() => void captureNormalBounds()).then((stop) => {
      if (disposed) stop(); else stopMoved = stop;
    });
    void currentWindow.onResized(() => void captureNormalBounds()).then((stop) => {
      if (disposed) stop(); else stopResized = stop;
    });
    void captureNormalBounds();
    return () => {
      disposed = true;
      stopMoved?.();
      stopResized?.();
    };
  }, [windowContext.kind]);

  useEffect(() => {
    const tauriInternals = (
      window as Window & { __TAURI_INTERNALS__?: { metadata?: unknown } }
    ).__TAURI_INTERNALS__;
    if (
      windowContext.kind === "tooltip" ||
      windowContext.kind === "button-animation" ||
      !tauriInternals?.metadata
    ) {
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
    if (
      windowContext.kind === "tooltip" ||
      windowContext.kind === "button-animation" ||
      !tauriInternals?.metadata
    ) {
      return;
    }

    const currentWindow = getCurrentWindow();
    const currentWindowLabel = currentWindow.label;
    const selectiveInput =
      windowContext.kind === "button-popout" || windowContext.kind === "button-fan";
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
        await registerScopedWindowTopmost(
          currentWindowLabel,
          programName,
          selectiveInput
        );
        if (disposed) {
          return;
        }
        await refreshScopedWindowTopmost(currentWindowLabel);
      } catch {
        await currentWindow.setIgnoreCursorEvents(true).catch(() => {});
        await applyTopmost(false);
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

    return () => {
      disposed = true;
      refreshTimers.forEach((timer) => {
        window.clearTimeout(timer);
      });
      void unregisterScopedWindowTopmost(currentWindowLabel).catch(() => {});
      void applyTopmost(false);
    };
  }, [programName, windowContext.kind]);

  if (windowContext.kind === "button-editor") {
    return <ButtonEditorPage context={windowContext} />;
  }
  if (windowContext.kind === "button-popout") {
    return <ButtonPopoutWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "button-fan") {
    return <ButtonFanWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "button-animation") {
    return <ButtonAnimationWindowPage context={windowContext} />;
  }

  if (windowContext.kind === "binds") {
    return <BindsWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "add-program") {
    return <AddProgramWindowPage />;
  }
  if (windowContext.kind === "add-panel") {
    return <AddPanelWindowPage context={windowContext} />;
  }
  if (windowContext.kind === "installed-page") {
    return <InstalledPageWindowPage context={windowContext} />;
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
