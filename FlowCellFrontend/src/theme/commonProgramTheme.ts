import type { ButtonStateDocument, ButtonThemeOverride } from "../button/types.js";
import { cloneButtonDocument } from "../button/state/buttonDefaults.js";
import { validateButtonStateDocument } from "../button/state/buttonStateValidation.js";
import { emptyButtonThemeOverride, placementMatchesThemeTarget, type ThemeTarget } from "./themeModel.js";
import {
  captureProgramPopoutThemeSettings, normalizeProgramPopoutColorOverride,
  normalizeProgramPopoutThemeLock, normalizeProgramPopoutThemeSettings,
  resolveProgramPopoutThemeOverride
} from "./programPopoutTheme.js";
import { normalizeButtonGlowAmount, normalizeButtonHighlightAmount, normalizeButtonSkinColor } from "../button/skins/buttonSkinColors.js";

export type CommonProgramThemeEffectField = "hoverHighlightAmount" | "activeHighlightAmount" | "hoverGlowAmount" | "activeGlowAmount";
export type CommonProgramThemeEdit =
  | { kind: "colors"; role: string; colors: Readonly<Record<string, string>> }
  | { kind: "effect"; field: CommonProgramThemeEffectField; amount: number };

function popped(document: ButtonStateDocument, placementId: string): boolean {
  const placement = document.placements[placementId];
  return Boolean(placement && ["regular-popout", "tool-set-popout", "fan"].includes(document.surfaces[placement.surfaceId]?.kind));
}

/** Common controls and program contributions edit the same canonical appearance. */
export function applyCommonProgramThemeEdit(
  document: ButtonStateDocument, target: ThemeTarget, placementIds: readonly string[], edit: CommonProgramThemeEdit
): void {
  const placements = placementIds.map((id) => document.placements[id]);
  if (placements.some((placement) => !placement || !placementMatchesThemeTarget(document, placement, target))) {
    throw new Error("Theme edit contains a Button outside the selected target.");
  }
  if (edit.kind === "effect") {
    const amount = edit.field.endsWith("GlowAmount") ? normalizeButtonGlowAmount(edit.amount) : normalizeButtonHighlightAmount(edit.amount);
    if (amount === null) throw new Error("Theme effect amount is invalid.");
  }
  const programWide = target.kind === "program" && target.panelName === null;
  if (edit.kind === "effect" && programWide && placements.some((placement) => popped(document, placement.id))) {
    const settings = captureProgramPopoutThemeSettings(document, target.programName);
    settings[edit.field] = edit.amount;
    document.programPopoutThemes ??= {};
    document.programPopoutThemes[target.programName.normalize("NFC").trim().toLocaleLowerCase("en")] = settings;
  }
  for (const placement of placements) {
    const id = placement.id;
    const isProgramPopout = target.kind === "program" && popped(document, id);
    const locked = isProgramPopout ? document.programPopoutThemeLocks?.[id] : undefined;
    // Program-wide edits respect participation exclusions. A narrower explicit
    // edit updates the selected frozen appearance, remaining editable afterwards.
    if (locked && programWide) continue;
    if (edit.kind === "colors") {
      const color = normalizeButtonSkinColor(edit.colors[id]);
      if (!color) throw new Error(`Theme color is missing or invalid for '${id}'.`);
      if (isProgramPopout && (edit.role === "surface" || edit.role === "text")) {
        if (locked) locked.colors[edit.role] = color;
        else {
          document.programPopoutColorOverrides ??= {};
          document.programPopoutColorOverrides[id] = { ...document.programPopoutColorOverrides[id], [edit.role]: color };
        }
      } else {
        document.themeOverrides ??= {};
        document.themeOverrides[id] ??= emptyButtonThemeOverride();
        document.themeOverrides[id].colors[edit.role] = color;
      }
    } else if (isProgramPopout) {
      if (!programWide) {
        const resolved = resolveProgramPopoutThemeOverride(document, id) ?? emptyButtonThemeOverride();
        document.programPopoutThemeLocks ??= {};
        document.programPopoutThemeLocks[id] = { ...structuredClone(resolved), [edit.field]: edit.amount };
      }
    } else {
      document.themeOverrides ??= {};
      document.themeOverrides[id] ??= emptyButtonThemeOverride();
      document.themeOverrides[id][edit.field] = edit.amount;
    }
  }
}

