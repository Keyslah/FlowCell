export const REMESH_TOOLBOX_SCALE = 3;
export const REMESH_TOOLBOX_TOP_ROW_TEXT_SIZE = 4.55;
export const REMESH_TOOLBOX_VALUE_TEXT_SIZE = 4.35;
export const REMESH_TOOLBOX_ACTION_TEXT_SIZE = 4.35;
export const REMESH_TOOLBOX_THIRD_ROW_TEXT_SIZE = 4.2;
export const REMESH_TOOLBOX_CANONICAL_WIDTH = 111.808959;
export const REMESH_TOOLBOX_BASE_CANONICAL_HEIGHT = 22.91326;
export const REMESH_TOOLBOX_ROW_HEIGHT = 10.44528;
export const REMESH_TOOLBOX_ROW_GAP = 1.0227;
export const REMESH_TOOLBOX_THIRD_ROW_Y = 23.43596;
export const REMESH_TOOLBOX_EXPANDED_CANONICAL_HEIGHT =
  REMESH_TOOLBOX_THIRD_ROW_Y + REMESH_TOOLBOX_ROW_HEIGHT + 0.5;
export const REMESH_TOOLBOX_CANONICAL_HEIGHT = REMESH_TOOLBOX_BASE_CANONICAL_HEIGHT;
export const REMESH_TOOLBOX_WINDOW_WIDTH =
  REMESH_TOOLBOX_CANONICAL_WIDTH * REMESH_TOOLBOX_SCALE;
export const REMESH_TOOLBOX_WINDOW_HEIGHT =
  REMESH_TOOLBOX_CANONICAL_HEIGHT * REMESH_TOOLBOX_SCALE;
export const REMESH_TOOLBOX_EXPANDED_WINDOW_HEIGHT =
  REMESH_TOOLBOX_EXPANDED_CANONICAL_HEIGHT * REMESH_TOOLBOX_SCALE;

export type RemeshToolboxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type RemeshToolboxSlot =
  | "mode_selector"
  | "primary_value"
  | "secondary_value"
  | "mode_voxel"
  | "mode_smooth"
  | "mode_sharp"
  | "mode_blocks"
  | "set_voxel_size_mm"
  | "set_adaptivity"
  | "toggle_smooth_shading"
  | "set_octree_depth"
  | "set_scale"
  | "toggle_remove_disconnected"
  | "set_threshold"
  | "set_sharpness"
  | "create_update_remesh"
  | "apply_remesh";

export type RemeshToolboxButtonSpec = {
  slot: RemeshToolboxSlot;
  fallbackLabel: string;
  tooltip: string;
  rect: RemeshToolboxRect;
};

export const REMESH_TOOLBOX_SVG_RECTS: readonly RemeshToolboxRect[] = [
  { x: 0.945016, y: 0.5, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  { x: 38.029674, y: 0.5, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  { x: 75.114332, y: 0.5, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  { x: 0.5, y: 11.96798, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  { x: 37.584658, y: 11.96798, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  { x: 75.114332, y: 11.96798, width: 36.194627, height: 10.44528, rx: 6.675232, ry: 5.22264 },
  {
    x: 0.5,
    y: REMESH_TOOLBOX_THIRD_ROW_Y,
    width: 36.194627,
    height: 10.44528,
    rx: 6.675232,
    ry: 5.22264
  },
  {
    x: 37.584658,
    y: REMESH_TOOLBOX_THIRD_ROW_Y,
    width: 36.194627,
    height: 10.44528,
    rx: 6.675232,
    ry: 5.22264
  },
  {
    x: 75.114332,
    y: REMESH_TOOLBOX_THIRD_ROW_Y,
    width: 36.194627,
    height: 10.44528,
    rx: 6.675232,
    ry: 5.22264
  }
] as const;

export const REMESH_TOOLBOX_MODE_RECT = REMESH_TOOLBOX_SVG_RECTS[0];
export const REMESH_TOOLBOX_PRIMARY_VALUE_RECT = REMESH_TOOLBOX_SVG_RECTS[1];
export const REMESH_TOOLBOX_SECONDARY_VALUE_RECT = REMESH_TOOLBOX_SVG_RECTS[2];

export const REMESH_TOOLBOX_TOGGLE_BUTTON: RemeshToolboxButtonSpec = {
  slot: "toggle_smooth_shading",
  fallbackLabel: "SS",
  tooltip: "Toggle Smooth Shading for Voxel remesh.",
  rect: REMESH_TOOLBOX_SVG_RECTS[3]
};

export const REMESH_TOOLBOX_CREATE_BUTTON: RemeshToolboxButtonSpec = {
  slot: "create_update_remesh",
  fallbackLabel: "Create",
  tooltip: "Create or update the Remesh modifier on the active mesh.",
  rect: REMESH_TOOLBOX_SVG_RECTS[4]
};

export const REMESH_TOOLBOX_APPLY_BUTTON: RemeshToolboxButtonSpec = {
  slot: "apply_remesh",
  fallbackLabel: "Apply",
  tooltip: "Apply the active Remesh modifier using the staged settings.",
  rect: REMESH_TOOLBOX_SVG_RECTS[5]
};

export const REMESH_TOOLBOX_THRESHOLD_RECT = REMESH_TOOLBOX_SVG_RECTS[6];
export const REMESH_TOOLBOX_SHARPNESS_RECT = REMESH_TOOLBOX_SVG_RECTS[7];
