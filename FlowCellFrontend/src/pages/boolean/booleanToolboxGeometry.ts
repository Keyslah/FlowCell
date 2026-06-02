export const BOOLEAN_TOOLBOX_SCALE = 1;
export const BOOLEAN_TOOLBOX_OPERATION_TEXT_SIZE = 18;
export const BOOLEAN_TOOLBOX_CONTROL_TEXT_SIZE = 13;
export const BOOLEAN_TOOLBOX_RUN_TEXT_SIZE = 13;
export const BOOLEAN_TOOLBOX_CANONICAL_WIDTH = 315.526316;
export const BOOLEAN_TOOLBOX_CANONICAL_HEIGHT = 70.726316;
export const BOOLEAN_TOOLBOX_WINDOW_WIDTH =
  BOOLEAN_TOOLBOX_CANONICAL_WIDTH * BOOLEAN_TOOLBOX_SCALE;
export const BOOLEAN_TOOLBOX_WINDOW_HEIGHT =
  BOOLEAN_TOOLBOX_CANONICAL_HEIGHT * BOOLEAN_TOOLBOX_SCALE;

export type BooleanToolboxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type BooleanToolboxButtonSlot =
  | "operation_intersect"
  | "operation_union"
  | "operation_difference"
  | "toggle_self_intersection"
  | "toggle_hole_tolerant"
  | "toggle_hide_cutter"
  | "toggle_backup_active"
  | "run_boolean";

export type BooleanToolboxButtonSpec = {
  slot: BooleanToolboxButtonSlot;
  fallbackLabel: string;
  tooltip: string;
  rect: BooleanToolboxRect;
};

export const BOOLEAN_TOOLBOX_SVG_RECTS: readonly BooleanToolboxRect[] = [
  { x: 0.5, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 63.405263, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 126.310526, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 189.21579, y: 0.5, width: 125.810526, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 0.5, y: 35.363157, width: 47.284772, height: 34.863159, rx: 17.431561, ry: 17.431561 },
  { x: 189.21579, y: 35.363158, width: 125.810526, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 47.784772, y: 35.363157, width: 47.284772, height: 34.863159, rx: 17.431562, ry: 17.431562 },
  { x: 95.069545, y: 35.363157, width: 47.284772, height: 34.863159, rx: 17.431561, ry: 17.431561 },
  { x: 142.354317, y: 35.363157, width: 47.284772, height: 34.863159, rx: 17.431561, ry: 17.431561 }
] as const;

export const BOOLEAN_TOOLBOX_OPERATION_BUTTONS: readonly BooleanToolboxButtonSpec[] = [
  {
    slot: "operation_intersect",
    fallbackLabel: "I",
    tooltip: "Set the boolean operation to Intersect.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[0]
  },
  {
    slot: "operation_union",
    fallbackLabel: "U",
    tooltip: "Set the boolean operation to Union.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[1]
  },
  {
    slot: "operation_difference",
    fallbackLabel: "D",
    tooltip: "Set the boolean operation to Difference.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[2]
  }
] as const;

export const BOOLEAN_TOOLBOX_SOLVER_RECT = BOOLEAN_TOOLBOX_SVG_RECTS[3];

export const BOOLEAN_TOOLBOX_TOGGLE_BUTTONS: readonly BooleanToolboxButtonSpec[] = [
  {
    slot: "toggle_self_intersection",
    fallbackLabel: "SI",
    tooltip: "Toggle self-intersection support.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[4]
  },
  {
    slot: "toggle_hole_tolerant",
    fallbackLabel: "HT",
    tooltip: "Toggle hole-tolerant solving.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[6]
  },
  {
    slot: "toggle_hide_cutter",
    fallbackLabel: "HC",
    tooltip: "Toggle hiding the cutter after running.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[7]
  },
  {
    slot: "toggle_backup_active",
    fallbackLabel: "BA",
    tooltip: "Toggle backing up the active object before running.",
    rect: BOOLEAN_TOOLBOX_SVG_RECTS[8]
  }
] as const;

export const BOOLEAN_TOOLBOX_RUN_BUTTON: BooleanToolboxButtonSpec = {
  slot: "run_boolean",
  fallbackLabel: "Run",
  tooltip: "Run the quick boolean operation.",
  rect: BOOLEAN_TOOLBOX_SVG_RECTS[5]
};
