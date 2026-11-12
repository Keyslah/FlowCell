import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ButtonFanAnimationSettings, ButtonPlacement, ButtonStateDocument } from "../types";
import {
  buttonFanCollapsedTransform,
  resolveButtonFanMotionItems,
  type ButtonFanMotionDirection
} from "./buttonFanMotion";

export type ButtonFanMotionPhase = "resting" | ButtonFanMotionDirection;

const DISABLED_FAN_ANIMATION: ButtonFanAnimationSettings = {
  durationMs: 180,
  easing: "ease-out",
  staggerMs: 30,
  spinEnabled: false
};

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

export interface UseButtonFanMotionArgs {
  surfaceRootRef: RefObject<HTMLElement | null>;
  document: ButtonStateDocument;
  surfaceId: string;
  ownerPlacementId: string | null | undefined;
  animation?: ButtonFanAnimationSettings;
  enabled: boolean;
  expanded: boolean;
  motionPhase?: ButtonFanMotionPhase;
  motionSequence?: number;
  onMotionStart?: (phase: ButtonFanMotionDirection, sequence: number) => void;
  onMotionComplete?: (phase: ButtonFanMotionDirection, sequence: number) => void;
}

export function useButtonFanMotion({
  surfaceRootRef,
  document,
  surfaceId,
  ownerPlacementId,
  animation,
  enabled,
  expanded,
  motionPhase = "resting",
  motionSequence = 0,
  onMotionStart,
  onMotionComplete
}: UseButtonFanMotionArgs): void {
  const activeAnimationsRef = useRef<Animation[]>([]);
  const activeMotionPhaseRef = useRef<ButtonFanMotionDirection | null>(null);
  const animationGenerationRef = useRef(0);
  const resolvedAnimation = animation ?? DISABLED_FAN_ANIMATION;

  useLayoutEffect(() => {
    const surfaceRoot = surfaceRootRef.current;
    const surface = document.surfaces[surfaceId];
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

    if (!expanded || motionPhase === "resting" || !enabled) {
      if (expanded) restoreOpenWrappers();
      if (motionPhase !== "resting" && !enabled) {
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
      animation: resolvedAnimation,
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
      wrapper.style.removeProperty("visibility");
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
    const easing = supportedFanMotionEasing(resolvedAnimation.easing);
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
    ownerPlacementId,
    document,
    expanded,
    motionPhase,
    motionSequence,
    onMotionComplete,
    onMotionStart,
    resolvedAnimation,
    surfaceId,
    enabled,
    surfaceRootRef
  ]);

  useEffect(() => () => {
    animationGenerationRef.current += 1;
    activeAnimationsRef.current.forEach((animation) => animation.cancel());
    activeAnimationsRef.current = [];
    activeMotionPhaseRef.current = null;
  }, []);
}
