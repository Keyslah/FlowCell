import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  buildButtonsSurfaceButtons,
  buildPanelRailButtons,
  buttonsSurfaceContentOrigin,
  PANEL_BUTTON_GAP,
  panelButtonViewport,
  rails
} from "./.compiled-button-system/pages/main/mainLayout.js";
import {
  buttonSpacingPixelsFromMillimeters,
  buttonRectsOverlap,
  createStarterButtonLayout,
  orderButtonRectsByVisualRows,
  orderRaisedKeyPaintSlots
} from "./.compiled-button-system/button/geometry/buttonGeometry.js";
import { cloneButtonDocument, createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { ensureDefaultPanelPopout, ensureRegularPopout, ensureFanSetup, buildQuickDefaultFanDocument } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { findPanelOwnerButton, resolvePanelOwnerMainPlacement } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import { applyButtonSettingsFile, buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import { resolveToolSetOwnerActivationTarget } from "./.compiled-button-system/button/runtime/toolSetOwnerHotkeyBridge.js";
import { getButtonDefaultPopoutChoice, createButtonDefaultPopoutChoice, setButtonDefaultPopoutChoice } from "./.compiled-button-system/button/state/buttonDefaultPopout.js";
import { BUTTON_FAN_STYLE_CATALOG, resolveButtonFanStyle } from "./.compiled-button-system/button/fan/buttonFanMotion.js";
import { DEFAULT_BUTTON_FAN_DIRECTION, resolveButtonFanExpansionDirection } from "./.compiled-button-system/button/fan/buttonFanDirection.js";
import { applyPanelPopoutPreset } from "./.compiled-button-system/button/state/buttonPanelPopoutPresets.js";
import { defaultPanelButtonSize } from "./.compiled-button-system/button/state/buttonPanelDefaults.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (...segments) =>
  readFileSync(path.join(frontendRoot, ...segments), "utf8");

function mainPopFixture() {
  const document = createButtonStateDocument();
  const ids = ["Project", ...Array.from({ length: 8 }, (_, index) => `Other ${index + 1}`)];
  const panel = {
    id: "files-panel", name: "Windows / Files", kind: "panel", width: 600, height: 300,
    placementIds: [], visualOverflowAllowance: 24, uniformButtonSize: null
  };
  document.surfaces[panel.id] = panel;
  for (const [index, id] of [...ids].reverse().entries()) {
    document.buttons[id] = {
      id, role: "single-script", sourceIdentity: createButtonSourceIdentity("Windows", "Files", `${id}.ps1`),
      label: id, tooltip: "", executionTarget: { kind: "panel-script", programName: "Windows", panelName: "Files", fileName: `${id}.ps1` },
      defaultSkinId: "skin-default-neutral", defaultTextFitMode: "shrink", disabled: false,
      activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
    };
    const visualIndex = ids.indexOf(id);
    const placement = {
      id: `main-${id}`, buttonId: id, surfaceId: panel.id,
      x: (visualIndex % 4) * 128, y: Math.floor(visualIndex / 4) * 48,
      width: id === "Project" ? 104 : 120, height: id === "Project" ? 36 : 40,
      zIndex: index, skinOverrideId: "skin-default-neutral", textFitMode: "stack-whole-words", textAlignment: "center",
      textOffsetX: 3, textOffsetY: -2, minimumFontSize: 9, textSizeOverride: 15,
      allowLabelResize: false, matchHitboxToSkin: false, allowStretching: false,
      highlightOnHover: true, activationCycle: null, visualStateMap: null, resizeAnchor: "top-left"
    };
    document.placements[placement.id] = placement;
    panel.placementIds.push(placement.id);
  }
  return { document, ids, panel };
}

function mainPopHarness(fixture, selectedIds = []) {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const identityStart = source.indexOf("function sourceIdentityMatchesFolderScope(");
  const identityEnd = source.indexOf("type CanonicalRenameScope", identityStart);
  const start = source.indexOf("const openPanelButtonsPop = async");
  const end = source.indexOf("const handleChoosePanelPop = async", start);
  assert.ok(identityStart >= 0 && identityEnd > identityStart && start >= 0 && end > start,
    "execute the actual Main selected-Button Pop handlers");
  const compiled = ts.transpileModule(
    source.slice(identityStart, identityEnd) + source.slice(start, end) +
    "\nglobalThis.openPanelPop = handleOpenPanelPop; globalThis.openButtonsPop = openPanelButtonsPop;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  let current = fixture.document;
  const opened = [];
  const toolSets = [];
  const alerts = [];
  const savedChoices = [];
  const sandbox = {
    selectedProgramName: "Windows", selectedPanelName: "Files",
    selectedPanelScriptRecords: selectedIds.map((id) => ({ canonicalButtonId: id, fileName: `${id}.ps1`, label: id })),
    buttonDocumentRef: { current },
    loadMainPageButtonBootstrap: async () => ({ document: current }),
    loadButtonStateDocument: async () => current,
    acceptButtonDocument: (document) => { current = document; sandbox.buttonDocumentRef.current = document; },
    commitButtonDocumentMutation: async (mutate) => {
      const draft = structuredClone(current);
      await mutate(draft);
      const validation = validateButtonStateDocument(draft);
      assert.equal(validation.valid, true, JSON.stringify(validation.issues));
      current = draft;
      sandbox.buttonDocumentRef.current = current;
      return current;
    },
    ensureDefaultPanelPopout, ensureRegularPopout, applyPanelPopoutPreset, findPanelOwnerButton, getButtonDefaultPopoutChoice,
    cloneButtonDocument, createStarterButtonLayout, buttonSpacingPixelsFromMillimeters, orderButtonRectsByVisualRows,
    defaultPanelButtonSize, PANEL_BUTTON_GAP,
    areFolderNamesEqual: (left, right) => left?.trim().toLowerCase() === right?.trim().toLowerCase(),
    openButtonPopoutWindow: async (args) => opened.push(structuredClone(args)),
    activateToolSetOwner: async (id, document, behavior) => toolSets.push({ id, behavior, document }),
    readMainLastPopChoices: () => assert.fail("normal Pop must not use the previous Open Pop file"),
    openMainPopChoice: async (choice, document, ownerId, options) => savedChoices.push({ choice, ownerId, options }),
    formatErrorMessage: (error) => error.message,
    console: { error: () => {} }, window: { alert: (message) => alerts.push(message) }
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    open: () => sandbox.openPanelPop(),
    openIds: (ids) => sandbox.openButtonsPop("Windows", "Files", ids),
    get document() { return current; }, opened, toolSets, alerts, savedChoices
  };
}

function quickFanHarness(fixture, selectedIds = [], { openGate, failLabel, registrationError } = {}) {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const parsed = ts.createSourceFile("MainPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["canonicalButtonSourceKey", "sourceIdentityMatchesFolderScope"].includes(node.name?.text))
    .map((node) => node.getText(parsed)).join("\n");
  const handler = source.slice(source.indexOf("const handleOpenQuickDefaultFan ="), source.indexOf("const handleOpenFanOptions ="));
  const compiled = ts.transpileModule(`${helpers}\n${handler}\nglobalThis.open = handleOpenQuickDefaultFan;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const events = [], alerts = [], sessions = new Map();
  const responders = new Map(), drafts = new Map(), bounds = new Map(), destroyed = new Map();
  const subscribe = async (map, id, handler) => {
    map.set(id, handler);
    return () => { if (map.get(id) === handler) map.delete(id); };
  };
  const sandbox = {
    buttonDocument: fixture.document, buttonDocumentRef: { current: fixture.document },
    selectedProgramName: "Windows", selectedPanelName: "Files", quickFanOpeningRef: { current: false },
    mainPopDraftSessionsRef: { current: sessions },
    selectedPanelScriptRecords: selectedIds.map((id) => ({ fileName: `${id}.ps1`, label: id })),
    buildQuickDefaultFanDocument,
    areFolderNamesEqual: (a, b) => a?.trim().toLowerCase() === b?.trim().toLowerCase(),
    buildButtonFanWindowLabel: (owner) => `fan:${owner}`,
    buildButtonPopoutWindowLabel: ({ popoutUnitId }) => `pop:${popoutUnitId}`,
    loadButtonStateDocument: async () => assert.fail("Main already has its current document"),
    saveButtonStateDocument: async () => assert.fail("quick Fans must not save canonical state"),
    publishButtonCommit: async () => assert.fail("quick Fans must not publish canonical commits"),
    registerButtonDraftResponder: (id, fn) => subscribe(responders, id, fn),
    subscribeButtonDrafts: async (id, fn) => {
      if (registrationError) throw new Error(registrationError);
      return subscribe(drafts, id, fn);
    },
    subscribeButtonRestingWindowBounds: (id, fn) => subscribe(bounds, id, fn),
    publishButtonDraftToWindow: async (id, label, document) => events.push(["draft", { id, label, document }]),
    openButtonFanWindow: async (args) => {
      events.push(["fan", args]);
      if (openGate) await openGate.promise;
      if (failLabel === "fan") throw new Error("fan open failed");
    },
    openButtonPopoutWindow: async (args) => {
      events.push(["pop", args]);
      if (failLabel === args.popoutUnitId) throw new Error("pop open failed");
    },
    closeButtonPopoutWindow: async (args) => events.push(["close", args]),
    closeButtonFanWindow: async (id) => events.push(["close-fan", id]),
    WebviewWindow: { getByLabel: async (label) => ({ once: async (event, fn) => {
      assert.equal(event, "tauri://destroyed"); return subscribe(destroyed, label, fn);
    } }) },
    formatErrorMessage: (error) => error.message,
    console: { error: () => {} }, window: { alert: (message) => alerts.push(message) }
  };
  vm.runInNewContext(compiled, sandbox);
  return { open: () => sandbox.open(), events, alerts, sessions, responders, drafts, bounds, destroyed,
    sessionFor: (id) => [...sessions.values()].find((session) => session.document === responders.get(id)?.()),
    select: (ids) => { sandbox.selectedPanelScriptRecords = ids.map((id) => ({ fileName: `${id}.ps1`, label: id })); } };
}

test("Main Fan always deploys fresh defaults without saving or reopening an authored setup", async () => {
  const fixture = mainPopFixture();
  const saved = ensureFanSetup({ document: fixture.document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => fixture.document.buttons[id]) });
  fixture.document.placements[saved.fanMemberPlacementIds[0]].x = 777;
  fixture.document.surfaces[saved.fanSurfaceId].uniformButtonSize = { width: 69, height: 41 };
  const before = structuredClone(fixture.document);
  const harness = quickFanHarness(fixture);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  const first = harness.events.find(([kind]) => kind === "fan")[1];
  const firstSession = harness.sessionFor(first.draftSessionId);
  const firstSetup = firstSession.document.fanSetups[first.fanSetupId];
  assert.notEqual(first.fanSetupId, saved.id);
  assert.equal(first.registerInLayout, false);
  assert.equal(firstSession.document.surfaces[firstSetup.fanSurfaceId].uniformButtonSize, null);
  const oldDestroyed = harness.destroyed.get(`fan:${first.panelOwnerButtonId}`);
  const oldDraft = harness.drafts.get(first.draftSessionId);
  const oldResponder = harness.responders.get(first.draftSessionId);
  const edited = structuredClone(firstSession.document);
  edited.placements[firstSetup.fanMemberPlacementIds[0]].x = 999;
  oldDraft(edited);
  await harness.open();
  const second = harness.events.filter(([kind]) => kind === "fan").at(-1)[1];
  const secondSession = harness.sessionFor(second.draftSessionId);
  const secondSetup = secondSession.document.fanSetups[second.fanSetupId];
  assert.notEqual(second.fanSetupId, first.fanSetupId);
  assert.notEqual(second.draftSessionId, first.draftSessionId, "each launch has an isolated wire session before the window context changes");
  assert.equal(oldResponder(), edited, "a queued old-context request must never receive the replacement draft");
  assert.equal(harness.responders.has(first.draftSessionId), false);
  assert.notEqual(secondSession.document.placements[secondSetup.fanMemberPlacementIds[0]].x, 999);
  oldDestroyed(); oldDraft(edited);
  assert.equal(harness.sessionFor(second.draftSessionId), secondSession, "retired callbacks cannot replace or dispose the current session");
  assert.equal(harness.sessions.size, 1);
  assert.deepEqual(fixture.document, before, "authored setups and the canonical document stay unchanged");
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const action = source.slice(source.indexOf('if (button.actionId === "open-fan-setup-menu")'), source.indexOf('if (button.actionId === "edit-fan-setups")'));
  assert.match(action, /handleOpenQuickDefaultFan\(\)/);
  assert.doesNotMatch(source, /panelFanSetups|handleOpenSavedFanSetup|Saved fan setups|\{fanSetupMenu \?/);
});

test("quick Fan honors highlighted scripts, defaults to all eligible Buttons, and rejects stale selections", async () => {
  const fixture = mainPopFixture();
  fixture.document.buttons[fixture.ids.at(-1)].metadata.themeContributionOnly = true;
  const harness = quickFanHarness(fixture, ["Project"]);
  await harness.open();
  const args = harness.events.find(([kind]) => kind === "fan")[1];
  assert.deepEqual(Array.from(harness.sessionFor(args.draftSessionId).document.fanSetups[args.fanSetupId].fanMemberButtonIds), ["Project"]);
  harness.select([]);
  await harness.open();
  const all = harness.events.filter(([kind]) => kind === "fan").at(-1)[1];
  assert.equal(harness.sessionFor(all.draftSessionId).document.fanSetups[all.fanSetupId].fanMemberButtonIds.length, fixture.ids.length - 1);
  const eventCount = harness.events.length;
  harness.select(["removed"]);
  await harness.open();
  assert.equal(harness.events.length, eventCount);
  assert.match(harness.alerts[0], /Canonical Button was not found/);
});

test("quick Fan and selected toolsets use isolated draft sessions and retain independent bounds", async () => {
  const fixture = mainPopFixture();
  const [one, two, excluded] = fixture.ids.slice(1, 4);
  for (const id of [one, two, excluded]) {
    fixture.document.buttons[id].role = "tool-set-owner";
    fixture.document.popoutUnits[id] = { id, kind: "tool-set", ownerButtonId: id };
  }
  const before = structuredClone(fixture.document);
  const harness = quickFanHarness(fixture, ["Project", one, two]);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  const fan = harness.events.find(([kind]) => kind === "fan")[1];
  const pops = harness.events.filter(([kind]) => kind === "pop").map(([, args]) => args);
  assert.deepEqual(pops.map((args) => args.ownerButtonId), [one, two]);
  assert.equal(new Set([fan.draftSessionId, ...pops.map((args) => args.draftSessionId)]).size, 3);
  assert.ok(pops.every((args) => args.registerInLayout === false));
  assert.deepEqual(harness.events.filter(([kind]) => kind === "close").map(([, args]) => args.ownerButtonId), [excluded]);
  const geometry = { bounds: { left: 23, top: 42, width: 400, height: 80 }, fitMode: "surface", envelope: { x: 0, y: 0, width: 400, height: 80 } };
  harness.bounds.get(fan.draftSessionId)({ kind: "fan", fanSetupId: fan.fanSetupId, ...geometry });
  harness.bounds.get(pops[0].draftSessionId)({ kind: "popout", popoutUnitId: one, ...geometry });
  assert.deepEqual(harness.responders.get(fan.draftSessionId)().fanSetups[fan.fanSetupId].collapsedPanelOwnerBounds, geometry.bounds);
  assert.deepEqual(harness.responders.get(pops[0].draftSessionId)().popoutUnits[one].desktopBounds, geometry.bounds);
  assert.equal(harness.responders.get(pops[1].draftSessionId)().popoutUnits[one].desktopBounds, undefined);
  const otherBranch = structuredClone(harness.responders.get(pops[1].draftSessionId)());
  harness.drafts.get(pops[1].draftSessionId)(otherBranch);
  assert.deepEqual(harness.responders.get(pops[0].draftSessionId)().popoutUnits[one].desktopBounds, geometry.bounds);
  harness.destroyed.get(`fan:${fan.panelOwnerButtonId}`)();
  assert.equal(harness.sessions.size, 2, "closing the Fan must not retire surviving toolset sessions");
  harness.destroyed.get(`pop:${one}`)(); harness.destroyed.get(`pop:${two}`)();
  assert.equal(harness.sessions.size, 0);
  assert.equal(harness.responders.size, 0);
  assert.equal(harness.bounds.size, 0);
  assert.deepEqual(fixture.document, before);
  harness.select([one]);
  await harness.open();
  assert.equal(harness.events.filter(([kind]) => kind === "fan").length, 1, "toolset-only selection opens no script Fan");
  assert.equal(harness.sessions.size, 1);
});

test("quick Fan cleans failed registrations and opens, and suppresses overlapping launches", async () => {
  for (const options of [{ registrationError: "subscribe failed" }, { failLabel: "fan" }]) {
    const harness = quickFanHarness(mainPopFixture(), [], options);
    await harness.open();
    assert.equal(harness.alerts.length, 1);
    assert.equal(harness.sessions.size, 0);
    assert.equal(harness.responders.size, 0);
  }
  const openGate = Promise.withResolvers();
  const harness = quickFanHarness(mainPopFixture(), [], { openGate });
  const operation = harness.open();
  await new Promise((resolve) => setImmediate(resolve));
  await harness.open();
  assert.equal(harness.events.filter(([kind]) => kind === "fan").length, 1);
  openGate.resolve();
  await operation;
  assert.deepEqual(harness.alerts, []);
});

test("Main Pop opens the whole assigned panel default even with a partial regular selection", async () => {
  const fixture = mainPopFixture();
  const fan = ensureFanSetup({ document: fixture.document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => fixture.document.buttons[id]) });
  const choice = createButtonDefaultPopoutChoice(fan.panelOwnerButtonId, fan.fanSurfaceId, "C:/saved/Chosen.json");
  setButtonDefaultPopoutChoice(fixture.document, fan.panelOwnerButtonId, choice);
  const before = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture);
  await harness.open();
  assert.equal(harness.savedChoices.length, 1);
  assert.deepEqual(harness.savedChoices[0].choice, choice);
  assert.equal(harness.opened.length, 0);
  assert.deepEqual(harness.document, before, "opening the selected default must not change files or arrangements");
  await harness.openIds(fixture.ids);
  assert.equal(harness.savedChoices.length, 2, "Select All uses the same explicit panel default");
  await harness.openIds(["Project"]);
  assert.equal(harness.savedChoices.length, 3, "a focused regular Button still opens the whole saved setup");
  assert.deepEqual(harness.savedChoices[2].choice, choice);
  assert.equal(harness.opened.length, 0);
  assert.deepEqual(harness.document, before);
});

test("Main Pop keeps explicit toolset selections independent from a saved panel default", async () => {
  const fixture = mainPopFixture();
  const fan = ensureFanSetup({ document: fixture.document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => fixture.document.buttons[id]) });
  const choice = createButtonDefaultPopoutChoice(fan.panelOwnerButtonId, fan.fanSurfaceId, "C:/saved/Panel.json");
  setButtonDefaultPopoutChoice(fixture.document, fan.panelOwnerButtonId, choice);
  const ownerIds = ["First toolset", "Second toolset"];
  for (const id of ownerIds) {
    const owner = { ...structuredClone(fixture.document.buttons.Project), id, role: "tool-set-owner", executionTarget: null,
      sourceIdentity: createButtonSourceIdentity("Windows", "Files", `${id}.flowcell.toolset.json`) };
    fixture.document.buttons[id] = owner;
    setButtonDefaultPopoutChoice(fixture.document, id,
      createButtonDefaultPopoutChoice(id, `surface-${id}`, `C:/saved/${id}.json`));
  }
  const before = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture);
  await harness.openIds(ownerIds);
  assert.deepEqual(harness.toolSets.map(({ id, behavior }) => ({ id, behavior })),
    ownerIds.map((id) => ({ id, behavior: "open" })), "each selected owner resolves its own whole toolset default");
  assert.equal(harness.savedChoices.length, 0);
  assert.equal(harness.opened.length, 0);
  await harness.openIds(["Project", ownerIds[0]]);
  assert.equal(harness.savedChoices.length, 1, "mixed selections use the assigned whole-panel setup");
  assert.deepEqual(harness.savedChoices[0].choice, choice);
  assert.equal(harness.toolSets.length, 2, "the saved panel setup is the only opening for a mixed selection");
  await harness.openIds([]);
  assert.equal(harness.savedChoices.length, 2, "no selection still opens the panel default when the panel has toolsets");
  assert.deepEqual(harness.document, before);
  await assert.rejects(() => harness.openIds(["Missing", ownerIds[0]]), /no longer belongs/);
  assert.equal(harness.savedChoices.length, 2, "stale selection is rejected before any default opens");
  assert.equal(harness.toolSets.length, 2);
});

test("Fan Options offers the complete style catalog and updates only the selected panel", () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const parsed = ts.createSourceFile("MainPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["applyMainPanelFanStyle", "sourceIdentityMatchesFolderScope"].includes(node.name?.text)).map((node) => node.getText(parsed)).join("\n");
  const compiled = ts.transpileModule(functions + "\nglobalThis.applyStyle = applyMainPanelFanStyle;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sandbox = { findPanelOwnerButton, resolveButtonFanStyle, DEFAULT_BUTTON_FAN_DIRECTION,
    areFolderNamesEqual: (a, b) => a?.trim().toLowerCase() === b?.trim().toLowerCase() };
  vm.runInNewContext(compiled, sandbox);
  const fixture = mainPopFixture();
  const document = fixture.document;
  const members = fixture.ids.map((id) => document.buttons[id]);
  const fan = ensureFanSetup({ document, programName: "Windows", panelName: "Files", buttons: members });
  const pop = ensureRegularPopout(document, members);
  const otherButton = structuredClone(members[0]);
  otherButton.id = "unrelated";
  otherButton.sourceIdentity = createButtonSourceIdentity("Windows", "Other", "other.ps1");
  document.buttons[otherButton.id] = otherButton;
  const other = ensureRegularPopout(document, [otherButton]);
  const unrelated = structuredClone(other);
  const geometry = structuredClone(document.placements);
  assert.equal(sandbox.applyStyle(document, "Windows", "Files", "spin"), true);
  assert.equal(document.buttons[fan.panelOwnerButtonId].metadata.panelFanMotionStyle, "spin");
  assert.equal(document.buttons[fan.panelOwnerButtonId].metadata.panelFanDirection, "right");
  assert.equal(fan.animation.spinEnabled, true);
  assert.equal(pop.fanAnimation.spinEnabled, true);
  assert.deepEqual(document.popoutUnits[other.id], unrelated);
  assert.deepEqual(document.placements, geometry);
  assert.equal(sandbox.applyStyle(document, "Windows", "Files", "spin"), false);
  assert.equal(sandbox.applyStyle(document, "Windows", "Files", "default"), true);
  assert.equal(fan.animation.spinEnabled, false);
  assert.equal(pop.fanAnimation.spinEnabled, false);
  const styledAnimation = { spinEnabled: false, durationMs: 350, easing: "ease-in", staggerMs: 12 };
  sandbox.resolveButtonFanStyle = () => ({ id: "default", name: "Default", animation: styledAnimation });
  assert.equal(sandbox.applyStyle(document, "Windows", "Files", "default"), true,
    "changed timing in a catalog style must commit even when its ID and spin mode are unchanged");
  for (const [key, value] of Object.entries(styledAnimation)) {
    assert.equal(fan.animation[key], value);
    assert.equal(pop.fanAnimation[key], value);
  }
  assert.equal(sandbox.applyStyle(document, "Windows", "Files", "default"), false);
  for (const direction of ["left", "top", "bottom", "right"]) {
    assert.equal(sandbox.applyStyle(document, "Windows", "Files", "default", direction), true,
      "changing direction alone must commit");
    assert.equal(document.buttons[fan.panelOwnerButtonId].metadata.panelFanDirection, direction);
    assert.equal(sandbox.applyStyle(document, "Windows", "Files", "default", direction), false);
  }
  assert.deepEqual(document.placements, geometry);
  assert.deepEqual(document.popoutUnits[other.id], unrelated);
  const action = source.slice(source.indexOf('if (button.actionId === "edit-fan-setups")'), source.indexOf('if (button.actionId === "edit-button-layout")'));
  assert.match(action, /handleOpenFanOptions\(\)/);
  assert.doesNotMatch(action, /openButtonEditorWindow/);
  const dialog = source.slice(source.indexOf("{isFanOptionsOpen ? ("), source.indexOf("{isSettingsOpen ? ("));
  assert.match(dialog, /BUTTON_FAN_STYLE_CATALOG\.map\(\(style\)/);
  assert.match(dialog, /\{style\.name\}/);
  assert.equal(new Set(BUTTON_FAN_STYLE_CATALOG.map((style) => style.id)).size, BUTTON_FAN_STYLE_CATALOG.length);
  assert.equal(resolveButtonFanStyle("default")?.name, "Default");
  assert.equal(resolveButtonFanStyle("spin")?.name, "Spin");
  for (const style of BUTTON_FAN_STYLE_CATALOG) assert.equal(resolveButtonFanStyle(style.id), style);
  assert.equal(resolveButtonFanStyle("missing-style"), null);
  assert.match(dialog, /role="dialog"/);
  assert.doesNotMatch(dialog, /Open Pop|Button Editor|saved file/);
});

test("Fan Options stages animation and direction together and only Apply commits both", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const handleOpenFanOptions =");
  const end = source.indexOf("const handleOpenButtonOrder =", start);
  const dialog = source.slice(source.indexOf("{isFanOptionsOpen ? ("), source.indexOf("{isSettingsOpen ? ("));
  const styleClick = dialog.match(/className="main-page__fan-style"[\s\S]*?onClick=\{(\(\) => setPendingFanStyleId\(style.id\))\}/);
  const directionClick = dialog.match(/className="main-page__fan-direction"[\s\S]*?onClick=\{(\(\) => setPendingFanDirection\(direction.id\))\}/);
  assert.ok(styleClick, "style buttons must only stage the highlighted choice");
  assert.ok(directionClick, "direction buttons must only stage the highlighted choice");
  const compiled = ts.transpileModule(source.slice(start, end) + `
    globalThis.openOptions = handleOpenFanOptions;
    globalThis.closeOptions = handleCloseFanOptions;
    globalThis.applyStyle = handleApplyFanStyle;
    globalThis.selectStyle = (id) => { const style = { id }; (${styleClick[1]})(); };
    globalThis.selectDirection = (id) => { const direction = { id }; (${directionClick[1]})(); };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixture = mainPopFixture();
  const fan = ensureFanSetup({ document: fixture.document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => fixture.document.buttons[id]) });
  const owner = fixture.document.buttons[fan.panelOwnerButtonId];
  owner.metadata.panelFanMotionStyle = "spin";
  owner.metadata.panelFanDirection = "left";
  const before = structuredClone(fixture.document);
  const commits = [];
  const alerts = [];
  let pendingCommit;
  const sandbox = {
    selectedProgramName: "Windows", selectedPanelName: "Files",
    buttonDocumentRef: { current: fixture.document }, fanStyleBusy: false, pendingFanStyleId: null,
    pendingFanDirection: DEFAULT_BUTTON_FAN_DIRECTION, isOpen: false,
    findPanelOwnerButton, resolveButtonFanStyle, DEFAULT_BUTTON_FAN_DIRECTION, resolveButtonFanExpansionDirection,
    setPendingFanStyleId: (id) => { sandbox.pendingFanStyleId = id; },
    setPendingFanDirection: (direction) => { sandbox.pendingFanDirection = direction; },
    setIsFanOptionsOpen: (value) => { sandbox.isOpen = value; },
    setFanStyleBusy: (value) => { sandbox.fanStyleBusy = value; },
    applyMainPanelFanStyle: (document, program, panel, id, direction) => {
      assert.equal(program, "Windows"); assert.equal(panel, "Files");
      document.buttons[owner.id].metadata.panelFanMotionStyle = id;
      document.buttons[owner.id].metadata.panelFanDirection = direction;
      return true;
    },
    commitButtonDocumentMutation: async (mutate) => {
      commits.push(mutate);
      pendingCommit = Promise.withResolvers();
      await pendingCommit.promise;
      mutate(sandbox.buttonDocumentRef.current);
    },
    formatErrorMessage: (error) => error.message,
    window: { alert: (message) => alerts.push(message) }
  };
  vm.runInNewContext(compiled, sandbox);
  sandbox.openOptions();
  assert.equal(sandbox.pendingFanStyleId, "spin", "opening highlights the panel's applied style");
  assert.equal(sandbox.pendingFanDirection, "left", "opening highlights the panel's applied direction");
  sandbox.selectStyle("default");
  sandbox.selectDirection("bottom");
  assert.equal(sandbox.pendingFanStyleId, "default");
  assert.equal(commits.length, 0);
  assert.deepEqual(fixture.document, before);
  sandbox.closeOptions();
  assert.equal(sandbox.isOpen, false);
  assert.equal(sandbox.pendingFanStyleId, null);
  assert.equal(sandbox.pendingFanDirection, "right");
  sandbox.openOptions();
  assert.equal(sandbox.pendingFanStyleId, "spin", "closing discards the unapplied choice");
  assert.equal(sandbox.pendingFanDirection, "left", "closing discards the unapplied direction");
  sandbox.selectStyle("default");
  sandbox.selectDirection("top");
  const applying = sandbox.applyStyle();
  assert.equal(sandbox.fanStyleBusy, true);
  await sandbox.applyStyle();
  sandbox.closeOptions();
  sandbox.openOptions();
  assert.equal(commits.length, 1, "busy Apply cannot issue another commit");
  assert.equal(sandbox.isOpen, true, "busy close cannot discard an in-flight selection");
  assert.equal(sandbox.pendingFanStyleId, "default");
  assert.equal(sandbox.pendingFanDirection, "top");
  pendingCommit.resolve();
  await applying;
  assert.equal(owner.metadata.panelFanMotionStyle, "default");
  assert.equal(owner.metadata.panelFanDirection, "top", "Apply commits style and direction in one mutation");
  assert.equal(sandbox.isOpen, false);
  assert.equal(sandbox.pendingFanStyleId, null);
  assert.equal(sandbox.pendingFanDirection, "right");
  assert.equal(sandbox.fanStyleBusy, false);
  sandbox.openOptions();
  assert.equal(sandbox.pendingFanStyleId, "default", "reopening starts with the newly applied style");
  assert.equal(sandbox.pendingFanDirection, "top");
  sandbox.selectStyle("spin");
  sandbox.selectDirection("bottom");
  const failing = sandbox.applyStyle();
  pendingCommit.reject(new Error("disk unavailable"));
  await failing;
  assert.equal(sandbox.isOpen, true, "failed saves retain the selected choice for retry");
  assert.equal(sandbox.pendingFanStyleId, "spin");
  assert.equal(sandbox.pendingFanDirection, "bottom");
  assert.equal(sandbox.fanStyleBusy, false);
  assert.match(alerts[0], /disk unavailable/);
  assert.equal(owner.metadata.panelFanMotionStyle, "default");
  assert.equal(owner.metadata.panelFanDirection, "top");
  sandbox.closeOptions();
  delete owner.metadata.panelFanMotionStyle;
  owner.metadata.panelFanDirection = "invalid";
  sandbox.openOptions();
  assert.equal(sandbox.pendingFanStyleId, "default", "panels with no applied choice start with Default");
  assert.equal(sandbox.pendingFanDirection, "right", "invalid stored direction falls back to Right");
  sandbox.closeOptions();
  delete owner.metadata.panelFanDirection;
  sandbox.openOptions();
  assert.equal(sandbox.pendingFanDirection, "right", "missing stored direction defaults to Right");
  assert.match(dialog, /aria-pressed=\{pendingFanStyleId === style.id\}/);
  assert.match(dialog, /aria-pressed=\{pendingFanDirection === direction.id\}/);
  assert.match(dialog, /MAIN_FAN_DIRECTIONS\.map/);
  assert.match(dialog, /<legend>Direction<\/legend>/);
  for (const [id, label] of [["left", "Left"], ["right", "Right"], ["top", "Top"], ["bottom", "Bottom"]]) {
    assert.ok(source.includes(`{ id: "${id}", name: "${label}" }`));
  }
  assert.match(dialog, /onClick=\{\(\) => void handleApplyFanStyle\(\)\}>Apply<\/button>/);
  assert.match(dialog, /onMouseDown=\{handleCloseFanOptions\}/);
  assert.match(dialog, /event.key === "Escape"\) handleCloseFanOptions\(\)/);
  assert.match(dialog, /autoFocus disabled=\{fanStyleBusy\} onClick=\{handleCloseFanOptions\}/);
  assert.match(dialog, /className="main-page__fan-style" disabled=\{fanStyleBusy\}/);
  assert.match(dialog, /className="main-page__fan-direction" disabled=\{fanStyleBusy\}/);
  assert.match(dialog, /className="main-page__fan-apply" disabled=\{fanStyleBusy \|\| !pendingFanStyleId\}/);
  assert.match(source, /setIsFanOptionsOpen\(false\);\s+setPendingFanStyleId\(null\);\s+setPendingFanDirection\(DEFAULT_BUTTON_FAN_DIRECTION\);\s+\}, \[selectedPanelName, selectedProgramName\]\)/);
  assert.match(readSource("src", "pages", "main", "mainPage.css"), /\.main-page__fan-style\[aria-pressed="true"\]/);
  assert.match(readSource("src", "pages", "main", "mainPage.css"), /\.main-page__fan-direction\[aria-pressed="true"\]/);
});

