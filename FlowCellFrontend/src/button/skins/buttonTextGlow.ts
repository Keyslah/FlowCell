import type { ButtonTextGlowMode, ProgramPopoutGradientCurvePoint } from "../types.js";
import {
  normalizeProgramPopoutGradientCurve,
  programPopoutGradientCurveValue
} from "../../theme/programPopoutGradientCurve.js";
import { BUTTON_SKIN_LABEL_TOKEN } from "./buttonSkinFormat.js";

type GlowElement = HTMLElement | SVGElement;
type ButtonTextGlowCurve = readonly ProgramPopoutGradientCurvePoint[];

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const AMOUNT_PROPERTY = "--flowcell-text-glow-amount";
const COLOR_PROPERTY = "--flowcell-text-glow-color";
const TRAIL_ATTRIBUTE = "data-button-text-glow-trail";
const LABEL_LINE_ATTRIBUTE = "data-button-label-line";
const CSS_COLOR_PATTERN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g;
// Only an alpha component counts: opaque black also ends in ", 0)".
const TRANSPARENT_COLOR_PATTERN = /^rgba\(.*,\s*0(?:\.0+)?\)$|\/\s*0(?:\.0+)?\)$/;
const SYMBOL_SHAPES = "path,rect,circle,ellipse,polygon,polyline,line,text";
const FADE_TRANSITION = `${AMOUNT_PROPERTY} 300ms linear`;
// The trail clears the core's top edge by this share of its height, within the
// surface's default visual-overflow allowance.
const TRAIL_RISE_SHARE = 0.35;
const TRAIL_RISE_MAX_PX = 24;
const TRAIL_MARGIN_PX = 4;
const TRAIL_FILTER_ID = "flowcell-text-glow-trail";
// The blur sees this many sweep lengths below the object, so a filled column reads as
// an endless edge.
const TRAIL_BLUR_REACH = 3;
const TRAIL_CURVE_SAMPLES = 64;
const TRAIL_SOFTNESS_SHARE = 0.09;
const TRAIL_SOFTNESS_MIN_PX = 0.6;
const TRAIL_SOFTNESS_BASE_MAX_PX = 24;
// Solid artwork reads softer than thin text strokes at the same blur.
const TRAIL_SYMBOL_SOFTNESS_SCALE = 0.6;
const TRAIL_TEXT_PROPERTIES = [
  "font-family",
  "font-size",
  "font-stretch",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "text-align",
  "text-transform",
  "word-spacing"
] as const;
// Runtime contract markers: a copy must never count as the skin's core or react
// to its authored animation tokens.
const SKIN_CONTRACT_ATTRIBUTES = ["data-core", "data-hit-shape", "data-anim"] as const;

/** Full strength where the trail leaves the object, nothing where it ends. */
export const BUTTON_TEXT_GLOW_DEFAULT_CURVE: ButtonTextGlowCurve = [
  { x: 0, y: 1, mode: "auto" },
  { x: 1, y: 0, mode: "auto" }
];

/** The trail's box bounds its paint; the copied silhouette inside it only feeds the filter. */
export const BUTTON_SKIN_PAINTED_ELEMENTS = `*:not([${TRAIL_ATTRIBUTE}] *)`;

// The trail collapses the moment the fade reaches zero, so an unlit glow adds no measured
// visual overflow to a resting Button window.
const BUTTON_TEXT_GLOW_CSS = [
  `[data-button-skin-root]{--flowcell-text-glow-on:min(1,calc(var(${AMOUNT_PROPERTY},0)*50));}`,
  `[${TRAIL_ATTRIBUTE}]{position:absolute;z-index:2147483646;transform-origin:bottom;transform:scaleY(var(--flowcell-text-glow-on));` +
    `opacity:calc(var(${AMOUNT_PROPERTY},0)*.6);}`,
  `[${TRAIL_ATTRIBUTE}]>span{position:absolute;white-space:nowrap;filter:url(#${TRAIL_FILTER_ID});}`,
  `[${TRAIL_ATTRIBUTE}]>svg{position:absolute;width:0;height:0;}`,
  `[${TRAIL_ATTRIBUTE}] feFlood{flood-color:var(${COLOR_PROPERTY},currentColor);}`
].join("\n");

