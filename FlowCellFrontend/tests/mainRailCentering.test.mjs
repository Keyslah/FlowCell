import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { rails, buildProgramRailButtons, buildPanelRailButtons } from "./.compiled-button-system/pages/main/mainLayout.js";
import { buttonRectsOverlap } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

function hostHarness(exportName) {
  const source = readFileSync(new URL("../src/pages/main/MainButtonHost.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const state = [];
  let cursor = 0;
  const exports = {};
  const sandbox = {
    exports,
    require(name) {
      if (name === "react") return {
        useState(initial) {
          const index = cursor++;
          if (!(index in state)) state[index] = initial;
          return [state[index], update => { state[index] = typeof update === "function" ? update(state[index]) : update; }];
        },
        useCallback: callback => callback
      };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "../../button/ButtonHost") return { ButtonHost: "ButtonHost" };
      if (name === "../../button/skins/chippedConcreteButtonSkin") {
        return { getChippedConcreteButtonSkin: () => ({ id: "fallback-skin" }) };
      }
      if (name === "./mainLayout") return { rails };
      throw new Error(`Unexpected dependency ${name}`);
    }
  };
  vm.runInNewContext(compiled, sandbox);
  return props => { cursor = 0; return exports[exportName](props); };
}

for (const hostName of ["MainButtonHost", "MainControlHost"]) {
  for (const [railId, actionId] of [
    ["program-rail", "select-program-folder"], ["program-rail", "add-program-folder"],
    ["panel-rail", "select-panel-folder"], ["panel-rail", "add-panel-folder"]
  ]) {
    test(`${hostName} centers measured ${actionId} core while preserving saved geometry and style`, () => {
      const render = hostHarness(hostName);
      const control = { id: "navigation-button", railId, actionId, x: 900, y: 203, width: 132, height: 39, label: "Files" };
      const presentation = {
        button: { id: "canonical-button", metadata: {}, label: "Custom", tooltip: "Saved tooltip" },
        placement: { id: "saved-placement", x: 900, y: 203, width: 132, height: 39, skinOverrideId: "custom-skin", textOffsetX: 4, textOffsetY: -2 },
        skin: { id: "custom-skin", customValue: "preserved" }
      };
      const props = hostName === "MainButtonHost" ? { button: control, canonicalPresentation: presentation } : { control };
      const before = structuredClone({ control, presentation });
      const rail = rails.find(rail => rail.id === railId);
      let rendered = render(props);
      assert.equal(rendered.props.children.props.familySkinCentering, "vertical", "the rail owns horizontal centering");
      for (const width of [48, 112, 73.25]) {
        rendered.props.children.props.onMeasurement({ width, height: 39, visualOverflow: { left: 80, right: 5, top: 4, bottom: 8 } });
        rendered = render(props);
        assert.ok(Math.abs(rendered.props.style.left + width / 2 - (rail.x + rail.width / 2)) < 0.000001);
        assert.equal(rendered.props.style.top, 203, "authored vertical position stays unchanged");
        if (hostName === "MainButtonHost") {
          assert.equal(rendered.props.children.props.placement, presentation.placement);
          assert.equal(rendered.props.children.props.skin, presentation.skin);
        }
      }
      const left = rendered.props.style.left;
      rendered.props.children.props.onMeasurement({ width: 0 });
      assert.equal(render(props).props.style.left, left, "ignore transient zero measurements");
      assert.deepEqual({ control, presentation }, before, "centering never rewrites stored state");
    });
  }
  test(`${hostName} leaves header and script-area horizontal placement unchanged`, () => {
    for (const railId of [undefined, "buttons-rail"]) {
      const render = hostHarness(hostName);
      const control = { id: "other", railId, actionId: "other", x: 471, y: 36, width: 100, height: 39, label: "Other" };
      const props = hostName === "MainButtonHost" ? {
        button: control,
        canonicalPresentation: { button: { metadata: {}, label: "Other" }, placement: control, skin: {} }
      } : { control };
      const rendered = render(props);
      assert.equal(rendered.props.style.left, 471);
      assert.equal(rendered.props.children.props.onMeasurement, undefined);
      assert.equal(rendered.props.children.props.familySkinCentering, undefined);
    }
  });
}

for (const kind of ["program", "panel"]) {
  test(`${kind} fallback reserves centered vertical slots despite old off-rail x coordinates`, () => {
    const saved = [
      { name: "First", rect: { x: 900, y: 125.758993, width: 70, height: 37.294964 } },
      { name: "Last", rect: { x: -400, y: 175.485611, width: 88, height: 37.294964 } }
    ];
    const before = structuredClone(saved);
    const footer = { x: 1500, y: 646.022806, width: 132, height: 37.294964 };
    const buttons = kind === "program"
      ? buildProgramRailButtons(["First", "New", "Last"], "New", saved.map(entry => ({ programName: entry.name, rect: entry.rect })), footer)
      : buildPanelRailButtons(["First", "New", "Last"], "New", saved.map(entry => ({ panelName: entry.name, rect: entry.rect })), footer);
    const added = buttons.find(button => button.folderName === "New");
    for (const { name, rect } of saved) {
      assert.equal(buttonRectsOverlap({ ...added, x: 0 }, { ...rect, x: 0 }), false);
      assert.equal(buttons.find(button => button.folderName === name).y, rect.y);
    }
    assert.deepEqual(saved, before);
  });
}
