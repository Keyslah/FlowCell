import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import {
  ButtonReorderWindow,
  type ButtonReorderEntry
} from "../../components/ButtonReorderWindow";
import {
  applyButtonLabelOverridesToPanelScriptRecords,
  readButtonLabelOverrides
} from "../../lib/buttonLabelOverrides";
import {
  applyPanelButtonOrder,
  PANEL_BUTTON_ORDER_CHANGED_EVENT,
  type PanelButtonOrderChangedPayload,
  readPanelButtonOrder,
  reorderPanelButtonFileNames,
  writePanelButtonOrder
} from "../../lib/panelButtonOrder";
import {
  listPanelScriptFiles,
  type PanelScriptFileRecord
} from "../../lib/programRails";
import type { ButtonReorderWindowContext } from "../../lib/windowContext";
import "../main/mainPage.css";
import "./buttonReorderWindowPage.css";

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ButtonReorderWindowPage({
  context
}: {
  context: ButtonReorderWindowContext;
}) {
  const [panelScripts, setPanelScripts] = useState<PanelScriptFileRecord[]>([]);
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextPanelScripts = await listPanelScriptFiles(
          context.programName,
          context.panelName
        );
        if (cancelled) {
          return;
        }

        setPanelScripts(nextPanelScripts);
        setLoadError("");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLoadError(formatErrorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context.panelName, context.programName]);

  const orderedPanelScripts = useMemo(
    () =>
      applyButtonLabelOverridesToPanelScriptRecords(
        applyPanelButtonOrder(
          panelScripts,
          readPanelButtonOrder(context.programName, context.panelName)
        ),
        readButtonLabelOverrides(),
        context.programName,
        context.panelName
      ),
    [context.panelName, context.programName, panelScripts]
  );

  const buttons = useMemo<ButtonReorderEntry[]>(
    () =>
      orderedPanelScripts.map((record) => ({
        id: record.fileName,
        label: record.label,
        kind: record.kind ?? "script",
        target: record.fileName
      })),
    [orderedPanelScripts]
  );

  const closeWindow = async () => {
    await getCurrentWindow().close().catch(() => {
      window.close();
    });
  };

  const handleReorder = async (
    sourceButtonId: string,
    targetButtonId: string,
    placement: "before" | "after"
  ) => {
    const currentOrder = orderedPanelScripts.map((record) => record.fileName);
    const nextOrder = reorderPanelButtonFileNames(
      currentOrder,
      sourceButtonId,
      targetButtonId,
      placement
    );
    const changed =
      nextOrder.length !== currentOrder.length ||
      nextOrder.some((fileName, index) => fileName !== currentOrder[index]);

    if (!changed) {
      return;
    }

    writePanelButtonOrder(context.programName, context.panelName, nextOrder);
    setPanelScripts((current) => applyPanelButtonOrder(current, nextOrder));
    await emit<PanelButtonOrderChangedPayload>(
      PANEL_BUTTON_ORDER_CHANGED_EVENT,
      {
        programName: context.programName,
        panelName: context.panelName
      }
    ).catch(() => {});
  };

  return (
    <main className="button-reorder-window-page">
      <ButtonReorderWindow
        panelName={context.panelName}
        buttons={buttons}
        onReorder={handleReorder}
        onClose={() => {
          void closeWindow();
        }}
      />
      {loadError ? (
        <div className="button-reorder-window-page__error" role="alert">
          Failed to load buttons for {context.panelName}. {loadError}
        </div>
      ) : null}
    </main>
  );
}
