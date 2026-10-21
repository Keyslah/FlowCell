import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import type {
  ButtonCoreMeasurement,
  ButtonEditorMode,
  ButtonRangeToolField,
  ButtonRecord,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  JsonValue
} from "./types";
import { ButtonRenderer } from "./ButtonRenderer";
import type { ProgramPopoutThemeScreenGeometry } from "../theme/programPopoutTheme";
import {
  executeButtonToolField,
  isToolSetChildStateSelected,
  type ButtonExecutionResult
} from "./runtime/ButtonRuntimeAdapter";
import { setButtonActivationState } from "./runtime/ButtonActivationStateBus";
import {
  buttonPlacementActivationCycleUsesResultMatches,
  resolveButtonActivationResultAssignments
} from "./runtime/buttonActivationResultSync";
import {
  showOpenFileDialog,
  showOpenFolderDialog
} from "../lib/tauri";
import {
  formatRangeValue,
  linkedRangeFields,
  linkedRangePatch
} from "./popout/rangeFieldLink";

interface ToolsetStateIdentity {
  programName: string;
  panelName: string;
  fileName: string;
}

function toolsetStateIdentityForButton(button: ButtonRecord | undefined): ToolsetStateIdentity | null {
  const target = button?.executionTarget;
  if (!target || target.kind !== "tool-set-action") return null;
  return {
    programName: target.programName,
    panelName: target.panelName,
    fileName: target.ownerFileName
  };
}

function toolsetStateIdentitiesMatch(
  left: ToolsetStateIdentity | null,
  right: ToolsetStateIdentity
): boolean {
  return Boolean(
    left &&
    left.programName === right.programName &&
    left.panelName === right.panelName &&
    left.fileName === right.fileName
  );
}

function responseReportsExecutionFailure(response: unknown): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  const status = (response as Record<string, unknown>).status;
  return typeof status === "string" && ["cancelled", "failed", "error"].includes(status.toLowerCase());
}

export interface ButtonSurfaceProps {
  document: ButtonStateDocument;
  programPopoutThemeScreenGeometry?: ProgramPopoutThemeScreenGeometry;
  /** Original identity for the single synthetic Button on a collapsed owner surface. */
  programPopoutThemeSourcePlacementId?: string;
  surfaceId: string;
  mode?: ButtonEditorMode;
  selectedPlacementIds?: ReadonlySet<string>;
  ownerPlacementId?: string;
  fields?: readonly ButtonToolField[];
  fieldValues?: Readonly<Record<string, JsonValue>>;
  onFieldPatch?: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
  onRequestInlineEditorFocus?: () => void | Promise<void>;
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
  visualMeasurementSamplingKey?: string | number;
  onPreparePlacementVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onPlacementVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
  onPlacementNaturalMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  resetResultMappedActivationStateOnMount?: boolean;
  /** The tool set's read-only state reply; it resyncs result-mapped Button states. */
  stateQueryResponse?: unknown;
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
  // Range fields render through RangeFieldControl.
  if (field.kind === "range") return null;
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

function RangeFieldControl({
  field,
  value,
  disabled,
  onInput,
  onRelease
}: {
  field: ButtonRangeToolField;
  value: JsonValue;
  disabled: boolean;
  onInput: (value: number) => void;
  onRelease: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // React's onChange is the continuous input event; the native change event
    // fires once when a drag or key step is released.
    const handleChange = () => onReleaseRef.current();
    input.addEventListener("change", handleChange);
    return () => input.removeEventListener("change", handleChange);
  }, []);
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : field.defaultValue;
  const beginDrag = () => {
    const input = inputRef.current;
    if (!input) return;
    input.setAttribute("data-button-field-dragging", "true");
    const endDrag = () => {
      input.removeAttribute("data-button-field-dragging");
      window.removeEventListener("pointerup", endDrag, true);
      window.removeEventListener("pointercancel", endDrag, true);
      window.removeEventListener("blur", endDrag);
    };
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
    window.addEventListener("blur", endDrag);
  };
  return (
    <>
      <input
        ref={inputRef}
        type="range"
        onPointerDown={beginDrag}
        min={field.minimum}
        max={field.maximum}
        step={field.step ?? "any"}
        value={numeric}
        disabled={disabled}
        onChange={(event) => onInput(Number(event.currentTarget.value))}
      />
      <output>{formatRangeValue(field, numeric)}</output>
    </>
  );
}

