import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { transform } from "lightningcss";

const stylesheets = {
  theme: "../src/pages/theme/themeEditorPage.css",
  binds: "../src/pages/binds/bindsWindowPage.css",
  macro: "../src/pages/macro-lab/macroLabWindowPage.css"
};
const sources = Object.fromEntries(Object.entries(stylesheets).map(([name, path]) =>
  [name, readFileSync(new URL(path, import.meta.url), "utf8")]
));

// Evaluate the page-class cascade and its viewport breakpoints without driving a UI.
function pageStyles(name, className, width, height) {
  const values = {};
  const priorities = {};
  postcss.parse(sources[name]).walkRules((rule) => {
    let parent = rule.parent;
    while (parent) {
      if (parent.type === "atrule" && parent.name === "media") {
        const matches = parent.params.split(",").some((query) => {
          const constraints = [...query.matchAll(/\(max-(width|height):\s*(\d+)px\)/g)];
          return constraints.length > 0 && constraints.every(([, axis, limit]) =>
            (axis === "width" ? width : height) <= Number(limit));
        });
        if (!matches) return;
      }
      parent = parent.parent;
    }
    const selectors = rule.selectors.filter((selector) => {
      const classes = selector.split(".");
      return classes[0] === "" && classes.slice(1).every((value) => value === className);
    });
    if (!selectors.length) return;
    const specificity = Math.max(...selectors.map((selector) => selector.split(".").length));
    rule.walkDecls((declaration) => {
      if ((priorities[declaration.prop] ?? 0) > specificity) return;
      values[declaration.prop] = declaration.value;
      priorities[declaration.prop] = specificity;
    });
  });
  return values;
}

test("utility viewport styles compile as CSS", () => {
  for (const [name, code] of Object.entries(sources)) {
    assert.doesNotThrow(() => transform({ filename: `${name}.css`, code: Buffer.from(code) }));
  }
});

test("Theme Editor fits a viewport below its former 760 CSS px minimum", () => {
  const page = pageStyles("theme", "theme-editor", 600, 480);
  assert.equal(page["min-width"], "0");
  assert.equal(page.overflow, "auto");
  assert.equal(page["grid-template-rows"], "auto auto minmax(160px, 1fr) auto");
  assert.equal(pageStyles("theme", "theme-editor__content", 600, 480).overflow, "auto");
  assert.equal(pageStyles("theme", "theme-editor__scope", 600, 480)["grid-template-columns"], "1fr");
  assert.equal(pageStyles("theme", "theme-library-columns", 600, 480)["grid-template-columns"], "1fr");
});

test("Binds retains its desktop canvas and scrolls after narrow or short reflow", () => {
  assert.equal(pageStyles("binds", "binds-window-page", 1280, 900).overflow, "hidden");
  assert.equal(pageStyles("binds", "binds-window", 1280, 900).height, "100%");
  for (const [width, height] of [[1040, 900], [1280, 620], [480, 480]]) {
    assert.equal(pageStyles("binds", "binds-window-page", width, height).overflow, "auto");
    assert.equal(pageStyles("binds", "binds-window", width, height).height, "auto");
    assert.equal(pageStyles("binds", "binds-window", width, height)["min-height"], "100%");
    assert.equal(pageStyles("binds", "binds-window__station", width, height)["grid-template-rows"], "auto auto auto auto");
    assert.equal(pageStyles("binds", "binds-window__card", width, height)["grid-template-rows"], "auto auto");
  }
});

test("Macro Lab keeps its desktop canvas and exposes wrapped controls and wide tables", () => {
  assert.equal(pageStyles("macro", "macro-lab-page", 1320, 900).overflow, "hidden");
  assert.equal(pageStyles("macro", "macro-lab", 1320, 900).height, "100%");
  for (const [width, height] of [[1100, 900], [1320, 620], [480, 480]]) {
    assert.equal(pageStyles("macro", "macro-lab-page", width, height).overflow, "auto");
    assert.equal(pageStyles("macro", "macro-lab", width, height).height, "auto");
    assert.equal(pageStyles("macro", "macro-lab__command-bar", width, height)["flex-wrap"], "wrap");
    assert.equal(pageStyles("macro", "macro-lab__step-table", width, height).overflow, "auto");
    assert.equal(pageStyles("macro", "macro-lab__step-table", width, height)["grid-template-rows"], "auto auto");
  }
});
