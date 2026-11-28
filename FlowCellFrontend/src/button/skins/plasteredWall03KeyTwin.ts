import type { ButtonSkin } from "../types.js";
import { chippedConcreteKeyName, type ConcreteMossKey, type ConcreteMossKeySet } from "./concreteMossKeyTwin.js";
import { readChippedConcreteKeyTravel } from "./chippedConcreteKeyTravel.js";
import { parseCssDeclarations } from "./cssSyntax.js";

export const PLASTERED_WALL_03_KEY_MATERIAL = "plastered-wall-03";

const SPRITE = /data:image\/webp;base64,[A-Za-z0-9+/=]+/;
const PICTURE_BOX = /(<span data-anim="cc" style="[^"]*?)left:-?[0-9.]+px;top:-?[0-9.]+px;width:[0-9.]+px;height:[0-9.]+px/;
const FRAME_SIZE = /background-size:\d+% 100%/;
const PROFILE = /--cc-travel-profile:[^;]*;/;
const LEGACY_KEY_NAME = /^chipped concrete key (\d{3})(?: ([a-z]))?$/i;
const LEGACY_FAMILY_NAME = /^chipped concrete ?\d+$/i;
const CORE_WIDTH = /<div data-core style="[^"]*?\bwidth:([0-9.]+)px/;
const LEGACY_PROPERTIES = new Set(["--cc-frame", "--cc-label-y", "--cc-ease", "--anim-cc", "--anim-cl"]);

/** Recognize only the original eight-frame Key Studio format, not arbitrary custom skins. */
function legacyKeyName(skin: ButtonSkin): string | null {
  if (skin.base.includes("--cc-travel-profile") || !skin.base.includes("--cc-frame:") ||
      !skin.structure.includes('data-anim="cc"') || !skin.structure.includes('data-anim="cl"') ||
      !skin.structure.includes("background-size:800% 100%") ||
      !skin.structure.includes("var(--cc-frame,0%)") || !skin.structure.includes("var(--cc-label-y,0px)") ||
      !skin.keyframes.includes("@keyframes cc-press") || !skin.keyframes.includes("@keyframes cl-press")) return null;
  const name = skin.name.trim();
  const named = LEGACY_KEY_NAME.exec(name);
  if (named) return `k${named[1]}${named[2]?.toLowerCase() ?? ""}`;
  if (!LEGACY_FAMILY_NAME.test(name) && !(skin.id === "skin-chipped-concrete-family-default" && /^chipped concrete$/i.test(name))) return null;
  const width = Number(CORE_WIDTH.exec(skin.structure)?.[1]);
  return Number.isFinite(width) && width > 0 ? `k${String(Math.round(width)).padStart(3, "0")}` : null;
}

function withoutLegacyMotion(source: string): string | null {
  const parsed = parseCssDeclarations(source);
  if (!parsed.ok) return null;
  // Custom-property names are case-sensitive, while the CSS parser normalizes
  // `property` to lowercase. Compare the authored spelling before removing one.
  return parsed.declarations.filter(({ source: declaration }) => !LEGACY_PROPERTIES.has(declaration.slice(0, declaration.indexOf(":")).trim()))
    .map(({ source: declaration }) => `${declaration};`).join("\n");
}

/** Upgrade only the drawn copy: its real saved skin and its old animation remain untouched. */
function buildLegacyTwin(skin: ButtonSkin, key: ConcreteMossKey): ButtonSkin | null {
  const travel = readChippedConcreteKeyTravel(`--cc-travel-profile: ${key.profile};`);
  if (!travel || travel.frames.length !== key.frames || !SPRITE.test(skin.structure) || !PICTURE_BOX.test(skin.structure)) return null;
  const sections = [skin.base, skin.hover, skin.pressed, skin.held, skin.release].map(withoutLegacyMotion);
  if (sections.some((section) => section === null)) return null;
  const [base, hover, pressed, held, release] = sections as string[];
  const motion = (frame: number) => `--cc-motion-frame: ${frame / (key.frames - 1) * 100}%;\n--cc-motion-label-y: ${travel.frames[frame].labelY}px;`;
  const [left, top, width, height] = key.picture.map((value) => Math.round(value * 1000) / 1000);
  const structure = skin.structure
    .replace(SPRITE, `data:image/webp;base64,${key.sprite}`)
    .replace(PICTURE_BOX, `$1left:${left}px;top:${top}px;width:${width}px;height:${height}px`)
    .replace(FRAME_SIZE, `background-size:${key.frames * 100}% 100%`)
    .replace("var(--cc-frame,0%)", "var(--cc-motion-frame,0%)")
    .replace("var(--cc-label-y,0px)", "var(--cc-motion-label-y,0px)")
    .replace(/;transition:background-position[^;"]*/i, "")
    .replace(/;transition:transform[^;"]*/i, "");
  return {
    ...skin,
    id: `${skin.id}--plastered-wall-03`,
    name: skin.name.replace(/^chipped concrete/i, "Plastered Wall 03"),
    structure,
    base: `${base}\n--cc-travel-profile: ${key.profile};\n${motion(0)}`,
    hover: `${hover}\n${motion(travel.hover)}`,
    pressed: `${pressed}\n${motion(key.frames - 1)}`,
    held: `${held}\n${motion(key.frames - 1)}`,
    release: `${release}\n${motion(travel.flush)}`,
    compileCache: null
  };
}

function buildTwin(skin: ButtonSkin, key: ConcreteMossKey): ButtonSkin | null {
  const [left, top, width, height] = key.picture.map((value) => Math.round(value * 1000) / 1000);
  if (![SPRITE, PICTURE_BOX, FRAME_SIZE].every((pattern) => pattern.test(skin.structure)) || !PROFILE.test(skin.base)) return null;
  return {
    ...skin,
    id: `${skin.id}--plastered-wall-03`,
    name: skin.name.replace(/^chipped concrete/i, "Plastered Wall 03"),
    structure: skin.structure
      .replace(SPRITE, `data:image/webp;base64,${key.sprite}`)
      .replace(PICTURE_BOX, `$1left:${left}px;top:${top}px;width:${width}px;height:${height}px`)
      .replace(FRAME_SIZE, `background-size:${key.frames * 100}% 100%`),
    base: skin.base.replace(PROFILE, `--cc-travel-profile: ${key.profile};`),
    compileCache: null
  };
}

const twins = new WeakMap<ConcreteMossKeySet, WeakMap<ButtonSkin, ButtonSkin>>();

/** Draw matching Main keys in plaster without changing their saved skin or label style. */
export function plasteredWall03KeyTwin(skin: ButtonSkin, keys: ConcreteMossKeySet): ButtonSkin {
  let cache = twins.get(keys);
  if (!cache) {
    cache = new WeakMap();
    twins.set(keys, cache);
  }
  const cached = cache.get(skin);
  if (cached) return cached;
  const legacyName = legacyKeyName(skin);
  const name = chippedConcreteKeyName(skin) ?? legacyName;
  const key = name ? keys[name] ?? keys[name.slice(0, 4)] : undefined;
  const twin = (key && (legacyName ? buildLegacyTwin(skin, key) : buildTwin(skin, key))) || skin;
  cache.set(skin, twin);
  return twin;
}