export interface ButtonTextGlowLayer {
  container: HTMLElement;
  core: GlowElement;
  style: HTMLStyleElement;
  trail: HTMLElement;
  /** The copied silhouette the trail is filtered from; it never paints itself. */
  shape: HTMLElement;
  filter: SVGFilterElement;
  filterKey: string | null;
  curve: ButtonTextGlowCurve;
  /** The painted text or symbol the color, size, and trail are read from. */
  anchor: GlowElement;
  renderedText: string | null;
}

/** Handles can lift a curve between two zero points, so this samples it rather than its points. */
export function buttonTextGlowCurveHasStrength(curve: ButtonTextGlowCurve): boolean {
  return Array.from({ length: TRAIL_CURVE_SAMPLES + 1 }, (_, index) => index / TRAIL_CURVE_SAMPLES)
    .some((position) => programPopoutGradientCurveValue(curve, position) > 0);
}

export function isButtonTextGlowSetting(
  value: unknown
): value is ButtonTextGlowMode | null | undefined {
  return value === undefined || value === null ||
    value === "hover" || value === "active" || value === "always";
}

export function isButtonTextGlowCurve(value: unknown): boolean {
  return value === undefined || value === null || normalizeProgramPopoutGradientCurve(value) !== null;
}

export function buttonSkinHasTextGlowTarget(structure: string): boolean {
  return structure.includes(BUTTON_SKIN_LABEL_TOKEN) || /<(?:svg|img)\b/i.test(structure);
}

export function resolveButtonTextGlowLit(
  mode: ButtonTextGlowMode | null | undefined,
  state: {
    hovered: boolean;
    active: boolean;
    pressed: boolean;
    held: boolean;
    play: boolean;
    disabled: boolean;
  }
): boolean {
  if (!mode || state.disabled) return false;
  if (mode === "always") return true;
  if (mode === "hover") return state.hovered;
  return state.active || state.pressed || state.held || state.play;
}

/**
 * The fade lives on the host because the visual latch inspects only the skin
 * subtree: a transition inside it would count as finite motion and hold back the
 * next press presentation.
 */
export function buttonTextGlowHostStyle(lit: boolean): { transition: string } & Record<`--${string}`, number> {
  return { [AMOUNT_PROPERTY]: lit ? 1 : 0, transition: FADE_TRANSITION };
}

/**
 * How much of a unit Gaussian lies beyond each step from 0 to 1 standard deviation.
 * A vertical blur of a filled column leaves exactly this alpha at those distances.
 */
const GAUSSIAN_TAIL = (() => {
  const steps = 512;
  const density = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
  const tail = [0.5];
  for (let step = 1; step <= steps; step += 1) {
    const x = step / steps;
    tail.push(tail[step - 1] - (density(x - 1 / steps) + density(x)) / (2 * steps));
  }
  return tail;
})();

function distanceForAlpha(alpha: number): number {
  let low = 0;
  let high = GAUSSIAN_TAIL.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (GAUSSIAN_TAIL[middle] > alpha) low = middle + 1;
    else high = middle;
  }
  return low / (GAUSSIAN_TAIL.length - 1);
}

/**
 * Alpha lookup from height above the object's top edge to curve strength. Half alpha is
 * the edge itself, so everything over the object holds the curve's Start strength, and
 * one deviation's tail is the trail's end.
 */
export function buttonTextGlowStrengthTable(curve: ButtonTextGlowCurve): string {
  return Array.from({ length: 256 }, (_, level) => {
    const alpha = level / 255;
    if (alpha < GAUSSIAN_TAIL[GAUSSIAN_TAIL.length - 1]) return "0";
    return programPopoutGradientCurveValue(curve, distanceForAlpha(alpha)).toFixed(4);
  }).join(" ");
}

