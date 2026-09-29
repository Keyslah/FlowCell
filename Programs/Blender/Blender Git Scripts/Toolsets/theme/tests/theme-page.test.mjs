import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const page = manifest.page;
const pageScript = readFileSync(path.join(packageRoot, "page", "page.js"), "utf8");
const pageHtml = readFileSync(path.join(packageRoot, "page", "index.html"), "utf8");
const pageCss = readFileSync(path.join(packageRoot, "page", "page.css"), "utf8");
const blenderSource = readFileSync(path.join(packageRoot, "theme.py"), "utf8");
const blenderProgramRoot = path.resolve(packageRoot, "..", "..", "..");
const sharedActionsSource = readFileSync(
  path.join(blenderProgramRoot, "Blender Addons - Copy contents Into Blender", "flowcell_actions.py"),
  "utf8"
);
const sharedBridgeSource = readFileSync(
  path.join(blenderProgramRoot, "Blender Addons - Copy contents Into Blender", "flowcell_bridge.py"),
  "utf8"
);
const removeButtonSource = readFileSync(
  path.join(blenderProgramRoot, "SupportScripts", "Remove-BlenderFlowCellButton.ps1"),
  "utf8"
);
const blenderProgramManifest = JSON.parse(
  readFileSync(path.join(blenderProgramRoot, "flowcell.program.json"), "utf8")
);

const actionById = new Map(page.actions.map((action) => [action.id, action]));
const fieldById = new Map(page.config.fields.map((field) => [field.id, field]));

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function assertStrictRootSchema(schema, subject) {
  assert.equal(schema.type, "object", `${subject} must use an object root`);
  assert.equal(schema.additionalProperties, false, `${subject} must reject undeclared root properties`);
  assert.ok(schema.properties && typeof schema.properties === "object", `${subject} must declare properties`);
  for (const required of schema.required || []) {
    assert.ok(required in schema.properties, `${subject} requires undeclared property ${required}`);
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.title = "";
    this.textContent = "";
    this.listeners = new Map();
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const listener of this.listeners.get("click") || []) listener({ target: this });
  }

  querySelectorAll(selector) {
    return this.children.flatMap((child) => child instanceof TestElement
      ? [...(child.tagName === selector ? [child] : []), ...child.querySelectorAll(selector)]
      : []);
  }
}

