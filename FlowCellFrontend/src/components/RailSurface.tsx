import type { CSSProperties } from "react";

import type { RailRecord } from "../pages/main/mainLayout";

type RailSurfaceProps = {
  rail: RailRecord;
};

export function RailSurface({ rail }: RailSurfaceProps) {
  const style: CSSProperties = {
    left: `${rail.x}px`,
    top: `${rail.y}px`,
    width: `${rail.width}px`,
    height: `${rail.height}px`,
    borderRadius: `${rail.radius ?? 0}px`,
    border: `${rail.strokeWidth}px solid ${rail.border}`,
    background: rail.background,
    // Keep the rail blur inline because the current CSS build drops backdrop-filter from the stylesheet.
    backdropFilter: "blur(34px)",
    WebkitBackdropFilter: "blur(34px)"
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
