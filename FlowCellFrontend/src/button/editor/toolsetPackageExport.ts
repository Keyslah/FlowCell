import type { ButtonPlacement, ButtonSkin, ButtonStateDocument, ToolSetButtonPopoutUnit } from "../types.js";
import { resolveButtonPlacementPresentation } from "../state/buttonPresentation.js";
import { assignInstalledToolSetSkins, parseInstalledToolSetSkin } from "../state/installedToolSetSkins.js";
import { cloneButtonDocument } from "../state/buttonDefaults.js";
import { serializeButtonSkinSections } from "../skins/buttonSkinFormat.js";
import {
  buttonSkinFamilyFromPath,
  buttonSkinFamilyVariantPath,
  getEmbeddedButtonSkinFamilySources,
  nearestButtonSkinFamilyPath,
  resolveEmbeddedButtonSkinFamilySource
} from "../skins/buttonSkinFamily.js";

export interface ToolsetSkinLibrary {
  directory: string;
  paths: string[];
  read(path: string): Promise<string>;
}

type SkinSource = { source: string; variants?: Record<string, string> };

function exportRect({ x, y, width, height, zIndex }: ButtonPlacement | ToolSetButtonPopoutUnit["fields"][number]) {
  return { x, y, width, height, zIndex };
}

function createSkinSourceCapture(
  document: ButtonStateDocument,
  library: () => Promise<ToolsetSkinLibrary>
) {
  const localFamilies = new Map<string, Promise<Record<string, string>>>();
  return async (placement: ButtonPlacement) => {
    const button = document.buttons[placement.buttonId];
    const skin: ButtonSkin | undefined = document.skins[placement.skinOverrideId ?? button.defaultSkinId];
    if (!skin) throw new Error(`The assigned skin for '${button.label}' is missing.`);
    const label = resolveButtonPlacementPresentation(button, placement).label;
    const embeddedVariant = resolveEmbeddedButtonSkinFamilySource(skin, placement.id, label);
    let variants = getEmbeddedButtonSkinFamilySources(skin);
    let source = embeddedVariant?.source ?? serializeButtonSkinSections(skin);
    let variantKey = embeddedVariant ? String(embeddedVariant.count) : "base";

    if (typeof skin.metadata.buttonSkinFamily === "string") {
      const files = await library();
      const name = skin.metadata.buttonSkinFamily.toLowerCase();
      if (!localFamilies.has(name)) {
        localFamilies.set(name, Promise.all(files.paths.flatMap((path) => {
          const variant = buttonSkinFamilyFromPath(path, files.directory);
          return variant?.name.toLowerCase() === name
            ? [files.read(path).then((text) => [String(variant.count), text] as const)]
            : [];
        })).then(Object.fromEntries));
      }
      variants = await localFamilies.get(name)!;
      const relative = buttonSkinFamilyVariantPath(skin, placement.id, label);
      if (relative) {
        const requested = `${files.directory}/${relative}`;
        const matched = files.paths.find((path) => path.replaceAll("\\", "/").toLowerCase() ===
          requested.replaceAll("\\", "/").toLowerCase()) ?? nearestButtonSkinFamilyPath(files.paths, requested, files.directory);
        const variant = matched && buttonSkinFamilyFromPath(matched, files.directory);
        if (variant && variants[String(variant.count)] !== undefined) {
          variantKey = String(variant.count);
          source = variants[variantKey];
        }
      }
    }

    return { skin, source, variants, variantKey };
  };
}

export async function embedLocalButtonSkinFamilies(
  document: ButtonStateDocument,
  placementIds: readonly string[],
  library: () => Promise<ToolsetSkinLibrary>
): Promise<ButtonStateDocument> {
  const next = cloneButtonDocument(document);
  const captureSource = createSkinSourceCapture(document, library);
  const skins: Record<string, SkinSource> = {};
  const keys = new Map<string, string>();
  const targets: { placement: ButtonPlacement; skinKey: string }[] = [];
  for (const id of placementIds) {
    const placement = document.placements[id];
    const button = placement && document.buttons[placement.buttonId];
    const skin = button && document.skins[placement.skinOverrideId ?? button.defaultSkinId];
    if (!skin || typeof skin.metadata.buttonSkinFamily !== "string") continue;
    const captured = await captureSource(placement);
    const identity = JSON.stringify([skin.id, captured.variantKey]);
    let key = keys.get(identity);
    if (!key) {
      key = `skin-${keys.size + 1}`;
      keys.set(identity, key);
      skins[key] = { source: captured.source, ...(captured.variants ? { variants: captured.variants } : {}) };
    }
    targets.push({ placement: next.placements[id], skinKey: key });
  }
  if (targets.length) assignInstalledToolSetSkins(next, { skins }, targets);
  return next;
}