test("toolset activation uses its explicit default file and Open Pop never changes the default", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const activateToolSetOwner = useCallback");
  const end = source.indexOf("\n  useEffect(", start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.activate = activateToolSetOwner;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const fixture = mainPopFixture();
  const owner = fixture.document.buttons.Project;
  owner.role = "tool-set-owner";
  const choice = createButtonDefaultPopoutChoice(owner.id, "toolset-surface", "C:/saved/Toolset.json");
  setButtonDefaultPopoutChoice(fixture.document, owner.id, choice);
  const calls = [];
  const sandbox = { useCallback: (callback) => callback, acceptButtonDocument: () => {},
    buttonDocumentRef: { current: fixture.document }, getButtonDefaultPopoutChoice,
    resolveToolSetOwnerActivationTarget: () => ({ programName: "Windows", panelName: "Files", popoutUnitId: "toolset", ownerButtonId: owner.id }),
    openMainPopChoice: async (...args) => calls.push(args),
    openButtonPopoutWindow: async () => assert.fail("explicit default takes precedence over package default"),
    toggleButtonPopoutWindow: async () => assert.fail("explicit default takes precedence over package default") };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.activate(owner.id);
  assert.deepEqual(calls[0][0], choice);
  assert.equal(calls[0][3].toggle, true, "toolset owner preserves toggle activation");
  assert.equal(calls[0][3].toolSetOwnerButtonId, owner.id, "the saved layout must target the selected whole toolset");
  await sandbox.activate(owner.id, fixture.document, "open");
  assert.equal(calls[1][3].toggle, false);
  const openPop = source.slice(source.indexOf("const openMainPopChoice = async"), source.indexOf("const openPanelButtonsPop = async"));
  assert.doesNotMatch(openPop, /writeMainLastPopChoice|setButtonDefaultPopoutChoice|saveButtonSettingsFile/);
});

