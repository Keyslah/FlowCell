import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { flushSync } from "react-dom";
import type {
  ButtonCoreMeasurement,
  ButtonSkin,
  ButtonTextAlignment,
  ButtonTextFitMode,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import { compileButtonSkin, type CompiledButtonSkin } from "./skinCompiler";
import { DEFAULT_BUTTON_SKIN } from "./defaultButtonSkin";
import { BUTTON_SKIN_LABEL_TOKEN } from "./buttonSkinFormat";
import {
  buttonTextFitAllowsMultipleLines,
  computeButtonTextFitPlan
} from "../text/textFit";
import {
  normalizeButtonScreenMeasurement,
  resolveButtonRenderedCssScale,
  resolveButtonShadowScreenOffsets,
  resolveButtonSkinScale,
  type ButtonSkinScale
} from "../geometry/buttonGeometry";
import type { ButtonSkinDiagnostic } from "./skinValidator";
import {
  BUTTON_VISUAL_SETTLE_FRAMES,
  resolveButtonVisualSamplingDecision
} from "./buttonVisualSampling";
import { applyButtonLabelTextOffset } from "./buttonTextOffset";
import {
  readButtonSkinHighlightOnActive,
  readButtonSkinHighlightOnHover
} from "./buttonSkinColors";
import {
  buttonVisualMotionBlocksStateChange,
  commitPreparedButtonVisual,
  createButtonVisualLatch,
  finishButtonVisualMotion,
  requestButtonVisual,
  resetButtonVisualLatch,
  settleButtonVisualMotionProbe,
  type ButtonVisualIntent,
  type ButtonVisualLatchState,
  type ButtonVisualMotionKind,
  type ButtonVisualPresentation
} from "../runtime/buttonVisualLatch";

type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

export interface ButtonSkinRendererProps {
  skin: ButtonSkin;
  label: string;
  width?: number;
  height?: number;
  constrained?: boolean;
  matchHitboxToSkin?: boolean;
  allowStretching?: boolean;
  textFitMode: ButtonTextFitMode;
  textAlignment?: ButtonTextAlignment;
  textOffsetX?: number;
  textOffsetY?: number;
  minimumFontSize: number;
  textSizeOverride?: number;
  previewStackWords?: boolean;
  hovered?: boolean;
  pressed?: boolean;
  pointerPressed?: boolean;
  held?: boolean;
  play?: boolean;
  release?: boolean;
  disabled?: boolean;
  error?: boolean;
  highlightOnHover?: boolean;
  rawHovered?: boolean;
  /** Latched selected/active state, lifted only when the skin opts in. */
  activeHighlight?: boolean;
  /**
   * Raw physical interaction state used by native visual measurement/sampling.
   * When omitted, the displayed visual flags above are sampled as before.
   */
  samplingState?: ButtonVisualState;
  /** Restarts a short measurement pulse for a persistent mapped-state change. */
  transitionSamplingKey?: string | number;
  onCoreElementChange?: (element: HTMLElement | SVGElement | null) => void;
  onLabelElementChange?: (element: HTMLElement | SVGElement | null) => void;
  onShadowRootChange?: (root: ShadowRoot | null) => void;
  onMeasurement?: (measurement: ButtonCoreMeasurement) => void;
  onVisualMeasurement?: (measurement: ButtonVisualMeasurement) => void;
  onNaturalMeasurement?: (measurement: ButtonCoreMeasurement) => void;
  onTextOverflowChange?: (overflow: boolean) => void;
  onPrepareVisualStateChange?: (state: ButtonVisualState) => void | Promise<void>;
  onVisualStateChange?: (state: ButtonVisualState) => void;
  onDiagnostics?: (diagnostics: readonly ButtonSkinDiagnostic[]) => void;
}

interface MountedSkin {
  container: HTMLElement;
  core: HTMLElement | SVGElement;
  labelNode: HTMLElement | SVGElement | null;
  textAlignmentRestores: Array<() => void>;
}

interface ButtonVisualRenderSnapshot {
  sourceKey: string;
  label: string;
  hovered: boolean;
  pressed: boolean;
  held: boolean;
  play: boolean;
  release: boolean;
  disabled: boolean;
  error: boolean;
  hoverHighlighted: boolean;
  activeHighlighted: boolean;
  samplingState: ButtonVisualState;
  transitionSamplingKey: string | number | undefined;
}

interface ButtonSkinMotionInspection {
  available: boolean;
  kind: ButtonVisualMotionKind;
  finiteAnimations: Animation[];
}

type ButtonHostRenderScale = ButtonSkinScale;

const IDENTITY_HOST_RENDER_SCALE: ButtonHostRenderScale = { scaleX: 1, scaleY: 1 };
const BUTTON_PERSISTENT_VISUAL_SAMPLE_FRAMES = 12;

/**
 * Composes the host-owned lifts. Active is the stronger of the two so a latched
 * Button reads as active at a glance, and hover still stacks on top of it so an
 * active Button under the pointer stays distinguishable from a resting one.
 */
function buttonHighlightFilter(
  snapshot: Pick<ButtonVisualRenderSnapshot, "hoverHighlighted" | "activeHighlighted">
): string | undefined {
  const lifts: string[] = [];
  if (snapshot.activeHighlighted) lifts.push("brightness(1.3)");
  if (snapshot.hoverHighlighted) lifts.push("brightness(1.15)");
  return lifts.length > 0 ? lifts.join(" ") : undefined;
}

function buttonVisualStateFromSnapshot(snapshot: ButtonVisualRenderSnapshot): ButtonVisualState {
  return {
    hovered: snapshot.hovered,
    pressed: snapshot.pressed,
    held: snapshot.held,
    play: snapshot.play,
    release: snapshot.release,
    error: snapshot.error
  };
}

function buttonVisualSnapshotIntent(
  snapshot: ButtonVisualRenderSnapshot
): ButtonVisualIntent<ButtonVisualRenderSnapshot> {
  return {
    key: JSON.stringify([
      snapshot.sourceKey,
      snapshot.label,
      snapshot.hovered,
      snapshot.pressed,
      snapshot.held,
      snapshot.play,
      snapshot.release,
      snapshot.disabled,
      snapshot.error,
      snapshot.hoverHighlighted,
      snapshot.activeHighlighted,
      snapshot.samplingState.hovered,
      snapshot.samplingState.pressed,
      snapshot.samplingState.held,
      snapshot.samplingState.play,
      snapshot.samplingState.release,
      snapshot.samplingState.error,
      snapshot.transitionSamplingKey ?? null
    ]),
    value: snapshot,
    // Press/play/release are authored activation presentations. Once requested,
    // native Pop/Fan preparation must not let a fast pointer-up or action result
    // replace them before they reach the skin and expose their finite motion.
    commitBeforeSupersede: snapshot.pressed || snapshot.play || snapshot.release
  };
}

function resolveHostRenderScale(
  host: HTMLElement,
  width: number | undefined,
  height: number | undefined
): ButtonHostRenderScale {
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width <= 0 ||
    height <= 0
  ) {
    return IDENTITY_HOST_RENDER_SCALE;
  }
  const hostRect = host.getBoundingClientRect();
  return resolveButtonSkinScale(
    { width, height },
    { width: hostRect.width, height: hostRect.height },
    true
  );
}

