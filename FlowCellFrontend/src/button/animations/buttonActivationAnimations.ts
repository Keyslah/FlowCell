import type {
  ButtonActivationAnimationPresetId,
  ButtonDesktopBounds,
  ButtonRecord
} from "../types.js";

export interface ButtonActivationAnimationPreset {
  id: ButtonActivationAnimationPresetId;
  label: string;
  durationMs: number;
  pressInterval?: { minimum: number; maximum: number };
  spritePixelSize: {
    width: number;
    height: number;
  };
  playbackCanvas: {
    topMarginSpriteHeights: number;
    heightSpriteHeights: number;
  };
}

export interface ButtonActivationAnimationFrame {
  offset: number;
  opacity: number;
  scale: number;
  translateYPercent: number;
}

export type ButtonAnimationResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export const BUTTON_ANIMATION_MINIMUM_EDITOR_WIDTH = 140;
export const PLUS_RISE_FRAME_COUNT = 61;

export const BUTTON_ACTIVATION_ANIMATION_PRESETS: readonly ButtonActivationAnimationPreset[] = [
  {
    id: "plus-rise",
    label: "Plus Rise",
    durationMs: 1_200,
    spritePixelSize: {
      width: 283,
      height: 295
    },
    playbackCanvas: {
      topMarginSpriteHeights: 0.55,
      heightSpriteHeights: 2
    }
  },
  {
    id: "star-wars-lightsaber",
    label: "Star Wars Lightsaber",
    durationMs: 3_010,
    pressInterval: { minimum: 5, maximum: 50 },
    spritePixelSize: {
      width: 480,
      height: 268
    },
    playbackCanvas: {
      topMarginSpriteHeights: 0,
      heightSpriteHeights: 1
    }
  }
];

const PRESET_IDS = new Set<string>(
  BUTTON_ACTIVATION_ANIMATION_PRESETS.map((preset) => preset.id)
);

export function isButtonActivationAnimationPresetId(
  value: unknown
): value is ButtonActivationAnimationPresetId {
  return typeof value === "string" && PRESET_IDS.has(value);
}

export function getButtonActivationAnimationPreset(
  presetId: ButtonActivationAnimationPresetId
): ButtonActivationAnimationPreset {
  const preset = BUTTON_ACTIVATION_ANIMATION_PRESETS.find(
    (candidate) => candidate.id === presetId
  );
  if (!preset) {
    throw new Error(`Unknown Button activation animation '${presetId}'.`);
  }
  return preset;
}

export function consumeButtonAnimationPress(
  button: ButtonRecord,
  storage: Pick<Storage, "getItem" | "setItem">,
  random: () => number = Math.random
): boolean {
  const animation = button.activationAnimation;
  if (!animation) return false;
  const range = getButtonActivationAnimationPreset(animation.presetId).pressInterval;
  if (!range) return true;
  const key = `flowcell.button-animation-presses.v1:${button.id}:${animation.presetId}`;
  let saved: { interval?: number; presses?: number } | null = null;
  try {
    saved = JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    // An invalid runtime counter starts a fresh interval; the assignment is unchanged.
  }
  const valid = saved && Number.isInteger(saved.interval) &&
    saved.interval! >= range.minimum && saved.interval! <= range.maximum &&
    Number.isInteger(saved.presses) && saved.presses! >= 0 && saved.presses! < saved.interval!;
  const nextInterval = () => range.minimum + Math.floor(
    random() * (range.maximum - range.minimum + 1)
  );
  let interval = valid ? saved!.interval! : nextInterval();
  let presses = (valid ? saved!.presses! : 0) + 1;
  const play = presses >= interval;
  if (play) {
    interval = nextInterval();
    presses = 0;
  }
  // Only the elected playback coordinator calls this synchronous read/write.
  storage.setItem(key, JSON.stringify({ interval, presses }));
  return play;
}

export function normalizeButtonAnimationDesktopBounds(
  bounds: ButtonDesktopBounds
): ButtonDesktopBounds {
  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
}

function roundMotionValue(value: number): number {
  return Number(value.toFixed(6));
}

function smootherStep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * clamped * (
    clamped * (clamped * 6 - 15) + 10
  );
}

export function getButtonAnimationAspectRatio(
  presetId: ButtonActivationAnimationPresetId
): number {
  const { spritePixelSize } = getButtonActivationAnimationPreset(presetId);
  return spritePixelSize.width / spritePixelSize.height;
}

