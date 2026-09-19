import type { ButtonSkinSectionName } from "../types.js";
import {
  BUTTON_SKIN_LABEL_TOKEN,
  BUTTON_SKIN_SECTION_ORDER,
  type ButtonSkinSectionSource
} from "./buttonSkinFormat.js";

export const BUTTON_SKIN_TEXT_COLOR_VARIABLE = "--flowcell-button-text-color";
export const BUTTON_SKIN_PROFILE_COLOR_PREFIX = "--flowcell-button-color-";
export const BUTTON_SKIN_HIGHLIGHT_ON_HOVER_VARIABLE = "--flowcell-button-highlight-on-hover";
export const BUTTON_SKIN_HIGHLIGHT_ON_ACTIVE_VARIABLE = "--flowcell-button-highlight-on-active";
export const BUTTON_SKIN_LEGACY_SURFACE_VARIABLES = ["--button-bg", "--ycb-face"] as const;
export const BUTTON_SKIN_LEGACY_TEXT_VARIABLES = ["--button-ink", "--ycb-ink"] as const;
export const BUTTON_HIGHLIGHT_AMOUNT_MIN = 0;
export const BUTTON_HIGHLIGHT_AMOUNT_MAX = 1000;
export const BUTTON_GLOW_AMOUNT_MAX = 100;
export const DEFAULT_BUTTON_HIGHLIGHT_AMOUNT = 75;
const BUTTON_EFFECT_AMOUNT_REFERENCE = 100;

interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface CssValueRange {
  start: number;
  end: number;
  property: string;
  declarationStart: number;
  declarationEnd: number;
}

interface ButtonSkinColorToken {
  start: number;
  end: number;
  color: ParsedColor;
  property: string;
}

export interface ButtonSkinColorBucket {
  id: string;
  color: string;
  pickerColor: string;
  alpha: number;
  occurrences: number;
  sections: ButtonSkinSectionName[];
}

export interface ButtonSkinProfileColor {
  variable: string;
  role: string;
  label: string;
  color: string;
}

const BASIC_NAMED_COLORS: Readonly<Record<string, string>> = {
  aqua: "#00ffff",
  black: "#000000",
  blue: "#0000ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  green: "#008000",
  lime: "#00ff00",
  maroon: "#800000",
  navy: "#000080",
  olive: "#808000",
  orange: "#ffa500",
  purple: "#800080",
  red: "#ff0000",
  silver: "#c0c0c0",
  teal: "#008080",
  transparent: "#00000000",
  white: "#ffffff",
  yellow: "#ffff00"
};

const NON_CONCRETE_COLOR_KEYWORDS = new Set([
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonborder",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "currentcolor",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "inherit",
  "initial",
  "linktext",
  "mark",
  "marktext",
  "revert",
  "revert-layer",
  "selecteditem",
  "selecteditemtext",
  "unset",
  "visitedtext"
]);

const browserNamedColorCache = new Map<string, ParsedColor | null>();
let browserColorContext: CanvasRenderingContext2D | null | undefined;

function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function byteHex(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0").toUpperCase();
}

function colorId(color: ParsedColor): string {
  return `#${byteHex(color.red)}${byteHex(color.green)}${byteHex(color.blue)}${byteHex(color.alpha)}`;
}

function colorText(color: ParsedColor): string {
  const opaque = `#${byteHex(color.red)}${byteHex(color.green)}${byteHex(color.blue)}`;
  return color.alpha === 255 ? opaque : `${opaque}${byteHex(color.alpha)}`;
}

function parseHexColor(value: string): ParsedColor | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  const expanded = digits.length <= 4
    ? [...digits].map((digit) => `${digit}${digit}`).join("")
    : digits;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255
  };
}

function parseRgbChannel(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampByte(trimmed.endsWith("%") ? parsed / 100 * 255 : parsed);
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) return 255;
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return clampByte((trimmed.endsWith("%") ? parsed / 100 : parsed) * 255);
}

function splitFunctionalColorBody(body: string): { channels: string[]; alpha?: string } {
  const slash = body.indexOf("/");
  const channelsSource = slash >= 0 ? body.slice(0, slash) : body;
  const explicitAlpha = slash >= 0 ? body.slice(slash + 1).trim() : undefined;
  const channels = channelsSource.includes(",")
    ? channelsSource.split(",").map((part) => part.trim())
    : channelsSource.trim().split(/\s+/);
  if (!explicitAlpha && channels.length === 4) {
    return { channels: channels.slice(0, 3), alpha: channels[3] };
  }
  return { channels, alpha: explicitAlpha };
}

