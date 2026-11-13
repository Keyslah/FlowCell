import type { ButtonPlacement, ButtonRecord, ButtonStateDocument } from "../types.js";
import {
  CHIPPED_CONCRETE_BUTTON_SKIN_ID,
  getChippedConcreteButtonSize
} from "../skins/chippedConcreteButtonSkin.js";
import { PANEL_BUTTON_GAP, panelButtonViewport } from "../../pages/main/mainLayout.js";
import { resolveButtonPlacementPresentation } from "./buttonPresentation.js";
import { DEFAULT_BUTTON_SKIN, DEFAULT_BUTTON_SKIN_ID, getDefaultButtonSize } from "../skins/defaultButtonSkin.js";
import { buttonSpacingPixelsFromMillimeters } from "../geometry/buttonGeometry.js";

/** Match the bundled family's visible core, retaining the requested row height. */
export function defaultPanelButtonSize(
  document: ButtonStateDocument,
  button: ButtonRecord,
  placement?: ButtonPlacement
): { width: number; height: number } {
  const width = placement?.width ?? 160;
  const height = placement?.height ?? 44;
  // A new Main panel occurrence receives Concrete locally; existing occurrences
  // (including neutral Pop-outs) use their own effective assignment.
  const skinId = placement ? placement.skinOverrideId ?? button.defaultSkinId
    : button.defaultSkinId === DEFAULT_BUTTON_SKIN_ID ? CHIPPED_CONCRETE_BUTTON_SKIN_ID : button.defaultSkinId;
  if (placement?.matchHitboxToSkin && document.skins[skinId]?.structure === DEFAULT_BUTTON_SKIN.structure &&
      !["main", "panel"].includes(document.surfaces[placement.surfaceId]?.kind ?? "")) {
    const presentation = resolveButtonPlacementPresentation(button, placement);
    return getDefaultButtonSize(presentation.label, height, width, placement.textSizeOverride ?? undefined);
  }
  if (skinId !== CHIPPED_CONCRETE_BUTTON_SKIN_ID) return { width, height };
  const presentation = placement ? resolveButtonPlacementPresentation(button, placement) : button;
  const natural = getChippedConcreteButtonSize(presentation.label, undefined, placement?.textSizeOverride ?? undefined);
  return { width: natural.width * height / natural.height, height };
}

/** Main keeps its key spacing; Pop-out defaults pack each Button's individual size tightly. */
export function arrangeDefaultPanelButtons(
  document: ButtonStateDocument,
  surfaceId: string,
  options: { maximumColumns?: number; maximumWidth?: number } = {}
): void {
  const surface = document.surfaces[surfaceId];
  if (!surface || (surface.kind !== "panel" && surface.kind !== "regular-popout")) {
    throw new Error("Select a panel or regular Pop-out before loading its grid default.");
  }
  const padding = document.settings.defaultSurfacePadding;
  const maximumWidth = options.maximumWidth ?? (surface.kind === "panel"
    ? panelButtonViewport().maxButtonWidth
    : Number.POSITIVE_INFINITY);
  const maximumColumns = options.maximumColumns ?? (surface.kind === "regular-popout" ? 4 : Number.POSITIVE_INFINITY);
  const gap = surface.kind === "panel" ? PANEL_BUTTON_GAP
    : buttonSpacingPixelsFromMillimeters(document.settings.buttonSpacingMm);
  let x = padding;
  let y = padding;
  let rowHeight = 0;
  let column = 0;
  let requiredWidth = padding * 2;
  surface.placementIds.forEach((placementId, index) => {
    const placement = document.placements[placementId];
    const button = placement && document.buttons[placement.buttonId];
    if (!placement || !button) return;
    const size = surface.uniformButtonSize ?? defaultPanelButtonSize(document, button, placement);
    if (column > 0 && (column >= maximumColumns || x + size.width > padding + maximumWidth)) {
      x = padding;
      y += rowHeight + gap;
      rowHeight = 0;
      column = 0;
    }
    Object.assign(placement, size, { x, y, zIndex: index });
    requiredWidth = Math.max(requiredWidth, x + size.width + padding);
    rowHeight = Math.max(rowHeight, size.height);
    x += size.width + gap;
    column += 1;
  });
  const requiredHeight = y + rowHeight + padding;
  if (surface.kind === "panel") {
    surface.width = Math.max(requiredWidth, maximumWidth + padding * 2);
    surface.height = Math.max(surface.height, requiredHeight);
  } else {
    surface.width = requiredWidth;
    surface.height = requiredHeight;
  }
}
