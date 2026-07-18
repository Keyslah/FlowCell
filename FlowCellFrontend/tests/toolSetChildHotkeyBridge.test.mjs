import test from "node:test";
import assert from "node:assert/strict";
import {
  activateToolSetChildHotkey
} from "./.compiled-button-system/button/runtime/toolSetChildHotkeyBridge.js";

const PAYLOAD = {
  bindingId: 42,
  shortcut: "^!N",
  buttonId: "rotate-negative",
  ownerButtonId: "rotate-owner"
};

function childButton(overrides = {}) {
  return {
    id: PAYLOAD.buttonId,
    role: "tool-set-child",
    label: "Negative",
    disabled: false,
    toolSetParentId: PAYLOAD.ownerButtonId,
    ...overrides
  };
}

function toolSetUnit(overrides = {}) {
  return {
    kind: "tool-set",
    ownerButtonId: PAYLOAD.ownerButtonId,
    childButtonIds: [PAYLOAD.buttonId],
    ...overrides
  };
}

function hostState(overrides = {}) {
  return {
    document: { buttons: { [PAYLOAD.buttonId]: childButton() } },
    unit: toolSetUnit(),
    renderedDisplayMode: "expanded",
    root: null,
    ...overrides
  };
}

class FakeKeyboardEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeInteractionHost {
  events = [];

  dispatchEvent(event) {
    this.events.push(event);
    return true;
  }
}

class FakeButtonHost {
  constructor(buttonId, interactionHost) {
    this.dataset = { buttonHostId: buttonId };
    this.interactionHost = interactionHost;
  }

  querySelector(selector) {
    assert.equal(selector, "[data-button-skin-host]");
    return this.interactionHost;
  }
}

class FakeRoot {
  constructor(hosts) {
    this.hosts = hosts;
  }

  querySelectorAll(selector) {
    assert.equal(selector, "[data-button-host-id]");
    return this.hosts;
  }
}

test("mounted active child hotkey dispatches the ButtonHost Enter press lifecycle", () => {
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  globalThis.KeyboardEvent = FakeKeyboardEvent;
  try {
    const interactionHost = new FakeInteractionHost();
    const root = new FakeRoot([
      new FakeButtonHost("another-child", new FakeInteractionHost()),
      new FakeButtonHost(PAYLOAD.buttonId, interactionHost)
    ]);

    const result = activateToolSetChildHotkey(PAYLOAD, hostState({ root }));

    assert.equal(result.accepted, true);
    assert.deepEqual(result.payload, PAYLOAD);
    assert.equal(interactionHost.events.length, 2);
    assert.deepEqual(
      interactionHost.events.map((event) => ({
        type: event.type,
        key: event.key,
        code: event.code,
        bubbles: event.bubbles,
        cancelable: event.cancelable,
        repeat: event.repeat
      })),
      [
        { type: "keydown", key: "Enter", code: "Enter", bubbles: true, cancelable: true, repeat: false },
        { type: "keyup", key: "Enter", code: "Enter", bubbles: true, cancelable: true, repeat: false }
      ]
    );
  } finally {
    if (originalKeyboardEvent === undefined) delete globalThis.KeyboardEvent;
    else globalThis.KeyboardEvent = originalKeyboardEvent;
  }
});

test("child hotkey rejects a request sent to the wrong owner", () => {
  const result = activateToolSetChildHotkey(
    { ...PAYLOAD, ownerButtonId: "different-owner" },
    hostState()
  );
  assert.equal(result.accepted, false);
  assert.match(result.message, /wrong tool-set owner/i);
});

test("child hotkey rejects a collapsed tool set", () => {
  const result = activateToolSetChildHotkey(
    PAYLOAD,
    hostState({ renderedDisplayMode: "collapsed" })
  );
  assert.equal(result.accepted, false);
  assert.match(result.message, /not expanded/i);
});

test("child hotkey rejects a stale child Button ID", () => {
  const result = activateToolSetChildHotkey(
    PAYLOAD,
    hostState({ document: { buttons: {} } })
  );
  assert.equal(result.accepted, false);
  assert.match(result.message, /no longer exists/i);
});

test("child hotkey rejects a disabled child", () => {
  const result = activateToolSetChildHotkey(
    PAYLOAD,
    hostState({
      document: { buttons: { [PAYLOAD.buttonId]: childButton({ disabled: true }) } }
    })
  );
  assert.equal(result.accepted, false);
  assert.match(result.message, /disabled/i);
});

test("child hotkey rejects an active child whose ButtonHost is not mounted", () => {
  const result = activateToolSetChildHotkey(
    PAYLOAD,
    hostState({ root: new FakeRoot([]) })
  );
  assert.equal(result.accepted, false);
  assert.match(result.message, /not mounted/i);
});
