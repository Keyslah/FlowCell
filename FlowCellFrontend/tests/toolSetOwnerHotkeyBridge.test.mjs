import test from "node:test";
import assert from "node:assert/strict";
import {
  ownerButtonIdFromHotkeyPayload,
  resolveToolSetOwnerActivationTarget
} from "./.compiled-button-system/button/runtime/toolSetOwnerHotkeyBridge.js";

const OWNER_ID = "owner-rotate";

function documentFixture(overrides = {}) {
  return {
    buttons: {
      [OWNER_ID]: {
        id: OWNER_ID,
        role: "tool-set-owner",
        sourceIdentity: {
          displayProgramName: "Blender",
          displayPanelName: "Toolset"
        }
      }
    },
    popoutUnits: {
      rotate: {
        id: "rotate-popout",
        kind: "tool-set",
        ownerButtonId: OWNER_ID,
        desktopBounds: { left: 10, top: 20, width: 300, height: 180 }
      }
    },
    ...overrides
  };
}

test("canonical owner resolves the same managed popout target used by Main", () => {
  assert.deepEqual(resolveToolSetOwnerActivationTarget(documentFixture(), OWNER_ID), {
    programName: "Blender",
    panelName: "Toolset",
    popoutUnitId: "rotate-popout",
    ownerButtonId: OWNER_ID,
    bounds: { Left: 10, Top: 20, Width: 300, Height: 180 }
  });
});

test("owner hotkey payload requires one matching canonical owner ID", () => {
  const payload = {
    bindingId: 7,
    shortcut: "^!R",
    targetKind: "tool-set-owner",
    buttonId: OWNER_ID,
    ownerButtonId: OWNER_ID
  };
  assert.equal(ownerButtonIdFromHotkeyPayload(payload), OWNER_ID);
  assert.throws(
    () => ownerButtonIdFromHotkeyPayload({ ...payload, buttonId: "different-owner" }),
    /one canonical owner/i
  );
});

test("stale or non-owner Button IDs are rejected", () => {
  assert.throws(
    () => resolveToolSetOwnerActivationTarget(documentFixture({ buttons: {} }), OWNER_ID),
    /was not found/i
  );
  const document = documentFixture();
  document.buttons[OWNER_ID] = { ...document.buttons[OWNER_ID], role: "single-script" };
  assert.throws(
    () => resolveToolSetOwnerActivationTarget(document, OWNER_ID),
    /was not found/i
  );
});

test("owner must have source identity and exactly one tool-set popout", () => {
  const missingIdentity = documentFixture();
  missingIdentity.buttons[OWNER_ID] = {
    ...missingIdentity.buttons[OWNER_ID],
    sourceIdentity: null
  };
  assert.throws(
    () => resolveToolSetOwnerActivationTarget(missingIdentity, OWNER_ID),
    /source identity/i
  );

  const duplicate = documentFixture();
  duplicate.popoutUnits.second = {
    ...duplicate.popoutUnits.rotate,
    id: "second-popout"
  };
  assert.throws(
    () => resolveToolSetOwnerActivationTarget(duplicate, OWNER_ID),
    /exactly one/i
  );
});