async function renderThemePage(ownerState = {}, actionResponses = {}) {
  const root = new TestElement("main");
  const requests = [];
  const timers = new Map();
  let nextTimerId = 1;
  const status = new TestElement("div");
  const document = {
    getElementById: (id) => id === "theme-page" ? root : id === "theme-status" ? status : null,
    createElement: (tagName) => new TestElement(tagName),
    createElementNS: (_namespace, tagName) => new TestElement(tagName)
  };
  const window = {
    flowcellPage: {
      descriptor: page,
      request: async (actionId, payload) => {
        requests.push({ actionId, payload });
        if (actionId === page.config.actions.state.read) return { state: ownerState };
        if (actionId === "button-theme.scan" && !(actionId in actionResponses)) {
          const stored = ownerState.buttonTheme || {};
          const buckets = new Map((stored.buckets || []).map((bucket) => [bucket.id, bucket]));
          return { revision: stored.revision ?? 0, placements: (stored.placements || []).map((placement) => ({
            placementId: placement.placementId,
            color: placement.color || buckets.get(placement.bucketId)?.color,
            materialColors: buckets.get(placement.bucketId)?.materialColors || [],
            label: placement.label || "Button", groupLabel: placement.groupLabel || "Blender", textColor: placement.textColor || "#FFFFFF"
          })) };
        }
        const response = actionResponses[actionId];
        return typeof response === "function" ? response(payload) : response || {};
      }
    },
    clearTimeout: (timerId) => timers.delete(timerId),
    setTimeout: (callback) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, callback);
      return timerId;
    }
  };
  vm.runInNewContext(pageScript, { document, window });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  root.requests = requests;
  root.status = status;
  root.flushTimers = async () => {
    while (timers.size) {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return root;
}

async function settlePageAction() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function poppedSettings(overrides = {}) {
  return {
    version: 1, colors: ["#183942", "#467A8B"], spread: 67, scatter: 4, seed: 32,
    screenTopToBottom: true, textColor: "#FFFFFF", hoverEnabled: true, activeEnabled: true,
    hoverColor: "#AACCFF", activeColor: "#88FFCC", hoverHighlightAmount: 75,
    activeHighlightAmount: 95, hoverGlowAmount: 8, activeGlowAmount: 12,
    idleEnabled: false, idleColor: "#FFFFFFCC", idleHighlightAmount: 0, idleGlowAmount: 0,
    ...overrides
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function clickPageButton(root, label) {
  const button = root.querySelectorAll("button").find((candidate) => candidate.textContent === label);
  assert.ok(button, `Missing ${label} button`);
  button.click();
  await settlePageAction();
}

function poppedControl(root, key) {
  const control = root.querySelectorAll("input").find((candidate) => candidate.dataset.setting === key);
  assert.ok(control, `Missing ${key} control`);
  return control;
}

const LINEAR_CURVE = [{ x: 0, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }];

function classes(node) {
  return String(node.className || node.class || "").split(/\s+/);
}

function channelBox(root, channel) {
  const box = root.querySelectorAll("section").find((node) => classes(node).includes(`button-theme-channel--${channel}`));
  assert.ok(box, `Missing ${channel} gradient box`);
  return box;
}

function channelStops(root, channel) {
  return channelBox(root, channel).querySelectorAll("div")
    .find((node) => classes(node).includes("button-theme-gradient__stops"))
    .querySelectorAll("input").filter((input) => input.type === "text");
}

function labelledInput(container, label) {
  const input = container.querySelectorAll("input").find((candidate) => candidate["aria-label"] === label);
  assert.ok(input, `Missing ${label} input`);
  return input;
}

function toolButton(container, label) {
  const button = container.querySelectorAll("button")
    .find((candidate) => candidate.textContent === label || candidate["aria-label"] === label);
  assert.ok(button, `Missing ${label} button`);
  return button;
}

function setInput(input, value, type = "change") {
  input.value = String(value);
  dispatch(input, type);
}

function curveBox(container) {
  return container.querySelectorAll("svg").find((node) => classes(node).includes("gradient-curve__box"));
}

function curvePoints(container) {
  return curveBox(container).querySelectorAll("circle").filter((node) => node.dataset.kind === "point");
}

function selectCurvePoint(container, index) {
  const box = curveBox(container);
  const target = curvePoints(container)[index];
  for (const listener of box.listeners.get("pointerdown") || []) {
    listener({ button: 0, pointerId: 1, target, preventDefault() {} });
  }
  for (const listener of box.listeners.get("pointerup") || []) listener({ pointerId: 1 });
}

function bucketColors(root) {
  return root.querySelectorAll("div")
    .filter((node) => classes(node).includes("button-theme-bucket--surface"))
    .map((node) => node.querySelectorAll("input").find(({ type }) => type === "text").value)
    .sort();
}

function applyBucketsButton(root) {
  return root.querySelectorAll("button").find(({ textContent }) => textContent === "Apply Buckets");
}

function namedPlacements() {
  return [
    { placementId: "hidden-util", label: "Utility", groupLabel: "Blender Tools", color: "#224466", textColor: "#FFFFFF", materialColors: [] },
    { placementId: "hidden-lith", label: "Lithophane", groupLabel: "Blender Tools", color: "#99BBDD", textColor: "#000000", materialColors: [] },
    { placementId: "hidden-split", label: "Split", groupLabel: "Modeling", color: "#556677", textColor: "#FFFFFF", materialColors: [] }
  ];
}

function dispatch(element, type) {
  const listeners = element.listeners.get(type) || [];
  assert.ok(listeners.length, `${element.tagName} must handle ${type}`);
  listeners.forEach((listener) => listener({ target: element }));
}

test("Theme is an ordinary page-enabled Blender script package", () => {
  assert.deepEqual(Object.keys(manifest), [
    "schemaVersion",
    "id",
    "label",
    "tooltip",
    "program",
    "source",
    "bridgeData",
    "page"
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "blender.theme");
  assert.equal(manifest.program, "Blender");
  assert.equal(manifest.source, "theme.py");
  assert.deepEqual(Object.keys(page), [
    "schemaVersion",
    "id",
    "program",
    "label",
    "tooltip",
    "entry",
    "scripts",
    "styles",
    "assets",
    "window",
    "actions",
    "capabilities",
    "ownerStateFormat",
    "sharedProgramDataNamespace",
    "supportedDataFormats",
    "refreshEvents",
    "config"
  ]);
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.id, "blender.theme");
  assert.equal(page.program, "Blender");
  assert.equal(page.ownerStateFormat, "flowcell.blender-theme-page-state.v1");
  assert.equal(page.sharedProgramDataNamespace, "blender-themes");
  assert.deepEqual(manifest.bridgeData.lifecycle, { enabled: true });
  assert.deepEqual(manifest.bridgeData.readOnlyCommands, [
    "status",
    "read_project_startup_state",
    "read_place_picture_runtime_state",
    "absorb_theme"
  ]);
});

test("Theme owns its Blender lifecycle and generic deletion owns its sidecar", () => {
  assert.match(blenderSource, /def register_flowcell_action_lifecycle\(\)/);
  assert.match(blenderSource, /def unregister_flowcell_action_lifecycle\(reason:/);
  assert.match(blenderSource, /\.flowcell-runtime/);
  assert.match(blenderSource, /_remove_viewport_overlay_handler\(\)/);
  assert.match(blenderSource, /_unregister_place_picture_modal_operator\(\)/);
  assert.match(blenderSource, /if reason == "removed" and/);
  assert.doesNotMatch(blenderSource, /import flowcell_actions/);
  assert.doesNotMatch(blenderSource, /import flowcell_bridge/);

  assert.match(sharedBridgeSource, /def sync_custom_action_lifecycles\(\)/);
  assert.match(sharedBridgeSource, /def cleanup_custom_action_lifecycles\(reason:/);
  assert.match(sharedBridgeSource, /removalRequested/);
  assert.match(sharedBridgeSource, /_write_custom_action_lifecycle_removal_ack/);
  assert.doesNotMatch(sharedBridgeSource, /PROJECT_THEME|project_theme|place_picture|Blender Theme/i);
  assert.doesNotMatch(sharedActionsSource, /PROJECT_THEME|project_theme|place_picture|Blender Theme/i);
  assert.match(sharedActionsSource, /get_custom_action_read_only_commands/);
  assert.match(removeButtonSource, /Test-FlowCellCustomActionLifecycleEnabled/);
  assert.match(removeButtonSource, /Request-FlowCellCustomActionLifecycleRemoval/);
  assert.match(removeButtonSource, /Blender did not acknowledge lifecycle cleanup/);
  assert.match(removeButtonSource, /\.flowcell-runtime/);
  assert.match(removeButtonSource, /Move-FlowCellDirectoryToRecycleBin/);
  const removalRequestCall = removeButtonSource.lastIndexOf("Request-FlowCellCustomActionLifecycleRemoval");
  const registryPrune = removeButtonSource.indexOf("$registry.actions = @($remainingRegistry.ToArray())");
  const runtimeRecycle = removeButtonSource.indexOf("Move-FlowCellFileToRecycleBin -Path $runtimePath");
  assert.ok(removalRequestCall > 0 && removalRequestCall < registryPrune);
  assert.ok(registryPrune > 0 && registryPrune < runtimeRecycle);
});

test("Theme is default-selected through the ordinary bundled script lifecycle", () => {
  const contribution = blenderProgramManifest.bundledSources.find(({ id }) => id === "blender.theme");
  assert.ok(contribution);
  assert.equal(contribution.version, "3.0.27");
  assert.equal(contribution.sourcePath, "Blender Git Scripts/Toolsets/theme");
  assert.equal(contribution.importKind, "script");
  assert.equal(contribution.installOnAdd, true);
  assert.equal("installIfMissing" in contribution, false);
  assert.equal(contribution.legacyMatchKind, "script");
});

test("every declared page resource is package-contained and present", () => {
  const resources = [page.entry, ...page.scripts, ...page.styles, ...page.assets];
  assert.equal(new Set(resources.map((value) => value.toLowerCase())).size, resources.length);
  for (const resource of resources) {
    assert.equal(path.isAbsolute(resource), false, `${resource} must be relative`);
    assert.equal(resource.split(/[\\/]/).includes(".."), false, `${resource} must not traverse`);
    const resolved = path.resolve(packageRoot, resource);
    assert.ok(resolved.startsWith(`${packageRoot}${path.sep}`));
    assert.equal(statSync(resolved).isFile(), true, `${resource} must resolve to a file`);
  }
});

test("all page actions are unique, schema-bound, and capability-declared", () => {
  assert.equal(actionById.size, page.actions.length);
  const declaredCapabilities = new Set(page.capabilities);
  for (const action of page.actions) {
    assertStrictRootSchema(action.requestSchema, `${action.id} request`);
    assertStrictRootSchema(action.responseSchema, `${action.id} response`);
    if (action.handler.kind === "program" || action.handler.kind === "core") {
      assert.ok(declaredCapabilities.has(action.handler.capability), `${action.id} capability is undeclared`);
    }
    if (action.handler.kind === "program") {
      assert.equal(action.handler.capability, "blender-theme-page");
      assert.deepEqual(Object.keys(action.handler.payload), ["command", "action"]);
      assert.equal(action.handler.payload.action, action.handler.payload.command);
    }
  }
});

test("page configuration only dispatches declared actions", () => {
  const configuredActions = collectStrings(page.config.actions);
  for (const actionId of configuredActions) {
    assert.ok(actionById.has(actionId), `config action ${actionId} must be declared`);
  }
  for (const localActionId of Object.values(page.config.localActions)) {
    assert.equal(actionById.has(localActionId), false, `${localActionId} must remain page-local`);
    assert.equal(typeof page.config.actionLabels[localActionId], "string");
  }
  for (const valueField of page.config.environment.valueFields) {
    assert.ok(actionById.has(valueField.actionId));
    assert.equal(typeof page.config.actionLabels[valueField.actionId], "string");
  }
});

test("generic Core capability contracts are explicit and stable", () => {
  const expected = {
    "theme.image.select": ["file.select", [], ["path", "selected"]],
    "picture.file.select": ["file.select", [], ["path", "selected"]],
    "environment.file.select": ["file.select", [], ["path", "selected"]],
    "theme.image.sample": ["image.sample-palette", ["imagePath"], ["fieldPatch", "imagePath", "message", "paletteHexes", "selected"]],
    "theme.fields.save": ["tool-fields.save", ["values"], ["message", "saved", "savedPath"]],
    "theme.fields.load": ["tool-fields.load", [], ["fieldPatch", "message", "selected", "sourcePath"]],
    "theme.package.save": ["tool-package.save", ["values"], ["message", "packageName", "packagePath", "saved", "savedPath"]],
    "theme.package.open": ["tool-package.open", [], ["fieldPatch", "message", "packageName", "packagePath", "selected"]],
    "theme.package.previous": ["tool-package.cycle", ["activePackagePath"], ["fieldPatch", "message", "packageName", "packagePath", "selected"]],
    "theme.package.next": ["tool-package.cycle", ["activePackagePath"], ["fieldPatch", "message", "packageName", "packagePath", "selected"]],
    "button-theme.scan": ["button-theme.palette", [], ["buttonCount", "changedCount", "colorCount", "message", "placements", "revision"]],
    "button-theme.apply": ["button-theme.palette", ["assignments", "expectedRevision", "settings"], ["buttonCount", "changedCount", "colorCount", "message", "placements", "revision"]],
    "button-theme.refill": ["button-theme.palette", ["angle", "colors", "curve", "scatter", "screenTopToBottom", "seed", "spread"], ["buttonCount", "changedCount", "colorCount", "message", "placements", "revision"]],
    "button-theme.toggle-text": ["button-theme.palette", [], ["buttonCount", "changedCount", "colorCount", "message", "placements", "revision"]],
    "button-theme.settings": ["button-theme.palette", ["resetOverrides", "settings"], ["configured", "message", "settings"]],
    "button-theme.edit": ["button-theme.palette", ["edits", "expectedRevision"], ["buttonCount", "changedCount", "colorCount", "message", "placements", "revision"]]
  };
  for (const [actionId, [capability, requestKeys, responseKeys]] of Object.entries(expected)) {
    const action = actionById.get(actionId);
    assert.equal(action.handler.kind, "core");
    assert.equal(action.handler.capability, capability);
    assert.deepEqual(Object.keys(action.requestSchema.properties).sort(), requestKeys);
    assert.deepEqual(Object.keys(action.responseSchema.properties).sort(), responseKeys);
  }
  assert.equal(actionById.get("theme.package.previous").handler.options.direction, -1);
  assert.equal(actionById.get("theme.package.next").handler.options.direction, 1);
  assert.equal(actionById.get("button-theme.scan").handler.options.operation, "scan");
  assert.equal(actionById.get("button-theme.apply").handler.options.operation, "apply");
  assert.equal(actionById.get("button-theme.refill").handler.options.operation, "refill");
  assert.equal(actionById.get("button-theme.toggle-text").handler.options.operation, "toggle-text");
  assert.deepEqual(actionById.get("picture.file.select").handler.options.extensions, ["png", "jpg", "jpeg", "webp"]);
  assert.deepEqual(actionById.get("theme.image.select").handler.options.extensions, ["png", "jpg", "jpeg", "webp"]);
  assert.deepEqual(actionById.get("environment.file.select").handler.options.extensions, ["hdr", "exr"]);
  assert.match(
    pageScript,
    /browseTheme[\s\S]*requestAction\(\s*actions\.theme\.select[\s\S]*requestAction\(\s*actions\.theme\.sample/,
    "Browse must select a fresh image before sampling its palette"
  );
});

test("popped Button colors use an aggregate revision-bound Core contract", async () => {
  const scan = actionById.get("button-theme.scan");
  const apply = actionById.get("button-theme.apply");
  const refill = actionById.get("button-theme.refill");
  const toggleText = actionById.get("button-theme.toggle-text");
  assert.deepEqual(page.config.actions.buttonTheme, {
    scan: scan.id,
    apply: apply.id,
    refill: refill.id,
    toggleText: toggleText.id,
    settings: "button-theme.settings",
    edit: "button-theme.edit"
  });
  assert.equal(page.capabilities.includes("button-theme.palette"), true);
  for (const action of [scan, apply, refill, toggleText]) {
    assert.equal(action.handler.kind, "core");
    assert.equal(action.handler.capability, "button-theme.palette");
    assert.equal(action.responseSchema.properties.placements.items.additionalProperties, false);
    assert.deepEqual(
      action.responseSchema.properties.placements.items.required,
      ["placementId", "materialColors", "label", "textColor", "groupLabel"]
    );
    assert.equal(
      action.responseSchema.properties.placements.items.required.includes("color"),
      false,
      "tint-only skins must be allowed to report exact material colors without inventing one Surface color"
    );
  }
  assert.equal(apply.requestSchema.properties.assignments.items.additionalProperties, false);
  assert.deepEqual(apply.requestSchema.properties.assignments.items.required, ["placementId"]);
  assert.equal(apply.requestSchema.required.includes("expectedRevision"), true);
  assert.deepEqual(
    refill.requestSchema.required,
    ["colors", "spread", "scatter", "seed", "screenTopToBottom"]
  );
  assert.equal(Object.hasOwn(refill.requestSchema.properties.colors, "minItems"), false);
  assert.equal(Object.hasOwn(refill.requestSchema.properties.colors, "maxItems"), false);
  assert.equal(refill.requestSchema.properties.colors.items.type, "string");
  assert.equal(refill.requestSchema.properties.screenTopToBottom.type, "boolean");
  assert.deepEqual(toggleText.requestSchema.properties, {});
  assert.deepEqual(toggleText.requestSchema.required, undefined);
  assert.equal(page.config.actionLabels[toggleText.id], "Toggle Text");

  const root = await renderThemePage({
    buttonTheme: {
      revision: 41,
      topColor: "#8FDB0A",
      bottomColor: "#141414",
      spread: 100,
      scatter: 20,
      seed: 7,
      gradientColorCount: 5,
      gradientColors: ["#8FDB0A", "#76B509", "#5D9008", "#456A06", "#141414"],
      placements: [
        { placementId: "hidden-a", bucketId: "surface:#8FDB0A" },
        { placementId: "hidden-b", bucketId: "surface:#8FDB0A" },
        { placementId: "hidden-c", bucketId: "material:#369D8D|#3DCD9E" }
      ],
      buckets: [
        { id: "surface:#8FDB0A", kind: "surface", color: "#8FDB0A", materialColors: [] },
        { id: "material:#369D8D|#3DCD9E", kind: "material", color: null, materialColors: ["#369D8D", "#3DCD9E"] }
      ]
    }
  });
  const visibleText = [
    ...root.querySelectorAll("span"),
    ...root.querySelectorAll("div")
  ].map((node) => node.textContent);
  assert.ok(visibleText.includes("Surface · 2 Buttons"), JSON.stringify(visibleText));
  assert.ok(visibleText.includes("Skin materials · 1 Button"), JSON.stringify(visibleText));
  assert.equal(visibleText.some((text) => /hidden-[abc]/.test(text)), false);
  assert.match(pageScript, /buttonTheme:\s*cloneValue\(model\.buttonTheme\)/);
  assert.match(pageScript, /hydrateButtonThemeState\(state\.buttonTheme\)/);
  assert.match(pageScript, /expectedRevision:\s*model\.buttonTheme\.revision/);
  assert.match(pageScript, /renderButtonThemeRangeControl\([^\n]*"scatter"\)/);
  assert.equal(page.config.buttonTheme.gradientColorCount, 5);
  assert.equal(page.config.buttonTheme.gradientColorCountMinimum, 2);
  assert.equal(page.config.buttonTheme.gradientColorCountMaximum, 16);
  assert.equal(page.config.buttonTheme.gradientColorCountLabel, "Gradient Colors");
  assert.equal(page.config.buttonTheme.screenTopToBottom, false);
  assert.equal(page.config.buttonTheme.screenTopToBottomLabel, "Whole Layout");
  assert.equal(page.config.buttonTheme.topLabel, "Start");
  assert.equal(page.config.buttonTheme.bottomLabel, "End");
  assert.equal(page.config.localActions.applyButtonText, "button-theme.apply-text");
  assert.equal(page.config.localActions.refillButtonColors, "button-theme.refill-colors");
  assert.equal(page.config.localActions.scatterButtonColors, "button-theme.scatter");
});

test("popped Button controls share one row and refill or scatter stable hidden placements", async () => {
  const imagePath = "C:\\Themes\\forest.png";
  const sampledColors = ["#102030", "#284460", "#487890", "#70A0B0", "#B8D8E0"];
  let revision = 41;
  let placements = [
    { placementId: "hidden-a", color: "#101010", materialColors: [] },
    { placementId: "hidden-b", color: "#101010", materialColors: [] },
    { placementId: "hidden-c", color: "#808080", materialColors: [] },
    { placementId: "hidden-d", color: "#808080", materialColors: [] },
    { placementId: "hidden-e", materialColors: ["#369D8D", "#3DCD9E"] },
    { placementId: "hidden-f", color: "#101010", materialColors: [] }
  ];
  const response = () => ({
    revision,
    placements,
    buttonCount: placements.length,
    colorCount: new Set(placements.flatMap(({ color, materialColors }) => color ? [color] : materialColors)).size,
    changedCount: placements.length,
    message: "Updated popped Button colors."
  });
  const applyResponse = (payload) => {
    const priorById = new Map(placements.map((placement) => [placement.placementId, placement]));
    placements = payload.assignments.map(({ placementId, color }) => color
      ? { placementId, color, materialColors: [] }
      : { placementId, materialColors: priorById.get(placementId)?.materialColors || [] });
    revision += 1;
    return response();
  };
  const refreshResponse = () => {
    revision += 1;
    return response();
  };
  const root = await renderThemePage({
    fields: {
      theme_image_path: imagePath,
      theme_palette_hexes: ["#FFFFFF"]
    },
    buttonTheme: {
      revision: 41,
      topColor: "#8FDB0A",
      bottomColor: "#141414",
      spread: 100,
      scatter: 20,
      seed: 7,
      gradientColorCount: 4,
      gradientColors: ["#8FDB0A", "#70A000", "#406000", "#141414"],
      screenTopToBottom: true,
      placements: [
        { placementId: "hidden-a", bucketId: "surface:#101010" },
        { placementId: "hidden-b", bucketId: "surface:#101010" },
        { placementId: "hidden-c", bucketId: "surface:#808080" },
        { placementId: "hidden-d", bucketId: "surface:#808080" },
        { placementId: "hidden-e", bucketId: "material:#369D8D|#3DCD9E" },
        { placementId: "hidden-f", bucketId: "surface:#101010" }
      ],
      buckets: [
        { id: "surface:#101010", kind: "surface", color: "#101010", materialColors: [] },
        { id: "surface:#808080", kind: "surface", color: "#808080", materialColors: [] },
        { id: "material:#369D8D|#3DCD9E", kind: "material", color: null, materialColors: ["#369D8D", "#3DCD9E"] }
      ]
    }
  }, {
    "theme.image.sample": ({ imagePath: requestedPath }) => ({
      selected: true,
      imagePath: requestedPath,
      paletteHexes: sampledColors
    }),
    "button-theme.apply": applyResponse,
    "button-theme.refill": (payload) => {
      placements = placements.map((placement, index) => ({
        placementId: placement.placementId,
        color: payload.colors[index % payload.colors.length],
        materialColors: []
      }));
      return refreshResponse();
    },
    "button-theme.toggle-text": refreshResponse,
    "button-theme.scan": () => ({ revision, placements, changedCount: 0, message: "Scanned popped Button colors." })
  });
  const actionRow = () => {
    const rows = root.querySelectorAll("div").filter(
      (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-actions")
    );
    assert.equal(rows.length, 1, "all popped Button actions must share one row");
    return rows[0];
  };
  const clickAction = async (label) => {
    const button = actionRow().children.find(
      (candidate) => candidate instanceof TestElement && candidate.tagName === "button" && candidate.textContent === label
    );
    assert.ok(button, `${label} must render in the popped Button action row`);
    button.click();
    await settlePageAction();
  };

  assert.deepEqual(
    actionRow().children
      .filter((candidate) => candidate instanceof TestElement && candidate.tagName === "button")
      .map((button) => button.textContent),
    ["Rescan", "Apply Buckets", "Refill", "Scatter", "Toggle Text"]
  );
  assert.equal(actionRow().querySelectorAll("input").length, 0, "the action row must contain only actions");
  const gradient = root.querySelectorAll("div").find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient")
  );
  assert.ok(gradient, "popped Button gradient controls must render");
  const stopRow = gradient.children.find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__stops")
  );
  assert.ok(stopRow, "ordered gradient stops must render together");
  const stopControls = () => stopRow.children.filter(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__color")
  );
  const stopLabels = () => stopControls().map((control) =>
    control.querySelectorAll("span").map(({ textContent }) => textContent).find(Boolean) || ""
  );
  const stopTextInputs = () => stopControls().map((control) =>
    control.querySelectorAll("input").find(({ type }) => type === "text")
  );
  const stopColorInputs = () => stopControls().map((control) =>
    control.querySelectorAll("input").find(({ type }) => type === "color")
  );
  assert.deepEqual(
    gradient.children.slice(1, 4).map((control) =>
      control.querySelectorAll("span").map(({ textContent }) => textContent).find(Boolean) || ""
    ),
    ["Gradient Colors", "Spread", "Scatter"],
    "Gradient Colors, Spread, and Scatter must follow the ordered stop row"
  );
  assert.deepEqual(stopLabels(), ["Start", "Color 2", "Color 3", "End"]);
  assert.deepEqual(stopTextInputs().map(({ value }) => value), ["#8FDB0A", "#70A000", "#406000", "#141414"]);
  assert.deepEqual(stopColorInputs().map(({ value }) => value), ["#8FDB0A", "#70A000", "#406000", "#141414"]);
  assert.deepEqual(
    stopTextInputs().map((input) => input["aria-label"]),
    ["Start color", "Color 2 color", "Color 3 color", "End color"]
  );
  const colorCountControl = gradient.children.find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__color-count")
  );
  const rangeInput = colorCountControl?.querySelectorAll("input").find(({ type }) => type === "range");
  const numberInput = colorCountControl?.querySelectorAll("input").find(({ type }) => type === "number");
  for (const input of [rangeInput, numberInput]) {
    assert.ok(input, "Gradient Colors must render synchronized range and number inputs");
    assert.equal(input.min, "2");
    assert.equal(input.max, "16");
    assert.equal(input.step, "1");
    assert.equal(input.value, "4", "owner-state gradientColorCount must hydrate both inputs");
  }
  rangeInput.value = "6";
  dispatch(rangeInput, "input");
  assert.equal(numberInput.value, "6");
  assert.equal(stopControls().length, 6, "changing Gradient Colors must immediately show every resampled stop");
  assert.equal(stopLabels()[0], "Start");
  assert.equal(stopLabels().at(-1), "End");
  numberInput.value = "3";
  dispatch(numberInput, "change");
  assert.equal(rangeInput.value, "3");
  assert.deepEqual(stopLabels(), ["Start", "Color 2", "End"]);
  const editedMiddlePicker = stopColorInputs()[1];
  editedMiddlePicker.value = "#0BADF0";
  dispatch(editedMiddlePicker, "input");
  assert.equal(stopTextInputs()[1].value, "#0BADF0", "an intermediate picker must update its visible hex field");
  const editedMiddleStop = stopTextInputs()[1];
  editedMiddleStop.value = "#ABCDEF";
  dispatch(editedMiddleStop, "change");

  const screenCheckboxControl = () => root.querySelectorAll("label").find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__screen-toggle")
  )?.children.find(
    (candidate) => candidate instanceof TestElement && candidate.tagName === "input" && candidate.type === "checkbox"
  );
  const screenCheckbox = screenCheckboxControl();
  assert.ok(screenCheckbox, "Screen Top-to-Bottom must render as a checkbox in the gradient controls");
  assert.equal(screenCheckbox.checked, true, "owner-state screen mode must hydrate the checkbox");

  await clickAction("Apply Buckets");
  const applyRequest = root.requests.filter(({ actionId }) => actionId === "button-theme.apply").at(-1);
  assert.equal(applyRequest.payload.expectedRevision, 41);
  assert.deepEqual(JSON.parse(JSON.stringify(applyRequest.payload.assignments)), [
    { placementId: "hidden-a", color: "#101010" },
    { placementId: "hidden-b", color: "#101010" },
    { placementId: "hidden-c", color: "#808080" },
    { placementId: "hidden-d", color: "#808080" },
    { placementId: "hidden-e" },
    { placementId: "hidden-f", color: "#101010" }
  ]);

  await clickPageButton(root, "Apply Gradient");
  const applyGradientRequest = root.requests.filter(
    ({ actionId }) => actionId === "button-theme.refill"
  ).at(-1);
  assert.equal(applyGradientRequest.payload.colors.length, 3);
  assert.equal(applyGradientRequest.payload.colors[0], "#8FDB0A");
  assert.equal(applyGradientRequest.payload.colors[1], "#ABCDEF");
  assert.equal(applyGradientRequest.payload.colors.at(-1), "#141414");
  assert.deepEqual(
    JSON.parse(JSON.stringify({ ...applyGradientRequest.payload, colors: undefined })),
    { spread: 100, scatter: 20, seed: 7, screenTopToBottom: true, angle: 0, curve: LINEAR_CURVE }
  );
  const liveScreenCheckbox = screenCheckboxControl();
  assert.notEqual(liveScreenCheckbox, screenCheckbox, "Apply Gradient must rerender live controls from the response");
  assert.equal(liveScreenCheckbox.checked, true);
  liveScreenCheckbox.checked = false;
  dispatch(liveScreenCheckbox, "change");

  const applyCountBeforeRefill = root.requests.filter(({ actionId }) => actionId === "button-theme.apply").length;
  const sampleCountBeforeRefill = root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length;
  await clickAction("Refill");
  const refillSampleRequest = root.requests.filter(({ actionId }) => actionId === "theme.image.sample").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(refillSampleRequest.payload)), { imagePath });
  assert.equal(
    root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length,
    sampleCountBeforeRefill + 1
  );
  const refillRequest = root.requests.filter(({ actionId }) => actionId === "button-theme.refill").at(-1);
  assert.equal(
    root.requests.filter(({ actionId }) => actionId === "button-theme.apply").length,
    applyCountBeforeRefill,
    "Refill must apply through the gradient Core action rather than revision-bound bucket assignments"
  );
  assert.deepEqual(JSON.parse(JSON.stringify(refillRequest.payload)), {
    colors: sampledColors.slice(0, 3),
    spread: 100,
    scatter: 20,
    seed: 8,
    screenTopToBottom: false,
    angle: 0,
    curve: LINEAR_CURVE
  });
  const refillColors = new Set(refillRequest.payload.colors);
  assert.equal(refillColors.size, 3, "Refill must use exactly the entered number of sampled image colors");
  assert.equal([...refillColors].every((color) => sampledColors.includes(color)), true);
  const gradientAfterRefill = root.querySelectorAll("div").find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient")
  );
  const endpointControls = gradientAfterRefill.querySelectorAll("label").filter(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__color")
  );
  const endpointText = (control) => control.querySelectorAll("input").find(({ type }) => type === "text")?.value;
  assert.equal(endpointText(endpointControls[0]), sampledColors[0], "Refill must update the visible Top color");
  assert.equal(endpointText(endpointControls[1]), sampledColors[1], "Refill must update the visible intermediate color");
  assert.equal(endpointText(endpointControls[2]), sampledColors[2], "Refill must update the visible Bottom color");

  const samplesBeforeReapply = root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length;
  await clickPageButton(root, "Apply Gradient");
  const reappliedGradient = root.requests.filter(({ actionId }) => actionId === "button-theme.refill").at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(reappliedGradient.payload.colors)), sampledColors.slice(0, 3));
  assert.equal(
    root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length,
    samplesBeforeReapply,
    "Apply Gradient must reuse the remembered gradient stops without sampling the image"
  );

  const sampleCountBeforeScatter = root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length;
  await clickAction("Scatter");
  const scatterRequest = root.requests.filter(({ actionId }) => actionId === "button-theme.apply").at(-1);
  assert.equal(scatterRequest.payload.expectedRevision, 45);
  assert.deepEqual(
    new Set(scatterRequest.payload.assignments.map(({ color }) => color)),
    refillColors,
    "Scatter must remix the aggregate colors currently present without resampling the image"
  );
  assert.equal(root.requests.filter(({ actionId }) => actionId === "theme.image.sample").length, sampleCountBeforeScatter);

  await clickAction("Toggle Text");
  const toggleTextRequest = root.requests.filter(
    ({ actionId }) => actionId === "button-theme.toggle-text"
  ).at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(toggleTextRequest.payload)), {});
  assert.equal(
    Object.hasOwn(toggleTextRequest.payload, "assignments"),
    false,
    "Toggle Text must resolve the live aggregate scope in Core without exposing placement identities"
  );

  await root.flushTimers();
  const persistedState = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1)?.payload?.state;
  assert.equal(persistedState.buttonTheme.gradientColorCount, 3);
  assert.deepEqual(
    JSON.parse(JSON.stringify(persistedState.buttonTheme.gradientColors)),
    sampledColors.slice(0, 3)
  );
  assert.equal(Object.hasOwn(persistedState.buttonTheme, "refillRange"), false);
  assert.equal(persistedState.buttonTheme.seed, 9);
  assert.equal(persistedState.buttonTheme.screenTopToBottom, false);
  assert.equal(Object.hasOwn(persistedState.buttonTheme, "nextTextColor"), false);
  assert.equal(Object.hasOwn(persistedState.buttonTheme, "textColor"), true);

  await clickAction("Rescan");
  assert.equal(root.requests.some(({ actionId }) => actionId === "theme.apply"), false);
  assert.equal(root.requests.some(({ actionId }) => actionId === "theme.apply-bucket"), false);
  assert.doesNotMatch(pageScript, /button-theme-(?:gradient|bucket)-actions/);
});

