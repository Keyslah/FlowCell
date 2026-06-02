export const IMPORTED_SKIN_LABEL_PLACEHOLDER = "{{label}}";

export type ParsedSvgHitbox = {
  viewBox: string;
  width: number;
  height: number;
  content: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function sanitizeMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

export function renderImportedTemplate(markup: string, label: string): string {
  return sanitizeMarkup(markup).replace(/\{\{label\}\}/g, escapeHtml(label));
}

function scopeCssSelector(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(from|to|\d+%)$/i.test(trimmed)) {
    return trimmed;
  }

  const replacedRoot = trimmed.replace(/\bhtml\b|\bbody\b|:root/g, scopeSelector);
  if (replacedRoot.includes(scopeSelector)) {
    return replacedRoot;
  }
  if (/^[>+~]/.test(replacedRoot)) {
    return `${scopeSelector}${replacedRoot}`;
  }
  return `${scopeSelector} ${replacedRoot}`;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return source.length - 1;
}

export function scopeImportedCssRules(source: string, scopeSelector: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const openBraceIndex = source.indexOf("{", cursor);
    if (openBraceIndex < 0) {
      output += source.slice(cursor);
      break;
    }

    const prelude = source.slice(cursor, openBraceIndex);
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    const blockContent = source.slice(openBraceIndex + 1, closeBraceIndex);
    const trimmedPrelude = prelude.trim();

    if (!trimmedPrelude) {
      output += `${prelude}{${blockContent}}`;
      cursor = closeBraceIndex + 1;
      continue;
    }

    if (trimmedPrelude.startsWith("@")) {
      const atRuleName = trimmedPrelude
        .slice(1)
        .split(/[\s{]/, 1)[0]
        .toLowerCase();
      if (["media", "supports", "layer", "container", "document"].includes(atRuleName)) {
        output += `${prelude}{${scopeImportedCssRules(blockContent, scopeSelector)}}`;
      } else {
        output += `${prelude}{${blockContent}}`;
      }
      cursor = closeBraceIndex + 1;
      continue;
    }

    const scopedPrelude = prelude
      .split(",")
      .map((selector) => scopeCssSelector(selector, scopeSelector))
      .join(", ");
    output += `${scopedPrelude}{${blockContent}}`;
    cursor = closeBraceIndex + 1;
  }

  return output;
}

export function normalizeImportedSkinHtmlMarkup(markup: string): string {
  if (typeof document === "undefined") {
    return markup;
  }

  const template = document.createElement("template");
  template.innerHTML = markup;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const textContent = current.textContent ?? "";
    if (!textContent.trim()) {
      continue;
    }
    current.textContent = textContent.replace(textContent.trim(), IMPORTED_SKIN_LABEL_PLACEHOLDER);
    return template.innerHTML;
  }

  return markup;
}

export function ensureImportedSkinLabelPlaceholder(markup: string): string {
  if (!markup.trim() || markup.includes(IMPORTED_SKIN_LABEL_PLACEHOLDER)) {
    return markup;
  }

  return normalizeImportedSkinHtmlMarkup(markup);
}

function parseNumericDimension(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numericValue = Number.parseFloat(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

export function parseSvgHitbox(markup: string): ParsedSvgHitbox | null {
  const sanitizedMarkup = sanitizeMarkup(markup).trim();
  if (!sanitizedMarkup || typeof DOMParser === "undefined") {
    return null;
  }

  const documentNode = new DOMParser().parseFromString(sanitizedMarkup, "image/svg+xml");
  const svg = documentNode.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== "svg") {
    return null;
  }

  const viewBox = svg.getAttribute("viewBox")?.trim();
  let width = 100;
  let height = 100;

  if (viewBox) {
    const viewBoxParts = viewBox
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));
    if (viewBoxParts.length === 4) {
      width = viewBoxParts[2] > 0 ? viewBoxParts[2] : width;
      height = viewBoxParts[3] > 0 ? viewBoxParts[3] : height;
    }
  } else {
    width = parseNumericDimension(svg.getAttribute("width")) ?? width;
    height = parseNumericDimension(svg.getAttribute("height")) ?? height;
  }

  return {
    viewBox: viewBox || `0 0 ${width} ${height}`,
    width,
    height,
    content: svg.innerHTML
  };
}