function parseRgbColor(value: string): ParsedColor | null {
  const match = /^rgba?\((.*)\)$/i.exec(value.trim());
  if (!match) return null;
  const { channels, alpha } = splitFunctionalColorBody(match[1]);
  if (channels.length !== 3) return null;
  const red = parseRgbChannel(channels[0]);
  const green = parseRgbChannel(channels[1]);
  const blue = parseRgbChannel(channels[2]);
  const parsedAlpha = parseAlpha(alpha);
  if (red === null || green === null || blue === null || parsedAlpha === null) return null;
  return { red, green, blue, alpha: parsedAlpha };
}

function parseHue(value: string): number | null {
  const match = /^(-?\d*\.?\d+)(deg|grad|rad|turn)?$/i.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return null;
  const unit = match[2]?.toLowerCase();
  const degrees = unit === "turn"
    ? parsed * 360
    : unit === "rad"
      ? parsed * 180 / Math.PI
      : unit === "grad"
        ? parsed * 0.9
        : parsed;
  return ((degrees % 360) + 360) % 360;
}

function parsePercentage(value: string): number | null {
  const match = /^(-?\d*\.?\d+)%$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? clampUnit(parsed / 100) : null;
}

function parseHslColor(value: string): ParsedColor | null {
  const match = /^hsla?\((.*)\)$/i.exec(value.trim());
  if (!match) return null;
  const { channels, alpha } = splitFunctionalColorBody(match[1]);
  if (channels.length !== 3) return null;
  const hue = parseHue(channels[0]);
  const saturation = parsePercentage(channels[1]);
  const lightness = parsePercentage(channels[2]);
  const parsedAlpha = parseAlpha(alpha);
  if (hue === null || saturation === null || lightness === null || parsedAlpha === null) return null;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const intermediate = chroma * (1 - Math.abs(segment % 2 - 1));
  const [redPrime, greenPrime, bluePrime] = segment < 1
    ? [chroma, intermediate, 0]
    : segment < 2
      ? [intermediate, chroma, 0]
      : segment < 3
        ? [0, chroma, intermediate]
        : segment < 4
          ? [0, intermediate, chroma]
          : segment < 5
            ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const offset = lightness - chroma / 2;
  return {
    red: clampByte((redPrime + offset) * 255),
    green: clampByte((greenPrime + offset) * 255),
    blue: clampByte((bluePrime + offset) * 255),
    alpha: parsedAlpha
  };
}

function browserNamedColor(value: string): ParsedColor | null {
  const normalizedName = value.trim().toLowerCase();
  if (NON_CONCRETE_COLOR_KEYWORDS.has(normalizedName)) return null;
  if (browserNamedColorCache.has(normalizedName)) {
    return browserNamedColorCache.get(normalizedName) ?? null;
  }
  if (typeof document === "undefined") return null;
  if (browserColorContext === undefined) {
    browserColorContext = document.createElement("canvas").getContext("2d");
  }
  const context = browserColorContext;
  if (!context) return null;
  context.fillStyle = "#010203";
  context.fillStyle = normalizedName;
  const normalized = String(context.fillStyle);
  const parsed = normalized.toLowerCase() === "#010203"
    ? null
    : parseHexColor(normalized) ?? parseRgbColor(normalized);
  browserNamedColorCache.set(normalizedName, parsed);
  return parsed;
}

function parseColor(value: string): ParsedColor | null {
  const trimmed = value.trim();
  const basic = BASIC_NAMED_COLORS[trimmed.toLowerCase()];
  return parseHexColor(trimmed) ??
    parseRgbColor(trimmed) ??
    parseHslColor(trimmed) ??
    (basic ? parseHexColor(basic) : browserNamedColor(trimmed));
}

function stripCssComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "");
}

