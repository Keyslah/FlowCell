import type { ImportedSkin, StyleGroup } from "../types";
import { HostSkinButton } from "./HostSkinButton";

interface ToolSkinProps {
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
}

interface AlignmentToolSurfaceProps {
  ownerLabel: string;
  panelName: string;
  compact?: boolean;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  modifiers: {
    X: string;
    Y: string;
    Z: string;
  };
  onAction: (
    axis: "X" | "Y" | "Z" | "ALL",
    action: "min" | "center" | "max" | "surface" | "geo" | "center_everything"
  ) => void;
}

interface FlattenRevolveValues {
  FlattenAxis: string;
  RevolveAxis: string;
  CenterMode: string;
  AngleDeg: number;
  RevolveSteps: number;
  MergeDistance: number;
}

interface FlattenRevolveToolSurfaceProps {
  ownerLabel: string;
  panelName: string;
  compact?: boolean;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  values: FlattenRevolveValues;
  onValueChange: (
    field: keyof FlattenRevolveValues,
    value: string | number
  ) => void;
  onAction: (action: "flatten_profile" | "generate_revolve") => void;
}

interface QuickRotateGroupValues {
  Axis: string;
  AngleDeg: number;
  DistributeCount: number;
  CenterMode: string;
  OperationMode: string;
}

interface HdriWorldToolValues {
  HdriPath: string;
  StaticBackgroundPath: string;
  ThemeImagePath: string;
  ThemePaletteHexes: string[];
  ThemeVisualMode: "dark" | "light";
  ThemeHeadersHex: string;
  ThemeTextHex: string;
  ThemeSectionFillHex: string;
  ThemeControlsHex: string;
  ThemeMiscHex: string;
  ThemeDarksHex: string;
  ThemeHighlightsHex: string;
  ThemeViewportBackgroundHex: string;
  ThemeViewportGradientEnabled: boolean;
  ThemeViewportGradientHex: string;
  RotationXDeg: number;
  RotationYDeg: number;
  RotationZDeg: number;
  WorldStrength: number;
}

interface QuickRotateGroupToolSurfaceProps {
  ownerLabel: string;
  panelName: string;
  compact?: boolean;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  values: QuickRotateGroupValues;
  onValueChange: (
    field: keyof QuickRotateGroupValues,
    value: string | number
  ) => void;
  onPresetApply: (angleDeg: number) => void;
  onApply: (direction: "negative" | "positive", values: QuickRotateGroupValues) => void;
}

interface HdriWorldToolSurfaceProps {
  ownerLabel: string;
  panelName: string;
  compact?: boolean;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  values: HdriWorldToolValues;
  onValueChange: (
    field: keyof HdriWorldToolValues,
    value: string | number | boolean
  ) => void;
  onApply: (
    action:
      | "apply_theme_from_photo_manual_colors"
      | "set_hdri_path"
      | "clear_world"
      | "reset_world"
      | "set_rotation_x"
      | "set_rotation_y"
      | "set_rotation_z"
      | "set_world_strength",
    values: HdriWorldToolValues
  ) => void;
  onBrowsePath: () => void;
  onBrowseThemePath: () => void;
  onApplyThemeMode: (
    mode: "dark" | "light",
    values: HdriWorldToolValues
  ) => void;
}

interface SmartAxisVisualState {
  Modes: {
    X: string;
    Y: string;
    Z: string;
  };
  LiveEnabled: boolean;
  RunnerActive: boolean;
  Registered: boolean;
  LastMessage: string;
}

interface SmartAxisStripProps {
  label: string;
  panelName?: string;
  compact?: boolean;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  state: SmartAxisVisualState;
  onAction: (
    action: "baseline" | "cycle_x" | "cycle_y" | "cycle_z" | "toggle_live"
  ) => void;
  onPopout?: () => void;
}

const ALIGNMENT_AXES: Array<"Z" | "Y" | "X"> = ["Z", "Y", "X"];
const CENTER_MODE_OPTIONS = ["GEOMETRY", "ORIGIN", "WORLD", "CURSOR", "OBJECT"];
const AXIS_OPTIONS = ["Z", "Y", "X"];
const QUICK_ROTATE_PRESET_ANGLES = [30, 45, 90, 180, 270];
const QUICK_ROTATE_OPERATION_OPTIONS = ["TRANSFORM", "DISTRIBUTE"];
const HDRI_WORLD_VALUE_ROWS = [
  {
    label: "Z",
    field: "RotationZDeg",
    action: "set_rotation_z",
    step: "0.01",
  },
  {
    label: "Y",
    field: "RotationYDeg",
    action: "set_rotation_y",
    step: "0.01",
  },
  {
    label: "X",
    field: "RotationXDeg",
    action: "set_rotation_x",
    step: "0.01",
  },
  {
    label: "WS",
    field: "WorldStrength",
    action: "set_world_strength",
    step: "0.01",
  },
] as const;

