// Paste parsing, validation, and CSS compilation for Appearance Hub skins.
// Everything compiled here is scoped under `.ahub-stage .ahub-s-<id>` so the
// output can only ever style instances mounted inside the hub's own preview
// stage — it cannot reach any live FlowCell button.

import { sanitizeMarkup } from "../../lib/importedSkin";
import {
  FORBIDDEN_STATE_PATTERNS,
  HUB_CORE_ATTRIBUTE,
  HUB_LABEL_PLACEHOLDER,
  KEYFRAMES_SLOT_ID,
  STATE_SELECTOR_SUFFIX,
  STATE_SLOT_IDS,
  STRUCTURE_SLOT_ID,
  SLOT_MARKER_LINE_PATTERN,
  isSlotId,
  type SlotId,
  type StateSlotId
} from "./slotSpec";

export type SlotContentMap = Record<SlotId, string>;

export type SlotPasteResult = {
  slots: Partial<SlotContentMap>;
  unknownSections: string[];
};

export function createEmptySlots(): SlotContentMap {
  const slots = {} as SlotContentMap;
  slots[STRUCTURE_SLOT_ID] = "";
  slots[KEYFRAMES_SLOT_ID] = "";
  for (const slotId of STATE_SLOT_IDS) {
    slots[slotId] = "";
  }
  return slots;
}

// Split a full-skin paste on `=== slot ===` marker lines.
export function splitSlotPaste(source: string): SlotPasteResult {
  const slots: Partial<SlotContentMap> = {};
  const unknownSections: string[] = [];
  let currentSlot: SlotId | null = null;
  let currentLines: string[] = [];

  const commit = () => {
    if (currentSlot) {
      slots[currentSlot] = currentLines.join("\n").trim();
    }
    currentLines = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const marker = SLOT_MARKER_LINE_PATTERN.exec(line.trim());
    if (marker) {
      commit();
      const name = marker[1];
      if (isSlotId(name)) {
        currentSlot = name;
      } else {
        currentSlot = null;
        unknownSections.push(name);
      }
      continue;
    }
    if (currentSlot) {
      currentLines.push(line);
    }
  }
  commit();

  return { slots, unknownSections };
}

export function validateStructure(markup: string): string[] {
  const errors: string[] = [];
  const trimmed = markup.trim();
  if (!trimmed) {
    errors.push("Structure is empty.");
    return errors;
  }
  if (!trimmed.includes(HUB_LABEL_PLACEHOLDER)) {
    errors.push(`Structure must contain ${HUB_LABEL_PLACEHOLDER}.`);
  }
  const coreCount = (trimmed.match(/\bdata-core\b/g) ?? []).length;
  if (coreCount === 0) {
    errors.push(`Structure needs one element marked ${HUB_CORE_ATTRIBUTE} (the measured button + hitbox).`);
  } else if (coreCount > 1) {
    errors.push(`Structure has ${coreCount} ${HUB_CORE_ATTRIBUTE} markers — exactly one is required.`);
  }
  return errors;
}

export function validateStateSlot(content: string): string[] {
  const errors: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return errors;
  }
  for (const rule of FORBIDDEN_STATE_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      errors.push(rule.message);
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  for (const declaration of splitDeclarations(trimmed)) {
    if (!/^(--)?[a-zA-Z][a-zA-Z0-9-]*\s*:/.test(declaration)) {
      errors.push(`Not a CSS declaration: "${truncate(declaration, 40)}"`);
    }
  }
  return errors;
}