function cssValueRanges(source: string, sourceOffset = 0): CssValueRange[] {
  const ranges: CssValueRange[] = [];
  let declarationStart = 0;
  let valueStart = -1;
  let property = "";
  let quote = "";
  let escaped = false;
  let comment = false;
  let parentheses = 0;

  const finishValue = (end: number) => {
    if (valueStart < 0) return;
    let trimmedStart = valueStart;
    let trimmedEnd = end;
    while (trimmedStart < trimmedEnd && /\s/.test(source[trimmedStart])) trimmedStart += 1;
    while (trimmedEnd > trimmedStart && /\s/.test(source[trimmedEnd - 1])) trimmedEnd -= 1;
    if (trimmedStart < trimmedEnd) {
      ranges.push({
        start: sourceOffset + trimmedStart,
        end: sourceOffset + trimmedEnd,
        property,
        declarationStart: sourceOffset + declarationStart,
        declarationEnd: sourceOffset + end + (source[end] === ";" ? 1 : 0)
      });
    }
    valueStart = -1;
    property = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      parentheses += 1;
      continue;
    }
    if (char === ")") {
      parentheses = Math.max(0, parentheses - 1);
      continue;
    }
    if (parentheses > 0) continue;
    if (char === "{") {
      finishValue(index);
      declarationStart = index + 1;
      continue;
    }
    if (char === ":" && valueStart < 0) {
      property = stripCssComments(source.slice(declarationStart, index)).trim().toLowerCase();
      valueStart = index + 1;
      continue;
    }
    if (char === ";" || char === "}") {
      finishValue(index);
      declarationStart = index + 1;
    }
  }
  finishValue(source.length);
  return ranges;
}

