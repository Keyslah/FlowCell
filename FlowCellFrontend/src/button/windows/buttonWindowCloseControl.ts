export const BUTTON_WINDOW_CLOSE_DELAY_MS = 3_000;
export const BUTTON_WINDOW_CLOSE_LEAVE_MS = 1_000;
export const BUTTON_WINDOW_CLOSE_SIZE = 56;

// Physical pixels relative to the containing window's semantic content frame.
export interface ButtonWindowCloseOffset { x: number; y: number }

export function isButtonWindowCloseOffset(value: unknown): value is ButtonWindowCloseOffset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return Object.keys(point).every((key) => key === "x" || key === "y") &&
    typeof point.x === "number" && Number.isFinite(point.x) &&
    typeof point.y === "number" && Number.isFinite(point.y);
}

export function closeControlPositionFromOffset(
  frame: { left: number; top: number }, offset: ButtonWindowCloseOffset, pixelRatio: number
) {
  return { left: frame.left + offset.x / pixelRatio, top: frame.top + offset.y / pixelRatio };
}

export function closeControlOffsetFromPosition(
  frame: { left: number; top: number }, position: { left: number; top: number }, pixelRatio: number
): ButtonWindowCloseOffset {
  return { x: (position.left - frame.left) * pixelRatio, y: (position.top - frame.top) * pixelRatio };
}

// Preserve hover-open windows during the short trip across transparent space to X.
// Timers are event driven; no additional native cursor sampler is needed.
export function createButtonWindowCloseHover(callbacks: {
  onVisible: (visible: boolean) => void;
  onHover: (hovered: boolean) => void;
}) {
  let target: object | null = null;
  let visible = false;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelReveal = () => {
    clearTimeout(revealTimer);
    revealTimer = undefined;
  };
  const cancelLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = undefined;
  };
  return {
    buttonTarget(next: object | null) {
      if (next === target) return;
      target = next;
      cancelReveal();
      if (next && !visible) {
        revealTimer = setTimeout(() => {
          revealTimer = undefined;
          visible = true;
          callbacks.onVisible(true);
        }, BUTTON_WINDOW_CLOSE_DELAY_MS);
      }
    },
    hover(hovered: boolean) {
      cancelLeave();
      if (hovered) {
        callbacks.onHover(true);
      } else {
        target = null;
        cancelReveal();
        if (visible) {
          leaveTimer = setTimeout(() => {
            leaveTimer = undefined;
            visible = false;
            callbacks.onVisible(false);
            callbacks.onHover(false);
          }, BUTTON_WINDOW_CLOSE_LEAVE_MS);
        } else {
          callbacks.onHover(false);
        }
      }
    },
    reset() {
      cancelReveal();
      cancelLeave();
      target = null;
      visible = false;
      callbacks.onVisible(false);
    }
  };
}

export function buttonWindowClosePosition(
  frame: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number }
) {
  const size = BUTTON_WINDOW_CLOSE_SIZE;
  const gap = 10;
  let left = frame.left + frame.width + gap;
  let top = frame.top;
  if (left + size > viewport.width - gap) {
    left = frame.left - size - gap;
    if (left < gap) {
      left = frame.left + frame.width - size;
      top = frame.top - size - gap;
      if (top < gap) top = frame.top + frame.height + gap;
    }
  }
  return {
    left: Math.max(gap, Math.min(left, viewport.width - size - gap)),
    top: Math.max(gap, Math.min(top, viewport.height - size - gap))
  };
}
