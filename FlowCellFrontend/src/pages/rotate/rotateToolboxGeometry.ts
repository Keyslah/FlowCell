// Change these first when resizing the rotate toolbox.
export const ROTATE_TOOLBOX_SCALE = 0.65;
export const ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE = 14;
export const ROTATE_TOOLBOX_CENTER_ROW_TEXT_SIZE = 14;
export const ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE = 19;
export const ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE = 14;
export const ROTATE_TOOLBOX_INPUT_TEXT_SIZE = 18;
export const ILLUSTRATOR_ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE = 22;
export const ILLUSTRATOR_ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE = 21;
export const ILLUSTRATOR_ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE = 18;
export const ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_TEXT_SIZE = 18;
export const ROTATE_TOOLBOX_CANONICAL_WIDTH = 432.1475;
export const ROTATE_TOOLBOX_CANONICAL_HEIGHT = 161.019008;
export const ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH = 430.582734;
export const ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT = 136.352518;
export const ROTATE_TOOLBOX_WINDOW_WIDTH =
  ROTATE_TOOLBOX_CANONICAL_WIDTH * ROTATE_TOOLBOX_SCALE;
export const ROTATE_TOOLBOX_WINDOW_HEIGHT =
  ROTATE_TOOLBOX_CANONICAL_HEIGHT * ROTATE_TOOLBOX_SCALE;
export const ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_WIDTH =
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH * ROTATE_TOOLBOX_SCALE;
export const ILLUSTRATOR_ROTATE_TOOLBOX_WINDOW_HEIGHT =
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT * ROTATE_TOOLBOX_SCALE;

export type RotateToolboxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type RotateToolboxSlot =
  | "axis_z"
  | "axis_y"
  | "axis_x"
  | "preset_30"
  | "preset_45"
  | "preset_90"
  | "preset_180"
  | "preset_270"
  | "center_geometry"
  | "center_origin"
  | "center_world"
  | "center_cursor"
  | "center_object"
  | "mode_transform"
  | "mode_distribute"
  | "apply_negative"
  | "apply_positive";

export type RotateToolboxButtonSpec = {
  slot: RotateToolboxSlot;
  rect: RotateToolboxRect;
};

export const ROTATE_TOOLBOX_SVG_RECTS: readonly RotateToolboxRect[] = [
  { x: 376.384892, y: 0.5, width: 53.697842, height: 35.798561, rx: 17.899262, ry: 17.899262 },
  { x: 322.68705, y: 0.749224, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 268.989209, y: 0.749224, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 215.291367, y: 0.749224, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 161.593525, y: 0.5, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 107.895683, y: 0.5, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 54.197842, y: 0.5, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 0.5, y: 0.749224, width: 53.697842, height: 35.798561, rx: 17.899263, ry: 17.899263 },
  { x: 2.064766, y: 36.547785, width: 84.258993, height: 31.079137, rx: 15.539553, ry: 15.539553 },
  { x: 88.395702, y: 36.547785, width: 84.258993, height: 31.079137, rx: 15.539553, ry: 15.539553 },
  { x: 174.726637, y: 36.547785, width: 84.258993, height: 31.079137, rx: 15.539553, ry: 15.539553 },
  { x: 261.057572, y: 36.547785, width: 84.258993, height: 31.079137, rx: 15.539553, ry: 15.539553 },
  { x: 347.388507, y: 36.547785, width: 84.258993, height: 31.079137, rx: 15.539553, ry: 15.539553 },
  { x: 2.064766, y: 67.626922, width: 194.76259, height: 49.726619, rx: 24.863284, ry: 24.863284 },
  { x: 236.88491, y: 67.626922, width: 194.76259, height: 49.726619, rx: 24.863285, ry: 24.863285 },
  { x: 2.064766, y: 117.35354, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 },
  { x: 146.755414, y: 117.35354, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 },
  { x: 291.446061, y: 117.35354, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 }
] as const;