test("a saved toolset template assigned to another owner opens all of the target toolset without rewriting either setup", async () => {
  const fixture = mainPopFixture();
  const document = fixture.document;
  const fan = ensureFanSetup({ document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => document.buttons[id]) });
  document.surfaces["owner-main"] = { ...structuredClone(fixture.panel), id: "owner-main", kind: "main",
    placementIds: ["owner-main-placement"] };
  document.placements["owner-main-placement"] = { ...structuredClone(document.placements["main-Project"]),
    id: "owner-main-placement", buttonId: fan.panelOwnerButtonId, surfaceId: "owner-main" };
  for (const name of ["source", "target"]) {
    const ownerId = `${name}-owner`, surfaceId = `${name}-surface`;
    const sourceIdentity = createButtonSourceIdentity("Windows", "Files", `${name}.flowcell-source.json`);
    document.buttons[ownerId] = { ...structuredClone(document.buttons.Project), id: ownerId,
      label: ownerId, role: "tool-set-owner", sourceIdentity, executionTarget: null };
    const childIds = [0, 1].map((index) => `${name}-child-${index}`);
    const placementIds = childIds.map((buttonId, index) => {
      document.buttons[buttonId] = { ...structuredClone(document.buttons.Project), id: buttonId,
        label: buttonId, role: "tool-set-child", sourceIdentity, toolSetParentId: ownerId,
        executionTarget: { kind: "core-action", actionId: `${name}-${index}` }, metadata: { toolSetSlot: `${index}` } };
      const id = `${buttonId}-placement`;
      document.placements[id] = { ...structuredClone(document.placements["main-Project"]), id,
        buttonId, surfaceId, x: 16 + index * 140, y: 12, zIndex: index };
      return id;
    });
    document.surfaces[surfaceId] = { id: surfaceId, name: `${name} Tool Set`, kind: "tool-set-popout",
      width: 300, height: 80, placementIds, visualOverflowAllowance: 24, uniformButtonSize: null };
    document.popoutUnits[`${name}-unit`] = { id: `${name}-unit`, name: `${name} Tool Set`, kind: "tool-set",
      surfaceId, ownerButtonId: ownerId, canonicalBounds: { x: 0, y: 0, width: 300, height: 80 }, desktopBounds: null,
      childButtonIds: childIds, childPlacementIds: [...placementIds], fields: [], openRule: "toggle", closeRule: "escape",
      transparency: 1, pinnedDefault: false, interactionMode: "pop", windowFitMode: "surface" };
  }
  const savedFile = buildButtonSettingsFile(document, "source-surface", { programName: "Windows", panelName: "Files" });
  const choice = createButtonDefaultPopoutChoice("target-owner", "target-surface", "C:/saved/Source-template.json");
  setButtonDefaultPopoutChoice(document, "target-owner", choice);
  const before = structuredClone(document), savedBefore = structuredClone(savedFile);
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const parsed = ts.createSourceFile("MainPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["loadMainPopSettingsFile", "sourceIdentityMatchesFolderScope"].includes(node.name?.text))
    .map((node) => node.getText(parsed)).join("\n");
  const activationStart = source.indexOf("const activateToolSetOwner = useCallback");
  const activation = source.slice(activationStart, source.indexOf("\n  useEffect(", activationStart));
  const opening = source.slice(source.indexOf("const openMainPopChoice = async"), source.indexOf("const openPanelButtonsPop = async"));
  const compiled = ts.transpileModule(`${helpers}\n${activation}\n${opening}\nglobalThis.activate = activateToolSetOwner;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const opened = [], published = [];
  const sandbox = { useCallback: (callback) => callback, acceptButtonDocument: () => {},
    buttonDocumentRef: { current: document }, mainPopDraftSessionsRef: { current: new Map() },
    getButtonDefaultPopoutChoice, resolveToolSetOwnerActivationTarget, resolvePanelOwnerMainPlacement,
    applyButtonSettingsFile, buildButtonSettingsFile, buildTransientButtonPopoutSettingsDocument,
    areFolderNamesEqual: (a, b) => a?.trim().toLowerCase() === b?.trim().toLowerCase(),
    panelPopoutPresetFromPath: () => null, loadButtonSettingsFile: async () => savedFile,
    resolveButtonSettingsFilePath: async (value) => value,
    buildButtonPopoutWindowLabel: ({ popoutUnitId, ownerButtonId }) => `pop:${ownerButtonId ?? popoutUnitId}`,
    registerButtonDraftResponder: async () => () => {}, subscribeButtonDrafts: async () => () => {},
    WebviewWindow: { getByLabel: async () => null },
    openButtonPopoutWindow: async (args) => opened.push(args),
    publishButtonDraftToWindow: async (_session, _label, draft) => published.push(draft),
    toggleButtonPopoutWindow: async () => assert.fail("the assigned saved file must be used") };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.activate("target-owner", document, "open");
  assert.equal(opened.length, 1);
  assert.equal(opened[0].ownerButtonId, "target-owner");
  assert.equal(opened[0].settingsBackedLayout.panelOwnerButtonId, fan.panelOwnerButtonId,
    "layout registration still belongs to the containing panel");
  const transientUnit = published[0].popoutUnits[opened[0].popoutUnitId];
  assert.equal(transientUnit.ownerButtonId, "target-owner");
  assert.deepEqual(transientUnit.childPlacementIds.map((id) => published[0].placements[id].buttonId),
    ["target-child-0", "target-child-1"], "the complete target toolset is opened, never source actions");
  assert.deepEqual(document, before, "opening a default cannot commit its remapped layout");
  assert.deepEqual(savedFile, savedBefore, "switching a default cannot rewrite the chosen file");
  assert.match(source, /toolSetOwnerButtonId: settingsBackedDescriptor\.toolSetOwnerButtonId/,
    "layout restore passes the same target owner through the shared load path");
});

test("Main Pop opens only highlighted Project even when another multi-Button Pop already exists", async () => {
  const fixture = mainPopFixture();
  fixture.document.placements["main-Project"].skinOverrideId = "skin-chipped-concrete-family-default";
  const previous = ensureRegularPopout(fixture.document, fixture.ids.map((id) => fixture.document.buttons[id]));
  const original = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture, ["Project"]);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  assert.equal(harness.opened.length, 1);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.notEqual(unit.id, previous.id);
  assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), ["Project"]);
  const placement = harness.document.placements[unit.memberPlacementIds[0]];
  const source = original.placements["main-Project"];
  for (const [key, value] of Object.entries({
    width: 160, height: 44, skinOverrideId: "skin-default-neutral", textFitMode: "shrink",
    textAlignment: "skin", textOffsetX: 0, textOffsetY: 0, minimumFontSize: 8,
    textSizeOverride: null, matchHitboxToSkin: true, highlightOnHover: false
  })) {
    assert.deepEqual(placement[key], value, `new Pop uses its own neutral ${key}`);
  }
  assert.deepEqual(harness.document.popoutUnits[previous.id], original.popoutUnits[previous.id]);
  assert.deepEqual(harness.document.placements["main-Project"], source);
  Object.assign(placement, {
    x: 28, y: 20, width: 116, height: 40, textOffsetX: 9,
    skinOverrideId: "skin-chipped-concrete-family-default"
  });
  const popupBeforeReopen = structuredClone({
    placement, unit, surface: harness.document.surfaces[unit.surfaceId]
  });
  await harness.open();
  assert.equal(harness.opened[1].popoutUnitId, unit.id, "repeated Pop reuses the exact selected unit");
  assert.deepEqual({
    placement: harness.document.placements[placement.id],
    unit: harness.document.popoutUnits[unit.id],
    surface: harness.document.surfaces[unit.surfaceId]
  }, popupBeforeReopen, "reopening preserves the Pop's custom skin, size, position and text offset");
});

test("Main Pop preserves an authored Fan with the same selection and reuses a separate ownerless Pop", async () => {
  const fixture = mainPopFixture();
  const fan = ensureRegularPopout(fixture.document, [fixture.document.buttons.Project]);
  const surface = fixture.document.surfaces[fan.surfaceId];
  const owner = {
    ...structuredClone(fixture.document.placements[fan.memberPlacementIds[0]]),
    id: "authored-fan-owner", x: 200, y: 8
  };
  fixture.document.placements[owner.id] = owner;
  surface.placementIds.push(owner.id);
  surface.width = 376;
  Object.assign(fan, {
    interactionMode: "fan", ownerButtonId: "Project", ownerPlacementId: owner.id,
    openRule: "hover", closeRule: "hover-out", canonicalBounds: { x: 0, y: 0, width: 376, height: surface.height }
  });
  assert.equal(validateButtonStateDocument(fixture.document).valid, true);
  const original = structuredClone(fixture.document);
  const harness = mainPopHarness(fixture, ["Project"]);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  assert.equal(harness.opened.length, 1);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.notEqual(unit.id, fan.id);
  assert.equal(unit.interactionMode, "pop");
  assert.equal(unit.ownerButtonId, null);
  assert.equal(unit.ownerPlacementId, null);
  assert.deepEqual(harness.document.popoutUnits[fan.id], original.popoutUnits[fan.id]);
  assert.deepEqual(harness.document.surfaces[fan.surfaceId], original.surfaces[fan.surfaceId]);
  for (const id of surface.placementIds) assert.deepEqual(harness.document.placements[id], original.placements[id]);
  await harness.open();
  assert.equal(harness.opened[1].popoutUnitId, unit.id);
  assert.equal(Object.keys(harness.document.popoutUnits).length, 2);
});

for (const count of [2, 8, 9]) {
  test(`Main Pop packs exactly ${count} highlighted Buttons into rows of at most 4`, async () => {
    const fixture = mainPopFixture();
    const selected = fixture.ids.slice(0, count);
    const harness = mainPopHarness(fixture, [...selected].reverse());
    await harness.open();
    assert.deepEqual(harness.alerts, []);
    assert.equal(harness.opened.length, 1);
    const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
    const placements = Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id]);
    assert.deepEqual(new Set(placements.map((placement) => placement.buttonId)), new Set(selected), "Pop includes exactly the selected scripts");
    assert.deepEqual(placements.map((placement) => placement.y), selected.map((_, index) => 8 + Math.floor(index / 4) * 44));
    assert.equal(new Set(placements.map((placement) => placement.y)).size, Math.ceil(count / 4));
    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      assert.deepEqual([placement.width, placement.height], [160, 44]);
      assert.equal(placement.skinOverrideId, "skin-default-neutral");
      const expectedX = index % 4 === 0 ? 8 : placements[index - 1].x + placements[index - 1].width;
      assert.equal(placement.x, expectedX, "fresh selected Pops use the document's 0 mm spacing");
    }
    const surface = harness.document.surfaces[unit.surfaceId];
    assert.equal(surface.width, count === 2 ? 336 : 656);
    assert.equal(surface.height, 16 + Math.ceil(count / 4) * 44);
    for (const id of selected) {
      assert.deepEqual(harness.document.placements[`main-${id}`], fixture.document.placements[`main-${id}`], "Pop creation preserves Main presentation");
    }
    assert.deepEqual(JSON.parse(JSON.stringify(unit.canonicalBounds)), { x: 0, y: 0, width: surface.width, height: surface.height });
  });
}

test("Main Pop with 0 highlighted Buttons opens the whole current panel", async () => {
  const fixture = mainPopFixture();
  const unrelated = structuredClone(fixture.document.buttons.Project);
  unrelated.id = "Unrelated";
  unrelated.sourceIdentity = createButtonSourceIdentity("Windows", "Utility", "Unrelated.ps1");
  fixture.document.buttons[unrelated.id] = unrelated;
  const harness = mainPopHarness(fixture);
  await harness.open();
  assert.deepEqual(harness.alerts, []);
  const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
  assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), fixture.ids);
});

test("Main Pop opens only a highlighted tool-set owner, and mixed selection keeps its exact scripts", async () => {
  for (const mixed of [false, true]) {
    const fixture = mainPopFixture();
    const owner = structuredClone(fixture.document.buttons.Project);
    owner.id = "Selected tool set";
    owner.role = "tool-set-owner";
    owner.executionTarget = null;
    owner.sourceIdentity = createButtonSourceIdentity("Windows", "Files", "tool.flowcell.toolset.json");
    fixture.document.buttons[owner.id] = owner;
    const harness = mainPopHarness(fixture, mixed ? ["Project", owner.id] : [owner.id]);
    await harness.open();
    assert.deepEqual(harness.alerts, []);
    assert.deepEqual(harness.toolSets.map(({ id, behavior }) => ({ id, behavior })), [{ id: owner.id, behavior: "open" }]);
    assert.equal(harness.opened.length, mixed ? 1 : 0);
    if (mixed) {
      const unit = harness.document.popoutUnits[harness.opened[0].popoutUnitId];
      assert.deepEqual(Array.from(unit.memberPlacementIds, (id) => harness.document.placements[id].buttonId), ["Project"]);
    }
  }
});

test("Main Pop refuses stale or unsupported highlighted IDs instead of opening the whole panel", async () => {
  for (const selectedId of ["Missing", "Other panel", "Tool child"]) {
    const fixture = mainPopFixture();
    const otherPanel = structuredClone(fixture.document.buttons.Project);
    otherPanel.id = "Other panel";
    otherPanel.sourceIdentity = createButtonSourceIdentity("Windows", "Utility", "Other.ps1");
    fixture.document.buttons[otherPanel.id] = otherPanel;
    const child = structuredClone(fixture.document.buttons.Project);
    child.id = "Tool child";
    child.role = "tool-set-child";
    fixture.document.buttons[child.id] = child;
    const harness = mainPopHarness(fixture);
    await assert.rejects(() => harness.openIds([selectedId]));
    assert.equal(harness.opened.length, 0);
    assert.equal(harness.toolSets.length, 0);
    assert.equal(Object.keys(harness.document.popoutUnits).length, 0);
  }
});

test("the Buttons rail follows saved visual rows and includes every panel Button", () => {
  const script = (id, x, y, width) => ({
    canonicalButtonId: id,
    fileName: `${id}.ps1`,
    label: id,
    canonicalPlacement: { x, y, width, height: 37.294964 }
  });
  const scripts = [
    script("shortcycle", 710, 11.352518, 100),
    script("Minimize", 38, 59.352518, 100),
    script("Odyssey", 36, 13.352518, 88),
    ...Array.from({ length: 35 }, (_, index) => script(`Extra ${index}`, 36, 110 + 50 * index, 88))
  ];
  const original = structuredClone(scripts);
  const buttons = buildButtonsSurfaceButtons(scripts).filter((button) => button.scriptFileName);

  assert.deepEqual(buttons.slice(0, 3).map((button) => button.id), ["Odyssey", "shortcycle", "Minimize"]);
  assert.equal(buttons.length, 38);
  assert.equal(buttons[0].width, 88);
  assert.equal(buttons[0].height, 37.294964);
  assert.deepEqual(scripts, original);
});

test("the panel Button viewport aligns with Add Button inside the Buttons rail", () => {
  const rail = rails.find((entry) => entry.id === "buttons-rail");
  const addButtonX = rail.x + 6;
  const viewport = panelButtonViewport(addButtonX);

  assert.equal(PANEL_BUTTON_GAP, 8);
  assert.equal(viewport.x + viewport.paddingLeft, addButtonX);
  assert.equal(viewport.y + PANEL_BUTTON_GAP, buttonsSurfaceContentOrigin.y);
  assert.equal(viewport.x + viewport.width, rail.x + rail.width);
  assert.equal(viewport.y + viewport.height, rail.y + rail.height);
  assert.equal(viewport.maxButtonWidth + viewport.paddingLeft + 2 * PANEL_BUTTON_GAP, viewport.width);
  assert.equal(viewport.maxButtonHeight + 2 * PANEL_BUTTON_GAP, viewport.height);
});

test("layout restore skips deleted Fan setup IDs without changing saved Pop entries", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const restoreLayoutSnapshotState =");
  const end = source.indexOf("const handleSaveLayout =", start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const events = [];
  const sandbox = {
    isValidFlowCellBounds: () => true,
    closeManagedLayoutWindows: async () => {},
    loadButtonStateDocument: async () => ({ fanSetups: { retained: {} } }),
    openButtonFanWindow: async (args) => events.push(["fan", args.fanSetupId]),
    openButtonPopoutWindow: async (args) => events.push(["pop", args.popoutUnitId])
  };
  vm.runInNewContext(compiled, sandbox);
  const bounds = { Left: 10, Top: 20, Width: 300, Height: 100 };
  const snapshot = { Windows: [
    { Kind: "button-fan", ProgramName: "Blender", PanelName: "Files", ButtonFanSetupId: "deleted", ButtonOwnerId: "owner", Bounds: bounds },
    { Kind: "button-fan", ProgramName: "Blender", PanelName: "Files", ButtonFanSetupId: "retained", ButtonOwnerId: "owner", Bounds: bounds },
    { Kind: "button-popout", ProgramName: "Blender", PanelName: "Files", ButtonPopoutUnitId: "custom-pop", Bounds: bounds }
  ] };
  const before = structuredClone(snapshot);
  await sandbox.restore(snapshot, false);
  assert.deepEqual(events, [["fan", "retained"], ["pop", "custom-pop"]]);
  assert.deepEqual(snapshot, before);
});

test("settings-backed layout restore retains regular script owners and rejects missing owners before closing windows", async () => {
  const fixture = mainPopFixture(), document = fixture.document;
  const fan = ensureFanSetup({ document, programName: "Windows", panelName: "Files",
    buttons: fixture.ids.map((id) => document.buttons[id]) });
  document.surfaces["owner-main"] = { ...structuredClone(fixture.panel), id: "owner-main", kind: "main",
    placementIds: ["owner-main-placement"] };
  document.placements["owner-main-placement"] = { ...structuredClone(document.placements["main-Project"]),
    id: "owner-main-placement", buttonId: fan.panelOwnerButtonId, surfaceId: "owner-main" };
  const unit = ensureRegularPopout(document, [document.buttons["Other 1"], document.buttons["Other 2"]]);
  const surface = document.surfaces[unit.surfaceId];
  const ownerPlacement = { ...structuredClone(document.placements["main-Project"]),
    id: "regular-script-owner", surfaceId: surface.id, x: 8, y: 60, zIndex: surface.placementIds.length };
  document.placements[ownerPlacement.id] = ownerPlacement;
  surface.placementIds.push(ownerPlacement.id);
  surface.height = 112;
  Object.assign(unit, { interactionMode: "fan", ownerButtonId: "Project", ownerPlacementId: ownerPlacement.id,
    canonicalBounds: { x: 0, y: 0, width: surface.width, height: surface.height } });
  const file = buildButtonSettingsFile(document, surface.id, { programName: "Windows", panelName: "Files" });
  const choiceId = "script-owner-layout";
  const transient = buildTransientButtonPopoutSettingsDocument(document, file,
    { programName: "Windows", panelName: "Files" }, choiceId);
  const snapshot = { Windows: [{ Kind: "button-popout", ProgramName: "Windows", PanelName: "Files",
    ButtonOwnerId: "Project", PanelOwnerButtonId: fan.panelOwnerButtonId,
    ButtonPopoutSettingsPath: "C:/saved/Script-owner.json", ButtonPopoutChoiceId: choiceId,
    ButtonPopoutUnitId: transient.popoutUnitId, Bounds: { Left: 10, Top: 20, Width: 350, Height: 120 } }] };
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const parsed = ts.createSourceFile("MainPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ["loadMainPopSettingsFile", "sourceIdentityMatchesFolderScope"].includes(node.name?.text))
    .map((node) => node.getText(parsed)).join("\n");
  const start = source.indexOf("const restoreLayoutSnapshotState =");
  const compiled = ts.transpileModule(`${helpers}\n${source.slice(start, source.indexOf("const handleSaveLayout =", start))}
    globalThis.restore = restoreLayoutSnapshotState;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events = [];
  const sandbox = { isValidFlowCellBounds: () => true, loadButtonStateDocument: async () => document,
    resolvePanelOwnerMainPlacement, panelPopoutPresetFromPath: () => null, loadButtonSettingsFile: async () => file,
    resolveButtonSettingsFilePath: async (value) => value, buildTransientButtonPopoutSettingsDocument,
    applyButtonSettingsFile, buildButtonSettingsFile,
    areFolderNamesEqual: (a, b) => a?.trim().toLowerCase() === b?.trim().toLowerCase(),
    closeManagedLayoutWindows: async () => events.push("close"),
    openMainPopChoice: async (_choice, _document, _panelOwner, options) => events.push(options) };
  vm.runInNewContext(compiled, sandbox);
  const before = structuredClone(document), snapshotBefore = structuredClone(snapshot), fileBefore = structuredClone(file);
  await sandbox.restore(snapshot, false);
  assert.equal(events[0], "close");
  assert.equal(events[1].toolSetOwnerButtonId, undefined, "a regular script owner must never enter toolset remapping");
  assert.equal(events[1].programName, "Windows");
  assert.deepEqual(document, before);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(file, fileBefore);
  delete document.buttons.Project;
  events.length = 0;
  await assert.rejects(() => sandbox.restore(snapshot, false), /owner is no longer installed/);
  assert.deepEqual(events, [], "missing owner fails preflight before existing windows are closed");
});

for (const unavailable of [false, true]) {
  test(`layout connects its programs once before restoring panels, unavailable=${unavailable}`, async () => {
    const source = readSource("src", "pages", "main", "MainPage.tsx");
    const start = source.indexOf("const restoreLayoutSnapshotState =");
    const end = source.indexOf("const handleSaveLayout =", start);
    const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const events = [];
    const sandbox = {
      isValidFlowCellBounds: () => true,
      resolveInstalledPageOpenDescriptor: async () => ({ window: { title: "Layer Tree", width: 360, height: 640 } }),
      closeManagedLayoutWindows: async () => events.push("close"),
      connectRunningLayoutPrograms: async (names) => {
        events.push(["connect", ...names]);
        if (unavailable) throw new Error("Illustrator closed during connection");
      },
      openButtonEditorWindow: async (args) => events.push(["editor", args.programName]),
      openInstalledPageWindow: async () => events.push("layer-tree"),
      console: { warn: () => events.push("unavailable") }
    };
    vm.runInNewContext(compiled, sandbox);
    const bounds = { Left: 10, Top: 20, Width: 360, Height: 640 };
    const snapshot = { Windows: [
      { Kind: "button-editor", ProgramName: "Illustrator", Bounds: bounds },
      { Kind: "button-editor", ProgramName: "Blender", Bounds: bounds },
      { Kind: "installed-page", ProgramName: "Illustrator", PanelName: "Layers", ButtonOwnerId: "tree",
        InstalledPageFileName: "layers.jsx", InstalledPageId: "illustrator.layer-tree", Bounds: bounds }
    ] };
    const original = structuredClone(snapshot);
    await sandbox.restore(snapshot);
    assert.deepEqual(events, [
      "close", ["connect", "Illustrator", "Blender"],
      ...(unavailable ? ["unavailable"] : []),
      ["editor", "Illustrator"], ["editor", "Blender"], "layer-tree"
    ]);
    assert.deepEqual(snapshot, original, "connection must not change the saved layout");
  });
}

test("layout restores retired Theme pages through Main while retaining ordinary installed pages", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const restoreLayoutSnapshotState =");
  const end = source.indexOf("const handleSaveLayout =", start);
  assert.ok(start >= 0 && end > start, "execute the actual Main layout restore handler");
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const bounds = { Left: 10, Top: 20, Width: 920, Height: 720 };
  const snapshot = { Windows: [
    { Kind: "installed-page", ProgramName: "Blender", PanelName: "toolset", ButtonOwnerId: "theme",
      InstalledPageFileName: "theme.flowcell-source.json", InstalledPageId: "blender.theme", Bounds: bounds },
    { Kind: "installed-page", ProgramName: "Illustrator", PanelName: "Layers", ButtonOwnerId: "tree",
      InstalledPageFileName: "layers.flowcell-source.json", InstalledPageId: "illustrator.layer-tree", Bounds: bounds },
    { Kind: "installed-page", ProgramName: "Krita", PanelName: "Tools", ButtonOwnerId: "future",
      InstalledPageFileName: "future.flowcell-source.json", InstalledPageId: "krita.future", Bounds: bounds }
  ] };
  const original = structuredClone(snapshot);
  const window = { title: "Installed Page", width: 360, height: 640, minWidth: 300, minHeight: 400, alwaysOnTop: true };
  const descriptors = new Map([
    ["theme", { window, themeContribution: { version: 1 } }],
    ["tree", { window }],
    ["future", { window, themeContribution: { version: 2 } }]
  ]);
  const events = [];
  const plain = value => JSON.parse(JSON.stringify(value));
  const sandbox = {
    isValidFlowCellBounds: () => true,
    resolveInstalledPageOpenDescriptor: async (args) => {
      events.push(["resolve", plain(args)]);
      assert.ok(descriptors.has(args.ownerButtonId));
      return descriptors.get(args.ownerButtonId);
    },
    closeManagedLayoutWindows: async () => events.push("close"),
    connectRunningLayoutPrograms: async (names) => events.push(["connect", ...names]),
    openThemeEditorWindow: async (args) => events.push(["theme-editor", plain(args)]),
    openInstalledPageWindow: async (args) => events.push(["installed-page", plain(args)])
  };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.restore(snapshot);
  const identity = entry => ({ ownerButtonId: entry.ButtonOwnerId, programName: entry.ProgramName,
    panelName: entry.PanelName, fileName: entry.InstalledPageFileName, pageId: entry.InstalledPageId });
  assert.deepEqual(events, [
    ...snapshot.Windows.map(entry => ["resolve", identity(entry)]),
    "close", ["connect", "Blender", "Illustrator", "Krita"],
    ["theme-editor", { target: "Blender" }],
    ...snapshot.Windows.slice(1).map(entry => ["installed-page", {
      ...identity(entry), ...window, bounds
    }])
  ], "resolve every saved identity before closing windows, then redirect only supported Theme contributions");
  assert.deepEqual(snapshot, original, "retiring a Theme window must not change the saved layout");
});

