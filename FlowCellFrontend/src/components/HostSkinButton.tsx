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
import type { ImportedSkin, StyleGroup } from "../types";

const HOLD_DELAY_MS = 280;
const RELEASE_PHASE_MS = 140;

interface FlowButtonFootprintOverride {
  width: number;
  height: number;
}

const MAIN_BUTTON_SIZE_PERCENT_DEFAULT = 100;
const MAIN_BUTTON_SIZE_PERCENT_MIN = 40;
const MAIN_BUTTON_SIZE_PERCENT_MAX = 220;

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

interface HostSkinButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
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
  afterContent?: ReactNode;
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
      afterContent,
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
    const frameRef = useRef<HTMLSpanElement | null>(null);
    const skinRef = useRef<HTMLDivElement | null>(null);
    const holdTimerRef = useRef<number | undefined>(undefined);
    const releaseTimerRef = useRef<number | undefined>(undefined);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const [held, setHeld] = useState(false);
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
    const usesLegacyBodyShell = usesLegacyImportedBodyShell(importedSkin);
    const requestedSizingMode =
      sizingMode ??
      importedSkin?.sizingMode ??
      (importedSkin ? "fit-uniform" : "fill-stretch");
    const resolvedSizingMode =
      footprintMode === "default-axis-normalized" &&
      importedSkin &&
      requestedSizingMode === "intrinsic"
        ? "responsive-uniform"
        : requestedSizingMode;
    const resolvedAllowOverflow =
      allowOverflow ??
      importedSkin?.allowOverflow ??
      (usesLegacyBodyShell
        ? false
        : resolvedSizingMode === "intrinsic" ||
            resolvedSizingMode === "fit-uniform" ||
            resolvedSizingMode === "responsive-uniform");
    const resolvedHostMode =
      hostMode === "neutral" || importedSkin ? "neutral" : "native-button";
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
    const contract = {
      flowId: resolvedFlowId,
      flowLabel: flowLabel ?? label,
      hovered,
      selected,
      active,
      pressed,
      held,
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
      [className, "host-skin-button"],
      contract
    );
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
      ...(highlightColor
        ? {
            ["--fc-selected-highlight" as const]: highlightColor
          }
        : highlightKey
          ? {
              ["--fc-selected-highlight" as const]:
                resolveGreenHighlightColor(highlightKey)
            }
          : {})
    };

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

    useLayoutEffect(() => {
      const updateMeasurements = () => {
        const frameNode = frameRef.current;
        const skinNode = skinRef.current;
        if (!frameNode || !skinNode) {
          return;
        }

        const importedHtmlNode = importedSkin
          ? (skinNode.shadowRoot?.querySelector(
              "[data-flow-imported-html]"
            ) as HTMLElement | null)
          : null;
        const measurableSkinNode =
          (importedHtmlNode?.firstElementChild as HTMLElement | null) ??
          importedHtmlNode ??
          skinNode;
        const useIntrinsicScrollMeasurement =
          Boolean(importedSkin) && footprintMode === "default-axis-normalized";
        const measuredSkinWidth = useIntrinsicScrollMeasurement
          ? Math.max(measurableSkinNode.scrollWidth, measurableSkinNode.offsetWidth)
          : measurableSkinNode.offsetWidth;
        const measuredSkinHeight = useIntrinsicScrollMeasurement
          ? Math.max(measurableSkinNode.scrollHeight, measurableSkinNode.offsetHeight)
          : measurableSkinNode.offsetHeight;

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
      importedSkin,
      footprintMode,
      styleGroup,
      resolvedSizingMode
    ]);

    const setRootRef = (node: HTMLElement | null) => {
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

    const frameStyle: CSSProperties | undefined = resolvedFootprint
      ? {
          width: "100%",
          height: "100%",
          minHeight: 0
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
            importedSkin,
            selected,
            compact: resolvedSkinCompact,
            contract,
            hostClassName: className,
            footprintMode,
            skinRef: skinRef,
            onSkinPointerEnter: importedSkin ? handlePointerEnter : undefined,
            onSkinPointerLeave: importedSkin ? handlePointerLeave : undefined
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
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          onPointerOut={handlePointerOut}
          onPointerOver={handlePointerOver}
          onPointerUp={handlePointerUp}
          data-flow-footprint={footprintMode}
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
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerOut={handlePointerOut}
        onPointerOver={handlePointerOver}
        onPointerUp={handlePointerUp}
        data-flow-footprint={footprintMode}
        {...buildFlowButtonDataAttributes(contract)}
      >
        {frame}
      </button>
    );
  }
);

HostSkinButton.displayName = "HostSkinButton";