/** Legacy files apply only the settings they contain, with exact local identity checks. */
export function applyLegacyProgramAppearance(
  document: ButtonStateDocument, target: ThemeTarget, settings?: unknown, appearance?: unknown
): ButtonStateDocument {
  if (target.kind !== "program") throw new Error("Program theme settings require a program target.");
  const next = cloneButtonDocument(document);
  const previousSettings = structuredClone(document.programPopoutThemes);
  if (settings !== undefined) {
    const normalized = normalizeProgramPopoutThemeSettings(settings);
    if (!normalized) throw new Error("Saved popped Button settings are invalid.");
    const previous = captureProgramPopoutThemeSettings(document, target.programName);
    const merged = { ...previous, ...(settings as object) };
    next.programPopoutThemes ??= {};
    next.programPopoutThemes[target.programName.normalize("NFC").trim().toLocaleLowerCase("en")] =
      normalizeProgramPopoutThemeSettings(merged)!;
  }
  if (appearance !== undefined) {
    const value = appearance as { version?: number; placements?: unknown[] } | null;
    if (!value || value.version !== 1 || !Array.isArray(value.placements) || value.placements.length > 10000) {
      throw new Error("Saved popped Button appearances are invalid.");
    }
    const seen = new Set<string>();
    for (const raw of value.placements) {
      const entry = raw as { placementId: string; buttonId: string; color?: string; textColor?: string; lockedAppearance?: ButtonThemeOverride } | null;
      if (!entry || typeof entry.placementId !== "string" || typeof entry.buttonId !== "string" ||
        Object.keys(entry).some((key) => !["placementId", "buttonId", "color", "textColor", "lockedAppearance"].includes(key)) ||
        seen.has(entry.placementId)) throw new Error("Saved popped Button identity is invalid or duplicated.");
      seen.add(entry.placementId);
      const placement = next.placements[entry.placementId];
      if (!placement || placement.buttonId !== entry.buttonId) {
        throw new Error(`Saved Button '${entry.buttonId}' cannot be resolved exactly on this installation.`);
      }
      if (!placementMatchesThemeTarget(next, placement, target)) continue;
      if (!popped(next, placement.id)) throw new Error("Saved popped appearance references a non-popped Button.");
      if (next.programPopoutThemeLocks?.[placement.id]) continue;
      const colors = entry.color !== undefined || entry.textColor !== undefined ? normalizeProgramPopoutColorOverride({
        ...(entry.color !== undefined ? { surface: entry.color } : {}), ...(entry.textColor !== undefined ? { text: entry.textColor } : {})
      }) : null;
      if ((entry.color !== undefined || entry.textColor !== undefined) && !colors) throw new Error("Saved popped Button color is invalid.");
      if (colors) {
        next.programPopoutColorOverrides ??= {};
        next.programPopoutColorOverrides[placement.id] = { ...next.programPopoutColorOverrides[placement.id], ...colors };
      }
      if (entry.lockedAppearance !== undefined) {
        const lock = normalizeProgramPopoutThemeLock(entry.lockedAppearance);
        if (!lock) throw new Error("Saved popped Button lock is invalid.");
        next.programPopoutThemeLocks ??= {};
        next.programPopoutThemeLocks[placement.id] = lock;
      }
    }
  }
  if (settings !== undefined && target.panelName !== null) {
    for (const placement of Object.values(next.placements)) {
      if (!popped(next, placement.id) || !placementMatchesThemeTarget(next, placement, target)) continue;
      const resolved = resolveProgramPopoutThemeOverride(next, placement.id);
      if (resolved) {
        next.programPopoutThemeLocks ??= {};
        next.programPopoutThemeLocks[placement.id] = structuredClone(resolved);
      }
    }
    if (previousSettings) next.programPopoutThemes = previousSettings;
    else delete next.programPopoutThemes;
  }
  const validation = validateButtonStateDocument(next);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  return next;
}
