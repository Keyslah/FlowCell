import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { cloneButtonDocument, createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import * as choices from "./.compiled-button-system/button/state/buttonDefaultPopout.js";
import { ensureRegularPopout, resolveDiscardedStagedOwnerButtonIds } from "./.compiled-button-system/button/state/buttonDocumentOperations.js";
import { findPanelOwnerButton, reconcileProgramPanelOwners } from "./.compiled-button-system/button/state/panelOwnerButtonOperations.js";
import { createButtonSourceIdentity } from "./.compiled-button-system/button/state/sourceIdentity.js";
import { applyButtonSettingsFile, buildButtonSettingsFile, buttonSettingsPlacementKind, buttonSettingsPlacementLabel } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import { buildButtonSettingsScopedDocument, applyButtonSettingsSavedScope } from "./.compiled-button-system/button/editor/buttonEditorSaveScopes.js";
import { validateButtonStateDocument } from "./.compiled-button-system/button/state/buttonStateValidation.js";

const editor = readFileSync(new URL("../src/button/editor/ButtonEditorPage.tsx", import.meta.url), "utf8");
const derivation = editor.slice(editor.indexOf("const selectedSurface ="), editor.indexOf("const usesLogicalGridDefault ="));
const handlers = editor.slice(editor.indexOf("const commitScopedDocument ="), editor.indexOf("const loadSettings ="));
assert.ok(derivation.includes("selectedFileIsDefaultPopout") && handlers.includes("saveSettings"));

function fixture(kind = "regular") {
  const document = createButtonStateDocument();
  const children = ["First", "Second"].map((label) => ({
    id: label.toLowerCase(), label, role: "single-script", tooltip: "",
    sourceIdentity: createButtonSourceIdentity("Windows", "Files", `${label}.ps1`),
    executionTarget: { kind: "panel-script", programName: "Windows", panelName: "Files", fileName: `${label}.ps1` },
    defaultSkinId: "skin-default-neutral", defaultTextFitMode: "shrink", disabled: false,
    activationAnimation: null, activationBehavior: null, toolSetParentId: null, toolSetBehavior: null, metadata: {}
  }));
  for (const child of children) document.buttons[child.id] = child;
  const unit = ensureRegularPopout(document, children);
  reconcileProgramPanelOwners(document, {
    programName: "Windows", panels: [{ panelName: "Files", rect: { x: 8, y: 8, width: 120, height: 44 } }],
    surfaceBounds: { width: 400, height: 120 }
  });
  let owner = findPanelOwnerButton(document, "Windows", "Files");
  if (kind === "tool-set") {
    owner = { ...structuredClone(children[0]), id: "tool-owner", label: "Whole Tool", role: "tool-set-owner",
      sourceIdentity: createButtonSourceIdentity("Windows", "Files", "Tool.flowcell-source.json"), executionTarget: null };
    document.buttons[owner.id] = owner;
    for (const child of children) {
      child.role = "tool-set-child";
      child.sourceIdentity = null;
      child.toolSetParentId = owner.id;
      child.toolSetBehavior = { execute: true };
      child.executionTarget = { kind: "tool-set-action", programName: "Windows", panelName: "Files",
        ownerFileName: "Tool.flowcell-source.json", command: child.id };
    }
    document.surfaces[unit.surfaceId].kind = "tool-set-popout";
    unit.kind = "tool-set";
    unit.ownerButtonId = owner.id;
    unit.childButtonIds = children.map((child) => child.id);
    unit.childPlacementIds = unit.memberPlacementIds;
    unit.fields = [];
    delete unit.memberPlacementIds;
    delete unit.memberSourceIdentities;
    delete unit.selectionKey;
  }
  const validation = validateButtonStateDocument(document);
  assert.equal(validation.valid, true, JSON.stringify(validation.issues));
  return { document, ownerId: owner.id, surfaceId: unit.surfaceId, children, unit };
}

function harness(base = fixture(), options = {}) {
  let canonical = structuredClone(base.document);
  const saves = [], writes = [], publishes = [], messages = [], dialogs = [];
  const sandbox = {
    ...choices, cloneButtonDocument, buildButtonSettingsScopedDocument, applyButtonSettingsSavedScope,
    applyButtonSettingsFile, buildButtonSettingsFile, buttonSettingsPlacementKind, buttonSettingsPlacementLabel,
    validateButtonStateDocument, resolveDiscardedStagedOwnerButtonIds,
    defaultButtonSettingsFileName: () => "Pop-out.json",
    selectedSurfaceId: base.surfaceId, programName: "Windows", panelName: "Files",
    settingsPlacementLabel: "Pop-out",
    settingsFilePaths: {}, pendingDefaultPopout: null, busyRef: { current: false },
    stagedInstallsRef: { current: new Map() },
    setBusy: (value) => { sandbox.busyRef.current = value; },
    setPendingDefaultPopout: (value) => { sandbox.pendingDefaultPopout = value; sandbox.refresh(); },
    setSettingsFilePaths: (update) => { sandbox.settingsFilePaths = update(sandbox.settingsFilePaths); sandbox.refresh(); },
    setMessage: (value) => messages.push(value),
    setSelectedSurfaceId: (value) => { sandbox.selectedSurfaceId = value; sandbox.refresh(); },
    setFocusedPlacementId: (value) => { sandbox.focusedPlacementId = value; },
    setSelectedPlacementIds: () => {}, setActivePage: () => {}, setReorderMode: () => {},
    getButtonSettingsDirectory: async () => "C:/Saved",
    showSaveFileDialog: async (dialog) => { dialogs.push(dialog); return options.dialog ? options.dialog() : "C:/Saved/Whole.json"; },
    saveButtonSettingsFile: async (path, file) => {
      writes.push({ path, file: structuredClone(file) });
      if (options.writeFailure) throw new Error("file write failed");
      return path;
    },
    saveButtonStateDocument: async (next, revision) => {
      saves.push(structuredClone(next));
      if (options.beforeSave) await options.beforeSave({ next, revision, saves, sandbox, get canonical() { return canonical; } });
      assert.equal(validateButtonStateDocument(next).valid, true);
      assert.equal(revision, canonical.revision);
      canonical = { ...structuredClone(next), revision: revision + 1 };
      return structuredClone(canonical);
    },
    loadButtonStateDocument: async () => structuredClone(canonical),
    publishButtonCommit: async (value) => { publishes.push(structuredClone(value)); },
    uninstallButtonSource: async () => assert.fail("fixture contains no staged install"),
    store: {
      committed: structuredClone(base.document), draft: structuredClone(base.document),
      current: () => sandbox.store.draft,
      transact: (update) => {
        const next = structuredClone(sandbox.store.draft);
        sandbox.store.draft = update(next) ?? next;
        sandbox.refresh();
      },
      acceptScopedSaved: (saved, merge) => {
        const draft = structuredClone(sandbox.store.draft);
        merge(draft, saved);
        sandbox.store.committed = structuredClone(saved);
        sandbox.store.draft = draft;
        sandbox.refresh();
      }
    }
  };
  const code = `function refreshSelection() { ${derivation}
    Object.assign(globalThis, { selectedSurface, selectedSurfaceUnit, defaultPopoutOwnerId,
      assignedDefaultPopout, savedPopoutFile, selectedSettingsFilePath, selectedPopoutFileChoice,
      selectedDefaultPopoutPending, selectedFileIsDefaultPopout, defaultPopoutScopeLabel });
  }
  globalThis.refresh = refreshSelection;
  ${handlers}
  globalThis.toggleDefault = setSelectedFileAsDefaultPopout;
  globalThis.saveSetup = saveSettings;
  globalThis.stageFile = stageSettingsFile;
  `;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, sandbox);
  sandbox.refresh();
  return { ...base, sandbox, saves, writes, publishes, messages, dialogs,
    get canonical() { return canonical; },
    setCanonical(value) { canonical = structuredClone(value); } };
}

