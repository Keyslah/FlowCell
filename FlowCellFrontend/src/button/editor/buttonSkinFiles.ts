import type { ButtonSkin } from "../types.js";
import {
  BUTTON_SKIN_SECTION_ORDER,
  buttonSkinNameFromPath,
  createEmptyButtonSkinSections
} from "../skins/buttonSkinFormat.js";
import {
  applyNamedButtonSkinSections,
  parseButtonSkinPaste
} from "../skins/skinPasteParser.js";

export interface ButtonSkinFileResult {
  skin: ButtonSkin;
  path: string;
}

export function createButtonSkinFromFile(
  source: string,
  path: string,
  skinId: string
): ButtonSkin {
  const parsed = parseButtonSkinPaste(source);
  if (!parsed.ok) {
    throw new Error(parsed.line ? `${parsed.message} (line ${parsed.line})` : parsed.message);
  }
  const missingSections = BUTTON_SKIN_SECTION_ORDER.filter(
    (section) => !parsed.presentSections.includes(section)
  );
  if (missingSections.length > 0) {
    throw new Error(
      `Button skin file is missing canonical section${missingSections.length === 1 ? "" : "s"}: ${missingSections.join(", ")}.`
    );
  }
  const sections = applyNamedButtonSkinSections(
    createEmptyButtonSkinSections(),
    parsed
  );
  return {
    id: skinId,
    name: buttonSkinNameFromPath(path) || "Button Skin",
    ...sections,
    metadata: {},
    compileCache: null
  };
}
