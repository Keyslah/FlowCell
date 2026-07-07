import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { resolveGreenHighlightColor } from "../lib/highlightPalette";
import {
  buildFlowButtonClassName,
  buildFlowButtonCssVars,
  buildFlowButtonDataAttributes,
  renderButtonSkin,
  type FlowButtonActionPhase,
  type FlowButtonFootprintMode,
  type FlowButtonSizingMode,
  type FlowButtonTrigger,
  type FlowButtonTransition,
  usesLegacyImportedBodyShell
} from "../lib/skins";
import { DEFAULT_FLOW_IMPORTED_SKIN } from "../lib/theme";
import type { ImportedSkin, StyleGroup } from "../types";

const HOLD_DELAY_MS = 280;
const RELEASE_PHASE_MS = 140;
// Hub play latch: one-shot animations triggered on press that always run to
// completion (see appearance-hub/liveBridge.ts). Grace clears the latch when
// the skin starts nothing; the cap guards against runaway animations.
const HUB_PLAY_GRACE_MS = 300;
const HUB_PLAY_MAX_MS = 15_000;
const HUB_PLAY_SETTLE_MS = 180;

interface FlowButtonFootprintOverride {
  width: number;
  height: number;
}

const MAIN_BUTTON_SIZE_PERCENT_DEFAULT = 100;
const MAIN_BUTTON_SIZE_PERCENT_MIN = 40;
const MAIN_BUTTON_SIZE_PERCENT_MAX = 220;
const FAN_CHILD_BASELINE_WIDTH = 132;
const FAN_CHILD_BASELINE_HEIGHT = 38;
const FAN_OWNER_BASELINE_WIDTH = 132;
const FAN_OWNER_BASELINE_HEIGHT = 38;
const FIXED_FOOTPRINT_MIN = 24;
const FIXED_FOOTPRINT_MAX = 480;

export function resolveMainButtonFootprintOverride(
  importedSkin: ImportedSkin | undefined
): FlowButtonFootprintOverride | undefined {
  const rawValue = importedSkin?.mainButtonSizePercent;
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return undefined;
  }

  const nextPercent = Math.min(
    MAIN_BUTTON_SIZE_PERCENT_MAX,
    Math.max(MAIN_BUTTON_SIZE_PERCENT_MIN, Math.round(rawValue))
  );
  const ratio = nextPercent / MAIN_BUTTON_SIZE_PERCENT_DEFAULT;
  return {
    width: Math.round(MAIN_BUTTON_BASELINE_WIDTH * ratio),
    height: Math.round(MAIN_BUTTON_BASELINE_HEIGHT * ratio)
  };
}

function resolveFixedFootprintDimension(
  value: number | undefined,
  fallback: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return clamp(Math.round(value), FIXED_FOOTPRINT_MIN, FIXED_FOOTPRINT_MAX);
}

export function resolveFanChildFootprintOverride(
  importedSkin: ImportedSkin | undefined
): FlowButtonFootprintOverride {
  return {
    width: resolveFixedFootprintDimension(importedSkin?.fanChildWidth, FAN_CHILD_BASELINE_WIDTH),
    height: resolveFixedFootprintDimension(importedSkin?.fanChildHeight, FAN_CHILD_BASELINE_HEIGHT)
  };
}

export function resolveFanOwnerFootprintOverride(
  importedSkin: ImportedSkin | undefined
): FlowButtonFootprintOverride {
  return {
    width: resolveFixedFootprintDimension(importedSkin?.fanOwnerWidth, FAN_OWNER_BASELINE_WIDTH),
    height: resolveFixedFootprintDimension(importedSkin?.fanOwnerHeight, FAN_OWNER_BASELINE_HEIGHT)
  };
}

interface HostSkinButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  hoveredOverride?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  active?: boolean;
  error?: boolean;
  flowId?: string;
  flowLabel?: string;
  skinCompact?: boolean;
  highlightKey?: string;
  highlightColor?: string;
  hostMode?: "native-button" | "neutral";
  sizingMode?: FlowButtonSizingMode;
  footprintMode?: FlowButtonFootprintMode;
  footprintOverride?: FlowButtonFootprintOverride;
  density?: number | string;
  allowOverflow?: boolean;
  autoInlineSize?: boolean;
  targetHeight?: number;
  afterContent?: ReactNode;
  onHubPlayChange?: (playing: boolean) => void;
}

function sanitizeFlowId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  return normalized.length > 0 ? normalized : "flow-button";
}

function hasHostClassToken(className: string | undefined, token: string): boolean {
  if (!className) {
    return false;
  }
  return className.split(/\s+/).includes(token);
}

