import type { ButtonSkinSectionName } from "../types.js";
import {
  isButtonSkinSectionName,
  type ButtonSkinSectionSource
} from "./buttonSkinFormat.js";

export interface ParsedButtonSkinPaste {
  ok: true;
  sections: Partial<ButtonSkinSectionSource>;
  presentSections: ButtonSkinSectionName[];
}

export interface InvalidButtonSkinPaste {
  ok: false;
  message: string;
  line?: number;
}

export type ButtonSkinPasteResult = ParsedButtonSkinPaste | InvalidButtonSkinPaste;

interface HeaderMatch {
  section: ButtonSkinSectionName;
  line: number;
  headerStart: number;
  bodyStart: number;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineEnd(source: string, start: number): number {
  const newline = source.indexOf("\n", start);
  return newline < 0 ? source.length : newline;
}

function bodyStartAfterHeader(source: string, end: number): number {
  return end < source.length && source[end] === "\n" ? end + 1 : end;
}

const HEADER_LINE_PATTERN = /^={3,}\s*([A-Za-z][A-Za-z-]*)\s*={3,}$/;

export function parseButtonSkinPaste(source: string): ButtonSkinPasteResult {
  if (!source) {
    return { ok: false, message: "Paste Skin is empty." };
  }

  const starts = lineStarts(source);
  const headers: HeaderMatch[] = [];
  const seen = new Set<ButtonSkinSectionName>();
  let firstNonemptyLine = -1;

  for (let lineIndex = 0; lineIndex < starts.length; lineIndex += 1) {
    const start = starts[lineIndex];
    const end = lineEnd(source, start);
    const trimmed = source.slice(start, end).replace(/\r$/, "").trim();
    if (firstNonemptyLine < 0 && trimmed.length > 0) {
      firstNonemptyLine = lineIndex;
    }
    const headerMatch = HEADER_LINE_PATTERN.exec(trimmed);
    const headerName = headerMatch?.[1].toLowerCase();
    if (headerName && isButtonSkinSectionName(headerName)) {
      if (seen.has(headerName)) {
        return {
          ok: false,
          message: `Duplicate skin section '${headerName}'.`,
          line: lineIndex + 1
        };
      }
      seen.add(headerName);
      headers.push({
        section: headerName,
        line: lineIndex + 1,
        headerStart: start,
        bodyStart: bodyStartAfterHeader(source, end)
      });
      continue;
    }

    if (trimmed.startsWith("===") || trimmed.endsWith("===")) {
      const possibleName = trimmed.replace(/^=+\s*/, "").replace(/\s*=+$/, "");
      if (isButtonSkinSectionName(possibleName.toLowerCase()) || /^=+/.test(trimmed)) {
        return {
          ok: false,
          message: "Unrecognized skin section header. Use '=== <section> ===' with a known section name.",
          line: lineIndex + 1
        };
      }
    }
  }

  if (headers.length === 0) {
    return { ok: false, message: "Paste Skin contains no recognized section headers." };
  }
  if (firstNonemptyLine !== headers[0].line - 1) {
    return {
      ok: false,
      message: "Paste Skin cannot contain content before the first section header.",
      line: firstNonemptyLine + 1
    };
  }

  const sections: Partial<ButtonSkinSectionSource> = {};
  headers.forEach((header, index) => {
    const nextHeaderStart = headers[index + 1]?.headerStart ?? source.length;
    let bodyEnd = nextHeaderStart;
    if (bodyEnd > header.bodyStart && source[bodyEnd - 1] === "\n") {
      bodyEnd -= 1;
      if (bodyEnd > header.bodyStart && source[bodyEnd - 1] === "\r") {
        bodyEnd -= 1;
      }
    }
    sections[header.section] = source.slice(header.bodyStart, bodyEnd);
  });

  return {
    ok: true,
    sections,
    presentSections: headers.map((header) => header.section)
  };
}

export function applyNamedButtonSkinSections(
  current: ButtonSkinSectionSource,
  parsed: ParsedButtonSkinPaste
): ButtonSkinSectionSource {
  const next = { ...current };
  for (const section of parsed.presentSections) {
    next[section] = parsed.sections[section] ?? "";
  }
  return next;
}
