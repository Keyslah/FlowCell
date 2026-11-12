import type { ButtonSkin, ButtonStateDocument } from "../../button/types.js";
import { isPortableTheme, themeTargetsMatch, type PortableTheme } from "../../theme/portableTheme.js";
import { getThemeToolDescriptors, preparePortableThemeImport } from "../../theme/portableThemeService.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../../button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources } from "../../button/skins/buttonSkinFamily.js";

type PortableAppearance = PortableTheme["theme"]["buttons"][number];
export interface ProgramAppearanceFile {
  kind: "FlowCellProgramAppearance";
  version: 1;
  theme: Omit<PortableTheme, "theme"> & {
    theme: Omit<PortableTheme["theme"], "buttons"> & {
      buttons: Array<Omit<PortableAppearance, "skin"> & { skin: string }>;
    };
  };
  skins: Record<string, ButtonSkin>;
  skinSources: Record<string, string>;
}

/** Repeated literal skins/families are stored once without changing their content. */
export function encodeProgramDefaultTheme(theme: PortableTheme): ProgramAppearanceFile {
  if (!isPortableTheme(theme)) throw new Error("Cannot package an invalid portable Program appearance.");
  const skins: Record<string, ButtonSkin> = {};
  const skinSources: Record<string, string> = {};
  const sourceKeys = new Map<string, string>();
  const intern = (source: string) => {
    let key = sourceKeys.get(source);
    if (!key) { key = `source-${sourceKeys.size}`; sourceKeys.set(source, key); skinSources[key] = source; }
    return key;
  };
  const keys = new Map<string, string>();
  const buttons = theme.theme.buttons.map(({ skin, ...appearance }) => {
    const packed = { ...skin, metadata: { ...skin.metadata } };
    for (const section of BUTTON_SKIN_SECTION_ORDER) packed[section] = intern(skin[section]);
    const variants = getEmbeddedButtonSkinFamilySources(skin);
    if (variants) packed.metadata.buttonSkinEmbeddedVariants = Object.fromEntries(
      Object.entries(variants).map(([count, source]) => [count, intern(source)]));
    const identity = JSON.stringify(packed);
    let key = keys.get(identity);
    if (!key) {
      key = `skin-${keys.size}`;
      keys.set(identity, key);
      skins[key] = packed;
    }
    return { ...appearance, skin: key };
  });
  return { kind: "FlowCellProgramAppearance", version: 1,
    theme: { ...theme, theme: { ...theme.theme, buttons } }, skins, skinSources };
}

export function decodeProgramAppearance(value: unknown): PortableTheme {
  if (isPortableTheme(value)) return value;
  const file = value as Partial<ProgramAppearanceFile> | null;
  if (file?.kind !== "FlowCellProgramAppearance" || file.version !== 1 || !file.skins ||
    typeof file.skins !== "object" || Array.isArray(file.skins) || !file.skinSources ||
    typeof file.skinSources !== "object" || Array.isArray(file.skinSources) || !Array.isArray(file.theme?.theme?.buttons)) {
    throw new Error("The packaged Program appearance has an unsupported format.");
  }
  const source = (key: string) => {
    if (typeof key !== "string" || !Object.hasOwn(file.skinSources!, key) || typeof file.skinSources![key] !== "string") {
      throw new Error("The packaged Program appearance references a missing skin source.");
    }
    return file.skinSources![key];
  };
  const skins = Object.fromEntries(Object.entries(file.skins).map(([key, packed]) => {
    const skin = { ...packed, metadata: { ...packed.metadata } };
    for (const section of BUTTON_SKIN_SECTION_ORDER) skin[section] = source(packed[section]);
    const variants = getEmbeddedButtonSkinFamilySources(packed);
    if (variants) skin.metadata.buttonSkinEmbeddedVariants = Object.fromEntries(
      Object.entries(variants).map(([count, key]) => [count, source(key)]));
    return [key, skin];
  }));
  const buttons = file.theme.theme.buttons.map((appearance) => {
    if (typeof appearance.skin !== "string" || !Object.hasOwn(skins, appearance.skin)) {
      throw new Error("The packaged Program appearance references a missing skin.");
    }
    return { ...appearance, skin: skins[appearance.skin] };
  });
  const theme = { ...file.theme, theme: { ...file.theme.theme, buttons } };
  if (!isPortableTheme(theme)) throw new Error("The packaged Program appearance contains invalid presentation settings.");
  return theme;
}

/** A new Program may receive its package's exact appearance in the setup commit. */
export function requireNewProgramAppearance(document: ButtonStateDocument, programName: string): void {
  const matches = (value: unknown) => typeof value === "string" && value.toLowerCase() === programName.toLowerCase();
  if (Object.values(document.buttons).some((button) =>
    matches(button.sourceIdentity?.displayProgramName) || matches(button.executionTarget?.kind === "core-action"
      ? undefined : button.executionTarget?.programName) || matches(button.metadata.programName)) ||
    Object.keys(document.programPopoutThemes ?? {}).some(matches)) {
    throw new Error(`'${programName}' already has saved Button settings. Turn off 'Use packaged appearance and layout' to preserve them.`);
  }
}

/** Stored with the appearance in the same atomic Save, for native crash recovery. */
export function stampProgramAppearanceReceipt(document: ButtonStateDocument, ownerIds: readonly string[], receipt: unknown): void {
  if (typeof receipt !== "string" || !/^[a-f0-9]{64}$/.test(receipt) || ownerIds.length === 0) {
    throw new Error("The Program installer returned an invalid packaged appearance receipt.");
  }
  for (const id of ownerIds) {
    const button = document.buttons[id];
    if (!button) throw new Error("The packaged appearance is missing an installed owner Button.");
    button.metadata.programDefaultAppearanceReceipt = receipt;
  }
}

export async function applyProgramDefaultTheme(
  document: ButtonStateDocument, programName: string, value: unknown
): Promise<ButtonStateDocument> {
  const target = { kind: "program" as const, programName, panelName: null };
  const theme = decodeProgramAppearance(value);
  if (!themeTargetsMatch(theme.target, target) ||
    theme.target.kind !== "program" || theme.target.panelName !== null || theme.target.area !== undefined) {
    throw new Error("The packaged appearance is not a valid whole-Program portable theme.");
  }
  const prepared = await preparePortableThemeImport({
    document, theme, target, descriptors: await getThemeToolDescriptors(target), allowSourceInstallation: false
  });
  return prepared.document;
}
