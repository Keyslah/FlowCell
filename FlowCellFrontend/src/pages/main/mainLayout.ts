import type { PanelButtonEventsRecord } from "../../lib/programRails.js";
import { buttonRectsOverlap, inferButtonPlacementRows } from "../../button/geometry/buttonGeometry.js";

export type PageRecord = {
  id: string;
  width: number;
  height: number;
  viewBox: string;
};

export type RailRecord = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  strokeWidth: number;
  border: string;
  background: string;
};

export type ButtonRecord = {
  id: string;
  railId?: string;
  groupId?: string;
  folderName?: string;
  scriptFileName?: string;
  macroId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  label: string;
  tooltip?: string;
  actionId: string;
  bridgeAction?: string;
  events?: PanelButtonEventsRecord;
  allowRename?: boolean;
  isSelected?: boolean;
  disabled?: boolean;
};

export const page: PageRecord = {
  id: "main-page",
  width: 1225,
  height: 721,
  viewBox: "0 0 1225 721"
};

/** The main window's frame: the page plus a little room around it, so a page-shaped base slab
 * (Chipped Concrete) reaches just past the rails' shadows and still has room for its own shadow. Every rail and Button keeps the page's
 * own coordinates: the page sits centered in the frame, or at MAIN_PAGE_BASE_OFFSET under a base
 * slab (its shadows fall right and down, so the room goes there). */
export const pageFrame: PageRecord = {
  id: "main-page-frame",
  width: 1276,
  height: 762,
  viewBox: "0 0 1276 762"
};

export const MAIN_PAGE_BASE_OFFSET = { left: 10, top: 0 } as const;

export const rails: RailRecord[] = [
  {
    id: "program-rail",
    name: "Program",
    x: 5.500015,
    y: 108.353741,
    width: 162.647482,
    height: 585.841727,
    radius: 15.539568,
    strokeWidth: 1,
    border: "transparent",
    background: "transparent"
  },
  {
    id: "panel-rail",
    name: "Panel",
    x: 183.687065,
    y: 108.353741,
    width: 162.647482,
    height: 585.841727,
    radius: 15.539568,
    strokeWidth: 1,
    border: "transparent",
    background: "transparent"
  },
  {
    id: "buttons-rail",
    name: "Buttons",
    x: 369.125914,
    y: 108.353741,
    width: 630.906475,
    height: 585.841727,
    radius: 15.539568,
    strokeWidth: 1,
    border: "transparent",
    background: "transparent"
  },
  {
    id: "info-rail",
    name: "Info",
    x: 1017.989209,
    y: 108.353741,
    width: 198.474835,
    height: 585.841727,
    radius: 15.539568,
    strokeWidth: 1,
    border: "transparent",
    background: "transparent"
  }
];

/** How far a rail's slab layer reaches past the rail on every side: room for a rendered slab's
 * front edge, broken chunks and shadow (see RailSurface and themeRuntime). */
export const RAIL_SLAB_BLEED_PX = 72;

type FolderRailDefinition = {
  railId: string;
  listButtonIdPrefix: string;
  listActionId: string;
  footerButtonId: string;
  footerActionId: string;
  footerLabel: string;
  firstX: number;
  otherX: number;
  footerX: number;
};

const railButtonGeometry = {
  firstY: 125.758993,
  stepY: 49.726618,
  footerY: 646.022806,
  width: 131.568346,
  height: 37.294964,
  radius: 18.647463
} as const;

