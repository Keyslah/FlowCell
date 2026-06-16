import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  ILLUSTRATOR_ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE,
  ILLUSTRATOR_ROTATE_TOOLBOX_BUTTON_SPECS,
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT,
  ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH,
  ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_RECT,
  ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_TEXT_SIZE,
  ILLUSTRATOR_ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE,
  ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS,
  ILLUSTRATOR_ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE,
  ROTATE_TOOLBOX_BUTTON_SPECS,
  ROTATE_TOOLBOX_CANONICAL_HEIGHT,
  ROTATE_TOOLBOX_CANONICAL_WIDTH,
  ROTATE_TOOLBOX_CENTER_ROW_TEXT_SIZE,
  ROTATE_TOOLBOX_INPUT_TEXT_SIZE,
  ROTATE_TOOLBOX_INPUT_RECT,
  ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE,
  ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE,
  ROTATE_TOOLBOX_SVG_RECTS,
  ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE,
  type RotateToolboxButtonSpec,
  type RotateToolboxSlot
} from "../rotate/rotateToolboxGeometry";

type RotateToolboxState = {
  axis: "X" | "Y" | "Z";
  angleDeg: number;
  centerMode: "GEOMETRY" | "ORIGIN" | "WORLD" | "CURSOR" | "OBJECT";
  operationMode: "TRANSFORM" | "DISTRIBUTE";
  distributeCount: number;
};

type RotateToolboxVariant = "blender" | "illustrator";
type RotateSlot = RotateToolboxSlot;

export type { RotateToolboxState };

interface RotateToolboxSurfaceProps {
  record: PanelScriptFileRecord;
  state: RotateToolboxState;
  onStateChange: (nextState: RotateToolboxState) => void;
  onApply: (
    direction: "negative" | "positive",
    stateOverride?: RotateToolboxState
  ) => void;
  disabled?: boolean;
  resolveLabelOverride?: (slot: string, fallbackLabel: string) => string | undefined;
  variant?: RotateToolboxVariant;
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}

function sanitizeTransformAngleInput(rawValue: string): number {
  const sanitized = rawValue.replace(/[^0-9.]/g, "");
  if (!sanitized) {
    return 0;
  }

  const parts = sanitized.split(".");
  const normalized = parts[0] + (parts.length > 1 ? `.${parts.slice(1).join("")}` : "");
  const nextAngle = Number.parseFloat(normalized);
  return Number.isFinite(nextAngle) ? normalizeAngle(nextAngle) : 0;
}

function sanitizeDistributeCountInput(rawValue: string): number {
  const digitsOnly = rawValue.replace(/[^0-9]/g, "");
  const nextCount = digitsOnly.length > 0 ? Number.parseInt(digitsOnly, 10) : 0;
  return Number.isFinite(nextCount) ? nextCount : 0;
}

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function fallbackRotateLabel(slot: RotateSlot, variant: RotateToolboxVariant): string {
  switch (slot) {
    case "axis_z":
      return "Z";
    case "axis_y":
      return "Y";
    case "axis_x":
      return "X";
    case "preset_30":
      return "30 deg";
    case "preset_45":
      return "45 deg";
    case "preset_90":
      return "90 deg";
    case "preset_180":
      return "180 deg";
    case "preset_270":
      return "270 deg";
    case "center_geometry":
      return "Geometry";
    case "center_origin":
      return "Origin";
    case "center_world":
      if (variant === "illustrator") {
        return "Art";
      }
      return "World";
    case "center_cursor":
      if (variant === "illustrator") {
        return "Anchor";
      }
      return "Cursor";
    case "center_object":
      return "Object";
    case "mode_transform":
      return "Transform";
    case "mode_distribute":
      return "Distribute";
    case "apply_negative":
      return "Negative";
    case "apply_positive":
      return "Positive";
  }
}

function formatRotateButtonLabel(slot: RotateSlot, label: string): string {
  if (slot === "center_geometry") {
    return "Geo";
  }

  if (!slot.startsWith("preset_")) {
    return label;
  }

  const degreesMatch = label.match(/(\d+(?:\.\d+)?)/);
  if (degreesMatch) {
    return `${degreesMatch[1]}\u00B0`;
  }

  return label.replace(/\s*deg(?:rees?)?/i, "\u00B0");
}

function isSelectedSlot(state: RotateToolboxState, slot: RotateSlot): boolean {
  switch (slot) {
    case "axis_x":
      return state.axis === "X";
    case "axis_y":
      return state.axis === "Y";
    case "axis_z":
      return state.axis === "Z";
    case "center_geometry":
      return state.centerMode === "GEOMETRY";
    case "center_origin":
      return state.centerMode === "ORIGIN";
    case "center_world":
      return state.centerMode === "WORLD";
    case "center_cursor":
      return state.centerMode === "CURSOR";
    case "center_object":
      return state.centerMode === "OBJECT";
    case "mode_transform":
      return state.operationMode === "TRANSFORM";
    case "mode_distribute":
      return state.operationMode === "DISTRIBUTE";
    default:
      return false;
  }
}

