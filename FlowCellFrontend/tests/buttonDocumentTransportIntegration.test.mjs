import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { createButtonStateDocument, DEFAULT_BUTTON_SURFACE_ID } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { packButtonDocumentTransport, unpackButtonDocumentTransport } from "./.compiled-button-system/button/state/buttonDocumentTransport.js";
import { loadButtonStateDocument, saveButtonStateDocument, saveButtonSettingsFile, loadButtonSettingsFile,
  initializeButtonSettingsDefault, loadButtonSettingsDefault, updateButtonSettingsDefault } from "./.compiled-button-system/button/state/ButtonStateRepository.js";
import { buildButtonSettingsFile } from "./.compiled-button-system/button/state/buttonSettingsFile.js";
import {
  publishButtonCommit, subscribeButtonCommits, publishButtonDraft,
  publishButtonDraftToWindow, subscribeButtonDrafts, registerButtonDraftResponder, requestButtonDraft
} from "./.compiled-button-system/button/state/ButtonDraftBus.js";

function fixture() {
  const document = createButtonStateDocument();
  document.revision = 5;
  const source = "saved skin asset ".repeat(800);
  for (const skin of Object.values(document.skins)) {
    skin.metadata.transportFixture = { first: source, second: source, nested: [null, source] };
  }
  return document;
}

test("settings IPC pools repeated complete skins across all save and load paths", async () => {
  globalThis.window = { crypto: webcrypto };
  const document = createButtonStateDocument();
  const skinId = document.settings.defaultSkinId;
  document.skins[skinId].metadata.transportFixture = { asset: "skin family source ".repeat(60000) };
  const surface = document.surfaces[DEFAULT_BUTTON_SURFACE_ID];
  for (let i = 0; i < 18; i++) {
    const id = `button-${i}`, placementId = `placement-${i}`;
    document.buttons[id] = { id, role: "single-script", sourceIdentity: null, label: `Item ${i}`,
      tooltip: "", executionTarget: null, defaultSkinId: skinId, defaultTextFitMode: "shrink",
      disabled: false, activationAnimation: null, activationBehavior: null,
      toolSetParentId: null, toolSetBehavior: null, metadata: {} };
    document.placements[placementId] = { id: placementId, buttonId: id, surfaceId: surface.id,
      x: (i % 6) * 65, y: Math.floor(i / 6) * 40, width: 60, height: 30, zIndex: i,
      skinOverrideId: null, textFitMode: "shrink", textAlignment: "skin", minimumFontSize: 8,
      textSizeOverride: null, textOffsetX: 0, textOffsetY: 0, allowLabelResize: true,
      matchHitboxToSkin: true, allowStretching: false, highlightOnHover: false,
      resizeAnchor: "top-left", activationCycle: null, visualStateMap: null };
    surface.placementIds.push(placementId);
  }
  const settings = buildButtonSettingsFile(document, surface.id, { programName: "Windows", panelName: "Startup" });
  const commands = [];
  let legacyReads = false;
  mockIPC((command, args) => {
    commands.push(command);
    if (command === "load_button_settings_file" || command === "load_button_settings_default") {
      return legacyReads ? settings : packButtonDocumentTransport(settings);
    }
    assert.ok(["save_button_settings_file", "initialize_button_settings_default", "update_button_settings_default"].includes(command));
    assert.equal(args.file.__flowcellButtonDocumentTransport, 1);
    assert.deepEqual(unpackButtonDocumentTransport(args.file), settings);
    assert.ok(JSON.stringify(args.file).length < JSON.stringify(settings).length / 4);
    return "fixture.json";
  });
  try {
    await saveButtonSettingsFile("fixture.json", settings);
    await initializeButtonSettingsDefault("main-page", surface.id, settings, 0);
    await updateButtonSettingsDefault("main-page", surface.id, settings, 0);
    assert.deepEqual(await loadButtonSettingsFile("fixture.json"), settings);
    assert.deepEqual(await loadButtonSettingsDefault("main-page", surface.id), settings);
    legacyReads = true;
    assert.deepEqual(await loadButtonSettingsFile("legacy.json"), settings);
    assert.deepEqual(await loadButtonSettingsDefault("main-page", surface.id), settings);
    assert.equal(commands.length, 7);
  } finally { clearMocks(); delete globalThis.window; }
});

test("packed native reads and writes retain the complete canonical document and revision conflicts", async () => {
  globalThis.window = { crypto: webcrypto };
  const original = fixture();
  let persisted = structuredClone(original);
  let commitPayload;
  mockIPC((command, args) => {
    if (command === "load_button_state") return packButtonDocumentTransport(persisted);
    assert.equal(command, "commit_button_state");
    commitPayload = args.request.document;
    const document = unpackButtonDocumentTransport(commitPayload);
    if (args.request.expectedRevision !== persisted.revision) throw new Error("revision conflict");
    persisted = structuredClone(document);
  });
  try {
    const loaded = await loadButtonStateDocument();
    assert.deepEqual(loaded, original);
    loaded.settings.defaultGap = 17;
    const saved = await saveButtonStateDocument(loaded, original.revision);
    assert.equal(commitPayload.__flowcellButtonDocumentTransport, 1);
    assert.deepEqual(persisted, { ...original, revision: 6, settings: { ...original.settings, defaultGap: 17 } });
    assert.deepEqual(saved, persisted);
    assert.deepEqual(await loadButtonStateDocument(), persisted);
    await assert.rejects(saveButtonStateDocument(original, 5), /revision conflict/);
    assert.deepEqual(persisted, saved, "a stale save must not replace the current complete document");
  } finally {
    clearMocks();
    delete globalThis.window;
  }
});

test("draft, targeted reply and commit subscribers receive complete isolated documents", async () => {
  globalThis.window = { crypto: webcrypto };
  mockIPC(() => {}, { shouldMockEvents: true });
  const document = fixture();
  const seen = [];
  const cleanups = [];
  try {
    cleanups.push(await subscribeButtonCommits((value) => { seen.push(value); value.settings.defaultGap = 99; }));
    cleanups.push(await subscribeButtonCommits((value) => { assert.deepEqual(value, document); }));
    await publishButtonCommit(document);
    assert.equal(document.settings.defaultGap, 0);
    const drafts = [];
    cleanups.push(await subscribeButtonDrafts("session", value => drafts.push(value), {
      requesterLabel: "fan-a", requestId: "request-a"
    }));
    cleanups.push(await subscribeButtonDrafts("other-session", () => assert.fail("wrong session")));
    await publishButtonDraft("session", document);
    assert.deepEqual(drafts[0], document);
    await publishButtonDraftToWindow("session", "fan-b", document);
    assert.equal(drafts.length, 1, "a targeted reply must not reach another window");
    cleanups.push(await registerButtonDraftResponder("session", () => document));
    await requestButtonDraft("session", "fan-a", "request-a");
    assert.equal(drafts.length, 2);
    assert.deepEqual(drafts[1], document);
    assert.notEqual(drafts[0], drafts[1]);
    assert.equal(seen.length, 1);
  } finally {
    cleanups.forEach(cleanup => cleanup());
    clearMocks();
    delete globalThis.window;
  }
});
