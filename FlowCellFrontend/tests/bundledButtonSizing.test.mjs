import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const familyPath = path.join(root, "button/skins/chippedConcreteFamily.ts");
const familyText = readFileSync(familyPath, "utf8");
const family = JSON.parse(familyText.slice(familyText.indexOf(" = ") + 3).trim().replace(/;$/, ""));
const widest = Math.max(...Object.values(family).map((variant) => variant.width));
const compiledSources = new Map();

function transpile(file) {
  if (!compiledSources.has(file)) {
    compiledSources.set(file, ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
    }).outputText);
  }
  return compiledSources.get(file);
}

function sourceModules(globals = {}, overrides = new Map()) {
  const cache = new Map([[familyPath, { chippedConcreteFamilySources: family }]]);
  const load = (file) => {
    if (overrides.has(file)) return overrides.get(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    vm.runInNewContext(transpile(file), {
      ...globals,
      exports,
      require(name) {
        if (overrides.has(name)) return overrides.get(name);
        assert.ok(name.startsWith("."), `Unexpected dependency ${name}`);
        const resolved = path.resolve(path.dirname(file), name).replace(/\.js$/, ".ts");
        return load(path.extname(resolved) ? resolved : `${resolved}.ts`);
      }
    }, { filename: file });
    return exports;
  };
  return load;
}

// This fixture supplies known text advances to the real selector. It is not a
// browser/font measurement; it verifies that runtime measurements, font size and
// the literal skin's padding determine the chosen unmodified artwork.
function domFixture(measureAt15 = (label) => [...label].reduce((width, char) => width + (char === "W" ? 15 : char === "i" ? 2 : 8), 0)) {
  const measured = [];
  const probes = new Set();
  const readStyle = (text) => Object.fromEntries(text.split(";").filter(Boolean).map((declaration) => {
    const colon = declaration.indexOf(":");
    return [declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), declaration.slice(colon + 1).trim()];
  }));
  class Element {
    constructor(style = {}) { this.style = { ...style }; this.children = []; this.textContent = ""; }
    append(child) { child.parentElement = this; this.children.push(child); }
    cloneNode() { return new Element(this.style); }
    attachShadow() { return { append: (child) => { this.shadowChild = child; } }; }
    remove() { probes.delete(this); }
  }
  const document = {
    body: { append: (probe) => probes.add(probe) },
    createElement(tag) {
      if (tag !== "template") return new Element();
      return {
        set innerHTML(source) {
          const core = source.match(/<div data-core style="([^"]+)"/);
          const label = source.match(/<span data-anim="cl" style="([^"]+)"/);
          assert.ok(core && label, "measure the actual bundled core and label carrier");
          this.content = { querySelector: (selector) => new Element(readStyle(selector === "[data-core]" ? core[1] : label[1])) };
        }
      };
    },
    createRange() {
      let selected;
      return {
        selectNodeContents(node) { selected = node; },
        getBoundingClientRect() {
          const fontSize = Number.parseFloat(selected.style.fontSize ?? selected.parentElement.style.fontSize);
          measured.push({ label: selected.textContent, fontSize });
          return { width: measureAt15(selected.textContent) * fontSize / 15 };
        }
      };
    }
  };
  const getComputedStyle = (node) => {
    const padding = node.style.padding.split(/\s+/).map(Number.parseFloat);
    assert.equal(node.style.boxSizing, "border-box");
    assert.equal(node.parentElement.style.fontFamily, "'Segoe UI',sans-serif");
    assert.equal(node.parentElement.style.fontWeight, "700");
    return { paddingLeft: `${padding[1] ?? padding[0]}px`, paddingRight: `${padding[3] ?? padding[1] ?? padding[0]}px` };
  };
  return { document, getComputedStyle, measured, probes };
}

const coreWidth = (skin) => Number(skin.structure.match(/width:([\d.]+)px/)[1]);
const sizingPath = path.join(root, "button/skins/chippedConcreteButtonSkin.ts");