function areMeasurementsEqual(
  left: { width: number; height: number; skinWidth: number; skinHeight: number },
  right: { width: number; height: number; skinWidth: number; skinHeight: number }
) {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.skinWidth === right.skinWidth &&
    left.skinHeight === right.skinHeight
  );
}

function computeFlowScale(args: {
  sizingMode: FlowButtonSizingMode;
  hostWidth: number;
  hostHeight: number;
  skinWidth: number;
  skinHeight: number;
}): number {
  const { sizingMode, hostWidth, hostHeight, skinWidth, skinHeight } = args;
  if (
    hostWidth <= 0 ||
    hostHeight <= 0 ||
    skinWidth <= 0 ||
    skinHeight <= 0
  ) {
    return 1;
  }

  if (sizingMode === "intrinsic" || sizingMode === "fill-stretch") {
    return 1;
  }

  const widthScale = hostWidth / skinWidth;
  const heightScale = hostHeight / skinHeight;
  if (!Number.isFinite(widthScale) || !Number.isFinite(heightScale)) {
    return 1;
  }

  const nextScale =
    sizingMode === "cover-crop"
      ? Math.max(widthScale, heightScale)
      : Math.min(widthScale, heightScale);
  return nextScale > 0 ? nextScale : 1;
}

export const MAIN_BUTTON_BASELINE_WIDTH = 189;
export const MAIN_BUTTON_BASELINE_HEIGHT = 58;
const MAIN_BUTTON_WIDE_MIN_WIDTH = 136;
const MAIN_BUTTON_WIDE_MAX_WIDTH = 240;
const MAIN_BUTTON_TALL_MAX_HEIGHT = 280;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parsePixelDimension(value: CSSProperties["height"] | CSSProperties["width"]): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function computeDefaultAxisNormalizedFootprint(args: {
  skinWidth: number;
  skinHeight: number;
}) {
  const { skinWidth, skinHeight } = args;
  if (skinWidth <= 0 || skinHeight <= 0) {
    return null;
  }

  const aspectRatio = skinWidth / skinHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return null;
  }

  if (aspectRatio >= 1) {
    return {
      width: Math.round(
        clamp(
          skinWidth * (MAIN_BUTTON_BASELINE_HEIGHT / skinHeight),
          MAIN_BUTTON_WIDE_MIN_WIDTH,
          MAIN_BUTTON_WIDE_MAX_WIDTH
        )
      ),
      height: MAIN_BUTTON_BASELINE_HEIGHT
    };
  }

  return {
    width: MAIN_BUTTON_BASELINE_WIDTH,
    height: Math.round(
      clamp(
        skinHeight * (MAIN_BUTTON_BASELINE_WIDTH / skinWidth),
        MAIN_BUTTON_BASELINE_HEIGHT,
        MAIN_BUTTON_TALL_MAX_HEIGHT
      )
    )
  };
}

