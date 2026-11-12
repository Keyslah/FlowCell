import type { ButtonPlacement, ButtonSkin, ButtonStateDocument } from "../types.js";
import { createButtonSkinFromFile } from "../editor/buttonSkinFiles.js";
import {
  getEmbeddedButtonSkinFamilySources,
  rememberButtonSkinFamilyBaseline,
  sameEmbeddedButtonSkinFamily
} from "../skins/buttonSkinFamily.js";
import { BUTTON_SKIN_FILE_EXTENSION, BUTTON_SKIN_SECTION_ORDER } from "../skins/buttonSkinFormat.js";
import { validateButtonSkin } from "../skins/skinValidator.js";
import { createStableButtonId } from "./buttonDefaults.js";
import { resolveButtonPlacementPresentation } from "./buttonPresentation.js";

export interface InstalledToolSetAppearance {
  skins: Record<string, { source: string; variants?: Record<string, string> }>;
  owner?: string;
  children?: Record<string, string>;
}

export type InstalledToolSetPlacementPresentation = Pick<ButtonPlacement,
  "textFitMode" | "textAlignment" | "textOffsetX" | "textOffsetY" |
  "minimumFontSize" | "textSizeOverride" | "allowLabelResize" |
  "matchHitboxToSkin" | "allowStretching" | "highlightOnHover"
>;

const PACKAGE_SKIN_ID_PREFIX = "skin-toolset-package";

export function parseInstalledToolSetSkin(source: string, name: string): ButtonSkin {
  if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) {
    throw new Error(`Tool-set skin '${name}' exceeds 2 MiB.`);
  }
  const skin = createButtonSkinFromFile(source, `${name}${BUTTON_SKIN_FILE_EXTENSION}`, "");
  const validation = validateButtonSkin(skin);
  if (!validation.valid) {
    const diagnostic = validation.diagnostics[0];
    throw new Error(`Tool-set skin '${name}' has invalid ${diagnostic.section}: ${diagnostic.message}`);
  }
  return skin;
}

export function assignInstalledToolSetSkins(
  document: ButtonStateDocument,
  appearance: InstalledToolSetAppearance | undefined,
  targets: readonly { placement: ButtonPlacement; skinKey?: string }[]
): void {
  if (!appearance) return;
  const parsed = new Map<string, ButtonSkin>();
  const validated = new Set<string>();
  for (const [key, entry] of Object.entries(appearance.skins)) {
    const skin = parseInstalledToolSetSkin(entry.source, key);
    validated.add(entry.source);
    if (entry.variants && Object.keys(entry.variants).length) {
      for (const [count, source] of Object.entries(entry.variants)) {
        if (!validated.has(source)) parseInstalledToolSetSkin(source, `${key} (${count} characters)`);
        validated.add(source);
      }
      skin.metadata.buttonSkinEmbeddedVariants = { ...entry.variants };
    }
    parsed.set(key, skin);
  }

  const installed = new Map<string, ButtonSkin>();
  for (const { placement, skinKey } of targets) {
    if (typeof skinKey !== "string") continue;
    const candidate = parsed.get(skinKey);
    if (!candidate) throw new Error(`Tool-set appearance references missing skin '${skinKey}'.`);
    let skin = installed.get(skinKey) ?? Object.values(document.skins).find((existing) =>
      existing.id.startsWith(`${PACKAGE_SKIN_ID_PREFIX}-`) &&
      BUTTON_SKIN_SECTION_ORDER.every((section) => existing[section] === candidate[section]) &&
      sameEmbeddedButtonSkinFamily(existing, candidate)
    );
    if (!skin) {
      let id = createStableButtonId(PACKAGE_SKIN_ID_PREFIX);
      while (Object.hasOwn(document.skins, id)) id = createStableButtonId(PACKAGE_SKIN_ID_PREFIX);
      skin = { ...candidate, id };
      document.skins[id] = skin;
    }
    installed.set(skinKey, skin);
    placement.skinOverrideId = skin.id;
    if (getEmbeddedButtonSkinFamilySources(skin)) {
      const button = resolveButtonPlacementPresentation(document.buttons[placement.buttonId], placement);
      rememberButtonSkinFamilyBaseline(skin, placement.id, button.label);
    }
  }
}
