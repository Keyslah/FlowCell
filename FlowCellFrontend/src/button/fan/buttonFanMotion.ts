import type {
  ButtonFanAnimationSettings,
  ButtonPlacement
} from "../types.js";

export type ButtonFanMotionStyle = "spin";
export type ButtonFanMotionDirection = "opening" | "closing";

export const BUTTON_FAN_MAX_STAGGER_WINDOW_MS = 240;

export interface ButtonFanMotionItem {
  placementId: string;
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
  delayMs: number;
  durationMs: number;
}

export function enabledButtonFanMotionStyles(
  animation: ButtonFanAnimationSettings | null | undefined
): ButtonFanMotionStyle[] {
  return animation?.spinEnabled === true ? ["spin"] : [];
}

export function resolveButtonFanMotionItems(args: {
  placements: readonly ButtonPlacement[];
  ownerPlacementId: string;
  animation: ButtonFanAnimationSettings;
  direction: ButtonFanMotionDirection;
  reducedMotion?: boolean;
}): ButtonFanMotionItem[] {
  const owner = args.placements.find((placement) => placement.id === args.ownerPlacementId);
  if (!owner) return [];

  const children = args.placements.filter((placement) => placement.id !== owner.id);
  const durationMs = args.reducedMotion
    ? 0
    : Number.isFinite(args.animation.durationMs)
      ? Math.max(0, args.animation.durationMs)
      : 0;
  const staggerMs = args.reducedMotion
    ? 0
    : Number.isFinite(args.animation.staggerMs)
      ? Math.max(0, args.animation.staggerMs)
      : 0;
  const effectiveStaggerMs = children.length <= 1
    ? 0
    : Math.min(staggerMs, BUTTON_FAN_MAX_STAGGER_WINDOW_MS / (children.length - 1));
  const ownerCenter = {
    x: owner.x + owner.width / 2,
    y: owner.y + owner.height / 2
  };

  return children.map((placement, index) => {
    const childCenter = {
      x: placement.x + placement.width / 2,
      y: placement.y + placement.height / 2
    };
    const staggerIndex = args.direction === "closing"
      ? children.length - index - 1
      : index;
    return {
      placementId: placement.id,
      offsetX: ownerCenter.x - childCenter.x,
      offsetY: ownerCenter.y - childCenter.y,
      rotationDeg: index % 2 === 0 ? -270 : 270,
      scale: 0.78,
      delayMs: staggerIndex * effectiveStaggerMs,
      durationMs
    };
  });
}

export function buttonFanCollapsedTransform(item: ButtonFanMotionItem): string {
  return `translate(${item.offsetX}px, ${item.offsetY}px) rotate(${item.rotationDeg}deg) scale(${item.scale})`;
}