function isSvgElement(value: Element): value is SVGElement {
  return value.namespaceURI === "http://www.w3.org/2000/svg";
}

function applyLabelLines(
  labelNode: HTMLElement | SVGElement,
  lines: readonly string[],
  fontSize?: number
): void {
  labelNode.replaceChildren();
  if (fontSize) {
    (labelNode as HTMLElement).style.fontSize = `${fontSize}px`;
  } else {
    (labelNode as HTMLElement).style.removeProperty("font-size");
  }
  if (isSvgElement(labelNode)) {
    const text = labelNode.closest("text");
    const x = text?.getAttribute("x") ?? "0";
    lines.forEach((line, index) => {
      const tspan = labelNode.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("data-button-label-line", "true");
      tspan.setAttribute("x", x);
      tspan.setAttribute("dy", index === 0 ? "0" : "1.1em");
      tspan.textContent = line;
      labelNode.append(tspan);
    });
    return;
  }
  if (lines.length <= 1) {
    labelNode.textContent = lines[0] ?? "";
    return;
  }
  lines.forEach((line) => {
    const span = labelNode.ownerDocument.createElement("span");
    span.setAttribute("data-button-label-line", "true");
    span.textContent = line;
    labelNode.append(span);
  });
}

function injectLabel(container: HTMLElement, label: string): HTMLElement | SVGElement {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode: Text | null = null;
  while (walker.nextNode()) {
    const candidate = walker.currentNode as Text;
    if (candidate.data.includes(BUTTON_SKIN_LABEL_TOKEN)) {
      textNode = candidate;
      break;
    }
  }
  if (!textNode || !textNode.parentElement) {
    throw new Error("Compiled Button skin lost its {{label}} token.");
  }
  const parent = textNode.parentElement;
  const labelNode = isSvgElement(parent)
    ? parent.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "tspan")
    : parent.ownerDocument.createElement("span");
  labelNode.setAttribute("data-button-label-node", "true");
  labelNode.textContent = label;
  const [before, after] = textNode.data.split(BUTTON_SKIN_LABEL_TOKEN);
  const fragment = container.ownerDocument.createDocumentFragment();
  if (before) fragment.append(container.ownerDocument.createTextNode(before));
  fragment.append(labelNode);
  if (after) fragment.append(container.ownerDocument.createTextNode(after));
  textNode.replaceWith(fragment);
  return labelNode as HTMLElement | SVGElement;
}

function mountCompiledSkin(
  shadow: ShadowRoot,
  compiled: CompiledButtonSkin,
  label: string
): MountedSkin {
  shadow.replaceChildren();
  const style = shadow.ownerDocument.createElement("style");
  style.textContent = compiled.scopedCss;
  const container = shadow.ownerDocument.createElement("span");
  container.setAttribute("data-button-skin-root", "true");
  container.innerHTML = compiled.sanitizedMarkupTemplate;
  shadow.append(style, container);
  const core = container.querySelector<HTMLElement | SVGElement>("[data-core]");
  if (!core) throw new Error("Compiled Button skin is missing data-core.");
  const labelNode = compiled.hasLabelToken
    ? injectLabel(container, label)
    : null;
  return { container, core, labelNode, textAlignmentRestores: [] };
}

type VisualRect = { left: number; top: number; right: number; bottom: number };

function isFiniteVisualRect(rect: VisualRect): boolean {
  return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite);
}

function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function readElementLayoutSize(element: Element): { width: number; height: number } {
  if (element instanceof HTMLElement) {
    return { width: element.offsetWidth, height: element.offsetHeight };
  }
  if (element.clientWidth > 0 || element.clientHeight > 0) {
    return { width: element.clientWidth, height: element.clientHeight };
  }
  if (
    typeof SVGGraphicsElement !== "undefined" &&
    element instanceof SVGGraphicsElement
  ) {
    try {
      const box = element.getBBox();
      return { width: box.width, height: box.height };
    } catch {
      return { width: 0, height: 0 };
    }
  }
  return { width: 0, height: 0 };
}

function resolveElementPaintScale(
  element: Element,
  rect: DOMRect,
  fallback: ButtonHostRenderScale,
  transformChain: ButtonTransformChain
): ButtonSkinScale & { conservativeDirections: boolean } {
  const layout = readElementLayoutSize(element);
  return {
    ...resolveButtonRenderedCssScale({
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      layoutWidth: layout.width,
      layoutHeight: layout.height,
      fallback,
      conservativeUniform: transformChain.mixesAxes,
      minimumUniformScale: transformChain.vectorScale
    }),
    conservativeDirections: transformChain.mixesAxes
  };
}

interface ButtonTransformChain {
  mixesAxes: boolean;
  vectorScale: number;
}

function transformMetrics(transform: string): ButtonTransformChain {
  if (!transform || transform === "none") {
    return { mixesAxes: false, vectorScale: 1 };
  }
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    if (!matrix.is2D) {
      const frobenius = Math.hypot(
        matrix.m11, matrix.m12, matrix.m13,
        matrix.m21, matrix.m22, matrix.m23,
        matrix.m31, matrix.m32, matrix.m33
      );
      return { mixesAxes: true, vectorScale: Math.max(1, frobenius) };
    }
    const squaredTerms =
      matrix.a * matrix.a +
      matrix.b * matrix.b +
      matrix.c * matrix.c +
      matrix.d * matrix.d;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    const discriminant = Math.max(
      0,
      squaredTerms * squaredTerms - 4 * determinant * determinant
    );
    return {
      mixesAxes: Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001,
      vectorScale: Math.sqrt((squaredTerms + Math.sqrt(discriminant)) / 2)
    };
  } catch {
    return {
      mixesAxes: /rotate|skew|matrix3d/i.test(transform),
      vectorScale: 1
    };
  }
}

