import type { CSSProperties } from "react";

import {
  DEFAULT_MOTION_SETTINGS,
  easingCss,
  type RailHoverMotionSettings
} from "../lib/motionSettings";
import {
  MAIN_PAGE_BASE_OFFSET,
  RAIL_SLAB_BLEED_PX,
  pageFrame,
  type RailRecord
} from "../pages/main/mainLayout";

const REST_BLUR_PX = 34;

type RailSurfaceProps = {
  rail: RailRecord;
  isHovered?: boolean;
  motion?: RailHoverMotionSettings;
};

export function RailSurface({
  rail,
  isHovered = false,
  motion = DEFAULT_MOTION_SETTINGS.railHover
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

  const cssRailId = rail.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  // A rendered page look (Chipped Concrete) draws each rail as a raised slab picture in its own
  // layer under the rail, because the slab's front edge, broken chunks and shadow reach past the
  // rail, which clips. That look also turns the blur off and the preset clears the rail fill.
  // Without a slab picture the layer stays empty and the rail is exactly as before.
  const backdrop = `var(--flowcell-main-rail-backdrop-filter, blur(${blurPx}px))`;
  const style: CSSProperties = {
    left: `${rail.x}px`,
    top: `${rail.y}px`,
    width: `${rail.width}px`,
    height: `${rail.height}px`,
    borderRadius: `${rail.radius ?? 0}px`,
    border: `${rail.strokeWidth}px solid var(--flowcell-main-rail-${cssRailId}-border, ${rail.border})`,
    background: `var(--flowcell-main-rail-${cssRailId}-background, ${rail.background})`,
    backdropFilter: backdrop,
    WebkitBackdropFilter: backdrop,
    transition,
    // Only offset while hovered so the resting DOM matches the pre-effect layout.
    transform: isHovered ? `translateY(${motion.dropOffsetPx}px)` : undefined
  };
  const slabLeft = rail.x - RAIL_SLAB_BLEED_PX;
  const slabTop = rail.y - RAIL_SLAB_BLEED_PX;
  const slabStyle: CSSProperties = {
    left: `${slabLeft}px`,
    top: `${slabTop}px`,
    width: `${rail.width + 2 * RAIL_SLAB_BLEED_PX}px`,
    height: `${rail.height + 2 * RAIL_SLAB_BLEED_PX}px`,
    background: `var(--flowcell-main-rail-${cssRailId}-slab, none)`,
    // The page's base slab (when the look has one) masks the rail's shadow to the base's edge.
    // The mask is the base picture, which covers the window's whole frame, so it is pinned there.
    maskImage: "var(--flowcell-main-base-mask, none)",
    maskSize: `${pageFrame.width}px ${pageFrame.height}px`,
    maskPosition: `${-(MAIN_PAGE_BASE_OFFSET.left + slabLeft)}px ${-(MAIN_PAGE_BASE_OFFSET.top + slabTop)}px`,
    maskRepeat: "no-repeat"
  };

  return (
    <>
      <div
        className="rail-surface__slab"
        data-rail-id={rail.id}
        style={slabStyle}
        aria-hidden="true"
      />
      <div
        className="rail-surface"
        data-rail-id={rail.id}
        data-rail-name={rail.name}
        style={style}
        aria-hidden="true"
      />
    </>
  );
}
