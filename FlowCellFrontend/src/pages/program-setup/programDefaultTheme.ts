import type { ButtonSkin, ButtonStateDocument } from "../../button/types.js";
import { isPortableTheme, themeTargetsMatch, type PortableTheme, type ThemeToolDescriptor } from "../../theme/portableTheme.js";
import { getThemeToolDescriptors, preparePortableThemeImport } from "../../theme/portableThemeService.js";
import { BUTTON_SKIN_SECTION_ORDER } from "../../button/skins/buttonSkinFormat.js";
import { getEmbeddedButtonSkinFamilySources } from "../../button/skins/buttonSkinFamily.js";
import { buttonStateDocumentsEqual, reconcileBundledProgramSources } from "../../button/state/ButtonStateRepository.js";
import { createButtonStateDocument } from "../../button/state/buttonDefaults.js";
import { reconcileProgramPanelOwners } from "../../button/state/panelOwnerButtonOperations.js";
import { validateButtonStateDocument } from "../../button/state/buttonStateValidation.js";
import { buildPanelRailOwnerEntries, panelRailOwnerSurfaceBounds } from "../main/mainLayout.js";
import type { ProgramSetupPresentation } from "../../lib/programRails.js";

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

/** Discovery creates these untouched owners before a Program is installed. */
function hasOnlyDefaultPanelScaffold(document: ButtonStateDocument, programName: string, ownerIds: string[]): boolean {
  const owners = ownerIds.map((id) => document.buttons[id]);
  if (!owners.length || owners.some((owner) => owner.role !== "panel-owner" ||
    typeof owner.metadata.panelName !== "string" || !owner.metadata.panelName.trim())) return false;
  const ids = new Set(ownerIds);
  const placements = Object.values(document.placements).filter((placement) => ids.has(placement.buttonId));
  if (placements.length !== owners.length || new Set(placements.map((placement) => placement.surfaceId)).size !== 1) return false;
  const surface = document.surfaces[placements[0].surfaceId];
  if (!surface || surface.placementIds.length !== owners.length || surface.placementIds.some((id) =>
    !document.placements[id] || !ids.has(document.placements[id].buttonId))) return false;
  const matches = (value: unknown) => typeof value === "string" && value.toLowerCase() === programName.toLowerCase();
  if (Object.values(document.popoutUnits).some((unit) => unit.ownerButtonId && ids.has(unit.ownerButtonId)) ||
    Object.values(document.fanSetups).some((fan) => ids.has(fan.panelOwnerButtonId) || matches(fan.programName))) return false;
  const expected = createButtonStateDocument();
  expected.settings = structuredClone(document.settings);
  const scaffoldProgram = String(owners[0].metadata.programName);
  const panels = surface.placementIds.map((id) => String(document.buttons[document.placements[id].buttonId].metadata.panelName));
  reconcileProgramPanelOwners(expected, { programName: scaffoldProgram, panels: buildPanelRailOwnerEntries(panels),
    surfaceBounds: panelRailOwnerSurfaceBounds, removeStaleOwners: false });
  const actual = structuredClone(expected);
  actual.buttons = Object.fromEntries(owners.map((owner) => [owner.id, owner]));
  actual.placements = Object.fromEntries(placements.map((placement) => [placement.id, placement]));
  actual.surfaces[surface.id] = surface;
  for (const id of new Set([...owners.map((owner) => owner.defaultSkinId), ...placements.map((placement) => placement.skinOverrideId).filter((id): id is string => Boolean(id))])) {
    if (!expected.skins[id] || !document.skins[id]) return false;
    actual.skins[id] = document.skins[id];
  }
  for (const placement of placements) {
    if (document.themeOverrides?.[placement.id] || document.programPopoutColorOverrides?.[placement.id] ||
      document.programPopoutThemeLocks?.[placement.id]) return false;
  }
  return buttonStateDocumentsEqual(actual, expected);
}

