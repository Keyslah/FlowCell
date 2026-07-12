import type { ButtonSkinSectionName } from "../types.js";
import {
  BUTTON_SKIN_LABEL_TOKEN,
  BUTTON_SKIN_STATE_SECTIONS,
  type ButtonSkinSectionSource,
  type ButtonSkinStateSectionName
} from "./buttonSkinFormat.js";
import { parseCssDeclarations, parseCssKeyframes } from "./cssSyntax.js";

export interface ButtonSkinDiagnostic {
  section: ButtonSkinSectionName;
  message: string;
  offset?: number;
}

export interface ButtonSkinAnalysis {
  animationTokens: string[];
  keyframeNames: string[];
  coreTagName: string;
}

export interface ButtonSkinValidationResult {
  valid: boolean;
  diagnostics: ButtonSkinDiagnostic[];
  analysis: ButtonSkinAnalysis | null;
}

interface MarkupAttribute {
  name: string;
  sourceName: string;
  value: string | null;
}

interface MarkupTag {
  name: string;
  sourceName: string;
  attributes: MarkupAttribute[];
  closing: boolean;
  selfClosing: boolean;
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

const FORBIDDEN_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "embed",
  "object",
  "portal",
  "base",
  "link",
  "meta",
  "form",
  "input",
  "select",
  "option",
  "textarea",
  "button",
  "fieldset",
  "a",
  "area",
  "img",
  "video",
  "audio",
  "source",
  "track"
]);

const URL_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "data",
  "background",
  "ping"
]);

function countOccurrences(source: string, token: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(token, offset)) >= 0) {
    count += 1;
    offset += token.length;
  }
  return count;
}

function decodeEntitiesForValidation(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|colon|tab|newline|amp|quot|apos);?/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return ({ colon: ":", tab: "\t", newline: "\n", amp: "&", quot: '"', apos: "'" } as const)[lower as "colon"] ?? match;
  });
}

function findTagEnd(source: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function parseAttributes(source: string): { attributes: MarkupAttribute[]; error?: string } {
  const attributes: MarkupAttribute[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const nameMatch = /^[a-zA-Z_:][a-zA-Z0-9:._-]*/.exec(source.slice(index));
    if (!nameMatch) {
      return { attributes, error: "Malformed attribute syntax." };
    }
    const sourceName = nameMatch[0];
    const name = sourceName.toLowerCase();
    index += nameMatch[0].length;
    if (seen.has(name)) {
      return { attributes, error: `Duplicate attribute '${name}'.` };
    }
    seen.add(name);
    while (/\s/.test(source[index] ?? "")) index += 1;
    let value: string | null = null;
    if (source[index] === "=") {
      index += 1;
      while (/\s/.test(source[index] ?? "")) index += 1;
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const end = source.indexOf(quote, index);
        if (end < 0) {
          return { attributes, error: `Attribute '${name}' has an unterminated value.` };
        }
        value = source.slice(index, end);
        index = end + 1;
      } else {
        const valueMatch = /^[^\s"'=<>`]+/.exec(source.slice(index));
        if (!valueMatch) {
          return { attributes, error: `Attribute '${name}' has no value.` };
        }
        value = valueMatch[0];
        index += value.length;
      }
    }
    attributes.push({ name, sourceName, value });
  }
  return { attributes };
}

function parseMarkupTag(source: string): { tag?: MarkupTag; error?: string } {
  const trimmed = source.trim();
  const closing = trimmed.startsWith("/");
  const body = closing ? trimmed.slice(1).trimStart() : trimmed;
  const selfClosing = !closing && /\/\s*$/.test(body);
  const normalizedBody = selfClosing ? body.replace(/\/\s*$/, "") : body;
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:_-]*/.exec(normalizedBody);
  if (!nameMatch) {
    return { error: "Malformed markup tag." };
  }
  const sourceName = nameMatch[0];
  const name = sourceName.toLowerCase();
  const rest = normalizedBody.slice(nameMatch[0].length);
  if (closing && rest.trim()) {
    return { error: `Closing tag '${name}' cannot contain attributes.` };
  }
  const parsed = closing ? { attributes: [] as MarkupAttribute[] } : parseAttributes(rest);
  if (parsed.error) {
    return { error: parsed.error };
  }
  return { tag: { name, sourceName, attributes: parsed.attributes, closing, selfClosing } };
}

function hasUnsafeUrl(value: string, allowFragment: boolean): boolean {
  const normalized = decodeEntitiesForValidation(value).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  if (allowFragment && /^#[a-z_][a-z0-9_.:-]*$/i.test(normalized)) {
    return false;
  }
  return normalized.length > 0;
}