function nextStateForSlot(
  state: RotateToolboxState,
  slot: RotateSlot,
  variant: RotateToolboxVariant
): RotateToolboxState {
  const presetAngle = presetAngleForSlot(slot);
  if (variant === "illustrator" && presetAngle !== null) {
    return { ...state, angleDeg: presetAngle, operationMode: "TRANSFORM" };
  }

  switch (slot) {
    case "axis_x":
      return { ...state, axis: "X" };
    case "axis_y":
      return { ...state, axis: "Y" };
    case "axis_z":
      return { ...state, axis: "Z" };
    case "preset_30":
      return { ...state, angleDeg: 30, operationMode: "TRANSFORM" };
    case "preset_45":
      return { ...state, angleDeg: 45, operationMode: "TRANSFORM" };
    case "preset_90":
      return { ...state, angleDeg: 90, operationMode: "TRANSFORM" };
    case "preset_180":
      return { ...state, angleDeg: 180, operationMode: "TRANSFORM" };
    case "preset_270":
      return { ...state, angleDeg: 270, operationMode: "TRANSFORM" };
    case "center_geometry":
      return { ...state, centerMode: "GEOMETRY" };
    case "center_origin":
      return { ...state, centerMode: "ORIGIN" };
    case "center_world":
      return { ...state, centerMode: "WORLD" };
    case "center_cursor":
      return { ...state, centerMode: "CURSOR" };
    case "center_object":
      return { ...state, centerMode: "OBJECT" };
    case "mode_transform":
      return { ...state, operationMode: "TRANSFORM" };
    case "mode_distribute":
      return { ...state, operationMode: "DISTRIBUTE" };
    default:
      return state;
  }
}

function presetAngleForSlot(slot: RotateSlot): number | null {
  switch (slot) {
    case "preset_30":
      return 30;
    case "preset_45":
      return 45;
    case "preset_90":
      return 90;
    case "preset_180":
      return 180;
    case "preset_270":
      return 270;
    default:
      return null;
  }
}

function resolveButtonSize(width: number): "small" | "medium" | "large" {
  if (width <= 60) {
    return "small";
  }
  if (width <= 100) {
    return "medium";
  }
  return "large";
}

function resolveRotateButtonTextSize(slot: RotateSlot, variant: RotateToolboxVariant): number {
  if (variant === "illustrator") {
    switch (slot) {
      case "center_world":
      case "center_cursor":
      case "preset_30":
      case "preset_45":
      case "preset_90":
        return ILLUSTRATOR_ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE;
      case "mode_transform":
      case "mode_distribute":
        return ILLUSTRATOR_ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE;
      case "apply_negative":
      case "apply_positive":
        return ILLUSTRATOR_ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE;
      default:
        return ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE;
    }
  }

  switch (slot) {
    case "axis_x":
    case "axis_y":
    case "axis_z":
    case "preset_30":
    case "preset_45":
    case "preset_90":
    case "preset_180":
    case "preset_270":
      return ROTATE_TOOLBOX_TOP_ROW_TEXT_SIZE;
    case "center_geometry":
    case "center_origin":
    case "center_world":
    case "center_cursor":
    case "center_object":
      return ROTATE_TOOLBOX_CENTER_ROW_TEXT_SIZE;
    case "mode_transform":
    case "mode_distribute":
      return ROTATE_TOOLBOX_MODE_ROW_TEXT_SIZE;
    case "apply_negative":
    case "apply_positive":
      return ROTATE_TOOLBOX_APPLY_ROW_TEXT_SIZE;
  }
}