const THEME_PRIMARY_ROLE_ROWS = [
  {
    label: "Headers",
    field: "ThemeHeadersHex",
    placeholder: "#7BA8B7",
  },
  {
    label: "Text",
    field: "ThemeTextHex",
    placeholder: "#F3F3EE",
  },
  {
    label: "Section Fill",
    field: "ThemeSectionFillHex",
    placeholder: "#2B3438",
  },
  {
    label: "Controls",
    field: "ThemeControlsHex",
    placeholder: "#5A7A6E",
  },
  {
    label: "Misc",
    field: "ThemeMiscHex",
    placeholder: "#A27D55",
  },
] as const;

const THEME_SECONDARY_ROLE_ROWS = [
  {
    label: "Darks",
    field: "ThemeDarksHex",
    placeholder: "#1C2818",
  },
  {
    label: "Highlights",
    field: "ThemeHighlightsHex",
    placeholder: "#9FD640",
  },
] as const;

const THEME_VIEWPORT_ROLE_ROWS = [
  {
    label: "Viewport BG",
    field: "ThemeViewportBackgroundHex",
    placeholder: "#1B2618",
  },
  {
    label: "Gradient 2",
    field: "ThemeViewportGradientHex",
    placeholder: "#2B3A23",
  },
] as const;

function renderToolChip(
  label: string,
  args: ToolSkinProps & {
    onClick: () => void;
    className?: string;
    selected?: boolean;
    title?: string;
    highlightKey?: string;
  }
) {
  const {
    styleGroup,
    importedSkin,
    onClick,
    className,
    selected = false,
    title,
    highlightKey
  } = args;
  const baseClassName = className ?? "tool-chip";

  return (
    <HostSkinButton
      type="button"
      label={label}
      className={baseClassName}
      styleGroup={styleGroup}
      importedSkin={importedSkin}
      selected={selected}
      skinCompact
      onClick={onClick}
      title={title ?? label}
      highlightKey={selected ? highlightKey ?? `${baseClassName}:${label}` : undefined}
    />
  );
}

function formatSmartAxisLabel(axis: "X" | "Y" | "Z", mode: string): string {
  switch (mode.trim().toUpperCase()) {
    case "MIN":
    case "MINUS":
    case "NEGATIVE":
    case "-":
      return `${axis}-`;
    case "MAX":
    case "PLUS":
    case "POSITIVE":
    case "+":
      return `${axis}+`;
    case "CENTER":
    case "ZERO":
    case "0":
      return `${axis}0`;
    default:
      return axis;
  }
}