async function runStartupScenario({ savedLayout = false, connectionFails = false,
  programListFails = false, layoutLoadFails = false } = {}) {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const settingsHandler = source.indexOf("const handleStartupSettingChange =");
  const start = source.indexOf("void (async () => {", settingsHandler);
  const end = source.indexOf("})();", start);
  assert.ok(settingsHandler >= 0 && start > settingsHandler && end > start,
    "execute the actual Main startup IIFE");
  const startup = source.slice(start, end + "})();".length)
    .replace(/^void /, "globalThis.startup = ");
  const compiled = ts.transpileModule(startup, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const names = ["Illustrator", "Blender", "Fusion 360", "Krita", "Fresco", "Photoshop", "Windows",
    ...Array.from({ length: 12 }, (_, index) => `Custom Host ${index}`)];
  const snapshot = { Windows: [{ Kind: "button-editor", ProgramName: "Illustrator" }] };
  const events = [];
  const timers = [];
  const rejectTimer = () => {
    timers.push("timer");
    throw new Error("Startup program connection must not schedule a timer");
  };
  const sandbox = {
    cancelled: false,
    currentWindow: { minimize: async () => events.push(["minimize"]) },
    readStartupSettings: () => ({ loadLastLayoutOnStartup: savedLayout, minimizeMainOnStartup: false }),
    listProgramFolders: async () => {
      events.push(["list-programs"]);
      if (programListFails) throw new Error("program listing failed");
      return names;
    },
    setProgramNames: value => events.push(["programs", ...value]),
    setSelectedProgramName: update => events.push(["selection", update(null)]),
    resolveFolderSelection: (values, current) => current ?? values[0],
    connectRunningLayoutPrograms: async value => {
      events.push(["connect", ...value]);
      if (connectionFails) throw new Error("host connection unavailable");
    },
    readLastLayoutPath: () => "saved.flowlayout.json",
    loadLayoutSnapshot: async layoutPath => {
      events.push(["load-layout", layoutPath]);
      if (layoutLoadFails) throw new Error("saved layout invalid");
      return snapshot;
    },
    restoreLayoutSnapshotState: async (value, connectPrograms) => {
      assert.equal(value, snapshot);
      events.push(["restore", connectPrograms]);
    },
    writeLastLayoutPath: value => events.push(["last-layout", value]),
    formatErrorMessage: error => error.message,
    console: {
      warn: () => events.push(["connection-warning"]),
      error: message => events.push(["error", message])
    },
    window: { alert: () => events.push(["alert"]), setTimeout: rejectTimer, setInterval: rejectTimer },
    setTimeout: rejectTimer,
    setInterval: rejectTimer
  };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.startup;
  assert.deepEqual(timers, [], "startup checks must not become background polling");
  return { events, names };
}

test("startup without a saved window layout prepares every Main program once", async () => {
  const { events, names } = await runStartupScenario();
  assert.deepEqual(events, [
    ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names]
  ]);
});

