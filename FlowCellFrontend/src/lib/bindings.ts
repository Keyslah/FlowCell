import type { FlowCellBindingsState } from "../types.js";

const FUNCTION_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
const NUMBER_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const LETTER_KEYS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z"
];
const ALTGR_PLACEHOLDER = "__FLOWCELL_ALTGR__";
const DEFAULT_CANDIDATE_SHORTCUTS = buildCandidateShortcuts();

const SPECIAL_KEY_INPUT_MAP: Record<string, string> = {
  esc: "Esc",
  escape: "Esc",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  bs: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  "page up": "PgUp",
  pgup: "PgUp",
  prior: "PgUp",
  "page down": "PgDn",
  pgdn: "PgDn",
  next: "PgDn",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  "caps lock": "CapsLock",
  capslock: "CapsLock",
  "num lock": "NumLock",
  numlock: "NumLock",
  "scroll lock": "ScrollLock",
  scrolllock: "ScrollLock",
  menu: "AppsKey",
  appskey: "AppsKey",
  wheelup: "WheelUp",
  wheeldown: "WheelDown",
  "left mouse": "LButton",
  lbutton: "LButton",
  "right mouse": "RButton",
  rbutton: "RButton",
  "middle mouse": "MButton",
  mbutton: "MButton"
};

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function parseDisplayKeyToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  if (SPECIAL_KEY_INPUT_MAP[normalized]) {
    return SPECIAL_KEY_INPUT_MAP[normalized];
  }
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (/^[a-z]$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (/^[0-9]$/.test(normalized) || normalized === "-" || normalized === "=") {
    return normalized;
  }
  return trimmed;
}

function formatShortcutKeyTokenForDisplay(value: string): string {
  if (!value.trim()) {
    return "";
  }
  const trimmed = value.trim().replace(/^\{(.+)\}$/, "$1");
  const normalized = trimmed.toLowerCase();
  switch (normalized) {
    case "ctrl":
    case "control":
      return "Control";
    case "alt":
      return "Alt";
    case "shift":
      return "Shift";
    case "win":
    case "lwin":
    case "rwin":
      return "Win";
    case "esc":
    case "escape":
      return "Esc";
    case "enter":
    case "return":
      return "Enter";
    case "tab":
      return "Tab";
    case "space":
      return "Space";
    case "backspace":
    case "bs":
      return "Backspace";
    case "delete":
    case "del":
      return "Delete";
    case "insert":
    case "ins":
      return "Insert";
    case "home":
      return "Home";
    case "end":
      return "End";
    case "pgup":
    case "prior":
      return "Page Up";
    case "pgdn":
    case "next":
      return "Page Down";
    case "up":
      return "Up";
    case "down":
      return "Down";
    case "left":
      return "Left";
    case "right":
      return "Right";
    case "capslock":
      return "Caps Lock";
    case "numlock":
      return "Num Lock";
    case "scrolllock":
      return "Scroll Lock";
    case "appskey":
      return "Menu";
    case "wheelup":
      return "Wheel Up";
    case "wheeldown":
      return "Wheel Down";
    case "lbutton":
      return "Left Mouse";
    case "rbutton":
      return "Right Mouse";
    case "mbutton":
      return "Middle Mouse";
    default:
      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(trimmed)) {
        return trimmed.toUpperCase();
      }
      if (/^[a-z]$/i.test(trimmed)) {
        return trimmed.toUpperCase();
      }
      return trimmed;
  }
}

export function buildCandidateShortcuts(): string[] {
  const shortcuts: string[] = [];
  FUNCTION_KEYS.forEach((key) => shortcuts.push(`^+${key}`));
  FUNCTION_KEYS.forEach((key) => shortcuts.push(`^!+${key}`));
  NUMBER_KEYS.forEach((key) => shortcuts.push(`^!${key}`));
  NUMBER_KEYS.forEach((key) => shortcuts.push(`^!+${key}`));
  LETTER_KEYS.forEach((key) => shortcuts.push(`^!${key}`));
  LETTER_KEYS.forEach((key) => shortcuts.push(`^!+${key}`));
  return shortcuts;
}

export function canonicalizeShortcut(value: string): string {
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) {
    return "";
  }

  return compact
    .replaceAll("<^>!", ALTGR_PLACEHOLDER)
    .replaceAll("<^", "^")
    .replaceAll(">^", "^")
    .replaceAll("<!", "!")
    .replaceAll(">!", "!")
    .replaceAll("<+", "+")
    .replaceAll(">+", "+")
    .replaceAll("<#", "#")
    .replaceAll(">#", "#")
    .replaceAll(ALTGR_PLACEHOLDER, "<^>!");
}