export async function captureToolsetPackage(
  document: ButtonStateDocument,
  unit: ToolSetButtonPopoutUnit,
  library: () => Promise<ToolsetSkinLibrary>
) {
  const owner = document.buttons[unit.ownerButtonId];
  const identity = owner?.sourceIdentity;
  const surface = document.surfaces[unit.surfaceId];
  if (!identity || !surface) throw new Error("Choose a tool set with an installed source and pop-out surface.");

  const ownerPlacements = Object.values(document.placements).filter((placement) =>
    placement.buttonId === owner.id && document.surfaces[placement.surfaceId]?.kind === "panel"
  );
  const ownerPlacement = ownerPlacements.find((placement) => placement.id === unit.ownerPlacementId)
    ?? (ownerPlacements.length === 1 ? ownerPlacements[0] : undefined);
  if (!ownerPlacement) throw new Error("The installed tool set must have one identifiable owner placement in its panel.");

  const skins: Record<string, SkinSource> = {};
  const skinKeys = new Map<string, string>();
  const captureSource = createSkinSourceCapture(document, library);
  const captureSkin = async (placement: ButtonPlacement) => {
    const { skin, source, variants, variantKey } = await captureSource(placement);
    const identityKey = JSON.stringify([skin.id, variantKey]);
    const existing = skinKeys.get(identityKey);
    if (existing) return existing;
    const name = skin.name.replace(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
    const key = `skin-${skinKeys.size + 1}${name ? `-${name}` : ""}`;
    skinKeys.set(identityKey, key);
    skins[key] = { source, ...(variants && Object.keys(variants).length ? { variants } : {}) };
    return key;
  };

  const ownerSkin = await captureSkin(ownerPlacement);
  const ownerPresentation = resolveButtonPlacementPresentation(owner, ownerPlacement);
  const children: Record<string, string> = Object.create(null);
  const childPresentation: Record<string, { label: string; tooltip: string }> = Object.create(null);
  const placements: Record<string, ReturnType<typeof exportRect>> = Object.create(null);
  for (const id of unit.childPlacementIds) {
    const placement = document.placements[id];
    const button = placement && document.buttons[placement.buttonId];
    const metadataSlot = button?.metadata.toolSetSlot;
    const slot = typeof metadataSlot === "string" && metadataSlot
      ? metadataSlot
      : button?.executionTarget?.kind === "tool-set-action" ? button.executionTarget.command : null;
    if (!placement || !button || !slot || slot in children) {
      throw new Error("Each tool-set child must have a unique installed command slot.");
    }
    children[slot] = await captureSkin(placement);
    const presentation = resolveButtonPlacementPresentation(button, placement);
    childPresentation[slot] = { label: presentation.label, tooltip: presentation.tooltip };
    placements[slot] = exportRect(placement);
  }

  const validated = new Set<string>();
  for (const [key, skin] of Object.entries(skins)) {
    for (const source of [skin.source, ...Object.values(skin.variants ?? {})]) {
      if (!validated.has(source)) parseInstalledToolSetSkin(source, key);
      validated.add(source);
    }
  }

  return {
    programName: identity.displayProgramName,
    panelName: identity.displayPanelName,
    ownerButtonId: owner.id,
    appearance: { skins, owner: ownerSkin, children },
    presentation: { owner: { label: ownerPresentation.label, tooltip: ownerPresentation.tooltip }, children: childPresentation },
    layout: {
      width: surface.width,
      height: surface.height,
      placements,
      fields: Object.fromEntries(unit.fields.map((field) => [field.id, exportRect(field)]))
    }
  };
}