for (const connectionFails of [false, true]) {
  test(`startup restores saved panels without a second connection pass, unavailable=${connectionFails}`, async () => {
    const { events, names } = await runStartupScenario({ savedLayout: true, connectionFails });
    assert.deepEqual(events, [
      ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names],
      ...(connectionFails ? [["connection-warning"]] : []),
      ["load-layout", "saved.flowlayout.json"], ["restore", false], ["last-layout", "saved.flowlayout.json"]
    ]);
  });
}

test("startup program-list failure still lets the saved layout prepare its programs", async () => {
  const { events } = await runStartupScenario({ savedLayout: true, programListFails: true });
  assert.deepEqual(events, [
    ["list-programs"], ["error", "Failed to load program folders."], ["alert"],
    ["load-layout", "saved.flowlayout.json"], ["restore", true], ["last-layout", "saved.flowlayout.json"]
  ]);
});

test("a broken saved layout does not undo or repeat Main's startup connection pass", async () => {
  const { events, names } = await runStartupScenario({ savedLayout: true, layoutLoadFails: true });
  assert.deepEqual(events, [
    ["list-programs"], ["programs", ...names], ["selection", names[0]], ["connect", ...names],
    ["load-layout", "saved.flowlayout.json"], ["last-layout", null],
    ["error", "Failed to load last layout on startup."]
  ]);
});

