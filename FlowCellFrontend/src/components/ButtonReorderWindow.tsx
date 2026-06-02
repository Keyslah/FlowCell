import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface ButtonReorderEntry {
  id: string;
  label: string;
  kind?: string;
  target?: string;
}

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
  buttons: ButtonReorderEntry[];
  onReorder: (
    sourceButtonId: string,
    targetButtonId: string,
    placement: "before" | "after"
  ) => Promise<void>;
  onClose: () => void;
}

const AUTO_SCROLL_EDGE_PX = 88;
const AUTO_SCROLL_MAX_STEP_PX = 28;

export function ButtonReorderWindow({
  panelName,
  buttons,
  onReorder,
  onClose
}: ButtonReorderWindowProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});
  const dragPointerClientYRef = useRef<number | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const [dragSession, setDragSession] = useState<DragSession | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const resolveDropTarget = (
    clientY: number,
    draggedButtonId: string
  ): DropTargetState | null => {
    const candidateButtons = buttons.filter((button) => button.id !== draggedButtonId);
    if (candidateButtons.length === 0) {
      return null;
    }

    for (const button of candidateButtons) {
      const row = rowRefs.current[button.id];
      const bounds = row?.getBoundingClientRect();
      if (!bounds) {
        continue;
      }

      if (clientY <= bounds.bottom) {
        return {
          buttonId: button.id,
          placement: clientY >= bounds.top + bounds.height / 2 ? "after" : "before"
        };
      }
    }

    const lastButton = candidateButtons[candidateButtons.length - 1];
    return {
      buttonId: lastButton.id,
      placement: "after"
    };
  };

  const clearDragState = () => {
    dragPointerClientYRef.current = null;
    setDragSession(null);
    setDropTarget(null);
  };

  useEffect(() => {
    if (!dragSession) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      dragPointerClientYRef.current = event.clientY;
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
          setFeedback({
            kind: "success",
            message: "Button order updated."
          });
        })
        .catch((error) => {
          setFeedback({
            kind: "error",
            message: error instanceof Error ? error.message : String(error)
          });
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

  useEffect(() => {
    if (!dragSession) {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      return;
    }

    const tickAutoScroll = () => {
      const list = listRef.current;
      const pointerClientY = dragPointerClientYRef.current;
      if (list && pointerClientY !== null) {
        const bounds = list.getBoundingClientRect();
        const maxScrollTop = Math.max(list.scrollHeight - list.clientHeight, 0);
        let scrollDelta = 0;

        if (pointerClientY < bounds.top + AUTO_SCROLL_EDGE_PX) {
          const intensity =
            (bounds.top + AUTO_SCROLL_EDGE_PX - pointerClientY) / AUTO_SCROLL_EDGE_PX;
          scrollDelta = -Math.max(
            8,
            Math.round(AUTO_SCROLL_MAX_STEP_PX * Math.min(intensity, 1))
          );
        } else if (pointerClientY > bounds.bottom - AUTO_SCROLL_EDGE_PX) {
          const intensity =
            (pointerClientY - (bounds.bottom - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX;
          scrollDelta = Math.max(
            8,
            Math.round(AUTO_SCROLL_MAX_STEP_PX * Math.min(intensity, 1))
          );
        }

        if (scrollDelta !== 0) {
          const previousScrollTop = list.scrollTop;
          const nextScrollTop = Math.min(
            Math.max(previousScrollTop + scrollDelta, 0),
            maxScrollTop
          );

          if (nextScrollTop !== previousScrollTop) {
            list.scrollTop = nextScrollTop;
            setDropTarget(resolveDropTarget(pointerClientY, dragSession.buttonId));
          }
        }
      }

      autoScrollFrameRef.current = window.requestAnimationFrame(tickAutoScroll);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tickAutoScroll);
    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [dragSession, buttons]);

  const beginDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    buttonId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragPointerClientYRef.current = event.clientY;
    setFeedback(null);
    setDragSession({
      buttonId,
      pointerId: event.pointerId
    });
    setDropTarget(resolveDropTarget(event.clientY, buttonId));
  };

  if (buttons.length === 0) {
    return (
      <div className="button-reorder-window">
        <section className="surface-card">
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
      <section className="surface-card">
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
        {feedback ? (
          <p
            className={`caption button-reorder-window__feedback${
              feedback.kind === "error" ? " is-error" : ""
            }`}
          >
            {feedback.message}
          </p>
        ) : null}
      </section>

      <section className="surface-card button-reorder-window__workspace">
        <div ref={listRef} className="button-reorder-window__list">
          {buttons.map((button, index) => {
            const isDragging = dragSession?.buttonId === button.id;
            const beforeActive =
              dropTarget?.buttonId === button.id && dropTarget.placement === "before";
            const afterActive =
              dropTarget?.buttonId === button.id && dropTarget.placement === "after";

            return (
              <article
                key={button.id}
                className={`button-reorder-window__row ${isDragging ? "is-dragging" : ""}`}
                ref={(node) => {
                  rowRefs.current[button.id] = node;
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
                    aria-label={`Drag to reorder ${button.label}`}
                    title={`Drag to reorder ${button.label}`}
                    onPointerDown={(event) => beginDrag(event, button.id)}
                  >
                    |||
                  </button>
                  <span className="button-reorder-window__index">{index + 1}</span>
                  <div className="button-reorder-window__meta">
                    <strong>{button.label}</strong>
                    <span className="caption">
                      {button.kind ?? "script"}
                      {button.target ? ` - ${button.target}` : ""}
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
