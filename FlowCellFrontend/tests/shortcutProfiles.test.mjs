import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShortcutPickerOptions,
  computeAvailableShortcutChoices,
  UNBOUND_SHORTCUT_LABEL,
  validateShortcutInput
} from "./.compiled-shortcut-profiles/lib/shortcutProfiles.js";

function createWorkspace(shortcutProfiles) {
  return {
    programs: [
      {
        name: "Photoshop",
        programTabId: 4,
        panels: [
          {
            name: "Files",
            buttons: [
              {
                id: "photoshop::files::selected",
                label: "Selected",
                kind: "script",
                target: "Programs\\Photoshop\\Panels\\Files\\selected.jsx",
                shortcut: "^S",
                bindingId: 21
              },
              {
                id: "photoshop::files::other",
                label: "Other",
                kind: "script",
                target: "Programs\\Photoshop\\Panels\\Files\\other.jsx",
                shortcut: "^+1",
                bindingId: 22
              }
            ]
          }
        ]
      }
    ],
    bindings: {
      nextId: 23,
      scriptBindings: [
        {
          id: 21,
          bindingId: 21,
          kind: "script",
          programTabId: 4,
          shortcut: "^S",
          target: "Programs\\Photoshop\\Panels\\Files\\selected.jsx"
        },
        {
          id: 22,
          bindingId: 22,
          kind: "script",
          programTabId: 4,
          shortcut: "^+1",
          target: "Programs\\Photoshop\\Panels\\Files\\other.jsx"
        }
      ],
      actionHotkeys: {
        record_action: "^!2"
      }
    },
    shortcutProfiles,
    macros: [],
    warnings: []
  };
}

const shortcutProfiles = [
  {
    fileName: "windows.json",
    profileId: "windows",
    isLocalOverride: false,
    profile: {
      id: "windows",
      displayName: "Windows",
      blocked: [{ shortcut: "!{F4}", display: "Alt + F4" }],
      reserved: [],
      preferred: ["!{F4}", "^+1", "^!K"]
    }
  },
  {
    fileName: "adobe.photoshop.windows.json",
    profileId: "adobe.photoshop.windows",
    isLocalOverride: false,
    profile: {
      id: "adobe.photoshop.windows",
      displayName: "Adobe Photoshop",
      blocked: [],
      reserved: [{ shortcut: "^S", display: "Ctrl + S" }, { shortcut: "^Z", display: "Ctrl + Z" }],
      preferred: ["^S", "^+1", "^!2", "^!K"]
    }
  }
];

test("available shortcuts keep selected and reserved shortcuts but drop used entries", () => {
  const workspace = createWorkspace(shortcutProfiles);
  const selectedButton = workspace.programs[0].panels[0].buttons[0];

  const available = computeAvailableShortcutChoices({
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton
  });

  assert.equal(available.includes("^S"), true);
  assert.equal(available.includes("^+1"), false);
  assert.equal(available.includes("^!2"), false);
  assert.equal(available.includes("!{F4}"), true);
});

test("manual shortcut validation warns for Windows blocked shortcuts", () => {
  const workspace = createWorkspace(shortcutProfiles);
  const result = validateShortcutInput({
    rawValue: "Alt + F4",
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton: workspace.programs[0].panels[0].buttons[0]
  });

  assert.deepEqual(result, {
    ok: true,
    shortcut: "!F4",
    warning: "Warning: Alt + F4 is also used by Windows. The FlowCell bind is allowed anyway."
  });
});

test("manual shortcut validation warns for program reserved shortcuts", () => {
  const workspace = createWorkspace(shortcutProfiles);
  const result = validateShortcutInput({
    rawValue: "Ctrl + Z",
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton: workspace.programs[0].panels[0].buttons[1]
  });

  assert.deepEqual(result, {
    ok: true,
    shortcut: "^Z",
    warning: "Warning: Control + Z is also used by Photoshop. The FlowCell bind is allowed anyway."
  });
});

test("manual shortcut validation rejects duplicate FlowCell binds and allows safe custom shortcuts", () => {
  const workspace = createWorkspace(shortcutProfiles);
  const selectedButton = workspace.programs[0].panels[0].buttons[1];
  const duplicate = validateShortcutInput({
    rawValue: "Ctrl + S",
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton
  });
  assert.deepEqual(duplicate, {
    ok: false,
    message: "Shortcut is already bound to Selected."
  });

  const selectedButtonWithoutDuplicate = workspace.programs[0].panels[0].buttons[0];
  const duplicateUsed = validateShortcutInput({
    rawValue: "Ctrl + Shift + 1",
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton: selectedButtonWithoutDuplicate
  });
  assert.deepEqual(duplicateUsed, {
    ok: false,
    message: "Shortcut is already bound to Other."
  });

  const custom = validateShortcutInput({
    rawValue: "Ctrl + Alt + K",
    workspace,
    programName: "Photoshop",
    programTabId: 4,
    selectedButton
  });
  assert.deepEqual(custom, {
    ok: true,
    shortcut: "^!K",
    warning: undefined
  });
});

test("shortcut picker options always keep Unbound first", () => {
  const options = buildShortcutPickerOptions(["^!K", "^+1"]);
  assert.equal(options[0], UNBOUND_SHORTCUT_LABEL);
  assert.deepEqual(options, [UNBOUND_SHORTCUT_LABEL, "Control + Alt + K", "Control + Shift + 1"]);
});