export function RotateToolboxSurface({
  record,
  state,
  onStateChange,
  onApply,
  disabled = false,
  resolveLabelOverride,
  variant = "blender"
}: RotateToolboxSurfaceProps) {
  const isIllustratorVariant = variant === "illustrator";
  const buttonSpecs: readonly RotateToolboxButtonSpec[] = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_BUTTON_SPECS
    : ROTATE_TOOLBOX_BUTTON_SPECS;
  const svgRects = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_SVG_RECTS
    : ROTATE_TOOLBOX_SVG_RECTS;
  const inputRect = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_RECT
    : ROTATE_TOOLBOX_INPUT_RECT;
  const surfaceWidth = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_WIDTH
    : ROTATE_TOOLBOX_CANONICAL_WIDTH;
  const surfaceHeight = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_CANONICAL_HEIGHT
    : ROTATE_TOOLBOX_CANONICAL_HEIGHT;
  const inputTextSize = isIllustratorVariant
    ? ILLUSTRATOR_ROTATE_TOOLBOX_INPUT_TEXT_SIZE
    : ROTATE_TOOLBOX_INPUT_TEXT_SIZE;
  const isDistributeMode = state.operationMode === "DISTRIBUTE";
  const usesDistributeCountInput = isDistributeMode;
  const quantityTitle = isDistributeMode
    ? "Total positions to end up with, including the original selection."
    : "Angle in degrees.";
  const quantityValue = usesDistributeCountInput
    ? String(state.distributeCount)
    : String(normalizeAngle(state.angleDeg));
  const handleButtonActivate = (slot: RotateSlot) => {
    if (disabled) {
      return;
    }

    if (slot === "apply_negative") {
      onApply("negative");
      return;
    }

    if (slot === "apply_positive") {
      onApply("positive");
      return;
    }

    const nextState = nextStateForSlot(state, slot, variant);
    if (nextState !== state) {
      onStateChange(nextState);
    }

    if (presetAngleForSlot(slot) !== null) {
      onApply("positive", nextState);
    }
  };

  return (
    <section
      className="rotate-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${surfaceWidth}px`,
        height: `${surfaceHeight}px`
      }}
    >
      <svg
        className="rotate-toolbox-window-page__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${surfaceWidth} ${surfaceHeight}`}
        aria-hidden="true"
      >
        <g>
          {svgRects.map((rect, index) => (
            <rect
              key={`rotate-svg-rect-${index}`}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={rect.rx}
              ry={rect.ry}
              fill="none"
              stroke="none"
            />
          ))}
        </g>
      </svg>

      <label
        className="rotate-toolbox-window-page__field"
        data-flow-tooltip={quantityTitle}
        style={{
          left: `${inputRect.x}px`,
          top: `${inputRect.y}px`,
          width: `${inputRect.width}px`,
          height: `${inputRect.height}px`,
          borderRadius: `${Math.min(inputRect.rx, inputRect.ry)}px`
        }}
      >
        <span className="sr-only">{isDistributeMode ? "Distribute count" : "Angle in degrees"}</span>
        <input
          className="rotate-toolbox-window-page__field-input"
          type="text"
          disabled={disabled}
          inputMode={usesDistributeCountInput ? "numeric" : "decimal"}
          pattern={usesDistributeCountInput ? "[0-9]*" : "[0-9]*[.]?[0-9]*"}
          style={{ fontSize: `${inputTextSize}px` }}
          value={quantityValue}
          onChange={(event) => {
            if (usesDistributeCountInput) {
              onStateChange({
                ...state,
                distributeCount: sanitizeDistributeCountInput(event.target.value)
              });
              return;
            }

            onStateChange({
              ...state,
              angleDeg: sanitizeTransformAngleInput(event.target.value)
            });
          }}
        />
      </label>

      {buttonSpecs.map((spec) => {
        const childRecord = findChildRecord(record.children, spec.slot);
        const defaultVisibleLabel = formatRotateButtonLabel(
          spec.slot,
          childRecord?.label?.trim() || fallbackRotateLabel(spec.slot, variant)
        );
        const label =
          resolveLabelOverride?.(spec.slot, defaultVisibleLabel) ?? defaultVisibleLabel;
        const tooltip = childRecord?.tooltip?.trim() || defaultVisibleLabel;
        const selected = isSelectedSlot(state, spec.slot);

        return (
          <button
            key={spec.slot}
            type="button"
            aria-label={label}
            aria-pressed={selected ? true : undefined}
            className="rotate-toolbox-window-page__button"
            data-flow-tooltip={tooltip}
            data-size={resolveButtonSize(spec.rect.width)}
            data-selected={selected ? "true" : "false"}
            style={{
              left: `${spec.rect.x}px`,
              top: `${spec.rect.y}px`,
              width: `${spec.rect.width}px`,
              height: `${spec.rect.height}px`,
              borderRadius: `${Math.min(spec.rect.rx, spec.rect.ry)}px`,
              fontSize: `${resolveRotateButtonTextSize(spec.slot, variant)}px`
            }}
            onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
              if (event.button !== 0) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              handleButtonActivate(spec.slot);
            }}
            onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
              if (event.detail === 0) {
                handleButtonActivate(spec.slot);
                return;
              }

              event.preventDefault();
              event.stopPropagation();
            }}
            disabled={disabled}
          >
            <span className="rotate-toolbox-window-page__button-label">{label}</span>
          </button>
        );
      })}
    </section>
  );
}
