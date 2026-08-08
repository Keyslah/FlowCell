import { useCallback, useEffect, useMemo, useState } from "react";
import { ButtonSurface } from "../ButtonSurface";
import type { ButtonExecutionResult } from "../runtime/ButtonRuntimeAdapter";
import type {
  ButtonCoreMeasurement,
  ButtonPlacement,
  ButtonPopoutUnit,
  ButtonRect,
  ButtonRecord,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  JsonValue
} from "../types";
import "./buttonPopout.css";

const EMPTY_TOOL_FIELDS: ButtonToolField[] = [];

function initialFieldValues(fields: ButtonToolField[]): Record<string, JsonValue> {
  return Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
}

function findLegacyOwnerPlacement(
  document: ButtonStateDocument,
  ownerButtonId: string
): ButtonPlacement | null {
  const candidates = Object.values(document.placements).filter(
    (placement) => placement.buttonId === ownerButtonId
  );
  candidates.sort((left, right) => {
    const leftSurface = document.surfaces[left.surfaceId];
    const rightSurface = document.surfaces[right.surfaceId];
    const rank = (kind: string | undefined) =>
      kind === "panel" ? 0 : kind === "main" ? 1 : kind === "fan" ? 2 : 3;
    return rank(leftSurface?.kind) - rank(rightSurface?.kind) || left.id.localeCompare(right.id);
  });
  return candidates[0] ?? null;
}

function resolveSavedOwnerPlacement(
  document: ButtonStateDocument,
  unit: ButtonPopoutUnit
): ButtonPlacement | null {
  const ownerPlacementId = unit.ownerPlacementId?.trim();
  const ownerButtonId = unit.ownerButtonId?.trim();
  if (!ownerPlacementId || !ownerButtonId) return null;
  const placement = document.placements[ownerPlacementId];
  return placement?.surfaceId === unit.surfaceId && placement.buttonId === ownerButtonId
    ? placement
    : null;
}

function buildCollapsedOwnerDocument(args: {
  document: ButtonStateDocument;
  unit: ButtonPopoutUnit;
  sourcePlacement: ButtonPlacement;
}): { document: ButtonStateDocument; surfaceId: string; placementId: string } | null {
  const ownerButtonId = args.sourcePlacement.buttonId;
  const sourcePlacement = args.sourcePlacement;

  const surfaceId = `button-window-owner-surface:${ownerButtonId}`;
  const placementId = `button-window-owner-placement:${ownerButtonId}`;
  return {
    surfaceId,
    placementId,
    document: {
      ...args.document,
      placements: {
        ...args.document.placements,
        [placementId]: {
          ...sourcePlacement,
          id: placementId,
          surfaceId,
          x: 0,
          y: 0,
          zIndex: 0
        }
      },
      surfaces: {
        ...args.document.surfaces,
        [surfaceId]: {
          id: surfaceId,
          name: `${args.unit.name} owner`,
          kind: "tool-set-popout",
          width: sourcePlacement.width,
          height: sourcePlacement.height,
          placementIds: [placementId],
          visualOverflowAllowance: 0,
          uniformButtonSize: null
        }
      }
    }
  };
}