function individualTransformMetrics(style: CSSStyleDeclaration): ButtonTransformChain {
  const rotate = style.getPropertyValue("rotate").trim();
  const scale = style.getPropertyValue("scale").trim();
  const zoom = Number.parseFloat(style.getPropertyValue("zoom"));
  const angleMatch = rotate.match(/(-?\d*\.?\d+)(deg|grad|rad|turn)\s*$/i);
  let mixesAxes = false;
  if (rotate && rotate !== "none" && angleMatch) {
    const angle = Number(angleMatch[1]);
    const unit = angleMatch[2].toLowerCase();
    const degrees = unit === "turn"
      ? angle * 360
      : unit === "rad"
        ? angle * 180 / Math.PI
        : unit === "grad"
          ? angle * 0.9
          : angle;
    mixesAxes = Math.abs(degrees % 180) > 0.0001;
  } else if (rotate && rotate !== "none") {
    mixesAxes = true;
  }
  const scaleValues = scale && scale !== "none"
    ? Array.from(scale.matchAll(/-?\d*\.?\d+/g), (match) => Math.abs(Number(match[0])))
    : [];
  const individualScale = scaleValues.length > 0
    ? Math.max(...scaleValues.filter(Number.isFinite), 1)
    : 1;
  const zoomScale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const perspective = style.getPropertyValue("perspective").trim();
  return {
    mixesAxes: mixesAxes || Boolean(perspective && perspective !== "none"),
    vectorScale: individualScale * zoomScale
  };
}

function resolveTransformChain(
  element: Element,
  cache: Map<Element, ButtonTransformChain>
): ButtonTransformChain {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const root = element.getRootNode();
  const parent = element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  const style = getComputedStyle(element);
  const transform = transformMetrics(style.transform);
  const individual = individualTransformMetrics(style);
  const own = {
    mixesAxes: transform.mixesAxes || individual.mixesAxes,
    vectorScale: transform.vectorScale * individual.vectorScale
  };
  const parentChain = parent
    ? resolveTransformChain(parent, cache)
    : { mixesAxes: false, vectorScale: 1 };
  const chain = {
    mixesAxes: own.mixesAxes || parentChain.mixesAxes,
    vectorScale: own.vectorScale * parentChain.vectorScale
  };
  cache.set(element, chain);
  return chain;
}

function shadowVisualRects(
  rect: VisualRect,
  source: string,
  paintScale: ButtonSkinScale & { conservativeDirections: boolean }
): VisualRect[] {
  if (!source || source === "none") return [];
  return splitCssList(source).flatMap((shadow) => {
    if (/\binset\b/i.test(shadow)) return [];
    const lengths = Array.from(shadow.matchAll(/(-?\d*\.?\d+)px/g), (match) => Number(match[1]));
    if (lengths.length < 2) return [];
    const [offsetX = 0, offsetY = 0, blur = 0, spread = 0] = lengths;
    const blurExtent = Math.max(0, blur) * 2;
    const offsets = resolveButtonShadowScreenOffsets({
      offsetX,
      offsetY,
      blurExtent,
      spread,
      paintScale,
      conservativeDirections: paintScale.conservativeDirections
    });
    return [{
      left: rect.left + offsets.left,
      top: rect.top + offsets.top,
      right: rect.right + offsets.right,
      bottom: rect.bottom + offsets.bottom
    }];
  });
}

function parseCssFilterFunctions(source: string): Array<{ name: string; body: string }> {
  const functions: Array<{ name: string; body: string }> = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    const nameStart = index;
    while (index < source.length && /[a-z-]/i.test(source[index])) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (!name || source[index] !== "(") {
      index += 1;
      continue;
    }
    index += 1;
    const bodyStart = index;
    let depth = 1;
    let quote = "";
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (quote) {
        if (char === quote && source[index - 1] !== "\\") quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
      index += 1;
    }
    functions.push({
      name,
      body: source.slice(bodyStart, Math.max(bodyStart, index - 1))
    });
  }
  return functions;
}

function filteredVisualRect(
  rect: VisualRect,
  source: string,
  paintScale: ButtonSkinScale & { conservativeDirections: boolean }
): VisualRect {
  let current = { ...rect };
  for (const filter of parseCssFilterFunctions(source)) {
    if (filter.name === "drop-shadow") {
      const shadows = shadowVisualRects(current, filter.body, paintScale);
      if (shadows.length > 0) {
        current = {
          left: Math.min(current.left, ...shadows.map((shadow) => shadow.left)),
          top: Math.min(current.top, ...shadows.map((shadow) => shadow.top)),
          right: Math.max(current.right, ...shadows.map((shadow) => shadow.right)),
          bottom: Math.max(current.bottom, ...shadows.map((shadow) => shadow.bottom))
        };
      }
      continue;
    }
    if (filter.name === "blur") {
      const radius = Number.parseFloat(filter.body) || 0;
      const offsets = resolveButtonShadowScreenOffsets({
        offsetX: 0,
        offsetY: 0,
        blurExtent: Math.max(0, radius) * 2,
        spread: 0,
        paintScale,
        conservativeDirections: paintScale.conservativeDirections
      });
      current = {
        left: current.left + offsets.left,
        top: current.top + offsets.top,
        right: current.right + offsets.right,
        bottom: current.bottom + offsets.bottom
      };
    }
  }
  return current;
}

function readPaintedVisualRect(
  container: HTMLElement,
  renderScale: ButtonHostRenderScale
): VisualRect {
  const elements: Element[] = [container, ...Array.from(container.querySelectorAll("*"))];
  const rects: VisualRect[] = [];
  const transformChainCache = new Map<Element, ButtonTransformChain>();
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (!isFiniteVisualRect(rect)) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const paintScale = resolveElementPaintScale(
      element,
      rect,
      renderScale,
      resolveTransformChain(element, transformChainCache)
    );
    rects.push(rect);
    rects.push(
      ...shadowVisualRects(rect, style.boxShadow, paintScale).filter(isFiniteVisualRect)
    );
    rects.push(
      ...shadowVisualRects(rect, style.textShadow, paintScale).filter(isFiniteVisualRect)
    );
    if (style.filter && style.filter !== "none") {
      const filteredRect = filteredVisualRect(rect, style.filter, paintScale);
      if (isFiniteVisualRect(filteredRect)) rects.push(filteredRect);
    }
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    const outline = Math.max(0, outlineWidth + outlineOffset);
    if (outline > 0) {
      const outlineRect = {
        left: rect.left - outline * paintScale.scaleX,
        top: rect.top - outline * paintScale.scaleY,
        right: rect.right + outline * paintScale.scaleX,
        bottom: rect.bottom + outline * paintScale.scaleY
      };
      if (isFiniteVisualRect(outlineRect)) rects.push(outlineRect);
    }
  }
  if (rects.length === 0) {
    const fallback = container.getBoundingClientRect();
    return isFiniteVisualRect(fallback)
      ? fallback
      : { left: 0, top: 0, right: 0, bottom: 0 };
  }
  return {
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom))
  };
}