test("popped Button gradient migrates the legacy count and keeps edited endpoints in its ordered stops", async () => {
  let gradientRequest = null;
  const root = await renderThemePage({
    buttonTheme: {
      refillRange: 4,
      topColor: "#112233",
      bottomColor: "#DDEEFF",
      spread: 80,
      scatter: 15,
      seed: 6,
      placements: [],
      buckets: []
    }
  }, {
    "button-theme.refill": (payload) => {
      gradientRequest = JSON.parse(JSON.stringify(payload));
      return {
        revision: 2,
        placements: [],
        buttonCount: 0,
        colorCount: 0,
        changedCount: 0,
        message: "No open popped Buttons."
      };
    }
  });
  const countControl = root.querySelectorAll("label").find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__color-count")
  );
  const countNumber = countControl.querySelectorAll("input").find(({ type }) => type === "number");
  assert.equal(countNumber.value, "4", "legacy refillRange must hydrate Gradient Colors");

  const endpointControls = channelBox(root, "fill").querySelectorAll("label").filter(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-gradient__color")
  );
  const topInput = endpointControls[0].querySelectorAll("input").find(({ type }) => type === "text");
  const bottomInput = endpointControls.at(-1).querySelectorAll("input").find(({ type }) => type === "text");
  topInput.value = "#ABCDEF";
  dispatch(topInput, "change");
  bottomInput.value = "#FEDCBA";
  dispatch(bottomInput, "change");

  const applyGradient = root.querySelectorAll("button").find(({ textContent }) => textContent === "Apply Gradient");
  applyGradient.click();
  await settlePageAction();
  assert.equal(gradientRequest.colors.length, 4);
  assert.equal(gradientRequest.colors[0], "#ABCDEF");
  assert.equal(gradientRequest.colors.at(-1), "#FEDCBA");
  assert.equal(gradientRequest.seed, 6);

  await root.flushTimers();
  const persisted = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1)?.payload?.state;
  assert.equal(persisted.buttonTheme.gradientColorCount, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(persisted.buttonTheme.gradientColors)), gradientRequest.colors);
  assert.equal(Object.hasOwn(persisted.buttonTheme, "refillRange"), false);
});

test("changing popped gradient color count preserves chosen stops and sends the complete ordered palette", async () => {
  const gradientRequests = [];
  const root = await renderThemePage({
    buttonTheme: {
      gradientColorCount: 3,
      gradientColors: ["#FF0000", "#777777", "#0000FF"]
    }
  }, {
    "button-theme.refill": (payload) => {
      gradientRequests.push(plain(payload));
      return { revision: 1, placements: [], buttonCount: 0, colorCount: 0, changedCount: 0 };
    }
  });
  const stopInputs = () => root.querySelectorAll("div")
    .find((node) => node.className === "button-theme-gradient__stops")
    .querySelectorAll("input").filter(({ type }) => type === "text");
  const changeCount = (value) => {
    const count = root.querySelectorAll("input")
      .find((input) => input.type === "number" && input["aria-label"] === "Gradient Colors");
    count.value = String(value);
    dispatch(count, "change");
  };

  const middle = stopInputs()[1];
  middle.value = "#00FF00";
  dispatch(middle, "change");
  changeCount(4);
  const expandedColors = ["#FF0000", "#808000", "#00FF00", "#0000FF"];
  assert.deepEqual(stopInputs().map(({ value }) => value), expandedColors);
  await clickPageButton(root, "Apply Gradient");
  assert.deepEqual(gradientRequests[0].colors, expandedColors);

  changeCount(3);
  const reducedColors = ["#FF0000", "#00FF00", "#0000FF"];
  assert.deepEqual(stopInputs().map(({ value }) => value), reducedColors);
  await clickPageButton(root, "Apply Gradient");
  assert.deepEqual(gradientRequests[1].colors, reducedColors);
  await root.flushTimers();
  const persisted = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.equal(persisted.buttonTheme.gradientColorCount, 3);
  assert.deepEqual(plain(persisted.buttonTheme.gradientColors), reducedColors);
});

test("popped Button Refill fails closed when the Theme image has too few distinct gradient colors", async () => {
  const priorColors = ["#112233", "#445566", "#778899", "#AABBCC"];
  const gradientRequests = [];
  const root = await renderThemePage({
    fields: { theme_image_path: "C:\\Themes\\limited.png" },
    buttonTheme: {
      gradientColorCount: 4,
      gradientColors: priorColors,
      topColor: priorColors[0],
      bottomColor: priorColors.at(-1),
      spread: 90,
      scatter: 10,
      seed: 12,
      placements: [],
      buckets: []
    }
  }, {
    "theme.image.sample": () => ({
      selected: true,
      imagePath: "C:\\Themes\\limited.png",
      paletteHexes: ["#010203", "#A0B0C0"]
    }),
    "button-theme.refill": (payload) => {
      gradientRequests.push(JSON.parse(JSON.stringify(payload)));
      return {
        revision: 3,
        placements: [],
        buttonCount: 0,
        colorCount: 0,
        changedCount: 0,
        message: "No open popped Buttons."
      };
    }
  });
  const actionRow = root.querySelectorAll("div").find(
    (candidate) => String(candidate.className || "").split(/\s+/).includes("button-theme-actions")
  );
  const action = (label) => actionRow.querySelectorAll("button").find(({ textContent }) => textContent === label);
  action("Refill").click();
  await settlePageAction();
  assert.equal(gradientRequests.length, 0, "too few sampled colors must not invoke the gradient apply");
  assert.match(root.status.textContent, /only 2 distinct colors.*Lower Gradient Colors/i);

  toolButton(channelBox(root, "fill"), "Apply Gradient").click();
  await settlePageAction();
  assert.equal(gradientRequests.length, 1);
  assert.deepEqual(gradientRequests[0].colors, priorColors, "failed Refill must retain the prior gradient colors");
  assert.equal(gradientRequests[0].seed, 12, "failed Refill must not advance the stable scatter seed");
});

