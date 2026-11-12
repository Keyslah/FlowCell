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
import type { ThemeToolDescriptor } from "./portableTheme.js";

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

interface LegacyAppearanceSourceReference {
  programId: string;
  sourceId: string;
  slot: string | null;
  surfaceKind: "regular-popout" | "tool-set-popout" | "fan";
}

function legacyAppearanceSourceReference(value: unknown): LegacyAppearanceSourceReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !["programId", "sourceId", "slot", "surfaceKind"].includes(key)) ||
    typeof candidate.programId !== "string" || !candidate.programId.trim() ||
    typeof candidate.sourceId !== "string" || !candidate.sourceId.trim() ||
    !(candidate.slot === null || typeof candidate.slot === "string" && candidate.slot.trim()) ||
    !["regular-popout", "tool-set-popout", "fan"].includes(String(candidate.surfaceKind))) return null;
  return candidate as unknown as LegacyAppearanceSourceReference;
}

function resolveLegacyAppearancePlacement(
  document: ButtonStateDocument, target: ThemeTarget, reference: LegacyAppearanceSourceReference,
  descriptors: readonly ThemeToolDescriptor[]
): string | null {
  const owners = [...new Set(descriptors.filter((descriptor) => descriptor.ownerButtonId &&
    descriptor.programId.toLocaleLowerCase("en") === reference.programId.toLocaleLowerCase("en") &&
    descriptor.sourceId === reference.sourceId).map((descriptor) => descriptor.ownerButtonId!))];
  if (owners.length > 1) throw new Error(`Saved popped Button source '${reference.sourceId}' has ${owners.length} installed owners.`);
  if (owners.length === 0) return null;
  const matches = Object.values(document.placements).filter((placement) => {
    if (!placementMatchesThemeTarget(document, placement, target) || document.surfaces[placement.surfaceId]?.kind !== reference.surfaceKind) return false;
    const button = document.buttons[placement.buttonId];
    if (reference.slot === null) return button?.id === owners[0];
    return button?.toolSetParentId === owners[0] &&
      (button.metadata.toolSetSlot === reference.slot ||
        button.executionTarget?.kind === "tool-set-action" && button.executionTarget.command === reference.slot);
  });
  if (matches.length > 1) throw new Error(`Saved popped Button slot '${reference.slot ?? "owner"}' has ${matches.length} matching placements.`);
  return matches[0]?.id ?? null;
}

/** Older local IDs remain supported; packaged source references resolve across installations. */
export function applyLegacyProgramAppearance(
  document: ButtonStateDocument, target: ThemeTarget, settings?: unknown, appearance?: unknown,
  descriptors: readonly ThemeToolDescriptor[] = []
): { document: ButtonStateDocument; skippedMissingPlacementCount: number } {
  if (target.kind !== "program") throw new Error("Program theme settings require a program target.");
  const next = cloneButtonDocument(document);
  const previousSettings = structuredClone(document.programPopoutThemes);
  let skippedMissingPlacementCount = 0;
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
    const resolvedPlacements = new Set<string>();
    for (const raw of value.placements) {
      const entry = raw as { placementId: string; buttonId: string; color?: string; textColor?: string; lockedAppearance?: ButtonThemeOverride; sourceReference?: LegacyAppearanceSourceReference } | null;
      if (!entry || typeof entry.placementId !== "string" || !entry.placementId.trim() ||
        typeof entry.buttonId !== "string" || !entry.buttonId.trim() ||
        Object.keys(entry).some((key) => !["placementId", "buttonId", "color", "textColor", "lockedAppearance", "sourceReference"].includes(key)) ||
        seen.has(entry.placementId)) throw new Error("Saved popped Button identity is invalid or duplicated.");
      seen.add(entry.placementId);
      const colors = entry.color !== undefined || entry.textColor !== undefined ? normalizeProgramPopoutColorOverride({
        ...(entry.color !== undefined ? { surface: entry.color } : {}), ...(entry.textColor !== undefined ? { text: entry.textColor } : {})
      }) : null;
      if ((entry.color !== undefined || entry.textColor !== undefined) && !colors) throw new Error("Saved popped Button color is invalid.");
      const lock = entry.lockedAppearance === undefined ? null : normalizeProgramPopoutThemeLock(entry.lockedAppearance);
      if (entry.lockedAppearance !== undefined && !lock) throw new Error("Saved popped Button lock is invalid.");
      const reference = entry.sourceReference === undefined ? null : legacyAppearanceSourceReference(entry.sourceReference);
      if (entry.sourceReference !== undefined && !reference) throw new Error("Saved popped Button source reference is invalid.");
      const direct = next.placements[entry.placementId];
      const placementId = direct?.buttonId === entry.buttonId ? direct.id
        : reference ? resolveLegacyAppearancePlacement(next, target, reference, descriptors) : null;
      if (!placementId) {
        if (direct && !reference) throw new Error(`Saved Button '${entry.buttonId}' cannot be resolved exactly on this installation.`);
        skippedMissingPlacementCount += 1;
        continue;
      }
      const placement = next.placements[placementId];
      if (resolvedPlacements.has(placement.id)) throw new Error("Saved popped Button appearance resolves to a duplicated placement.");
      resolvedPlacements.add(placement.id);
      if (!placementMatchesThemeTarget(next, placement, target)) continue;
      if (!popped(next, placement.id)) throw new Error("Saved popped appearance references a non-popped Button.");
      if (next.programPopoutThemeLocks?.[placement.id]) continue;
      if (colors) {
        next.programPopoutColorOverrides ??= {};
        next.programPopoutColorOverrides[placement.id] = { ...next.programPopoutColorOverrides[placement.id], ...colors };
      }
      if (lock) {
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
  return { document: next, skippedMissingPlacementCount };
}