function readMeasurement(
  container: HTMLElement,
  core: HTMLElement | SVGElement,
  renderScale: ButtonHostRenderScale = IDENTITY_HOST_RENDER_SCALE
): ButtonCoreMeasurement {
  const coreRect = core.getBoundingClientRect();
  const visualRect = readPaintedVisualRect(container, renderScale);
  return normalizeButtonScreenMeasurement({
    coreRect,
    visualRect,
    hostScale: renderScale
  });
}

function inspectButtonSkinMotion(container: HTMLElement): ButtonSkinMotionInspection {
  if (typeof container.getAnimations !== "function") {
    return { available: false, kind: "none", finiteAnimations: [] };
  }
  try {
    const animations = container.getAnimations({ subtree: true });
    const activeAnimations = animations.filter(
      (animation) => animation.pending || animation.playState === "running"
    );
    const finiteAnimations = activeAnimations.filter((animation) => {
      let endTime: unknown;
      try {
        endTime = animation.effect?.getComputedTiming().endTime;
      } catch {
        endTime = undefined;
      }
      return buttonVisualMotionBlocksStateChange({
        pending: animation.pending,
        playState: animation.playState,
        endTime
      });
    });
    return {
      available: true,
      kind: finiteAnimations.length > 0
        ? "finite"
        : activeAnimations.length > 0
          ? "infinite"
          : "none",
      finiteAnimations
    };
  } catch {
    return { available: false, kind: "none", finiteAnimations: [] };
  }
}

function inspectRunningSkinAnimations(container: HTMLElement): {
  available: boolean;
  running: boolean;
} {
  const inspection = inspectButtonSkinMotion(container);
  return {
    available: inspection.available,
    running: inspection.kind !== "none"
  };
}

function waitForButtonVisualFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitForButtonSkinMotionCompletion(animations: readonly Animation[]): Promise<void> {
  const completions = animations.map((animation) => {
    try {
      return animation.finished;
    } catch {
      return Promise.resolve();
    }
  });
  return Promise.allSettled(completions).then(() => undefined);
}

function applySkinRootScale(
  mounted: MountedSkin,
  width: number | undefined,
  height: number | undefined,
  matchHitboxToSkin: boolean,
  allowStretching: boolean,
  renderScale: ButtonHostRenderScale
): void {
  mounted.container.style.removeProperty("transform");
  mounted.container.style.removeProperty("transform-origin");
  if (
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return;
  }
  const naturalContainerRect = mounted.container.getBoundingClientRect();
  const naturalCoreRect = mounted.core.getBoundingClientRect();
  const coreOffsetX = (naturalCoreRect.left - naturalContainerRect.left) / renderScale.scaleX;
  const coreOffsetY = (naturalCoreRect.top - naturalContainerRect.top) / renderScale.scaleY;
  mounted.container.style.transformOrigin = "top left";
  if (!matchHitboxToSkin) {
    mounted.container.style.transform = `translate(${-coreOffsetX}px, ${-coreOffsetY}px)`;
    return;
  }
  const scale = resolveButtonSkinScale(
    {
      width: naturalCoreRect.width / renderScale.scaleX,
      height: naturalCoreRect.height / renderScale.scaleY
    },
    { width, height },
    allowStretching
  );
  mounted.container.style.transform = `scale(${scale.scaleX}, ${scale.scaleY}) translate(${-coreOffsetX}px, ${-coreOffsetY}px)`;
}

function measureNaturalSkin(
  compiled: CompiledButtonSkin,
  label: string,
  textSizeOverride?: number
): ButtonCoreMeasurement | null {
  if (typeof document === "undefined" || !document.body) return null;
  const host = document.createElement("span");
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "-100000px",
    visibility: "hidden",
    pointerEvents: "none"
  });
  const shadow = host.attachShadow({ mode: "open" });
  document.body.append(host);
  try {
    const mounted = mountCompiledSkin(shadow, compiled, label);
    if (mounted.labelNode) {
      applyLabelLines(mounted.labelNode, [label], textSizeOverride);
    }
    return readMeasurement(mounted.container, mounted.core);
  } finally {
    host.remove();
  }
}

function readLabelTextMeasurement(
  labelNode: HTMLElement | SVGElement
): { width: number; height: number } {
  const lineNodes = Array.from(
    labelNode.querySelectorAll<HTMLElement | SVGElement>("[data-button-label-line]")
  );
  const targets = lineNodes.length > 0 ? lineNodes : [labelNode];
  const rects: VisualRect[] = [];
  for (const target of targets) {
    try {
      if (target.childNodes.length > 0) {
        const range = target.ownerDocument.createRange();
        range.selectNodeContents(target);
        rects.push(
          ...Array.from(range.getClientRects())
            .filter(isFiniteVisualRect)
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom
            }))
        );
      }
    } catch {
      // SVG text ranges are not available in every WebView build.
    }
    if (rects.length === 0 || lineNodes.length > 0) {
      const fallback = target.getBoundingClientRect();
      if (isFiniteVisualRect(fallback)) rects.push(fallback);
    }
  }
  if (rects.length === 0) return { width: 0, height: 0 };
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function applyTextFit(
  mounted: MountedSkin,
  label: string,
  mode: ButtonTextFitMode,
  minimumFontSize: number,
  constrained: boolean,
  textSizeOverride?: number,
  previewStackWords?: boolean
): boolean {
  const labelNode = mounted.labelNode;
  if (!labelNode) return false;
  const allowsMultipleLines = buttonTextFitAllowsMultipleLines(mode);
  if (!isSvgElement(labelNode)) {
    // Stacking is host-planned with explicit line spans. Browser-native wrapping
    // must never turn Shrink (or any planned line) into an extra row.
    labelNode.style.setProperty("white-space", "nowrap", "important");
  }
  if (!constrained) {
    applyLabelLines(
      labelNode,
      previewStackWords && allowsMultipleLines
        ? label.trim().split(/\s+/).filter(Boolean)
        : [label],
      textSizeOverride
    );
    return false;
  }
  applyLabelLines(labelNode, [label], textSizeOverride);
  const computed = getComputedStyle(labelNode);
  const naturalFontSize = textSizeOverride ?? (Number.parseFloat(computed.fontSize) || 13);
  const coreRect = mounted.core.getBoundingClientRect();
  const maximumWidth = Number.isFinite(coreRect.width) && coreRect.width > 0
    ? coreRect.width
    : Math.max(1, mounted.core.clientWidth);
  const maximumHeight = Number.isFinite(coreRect.height) && coreRect.height > 0
    ? coreRect.height
    : Math.max(1, mounted.core.clientHeight);
  const plan = computeButtonTextFitPlan({
    label,
    mode,
    maximumWidth,
    maximumHeight,
    naturalFontSize,
    minimumFontSize,
    measure: (fontSize, lines) => {
      applyLabelLines(labelNode, lines, fontSize);
      return readLabelTextMeasurement(labelNode);
    }
  });
  applyLabelLines(labelNode, plan.lines, plan.fontSize);
  return plan.overflow;
}