export interface ButtonPopoutRendererProps {
  document: ButtonStateDocument;
  unit: ButtonPopoutUnit;
  displayMode: "collapsed" | "expanded";
  surfaceScale?: number;
  surfaceEnvelope?: ButtonRect;
  onOwnerActivate?: (button: ButtonRecord) => void | Promise<void>;
  onRequestInlineEditorFocus?: () => void | Promise<void>;
  onPlacementMeasurement?: (
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => void;
  onPlacementVisualMeasurement?: (
    placementId: string,
    measurement: ButtonVisualMeasurement
  ) => void;
  onPreparePlacementVisualStateChange?: (
    placementId: string,
    state: ButtonVisualState
  ) => void | Promise<void>;
  onPlacementVisualStateChange?: (placementId: string, state: ButtonVisualState) => void;
}

export function ButtonPopoutRenderer({
  document,
  unit,
  displayMode,
  surfaceScale = 1,
  surfaceEnvelope,
  onOwnerActivate,
  onRequestInlineEditorFocus,
  onPlacementMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange
}: ButtonPopoutRendererProps) {
  const fields = unit.kind === "tool-set" ? unit.fields : EMPTY_TOOL_FIELDS;
  const [fieldValues, setFieldValues] = useState<Record<string, JsonValue>>(() =>
    initialFieldValues(fields)
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  useEffect(() => {
    const nextValues = initialFieldValues(fields);
    setFieldValues(nextValues);
    setFieldError(null);
  }, [unit.id, fields]);

  const acceptFieldValues = useCallback(
    (nextValues: Readonly<Record<string, JsonValue>>) => {
      setFieldValues((current) => {
        const keys = Object.keys(nextValues);
        const unchanged =
          keys.length === Object.keys(current).length &&
          keys.every((key) => Object.is(current[key], nextValues[key]));
        return unchanged ? current : { ...nextValues };
      });
    },
    []
  );

  const applyExecutionResult = useCallback(
    (result: ButtonExecutionResult) => {
      acceptFieldValues(result.fieldValues);
      setFieldError(result.message ?? null);
    },
    [acceptFieldValues]
  );
  const savedOwnerPlacement = useMemo(
    () => resolveSavedOwnerPlacement(document, unit),
    [document, unit]
  );
  const authoredFan = unit.interactionMode === "fan" && Boolean(savedOwnerPlacement);
  const collapsedSourcePlacement = authoredFan
    ? savedOwnerPlacement
    : unit.kind === "tool-set"
      ? findLegacyOwnerPlacement(document, unit.ownerButtonId)
      : null;
  const collapsedOwner = useMemo(
    () => collapsedSourcePlacement
      ? buildCollapsedOwnerDocument({ document, unit, sourcePlacement: collapsedSourcePlacement })
      : null,
    [collapsedSourcePlacement, document, unit]
  );
  const expandedDocument = useMemo(() => {
    if (authoredFan || !savedOwnerPlacement) return document;
    const surface = document.surfaces[unit.surfaceId];
    if (!surface?.placementIds.includes(savedOwnerPlacement.id)) return document;
    return {
      ...document,
      surfaces: {
        ...document.surfaces,
        [surface.id]: {
          ...surface,
          placementIds: surface.placementIds.filter(
            (placementId) => placementId !== savedOwnerPlacement.id
          )
        }
      }
    };
  }, [authoredFan, document, savedOwnerPlacement, unit.surfaceId]);

  if (displayMode === "collapsed") {
    if (!collapsedOwner) {
      return <div className="button-window-error">Fan owner placement is missing.</div>;
    }
    return (
      <div
        className="button-popout-renderer__surface-frame"
        style={{
          width: (surfaceEnvelope?.width ?? collapsedOwner.document.surfaces[collapsedOwner.surfaceId].width) * surfaceScale,
          height: (surfaceEnvelope?.height ?? collapsedOwner.document.surfaces[collapsedOwner.surfaceId].height) * surfaceScale
        }}
      >
        <div
          className="button-popout-renderer button-popout-renderer--collapsed"
          style={{
            width: collapsedOwner.document.surfaces[collapsedOwner.surfaceId].width,
            height: collapsedOwner.document.surfaces[collapsedOwner.surfaceId].height,
            transform: `translate(${-(surfaceEnvelope?.x ?? 0) * surfaceScale}px, ${-(surfaceEnvelope?.y ?? 0) * surfaceScale}px) scale(${surfaceScale})`,
            transformOrigin: "top left"
          }}
        >
          <ButtonSurface
            document={collapsedOwner.document}
            surfaceId={collapsedOwner.surfaceId}
            mode="run"
            ownerPlacementId={collapsedOwner.placementId}
            onRequestInlineEditorFocus={onRequestInlineEditorFocus}
            onPlacementMeasurement={onPlacementMeasurement}
            onPlacementVisualMeasurement={onPlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
            onPlacementVisualStateChange={onPlacementVisualStateChange}
            onOwnerActivate={(_placementId: string, button: ButtonRecord) => onOwnerActivate?.(button)}
          />
        </div>
      </div>
    );
  }

  const surface = document.surfaces[unit.surfaceId];
  if (!surface) {
    return <div className="button-window-error">Popout surface is missing.</div>;
  }
  const normalizedSurfaceScale = Number.isFinite(surfaceScale) && surfaceScale > 0
    ? surfaceScale
    : 1;
  const envelope = surfaceEnvelope ?? { x: 0, y: 0, width: surface.width, height: surface.height };

  return (
    <div
      className="button-popout-renderer__surface-frame"
      style={{
        width: envelope.width * normalizedSurfaceScale,
        height: envelope.height * normalizedSurfaceScale
      }}
    >
      <div
        className="button-popout-renderer button-popout-renderer--expanded"
        style={{
          width: surface.width,
          height: surface.height,
          transform: `translate(${-envelope.x * normalizedSurfaceScale}px, ${-envelope.y * normalizedSurfaceScale}px) scale(${normalizedSurfaceScale})`,
          transformOrigin: "top left"
        }}
      >
        <ButtonSurface
          document={expandedDocument}
          surfaceId={surface.id}
          mode="run"
          ownerPlacementId={authoredFan ? savedOwnerPlacement?.id : undefined}
          resetResultMappedActivationStateOnMount={unit.kind === "tool-set"}
          fields={fields}
          fieldValues={fieldValues}
          onRequestInlineEditorFocus={onRequestInlineEditorFocus}
          onFieldPatch={(
            _patch: Readonly<Record<string, JsonValue>>,
            nextValues: Readonly<Record<string, JsonValue>>
          ) => acceptFieldValues(nextValues)}
          onExecutionResult={(_placementId: string, result: ButtonExecutionResult) =>
            applyExecutionResult(result)
          }
          onFieldExecutionResult={(_fieldId: string, result: ButtonExecutionResult) =>
            applyExecutionResult(result)
          }
          onPlacementMeasurement={onPlacementMeasurement}
          onPlacementVisualMeasurement={onPlacementVisualMeasurement}
          onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
          onPlacementVisualStateChange={onPlacementVisualStateChange}
          onOwnerActivate={(_placementId: string, button: ButtonRecord) => onOwnerActivate?.(button)}
        />
        {fieldError ? <div className="button-window-error">{fieldError}</div> : null}
      </div>
    </div>
  );
}

export default ButtonPopoutRenderer;
