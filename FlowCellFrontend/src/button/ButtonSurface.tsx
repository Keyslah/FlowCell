import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";
import type {
  ButtonCoreMeasurement,
  ButtonEditorMode,
  ButtonRecord,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  JsonValue
} from "./types";
import { ButtonRenderer } from "./ButtonRenderer";
import {
  executeButtonToolField,
  type ButtonExecutionResult
} from "./runtime/ButtonRuntimeAdapter";
import {
  showOpenFileDialog,
  showOpenFolderDialog
} from "../lib/tauri";

export interface ButtonSurfaceProps {
  document: ButtonStateDocument;
  surfaceId: string;
  mode?: ButtonEditorMode;
  selectedPlacementIds?: ReadonlySet<string>;
  fields?: readonly ButtonToolField[];
  fieldValues?: Readonly<Record<string, JsonValue>>;
  onFieldPatch?: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
  onSelectPlacement?: (placementId: string, event: PointerEvent | KeyboardEvent) => void;
  onActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onOwnerActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onDoubleActivate?: (placementId: string, button: ButtonRecord, event: MouseEvent) => void | Promise<void>;
  onRequestContextMenu?: (placementId: string, button: ButtonRecord, event: MouseEvent) => void;
  onHoverStart?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onHoverEnd?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onHoverCancel?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onExecutionResult?: (placementId: string, result: ButtonExecutionResult) => void;
  onFieldExecutionResult?: (fieldId: string, result: ButtonExecutionResult) => void;
  onPlacementMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onPlacementVisualMeasurement?: (
    placementId: string,
    measurement: ButtonVisualMeasurement
  ) => void;
  onPreparePlacementVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onPlacementVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
  onPlacementNaturalMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  className?: string;
  style?: CSSProperties;
}

const EMPTY_TOOL_FIELDS: readonly ButtonToolField[] = [];

function initialFieldValues(fields: readonly ButtonToolField[]): Record<string, JsonValue> {
  return Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
}

function renderFieldInput(args: {
  field: ButtonToolField;
  value: JsonValue;
  disabled: boolean;
  setValue: (value: JsonValue) => void;
  commit: (value: JsonValue, trigger: "change" | "activate") => void;
  browsePath?: () => void;
}) {
  const { field, value, disabled, setValue, commit, browsePath } = args;
  if (field.kind === "display") {
    return field.serviceTarget && field.serviceTrigger === "activate"
      ? <button type="button" disabled={disabled} onClick={() => commit(value, "activate")}><output>{String(value ?? "")}</output></button>
      : <output>{String(value ?? "")}</output>;
  }
  if (field.kind === "toggle") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => commit(event.currentTarget.checked, "change")}
      />
    );
  }
  if (field.kind === "select") {
    return (
      <select
        value={field.options.find((item) => Object.is(item.value, value))?.id ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const option = field.options.find((item) => item.id === event.currentTarget.value);
          if (option) commit(option.value, "change");
        }}
      >
        {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    );
  }
  if (field.kind === "color") {
    return (
      <input
        type="color"
        value={typeof value === "string" ? value : field.defaultValue}
        disabled={disabled}
        onChange={(event) => commit(event.currentTarget.value, "change")}
      />
    );
  }
  if (field.kind === "number") {
    return (
      <input
        type="number"
        value={typeof value === "number" || typeof value === "string" ? value : ""}
        min={field.minimum}
        max={field.maximum}
        step={field.step}
        disabled={disabled}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={(event) => commit(Number(event.currentTarget.value), "change")}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(Number(event.currentTarget.value), "change");
        }}
      />
    );
  }
  if (field.kind === "path") {
    return (
      <span className="button-tool-field__path">
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          placeholder={field.label}
          disabled={disabled}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value, "change")}
        />
        <button type="button" disabled={disabled} onClick={browsePath}>Browse</button>
      </span>
    );
  }
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      placeholder={field.placeholder}
      disabled={disabled}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={(event) => commit(event.currentTarget.value, "change")}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit(event.currentTarget.value, "change");
      }}
    />
  );
}

