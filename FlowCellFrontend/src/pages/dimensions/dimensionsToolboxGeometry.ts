export const DIMENSIONS_TOOLBOX_SCALE = 0.75;
export const DIMENSIONS_BUTTON_COUNT = 3;
export const DIMENSIONS_BUTTON_BASE_WIDTH = 132;
export const DIMENSIONS_BUTTON_BASE_HEIGHT = 44;
export const DIMENSIONS_BUTTON_GAP = 0;
export const DIMENSIONS_STATUS_HEIGHT = 14;
export const DIMENSIONS_TOOLBOX_CANONICAL_WIDTH =
  DIMENSIONS_BUTTON_COUNT * DIMENSIONS_BUTTON_BASE_WIDTH +
  Math.max(0, DIMENSIONS_BUTTON_COUNT - 1) * DIMENSIONS_BUTTON_GAP;
export const DIMENSIONS_TOOLBOX_CANONICAL_HEIGHT =
  DIMENSIONS_BUTTON_BASE_HEIGHT + DIMENSIONS_STATUS_HEIGHT;
export const DIMENSIONS_TOOLBOX_WINDOW_WIDTH =
  DIMENSIONS_TOOLBOX_CANONICAL_WIDTH * DIMENSIONS_TOOLBOX_SCALE;
export const DIMENSIONS_TOOLBOX_WINDOW_HEIGHT =
  DIMENSIONS_TOOLBOX_CANONICAL_HEIGHT * DIMENSIONS_TOOLBOX_SCALE;

export function resolveDimensionsButtonLayout(
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
  const normalizedButtonSizes =
    buttonSizes.length > 0 ? buttonSizes : new Array(DIMENSIONS_BUTTON_COUNT).fill({});
  const uniformWidth = normalizedButtonSizes.reduce((maxWidth, buttonSize) => {
    const candidateWidth = buttonSize.width ?? DIMENSIONS_BUTTON_BASE_WIDTH;
    return Math.max(maxWidth, Math.round(candidateWidth));
  }, DIMENSIONS_BUTTON_BASE_WIDTH);
  const uniformHeight = normalizedButtonSizes.reduce((maxHeight, buttonSize) => {
    const candidateHeight = buttonSize.height ?? DIMENSIONS_BUTTON_BASE_HEIGHT;
    return Math.max(maxHeight, Math.round(candidateHeight));
  }, DIMENSIONS_BUTTON_BASE_HEIGHT);
  const positions = normalizedButtonSizes.map(
    (_buttonSize, index) => index * (uniformWidth + DIMENSIONS_BUTTON_GAP)
  );

  return {
    canvasWidth:
      normalizedButtonSizes.length * uniformWidth +
      Math.max(0, normalizedButtonSizes.length - 1) * DIMENSIONS_BUTTON_GAP,
    canvasHeight: uniformHeight,
    uniformWidth,
    uniformHeight,
    positions
  };
}