test("layout restore skips connection when startup has already checked the programs", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const restoreLayoutSnapshotState =");
  const end = source.indexOf("const handleSaveLayout =", start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.restore = restoreLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const events = [];
  const sandbox = {
    isValidFlowCellBounds: () => true,
    closeManagedLayoutWindows: async () => events.push("close"),
    connectRunningLayoutPrograms: async () => { events.push("unexpected-connect"); },
    openButtonEditorWindow: async args => events.push(["editor", args.programName])
  };
  vm.runInNewContext(compiled, sandbox);
  await sandbox.restore({ Windows: [{ Kind: "button-editor", ProgramName: "Illustrator",
    Bounds: { Left: 10, Top: 20, Width: 360, Height: 640 } }] }, false);
  assert.deepEqual(events, ["close", ["editor", "Illustrator"]]);
});

test("new Startup fallback avoids custom saved panels without moving or changing them", () => {
  const savedPanels = [
    { panelName: "Files", rect: { x: 216, y: 112, width: 72, height: 48.156 } },
    { panelName: "Utility", rect: { x: 216, y: 179.264, width: 72, height: 45.948 } },
    { panelName: "Test", rect: { x: 216, y: 240, width: 72, height: 50.515 } }
  ];
  const original = structuredClone(savedPanels);
  const buttons = buildPanelRailButtons(["Files", "Startup", "Test", "Utility"], "Startup", savedPanels);
  const startup = buttons.find((button) => button.folderName === "Startup");
  assert.ok(startup);
  assert.equal(startup.isSelected, true);
  for (const saved of savedPanels) {
    assert.equal(buttonRectsOverlap(startup, saved.rect), false, `Startup overlaps ${saved.panelName}`);
    const rendered = buttons.find((button) => button.folderName === saved.panelName);
    assert.deepEqual(
      { x: rendered.x, y: rendered.y, width: rendered.width, height: rendered.height },
      saved.rect,
      `${saved.panelName} was moved`
    );
  }
  assert.deepEqual(savedPanels, original, "navigation must not mutate saved placements");
  const withoutSaved = buildPanelRailButtons(["Files", "Startup", "Test", "Utility"], "Startup");
  assert.deepEqual(buttons.at(-1), withoutSaved.at(-1), "Add Panel control must stay unchanged");
});