export function normalizeShortcut(value: string): string {
  return canonicalizeShortcut(value)
    .replace(/\{([^{}]+)\}/g, "$1")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function parseShortcutInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const looksLikeAhkShortcut =
    /[~\^#!]|<\^|>\^|<!|>!|<\+|>\+|<#|>#|\{.+\}/.test(trimmed) &&
    !/[a-z]+\s+\+\s+[a-z0-9-]/i.test(trimmed);
  if (looksLikeAhkShortcut) {
    return canonicalizeShortcut(trimmed);
  }

  const tokens = trimmed
    .split(/\s*\+\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  const modifiers: string[] = [];
  let keyToken = "";
  tokens.forEach((token) => {
    const normalized = token.replace(/\s+/g, " ").toLowerCase();
    switch (normalized) {
      case "ctrl":
      case "control":
        pushUnique(modifiers, "^");
        break;
      case "alt":
        pushUnique(modifiers, "!");
        break;
      case "shift":
        pushUnique(modifiers, "+");
        break;
      case "win":
      case "windows":
      case "meta":
      case "super":
        pushUnique(modifiers, "#");
        break;
      case "altgr":
        pushUnique(modifiers, "<^>!");
        break;
      case "left ctrl":
      case "left control":
        pushUnique(modifiers, "<^");
        break;
      case "right ctrl":
      case "right control":
        pushUnique(modifiers, ">^");
        break;
      case "left alt":
        pushUnique(modifiers, "<!");
        break;
      case "right alt":
        pushUnique(modifiers, ">!");
        break;
      case "left shift":
        pushUnique(modifiers, "<+");
        break;
      case "right shift":
        pushUnique(modifiers, ">+");
        break;
      case "left win":
      case "left windows":
        pushUnique(modifiers, "<#");
        break;
      case "right win":
      case "right windows":
        pushUnique(modifiers, ">#");
        break;
      default:
        keyToken = parseDisplayKeyToken(token);
        break;
    }
  });

  if (!keyToken) {
    keyToken = parseDisplayKeyToken(trimmed);
  }

  return canonicalizeShortcut(`${modifiers.join("")}${keyToken}`);
}

export function formatShortcutForDisplay(value: string): string {
  const shortcut = canonicalizeShortcut(value);
  if (!shortcut) {
    return "";
  }

  if (shortcut.startsWith("~")) {
    const passThroughDisplay = formatShortcutForDisplay(shortcut.slice(1));
    return passThroughDisplay ? `${passThroughDisplay} (pass-through)` : shortcut;
  }

  if (/[\^!+#<>]/.test(shortcut)) {
    const parts: string[] = [];
    let index = 0;
    while (index < shortcut.length) {
      const remaining = shortcut.slice(index);
      if (remaining.startsWith("<^>!")) {
        pushUnique(parts, "AltGr");
        index += 4;
        continue;
      }
      if (remaining.startsWith("<^")) {
        pushUnique(parts, "Left Control");
        index += 2;
        continue;
      }
      if (remaining.startsWith(">^")) {
        pushUnique(parts, "Right Control");
        index += 2;
        continue;
      }
      if (remaining.startsWith("<!")) {
        pushUnique(parts, "Left Alt");
        index += 2;
        continue;
      }
      if (remaining.startsWith(">!")) {
        pushUnique(parts, "Right Alt");
        index += 2;
        continue;
      }
      if (remaining.startsWith("<+")) {
        pushUnique(parts, "Left Shift");
        index += 2;
        continue;
      }
      if (remaining.startsWith(">+")) {
        pushUnique(parts, "Right Shift");
        index += 2;
        continue;
      }
      if (remaining.startsWith("<#")) {
        pushUnique(parts, "Left Win");
        index += 2;
        continue;
      }
      if (remaining.startsWith(">#")) {
        pushUnique(parts, "Right Win");
        index += 2;
        continue;
      }

      const token = shortcut[index];
      if (token === "^") {
        pushUnique(parts, "Control");
        index += 1;
        continue;
      }
      if (token === "!") {
        pushUnique(parts, "Alt");
        index += 1;
        continue;
      }
      if (token === "+") {
        pushUnique(parts, "Shift");
        index += 1;
        continue;
      }
      if (token === "#") {
        pushUnique(parts, "Win");
        index += 1;
        continue;
      }

      parts.push(formatShortcutKeyTokenForDisplay(shortcut.slice(index)));
      return parts.join(" + ");
    }

    return parts.join(" + ");
  }

  return formatShortcutKeyTokenForDisplay(shortcut);
}

export function buildUsedShortcutMap(
  bindings: FlowCellBindingsState | null | undefined,
  excludeShortcut = ""
): Map<string, string> {
  const used = new Map<string, string>();
  if (!bindings) {
    return used;
  }

  const excludeNormalized = normalizeShortcut(excludeShortcut);
  bindings.scriptBindings.forEach((binding) => {
    const normalized = normalizeShortcut(binding.shortcut);
    if (normalized && normalized !== excludeNormalized) {
      used.set(normalized, binding.shortcut);
    }
  });
  Object.values(bindings.actionHotkeys).forEach((shortcut) => {
    const normalized = normalizeShortcut(shortcut);
    if (normalized && normalized !== excludeNormalized) {
      used.set(normalized, shortcut);
    }
  });
  return used;
}

export function buildAvailableCandidateShortcuts(
  bindings: FlowCellBindingsState | null | undefined,
  includeShortcut = ""
): string[] {
  const includeNormalized = normalizeShortcut(includeShortcut);
  const used = buildUsedShortcutMap(bindings, includeShortcut);
  const available = DEFAULT_CANDIDATE_SHORTCUTS.filter((shortcut) => {
    const normalized = normalizeShortcut(shortcut);
    return normalized === includeNormalized || !used.has(normalized);
  });

  if (
    includeNormalized &&
    !available.some((shortcut) => normalizeShortcut(shortcut) === includeNormalized)
  ) {
    available.unshift(canonicalizeShortcut(includeShortcut));
  }

  return available;
}