/**
 * Builds the light from the object itself. It covers the object and everything above
 * it, as if the silhouette were swept straight up. Its strength comes from a second
 * branch: filling each column down from its topmost pixel and blurring only vertically
 * leaves alpha as a measure of height above the object's top edge, column by column,
 * and a lookup maps that height through the curve. The fade therefore keeps the object's
 * outline all the way to the far end instead of ending on a level line, and the text
 * color goes on last so no strength costs it precision.
 *
 * Only `hard` may feed two primitives. A sweep built from offset copies merged back with
 * their source references each stage twice, which doubles the paint cost per stage and
 * froze the window at high display scales.
 */
export function buttonTextGlowTrailPrimitives(args: {
  sweep: number;
  softness: number;
  curve: ButtonTextGlowCurve;
}): string {
  const { sweep, softness, curve } = args;
  const fillReach = sweep * TRAIL_BLUR_REACH / 2;
  return [
    '<feComponentTransfer in="SourceAlpha" result="hard"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>',
    // Each direction runs in the order that keeps its edge inside the filter region.
    `<feOffset in="hard" dy="${fillReach}" result="lowered"/>`,
    `<feMorphology in="lowered" operator="dilate" radius="0.01 ${fillReach}" result="filled"/>`,
    `<feGaussianBlur in="filled" stdDeviation="0 ${sweep}" result="height"/>`,
    `<feComponentTransfer in="height" result="strength"><feFuncA type="table" tableValues="${buttonTextGlowStrengthTable(curve)}"/></feComponentTransfer>`,
    `<feMorphology in="hard" operator="dilate" radius="0.01 ${fillReach}" result="spread"/>`,
    `<feOffset in="spread" dy="${-fillReach}" result="swept"/>`,
    '<feComposite in="strength" in2="swept" operator="in" result="trail"/>',
    '<feFlood result="light"/>',
    '<feComposite in="light" in2="trail" operator="in" result="lit"/>',
    `<feGaussianBlur in="lit" stdDeviation="${softness}"/>`
  ].join("");
}

function registerGlowAmountProperty(): void {
  try {
    // Only a registered number interpolates, which is what makes the fade smooth.
    CSS.registerProperty({
      name: AMOUNT_PROPERTY,
      syntax: "<number>",
      inherits: true,
      initialValue: "0"
    });
  } catch {
    // Already registered for this document.
  }
}

function isSvgElement(element: Element): boolean {
  return element.namespaceURI === SVG_NAMESPACE;
}

function backgroundClippedTextElement(
  element: GlowElement,
  core: GlowElement
): GlowElement | null {
  let current: GlowElement | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (style.backgroundClip === "text" || style.webkitBackgroundClip === "text") return current;
    if (current === core) return null;
    current = current.parentElement;
  }
  return null;
}

function resolveGlowSymbol(core: GlowElement): GlowElement | null {
  const symbol = Array.from(core.querySelectorAll<GlowElement>("svg,img"))
    .find((candidate) => !candidate.parentElement?.closest("svg"));
  return symbol ?? (core.matches("svg,img") ? core : null);
}

export function visibleButtonPaint(value: string | undefined): string | null {
  if (!value || value === "none" || value === "transparent" || value.startsWith("url(")) return null;
  return TRANSPARENT_COLOR_PATTERN.test(value) ? null : value;
}

function readSymbolPaint(symbol: GlowElement): string | null {
  for (const shape of Array.from(symbol.querySelectorAll(SYMBOL_SHAPES))) {
    const style = getComputedStyle(shape);
    const paint = visibleButtonPaint(style.fill) ?? visibleButtonPaint(style.stroke);
    if (paint) return paint;
  }
  return visibleButtonPaint(getComputedStyle(symbol).color);
}

