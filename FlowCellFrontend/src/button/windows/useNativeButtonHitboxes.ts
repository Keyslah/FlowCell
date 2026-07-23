import { useEffect, useRef, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getNativeInputSnapshot,
  listenNativeInputSnapshots,
  type NativeInputSnapshot
} from "../../lib/nativeKeyState";
import {
  getScopedWindowInputState,
  listenScopedWindowInputState
} from "../../lib/tauri";
import {
  buttonWindowRectContainsPoint,
  resolveButtonWindowClientPoint
} from "./buttonWindowGeometry";
import { isButtonWindowGeometryTransitionActive } from "./buttonWindowGeometryTransition";
import {
  createNativeCursorIgnoreController,
  isNativeQueryRevisionCurrent,
  shouldIgnoreButtonWindowCursor,
  type NativeCursorIgnoreController
} from "./nativeCursorIgnoreController";

interface InteractiveInventory {
  hitboxes: InteractiveHitbox[];
  buttonHosts: InteractiveHitbox[];
}

interface InteractiveHitbox {
  element: Element;
  buttonHost: HTMLElement | null;
}

const INTERACTIVE_INVENTORY_SAFETY_REFRESH_MS = 1_000;
const activeCursorIgnoreControllers = new Map<string, NativeCursorIgnoreController>();

function findInteractiveInventory(root: HTMLElement): InteractiveInventory {
  const buttonHitboxes = Array.from(
    root.querySelectorAll<HTMLElement>("[data-button-skin-host]")
  ).flatMap((host): InteractiveHitbox[] => {
    const core = host.shadowRoot?.querySelector<HTMLElement | SVGElement>("[data-core]");
    return core ? [{ element: core, buttonHost: host }] : [];
  });
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
  const hitboxCandidates: InteractiveHitbox[] = [
    ...buttonHitboxes,
    ...fields.map((element) => ({ element, buttonHost: null })),
    ...resizeHandles.map((element) => ({ element, buttonHost: null }))
  ];
  const hitboxes = hitboxCandidates
    .flatMap((hitbox): InteractiveHitbox[] => {
      const { element } = hitbox;
      if (!element.isConnected) return [];
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [];
      return [hitbox];
    });
  return {
    hitboxes,
    buttonHosts: hitboxes.filter((hitbox) => hitbox.buttonHost !== null)
  };
}