export const ROTATE_TOOLBOX_BUTTON_SPECS: readonly RotateToolboxButtonSpec[] = [
  { slot: "axis_z", rect: ROTATE_TOOLBOX_SVG_RECTS[0] },
  { slot: "axis_y", rect: ROTATE_TOOLBOX_SVG_RECTS[1] },
  { slot: "axis_x", rect: ROTATE_TOOLBOX_SVG_RECTS[2] },
  { slot: "preset_30", rect: ROTATE_TOOLBOX_SVG_RECTS[3] },
  { slot: "preset_45", rect: ROTATE_TOOLBOX_SVG_RECTS[4] },
  { slot: "preset_90", rect: ROTATE_TOOLBOX_SVG_RECTS[5] },
  { slot: "preset_180", rect: ROTATE_TOOLBOX_SVG_RECTS[6] },
  { slot: "preset_270", rect: ROTATE_TOOLBOX_SVG_RECTS[7] },
  { slot: "center_geometry", rect: ROTATE_TOOLBOX_SVG_RECTS[8] },
  { slot: "center_origin", rect: ROTATE_TOOLBOX_SVG_RECTS[9] },
  { slot: "center_world", rect: ROTATE_TOOLBOX_SVG_RECTS[10] },
  { slot: "center_cursor", rect: ROTATE_TOOLBOX_SVG_RECTS[11] },
  { slot: "center_object", rect: ROTATE_TOOLBOX_SVG_RECTS[12] },
  { slot: "mode_transform", rect: ROTATE_TOOLBOX_SVG_RECTS[13] },
  { slot: "mode_distribute", rect: ROTATE_TOOLBOX_SVG_RECTS[14] },
  { slot: "apply_negative", rect: ROTATE_TOOLBOX_SVG_RECTS[16] },
  { slot: "apply_positive", rect: ROTATE_TOOLBOX_SVG_RECTS[17] }
] as const;

export const ROTATE_TOOLBOX_INPUT_RECT: RotateToolboxRect = ROTATE_TOOLBOX_SVG_RECTS[15];

export const ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS: readonly RotateToolboxRect[] = [
  { x: 0.5, y: 0.5, width: 84.258993, height: 42.460432, rx: 21.230216, ry: 21.230216 },
  { x: 86.830935, y: 0.5, width: 84.258993, height: 42.460432, rx: 21.230216, ry: 21.230216 },
  { x: 173.161871, y: 0.5, width: 84.258993, height: 42.460432, rx: 21.230216, ry: 21.230216 },
  { x: 259.492806, y: 0.5, width: 84.258993, height: 42.460432, rx: 21.230216, ry: 21.230216 },
  { x: 345.823741, y: 0.5, width: 84.258993, height: 42.460432, rx: 21.230216, ry: 21.230216 },
  { x: 0.5, y: 42.960432, width: 194.76259, height: 49.726619, rx: 24.863284, ry: 24.863284 },
  { x: 235.320144, y: 42.960432, width: 194.76259, height: 49.726619, rx: 24.863285, ry: 24.863285 },
  { x: 0.5, y: 92.68705, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 },
  { x: 145.190648, y: 92.68705, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 },
  { x: 289.881295, y: 92.68705, width: 140.201439, height: 43.165468, rx: 21.582712, ry: 21.582712 }
] as const;

export const ILLUSTRATOR_ROTATE_TOOLBOX_BUTTON_SPECS: readonly RotateToolboxButtonSpec[] = [
  { slot: "center_world", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[0] },
  { slot: "center_cursor", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[1] },
  { slot: "preset_30", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[2] },
  { slot: "preset_45", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[3] },
  { slot: "preset_90", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[4] },
  { slot: "mode_transform", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[5] },
  { slot: "mode_distribute", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[6] },
  { slot: "apply_negative", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[8] },
  { slot: "apply_positive", rect: ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[9] }
] as const;

export const ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_RECT: RotateToolboxRect =
  ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS[7];
