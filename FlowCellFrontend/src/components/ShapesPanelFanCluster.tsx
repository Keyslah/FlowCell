import { useEffect, useMemo, type CSSProperties } from "react";
import type { FanClusterEntry, FanClusterPanelMetrics } from "./FanOutButtonCluster";

const BUTTON_SIZE = 51.2;

const SHAPE_SLOT_SPECS: Record<
  string,
  {
    dx: number;
    dy: number;
    closedRotate: number;
    openRotate: number;
    background: string;
    zIndex: number;
  }
> = {
  cone: {
    dx: -61.44,
    dy: 0,
    closedRotate: 90,
    openRotate: -90,
    background: "#ff7f50",
    zIndex: 30
  },
  cube: {
    dx: -36,
    dy: -52,
    closedRotate: 58,
    openRotate: -45,
    background: "#ffd700",
    zIndex: 35
  },
  cylinder: {
    dx: 0,
    dy: -72,
    closedRotate: -22,
    openRotate: 0,
    background: "#019b98",
    zIndex: 40
  },
  triangle: {
    dx: 36,
    dy: -52,
    closedRotate: -72,
    openRotate: 45,
    background: "#5b7cff",
    zIndex: 45
  },
  sphere: {
    dx: 61.44,
    dy: 0,
    closedRotate: -115,
    openRotate: 90,
    background: "#d94bff",
    zIndex: 50
  }
};

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function ShapesOwnerIcon() {
  return (
    <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="19" cy="43" rx="7" ry="2.5" fill="none" stroke="#ffffff" strokeWidth="3" />
      <path
        d="M14 42L19 28L24 42"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M32 17L40 21V29L32 33L24 29V21L32 17Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M32 17V25M40 21L32 25L24 21M32 25V33"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="47" cy="42" r="7" fill="none" stroke="#ffffff" strokeWidth="3" />
      <path
        d="M40 42H54M47 35C49.8 37.2 49.8 46.8 47 49M47 35C44.2 37.2 44.2 46.8 47 49"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShapeIcon({ shapeKey }: { shapeKey: string }) {
  switch (shapeKey) {
    case "cone":
      return (
        <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
          <ellipse cx="32" cy="47" rx="16" ry="5" fill="none" stroke="#ffffff" strokeWidth="4" />
          <path
            d="M20 46L32 16L44 46"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cube":
      return (
        <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
          <path
            d="M32 13L47 21V41L32 49L17 41V21L32 13Z"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinejoin="round"
          />
          <path
            d="M32 13V32M47 21L32 32L17 21M32 32V49"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "cylinder":
      return (
        <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
          <ellipse cx="32" cy="18" rx="15" ry="6" fill="none" stroke="#ffffff" strokeWidth="4" />
          <path
            d="M17 18V44C17 47.314 23.716 50 32 50C40.284 50 47 47.314 47 44V18"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
          />
          <path
            d="M17 44C17 47.314 23.716 50 32 50C40.284 50 47 47.314 47 44"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
          />
        </svg>
      );
    case "triangle":
      return (
        <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
          <path
            d="M32 15L48 46H16L32 15Z"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg className="shapes-panel-fan-cluster__icon" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" strokeWidth="4" />
          <path
            d="M14 32H50M32 14C39 20 39 44 32 50M32 14C25 20 25 44 32 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

function buildMetrics(entries: FanClusterEntry[]): FanClusterPanelMetrics & {
  childLayouts: Array<
    FanClusterPanelMetrics["childRects"][number] & {
      closedDx: number;
      closedDy: number;
      closedRotate: number;
      openRotate: number;
      background: string;
      zIndex: number;
      entry: FanClusterEntry;
    }
  >;
} {
  const ownerRect = {
    left: 0,
    top: 0,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE
  };
  const ownerCenterX = ownerRect.width / 2;
  const ownerCenterY = ownerRect.height / 2;
  const childRects = entries.map((entry) => {
    const shapeKey = normalizeLabel(entry.button.Label);
    const slot = SHAPE_SLOT_SPECS[shapeKey];
    const left = ownerCenterX + slot.dx - BUTTON_SIZE / 2;
    const top = ownerCenterY + slot.dy - BUTTON_SIZE / 2;
    return {
      left,
      top,
      width: BUTTON_SIZE,
      height: BUTTON_SIZE,
      closedRotate: slot.closedRotate,
      openRotate: slot.openRotate,
      background: slot.background,
      zIndex: slot.zIndex,
      entry
    };
  });

  const minLeft = Math.min(ownerRect.left, ...childRects.map((entry) => entry.left));
  const minTop = Math.min(ownerRect.top, ...childRects.map((entry) => entry.top));
  const maxRight = Math.max(
    ownerRect.left + ownerRect.width,
    ...childRects.map((entry) => entry.left + entry.width)
  );
  const maxBottom = Math.max(
    ownerRect.top + ownerRect.height,
    ...childRects.map((entry) => entry.top + entry.height)
  );
  const shiftX = minLeft < 0 ? -minLeft : 0;
  const shiftY = minTop < 0 ? -minTop : 0;
  const ownerLeft = ownerRect.left + shiftX;
  const ownerTop = ownerRect.top + shiftY;
  const shiftedOwnerCenterX = ownerLeft + ownerRect.width / 2;
  const shiftedOwnerCenterY = ownerTop + ownerRect.height / 2;

  const childLayouts = childRects.map((entry) => {
    const left = entry.left + shiftX;
    const top = entry.top + shiftY;
    return {
      left,
      top,
      width: entry.width,
      height: entry.height,
      closedDx: shiftedOwnerCenterX - (left + entry.width / 2),
      closedDy: shiftedOwnerCenterY - (top + entry.height / 2),
      closedRotate: entry.closedRotate,
      openRotate: entry.openRotate,
      background: entry.background,
      zIndex: entry.zIndex,
      entry: entry.entry
    };
  });

  return {
    windowWidth: Math.ceil(maxRight - minLeft),
    windowHeight: Math.ceil(maxBottom - minTop),
    ownerLeft,
    ownerTop,
    ownerWidth: ownerRect.width,
    ownerHeight: ownerRect.height,
    childRects: childLayouts.map(({ left, top, width, height }) => ({
      left,
      top,
      width,
      height
    })),
    childLayouts
  };
}

interface ShapesPanelFanClusterProps {
  ownerLabel: string;
  childButtons: FanClusterEntry[];
  windowExpanded: boolean;
  childrenVisible: boolean;
  suspendInteraction?: boolean;
  onExpandRequest?: () => void;
  onCollapseRequest?: () => void;
  onPanelFanMetricsChange?: (metrics: FanClusterPanelMetrics | null) => void;
  onOwnerClick: () => void;
  onChildClick: (entry: FanClusterEntry) => void;
}

export function ShapesPanelFanCluster({
  ownerLabel,
  childButtons,
  windowExpanded,
  childrenVisible,
  suspendInteraction = false,
  onExpandRequest,
  onCollapseRequest,
  onPanelFanMetricsChange,
  onOwnerClick,
  onChildClick
}: ShapesPanelFanClusterProps) {
  const orderedChildren = useMemo(() => {
    const order = ["cone", "cube", "cylinder", "triangle", "sphere"];
    return childButtons
      .filter((entry) => order.includes(normalizeLabel(entry.button.Label)))
      .sort(
        (left, right) =>
          order.indexOf(normalizeLabel(left.button.Label)) -
          order.indexOf(normalizeLabel(right.button.Label))
      );
  }, [childButtons]);

  const metrics = useMemo(() => buildMetrics(orderedChildren), [orderedChildren]);

  useEffect(() => {
    onPanelFanMetricsChange?.(metrics);
    return () => {
      onPanelFanMetricsChange?.(null);
    };
  }, [metrics, onPanelFanMetricsChange]);

  const requestExpand = () => {
    if (suspendInteraction) {
      return;
    }
    onExpandRequest?.();
  };

  const requestCollapse = () => {
    onCollapseRequest?.();
  };

  const rootStyle: CSSProperties = {
    width: `${windowExpanded ? metrics.windowWidth : metrics.ownerWidth}px`,
    height: `${windowExpanded ? metrics.windowHeight : metrics.ownerHeight}px`
  };

  const ownerStyle: CSSProperties = {
    left: `${windowExpanded ? metrics.ownerLeft : 0}px`,
    top: `${windowExpanded ? metrics.ownerTop : 0}px`,
    width: `${metrics.ownerWidth}px`,
    height: `${metrics.ownerHeight}px`,
    zIndex: 60
  };

  return (
    <div
      className={[
        "fan-cluster",
        "fan-cluster--panel-fan",
        "shapes-panel-fan-cluster",
        windowExpanded ? "is-window-open" : "",
        childrenVisible ? "is-open" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={rootStyle}
    >
      <div className="fan-cluster__stage">
        <button
          type="button"
          className="shapes-panel-fan-cluster__button shapes-panel-fan-cluster__button--owner"
          style={ownerStyle}
          aria-label={ownerLabel}
          title={ownerLabel}
          onPointerEnter={requestExpand}
          onPointerLeave={requestCollapse}
          onClick={onOwnerClick}
        >
          <ShapesOwnerIcon />
        </button>
        <div className="fan-cluster__children" aria-hidden={!childrenVisible}>
          {metrics.childLayouts.map((layout) => (
            <button
              key={layout.entry.childSlotId}
              type="button"
              className="shapes-panel-fan-cluster__button shapes-panel-fan-cluster__button--child"
              style={
                {
                  left: `${layout.left}px`,
                  top: `${layout.top}px`,
                  width: `${layout.width}px`,
                  height: `${layout.height}px`,
                  zIndex: layout.zIndex,
                  background: layout.background,
                  ["--closed-dx" as string]: `${layout.closedDx}px`,
                  ["--closed-dy" as string]: `${layout.closedDy}px`,
                  ["--closed-rotate" as string]: `${layout.closedRotate}deg`,
                  ["--open-rotate" as string]: `${layout.openRotate}deg`
                } satisfies CSSProperties
              }
              aria-label={layout.entry.button.Label}
              title={layout.entry.button.Tooltip || layout.entry.button.Label}
              onPointerEnter={requestExpand}
              onPointerLeave={requestCollapse}
              onClick={() => onChildClick(layout.entry)}
            >
              <ShapeIcon shapeKey={normalizeLabel(layout.entry.button.Label)} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