function applyTextAlignment(
  mounted: MountedSkin,
  alignment: ButtonTextAlignment
): void {
  for (const restore of mounted.textAlignmentRestores.splice(0).reverse()) {
    restore();
  }
  if (alignment === "skin") return;

  const overriddenProperties = new WeakMap<Element, Set<string>>();
  const overrideStyle = (
    element: HTMLElement | SVGElement,
    property: string,
    value: string
  ) => {
    let properties = overriddenProperties.get(element);
    if (!properties) {
      properties = new Set<string>();
      overriddenProperties.set(element, properties);
    }
    if (properties.has(property)) return;
    properties.add(property);
    const originalValue = element.style.getPropertyValue(property);
    const originalPriority = element.style.getPropertyPriority(property);
    mounted.textAlignmentRestores.push(() => {
      if (originalValue) {
        element.style.setProperty(property, originalValue, originalPriority);
      } else {
        element.style.removeProperty(property);
      }
    });
    element.style.setProperty(property, value, "important");
  };

  const labelNode = mounted.labelNode;
  if (labelNode && isSvgElement(labelNode)) {
    const textNode = labelNode.closest("text") ?? labelNode;
    overrideStyle(
      textNode as SVGElement,
      "text-anchor",
      alignment === "center" ? "middle" : alignment === "left" ? "start" : "end"
    );
    return;
  }

  const alignmentPath = new Set<HTMLElement>();
  if (labelNode instanceof HTMLElement) {
    let element: HTMLElement | null = labelNode;
    while (element) {
      alignmentPath.add(element);
      if (element === mounted.core) break;
      element = element.parentElement;
    }
  }
  if (mounted.core instanceof HTMLElement) alignmentPath.add(mounted.core);

  let labelBranch: HTMLElement | null = null;
  for (const element of alignmentPath) {
    overrideStyle(element, "text-align", alignment);
    const computed = getComputedStyle(element);
    const labelIsOnlyInFlowChild = labelBranch !== null && Array.from(element.childNodes).every((child) => {
      if (child === labelBranch) return true;
      if (child.nodeType === Node.TEXT_NODE) return !(child.textContent ?? "").trim();
      if (child.nodeType !== Node.ELEMENT_NODE) return true;
      const childStyle = getComputedStyle(child as Element);
      return childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed";
    });
    if (labelIsOnlyInFlowChild && computed.writingMode === "horizontal-tb") {
      if (computed.display === "flex" || computed.display === "inline-flex") {
        if (computed.flexDirection === "row" || computed.flexDirection === "row-reverse") {
          overrideStyle(element, "justify-content", alignment);
        } else {
          const rightToLeft = computed.direction === "rtl";
          const value = alignment === "center"
            ? "center"
            : alignment === "left" !== rightToLeft
              ? "flex-start"
              : "flex-end";
          overrideStyle(element, "align-items", value);
        }
      } else if (computed.display === "grid" || computed.display === "inline-grid") {
        overrideStyle(element, "justify-items", alignment);
      }
    }
    labelBranch = element;
  }
}

function applyTextOffset(
  mounted: MountedSkin,
  offsetX: number,
  offsetY: number
): void {
  const labelNode = mounted.labelNode;
  if (!labelNode) return;
  applyButtonLabelTextOffset(labelNode, offsetX, offsetY);
}

function setBooleanAttribute(host: HTMLElement, name: string, value: boolean): void {
  host.setAttribute(name, value ? "true" : "false");
}