export type PanelRailOwnerEntry = {
  panelName: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export const panelRailOwnerSurfaceBounds = {
  width: page.width,
  height: page.height
} as const;

const programRailDefinition: FolderRailDefinition = {
  railId: "program-rail",
  listButtonIdPrefix: "program-button",
  listActionId: "select-program-folder",
  footerButtonId: "program-add-button",
  footerActionId: "add-program-folder",
  footerLabel: "Add Program",
  firstX: 21.039583,
  otherX: 21.039583,
  footerX: 21.039583
};

const panelRailDefinition: FolderRailDefinition = {
  railId: "panel-rail",
  listButtonIdPrefix: "panel-button",
  listActionId: "select-panel-folder",
  footerButtonId: "panel-add-button",
  footerActionId: "add-panel-folder",
  footerLabel: "Add Panel",
  firstX: 199.226633,
  otherX: 199.226633,
  footerX: 199.226633
};

const buttonsSurfaceGeometry = {
  addButtonX: 384.665482,
  addButtonY: 125.758993,
  fanControlsY: 177.039154,
  orderButtonY: 226.765772,
  scriptStartX: 384.665482,
  scriptStartY: 276.49239,
  stepX: 146.568346,
  stepY: 49.726618,
  width: 131.568346,
  height: 37.294964,
  radius: 18.647463
} as const;

export const buttonsSurfaceContentOrigin = {
  x: buttonsSurfaceGeometry.scriptStartX,
  y: buttonsSurfaceGeometry.scriptStartY
} as const;

export const PANEL_BUTTON_GAP = 8;

export function panelButtonViewport(addButtonX: number = buttonsSurfaceContentOrigin.x) {
  const rail = rails.find((entry) => entry.id === "buttons-rail")!;
  const left = Math.max(rail.x + rail.strokeWidth, Math.min(addButtonX, buttonsSurfaceContentOrigin.x));
  const top = buttonsSurfaceContentOrigin.y - PANEL_BUTTON_GAP;
  const height = rail.y + rail.height - top;
  const paddingLeft = left - rail.x;
  return {
    x: rail.x,
    y: top,
    width: rail.width,
    height,
    paddingLeft,
    // Leave room for the right inset and scrollbar, both one gap wide.
    maxButtonWidth: rail.width - paddingLeft - 2 * PANEL_BUTTON_GAP,
    maxButtonHeight: height - 2 * PANEL_BUTTON_GAP
  };
}

export const buttonsSurfacePopTypeControlGeometry = {
  x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 2,
  y: buttonsSurfaceGeometry.fanControlsY,
  width: buttonsSurfaceGeometry.width,
  height: buttonsSurfaceGeometry.height,
  radius: buttonsSurfaceGeometry.radius
} as const;

interface ButtonsSurfaceBuildOptions {
  selectedScriptFileNames?: readonly string[];
  fanSelectionCount?: number;
  deleteSelectionDisabled?: boolean;
  selectAllDisabled?: boolean;
  allSelectableScriptsSelected?: boolean;
  orderDisabled?: boolean;
  popDisabled?: boolean;
  fanDisabled?: boolean;
  fanOptionsDisabled?: boolean;
}

function equalsFolderName(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function getVisibleFolderRailCount(): number {
  return (
    Math.floor(
      (railButtonGeometry.footerY - railButtonGeometry.firstY - railButtonGeometry.height) /
        railButtonGeometry.stepY
    ) + 1
  );
}

function buildVisibleFolderRailNames(
  names: readonly string[],
  selectedName: string | null
): readonly string[] {
  const visibleCount = getVisibleFolderRailCount();
  const visibleNames = names.slice(0, visibleCount);
  if (!selectedName || visibleNames.some((name) => equalsFolderName(selectedName, name))) {
    return visibleNames;
  }

  const selectedVisibleName = names.find((name) => equalsFolderName(selectedName, name));
  if (!selectedVisibleName) {
    return visibleNames;
  }

  if (visibleNames.length < visibleCount) {
    return [...visibleNames, selectedVisibleName];
  }

  return [...visibleNames.slice(0, Math.max(visibleCount - 1, 0)), selectedVisibleName];
}

function buildFolderRailButtons(
  definition: FolderRailDefinition,
  names: readonly string[],
  selectedName: string | null
): ButtonRecord[] {
  const visibleNames = buildVisibleFolderRailNames(names, selectedName);
  const buttons: ButtonRecord[] = visibleNames.map((name, index) => ({
    id: `${definition.listButtonIdPrefix}-${index + 1}`,
    railId: definition.railId,
    folderName: name,
    x: index === 0 ? definition.firstX : definition.otherX,
    y: railButtonGeometry.firstY + railButtonGeometry.stepY * index,
    width: railButtonGeometry.width,
    height: railButtonGeometry.height,
    radius: railButtonGeometry.radius,
    label: name,
    actionId: definition.listActionId,
    allowRename: false,
    isSelected: equalsFolderName(selectedName, name)
  }));

  buttons.push({
    id: definition.footerButtonId,
    railId: definition.railId,
    x: definition.footerX,
    y: railButtonGeometry.footerY,
    width: railButtonGeometry.width,
    height: railButtonGeometry.height,
    radius: railButtonGeometry.radius,
    label: definition.footerLabel,
    tooltip:
      definition.footerActionId === "add-program-folder"
        ? "Add a program by selecting its executable."
        : "Add a panel folder to the selected program.",
    actionId: definition.footerActionId,
    allowRename: false
  });

  return buttons;
}

// The header is one row of same-size Buttons: Refresh first at the top left, the window
// controls last at the top right. The row spans the rails, from the Program rail's left
// edge to the Info rail's right edge, so every Button is wide enough for its full label.
const headerRow = {
  y: 36.353741,
  width: 100,
  height: 37.294964,
  radius: 18.647463,
  step: 107,
  leftX: 5.500015,
  rightX: 1216.464044 - 3 * 100 - 2 * 7
} as const;

function headerButton(
  groupId: "top-left-actions" | "top-right-actions",
  slot: number,
  record: Pick<ButtonRecord, "id" | "label" | "tooltip" | "actionId">
): ButtonRecord {
  return {
    ...record,
    groupId,
    x: (groupId === "top-left-actions" ? headerRow.leftX : headerRow.rightX) + headerRow.step * slot,
    y: headerRow.y,
    width: headerRow.width,
    height: headerRow.height,
    radius: headerRow.radius
  };
}

export const staticButtons: ButtonRecord[] = [
  headerButton("top-left-actions", 0, {
    id: "top-left-button-7",
    label: "Refresh",
    tooltip: "Reload the FlowCell frontend after file, script, or layout changes.",
    actionId: "top-left-button-7"
  }),
  headerButton("top-left-actions", 1, {
    id: "top-left-button-1",
    label: "Save Layout",
    tooltip: "Save every open Button Editor, Pop-out, Fan, and installed Page window.",
    actionId: "top-left-button-1"
  }),
  headerButton("top-left-actions", 2, {
    id: "top-left-button-2",
    label: "Load Layout",
    tooltip: "Restore every saved Button Editor, Pop-out, Fan, and installed Page window.",
    actionId: "top-left-button-2"
  }),
  headerButton("top-left-actions", 3, {
    id: "top-left-button-3",
    label: "Binds",
    tooltip: "Open the shortcut binding window for panel buttons and macros.",
    actionId: "top-left-button-3"
  }),
  headerButton("top-left-actions", 4, {
    id: "top-left-button-6",
    label: "Macro Lab",
    tooltip: "Open Macro Lab for the selected program and panel.",
    actionId: "open-macro-lab"
  }),
  headerButton("top-left-actions", 5, {
    id: "top-left-button-8",
    label: "Settings",
    tooltip: "Open FlowCell startup settings.",
    actionId: "open-settings"
  }),
  headerButton("top-left-actions", 6, {
    id: "top-left-button-9",
    label: "Buttons",
    tooltip: "Open the FlowCell Buttons Editor.",
    actionId: "open-button-editor"
  }),
  headerButton("top-left-actions", 7, {
    id: "top-left-button-10",
    label: "Theme",
    tooltip: "Open the FlowCell Theme Editor.",
    actionId: "open-theme-editor"
  }),
  headerButton("top-right-actions", 0, {
    id: "top-right-button-1",
    label: "min",
    tooltip: "Minimize the main FlowCell window.",
    actionId: "top-right-button-1"
  }),
  headerButton("top-right-actions", 1, {
    id: "top-right-button-2",
    label: "max",
    tooltip: "Maximize or restore the main FlowCell window.",
    actionId: "top-right-button-2"
  }),
  headerButton("top-right-actions", 2, {
    id: "top-right-button-3",
    label: "close",
    tooltip: "Close FlowCell and all of its open windows.",
    actionId: "top-right-button-3"
  })
];

export function buildProgramRailButtons(
  names: readonly string[],
  selectedName: string | null
): ButtonRecord[] {
  return buildFolderRailButtons(programRailDefinition, names, selectedName);
}

export function buildPanelRailButtons(
  names: readonly string[],
  selectedName: string | null,
  savedPanels: readonly PanelRailOwnerEntry[] = []
): ButtonRecord[] {
  const buttons = buildFolderRailButtons(panelRailDefinition, names, selectedName);
  // Folder discovery is read-only. Reserve every saved owner before placing
  // newly discovered panels, including saved owners later in alphabetic order.
  const occupied = savedPanels.map((entry) => entry.rect);
  const candidates = buttons.filter((button) => button.folderName);
  return buttons.map((button) => {
    if (!button.folderName) return button;
    const saved = savedPanels.find((entry) => equalsFolderName(entry.panelName, button.folderName!));
    if (saved) return { ...button, ...saved.rect };
    const available = [button, ...candidates].find((candidate) =>
      !occupied.some((rect) => buttonRectsOverlap(candidate, rect))
    );
    const next = available
      ? { ...button, x: available.x, y: available.y }
      : {
          ...button,
          y: Math.max(button.y, ...occupied
            .filter((rect) => button.x < rect.x + rect.width && button.x + button.width > rect.x)
            .map((rect) => rect.y + rect.height + railButtonGeometry.stepY - railButtonGeometry.height))
        };
    occupied.push({ x: next.x, y: next.y, width: next.width, height: next.height });
    return next;
  });
}

export function buildPanelRailOwnerEntries(
  panelNames: readonly string[]
): PanelRailOwnerEntry[] {
  return panelNames.map((panelName, index) => ({
    panelName,
    rect: {
      x: index === 0 ? panelRailDefinition.firstX : panelRailDefinition.otherX,
      y: railButtonGeometry.firstY + railButtonGeometry.stepY * index,
      width: railButtonGeometry.width,
      height: railButtonGeometry.height
    }
  }));
}

export function buildButtonsSurfaceButtons(
  scripts: readonly {
    canonicalButtonId: string;
    fileName: string;
    label: string;
    tooltip?: string;
    kind?: string;
    bridgeAction?: string;
    events?: PanelButtonEventsRecord;
    macroId?: string;
    canonicalPlacement: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[],
  options: ButtonsSurfaceBuildOptions = {}
): ButtonRecord[] {
  const selectedScriptFileNames = new Set(options.selectedScriptFileNames ?? []);
  const fanSelectionCount = Math.max(0, options.fanSelectionCount ?? 0);
  const buttons: ButtonRecord[] = [
    {
      id: "buttons-add-script",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX,
      y: buttonsSurfaceGeometry.addButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Add Button",
      tooltip: "Add script, tool-set, or page Button content to the selected panel.",
      actionId: "add-panel-script",
      allowRename: false
    },
    {
      id: "buttons-add-macro",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX,
      y: buttonsSurfaceGeometry.addButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Add Macro",
      tooltip: "Create or attach a macro button to the selected panel.",
      actionId: "add-panel-macro",
      allowRename: false
    },
    {
      id: "buttons-fan-selection",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX,
      y: buttonsSurfaceGeometry.fanControlsY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: fanSelectionCount > 0 ? `Fan (${fanSelectionCount})` : "Fan",
      tooltip: fanSelectionCount > 0
        ? `Open a Fan from the exact ${fanSelectionCount} selected ${fanSelectionCount === 1 ? "Button" : "Buttons"}.`
        : "Open the panel's fan. Creates a generic fan of the panel's script Buttons the first time; lists saved setups when several exist.",
      actionId: "open-fan-setup-menu",
      allowRename: false,
      disabled: options.fanDisabled ?? true
    },
    {
      id: "buttons-fan-options",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX,
      y: buttonsSurfaceGeometry.fanControlsY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Fan Options",
      tooltip: "Edit the selected panel's named fan setups in Buttons Editor.",
      actionId: "edit-fan-setups",
      allowRename: false,
      disabled: options.fanOptionsDisabled ?? true
    },
    {
      id: "buttons-order",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX,
      y: buttonsSurfaceGeometry.orderButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Order",
      tooltip: "Edit the selected panel's Button order and placement.",
      actionId: "edit-button-layout",
      allowRename: false,
      disabled: options.orderDisabled ?? true
    },
    {
      id: "buttons-delete-selection",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 2,
      y: buttonsSurfaceGeometry.addButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Delete",
      tooltip: "Move the selected panel buttons and backing files to the Recycle Bin.",
      actionId: "delete-selected-panel-scripts",
      allowRename: false,
      disabled: options.deleteSelectionDisabled ?? true
    },
    {
      id: "buttons-select-all",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 3,
      y: buttonsSurfaceGeometry.addButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: options.allSelectableScriptsSelected ? "Clear All" : "Select All",
      tooltip: options.allSelectableScriptsSelected
        ? "Clear the current button selection."
        : "Select every visible script button in this panel.",
      actionId: "toggle-all-panel-scripts",
      allowRename: false,
      disabled: options.selectAllDisabled ?? true
    },
    {
      id: "buttons-open-pop",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 2,
      y: buttonsSurfaceGeometry.fanControlsY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Open Pop",
      tooltip: "Choose a saved Pop-out file and open its Buttons without changing saved Button settings.",
      actionId: "open-panel-pop-file",
      allowRename: false,
      disabled: options.popDisabled ?? true
    },
    {
      id: "buttons-pop-selection",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 3,
      y: buttonsSurfaceGeometry.fanControlsY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Pop",
      tooltip: "Open this panel's last-used Pop-out file, or its default Pop-out.",
      actionId: "pop-panel-script",
      allowRename: false,
      disabled: options.popDisabled ?? true
    }
  ];

  const scriptsById = new Map(scripts.map((script) => [script.canonicalButtonId, script]));
  const orderedPlacements = inferButtonPlacementRows(scripts.map((script) => ({
    id: script.canonicalButtonId,
    rect: script.canonicalPlacement
  }))).flatMap((row) => row.placements);
  orderedPlacements.forEach(({ id }) => {
    const script = scriptsById.get(id)!;
    const isMacro = script.kind?.trim().toLowerCase() === "macro" && Boolean(script.macroId?.trim());
    const canonicalPlacement = script.canonicalPlacement;
    buttons.push({
      id: script.canonicalButtonId,
      railId: "buttons-rail",
      scriptFileName: script.fileName,
      macroId: isMacro ? script.macroId : undefined,
      x: buttonsSurfaceGeometry.scriptStartX + canonicalPlacement.x,
      y: buttonsSurfaceGeometry.scriptStartY + canonicalPlacement.y,
      width: canonicalPlacement.width,
      height: canonicalPlacement.height,
      radius: buttonsSurfaceGeometry.radius,
      label: script.label,
      tooltip: script.tooltip,
      actionId: isMacro ? "run-panel-macro" : "run-panel-script",
      bridgeAction: script.bridgeAction,
      events: script.events,
      allowRename: true,
      isSelected: selectedScriptFileNames.has(script.fileName)
    });
  });

  return buttons;
}