for (const kind of ["regular", "tool-set"]) {
  test(`checking an unsaved ${kind} visibly checks, saves the whole setup, and survives reopen/child focus`, async () => {
    const dialog = Promise.withResolvers();
    const h = harness(fixture(kind), { dialog: () => dialog.promise });
    const placements = h.sandbox.store.draft.surfaces[h.surfaceId].placementIds;
    h.sandbox.store.draft.placements[placements[1]].textOffsetX = 19;
    assert.equal(h.sandbox.selectedPopoutFileChoice, null);
    const selecting = h.sandbox.toggleDefault(true);
    assert.equal(h.sandbox.selectedFileIsDefaultPopout, true, "pending check is visible before Save completes");
    assert.equal(h.sandbox.busyRef.current, true);
    await h.sandbox.toggleDefault(true);
    assert.equal(h.saves.length, 0, "busy repeat cannot submit twice");
    dialog.resolve("C:/Saved/Whole.json");
    await selecting;
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].file.entries.length, placements.length);
    assert.equal(h.writes[0].file.entries.find((entry) => entry.placementId === placements[1]).placement.textOffsetX, 19);
    assert.equal(h.saves.length, 2, "file association/default follows the whole-setup save");
    assert.equal(choices.getButtonDefaultPopoutChoice(h.saves[0], h.ownerId), null, "no pointer before the file exists");
    assert.equal(choices.getButtonSavedPopoutChoice(h.saves[0], h.ownerId, h.surfaceId), null);
    assert.equal(h.sandbox.selectedFileIsDefaultPopout, true);
    assert.equal(h.sandbox.pendingDefaultPopout, null);
    assert.equal(h.sandbox.busyRef.current, false);
    assert.match(h.messages.at(-1), /default for the whole/);
    const reopened = harness({ ...h, document: h.canonical });
    assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, true);
    for (const placementId of placements) {
      reopened.sandbox.focusedPlacementId = placementId;
      reopened.sandbox.refresh();
      assert.equal(reopened.sandbox.defaultPopoutOwnerId, h.ownerId);
      assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, true);
    }
    await reopened.sandbox.toggleDefault(false);
    assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, false);
    assert.equal(reopened.writes.length, 0, "unchecking never rewrites a setup file");
    assert.equal(reopened.dialogs.length, 0);
    assert.ok(choices.getButtonSavedPopoutChoice(reopened.canonical, h.ownerId, h.surfaceId));
    await reopened.sandbox.toggleDefault(true);
    assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, true);
    assert.equal(reopened.writes.length, 0, "known-file checking only changes the pointer");
  });
}

