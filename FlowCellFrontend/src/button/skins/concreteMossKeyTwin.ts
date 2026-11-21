import type { ButtonSkin } from "../types.js";

/**
 * The Concrete Moss Main theme. The Main page's keys stay Chipped Concrete in Button state (their
 * skins, sizes, family baselines and placements never change); while the Main page's theme is
 * Concrete Moss, the Main page draws each Chipped Concrete key it shows as the same key rendered
 * in Concrete Moss. Pop-outs, Fans, tool sets and the Buttons Editor never draw twins.
 */
export const MAIN_KEY_MATERIAL_ATTRIBUTE = "data-flowcell-main-key-material";
export const CONCRETE_MOSS_KEY_MATERIAL = "concrete-moss";

/** One rendered Concrete Moss key, generated from the Key Studio renders (concreteMossKeys.ts). */
export interface ConcreteMossKey {
  /** Base64 WebP strip of every press frame, side by side. */
  sprite: string;
  /** Picture left, top, width and height around a core of the key's own size, in CSS px. */
  picture: readonly [number, number, number, number];
  frames: number;
  /** The --cc-travel-profile value: hover frame, flush frame, then depth %,label y for every frame. */
  profile: string;
}

export type ConcreteMossKeySet = Readonly<Record<string, ConcreteMossKey>>;

// Light in the cut: warm white letters whose glow is the same color, added onto the stone like real light.
const LIGHT = "255,246,228";
const LIT_LABEL = [
  `color:rgb(${LIGHT})`,
  "font-weight:300",
  `text-shadow:0 0 1px rgba(${LIGHT},0.9),0 0 3px rgba(${LIGHT},0.7),0 0 7px rgba(${LIGHT},0.45),0 0 14px rgba(${LIGHT},0.25)`,
  "mix-blend-mode:plus-lighter"
];

const KEY_NAME = /^chipped concrete key (\d{3})(?: ([a-z]))?$/i;
const FAMILY_NAME = /^chipped concrete ?\d+$/i;
const CORE_WIDTH = /<div data-core style="[^"]*?\bwidth:([0-9.]+)px/;
const SPRITE = /data:image\/webp;base64,[A-Za-z0-9+/=]+/;
const PICTURE_BOX = /(<span data-anim="cc" style="[^"]*?)left:-?[0-9.]+px;top:-?[0-9.]+px;width:[0-9.]+px;height:[0-9.]+px/;
const FRAME_SIZE = /background-size:\d+% 100%/;
const LABEL_STYLE = /(<span data-anim="cl" style=")([^"]*)(")/;
const PROFILE = /--cc-travel-profile:[^;]*;/;

/**
 * The rendered key a Chipped Concrete key skin draws ("k100", "k100b"), or null for every other
 * skin. Saved keys carry their key in the name; family files and the bundled default carry their
 * width. Only the 12-frame key format qualifies, so older sample and picture skins never match.
 */
export function chippedConcreteKeyName(skin: ButtonSkin): string | null {
  if (!skin.base.includes("--cc-travel-profile") || !skin.structure.includes('data-anim="cc"') ||
      !skin.structure.includes('data-anim="cl"')) return null;
  const name = skin.name.trim();
  const named = KEY_NAME.exec(name);
  if (named) return `k${named[1]}${named[2]?.toLowerCase() ?? ""}`;
  if (!FAMILY_NAME.test(name)) return null;
  const width = Number(CORE_WIDTH.exec(skin.structure)?.[1]);
  return Number.isFinite(width) && width > 0 ? `k${String(Math.round(width)).padStart(3, "0")}` : null;
}

function litLabel(style: string): string {
  const kept = style.split(";").map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !/^(?:color|text-shadow|font-weight|mix-blend-mode)\s*:/i.test(declaration));
  return [...kept, ...LIT_LABEL].join(";");
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildTwin(skin: ButtonSkin, key: ConcreteMossKey): ButtonSkin | null {
  const [left, top, width, height] = key.picture.map(round);
  const patterns = [SPRITE, PICTURE_BOX, FRAME_SIZE, LABEL_STYLE];
  if (!patterns.every((pattern) => pattern.test(skin.structure)) || !PROFILE.test(skin.base)) return null;
  const structure = skin.structure
    .replace(SPRITE, `data:image/webp;base64,${key.sprite}`)
    .replace(PICTURE_BOX, `$1left:${left}px;top:${top}px;width:${width}px;height:${height}px`)
    .replace(FRAME_SIZE, `background-size:${key.frames * 100}% 100%`)
    .replace(LABEL_STYLE, (_match, open: string, style: string, close: string) => `${open}${litLabel(style)}${close}`);
  return {
    ...skin,
    id: `${skin.id}--concrete-moss`,
    name: skin.name.replace(/^chipped concrete/i, "Concrete Moss"),
    structure,
    base: skin.base.replace(PROFILE, `--cc-travel-profile: ${key.profile};`),
    compileCache: null
  };
}

const twins = new WeakMap<ConcreteMossKeySet, WeakMap<ButtonSkin, ButtonSkin>>();

/**
 * The Concrete Moss twin of a Chipped Concrete key skin: the same key (size, shape, motion,
 * sizing policy and states) with the Concrete Moss picture and a lit label. Every other skin is
 * returned as it is. The same input always returns the same object, so a drawn skin never remounts.
 */
export function concreteMossKeyTwin(skin: ButtonSkin, keys: ConcreteMossKeySet): ButtonSkin {
  let cache = twins.get(keys);
  if (!cache) {
    cache = new WeakMap();
    twins.set(keys, cache);
  }
  const cached = cache.get(skin);
  if (cached) return cached;
  const name = chippedConcreteKeyName(skin);
  const key = name ? keys[name] ?? keys[name.slice(0, 4)] : undefined;
  const twin = (key && buildTwin(skin, key)) || skin;
  cache.set(skin, twin);
  return twin;
}