type RangeServiceTrigger = "input" | "change";

export function ButtonSurface({
  document,
  programPopoutThemeScreenGeometry,
  programPopoutThemeSourcePlacementId,
  surfaceId,
  mode = "run",
  selectedPlacementIds,
  ownerPlacementId,
  fields = EMPTY_TOOL_FIELDS,
  fieldValues,
  onFieldPatch,
  onRequestInlineEditorFocus,
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
  visualMeasurementSamplingKey,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  onPlacementNaturalMeasurement,
  resetResultMappedActivationStateOnMount = false,
  stateQueryResponse,
  className,
  style
}: ButtonSurfaceProps) {
  const surface = document.surfaces[surfaceId];
  const [values, setValues] = useState<Record<string, JsonValue>>(() => ({
    ...initialFieldValues(fields),
    ...(fieldValues ?? {})
  }));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  useEffect(() => {
    setValues((current) => ({ ...initialFieldValues(fields), ...current, ...(fieldValues ?? {}) }));
  }, [fields, fieldValues]);

  const applyFieldPatch = useCallback((
    patch: Readonly<Record<string, JsonValue>>,
    _nextValues: Readonly<Record<string, JsonValue>>
  ) => {
    // Merge onto the live values: callers compute nextValues from the values
    // they started with, and a slow program reply would otherwise undo any
    // field the user changed in the meantime (e.g. a Link toggle).
    const merged = { ...valuesRef.current, ...patch };
    valuesRef.current = merged;
    setValues(merged);
    onFieldPatch?.(patch, merged);
  }, [onFieldPatch]);

  // One service call per range field at a time. Drag steps coalesce to the
  // latest value; the release always follows them.
  const rangeServiceQueuesRef = useRef(new Map<string, { running: boolean; queue: RangeServiceTrigger[] }>());
  // Assigned below once the activation-result queue exists.
  const syncFieldServiceResultRef = useRef<(field: ButtonToolField, response: unknown) => void>(() => {});
  const onFieldExecutionResultRef = useRef(onFieldExecutionResult);
  onFieldExecutionResultRef.current = onFieldExecutionResult;
  const pumpRangeService = useCallback(async (fieldId: string) => {
    const state = rangeServiceQueuesRef.current.get(fieldId);
    if (!state || state.running) return;
    state.running = true;
    try {
      while (state.queue.length > 0) {
        const trigger = state.queue.shift()!;
        const field = fieldsRef.current.find((candidate) => candidate.id === fieldId);
        if (!field || field.kind !== "range" || !field.serviceTarget) continue;
        // While dragging, the slider (and its linked sliders) own their values;
        // program patches for them apply only to the release response.
        const ownedIds = trigger === "input"
          ? new Set(linkedRangeFields(fieldsRef.current, valuesRef.current, fieldId).map((member) => member.id))
          : new Set<string>();
        try {
          const result = await executeButtonToolField(field, valuesRef.current[fieldId] ?? field.defaultValue, {
            fields: fieldsRef.current,
            fieldValues: valuesRef.current,
            onFieldPatch: (patch) => {
              const accepted = Object.fromEntries(
                Object.entries(patch).filter(([id]) => !ownedIds.has(id))
              );
              if (Object.keys(accepted).length === 0) return;
              applyFieldPatch(accepted, { ...valuesRef.current, ...accepted });
            }
          }, trigger);
          if (trigger === "change") syncFieldServiceResultRef.current(field, result.response);
          // Accepted patches are already applied; a send-time snapshot would drag the slider back.
          onFieldExecutionResultRef.current?.(fieldId, { ...result, fieldValues: valuesRef.current, fieldPatch: {} });
        } catch (error) {
          onFieldExecutionResultRef.current?.(fieldId, {
            executed: false,
            message: error instanceof Error ? error.message : String(error),
            fieldValues: valuesRef.current,
            fieldPatch: {}
          });
        }
      }
    } finally {
      state.running = false;
    }
  }, [applyFieldPatch]);
  const enqueueRangeService = useCallback((fieldId: string, trigger: RangeServiceTrigger) => {
    const queues = rangeServiceQueuesRef.current;
    const state = queues.get(fieldId) ?? { running: false, queue: [] };
    queues.set(fieldId, state);
    if (!(trigger === "input" && state.queue[state.queue.length - 1] === "input")) {
      state.queue.push(trigger);
    }
    void pumpRangeService(fieldId);
  }, [pumpRangeService]);

  const orderedPlacementIds = useMemo(() => {
    if (!surface) return [];
    return [...surface.placementIds].sort((left, right) => {
      const leftPlacement = document.placements[left];
      const rightPlacement = document.placements[right];
      return (leftPlacement?.zIndex ?? 0) - (rightPlacement?.zIndex ?? 0) || left.localeCompare(right);
    });
  }, [surface, document.placements]);

  const documentRef = useRef(document);
  const activationResultApplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  documentRef.current = document;

  const enqueueActivationResult = useCallback((args: {
    response: unknown;
    identity: ToolsetStateIdentity | null;
    fallbackPlacementId?: string;
  }): Promise<void> => {
    const apply = async () => {
      const currentDocument = documentRef.current;
      const currentSurface = currentDocument.surfaces[surfaceId];
      if (!currentSurface) return;
      const placementIds = args.identity
        ? currentSurface.placementIds.filter((placementId) => {
            const placement = currentDocument.placements[placementId];
            return toolsetStateIdentitiesMatch(
              toolsetStateIdentityForButton(
                placement ? currentDocument.buttons[placement.buttonId] : undefined
              ),
              args.identity!
            );
          })
        : args.fallbackPlacementId
          ? [args.fallbackPlacementId]
          : currentSurface.placementIds;
      const assignments = resolveButtonActivationResultAssignments(
        currentDocument,
        placementIds,
        args.response
      );
      await Promise.all(assignments.map((assignment) => (
        setButtonActivationState(
          assignment.activationKey,
          assignment.stateCount,
          assignment.index
        )
      )));
    };
    const queued = activationResultApplyQueueRef.current.then(apply, apply);
    activationResultApplyQueueRef.current = queued.then(() => undefined, () => undefined);
    return queued;
  }, [surfaceId]);

  useEffect(() => {
    if (mode !== "run" || stateQueryResponse === undefined || stateQueryResponse === null) return;
    if (responseReportsExecutionFailure(stateQueryResponse)) return;
    void enqueueActivationResult({ response: stateQueryResponse, identity: null }).catch((error) => {
      console.error("FlowCell could not apply the tool set's current Button state.", error);
    });
  }, [mode, stateQueryResponse, enqueueActivationResult]);

  // A field service answers for its own tool set, so its response also
  // resyncs that tool set's result-mapped Button states (e.g. lock cycles).
  syncFieldServiceResultRef.current = (field, response) => {
    const target = field.serviceTarget;
    if (response === undefined || responseReportsExecutionFailure(response)) return;
    if (target?.kind !== "tool-set-action") return;
    void enqueueActivationResult({
      response,
      identity: {
        programName: target.programName,
        panelName: target.panelName,
        fileName: target.ownerFileName
      }
    }).catch((error) => {
      console.error("FlowCell could not apply the tool field's Button state.", error);
    });
  };

  useEffect(() => {
    if (mode !== "run" || !resetResultMappedActivationStateOnMount) return;
    const currentDocument = documentRef.current;
    const currentSurface = currentDocument.surfaces[surfaceId];
    if (!currentSurface) return;
    const resets = currentSurface.placementIds.flatMap((placementId) => {
      const cycle = currentDocument.placements[placementId]?.activationCycle;
      return buttonPlacementActivationCycleUsesResultMatches(cycle)
        ? [setButtonActivationState(placementId, cycle!.states.length, 0)]
        : [];
    });
    void Promise.all(resets).catch((error) => {
      console.error("FlowCell could not reset the toolset Button state.", error);
    });
  }, [mode, resetResultMappedActivationStateOnMount, surfaceId]);

  const handlePlacementExecutionResult = useCallback((
    placementId: string,
    result: ButtonExecutionResult
  ) => {
    if (
      result.executed &&
      result.response !== undefined &&
      !responseReportsExecutionFailure(result.response)
    ) {
      const currentDocument = documentRef.current;
      const placement = currentDocument.placements[placementId];
      const identity = toolsetStateIdentityForButton(
        placement ? currentDocument.buttons[placement.buttonId] : undefined
      );
      void enqueueActivationResult({
        response: result.response,
        identity,
        fallbackPlacementId: placementId
      }).catch((error) => {
        console.error("FlowCell could not apply the Button action state.", error);
      });
    }
    onExecutionResult?.(placementId, result);
  }, [enqueueActivationResult, onExecutionResult]);

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
      if (result.executed) syncFieldServiceResultRef.current(field, result.response);
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
          {field.kind === "range" ? (
            <RangeFieldControl
              field={field}
              value={values[field.id] ?? field.defaultValue}
              disabled={Boolean(field.disabled) || mode === "edit"}
              onInput={(requested) => {
                const patch = linkedRangePatch(fields, valuesRef.current, field.id, requested);
                if (Object.keys(patch).length === 0) return;
                applyFieldPatch(patch, { ...valuesRef.current, ...patch });
                if (field.serviceTarget && field.serviceTrigger === "input" && mode !== "edit") {
                  enqueueRangeService(field.id, "input");
                }
              }}
              onRelease={() => {
                const trigger = field.serviceTrigger ?? "change";
                if (field.serviceTarget && (trigger === "input" || trigger === "change") && mode !== "edit") {
                  enqueueRangeService(field.id, "change");
                }
              }}
            />
          ) : renderFieldInput({
            field,
            value: values[field.id] ?? field.defaultValue,
            disabled: Boolean(field.disabled) || mode === "edit",
            setValue: (value) => applyFieldPatch({ [field.id]: value }, { ...values, [field.id]: value }),
            commit: (value, trigger) => void commitField(field, value, trigger),
            browsePath: field.kind === "path" ? () => void browsePathField(field) : undefined
          })}
        </label>
      ))}
      {orderedPlacementIds.map((placementId) => {
        const placement = document.placements[placementId];
        const button = placement ? document.buttons[placement.buttonId] : undefined;
        const selected = (mode === "edit" && selectedPlacementIds?.has(placementId)) || (
          mode === "run" && isToolSetChildStateSelected(button, values)
        );
        return (
          <ButtonRenderer
            key={placementId}
            document={document}
            programPopoutThemeScreenGeometry={programPopoutThemeScreenGeometry}
            programPopoutThemeSourcePlacementId={programPopoutThemeSourcePlacementId}
            placementId={placementId}
            mode={mode}
            selected={selected}
            ownerPlacement={placementId === ownerPlacementId}
            fields={fields}
            fieldValues={values}
            onFieldActivate={activateField}
            onFieldPatch={applyFieldPatch}
            onRequestInlineEditorFocus={onRequestInlineEditorFocus}
            onSelect={onSelectPlacement}
            onActivate={onActivate}
            onOwnerActivate={onOwnerActivate}
            onDoubleActivate={onDoubleActivate}
            onRequestContextMenu={onRequestContextMenu}
            onHoverStart={onHoverStart}
            onHoverEnd={onHoverEnd}
            onHoverCancel={onHoverCancel}
            onExecutionResult={handlePlacementExecutionResult}
            onMeasurement={onPlacementMeasurement}
            onVisualMeasurement={onPlacementVisualMeasurement}
            visualMeasurementSamplingKey={visualMeasurementSamplingKey}
            onPrepareVisualStateChange={onPreparePlacementVisualStateChange}
            onVisualStateChange={onPlacementVisualStateChange}
            onNaturalMeasurement={onPlacementNaturalMeasurement}
          />
        );
      })}
    </div>
  );
}
