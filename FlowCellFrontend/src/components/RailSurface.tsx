import type { CSSProperties } from "react";

import {
  DEFAULT_APPEARANCE_SETTINGS,
  easingCss,
  type RailHoverMotionSettings
} from "../lib/appearanceSettings";
import type { RailRecord } from "../pages/main/mainLayout";

const REST_BLUR_PX = 34;

type RailSurfaceProps = {
  rail: RailRecord;
  isHovered?: boolean;
  motion?: RailHoverMotionSettings;
};

export function RailSurface({
  rail,
  isHovered = false,
  motion = DEFAULT_APPEARANCE_SETTINGS.railHover
}: RailSurfaceProps) {
  // The rail blur, drop, and transition stay inline: the current CSS build drops
  // backdrop-filter from the stylesheet, and inline values also keep the rest
  // state identical to before this hover effect existed (no drop, blur 34px).
  const durationMs = isHovered ? motion.dropDurationMs : motion.riseDurationMs;
  const easing = easingCss(isHovered ? motion.dropEasingId : motion.riseEasingId);
  const transition = [
    `transform ${durationMs}ms ${easing}`,
    `backdrop-filter ${durationMs}ms ${easing}`,
    `-webkit-backdrop-filter ${durationMs}ms ${easing}`
  ].join(", ");
  const blurPx = isHovered && motion.clearOnHover ? 0 : REST_BLUR_PX;

  const style: CSSProperties = {
    left: `${rail.x}px`,
    top: `${rail.y}px`,
    width: `${rail.width}px`,
    height: `${rail.height}px`,
    borderRadius: `${rail.radius ?? 0}px`,
    border: `${rail.strokeWidth}px solid ${rail.border}`,
    background: rail.background,
    backdropFilter: `blur(${blurPx}px)`,
    WebkitBackdropFilter: `blur(${blurPx}px)`,
    transition,
    // Only offset while hovered so the resting DOM matches the pre-effect layout.
    transform: isHovered ? `translateY(${motion.dropOffsetPx}px)` : undefined
  };

  return (
    <div
      className="rail-surface"
      data-rail-id={rail.id}
      data-rail-name={rail.name}
      style={style}
      aria-hidden="true"
    />
  );
}
