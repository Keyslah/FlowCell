import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ButtonSurface } from "../ButtonSurface";
import {
  executeButtonRecord,
  type ButtonExecutionResult
} from "../runtime/ButtonRuntimeAdapter";
import { resolvePanelOwnerFanPlacement } from "../state/panelOwnerButtonOperations";
import type {
  ButtonCoreMeasurement,
  ButtonFanSetup,
  ButtonPlacement,
  ButtonRect,
  ButtonRecord,
  ButtonStateDocument,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import {
  buttonFanCollapsedTransform,
  resolveButtonFanMotionItems,
  type ButtonFanMotionDirection,
  type ButtonFanMotionStyle
} from "./buttonFanMotion";
import "./buttonFan.css";

export type ButtonFanMotionPhase = "resting" | ButtonFanMotionDirection;

function setFanMotionWrapperInert(wrapper: HTMLElement, inert: boolean): void {
  wrapper.toggleAttribute("inert", inert);
  if (inert) {
    wrapper.setAttribute("aria-hidden", "true");
    wrapper.setAttribute("data-button-fan-motion-child", "true");
  } else {
    wrapper.removeAttribute("aria-hidden");
    wrapper.removeAttribute("data-button-fan-motion-child");
  }
}

function clearFanMotionWrapperStyles(wrapper: HTMLElement): void {
  wrapper.style.removeProperty("opacity");
  wrapper.style.removeProperty("transform");
  wrapper.style.removeProperty("transform-origin");
  wrapper.style.removeProperty("visibility");
  wrapper.style.removeProperty("will-change");
}

function supportedFanMotionEasing(value: unknown): string {
  if (typeof value !== "string") return "ease-out";
  const candidate = value.trim();
  if (!candidate) return "ease-out";
  try {
    return typeof CSS === "undefined" || CSS.supports("animation-timing-function", candidate)
      ? candidate
      : "ease-out";
  } catch {
    return "ease-out";
  }
}

function buildCollapsedPanelOwnerDocument(args: {
  document: ButtonStateDocument;
  setup: ButtonFanSetup;
}): { document: ButtonStateDocument; surfaceId: string; sourcePlacementId: string } | null {
  const sourcePlacement = resolvePanelOwnerFanPlacement(args.document, args.setup.id);
  if (!sourcePlacement) {
    return null;
  }

  const surfaceId = `button-window-panel-owner-surface:${args.setup.panelOwnerButtonId}`;
  const placementId = `button-window-panel-owner-placement:${args.setup.panelOwnerButtonId}`;
  const sourceThemeOverride = args.document.themeOverrides?.[sourcePlacement.id];
  return {
    surfaceId,
    sourcePlacementId: sourcePlacement.id,
    document: {
      ...args.document,
      placements: {
        ...args.document.placements,
        [placementId]: {
          ...sourcePlacement,
          id: placementId,
          surfaceId,
          x: 0,
          y: 0,
          zIndex: 0
        }
      },
      surfaces: {
        ...args.document.surfaces,
        [surfaceId]: {
          id: surfaceId,
          name: `${args.setup.name} panel owner`,
          kind: "fan",
          width: sourcePlacement.width,
          height: sourcePlacement.height,
          placementIds: [placementId],
          visualOverflowAllowance: 0,
          uniformButtonSize: null
        }
      },
      themeOverrides: sourceThemeOverride
        ? { ...args.document.themeOverrides, [placementId]: sourceThemeOverride }
        : args.document.themeOverrides
    }
  };
}

export interface ButtonFanRendererProps {
  document: ButtonStateDocument;
  setup: ButtonFanSetup;
  expanded: boolean;
  motionPhase?: ButtonFanMotionPhase;
  motionSequence?: number;
  motionStyles?: readonly ButtonFanMotionStyle[];
  onMotionStart?: (phase: ButtonFanMotionDirection, sequence: number) => void;
  onMotionComplete?: (phase: ButtonFanMotionDirection, sequence: number) => void;
  onOwnerActivate: (button: ButtonRecord) => void | Promise<void>;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onHoverCancel?: () => void;
  onExecutionResult?: (placementId: string, result: ButtonExecutionResult) => void;
  onPlacementMeasurement?: (
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => void;
  onPlacementNaturalMeasurement?: (
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => void;
  onPlacementVisualMeasurement?: (
    placementId: string,
    measurement: ButtonVisualMeasurement
  ) => void;
  onPreparePlacementVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onPlacementVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
  surfaceEnvelope?: ButtonRect;
}

export function ButtonFanRenderer({
  document,
  setup,
  expanded,
  motionPhase = "resting",
  motionSequence = 0,
  motionStyles = [],
  onMotionStart,
  onMotionComplete,
  onOwnerActivate,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onExecutionResult,
  onPlacementMeasurement,
  onPlacementNaturalMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  surfaceEnvelope
}: ButtonFanRendererProps) {
  const expandedSurfaceRef = useRef<HTMLDivElement | null>(null);
  const activeAnimationsRef = useRef<Animation[]>([]);
  const activeMotionPhaseRef = useRef<ButtonFanMotionDirection | null>(null);
  const animationGenerationRef = useRef(0);
  const collapsedOwner = useMemo(
    () => buildCollapsedPanelOwnerDocument({ document, setup }),
    [document, setup]
  );
  const spinMotionEnabled = motionStyles.includes("spin");

  useLayoutEffect(() => {
    const surfaceRoot = expandedSurfaceRef.current;
    const ownerPlacementId = collapsedOwner?.sourcePlacementId;
    const surface = document.surfaces[setup.fanSurfaceId];
    const placements = surface?.placementIds
      .map((placementId) => document.placements[placementId])
      .filter((placement): placement is ButtonPlacement => Boolean(placement)) ?? [];
    const wrappers = surfaceRoot
      ? Array.from(surfaceRoot.querySelectorAll<HTMLElement>("[data-button-placement-id]"))
      : [];
    const childWrappers = wrappers.filter(
      (wrapper) => wrapper.dataset.buttonPlacementId !== ownerPlacementId
    );
    const generation = ++animationGenerationRef.current;

    const previousPhase = activeMotionPhaseRef.current;
    const previousStyles = new Map<HTMLElement, { transform: string; opacity: string }>();
    if (previousPhase) {
      childWrappers.forEach((wrapper) => {
        const style = window.getComputedStyle(wrapper);
        previousStyles.set(wrapper, {
          transform: style.transform === "none" ? "none" : style.transform,
          opacity: style.opacity || "1"
        });
      });
    }
    activeAnimationsRef.current.forEach((animation) => animation.cancel());
    activeAnimationsRef.current = [];
    activeMotionPhaseRef.current = null;

    const restoreOpenWrappers = () => {
      childWrappers.forEach((wrapper) => {
        clearFanMotionWrapperStyles(wrapper);
        setFanMotionWrapperInert(wrapper, false);
      });
    };

    if (!expanded || motionPhase === "resting" || !spinMotionEnabled) {
      if (expanded) restoreOpenWrappers();
      if (motionPhase !== "resting" && !spinMotionEnabled) {
        queueMicrotask(() => {
          if (animationGenerationRef.current === generation) {
            onMotionComplete?.(motionPhase, motionSequence);
          }
        });
      }
      return;
    }

    const reducedMotion = typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = resolveButtonFanMotionItems({
      placements,
      ownerPlacementId: ownerPlacementId ?? "",
      animation: setup.animation,
      direction: motionPhase,
      reducedMotion
    });
    const wrappersByPlacementId = new Map(
      childWrappers.map((wrapper) => [wrapper.dataset.buttonPlacementId ?? "", wrapper])
    );
    const motionEntries = items.flatMap((item) => {
      const wrapper = wrappersByPlacementId.get(item.placementId);
      return wrapper ? [{ item, wrapper }] : [];
    });

    childWrappers.forEach((wrapper) => {
      setFanMotionWrapperInert(wrapper, true);
      wrapper.style.transformOrigin = "center center";
      wrapper.style.willChange = "transform, opacity";
    });
    activeMotionPhaseRef.current = motionPhase;
    onMotionStart?.(motionPhase, motionSequence);

    if (motionEntries.length === 0) {
      if (motionPhase === "opening") restoreOpenWrappers();
      queueMicrotask(() => {
        if (animationGenerationRef.current === generation) {
          activeMotionPhaseRef.current = null;
          onMotionComplete?.(motionPhase, motionSequence);
        }
      });
      return;
    }

    const reversing = previousPhase !== null && previousPhase !== motionPhase;
    const easing = supportedFanMotionEasing(setup.animation.easing);
    const animations = motionEntries.map(({ item, wrapper }) => {
      const collapsedTransform = buttonFanCollapsedTransform(item);
      const previous = previousStyles.get(wrapper);
      const fromTransform = previous?.transform ?? (
        motionPhase === "opening" ? collapsedTransform : "none"
      );
      const fromOpacity = previous?.opacity ?? (motionPhase === "opening" ? "0" : "1");
      const toTransform = motionPhase === "opening" ? "none" : collapsedTransform;
      const toOpacity = motionPhase === "opening" ? "1" : "0";
      return wrapper.animate([
        { transform: fromTransform, opacity: fromOpacity },
        { transform: toTransform, opacity: toOpacity }
      ], {
        duration: item.durationMs,
        delay: reversing ? 0 : item.delayMs,
        easing,
        fill: "both"
      });
    });
    activeAnimationsRef.current = animations;

    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (animationGenerationRef.current !== generation) return;
      motionEntries.forEach(({ item, wrapper }) => {
        if (motionPhase === "opening") {
          clearFanMotionWrapperStyles(wrapper);
          setFanMotionWrapperInert(wrapper, false);
          return;
        }
        wrapper.style.transform = buttonFanCollapsedTransform(item);
        wrapper.style.opacity = "0";
        wrapper.style.visibility = "hidden";
        wrapper.style.removeProperty("will-change");
      });
      animations.forEach((animation) => animation.cancel());
      activeAnimationsRef.current = [];
      activeMotionPhaseRef.current = null;
      onMotionComplete?.(motionPhase, motionSequence);
    });
  }, [
    collapsedOwner?.sourcePlacementId,
    document,
    expanded,
    motionPhase,
    motionSequence,
    onMotionComplete,
    onMotionStart,
    setup.animation,
    setup.fanSurfaceId,
    spinMotionEnabled
  ]);

  useEffect(() => () => {
    animationGenerationRef.current += 1;
    activeAnimationsRef.current.forEach((animation) => animation.cancel());
    activeAnimationsRef.current = [];
    activeMotionPhaseRef.current = null;
  }, []);

  if (!expanded) {
    if (!collapsedOwner) {
      return <div className="button-window-error">Panel-owner placement is missing.</div>;
    }
    const surface = collapsedOwner.document.surfaces[collapsedOwner.surfaceId];
    const envelope = surfaceEnvelope ?? { x: 0, y: 0, width: surface.width, height: surface.height };
    return (
      <div className="button-fan-renderer__surface-frame" style={{ width: envelope.width, height: envelope.height }}>
        <div
          className="button-fan-renderer button-fan-renderer--collapsed"
          style={{
            width: surface.width,
            height: surface.height,
            transform: `translate(${-envelope.x}px, ${-envelope.y}px)`
          }}
        >
          <ButtonSurface
            document={collapsedOwner.document}
            surfaceId={collapsedOwner.surfaceId}
            mode="run"
            onPlacementMeasurement={onPlacementMeasurement}
            visualMeasurementSamplingKey={motionPhase === "resting" ? motionSequence : undefined}
            onPlacementNaturalMeasurement={(_placementId, measurement) =>
              onPlacementNaturalMeasurement?.(collapsedOwner.sourcePlacementId, measurement)}
            onPlacementVisualMeasurement={onPlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
            onPlacementVisualStateChange={onPlacementVisualStateChange}
            onActivate={(_placementId: string, button: ButtonRecord) => onOwnerActivate(button)}
            onHoverStart={() => onHoverStart?.()}
            onHoverEnd={() => onHoverEnd?.()}
            onHoverCancel={() => onHoverCancel?.()}
          />
        </div>
      </div>
    );
  }

  const surface = document.surfaces[setup.fanSurfaceId];
  if (!surface) {
    return <div className="button-window-error">Fan surface is missing.</div>;
  }

  const envelope = surfaceEnvelope ?? { x: 0, y: 0, width: surface.width, height: surface.height };
  return (
    <div className="button-fan-renderer__surface-frame" style={{ width: envelope.width, height: envelope.height }}>
      <div
        ref={expandedSurfaceRef}
        className="button-fan-renderer button-fan-renderer--expanded"
        style={{
          width: surface.width,
          height: surface.height,
          transform: `translate(${-envelope.x}px, ${-envelope.y}px)`
        }}
      >
      <ButtonSurface
        document={document}
        surfaceId={surface.id}
        mode="run"
        onPlacementMeasurement={onPlacementMeasurement}
        visualMeasurementSamplingKey={motionPhase === "resting" ? motionSequence : undefined}
        onPlacementNaturalMeasurement={onPlacementNaturalMeasurement}
        onPlacementVisualMeasurement={onPlacementVisualMeasurement}
        onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
        onPlacementVisualStateChange={onPlacementVisualStateChange}
        onExecutionResult={onExecutionResult}
        onActivate={async (_placementId: string, button: ButtonRecord) => {
          if (button.id === setup.panelOwnerButtonId) {
            await onOwnerActivate(button);
            return;
          }
          await executeButtonRecord(button, "click");
        }}
        onHoverStart={() => onHoverStart?.()}
        onHoverEnd={() => onHoverEnd?.()}
        onHoverCancel={() => onHoverCancel?.()}
      />
      </div>
    </div>
  );
}

export default ButtonFanRenderer;