export const HostSkinButton = forwardRef<HTMLElement, HostSkinButtonProps>(
  (
    {
      label,
      styleGroup,
      importedSkin,
      hoveredOverride = false,
      highlighted = false,
      selected = false,
      active = false,
      error = false,
      flowId,
      flowLabel,
      skinCompact = false,
      highlightKey,
      highlightColor,
      hostMode = "native-button",
      sizingMode,
      footprintMode,
      footprintOverride,
      density,
      allowOverflow,
      autoInlineSize = false,
      targetHeight,
      afterContent,
      onHubPlayChange,
      className,
      style,
      type,
      disabled = false,
      tabIndex,
      onBlur,
      onClick,
      onFocus,
      onKeyDown,
      onKeyUp,
      onPointerCancel,
      onPointerDown,
      onPointerEnter,
      onPointerLeave,
      onPointerOut,
      onPointerOver,
      onPointerUp,
      ...buttonProps
    },
    ref
  ) => {
    const rootRef = useRef<HTMLElement | null>(null);
    const frameRef = useRef<HTMLSpanElement | null>(null);
    const skinRef = useRef<HTMLDivElement | null>(null);
    const holdTimerRef = useRef<number | undefined>(undefined);
    const releaseTimerRef = useRef<number | undefined>(undefined);
    const bridgeHoveredRef = useRef(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const [held, setHeld] = useState(false);
    const [playing, setPlaying] = useState(false);
    const playingRef = useRef(false);
    const playAnimationCountRef = useRef(0);
    const playSawAnimationRef = useRef(false);
    const playGraceTimerRef = useRef<number | undefined>(undefined);
    const playCapTimerRef = useRef<number | undefined>(undefined);
    const playSettleTimerRef = useRef<number | undefined>(undefined);
    const onHubPlayChangeRef = useRef(onHubPlayChange);
    const [actionPhase, setActionPhase] = useState<FlowButtonActionPhase>(
      error ? "error" : "idle"
    );
    const [transition, setTransition] = useState<FlowButtonTransition>("none");
    const [trigger, setTrigger] = useState<FlowButtonTrigger>("programmatic");
    const [measurements, setMeasurements] = useState({
      width: 0,
      height: 0,
      skinWidth: 0,
      skinHeight: 0
    });
    const resolvedFlowId = sanitizeFlowId(flowId ?? label);
    const resolvedSkinCompact = skinCompact;
    const resolvedImportedSkin =
      importedSkin ??
      (styleGroup?.skinId === "imported-skin" ? DEFAULT_FLOW_IMPORTED_SKIN : undefined);
    const usesSkinBridge = Boolean(resolvedImportedSkin);
    // Appearance-hub skins carry hubPlayLatch. They render in their OWN lane:
    // a hard chrome reset (see .host-skin-button--hub in app.css) strips every
    // host background/border/shadow/blur so the imported skin's own CSS is the
    // only thing painted. Scoped to hub skins only — stock buttons never get
    // this class and stay byte-identical.
    const isHubSkin = resolvedImportedSkin?.hubPlayLatch === true;
    const usesLegacyBodyShell = usesLegacyImportedBodyShell(resolvedImportedSkin);
    const requestedSizingMode =
      sizingMode ??
      resolvedImportedSkin?.sizingMode ??
      (resolvedImportedSkin ? "fit-uniform" : "fill-stretch");
    const resolvedSizingMode =
      footprintMode === "default-axis-normalized" &&
      resolvedImportedSkin &&
      requestedSizingMode === "intrinsic"
        ? "responsive-uniform"
        : requestedSizingMode;
    const resolvedAllowOverflow =
      allowOverflow ??
      resolvedImportedSkin?.allowOverflow ??
      (usesLegacyBodyShell
        ? false
        : resolvedSizingMode === "intrinsic" ||
            resolvedSizingMode === "fit-uniform" ||
            resolvedSizingMode === "responsive-uniform");
    const resolvedHostMode =
      hostMode === "neutral" || resolvedImportedSkin ? "neutral" : "native-button";
    const scale = computeFlowScale({
      sizingMode: resolvedSizingMode,
      hostWidth: measurements.width,
      hostHeight: measurements.height,
      skinWidth: measurements.skinWidth,
      skinHeight: measurements.skinHeight
    });
    const aspectRatio =
      measurements.width > 0 && measurements.height > 0
        ? measurements.width / measurements.height
        : undefined;
    const normalizedFootprint =
      footprintMode === "default-axis-normalized"
        ? computeDefaultAxisNormalizedFootprint({
            skinWidth: measurements.skinWidth,
            skinHeight: measurements.skinHeight
          })
        : null;
    const resolvedFootprint = footprintOverride ?? normalizedFootprint;
    const resolvedTargetHeight =
      targetHeight ?? parsePixelDimension(style?.height) ?? resolvedFootprint?.height;
    const resolvedMinInlineWidth = parsePixelDimension(style?.minWidth);
    const resolvedMaxInlineWidth = parsePixelDimension(style?.maxWidth);
    const resolvedAutoInlineWidth =
      autoInlineSize &&
      !resolvedFootprint &&
      resolvedTargetHeight &&
      measurements.skinWidth > 0 &&
      measurements.skinHeight > 0
        ? (() => {
            const computedWidth = Math.max(
              1,
              Math.round(
                measurements.skinWidth * (resolvedTargetHeight / measurements.skinHeight)
              )
            );
            const minWidth = resolvedMinInlineWidth ?? 0;
            const maxWidth = resolvedMaxInlineWidth;
            const widenedWidth = Math.max(computedWidth, minWidth);
            return typeof maxWidth === "number"
              ? Math.min(widenedWidth, maxWidth)
              : widenedWidth;
          })()
        : undefined;
    const resolvedHovered = hovered || hoveredOverride;
    const contract = {
      flowId: resolvedFlowId,
      flowLabel: flowLabel ?? label,
      hovered: resolvedHovered,
      highlighted,
      selected,
      active,
      pressed,
      held,
      play: playing,
      disabled,
      error,
      compact: resolvedSkinCompact,
      actionPhase: error ? "error" : actionPhase,
      transition,
      trigger,
      sizingMode: resolvedSizingMode,
      allowOverflow: resolvedAllowOverflow,
      hostWidth: measurements.width,
      hostHeight: measurements.height,
      scale,
      density,
      aspectRatio
    } as const;
    const resolvedClassName = buildFlowButtonClassName(
      [className, "host-skin-button", isHubSkin ? "host-skin-button--hub" : ""],
      contract
    );
    const skinSurfaceClassName = [
      className,
      isHubSkin ? "host-skin-button--hub" : ""
    ]
      .filter(Boolean)
      .join(" ");
    const skinOwnsHitbox = usesSkinBridge;
    const resolvedStyle: CSSProperties = {
      ...(style ?? {}),
      ...buildFlowButtonCssVars(contract),
      ...(resolvedFootprint
        ? {
            boxSizing: "border-box",
            minWidth: `${resolvedFootprint.width}px`,
            width: `${resolvedFootprint.width}px`,
            maxWidth: `${resolvedFootprint.width}px`,
            minHeight: `${resolvedFootprint.height}px`,
            height: `${resolvedFootprint.height}px`,
            maxHeight: `${resolvedFootprint.height}px`,
            flex: "0 0 auto",
            alignSelf: "flex-start"
          }
        : {}),
      ...(resolvedFootprint
        ? {
            ["--flow-footprint-width" as const]: `${resolvedFootprint.width}px`,
            ["--flow-footprint-height" as const]: `${resolvedFootprint.height}px`
          }
        : {}),
      ...(resolvedTargetHeight && !resolvedFootprint
        ? {
            minHeight: `${resolvedTargetHeight}px`,
            height: `${resolvedTargetHeight}px`,
            maxHeight: `${resolvedTargetHeight}px`
          }
        : {}),
      ...(resolvedAutoInlineWidth
        ? {
            display: "inline-flex",
            boxSizing: "border-box",
            minWidth: `${resolvedAutoInlineWidth}px`,
            width: `${resolvedAutoInlineWidth}px`,
            maxWidth: `${resolvedAutoInlineWidth}px`,
            flex: "0 0 auto",
            alignSelf: "flex-start"
          }
        : autoInlineSize
          ? {
              display: "inline-flex",
              flex: "0 0 auto",
              alignSelf: "flex-start"
            }
          : {}),
      ...(highlightColor
        ? {
            ["--fc-selected-highlight" as const]: highlightColor
          }
        : highlightKey
          ? {
              ["--fc-selected-highlight" as const]:
                resolveGreenHighlightColor(highlightKey)
            }
          : {}),
      pointerEvents: "auto"
    };

    const usesHubPlayLatch = resolvedImportedSkin?.hubPlayLatch === true;

    useEffect(() => {
      onHubPlayChangeRef.current = onHubPlayChange;
    }, [onHubPlayChange]);

    const clearHubPlayTimer = (timerRef: { current: number | undefined }) => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };

    const playDetachRef = useRef<(() => void) | null>(null);

    const stopHubPlay = () => {
      const wasPlaying = playingRef.current;
      playingRef.current = false;
      playAnimationCountRef.current = 0;
      playSawAnimationRef.current = false;
      clearHubPlayTimer(playGraceTimerRef);
      clearHubPlayTimer(playCapTimerRef);
      clearHubPlayTimer(playSettleTimerRef);
      playDetachRef.current?.();
      playDetachRef.current = null;
      setPlaying(false);
      if (wasPlaying) {
        onHubPlayChangeRef.current?.(false);
      }
    };

    const scheduleHubPlaySettleCheck = () => {
      clearHubPlayTimer(playSettleTimerRef);
      playSettleTimerRef.current = window.setTimeout(() => {
        playSettleTimerRef.current = undefined;
        if (!playingRef.current) {
          return;
        }
        const skinNode = skinRef.current;
        const stillRunning = skinNode
          ? skinNode
              .getAnimations({ subtree: true })
              .some((animation) => animation.playState === "running")
          : false;
        if (!stillRunning) {
          stopHubPlay();
        }
      }, HUB_PLAY_SETTLE_MS);
    };

    // Animation events do not compose across shadow boundaries, so the latch
    // listens on the skin's shadow root. Listeners attach per play (the
    // shadow root is guaranteed to exist once the user can press the skin).
    const startHubPlay = () => {
      if (!usesHubPlayLatch || playingRef.current) {
        return;
      }
      const shadowRoot = skinRef.current?.shadowRoot;
      if (!shadowRoot) {
        return;
      }
      playingRef.current = true;
      playAnimationCountRef.current = 0;
      playSawAnimationRef.current = false;
      onHubPlayChangeRef.current?.(true);

      const handleAnimationStart = () => {
        if (!playingRef.current) {
          return;
        }
        playSawAnimationRef.current = true;
        playAnimationCountRef.current += 1;
      };
      const handleAnimationEnd = () => {
        if (!playingRef.current) {
          return;
        }
        playAnimationCountRef.current -= 1;
        if (playSawAnimationRef.current && playAnimationCountRef.current <= 0) {
          stopHubPlay();
          return;
        }
        scheduleHubPlaySettleCheck();
      };
      shadowRoot.addEventListener("animationstart", handleAnimationStart);
      shadowRoot.addEventListener("animationend", handleAnimationEnd);
      shadowRoot.addEventListener("animationcancel", handleAnimationEnd);
      playDetachRef.current = () => {
        shadowRoot.removeEventListener("animationstart", handleAnimationStart);
        shadowRoot.removeEventListener("animationend", handleAnimationEnd);
        shadowRoot.removeEventListener("animationcancel", handleAnimationEnd);
      };

      setPlaying(true);
      playGraceTimerRef.current = window.setTimeout(() => {
        if (!playSawAnimationRef.current) {
          stopHubPlay();
        }
      }, HUB_PLAY_GRACE_MS);
      playCapTimerRef.current = window.setTimeout(stopHubPlay, HUB_PLAY_MAX_MS);
    };

    useEffect(() => {
      return () => {
        if (playingRef.current) {
          onHubPlayChangeRef.current?.(false);
        }
        playingRef.current = false;
        clearHubPlayTimer(playGraceTimerRef);
        clearHubPlayTimer(playCapTimerRef);
        clearHubPlayTimer(playSettleTimerRef);
        playDetachRef.current?.();
        playDetachRef.current = null;
      };
    }, []);

    const clearHoldTimer = () => {
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = undefined;
      }
    };

    const clearReleaseTimer = () => {
      if (releaseTimerRef.current !== undefined) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = undefined;
      }
    };

    const beginInteraction = (nextTrigger: FlowButtonTrigger) => {
      if (disabled) {
        return;
      }
      clearReleaseTimer();
      clearHoldTimer();
      startHubPlay();
      setTrigger(nextTrigger);
      setPressed(true);
      setHeld(false);
      setTransition("in");
      setActionPhase(error ? "error" : "press");
      holdTimerRef.current = window.setTimeout(() => {
        setHeld(true);
        setActionPhase(error ? "error" : "hold");
        setTransition("in");
      }, HOLD_DELAY_MS);
    };

    const finishInteraction = () => {
      clearHoldTimer();
      setPressed(false);
      setHeld(false);
      setTransition("out");
      setActionPhase(error ? "error" : "release");
      clearReleaseTimer();
      releaseTimerRef.current = window.setTimeout(() => {
        setActionPhase(error ? "error" : "idle");
        setTransition("none");
      }, RELEASE_PHASE_MS);
    };

    useEffect(() => {
      return () => {
        clearHoldTimer();
        clearReleaseTimer();
      };
    }, []);

    useEffect(() => {
      if (!pressed || trigger !== "pointer") {
        return;
      }

      const handlePointerFinish = () => {
        finishInteraction();
      };

      window.addEventListener("pointerup", handlePointerFinish);
      window.addEventListener("pointercancel", handlePointerFinish);
      return () => {
        window.removeEventListener("pointerup", handlePointerFinish);
        window.removeEventListener("pointercancel", handlePointerFinish);
      };
    }, [pressed, trigger, error]);

    useEffect(() => {
      if (!usesSkinBridge) {
        return;
      }

      const skinNode = skinRef.current;
      if (!skinNode) {
        return;
      }

      const handleSkinState = (
        event: Event
      ) => {
        const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
        if (typeof detail.hovered === "boolean") {
          const nextHovered = detail.hovered;
          if (bridgeHoveredRef.current !== nextHovered) {
            bridgeHoveredRef.current = nextHovered;
            const rootNode = rootRef.current;
            if (rootNode) {
              const syntheticPointerEvent = {
                currentTarget: rootNode,
                target: rootNode
              } as unknown as ReactPointerEvent<HTMLButtonElement | HTMLDivElement>;
              if (nextHovered) {
                onPointerEnter?.(syntheticPointerEvent as ReactPointerEvent<HTMLButtonElement>);
              } else {
                onPointerLeave?.(syntheticPointerEvent as ReactPointerEvent<HTMLButtonElement>);
              }
            }
          }
          setHovered(detail.hovered);
        }
        if (typeof detail.pressed === "boolean") {
          if (detail.pressed) {
            beginInteraction("pointer");
          } else {
            finishInteraction();
          }
        }
      };
      const handleSkinActivate = (event: Event) => {
        if (disabled) {
          return;
        }
        const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
        const clickEvent = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          altKey: detail.altKey === true,
          button: typeof detail.button === "number" ? detail.button : 0,
          buttons: typeof detail.buttons === "number" ? detail.buttons : 0,
          clientX: typeof detail.clientX === "number" ? detail.clientX : 0,
          clientY: typeof detail.clientY === "number" ? detail.clientY : 0,
          ctrlKey: detail.ctrlKey === true,
          detail: typeof detail.detail === "number" ? detail.detail : 1,
          metaKey: detail.metaKey === true,
          screenX: typeof detail.screenX === "number" ? detail.screenX : 0,
          screenY: typeof detail.screenY === "number" ? detail.screenY : 0,
          shiftKey: detail.shiftKey === true,
          view: window
        });
        rootRef.current?.focus();
        rootRef.current?.dispatchEvent(clickEvent);
      };
      const handleSkinPointerDown = (event: Event) => {
        if (disabled) {
          return;
        }

        const rootNode = rootRef.current;
        if (!rootNode) {
          return;
        }

        const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
        let defaultPrevented = false;
        const syntheticPointerEvent = {
          altKey: detail.altKey === true,
          button: typeof detail.button === "number" ? detail.button : 0,
          buttons: typeof detail.buttons === "number" ? detail.buttons : 0,
          clientX: typeof detail.clientX === "number" ? detail.clientX : 0,
          clientY: typeof detail.clientY === "number" ? detail.clientY : 0,
          ctrlKey: detail.ctrlKey === true,
          currentTarget: rootNode,
          get defaultPrevented() {
            return defaultPrevented;
          },
          metaKey: detail.metaKey === true,
          preventDefault: () => {
            defaultPrevented = true;
          },
          screenX: typeof detail.screenX === "number" ? detail.screenX : 0,
          screenY: typeof detail.screenY === "number" ? detail.screenY : 0,
          shiftKey: detail.shiftKey === true,
          stopPropagation: () => undefined,
          target: rootNode
        } as unknown as ReactPointerEvent<HTMLButtonElement>;
        onPointerDown?.(syntheticPointerEvent);
      };
      const handleSkinContextMenu = (event: Event) => {
        if (disabled) {
          return;
        }
        const detail = (event as CustomEvent<Record<string, unknown>>).detail ?? {};
        const contextMenuEvent = new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: typeof detail.clientX === "number" ? detail.clientX : 0,
          clientY: typeof detail.clientY === "number" ? detail.clientY : 0
        });
        rootRef.current?.dispatchEvent(contextMenuEvent);
      };
      const handleSkinFocusRequest = () => {
        rootRef.current?.focus();
      };

      skinNode.addEventListener("flow-skin-state", handleSkinState as EventListener);
      skinNode.addEventListener("flow-skin-activate", handleSkinActivate as EventListener);
      skinNode.addEventListener("flow-skin-pointerdown", handleSkinPointerDown as EventListener);
      skinNode.addEventListener("flow-skin-contextmenu", handleSkinContextMenu as EventListener);
      skinNode.addEventListener(
        "flow-skin-request-focus",
        handleSkinFocusRequest as EventListener
      );

      return () => {
        skinNode.removeEventListener("flow-skin-state", handleSkinState as EventListener);
        skinNode.removeEventListener(
          "flow-skin-activate",
          handleSkinActivate as EventListener
        );
        skinNode.removeEventListener(
          "flow-skin-pointerdown",
          handleSkinPointerDown as EventListener
        );
        skinNode.removeEventListener(
          "flow-skin-contextmenu",
          handleSkinContextMenu as EventListener
        );
        skinNode.removeEventListener(
          "flow-skin-request-focus",
          handleSkinFocusRequest as EventListener
        );
      };
    }, [
      disabled,
      usesSkinBridge,
      onClick,
      onPointerDown,
      onPointerEnter,
      onPointerLeave,
      onPointerUp,
      error
    ]);

    useLayoutEffect(() => {
      const updateMeasurements = () => {
        const frameNode = frameRef.current;
        const skinNode = skinRef.current;
        if (!frameNode || !skinNode) {
          return;
        }

        const importedHtmlNode = resolvedImportedSkin
          ? (skinNode.shadowRoot?.querySelector(
              "[data-flow-imported-html]"
            ) as HTMLElement | null)
          : null;
        const importedMeasureNode = resolvedImportedSkin
          ? (skinNode.shadowRoot?.querySelector(
              "[data-flow-measure='true']"
            ) as HTMLElement | null)
          : null;
        const measurableSkinNode =
          importedMeasureNode ??
          (importedHtmlNode?.firstElementChild as HTMLElement | null) ??
          importedHtmlNode ??
          skinNode;
        const useIntrinsicScrollMeasurement =
          Boolean(resolvedImportedSkin) &&
          (footprintMode === "default-axis-normalized" || autoInlineSize);
        const readMeasuredDimension = (key: string, fallback: number) => {
          const value = Number(measurableSkinNode.dataset[key]);
          return Number.isFinite(value) && value > 0 ? value : fallback;
        };
        const measuredOffsetWidth = readMeasuredDimension(
          "flowMeasuredOffsetWidth",
          measurableSkinNode.offsetWidth
        );
        const measuredOffsetHeight = readMeasuredDimension(
          "flowMeasuredOffsetHeight",
          measurableSkinNode.offsetHeight
        );
        const measuredScrollWidth = readMeasuredDimension(
          "flowMeasuredScrollWidth",
          measurableSkinNode.scrollWidth
        );
        const measuredScrollHeight = readMeasuredDimension(
          "flowMeasuredScrollHeight",
          measurableSkinNode.scrollHeight
        );
        const measuredSkinWidth = useIntrinsicScrollMeasurement
          ? Math.max(measuredScrollWidth, measuredOffsetWidth)
          : measuredOffsetWidth;
        const measuredSkinHeight = useIntrinsicScrollMeasurement
          ? Math.max(measuredScrollHeight, measuredOffsetHeight)
          : measuredOffsetHeight;

        const nextMeasurements = {
          width: Math.round(frameNode.clientWidth),
          height: Math.round(frameNode.clientHeight),
          skinWidth: Math.round(measuredSkinWidth),
          skinHeight: Math.round(measuredSkinHeight)
        };
        setMeasurements((current) =>
          areMeasurementsEqual(current, nextMeasurements)
            ? current
            : nextMeasurements
        );
      };

      updateMeasurements();
      const currentSkinNode = skinRef.current;
      const handleSkinContentReady = () => {
        updateMeasurements();
      };
      const animationFrameId = window.requestAnimationFrame(() => {
        updateMeasurements();
      });
      currentSkinNode?.addEventListener(
        "flow-skin-content-ready",
        handleSkinContentReady as EventListener
      );
      if (typeof ResizeObserver === "undefined") {
        return () => {
          window.cancelAnimationFrame(animationFrameId);
          currentSkinNode?.removeEventListener(
            "flow-skin-content-ready",
            handleSkinContentReady as EventListener
          );
        };
      }

      const observer = new ResizeObserver(() => {
        updateMeasurements();
      });
      if (frameRef.current) {
        observer.observe(frameRef.current);
      }
      if (skinRef.current) {
        observer.observe(skinRef.current);
      }
      return () => {
        window.cancelAnimationFrame(animationFrameId);
        currentSkinNode?.removeEventListener(
          "flow-skin-content-ready",
          handleSkinContentReady as EventListener
        );
        observer.disconnect();
      };
    }, [
      label,
      selected,
      active,
      error,
      resolvedSkinCompact,
      resolvedImportedSkin,
      footprintMode,
      styleGroup,
      resolvedSizingMode
    ]);

    const setRootRef = (node: HTMLElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") {
        ref(node);
        return;
      }
      if (ref) {
        ref.current = node;
      }
    };

    const isNodeWithinElementOrShadow = (
      root: HTMLElement,
      candidate: EventTarget | null
    ) => {
      if (!(candidate instanceof Node)) {
        return false;
      }
      if (root.contains(candidate)) {
        return true;
      }

      let current: Node | null = candidate;
      while (current) {
        if (current === root) {
          return true;
        }
        const currentRoot = current.getRootNode?.();
        if (currentRoot instanceof ShadowRoot) {
          current = currentRoot.host;
          continue;
        }
        current = current.parentNode;
      }
      return false;
    };

    const handlePointerDown = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerDown?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      if (event.defaultPrevented || disabled) {
        return;
      }
      beginInteraction("pointer");
    };

    const handlePointerEnter = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerEnter?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      if (disabled) {
        return;
      }
      setHovered(true);
    };

    const handlePointerOver = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerOver?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      if (disabled) {
        return;
      }
      setHovered(true);
    };

    const handlePointerLeave = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerLeave?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      setHovered(false);
    };

    const handlePointerOut = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerOut?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      const currentTarget = event.currentTarget as HTMLElement;
      if (isNodeWithinElementOrShadow(currentTarget, event.relatedTarget)) {
        return;
      }
      setHovered(false);
    };

    const handlePointerUp = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerUp?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      if (event.defaultPrevented || disabled) {
        return;
      }
      finishInteraction();
    };

    const handlePointerCancel = (
      event: ReactPointerEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onPointerCancel?.(
        event as unknown as ReactPointerEvent<HTMLButtonElement>
      );
      finishInteraction();
    };

    const handleBlur = (
      event: ReactFocusEvent<HTMLButtonElement | HTMLDivElement>
    ) => {
      onBlur?.(event as unknown as ReactFocusEvent<HTMLButtonElement>);
      finishInteraction();
    };

    const handleNativeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled || event.repeat) {
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        beginInteraction("keyboard");
      }
    };

    const handleNativeKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      onKeyUp?.(event);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        finishInteraction();
      }
    };

    const handleNeutralClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      if (disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.(event as unknown as ReactMouseEvent<HTMLButtonElement>);
    };

    const handleNeutralKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (
        !event.repeat &&
        (event.key === "Enter" || event.key === " " || event.key === "Spacebar")
      ) {
        beginInteraction("keyboard");
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.click();
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
      }
    };

    const handleNeutralKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyUp?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.currentTarget.click();
      }
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        finishInteraction();
      }
    };

    const frameStyle: CSSProperties | undefined =
      resolvedFootprint || resolvedTargetHeight || skinOwnsHitbox
        ? {
            ...(resolvedFootprint || resolvedTargetHeight
              ? {
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  minHeight: 0,
                  justifyItems: "stretch",
                  alignItems: "stretch"
                }
              : {}),
            ...(skinOwnsHitbox
              ? {
                  pointerEvents: "none"
                }
              : {})
          }
        : undefined;

    const frame = (
      <>
        <span
          ref={frameRef}
          className="host-skin-button__frame"
          style={frameStyle}
          data-flow-sizing={resolvedSizingMode}
          data-flow-overflow={resolvedAllowOverflow ? "true" : "false"}
        >
          {renderButtonSkin({
            label,
            styleGroup,
            importedSkin: resolvedImportedSkin,
            selected,
            compact: resolvedSkinCompact,
            contract,
            hostClassName: skinSurfaceClassName,
            footprintMode,
            skinRef: skinRef,
            onSkinPointerEnter:
              resolvedImportedSkin && !usesSkinBridge ? handlePointerEnter : undefined,
            onSkinPointerLeave:
              resolvedImportedSkin && !usesSkinBridge ? handlePointerLeave : undefined
          })}
        </span>
        {afterContent}
      </>
    );

    if (resolvedHostMode === "neutral") {
      const neutralProps = buttonProps as unknown as HTMLAttributes<HTMLDivElement>;
      return (
        <div
          ref={setRootRef}
          role="button"
          tabIndex={disabled ? -1 : (tabIndex ?? 0)}
          aria-disabled={disabled ? "true" : undefined}
          {...neutralProps}
          className={resolvedClassName}
          style={resolvedStyle}
          onBlur={handleBlur}
          onClick={handleNeutralClick}
          onFocus={onFocus as unknown as HTMLAttributes<HTMLDivElement>["onFocus"]}
          onKeyDown={handleNeutralKeyDown}
          onKeyUp={handleNeutralKeyUp}
          onPointerCancel={usesSkinBridge ? undefined : handlePointerCancel}
          onPointerDown={usesSkinBridge ? undefined : handlePointerDown}
          onPointerEnter={usesSkinBridge ? undefined : handlePointerEnter}
          onPointerLeave={usesSkinBridge ? undefined : handlePointerLeave}
          onPointerOut={usesSkinBridge ? undefined : handlePointerOut}
          onPointerOver={usesSkinBridge ? undefined : handlePointerOver}
          onPointerUp={usesSkinBridge ? undefined : handlePointerUp}
          data-flow-footprint={footprintMode}
          data-flow-hitbox-source={skinOwnsHitbox ? "skin" : undefined}
          {...buildFlowButtonDataAttributes(contract)}
        >
          {frame}
        </div>
      );
    }

    return (
      <button
        ref={setRootRef}
        type={type}
        disabled={disabled}
        tabIndex={tabIndex}
        {...buttonProps}
        className={resolvedClassName}
        style={resolvedStyle}
        onBlur={handleBlur}
        onClick={onClick}
        onFocus={onFocus}
        onKeyDown={handleNativeKeyDown}
        onKeyUp={handleNativeKeyUp}
        onPointerCancel={usesSkinBridge ? undefined : handlePointerCancel}
        onPointerDown={usesSkinBridge ? undefined : handlePointerDown}
        onPointerEnter={usesSkinBridge ? undefined : handlePointerEnter}
        onPointerLeave={usesSkinBridge ? undefined : handlePointerLeave}
        onPointerOut={usesSkinBridge ? undefined : handlePointerOut}
        onPointerOver={usesSkinBridge ? undefined : handlePointerOver}
        onPointerUp={usesSkinBridge ? undefined : handlePointerUp}
        data-flow-footprint={footprintMode}
        data-flow-hitbox-source={skinOwnsHitbox ? "skin" : undefined}
        {...buildFlowButtonDataAttributes(contract)}
      >
        {frame}
      </button>
    );
  }
);

HostSkinButton.displayName = "HostSkinButton";
