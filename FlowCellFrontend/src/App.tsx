import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import ButtonReorderWindowPage from "./pages/button-reorder/ButtonReorderWindowPage";
import CodexUsagePopoutWindowPage from "./pages/codex-usage/CodexUsagePopoutWindowPage";
import DimensionsToolboxWindowPage from "./pages/dimensions/DimensionsToolboxWindowPage";
import FlattenRevolveToolboxWindowPage from "./pages/flatten-revolve/FlattenRevolveToolboxWindowPage";
import MacroLabWindowPage from "./pages/macro-lab/MacroLabWindowPage";
import MainPage from "./pages/main/MainPage";
import RemeshToolboxWindowPage from "./pages/remesh/RemeshToolboxWindowPage";
import RotateToolboxWindowPage from "./pages/rotate/RotateToolboxWindowPage";
import SmartAxisToolboxWindowPage from "./pages/smart-axis/SmartAxisToolboxWindowPage";
import ScriptGroupPopoutWindowPage from "./pages/script-group/ScriptGroupPopoutWindowPage";
import ThemeToolboxWindowPage from "./pages/theme/ThemeToolboxWindowPage";
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
    windowContext.kind === "binds" ||
    windowContext.kind === "macro-lab"
  ) {
    return "";
  }

  return windowContext.programName;
}

function shouldBindScopedNativeOwner(
  _windowContext: ReturnType<typeof getWindowContextFromLocation>
): boolean {
  return false;
}

export default function App() {
  const windowContext = getWindowContextFromLocation();
  const programName = resolveScopedTopmostProgramName(windowContext);
  const bindNativeOwner = shouldBindScopedNativeOwner(windowContext);

  useEffect(() => {
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

  return <MainPage />;
}