function structureColorRanges(source: string): CssValueRange[] {
  const ranges: CssValueRange[] = [];
  const pattern = /(?<![\w:-])(style|fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(["'])([\s\S]*?)\2/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const property = match[1].toLowerCase();
    const quoteOffset = match[0].indexOf(match[2]);
    const valueStart = match.index + quoteOffset + 1;
    const value = match[3];
    if (property === "style") {
      ranges.push(...cssValueRanges(value, valueStart));
    } else {
      ranges.push({
        start: valueStart,
        end: valueStart + value.length,
        property,
        declarationStart: valueStart,
        declarationEnd: valueStart + value.length
      });
    }
  }
  return ranges;
}

function sectionColorRanges(section: ButtonSkinSectionName, source: string): CssValueRange[] {
  return section === "structure" ? structureColorRanges(source) : cssValueRanges(source);
}

function propertyAllowsNamedColors(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  if (normalized.startsWith("--")) return !normalized.startsWith("--anim-");
  return [
    "accent",
    "background",
    "border",
    "caret",
    "color",
    "decoration",
    "emphasis",
    "fill",
    "filter",
    "outline",
    "rule",
    "shadow",
    "stroke"
  ].some((part) => normalized.includes(part));
}

function matchingParenthesis(source: string, opening: number, limit: number): number {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = opening; index < limit; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function colorTokens(source: string, ranges: readonly CssValueRange[]): ButtonSkinColorToken[] {
  const tokens: ButtonSkinColorToken[] = [];
  for (const range of ranges) {
    if (range.property === BUTTON_SKIN_TEXT_COLOR_VARIABLE) continue;
    let quote = "";
    let escaped = false;
    let comment = false;
    for (let index = range.start; index < range.end; index += 1) {
      const char = source[index];
      const next = source[index + 1];
      if (comment) {
        if (char === "*" && next === "/") {
          comment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === "/" && next === "*") {
        comment = true;
        index += 1;
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }
      if (char === "#") {
        const match = /^#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i.exec(
          source.slice(index, range.end)
        );
        const compactPrefix = source.slice(Math.max(range.start, index - 6), index).replace(/\s/g, "").toLowerCase();
        if (match && !compactPrefix.endsWith("url(")) {
          const color = parseHexColor(match[0]);
          if (color) tokens.push({ start: index, end: index + match[0].length, color, property: range.property });
          index += match[0].length - 1;
        }
        continue;
      }
      if (!/[a-z]/i.test(char)) continue;
      if (index > range.start && /[a-z0-9_-]/i.test(source[index - 1])) continue;
      const urlMatch = /^url\s*\(/i.exec(source.slice(index, range.end));
      if (urlMatch) {
        const opening = index + urlMatch[0].lastIndexOf("(");
        const closing = matchingParenthesis(source, opening, range.end);
        if (closing >= 0) {
          index = closing;
          continue;
        }
      }
      const functionMatch = /^(rgba?|hsla?)\s*\(/i.exec(source.slice(index, range.end));
      if (functionMatch) {
        const opening = index + functionMatch[0].lastIndexOf("(");
        const closing = matchingParenthesis(source, opening, range.end);
        if (closing >= 0) {
          const candidate = source.slice(index, closing + 1);
          const color = parseColor(candidate);
          if (color) tokens.push({ start: index, end: closing + 1, color, property: range.property });
          index = closing;
          continue;
        }
      }
      const identifier = /^[a-z][a-z0-9-]*/i.exec(source.slice(index, range.end))?.[0];
      if (!identifier) continue;
      const color = propertyAllowsNamedColors(range.property) ? parseColor(identifier) : null;
      if (color) tokens.push({ start: index, end: index + identifier.length, color, property: range.property });
      index += identifier.length - 1;
    }
  }
  return tokens;
}

function tokensForSection(section: ButtonSkinSectionName, source: string): ButtonSkinColorToken[] {
  return colorTokens(source, sectionColorRanges(section, source));
}

export function normalizeButtonSkinColor(value: string): string | null {
  const parsed = parseColor(value);
  return parsed ? colorText(parsed) : null;
}

export function normalizeButtonHighlightAmount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BUTTON_HIGHLIGHT_AMOUNT_MIN &&
    value <= BUTTON_HIGHLIGHT_AMOUNT_MAX
    ? value
    : null;
}

export function resolveButtonHighlightAmount(value: unknown): number {
  return normalizeButtonHighlightAmount(value) ?? DEFAULT_BUTTON_HIGHLIGHT_AMOUNT;
}

export function normalizeButtonGlowAmount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BUTTON_HIGHLIGHT_AMOUNT_MIN &&
    value <= BUTTON_GLOW_AMOUNT_MAX
    ? value
    : null;
}

export function resolveButtonGlowAmount(value: unknown): number {
  return normalizeButtonGlowAmount(value) ?? DEFAULT_BUTTON_HIGHLIGHT_AMOUNT;
}

function highlightFilterNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function buttonHighlightGlowColor(value: string | null, intensity: number): string {
  const color = (value ? parseColor(value) : null) ?? {
    red: 255,
    green: 255,
    blue: 255,
    alpha: 204
  };
  return colorText({
    ...color,
    alpha: clampByte(color.alpha * intensity)
  });
}

/**
 * Builds the host-owned fallback highlight without changing authored skin
 * states. Hover/active brightness and glow are independently scalable; active
 * remains stronger at the same percentage, and hover still stacks on it.
 */
export function buttonHighlightFilter(args: {
  hoverHighlighted: boolean;
  activeHighlighted: boolean;
  hoverHighlightColor: string | null;
  activeHighlightColor: string | null;
  /** @deprecated Compatibility fallback for the original combined amount. */
  highlightAmount?: number | null;
  hoverHighlightAmount?: number | null;
  activeHighlightAmount?: number | null;
  hoverGlowAmount?: number | null;
  activeGlowAmount?: number | null;
}): string | undefined {
  if (!args.hoverHighlighted && !args.activeHighlighted) return undefined;
  const hoverHighlightIntensity = resolveButtonHighlightAmount(
    args.hoverHighlightAmount ?? args.highlightAmount
  ) / BUTTON_EFFECT_AMOUNT_REFERENCE;
  const activeHighlightIntensity = resolveButtonHighlightAmount(
    args.activeHighlightAmount ?? args.highlightAmount
  ) / BUTTON_EFFECT_AMOUNT_REFERENCE;
  const hoverGlowIntensity = resolveButtonGlowAmount(
    args.hoverGlowAmount ?? args.highlightAmount
  ) / BUTTON_EFFECT_AMOUNT_REFERENCE;
  const activeGlowIntensity = resolveButtonGlowAmount(
    args.activeGlowAmount ?? args.highlightAmount
  ) / BUTTON_EFFECT_AMOUNT_REFERENCE;
  const filters: string[] = [];
  if (args.activeHighlighted && activeHighlightIntensity > 0) {
    filters.push(`brightness(${highlightFilterNumber(1 + 0.5 * activeHighlightIntensity)})`);
  }
  if (args.hoverHighlighted && hoverHighlightIntensity > 0) {
    filters.push(`brightness(${highlightFilterNumber(1 + 0.35 * hoverHighlightIntensity)})`);
  }
  if (args.activeHighlighted && activeGlowIntensity > 0) {
    const activeGlowRadius = highlightFilterNumber(2 + 14 * activeGlowIntensity);
    filters.push(
      `drop-shadow(0 0 ${activeGlowRadius}px ${buttonHighlightGlowColor(args.activeHighlightColor, activeGlowIntensity)})`
    );
  }
  if (args.hoverHighlighted && hoverGlowIntensity > 0) {
    const hoverGlowRadius = highlightFilterNumber(2 + 14 * hoverGlowIntensity);
    filters.push(
      `drop-shadow(0 0 ${hoverGlowRadius}px ${buttonHighlightGlowColor(args.hoverHighlightColor, hoverGlowIntensity)})`
    );
  }
  return filters.length > 0 ? filters.join(" ") : undefined;
}

export function buttonSkinPickerColor(value: string): string {
  const parsed = parseColor(value) ?? { red: 255, green: 255, blue: 255, alpha: 255 };
  return `#${byteHex(parsed.red)}${byteHex(parsed.green)}${byteHex(parsed.blue)}`;
}

export function buttonSkinOpaqueColor(value: string): string | null {
  const parsed = parseColor(value);
  return parsed ? colorText({ ...parsed, alpha: 255 }) : null;
}

export function buttonSkinColorWithPreservedAlpha(nextPickerColor: string, currentColor: string): string | null {
  const next = parseColor(nextPickerColor);
  const current = parseColor(currentColor);
  if (!next || !current) return null;
  return colorText({ ...next, alpha: current.alpha });
}

export function buttonSkinColorOpacityPercent(value: string): number {
  const parsed = parseColor(value);
  return parsed ? Math.round(parsed.alpha / 255 * 100) : 100;
}

export function buttonSkinColorWithOpacity(value: string, opacityPercent: number): string | null {
  const parsed = parseColor(value);
  if (!parsed || !Number.isFinite(opacityPercent)) return null;
  return colorText({
    ...parsed,
    alpha: clampByte(clampUnit(opacityPercent / 100) * 255)
  });
}

function buttonSkinProfileColorLabel(role: string): string {
  if (role === "primary" || role === "surface") return "Button Color";
  if (role === "text") return "Text Color";
  const words = role
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
  return `${words || "Profile"} Color`;
}

/**
 * Reads only explicit semantic profile roots authored in Base. Related shades
 * consume these roots through --flowcell-button-shade-* variables, so literal
 * shadows, glows, filters, and status colors never become picker rows.
 */
export function collectButtonSkinProfileColors(
  source: ButtonSkinSectionSource
): ButtonSkinProfileColor[] {
  const colors = new Map<string, ButtonSkinProfileColor>();
  for (const range of cssValueRanges(source.base)) {
    if (!range.property.startsWith(BUTTON_SKIN_PROFILE_COLOR_PREFIX)) continue;
    const role = range.property.slice(BUTTON_SKIN_PROFILE_COLOR_PREFIX.length);
    if (!/^[a-z][a-z0-9-]*$/.test(role)) continue;
    const color = normalizeButtonSkinColor(source.base.slice(range.start, range.end));
    if (!color) continue;
    colors.set(range.property, {
      variable: range.property,
      role,
      label: buttonSkinProfileColorLabel(role),
      color
    });
  }
  return [...colors.values()];
}

export type ButtonSkinSurfaceThemeMode = "semantic" | "legacy-variable" | "tint";

function sectionValueRanges(
  source: ButtonSkinSectionSource
): Array<{ source: string; range: CssValueRange }> {
  return BUTTON_SKIN_SECTION_ORDER.flatMap((section) => (
    sectionColorRanges(section, source[section]).map((range) => ({
      source: source[section],
      range
    }))
  ));
}

function valueConsumesVariable(value: string, variable: string): boolean {
  return new RegExp(`var\\(\\s*${variable}(?:\\s*[,)]|\\s*$)`).test(stripCssComments(value));
}

function isSurfacePaintProperty(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  if (normalized.startsWith("--")) return false;
  return [
    "background",
    "border",
    "box-shadow",
    "fill",
    "filter",
    "flood-color",
    "lighting-color",
    "outline",
    "stroke"
  ].some((part) => normalized.includes(part));
}

function isTextPaintProperty(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  return normalized === "color" ||
    normalized === "fill" ||
    normalized === "-webkit-text-fill-color" ||
    normalized === "-webkit-text-stroke-color";
}

function consumedLegacyVariable(
  source: ButtonSkinSectionSource,
  variables: readonly string[],
  acceptsProperty: (property: string) => boolean
): string | null {
  const ranges = sectionValueRanges(source);
  for (const variable of variables) {
    const consumed = ranges.some(({ source: sectionSource, range }) => (
      acceptsProperty(range.property) &&
      valueConsumesVariable(sectionSource.slice(range.start, range.end), variable)
    ));
    if (consumed) return variable;
  }
  return null;
}

/** Returns the one authored variable the Surface channel should drive. */
export function buttonSkinSurfaceThemeVariable(
  source: ButtonSkinSectionSource
): string | null {
  const roles = new Set(collectButtonSkinProfileColors(source).map(({ role }) => role));
  if (roles.has("surface")) return `${BUTTON_SKIN_PROFILE_COLOR_PREFIX}surface`;
  if (roles.has("primary")) return `${BUTTON_SKIN_PROFILE_COLOR_PREFIX}primary`;
  return consumedLegacyVariable(source, BUTTON_SKIN_LEGACY_SURFACE_VARIABLES, isSurfacePaintProperty);
}

/** Returns the one authored variable the Text channel should drive. */
export function buttonSkinTextThemeVariable(
  source: ButtonSkinSectionSource
): string | null {
  const roles = new Set(collectButtonSkinProfileColors(source).map(({ role }) => role));
  if (roles.has("text")) return `${BUTTON_SKIN_PROFILE_COLOR_PREFIX}text`;
  return consumedLegacyVariable(source, BUTTON_SKIN_LEGACY_TEXT_VARIABLES, isTextPaintProperty);
}

/** Resolves Theme colors to only the authored channel each skin actually consumes. */
export function buttonSkinThemeColorVariables(
  source: ButtonSkinSectionSource,
  colors: Readonly<Record<string, string>> | null | undefined
): Record<`--${string}`, string> {
  const variables: Record<`--${string}`, string> = {};
  const surfaceVariable = buttonSkinSurfaceThemeVariable(source);
  const textVariable = buttonSkinTextThemeVariable(source);
  for (const [role, rawColor] of Object.entries(colors ?? {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(role)) continue;
    const color = normalizeButtonSkinColor(rawColor);
    if (!color) continue;
    if (role === "surface") {
      if (surfaceVariable) variables[surfaceVariable as `--${string}`] = color;
      continue;
    }
    if (role === "text") {
      variables[(textVariable ?? BUTTON_SKIN_TEXT_COLOR_VARIABLE) as `--${string}`] = color;
      continue;
    }
    variables[`${BUTTON_SKIN_PROFILE_COLOR_PREFIX}${role}`] = color;
  }
  return variables;
}

/** Chooses an exact authored path when one exists, otherwise host paint mapping. */
export function buttonSkinSurfaceThemeMode(
  source: ButtonSkinSectionSource
): ButtonSkinSurfaceThemeMode {
  const variable = buttonSkinSurfaceThemeVariable(source);
  if (!variable) return "tint";
  return variable.startsWith(BUTTON_SKIN_PROFILE_COLOR_PREFIX) ? "semantic" : "legacy-variable";
}

function isFallbackSurfaceColorProperty(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  if (normalized.startsWith("--")) {
    if (normalized.startsWith("--anim-")) return false;
    return !/(?:text|label|ink|font|foreground|\bfg\b)/.test(normalized);
  }
  if ([
    "color",
    "caret-color",
    "text-decoration-color",
    "text-emphasis-color",
    "text-shadow",
    "text-stroke",
    "-webkit-text-fill-color",
    "-webkit-text-stroke",
    "-webkit-text-stroke-color"
  ].some((textProperty) => normalized === textProperty || normalized.startsWith(`${textProperty}-`))) {
    return false;
  }
  return propertyAllowsNamedColors(normalized);
}

interface LabelOpeningTag {
  name: string;
  start: number;
  end: number;
  source: string;
}

const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr"
]);

function labelOpeningTags(structure: string): LabelOpeningTag[] {
  const labelIndex = structure.indexOf(BUTTON_SKIN_LABEL_TOKEN);
  if (labelIndex < 0) return [];
  const stack: LabelOpeningTag[] = [];
  const pattern = /<\s*(\/?)\s*([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(structure)) && match.index < labelIndex) {
    const name = match[2].toLowerCase();
    if (match[1]) {
      const matchingIndex = stack.map((entry) => entry.name).lastIndexOf(name);
      if (matchingIndex >= 0) stack.splice(matchingIndex);
      continue;
    }
    if (match[0].endsWith("/>") || HTML_VOID_ELEMENTS.has(name)) continue;
    stack.push({
      name,
      start: match.index,
      end: match.index + match[0].length,
      source: match[0]
    });
  }
  return stack;
}

function isLabelOwnedSurfaceToken(
  section: ButtonSkinSectionName,
  token: ButtonSkinColorToken,
  labelTags: readonly LabelOpeningTag[]
): boolean {
  if (section !== "structure") return false;
  const labelTag = labelTags.find((tag) => (
    token.start >= tag.start && token.end <= tag.end
  ));
  if (!labelTag) return false;
  const property = token.property.trim().toLowerCase();
  if ((labelTag.name === "text" || labelTag.name === "tspan") && (
    property === "fill" || property === "stroke"
  )) return true;
  return property.startsWith("background") &&
    /(?:-webkit-)?background-clip\s*:\s*text/i.test(stripCssComments(labelTag.source));
}

function fallbackSurfaceColor(source: ParsedColor, target: ParsedColor): string {
  const luminance = (
    source.red * 0.2126 +
    source.green * 0.7152 +
    source.blue * 0.0722
  ) / 255;
  const shade = (luminance - 0.5) * 255;
  return colorText({
    red: clampByte(target.red + shade),
    green: clampByte(target.green + shade),
    blue: clampByte(target.blue + shade),
    alpha: clampByte(source.alpha * target.alpha / 255)
  });
}

/** Lists the exact authored paints consumed by the render-only Surface tint path. */
export function collectButtonSkinSurfaceThemeFallbackColors(
  source: ButtonSkinSectionSource
): string[] {
  const colors = new Set<string>();
  const labelTags = labelOpeningTags(source.structure);
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    for (const token of tokensForSection(section, source[section])) {
      if (
        isFallbackSurfaceColorProperty(token.property) &&
        !isLabelOwnedSurfaceToken(section, token, labelTags)
      ) {
        colors.add(colorText(token.color));
      }
    }
  }
  return [...colors];
}

/**
 * Creates an in-memory, render-only source for skins without a Surface root.
 * It maps paint colors around the selected hue while preserving relative
 * shading and multiplying source alpha by the selected opacity. Text paint is
 * left alone so the Text channel remains independent. The saved skin object is
 * never mutated.
 */
export function applyButtonSkinSurfaceThemeFallback(
  source: ButtonSkinSectionSource,
  value: string
): ButtonSkinSectionSource {
  const target = parseColor(value);
  if (!target) return source;
  const next = { ...source };
  const labelTags = labelOpeningTags(source.structure);
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    const sectionSource = source[section];
    const matches = tokensForSection(section, sectionSource)
      .filter((token) => (
        isFallbackSurfaceColorProperty(token.property) &&
        !isLabelOwnedSurfaceToken(section, token, labelTags)
      ))
      .sort((left, right) => right.start - left.start);
    if (matches.length === 0) continue;
    let changed = sectionSource;
    for (const match of matches) {
      changed = `${changed.slice(0, match.start)}${fallbackSurfaceColor(match.color, target)}${changed.slice(match.end)}`;
    }
    next[section] = changed;
  }
  return next;
}

