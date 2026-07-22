import type { ButtonSkin, ButtonSkinSectionName } from "../types.js";

export const BUTTON_SKIN_SECTION_ORDER = [
  "structure",
  "keyframes",
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error"
] as const satisfies readonly ButtonSkinSectionName[];

export const BUTTON_SKIN_STATE_SECTIONS = [
  "base",
  "hover",
  "play",
  "pressed",
  "held",
  "release",
  "disabled",
  "error"
] as const;

export type ButtonSkinStateSectionName = (typeof BUTTON_SKIN_STATE_SECTIONS)[number];

export const BUTTON_SKIN_LABEL_TOKEN = "{{label}}";
export const BUTTON_SKIN_FILE_EXTENSION = ".flowcell-button-skin.txt" as const;

export function buttonSkinNameFromPath(path: string): string {
  const fileName = path.split(/[\\/]/).at(-1) ?? "";
  return fileName.toLowerCase().endsWith(BUTTON_SKIN_FILE_EXTENSION)
    ? fileName.slice(0, -BUTTON_SKIN_FILE_EXTENSION.length)
    : fileName;
}

export const BUTTON_SKIN_HEADERS = Object.fromEntries(
  BUTTON_SKIN_SECTION_ORDER.map((section) => [section, `=== ${section} ===`])
) as Record<ButtonSkinSectionName, string>;

export type ButtonSkinSectionSource = Pick<ButtonSkin, ButtonSkinSectionName>;

export function createEmptyButtonSkinSections(): ButtonSkinSectionSource {
  return {
    structure: "",
    keyframes: "",
    base: "",
    hover: "",
    play: "",
    pressed: "",
    held: "",
    release: "",
    disabled: "",
    error: ""
  };
}

export function isButtonSkinSectionName(value: string): value is ButtonSkinSectionName {
  return (BUTTON_SKIN_SECTION_ORDER as readonly string[]).includes(value);
}

export function serializeButtonSkinSections(
  source: ButtonSkinSectionSource,
  sections: readonly ButtonSkinSectionName[] = BUTTON_SKIN_SECTION_ORDER
): string {
  return sections
    .map((section) => `${BUTTON_SKIN_HEADERS[section]}\n${source[section]}`)
    .join("\n");
}
