import type { ButtonStateDocument } from "../types.js";

const TRANSPORT_MARKER = "__flowcellButtonDocumentTransport";
const MIN_POOLED_STRING_BYTES = 4096;
type StringReference = [path: string[], index: number];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defineValue(target: object, key: string, value: unknown): void {
  // JSON keys such as __proto__ are data, including when rebuilding a document.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function cloneValues(
  value: unknown,
  mapString: (value: string, path: string[]) => unknown,
  path: string[] = []
): unknown {
  if (typeof value === "string") return mapString(value, path);
  if (Array.isArray(value)) {
    return value.map((entry, index) => cloneValues(entry, mapString, [...path, String(index)]));
  }
  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      defineValue(result, key, cloneValues(value[key], mapString, [...path, key]));
    }
    return result;
  }
  return value;
}

/** Pool repeated large JSON string values without changing the saved document format. */
export function packButtonDocumentTransport(document: ButtonStateDocument): unknown {
  const strings: string[] = [];
  const references: StringReference[] = [];
  const indexes = new Map<string, number>();
  const encoder = new TextEncoder();
  const packed = cloneValues(document, (value, path) => {
    // UTF-8 needs at most three bytes per UTF-16 code unit. Long strings qualify
    // directly; only short, potentially multi-byte candidates need an encoding.
    const qualifies = value.length >= MIN_POOLED_STRING_BYTES ||
      (value.length >= Math.ceil(MIN_POOLED_STRING_BYTES / 3) &&
        encoder.encode(value).byteLength >= MIN_POOLED_STRING_BYTES);
    if (!qualifies) return value;
    let index = indexes.get(value);
    if (index === undefined) {
      index = strings.length;
      indexes.set(value, index);
      strings.push(value);
    }
    references.push([path, index]);
    return null;
  });
  return references.length > 0
    ? { [TRANSPORT_MARKER]: 1, document: packed, strings, references }
    : packed;
}

/** Accept ordinary documents and strictly validate the reserved transport envelope. */
export function unpackButtonDocumentTransport(value: unknown): unknown {
  if (!isObject(value) || !Object.hasOwn(value, TRANSPORT_MARKER)) return value;
  const fail = (): never => { throw new Error("Invalid Button document transport."); };
  const keys = Object.keys(value);
  if (value[TRANSPORT_MARKER] !== 1 || keys.length !== 4 ||
      ![TRANSPORT_MARKER, "document", "strings", "references"].every((key) => Object.hasOwn(value, key)) ||
      !isObject(value.document) || !Array.isArray(value.strings) || !Array.isArray(value.references) ||
      !Array.from(value.strings).every((entry) => typeof entry === "string")) fail();

  const strings = value.strings as string[];
  const references = value.references as unknown[];
  const document = cloneValues(value.document, (entry) => entry) as Record<string, unknown>;
  for (const reference of references) {
    if (!Array.isArray(reference) || reference.length !== 2 || !Array.isArray(reference[0]) ||
        reference[0].length === 0 || !Array.from(reference[0]).every((key: unknown) => typeof key === "string") ||
        !Number.isSafeInteger(reference[1]) || reference[1] < 0 || reference[1] >= strings.length) fail();
    const [path, index] = reference as StringReference;
    let target: unknown = document;
    for (let depth = 0; depth < path.length; depth += 1) {
      const key = path[depth];
      if ((!isObject(target) && !Array.isArray(target)) || !Object.hasOwn(target, key)) fail();
      if (Array.isArray(target) && (!/^(0|[1-9]\d*)$/.test(key) ||
          !Number.isSafeInteger(Number(key)) || Number(key) >= target.length)) fail();
      const container = target as Record<string, unknown>;
      if (depth === path.length - 1) {
        if (container[key] !== null) fail();
        defineValue(container, key, strings[index]);
      } else {
        target = container[key];
      }
    }
  }
  return document;
}
