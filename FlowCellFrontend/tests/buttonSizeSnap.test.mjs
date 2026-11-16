import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createButtonStateDocument } from "./.compiled-button-system/button/state/buttonDefaults.js";
import { resolveButtonPlacementPresentation } from "./.compiled-button-system/button/state/buttonPresentation.js";
import { buttonSpacingPixelsFromMillimeters, resizeButtonPlacementSelection } from "./.compiled-button-system/button/geometry/buttonGeometry.js";

const editor = readFileSync(new URL("../src/button/editor/ButtonEditorPage.tsx", import.meta.url), "utf8");
const handlerStart = editor.indexOf("const snapSelectionToText =");
const handlerEnd = editor.indexOf("const snapSelectedSurfaceToTopLeft =", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "the production Size snap handler must exist");
const handler = editor.slice(handlerStart, handlerEnd);

function fixture(kind = "regular") {
  const document = createButtonStateDocument();
  document.settings.buttonSpacingMm = 0;
  const surfaceId = "size-snap-surface";
  const placementIds = ["a", "b", "c"];
  document.surfaces[surfaceId] = {
    id: surfaceId, kind: "regular-popout", name: "Size snap fixture",
    width: 300, height: 120, placementIds, uniformButtonSize: { width: 40, height: 20 }
  };
  for (const [index, id] of placementIds.entries()) {
    document.buttons[id] = {
      id, label: id.toUpperCase(), defaultSkinId: "skin-default-neutral"
    };
    document.placements[id] = {
      id, buttonId: id, surfaceId, x: index * 90, y: 10, width: 40, height: 20,
      skinOverrideId: null, textSizeOverride: null, matchHitboxToSkin: true,
      allowStretching: true, allowLabelResize: true, metadata: { marker: id }
    };
  }
  if (kind !== "regular") {
    document.buttons.owner = { id: "owner", label: "Owner", defaultSkinId: "skin-default-neutral" };
    document.placements.owner = {
      ...document.placements.a, id: "owner", buttonId: "owner", x: -35, y: 10, width: 70, height: 25
    };
    placementIds.push("owner");
    if (kind === "legacy-fan") {
      document.fanSetups.fan = { fanSurfaceId: surfaceId, panelOwnerButtonId: "owner" };
    } else {
      document.popoutUnits.unit = {
        surfaceId, ownerPlacementId: "owner", interactionMode: kind === "fan" ? "fan" : "pop"
      };
    }
  }
  return { document, surfaceId };
}

function harness(base = fixture(), options = {}) {
  const transactions = [], messages = [], busyChanges = [], familyCalls = [], measurementCalls = [];
  let current = structuredClone(base.document);
  const sandbox = {
    Error, Map, Set, Promise,
    useCallback: (callback) => callback,
    selectedSurfaceId: base.surfaceId,
    selectedPlacementIds: new Set(options.selectedIds ?? ["a", "b"]),
    busyRef: { current: false },
    window: { document: { fonts: { ready: options.fontsReady ?? Promise.resolve() } } },
    setBusy: (value) => { busyChanges.push(value); sandbox.busyRef.current = value; },
    setMessage: (value) => messages.push(value),
    resolveButtonPlacementPresentation,
    buttonSpacingPixelsFromMillimeters, resizeButtonPlacementSelection,
    resolveButtonSkinFamilyForTextSize: async (...args) => {
      familyCalls.push(args);
      return options.resolveFamily ? options.resolveFamily(...args) : args[0];
    },
    measureButtonTextSize: (...args) => {
      measurementCalls.push(args);
      return options.measure ? options.measure(...args) : {
        status: "sized", width: args[1] === "A" ? 25 : 65, height: 20
      };
    },
    store: {
      current: () => current,
      transact: (update, transactionOptions) => {
        transactions.push({ before: structuredClone(current), ...transactionOptions });
        const next = structuredClone(current);
        current = update(next) ?? next;
      }
    }
  };
  const code = `${handler}\nglobalThis.snap = snapSelectionToText;`;
  vm.runInNewContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText, sandbox);
  return {
    ...base, sandbox, transactions, messages, busyChanges, familyCalls, measurementCalls,
    get current() { return current; },
    replaceCurrent(next) { current = next; },
    undo() { current = structuredClone(transactions.pop().before); }
  };
}

