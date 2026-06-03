import { buildPanelScriptButtonId } from "../../lib/buttonLabelOverrides";

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

export type ShapeType = "roundedRect" | "rect";

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
  shapeType: ShapeType;
  radius?: number;
  strokeWidth: number;
  label: string;
  tooltip?: string;
  actionId: string;
  skinId: string;
  border?: string;
  background?: string;
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

const defaultButtonVisual = {
  border: "#231f20",
  background: "transparent",
  shapeType: "roundedRect" as const,
  strokeWidth: 1,
  skinId: "glass"
};

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
  columnCount: 4,
  scriptRowCount: 9,
  width: 131.568346,
  height: 37.294964,
  radius: 18.647463
} as const;

export const buttonsSurfacePopTypeControlGeometry = {
  x: buttonsSurfaceGeometry.addButtonX + buttonsSurfaceGeometry.stepX * 2,
  y: buttonsSurfaceGeometry.fanControlsY,
  width: buttonsSurfaceGeometry.width,
  height: buttonsSurfaceGeometry.height,
  radius: buttonsSurfaceGeometry.radius
} as const;

interface ButtonsSurfaceBuildOptions {
  selectedScriptFileNames?: readonly string[];
  deleteSelectionDisabled?: boolean;
  selectAllDisabled?: boolean;
  allSelectableScriptsSelected?: boolean;
  orderDisabled?: boolean;
  popDisabled?: boolean;
  fanDisabled?: boolean;
  fanOptionsDisabled?: boolean;
}

export { buildPanelScriptButtonId };

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

function buildFolderRailButtons(
  definition: FolderRailDefinition,
  names: readonly string[],
  selectedName: string | null
): ButtonRecord[] {
  const visibleNames = names.slice(0, getVisibleFolderRailCount());
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
    isSelected: equalsFolderName(selectedName, name),
    ...defaultButtonVisual
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
    actionId: definition.footerActionId,
    allowRename: false,
    ...defaultButtonVisual
  });

  return buttons;
}

export const staticButtons: ButtonRecord[] = [
  {
    id: "top-left-button-1",
    groupId: "top-left-actions",
    x: 7.571957,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "Save Layout",
    actionId: "top-left-button-1",
    ...defaultButtonVisual
  },
  {
    id: "top-left-button-2",
    groupId: "top-left-actions",
    x: 94.464043,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "Load Layout",
    actionId: "top-left-button-2",
    ...defaultButtonVisual
  },
  {
    id: "top-left-button-3",
    groupId: "top-left-actions",
    x: 181.35613,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "Binds",
    actionId: "top-left-button-3",
    ...defaultButtonVisual
  },
  {
    id: "top-left-button-6",
    groupId: "top-left-actions",
    x: 268.248216,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "Macro Lab",
    actionId: "open-macro-lab",
    ...defaultButtonVisual
  },
  {
    id: "top-left-button-7",
    groupId: "top-left-actions",
    x: 355.140303,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "Refresh",
    actionId: "top-left-button-7",
    ...defaultButtonVisual
  },
  {
    id: "top-right-button-1",
    groupId: "top-right-actions",
    x: 929.586346,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "min",
    actionId: "top-right-button-1",
    ...defaultButtonVisual
  },
  {
    id: "top-right-button-2",
    groupId: "top-right-actions",
    x: 1035.25541,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "max",
    actionId: "top-right-button-2",
    ...defaultButtonVisual
  },
  {
    id: "top-right-button-3",
    groupId: "top-right-actions",
    x: 1140.924475,
    y: 36.353741,
    width: 70.446043,
    height: 37.294964,
    radius: 18.647463,
    label: "close",
    actionId: "top-right-button-3",
    ...defaultButtonVisual
  }
];

export function buildProgramRailButtons(
  names: readonly string[],
  selectedName: string | null
): ButtonRecord[] {
  return buildFolderRailButtons(programRailDefinition, names, selectedName);
}

export function buildPanelRailButtons(
  names: readonly string[],
  selectedName: string | null
): ButtonRecord[] {
  return buildFolderRailButtons(panelRailDefinition, names, selectedName);
}

export function buildButtonsSurfaceButtons(
  programName: string | null,
  panelName: string | null,
  scripts: readonly {
    fileName: string;
    label: string;
    tooltip?: string;
    kind?: string;
    macroId?: string;
  }[],
  options: ButtonsSurfaceBuildOptions = {}
): ButtonRecord[] {
  const selectedScriptFileNames = new Set(options.selectedScriptFileNames ?? []);
  const buttons: ButtonRecord[] = [
    {
      id: "buttons-add-script",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX,
      y: buttonsSurfaceGeometry.addButtonY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Add Script",
      actionId: "add-panel-script",
      allowRename: false,
      ...defaultButtonVisual
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
      actionId: "add-panel-macro",
      allowRename: false,
      ...defaultButtonVisual
    },
    {
      id: "buttons-fan-selection",
      railId: "buttons-rail",
      x: buttonsSurfaceGeometry.addButtonX,
      y: buttonsSurfaceGeometry.fanControlsY,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: "Fan",
      actionId: "fan-panel-script-selection",
      allowRename: false,
      disabled: options.fanDisabled ?? true,
      ...defaultButtonVisual
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
      actionId: "open-panel-fan-options",
      allowRename: false,
      disabled: options.fanOptionsDisabled ?? true,
      ...defaultButtonVisual
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
      actionId: "open-button-order",
      allowRename: false,
      disabled: options.orderDisabled ?? true,
      ...defaultButtonVisual
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
      actionId: "delete-selected-panel-scripts",
      allowRename: false,
      disabled: options.deleteSelectionDisabled ?? true,
      ...defaultButtonVisual
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
      actionId: "toggle-all-panel-scripts",
      allowRename: false,
      disabled: options.selectAllDisabled ?? true,
      ...defaultButtonVisual
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
      actionId: "pop-panel-script",
      allowRename: false,
      disabled: options.popDisabled ?? true,
      ...defaultButtonVisual
    }
  ];

  const visibleScripts = scripts.slice(
    0,
    buttonsSurfaceGeometry.columnCount * buttonsSurfaceGeometry.scriptRowCount
  );
  visibleScripts.forEach((script, index) => {
    const columnIndex = index % buttonsSurfaceGeometry.columnCount;
    const rowIndex = Math.floor(index / buttonsSurfaceGeometry.columnCount);
    const isMacro = script.kind?.trim().toLowerCase() === "macro" && Boolean(script.macroId?.trim());
    const buttonId =
      programName && panelName
        ? buildPanelScriptButtonId(programName, panelName, script.fileName)
        : `panel-script-${index + 1}`;

    buttons.push({
      id: buttonId,
      railId: "buttons-rail",
      scriptFileName: script.fileName,
      macroId: isMacro ? script.macroId : undefined,
      x: buttonsSurfaceGeometry.scriptStartX + buttonsSurfaceGeometry.stepX * columnIndex,
      y: buttonsSurfaceGeometry.scriptStartY + buttonsSurfaceGeometry.stepY * rowIndex,
      width: buttonsSurfaceGeometry.width,
      height: buttonsSurfaceGeometry.height,
      radius: buttonsSurfaceGeometry.radius,
      label: script.label,
      tooltip: script.tooltip,
      actionId: isMacro ? "run-panel-macro" : "run-panel-script",
      allowRename: true,
      isSelected: selectedScriptFileNames.has(script.fileName),
      ...defaultButtonVisual
    });
  });

  return buttons;
}
