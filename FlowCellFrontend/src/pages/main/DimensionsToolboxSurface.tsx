import { useEffect, useMemo } from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  DIMENSIONS_BUTTON_BASE_HEIGHT,
  DIMENSIONS_BUTTON_BASE_WIDTH,
  DIMENSIONS_STATUS_HEIGHT,
  resolveDimensionsButtonLayout
} from "../dimensions/dimensionsToolboxGeometry";

const BUTTON_HEIGHT = DIMENSIONS_BUTTON_BASE_HEIGHT;
const BUTTON_WIDTH = DIMENSIONS_BUTTON_BASE_WIDTH;

export type DimensionsAxis = "x" | "y" | "z";

export type DimensionsToolboxState = {
  selected: boolean;
  objectName: string;
  displayDimensions: Record<DimensionsAxis, string>;
  lastMessage: string;
};

type DimensionsButtonSpec = {
  slot: "dimension_x" | "dimension_y" | "dimension_z";
  axis: DimensionsAxis;
  fallbackLabel: string;
  width: number;
  tooltip: string;
};

type ResolvedDimensionsButtonSpec = {
  spec: DimensionsButtonSpec;
  label: string;
  value: string;
  tooltip: string;
};

const BUTTON_SPECS: DimensionsButtonSpec[] = [
  {
    slot: "dimension_x",
    axis: "x",
    fallbackLabel: "X",
    width: BUTTON_WIDTH,
    tooltip: "Display the active selected object's X dimension in inches."
  },
  {
    slot: "dimension_y",
    axis: "y",
    fallbackLabel: "Y",
    width: BUTTON_WIDTH,
    tooltip: "Display the active selected object's Y dimension in inches."
  },
  {
    slot: "dimension_z",
    axis: "z",
    fallbackLabel: "Z",
    width: BUTTON_WIDTH,
    tooltip: "Display the active selected object's Z dimension in inches."
  }
];

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function valueFontSize(value: string): number {
  if (value.length <= 10) {
    return 13;
  }
  return Math.max(9.5, 13 - (value.length - 10) * 0.45);
}

export function DimensionsToolboxSurface({
  record,
  state,
  onLayoutResolved
}: {
  record: PanelScriptFileRecord;
  state: DimensionsToolboxState;
  onLayoutResolved?: (layout: { width: number; height: number }) => void;
}) {
  const resolvedButtonSpecs = useMemo(
    () =>
      BUTTON_SPECS.map((spec) => {
        const childRecord = findChildRecord(record.children, spec.slot);
        const value = state.displayDimensions[spec.axis] || "-- in";

        return {
          spec,
          label: childRecord?.label?.trim() || spec.fallbackLabel,
          value,
          tooltip: childRecord?.tooltip?.trim() || spec.tooltip
        } satisfies ResolvedDimensionsButtonSpec;
      }),
    [record.children, state.displayDimensions]
  );

  const resolvedLayout = useMemo(() => {
    const defaultLayout = resolveDimensionsButtonLayout(
      resolvedButtonSpecs.map(({ spec }) => ({
        width: spec.width,
        height: BUTTON_HEIGHT
      }))
    );

    const resolvedSpecs = resolvedButtonSpecs.map((entry, index) => {
      const { spec } = entry;
      const width = spec.width;
      const height = BUTTON_HEIGHT;
      const left = defaultLayout.positions[index] ?? 0;

      return {
        ...entry,
        width,
        height,
        left,
        top: 0
      };
    });

    const canvasWidth = Math.max(
      1,
      Math.ceil(
        resolvedSpecs.reduce((maxRight, entry) => Math.max(maxRight, entry.left + entry.width), 0)
      )
    );
    const canvasHeight = Math.max(
      BUTTON_HEIGHT,
      Math.ceil(
        resolvedSpecs.reduce(
          (maxBottom, entry) => Math.max(maxBottom, entry.top + entry.height),
          0
        )
      )
    );

    return {
      canvasWidth,
      canvasHeight,
      specs: resolvedSpecs
    };
  }, [resolvedButtonSpecs]);

  useEffect(() => {
    onLayoutResolved?.({
      width: resolvedLayout.canvasWidth,
      height: resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT
    });
  }, [onLayoutResolved, resolvedLayout.canvasHeight, resolvedLayout.canvasWidth]);

  const statusText = state.selected ? "" : state.lastMessage || "Select an object";

  return (
    <section
      className="dimensions-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${resolvedLayout.canvasWidth}px`,
        minWidth: `${resolvedLayout.canvasWidth}px`,
        maxWidth: `${resolvedLayout.canvasWidth}px`,
        height: `${resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT}px`,
        minHeight: `${resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT}px`,
        maxHeight: `${resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT}px`
      }}
    >
      <svg
        aria-hidden="true"
        className="dimensions-toolbox-window-page__svg"
        width={resolvedLayout.canvasWidth}
        height={resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT}
        viewBox={`0 0 ${resolvedLayout.canvasWidth} ${
          resolvedLayout.canvasHeight + DIMENSIONS_STATUS_HEIGHT
        }`}
      >
        <title>{`${record.label} toolbox`}</title>
        <defs>
          <linearGradient id="dimensions-pill-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(0, 0, 0, 0.92)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0.86)" />
          </linearGradient>
        </defs>
        {resolvedLayout.specs.map(({ spec, label, value, width, height, left, top }) => {
          const textX = left + width / 2;
          const axisY = top + 15;
          const valueY = top + 31;
          const resolvedValueFontSize = valueFontSize(value);

          return (
            <g
              key={spec.slot}
              style={{ filter: "drop-shadow(0 10px 20px rgba(0, 0, 0, 0.32))" }}
            >
              <rect
                x={left}
                y={top}
                width={width}
                height={height}
                rx={Math.min(width, height) / 2}
                ry={Math.min(width, height) / 2}
                fill="url(#dimensions-pill-fill)"
                stroke="rgba(255, 255, 255, 0.14)"
                strokeWidth={1}
              />
              <text
                x={textX}
                y={axisY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255, 255, 255, 0.82)"
                fontFamily="Segoe UI, sans-serif"
                fontSize="10"
                fontWeight="700"
              >
                {label}
              </text>
              <text
                x={textX}
                y={valueY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255, 255, 255, 0.98)"
                fontFamily="Segoe UI, sans-serif"
                fontSize={resolvedValueFontSize}
                fontWeight="650"
                style={{ fontVariantNumeric: "tabular-nums" }}
                textLength={value.length > 13 ? width - 18 : undefined}
                lengthAdjust="spacingAndGlyphs"
              >
                {value}
              </text>
            </g>
          );
        })}
        <text
          x={resolvedLayout.canvasWidth / 2}
          y={resolvedLayout.canvasHeight + 9}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255, 255, 255, 0.7)"
          fontFamily="Segoe UI, sans-serif"
          fontSize="9"
          fontWeight="600"
        >
          {statusText}
        </text>
      </svg>
      {resolvedLayout.specs.map(({ spec, width, height, left, top, label, value, tooltip }) => (
        <button
          key={spec.slot}
          type="button"
          aria-label={`${label} dimension ${value}`}
          title={tooltip}
          data-dimensions-slot={spec.slot}
          className="dimensions-toolbox-window-page__button"
          style={{
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            borderRadius: `${Math.min(width, height) / 2}px`
          }}
        />
      ))}
    </section>
  );
}
