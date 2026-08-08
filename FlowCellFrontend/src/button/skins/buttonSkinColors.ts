import type { ButtonSkinSectionName } from "../types.js";
import {
  BUTTON_SKIN_SECTION_ORDER,
  type ButtonSkinSectionSource
} from "./buttonSkinFormat.js";

export const BUTTON_SKIN_TEXT_COLOR_VARIABLE = "--flowcell-button-text-color";
export const BUTTON_SKIN_PROFILE_COLOR_PREFIX = "--flowcell-button-color-";
export const BUTTON_SKIN_HIGHLIGHT_ON_HOVER_VARIABLE = "--flowcell-button-highlight-on-hover";
export const BUTTON_SKIN_HIGHLIGHT_ON_ACTIVE_VARIABLE = "--flowcell-button-highlight-on-active";

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
      property = source.slice(declarationStart, index).trim().toLowerCase();
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
          if (color) tokens.push({ start: index, end: index + match[0].length, color });
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
          if (color) tokens.push({ start: index, end: closing + 1, color });
          index = closing;
          continue;
        }
      }
      const identifier = /^[a-z][a-z0-9-]*/i.exec(source.slice(index, range.end))?.[0];
      if (!identifier) continue;
      const color = propertyAllowsNamedColors(range.property) ? parseColor(identifier) : null;
      if (color) tokens.push({ start: index, end: index + identifier.length, color });
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
