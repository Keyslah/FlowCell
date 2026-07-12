export interface CssDeclaration {
  property: string;
  value: string;
  source: string;
}

export interface CssParseError {
  message: string;
  offset: number;
}

export type CssDeclarationParseResult =
  | { ok: true; declarations: CssDeclaration[] }
  | { ok: false; errors: CssParseError[] };

export interface CssKeyframeBlock {
  prefix: "@keyframes" | "@-webkit-keyframes";
  name: string;
  body: string;
  source: string;
}

export type CssKeyframeParseResult =
  | { ok: true; blocks: CssKeyframeBlock[] }
  | { ok: false; errors: CssParseError[] };

interface ScannerState {
  quote: "'" | '"' | null;
  escaped: boolean;
  comment: boolean;
  parentheses: number;
}

function createScannerState(): ScannerState {
  return { quote: null, escaped: false, comment: false, parentheses: 0 };
}

function stepScanner(source: string, index: number, state: ScannerState): number {
  const char = source[index];
  const next = source[index + 1];
  if (state.comment) {
    if (char === "*" && next === "/") {
      state.comment = false;
      return index + 1;
    }
    return index;
  }
  if (state.quote) {
    if (state.escaped) {
      state.escaped = false;
    } else if (char === "\\") {
      state.escaped = true;
    } else if (char === state.quote) {
      state.quote = null;
    }
    return index;
  }
  if (char === "/" && next === "*") {
    state.comment = true;
    return index + 1;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
  } else if (char === "(") {
    state.parentheses += 1;
  } else if (char === ")") {
    state.parentheses -= 1;
  }
  return index;
}

function findTopLevelColon(source: string): number {
  const state = createScannerState();
  for (let index = 0; index < source.length; index += 1) {
    const before = { ...state };
    index = stepScanner(source, index, state);
    if (!before.quote && !before.comment && before.parentheses === 0 && source[index] === ":") {
      return index;
    }
  }
  return -1;
}

export function parseCssDeclarations(source: string): CssDeclarationParseResult {
  const errors: CssParseError[] = [];
  const chunks: Array<{ source: string; offset: number }> = [];
  const state = createScannerState();
  let chunkStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    const wasTopLevel = !state.quote && !state.comment && state.parentheses === 0;
    const originalIndex = index;
    index = stepScanner(source, index, state);
    const char = source[originalIndex];
    if (wasTopLevel && (char === "{" || char === "}" || char === "@" || char === "<" || char === ">")) {
      errors.push({ message: `Unexpected '${char}' in a CSS declaration section.`, offset: originalIndex });
    }
    if (wasTopLevel && char === ";") {
      chunks.push({ source: source.slice(chunkStart, originalIndex), offset: chunkStart });
      chunkStart = originalIndex + 1;
    }
  }
  chunks.push({ source: source.slice(chunkStart), offset: chunkStart });

  if (state.quote) {
    errors.push({ message: "Unterminated CSS string.", offset: source.length });
  }
  if (state.comment) {
    errors.push({ message: "Unterminated CSS comment.", offset: source.length });
  }
  if (state.parentheses !== 0) {
    errors.push({ message: "Unbalanced CSS parentheses.", offset: source.length });
  }

  const declarations: CssDeclaration[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.source.trim();
    if (!trimmed) {
      continue;
    }
    const colon = findTopLevelColon(trimmed);
    if (colon <= 0) {
      errors.push({ message: "CSS declarations require a property and value.", offset: chunk.offset });
      continue;
    }
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (!/^--[a-z0-9_-]+$/.test(property) && !/^-?[a-z][a-z0-9-]*$/.test(property)) {
      errors.push({ message: `Invalid CSS property '${property}'.`, offset: chunk.offset });
      continue;
    }
    if (!value) {
      errors.push({ message: `CSS property '${property}' has no value.`, offset: chunk.offset });
      continue;
    }
    declarations.push({ property, value, source: trimmed });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, declarations };
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      return end < 0 ? source.length : skipWhitespaceAndComments(source, end + 2);
    }
    break;
  }
  return index;
}

function findClosingBrace(source: string, openingBrace: number): number {
  let depth = 0;
  const state = createScannerState();
  for (let index = openingBrace; index < source.length; index += 1) {
    const topLevel = !state.quote && !state.comment;
    const char = source[index];
    index = stepScanner(source, index, state);
    if (!topLevel) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

export function parseCssKeyframes(source: string): CssKeyframeParseResult {
  const blocks: CssKeyframeBlock[] = [];
  const errors: CssParseError[] = [];
  let index = 0;
  while (index < source.length) {
    index = skipWhitespaceAndComments(source, index);
    if (index >= source.length) {
      break;
    }
    const prefix = source.startsWith("@-webkit-keyframes", index)
      ? "@-webkit-keyframes"
      : source.startsWith("@keyframes", index)
        ? "@keyframes"
        : null;
    if (!prefix) {
      errors.push({ message: "The keyframes section may contain only @keyframes blocks.", offset: index });
      break;
    }
    const blockStart = index;
    index += prefix.length;
    index = skipWhitespaceAndComments(source, index);
    const nameMatch = /^[a-zA-Z_][a-zA-Z0-9_-]*/.exec(source.slice(index));
    if (!nameMatch) {
      errors.push({ message: "A keyframes block is missing a valid name.", offset: index });
      break;
    }
    const name = nameMatch[0];
    index += name.length;
    index = skipWhitespaceAndComments(source, index);
    if (source[index] !== "{") {
      errors.push({ message: `Keyframes '${name}' is missing its opening brace.`, offset: index });
      break;
    }
    const closingBrace = findClosingBrace(source, index);
    if (closingBrace < 0) {
      errors.push({ message: `Keyframes '${name}' has unbalanced braces.`, offset: index });
      break;
    }
    blocks.push({
      prefix,
      name,
      body: source.slice(index + 1, closingBrace),
      source: source.slice(blockStart, closingBrace + 1)
    });
    index = closingBrace + 1;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, blocks };
}

export function replaceCssIdentifier(source: string, identifier: string, replacement: string): string {
  return source.replace(new RegExp(`(^|[^a-zA-Z0-9_-])${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-zA-Z0-9_-])`, "g"), `$1${replacement}`);
}

export function fingerprintButtonSkinSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

