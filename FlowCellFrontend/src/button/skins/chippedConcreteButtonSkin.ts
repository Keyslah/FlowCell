import type { ButtonSkin } from "../types.js";
import { createEmptyButtonSkinSections } from "./buttonSkinFormat.js";
import { buttonSkinLabelCharacterCount } from "./buttonSkinFamily.js";
import { parseButtonSkinPaste } from "./skinPasteParser.js";
import { chippedConcreteFamilySources } from "./chippedConcreteFamily.js";

export const CHIPPED_CONCRETE_BUTTON_SKIN_ID = "skin-chipped-concrete-family-default";
const counts = Object.keys(chippedConcreteFamilySources).map(Number).sort((a, b) => a - b);
const skins = new Map<number, ButtonSkin>();

function variantCount(label: string): number {
  const requested = buttonSkinLabelCharacterCount(label);
  return counts.reduce((best, count) => Math.abs(count - requested) <= Math.abs(best - requested) ? count : best);
}

function skinForCount(count: number): ButtonSkin {
  const cached = skins.get(count);
  if (cached) return cached;
  const parsed = parseButtonSkinPaste(chippedConcreteFamilySources[String(count)].source);
  if (!parsed.ok) throw new Error(`Bundled Chipped Concrete skin ${count}: ${parsed.message}`);
  const skin: ButtonSkin = {
    id: `skin-chipped-concrete-bundled-${count}`,
    name: `Chipped Concrete ${count}`,
    ...createEmptyButtonSkinSections(),
    ...parsed.sections,
    metadata: { bundled: true },
    compileCache: null
  };
  skins.set(count, skin);
  return skin;
}

/** Literal authored variants; the shared host retains all sizing and input behavior. */
export function getChippedConcreteButtonSkin(label: string): ButtonSkin {
  return skinForCount(variantCount(label));
}

export function getChippedConcreteButtonSize(label: string): { width: number; height: number } {
  const { width, height } = chippedConcreteFamilySources[String(variantCount(label))];
  return { width, height };
}

export const CHIPPED_CONCRETE_BUTTON_SKIN: ButtonSkin = {
  ...skinForCount(6),
  id: CHIPPED_CONCRETE_BUTTON_SKIN_ID,
  name: "Chipped Concrete",
  metadata: {
    bundled: true,
    buttonSkinEmbeddedVariants: Object.fromEntries(Object.entries(chippedConcreteFamilySources)
      .map(([count, variant]) => [count, variant.source]))
  }
};
