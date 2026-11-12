export const BUTTON_WINDOW_CLOSE_DELAY_MS = 3_000;
export const BUTTON_WINDOW_CLOSE_LEAVE_MS = 1_000;
export const BUTTON_WINDOW_CLOSE_SIZE = 56;
export const BUTTON_WINDOW_CLOSE_GAP = 10;

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

// Project X onto the perimeter of the resting Button bounds. Saved offsets and
// drag distance choose a point around the group, never a detached screen point.
export function constrainButtonWindowClosePosition(
  frame: { left: number; top: number; width: number; height: number },
  preferred: { left: number; top: number },
  viewport?: { width: number; height: number }
) {
  const left = frame.left - BUTTON_WINDOW_CLOSE_SIZE - BUTTON_WINDOW_CLOSE_GAP;
  const right = frame.left + frame.width + BUTTON_WINDOW_CLOSE_GAP;
  const top = frame.top - BUTTON_WINDOW_CLOSE_SIZE - BUTTON_WINDOW_CLOSE_GAP;
  const bottom = frame.top + frame.height + BUTTON_WINDOW_CLOSE_GAP;
  const minX = viewport ? 0 : -Infinity;
  const minY = viewport ? 0 : -Infinity;
  const maxX = viewport ? Math.max(0, viewport.width - BUTTON_WINDOW_CLOSE_SIZE) : Infinity;
  const maxY = viewport ? Math.max(0, viewport.height - BUTTON_WINDOW_CLOSE_SIZE) : Infinity;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const candidates: Array<{ left: number; top: number }> = [];
  for (const x of [left, right]) {
    if (x >= minX && x <= maxX && Math.max(top, minY) <= Math.min(bottom, maxY)) {
      candidates.push({ left: x, top: clamp(preferred.top, Math.max(top, minY), Math.min(bottom, maxY)) });
    }
  }
  for (const y of [top, bottom]) {
    if (y >= minY && y <= maxY && Math.max(left, minX) <= Math.min(right, maxX)) {
      candidates.push({ left: clamp(preferred.left, Math.max(left, minX), Math.min(right, maxX)), top: y });
    }
  }
  // A group filling the entire viewport leaves no room outside its bounds.
  // Keep X reachable in that case rather than placing it beyond the monitor.
  return candidates.reduce((closest, candidate) =>
    Math.hypot(candidate.left - preferred.left, candidate.top - preferred.top) <
      Math.hypot(closest.left - preferred.left, closest.top - preferred.top) ? candidate : closest,
  candidates[0] ?? { left: clamp(preferred.left, minX, maxX), top: clamp(preferred.top, minY, maxY) });
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
  const gap = BUTTON_WINDOW_CLOSE_GAP;
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
