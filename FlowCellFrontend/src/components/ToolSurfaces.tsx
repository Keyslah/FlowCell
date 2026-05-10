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
const AXIS_OPTIONS = ["X", "Y", "Z"];

function renderToolChip(
  label: string,
  args: ToolSkinProps & {
    onClick: () => void;
    className?: string;
    selected?: boolean;
    title?: string;
  }
) {
  const { styleGroup, importedSkin, onClick, className, selected = false, title } = args;
  const baseClassName = className ?? "tool-chip";
  const resolvedClassName = styleGroup
    ? baseClassName
        .replace(/\bis-active\b/g, "")
        .replace(/\btool-chip--armed\b/g, "")
        .replace(/\btool-chip--live-active\b/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : baseClassName;

  return (
    <HostSkinButton
      type="button"
      label={label}
      className={resolvedClassName}
      styleGroup={styleGroup}
      importedSkin={importedSkin}
      selected={selected}
      skinCompact
      onClick={onClick}
      title={title ?? label}
    />
  );
}

function formatSmartAxisLabel(axis: "X" | "Y" | "Z", mode: string): string {
  switch (mode) {
    case "MIN":
      return `${axis}-`;
    case "MAX":
      return `${axis}+`;
    case "CENTER":
      return `${axis}0`;
    default:
      return axis;
  }
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
            styleGroup,
            importedSkin
          })}
          {renderToolChip("Geo", {
            onClick: () => onAction(axis, "geo"),
            className: `tool-chip ${modifiers[axis] === "GEOCENTER" ? "is-active" : ""}`,
            selected: modifiers[axis] === "GEOCENTER",
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
      {renderToolChip(formatSmartAxisLabel("X", state.Modes.X), {
        onClick: () => onAction("cycle_x"),
        className: `tool-chip ${state.Modes.X !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.X !== "NONE",
        styleGroup,
        importedSkin
      })}
      {renderToolChip(formatSmartAxisLabel("Y", state.Modes.Y), {
        onClick: () => onAction("cycle_y"),
        className: `tool-chip ${state.Modes.Y !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.Y !== "NONE",
        styleGroup,
        importedSkin
      })}
      {renderToolChip(formatSmartAxisLabel("Z", state.Modes.Z), {
        onClick: () => onAction("cycle_z"),
        className: `tool-chip ${state.Modes.Z !== "NONE" ? "tool-chip--armed" : ""}`,
        selected: state.Modes.Z !== "NONE",
        styleGroup,
        importedSkin
      })}
      {renderToolChip("Live", {
        onClick: () => onAction("toggle_live"),
        className: `tool-chip ${state.LiveEnabled ? "tool-chip--live-active" : ""}`,
        selected: state.LiveEnabled,
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