// The keyframes slot may contain @keyframes (or @-webkit-keyframes) blocks
// and nothing else. Bodies only ever match percentage/from/to selectors, and
// the compiled sheet is mounted only while this skin is selected in the hub,
// so unprefixed animation names stay bench-local in practice.
export function validateKeyframesSlot(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const errors: string[] = [];
  if (/</.test(trimmed)) {
    errors.push("No markup inside the keyframes slot.");
  }
  if (/javascript\s*:/i.test(trimmed)) {
    errors.push("javascript: URLs are not allowed.");
  }
  if (/expression\s*\(/i.test(trimmed)) {
    errors.push("CSS expression() is not allowed.");
  }
  if (errors.length > 0) {
    return errors;
  }

  let rest = trimmed;
  while (rest.length > 0) {
    const head = /^@(?:-webkit-)?keyframes\s+[a-zA-Z_][\w-]*\s*\{/.exec(rest);
    if (!head) {
      errors.push("Only @keyframes blocks are allowed in the keyframes slot.");
      break;
    }
    const end = findBlockEnd(rest, head[0].length - 1);
    if (end < 0) {
      errors.push("Unbalanced braces in a @keyframes block.");
      break;
    }
    rest = rest.slice(end + 1).trim();
  }
  return errors;
}

function findBlockEnd(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

// Split on semicolons, but only at paren depth 0 so url(data:...;base64,...)
// style values survive.
function splitDeclarations(source: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of source) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (character === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        declarations.push(trimmed);
      }
      current = "";
      continue;
    }
    current += character;
  }
  const trailing = current.trim();
  if (trailing) {
    declarations.push(trailing);
  }
  return declarations;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildScopeClassName(skinId: string): string {
  const token = skinId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return `ahub-s-${token.length > 0 ? token : "skin"}`;
}

// The contract forbids inline `animation` in structure — motion may only come
// from `data-anim` tags plus `--anim-*` state rules. Strip any that slip
// through (including stale var()-wired skins from before the data-anim
// mechanism), so no pasted skin can ever animate outside its state rules.
function stripAnimationDeclarations(css: string): string {
  return css.replace(/(^|[;\s])(?:-webkit-)?animation(?:-[a-z-]+)?\s*:[^;]*(;|$)/gi, "$1");
}

function stripInlineAnimations(markup: string): string {
  return markup
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/style="([^"]*)"/gi, (_match, css: string) => `style="${stripAnimationDeclarations(css)}"`)
    .replace(/style='([^']*)'/gi, (_match, css: string) => `style='${stripAnimationDeclarations(css)}'`);
}

// Fully sanitized structure markup: scripts/handlers stripped, style/link
// tags removed, inline animation declarations removed.
export function sanitizeStructureMarkup(structure: string): string {
  return stripInlineAnimations(sanitizeMarkup(structure));
}

// Inject the bench label into the sanitized structure. Stacked mode puts each
// word on its own line via <br> (forced breaks work even under nowrap).
export function renderStructureHtml(
  structure: string,
  label: string,
  stacked: boolean
): string {
  const safeLabel = stacked
    ? label
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => escapeHtml(word))
        .join("<br>")
    : escapeHtml(label);
  return sanitizeStructureMarkup(structure).replace(/\{\{label\}\}/g, safeLabel);
}

// Two-line mode breaks the label at the space closest to its middle; one-line
// mode injects it verbatim. <br> forces the break even under nowrap.
export function renderStructureHtmlWithLines(
  structure: string,
  label: string,
  lines: 1 | 2
): string {
  let safeLabel = escapeHtml(label);
  if (lines === 2) {
    const trimmed = label.trim();
    const middle = trimmed.length / 2;
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] === " ") {
        const distance = Math.abs(index - middle);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }
    if (bestIndex > 0) {
      safeLabel = `${escapeHtml(trimmed.slice(0, bestIndex))}<br>${escapeHtml(trimmed.slice(bestIndex + 1))}`;
    }
  }
  return sanitizeStructureMarkup(structure).replace(/\{\{label\}\}/g, safeLabel);
}

export type CompiledSkin = {
  css: string;
  slotErrors: Partial<Record<SlotId, string[]>>;
  structureValid: boolean;
};

