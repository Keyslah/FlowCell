import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  FLOW_TOOLTIP_EVENT,
  type FlowTooltipPayload
} from "../../lib/flowTooltip";
import type { TooltipWindowContext } from "../../lib/windowContext";
import "./tooltipWindowPage.css";

type TooltipWindowPageProps = {
  context: TooltipWindowContext;
};

export default function TooltipWindowPage({ context }: TooltipWindowPageProps) {
  const [text, setText] = useState(context.text ?? "");
  const [visible, setVisible] = useState(Boolean(context.text?.trim()));

  useEffect(() => {
    const unlistenPromise = listen<FlowTooltipPayload>(FLOW_TOOLTIP_EVENT, (event) => {
      const payload = event.payload;
      setText(payload.text ?? "");
      setVisible(payload.visible && Boolean(payload.text?.trim()));
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  return (
    <main
      className={`tooltip-window-page${visible ? " tooltip-window-page--visible" : ""}`}
      aria-hidden={!visible}
    >
      <div className="tooltip-window-page__bubble">{text}</div>
    </main>
  );
}