function everyCssVarHasFallback(value: string): boolean {
  let index = 0;
  while ((index = value.toLowerCase().indexOf("var(", index)) >= 0) {
    let depth = 1;
    let comma = false;
    let quote: string | null = null;
    for (let cursor = index + 4; cursor < value.length; cursor += 1) {
      const char = value[cursor];
      if (quote) {
        if (char === quote && value[cursor - 1] !== "\\") quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          if (!comma) return false;
          index = cursor + 1;
          break;
        }
      } else if (char === "," && depth === 1) {
        comma = true;
      }
      if (cursor === value.length - 1 && depth > 0) return false;
    }
  }
  return true;
}

function unsafeCssMessage(property: string, value: string, inline: boolean): string | null {
  const normalized = decodeEntitiesForValidation(value).toLowerCase();
  if (normalized.includes("javascript:") || normalized.includes("expression(")) {
    return "Executable CSS values are not allowed.";
  }
  if (property === "position" && /(^|\s)fixed($|\s)/i.test(value)) {
    return "position: fixed is not allowed in a Button skin.";
  }
  if (/url\s*\(/i.test(value)) {
    const urls = [...value.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)];
    if (urls.length === 0 || urls.some((match) => !/^#[a-z_][a-z0-9_.:-]*$/i.test(match[2]))) {
      return "Only fragment-local url(#id) references are allowed.";
    }
  }
  if (inline && (property === "animation" || property.startsWith("animation-"))) {
    return "Inline animation declarations are not allowed; use data-anim and a state section.";
  }
  if (!everyCssVarHasFallback(value)) {
    return "Every CSS var() reference must include a fallback value.";
  }
  return null;
}

function validateInlineStyle(value: string, diagnostics: ButtonSkinDiagnostic[]): void {
  const parsed = parseCssDeclarations(value);
  if (!parsed.ok) {
    parsed.errors.forEach((error) => diagnostics.push({ section: "structure", message: error.message, offset: error.offset }));
    return;
  }
  for (const declaration of parsed.declarations) {
    const message = unsafeCssMessage(declaration.property, declaration.value, true);
    if (message) diagnostics.push({ section: "structure", message });
  }
}

function validateStructure(source: string, diagnostics: ButtonSkinDiagnostic[]): ButtonSkinAnalysis | null {
  const tokenCount = countOccurrences(source, BUTTON_SKIN_LABEL_TOKEN);
  if (tokenCount !== 1) {
    diagnostics.push({ section: "structure", message: "Structure must contain exactly one {{label}} token." });
  }
  const stack: Array<{ name: string; core: boolean }> = [];
  const animationTokens = new Set<string>();
  let labelInsideCore = false;
  let coreCount = 0;
  let coreTagName = "";
  let index = 0;

  while (index < source.length) {
    const tagStart = source.indexOf("<", index);
    const textEnd = tagStart < 0 ? source.length : tagStart;
    const text = source.slice(index, textEnd);
    if (text.includes(BUTTON_SKIN_LABEL_TOKEN) && stack.some((entry) => entry.core)) {
      labelInsideCore = true;
    }
    if (tagStart < 0) break;
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) {
        diagnostics.push({ section: "structure", message: "Structure contains an unterminated comment.", offset: tagStart });
        break;
      }
      index = commentEnd + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = source.indexOf("]]>", tagStart + 9);
      if (cdataEnd < 0) {
        diagnostics.push({ section: "structure", message: "Structure contains unterminated CDATA.", offset: tagStart });
        break;
      }
      const cdata = source.slice(tagStart + 9, cdataEnd);
      if (cdata.includes(BUTTON_SKIN_LABEL_TOKEN) && stack.some((entry) => entry.core)) labelInsideCore = true;
      index = cdataEnd + 3;
      continue;
    }
    if (source.startsWith("<!", tagStart) || source.startsWith("<?", tagStart)) {
      diagnostics.push({ section: "structure", message: "Doctype and processing instructions are not allowed.", offset: tagStart });
      const forbiddenEnd = findTagEnd(source, tagStart + 1);
      index = forbiddenEnd < 0 ? source.length : forbiddenEnd + 1;
      continue;
    }
    const tagEnd = findTagEnd(source, tagStart + 1);
    if (tagEnd < 0) {
      diagnostics.push({ section: "structure", message: "Structure contains an unterminated tag.", offset: tagStart });
      break;
    }
    const parsed = parseMarkupTag(source.slice(tagStart + 1, tagEnd));
    if (!parsed.tag) {
      diagnostics.push({ section: "structure", message: parsed.error ?? "Malformed markup.", offset: tagStart });
      index = tagEnd + 1;
      continue;
    }
    const tag = parsed.tag;
    if (tag.closing) {
      const current = stack.pop();
      if (!current || current.name !== tag.name) {
        diagnostics.push({ section: "structure", message: `Closing tag '${tag.name}' does not match the open structure.`, offset: tagStart });
      }
      index = tagEnd + 1;
      continue;
    }
    if (FORBIDDEN_TAGS.has(tag.name)) {
      diagnostics.push({ section: "structure", message: `<${tag.name}> is not allowed in a Button skin.`, offset: tagStart });
    }
    let isCore = false;
    for (const attribute of tag.attributes) {
      const value = attribute.value ?? "";
      if (attribute.name === "data-core") {
        coreCount += 1;
        isCore = true;
        coreTagName = tag.name;
      }
      if (attribute.name.startsWith("on")) {
        diagnostics.push({ section: "structure", message: `Event handler attribute '${attribute.name}' is not allowed.`, offset: tagStart });
      }
      if (attribute.name === "is") {
        diagnostics.push({ section: "structure", message: "Customized built-in elements are not allowed.", offset: tagStart });
      }
      if (attribute.name === "style") {
        validateInlineStyle(value, diagnostics);
      }
      if (attribute.name === "data-anim") {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
          diagnostics.push({ section: "structure", message: "data-anim tokens may contain only lowercase letters, numbers, and hyphens.", offset: tagStart });
        } else if (animationTokens.has(value)) {
          diagnostics.push({ section: "structure", message: `Animation token '${value}' must identify only one element.`, offset: tagStart });
        } else {
          animationTokens.add(value);
        }
      }
      if (URL_ATTRIBUTES.has(attribute.name) && hasUnsafeUrl(value, attribute.name === "href" || attribute.name === "xlink:href")) {
        diagnostics.push({ section: "structure", message: `External or executable '${attribute.name}' values are not allowed.`, offset: tagStart });
      }
    }
    if (!tag.selfClosing && !VOID_HTML_TAGS.has(tag.name)) {
      stack.push({ name: tag.name, core: isCore || stack.some((entry) => entry.core) });
    }
    index = tagEnd + 1;
  }

  if (stack.length > 0) {
    diagnostics.push({ section: "structure", message: `Structure has an unclosed <${stack[stack.length - 1].name}> element.` });
  }
  if (coreCount !== 1) {
    diagnostics.push({ section: "structure", message: "Structure must contain exactly one data-core element." });
  }
  if (tokenCount === 1 && !labelInsideCore) {
    diagnostics.push({ section: "structure", message: "The {{label}} token must be text inside the data-core element." });
  }
  return coreCount === 1 && tokenCount === 1 && labelInsideCore
    ? { animationTokens: [...animationTokens], keyframeNames: [], coreTagName }
    : null;
}

