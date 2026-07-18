import {
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties
} from "react";
import type {
  ButtonCoreMeasurement,
  ButtonSkin,
  ButtonTextFitMode,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import { compileButtonSkin, type CompiledButtonSkin } from "./skinCompiler";
import { DEFAULT_BUTTON_SKIN } from "./defaultButtonSkin";
import { BUTTON_SKIN_LABEL_TOKEN } from "./buttonSkinFormat";
import { computeButtonTextFitPlan } from "../text/textFit";
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
  minimumFontSize: number;
  textSizeOverride?: number;
  previewStackWords?: boolean;
  hovered?: boolean;
  pressed?: boolean;
  held?: boolean;
  play?: boolean;
  release?: boolean;
  disabled?: boolean;
  error?: boolean;
  onCoreElementChange?: (element: HTMLElement | SVGElement | null) => void;
  onShadowRootChange?: (root: ShadowRoot | null) => void;
  onMeasurement?: (measurement: ButtonCoreMeasurement) => void;
  onVisualMeasurement?: (measurement: ButtonVisualMeasurement) => void;
  onNaturalMeasurement?: (measurement: ButtonCoreMeasurement) => void;
  onTextOverflowChange?: (overflow: boolean) => void;
  onDiagnostics?: (diagnostics: readonly ButtonSkinDiagnostic[]) => void;
}

interface MountedSkin {
  container: HTMLElement;
  core: HTMLElement | SVGElement;
  labelNode: HTMLElement | SVGElement | null;
}

type ButtonHostRenderScale = ButtonSkinScale;

const IDENTITY_HOST_RENDER_SCALE: ButtonHostRenderScale = { scaleX: 1, scaleY: 1 };

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
  return { container, core, labelNode };
}

type VisualRect = { left: number; top: number; right: number; bottom: number };

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
    if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const paintScale = resolveElementPaintScale(
      element,
      rect,
      renderScale,
      resolveTransformChain(element, transformChainCache)
    );
    rects.push(rect);
    rects.push(...shadowVisualRects(rect, style.boxShadow, paintScale));
    rects.push(...shadowVisualRects(rect, style.textShadow, paintScale));
    if (style.filter && style.filter !== "none") {
      rects.push(filteredVisualRect(rect, style.filter, paintScale));
    }
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    const outline = Math.max(0, outlineWidth + outlineOffset);
    if (outline > 0) {
      rects.push({
        left: rect.left - outline * paintScale.scaleX,
        top: rect.top - outline * paintScale.scaleY,
        right: rect.right + outline * paintScale.scaleX,
        bottom: rect.bottom + outline * paintScale.scaleY
      });
    }
  }
  if (rects.length === 0) return container.getBoundingClientRect();
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