/** Updates one declared profile root without touching any visual occurrence. */
export function setButtonSkinProfileColor(
  source: ButtonSkinSectionSource,
  variable: string,
  nextColorValue: string
): ButtonSkinSectionSource {
  if (!variable.startsWith(BUTTON_SKIN_PROFILE_COLOR_PREFIX)) return source;
  const role = variable.slice(BUTTON_SKIN_PROFILE_COLOR_PREFIX.length);
  if (!/^[a-z][a-z0-9-]*$/.test(role)) return source;
  const replacement = normalizeButtonSkinColor(nextColorValue);
  if (!replacement) return source;
  const matches = cssValueRanges(source.base)
    .filter((range) => range.property === variable)
    .sort((left, right) => right.start - left.start);
  if (matches.length === 0) return source;
  let base = source.base;
  for (const match of matches) {
    base = `${base.slice(0, match.start)}${replacement}${base.slice(match.end)}`;
  }
  return { ...source, base };
}

export function collectButtonSkinColorBuckets(
  source: ButtonSkinSectionSource
): ButtonSkinColorBucket[] {
  const buckets = new Map<string, ButtonSkinColorBucket>();
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    for (const token of tokensForSection(section, source[section])) {
      const id = colorId(token.color);
      const current = buckets.get(id);
      if (current) {
        current.occurrences += 1;
        if (!current.sections.includes(section)) current.sections.push(section);
        continue;
      }
      buckets.set(id, {
        id,
        color: colorText(token.color),
        pickerColor: `#${byteHex(token.color.red)}${byteHex(token.color.green)}${byteHex(token.color.blue)}`,
        alpha: token.color.alpha,
        occurrences: 1,
        sections: [section]
      });
    }
  }
  return [...buckets.values()];
}