/** A new Program may replace discovery scaffolding, never saved user presentation. */
export function requireNewProgramAppearance(document: ButtonStateDocument, programName: string): void {
  const matches = (value: unknown) => typeof value === "string" && value.toLowerCase() === programName.toLowerCase();
  const owners = Object.values(document.buttons).filter((button) =>
    matches(button.sourceIdentity?.displayProgramName) || matches(button.executionTarget?.kind === "core-action"
      ? undefined : button.executionTarget?.programName) || matches(button.metadata.programName));
  if ((owners.length > 0 && !hasOnlyDefaultPanelScaffold(document, programName, owners.map((owner) => owner.id))) ||
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
  document: ButtonStateDocument, programName: string, value: unknown,
  descriptors?: readonly ThemeToolDescriptor[]
): Promise<ButtonStateDocument> {
  const target = { kind: "program" as const, programName, panelName: null };
  const theme = decodeProgramAppearance(value);
  if (!themeTargetsMatch(theme.target, target) ||
    theme.target.kind !== "program" || theme.target.panelName !== null || theme.target.area !== undefined) {
    throw new Error("The packaged appearance is not a valid whole-Program portable theme.");
  }
  const prepared = await preparePortableThemeImport({
    document, theme, target, descriptors: descriptors ?? await getThemeToolDescriptors(target), allowSourceInstallation: false,
    reconcileAdditionalPanelPlacements: true
  });
  return prepared.document;
}

/** Preview and commit use the same in-memory construction, without installing sources. */
export async function buildProgramSetupDocument(
  base: ButtonStateDocument,
  setup: ProgramSetupPresentation,
  applyTheme: typeof applyProgramDefaultTheme = applyProgramDefaultTheme
): Promise<{ document: ButtonStateDocument; expectedButtonIds: string[] }> {
  const name = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase("en");
  const theme = setup.defaultTheme ? decodeProgramAppearance(setup.defaultTheme) : null;
  if (theme) requireNewProgramAppearance(base, setup.programName);
  const themedOwners = new Set(theme ? setup.themeDescriptors.filter((descriptor) =>
    theme.dependencies.some((dependency) => name(dependency.programId) === name(descriptor.programId) &&
      dependency.sourceId === descriptor.sourceId && dependency.sourceVersion === descriptor.sourceVersion &&
      dependency.importKind === descriptor.importKind)).map((descriptor) => descriptor.ownerButtonId) : []);
  const themedPanels = new Set(theme ? Object.values(theme.references).flatMap((reference) =>
    reference.kind === "panel" && name(reference.programName) === name(setup.programName) ? [name(reference.panelName)] : []) : []);
  const entries = buildPanelRailOwnerEntries(setup.panels);
  if (theme && [...themedPanels].some((panel) => !entries.some((entry) => name(entry.panelName) === panel))) {
    throw new Error("The packaged appearance requires a panel that is not selected.");
  }
  const primary = theme ? setup.descriptors.filter((descriptor) => themedOwners.has(String(descriptor.ownerButtonId))) : setup.descriptors;
  const extras = theme ? setup.descriptors.filter((descriptor) => !themedOwners.has(String(descriptor.ownerButtonId))) : [];
  let document = reconcileBundledProgramSources(base, primary);
  const reconcilePanels = (panels: typeof entries) => reconcileProgramPanelOwners(document, {
    programName: setup.programName, panels, surfaceBounds: panelRailOwnerSurfaceBounds, removeStaleOwners: false
  });
  const owners = reconcilePanels(theme ? entries.filter((entry) => themedPanels.has(name(entry.panelName))) : entries).owners;
  if (theme) {
    document = await applyTheme(document, setup.programName, theme, setup.themeDescriptors);
    // Additional selected tools have no saved theme coordinates. Allocate them
    // after the authored controls and grow the panel as needed for the selection.
    if (extras.length) document = reconcileBundledProgramSources(document, extras);
    owners.push(...reconcilePanels(entries.filter((entry) => !themedPanels.has(name(entry.panelName)))).owners);
  }
  const expectedButtonIds = [
    ...setup.descriptors.map((descriptor) => String(descriptor.ownerButtonId ?? "")),
    ...owners.map((owner) => owner.buttonId)
  ].filter(Boolean);
  if (theme) stampProgramAppearanceReceipt(document, expectedButtonIds, setup.defaultThemeReceipt);
  const validation = validateButtonStateDocument(document);
  if (!validation.valid) throw new Error(`Program setup layout is invalid: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  return { document, expectedButtonIds };
}