test("ordinary Save remembers the whole setup without making it default", async () => {
  const h = harness();
  await h.sandbox.saveSetup();
  assert.equal(h.writes.length, 1);
  assert.equal(choices.getButtonDefaultPopoutChoice(h.canonical, h.ownerId), null);
  const reopened = harness({ ...h, document: h.canonical });
  assert.equal(reopened.sandbox.selectedSettingsFilePath, "C:/Saved/Whole.json");
  assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, false);
  await reopened.sandbox.toggleDefault(true);
  assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, true);
  assert.equal(reopened.writes.length, 0);
  assert.equal(reopened.dialogs.length, 0);
});

test("Save A then Load B and select default remembers B on reopen without rewriting either file", async () => {
  const h = harness();
  await h.sandbox.saveSetup();
  const fileB = structuredClone(h.writes[0].file);
  fileB.entries[0].placement.textOffsetX = 37;
  h.sandbox.stageFile(fileB, "Other.json", "C:/Saved/Other.json");
  assert.equal(h.sandbox.selectedSettingsFilePath, "C:/Saved/Other.json");
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, false);
  const draftBefore = structuredClone(h.sandbox.store.draft.placements);
  await h.sandbox.toggleDefault(true);
  assert.equal(h.writes.length, 1, "selecting the loaded B only changes canonical metadata");
  assert.deepEqual(h.sandbox.store.draft.placements, draftBefore, "association rebase retains staged B arrangements");
  assert.equal(choices.getButtonSavedPopoutChoice(h.canonical, h.ownerId, h.surfaceId).path, "C:/Saved/Other.json");
  const reopened = harness({ ...h, document: h.canonical });
  assert.equal(reopened.sandbox.selectedSettingsFilePath, "C:/Saved/Other.json");
  assert.equal(reopened.sandbox.selectedFileIsDefaultPopout, true);
  assert.equal(reopened.sandbox.defaultPopoutOwnerId, h.ownerId);
});

