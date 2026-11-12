import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const renderer = readFileSync(new URL("../src/button/skins/ButtonSkinRenderer.tsx", import.meta.url), "utf8");
const textFit = readFileSync(new URL("../src/button/text/textFit.ts", import.meta.url), "utf8");
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText;

// These deterministic glyph measurements exercise fitting policy only. They do
// not assert actual browser font metrics or the screenshot's rendered font size.
function fixture({
  ratio = 1,
  svg = false,
  width = 76.64803072980384,
  height = 36.54620361328125,
  naturalWidth = 44,
  padded = true
} = {}) {
  const core = {
    clientWidth: width, clientHeight: height, parentElement: null,
    getBoundingClientRect: () => ({ width: width * ratio, height: height * ratio }),
    css: { width: `${width}px`, height: `${height}px`, boxSizing: "border-box" }
  };
  const carrier = {
    parentElement: core,
    getBoundingClientRect: core.getBoundingClientRect,
    css: {
      ...core.css,
      paddingLeft: padded ? "24px" : "0px", paddingRight: padded ? "24px" : "0px",
      paddingTop: padded ? "16px" : "0px", paddingBottom: padded ? "16px" : "0px"
    }
  };
  const labelNode = {
    parentElement: carrier, svg, lines: [], fontSize: 16,
    style: { setProperty() {} }, css: { fontSize: "16px" }
  };
  const box = {
    exports: {},
    getComputedStyle: node => node.css,
    isSvgElement: node => Boolean(node.svg),
    applyLabelLines(node, lines, fontSize) { node.lines = [...lines]; node.fontSize = fontSize ?? 16; },
    readLabelTextMeasurement: node => ({
      width: naturalWidth * node.fontSize / 16 * ratio,
      height: 19 * node.fontSize / 16 * ratio
    })
  };
  vm.runInNewContext(transpile(textFit), box);
  Object.assign(box, box.exports);
  const fitStart = renderer.indexOf("function applyTextFit(");
  const insetStart = renderer.indexOf("function readLabelFitSize(");
  // Include the former helper when checking the regression against old source,
  // so it fails on the shrunken label rather than an unresolved dependency.
  const start = insetStart >= 0 ? insetStart : fitStart;
  const end = renderer.indexOf("function applyTextAlignment(", start);
  assert.ok(fitStart >= 0 && start >= 0 && end > fitStart);
  vm.runInNewContext(transpile(renderer.slice(start, end) +
    "\nglobalThis.fit = applyTextFit;"), box);
  return { box, mounted: { core, labelNode }, labelNode };
}

for (const ratio of [1, 1.05, 1.575]) {
  test(`compact pill padding does not shrink a fitting label at WebView ratio ${ratio}`, () => {
    const { box, mounted, labelNode } = fixture({ ratio });
    const overflow = box.fit(mounted, "Group", "shrink", 8, true);
    assert.equal(labelNode.fontSize, 16, "the label fits the full semantic core at its authored size");
    assert.equal(overflow, false);
    assert.deepEqual(labelNode.lines, ["Group"]);
  });
}

test("a narrow padded Rotate pill keeps a short label at its authored size", () => {
  const { box, mounted, labelNode } = fixture({ width: 49, height: 41, naturalWidth: 32 });
  const overflow = box.fit(mounted, "270", "shrink", 8, true);
  assert.equal(labelNode.fontSize, 16);
  assert.equal(overflow, false);
});

test("a long Collections label shrinks only enough to fit the full core", () => {
  const { box, mounted, labelNode } = fixture({ width: 92.25982793135026, height: 44, naturalWidth: 128 });
  const overflow = box.fit(mounted, "Make Collections", "shrink", 8, true);
  assert.equal(labelNode.fontSize, 11.5, "the fixture's 128 CSS px label fits at 92 CSS px without reaching its minimum");
  assert.equal(overflow, false);
  assert.deepEqual(labelNode.lines, ["Make Collections"]);
});

for (const svg of [false, true]) {
  test(`${svg ? "SVG" : "unpadded HTML"} fitting retains the full semantic core`, () => {
    const { box, mounted, labelNode } = fixture({ ratio: 1.05, svg, padded: false });
    assert.equal(box.fit(mounted, "Group", "shrink", 8, true), false);
    assert.equal(labelNode.fontSize, 16);
  });
}

test("a fitting explicit font size survives padded skin fitting", () => {
  const { box, mounted, labelNode } = fixture();
  const overflow = box.fit(mounted, "Group", "shrink", 8, true, 20);
  assert.equal(labelNode.fontSize, 20);
  assert.equal(overflow, false);
});

test("actual core overflow still honors the saved minimum and reports overflow", () => {
  const { box, mounted, labelNode } = fixture({ width: 40, height: 44, naturalWidth: 128 });
  assert.equal(box.fit(mounted, "Make Collections", "shrink", 8, true), true);
  assert.equal(labelNode.fontSize, 8);
});
