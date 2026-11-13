import type { ButtonSkin } from "../types.js";
import { BUTTON_SKIN_SECTION_ORDER, createEmptyButtonSkinSections } from "./buttonSkinFormat.js";
import { parseButtonSkinPaste } from "./skinPasteParser.js";
import { chippedConcreteFamilySources } from "./chippedConcreteFamily.js";

export const CHIPPED_CONCRETE_BUTTON_SKIN_ID = "skin-chipped-concrete-family-default";
const counts = Object.keys(chippedConcreteFamilySources).map(Number).sort((a, b) => a - b);
const skins = new Map<number, ButtonSkin>();
const labelWidths = new Map<string, number>();

function measureLabelWidth(label: string, textSizeOverride?: number): number | null {
  const key = JSON.stringify([label, textSizeOverride]);
  const cached = labelWidths.get(key);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined" || !document.body) return null;

  // Chipped Concrete owns this width rule: measure its authored font and add
  // its authored side padding before selecting an existing sprite. Do not
  // impose these insets on other skins through the shared text fitter.
  const template = document.createElement("template");
  template.innerHTML = skinForCount(counts[0]).structure;
  const sourceCore = template.content.querySelector<HTMLElement>("[data-core]");
  const sourceLabel = template.content.querySelector<HTMLElement>('[data-anim="cl"]');
  if (!sourceCore || !sourceLabel) return null;
  const probe = document.createElement("span");
  probe.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const core = sourceCore.cloneNode(false) as HTMLElement;
  const carrier = sourceLabel.cloneNode(false) as HTMLElement;
  if (textSizeOverride !== undefined) carrier.style.fontSize = `${textSizeOverride}px`;
  carrier.textContent = label;
  core.append(carrier);
  probe.attachShadow({ mode: "open" }).append(core);
  document.body.append(probe);
  try {
    const range = document.createRange();
    range.selectNodeContents(carrier);
    const textWidth = range.getBoundingClientRect().width;
    if (!Number.isFinite(textWidth) || textWidth < 0 || (label.length > 0 && textWidth === 0)) return null;
    const style = getComputedStyle(carrier);
    const width = textWidth +
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0);
    if (!Number.isFinite(width) || width < 0 || (label.length > 0 && width === 0)) return null;
    labelWidths.set(key, width);
    return width;
  } catch {
    return null;
  } finally {
    probe.remove();
  }
}

function variantCount(label: string, preferredWidth?: number, textSizeOverride?: number): number {
  if (preferredWidth !== undefined && Number.isFinite(preferredWidth) && preferredWidth > 0) {
    return counts.reduce((best, count) =>
      Math.abs(chippedConcreteFamilySources[String(count)].width - preferredWidth) <=
      Math.abs(chippedConcreteFamilySources[String(best)].width - preferredWidth) ? count : best);
  }
  const requiredWidth = measureLabelWidth(label, textSizeOverride);
  // Non-DOM consumers cannot measure text. Use the widest authored source rather
  // than persisting an undersized character-count guess.
  return counts.find((count) => requiredWidth !== null &&
    chippedConcreteFamilySources[String(count)].width >= requiredWidth) ?? counts[counts.length - 1];
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
export function getChippedConcreteButtonSkin(label: string, preferredWidth?: number, textSizeOverride?: number): ButtonSkin {
  return skinForCount(variantCount(label, preferredWidth, textSizeOverride));
}

export function getChippedConcreteButtonSize(label: string, preferredWidth?: number, textSizeOverride?: number): { width: number; height: number } {
  const { width, height } = chippedConcreteFamilySources[String(variantCount(label, preferredWidth, textSizeOverride))];
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

export function isBundledChippedConcreteDefaultSkin(skin: ButtonSkin): boolean {
  if (skin.id !== CHIPPED_CONCRETE_BUTTON_SKIN_ID ||
    !BUTTON_SKIN_SECTION_ORDER.every((section) => skin[section] === CHIPPED_CONCRETE_BUTTON_SKIN[section])) return false;
  const sources = skin.metadata.buttonSkinEmbeddedVariants;
  return Boolean(sources && typeof sources === "object" && !Array.isArray(sources) &&
    Object.keys(sources).length === counts.length &&
    counts.every((count) => sources[String(count)] === chippedConcreteFamilySources[String(count)].source));
}

/** Recognize Main's unchanged default after settings imports rename a conflicting ID. */
export function isBundledMainPageConcreteSkin(value: unknown): value is ButtonSkin {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const skin = value as ButtonSkin;
  if (typeof skin.id !== "string" || !/^(?:settings-skin-)*skin-chipped-concrete-family-default(?:-\d+)*$/.test(skin.id) ||
    !skin.metadata || typeof skin.metadata !== "object" || Array.isArray(skin.metadata)) return false;
  return isBundledChippedConcreteDefaultSkin({ ...skin, id: CHIPPED_CONCRETE_BUTTON_SKIN_ID });
}