test("canceling Save clears pending check and does not persist anything", async () => {
  const h = harness(fixture(), { dialog: () => null });
  await h.sandbox.toggleDefault(true);
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, false);
  assert.equal(h.sandbox.pendingDefaultPopout, null);
  assert.equal(h.sandbox.busyRef.current, false);
  assert.equal(h.saves.length, 0);
  assert.equal(h.writes.length, 0);
  assert.match(h.messages.at(-1), /Default selection canceled.*whole/);
});

test("failed file write never remembers a missing file or leaves a pending check", async () => {
  const h = harness(fixture(), { writeFailure: true });
  await h.sandbox.toggleDefault(true);
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, false);
  assert.equal(h.sandbox.busyRef.current, false);
  assert.equal(choices.getButtonDefaultPopoutChoice(h.canonical, h.ownerId), null);
  assert.equal(choices.getButtonSavedPopoutChoice(h.canonical, h.ownerId, h.surfaceId), null);
  assert.equal(h.saves.length, 1);
  assert.match(h.messages.at(-1), /could not write the settings file/);
});

test("metadata failure rolls back only the pending check and explains the already saved file", async () => {
  const h = harness(fixture(), { beforeSave: ({ saves }) => {
    if (saves.length === 2) throw new Error("metadata unavailable");
  } });
  await h.sandbox.toggleDefault(true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, false);
  assert.equal(h.sandbox.pendingDefaultPopout, null);
  assert.equal(h.sandbox.selectedSettingsFilePath, "C:/Saved/Whole.json", "a successful file write remains usable for retry");
  assert.equal(choices.getButtonDefaultPopoutChoice(h.canonical, h.ownerId), null);
  assert.match(h.messages.at(-1), /file was saved, but the default selection could not be saved/);
});

test("metadata conflict retries against current canonical data and preserves unrelated draft edits", async () => {
  let h;
  h = harness(fixture(), { beforeSave: ({ next, saves, sandbox }) => {
    if (saves.length !== 2) return;
    const remote = structuredClone(h.canonical);
    remote.revision += 1;
    remote.settings.snapTolerance = 23;
    remote.buttons[h.ownerId].metadata.remoteNote = "keep remote owner changes";
    h.setCanonical(remote);
    sandbox.store.draft.settings.gridSize = 17;
    throw new Error("Button state changed before Save.");
  } });
  await h.sandbox.toggleDefault(true);
  assert.equal(h.saves.length, 3);
  assert.equal(h.writes.length, 1, "metadata retry must not rewrite the saved setup");
  assert.equal(h.canonical.settings.snapTolerance, 23);
  assert.equal(h.canonical.buttons[h.ownerId].metadata.remoteNote, "keep remote owner changes");
  assert.equal(h.sandbox.store.draft.settings.gridSize, 17, "metadata merge must retain unrelated draft work");
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, true);
});

test("known-file failure reverts pending state without a file dialog or write", async () => {
  const base = fixture();
  choices.setButtonSavedPopoutChoice(base.document, base.ownerId,
    choices.createButtonDefaultPopoutChoice(base.ownerId, base.surfaceId, "C:/Saved/Known.json"));
  const h = harness(base, { beforeSave: () => { throw new Error("disk unavailable"); } });
  const selecting = h.sandbox.toggleDefault(true);
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, true);
  await selecting;
  assert.equal(h.sandbox.selectedFileIsDefaultPopout, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.dialogs.length, 0);
  assert.match(h.messages.at(-1), /selection could not be saved/);
});

test("checkbox remains enabled for an unsaved whole setup and exposes pending/result status", () => {
  assert.match(editor, /checked=\{selectedFileIsDefaultPopout\}/);
  assert.match(editor, /disabled=\{busy \|\| !defaultPopoutOwnerId\}/);
  assert.match(editor, /<span>Make this default pop out\.<\/span>/);
  assert.match(editor, /role="status" aria-live="polite"/);
  assert.match(editor, /Checking this opens Save for the whole setup\./);
});
