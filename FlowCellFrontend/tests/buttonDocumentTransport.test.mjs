import assert from "node:assert/strict";
import test from "node:test";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { packButtonDocumentTransport, unpackButtonDocumentTransport } from "./.compiled-button-system/button/state/buttonDocumentTransport.js";

const marker = "__flowcellButtonDocumentTransport";
const large = "data:image/png;base64," + "Ab12".repeat(2048);
const envelope = (document = { leaf: null }, references = [[["leaf"], 0]]) =>
  ({ [marker]: 1, document, strings: [large], references });

test("document transport pools repeated large values and round-trips nested JSON without mutation", () => {
  const input = { nested: { first: large, second: large, unique: "X".repeat(4096) },
    array: [null, large, { embedded: large }, false, 42], short: "plain", empty: "" };
  const before = structuredClone(input);
  const packed = packButtonDocumentTransport(input);
  assert.equal(packed[marker], 1);
  assert.deepEqual(packed.strings, [large, "X".repeat(4096)]);
  assert.equal(packed.references.length, 5);
  assert.equal(packed.document.array[0], null);
  assert.equal(packed.document.array[1], null);
  assert.deepEqual(input, before);
  const packedBefore = structuredClone(packed);
  assert.deepEqual(unpackButtonDocumentTransport(packed), input);
  assert.deepEqual(packed, packedBefore, "decoding never mutates the transport payload");
});

test("pooling uses UTF-8 bytes at the boundary and preserves Unicode exactly", () => {
  const input = { below: "a".repeat(4095), exact: "a".repeat(4096),
    unicodeBelow: "界".repeat(1365), unicodeAbove: "界".repeat(1366),
    emoji: "🧭".repeat(1024), escaped: "\ud800".repeat(1366) };
  const packed = packButtonDocumentTransport(input);
  assert.equal(packed.document.below, input.below);
  assert.equal(packed.document.unicodeBelow, input.unicodeBelow);
  for (const key of ["exact", "unicodeAbove", "emoji", "escaped"]) assert.equal(packed.document[key], null);
  assert.deepEqual(unpackButtonDocumentTransport(packed), input);
});

test("small documents are cloned for sending while raw received documents pass through", () => {
  const input = { nested: { a: 1, text: "small" }, entries: [null, "value"] };
  const packed = packButtonDocumentTransport(input);
  assert.deepEqual(packed, input);
  assert.notEqual(packed, input);
  assert.notEqual(packed.nested, input.nested);
  packed.entries[1] = "changed";
  assert.equal(input.entries[1], "value");
  assert.equal(unpackButtonDocumentTransport(input), input);
  assert.equal(unpackButtonDocumentTransport(null), null);
});

test("own prototype-like keys and nested markers remain data and are never pooled as keys", () => {
  const input = JSON.parse('{"__proto__":{"payload":null},"constructor":{"prototype":null},"nested":{"__flowcellButtonDocumentTransport":2}}');
  input.__proto__.payload = large;
  input.constructor.prototype = large;
  Object.defineProperty(input, large, { value: "short", enumerable: true });
  const decoded = unpackButtonDocumentTransport(packButtonDocumentTransport(input));
  assert.deepEqual(decoded, input);
  assert.equal(Object.hasOwn(decoded, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.prototype.payload, undefined);
  assert.equal(decoded[large], "short");
});

test("recognized transport rejects malformed versions, envelope shapes, tables, and references", () => {
  const invalid = [
    { [marker]: 2 }, { [marker]: 1 }, { ...envelope(), extra: true },
    { ...envelope(), document: null }, { ...envelope(), document: [] },
    { ...envelope(), strings: [42] }, { ...envelope(), strings: {} },
    { ...envelope(), strings: Array(1) },
    { ...envelope(), references: {} },
    envelope({ leaf: null }, [[[], 0]]), envelope({ leaf: null }, [[["leaf"], -1]]),
    envelope({ leaf: null }, [[["leaf"], 0.5]]), envelope({ leaf: null }, [[["leaf"], 1]]),
    envelope({ leaf: null }, [[["leaf"], "0"]]), envelope({ leaf: null }, [[[0], 0]]),
    envelope({ undefined: null }, [[Array(1), 0]]),
    envelope({ leaf: null }, [[["leaf"], Number.MAX_SAFE_INTEGER + 1]]),
    envelope({ leaf: null }, [[["leaf"], 0, "extra"]]),
    envelope({ leaf: "replace me" }), envelope({ leaf: null }, [[["missing"], 0]]),
    envelope({ leaf: null }, [[["leaf", "child"], 0]]),
    envelope({ leaf: null }, [[["leaf"], 0], [["leaf"], 0]]),
    envelope({ values: [null] }, [[["values", "length"], 0]]),
    envelope({ values: [null] }, [[["values", "01"], 0]]),
    envelope({ values: [null] }, [[["values", "1"], 0]]),
    envelope({}, [[["__proto__", "polluted"], 0]]),
    envelope({}, [[["constructor", "prototype", "polluted"], 0]])
  ];
  for (const value of invalid) assert.throws(() => unpackButtonDocumentTransport(value), /Invalid Button document transport/);
  assert.equal(Object.prototype.polluted, undefined);
});

test("a realistic canonical document retains complete skins, variants, metadata, and settings", () => {
  const document = createButtonStateDocument();
  const skin = document.skins[document.settings.defaultSkinId];
  skin.base = `background-image: url('${large}')`;
  skin.hover = skin.base;
  skin.metadata.transportFixture = { saved: { path: "C:\\Buttons\\Pop\\Design.json", images: [large, large] },
    nested: [large, null, { texture: large }] };
  const original = structuredClone(document);
  const packed = packButtonDocumentTransport(document);
  assert.equal(packed.strings.filter((value) => value === large).length, 1);
  assert.equal(packed.strings.filter((value) => value === skin.base).length, 1);
  assert.equal(new Set(packed.strings).size, packed.strings.length);
  assert.deepEqual(unpackButtonDocumentTransport(JSON.parse(JSON.stringify(packed))), JSON.parse(JSON.stringify(document)));
  assert.deepEqual(document, original);
});