test("popped Button scatter remembers colors by hidden placement identity", async () => {
  const placementIds = ["hidden-a", "hidden-b", "hidden-c", "hidden-d", "hidden-e", "hidden-f"];
  const buckets = [
    { id: "surface:#112233", kind: "surface", color: "#112233", materialColors: [] },
    { id: "surface:#445566", kind: "surface", color: "#445566", materialColors: [] },
    { id: "surface:#778899", kind: "surface", color: "#778899", materialColors: [] }
  ];
  const scatterForOrder = async (orderedIds) => {
    let capturedRequest = null;
    const root = await renderThemePage({
      buttonTheme: {
        revision: 70,
        seed: 12,
        refillRange: 5,
        placements: orderedIds.map((placementId, index) => ({
          placementId,
          bucketId: buckets[index % buckets.length].id
        })),
        buckets
      }
    }, {
      "button-theme.apply": (payload) => {
        capturedRequest = JSON.parse(JSON.stringify(payload));
        return {
          revision: 71,
          placements: payload.assignments.map(({ placementId, color }) => ({ placementId, color, materialColors: [] })),
          buttonCount: payload.assignments.length,
          colorCount: new Set(payload.assignments.map(({ color }) => color)).size,
          changedCount: payload.assignments.length,
          message: "Scattered popped Button colors."
        };
      }
    });
    const button = root.querySelectorAll("button").find(({ textContent }) => textContent === "Scatter");
    assert.ok(button);
    button.click();
    await settlePageAction();
    assert.equal(capturedRequest.expectedRevision, 70);
    return Object.fromEntries(
      capturedRequest.assignments
        .map(({ placementId, color }) => [placementId, color])
        .sort(([left], [right]) => left.localeCompare(right))
    );
  };

  const forward = await scatterForOrder(placementIds);
  const reversed = await scatterForOrder([...placementIds].reverse());
  assert.deepEqual(reversed, forward, "placement order must not change a Button identity's scattered color");
  assert.deepEqual(new Set(Object.values(forward)), new Set(buckets.map(({ color }) => color)));
});

test("all existing Theme fields, buckets, and mappings are package-owned", () => {
  assert.equal(fieldById.size, page.config.fields.length);
  const expectedBuckets = [
    "tabs_hex",
    "headers_hex",
    "editor_background_hex",
    "scene_hex",
    "controls_hex",
    "tabs_text_hex",
    "header_text_hex",
    "text_hex",
    "control_text_hex",
    "accent_text_hex",
    "highlights_hex",
    "viewport_background_hex",
    "viewport_gradient_hex"
  ];
  assert.deepEqual(page.config.roles.map((role) => role.bucket), expectedBuckets);
  for (const role of page.config.roles) {
    assert.ok(fieldById.has(role.fieldId));
    assert.match(blenderSource, new RegExp(`['\"]${role.bucket}['\"]`));
  }
  const applyBucketSchema = actionById.get("theme.apply-bucket").requestSchema;
  assert.deepEqual(applyBucketSchema.properties.bucket.enum, expectedBuckets);
  for (const fieldId of Object.values(page.config.payloadMaps.theme)) {
    assert.ok(fieldById.has(fieldId), `theme payload maps unknown field ${fieldId}`);
  }
  for (const fieldId of page.config.persistence.fieldIds) assert.ok(fieldById.has(fieldId));
  for (const fieldId of page.config.persistence.packageFieldIds) assert.ok(fieldById.has(fieldId));
  for (const fieldId of page.config.persistence.assetFieldIds) assert.ok(fieldById.has(fieldId));
});

test("the package restores the original Theme wording", () => {
  assert.deepEqual(
    Object.fromEntries(page.config.roles.map((role) => [role.id, role.label])),
    {
      tabs: "Tab Fill",
      headers: "Header",
      editor: "Panel",
      scene: "Collection Row",
      controls: "Control Fill",
      tab_text: "Tab text",
      header_text: "Header text",
      text: "random text",
      control_text: "tool text",
      accent_text: "scene/header text",
      highlights: "Highlights",
      viewport: "Viewport BG",
      viewport_gradient: "Gradient 2"
    }
  );
  assert.deepEqual(
    Object.fromEntries([
      "theme.absorb",
      "theme.fields.save",
      "theme.fields.load",
      "theme.package.open",
      "theme.mode.dark",
      "theme.mode.light",
      "picture.apply",
      "picture.grid",
      "picture.grid.remove",
      "environment.file.select",
      "environment.apply",
      "environment.clear",
      "environment.reset"
    ].map((actionId) => [actionId, page.config.actionLabels[actionId]])),
    {
      "theme.absorb": "Absorb Theme",
      "theme.fields.save": "Save Buckets",
      "theme.fields.load": "Load Buckets",
      "theme.package.open": "Open Package",
      "theme.mode.dark": "Dark Theme",
      "theme.mode.light": "Light Theme",
      "picture.apply": "Place Picture",
      "picture.grid": "Grid",
      "picture.grid.remove": "Remove Grid",
      "environment.file.select": "HDRI Browse",
      "environment.apply": "HDRI Apply",
      "environment.clear": "Clear",
      "environment.reset": "Reset"
    }
  );
});