function serializeSanitizedAttribute(attribute: MarkupAttribute): string {
  if (attribute.value === null) return attribute.sourceName;
  const escaped = attribute.value.replace(/"/g, "&quot;").replace(/\u0000/g, "\ufffd");
  return `${attribute.sourceName}="${escaped}"`;
}

export interface SanitizedButtonSkinStructure {
  markup: string;
  /**
   * The data-core element's authored inline style, lifted out of the markup so
   * the compiler can emit it as a lowest-priority `[data-core]` rule. Inline it
   * would defeat every state-section declaration targeting the core.
   */
  coreInlineStyle: string | null;
}

/**
 * Re-parses validated authored markup into a deterministic render template.
 * Authored source remains untouched in Button state; only this representation
 * is passed to innerHTML by the production renderer.
 */
export function sanitizeButtonSkinStructure(source: string): SanitizedButtonSkinStructure {
  const diagnostics: ButtonSkinDiagnostic[] = [];
  validateStructure(source, diagnostics);
  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }

  let output = "";
  let coreInlineStyle: string | null = null;
  let index = 0;
  while (index < source.length) {
    const tagStart = source.indexOf("<", index);
    if (tagStart < 0) {
      output += source.slice(index);
      break;
    }
    output += source.slice(index, tagStart);
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      if (commentEnd < 0) throw new Error("Structure contains an unterminated comment.");
      index = commentEnd + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = source.indexOf("]]>", tagStart + 9);
      if (cdataEnd < 0) throw new Error("Structure contains unterminated CDATA.");
      output += `<![CDATA[${source.slice(tagStart + 9, cdataEnd)}]]>`;
      index = cdataEnd + 3;
      continue;
    }
    const tagEnd = findTagEnd(source, tagStart + 1);
    if (tagEnd < 0) throw new Error("Structure contains an unterminated tag.");
    const parsed = parseMarkupTag(source.slice(tagStart + 1, tagEnd));
    if (!parsed.tag) throw new Error(parsed.error ?? "Malformed markup.");
    const tag = parsed.tag;
    if (tag.closing) {
      output += `</${tag.sourceName}>`;
    } else {
      const isCore = tag.attributes.some((attribute) => attribute.name === "data-core");
      let serializedAttributes = tag.attributes;
      if (isCore) {
        const style = tag.attributes.find((attribute) => attribute.name === "style");
        if (style?.value?.trim()) {
          coreInlineStyle = decodeEntitiesForValidation(style.value);
        }
        serializedAttributes = tag.attributes.filter((attribute) => attribute.name !== "style");
      }
      const attributes = serializedAttributes.map(serializeSanitizedAttribute).join(" ");
      const opening = `<${tag.sourceName}${attributes ? ` ${attributes}` : ""}`;
      if (VOID_HTML_TAGS.has(tag.name)) {
        output += `${opening}>`;
      } else if (tag.selfClosing) {
        output += `${opening}></${tag.sourceName}>`;
      } else {
        output += `${opening}>`;
      }
    }
    index = tagEnd + 1;
  }
  return { markup: output, coreInlineStyle };
}