test("multiple newly discovered panel fallbacks reserve each other's free slots", () => {
  const savedPanels = [{ panelName: "Utility", rect: { x: 199, y: 125, width: 132, height: 90 } }];
  const buttons = buildPanelRailButtons(["Alpha", "Startup", "Utility"], null, savedPanels)
    .filter((button) => button.folderName);
  for (let index = 0; index < buttons.length; index += 1) {
    for (let other = index + 1; other < buttons.length; other += 1) {
      assert.equal(buttonRectsOverlap(buttons[index], buttons[other]), false);
    }
  }
  assert.deepEqual(savedPanels[0].rect, { x: 199, y: 125, width: 132, height: 90 });
});

test("Panel rail paint order follows saved visual rows instead of folder names", () => {
  const savedPanels = [
    { panelName: "Utility", rect: { x: 210, y: 175.485611, width: 58, height: 37.294964 } },
    { panelName: "Files", rect: { x: 276, y: 174, width: 58, height: 37.294964 } },
    { panelName: "Test", rect: { x: 237.010806, y: 225.212229, width: 56, height: 37.294964 } }
  ];
  const buttons = orderButtonRectsByVisualRows(buildPanelRailButtons(["Files", "Test", "Utility"], "Test", savedPanels));

  assert.deepEqual(buttons.map((button) => button.label), ["Utility", "Files", "Test", "Add Panel"]);
  assert.equal(buttons[2].isSelected, true);
  for (const [index, { rect }] of savedPanels.entries()) {
    const { x, y, width, height } = buttons[index];
    assert.deepEqual({ x, y, width, height }, rect);
  }
});

test("raised key paint order reuses stack slots and leaves other placements in place", () => {
  const slot = (id, y, zIndex, raisedKey) => ({
    placement: { id, x: 0, y, width: 88, height: 37.294964, zIndex },
    raisedKey
  });
  const slots = [
    slot("Test", 225.212229, 1, true),
    slot("custom", 100, 2, false),
    slot("Utility", 175.485611, 3, true),
    slot("lifted", 125.758993, 19_999, false)
  ];
  const original = structuredClone(slots);
  assert.deepEqual(orderRaisedKeyPaintSlots(slots), [
    { id: "Utility", zIndex: 1 },
    { id: "custom", zIndex: 2 },
    { id: "Test", zIndex: 3 },
    { id: "lifted", zIndex: 19_999 }
  ]);
  assert.deepEqual(slots, original);
});

