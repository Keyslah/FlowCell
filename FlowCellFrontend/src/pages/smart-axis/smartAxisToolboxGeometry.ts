// Tool-set-wide tuning values. Change these first when resizing Smart Axis.
export const SMART_AXIS_TOOLBOX_SCALE = 0.75;
export const SMART_AXIS_BUTTON_COUNT = 5;
export const SMART_AXIS_BUTTON_BASE_WIDTH = 88;
export const SMART_AXIS_BUTTON_BASE_HEIGHT = 44;
export const SMART_AXIS_BUTTON_GAP = 0;
export const SMART_AXIS_TOOLBOX_CANONICAL_WIDTH =
  SMART_AXIS_BUTTON_COUNT * SMART_AXIS_BUTTON_BASE_WIDTH +
  Math.max(0, SMART_AXIS_BUTTON_COUNT - 1) * SMART_AXIS_BUTTON_GAP;
export const SMART_AXIS_TOOLBOX_CANONICAL_HEIGHT = SMART_AXIS_BUTTON_BASE_HEIGHT;
export const SMART_AXIS_TOOLBOX_WINDOW_WIDTH =
  SMART_AXIS_TOOLBOX_CANONICAL_WIDTH * SMART_AXIS_TOOLBOX_SCALE;
export const SMART_AXIS_TOOLBOX_WINDOW_HEIGHT =
  SMART_AXIS_TOOLBOX_CANONICAL_HEIGHT * SMART_AXIS_TOOLBOX_SCALE;

export function resolveSmartAxisButtonLayout(
  buttonSizes: ReadonlyArray<{
    width?: number;
    height?: number;
  }>
): {
  canvasWidth: number;
  canvasHeight: number;
  uniformWidth: number;
  uniformHeight: number;
  positions: number[];
} {
  const normalizedButtonSizes = buttonSizes.length > 0 ? buttonSizes : new Array(SMART_AXIS_BUTTON_COUNT).fill({});
  const uniformWidth = normalizedButtonSizes.reduce((maxWidth, buttonSize) => {
    const candidateWidth = buttonSize.width ?? SMART_AXIS_BUTTON_BASE_WIDTH;
    return Math.max(maxWidth, Math.round(candidateWidth));
  }, SMART_AXIS_BUTTON_BASE_WIDTH);
  const uniformHeight = normalizedButtonSizes.reduce((maxHeight, buttonSize) => {
    const candidateHeight = buttonSize.height ?? SMART_AXIS_BUTTON_BASE_HEIGHT;
    return Math.max(maxHeight, Math.round(candidateHeight));
  }, SMART_AXIS_BUTTON_BASE_HEIGHT);
  const positions = normalizedButtonSizes.map(
    (_buttonSize, index) => index * (uniformWidth + SMART_AXIS_BUTTON_GAP)
  );

  return {
    canvasWidth:
      normalizedButtonSizes.length * uniformWidth +
      Math.max(0, normalizedButtonSizes.length - 1) * SMART_AXIS_BUTTON_GAP,
    canvasHeight: uniformHeight,
    uniformWidth,
    uniformHeight,
    positions
  };
}