export function replaceButtonSkinColor(
  source: ButtonSkinSectionSource,
  bucketId: string,
  nextColorValue: string
): ButtonSkinSectionSource {
  const nextColor = parseColor(nextColorValue);
  const target = parseColor(bucketId);
  if (!nextColor || !target) return source;
  const targetId = colorId(target);
  const replacement = colorText(nextColor);
  const next = { ...source };
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    const sectionSource = source[section];
    const matches = tokensForSection(section, sectionSource)
      .filter((token) => colorId(token.color) === targetId)
      .sort((left, right) => right.start - left.start);
    if (matches.length === 0) continue;
    let changed = sectionSource;
    for (const match of matches) {
      changed = `${changed.slice(0, match.start)}${replacement}${changed.slice(match.end)}`;
    }
    next[section] = changed;
  }
  return next;
}

export function readButtonSkinTextColor(source: ButtonSkinSectionSource): string | null {
  const range = cssValueRanges(source.base).find(
    (candidate) => candidate.property === BUTTON_SKIN_TEXT_COLOR_VARIABLE
  );
  return range ? normalizeButtonSkinColor(source.base.slice(range.start, range.end)) : null;
}

export function setButtonSkinTextColor(
  source: ButtonSkinSectionSource,
  nextColorValue: string | null
): ButtonSkinSectionSource {
  const replacement = nextColorValue === null ? "inherit" : normalizeButtonSkinColor(nextColorValue);
  if (!replacement) return source;
  const range = cssValueRanges(source.base).find(
    (candidate) => candidate.property === BUTTON_SKIN_TEXT_COLOR_VARIABLE
  );
  if (range) {
    if (nextColorValue === null) {
      return {
        ...source,
        base: `${source.base.slice(0, range.declarationStart)}${source.base.slice(range.declarationEnd)}`
      };
    }
    return {
      ...source,
      base: `${source.base.slice(0, range.start)}${replacement}${source.base.slice(range.end)}`
    };
  }
  if (nextColorValue === null) return source;
  return {
    ...source,
    base: `${BUTTON_SKIN_TEXT_COLOR_VARIABLE}:${replacement};${source.base}`
  };
}

