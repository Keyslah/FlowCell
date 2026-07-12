import { useEffect, useRef, type RefObject } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { isButtonWindowGeometryTransitionActive } from "./buttonWindowGeometryTransition";

function findInteractiveElements(root: HTMLElement): Element[] {
  const buttonHitboxes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-button-skin-host]")
  ).filter((host) => host.shadowRoot?.querySelector("[data-core]"));
  const fields = Array.from(
    root.querySelectorAll<HTMLElement>("[data-button-tool-field-id]")
  ).flatMap((field) => {
    const controls = Array.from(
      field.querySelectorAll<HTMLElement>("button,input,select,textarea,[tabindex]")
    ).filter((control) => !(control as HTMLButtonElement).disabled);
    if (field.classList.contains("button-tool-field--display")) {
      return controls;
    }
    return controls.length > 0 ? [field] : [];
  });
  const resizeHandles = Array.from(
    root.querySelectorAll<HTMLElement>("[data-button-window-resize-handle]")
  );
  return [...buttonHitboxes, ...fields, ...resizeHandles];
}

function pointHitsInteractiveElement(
  element: Element,
  clientX: number,
  clientY: number
): boolean {
  const rect = element.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return false;
  }

  // The skin host is the placement-owned hitbox. Its authored core may squash,
  // rotate, or move during hover, but that visual animation must not move the
  // pointer target out from under a stationary cursor.
  if (element.hasAttribute("data-button-skin-host")) {
    return true;
  }

  const root = element.getRootNode();
  const hit = root instanceof ShadowRoot
    ? root.elementFromPoint(clientX, clientY)
    : document.elementFromPoint(clientX, clientY);
  return hit === element || (hit !== null && element.contains(hit));
}