function pointHitsInteractiveElement(
  hitbox: InteractiveHitbox,
  clientX: number,
  clientY: number
): boolean {
  // Viewport positions can change when an ancestor semantic frame moves even
  // though neither this element nor its size changed. Keep membership cached,
  // but read the exact rect live so synthetic hover matches WebView click hit testing.
  const rect = hitbox.element.getBoundingClientRect();
  if (!buttonWindowRectContainsPoint(
    { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    { x: clientX, y: clientY }
  )) {
    return false;
  }

  // Button membership is cached through the light-DOM host, but the authored
  // core's live rectangle is the exact hitbox after placement and state transforms.
  if (hitbox.buttonHost) {
    return true;
  }

  const { element } = hitbox;
  const root = element.getRootNode();
  const hit = root instanceof ShadowRoot
    ? root.elementFromPoint(clientX, clientY)
    : document.elementFromPoint(clientX, clientY);
  return hit === element || (hit !== null && element.contains(hit));
}

export function useNativeButtonHitboxes(args: {
  rootRef: RefObject<HTMLElement | null>;
  broadPhaseRef?: RefObject<HTMLElement | null>;
  broadPhasePadding?: number;
  enabled?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  onNativeSpaceChange?: (spaceDown: boolean) => void;
}): void {
  const onHoverChangeRef = useRef(args.onHoverChange);
  const onNativeSpaceChangeRef = useRef(args.onNativeSpaceChange);
  onHoverChangeRef.current = args.onHoverChange;
  onNativeSpaceChangeRef.current = args.onNativeSpaceChange;

  useEffect(() => {
    const currentWindow = getCurrentWindow();
    let cancelled = false;
    let scopeActive = false;
    let currentHoverState: boolean | null = null;
    let windowPosition: { x: number; y: number } | null = null;
    let scaleFactor: number | null = null;
    let positionEventRevision = 0;
    let scaleEventRevision = 0;
    let animationFrame: number | null = null;
    let transitionRetryTimer: number | null = null;
    let pollInFlight = false;
    let pendingSnapshot: NativeInputSnapshot | null = null;
    let latestSnapshot: NativeInputSnapshot | null = null;
    let inventory: InteractiveInventory = { hitboxes: [], buttonHosts: [] };
    let inventoryDirty = true;
    let inventoryRefreshedAt = 0;
    let currentSpaceState: boolean | null = null;
    let mutationObserver: MutationObserver | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let observedResizeElements = new Set<Element>();
    let unlistenNativeInput: (() => void) | null = null;
    let unlistenScopeInput: (() => void) | null = null;
    let unlistenMoved: (() => void) | null = null;
    let unlistenScaleChanged: (() => void) | null = null;
    let nativeInputListenerRetryTimer: number | null = null;
    let nativeSnapshotRetryTimer: number | null = null;
    let scopeInputListenerRetryTimer: number | null = null;
    let scopeInputStateRetryTimer: number | null = null;
    let nativeInputListenerAttempts = 0;
    let nativeSnapshotAttempts = 0;
    let scopeInputListenerAttempts = 0;
    let scopeInputStateAttempts = 0;
    let nativeInputEventRevision = 0;
    let scopeInputEventRevision = 0;
    let requestSnapshotPoll: (snapshot?: NativeInputSnapshot) => void = () => {};
    let scheduleTransitionRetry = () => {};
    const cursorIgnoreController = createNativeCursorIgnoreController((ignored) =>
      currentWindow.setIgnoreCursorEvents(ignored)
    );
    const previousCursorIgnoreController = activeCursorIgnoreControllers.get(currentWindow.label);
    activeCursorIgnoreControllers.set(currentWindow.label, cursorIgnoreController);
    previousCursorIgnoreController?.shutdown(() => {
      activeCursorIgnoreControllers.get(currentWindow.label)?.invalidate();
    });
    cursorIgnoreController.request(true);

    const notifyNativeSpace = (spaceDown: boolean) => {
      if (currentSpaceState === spaceDown) return;
      currentSpaceState = spaceDown;
      onNativeSpaceChangeRef.current?.(spaceDown);
    };

    const refreshInventory = (root: HTMLElement): InteractiveInventory => {
      const now = Date.now();
      if (inventory.hitboxes.some(({ element }) => !element.isConnected)) {
        inventoryDirty = true;
      }
      if (
        inventoryDirty ||
        now - inventoryRefreshedAt >= INTERACTIVE_INVENTORY_SAFETY_REFRESH_MS
      ) {
        inventory = findInteractiveInventory(root);
        inventoryDirty = false;
        inventoryRefreshedAt = now;
        const broadPhaseElement = args.broadPhaseRef?.current;
        const nextResizeElements = new Set<Element>([
          ...(broadPhaseElement ? [broadPhaseElement] : []),
          ...inventory.hitboxes.map(({ element }) => element)
        ]);
        observedResizeElements.forEach((element) => {
          if (!nextResizeElements.has(element)) resizeObserver?.unobserve(element);
        });
        nextResizeElements.forEach((element) => {
          if (!observedResizeElements.has(element)) resizeObserver?.observe(element);
        });
        observedResizeElements = nextResizeElements;
      }
      return inventory;
    };

    const dispatchSyntheticButtonHover = (
      buttonHosts: readonly InteractiveHitbox[],
      clientX: number,
      clientY: number,
      allowEnter: boolean
    ) => {
      for (const hitbox of buttonHosts) {
        const host = hitbox.buttonHost;
        if (!host?.isConnected || !hitbox.element.isConnected) continue;
        const coreHovered = host.getAttribute("data-button-pointer-hover") === "true";
        const hostHovered = allowEnter && pointHitsInteractiveElement(
          hitbox,
          clientX,
          clientY
        );
        if (hostHovered && !coreHovered) {
          hitbox.element.dispatchEvent(new PointerEvent("pointerenter", {
            clientX,
            clientY,
            bubbles: false
          }));
        } else if (
          !hostHovered &&
          coreHovered &&
          host.getAttribute("data-button-pointer-pressed") !== "true"
        ) {
          hitbox.element.dispatchEvent(new PointerEvent("pointerleave", {
            clientX,
            clientY,
            bubbles: false
          }));
        }
      }
    };

    const setIgnored = (ignored: boolean): Promise<void> => {
      cursorIgnoreController.request(ignored);
      return Promise.resolve();
    };

    const poll = async (snapshot: NativeInputSnapshot) => {
      notifyNativeSpace(snapshot.spaceDown);
      const root = args.rootRef.current;
      if (cancelled || !root || !scopeActive || args.enabled === false) {
        if (currentHoverState !== false) {
          currentHoverState = false;
          onHoverChangeRef.current?.(false);
        }
        await setIgnored(true);
        return;
      }
      const pointerPressActive = root.querySelector<HTMLElement>(
        '[data-button-skin-host][data-button-pointer-pressed="true"]'
      ) !== null;

      if (!windowPosition || scaleFactor === null) {
        return;
      }

      if (isButtonWindowGeometryTransitionActive()) {
        scheduleTransitionRetry();
        return;
      }

      // Programmatic envelope moves can outrun or coalesce native move events.
      // While a Button is hovered, refresh the origin directly so hit testing
      // and the synthetic pointerleave always use the frame's current position.
      if (currentHoverState === true) {
        const livePosition = await currentWindow.outerPosition().catch(() => null);
        if (livePosition && !cancelled) {
          windowPosition = livePosition;
        }
      }
      if (isButtonWindowGeometryTransitionActive()) {
        scheduleTransitionRetry();
        return;
      }

      // Native cursor/window positions are physical pixels. WebView CSS pixels
      // can differ from the native monitor DPI (for example when WebView zoom
      // is 105%), so devicePixelRatio is the authoritative conversion here.
      const clientPoint = resolveButtonWindowClientPoint(
        snapshot,
        windowPosition,
        scaleFactor,
        window.devicePixelRatio
      );
      const clientX = clientPoint.x;
      const clientY = clientPoint.y;
      const currentInventory = refreshInventory(root);
      const broadPhaseElement = args.broadPhaseRef?.current;
      if (broadPhaseElement) {
        const rect = broadPhaseElement.getBoundingClientRect();
        const insideBroadPhase = buttonWindowRectContainsPoint(
          { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          { x: clientX, y: clientY },
          args.broadPhasePadding ?? 0
        );
        if (!insideBroadPhase) {
          if (currentHoverState !== false) {
            dispatchSyntheticButtonHover(
              currentInventory.buttonHosts,
              clientX,
              clientY,
              false
            );
            currentHoverState = false;
            onHoverChangeRef.current?.(false);
          }
          await setIgnored(
            shouldIgnoreButtonWindowCursor(scopeActive, false, pointerPressActive)
          );
          return;
        }
      }

      const connectedHitboxes = currentInventory.hitboxes.filter(
        ({ element }) => element.isConnected
      );
      if (connectedHitboxes.length === 0) {
        if (currentHoverState !== false) {
          currentHoverState = false;
          onHoverChangeRef.current?.(false);
        }
        await setIgnored(
          shouldIgnoreButtonWindowCursor(scopeActive, false, pointerPressActive)
        );
        return;
      }
      const hovered = connectedHitboxes.some((hitbox) =>
        pointHitsInteractiveElement(hitbox, clientX, clientY)
      );

      // While the window ignores cursor events the webview receives no pointer
      // events. Drive hover from each authored core's live rectangle so native
      // gating and the browser's core-only pointer target stay aligned.
      dispatchSyntheticButtonHover(currentInventory.buttonHosts, clientX, clientY, true);

      if (currentHoverState !== hovered) {
        currentHoverState = hovered;
        onHoverChangeRef.current?.(hovered);
      }
      await setIgnored(
        shouldIgnoreButtonWindowCursor(scopeActive, hovered, pointerPressActive)
      );
    };

    requestSnapshotPoll = (snapshot) => {
      if (snapshot) latestSnapshot = snapshot;
      if (cancelled || !latestSnapshot) return;
      pendingSnapshot = latestSnapshot;
      if (animationFrame !== null || pollInFlight) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        if (cancelled || pollInFlight) return;
        const snapshotToPoll = pendingSnapshot ?? latestSnapshot;
        pendingSnapshot = null;
        if (!snapshotToPoll) return;
        pollInFlight = true;
        void poll(snapshotToPoll).finally(() => {
          pollInFlight = false;
          if (!cancelled && pendingSnapshot) requestSnapshotPoll();
        });
      });
    };

    scheduleTransitionRetry = () => {
      if (cancelled || transitionRetryTimer !== null) return;
      transitionRetryTimer = window.setTimeout(() => {
        transitionRetryTimer = null;
        requestSnapshotPoll();
      }, 16);
    };

    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        inventoryDirty = true;
        requestSnapshotPoll();
      });
      const root = args.rootRef.current;
      if (root) {
        mutationObserver.observe(root, {
          attributes: true,
          attributeFilter: [
            "class",
            "disabled",
            "hidden",
            "style",
            "data-button-pointer-pressed"
          ],
          childList: true,
          subtree: true
        });
      }
    }
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        inventoryDirty = true;
        requestSnapshotPoll();
      });
    }

    const retryDelay = (attempt: number) =>
      [50, 100, 250, 500, 1_000][Math.min(attempt, 4)];

    const applyScopeInputState = (active: boolean) => {
      if (cancelled) return;
      scopeActive = active;
      // Rust and the opener can force the real HWND back to ignored without
      // going through this controller. Discard its cached applied state, then
      // start every scope transition fail-closed until fresh geometry is read.
      cursorIgnoreController.reset(true);
      if (!active) {
        if (currentHoverState !== false) {
          currentHoverState = false;
          onHoverChangeRef.current?.(false);
        }
        return;
      }
      requestSnapshotPoll();
    };

    const scheduleNativeSnapshotRetry = () => {
      if (cancelled || nativeSnapshotRetryTimer !== null) return;
      const delay = retryDelay(nativeSnapshotAttempts);
      nativeSnapshotAttempts += 1;
      nativeSnapshotRetryTimer = window.setTimeout(() => {
        nativeSnapshotRetryTimer = null;
        syncNativeSnapshot();
      }, delay);
    };

    const syncNativeSnapshot = () => {
      if (cancelled) return;
      const queryRevision = nativeInputEventRevision;
      void getNativeInputSnapshot().then((snapshot) => {
        if (
          cancelled ||
          !isNativeQueryRevisionCurrent(queryRevision, nativeInputEventRevision)
        ) return;
        if (!snapshot) {
          void setIgnored(true);
          scheduleNativeSnapshotRetry();
          return;
        }
        nativeSnapshotAttempts = 0;
        requestSnapshotPoll(snapshot);
      });
    };

    const scheduleNativeInputListenerRetry = () => {
      if (cancelled || nativeInputListenerRetryTimer !== null) return;
      const delay = retryDelay(nativeInputListenerAttempts);
      nativeInputListenerAttempts += 1;
      nativeInputListenerRetryTimer = window.setTimeout(() => {
        nativeInputListenerRetryTimer = null;
        subscribeNativeInput();
      }, delay);
    };

    const subscribeNativeInput = () => {
      if (cancelled || unlistenNativeInput) return;
      void listenNativeInputSnapshots((snapshot) => {
        nativeInputEventRevision += 1;
        if (nativeSnapshotRetryTimer !== null) {
          window.clearTimeout(nativeSnapshotRetryTimer);
          nativeSnapshotRetryTimer = null;
        }
        nativeSnapshotAttempts = 0;
        requestSnapshotPoll(snapshot);
      })
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
            return;
          }
          unlistenNativeInput = unlisten;
          nativeInputListenerAttempts = 0;
          // Subscribe before querying so the initial state cannot change in a
          // gap between the command response and listener installation.
          syncNativeSnapshot();
        })
        .catch(() => {
          void setIgnored(true);
          scheduleNativeInputListenerRetry();
        });
    };

    const scheduleScopeInputStateRetry = () => {
      if (cancelled || scopeInputStateRetryTimer !== null) return;
      const delay = retryDelay(scopeInputStateAttempts);
      scopeInputStateAttempts += 1;
      scopeInputStateRetryTimer = window.setTimeout(() => {
        scopeInputStateRetryTimer = null;
        syncScopeInputState();
      }, delay);
    };

    const syncScopeInputState = () => {
      if (cancelled) return;
      const queryRevision = scopeInputEventRevision;
      void getScopedWindowInputState(currentWindow.label)
        .then((active) => {
          if (
            cancelled ||
            !isNativeQueryRevisionCurrent(queryRevision, scopeInputEventRevision)
          ) return;
          scopeInputStateAttempts = 0;
          applyScopeInputState(active);
        })
        .catch(() => {
          if (
            cancelled ||
            !isNativeQueryRevisionCurrent(queryRevision, scopeInputEventRevision)
          ) return;
          applyScopeInputState(false);
          scheduleScopeInputStateRetry();
        });
    };

    const scheduleScopeInputListenerRetry = () => {
      if (cancelled || scopeInputListenerRetryTimer !== null) return;
      const delay = retryDelay(scopeInputListenerAttempts);
      scopeInputListenerAttempts += 1;
      scopeInputListenerRetryTimer = window.setTimeout(() => {
        scopeInputListenerRetryTimer = null;
        subscribeScopeInput();
      }, delay);
    };

    const subscribeScopeInput = () => {
      if (cancelled || unlistenScopeInput) return;
      void listenScopedWindowInputState(currentWindow.label, (active) => {
        scopeInputEventRevision += 1;
        if (scopeInputStateRetryTimer !== null) {
          window.clearTimeout(scopeInputStateRetryTimer);
          scopeInputStateRetryTimer = null;
        }
        scopeInputStateAttempts = 0;
        applyScopeInputState(active);
      })
        .then((unlisten) => {
          if (cancelled) {
            unlisten();
            return;
          }
          unlistenScopeInput = unlisten;
          scopeInputListenerAttempts = 0;
          syncScopeInputState();
        })
        .catch(() => {
          applyScopeInputState(false);
          scheduleScopeInputListenerRetry();
        });
    };

    subscribeNativeInput();
    subscribeScopeInput();

    void currentWindow
      .onMoved(({ payload }) => {
        if (!cancelled) {
          positionEventRevision += 1;
          windowPosition = payload;
          requestSnapshotPoll();
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
          inventoryDirty = true;
          requestSnapshotPoll();
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
          requestSnapshotPoll();
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
          requestSnapshotPoll();
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (transitionRetryTimer !== null) {
        window.clearTimeout(transitionRetryTimer);
      }
      if (nativeInputListenerRetryTimer !== null) {
        window.clearTimeout(nativeInputListenerRetryTimer);
      }
      if (nativeSnapshotRetryTimer !== null) {
        window.clearTimeout(nativeSnapshotRetryTimer);
      }
      if (scopeInputListenerRetryTimer !== null) {
        window.clearTimeout(scopeInputListenerRetryTimer);
      }
      if (scopeInputStateRetryTimer !== null) {
        window.clearTimeout(scopeInputStateRetryTimer);
      }
      unlistenNativeInput?.();
      unlistenScopeInput?.();
      unlistenMoved?.();
      unlistenScaleChanged?.();
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      observedResizeElements.clear();
      if (activeCursorIgnoreControllers.get(currentWindow.label) === cursorIgnoreController) {
        activeCursorIgnoreControllers.delete(currentWindow.label);
      }
      cursorIgnoreController.shutdown(() => {
        activeCursorIgnoreControllers.get(currentWindow.label)?.invalidate();
      });
    };
  }, [
    args.broadPhasePadding,
    args.broadPhaseRef,
    args.enabled,
    args.rootRef
  ]);
}