function inspectRunningSkinAnimations(container: HTMLElement): {
  available: boolean;
  running: boolean;
} {
  if (typeof container.getAnimations !== "function") {
    return { available: false, running: false };
  }
  try {
    const animations = container.getAnimations({ subtree: true });
    return {
      available: true,
      running: animations.some(
        (animation) => animation.pending || animation.playState === "running"
      )
    };
  } catch {
    return { available: false, running: false };
  }
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
    !matchHitboxToSkin ||
    typeof width !== "number" ||
    typeof height !== "number"
  ) {
    return;
  }
  const naturalContainerRect = mounted.container.getBoundingClientRect();
  const naturalCoreRect = mounted.core.getBoundingClientRect();
  const scale = resolveButtonSkinScale(
    {
      width: naturalCoreRect.width / renderScale.scaleX,
      height: naturalCoreRect.height / renderScale.scaleY
    },
    { width, height },
    allowStretching
  );
  const coreOffsetX = (naturalCoreRect.left - naturalContainerRect.left) / renderScale.scaleX;
  const coreOffsetY = (naturalCoreRect.top - naturalContainerRect.top) / renderScale.scaleY;
  mounted.container.style.transformOrigin = "top left";
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
  if (!constrained) {
    applyLabelLines(
      labelNode,
      previewStackWords ? label.trim().split(/\s+/).filter(Boolean) : [label],
      textSizeOverride
    );
    return false;
  }
  applyLabelLines(labelNode, [label], textSizeOverride);
  const computed = getComputedStyle(labelNode);
  const naturalFontSize = textSizeOverride ?? (Number.parseFloat(computed.fontSize) || 13);
  const core = mounted.core as HTMLElement;
  const plan = computeButtonTextFitPlan({
    label,
    mode,
    maximumWidth: Math.max(1, core.clientWidth),
    maximumHeight: Math.max(1, core.clientHeight),
    naturalFontSize,
    minimumFontSize,
    measure: (fontSize, lines) => {
      applyLabelLines(labelNode, lines, fontSize);
      return {
        width: Math.max(core.clientWidth, core.scrollWidth),
        height: Math.max(core.clientHeight, core.scrollHeight)
      };
    }
  });
  applyLabelLines(labelNode, plan.lines, plan.fontSize);
  return plan.overflow;
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
  minimumFontSize,
  textSizeOverride,
  previewStackWords,
  hovered = false,
  pressed = false,
  held = false,
  play = false,
  release = false,
  disabled = false,
  error = false,
  onCoreElementChange,
  onShadowRootChange,
  onMeasurement,
  onVisualMeasurement,
  onNaturalMeasurement,
  onTextOverflowChange,
  onDiagnostics
}: ButtonSkinRendererProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const lastValidRef = useRef<CompiledButtonSkin | null>(null);
  const mountedRef = useRef<MountedSkin | null>(null);
  const fittedSizeRef = useRef<{
    width?: number;
    height?: number;
    matchHitboxToSkin: boolean;
    allowStretching: boolean;
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
  const onShadowRootChangeRef = useRef(onShadowRootChange);
  const onMeasurementRef = useRef(onMeasurement);
  const onVisualMeasurementRef = useRef(onVisualMeasurement);
  const onNaturalMeasurementRef = useRef(onNaturalMeasurement);
  const onTextOverflowChangeRef = useRef(onTextOverflowChange);
  const onDiagnosticsRef = useRef(onDiagnostics);
  onCoreElementChangeRef.current = onCoreElementChange;
  onShadowRootChangeRef.current = onShadowRootChange;
  onMeasurementRef.current = onMeasurement;
  onVisualMeasurementRef.current = onVisualMeasurement;
  onNaturalMeasurementRef.current = onNaturalMeasurement;
  onTextOverflowChangeRef.current = onTextOverflowChange;
  onDiagnosticsRef.current = onDiagnostics;
  const compileResult = useMemo(() => compileButtonSkin(skin), [skin]);
  if (compileResult.ok) lastValidRef.current = compileResult.compiled;
  const fallback = useMemo(
    () => (compileResult.ok ? null : compileButtonSkin(DEFAULT_BUTTON_SKIN)),
    [compileResult.ok]
  );
  const compiled = compileResult.ok
    ? compileResult.compiled
    : lastValidRef.current ?? (fallback?.ok ? fallback.compiled : null);
  const renderedLabel = compiled?.hasLabelToken ? label : "";
  const hasMeasurementConsumer = Boolean(onMeasurement || onVisualMeasurement);
  const hasVisualMeasurementConsumer = Boolean(onVisualMeasurement);
  const visualStateRef = useRef<ButtonVisualState>({
    hovered,
    pressed,
    held,
    play,
    release,
    error
  });
  visualStateRef.current = { hovered, pressed, held, play, release, error };

  useLayoutEffect(() => {
    onDiagnosticsRef.current?.(compileResult.ok ? [] : compileResult.diagnostics);
  }, [compileResult.ok, skin]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !compiled) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    setBooleanAttribute(host, "data-button-constrained", constrained && !matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-match-hitbox-to-skin", matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-hover", hovered);
    setBooleanAttribute(host, "data-button-pressed", pressed);
    setBooleanAttribute(host, "data-button-held", held);
    setBooleanAttribute(host, "data-button-play", play);
    setBooleanAttribute(host, "data-button-release", release);
    setBooleanAttribute(host, "data-button-disabled", disabled);
    setBooleanAttribute(host, "data-button-error", error);
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
    applySkinRootScale(
      mounted,
      width,
      height,
      matchHitboxToSkin,
      allowStretching,
      resolveHostRenderScale(host, width, height)
    );
    fittedSizeRef.current = {
      width,
      height,
      matchHitboxToSkin,
      allowStretching
    };
    setBooleanAttribute(host, "data-button-text-overflow", overflow);
    onTextOverflowChangeRef.current?.(overflow);
    onCoreElementChangeRef.current?.(mounted.core);
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
    const natural = onNaturalMeasurementRef.current
      ? measureNaturalSkin(compiled, renderedLabel, textSizeOverride)
      : null;
    if (natural) onNaturalMeasurementRef.current?.(natural);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      mountedRef.current = null;
      onCoreElementChangeRef.current?.(null);
      onShadowRootChangeRef.current?.(null);
    };
    // The mount deps are the compiled skin's stable identity (skin id + source
    // fingerprint), not object identities: a re-cloned document or a re-created
    // callback must never rebuild the shadow DOM.
  }, [compiled?.skinId, compiled?.sourceFingerprint, renderedLabel, textFitMode, minimumFontSize, constrained, textSizeOverride, previewStackWords, hasMeasurementConsumer]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const mounted = mountedRef.current;
    if (!host || !mounted) return;
    const fitted = fittedSizeRef.current;
    if (
      fitted &&
      fitted.width === width &&
      fitted.height === height &&
      fitted.matchHitboxToSkin === matchHitboxToSkin &&
      fitted.allowStretching === allowStretching
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
    fittedSizeRef.current = {
      width,
      height,
      matchHitboxToSkin,
      allowStretching
    };
    setBooleanAttribute(host, "data-button-text-overflow", overflow);
    onTextOverflowChangeRef.current?.(overflow);
    onMeasurementRef.current?.(readMeasurement(mounted.container, mounted.core, renderScale));
  }, [width, height, renderedLabel, textFitMode, minimumFontSize, constrained, matchHitboxToSkin, allowStretching, textSizeOverride, previewStackWords]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setBooleanAttribute(host, "data-button-constrained", constrained && !matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-match-hitbox-to-skin", matchHitboxToSkin);
    setBooleanAttribute(host, "data-button-hover", hovered);
    setBooleanAttribute(host, "data-button-pressed", pressed);
    setBooleanAttribute(host, "data-button-held", held);
    setBooleanAttribute(host, "data-button-play", play);
    setBooleanAttribute(host, "data-button-release", release);
    setBooleanAttribute(host, "data-button-disabled", disabled);
    setBooleanAttribute(host, "data-button-error", error);
    if (!hasVisualMeasurementConsumer) return;
    let frame: number | null = null;
    let settleFramesRemaining = BUTTON_VISUAL_SETTLE_FRAMES;
    const sample = () => {
      const current = mountedRef.current;
      const onVisualMeasurement = onVisualMeasurementRef.current;
      if (!current || !onVisualMeasurement) return;
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
      if (decision.continueSampling) {
        frame = requestAnimationFrame(sample);
      }
    };
    frame = requestAnimationFrame(sample);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [
    constrained,
    matchHitboxToSkin,
    hovered,
    pressed,
    held,
    play,
    release,
    disabled,
    error,
    hasVisualMeasurementConsumer
  ]);

  const style: StyleWithVars = {
    display: "inline-block",
    verticalAlign: "top",
    overflow: "visible",
    pointerEvents: "auto",
    ...(typeof width === "number" ? { width: `${width}px` } : {}),
    ...(typeof height === "number" ? { height: `${height}px` } : {}),
    ...(typeof width === "number" ? { "--button-core-width": `${width}px` } : {}),
    ...(typeof height === "number" ? { "--button-core-height": `${height}px` } : {})
  };

  return <span ref={hostRef} data-button-skin-host="true" style={style} />;
}
