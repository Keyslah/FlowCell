import { useEffect, useMemo } from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  SMART_AXIS_BUTTON_BASE_HEIGHT,
  SMART_AXIS_BUTTON_BASE_WIDTH,
  resolveSmartAxisButtonLayout
} from "../smart-axis/smartAxisToolboxGeometry";

const BUTTON_HEIGHT = SMART_AXIS_BUTTON_BASE_HEIGHT;
const SMART_AXIS_BUTTON_WIDTH = SMART_AXIS_BUTTON_BASE_WIDTH;

type SmartAxisCommand = "baseline" | "cycle_x" | "cycle_y" | "cycle_z" | "toggle_live";

type SmartAxisAxisMode = "NONE" | "MIN" | "MAX";

export type SmartAxisToolboxState = {
  modes: {
    X: string;
    Y: string;
    Z: string;
  };
  liveEnabled: boolean;
  runnerActive: boolean;
  registered: boolean;
  lastMessage: string;
};

type SmartAxisButtonSpec = {
  slot: SmartAxisCommand;
  fallbackLabel: string;
  width: number;
  tooltip: string;
};

type ResolvedSmartAxisButtonSpec = {
  spec: SmartAxisButtonSpec;
  label: string;
  tooltip: string;
};

const BUTTON_SPECS: SmartAxisButtonSpec[] = [
  {
    slot: "baseline",
    fallbackLabel: "Base",
    width: SMART_AXIS_BUTTON_WIDTH,
    tooltip: "Store the current bounds as the Smart Axis baseline."
  },
  {
    slot: "cycle_x",
    fallbackLabel: "X",
    width: SMART_AXIS_BUTTON_WIDTH,
    tooltip: "Cycle X between none, minus, and plus."
  },
  {
    slot: "cycle_y",
    fallbackLabel: "Y",
    width: SMART_AXIS_BUTTON_WIDTH,
    tooltip: "Cycle Y between none, minus, and plus."
  },
  {
    slot: "cycle_z",
    fallbackLabel: "Z",
    width: SMART_AXIS_BUTTON_WIDTH,
    tooltip: "Cycle Z between none, minus, and plus."
  },
  {
    slot: "toggle_live",
    fallbackLabel: "Live",
    width: SMART_AXIS_BUTTON_WIDTH,
    tooltip: "Toggle Smart Axis live pinning."
  }
];

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function formatSmartAxisLabel(baseLabel: string, mode: string): string {
  switch ((mode || "").trim().toUpperCase()) {
    case "MIN":
    case "MINUS":
    case "NEGATIVE":
    case "-":
      return `${baseLabel}-`;
    case "MAX":
    case "PLUS":
    case "POSITIVE":
    case "+":
      return `${baseLabel}+`;
    default:
      return baseLabel;
  }
}

function isSelected(state: SmartAxisToolboxState, slot: SmartAxisCommand): boolean {
  if (slot === "toggle_live") {
    return state.liveEnabled;
  }
  if (slot === "cycle_x") {
    return state.modes.X !== "NONE";
  }
  if (slot === "cycle_y") {
    return state.modes.Y !== "NONE";
  }
  if (slot === "cycle_z") {
    return state.modes.Z !== "NONE";
  }
  return false;
}

function normalizeAxisMode(mode: string | undefined): SmartAxisAxisMode {
  const normalized = (mode || "").trim().toUpperCase();
  if (normalized === "MIN") {
    return "MIN";
  }
  if (normalized === "MAX") {
    return "MAX";
  }
  return "NONE";
}

function resolveButtonPalette(
  state: SmartAxisToolboxState,
  slot: SmartAxisCommand
): {
  fill: string;
  stroke: string;
  textFill: string;
} {
  if (slot === "toggle_live") {
    return state.liveEnabled
      ? {
          fill: "rgba(90, 31, 31, 0.85)",
          stroke: "rgba(255, 123, 123, 0.72)",
          textFill: "rgba(255, 240, 240, 0.98)"
        }
      : {
          fill: "rgba(43, 23, 23, 0.85)",
          stroke: "rgba(122, 59, 59, 0.5)",
          textFill: "rgba(255, 215, 215, 0.96)"
        };
  }

  const axisMode =
    slot === "cycle_x"
      ? normalizeAxisMode(state.modes.X)
      : slot === "cycle_y"
        ? normalizeAxisMode(state.modes.Y)
        : slot === "cycle_z"
          ? normalizeAxisMode(state.modes.Z)
          : "NONE";

  if (axisMode === "MIN") {
    return {
      fill: "rgba(36, 48, 27, 0.85)",
      stroke: "rgba(198, 221, 120, 0.62)",
      textFill: "rgba(244, 255, 226, 0.98)"
    };
  }

  if (axisMode === "MAX") {
    return {
      fill: "rgba(29, 44, 54, 0.85)",
      stroke: "rgba(125, 207, 255, 0.62)",
      textFill: "rgba(228, 247, 255, 0.98)"
    };
  }

  return {
    fill: "rgba(0, 0, 0, 0.85)",
    stroke: "rgba(255, 255, 255, 0.14)",
    textFill: "rgba(255, 255, 255, 0.96)"
  };
}

