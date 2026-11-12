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

function fixture(ratio = 1, svg = false) {
  const core = {
    clientWidth: 72, clientHeight: 37.295, parentElement: null,
    getBoundingClientRect: () => ({ width: 72 * ratio, height: 37.295 * ratio }),
    css: { width: "72px", height: "37.295px", boxSizing: "border-box" }
  };
  const carrier = {
    parentElement: core,
    getBoundingClientRect: core.getBoundingClientRect,
    css: { ...core.css, paddingLeft: "7px", paddingRight: "7px" }
  };
  const labelNode = {
    parentElement: carrier, svg, lines: [], fontSize: 15,
    style: { setProperty() {} }, css: { fontSize: "15px" }
  };
  const box = {
    exports: {},
    getComputedStyle: node => node.css,
    isSvgElement: node => Boolean(node.svg),
    applyLabelLines(node, lines, fontSize) { node.lines = [...lines]; node.fontSize = fontSize ?? 15; },
    readLabelTextMeasurement: node => ({
      width: 64 * node.fontSize / 15 * ratio,
      height: 18 * node.fontSize / 15 * ratio
    })
  };
  vm.runInNewContext(transpile(textFit), box);
  Object.assign(box, box.exports);
  const start = renderer.indexOf("function readLabelFitSize(");
  const end = renderer.indexOf("function applyTextAlignment(", start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(transpile(renderer.slice(start, end) +
    "\nglobalThis.bounds = readLabelFitSize; globalThis.fit = applyTextFit;"), box);
  return { box, mounted: { core, labelNode }, core, carrier, labelNode };
}

for (const ratio of [1, 1.05, 1.575]) {
  test(`label fitting retains both 7 CSS px insets at WebView ratio ${ratio}`, () => {
    const { box, mounted, labelNode } = fixture(ratio);
    const bounds = box.bounds(mounted);
    assert.ok(Math.abs(bounds.width - 58 * ratio) < 0.000001);
    assert.equal(box.fit(mounted, "Fixture label", "shrink", 8, true), false);
    assert.equal(labelNode.fontSize, 13.5, "64 CSS px text must shrink to the 58 CSS px content area");
    assert.deepEqual(labelNode.lines, ["Fixture label"]);
  });
}

test("content-box padding and borders are converted with the same live scale", () => {
  const { box, mounted, carrier } = fixture(1.5);
  carrier.css = {
    width: "54px", height: "27.295px", boxSizing: "content-box",
    paddingLeft: "7px", paddingRight: "7px", borderLeftWidth: "2px", borderRightWidth: "2px",
    paddingTop: "3px", paddingBottom: "3px", borderTopWidth: "2px", borderBottomWidth: "2px"
  };
  const bounds = box.bounds(mounted);
  assert.ok(Math.abs(bounds.width - 81) < 0.000001);
  assert.ok(Math.abs(bounds.height - 40.9425) < 0.000001);
});

test("an unpadded HTML label retains its complete core and SVG fitting remains unchanged", () => {
  const html = fixture();
  html.carrier.css = { ...html.core.css };
  assert.equal(html.box.bounds(html.mounted).width, 72);
  const svg = fixture(1.05, true);
  assert.equal(svg.box.bounds(svg.mounted).width, 72 * 1.05);
});
