import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { FlowCellButton } from "../types";

interface DropTargetState {
  buttonId: string;
  placement: "before" | "after";
}

interface DragSession {
  buttonId: string;
  pointerId: number;
}

interface ButtonReorderWindowProps {
  panelName: string;
  buttons: FlowCellButton[];
  onReorder: (
    sourceButtonId: string,
    targetButtonId: string,
    placement: "before" | "after"
  ) => Promise<void>;
  onClose: () => void;
}

export function ButtonReorderWindow({
  panelName,
  buttons,
  onReorder,
  onClose
}: ButtonReorderWindowProps) {
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const [dragSession, setDragSession] = useState<DragSession | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const resolveDropTarget = (
    clientY: number,
    draggedButtonId: string
  ): DropTargetState | null => {
    const candidateButtons = buttons.filter((button) => button.Id !== draggedButtonId);
    if (candidateButtons.length === 0) {
      return null;
    }

    for (const button of candidateButtons) {
      const row = rowRefs.current[button.Id];
      const bounds = row?.getBoundingClientRect();
      if (!bounds) {
        continue;
      }

      if (clientY <= bounds.bottom) {
        return {
          buttonId: button.Id,
          placement: clientY >= bounds.top + bounds.height / 2 ? "after" : "before"
        };
      }
    }

    const lastButton = candidateButtons[candidateButtons.length - 1];
    return {
      buttonId: lastButton.Id,
      placement: "after"
    };
  };

  const clearDragState = () => {
    setDragSession(null);
    setDropTarget(null);
  };

  useEffect(() => {
    if (!dragSession) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      setDropTarget(resolveDropTarget(event.clientY, dragSession.buttonId));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragSession.pointerId) {
        return;
      }

      const nextDropTarget = resolveDropTarget(event.clientY, dragSession.buttonId);
      if (
        !nextDropTarget ||
        (nextDropTarget.buttonId === dragSession.buttonId &&
          nextDropTarget.placement === "before")
      ) {
        clearDragState();
        return;
      }

      void onReorder(
        dragSession.buttonId,
        nextDropTarget.buttonId,
        nextDropTarget.placement
      )
        .then(() => {
          setFeedback("Button order updated.");
        })
        .catch((error) => {
          setFeedback(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          clearDragState();
        });
    };

    const handlePointerCancel = () => {
      clearDragState();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [dragSession, buttons]);

  const beginDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setFeedback("");
    setDragSession({
      buttonId,
      pointerId: event.pointerId
    });
    setDropTarget(resolveDropTarget(event.clientY, buttonId));
  };

  if (buttons.length === 0) {
    return (
      <div className="button-reorder-window">
        <section className="surface-card appearance-card">
          <div className="surface-header">
            <div>
              <span className="eyebrow">Reorder Buttons</span>
              <h2>{panelName}</h2>
            </div>
            <button type="button" className="surface-action" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="caption">No buttons are available in this panel.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="button-reorder-window">
      <section className="surface-card appearance-card">
        <div className="surface-header">
          <div>
            <span className="eyebrow">Reorder Buttons</span>
            <h2>{panelName}</h2>
          </div>
          <button type="button" className="surface-action" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="caption">
          Drag the grip to reorder. Drop on the upper or lower half of a row to place before or
          after it.
        </p>
        {feedback ? <p className="caption">{feedback}</p> : null}
      </section>

      <section className="surface-card appearance-card button-reorder-window__workspace">
        <div className="button-reorder-window__list">
          {buttons.map((button, index) => {
            const isDragging = dragSession?.buttonId === button.Id;
            const beforeActive =
              dropTarget?.buttonId === button.Id && dropTarget.placement === "before";
            const afterActive =
              dropTarget?.buttonId === button.Id && dropTarget.placement === "after";

            return (
              <article
                key={button.Id}
                className={`button-reorder-window__row ${isDragging ? "is-dragging" : ""}`}
                ref={(node) => {
                  rowRefs.current[button.Id] = node;
                }}
                aria-grabbed={isDragging}
              >
                <div
                  className={`button-reorder-window__drop-indicator ${beforeActive ? "is-active" : ""}`}
                  aria-hidden="true"
                />
                <div className="button-reorder-window__row-body">
                  <button
                    type="button"
                    className="button-reorder-window__handle"
                    aria-label={`Drag to reorder ${button.Label}`}
                    title={`Drag to reorder ${button.Label}`}
                    onPointerDown={(event) => beginDrag(event, button.Id)}
                  >
                    :::
                  </button>
                  <span className="button-reorder-window__index">{index + 1}</span>
                  <div className="button-reorder-window__meta">
                    <strong>{button.Label}</strong>
                    <span className="caption">
                      {button.Kind}
                      {button.Target ? ` - ${button.Target}` : ""}
                    </span>
                  </div>
                </div>
                <div
                  className={`button-reorder-window__drop-indicator ${afterActive ? "is-active" : ""}`}
                  aria-hidden="true"
                />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
