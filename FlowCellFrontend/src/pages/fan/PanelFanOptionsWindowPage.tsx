import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { PanelFanOptionsWindow } from "../../components/PanelFanOptionsWindow";
import {
  readPanelFanOptions,
  writePanelFanOptions
} from "../../lib/panelFanSettings";
import type { PanelFanOptionsWindowContext } from "../../lib/windowContext";
import "../main/mainPage.css";
import "./panelFanWindowPage.css";

export default function PanelFanOptionsWindowPage({
  context
}: {
  context: PanelFanOptionsWindowContext;
}) {
  const [options, setOptions] = useState(() =>
    readPanelFanOptions(context.programName, context.panelName)
  );

  const closeWindow = async () => {
    await getCurrentWindow().close().catch(() => {
      window.close();
    });
  };

  return (
    <main className="panel-fan-options-window-page">
      <PanelFanOptionsWindow
        panelName={context.panelName}
        layout={options.layout}
        placement={options.placement}
        onLayoutChange={(layout) => {
          setOptions((current) => ({
            ...current,
            layout
          }));
        }}
        onPlacementChange={(placement) => {
          setOptions((current) => ({
            ...current,
            placement
          }));
        }}
        onSave={() => {
          writePanelFanOptions(context.programName, context.panelName, options);
          void closeWindow();
        }}
      />
    </main>
  );
}