test("new Main imports retain the panel height and measured Concrete width through first render", () => {
  const load = sourceModules(domFixture());
  const sizing = load(sizingPath);
  const { defaultPanelButtonSize } = load(path.join(root, "button/state/buttonPanelDefaults.ts"));
  const geometry = load(path.join(root, "button/geometry/buttonGeometry.ts"));
  const editor = readFileSync(path.join(root, "button/editor/ButtonEditorPage.tsx"), "utf8");
  const add = editor.slice(editor.indexOf("function addPlacement("), editor.indexOf("function createSurface("));
  const measure = editor.slice(editor.indexOf("const handleNaturalMeasurement ="), editor.indexOf("const selectWorkspacePlacement ="));
  const document = { buttons: { new: { label: "WWWWWW", defaultSkinId: "skin-default-neutral" } }, skins: {},
    surfaces: { panel: { id: "panel", kind: "panel", width: 1000, height: 500, placementIds: ["later", "first"] } },
    placements: { later: { x: 200, y: 100, width: 100, height: 48 }, first: { x: 0, y: 0, width: 100, height: 37.294964 } },
    settings: { gridSize: 8, defaultSurfacePadding: 8, buttonSpacingMm: 0, defaultMinimumFontSize: 8 } };
  const sandbox = { ...geometry, defaultPanelButtonSize, CHIPPED_CONCRETE_BUTTON_SKIN_ID: sizing.CHIPPED_CONCRETE_BUTTON_SKIN_ID,
    createStableButtonId: () => "new-placement", naturalCoreMeasurementsRef: { current: new Map() },
    freshPlacementsRef: { current: new Set(["new-placement"]) },
    store: { current: () => document, transact: () => assert.fail("already committed Main dimensions must not change on measurement") } };
  vm.runInNewContext(ts.transpileModule(add + measure + "\nglobalThis.add = addPlacement; globalThis.measure = handleNaturalMeasurement;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, sandbox);
  const placement = sandbox.add(document, "new", "panel");
  assert.equal(placement.height, 37.294964);
  assert.equal(placement.width, 104 * 37.294964 / 37.295);
  const saved = JSON.stringify(placement);
  sandbox.measure(placement.id, { width: 104, height: 37.295 });
  sandbox.measure(placement.id, { width: 200, height: 60 });
  assert.equal(JSON.stringify(placement), saved);
  assert.equal(sandbox.freshPlacementsRef.current.size, 0);
  assert.equal(JSON.parse(JSON.stringify(document)).placements[placement.id].height, 37.294964);
  const empty = defaultPanelButtonSize(document, document.buttons.new);
  assert.equal(empty.height, 37.295, "an empty panel uses the skin's authored height");
  for (const label of ["iiiiii", "WWWWWW", "A longer label"]) {
    const natural = sizing.getChippedConcreteButtonSize(label);
    const row = sizing.getChippedConcreteButtonSize(label, undefined, undefined, placement.height);
    assert.equal(row.height, placement.height);
    assert.ok(Math.abs(row.width / natural.width - row.height / natural.height) < 1e-12,
      "changing the label preserves a uniform font scale and authored side padding");
  }
});

test("bundled defaults measure equal-character wide/narrow labels and preserve literal skin sections", () => {
  const dom = domFixture();
  const load = sourceModules(dom);
  const sizing = load(sizingPath);
  assert.equal(sizing.getChippedConcreteButtonSize("WWWWWW").width, 104);
  assert.equal(sizing.getChippedConcreteButtonSize("iiiiii").width, 48);
  for (const label of ["WWWWWW", "iiiiii"]) {
    const skin = sizing.getChippedConcreteButtonSkin(label);
    const size = sizing.getChippedConcreteButtonSize(label);
    assert.equal(coreWidth(skin), size.width);
    const count = Number(skin.id.split("-").at(-1));
    const { parseButtonSkinPaste } = load(path.join(root, "button/skins/skinPasteParser.ts"));
    const original = parseButtonSkinPaste(family[count].source).sections;
    for (const [section, source] of Object.entries(original)) {
      const actual = section === "base" ? skin.base.replace(/--flowcell-sizing-(?:default|responsive):[^;]+;\s*/g, "") : skin[section];
      assert.equal(actual, source, "non-visual presets must not change authored artwork or animation");
    }
  }
  assert.equal(dom.measured.length, 2, "reuse measurements between skin and geometry getters");
  assert.equal(dom.probes.size, 0, "every measurement probe is removed");
  assert.equal(readFileSync(familyPath, "utf8"), familyText);
});

test("bundled width selection includes 14 CSS px of authored padding and exact boundaries", () => {
  const dom = domFixture((label) => label === "boundary" ? 50 : 50.01);
  const sizing = sourceModules(dom)(sizingPath);
  assert.equal(sizing.getChippedConcreteButtonSize("boundary").width, 64);
  assert.equal(sizing.getChippedConcreteButtonSize("over boundary").width, 68);
  assert.equal(dom.probes.size, 0);
});

test("bundled label measurement honors explicit font size and caps at the widest authored source", () => {
  const dom = domFixture();
  const sizing = sourceModules(dom)(sizingPath);
  assert.equal(sizing.getChippedConcreteButtonSize("WW").width, 48);
  assert.equal(sizing.getChippedConcreteButtonSize("WW", undefined, 30).width, 76);
  assert.equal(sizing.getChippedConcreteButtonSize("W".repeat(100)).width, widest);
  assert.deepEqual(dom.measured.map(({ fontSize }) => fontSize), [15, 30, 15]);
});

test("non-DOM defaults avoid character-count guesses while header preferences retain authored widths", () => {
  const sizing = sourceModules()(sizingPath);
  assert.equal(sizing.getChippedConcreteButtonSize("i").width, widest);
  assert.equal(coreWidth(sizing.getChippedConcreteButtonSkin("i")), widest);
  assert.equal(sizing.getChippedConcreteButtonSize("Load Layout", 100).width, 100);
  assert.equal(coreWidth(sizing.getChippedConcreteButtonSkin("Load Layout", 100)), 100);
});

test("canonical default-family routing uses measured widths while custom family baselines remain intact", () => {
  const dom = domFixture();
  const overrides = new Map([
    ["react", { useMemo: (callback) => callback(), useState: () => [null, () => {}], useEffect: () => {} }],
    [path.join(root, "button/state/ButtonStateRepository.ts"), {
      getButtonSkinDirectory() { throw new Error("unexpected file lookup"); },
      listButtonSkinFiles() { throw new Error("unexpected file lookup"); },
      loadButtonSkinFile() { throw new Error("unexpected file lookup"); }
    }]
  ]);
  const load = sourceModules(dom, overrides);
  const sizing = load(sizingPath);
  const { useButtonSkinFamily } = load(path.join(root, "button/skins/useButtonSkinFamily.ts"));
  const bundled = sizing.CHIPPED_CONCRETE_BUTTON_SKIN;
  assert.equal(coreWidth(useButtonSkinFamily(bundled, "new", "WWWWWW")), 104);
  assert.equal(coreWidth(useButtonSkinFamily(bundled, "header", "WWWWWW", 100)), 100);
  const custom = { ...bundled, id: "custom-family", metadata: {
    buttonSkinEmbeddedVariants: { 6: family[6].source }, buttonSkinFamilyBaseline: { saved: 6 }
  } };
  assert.equal(useButtonSkinFamily(custom, "saved", "WWWWWW"), custom);
  assert.equal(coreWidth(useButtonSkinFamily(custom, "new", "WWWWWW")), family[6].width);
  const { BUTTON_SKIN_SECTION_ORDER } = load(path.join(root, "button/skins/buttonSkinFormat.ts"));
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    const editedDefault = { ...bundled, [section]: `${bundled[section]}\ncustom edit`, metadata: {
      ...bundled.metadata, buttonSkinFamilyBaseline: { saved: 6 }
    } };
    assert.equal(sizing.isBundledChippedConcreteDefaultSkin(editedDefault), false);
    assert.equal(useButtonSkinFamily(editedDefault, "saved", "WWWWWW"), editedDefault,
      `an edited ${section} section keeps its original assignment even with the bundled ID`);
  }
  const editedFamily = { ...bundled, metadata: { ...bundled.metadata,
    buttonSkinFamilyBaseline: { saved: 6 },
    buttonSkinEmbeddedVariants: { ...bundled.metadata.buttonSkinEmbeddedVariants, 6: `${family[6].source}\n` }
  } };
  assert.equal(sizing.isBundledChippedConcreteDefaultSkin(editedFamily), false);
  assert.equal(useButtonSkinFamily(editedFamily, "saved", "WWWWWW"), editedFamily);
  assert.equal(dom.measured.length, 1, "custom character-count families are not remeasured");
});

test("unchanged legacy Chipped Concrete defaults use text and padding instead of character count", () => {
  const dom = domFixture();
  const overrides = new Map([
    ["react", { useMemo: (callback) => callback(), useState: () => [null, () => {}], useEffect: () => {} }]
  ]);
  // The file-backed family need not load for a recognized authored default.
  overrides.set(path.join(root, "button/state/ButtonStateRepository.ts"), {});
  const load = sourceModules(dom, overrides);
  const sizing = load(sizingPath);
  const { useButtonSkinFamily } = load(path.join(root, "button/skins/useButtonSkinFamily.ts"));
  const { BUTTON_SKIN_SECTION_ORDER } = load(path.join(root, "button/skins/buttonSkinFormat.ts"));
  const legacy = {
    ...sizing.getChippedConcreteButtonSkin("", 156),
    id: sizing.CHIPPED_CONCRETE_BUTTON_SKIN_ID,
    name: "Chipped Concrete",
    metadata: { buttonSkinFamily: "Chipped Concrete" }
  };
  legacy.base = legacy.base.replace(/--flowcell-sizing-(?:default|responsive):[^;]+;\s*/g, "");
  assert.equal(sizing.isBundledChippedConcreteDefaultSkin(legacy), true);
  assert.equal(sizing.isBundledMainPageConcreteSkin(legacy), false, "legacy width compatibility must not trigger Main-theme cleanup of existing popout assignments");
  assert.equal(coreWidth(useButtonSkinFamily(legacy, "new", "WWWWWW")), 104);
  assert.equal(coreWidth(useButtonSkinFamily(legacy, "new", "iiiiii")), 48);
  assert.equal(coreWidth(useButtonSkinFamily(legacy, "new", "Screenshots")), 104,
    "fixture text width 88 px plus 14 px padding selects the 104 px authored variant, not the 80 px character-count variant");
  assert.equal(coreWidth(legacy), 156, "the saved source is not rewritten");
  for (const section of BUTTON_SKIN_SECTION_ORDER) {
    assert.equal(sizing.isBundledChippedConcreteDefaultSkin({ ...legacy, [section]: `${legacy[section]}\ncustom edit` }), false);
  }
  assert.equal(sizing.isBundledChippedConcreteDefaultSkin({ ...legacy, id: "custom-concrete" }), false);
  assert.equal(sizing.isBundledChippedConcreteDefaultSkin({ ...legacy, metadata: { buttonSkinFamily: "Another Skin" } }), false);
});

test("skin-owned sizing presets support existing Concrete, Gray, and arbitrary future skins", () => {
  const load = sourceModules();
  const concrete = load(sizingPath);
  const gray = load(path.join(root, "button/skins/defaultButtonSkin.ts"));
  const policy = load(path.join(root, "button/skins/buttonSkinSizing.ts"));
  const shape = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(shape(policy.readButtonSkinSizing(concrete.CHIPPED_CONCRETE_BUTTON_SKIN)), { defaultMode: "proportional", supportsResponsive: false });
  assert.deepEqual(shape(policy.readButtonSkinSizing(gray.DEFAULT_BUTTON_SKIN)), { defaultMode: "proportional", supportsResponsive: true });
  assert.equal(policy.resolveButtonSkinSizingMode(concrete.CHIPPED_CONCRETE_BUTTON_SKIN, "responsive"), "proportional");
  assert.equal(policy.resolveButtonSkinSizingMode(gray.DEFAULT_BUTTON_SKIN, "responsive"), "responsive");
  assert.deepEqual(shape(policy.readButtonSkinSizing({ base: "--flowcell-sizing-default:stretch;--flowcell-sizing-responsive:0;" })), { defaultMode: "stretch", supportsResponsive: false });
  assert.deepEqual(shape(policy.readButtonSkinSizing({ base: "" })), { defaultMode: "responsive", supportsResponsive: true });
  assert.equal(policy.readButtonSkinSizing({ base: "--flowcell-sizing-default:invalid;/* --flowcell-sizing-responsive:0; */" }).supportsResponsive, true);

  const oldConcrete = { ...concrete.getChippedConcreteButtonSkin("", 112), base: "" };
  oldConcrete.base = concrete.getChippedConcreteButtonSkin("", 112).base.replace(/--flowcell-sizing-(?:default|responsive):[^;]+;\s*/g, "");
  const artwork = oldConcrete.structure;
  assert.equal(concrete.applyChippedConcreteSizingPreset(oldConcrete), true);
  assert.equal(oldConcrete.structure, artwork);
  assert.equal(concrete.applyChippedConcreteSizingPreset(oldConcrete), false, "migration is idempotent");
  assert.equal(policy.readButtonSkinSizing(oldConcrete).supportsResponsive, false);
  const edited = { ...oldConcrete, structure: artwork + "custom edit", base: oldConcrete.base.replace(/--flowcell-sizing-(?:default|responsive):[^;]+;\s*/g, "") };
  assert.equal(concrete.applyChippedConcreteSizingPreset(edited), false);
  const oldGray = { ...gray.DEFAULT_BUTTON_SKIN, base: gray.DEFAULT_BUTTON_SKIN.base.replace(/--flowcell-sizing-default:[^;]+;\s*/g, "") };
  assert.equal(gray.applyDefaultGraySizingPreset(oldGray), true);
  assert.deepEqual(shape(policy.readButtonSkinSizing(oldGray)), { defaultMode: "proportional", supportsResponsive: true });
});

test("Main header routing retains responsive policy without changing custom or ordinary family behavior", () => {
  const source = readFileSync(path.join(root, "button/ButtonHost.tsx"), "utf8");
  const start = source.indexOf("  const button = useMemo(() => resolveButtonPlacementPresentation");
  const end = source.indexOf("  const [coreElement", start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end) + "\nglobalThis.result = { skinPlacement };", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const sizing = sourceModules()(sizingPath);
  for (const header of [true, false]) {
    for (const bundled of [true, false]) {
      const placement = { id: "saved", width: 100, height: 37.294964, matchHitboxToSkin: false, textSizeOverride: 17 };
      const assignedSkin = bundled ? sizing.CHIPPED_CONCRETE_BUTTON_SKIN : { id: "custom-family" };
      const canonicalButton = { label: "Load Layout", metadata: { mainPageControl: true, mainPageSection: header ? "Header Buttons" : "Program Rail" } };
      const calls = [];
      const context = {
        placement, assignedSkin, canonicalButton,
        isBundledChippedConcreteDefaultSkin: sizing.isBundledChippedConcreteDefaultSkin,
        resolveButtonPlacementPresentation: (button) => button,
        useMemo: (callback) => callback(),
        useButtonSkinFamily: (...args) => { calls.push(args); return { id: "resolved-variant" }; }
      };
      vm.runInNewContext(code, context);
      assert.equal(calls[0][3], header && bundled ? 100 : undefined);
      assert.equal(calls[0][4], 17);
      assert.equal(context.result.skinPlacement.matchHitboxToSkin, !(header && bundled));
      if (header && bundled) assert.equal(context.result.skinPlacement, placement);
      assert.equal(placement.matchHitboxToSkin, false, "saved sizing policy stays unchanged");
    }
  }
});

test("unavailable or failed DOM text measurements use the safe fallback and release their probes", () => {
  for (const measure of [() => 0, () => { throw new Error("measurement unavailable"); }]) {
    const dom = domFixture(measure);
    const sizing = sourceModules(dom)(sizingPath);
    assert.equal(sizing.getChippedConcreteButtonSize("visible label").width, widest);
    assert.equal(dom.probes.size, 0);
  }
});