function readTextPaint(element: GlowElement, core: GlowElement): string | null {
  const style = getComputedStyle(element);
  if (isSvgElement(element)) return visibleButtonPaint(style.fill) ?? visibleButtonPaint(style.stroke);
  const fill = visibleButtonPaint(style.webkitTextFillColor);
  if (fill) return fill;
  const clipped = backgroundClippedTextElement(element, core);
  const stops = clipped ? getComputedStyle(clipped).backgroundImage.match(CSS_COLOR_PATTERN) : null;
  return stops?.map(visibleButtonPaint).find(Boolean) ?? visibleButtonPaint(style.color);
}

function copySymbol(symbol: GlowElement): GlowElement {
  const copy = symbol.cloneNode(true) as GlowElement;
  for (const element of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    SKIN_CONTRACT_ATTRIBUTES.forEach((attribute) => element.removeAttribute(attribute));
  }
  copy.style.setProperty("position", "static", "important");
  copy.style.setProperty("display", "block", "important");
  copy.style.setProperty("margin", "0", "important");
  copy.style.setProperty("transform", "none", "important");
  return copy;
}

/** offsetWidth and offsetHeight round to whole pixels, which would shift the trail off the label. */
function fractionalLayoutSize(element: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(element);
  return { width: Number.parseFloat(style.width) || 0, height: Number.parseFloat(style.height) || 0 };
}

function renderTrailText(layer: ButtonTextGlowLayer): void {
  const { anchor, shape } = layer;
  const computed = getComputedStyle(anchor);
  for (const property of TRAIL_TEXT_PROPERTIES) {
    shape.style.setProperty(property, computed.getPropertyValue(property));
  }
  const lines = Array.from(
    anchor.querySelectorAll(`[${LABEL_LINE_ATTRIBUTE}]`),
    (line) => line.textContent ?? ""
  );
  const text = lines.length > 0 ? lines : [anchor.textContent ?? ""];
  const renderedText = text.join("\n");
  if (renderedText === layer.renderedText) return;
  layer.renderedText = renderedText;
  shape.replaceChildren(...text.map((line) => {
    const span = anchor.ownerDocument.createElement("span");
    span.setAttribute(LABEL_LINE_ATTRIBUTE, "true");
    span.textContent = line;
    return span;
  }));
}

export function mountButtonTextGlow(args: {
  container: HTMLElement;
  core: GlowElement;
  labelNode: GlowElement | null;
  curve: ButtonTextGlowCurve | null | undefined;
}): ButtonTextGlowLayer | null {
  const { container, core, labelNode, curve } = args;
  const anchor = labelNode ?? resolveGlowSymbol(core);
  if (!anchor) return null;
  registerGlowAmountProperty();
  const style = container.ownerDocument.createElement("style");
  style.textContent = BUTTON_TEXT_GLOW_CSS;
  const trail = container.ownerDocument.createElement("span");
  trail.setAttribute(TRAIL_ATTRIBUTE, "true");
  trail.setAttribute("aria-hidden", "true");
  const shape = container.ownerDocument.createElement("span");
  if (!labelNode) shape.append(copySymbol(anchor));
  const filterRoot = container.ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  const filter = container.ownerDocument.createElementNS(SVG_NAMESPACE, "filter");
  filter.id = TRAIL_FILTER_ID;
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filterRoot.append(filter);
  trail.append(filterRoot, shape);
  (container.getRootNode() as ShadowRoot).append(style);
  container.append(trail);
  const layer: ButtonTextGlowLayer = {
    container,
    core,
    style,
    trail,
    shape,
    filter,
    filterKey: null,
    curve: curve ?? BUTTON_TEXT_GLOW_DEFAULT_CURVE,
    anchor,
    renderedText: null
  };
  syncButtonTextGlow(layer);
  return layer;
}

export function updateButtonTextGlowCurve(
  layer: ButtonTextGlowLayer,
  curve: ButtonTextGlowCurve | null | undefined
): void {
  layer.curve = curve ?? BUTTON_TEXT_GLOW_DEFAULT_CURVE;
  syncButtonTextGlow(layer);
}

export function unmountButtonTextGlow(layer: ButtonTextGlowLayer): void {
  layer.style.remove();
  layer.trail.remove();
  layer.container.style.removeProperty(COLOR_PROPERTY);
}