function resolveVisibleLabel(
  state: SmartAxisToolboxState,
  spec: SmartAxisButtonSpec,
  childRecord: PanelScriptChildRecord | undefined
): string {
  const baseLabel = childRecord?.label?.trim() || spec.fallbackLabel;
  switch (spec.slot) {
    case "cycle_x":
      return formatSmartAxisLabel(baseLabel, state.modes.X);
    case "cycle_y":
      return formatSmartAxisLabel(baseLabel, state.modes.Y);
    case "cycle_z":
      return formatSmartAxisLabel(baseLabel, state.modes.Z);
    default:
      return baseLabel;
  }
}

export function SmartAxisToolboxSurface({
  record,
  state,
  onAction,
  resolveLabelOverride,
  onLayoutResolved
}: {
  record: PanelScriptFileRecord;
  state: SmartAxisToolboxState;
  resolveLabelOverride?: (slot: string, fallbackLabel: string) => string | undefined;
  onLayoutResolved?: (layout: { width: number; height: number }) => void;
  onAction: (command: SmartAxisCommand) => void;
}) {
  const resolvedButtonSpecs = useMemo(
    () =>
      BUTTON_SPECS.map((spec) => {
        const childRecord = findChildRecord(record.children, spec.slot);
        const defaultLabel = resolveVisibleLabel(state, spec, childRecord);

        return {
          spec,
          label: resolveLabelOverride?.(spec.slot, defaultLabel) ?? defaultLabel,
          tooltip: childRecord?.tooltip?.trim() || spec.tooltip
        } satisfies ResolvedSmartAxisButtonSpec;
      }),
    [record.children, resolveLabelOverride, state]
  );

  const resolvedLayout = useMemo(() => {
    const defaultLayout = resolveSmartAxisButtonLayout(
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
        top: 0,
        rotationDeg: 0
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
      height: resolvedLayout.canvasHeight
    });
  }, [onLayoutResolved, resolvedLayout.canvasHeight, resolvedLayout.canvasWidth]);

  return (
    <section
      className="main-page__smart-axis-toolbox"
      aria-label={`${record.label} toolbox`}
      style={{
        position: "relative",
        display: "block",
        width: `${resolvedLayout.canvasWidth}px`,
        minWidth: `${resolvedLayout.canvasWidth}px`,
        maxWidth: `${resolvedLayout.canvasWidth}px`,
        height: `${resolvedLayout.canvasHeight}px`,
        minHeight: `${resolvedLayout.canvasHeight}px`,
        maxHeight: `${resolvedLayout.canvasHeight}px`,
        padding: "0",
        margin: "0"
      }}
    >
      <div
        className="main-page__smart-axis-row"
        style={{
          position: "relative",
          display: "block",
          width: `${resolvedLayout.canvasWidth}px`,
          minWidth: `${resolvedLayout.canvasWidth}px`,
          maxWidth: `${resolvedLayout.canvasWidth}px`,
          height: `${resolvedLayout.canvasHeight}px`,
          minHeight: `${resolvedLayout.canvasHeight}px`,
          maxHeight: `${resolvedLayout.canvasHeight}px`,
          padding: "0",
          margin: "0"
        }}
      >
      <svg
        aria-hidden="true"
        width={resolvedLayout.canvasWidth}
        height={resolvedLayout.canvasHeight}
        viewBox={`0 0 ${resolvedLayout.canvasWidth} ${resolvedLayout.canvasHeight}`}
        style={{
          position: "absolute",
          inset: "0",
          display: "block",
          overflow: "visible",
          pointerEvents: "none"
        }}
      >
        <title>{`${record.label} toolbox`}</title>
        {resolvedLayout.specs.map(({ spec, label, width, height, left, top }) => {
          const { fill, stroke, textFill } = resolveButtonPalette(state, spec.slot);
          const textX = left + width / 2;
          const textY = top + height / 2;

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
                fill={fill}
                stroke={stroke}
                strokeWidth={1}
              />
              <text
                x={textX}
                y={textY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textFill}
                fontFamily="Segoe UI, sans-serif"
                fontSize="14"
                fontWeight="600"
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {resolvedLayout.specs.map(({ spec, width, height, left, top, tooltip }) => (
        <button
          key={spec.slot}
          type="button"
          aria-label={tooltip}
          aria-pressed={isSelected(state, spec.slot)}
          data-flow-tooltip={tooltip}
          data-smart-axis-slot={spec.slot}
          data-selected={isSelected(state, spec.slot) ? "true" : "false"}
          className="main-page__smart-axis-button"
          style={{
            position: "absolute",
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            minWidth: `${width}px`,
            maxWidth: `${width}px`,
            minHeight: `${height}px`,
            height: `${height}px`,
            maxHeight: `${height}px`,
            margin: "0",
            padding: "0",
            border: "0",
            borderRadius: `${Math.min(width, height) / 2}px`,
            background: "transparent",
            appearance: "none",
            cursor: "pointer"
          }}
          onClick={() => {
            onAction(spec.slot);
          }}
        />
      ))}
      </div>
    </section>
  );
}
