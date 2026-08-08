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
import { ButtonHost } from "./ButtonHost";
import type { ButtonExecutionResult } from "./runtime/ButtonRuntimeAdapter";

export interface ButtonRendererProps {
  document: ButtonStateDocument;
  placementId: string;
  mode?: ButtonEditorMode;
  selected?: boolean;
  ownerPlacement?: boolean;
  fields?: readonly ButtonToolField[];
  fieldValues?: Readonly<Record<string, JsonValue>>;
  onFieldPatch?: (
    patch: Readonly<Record<string, JsonValue>>,
    nextValues: Readonly<Record<string, JsonValue>>
  ) => void;
  onFieldActivate?: (
    field: ButtonToolField,
    currentValue: JsonValue
  ) => Promise<JsonValue | undefined>;
  onRequestInlineEditorFocus?: () => void | Promise<void>;
  onSelect?: (placementId: string, event: PointerEvent | KeyboardEvent) => void;
  onActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onOwnerActivate?: (placementId: string, button: ButtonRecord, event: PointerEvent | KeyboardEvent) => void | Promise<void>;
  onDoubleActivate?: (placementId: string, button: ButtonRecord, event: MouseEvent) => void | Promise<void>;
  onRequestContextMenu?: (placementId: string, button: ButtonRecord, event: MouseEvent) => void;
  onHoverStart?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onHoverEnd?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onHoverCancel?: (placementId: string, button: ButtonRecord, event: PointerEvent) => void;
  onExecutionResult?: (placementId: string, result: ButtonExecutionResult) => void;
  onMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
  onVisualMeasurement?: (placementId: string, measurement: ButtonVisualMeasurement) => void;
  onPrepareVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
  onNaturalMeasurement?: (placementId: string, measurement: ButtonCoreMeasurement) => void;
}

export function ButtonRenderer({
  document,
  placementId,
  mode = "run",
  selected = false,
  ownerPlacement = false,
  fields,
  fieldValues,
  onFieldPatch,
  onFieldActivate,
  onRequestInlineEditorFocus,
  onSelect,
  onActivate,
  onOwnerActivate,
  onDoubleActivate,
  onRequestContextMenu,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onExecutionResult,
  onMeasurement,
  onVisualMeasurement,
  onPrepareVisualStateChange,
  onVisualStateChange,
  onNaturalMeasurement
}: ButtonRendererProps) {
  const placement = document.placements[placementId];
  if (!placement) return null;
  const button = document.buttons[placement.buttonId];
  if (!button) return null;
  const skin = document.skins[placement.skinOverrideId ?? button.defaultSkinId];
  if (!skin) return null;
  const activationHandler = (
    ownerPlacement ||
    button.role === "tool-set-owner" ||
    button.role === "panel-owner"
  )
    ? onOwnerActivate ?? onActivate
    : onActivate;

  return (
    <span
      data-button-placement-id={placement.id}
      data-button-selected={selected ? "true" : "false"}
      style={{
        position: "absolute",
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
        zIndex: placement.zIndex,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      <ButtonHost
        button={button}
        placement={placement}
        skin={skin}
        mode={mode}
        selected={selected}
        fields={fields}
        fieldValues={fieldValues}
        onFieldActivate={onFieldActivate}
        onFieldPatch={onFieldPatch}
        onRequestInlineEditorFocus={onRequestInlineEditorFocus}
        onSelect={(event) => onSelect?.(placement.id, event)}
        onActivate={activationHandler ? (_button, event) => activationHandler(placement.id, button, event) : undefined}
        onDoubleActivate={onDoubleActivate ? (_button, event) => onDoubleActivate(placement.id, button, event) : undefined}
        onRequestContextMenu={onRequestContextMenu ? (_button, event) => onRequestContextMenu(placement.id, button, event) : undefined}
        onHoverStart={onHoverStart ? (_button, event) => onHoverStart(placement.id, button, event) : undefined}
        onHoverEnd={onHoverEnd ? (_button, event) => onHoverEnd(placement.id, button, event) : undefined}
        onHoverCancel={onHoverCancel ? (_button, event) => onHoverCancel(placement.id, button, event) : undefined}
        onExecutionResult={(result) => onExecutionResult?.(placement.id, result)}
        onMeasurement={onMeasurement ? (measurement) => onMeasurement(placement.id, measurement) : undefined}
        onVisualMeasurement={onVisualMeasurement ? (measurement) => onVisualMeasurement(placement.id, measurement) : undefined}
        onPrepareVisualStateChange={onPrepareVisualStateChange
          ? (state) => onPrepareVisualStateChange(placement.id, state)
          : undefined}
        onVisualStateChange={onVisualStateChange ? (state) => onVisualStateChange(placement.id, state) : undefined}
        onNaturalMeasurement={onNaturalMeasurement ? (measurement) => onNaturalMeasurement(placement.id, measurement) : undefined}
      />
    </span>
  );
}