export function ButtonSurface({
  document,
  surfaceId,
  mode = "run",
  selectedPlacementIds,
  fields = EMPTY_TOOL_FIELDS,
  fieldValues,
  onFieldPatch,
  onSelectPlacement,
  onActivate,
  onOwnerActivate,
  onDoubleActivate,
  onRequestContextMenu,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onExecutionResult,
  onFieldExecutionResult,
  onPlacementMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  onPlacementNaturalMeasurement,
  className,
  style
}: ButtonSurfaceProps) {
  const surface = document.surfaces[surfaceId];
  const [values, setValues] = useState<Record<string, JsonValue>>(() => ({
    ...initialFieldValues(fields),
    ...(fieldValues ?? {})
  }));
  useEffect(() => {
    setValues((current) => ({ ...initialFieldValues(fields), ...current, ...(fieldValues ?? {}) }));
  }, [fields, fieldValues]);

  const applyFieldPatch = useCallback((
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => {
    setValues({ ...nextValues });
    onFieldPatch?.(patch, nextValues);
  }, [onFieldPatch]);

  const orderedPlacementIds = useMemo(() => {
    if (!surface) return [];
    return [...surface.placementIds].sort((left, right) => {
      const leftPlacement = document.placements[left];
      const rightPlacement = document.placements[right];
      return (leftPlacement?.zIndex ?? 0) - (rightPlacement?.zIndex ?? 0) || left.localeCompare(right);
    });
  }, [surface, document.placements]);

  if (!surface) return null;

  const commitField = async (field: ButtonToolField, value: JsonValue, trigger: "change" | "activate") => {
    const expectedTrigger = field.serviceTrigger ?? (field.kind === "path" ? "activate" : "change");
    if (!field.serviceTarget || expectedTrigger !== trigger || mode === "edit") {
      applyFieldPatch({ [field.id]: value }, { ...values, [field.id]: value });
      return;
    }
    try {
      const result = await executeButtonToolField(field, value, {
        fields,
        fieldValues: values,
        onFieldPatch: applyFieldPatch
      }, trigger);
      onFieldExecutionResult?.(field.id, result);
    } catch (error) {
      onFieldExecutionResult?.(field.id, {
        executed: false,
        message: error instanceof Error ? error.message : String(error),
        fieldValues: values,
        fieldPatch: {}
      });
    }
  };

  const activateField = useCallback(async (
    field: ButtonToolField,
    _currentValue: JsonValue
  ): Promise<JsonValue | undefined> => {
    if (field.kind !== "path") {
      throw new Error(`Tool field '${field.id}' does not have a native activation service.`);
    }
    const selectedPaths = field.pathKind === "folder"
      ? await showOpenFolderDialog({
          title: `Choose ${field.label}`,
          multiselect: false
        })
      : await showOpenFileDialog({
          title: `Choose ${field.label}`,
          filter: field.filter?.trim() || "All files (*.*)|*.*",
          multiselect: false
        });
    return selectedPaths[0]?.trim() || undefined;
  }, []);

  const browsePathField = async (field: Extract<ButtonToolField, { kind: "path" }>) => {
    try {
      const selectedPath = await activateField(field, values[field.id] ?? field.defaultValue);
      if (selectedPath !== undefined) await commitField(field, selectedPath, "activate");
    } catch (error) {
      onFieldExecutionResult?.(field.id, {
        executed: false,
        message: error instanceof Error ? error.message : String(error),
        fieldValues: values,
        fieldPatch: {}
      });
    }
  };

  return (
    <div
      className={className}
      data-button-surface-id={surface.id}
      data-button-surface-kind={surface.kind}
      style={{
        position: "relative",
        boxSizing: "border-box",
        width: surface.width,
        height: surface.height,
        overflow: "visible",
        pointerEvents: "none",
        ...style
      }}
    >
      {fields.filter((field) => !field.hidden).map((field) => (
        <label
          key={field.id}
          data-button-tool-field-id={field.id}
          className={`button-tool-field button-tool-field--${field.kind}`}
          style={{
            position: "absolute",
            left: field.x,
            top: field.y,
            width: field.width,
            height: field.height,
            zIndex: field.zIndex,
            pointerEvents: mode === "run" ? "auto" : "none"
          }}
        >
          <span>{field.label}</span>
          {renderFieldInput({
            field,
            value: values[field.id] ?? field.defaultValue,
            disabled: Boolean(field.disabled) || mode === "edit",
            setValue: (value) => applyFieldPatch({ [field.id]: value }, { ...values, [field.id]: value }),
            commit: (value, trigger) => void commitField(field, value, trigger),
            browsePath: field.kind === "path" ? () => void browsePathField(field) : undefined
          })}
        </label>
      ))}
      {orderedPlacementIds.map((placementId) => (
        <ButtonRenderer
          key={placementId}
          document={document}
          placementId={placementId}
          mode={mode}
          selected={selectedPlacementIds?.has(placementId)}
          fields={fields}
          fieldValues={values}
          onFieldActivate={activateField}
          onFieldPatch={applyFieldPatch}
          onSelect={onSelectPlacement}
          onActivate={onActivate}
          onOwnerActivate={onOwnerActivate}
          onDoubleActivate={onDoubleActivate}
          onRequestContextMenu={onRequestContextMenu}
          onHoverStart={onHoverStart}
          onHoverEnd={onHoverEnd}
          onHoverCancel={onHoverCancel}
          onExecutionResult={onExecutionResult}
          onMeasurement={onPlacementMeasurement}
          onVisualMeasurement={onPlacementVisualMeasurement}
          onPrepareVisualStateChange={onPreparePlacementVisualStateChange}
          onVisualStateChange={onPlacementVisualStateChange}
          onNaturalMeasurement={onPlacementNaturalMeasurement}
        />
      ))}
    </div>
  );
}
