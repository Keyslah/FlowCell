import {
  isThemeGradientDefinition,
  type ThemeGradientDefinition,
  type ThemeTarget
} from "./themeModel.js";

export const THEME_EDITOR_SCOPE_STATE_STORAGE_KEY =
  "flowcell.theme-editor-scope-state.v1";

export interface ThemeEditorButtonParticipation {
  gradientEnabled: boolean;
  scatterEnabled: boolean;
}

export interface ThemeEditorScopeState {
  gradient: ThemeGradientDefinition;
  buttonParticipation: Record<string, ThemeEditorButtonParticipation>;
}

interface ThemeEditorScopeStateDocument {
  version: 1;
  scopes: Record<string, ThemeEditorScopeState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isButtonParticipation(
  value: unknown
): value is ThemeEditorButtonParticipation {
  return isRecord(value) &&
    hasExactKeys(value, ["gradientEnabled", "scatterEnabled"]) &&
    typeof value.gradientEnabled === "boolean" &&
    typeof value.scatterEnabled === "boolean";
}

export function isThemeEditorScopeState(value: unknown): value is ThemeEditorScopeState {
  if (!isRecord(value) || !hasExactKeys(value, ["gradient", "buttonParticipation"])) {
    return false;
  }
  if (!isThemeGradientDefinition(value.gradient) || value.gradient === null) return false;
  if (!isRecord(value.buttonParticipation)) return false;
  return Object.entries(value.buttonParticipation).every(
    ([placementId, participation]) => Boolean(placementId.trim()) && isButtonParticipation(participation)
  );
}

function isThemeEditorScopeStateDocument(
  value: unknown
): value is ThemeEditorScopeStateDocument {
  return isRecord(value) &&
    hasExactKeys(value, ["version", "scopes"]) &&
    value.version === 1 &&
    isRecord(value.scopes) &&
    Object.entries(value.scopes).every(
      ([scope, state]) => Boolean(scope.trim()) && isThemeEditorScopeState(state)
    );
}

function normalizeScopeName(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\{2,}/g, "\\")
    .toLocaleLowerCase("en");
}

export function themeEditorScopeKey(target: ThemeTarget): string {
  return target.kind === "flowcell"
    ? JSON.stringify(["flowcell", target.page])
    : JSON.stringify([
        "program",
        normalizeScopeName(target.programName),
        target.panelName ? normalizeScopeName(target.panelName) : "*"
      ]);
}

function availableStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function emptyDocument(): ThemeEditorScopeStateDocument {
  return { version: 1, scopes: {} };
}

function readDocument(): ThemeEditorScopeStateDocument {
  const storage = availableStorage();
  if (!storage) return emptyDocument();
  try {
    const raw = storage.getItem(THEME_EDITOR_SCOPE_STATE_STORAGE_KEY);
    if (!raw) return emptyDocument();
    const parsed: unknown = JSON.parse(raw);
    return isThemeEditorScopeStateDocument(parsed)
      ? structuredClone(parsed)
      : emptyDocument();
  } catch {
    return emptyDocument();
  }
}

export function readThemeEditorScopeState(
  target: ThemeTarget
): ThemeEditorScopeState | null {
  const state = readDocument().scopes[themeEditorScopeKey(target)];
  return state ? structuredClone(state) : null;
}

export function writeThemeEditorScopeState(
  target: ThemeTarget,
  state: ThemeEditorScopeState
): ThemeEditorScopeState {
  if (!isThemeEditorScopeState(state)) {
    throw new Error("Theme Editor gradient and participation state is invalid.");
  }
  const accepted = structuredClone(state);
  const document = readDocument();
  document.scopes[themeEditorScopeKey(target)] = accepted;
  const storage = availableStorage();
  if (storage) {
    try {
      storage.setItem(THEME_EDITOR_SCOPE_STATE_STORAGE_KEY, JSON.stringify(document));
    } catch {
      // Canonical Button/page application remains valid when browser storage is unavailable.
    }
  }
  return structuredClone(accepted);
}