test("every rendered Theme button restores an explanatory tooltip", async () => {
  assert.deepEqual(page.config.actionTooltips, {
    "theme.image.select": "Pick an image, sample theme colors, and place it as the Place Picture image.",
    "theme.image.sample": "Sample theme colors from the selected reference image.",
    "theme.absorb": "Read the current Blender theme and stage all visible buckets.",
    "theme.refill": "Randomly remix the staged sampled colors into a different bucket set and apply it.",
    "theme.fields.save": "Save the current staged Blender theme buckets for later reuse.",
    "theme.fields.load": "Load saved Blender theme buckets back into this page.",
    "theme.package.save": "Save the theme images, staged Blender colors, and current popped Button fill and text gradients, highlights and glow with this package.",
    "theme.package.open": "Pick a saved theme package, or browse for one.",
    "theme.package.previous": "Load the previous saved theme package.",
    "theme.package.next": "Load the next saved theme package.",
    "theme.mode.dark": "Stage a dark theme preset on this page. Apply sends it to Blender.",
    "theme.mode.light": "Stage a light theme preset on this page. Apply sends it to Blender.",
    "theme.profile.save": "Save the current darkness settings under the entered profile name.",
    "theme.apply": "Apply the currently visible theme role colors.",
    "theme.apply-bucket": "Apply only this theme bucket.",
    "button-theme.scan": "Collect and group Surface colors from scoped action Buttons in open Blender Pop-out and Fan windows. Fans include their surface owner and members even while collapsed; editor previews remain excluded.",
    "button-theme.apply": "Apply the edited aggregate Surface buckets back to the same live scanned Buttons; Rescan is required if the open windows changed.",
    "button-theme.apply-gradient": "Apply the Button Fill gradient to scoped Buttons in the currently open Blender Pop-outs and Fans, including each Fan surface owner and every member while collapsed or expanded. Colors run from Start to End along the Angle (0 degrees is top to bottom) and the curve reshapes how quickly they change. Whole Layout anchors vertically to the highest and lowest visible Buttons on each monitor; otherwise Angle applies within each window. Every selected color stop stays exact. Spread controls blend width and Scatter varies interior colors.",
    "button-theme.apply-text": "Apply the Button Text gradient to every Blender popped Button label, independently of the fill. One Text Color keeps the labels solid; more colors run from Start to End along the text Angle and curve.",
    "button-theme.refill": "Apply the ordered multi-color Surface gradient, with its angle and curve, to scoped Buttons in the currently open Blender Pop-outs and Fans.",
    "button-theme.refill-colors": "Sample the selected number of Gradient Colors from the current Theme image, show them as ordered gradient stops, and apply the gradient to scoped Buttons in open Blender Pop-outs and Fans.",
    "button-theme.scatter": "Redistribute the currently present aggregate colors across the same live scanned Buttons using remembered hidden placement IDs.",
    "button-theme.toggle-text": "Toggle all scoped Button label text in open Blender Pop-outs and Fans between black and white, replacing any text gradient, without changing Surface colors or saved skins.",
    "button-theme.settings": "Apply separate Regular, Hover, and Active highlights and glow to Blender buttons. Regular applies only while neither hovered nor active. Saved packages include all three groups.",
    "picture.file.select": "Pick a Place Picture image.",
    "picture.apply": "Place the picture path in the Blender viewport with the overlay.",
    "picture.grid": "Apply Grid Scale and Subdivisions and enable Blender's native viewport grid.",
    "picture.grid.remove": "Hide Blender's native grid; keep any Place Picture image and gizmos active.",
    "picture.startup": "Save the current Place Picture image so Blender restores it on startup.",
    "picture.clear": "Remove the Place Picture background, grid, and gizmos, and clear the picture path.",
    "environment.file.select": "Pick an HDRI file.",
    "environment.apply": "Apply the HDRI path in the field.",
    "environment.clear": "Clear the current HDRI world from this file.",
    "environment.reset": "Rebuild a clean Blender world for this file and reapply the current HDRI values.",
    "environment.rotation-x": "Apply the entered X rotation.",
    "environment.rotation-y": "Apply the entered Y rotation.",
    "environment.rotation-z": "Apply the entered Z rotation.",
    "environment.strength": "Apply the entered world strength."
  });
  assert.deepEqual(
    Object.keys(page.config.actionTooltips).sort(),
    Object.keys(page.config.actionLabels).sort()
  );
  assert.equal(
    Object.values(page.config.actionTooltips).every((tooltip) => typeof tooltip === "string" && tooltip.trim()),
    true
  );
  assert.equal(
    (pageScript.match(/element\("button"/g) || []).length,
    2,
    "all Theme buttons must use actionButton or the tooltip-requiring curve tool helper"
  );

  const root = await renderThemePage();
  const buttons = root.querySelectorAll("button");
  // Grid visibility and spacing apply directly through their inputs.
  assert.equal(buttons.length, 28 + 2 * 17 + page.config.roles.length + page.config.environment.valueFields.length);
  assert.deepEqual(
    buttons.flatMap((button, index) => button.title.trim() ? [] : [`${index}: ${button.textContent}`]),
    []
  );
  assert.deepEqual(
    buttons
      .filter((button) => button.title.startsWith("Apply only the "))
      .map((button) => button.title),
    page.config.roles.map((role) => `Apply only the ${role.label} bucket.`)
  );
  const checkboxes = root.querySelectorAll("input").filter((input) => input.type === "checkbox");
  const gradientRole = root.querySelectorAll("div").find((node) => node.title === "Gradient 2");
  assert.equal(checkboxes.length, 8);
  assert.ok(gradientRole);
  assert.equal(gradientRole.querySelectorAll("input").filter((input) => input.type === "checkbox").length, 1);
  assert.equal(
    root.querySelectorAll("span").filter((node) => node.textContent === "Whole Layout").length === 2,
    true
  );
  assert.equal(root.querySelectorAll("span").some((node) => node.textContent === page.config.gradient.label), false);
});

test("every program action resolves to an existing fixed theme.py command", () => {
  const expectedCommands = [
    "status",
    "absorb_theme",
    "apply_theme_from_photo_manual_colors",
    "apply_theme_bucket",
    "place_picture",
    "set_grid_spacing",
    "remove_grid",
    "set_place_picture_startup",
    "clear_place_picture",
    "set_hdri_path",
    "clear_world",
    "reset_world",
    "set_rotation_x",
    "set_rotation_y",
    "set_rotation_z",
    "set_world_strength",
    "read_project_startup_state",
    "restore_project_startup_state",
    "read_place_picture_runtime_state"
  ];
  const declaredCommands = page.actions
    .filter((action) => action.handler.kind === "program")
    .map((action) => action.handler.payload.command);
  assert.deepEqual(declaredCommands, expectedCommands);
  assert.match(blenderSource, /def run_flowcell_action\(/);
  for (const command of expectedCommands) {
    assert.ok(blenderSource.includes(`"${command}"`), `theme.py must declare ${command}`);
  }
  for (const legacyCommand of [
    "read_startup_state",
    "restore_startup_state",
    "set_static_background_image",
    "apply_all"
  ]) {
    assert.equal(blenderSource.includes(`"${legacyCommand}"`), false);
  }
});

test("package page has no direct privileged or legacy Core UI path", () => {
  const pageFiles = `${pageHtml}\n${pageCss}\n${pageScript}`;
  const forbiddenApis = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /@tauri-apps/,
    /\binvoke\s*\(/,
    /\bwindow\.open\s*\(/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bimport\s*\(/,
    /\brequire\s*\(/
  ];
  for (const pattern of forbiddenApis) assert.doesNotMatch(pageFiles, pattern);
  assert.match(pageScript, /window\.flowcellPage/);
  assert.match(pageScript, /pageApi\.request\(/);
  assert.match(pageHtml, /default-src 'none'/);
  assert.match(pageHtml, /connect-src 'none'/);
  assert.doesNotMatch(pageHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);

  const newPackage = `${JSON.stringify(manifest)}\n${pageFiles}`;
  for (const legacyIdentifier of [
    "theme-workbench",
    "ThemeWorkbench",
    "open-tool-page",
    "sample-blender-theme-image",
    "open-blender-theme",
    "theme.legacy-profiles.read",
    "legacy-state.read",
    "theme-legacy-state",
    "legacyProfiles",
    "readLegacyProfiles",
    "completedMigrationIds"
  ]) {
    assert.equal(newPackage.includes(legacyIdentifier), false, `new package must not use ${legacyIdentifier}`);
  }
});

test("package page is headerless and keeps Theme plus Place Picture compact", () => {
  assert.deepEqual(page.window, {
    title: "Blender Theme",
    width: 920,
    height: 720,
    minWidth: 920,
    minHeight: 560
  });
  assert.match(pageCss, /body\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(pageCss, /\.theme-page\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(pageCss, /\.theme-page\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(pageCss, /\.theme-role-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
  assert.equal((pageCss.match(/\.theme-role-grid\s*\{/g) || []).length, 1);
  assert.match(
    pageCss,
    /\.theme-role\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 22px 58px 36px;[\s\S]*min-height:\s*40px;/
  );
  assert.match(pageCss, /\.theme-role__label-row\s*\{[\s\S]*display:\s*flex;/);
  assert.match(pageCss, /\.theme-role__label\s*\{[\s\S]*word-break:\s*normal;/);
  assert.doesNotMatch(pageCss, /(^|\n)\.theme-gradient\b/);
  assert.match(pageCss, /\.button-theme-gradient\s*[,\{][\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(
    pageCss,
    /\.button-theme-gradient__stops\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;[\s\S]*display:\s*flex;[\s\S]*overflow-x:\s*auto;/
  );
  assert.match(pageCss, /\.button-theme-gradient__stops\s*>\s*\.button-theme-gradient__color\s*\{[\s\S]*flex:\s*1\s+0\s+104px;/);
  assert.match(pageCss, /\.button-theme-actions\s*\{[\s\S]*flex-wrap:\s*nowrap;/);
  assert.match(pageCss, /\.button-theme-gradient__color-count\s*\{/);
  assert.match(pageCss, /\.button-theme-gradient__color-count-inputs[^\{]*input\[type="number"\]\s*\{/);
  assert.doesNotMatch(pageCss, /\.button-theme-refill-range/);
  assert.match(pageCss, /\.button-theme-gradient__screen-toggle\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;/);
  assert.match(pageCss, /\.theme-profiles\s*\{\s*display:\s*contents;/);
  assert.match(
    pageCss,
    /\.theme-grid-controls\s*\{[\s\S]*grid-column:\s*span 3;/
  );
  assert.doesNotMatch(pageCss, /scrollbar-width:\s*none;/);
  assert.doesNotMatch(pageCss, /\.theme-page__header/);
  assert.doesNotMatch(pageScript, /function renderHeader\(/);
  assert.doesNotMatch(pageScript, /theme-page__columns/);
  assert.equal("eyebrow" in page.config.copy, false);
  assert.equal("title" in page.config.copy, false);
  assert.equal("subtitle" in page.config.copy, false);
  assert.match(
    pageScript,
    /root\.append\(\s*renderThemeCard\(\),\s*renderButtonThemeCard\(\),\s*renderPictureCard\(\),\s*renderEnvironmentCard\(\)/
  );
  assert.match(pageScript, /const grid = element\("div", "theme-role-grid"\);\s*roles\.forEach/);
  assert.match(pageScript, /role\.fieldId === config\.gradient\.gradientFieldId/);
  assert.match(pageScript, /gradientCheckbox\.setAttribute\("aria-label", config\.gradient\.label\)/);
  assert.doesNotMatch(pageScript, /element\("label", "theme-gradient"\)/);

  const renderToneStart = pageScript.indexOf("function renderToneControls(");
  const renderRolesStart = pageScript.indexOf("function renderRoleGroups(");
  const renderThemeStart = pageScript.indexOf("function renderThemeCard(");
  const renderPictureStart = pageScript.indexOf("function renderPictureCard(");
  assert.ok(renderToneStart >= 0 && renderRolesStart > renderToneStart);
  assert.ok(renderThemeStart >= 0 && renderPictureStart > renderThemeStart);
  const renderToneSource = pageScript.slice(renderToneStart, renderRolesStart);
  const renderThemeSource = pageScript.slice(renderThemeStart, renderPictureStart);
  assert.match(renderToneSource, /row\.append\(tone, actionButton\(actions\.theme\.apply, applyTheme\)\)/);
  assert.match(renderToneSource, /profiles\.append\(select, nameInput, saveButton\);\s*storage\.append\(profiles\);/);
  assert.ok(renderThemeSource.indexOf("actions.theme.loadFields") < renderThemeSource.indexOf("renderToneControls(section, storage)"));
  assert.doesNotMatch(renderThemeSource, /applyRow/);
});

test("native Grid exposes native settings while retaining hidden legacy saved values", async () => {
  const legacyGrid = { grid_spacing_m: 0.25, grid_distance_m: 17, grid_far_spacing_m: 3 };
  const root = await renderThemePage({ fields: legacyGrid }, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "theme.package.save": { saved: true, packagePath: "C:\\Themes\\legacy.json", packageName: "Legacy" }
  });
  assert.deepEqual(page.config.picture.gridFieldIds, ["grid_scale", "grid_subdivisions"]);
  assert.equal(root.querySelectorAll("div").find((node) => node.className === "theme-grid-controls").children.length, 3);
  assert.equal(root.querySelectorAll("span").some((node) => ["Near grid", "Distance", "Far grid"].includes(node.textContent)), false);
  assert.equal(page.config.copy.applyingGrid, "Applying Blender's native grid settings…");
  assert.equal(page.config.copy.removingGrid, "Hiding Blender's native grid...");

  for (const fieldId of Object.keys(legacyGrid)) {
    assert.ok(fieldById.has(fieldId), `retain legacy ${fieldId} state`);
    assert.ok(page.config.persistence.fieldIds.includes(fieldId));
    assert.ok(page.config.persistence.packageFieldIds.includes(fieldId));
    assert.equal(page.config.payloadMaps.picture[fieldId], fieldId);
    for (const actionId of ["theme.package.open", "theme.package.previous", "theme.package.next"]) {
      assert.equal(actionById.get(actionId).responseSchema.properties.fieldPatch.properties[fieldId].type, "number");
    }
  }
  for (const [label, actionId] of [["Grid", "picture.grid"], ["Save Buckets", "theme.fields.save"], ["Save Package", "theme.package.save"]]) {
    if (label === "Grid") {
      const checkbox = root.querySelectorAll("input").find((input) => input["aria-label"] === "Grid");
      checkbox.checked = true;
      dispatch(checkbox, "change");
      await settlePageAction();
    } else await clickPageButton(root, label);
    const request = root.requests.find((candidate) => candidate.actionId === actionId);
    assert.ok(request, `retain ${label} action`);
    const values = request.payload.values || request.payload;
    assert.deepEqual(Object.fromEntries(Object.keys(legacyGrid).map((fieldId) => [fieldId, values[fieldId]])), legacyGrid);
  }
  await root.flushTimers();
  const savedState = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.deepEqual(Object.fromEntries(Object.keys(legacyGrid).map((fieldId) => [fieldId, savedState.fields[fieldId]])), legacyGrid);
});

test("native grid fields stay optional for legacy clients and travel with saved fields and packages", () => {
  for (const [fieldId, type, minimum, maximum, defaultValue] of [
    ["grid_scale", "number", 0.001, 1000, 0.01],
    ["grid_subdivisions", "integer", 2, 100, 10]
  ]) {
    const field = fieldById.get(fieldId);
    assert.equal(field.defaultValue, defaultValue);
    assert.equal(field.minimum, minimum);
    assert.equal(field.maximum, maximum);
    assert.ok(page.config.persistence.fieldIds.includes(fieldId));
    assert.ok(page.config.persistence.packageFieldIds.includes(fieldId));
    assert.equal(page.config.payloadMaps.picture[fieldId], fieldId);
    for (const actionId of ["picture.apply", "picture.grid", "picture.startup"]) {
      const schema = actionById.get(actionId).requestSchema;
      assert.deepEqual(schema.properties[fieldId], { type });
      assert.equal(schema.required.includes(fieldId), false, `${actionId} must accept legacy callers`);
    }
    for (const actionId of ["theme.fields.save", "theme.fields.load", "theme.package.save", "theme.package.open", "theme.package.previous", "theme.package.next"]) {
      const action = actionById.get(actionId);
      assert.ok(action.handler.options.valueFields.includes(fieldId), `${actionId} keeps ${fieldId}`);
      const schema = actionId.endsWith(".save")
        ? action.requestSchema.properties.values
        : action.responseSchema.properties.fieldPatch;
      assert.deepEqual(schema.properties[fieldId], { type });
      assert.equal((schema.required || []).includes(fieldId), false);
    }
    for (const actionId of ["picture.apply", "picture.grid", "picture.startup", "runtime.read-picture-state"]) {
      const schema = actionById.get(actionId).responseSchema;
      assert.deepEqual(schema.properties[fieldId], { type });
    }
  }
  assert.match(page.config.picture.gridHelp, /finer squares.*minor lines fade before major lines/);
  assert.match(page.config.picture.gridHelp, /Scene Units is None.*Metric\/Imperial/);
});

test("native grid controls normalize values, adopt Blender results and persist them", async () => {
  const root = await renderThemePage({ fields: { grid_enabled: false, grid_scale: 0.01, grid_subdivisions: 20 } }, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "picture.grid": { grid_scale: 0.003, grid_subdivisions: 8, grid_enabled: true },
    "theme.package.save": { saved: true, packagePath: "C:\\Themes\\fine.json", packageName: "Fine" }
  });
  const control = (label) => root.querySelectorAll("label")
    .find((candidate) => candidate.querySelectorAll("span").some((span) => span.textContent === label))
    .querySelectorAll("input")[0];
  const scale = control("Grid Scale");
  const subdivisions = control("Subdivisions (unitless)");
  assert.equal(scale.value, "0.01");
  assert.equal(scale.min, "0.001");
  assert.equal(scale.max, "1000");
  assert.equal(subdivisions.value, "20");
  assert.equal(subdivisions.min, "2");
  assert.equal(subdivisions.max, "100");
  for (const [input, value, expected] of [
    [scale, "0", "0.001"], [scale, "2000", "1000"], [scale, "0.0025", "0.0025"],
    [subdivisions, "1", "2"], [subdivisions, "200", "100"], [subdivisions, "4.6", "5"]
  ]) {
    input.value = value;
    dispatch(input, "change");
    assert.equal(input.value, expected);
  }
  assert.equal(root.requests.some(({ actionId }) => actionId === "picture.grid"), false, "spacing edits keep an unchecked grid off");
  const checkbox = root.querySelectorAll("input").find((input) => input["aria-label"] === "Grid");
  checkbox.checked = true;
  dispatch(checkbox, "change");
  await settlePageAction();
  const gridRequest = root.requests.find(({ actionId }) => actionId === "picture.grid");
  assert.equal(gridRequest.payload.grid_scale, 0.0025);
  assert.equal(gridRequest.payload.grid_subdivisions, 5);
  assert.equal(control("Grid Scale").value, "0.003");
  assert.equal(control("Subdivisions (unitless)").value, "8");
  for (const [label, actionId] of [["Save Buckets", "theme.fields.save"], ["Save Package", "theme.package.save"]]) {
    await clickPageButton(root, label);
    const request = root.requests.find((candidate) => candidate.actionId === actionId);
    const values = request.payload.values || request.payload;
    assert.equal(values.grid_scale, 0.003, `${actionId} saves applied scale`);
    assert.equal(values.grid_subdivisions, 8, `${actionId} saves applied subdivisions`);
  }
  await root.flushTimers();
  const saved = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state.fields;
  assert.equal(saved.grid_scale, 0.003);
  assert.equal(saved.grid_subdivisions, 8);
});

test("loading a package applies its native grid scale with its picture", async () => {
  const root = await renderThemePage({ fields: { grid_scale: 1, grid_subdivisions: 10 } }, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "theme.package.open": {
      selected: true, packagePath: "C:\\Themes\\fine.json", packageName: "Fine",
      fieldPatch: { static_background_path: "C:\\Themes\\fine.png", grid_scale: 0.005, grid_subdivisions: 5 }
    }
  });
  await clickPageButton(root, "Open Package");
  const request = root.requests.find(({ actionId }) => actionId === "picture.apply");
  assert.equal(request.payload.static_background_path, "C:\\Themes\\fine.png");
  assert.equal(request.payload.grid_scale, 0.005);
  assert.equal(request.payload.grid_subdivisions, 5);
});

test("older saved fields and packages adopt the current grid defaults", async () => {
  for (const [label, actionId] of [["Load Buckets", "theme.fields.load"], ["Open Package", "theme.package.open"], ["Previous", "theme.package.previous"], ["Next", "theme.package.next"]]) {
    for (const storedGrid of [{}, { grid_scale: 0.2 }, { grid_subdivisions: 4 }]) {
      const root = await renderThemePage({ fields: { grid_scale: 0.005, grid_subdivisions: 20 } }, {
        "button-theme.settings": { settings: poppedSettings(), configured: true },
        [actionId]: {
          selected: true, packagePath: "C:\\Themes\\older.json", packageName: "Older",
          fieldPatch: { static_background_path: "C:\\Themes\\older.png", ...storedGrid }
        }
      });
      await clickPageButton(root, label);
      await root.flushTimers();
      const fields = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state.fields;
      assert.equal(fields.grid_scale, storedGrid.grid_scale ?? 0.01, `${label} resets missing scale`);
      assert.equal(fields.grid_subdivisions, storedGrid.grid_subdivisions ?? 10, `${label} resets missing subdivisions`);
      assert.equal(fields.grid_enabled, true);
      assert.equal(root.requests.some(({ actionId }) => actionId === "picture.grid"), false);
      const picture = root.requests.find(({ actionId }) => actionId === "picture.apply");
      if (actionId === "theme.fields.load") assert.equal(picture, undefined, "loading fields only stages settings");
      else {
        assert.equal(picture.payload.grid_scale, storedGrid.grid_scale ?? 0.01);
        assert.equal(picture.payload.grid_subdivisions, storedGrid.grid_subdivisions ?? 10);
        assert.equal(picture.payload.grid_enabled, true);
      }
    }
  }
});

test("cancelled or failed saved-field loads preserve the current native grid settings", async () => {
  for (const [label, actionId] of [["Load Buckets", "theme.fields.load"], ["Open Package", "theme.package.open"], ["Previous", "theme.package.previous"], ["Next", "theme.package.next"]]) {
    for (const response of [{ selected: false, fieldPatch: {} }, () => { throw new Error("Load failed"); }]) {
      const root = await renderThemePage({ fields: { grid_scale: 0.005, grid_subdivisions: 20 } }, {
        "button-theme.settings": { settings: poppedSettings(), configured: true },
        [actionId]: response
      });
      await clickPageButton(root, label);
      await clickPageButton(root, "Save Buckets");
      const fields = root.requests.find(({ actionId }) => actionId === "theme.fields.save").payload.values;
      assert.equal(fields.grid_scale, 0.005);
      assert.equal(fields.grid_subdivisions, 20);
      assert.equal(root.requests.some(({ actionId }) => actionId === "picture.grid" || actionId === "picture.apply"), false);
    }
  }
});

test("Remove Grid preserves the picture and the startup bundle stays atomic", () => {
  assert.equal(page.config.actions.picture.removeGrid, "picture.grid.remove");
  assert.match(
    pageScript,
    /enabled \? actions\.picture\.grid : actions\.picture\.removeGrid/
  );

  const removeGridStart = blenderSource.indexOf("def _remove_place_picture_grid(");
  const clearPictureStart = blenderSource.indexOf("def _clear_place_picture_overlay(");
  assert.ok(removeGridStart >= 0 && clearPictureStart > removeGridStart);
  const removeGridSource = blenderSource.slice(removeGridStart, clearPictureStart);
  assert.match(removeGridSource, /state\["grid_enabled"\] = False/);
  assert.match(removeGridSource, /_set_native_grid_visibility\(False\)/);
  assert.doesNotMatch(removeGridSource, /_remove_viewport_overlay_handler|_clear_place_picture_overlay|_disable_camera_background_images|_set_saved_overlay_path/);
  const nativeGridStart = blenderSource.indexOf("def _set_native_grid_visibility(");
  const viewportSettingsStart = blenderSource.indexOf("def _apply_place_picture_viewport_settings(");
  assert.ok(nativeGridStart >= 0 && viewportSettingsStart > nativeGridStart);
  const nativeGridSource = blenderSource.slice(nativeGridStart, viewportSettingsStart);
  for (const attribute of ["show_floor", "show_ortho_grid", "show_axis_x", "show_axis_y"]) {
    assert.ok(nativeGridSource.includes(`"${attribute}"`));
  }
  assert.match(nativeGridSource, /_safe_set\(overlay, attr, bool\(enabled\)\)/);
  const gizmoDrawStart = blenderSource.indexOf("    def draw_grid_and_gizmo_overlay():");
  assert.ok(gizmoDrawStart >= 0);
  const gizmoDraw = blenderSource.slice(gizmoDrawStart, blenderSource.indexOf('    state["draw_background_image"]', gizmoDrawStart));
  assert.match(gizmoDraw, /_draw_fake_gizmos_2d/);
  assert.doesNotMatch(gizmoDraw, /_draw_fake_grid_/);
  assert.doesNotMatch(blenderSource, /def draw_grid_overlay\(/);
  assert.match(blenderSource, /state\["grid_handler"\] = None/);

  const loadPackageStart = pageScript.indexOf("async function loadPackage(");
  const selectFileStart = pageScript.indexOf("async function selectFile(");
  assert.ok(loadPackageStart >= 0 && selectFileStart > loadPackageStart);
  const loadPackageSource = pageScript.slice(loadPackageStart, selectFileStart);
  assert.ok(loadPackageSource.indexOf("await applyPicture(true)") < loadPackageSource.indexOf("await applyTheme(true)"));
  assert.ok(loadPackageSource.indexOf("actions.picture.clear") < loadPackageSource.indexOf("await applyTheme(true)"));
  assert.match(loadPackageSource, /if \(!pictureResponse\) return;/);
  assert.match(
    blenderSource,
    /startup_state\["place_picture"\] = _startup_place_picture_state_from_runtime\(context\)/
  );
  assert.match(blenderSource, /"saved_by": "theme_bundle"/);
  assert.match(blenderSource, /\{"startup_button", "theme_bundle"\}/);
});

test("packages declare only portable popped settings, without placement identity or the temporary lock", () => {
  const settingsAction = actionById.get("button-theme.settings");
  assert.equal(settingsAction.handler.options.operation, "settings");
  const schema = settingsAction.requestSchema.properties.settings;
  const shapeKeys = ["angle", "curve", "textAngle", "textColors", "textCurve", "textScreenTopToBottom"];
  assert.deepEqual(Object.keys(schema.properties).sort(), [...Object.keys(poppedSettings()), ...shapeKeys].sort());
  assert.deepEqual([...schema.required].sort(), Object.keys(poppedSettings()).filter((key) => !key.startsWith("idle")).sort(), "older packages stay valid");
  assert.deepEqual(schema.properties.curve.items.properties.mode.enum, ["auto", "corner", "aligned", "free"]);
  assert.equal(schema.additionalProperties, false);
  for (const actionId of ["theme.package.save", "theme.package.open", "theme.package.previous", "theme.package.next"]) {
    const action = actionById.get(actionId);
    assert.ok(action.handler.options.valueFields.includes("popped_button_settings"));
    const valuesSchema = actionId.endsWith("save")
      ? action.requestSchema.properties.values
      : action.responseSchema.properties.fieldPatch;
    assert.deepEqual(valuesSchema.properties.popped_button_settings, schema);
    assert.equal(JSON.stringify(schema).includes("placementId"), false);
    assert.equal(JSON.stringify(schema).includes("lockSettings"), false);
  }
});

test("first use promotes the saved popped gradient over captured live effects, while configured settings win on reopen", async () => {
  const writes = [];
  const captured = poppedSettings({ colors: ["#FFFFFF"], hoverGlowAmount: 17, hoverColor: "#FFFFFFCC", activeColor: "#FFFFFFCC" });
  const owner = {
    buttonTheme: {
      gradientColorCount: 2, gradientColors: ["#ABCDEF", "#102030"],
      spread: 38, scatter: 9, seed: 18, screenTopToBottom: false
    }
  };
  const root = await renderThemePage(owner, {
    "button-theme.settings": (payload) => {
      if (payload.settings) writes.push(plain(payload.settings));
      return { settings: payload.settings || captured, configured: Boolean(payload.settings), message: "Settings ready" };
    }
  });
  assert.deepEqual(writes, [poppedSettings({
    colors: ["#ABCDEF", "#102030"], spread: 38, scatter: 9, seed: 18,
    screenTopToBottom: false, angle: 0, curve: LINEAR_CURVE,
    hoverGlowAmount: 17, hoverColor: "#FFFFFFCC", activeColor: "#FFFFFFCC"
  })]);
  assert.equal(poppedControl(root, "idleGlowAmount").value, "0");
  assert.equal(poppedControl(root, "idleColor").value, "#FFFFFF");
  assert.equal(root.requests.some(({ payload }) => payload.resetOverrides === true), false, "migration must preserve individual overrides");
  assert.equal(root.dataset.busy, "false");
  const configuredRoot = await renderThemePage(owner, {
    "button-theme.settings": { settings: captured, configured: true, message: "Settings ready" }
  });
  assert.equal(configuredRoot.requests.filter(({ payload }) => payload.settings).length, 0);
  const stops = configuredRoot.querySelectorAll("div").find((node) => node.className === "button-theme-gradient__stops");
  assert.deepEqual(stops.querySelectorAll("input").filter((input) => input.type === "color").map((input) => input.value), ["#FFFFFF", "#FFFFFF"]);
});

test("effects apply without replacing the applied gradient and package save captures current live settings", async () => {
  let live = poppedSettings({ hoverColor: "#FFFFFFCC" });
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => {
      if (payload.settings) live = plain(payload.settings);
      return { settings: live, configured: true, message: "Settings ready" };
    },
    "theme.package.save": { saved: true, packagePath: "C:\\Themes\\night.json", packageName: "Night" }
  });
  assert.ok(root.querySelectorAll("h3").some((node) => node.textContent === "Highlights and Glow"));
  assert.equal(poppedControl(root, "idleHighlightAmount").max, "1000");
  assert.equal(poppedControl(root, "idleGlowAmount").max, "100");
  const stagedGradient = root.querySelectorAll("div").find((node) => node.className === "button-theme-gradient__stops")
    .querySelectorAll("input").find((input) => input.type === "color");
  stagedGradient.value = "#EE0000";
  dispatch(stagedGradient, "input");
  const hoverGlow = poppedControl(root, "idleGlowAmount");
  hoverGlow.value = "3";
  dispatch(hoverGlow, "input");
  const stagedText = channelStops(root, "text")[0];
  setInput(stagedText, "#000000");
  const activeEnabled = poppedControl(root, "idleEnabled");
  activeEnabled.checked = true;
  dispatch(activeEnabled, "change");
  const hoverColor = poppedControl(root, "idleColor");
  hoverColor.value = "#335577";
  dispatch(hoverColor, "input");
  for (const [key, value] of Object.entries({ hoverGlowAmount: 19, hoverHighlightAmount: 234, activeGlowAmount: 27, activeHighlightAmount: 456 })) {
    const control = poppedControl(root, key);
    control.value = String(value);
    dispatch(control, "input");
  }
  const activeToggle = poppedControl(root, "activeEnabled");
  activeToggle.checked = false;
  dispatch(activeToggle, "change");
  await clickPageButton(root, "Apply Highlights & Glow");
  assert.deepEqual(live, poppedSettings({ hoverColor: "#FFFFFFCC", idleGlowAmount: 3, idleEnabled: true, idleColor: "#335577CC",
    hoverGlowAmount: 19, hoverHighlightAmount: 234, activeGlowAmount: 27, activeHighlightAmount: 456, activeEnabled: false }),
    "effects leave the applied text alone; the staged text waits for Apply Text Gradient");
  assert.equal(channelStops(root, "text")[0].value, "#000000");
  assert.equal(root.requests.some(({ payload }) => payload.resetOverrides === true), false, "effects apply is not a package reset");
  // An Apply Buckets/gradient operation can change the live profile since the last page read.
  live = { ...live, colors: ["#111111", "#555555", "#AAAAAA"], seed: 47 };
  await clickPageButton(root, "Save Package");
  const save = root.requests.find(({ actionId }) => actionId === "theme.package.save");
  assert.deepEqual(plain(save.payload.values.popped_button_settings), live);
  assert.equal("lockSettings" in save.payload.values.popped_button_settings, false);
  assert.equal("placements" in save.payload.values.popped_button_settings, false);
});

test("package switching preserves a temporary lock and unlock restores the selected package without writing it", async () => {
  const original = poppedSettings();
  const next = poppedSettings({ colors: ["#440011", "#992266"], hoverGlowAmount: 2, textColor: "#000000" });
  let live = original;
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => {
      if (payload.settings) live = plain(payload.settings);
      return { settings: live, configured: true, message: "Settings ready" };
    },
    "theme.package.next": { selected: true, fieldPatch: { popped_button_settings: next }, packagePath: "C:\\Themes\\rose.json", packageName: "Rose" }
  });
  const lock = poppedControl(root, "lockSettings");
  lock.checked = true;
  dispatch(lock, "change");
  await settlePageAction();
  await clickPageButton(root, "Next");
  assert.deepEqual(live, original);
  assert.equal(root.requests.filter(({ actionId, payload }) => actionId === "button-theme.settings" && payload.settings).length, 0);
  await root.flushTimers();
  const ownerState = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.equal(ownerState.buttonTheme.lockSettings, true);
  assert.deepEqual(plain(ownerState.activePackage.poppedButtonSettings), next);
  const unlock = poppedControl(root, "lockSettings");
  unlock.checked = false;
  dispatch(unlock, "change");
  await settlePageAction();
  assert.deepEqual(live, next);
  assert.equal(poppedControl(root, "lockSettings").checked, false);
  assert.equal(root.requests.filter(({ actionId, payload }) => actionId === "button-theme.settings" && payload.settings).at(-1).payload.resetOverrides, true);
  assert.equal(root.requests.some(({ actionId }) => actionId === "theme.package.save"), false);
});

test("legacy packages retain last used settings and popped package settings apply even when the picture bridge fails", async () => {
  let live = poppedSettings();
  let packageFields = {};
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => {
      if (payload.settings) live = plain(payload.settings);
      return { settings: live, configured: true, message: "Settings ready" };
    },
    "theme.package.open": () => ({ selected: true, fieldPatch: packageFields, packagePath: "C:\\Themes\\current.json" }),
    "picture.clear": () => { throw new Error("Blender picture bridge is offline"); }
  });
  const previous = plain(live);
  await clickPageButton(root, "Open Package");
  assert.deepEqual(live, previous);
  const next = poppedSettings({ colors: ["#110044", "#3300AA"], activeGlowAmount: 1 });
  packageFields = { popped_button_settings: next };
  await clickPageButton(root, "Open Package");
  assert.deepEqual(live, next);
  assert.equal(root.status.dataset.kind, "error");
  assert.match(root.status.textContent, /picture bridge is offline/);
  assert.equal(root.dataset.busy, "false");
});

test("package switching never waits for a live popout scan and retains the named list until refresh", async () => {
  const selected = poppedSettings({ colors: ["#330011", "#CC4477"], activeGlowAmount: 3 });
  const root = await renderThemePage({ buttonTheme: {
    revision: 41, placements: [{ placementId: "old-popup", bucketId: "surface:#123456" }],
    buckets: [{ id: "surface:#123456", kind: "surface", color: "#123456", materialColors: [] }]
  } }, {
    "button-theme.settings": (payload) => ({ settings: payload.settings || poppedSettings(), configured: true }),
    // Even an unresponsive Pop-out must not delay applying Blender's package.
    "button-theme.scan": () => new Promise(() => {}),
    "theme.package.next": { selected: true, fieldPatch: { popped_button_settings: selected }, packagePath: "C:\\Themes\\quick.json" }
  });
  root.requests.length = 0;
  await clickPageButton(root, "Next");
  assert.equal(root.dataset.busy, "false");
  assert.deepEqual(root.requests.map(({ actionId }) => actionId), [
    "theme.package.next", "button-theme.settings", "picture.clear", "picture.grid", "theme.apply"
  ]);
  await root.flushTimers();
  const saved = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.equal(saved.buttonTheme.revision, null);
  assert.equal(saved.buttonTheme.buckets.length, 1);
  assert.equal(saved.buttonTheme.placements.length, 1);
  assert.equal(saved.buttonTheme.placements[0].placementId, "old-popup");
  assert.deepEqual(bucketColors(root), ["#123456"], "the existing colors remain visible while a scan is stalled");
  assert.equal(applyBucketsButton(root).disabled, true, "bucket edits wait for a fresh scan");
  assert.deepEqual(plain(saved.buttonTheme.lastAppliedSettings), selected);
});

test("legacy package switching keeps live popout settings without saving or rescanning them", async () => {
  const current = poppedSettings();
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => payload.settings
      ? new Promise(() => {})
      : { settings: current, configured: true },
    "button-theme.scan": () => new Promise(() => {}),
    "theme.package.next": { selected: true, fieldPatch: { tabs_hex: "#654321" }, packagePath: "C:\\Themes\\legacy.json" }
  });
  root.requests.length = 0;
  await clickPageButton(root, "Next");
  assert.equal(root.dataset.busy, "false");
  assert.deepEqual(root.requests.map(({ actionId }) => actionId), [
    "theme.package.next", "button-theme.settings", "picture.clear", "picture.grid", "theme.apply"
  ]);
  assert.equal(root.requests.some(({ payload }) => payload.settings), false);
});

test("a locked legacy package switch preserves every staged appearance control without writing live settings or packages", async () => {
  const current = poppedSettings();
  const root = await renderThemePage({ buttonTheme: { lockSettings: true } }, {
    "button-theme.settings": { settings: current, configured: true },
    "theme.package.next": { selected: true, fieldPatch: { tabs_hex: "#654321" }, packagePath: "C:\\Themes\\legacy.json" }
  });
  const gradient = () => root.querySelectorAll("div").find((node) => node.className === "button-theme-gradient");
  const colorCount = () => gradient().querySelectorAll("label")
    .find((node) => node.className === "button-theme-gradient__color-count")
    .querySelectorAll("input").find((input) => input.type === "number");
  const stops = () => gradient().querySelectorAll("div")
    .find((node) => node.className === "button-theme-gradient__stops")
    .querySelectorAll("input").filter((input) => input.type === "color");
  const screenFlag = () => gradient().querySelectorAll("input").find((input) => input.type === "checkbox");
  const count = colorCount();
  count.value = "3";
  dispatch(count, "change");
  const stagedColors = ["#102938", "#746352", "#EEDDAA"];
  stops().forEach((input, index) => {
    input.value = stagedColors[index];
    dispatch(input, "input");
  });
  const text = channelBox(root, "text");
  setInput(labelledInput(text, "Text Colors"), 2);
  channelStops(root, "text").forEach((input, index) => setInput(input, ["#123123", "#ABCABC"][index]));
  setInput(labelledInput(text, "Button Text angle"), 30);
  toolButton(text, "Peak curve").click();
  const stagedText = () => ({
    colors: channelStops(root, "text").map(({ value }) => value),
    angle: Number(labelledInput(channelBox(root, "text"), "Button Text angle").value),
    points: curvePoints(channelBox(root, "text")).length
  });
  const expectedText = { colors: ["#123123", "#ABCABC"], angle: 30, points: 3 };
  assert.deepEqual(stagedText(), expectedText);
  const stagedControls = {
    spread: 23, scatter: 81, idleColor: "#AABBCD",
    idleEnabled: true, idleHighlightAmount: 123, idleGlowAmount: 7,
    hoverEnabled: false, hoverHighlightAmount: 85, hoverGlowAmount: 9,
    activeEnabled: true, activeHighlightAmount: 220, activeGlowAmount: 15
  };
  for (const [key, value] of Object.entries(stagedControls)) {
    const control = poppedControl(root, key);
    if (typeof value === "boolean") {
      control.checked = value;
      dispatch(control, "change");
    } else {
      control.value = String(value);
      dispatch(control, "input");
    }
  }
  screenFlag().checked = false;
  dispatch(screenFlag(), "change");
  const appearance = () => ({
    colors: stops().map((input) => input.value),
    gradientColorCount: Number(colorCount().value),
    screenTopToBottom: screenFlag().checked,
    ...Object.fromEntries(Object.entries(stagedControls).map(([key, value]) => {
      const control = poppedControl(root, key);
      return [key, typeof value === "boolean" ? control.checked : typeof value === "number" ? Number(control.value) : control.value];
    }))
  });
  const expected = { colors: stagedColors, gradientColorCount: 3, screenTopToBottom: false, ...stagedControls };
  assert.deepEqual(appearance(), expected);
  root.requests.length = 0;
  await clickPageButton(root, "Next");
  assert.deepEqual(appearance(), expected);
  assert.deepEqual(stagedText(), expectedText, "the locked staged text gradient survives the switch");
  assert.equal(poppedControl(root, "lockSettings").checked, true);
  assert.equal(root.requests.some(({ actionId, payload }) => actionId === "button-theme.settings" && payload.settings), false);
  assert.equal(root.requests.some(({ actionId }) => ["button-theme.apply", "button-theme.refill", "button-theme.toggle-text", "theme.package.save"].includes(actionId)), false);
  await root.flushTimers();
  const state = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.deepEqual(plain(state.buttonTheme.gradientColors), stagedColors);
  assert.equal(state.buttonTheme.gradientColorCount, 3);
  assert.equal(state.buttonTheme.screenTopToBottom, false);
  for (const [key, value] of Object.entries(stagedControls)) assert.equal(state.buttonTheme[key], key === "idleColor" ? value + "CC" : value, key);
  assert.deepEqual(plain(state.buttonTheme.textColors), expectedText.colors);
  assert.equal(state.buttonTheme.textAngle, 30);
  assert.deepEqual(plain(state.buttonTheme.lastAppliedSettings), current);
  assert.deepEqual(plain(state.activePackage.poppedButtonSettings), current);
});

test("package save holds the operation lock while reading settings so a gradient cannot race it", async () => {
  let finishRead;
  let reads = 0;
  const root = await renderThemePage({}, {
    "button-theme.settings": () => {
      reads += 1;
      const response = { settings: poppedSettings(), configured: true, message: "Settings ready" };
      return reads === 1 ? response : new Promise((resolve) => { finishRead = () => resolve(response); });
    },
    "theme.package.save": { saved: true, packagePath: "C:\\Themes\\saved.json" }
  });
  await clickPageButton(root, "Save Package");
  assert.equal(root.dataset.busy, "true");
  await clickPageButton(root, "Apply Gradient");
  assert.equal(root.requests.some(({ actionId }) => actionId === "button-theme.refill"), false);
  finishRead();
  await settlePageAction();
  assert.equal(root.dataset.busy, "false");
  assert.equal(root.requests.filter(({ actionId }) => actionId === "theme.package.save").length, 1);
});

test("invalid saved popped settings fail explicitly instead of being treated as an older package", async () => {
  for (const invalid of [null, poppedSettings({ colors: [] }), poppedSettings({ hoverColor: "oops" }), poppedSettings({ activeGlowAmount: 101 })]) {
    const current = poppedSettings();
    const root = await renderThemePage({ activePackage: {
      path: "C:\\Themes\\original.json", name: "Original", poppedButtonSettings: current
    } }, {
      "button-theme.settings": { settings: current, configured: true, message: "Settings ready" },
      "theme.package.open": { selected: true, fieldPatch: { popped_button_settings: invalid, tabs_hex: "#112233" }, packagePath: "C:\\Themes\\broken.json" }
    });
    await clickPageButton(root, "Open Package");
    assert.match(root.status.textContent, /invalid popped Button settings/);
    assert.equal(root.status.dataset.kind, "error");
    assert.equal(root.requests.some(({ actionId, payload }) => actionId === "button-theme.settings" && payload.settings), false);
    assert.equal(root.requests.some(({ actionId }) => actionId === "picture.clear" || actionId === "theme.apply"), false);
    await root.flushTimers();
    const state = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
    assert.equal(state.activePackage.path, "C:\\Themes\\original.json");
    assert.notEqual(state.fields.tabs_hex, "#112233");
  }
});

test("a failed first migration remains an error instead of reporting Ready", async () => {
  const root = await renderThemePage({ buttonTheme: { gradientColors: ["#123456", "#654321"], gradientColorCount: 2 } }, {
    "button-theme.settings": (payload) => {
      if (payload.settings) throw new Error("Cannot persist Blender popped settings");
      return { settings: poppedSettings(), configured: false, message: "Settings ready" };
    }
  });
  assert.equal(root.status.dataset.kind, "error");
  assert.match(root.status.textContent, /Cannot persist Blender popped settings/);
  assert.doesNotMatch(root.status.textContent, /Ready|is ready/);
  assert.equal(root.dataset.busy, "false");
});

test("a locked package selection survives a picture failure and reopening before unlock", async () => {
  const original = poppedSettings();
  const selected = poppedSettings({ colors: ["#442211", "#CCAA88"], hoverGlowAmount: 1 });
  let live = original;
  const respond = (payload) => {
    if (payload.settings) live = plain(payload.settings);
    return { settings: live, configured: true, message: "Settings ready" };
  };
  const root = await renderThemePage({ buttonTheme: { lockSettings: true } }, {
    "button-theme.settings": respond,
    "theme.package.open": { selected: true, fieldPatch: { popped_button_settings: selected }, packagePath: "C:\\Themes\\sand.json" },
    "picture.clear": () => { throw new Error("Picture bridge unavailable"); }
  });
  await clickPageButton(root, "Open Package");
  assert.equal(root.status.dataset.kind, "error");
  assert.deepEqual(live, original);
  await root.flushTimers();
  const ownerState = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.equal(ownerState.activePackage.path, "C:\\Themes\\sand.json");
  assert.deepEqual(plain(ownerState.activePackage.poppedButtonSettings), selected);
  const reopened = await renderThemePage(plain(ownerState), { "button-theme.settings": respond });
  const lock = poppedControl(reopened, "lockSettings");
  assert.equal(lock.checked, true);
  lock.checked = false;
  dispatch(lock, "change");
  await settlePageAction();
  assert.deepEqual(live, selected);
  assert.equal(reopened.requests.some(({ actionId }) => actionId === "theme.package.save"), false);
});

test("the Individual Buttons list is gone and Fill and Text each get their own gradient box", async () => {
  const root = await renderThemePage({ buttonTheme: {
    revision: 3, placements: [{ placementId: "hidden-a", bucketId: "surface:#123456", label: "Utility" }],
    buckets: [{ id: "surface:#123456", kind: "surface", color: "#123456", materialColors: [] }]
  } });
  assert.equal(root.querySelectorAll("h3").some(({ textContent }) => textContent === "Individual Buttons"), false);
  assert.doesNotMatch(pageScript, /Individual Buttons|button-theme-individual|selectedButtonPlacements|button-theme\.edit"/);
  assert.doesNotMatch(pageCss, /button-theme-individual/);
  assert.deepEqual(
    root.querySelectorAll("h3").map(({ textContent }) => textContent).filter((text) => text.startsWith("Button ")),
    ["Button Fill", "Button Text"]
  );
  for (const [channel, title] of [["fill", "Button Fill"], ["text", "Button Text"]]) {
    const box = channelBox(root, channel);
    assert.ok(curveBox(box), `${title} has its own curve box`);
    assert.equal(curvePoints(box).length, 2, "a new curve is the straight bottom-left to top-right line");
    assert.equal(labelledInput(box, `${title} angle`).value, "0", "0 degrees runs top to bottom");
    assert.equal(box.querySelectorAll("input").filter(({ type }) => type === "checkbox").length, 1);
  }
  assert.ok(toolButton(channelBox(root, "fill"), "Apply Gradient"));
  assert.ok(toolButton(channelBox(root, "text"), "Apply Text Gradient"));
  assert.deepEqual(channelStops(root, "text").map(({ value }) => value), ["#FFFFFF"], "text starts as one solid color");
  const sample = root.querySelectorAll("div").find((node) => node.className === "button-theme-sample");
  assert.equal(sample.children.length, 24);
  assert.ok(sample.children.every((chip) => chip.style.backgroundColor && chip.style.color));
});

test("Apply Text Gradient sends an independent text gradient and leaves the staged fill untouched", async () => {
  let live = poppedSettings();
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => {
      if (payload.settings) live = plain(payload.settings);
      return { settings: live, configured: true, message: "Settings ready" };
    }
  });
  setInput(channelStops(root, "fill")[0], "#EE0000");
  const text = channelBox(root, "text");
  setInput(labelledInput(text, "Text Colors"), 3);
  channelStops(root, "text").forEach((input, index) => setInput(input, ["#FF0000", "#00FF00", "#0000FF"][index]));
  setInput(labelledInput(text, "Button Text angle"), 90);
  toolButton(text, "Peak curve").click();
  const screen = text.querySelectorAll("input").find(({ type }) => type === "checkbox");
  screen.checked = true;
  dispatch(screen, "change");
  await clickPageButton(root, "Apply Text Gradient");
  assert.deepEqual(live, poppedSettings({
    textColor: "#FF0000", textColors: ["#FF0000", "#00FF00", "#0000FF"], textAngle: 90,
    textCurve: [{ x: 0, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }],
    textScreenTopToBottom: true
  }));
  assert.equal(root.requests.some(({ actionId }) => actionId === "button-theme.refill"), false);
  assert.equal(channelStops(root, "fill")[0].value, "#EE0000", "the staged fill survives applying text");
  setInput(labelledInput(channelBox(root, "text"), "Text Colors"), 1);
  await clickPageButton(root, "Apply Text Gradient");
  assert.equal(live.textColor, "#FF0000");
  assert.equal(Object.hasOwn(live, "textColors"), false, "one text color is a solid label color");
  await root.flushTimers();
  const state = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.deepEqual(plain(state.buttonTheme.textColors), ["#FF0000"]);
  assert.equal(state.buttonTheme.textAngle, 90);
});

test("the curve box edits points and presets within Core's curve contract and Apply Gradient sends the shape", async () => {
  let refill = null;
  const root = await renderThemePage({}, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "button-theme.refill": (payload) => {
      refill = plain(payload);
      return { revision: 4, placements: [] };
    }
  });
  const fill = () => channelBox(root, "fill");
  const pointLabel = () => fill().querySelectorAll("span").find((node) => node.className === "gradient-curve__point-label").textContent;
  assert.equal(toolButton(fill(), "Delete").disabled, true, "nothing is selected yet");
  toolButton(fill(), "Wave curve").click();
  assert.equal(curvePoints(fill()).length, 5);
  selectCurvePoint(fill(), 2);
  assert.equal(pointLabel(), "Point 3 of 5");
  toolButton(fill(), "Corner").click();
  setInput(labelledInput(fill(), "Button Fill point position percent"), 40);
  setInput(labelledInput(fill(), "Button Fill point value percent"), 25);
  toolButton(fill(), "Bezier").click();
  assert.equal(toolButton(fill(), "Bezier")["aria-pressed"], "true");
  await root.flushTimers();
  let state = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.deepEqual(plain(state.buttonTheme.curve[2]), {
    x: 0.4, y: 0.25, mode: "aligned", inX: -0.05, inY: 0.25, outX: 0.1167, outY: 0.25
  }, "a corner converts to Bezier without changing its shape");
  toolButton(fill(), "Delete").click();
  assert.equal(curvePoints(fill()).length, 4);
  selectCurvePoint(fill(), 0);
  assert.equal(toolButton(fill(), "Delete").disabled, true, "endpoints stay pinned");
  assert.equal(labelledInput(fill(), "Button Fill point position percent").disabled, true);

  toolButton(fill(), "Ease In curve").click();
  toolButton(fill(), "Mirror").click();
  toolButton(fill(), "Flip").click();
  await root.flushTimers();
  state = root.requests.filter(({ actionId }) => actionId === page.config.actions.state.write).at(-1).payload.state;
  assert.deepEqual(plain(state.buttonTheme.curve), [
    { x: 0, y: 0, mode: "free", inX: 0, inY: 0, outX: 0, outY: 0 },
    { x: 1, y: 1, mode: "free", inX: -0.42, inY: 0, outX: 0, outY: 0 }
  ], "mirroring and flipping Ease In gives Ease Out");

  toolButton(fill(), "Steps curve").click();
  setInput(labelledInput(fill(), "Button Fill angle"), 405);
  assert.equal(labelledInput(fill(), "Button Fill angle").value, "45", "angles wrap into -180..180");
  await clickPageButton(root, "Apply Gradient");
  assert.equal(refill.angle, 45);
  const xs = refill.curve.map(({ x }) => x);
  assert.equal(xs[0], 0);
  assert.equal(xs.at(-1), 1);
  assert.ok(xs.every((x, index) => index === 0 || x > xs[index - 1]), "curve x strictly increases");
  assert.ok(refill.curve.every((point) => Object.keys(point).every((key) => ["x", "y", "mode"].includes(key))));
  assert.equal(refill.curve.length, 2 * refill.colors.length, "Steps makes one flat band per color");
});

test("Toggle Text replaces a text gradient with the solid color Blender reports", async () => {
  let live = poppedSettings({ textColors: ["#FF0000", "#0000FF"], textAngle: 30 });
  const root = await renderThemePage({}, {
    "button-theme.settings": () => ({ settings: live, configured: true }),
    "button-theme.toggle-text": () => {
      const { textColors: _textColors, ...solid } = live;
      live = { ...solid, textColor: "#000000" };
      return { revision: 5, placements: [] };
    }
  });
  assert.deepEqual(channelStops(root, "text").map(({ value }) => value), ["#FF0000", "#0000FF"]);
  assert.equal(labelledInput(channelBox(root, "text"), "Button Text angle").value, "30");
  await clickPageButton(root, "Toggle Text");
  assert.deepEqual(channelStops(root, "text").map(({ value }) => value), ["#000000"]);
});

test("rapid package changes coalesce background scans and only the latest response refreshes the buckets", async () => {
  const placements = namedPlacements();
  const pending = [];
  let scanCount = 0;
  let packageCount = 0;
  const root = await renderThemePage({}, {
    "button-theme.settings": (payload) => ({ settings: payload.settings || poppedSettings(), configured: true }),
    "button-theme.scan": () => {
      scanCount += 1;
      if (scanCount === 1) return { revision: 1, placements };
      return new Promise((resolve) => pending.push(resolve));
    },
    "theme.package.next": () => ({ selected: true, fieldPatch: { popped_button_settings: poppedSettings({ seed: ++packageCount }) }, packagePath: `C:\\Themes\\${packageCount}.json` })
  });
  const initialBuckets = bucketColors(root);
  assert.equal(initialBuckets.length, 3);
  await clickPageButton(root, "Next");
  assert.equal(scanCount, 2);
  await clickPageButton(root, "Next");
  await clickPageButton(root, "Next");
  assert.equal(scanCount, 2, "there is only one scan in flight across several package changes");
  assert.equal(root.dataset.busy, "false");
  assert.deepEqual(bucketColors(root), initialBuckets);
  const statusAfterPackages = root.status.textContent;
  assert.equal(applyBucketsButton(root).disabled, true);
  pending[0]({ revision: 2, placements: [{ ...placements[0], color: "#010101" }] });
  await settlePageAction();
  assert.equal(scanCount, 3, "one latest refresh replaces all superseded pending refreshes");
  assert.deepEqual(bucketColors(root), initialBuckets, "an outdated scan cannot replace the retained buckets");
  const latest = placements.map((placement) => ({ ...placement, color: "#775599" }));
  pending[1]({ revision: 7, placements: latest });
  await settlePageAction();
  assert.equal(scanCount, 3);
  assert.deepEqual(bucketColors(root), ["#775599"]);
  assert.equal(applyBucketsButton(root).disabled, false);
  assert.equal(root.status.textContent, statusAfterPackages);
  assert.equal(root.dataset.busy, "false");
});

test("a background scan failure retains the buckets and disables bucket edits without changing package status", async () => {
  let scans = 0;
  const root = await renderThemePage({}, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "button-theme.scan": () => {
      scans += 1;
      if (scans === 1) return { revision: 3, placements: namedPlacements() };
      throw new Error("Native window did not respond");
    }
  });
  const previousStatus = root.status.textContent;
  await clickPageButton(root, "Rescan");
  assert.equal(bucketColors(root).length, 3);
  assert.equal(applyBucketsButton(root).disabled, true);
  assert.equal(root.status.textContent, previousStatus);
  assert.ok(root.querySelectorAll("p").some((node) => /Press Rescan to enable editing/.test(node.textContent)));
  assert.equal(scans, 2, "failed refresh does not repeatedly rescan");
});

test("a late background response cannot overwrite newer gradient and text results", async () => {
  let scans = 0;
  let finishStale;
  let placements = namedPlacements();
  const root = await renderThemePage({}, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "button-theme.scan": () => ++scans === 1
      ? { revision: 2, placements }
      : new Promise((resolve) => { finishStale = resolve; }),
    "button-theme.refill": () => {
      placements = placements.map((placement) => ({ ...placement, color: "#771199" }));
      return { revision: 4, placements };
    },
    "button-theme.toggle-text": () => {
      placements = placements.map((placement) => ({ ...placement, textColor: "#000000" }));
      return { revision: 5, placements };
    }
  });
  await clickPageButton(root, "Rescan");
  await clickPageButton(root, "Apply Gradient");
  await clickPageButton(root, "Toggle Text");
  finishStale({ revision: 3, placements: namedPlacements() });
  await settlePageAction();
  assert.deepEqual(bucketColors(root), ["#771199"]);
  assert.equal(applyBucketsButton(root).disabled, false, "the newest complete response keeps its revision");
  assert.equal(scans, 2, "complete responses supersede the pending scan without queuing another");
});


test("Regular controls accompany the existing Hover and Active controls with no Startup button", async () => {
  const root = await renderThemePage({}, {
    "button-theme.settings": { settings: poppedSettings(), configured: true }
  });
  assert.equal(root.querySelectorAll("button").some((node) => node.textContent === "Startup"), false);
  for (const prefix of ["idle", "hover", "active"]) {
    for (const suffix of ["Enabled", "Color", "HighlightAmount", "GlowAmount"]) {
      assert.ok(poppedControl(root, prefix + suffix));
    }
  }
});


test("Grid defaults on and unchecking saves explicit false through package reload", async () => {
  let saved;
  const root = await renderThemePage({}, {
    "button-theme.settings": { settings: poppedSettings(), configured: true },
    "picture.grid.remove": { grid_enabled: false, message: "Grid removed" },
    "theme.package.save": (payload) => {
      saved = plain(payload.values);
      return { saved: true, packagePath: "C:\\Themes\\grid-off.json", packageName: "Off" };
    },
    "theme.package.open": () => ({ selected: true, fieldPatch: { ...saved, static_background_path: "C:\\Themes\\picture.png" } })
  });
  const checkbox = () => root.querySelectorAll("input").find((input) => input["aria-label"] === "Grid");
  assert.equal(checkbox().checked, true);
  checkbox().checked = false;
  dispatch(checkbox(), "change");
  await new Promise((resolve) => setImmediate(resolve));
  await clickPageButton(root, "Save Package");
  assert.equal(saved.grid_enabled, false);
  assert.equal(saved.grid_scale, 0.01);
  assert.equal(saved.grid_subdivisions, 10);
  checkbox().checked = true;
  dispatch(checkbox(), "change");
  await settlePageAction();
  assert.equal(checkbox().checked, true);
  await clickPageButton(root, "Open Package");
  assert.equal(checkbox().checked, false);
  assert.equal(root.requests.filter(({ actionId }) => actionId === "picture.apply").at(-1).payload.grid_enabled, false);
  await clickPageButton(root, "Save Buckets");
  assert.equal(root.requests.filter(({ actionId }) => actionId === "theme.fields.save").at(-1).payload.values.grid_enabled, false);
});

test("Grid controls follow Gradient 2 in Theme Palette and leave Place Picture grid-free", async () => {
  const root = await renderThemePage();
  const palette = root.children[0];
  const roles = palette.querySelectorAll("div").find((node) => node.className === "theme-role-grid");
  const gradientIndex = roles.children.findIndex((node) => node.title === "Gradient 2");
  const controls = roles.children[gradientIndex + 1];
  assert.equal(controls.className, "theme-grid-controls");
  assert.equal(controls.children[0].querySelectorAll("input")[0]["aria-label"], "Grid");
  assert.equal(controls.children[1].querySelectorAll("span")[0].textContent, "Grid Scale");
  assert.equal(controls.children[2].querySelectorAll("span")[0].textContent, "Subdivisions (unitless)");
  const picture = root.children[2];
  assert.equal(picture.querySelectorAll("input").length, 1, "only the picture path remains");
  assert.deepEqual(picture.querySelectorAll("button").map((button) => button.textContent), ["Browse", "Place Picture", "Clear"]);
});

test("spacing edits apply immediately while Grid is enabled", async () => {
  const root = await renderThemePage();
  const controls = root.querySelectorAll("div").find((node) => node.className === "theme-grid-controls");
  for (const [index, value, fieldId] of [[1, "0.05", "grid_scale"], [2, "12", "grid_subdivisions"]]) {
    const input = controls.children[index].querySelectorAll("input")[0];
    input.value = value;
    dispatch(input, "change");
    await settlePageAction();
    const request = root.requests.filter(({ actionId }) => actionId === "picture.grid").at(-1);
    assert.equal(request.payload[fieldId], Number(value));
    assert.equal(request.payload.grid_enabled, true);
  }
});

test("a failed grid checkbox action keeps the prior saved choice", async () => {
  const root = await renderThemePage({}, { "picture.grid.remove": () => { throw new Error("Blender unavailable"); } });
  const checkbox = root.querySelectorAll("input").find((input) => input["aria-label"] === "Grid");
  checkbox.checked = false;
  dispatch(checkbox, "change");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checkbox.checked, true);
});

test("grid visibility is optional in every IO schema and survives migrated legacy packages", () => {
  assert.equal(fieldById.get("grid_enabled").defaultValue, true);
  for (const actionId of ["theme.fields.save", "theme.fields.load", "theme.package.save", "theme.package.open", "theme.package.previous", "theme.package.next"]) {
    const action = actionById.get(actionId);
    assert.ok(action.handler.options.valueFields.includes("grid_enabled"));
    const schema = actionId.endsWith(".save") ? action.requestSchema.properties.values : action.responseSchema.properties.fieldPatch;
    assert.deepEqual(schema.properties.grid_enabled, { type: "boolean" });
    assert.equal((schema.required || []).includes("grid_enabled"), false);
    if (!actionId.endsWith(".save")) {
      assert.equal(action.handler.options.legacyFieldMap.GridEnabled, "grid_enabled");
      assert.equal(action.handler.options.legacyFieldMap.GridScale, "grid_scale");
      assert.equal(action.handler.options.legacyFieldMap.GridSubdivisions, "grid_subdivisions");
    }
  }
  for (const actionId of ["picture.apply", "picture.grid", "picture.startup"]) {
    assert.deepEqual(actionById.get(actionId).requestSchema.properties.grid_enabled, { type: "boolean" });
  }
});

test("themes without a picture still honor explicit grid on and off", async () => {
  for (const grid_enabled of [true, false]) {
    const root = await renderThemePage({}, {
      "button-theme.settings": { settings: poppedSettings(), configured: true },
      "theme.package.open": { selected: true, fieldPatch: { static_background_path: "", grid_enabled } }
    });
    await clickPageButton(root, "Open Package");
    const actionIds = root.requests.map(({ actionId }) => actionId);
    assert.ok(actionIds.includes(grid_enabled ? "picture.grid" : "picture.grid.remove"));
    assert.equal(actionIds.includes(grid_enabled ? "picture.grid.remove" : "picture.grid"), false);
  }
});