function renderThemeRoleField(args: {
  row: { label: string; field: keyof HdriWorldToolValues; placeholder: string };
  value: string;
  onValueChange: (field: keyof HdriWorldToolValues, value: string) => void;
}) {
  const { row, value, onValueChange } = args;
  return (
    <label className="hdri-world-theme-role" key={row.field}>
      <span className="hdri-world-theme-role__label">{row.label}</span>
      <div className="hdri-world-theme-role__controls">
        <input
          className="hdri-world-color-input"
          type="color"
          value={/^#[0-9A-F]{6}$/i.test(value) ? value : row.placeholder}
          onChange={(event) =>
            onValueChange(row.field, event.target.value.toUpperCase())
          }
          title={`${row.label} theme color picker.`}
        />
        <input
          className="hdri-world-field__input hdri-world-field__input--hex"
          type="text"
          value={value}
          onChange={(event) =>
            onValueChange(row.field, event.target.value.toUpperCase())
          }
          placeholder={row.placeholder}
          title={`${row.label} theme color in hex.`}
        />
      </div>
    </label>
  );
}

export function AlignmentToolSurface({
  ownerLabel,
  panelName,
  compact = false,
  styleGroup,
  importedSkin,
  modifiers,
  onAction
}: AlignmentToolSurfaceProps) {
  const content = (
    <div
      className={
        compact ? "alignment-grid alignment-grid--compact" : "alignment-grid"
      }
      role="group"
      aria-label="Alignment actions"
    >
      {ALIGNMENT_AXES.map((axis) => (
        <div className="alignment-row" key={axis}>
          <span className="alignment-row__axis">{axis}</span>
          {renderToolChip("Min", {
            onClick: () => onAction(axis, "min"),
            styleGroup,
            importedSkin
          })}
          {renderToolChip("Center", {
            onClick: () => onAction(axis, "center"),
            styleGroup,
            importedSkin
          })}
          {renderToolChip("Max", {
            onClick: () => onAction(axis, "max"),
            styleGroup,
            importedSkin
          })}
          {renderToolChip("Surface", {
            onClick: () => onAction(axis, "surface"),
            className: `tool-chip ${modifiers[axis] === "SURFACE" ? "is-active" : ""}`,
            selected: modifiers[axis] === "SURFACE",
            highlightKey: `alignment:${panelName}:${ownerLabel}:${axis}:surface`,
            styleGroup,
            importedSkin
          })}
          {renderToolChip("Geo", {
            onClick: () => onAction(axis, "geo"),
            className: `tool-chip ${modifiers[axis] === "GEOCENTER" ? "is-active" : ""}`,
            selected: modifiers[axis] === "GEOCENTER",
            highlightKey: `alignment:${panelName}:${ownerLabel}:${axis}:geo`,
            styleGroup,
            importedSkin
          })}
        </div>
      ))}
      {renderToolChip("Center Everything", {
        onClick: () => onAction("ALL", "center_everything"),
        className: "tool-chip tool-chip--wide",
        styleGroup,
        importedSkin
      })}
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <span className="eyebrow">Alignment Tool</span>
          <h1>{ownerLabel}</h1>
        </div>
        <span className="caption">{panelName}</span>
      </div>
      <div className="compound-surface">{content}</div>
    </>
  );
}

export function FlattenRevolveToolSurface({
  ownerLabel,
  panelName,
  compact = false,
  styleGroup,
  importedSkin,
  values,
  onValueChange,
  onAction
}: FlattenRevolveToolSurfaceProps) {
  const content = (
    <>
      <div className="compound-form">
        <label className="compound-field">
          <span>Flatten Axis</span>
          <select
            value={values.FlattenAxis}
            onChange={(event) => onValueChange("FlattenAxis", event.target.value)}
          >
            {AXIS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="compound-field">
          <span>Revolve Axis</span>
          <select
            value={values.RevolveAxis}
            onChange={(event) => onValueChange("RevolveAxis", event.target.value)}
          >
            {AXIS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="compound-field">
          <span>Center Mode</span>
          <select
            value={values.CenterMode}
            onChange={(event) => onValueChange("CenterMode", event.target.value)}
          >
            {CENTER_MODE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="compound-field">
          <span>Angle</span>
          <input
            type="number"
            value={values.AngleDeg}
            onChange={(event) => onValueChange("AngleDeg", Number(event.target.value))}
          />
        </label>
        <label className="compound-field">
          <span>Steps</span>
          <input
            type="number"
            min={1}
            value={values.RevolveSteps}
            onChange={(event) => onValueChange("RevolveSteps", Number(event.target.value))}
          />
        </label>
        <label className="compound-field">
          <span>Merge Distance</span>
          <input
            type="number"
            step="0.0001"
            value={values.MergeDistance}
            onChange={(event) =>
              onValueChange("MergeDistance", Number(event.target.value))
            }
          />
        </label>
      </div>
      <div className="compound-actions">
        {renderToolChip("Flatten", {
          onClick: () => onAction("flatten_profile"),
          className: "tool-chip tool-chip--wide",
          styleGroup,
          importedSkin
        })}
        {renderToolChip("Revolve", {
          onClick: () => onAction("generate_revolve"),
          className: "tool-chip tool-chip--wide",
          styleGroup,
          importedSkin
        })}
      </div>
    </>
  );

  if (compact) {
    return <div className="compound-surface compound-surface--compact">{content}</div>;
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <span className="eyebrow">Flatten / Revolve</span>
          <h1>{ownerLabel}</h1>
        </div>
        <span className="caption">{panelName}</span>
      </div>
      <div className="compound-surface">{content}</div>
    </>
  );
}

export function QuickRotateGroupToolSurface({
  ownerLabel,
  panelName,
  compact = false,
  styleGroup,
  importedSkin,
  values,
  onValueChange,
  onPresetApply,
  onApply
}: QuickRotateGroupToolSurfaceProps) {
  const isDistributeMode = values.OperationMode === "DISTRIBUTE";
  const quantityValue = Math.max(1, Math.round(values.DistributeCount || 1));
  const content = (
    <div
      className={
        compact ? "quick-rotate-grid quick-rotate-grid--compact" : "quick-rotate-grid"
      }
    >
      <div className="quick-rotate-row quick-rotate-row--angles">
        {AXIS_OPTIONS.map((axis) =>
          renderToolChip(axis, {
            onClick: () => onValueChange("Axis", axis),
            className: `tool-chip ${values.Axis === axis ? "is-active" : ""}`,
            selected: values.Axis === axis,
            styleGroup,
            importedSkin
          })
        )}
        {QUICK_ROTATE_PRESET_ANGLES.map((angle) =>
          renderToolChip(`${angle}\u00b0`, {
            onClick: () => onPresetApply(angle),
            className: `tool-chip ${Math.abs(values.AngleDeg - angle) < 0.001 ? "is-active" : ""}`,
            selected: Math.abs(values.AngleDeg - angle) < 0.001,
            styleGroup,
            importedSkin,
            title: isDistributeMode
              ? "Stores the transform angle preset. Distribute uses the total count below."
              : `Rotate ${angle} degrees`
          })
        )}
      </div>
      <div className="quick-rotate-row quick-rotate-row--centers">
        {CENTER_MODE_OPTIONS.map((option) =>
          renderToolChip(option[0] + option.slice(1).toLowerCase(), {
            onClick: () => onValueChange("CenterMode", option),
            className: `tool-chip ${values.CenterMode === option ? "is-active" : ""}`,
            selected: values.CenterMode === option,
            styleGroup,
            importedSkin
          })
        )}
      </div>
      <div className="quick-rotate-row quick-rotate-row--modes">
        {QUICK_ROTATE_OPERATION_OPTIONS.map((option) =>
          renderToolChip(option[0] + option.slice(1).toLowerCase(), {
            onClick: () => onValueChange("OperationMode", option),
            className: `tool-chip ${values.OperationMode === option ? "is-active" : ""}`,
            selected: values.OperationMode === option,
            styleGroup,
            importedSkin
          })
        )}
      </div>
      {compact ? (
        <div className="quick-rotate-row quick-rotate-row--apply">
          <input
            className="quick-rotate-field__input"
            type="number"
            step={isDistributeMode ? "1" : "0.01"}
            min={isDistributeMode ? "1" : undefined}
            title={
              isDistributeMode
                ? "Total positions to end up with, including the original selection."
                : "Angle in degrees."
            }
            value={
              isDistributeMode
                ? quantityValue
                : Number.isFinite(values.AngleDeg)
                  ? values.AngleDeg
                  : 0
            }
            onChange={(event) =>
              onValueChange(
                isDistributeMode ? "DistributeCount" : "AngleDeg",
                Number(event.target.value)
              )
            }
          />
          {renderToolChip("Negative", {
            onClick: () => onApply("negative", values),
            className: "tool-chip",
            styleGroup,
            importedSkin,
            title: isDistributeMode
              ? "Duplicate and distribute in the negative direction"
              : "Rotate by the entered negative angle"
          })}
          {renderToolChip("Positive", {
            onClick: () => onApply("positive", values),
            className: "tool-chip",
            styleGroup,
            importedSkin,
            title: isDistributeMode
              ? "Duplicate and distribute in the positive direction"
              : "Rotate by the entered positive angle"
          })}
        </div>
      ) : (
        <div className="quick-rotate-row quick-rotate-row--apply">
          <label className="compound-field quick-rotate-field">
            <span>{isDistributeMode ? "Total Count" : "Angle"}</span>
            <input
              type="number"
              step={isDistributeMode ? "1" : "0.01"}
              min={isDistributeMode ? "1" : undefined}
              title={
                isDistributeMode
                  ? "Total positions to end up with, including the original selection."
                  : "Angle in degrees."
              }
              value={
                isDistributeMode
                  ? quantityValue
                  : Number.isFinite(values.AngleDeg)
                    ? values.AngleDeg
                    : 0
              }
              onChange={(event) =>
                onValueChange(
                  isDistributeMode ? "DistributeCount" : "AngleDeg",
                  Number(event.target.value)
                )
              }
            />
          </label>
          <div className="quick-rotate-apply-pair">
            <div className="quick-rotate-apply-slot">
              {renderToolChip("Negative", {
                onClick: () => onApply("negative", values),
                className: "tool-chip",
                styleGroup,
                importedSkin,
                title: isDistributeMode
                  ? "Duplicate and distribute in the negative direction"
                  : "Rotate by the entered negative angle"
              })}
            </div>
            <div className="quick-rotate-apply-slot">
              {renderToolChip("Positive", {
                onClick: () => onApply("positive", values),
                className: "tool-chip",
                styleGroup,
                importedSkin,
                title: isDistributeMode
                  ? "Duplicate and distribute in the positive direction"
                  : "Rotate by the entered positive angle"
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (compact) {
    return <div className="compound-surface compound-surface--compact">{content}</div>;
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <span className="eyebrow">Rotate</span>
          <h1>{ownerLabel}</h1>
        </div>
        <span className="caption">{panelName}</span>
      </div>
      <div className="compound-surface">{content}</div>
    </>
  );
}

export function HdriWorldToolSurface({
  ownerLabel,
  panelName,
  compact = false,
  styleGroup,
  importedSkin,
  values,
  onValueChange,
  onApply,
  onBrowsePath,
  onBrowseThemePath,
  onApplyThemeMode
}: HdriWorldToolSurfaceProps) {
  const content = (
    <div className={compact ? "hdri-world-grid hdri-world-grid--compact" : "hdri-world-grid"}>
      <div className="hdri-world-row hdri-world-row--theme-path">
        <input
          className="hdri-world-field__input"
          type="text"
          value={values.ThemeImagePath}
          onChange={(event) => onValueChange("ThemeImagePath", event.target.value)}
          placeholder="Choose a reference image"
          title="Image path used to sample the Blender UI theme colors."
        />
        {renderToolChip("Browse", {
          onClick: onBrowseThemePath,
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Pick an image and sample five theme colors."
        })}
      </div>
      <div className="hdri-world-row hdri-world-row--theme-actions">
        {renderToolChip("Dark Theme", {
          onClick: () => onApplyThemeMode("dark", values),
          className: `tool-chip ${values.ThemeVisualMode === "dark" ? "is-active" : ""}`,
          selected: values.ThemeVisualMode === "dark",
          styleGroup,
          importedSkin,
          title: "Stage a dark theme preset on this page. Apply sends it to Blender."
        })}
        {renderToolChip("Light Theme", {
          onClick: () => onApplyThemeMode("light", values),
          className: `tool-chip ${values.ThemeVisualMode === "light" ? "is-active" : ""}`,
          selected: values.ThemeVisualMode === "light",
          styleGroup,
          importedSkin,
          title: "Stage a light theme preset on this page. Apply sends it to Blender."
        })}
        {renderToolChip("Apply", {
          onClick: () => onApply("apply_theme_from_photo_manual_colors", values),
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Apply the currently visible theme role colors."
        })}
      </div>
      <div className="hdri-world-theme-grid">
        {THEME_PRIMARY_ROLE_ROWS.map((row) =>
          renderThemeRoleField({
            row,
            value: values[row.field],
            onValueChange: (field, value) => onValueChange(field, value),
          })
        )}
      </div>
      <div className="hdri-world-theme-grid hdri-world-theme-grid--secondary">
        {THEME_SECONDARY_ROLE_ROWS.map((row) =>
          renderThemeRoleField({
            row,
            value: values[row.field],
            onValueChange: (field, value) => onValueChange(field, value),
          })
        )}
      </div>
      <div className="hdri-world-theme-grid hdri-world-theme-grid--viewport">
        {THEME_VIEWPORT_ROLE_ROWS.map((row) =>
          renderThemeRoleField({
            row,
            value: values[row.field],
            onValueChange: (field, value) => onValueChange(field, value),
          })
        )}
        <label className="hdri-world-theme-role hdri-world-theme-role--toggle">
          <span className="hdri-world-theme-role__label">Gradient</span>
          <label className="hdri-world-toggle">
            <input
              type="checkbox"
              checked={values.ThemeViewportGradientEnabled}
              onChange={(event) =>
                onValueChange("ThemeViewportGradientEnabled", event.target.checked)
              }
            />
            <span>Use gradient</span>
          </label>
        </label>
      </div>
      <div className="hdri-world-row hdri-world-row--path">
        {renderToolChip("HDRI", {
          onClick: () => onApply("set_hdri_path", values),
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Apply the HDRI path in the field."
        })}
        <input
          className="hdri-world-field__input"
          type="text"
          value={values.HdriPath}
          onChange={(event) => onValueChange("HdriPath", event.target.value)}
          placeholder="Blender\\appearance\\mossy_forest_4k.exr"
          title="HDRI path to load into the Blender world environment."
        />
        {renderToolChip("Clear", {
          onClick: () => onApply("clear_world", values),
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Clear the current HDRI world from this file."
        })}
        {renderToolChip("Reset", {
          onClick: () => onApply("reset_world", values),
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Rebuild a clean Blender world for this file and reapply the current HDRI values."
        })}
        {renderToolChip("Browse", {
          onClick: onBrowsePath,
          className: "tool-chip",
          styleGroup,
          importedSkin,
          title: "Pick an HDRI file."
        })}
      </div>
      <div className="hdri-world-row hdri-world-row--controls">
        {HDRI_WORLD_VALUE_ROWS.map((row) => (
          <div className="hdri-world-value-pair" key={row.field}>
            {renderToolChip(row.label, {
              onClick: () => onApply(row.action, values),
              className: "tool-chip",
              styleGroup,
              importedSkin,
              title:
                row.label === "WS"
                  ? "Apply the entered world strength."
                  : `Apply the entered ${row.label} rotation.`
            })}
            <input
              className="hdri-world-field__input hdri-world-field__input--small"
              type="number"
              step={row.step}
              value={
                Number.isFinite(Number(values[row.field]))
                  ? Number(values[row.field])
                  : 0
              }
              onChange={(event) => onValueChange(row.field, Number(event.target.value))}
              title={
                row.label === "WS"
                  ? "World background strength."
                  : `${row.label} rotation in degrees.`
              }
            />
          </div>
        ))}
      </div>
    </div>
  );

  if (compact) {
    return <div className="compound-surface compound-surface--compact">{content}</div>;
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <span className="eyebrow">Theme</span>
          <h1>{ownerLabel}</h1>
        </div>
        <span className="caption">{panelName}</span>
      </div>
      <div className="compound-surface">{content}</div>
    </>
  );
}

export function SmartAxisStrip({
  label,
  panelName,
  compact = false,
  styleGroup,
  importedSkin,
  state,
  onAction,
  onPopout
}: SmartAxisStripProps) {
  const strip = (
    <div
      className={compact ? "smart-axis-strip smart-axis-strip--compact" : "smart-axis-strip"}
      role="group"
      aria-label="Smart Axis"
    >
      {renderToolChip("Base", {
        onClick: () => onAction("baseline"),
        styleGroup,
        importedSkin
      })}
      {renderToolChip(formatSmartAxisLabel("Z", state.Modes.Z), {
        onClick: () => onAction("cycle_z"),
        className: `tool-chip ${state.Modes.Z !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.Z !== "NONE",
        highlightKey: `smart-axis:${panelName ?? label}:z`,
        styleGroup,
        importedSkin
      })}
      {renderToolChip(formatSmartAxisLabel("Y", state.Modes.Y), {
        onClick: () => onAction("cycle_y"),
        className: `tool-chip ${state.Modes.Y !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.Y !== "NONE",
        highlightKey: `smart-axis:${panelName ?? label}:y`,
        styleGroup,
        importedSkin
      })}
      {renderToolChip(formatSmartAxisLabel("X", state.Modes.X), {
        onClick: () => onAction("cycle_x"),
        className: `tool-chip ${state.Modes.X !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.X !== "NONE",
        highlightKey: `smart-axis:${panelName ?? label}:x`,
        styleGroup,
        importedSkin
      })}
      {renderToolChip("Live", {
        onClick: () => onAction("toggle_live"),
        className: `tool-chip ${state.LiveEnabled ? "tool-chip--live-active" : ""}`,
        selected: state.LiveEnabled,
        highlightKey: `smart-axis:${panelName ?? label}:live`,
        styleGroup,
        importedSkin
      })}
    </div>
  );

  if (compact) {
    return <div className="smart-axis-card smart-axis-card--compact">{strip}</div>;
  }

  return (
    <div className="smart-axis-card">
      <div className="smart-axis-card__header">
        <div>
          <span className="eyebrow">Smart Axis</span>
          <strong>{label}</strong>
        </div>
        <div className="smart-axis-card__meta">
          {panelName ? <span className="caption">{panelName}</span> : null}
          {onPopout ? (
            <button type="button" className="smart-axis-card__popout" onClick={onPopout}>
              Pop
            </button>
          ) : null}
        </div>
      </div>
      {strip}
      <div className="smart-axis-status">
        <span className="caption">
          Registered {state.Registered ? "yes" : "no"} | Runner{" "}
          {state.RunnerActive ? "active" : "idle"}
        </span>
        <span className="caption">{state.LastMessage}</span>
      </div>
    </div>
  );
}