/**
 * Reads the portable host-owned hover lift from Base. A missing or malformed
 * declaration returns null so older placement-owned values can remain a
 * compatibility fallback without becoming part of new skin edits.
 */
export function readButtonSkinHighlightOnHover(source: { base: string }): boolean | null {
  return readButtonSkinHighlightFlag(source, BUTTON_SKIN_HIGHLIGHT_ON_HOVER_VARIABLE);
}

/** Writes an explicit portable hover-lift choice without changing visual source beyond Base. */
export function setButtonSkinHighlightOnHover(
  source: ButtonSkinSectionSource,
  enabled: boolean
): ButtonSkinSectionSource {
  return setButtonSkinHighlightFlag(source, BUTTON_SKIN_HIGHLIGHT_ON_HOVER_VARIABLE, enabled);
}

/**
 * Reads the portable host-owned active lift from Base. It is the same portable
 * declaration as the hover lift, but it answers the latched selected state
 * rather than pointer hover, so an authored Pressed section is not the only way
 * to see which Button is currently active.
 */
export function readButtonSkinHighlightOnActive(source: { base: string }): boolean | null {
  return readButtonSkinHighlightFlag(source, BUTTON_SKIN_HIGHLIGHT_ON_ACTIVE_VARIABLE);
}

/** Writes an explicit portable active-lift choice without changing visual source beyond Base. */
export function setButtonSkinHighlightOnActive(
  source: ButtonSkinSectionSource,
  enabled: boolean
): ButtonSkinSectionSource {
  return setButtonSkinHighlightFlag(source, BUTTON_SKIN_HIGHLIGHT_ON_ACTIVE_VARIABLE, enabled);
}

function readButtonSkinHighlightFlag(
  source: { base: string },
  variable: string
): boolean | null {
  const ranges = cssValueRanges(source.base).filter(
    (candidate) => candidate.property === variable
  );
  const range = ranges[ranges.length - 1];
  if (!range) return null;
  const value = source.base.slice(range.start, range.end).trim().toLowerCase();
  if (["1", "true", "on"].includes(value)) return true;
  if (["0", "false", "off"].includes(value)) return false;
  return null;
}

function setButtonSkinHighlightFlag(
  source: ButtonSkinSectionSource,
  variable: string,
  enabled: boolean
): ButtonSkinSectionSource {
  const replacement = enabled ? "1" : "0";
  const matches = cssValueRanges(source.base)
    .filter((candidate) => candidate.property === variable)
    .sort((left, right) => right.start - left.start);
  if (matches.length === 0) {
    return {
      ...source,
      base: `${variable}:${replacement};${source.base}`
    };
  }
  let base = source.base;
  for (const match of matches) {
    base = `${base.slice(0, match.start)}${replacement}${base.slice(match.end)}`;
  }
  return { ...source, base };
}
