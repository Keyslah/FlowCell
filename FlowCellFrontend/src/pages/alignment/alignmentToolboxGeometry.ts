export const ALIGNMENT_TOOLBOX_SCALE = 1;
export const ALIGNMENT_TOOLBOX_AXIS_TEXT_SIZE = 24;
export const ALIGNMENT_TOOLBOX_ROW_TEXT_SIZE = 13;
export const ALIGNMENT_TOOLBOX_BOTTOM_TEXT_SIZE = 12;
export const ALIGNMENT_TOOLBOX_CANONICAL_WIDTH = 316.094746;
export const ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT = 140.452632;
export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT = 105.589474;
export const ALIGNMENT_TOOLBOX_WINDOW_WIDTH =
  ALIGNMENT_TOOLBOX_CANONICAL_WIDTH * ALIGNMENT_TOOLBOX_SCALE;
export const ALIGNMENT_TOOLBOX_WINDOW_HEIGHT =
  ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT * ALIGNMENT_TOOLBOX_SCALE;
export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_WINDOW_HEIGHT =
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_CANONICAL_HEIGHT * ALIGNMENT_TOOLBOX_SCALE;

export type AlignmentToolboxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type AlignmentAxis = "X" | "Y" | "Z";

export type AlignmentToolboxRowSpec = {
  axis: AlignmentAxis;
  minRect: AlignmentToolboxRect;
  centerRect: AlignmentToolboxRect;
  maxRect: AlignmentToolboxRect;
  surfaceRect: AlignmentToolboxRect;
  geoRect: AlignmentToolboxRect;
};

export const ALIGNMENT_TOOLBOX_SVG_RECTS: readonly AlignmentToolboxRect[] = [
  { x: 0.5, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 63.405263, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 126.310526, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 189.21579, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 252.121053, y: 0.5, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 0.5, y: 35.363158, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 63.405263, y: 35.363158, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 126.310526, y: 35.363158, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 189.21579, y: 35.363158, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 252.121053, y: 35.363158, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 0.5, y: 105.089474, width: 157.263158, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 157.194746, y: 104.521061, width: 158.4, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 63.405263, y: 70.226316, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 0.5, y: 70.226316, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 126.310526, y: 70.226316, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 189.21579, y: 70.226316, width: 62.905263, height: 34.863158, rx: 17.431562, ry: 17.431562 },
  { x: 252.121053, y: 70.226316, width: 62.905263, height: 34.863158, rx: 17.431561, ry: 17.431561 }
] as const;

export const ALIGNMENT_TOOLBOX_ROWS: readonly AlignmentToolboxRowSpec[] = [
  {
    axis: "X",
    minRect: ALIGNMENT_TOOLBOX_SVG_RECTS[0],
    centerRect: ALIGNMENT_TOOLBOX_SVG_RECTS[1],
    maxRect: ALIGNMENT_TOOLBOX_SVG_RECTS[2],
    surfaceRect: ALIGNMENT_TOOLBOX_SVG_RECTS[3],
    geoRect: ALIGNMENT_TOOLBOX_SVG_RECTS[4]
  },
  {
    axis: "Y",
    minRect: ALIGNMENT_TOOLBOX_SVG_RECTS[5],
    centerRect: ALIGNMENT_TOOLBOX_SVG_RECTS[6],
    maxRect: ALIGNMENT_TOOLBOX_SVG_RECTS[7],
    surfaceRect: ALIGNMENT_TOOLBOX_SVG_RECTS[8],
    geoRect: ALIGNMENT_TOOLBOX_SVG_RECTS[9]
  },
  {
    axis: "Z",
    minRect: ALIGNMENT_TOOLBOX_SVG_RECTS[13],
    centerRect: ALIGNMENT_TOOLBOX_SVG_RECTS[12],
    maxRect: ALIGNMENT_TOOLBOX_SVG_RECTS[14],
    surfaceRect: ALIGNMENT_TOOLBOX_SVG_RECTS[15],
    geoRect: ALIGNMENT_TOOLBOX_SVG_RECTS[16]
  }
] as const;

export const ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT = ALIGNMENT_TOOLBOX_SVG_RECTS[10];
export const ALIGNMENT_TOOLBOX_CENTER_XY_RECT = ALIGNMENT_TOOLBOX_SVG_RECTS[11];

export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS: readonly AlignmentToolboxRect[] = [
  ...ALIGNMENT_TOOLBOX_SVG_RECTS.slice(0, 10),
  { x: 0.5, y: 70.226316, width: 105.031582, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 105.531582, y: 70.226316, width: 105.031582, height: 34.863158, rx: 17.431561, ry: 17.431561 },
  { x: 210.563164, y: 70.226316, width: 105.031582, height: 34.863158, rx: 17.431561, ry: 17.431561 }
] as const;

export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_ROWS: readonly AlignmentToolboxRowSpec[] = [
  {
    axis: "X",
    minRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[0],
    centerRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[1],
    maxRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[2],
    surfaceRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[3],
    geoRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[4]
  },
  {
    axis: "Y",
    minRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[5],
    centerRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[6],
    maxRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[7],
    surfaceRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[8],
    geoRect: ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[9]
  }
] as const;

export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_ARTBOARD_RECT =
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[10];
export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_EVERYTHING_RECT =
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[11];
export const ILLUSTRATOR_ALIGNMENT_TOOLBOX_CENTER_XY_RECT =
  ILLUSTRATOR_ALIGNMENT_TOOLBOX_SVG_RECTS[12];
