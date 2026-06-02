import { useEffect, useMemo, useRef, useState } from "react";
import type { PanelScriptChildRecord, PanelScriptFileRecord } from "../../lib/programRails";
import {
  REMESH_TOOLBOX_ACTION_TEXT_SIZE,
  REMESH_TOOLBOX_APPLY_BUTTON,
  REMESH_TOOLBOX_CANONICAL_HEIGHT,
  REMESH_TOOLBOX_CANONICAL_WIDTH,
  REMESH_TOOLBOX_CREATE_BUTTON,
  REMESH_TOOLBOX_EXPANDED_CANONICAL_HEIGHT,
  REMESH_TOOLBOX_MODE_RECT,
  REMESH_TOOLBOX_PRIMARY_VALUE_RECT,
  REMESH_TOOLBOX_SECONDARY_VALUE_RECT,
  REMESH_TOOLBOX_SHARPNESS_RECT,
  REMESH_TOOLBOX_THIRD_ROW_TEXT_SIZE,
  REMESH_TOOLBOX_TOGGLE_BUTTON,
  REMESH_TOOLBOX_TOP_ROW_TEXT_SIZE,
  REMESH_TOOLBOX_VALUE_TEXT_SIZE,
  REMESH_TOOLBOX_SVG_RECTS,
  REMESH_TOOLBOX_THRESHOLD_RECT,
  type RemeshToolboxRect
} from "../remesh/remeshToolboxGeometry";

export type RemeshMode = "VOXEL" | "SMOOTH" | "SHARP" | "BLOCKS";

export type RemeshToolboxState = {
  mode: RemeshMode;
  voxelSizeMm: number;
  adaptivity: number;
  smoothShading: boolean;
  octreeDepth: number;
  scale: number;
  removeDisconnected: boolean;
  threshold: number;
  sharpness: number;
};

export type RemeshToolboxCommand =
  | "mode_voxel"
  | "mode_smooth"
  | "mode_sharp"
  | "mode_blocks"
  | "set_voxel_size_mm"
  | "set_adaptivity"
  | "toggle_smooth_shading"
  | "set_octree_depth"
  | "set_scale"
  | "toggle_remove_disconnected"
  | "set_threshold"
  | "set_sharpness"
  | "create_update_remesh"
  | "apply_remesh";

const MODE_OPTIONS: Array<{
  mode: RemeshMode;
  slot: RemeshToolboxCommand;
  label: string;
  tooltip: string;
}> = [
  {
    mode: "VOXEL",
    slot: "mode_voxel",
    label: "Voxel",
    tooltip: "Use Voxel remesh mode."
  },
  {
    mode: "SMOOTH",
    slot: "mode_smooth",
    label: "Smooth",
    tooltip: "Use Smooth remesh mode."
  },
  {
    mode: "SHARP",
    slot: "mode_sharp",
    label: "Sharp",
    tooltip: "Use Sharp remesh mode."
  },
  {
    mode: "BLOCKS",
    slot: "mode_blocks",
    label: "Blocks",
    tooltip: "Use Blocks remesh mode."
  }
];

function findChildRecord(
  children: readonly PanelScriptChildRecord[] | undefined,
  slot: string
): PanelScriptChildRecord | undefined {
  return children?.find((child) => child.slot === slot);
}

function resolveChildLabel(
  record: PanelScriptFileRecord,
  slot: string,
  fallbackLabel: string
): string {
  return findChildRecord(record.children, slot)?.label?.trim() || fallbackLabel;
}

function resolveChildTooltip(
  record: PanelScriptFileRecord,
  slot: string,
  fallbackTooltip: string
): string {
  return findChildRecord(record.children, slot)?.tooltip?.trim() || fallbackTooltip;
}

function trimFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toFixed(digits);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseFloatValue(rawValue: string, min: number, max: number): number | null {
  const parsed = Number.parseFloat(rawValue.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clampNumber(parsed, min, max);
}

function parseIntValue(rawValue: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(clampNumber(parsed, min, max));
}

function modeLabel(mode: RemeshMode): string {
  switch (mode) {
    case "VOXEL":
      return "Voxel";
    case "SMOOTH":
      return "Smooth";
    case "SHARP":
      return "Sharp";
    case "BLOCKS":
      return "Blocks";
  }
}

type RemeshTooltip = {
  text: string;
  rect: RemeshToolboxRect;
};

const REMESH_TOOLTIP_ESTIMATED_HEIGHT = 8.25;

function resolveTooltipTop(rect: RemeshToolboxRect, surfaceHeight: number): number {
  const belowTop = rect.y + rect.height + 1;
  if (belowTop + REMESH_TOOLTIP_ESTIMATED_HEIGHT <= surfaceHeight) {
    return belowTop;
  }
  return Math.max(0.5, rect.y - REMESH_TOOLTIP_ESTIMATED_HEIGHT - 1);
}

function renderButton(args: {
  key: string;
  label: string;
  title: string;
  ariaLabel: string;
  rect: RemeshToolboxRect;
  fontSize: number;
  selected?: boolean;
  disabled?: boolean;
  onTooltipChange?: (tooltip: RemeshTooltip | null) => void;
  onClick: () => void;
}) {
  const {
    key,
    label,
    title,
    ariaLabel,
    rect,
    fontSize,
    selected,
    disabled,
    onTooltipChange,
    onClick
  } = args;
  const showTooltip = () => {
    const text = title.trim();
    onTooltipChange?.(text ? { text, rect } : null);
  };
  const hideTooltip = () => onTooltipChange?.(null);

  return (
    <button
      key={key}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected ? true : undefined}
      className="remesh-toolbox-window-page__button"
      data-selected={selected ? "true" : "false"}
      disabled={disabled}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${fontSize}px`
      }}
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onClick={onClick}
    >
      <span className="remesh-toolbox-window-page__button-label">{label}</span>
    </button>
  );
}

function EditableValueControl({
  rect,
  value,
  title,
  ariaLabel,
  command,
  fontSize,
  disabled,
  parseValue,
  onTooltipChange,
  onAction
}: {
  rect: RemeshToolboxRect;
  value: string;
  title: string;
  ariaLabel: string;
  command: RemeshToolboxCommand;
  fontSize: number;
  disabled?: boolean;
  parseValue: (rawValue: string) => number | null;
  onTooltipChange?: (tooltip: RemeshTooltip | null) => void;
  onAction: (command: RemeshToolboxCommand, payload?: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(value);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commitDraft = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }

    const parsed = parseValue(draft);
    if (parsed === null) {
      setDraft(value);
      return;
    }

    const current = parseValue(value);
    if (current === null || parsed !== current) {
      onAction(command, { value: parsed });
    }
  };
  const showTooltip = () => {
    const text = title.trim();
    onTooltipChange?.(text ? { text, rect } : null);
  };
  const hideTooltip = () => onTooltipChange?.(null);

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      className="remesh-toolbox-window-page__input"
      disabled={disabled}
      value={draft}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: `${Math.min(rect.rx, rect.ry)}px`,
        fontSize: `${fontSize}px`
      }}
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={(event) => {
        showTooltip();
        event.currentTarget.select();
      }}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      onBlur={() => {
        hideTooltip();
        commitDraft();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skipCommitRef.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function primaryValueConfig(state: RemeshToolboxState): {
  value: string;
  title: string;
  command: RemeshToolboxCommand;
  parseValue: (rawValue: string) => number | null;
} {
  if (state.mode === "VOXEL") {
    return {
      value: trimFixed(state.voxelSizeMm, 2),
      title: "Voxel size in millimeters.",
      command: "set_voxel_size_mm",
      parseValue: (rawValue) => parseFloatValue(rawValue, 0.001, 1000)
    };
  }

  return {
    value: String(state.octreeDepth),
    title: "Octree depth for Smooth, Sharp, and Blocks remesh modes.",
    command: "set_octree_depth",
    parseValue: (rawValue) => parseIntValue(rawValue, 1, 12)
  };
}

function secondaryValueConfig(state: RemeshToolboxState): {
  value: string;
  title: string;
  command: RemeshToolboxCommand;
  parseValue: (rawValue: string) => number | null;
} {
  if (state.mode === "VOXEL") {
    return {
      value: trimFixed(state.adaptivity, 2),
      title: "Adaptivity for Voxel remesh mode.",
      command: "set_adaptivity",
      parseValue: (rawValue) => parseFloatValue(rawValue, 0, 1)
    };
  }

  return {
    value: trimFixed(state.scale, 2),
    title: "Scale for Smooth, Sharp, and Blocks remesh modes.",
    command: "set_scale",
    parseValue: (rawValue) => parseFloatValue(rawValue, 0.1, 1)
  };
}

export function remeshNeedsThirdRow(state: RemeshToolboxState): boolean {
  return (state.mode !== "VOXEL" && state.removeDisconnected) || state.mode === "SHARP";
}

export function resolveRemeshToolboxSurfaceHeight(state: RemeshToolboxState): number {
  return remeshNeedsThirdRow(state)
    ? REMESH_TOOLBOX_EXPANDED_CANONICAL_HEIGHT
    : REMESH_TOOLBOX_CANONICAL_HEIGHT;
}

export function RemeshToolboxSurface({
  record,
  state,
  surfaceHeight = resolveRemeshToolboxSurfaceHeight(state),
  disabled = false,
  onAction
}: {
  record: PanelScriptFileRecord;
  state: RemeshToolboxState;
  surfaceHeight?: number;
  disabled?: boolean;
  onAction: (
    command: RemeshToolboxCommand,
    payload?: Record<string, unknown>
  ) => void;
}) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [tooltip, setTooltip] = useState<RemeshTooltip | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const primary = primaryValueConfig(state);
  const secondary = secondaryValueConfig(state);
  const nonVoxelMode = state.mode !== "VOXEL";
  const showThreshold = nonVoxelMode && state.removeDisconnected;
  const showSharpness = state.mode === "SHARP";
  const modeTooltip = "Choose Voxel, Smooth, Sharp, or Blocks remesh mode.";
  const resolvedModeOptions = useMemo(
    () =>
      MODE_OPTIONS.map((option) => ({
        ...option,
        label: resolveChildLabel(record, option.slot, option.label),
        tooltip: resolveChildTooltip(record, option.slot, option.tooltip)
      })),
    [record]
  );

  useEffect(() => {
    if (disabled) {
      setModeMenuOpen(false);
      setTooltip(null);
    }
  }, [disabled]);

  useEffect(() => {
    if (!modeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && surfaceRef.current?.contains(target)) {
        return;
      }
      setModeMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [modeMenuOpen]);

  return (
    <section
      ref={surfaceRef}
      className="remesh-toolbox-window-page__surface"
      aria-label={`${record.label} toolbox`}
      style={{
        width: `${REMESH_TOOLBOX_CANONICAL_WIDTH}px`,
        height: `${surfaceHeight}px`
      }}
    >
      <svg
        className="remesh-toolbox-window-page__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${REMESH_TOOLBOX_CANONICAL_WIDTH} ${surfaceHeight}`}
        aria-hidden="true"
      >
        <g>
          {REMESH_TOOLBOX_SVG_RECTS.map((rect, index) => (
            <rect
              key={`remesh-svg-rect-${index}`}
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

      <button
        type="button"
        className="remesh-toolbox-window-page__button remesh-toolbox-window-page__mode-button"
        aria-label="Remesh mode"
        aria-expanded={modeMenuOpen}
        aria-haspopup="menu"
        disabled={disabled}
        data-selected="true"
        style={{
          left: `${REMESH_TOOLBOX_MODE_RECT.x}px`,
          top: `${REMESH_TOOLBOX_MODE_RECT.y}px`,
          width: `${REMESH_TOOLBOX_MODE_RECT.width}px`,
          height: `${REMESH_TOOLBOX_MODE_RECT.height}px`,
          borderRadius: `${Math.min(REMESH_TOOLBOX_MODE_RECT.rx, REMESH_TOOLBOX_MODE_RECT.ry)}px`,
          fontSize: `${REMESH_TOOLBOX_TOP_ROW_TEXT_SIZE}px`
        }}
        onPointerEnter={() => {
          setTooltip({ text: modeTooltip, rect: REMESH_TOOLBOX_MODE_RECT });
        }}
        onPointerLeave={() => {
          setTooltip(null);
        }}
        onFocus={() => {
          setTooltip({ text: modeTooltip, rect: REMESH_TOOLBOX_MODE_RECT });
        }}
        onBlur={() => {
          setTooltip(null);
        }}
        onClick={() => {
          setTooltip(null);
          if (!disabled) {
            setModeMenuOpen((open) => !open);
          }
        }}
      >
        <span className="remesh-toolbox-window-page__button-label">{modeLabel(state.mode)}</span>
        <span className="remesh-toolbox-window-page__mode-caret" aria-hidden="true" />
      </button>

      {modeMenuOpen ? (
        <div
          className="remesh-toolbox-window-page__mode-menu"
          role="menu"
          aria-label="Remesh mode options"
        >
          {resolvedModeOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              className="remesh-toolbox-window-page__mode-option"
              aria-label={option.tooltip}
              role="menuitemradio"
              aria-checked={state.mode === option.mode}
              data-selected={state.mode === option.mode ? "true" : "false"}
              disabled={disabled}
              onPointerEnter={() => {
                setTooltip({ text: option.tooltip, rect: REMESH_TOOLBOX_TOGGLE_BUTTON.rect });
              }}
              onPointerLeave={() => {
                setTooltip(null);
              }}
              onFocus={() => {
                setTooltip({ text: option.tooltip, rect: REMESH_TOOLBOX_TOGGLE_BUTTON.rect });
              }}
              onBlur={() => {
                setTooltip(null);
              }}
              onClick={() => {
                setTooltip(null);
                setModeMenuOpen(false);
                if (state.mode !== option.mode) {
                  onAction(option.slot);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <EditableValueControl
        rect={REMESH_TOOLBOX_PRIMARY_VALUE_RECT}
        value={primary.value}
        title={primary.title}
        ariaLabel={primary.title}
        command={primary.command}
        fontSize={REMESH_TOOLBOX_VALUE_TEXT_SIZE}
        disabled={disabled}
        parseValue={primary.parseValue}
        onTooltipChange={setTooltip}
        onAction={onAction}
      />

      <EditableValueControl
        rect={REMESH_TOOLBOX_SECONDARY_VALUE_RECT}
        value={secondary.value}
        title={secondary.title}
        ariaLabel={secondary.title}
        command={secondary.command}
        fontSize={REMESH_TOOLBOX_VALUE_TEXT_SIZE}
        disabled={disabled}
        parseValue={secondary.parseValue}
        onTooltipChange={setTooltip}
        onAction={onAction}
      />

      {renderButton({
        key: nonVoxelMode ? "toggle_remove_disconnected" : REMESH_TOOLBOX_TOGGLE_BUTTON.slot,
        label: nonVoxelMode ? "RD" : "SS",
        title: nonVoxelMode
          ? "Toggle Remove Disconnected for Smooth, Sharp, and Blocks remesh modes."
          : resolveChildTooltip(
              record,
              REMESH_TOOLBOX_TOGGLE_BUTTON.slot,
              REMESH_TOOLBOX_TOGGLE_BUTTON.tooltip
            ),
        ariaLabel: nonVoxelMode ? "Toggle Remove Disconnected" : "Toggle Smooth Shading",
        rect: REMESH_TOOLBOX_TOGGLE_BUTTON.rect,
        fontSize: REMESH_TOOLBOX_ACTION_TEXT_SIZE,
        selected: nonVoxelMode ? state.removeDisconnected : state.smoothShading,
        disabled,
        onTooltipChange: setTooltip,
        onClick: () => {
          setTooltip(null);
          setModeMenuOpen(false);
          onAction(nonVoxelMode ? "toggle_remove_disconnected" : "toggle_smooth_shading");
        }
      })}

      {renderButton({
        key: REMESH_TOOLBOX_CREATE_BUTTON.slot,
        label: resolveChildLabel(
          record,
          REMESH_TOOLBOX_CREATE_BUTTON.slot,
          REMESH_TOOLBOX_CREATE_BUTTON.fallbackLabel
        ),
        title: resolveChildTooltip(
          record,
          REMESH_TOOLBOX_CREATE_BUTTON.slot,
          REMESH_TOOLBOX_CREATE_BUTTON.tooltip
        ),
        ariaLabel: resolveChildTooltip(
          record,
          REMESH_TOOLBOX_CREATE_BUTTON.slot,
          REMESH_TOOLBOX_CREATE_BUTTON.tooltip
        ),
        rect: REMESH_TOOLBOX_CREATE_BUTTON.rect,
        fontSize: REMESH_TOOLBOX_ACTION_TEXT_SIZE,
        disabled,
        onTooltipChange: setTooltip,
        onClick: () => {
          setTooltip(null);
          setModeMenuOpen(false);
          onAction("create_update_remesh");
        }
      })}

      {renderButton({
        key: REMESH_TOOLBOX_APPLY_BUTTON.slot,
        label: resolveChildLabel(
          record,
          REMESH_TOOLBOX_APPLY_BUTTON.slot,
          REMESH_TOOLBOX_APPLY_BUTTON.fallbackLabel
        ),
        title: resolveChildTooltip(
          record,
          REMESH_TOOLBOX_APPLY_BUTTON.slot,
          REMESH_TOOLBOX_APPLY_BUTTON.tooltip
        ),
        ariaLabel: resolveChildTooltip(
          record,
          REMESH_TOOLBOX_APPLY_BUTTON.slot,
          REMESH_TOOLBOX_APPLY_BUTTON.tooltip
        ),
        rect: REMESH_TOOLBOX_APPLY_BUTTON.rect,
        fontSize: REMESH_TOOLBOX_ACTION_TEXT_SIZE,
        disabled,
        onTooltipChange: setTooltip,
        onClick: () => {
          setTooltip(null);
          setModeMenuOpen(false);
          onAction("apply_remesh");
        }
      })}

      {showThreshold ? (
        <EditableValueControl
          rect={REMESH_TOOLBOX_THRESHOLD_RECT}
          value={trimFixed(state.threshold, 2)}
          title="Threshold for removing disconnected remesh components."
          ariaLabel="Remove Disconnected threshold"
          command="set_threshold"
          fontSize={REMESH_TOOLBOX_THIRD_ROW_TEXT_SIZE}
          disabled={disabled}
          parseValue={(rawValue) => parseFloatValue(rawValue, 0, 1)}
          onTooltipChange={setTooltip}
          onAction={onAction}
        />
      ) : null}

      {showSharpness ? (
        <EditableValueControl
          rect={REMESH_TOOLBOX_SHARPNESS_RECT}
          value={trimFixed(state.sharpness, 2)}
          title="Sharpness for Sharp remesh mode."
          ariaLabel="Sharp remesh sharpness"
          command="set_sharpness"
          fontSize={REMESH_TOOLBOX_THIRD_ROW_TEXT_SIZE}
          disabled={disabled}
          parseValue={(rawValue) => parseFloatValue(rawValue, 0, 10)}
          onTooltipChange={setTooltip}
          onAction={onAction}
        />
      ) : null}

      {tooltip ? (
        <div
          className="remesh-toolbox-window-page__tooltip"
          role="tooltip"
          style={{
            top: `${resolveTooltipTop(tooltip.rect, surfaceHeight)}px`
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </section>
  );
}
