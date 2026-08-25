import {
  buildButtonsSurfaceButtons,
  page,
  staticButtons,
  type ButtonRecord as MainPageButton
} from "../../pages/main/mainLayout.js";
import type {
  ButtonPlacement,
  ButtonRecord,
  ButtonStateDocument,
  ButtonSurface
} from "../types.js";

export const FLOWCELL_MAIN_PAGE_PROGRAM = "FlowCell Main Page";

export const FLOWCELL_MAIN_PAGE_SECTIONS = [
  "Program Rail",
  "Panel Rail",
  "Button Section Rail",
  "Header Buttons"
] as const;

export type FlowCellMainPageSection = typeof FLOWCELL_MAIN_PAGE_SECTIONS[number];

const SURFACE_PREFIX = "surface-flowcell-main-page-";
const BUTTON_PREFIX = "button-flowcell-main-page-";
const PLACEMENT_PREFIX = "placement-flowcell-main-page-";

function normalizeName(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en");
}

function stableIdSegment(value: string): string {
  return Array.from(normalizeName(value))
    .map((character) => character.codePointAt(0)?.toString(16) ?? "0")
    .join("-") || "item";
}

function slug(value: string): string {
  return normalizeName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function definition(
  section: FlowCellMainPageSection,
  key: string,
  button: MainPageButton,
  label = button.label
): { section: FlowCellMainPageSection; key: string; button: MainPageButton; label: string } {
  return { section, key, button, label };
}

const programAdd: MainPageButton = {
  id: "program-add-button",
  railId: "program-rail",
  x: 21.039583,
  y: 646.022806,
  width: 131.568346,
  height: 37.294964,
  label: "Add Program",
  tooltip: "Add a program by selecting its executable.",
  actionId: "add-program-folder"
};

const panelAdd: MainPageButton = {
  ...programAdd,
  id: "panel-add-button",
  railId: "panel-rail",
  x: 199.226633,
  y: 646.022806,
  label: "Add Panel",
  tooltip: "Add a panel folder to the selected program.",
  actionId: "add-panel-folder"
};

const fixedDefinitions = [
  definition("Program Rail", "program-add", programAdd),
  definition("Panel Rail", "panel-add", panelAdd),
  ...buildButtonsSurfaceButtons([]).map((button) =>
    definition("Button Section Rail", button.id, button)
  ),
  ...staticButtons.map((button) =>
    definition("Header Buttons", button.id, button)
  )
];

function surfaceId(section: FlowCellMainPageSection): string {
  return `${SURFACE_PREFIX}${slug(section)}`;
}

function buttonId(key: string): string {
  return `${BUTTON_PREFIX}${slug(key)}`;
}

function placementId(key: string): string {
  return `${PLACEMENT_PREFIX}${slug(key)}`;
}

function programControlKey(programName: string): string {
  return `program-${stableIdSegment(programName)}`;
}

function programDefinition(programName: string, index: number) {
  const row = index % 10;
  const column = Math.floor(index / 10);
  return definition("Program Rail", programControlKey(programName), {
    id: `program-button-${index + 1}`,
    railId: "program-rail",
    folderName: programName,
    x: 21.039583 + column * 146.568346,
    y: 125.758993 + row * 49.726618,
    width: 131.568346,
    height: 37.294964,
    label: programName,
    tooltip: `Select ${programName}.`,
    actionId: "select-program-folder"
  });
}

export function isFlowCellMainPageProgram(programName: string): boolean {
  return normalizeName(programName) === normalizeName(FLOWCELL_MAIN_PAGE_PROGRAM);
}

export function flowCellMainPageSurfaceId(section: string): string | null {
  const matched = FLOWCELL_MAIN_PAGE_SECTIONS.find(
    (candidate) => normalizeName(candidate) === normalizeName(section)
  );
  return matched ? surfaceId(matched) : null;
}

export function mainPageControlKey(button: MainPageButton): string | null {
  if (button.groupId === "top-left-actions" || button.groupId === "top-right-actions") {
    return button.id;
  }
  if (button.actionId === "add-program-folder") return "program-add";
  if (button.actionId === "add-panel-folder") return "panel-add";
  if (button.railId === "buttons-rail" && !button.scriptFileName) return button.id;
  return null;
}

function removePlacement(document: ButtonStateDocument, id: string): void {
  const placement = document.placements[id];
  if (!placement) return;
  const surface = document.surfaces[placement.surfaceId];
  if (surface) {
    surface.placementIds = surface.placementIds.filter((candidate) => candidate !== id);
  }
  delete document.placements[id];
}

function removeButton(document: ButtonStateDocument, id: string): void {
  for (const placement of Object.values(document.placements)) {
    if (placement.buttonId === id) removePlacement(document, placement.id);
  }
  delete document.buttons[id];
}

function isManagedMainPageButton(button: ButtonRecord): boolean {
  return button.metadata.mainPageProgram === FLOWCELL_MAIN_PAGE_PROGRAM &&
    (button.metadata.mainPageControl === true || button.id.startsWith(BUTTON_PREFIX));
}

function mainPageProgramName(button: ButtonRecord): string {
  return typeof button.metadata.mainPageProgramName === "string"
    ? button.metadata.mainPageProgramName.trim()
    : "";
}

function findProgramButton(
  document: ButtonStateDocument,
  programName: string
): ButtonRecord | null {
  return Object.values(document.buttons)
    .filter((button) =>
      isManagedMainPageButton(button) &&
      normalizeName(mainPageProgramName(button)) === normalizeName(programName)
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

function placementForButtonOnSurface(
  document: ButtonStateDocument,
  ownerButtonId: string,
  ownerSurfaceId: string
): ButtonPlacement | null {
  return Object.values(document.placements)
    .filter((placement) =>
      placement.buttonId === ownerButtonId &&
      placement.surfaceId === ownerSurfaceId
    )
    .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

function definitionRect(entry: { button: MainPageButton }) {
  return {
    x: entry.button.x,
    y: entry.button.y,
    width: entry.button.width,
    height: entry.button.height
  };
}

function metadataRect(value: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (![candidate.x, candidate.y, candidate.width, candidate.height].every(
    (field) => typeof field === "number" && Number.isFinite(field)
  )) {
    return null;
  }
  return {
    x: candidate.x as number,
    y: candidate.y as number,
    width: candidate.width as number,
    height: candidate.height as number
  };
}

function rectMatches(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height;
}

export function ensureFlowCellMainPageButtons(
  document: ButtonStateDocument,
  programNames: readonly string[],
  options: { removeLegacyTemplates?: boolean } = {}
): boolean {
  let changed = false;
  for (const section of FLOWCELL_MAIN_PAGE_SECTIONS) {
    const id = surfaceId(section);
    if (!document.surfaces[id]) {
      const surface: ButtonSurface = {
        id,
        name: section,
        kind: "main",
        width: page.width,
        height: page.height,
        placementIds: [],
        visualOverflowAllowance: 24,
        uniformButtonSize: null
      };
      document.surfaces[id] = surface;
      changed = true;
    }
  }

  // Discovery can be incomplete while a folder is unavailable. Only the
  // canonical program-removal transaction may delete a program presentation.
  if (options.removeLegacyTemplates !== false) {
    for (const button of Object.values(document.buttons)) {
      if (!isManagedMainPageButton(button)) continue;
      const key = typeof button.metadata.mainPageControlKey === "string"
        ? button.metadata.mainPageControlKey
        : "";
      const legacyTemplate = key === "program-row" || key === "panel-row";
      if (!legacyTemplate) continue;
      removeButton(document, button.id);
      changed = true;
    }
  }

  const definitions = [
    ...programNames.map(programDefinition),
    ...fixedDefinitions
  ];
  const programSurface = document.surfaces[surfaceId("Program Rail")];
  const requiredProgramSurfaceWidth = Math.max(
    page.width,
    ...definitions
      .filter((entry) => entry.section === "Program Rail")
      .map((entry) => entry.button.x + entry.button.width + document.settings.defaultSurfacePadding)
  );
  if (programSurface.width < requiredProgramSurfaceWidth) {
    programSurface.width = requiredProgramSurfaceWidth;
    changed = true;
  }
  for (const entry of definitions) {
    const preferredButtonId = buttonId(entry.key);
    const existingProgramButton = entry.button.folderName
      ? findProgramButton(document, entry.button.folderName)
      : null;
    const id = existingProgramButton?.id ?? preferredButtonId;
    if (!document.buttons[id]) {
      const record: ButtonRecord = {
        id,
        role: "single-script",
        sourceIdentity: null,
        label: entry.label,
        tooltip: entry.button.tooltip ?? "",
        executionTarget: null,
        defaultSkinId: document.settings.defaultSkinId,
        defaultTextFitMode: "shrink-and-stack",
        disabled: false,
        activationAnimation: null,
        activationBehavior: null,
        toolSetParentId: null,
        toolSetBehavior: null,
        metadata: {
          mainPageControl: true,
          mainPageProgram: FLOWCELL_MAIN_PAGE_PROGRAM,
          mainPageSection: entry.section,
          mainPageControlKey: entry.key,
          mainPageDefaultLabel: entry.label,
          mainPageDefaultTooltip: entry.button.tooltip ?? "",
          mainPageDefaultRect: definitionRect(entry),
          ...(entry.button.folderName
            ? { mainPageProgramName: entry.button.folderName }
            : {})
        }
      };
      document.buttons[id] = record;
      changed = true;
    } else if (
      isManagedMainPageButton(document.buttons[id]) &&
      document.buttons[id].role === "panel-owner"
    ) {
      document.buttons[id].role = "single-script";
      changed = true;
    }
    const existingButton = document.buttons[id];
    if (
      isManagedMainPageButton(existingButton) &&
      (
        typeof existingButton.metadata.mainPageDefaultLabel !== "string" ||
        typeof existingButton.metadata.mainPageDefaultTooltip !== "string" ||
        existingButton.metadata.mainPageControl !== true
      )
    ) {
      existingButton.metadata = {
        ...existingButton.metadata,
        mainPageControl: true,
        mainPageDefaultLabel: entry.label,
        mainPageDefaultTooltip: entry.button.tooltip ?? ""
      };
      changed = true;
    }
    const targetSurfaceId = surfaceId(entry.section);
    const existingPlacement = placementForButtonOnSurface(document, id, targetSurfaceId);
    const targetPlacementId = existingPlacement?.id ?? placementId(entry.key);
    if (!document.placements[targetPlacementId]) {
      const placement: ButtonPlacement = {
        id: targetPlacementId,
        buttonId: id,
        surfaceId: targetSurfaceId,
        x: entry.button.x,
        y: entry.button.y,
        width: entry.button.width,
        height: entry.button.height,
        zIndex: document.surfaces[targetSurfaceId].placementIds.length,
        skinOverrideId: null,
        textFitMode: "shrink-and-stack",
        textAlignment: "skin",
        textOffsetX: 0,
        textOffsetY: 0,
        minimumFontSize: document.settings.defaultMinimumFontSize,
        textSizeOverride: null,
        allowLabelResize: false,
        matchHitboxToSkin: true,
        allowStretching: false,
        highlightOnHover: false,
        activationCycle: null,
        visualStateMap: null,
        resizeAnchor: "top-left"
      };
      document.placements[targetPlacementId] = placement;
      document.surfaces[targetSurfaceId].placementIds.push(targetPlacementId);
      changed = true;
    } else if (!document.surfaces[targetSurfaceId].placementIds.includes(targetPlacementId)) {
      document.surfaces[targetSurfaceId].placementIds.push(targetPlacementId);
      changed = true;
    }
    const placement = document.placements[targetPlacementId];
    const previousDefaultRect = metadataRect(existingButton.metadata.mainPageDefaultRect);
    const nextDefaultRect = definitionRect(entry);
    if (
      placement &&
      previousDefaultRect &&
      rectMatches(placement, previousDefaultRect) &&
      !rectMatches(placement, nextDefaultRect)
    ) {
      Object.assign(placement, nextDefaultRect);
      changed = true;
    }
    if (!previousDefaultRect || !rectMatches(previousDefaultRect, nextDefaultRect)) {
      existingButton.metadata = {
        ...existingButton.metadata,
        mainPageDefaultRect: nextDefaultRect
      };
      changed = true;
    }
  }
  return changed;
}

export function setFlowCellMainPageProgramButtonLabel(
  document: ButtonStateDocument,
  programName: string,
  label: string
): boolean {
  const button = findProgramButton(document, programName);
  const nextLabel = label.trim();
  if (!button || !nextLabel || button.label === nextLabel) return false;
  button.label = nextLabel;
  return true;
}

export function renameFlowCellMainPageProgramButton(
  document: ButtonStateDocument,
  currentProgramName: string,
  nextProgramName: string
): boolean {
  const button = findProgramButton(document, currentProgramName);
  if (!button) return false;
  let changed = false;
  if (
    normalizeName(button.label) === normalizeName(currentProgramName) &&
    button.label !== nextProgramName
  ) {
    button.label = nextProgramName;
    changed = true;
  }
  if (
    normalizeName(button.tooltip) === normalizeName(`Select ${currentProgramName}.`) &&
    button.tooltip !== `Select ${nextProgramName}.`
  ) {
    button.tooltip = `Select ${nextProgramName}.`;
    changed = true;
  }
  if (
    mainPageProgramName(button) !== nextProgramName ||
    button.metadata.mainPageControlKey !== programControlKey(nextProgramName)
  ) {
    button.metadata = {
      ...button.metadata,
      mainPageProgramName: nextProgramName,
      mainPageControlKey: programControlKey(nextProgramName),
      mainPageDefaultLabel: nextProgramName,
      mainPageDefaultTooltip: `Select ${nextProgramName}.`
    };
    changed = true;
  }
  return changed;
}

export function removeFlowCellMainPageProgramButton(
  document: ButtonStateDocument,
  programName: string
): string | null {
  const button = findProgramButton(document, programName);
  if (!button) return null;
  removeButton(document, button.id);
  return button.id;
}

export function resolveFlowCellMainPagePresentation(
  document: ButtonStateDocument | null,
  control: MainPageButton
) {
  if (
    document &&
    control.actionId === "select-program-folder" &&
    control.folderName
  ) {
    const candidate = findProgramButton(document, control.folderName);
    const placement = candidate
      ? Object.values(document.placements).find((entry) =>
          entry.buttonId === candidate.id &&
          document.surfaces[entry.surfaceId]?.id === surfaceId("Program Rail")
        )
      : null;
    const skin = candidate && placement
      ? document.skins[placement.skinOverrideId ?? candidate.defaultSkinId]
      : null;
    if (candidate && placement && skin) return { button: candidate, placement, skin };
  }
  const key = mainPageControlKey(control);
  if (!document || !key) return null;
  const button = document.buttons[buttonId(key)];
  const placement = document.placements[placementId(key)];
  const skin = button && placement
    ? document.skins[placement.skinOverrideId ?? button.defaultSkinId]
    : null;
  return button && placement && skin ? { button, placement, skin } : null;
}

export function resolveFlowCellMainPageButtonLayout(
  document: ButtonStateDocument | null,
  control: MainPageButton
): MainPageButton {
  const presentation = resolveFlowCellMainPagePresentation(document, control);
  if (!presentation) return control;
  return {
    ...control,
    x: presentation.placement.x,
    y: presentation.placement.y,
    width: presentation.placement.width,
    height: presentation.placement.height
  };
}