// Compile every valid state slot into scoped CSS. Normal declarations style
// the data-core element; custom properties land on the instance wrapper so
// they cascade into decorative children. An optional text-bench font size is
// appended last so it wins over the base slot at equal specificity.
export function compileSkin(
  skinId: string,
  slots: SlotContentMap,
  fontSizePx: number | null,
  fontFamily?: string | null
): CompiledSkin {
  const scope = `.ahub-stage .${buildScopeClassName(skinId)}`;
  const slotErrors: Partial<Record<SlotId, string[]>> = {};
  const cssParts: string[] = [];

  const structureErrors = validateStructure(slots[STRUCTURE_SLOT_ID]);
  if (structureErrors.length > 0) {
    slotErrors[STRUCTURE_SLOT_ID] = structureErrors;
  }

  const keyframesContent = slots[KEYFRAMES_SLOT_ID].trim();
  if (keyframesContent) {
    const keyframesErrors = validateKeyframesSlot(keyframesContent);
    if (keyframesErrors.length > 0) {
      slotErrors[KEYFRAMES_SLOT_ID] = keyframesErrors;
    } else {
      cssParts.push(keyframesContent);
    }
  }

  for (const slotId of STATE_SLOT_IDS) {
    const content = slots[slotId].trim();
    if (!content) {
      continue;
    }
    const errors = validateStateSlot(content);
    if (errors.length > 0) {
      slotErrors[slotId] = errors;
      continue;
    }
    cssParts.push(...compileStateSlot(scope, slotId, content));
  }

  if (typeof fontSizePx === "number" && Number.isFinite(fontSizePx) && fontSizePx > 0) {
    cssParts.push(`${scope} [data-core] { font-size: ${fontSizePx}px; }`);
  }
  if (typeof fontFamily === "string" && fontFamily.trim()) {
    cssParts.push(`${scope} [data-core] { font-family: ${JSON.stringify(fontFamily.trim())}; }`);
  }

  return {
    css: cssParts.join("\n"),
    slotErrors,
    structureValid: structureErrors.length === 0
  };
}

// `--anim-<token>: <animation shorthand>` compiles to a REAL animation rule
// on the matching `data-anim="<token>"` child. Never route animations through
// var() indirection: Chromium restarts var()-referenced animations whenever
// any ancestor attribute flips (press/release/hover churn), which reads as
// glitchy multi-starts. A direct rule keyed only on its own state selector is
// immune — unrelated attribute changes leave the computed animation identical.
const ANIM_DECLARATION_PATTERN = /^--anim-([a-z0-9-]+)\s*:\s*(.+)$/i;

export type PartitionedStateDeclarations = {
  varDeclarations: string[];
  coreDeclarations: string[];
  animations: Array<{ token: string; value: string }>;
};

// Shared by the bench compiler and the live bridge compiler so both interpret
// slot content identically.
export function partitionStateDeclarations(content: string): PartitionedStateDeclarations {
  const varDeclarations: string[] = [];
  const coreDeclarations: string[] = [];
  const animations: Array<{ token: string; value: string }> = [];
  for (const declaration of splitDeclarations(content)) {
    const animMatch = ANIM_DECLARATION_PATTERN.exec(declaration);
    if (animMatch) {
      animations.push({ token: animMatch[1].toLowerCase(), value: animMatch[2] });
      continue;
    }
    if (declaration.startsWith("--")) {
      varDeclarations.push(declaration);
    } else {
      coreDeclarations.push(declaration);
    }
  }
  return { varDeclarations, coreDeclarations, animations };
}

function compileStateSlot(scope: string, slotId: StateSlotId, content: string): string[] {
  const suffix = STATE_SELECTOR_SUFFIX[slotId];
  const { varDeclarations, coreDeclarations, animations } = partitionStateDeclarations(content);
  const rules: string[] = [];
  if (varDeclarations.length > 0) {
    rules.push(`${scope}${suffix} { ${varDeclarations.join("; ")}; }`);
  }
  if (coreDeclarations.length > 0) {
    rules.push(`${scope}${suffix} [data-core] { ${coreDeclarations.join("; ")}; }`);
  }
  for (const animation of animations) {
    rules.push(`${scope}${suffix} [data-anim="${animation.token}"] { animation: ${animation.value}; }`);
  }
  return rules;
}
