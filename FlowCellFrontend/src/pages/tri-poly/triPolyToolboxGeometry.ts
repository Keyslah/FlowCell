export const TRI_POLY_TOOLBOX_SCALE = 1;
export const TRI_POLY_TOOLBOX_CANONICAL_WIDTH = 492;
export const TRI_POLY_TOOLBOX_CANONICAL_HEIGHT = 94;
export const TRI_POLY_TOOLBOX_WINDOW_WIDTH =
  TRI_POLY_TOOLBOX_CANONICAL_WIDTH * TRI_POLY_TOOLBOX_SCALE;
export const TRI_POLY_TOOLBOX_WINDOW_HEIGHT =
  TRI_POLY_TOOLBOX_CANONICAL_HEIGHT * TRI_POLY_TOOLBOX_SCALE;
export const TRI_POLY_TOOLBOX_BUTTON_TEXT_SIZE = 16;
export const TRI_POLY_TOOLBOX_INPUT_TEXT_SIZE = 16;

export type TriPolyToolboxRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
};

export type TriPolyToolboxButtonSlot =
  | "triangle_equilateral"
  | "triangle_isosceles"
  | "triangle_50"
  | "triangle_right"
  | "triangle_scalene"
  | "polygon_create";

export type TriPolyToolboxButtonSpec = {
  slot: TriPolyToolboxButtonSlot;
  fallbackLabel: string;
  tooltip: string;
  rect: TriPolyToolboxRect;
};

export const TRI_POLY_TOOLBOX_SIDES_RECT: TriPolyToolboxRect = {
  x: 0,
  y: 49,
  width: 234,
  height: 45,
  rx: 6,
  ry: 6
};

export const TRI_POLY_TOOLBOX_SVG_RECTS: readonly TriPolyToolboxRect[] = [
  { x: 0, y: 0, width: 100, height: 45, rx: 6, ry: 6 },
  { x: 105, y: 0, width: 90, height: 45, rx: 6, ry: 6 },
  { x: 200, y: 0, width: 91, height: 45, rx: 6, ry: 6 },
  { x: 296, y: 0, width: 91, height: 45, rx: 6, ry: 6 },
  { x: 392, y: 0, width: 100, height: 45, rx: 6, ry: 6 },
  TRI_POLY_TOOLBOX_SIDES_RECT,
  { x: 239, y: 49, width: 253, height: 45, rx: 6, ry: 6 }
] as const;

export const TRI_POLY_TOOLBOX_TRIANGLE_BUTTONS: readonly TriPolyToolboxButtonSpec[] = [
  {
    slot: "triangle_equilateral",
    fallbackLabel: "Equila...",
    tooltip: "Create an equilateral triangular prism.",
    rect: TRI_POLY_TOOLBOX_SVG_RECTS[0]
  },
  {
    slot: "triangle_isosceles",
    fallbackLabel: "Isosc...",
    tooltip: "Create an isosceles triangular prism.",
    rect: TRI_POLY_TOOLBOX_SVG_RECTS[1]
  },
  {
    slot: "triangle_50",
    fallbackLabel: "50°",
    tooltip: "Create a triangular prism with the typed apex angle.",
    rect: TRI_POLY_TOOLBOX_SVG_RECTS[2]
  },
  {
    slot: "triangle_right",
    fallbackLabel: "Right",
    tooltip: "Create a right triangular prism.",
    rect: TRI_POLY_TOOLBOX_SVG_RECTS[3]
  },
  {
    slot: "triangle_scalene",
    fallbackLabel: "Scalene",
    tooltip: "Create a scalene triangular prism.",
    rect: TRI_POLY_TOOLBOX_SVG_RECTS[4]
  }
] as const;

export const TRI_POLY_TOOLBOX_CREATE_BUTTON: TriPolyToolboxButtonSpec = {
  slot: "polygon_create",
  fallbackLabel: "Create",
  tooltip: "Create a regular polygon prism using the staged side count.",
  rect: TRI_POLY_TOOLBOX_SVG_RECTS[6]
};
