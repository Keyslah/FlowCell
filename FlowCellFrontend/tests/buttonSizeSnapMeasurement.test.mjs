import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const renderer = readFileSync(new URL("../src/button/skins/ButtonSkinRenderer.tsx", import.meta.url), "utf8");
const start = renderer.indexOf("export function measureButtonTextSize(");
const end = renderer.indexOf("function applyTextFit(", start);
assert.ok(start >= 0 && end > start);
const source = ts.transpileModule(renderer.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

// Exact glyph advances are supplied to exercise the production measurement
// policy. These tests do not claim to measure browser fonts or rendered pixels.
function fixture({ fixedWidth, fixedHeight, minimumWidth = 0, paddingX = 24, paddingY = 12,
  svg = false, absoluteLabel = false, hasLabel = true, valid = true,
  failMount = false, invalidText = false } = {}) {
  const probes = new Set();
  const styles = [];
  let labelNode;
  const style = () => {
    const values = new Map();
    const instance = {
      setProperty(name, value) { values.set(name, value); },
      removeProperty(name) { values.delete(name); },
      get: name => values.get(name)
    };
    styles.push(instance);
    return instance;
  };
  const textSize = () => {
    const font = labelNode.fontSize ?? 16;
    return {
      width: invalidText ? NaN : [...labelNode.text].reduce((sum, char) => sum + (char === "W" ? 12 : 4), 0) * font / 16,
      height: 20 * font / 16
    };
  };
  const box = {
    exports: {},
    compileButtonSkin: () => valid ? { ok: true, compiled: { hasLabelToken: hasLabel } } : { ok: false },
    document: {
      body: { append: host => probes.add(host) },
      createElement() {
        return {
          style: style(),
          attachShadow: () => ({}),
          setAttribute() {},
          remove() { probes.delete(this); }
        };
      }
    },
    mountCompiledSkin() {
      if (failMount) throw new Error("broken mount");
      labelNode = { style: style(), text: "", fontSize: undefined };
      const coreStyle = {
        setProperty() { assert.fail("Size snap must not override the skin's native dimensions"); },
        removeProperty() { assert.fail("Size snap must not remove the skin's native dimensions"); }
      };
      return { core: { style: coreStyle, svg }, container: {}, labelNode };
    },
    applyLabelLines(node, lines, fontSize) {
      assert.equal(lines.length, 1);
      node.text = lines[0];
      node.fontSize = fontSize;
    },
    isSvgElement: core => core.svg,
    readMeasurement() {
      const text = textSize();
      return {
        width: fixedWidth ?? (absoluteLabel ? 0 : Math.max(minimumWidth, text.width + paddingX)),
        height: fixedHeight ?? text.height + paddingY
      };
    },
    readLabelTextMeasurement: () => textSize()
  };
  vm.runInNewContext(source, box);
  return { measure: box.exports.measureButtonTextSize, probes, styles, box, labelNode: () => labelNode };
}

test("Size snap uses each label's measured width plus authored padding", () => {
  const { measure, probes } = fixture();
  const skin = { structure: "unchanged artwork" };
  const original = structuredClone(skin);
  assert.deepEqual(JSON.parse(JSON.stringify(measure(skin, "iii"))), {
    status: "sized", width: 36, height: 32
  });
  assert.equal(measure(skin, "WWW").width, 60);
  assert.deepEqual(skin, original);
  assert.equal(probes.size, 0);
});

test("fixed HTML widths are skipped for both short and overflowing labels", () => {
  const { measure } = fixture({ fixedWidth: 50, fixedHeight: 36 });
  const short = measure({}, "ii");
  const long = measure({}, "WWWWWW");
  assert.equal(short.status, "skipped");
  assert.equal(long.status, "skipped");
  assert.equal("width" in short, false);
  assert.equal("width" in long, false);
});

test("a fixed authored height does not block text-responsive width measurement", () => {
  const { measure } = fixture({ fixedHeight: 36 });
  const result = measure({}, "WW", 16);
  assert.equal(result.status, "sized");
  assert.equal(result.width, 48);
  assert.equal(result.height, 36);
});

test("authored height constraints skip overflowing text without forcing a new height", () => {
  const { measure, probes } = fixture({ fixedHeight: 24 });
  const result = measure({}, "WW", 32);
  assert.equal(result.status, "skipped");
  assert.equal("height" in result, false);
  assert.equal(probes.size, 0);
});

test("fixed artwork variants are skipped rather than resized", () => {
  const { measure } = fixture({ fixedWidth: 108, fixedHeight: 37, absoluteLabel: true });
  const result = measure({}, "WWW");
  assert.equal(result.status, "skipped");
  assert.equal("width" in result, false);
});

test("fixed SVG widths are skipped even when the label fits", () => {
  const { measure } = fixture({ fixedWidth: 50, fixedHeight: 32, svg: true });
  assert.equal(measure({}, "WW").status, "skipped");
  assert.equal(measure({}, "WWWWW").status, "skipped");
});

test("textless and blank buttons are skipped without creating a probe", () => {
  for (const [options, label] of [[{ hasLabel: false }, "Icon"], [{}, "  "]]) {
    const { measure, probes, styles } = fixture(options);
    assert.equal(measure({}, label).status, "skipped");
    assert.equal(probes.size, 0);
    assert.equal(styles.length, 0);
  }
});

test("invalid core and failed measurements never guess dimensions", () => {
  for (const options of [
    { absoluteLabel: true },
    { invalidText: true }, { valid: false }, { failMount: true }
  ]) {
    const { measure, probes } = fixture(options);
    const result = measure({}, "Label");
    assert.equal(result.status, "failed");
    assert.equal("width" in result, false);
    assert.equal(probes.size, 0);
  }
});

test("authored minimum width survives probing and the original label is restored", () => {
  const { measure, labelNode } = fixture({ minimumWidth: 150 });
  const result = measure({}, "i");
  assert.equal(result.status, "sized");
  assert.equal(result.width, 150);
  assert.equal(labelNode().text, "i");
});

test("each invocation uses fresh label and font values", () => {
  const { measure } = fixture();
  assert.equal(measure({}, "ii", 16).width, 32);
  assert.equal(measure({}, "WW", 16).width, 48);
  assert.equal(measure({}, "WW", 32).width, 72);
});

test("measurement fails explicitly without a DOM", () => {
  const { measure, box } = fixture();
  delete box.document;
  assert.equal(measure({}, "Label").status, "failed");
});