function validateStateSection(
  section: ButtonSkinStateSectionName,
  source: string,
  animationTokens: ReadonlySet<string>,
  diagnostics: ButtonSkinDiagnostic[]
): void {
  if (!source.trim()) return;
  const parsed = parseCssDeclarations(source);
  if (!parsed.ok) {
    parsed.errors.forEach((error) => diagnostics.push({ section, message: error.message, offset: error.offset }));
    return;
  }
  for (const declaration of parsed.declarations) {
    const message = unsafeCssMessage(declaration.property, declaration.value, false);
    if (message) diagnostics.push({ section, message });
    if (declaration.property.startsWith("--anim-")) {
      const token = declaration.property.slice("--anim-".length);
      if (section === "base") {
        diagnostics.push({ section, message: "Animations cannot run unconditionally from Base." });
      }
      if (!animationTokens.has(token)) {
        diagnostics.push({ section, message: `Animation declaration references missing data-anim token '${token}'.` });
      }
      if (/\bvar\s*\(/i.test(declaration.value)) {
        diagnostics.push({ section, message: "Animation shorthands cannot use var()." });
      }
      if (section === "play" && /\binfinite\b/i.test(declaration.value)) {
        diagnostics.push({ section, message: "Play animations must finish and cannot use infinite iteration." });
      }
    } else if (declaration.property === "animation" || declaration.property.startsWith("animation-")) {
      diagnostics.push({ section, message: "Use --anim-token declarations instead of direct animation properties." });
    }
  }
}

export function validateButtonSkin(source: ButtonSkinSectionSource): ButtonSkinValidationResult {
  const diagnostics: ButtonSkinDiagnostic[] = [];
  if (!source.structure.trim()) {
    diagnostics.push({ section: "structure", message: "Structure is required." });
  }
  const analysis = validateStructure(source.structure, diagnostics);
  const animationTokens = new Set(analysis?.animationTokens ?? []);
  for (const section of BUTTON_SKIN_STATE_SECTIONS) {
    validateStateSection(section, source[section], animationTokens, diagnostics);
  }

  const keyframes = parseCssKeyframes(source.keyframes);
  if (!keyframes.ok) {
    keyframes.errors.forEach((error) => diagnostics.push({ section: "keyframes", message: error.message, offset: error.offset }));
  } else {
    const names = new Set<string>();
    for (const block of keyframes.blocks) {
      if (names.has(block.name)) diagnostics.push({ section: "keyframes", message: `Duplicate keyframes name '${block.name}'.` });
      names.add(block.name);
      const normalized = decodeEntitiesForValidation(block.body).toLowerCase();
      if (normalized.includes("javascript:") || normalized.includes("expression(") || /url\s*\((?!\s*['"]?#)/i.test(block.body)) {
        diagnostics.push({ section: "keyframes", message: `Keyframes '${block.name}' contains an unsafe value.` });
      }
      if (/position\s*:\s*fixed/i.test(block.body)) {
        diagnostics.push({ section: "keyframes", message: "position: fixed is not allowed in keyframes." });
      }
    }
    if (analysis) analysis.keyframeNames = [...names];
  }

  return { valid: diagnostics.length === 0, diagnostics, analysis };
}