/** Follows the rendered text through fitting, resizing, offsets, and skin state changes. */
export function syncButtonTextGlow(layer: ButtonTextGlowLayer): void {
  const { container, core, trail, shape, anchor } = layer;
  // At zero the layer comes off entirely: even an invisible one changes how the text beneath
  // it is smoothed, and it would still count as visual overflow.
  const lit = buttonTextGlowCurveHasStrength(layer.curve);
  trail.style.display = lit ? "" : "none";
  if (!lit) return;
  const isText = anchor.matches("[data-button-label-node]");
  const paint = isText ? readTextPaint(anchor, core) : readSymbolPaint(anchor);
  if (paint) container.style.setProperty(COLOR_PROPERTY, paint);
  if (isText) renderTrailText(layer);

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const coreRect = core.getBoundingClientRect();
  const containerLayout = fractionalLayoutSize(container);
  const scaleX = containerRect.width / containerLayout.width || 1;
  const scaleY = containerRect.height / containerLayout.height || 1;
  const anchorWidth = anchorRect.width / scaleX;
  const anchorHeight = anchorRect.height / scaleY;
  const anchorLeft = (anchorRect.left - containerRect.left) / scaleX;
  const anchorTop = (anchorRect.top - containerRect.top) / scaleY;
  const coreTop = (coreRect.top - containerRect.top) / scaleY;
  const rise = Math.min(TRAIL_RISE_MAX_PX, (coreRect.height / scaleY) * TRAIL_RISE_SHARE);
  const trailTop = coreTop - rise;
  const trailHeight = Math.max(0, anchorTop + anchorHeight + TRAIL_MARGIN_PX - trailTop);
  const softnessBase = Math.min(
    TRAIL_SOFTNESS_BASE_MAX_PX,
    anchorHeight * (isText ? 1 : TRAIL_SYMBOL_SOFTNESS_SCALE)
  );

  Object.assign(trail.style, {
    left: `${anchorLeft - TRAIL_MARGIN_PX}px`,
    top: `${trailTop}px`,
    width: `${anchorWidth + TRAIL_MARGIN_PX * 2}px`,
    height: `${trailHeight}px`
  });
  if (!isText) {
    const symbol = shape.firstElementChild as GlowElement;
    symbol.style.setProperty("width", `${anchorWidth}px`, "important");
    symbol.style.setProperty("height", `${anchorHeight}px`, "important");
  }
  // Text copies keep their own layout box, so center and scale them onto the label.
  const shapeLayout = fractionalLayoutSize(shape);
  const shapeWidth = shapeLayout.width || anchorWidth;
  const shapeHeight = shapeLayout.height || anchorHeight;
  const shapeScale = anchorWidth / shapeWidth;
  Object.assign(shape.style, {
    left: `${TRAIL_MARGIN_PX + (anchorWidth - shapeWidth) / 2}px`,
    top: `${anchorTop + anchorHeight / 2 - trailTop - shapeHeight / 2}px`,
    transform: `scale(${shapeScale})`
  });
  const sweep = Math.max(0, anchorTop - trailTop);
  const filterKey = `${sweep.toFixed(1)}:${shapeHeight.toFixed(1)}:${JSON.stringify(layer.curve)}`;
  if (filterKey !== layer.filterKey && shapeHeight > 0 && sweep > 0) {
    layer.filterKey = filterKey;
    const above = (sweep + TRAIL_MARGIN_PX) / shapeHeight;
    const below = sweep * TRAIL_BLUR_REACH / shapeHeight;
    layer.filter.setAttribute("x", "-25%");
    layer.filter.setAttribute("width", "150%");
    layer.filter.setAttribute("y", `${-above}`);
    layer.filter.setAttribute("height", `${above + 1 + below}`);
    layer.filter.innerHTML = buttonTextGlowTrailPrimitives({
      sweep,
      softness: Math.max(TRAIL_SOFTNESS_MIN_PX, softnessBase * TRAIL_SOFTNESS_SHARE),
      curve: layer.curve
    });
  }
}