export function useNativeButtonHitboxes(args: {
  rootRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
  geometryKey?: string | number;
  onHoverChange?: (hovered: boolean) => void;
}): void {
  const onHoverChangeRef = useRef(args.onHoverChange);
  onHoverChangeRef.current = args.onHoverChange;

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let cancelled = false;
    let ignoreUnavailable = false;
    let requestedIgnoreState: boolean | null = null;
    let currentHoverState: boolean | null = null;
    let windowPosition: { x: number; y: number } | null = null;
    let scaleFactor: number | null = null;
    let positionEventRevision = 0;
    let scaleEventRevision = 0;
    let animationFrame: number | null = null;
    let pollInFlight = false;
    let ignoreQueue = Promise.resolve();
    let unlistenMoved: (() => void) | null = null;
    let unlistenScaleChanged: (() => void) | null = null;

    const setIgnored = (ignored: boolean, force = false): Promise<void> => {
      if (!force && (ignoreUnavailable || requestedIgnoreState === ignored)) {
        return ignoreQueue;
      }
      requestedIgnoreState = ignored;
      ignoreQueue = ignoreQueue.then(async () => {
        if (!force && ignoreUnavailable) {
          return;
        }
        try {
          await currentWindow.setIgnoreCursorEvents(ignored);
        } catch {
          if (!force) {
            ignoreUnavailable = true;
            requestedIgnoreState = null;
          }
        }
      });
      return ignoreQueue;
    };

    const poll = async () => {
      const root = args.rootRef.current;
      if (isButtonWindowGeometryTransitionActive()) {
        return;
      }
      if (cancelled || !root || ignoreUnavailable || args.enabled === false) {
        if (currentHoverState !== false) {
          currentHoverState = false;
          onHoverChangeRef.current?.(false);
        }
        await setIgnored(false);
        return;
      }

      const elements = findInteractiveElements(root).filter((element) => {
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      });
      if (elements.length === 0) {
        if (currentHoverState !== false) {
          currentHoverState = false;
          onHoverChangeRef.current?.(false);
        }
        await setIgnored(true);
        return;
      }

      if (!windowPosition || scaleFactor === null) {
        return;
      }

      const pointer = await cursorPosition().catch(() => null);
      if (!pointer || cancelled || !windowPosition || scaleFactor === null) {
        return;
      }
      if (isButtonWindowGeometryTransitionActive()) return;

      // Programmatic envelope moves can outrun or coalesce native move events.
      // While a Button is hovered, refresh the origin directly so hit testing
      // and the synthetic pointerleave always use the frame's current position.
      if (currentHoverState === true) {
        const livePosition = await currentWindow.outerPosition().catch(() => null);
        if (livePosition && !cancelled) {
          windowPosition = livePosition;
        }
      }
      if (isButtonWindowGeometryTransitionActive()) return;

      const clientX = (pointer.x - windowPosition.x) / scaleFactor;
      const clientY = (pointer.y - windowPosition.y) / scaleFactor;
      const hovered = elements.some((element) =>
        pointHitsInteractiveElement(element, clientX, clientY)
      );

      // While the window ignores cursor events the webview receives no pointer
      // events. Drive hover from the placement-owned host rectangle so a core
      // that squashes or rotates cannot enter a leave/re-enter feedback loop.
      for (const host of Array.from(
        root.querySelectorAll<HTMLElement>("[data-button-skin-host]")
      )) {
        const core = host.shadowRoot?.querySelector("[data-core]");
        if (!core) continue;
        const hostHovered = pointHitsInteractiveElement(host, clientX, clientY);
        const coreHovered = host.getAttribute("data-button-hover") === "true";
        if (hostHovered && !coreHovered) {
          host.dispatchEvent(new PointerEvent("pointerenter", {
            clientX,
            clientY,
            bubbles: false
          }));
        } else if (
          !hostHovered &&
          coreHovered &&
          host.getAttribute("data-button-pressed") !== "true"
        ) {
          host.dispatchEvent(new PointerEvent("pointerleave", {
            clientX,
            clientY,
            bubbles: false
          }));
        }
      }

      if (currentHoverState !== hovered) {
        currentHoverState = hovered;
        onHoverChangeRef.current?.(hovered);
      }
      await setIgnored(!hovered);
    };

    const scheduleFrame = () => {
      if (cancelled || animationFrame !== null || pollInFlight) {
        return;
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        if (cancelled || pollInFlight) {
          return;
        }
        pollInFlight = true;
        void poll().finally(() => {
          pollInFlight = false;
          if (!cancelled && !ignoreUnavailable && args.enabled !== false) {
            scheduleFrame();
          }
        });
      });
    };

    void currentWindow
      .onMoved(({ payload }) => {
        if (!cancelled) {
          positionEventRevision += 1;
          windowPosition = payload;
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenMoved = unlisten;
        }
      })
      .catch(() => {});
    void currentWindow
      .onScaleChanged(({ payload }) => {
        if (!cancelled && Number.isFinite(payload.scaleFactor) && payload.scaleFactor > 0) {
          scaleEventRevision += 1;
          scaleFactor = payload.scaleFactor;
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenScaleChanged = unlisten;
        }
      })
      .catch(() => {});

    const initialPositionRevision = positionEventRevision;
    void currentWindow
      .outerPosition()
      .then((value) => {
        if (!cancelled && positionEventRevision === initialPositionRevision) {
          windowPosition = value;
        }
      })
      .catch(() => {});
    const initialScaleRevision = scaleEventRevision;
    void currentWindow
      .scaleFactor()
      .then((value) => {
        if (
          !cancelled &&
          scaleEventRevision === initialScaleRevision &&
          Number.isFinite(value) &&
          value > 0
        ) {
          scaleFactor = value;
        }
      })
      .catch(() => {});

    scheduleFrame();

    return () => {
      cancelled = true;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      unlistenMoved?.();
      unlistenScaleChanged?.();
      void setIgnored(false, true);
    };
  }, [args.enabled, args.geometryKey, args.rootRef]);
}
