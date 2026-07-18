import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { showOpenFileDialog, showOpenFolderDialog } from "../../lib/tauri";
import { ButtonSurface } from "../ButtonSurface";
import type { ButtonExecutionResult } from "../runtime/ButtonRuntimeAdapter";
import type {
  ButtonCoreMeasurement,
  ButtonPopoutUnit,
  ButtonRect,
  ButtonRecord,
  ButtonStateDocument,
  ButtonToolField,
  ButtonVisualMeasurement,
  ButtonVisualState,
  ToolSetButtonPopoutUnit,
  JsonValue
} from "../types";
import {
  isThemeWorkbenchPresentationConfig,
  ThemeWorkbench
} from "../toolPages";
import "./buttonPopout.css";

const EMPTY_TOOL_FIELDS: ButtonToolField[] = [];

function initialFieldValues(fields: ButtonToolField[]): Record<string, JsonValue> {
  return Object.fromEntries(fields.map((field) => [field.id, field.defaultValue]));
}

function findOwnerPlacementId(
  document: ButtonStateDocument,
  ownerButtonId: string
): string | null {
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
  return candidates[0]?.id ?? null;
}

function buildCollapsedOwnerDocument(args: {
  document: ButtonStateDocument;
  unit: ToolSetButtonPopoutUnit;
}): { document: ButtonStateDocument; surfaceId: string; placementId: string } | null {
  const ownerButtonId = args.unit.ownerButtonId;
  const sourcePlacementId = findOwnerPlacementId(args.document, ownerButtonId);
  const sourcePlacement = sourcePlacementId
    ? args.document.placements[sourcePlacementId]
    : undefined;
  if (!sourcePlacement) {
    return null;
  }

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
          visualOverflowAllowance: 0
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
  const themePresentation = unit.kind === "tool-set" &&
    unit.presentation?.renderer === "theme-workbench" &&
    isThemeWorkbenchPresentationConfig(unit.presentation.config)
    ? unit.presentation.config
    : null;
  const malformedThemePresentation = unit.kind === "tool-set" &&
    unit.presentation?.renderer === "theme-workbench" &&
    !themePresentation;
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
  const activateField = useCallback(async (
    field: ButtonToolField,
    _currentValue: JsonValue
  ): Promise<JsonValue | undefined> => {
    if (field.kind !== "path") {
      throw new Error(`Tool field '${field.id}' does not have a native activation service.`);
    }
    const selectedPaths = field.pathKind === "folder"
      ? await showOpenFolderDialog({ title: `Choose ${field.label}`, multiselect: false })
      : await showOpenFileDialog({
          title: `Choose ${field.label}`,
          filter: field.filter?.trim() || "All files (*.*)|*.*",
          multiselect: false
        });
    return selectedPaths[0]?.trim() || undefined;
  }, []);
  const resolveImageSource = useCallback((path: string) => {
    try {
      return convertFileSrc(path);
    } catch {
      return null;
    }
  }, []);

  const collapsedOwner = useMemo(
    () => unit.kind === "tool-set" ? buildCollapsedOwnerDocument({ document, unit }) : null,
    [document, unit]
  );

  if (displayMode === "collapsed") {
    if (unit.kind !== "tool-set" || !collapsedOwner) {
      return <div className="button-window-error">Tool-set owner placement is missing.</div>;
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
            onPlacementMeasurement={onPlacementMeasurement}
            onPlacementVisualMeasurement={onPlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
            onPlacementVisualStateChange={onPlacementVisualStateChange}
            onActivate={(_placementId: string, button: ButtonRecord) => onOwnerActivate?.(button)}
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
        {themePresentation && unit.kind === "tool-set" ? (
          <ThemeWorkbench
            document={document}
            unit={unit}
            presentation={themePresentation}
            fieldValues={fieldValues}
            onFieldPatch={(_patch, nextValues) => acceptFieldValues(nextValues)}
            onFieldActivate={activateField}
            onExecutionResult={(_slot, _button, result) => applyExecutionResult(result)}
            onPlacementMeasurement={onPlacementMeasurement}
            onPlacementVisualMeasurement={onPlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
            onPlacementVisualStateChange={onPlacementVisualStateChange}
            resolveImageSource={resolveImageSource}
          />
        ) : (
          <ButtonSurface
            document={document}
            surfaceId={surface.id}
            mode="run"
            fields={fields}
            fieldValues={fieldValues}
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
          />
        )}
        {malformedThemePresentation ? (
          <div className="button-window-error">The installed tool-page presentation is malformed.</div>
        ) : null}
        {fieldError ? <div className="button-window-error">{fieldError}</div> : null}
      </div>
    </div>
  );
}

export default ButtonPopoutRenderer;