test("Size snap measures each placement's visible label, assigned skin and font override in one undo transaction", async () => {
  const base = fixture();
  base.document.placements.a.presentationOverride = { label: "Occurrence A" };
  base.document.placements.a.textSizeOverride = 18;
  base.document.placements.a.height = 30;
  base.document.placements.a.allowStretching = false;
  base.document.placements.b.height = 28;
  base.document.placements.b.matchHitboxToSkin = false;
  base.document.placements.b.allowLabelResize = false;
  base.document.skins["override-skin"] = { ...base.document.skins["skin-default-neutral"], id: "override-skin" };
  base.document.placements.a.skinOverrideId = "override-skin";
  const familyVariant = { ...base.document.skins["override-skin"], id: "resolved-variant" };
  const h = harness(base, {
    resolveFamily: (skin, placementId) => placementId === "a" ? familyVariant : skin,
    measure: (skin) => skin.id === "resolved-variant"
      ? { status: "sized", width: 30, height: 18 }
      : { status: "sized", width: 65, height: 24 }
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();

  assert.deepEqual(h.familyCalls.map(([skin, placementId, label, font]) => [skin.id, placementId, label, font]), [
    ["override-skin", "a", "Occurrence A", 18], ["skin-default-neutral", "b", "B", undefined]
  ]);
  assert.deepEqual(h.measurementCalls.map(([skin, label, font]) => [skin.id, label, font]), [
    ["resolved-variant", "Occurrence A", 18], ["skin-default-neutral", "B", undefined]
  ]);
  assert.ok(h.measurementCalls.every((call) => call.length === 3));
  assert.deepEqual([h.current.placements.a.width, h.current.placements.a.height], [50, 30]);
  assert.deepEqual([h.current.placements.b.width, h.current.placements.b.height], [65, 28]);
  assert.equal(h.current.placements.a.matchHitboxToSkin, true);
  assert.equal(h.current.placements.b.matchHitboxToSkin, false);
  for (const id of ["a", "b"]) {
    assert.deepEqual(h.current.placements[id], { ...original.placements[id], width: h.current.placements[id].width });
  }
  assert.deepEqual(h.current.placements.c, original.placements.c);
  assert.deepEqual(h.current.buttons, original.buttons);
  assert.deepEqual(h.current.skins, original.skins);
  assert.equal(h.current.surfaces[h.surfaceId].uniformButtonSize, null);
  assert.equal(h.transactions.length, 1);
  assert.equal(h.transactions[0].label, "Size snap selected Buttons to text");
  assert.deepEqual(h.busyChanges, [true, false]);
  assert.equal(h.sandbox.busyRef.current, false);
  h.undo();
  assert.deepEqual(h.current, original);
});

test("Size snap uses the effective matched family scale without changing a saved responsive mode", async () => {
  const base = fixture();
  base.document.placements.a.matchHitboxToSkin = false;
  const variant = { ...base.document.skins["skin-default-neutral"], id: "dynamic-family-variant" };
  const h = harness(base, {
    selectedIds: ["a"],
    resolveFamily: () => variant,
    measure: () => ({ status: "sized", width: 30, height: 10 })
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.deepEqual(h.current.placements.a, { ...original.placements.a, width: 60 });
  assert.equal(h.current.placements.a.matchHitboxToSkin, false);
  assert.deepEqual(h.current.placements.b, original.placements.b);
  assert.deepEqual(h.current.placements.c, original.placements.c);
  assert.equal(h.transactions.length, 1);
});

test("Size snap skips fixed-width families without changing their authored dimensions", async () => {
  for (const metadata of [
    { buttonSkinFamily: "Family", buttonSkinFamilyBaseline: { a: 1 } },
    { buttonSkinEmbeddedVariants: { 1: "authored variant" }, buttonSkinFamilyBaseline: { a: 1 } }
  ]) {
    const base = fixture();
    base.document.skins["skin-default-neutral"].metadata = metadata;
    const h = harness(base, {
      selectedIds: ["a"],
      measure: () => ({ status: "skipped", reason: "The skin has a fixed width." })
    });
    const original = structuredClone(h.current);
    await h.sandbox.snap();
    assert.equal(h.measurementCalls.length, 1);
    assert.equal(h.measurementCalls[0].length, 3);
    assert.deepEqual(h.current, original);
    assert.equal(h.transactions.length, 0);
    assert.deepEqual(h.busyChanges, [true, false]);
  }
});

test("Size snap skips textless buttons without changing their size or sizing policy", async () => {
  const h = harness(fixture(), {
    measure: (_skin, label) => label === "A"
      ? { status: "skipped", reason: "The skin has no label." }
      : { status: "sized", width: 55, height: 20 }
  });
  const skipped = structuredClone(h.current.placements.a);
  await h.sandbox.snap();
  assert.deepEqual(h.current.placements.a, skipped);
  assert.equal(h.current.placements.b.width, 55);
  assert.equal(h.transactions.length, 1);
  assert.match(h.messages.at(-1), /Sized 1 Button.*Skipped 1/);
});

test("Size snap leaves an entirely textless selection unchanged and releases busy", async () => {
  const h = harness(fixture(), { measure: () => ({ status: "skipped", reason: "No visible text." }) });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.deepEqual(h.current, original);
  assert.equal(h.transactions.length, 0);
  assert.match(h.messages.at(-1), /text|fixed/i);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap fits an elastic Button while preserving selected fixed-width and textless Buttons", async () => {
  const base = fixture();
  base.document.placements.b.height = 35;
  base.document.placements.c.height = 45;
  const h = harness(base, {
    selectedIds: ["a", "b", "c"],
    measure: (_skin, label) => label === "A"
      ? { status: "sized", width: 60, height: 20 }
      : { status: "skipped", reason: label === "B" ? "The skin has a fixed width." : "No visible text." }
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.deepEqual(h.current.placements.a, { ...original.placements.a, width: 60 });
  assert.deepEqual(h.current.placements.b, original.placements.b);
  assert.deepEqual(h.current.placements.c, original.placements.c);
  assert.equal(h.transactions.length, 1);
  assert.match(h.messages.at(-1), /Sized 1 Button.*Skipped 2/);
});

test("Size snap excludes the hidden Pop owner even when it is selected", async () => {
  const h = harness(fixture("pop"), { selectedIds: ["a", "owner"] });
  const originalOwner = structuredClone(h.current.placements.owner);
  await h.sandbox.snap();
  assert.deepEqual(h.familyCalls.map((call) => call[1]), ["a"]);
  assert.deepEqual(h.current.placements.owner, originalOwner);
  assert.equal(h.transactions.length, 1);
});

for (const kind of ["fan", "legacy-fan"]) {
  test(`Size snap keeps the ${kind} owner independent without moving any Button`, async () => {
    const base = fixture(kind);
    const h = harness(base, {
      selectedIds: ["a", "owner"],
      measure: (_skin, label) => ({
        status: "sized", width: label === "Owner" ? 45 : 60, height: label === "Owner" ? 25 : 20
      })
    });
    const original = structuredClone(h.current);
    await h.sandbox.snap();
    assert.deepEqual([h.current.placements.owner.x, h.current.placements.owner.y], [-35, 10]);
    assert.equal(h.current.placements.owner.width, 45);
    assert.equal(h.current.placements.a.width, 60);
    for (const id of ["a", "b", "c", "owner"]) {
      assert.deepEqual(h.current.placements[id], { ...original.placements[id], width: h.current.placements[id].width });
    }
    assert.deepEqual(h.current.placements.b, original.placements.b);
    assert.deepEqual(h.current.placements.c, original.placements.c);
    assert.equal(h.transactions.length, 1);
    assert.deepEqual(h.busyChanges, [true, false]);
  });
}

test("Size snap rolls back every measured target when a later measurement fails", async () => {
  const h = harness(fixture(), {
    measure: (_skin, label) => label === "B"
      ? { status: "failed", reason: "The label cannot be measured." }
      : { status: "sized", width: 25, height: 20 }
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.equal(h.measurementCalls.length, 2);
  assert.equal(h.transactions.length, 0);
  assert.deepEqual(h.current, original);
  assert.match(h.messages.at(-1), /B: The label cannot be measured/);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap leaves all placements and uniform sizing unchanged when the measured row cannot fit", async () => {
  const base = fixture();
  base.document.surfaces[base.surfaceId].width = 220;
  const h = harness(base, {
    measure: () => ({ status: "sized", width: 180, height: 20 })
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.equal(h.transactions.length, 0);
  assert.deepEqual(h.current, original);
  assert.match(h.messages.at(-1), /overlap|outside|surface/i);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap refuses overlap without moving a neighbor even when repacking would fit", async () => {
  const base = fixture();
  base.document.placements.b.x = 40;
  base.document.placements.c.x = 80;
  const h = harness(base, {
    selectedIds: ["a"],
    measure: () => ({ status: "sized", width: 65, height: 20 })
  });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.equal(h.transactions.length, 0);
  assert.deepEqual(h.current, original);
  assert.match(h.messages.at(-1), /overlap/i);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap rejects asynchronous document changes and ignores repeat clicks while busy", async () => {
  const fonts = Promise.withResolvers();
  const h = harness(fixture(), { fontsReady: fonts.promise });
  const snapping = h.sandbox.snap();
  assert.equal(h.sandbox.busyRef.current, true);
  assert.equal(h.familyCalls.length, 0);
  await h.sandbox.snap();
  assert.deepEqual(h.busyChanges, [true]);
  const changed = structuredClone(h.current);
  changed.buttons.a.label = "Edited during measurement";
  h.replaceCurrent(changed);
  fonts.resolve();
  await snapping;
  assert.equal(h.transactions.length, 0);
  assert.deepEqual(h.current, changed);
  assert.match(h.messages.at(-1), /changed while measuring/);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap releases busy after family loading fails without writing a partial result", async () => {
  const h = harness(fixture(), { resolveFamily: async () => { throw new Error("Family load failed"); } });
  const original = structuredClone(h.current);
  await h.sandbox.snap();
  assert.equal(h.transactions.length, 0);
  assert.deepEqual(h.current, original);
  assert.match(h.messages.at(-1), /Family load failed/);
  assert.deepEqual(h.busyChanges, [true, false]);
});

test("Size snap with no visible selection does not measure or create an undo entry", async () => {
  for (const selectedIds of [[], ["owner"]]) {
    const h = harness(fixture("pop"), { selectedIds });
    const original = structuredClone(h.current);
    await h.sandbox.snap();
    assert.deepEqual(h.current, original);
    assert.equal(h.measurementCalls.length, 0);
    assert.equal(h.transactions.length, 0);
    assert.deepEqual(h.busyChanges, []);
    assert.match(h.messages.at(-1), /Select one or more Buttons/);
  }
});