export function normalizeButtonAnimationEditorBounds(
  presetId: ButtonActivationAnimationPresetId,
  bounds: ButtonDesktopBounds
): ButtonDesktopBounds {
  const normalized = normalizeButtonAnimationDesktopBounds(bounds);
  const aspectRatio = getButtonAnimationAspectRatio(presetId);
  return {
    ...normalized,
    height: Math.max(1, Math.round(normalized.width / aspectRatio))
  };
}

export function resolveButtonAnimationPlaybackBounds(
  presetId: ButtonActivationAnimationPresetId,
  bounds: ButtonDesktopBounds
): ButtonDesktopBounds {
  const editorBounds = normalizeButtonAnimationEditorBounds(presetId, bounds);
  const { playbackCanvas } = getButtonActivationAnimationPreset(presetId);
  return normalizeButtonAnimationDesktopBounds({
    left: editorBounds.left,
    top: editorBounds.top - (
      editorBounds.height * playbackCanvas.topMarginSpriteHeights
    ),
    width: editorBounds.width,
    height: editorBounds.height * playbackCanvas.heightSpriteHeights
  });
}

export function resizeButtonAnimationEditorBounds(args: {
  presetId: ButtonActivationAnimationPresetId;
  bounds: ButtonDesktopBounds;
  direction: ButtonAnimationResizeDirection;
  cursor: { x: number; y: number };
  minimumWidth: number;
}): ButtonDesktopBounds {
  const bounds = normalizeButtonAnimationEditorBounds(args.presetId, args.bounds);
  const aspectRatio = getButtonAnimationAspectRatio(args.presetId);
  const minimumWidth = Math.max(1, Math.round(args.minimumWidth));
  const minimumHeight = Math.max(1, Math.round(minimumWidth / aspectRatio));
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const west = args.direction.includes("West");
  const east = args.direction.includes("East");
  const north = args.direction.includes("North");
  const south = args.direction.includes("South");

  let width: number;
  let height: number;
  if ((west || east) && (north || south)) {
    const requestedWidth = west
      ? right - args.cursor.x
      : args.cursor.x - bounds.left;
    const requestedHeight = north
      ? bottom - args.cursor.y
      : args.cursor.y - bounds.top;
    const projectedHeight = (
      Math.max(0, requestedWidth) * aspectRatio + Math.max(0, requestedHeight)
    ) / (aspectRatio * aspectRatio + 1);
    height = Math.max(minimumHeight, Math.round(projectedHeight));
    width = Math.max(minimumWidth, Math.round(height * aspectRatio));
    height = Math.max(minimumHeight, Math.round(width / aspectRatio));
  } else if (west || east) {
    const requestedWidth = west
      ? right - args.cursor.x
      : args.cursor.x - bounds.left;
    width = Math.max(minimumWidth, Math.round(requestedWidth));
    height = Math.max(minimumHeight, Math.round(width / aspectRatio));
  } else {
    const requestedHeight = north
      ? bottom - args.cursor.y
      : args.cursor.y - bounds.top;
    height = Math.max(minimumHeight, Math.round(requestedHeight));
    width = Math.max(minimumWidth, Math.round(height * aspectRatio));
    height = Math.max(minimumHeight, Math.round(width / aspectRatio));
  }

  return normalizeButtonAnimationDesktopBounds({
    left: west
      ? right - width
      : east
        ? bounds.left
        : centerX - width / 2,
    top: north
      ? bottom - height
      : south
        ? bounds.top
        : centerY - height / 2,
    width,
    height
  });
}

export function buildPlusRiseAnimationFrames(): ButtonActivationAnimationFrame[] {
  const peakOffset = 0.45;
  return Array.from({ length: PLUS_RISE_FRAME_COUNT }, (_, index) => {
    const offset = index / (PLUS_RISE_FRAME_COUNT - 1);
    const entering = offset <= peakOffset;
    const exitProgress = smootherStep((offset - peakOffset) / (1 - peakOffset));
    const scale = entering
      ? 0.46 + 0.54 * smootherStep(offset / peakOffset)
      : 1 - 0.64 * exitProgress;
    const opacity = entering
      ? smootherStep(offset / 0.32)
      : 1 - exitProgress;
    return {
      offset: roundMotionValue(offset),
      opacity: roundMotionValue(opacity),
      scale: roundMotionValue(scale),
      translateYPercent: roundMotionValue(150 * (peakOffset - offset))
    };
  });
}

export function canButtonRunActivationAnimation(button: ButtonRecord): boolean {
  return !button.disabled && Boolean(
    (button.executionTarget && button.toolSetBehavior?.execute !== false) ||
    button.role === "panel-owner" ||
    button.role === "tool-set-owner"
  );
}