test("layout capture omits live Fan display mode but keeps Pop-out mode and semantic bounds", async () => {
  const source = readSource("src", "pages", "main", "MainPage.tsx");
  const start = source.indexOf("const captureLayoutSnapshotState =");
  const end = source.indexOf("const restoreLayoutSnapshotState =", start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.capture = captureLayoutSnapshotState;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const bounds = { Left: 123, Top: 456, Width: 160, Height: 90 };
  const registry = {
    fan: { kind: "button-fan", programName: "Blender", panelName: "Tools", buttonFanSetupId: "fan-1",
      buttonOwnerId: "owner-1", buttonDisplayMode: "expanded", snapshotBounds: bounds },
    pop: { kind: "button-popout", programName: "Blender", buttonPopoutUnitId: "pop-1",
      buttonDisplayMode: "collapsed", snapshotBounds: bounds }
  };
  const sandbox = {
    getCurrentWindow: () => ({ label: "main" }),
    WebviewWindow: { getAll: async () => ["main", "fan", "pop"].map(label => ({ label })) },
    readRegisteredLayoutWindow: label => registry[label],
    captureWindowBounds: () => { throw new Error("Do not save monitor-sized Fan/Pop canvases"); },
    isValidFlowCellBounds: value => Boolean(value?.Width > 0 && value?.Height > 0),
    LAYOUT_SNAPSHOT_VERSION: 10
  };
  vm.runInNewContext(compiled, sandbox);
  for (const mode of ["expanded", "collapsed"]) {
    registry.fan.buttonDisplayMode = mode;
    const snapshot = JSON.parse(JSON.stringify(await sandbox.capture()));
    const fan = snapshot.Windows.find(entry => entry.Kind === "button-fan");
    assert.equal(Object.hasOwn(fan, "ButtonDisplayMode"), false);
    assert.equal(fan.ButtonFanSetupId, "fan-1");
    assert.equal(fan.ButtonOwnerId, "owner-1");
    assert.deepEqual(fan.Bounds, bounds);
    assert.equal(snapshot.Windows.find(entry => entry.Kind === "button-popout").ButtonDisplayMode, "collapsed");
    assert.equal(registry.fan.buttonDisplayMode, mode, "live palette state must remain available");
  }
});

test("Main Save and Load Layout use the existing strict secondary-window pipeline", () => {
  const snapshots = readSource("src", "lib", "layoutSnapshots.ts");
  const mainPage = readSource("src", "pages", "main", "MainPage.tsx");
  const types = readSource("src", "types.ts");
  const coreWindows = readSource("src", "lib", "coreWindows.ts");
  const buttonWindows = readSource("src", "button", "windows", "buttonWindows.ts");
  const nativeLayouts = readSource("src-tauri", "src", "commands", "layouts.rs");

  assert.match(snapshots, /flowcell\.main-page-layout-directory\.v1/);
  assert.doesNotMatch(snapshots, /flowcell\.last-layout-directory\.v1/);
  assert.match(mainPage, /readLastMainPageLayoutDirectory\(\)/);
  assert.match(mainPage, /writeLastMainPageLayoutDirectory\(getParentDirectory\(/);
  assert.match(mainPage, /Windows: managedWindows/);
  assert.match(mainPage, /readRegisteredLayoutWindow\(windowHandle\.label\)/);
  assert.match(mainPage, /for \(const windowEntry of snapshot\.Windows\)/);
  assert.match(mainPage, /case "button-editor":/);
  assert.match(mainPage, /case "button-popout":/);
  assert.match(mainPage, /case "button-fan":/);
  assert.match(mainPage, /case "installed-page":/);
  assert.match(mainPage, /resolveInstalledPageOpenDescriptor\(/);
  assert.match(mainPage, /openInstalledPageWindow\(/);
  assert.match(mainPage, /ButtonPopoutSettingsPath:\s*registeredWindow\.buttonPopoutSettingsPath/);
  assert.match(mainPage, /PanelOwnerButtonId:\s*registeredWindow\.panelOwnerButtonId/);
  assert.match(mainPage, /resolvedSettingsBackedPopouts/);
  assert.match(mainPage, /settingsBackedLayout:\s*\{/);
  assert.match(
    mainPage,
    /case "button-popout":[\s\S]{0,900}settingsBackedDescriptor[\s\S]{0,900}openMainPopChoice\(/
  );
  const parsedMainPage = ts.createSourceFile("MainPage.tsx", mainPage, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const installedPageCases = [];
  const findInstalledPageCase = (node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === "installed-page") {
      installedPageCases.push(node);
    }
    ts.forEachChild(node, findInstalledPageCase);
  };
  findInstalledPageCase(parsedMainPage);
  assert.equal(installedPageCases.length, 1, "the installed Page restore policy must have one switch case");
  assert.match(installedPageCases[0].getText(parsedMainPage), /alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/);
  assert.match(mainPage, /await closeManagedButtonWindow\(windowHandle\.label\)/);
  assert.doesNotMatch(mainPage, /await windowHandle\.close\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(
    buttonWindows,
    /await target\.close\(\)[\s\S]{0,420}await waitForManagedWindowToDisappear\(/
  );
  assert.match(mainPage, /Installed Page window[\s\S]{0,120}is missing its owner identity/);
  assert.ok(
    mainPage.indexOf("resolveInstalledPageOpenDescriptor({") <
      mainPage.indexOf("await closeManagedLayoutWindows();"),
    "installed Pages must resolve before the current managed layout is closed"
  );
  assert.ok(
    mainPage.indexOf("resolvedSettingsBackedPopouts.set(") <
      mainPage.indexOf("await closeManagedLayoutWindows();"),
    "settings-backed Pop-outs must resolve before the current managed layout is closed"
  );
  assert.match(
    mainPage,
    /isValidFlowCellBounds\(liveNativeBounds\)[\s\S]{0,180}registeredWindow\.snapshotBounds/
  );
  assert.match(snapshots, /entry\?\.kind === "installed-page"/);
  assert.match(snapshots, /buttonPopoutSettingsPath/);
  assert.match(snapshots, /panelOwnerButtonId/);
  assert.match(coreWindows, /kind:\s*"installed-page"/);
  assert.match(coreWindows, /hashInstalledPageOwnerId\(normalizedOwner\)/);
  assert.match(coreWindows, /savedBounds:\s*args\.bounds/);
  assert.match(coreWindows, /new PhysicalPosition\(placement\.x, placement\.y\)/);
  assert.match(coreWindows, /new PhysicalSize\(placement\.width, placement\.height\)/);
  for (const forbidden of [
    "SelectedProgramName",
    "SelectedPanelName",
    "SelectedFileNames",
    "MainWindowBounds",
    "MainPagePlacements"
  ]) {
    assert.doesNotMatch(types, new RegExp(forbidden));
  }
  for (const forbidden of [
    "selected_program_name",
    "selected_panel_name",
    "selected_file_names",
    "main_window_bounds",
    "main_page_placements"
  ]) {
    assert.doesNotMatch(nativeLayouts, new RegExp(forbidden));
  }
  assert.match(types, /Version:\s*number/);
  assert.doesNotMatch(types, /main-panel-popout/);
  assert.match(nativeLayouts, /LAYOUT_SNAPSHOT_VERSION:\s*u64\s*=\s*10/);
  assert.match(nativeLayouts, /LEGACY_LAYOUT_SNAPSHOT_VERSION:\s*u64\s*=\s*9/);
  assert.match(nativeLayouts, /button_popout_settings_path/);
  assert.match(nativeLayouts, /panel_owner_button_id/);
  assert.match(nativeLayouts, /button_display_mode\.is_none\(\)/);
  assert.match(nativeLayouts, /bounds\.left <= -30_000\.0/);
  assert.match(
    nativeLayouts,
    /resolve_flowcell_local_root\(\)\?[\s\S]{0,100}\.join\("layouts"\)[\s\S]{0,60}\.join\("Main Page"\)/
  );
  assert.match(
    nativeLayouts,
    /fn resolve_layout_dialog_directory[\s\S]{0,500}resolve_main_page_layouts_root\(\)/
  );
  assert.match(
    nativeLayouts,
    /add_filter\("FlowCell Layout", &\["json"\]\)/
  );
  assert.doesNotMatch(nativeLayouts, /add_filter\([^\n]+"flowlayout\.json"/);
  const openLayoutDialogStart = nativeLayouts.indexOf(
    "pub(crate) fn show_open_layout_dialog"
  );
  const openLayoutDialogEnd = nativeLayouts.indexOf(
    ".pick_file();",
    openLayoutDialogStart
  );
  const openLayoutDialog = nativeLayouts.slice(
    openLayoutDialogStart,
    openLayoutDialogEnd
  );
  assert.notEqual(openLayoutDialogStart, -1);
  assert.notEqual(openLayoutDialogEnd, -1);
  assert.doesNotMatch(openLayoutDialog, /\.add_filter\(/);
  assert.match(nativeLayouts, /validate_layout_file_path\(&layout_path\)\?/);
  assert.match(nativeLayouts, /FlowCell Theme, not a FlowCell Layout/);
});

test("Main native close retires every secondary FlowCell window before destroying Main", () => {
  const mainPage = readSource("src", "pages", "main", "MainPage.tsx");
  const closeCoordinatorStart = mainPage.indexOf("const closeManagedLayoutWindows");
  const closeCoordinatorEnd = mainPage.indexOf(
    "const captureLayoutSnapshotState",
    closeCoordinatorStart
  );
  const closeCoordinator = mainPage.slice(closeCoordinatorStart, closeCoordinatorEnd);
  const closeHookStart = mainPage.indexOf("mainWindow.onCloseRequested");
  const closeHookEnd = mainPage.indexOf("const captureLayoutSnapshotState", closeHookStart);
  const closeHook = mainPage.slice(closeHookStart, closeHookEnd);

  assert.notEqual(closeCoordinatorStart, -1);
  assert.match(closeCoordinator, /closeUnregisteredWindows\s*=\s*false/);
  assert.match(
    closeCoordinator,
    /if \(closeUnregisteredWindows\)[\s\S]{0,160}await windowHandle\.close\(\)/
  );
  assert.notEqual(closeHookStart, -1);
  assert.match(closeHook, /event\.preventDefault\(\)/);
  assert.ok(
    closeHook.indexOf("await closeManagedLayoutWindows(true)") <
      closeHook.indexOf("await mainWindow.destroy()"),
    "Main must finish the secondary-window close pass before it destroys itself"
  );
});