export function ButtonSkinRenderer({
  skin,
  label,
  width,
  height,
  constrained = true,
  matchHitboxToSkin = true,
  allowStretching = false,
  textFitMode,
  textAlignment = "skin",
  textOffsetX = 0,
  textOffsetY = 0,
  minimumFontSize,
  textSizeOverride,
  previewStackWords,
  hovered = false,
  pressed = false,
  pointerPressed = pressed,
  held = false,
  play = false,
  release = false,
  disabled = false,
  error = false,
  highlightOnHover = false,
  rawHovered = false,
  activeHighlight = false,
  samplingState,
  transitionSamplingKey,
  onCoreElementChange,
  onLabelElementChange,
  onShadowRootChange,
  onMeasurement,
  onVisualMeasurement,
  onNaturalMeasurement,
  onTextOverflowChange,
  onPrepareVisualStateChange,
  onVisualStateChange,
  onDiagnostics
}: ButtonSkinRendererProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const lastValidRef = useRef<CompiledButtonSkin | null>(null);
  const mountedRef = useRef<MountedSkin | null>(null);
  const fittedTextRef = useRef<{
    width?: number;
    height?: number;
    label: string;
    textFitMode: ButtonTextFitMode;
    minimumFontSize: number;
    constrained: boolean;
    matchHitboxToSkin: boolean;
    allowStretching: boolean;
    textSizeOverride?: number;
    previewStackWords: boolean;
  } | null>(null);
  const sizingRef = useRef({
    width,
    height,
    constrained,
    matchHitboxToSkin,
    allowStretching
  });
  sizingRef.current = {
    width,
    height,
    constrained,
    matchHitboxToSkin,
    allowStretching
  };
  // Callbacks flow through refs so parent re-renders (new inline arrow identities)
  // never remount the skin shadow DOM — a remount restarts every CSS animation.
  const onCoreElementChangeRef = useRef(onCoreElementChange);
  const onLabelElementChangeRef = useRef(onLabelElementChange);
  const onShadowRootChangeRef = useRef(onShadowRootChange);
  const onMeasurementRef = useRef(onMeasurement);
  const onVisualMeasurementRef = useRef(onVisualMeasurement);
  const onNaturalMeasurementRef = useRef(onNaturalMeasurement);
  const onTextOverflowChangeRef = useRef(onTextOverflowChange);
  const onPrepareVisualStateChangeRef = useRef(onPrepareVisualStateChange);
  const onVisualStateChangeRef = useRef(onVisualStateChange);
  const onDiagnosticsRef = useRef(onDiagnostics);
  onCoreElementChangeRef.current = onCoreElementChange;
  onLabelElementChangeRef.current = onLabelElementChange;
  onShadowRootChangeRef.current = onShadowRootChange;
  onMeasurementRef.current = onMeasurement;
  onVisualMeasurementRef.current = onVisualMeasurement;
  onNaturalMeasurementRef.current = onNaturalMeasurement;
  onTextOverflowChangeRef.current = onTextOverflowChange;
  onPrepareVisualStateChangeRef.current = onPrepareVisualStateChange;
  onVisualStateChangeRef.current = onVisualStateChange;
  onDiagnosticsRef.current = onDiagnostics;
  const compileResult = useMemo(() => compileButtonSkin(skin), [skin]);
  const skinHighlightOnHover = useMemo(
    () => readButtonSkinHighlightOnHover(skin),
    [skin.base]
  );
  const skinHighlightOnActive = useMemo(
    () => readButtonSkinHighlightOnActive(skin),
    [skin.base]
  );
  if (compileResult.ok) lastValidRef.current = compileResult.compiled;
  const fallback = useMemo(
    () => (compileResult.ok ? null : compileButtonSkin(DEFAULT_BUTTON_SKIN)),
    [compileResult.ok]
  );
  const compiled = compileResult.ok
    ? compileResult.compiled
    : lastValidRef.current ?? (fallback?.ok ? fallback.compiled : null);
  const hasMeasurementConsumer = Boolean(onMeasurement || onVisualMeasurement);
  const hasVisualMeasurementConsumer = Boolean(onVisualMeasurement);
  const sourceKey = compiled
    ? `${compiled.skinId}:${compiled.sourceFingerprint}`
    : "uncompiled";
  const desiredSamplingState: ButtonVisualState = {
    hovered: (samplingState?.hovered ?? hovered) || hovered,
    pressed: (samplingState?.pressed ?? pressed) || pressed,
    held: (samplingState?.held ?? held) || held,
    play: (samplingState?.play ?? play) || play,
    release: (samplingState?.release ?? release) || release,
    error: (samplingState?.error ?? error) || error
  };
  const desiredVisualIntent = buttonVisualSnapshotIntent({
    sourceKey,
    label: compiled?.hasLabelToken ? label : "",
    hovered,
    pressed,
    held,
    play,
    release,
    disabled,
    error,
    hoverHighlighted: (skinHighlightOnHover ?? highlightOnHover) && rawHovered,
    activeHighlighted: (skinHighlightOnActive ?? false) && activeHighlight,
    samplingState: desiredSamplingState,
    transitionSamplingKey
  });
  const desiredVisualIntentRef = useRef(desiredVisualIntent);
  desiredVisualIntentRef.current = desiredVisualIntent;
  const visualLatchStateRef = useRef<ButtonVisualLatchState<ButtonVisualRenderSnapshot>>(
    createButtonVisualLatch(desiredVisualIntent)
  );
  const [appliedVisualPresentation, setAppliedVisualPresentation] = useState<
    ButtonVisualPresentation<ButtonVisualRenderSnapshot>
  >(() => visualLatchStateRef.current.presentation);
  const appliedVisualPresentationRef = useRef(appliedVisualPresentation);
  appliedVisualPresentationRef.current = appliedVisualPresentation;
  const visualPresentationApplyGenerationRef = useRef(0);
  const preparingVisualPresentationIdRef = useRef<number | null>(null);
  const visualMotionWaitRef = useRef<{ id: number; promise: Promise<void> } | null>(null);
  const visualLatchActiveRef = useRef(true);

  const applyVisualPresentation = useCallback((
    presentation: ButtonVisualPresentation<ButtonVisualRenderSnapshot>
  ) => {
    const generation = ++visualPresentationApplyGenerationRef.current;
    preparingVisualPresentationIdRef.current = presentation.id;
    void (async () => {
      try {
        await onPrepareVisualStateChangeRef.current?.(
          buttonVisualStateFromSnapshot(presentation.intent.value)
        );
      } catch (prepareError) {
        console.error("FlowCell could not prepare the next Button visual state.", prepareError);
      }
      if (
        !visualLatchActiveRef.current ||
        visualPresentationApplyGenerationRef.current !== generation ||
        visualLatchStateRef.current.presentation.id !== presentation.id
      ) return;
      const committed = commitPreparedButtonVisual(
        visualLatchStateRef.current,
        presentation.id
      );
      if (committed === visualLatchStateRef.current) return;
      visualLatchStateRef.current = committed;
      preparingVisualPresentationIdRef.current = null;
      // Native Pop/Fan geometry preparation is asynchronous. Commit the
      // prepared snapshot and its probing phase as one synchronous handoff so
      // no pointer event can observe a protected-but-still-unpainted candidate.
      flushSync(() => {
        appliedVisualPresentationRef.current = presentation;
        setAppliedVisualPresentation(presentation);
      });
    })();
  }, []);

  const commitVisualLatchState = useCallback((
    next: ButtonVisualLatchState<ButtonVisualRenderSnapshot>
  ) => {
    visualLatchStateRef.current = next;
    const presentation = next.presentation;
    if (
      presentation.id === appliedVisualPresentationRef.current.id ||
      presentation.id === preparingVisualPresentationIdRef.current
    ) return;
    applyVisualPresentation(presentation);
  }, [applyVisualPresentation]);

  const waitForFiniteVisualMotion = useCallback((presentationId: number) => {
    if (visualMotionWaitRef.current?.id === presentationId) return;
    const promise = (async () => {
      while (visualLatchActiveRef.current) {
        const current = visualLatchStateRef.current;
        if (
          current.presentation.id !== presentationId ||
          current.motion?.presentationId !== presentationId ||
          current.motion.phase !== "finite"
        ) return;
        const mounted = mountedRef.current;
        if (!mounted) {
          await waitForButtonVisualFrame();
          continue;
        }
        const inspection = inspectButtonSkinMotion(mounted.container);
        if (inspection.kind === "finite") {
          await waitForButtonSkinMotionCompletion(inspection.finiteAnimations);
          await waitForButtonVisualFrame();
          continue;
        }
        // Animation promises can settle just before the browser exposes the
        // final computed frame. Confirm on the following frame before releasing
        // the presentation and applying the newest requested appearance.
        await waitForButtonVisualFrame();
        if (!visualLatchActiveRef.current) return;
        const confirmedMounted = mountedRef.current;
        if (confirmedMounted && inspectButtonSkinMotion(confirmedMounted.container).kind === "finite") {
          continue;
        }
        commitVisualLatchState(finishButtonVisualMotion(
          visualLatchStateRef.current,
          presentationId
        ));
        return;
      }
    })();
    visualMotionWaitRef.current = { id: presentationId, promise };
    void promise.finally(() => {
      if (visualMotionWaitRef.current?.promise === promise) {
        visualMotionWaitRef.current = null;
      }
    });
  }, [commitVisualLatchState]);

  useLayoutEffect(() => {
    visualLatchActiveRef.current = true;
    return () => {
      visualLatchActiveRef.current = false;
      visualPresentationApplyGenerationRef.current += 1;
      visualMotionWaitRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const desired = desiredVisualIntentRef.current;
    const current = visualLatchStateRef.current;
    const next = current.presentation.intent.value.sourceKey === desired.value.sourceKey
      ? requestButtonVisual(current, desired)
      : resetButtonVisualLatch(current, desired);
    commitVisualLatchState(next);
  }, [commitVisualLatchState, desiredVisualIntent.key]);

  const renderedVisual = appliedVisualPresentation.intent.value;
  const renderedLabel = renderedVisual.label;
  const visualStateRef = useRef<ButtonVisualState>(renderedVisual.samplingState);
  visualStateRef.current = renderedVisual.samplingState;

  useLayoutEffect(() => {
    onDiagnosticsRef.current?.(compileResult.ok ? [] : compileResult.diagnostics);
  }, [compileResult.ok, skin]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !compiled) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    setBooleanAttribute(host, "data-button-constrained", constrained && !matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-match-hitbox-to-skin", matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-hover", renderedVisual.hovered);
    setBooleanAttribute(host, "data-button-pressed", renderedVisual.pressed);
    setBooleanAttribute(host, "data-button-pointer-hover", rawHovered);
    setBooleanAttribute(host, "data-button-pointer-pressed", pointerPressed);
    setBooleanAttribute(host, "data-button-held", renderedVisual.held);
    setBooleanAttribute(host, "data-button-play", renderedVisual.play);
    setBooleanAttribute(host, "data-button-release", renderedVisual.release);
    setBooleanAttribute(host, "data-button-disabled", renderedVisual.disabled);
    setBooleanAttribute(host, "data-button-error", renderedVisual.error);
    onShadowRootChangeRef.current?.(shadow);
    let mounted: MountedSkin;
    try {
      mounted = mountCompiledSkin(shadow, compiled, renderedLabel);
    } catch (mountError) {
      console.error("Failed to mount Button skin.", mountError);
      return;
    }
    mountedRef.current = mounted;
    const overflow = applyTextFit(
      mounted,
      renderedLabel,
      textFitMode,
      minimumFontSize,
      constrained,
      textSizeOverride,
      previewStackWords
    );
    applyTextAlignment(mounted, textAlignment);
    applySkinRootScale(
      mounted,
      width,
      height,
      matchHitboxToSkin,
      allowStretching,
      resolveHostRenderScale(host, width, height)
    );
    applyTextOffset(mounted, textOffsetX, textOffsetY);
    fittedTextRef.current = {
      width,
      height,
      label: renderedLabel,
      textFitMode,
      minimumFontSize,
      constrained,
      matchHitboxToSkin,
      allowStretching,
      textSizeOverride,
      previewStackWords: Boolean(previewStackWords)
    };
    setBooleanAttribute(host, "data-button-text-overflow", overflow);
    onTextOverflowChangeRef.current?.(overflow);
    onCoreElementChangeRef.current?.(mounted.core);
    onLabelElementChangeRef.current?.(mounted.labelNode);
    const updateMeasurement = () => {
      const sizing = sizingRef.current;
      const renderScale = resolveHostRenderScale(host, sizing.width, sizing.height);
      applySkinRootScale(
        mounted,
        sizing.width,
        sizing.height,
        sizing.matchHitboxToSkin,
        sizing.allowStretching,
        renderScale
      );
      applyTextOffset(mounted, textOffsetX, textOffsetY);
      if (hasMeasurementConsumer) {
        const measurement = readMeasurement(mounted.container, mounted.core, renderScale);
        onMeasurementRef.current?.(measurement);
        onVisualMeasurementRef.current?.({ ...measurement, state: visualStateRef.current });
      }
    };
    updateMeasurement();
    const frame = requestAnimationFrame(updateMeasurement);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateMeasurement);
    observer?.observe(mounted.core);
    observer?.observe(mounted.container);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mountedRef.current = null;
      onCoreElementChangeRef.current?.(null);
      onLabelElementChangeRef.current?.(null);
      onShadowRootChangeRef.current?.(null);
    };
    // The mount deps are the compiled skin's stable identity (skin id + source
    // fingerprint), not object identities: a re-cloned document or a re-created
    // callback must never rebuild the shadow DOM.
  }, [compiled?.skinId, compiled?.sourceFingerprint, hasMeasurementConsumer]);

  useLayoutEffect(() => {
    if (!compiled || !onNaturalMeasurementRef.current) return;
    const natural = measureNaturalSkin(compiled, renderedLabel, textSizeOverride);
    if (natural) onNaturalMeasurementRef.current?.(natural);
  }, [compiled?.skinId, compiled?.sourceFingerprint, renderedLabel, textSizeOverride]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mounted = mountedRef.current;
    if (!host || !mounted) return;
    applyTextAlignment(mounted, textAlignment);
    if (hasMeasurementConsumer) {
      const sizing = sizingRef.current;
      const renderScale = resolveHostRenderScale(host, sizing.width, sizing.height);
      const measurement = readMeasurement(mounted.container, mounted.core, renderScale);
      onMeasurementRef.current?.(measurement);
      onVisualMeasurementRef.current?.({ ...measurement, state: visualStateRef.current });
    }
  }, [textAlignment, hasMeasurementConsumer]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mounted = mountedRef.current;
    if (!host || !mounted) return;
    applyTextOffset(mounted, textOffsetX, textOffsetY);
    if (hasMeasurementConsumer) {
      const sizing = sizingRef.current;
      const renderScale = resolveHostRenderScale(host, sizing.width, sizing.height);
      const measurement = readMeasurement(mounted.container, mounted.core, renderScale);
      onMeasurementRef.current?.(measurement);
      onVisualMeasurementRef.current?.({ ...measurement, state: visualStateRef.current });
    }
  }, [textOffsetX, textOffsetY, hasMeasurementConsumer]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mounted = mountedRef.current;
    if (!host || !mounted) return;
    const fitted = fittedTextRef.current;
    if (
      fitted &&
      fitted.width === width &&
      fitted.height === height &&
      fitted.label === renderedLabel &&
      fitted.textFitMode === textFitMode &&
      fitted.minimumFontSize === minimumFontSize &&
      fitted.constrained === constrained &&
      fitted.matchHitboxToSkin === matchHitboxToSkin &&
      fitted.allowStretching === allowStretching &&
      fitted.textSizeOverride === textSizeOverride &&
      fitted.previewStackWords === Boolean(previewStackWords)
    ) return;
    setBooleanAttribute(host, "data-button-constrained", constrained && !matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-match-hitbox-to-skin", matchHitboxToSkin);
    const overflow = applyTextFit(
      mounted,
      renderedLabel,
      textFitMode,
      minimumFontSize,
      constrained,
      textSizeOverride,
      previewStackWords
    );
    const renderScale = resolveHostRenderScale(host, width, height);
    applySkinRootScale(
      mounted,
      width,
      height,
      matchHitboxToSkin,
      allowStretching,
      renderScale
    );
    // SVG fitting recreates the host-owned line tspans, and its pixel-to-user
    // conversion must observe the final host scale.
    applyTextOffset(mounted, textOffsetX, textOffsetY);
    fittedTextRef.current = {
      width,
      height,
      label: renderedLabel,
      textFitMode,
      minimumFontSize,
      constrained,
      matchHitboxToSkin,
      allowStretching,
      textSizeOverride,
      previewStackWords: Boolean(previewStackWords)
    };
    setBooleanAttribute(host, "data-button-text-overflow", overflow);
    onTextOverflowChangeRef.current?.(overflow);
    const measurement = readMeasurement(mounted.container, mounted.core, renderScale);
    onMeasurementRef.current?.(measurement);
    onVisualMeasurementRef.current?.({ ...measurement, state: visualStateRef.current });
  }, [width, height, renderedLabel, textFitMode, minimumFontSize, constrained, matchHitboxToSkin, allowStretching, textSizeOverride, previewStackWords]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setBooleanAttribute(host, "data-button-constrained", constrained && !matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-match-hitbox-to-skin", matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-hover", renderedVisual.hovered);
    setBooleanAttribute(host, "data-button-pressed", renderedVisual.pressed);
    setBooleanAttribute(host, "data-button-pointer-hover", rawHovered);
    setBooleanAttribute(host, "data-button-pointer-pressed", pointerPressed);
    setBooleanAttribute(host, "data-button-held", renderedVisual.held);
    setBooleanAttribute(host, "data-button-play", renderedVisual.play);
    setBooleanAttribute(host, "data-button-release", renderedVisual.release);
    setBooleanAttribute(host, "data-button-disabled", renderedVisual.disabled);
    setBooleanAttribute(host, "data-button-error", renderedVisual.error);
    const reapplyCurrentTextOffset = () => {
      const current = mountedRef.current;
      if (current) applyTextOffset(current, textOffsetX, textOffsetY);
    };
    reapplyCurrentTextOffset();
    let frame: number | null = null;
    let settleFramesRemaining = BUTTON_VISUAL_SETTLE_FRAMES;
    let transitionFramesRemaining = renderedVisual.transitionSamplingKey === undefined
      ? 0
      : BUTTON_PERSISTENT_VISUAL_SAMPLE_FRAMES;
    let offsetFramesRemaining = BUTTON_PERSISTENT_VISUAL_SAMPLE_FRAMES;
    const sample = () => {
      const current = mountedRef.current;
      const onVisualMeasurement = onVisualMeasurementRef.current;
      if (!current) return;
      reapplyCurrentTextOffset();
      let continueMeasurementSampling = false;
      if (hasVisualMeasurementConsumer && onVisualMeasurement) {
        const sizing = sizingRef.current;
        const measurement = readMeasurement(
          current.container,
          current.core,
          resolveHostRenderScale(host, sizing.width, sizing.height)
        );
        const state = visualStateRef.current;
        onVisualMeasurement({ ...measurement, state });
        const animationState = inspectRunningSkinAnimations(current.container);
        const decision = resolveButtonVisualSamplingDecision({
          state,
          animationInspectionAvailable: animationState.available,
          hasRunningAnimations: animationState.running,
          settleFramesRemaining
        });
        settleFramesRemaining = decision.settleFramesRemaining;
        continueMeasurementSampling = decision.continueSampling;
      }
      offsetFramesRemaining = Math.max(0, offsetFramesRemaining - 1);
      if (continueMeasurementSampling || transitionFramesRemaining > 0 || offsetFramesRemaining > 0) {
        transitionFramesRemaining = Math.max(0, transitionFramesRemaining - 1);
        frame = requestAnimationFrame(sample);
      }
    };
    frame = requestAnimationFrame(sample);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [
    appliedVisualPresentation.id,
    constrained,
    matchHitboxToSkin,
    rawHovered,
    pointerPressed,
    hasVisualMeasurementConsumer,
    textOffsetX,
    textOffsetY
  ]);

  useLayoutEffect(() => {
    const presentationId = appliedVisualPresentation.id;
    onVisualStateChangeRef.current?.(buttonVisualStateFromSnapshot(renderedVisual));
    const current = visualLatchStateRef.current;
    if (
      current.presentation.id !== presentationId ||
      current.motion?.presentationId !== presentationId ||
      current.motion.phase !== "probing"
    ) return;
    const frame = requestAnimationFrame(() => {
      if (
        !visualLatchActiveRef.current ||
        appliedVisualPresentationRef.current.id !== presentationId
      ) return;
      const mounted = mountedRef.current;
      const kind = mounted ? inspectButtonSkinMotion(mounted.container).kind : "none";
      const next = settleButtonVisualMotionProbe(
        visualLatchStateRef.current,
        presentationId,
        kind
      );
      commitVisualLatchState(next);
      if (
        next.presentation.id === presentationId &&
        next.motion?.presentationId === presentationId &&
        next.motion.phase === "finite"
      ) {
        waitForFiniteVisualMotion(presentationId);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    appliedVisualPresentation.id,
    commitVisualLatchState,
    renderedVisual,
    waitForFiniteVisualMotion
  ]);

  const style: StyleWithVars = {
    display: "inline-block",
    verticalAlign: "top",
    overflow: "visible",
    pointerEvents: "none",
    filter: buttonHighlightFilter(renderedVisual),
    ...(typeof width === "number" ? { width: `${width}px` } : {}),
    ...(typeof height === "number" ? { height: `${height}px` } : {}),
    ...(typeof width === "number" ? { "--button-core-width": `${width}px` } : {}),
    ...(typeof height === "number" ? { "--button-core-height": `${height}px` } : {})
  };

  return <span ref={hostRef} data-button-skin-host="true" style={style} />;
}
