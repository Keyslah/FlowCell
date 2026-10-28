import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

// Source-only harness: no transpilation, app process, installed package, or host program.
const assetRoot = join(import.meta.dirname, "../src/pages/theme/poppedButtonColors");
const script = readFileSync(join(assetRoot, "page.js"), "utf8");
const config = JSON.parse(readFileSync(join(assetRoot, "page.config.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));
const linearCurve = [{ x: 0, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }];

class Element {
  constructor(tagName) {
    Object.assign(this, { tagName, children: [], dataset: {}, style: {}, textContent: "", listeners: new Map() });
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? []; listeners.push(listener); this.listeners.set(type, listeners);
  }
  querySelectorAll(tagName) {
    return this.children.flatMap(child => child instanceof Element
      ? [...(child.tagName === tagName ? [child] : []), ...child.querySelectorAll(tagName)] : []);
  }
}

function settings(overrides = {}) {
  return { version: 1, colors: ["#183942", "#467A8B"], spread: 67, scatter: 4, seed: 32,
    screenTopToBottom: true, textColor: "#FFFFFF", hoverEnabled: true, activeEnabled: true,
    hoverColor: "#AACCFF", activeColor: "#88FFCC", hoverHighlightAmount: 75,
    activeHighlightAmount: 95, hoverGlowAmount: 8, activeGlowAmount: 12,
    idleEnabled: false, idleColor: "#FFFFFFCC", idleHighlightAmount: 0, idleGlowAmount: 0, ...overrides };
}

async function settle() { await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); }
async function dispatch(control, type = "change") {
  const handlers = control.listeners.get(type) ?? []; assert.ok(handlers.length, `Missing ${type} handler`);
  for (const handler of handlers) handler({ target: control });
  await settle();
}
async function click(root, label) {
  const button = root.querySelectorAll("button").find(node => node.textContent === label || node["aria-label"] === label);
  assert.ok(button, `Missing ${label}`); await dispatch(button, "click");
}
function input(root, name) {
  const node = root.querySelectorAll("input").find(node => node.dataset.setting === name || node["aria-label"] === name);
  assert.ok(node, `Missing ${name}`); return node;
}
function channel(root, name) {
  const box = root.querySelectorAll("section").find(node => String(node.className).split(/\s+/).includes(`button-theme-channel--${name}`));
  assert.ok(box, `Missing ${name} channel`); return box;
}

async function render({ programName = "Custom Editor", ownerState = {}, overrides = {}, configured = false } = {}) {
  const root = new Element("main"); const status = new Element("div"); const requests = []; const timers = new Map();
  let currentSettings = settings(); let revision = 7; let nextTimer = 1;
  const placements = [
    { placementId: "first", buttonId: "a", label: "First", groupLabel: "Tools", color: "#224466", materialColors: [], textColor: "#FFFFFF", enabled: true },
    { placementId: "second", buttonId: "b", label: "Second", groupLabel: "Tools", color: "#99BBDD", materialColors: [], textColor: "#FFFFFF", enabled: false }
  ];
  const request = async (actionId, payload) => {
    requests.push({ actionId, payload: plain(payload) });
    if (Object.hasOwn(overrides, actionId)) return typeof overrides[actionId] === "function" ? overrides[actionId](payload) : overrides[actionId];
    if (actionId === "owner-state.read") return { state: ownerState };
    if (actionId === "owner-state.write") return {};
    if (actionId === "button-theme.settings") {
      if (payload.settings) currentSettings = plain(payload.settings);
      return { settings: currentSettings, configured };
    }
    if (actionId === "button-theme.scan") return { revision, placements: plain(placements) };
    if (["button-theme.apply", "button-theme.refill", "button-theme.toggle-text", "button-theme.edit", "button-theme.participation"].includes(actionId)) {
      if (payload.settings) currentSettings = plain(payload.settings);
      return { revision: ++revision, placements: plain(placements), changedCount: 2 };
    }
    if (actionId === "theme.image.select") return { selected: false };
    throw new Error(`Unexpected core appearance request: ${actionId}`);
  };
  const document = { getElementById: id => id === "theme-page" ? root : id === "theme-status" ? status : null,
    createElement: name => new Element(name), createElementNS: (_ns, name) => new Element(name) };
  const window = { flowcellPage: { descriptor: { config, programName, embeddedTheme: true, coreOwned: true }, request,
    setThemeHandler: handler => { root.themeRequest = handler; }, themeReady: () => { root.ready = true; } },
    clearTimeout: timer => timers.delete(timer), setTimeout: callback => { const id = nextTimer++; timers.set(id, callback); return id; } };
  vm.runInNewContext(script, { document, window }, { filename: "core-popped-button-colors.js" });
  await settle(); await settle();
  assert.notEqual(status.dataset.kind, "error", status.textContent);
  Object.assign(root, { requests, status, flush: async () => {
    const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await settle();
  } });
  return root;
}

test("the common editor owns only program-neutral appearance resources", () => {
  const assets = [script, readFileSync(join(assetRoot, "page.css"), "utf8"), readFileSync(join(assetRoot, "index.html"), "utf8"), JSON.stringify(config)];
  for (const source of assets) assert.doesNotMatch(source, /Blender|Programs[\\/]|HDRI|environment\.|picture\.|["']theme\.(?:apply|absorb|package|fields)\b/);
  assert.deepEqual(Object.keys(config.actions).sort(), ["buttonTheme", "referenceImage", "state"]);
  assert.equal(config.actions.referenceImage.select, "theme.image.select");
});

test("opening an unconfigured custom program reads settings without applying defaults", async () => {
  const root = await render();
  assert.equal(root.ready, true);
  assert.deepEqual(root.requests.map(({ actionId }) => actionId), ["owner-state.read", "button-theme.settings", "button-theme.scan"]);
  assert.deepEqual(root.requests[1].payload, {});
  for (const name of ["fill", "text", "highlight", "glow"]) assert.ok(channel(root, name));
  for (const label of ["Rescan", "Apply Buckets", "Refill", "Scatter", "Toggle Text", "Apply Gradient", "Apply Text Gradient", "Apply Highlights & Glow"]) {
    assert.ok(root.querySelectorAll("button").some(button => button.textContent === label), label);
  }
});

test("Refill cancellation changes no appearance; a selected image samples and applies exact colors", async () => {
  const cancelled = await render(); await click(cancelled, "Refill");
  assert.deepEqual(cancelled.requests.slice(3).map(({ actionId }) => actionId), ["theme.image.select"]);
  const colors = ["#112233", "#445566"];
  const chosen = await render({ overrides: {
    "theme.image.select": { selected: true, path: "C:\\reference.png" },
    "theme.image.sample": { selected: true, paletteHexes: colors }
  } });
  await click(chosen, "Refill");
  assert.deepEqual(chosen.requests.slice(3).map(({ actionId }) => actionId), ["theme.image.select", "theme.image.sample", "button-theme.refill"]);
  assert.deepEqual(chosen.requests.find(request => request.actionId === "button-theme.refill").payload.colors, colors);
  assert.equal(chosen.requests.find(request => request.actionId === "theme.image.sample").payload.imagePath, "C:\\reference.png");
});

test("theme selection and refresh retain the lock, while unlock restores saved appearance", async () => {
  const root = await render(); const lock = input(root, "lockSettings"); lock.checked = true; await dispatch(lock);
  const selectedSettings = settings({ colors: ["#AA1111", "#11AAAA"], spread: 28 });
  const appearance = { version: 1, placements: [{ placementId: "first", buttonId: "a", color: "#112233" }] };
  await root.themeRequest("set-active", { name: "Saved", path: "C:\\saved.flowtheme", buttonSettings: selectedSettings, buttonAppearance: appearance });
  await root.themeRequest("refresh", null); await settle();
  assert.equal((await root.themeRequest("policy", null)).preservePoppedAppearance, true);
  assert.equal(root.requests.some(({ payload }) => payload.settings), false);
  const unlock = input(root, "lockSettings"); unlock.checked = false; await dispatch(unlock);
  const applied = root.requests.find(({ payload }) => payload.settings);
  assert.equal(applied.payload.resetOverrides, true);
  assert.deepEqual(applied.payload.settings.colors, selectedSettings.colors);
  assert.deepEqual(applied.payload.buttonAppearance, appearance);
  assert.equal((await root.themeRequest("policy", null)).preservePoppedAppearance, false);
  await assert.rejects(root.themeRequest("apply", {}), /only Button appearance/);
});

test("fill, text and effect controls still apply independently through Core", async () => {
  const root = await render();
  await click(channel(root, "fill"), "Apply Gradient");
  const gradient = root.requests.find(({ actionId }) => actionId === "button-theme.refill");
  assert.ok(gradient); assert.equal(gradient.payload.spread, 67);
  await click(channel(root, "text"), "Apply Text Gradient");
  const text = root.requests.filter(({ payload }) => payload.settings).at(-1);
  assert.ok(text); assert.deepEqual(text.payload.settings.colors, settings().colors);
  const amount = input(root, "hoverGlowAmount"); amount.value = "33"; await dispatch(amount, "input");
  await click(root, "Apply Highlights & Glow");
  const effect = root.requests.filter(({ payload }) => payload.settings).at(-1);
  assert.equal(effect.payload.settings.hoverGlowAmount, 33);
  assert.deepEqual(effect.payload.settings.colors, settings().colors);
});

test("individual unchecked Buttons retain participation and direct-color editing", async () => {
  const root = await render();
  const participation = root.querySelectorAll("input").find(node => node.type === "checkbox" && node.dataset.placementId === "second");
  assert.ok(participation); assert.equal(participation.checked, false); participation.checked = true; await dispatch(participation);
  const request = root.requests.find(({ actionId }) => actionId === "button-theme.participation");
  assert.deepEqual(request.payload.placementIds, ["second"]); assert.equal(request.payload.enabled, true); assert.equal(request.payload.expectedRevision, 7);
  const rows = root.querySelectorAll("div").filter(node => node.dataset.placementId === "second");
  const color = rows.flatMap(row => row.querySelectorAll("input")).find(node => node.type === "text");
  assert.ok(color); color.value = "#ABCDEF"; await dispatch(color);
  assert.ok(root.requests.some(({ actionId }) => actionId === "button-theme.edit"));
});

test("curve presets and editor draft state remain available without program theme fields", async () => {
  const root = await render(); const fill = channel(root, "fill");
  await click(fill, "Peak curve"); await click(root, "Apply Gradient");
  const applied = root.requests.find(({ actionId }) => actionId === "button-theme.refill");
  assert.notDeepEqual(applied.payload.curve, linearCurve);
  await root.flush();
  const state = root.requests.filter(({ actionId }) => actionId === "owner-state.write").at(-1).payload.state;
  assert.deepEqual(Object.keys(state).sort(), ["activePackage", "buttonTheme", "referenceImagePath", "schemaVersion"]);
  const reopened = await render({ ownerState: state }); assert.equal(reopened.ready, true);
});
