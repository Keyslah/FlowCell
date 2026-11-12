import { useMemo, useRef } from "react";
import { ButtonSurface } from "../ButtonSurface";
import type { ProgramPopoutThemeScreenGeometry } from "../../theme/programPopoutTheme";
import {
  executeButtonRecord,
  type ButtonExecutionResult
} from "../runtime/ButtonRuntimeAdapter";
import { resolvePanelOwnerFanPlacement } from "../state/panelOwnerButtonOperations";
import type {
  ButtonCoreMeasurement,
  ButtonFanSetup,
  ButtonRect,
  ButtonRecord,
  ButtonStateDocument,
  ButtonVisualMeasurement,
  ButtonVisualState
} from "../types";
import type { ButtonFanMotionDirection, ButtonFanMotionStyle } from "./buttonFanMotion";
import { useButtonFanMotion, type ButtonFanMotionPhase } from "./useButtonFanMotion";
export type { ButtonFanMotionPhase } from "./useButtonFanMotion";
import "./buttonFan.css";

function buildCollapsedPanelOwnerDocument(args: {
  document: ButtonStateDocument;
  setup: ButtonFanSetup;
}): { document: ButtonStateDocument; surfaceId: string; sourcePlacementId: string } | null {
  const sourcePlacement = resolvePanelOwnerFanPlacement(args.document, args.setup.id);
  if (!sourcePlacement) {
    return null;
  }

  const surfaceId = `button-window-panel-owner-surface:${args.setup.panelOwnerButtonId}`;
  const placementId = `button-window-panel-owner-placement:${args.setup.panelOwnerButtonId}`;
  const sourceThemeOverride = args.document.themeOverrides?.[sourcePlacement.id];
  return {
    surfaceId,
    sourcePlacementId: sourcePlacement.id,
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
          name: `${args.setup.name} panel owner`,
          kind: "fan",
          width: sourcePlacement.width,
          height: sourcePlacement.height,
          placementIds: [placementId],
          visualOverflowAllowance: 0,
          uniformButtonSize: null
        }
      },
      themeOverrides: sourceThemeOverride
        ? { ...args.document.themeOverrides, [placementId]: sourceThemeOverride }
        : args.document.themeOverrides
    }
  };
}

export interface ButtonFanRendererProps {
  document: ButtonStateDocument;
  programPopoutThemeScreenGeometry?: ProgramPopoutThemeScreenGeometry;
  setup: ButtonFanSetup;
  expanded: boolean;
  motionPhase?: ButtonFanMotionPhase;
  motionSequence?: number;
  motionStyles?: readonly ButtonFanMotionStyle[];
  onMotionStart?: (phase: ButtonFanMotionDirection, sequence: number) => void;
  onMotionComplete?: (phase: ButtonFanMotionDirection, sequence: number) => void;
  onOwnerActivate: (button: ButtonRecord) => void | Promise<void>;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onHoverCancel?: () => void;
  onExecutionResult?: (placementId: string, result: ButtonExecutionResult) => void;
  onPlacementMeasurement?: (
    placementId: string,
    measurement: ButtonCoreMeasurement
  ) => void;
  onPlacementNaturalMeasurement?: (
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
  surfaceEnvelope?: ButtonRect;
}

export function ButtonFanRenderer({
  document,
  programPopoutThemeScreenGeometry,
  setup,
  expanded,
  motionPhase = "resting",
  motionSequence = 0,
  motionStyles = [],
  onMotionStart,
  onMotionComplete,
  onOwnerActivate,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onExecutionResult,
  onPlacementMeasurement,
  onPlacementNaturalMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  surfaceEnvelope
}: ButtonFanRendererProps) {
  const expandedSurfaceRef = useRef<HTMLDivElement | null>(null);
  const collapsedOwner = useMemo(
    () => buildCollapsedPanelOwnerDocument({ document, setup }),
    [document, setup]
  );
  useButtonFanMotion({
    surfaceRootRef: expandedSurfaceRef,
    document,
    surfaceId: setup.fanSurfaceId,
    ownerPlacementId: collapsedOwner?.sourcePlacementId,
    animation: setup.animation,
    enabled: motionStyles.includes("spin"),
    expanded,
    motionPhase,
    motionSequence,
    onMotionStart,
    onMotionComplete
  });

  if (!expanded) {
    if (!collapsedOwner) {
      return <div className="button-window-error">Panel-owner placement is missing.</div>;
    }
    const surface = collapsedOwner.document.surfaces[collapsedOwner.surfaceId];
    const envelope = surfaceEnvelope ?? { x: 0, y: 0, width: surface.width, height: surface.height };
    return (
      <div className="button-fan-renderer__surface-frame" style={{ width: envelope.width, height: envelope.height }}>
        <div
          className="button-fan-renderer button-fan-renderer--collapsed"
          style={{
            width: surface.width,
            height: surface.height,
            transform: `translate(${-envelope.x}px, ${-envelope.y}px)`
          }}
        >
          <ButtonSurface
            document={collapsedOwner.document}
            programPopoutThemeScreenGeometry={programPopoutThemeScreenGeometry}
            programPopoutThemeSourcePlacementId={collapsedOwner.sourcePlacementId}
            surfaceId={collapsedOwner.surfaceId}
            mode="run"
            onPlacementMeasurement={onPlacementMeasurement}
            visualMeasurementSamplingKey={motionPhase === "resting" ? motionSequence : undefined}
            onPlacementNaturalMeasurement={(_placementId, measurement) =>
              onPlacementNaturalMeasurement?.(collapsedOwner.sourcePlacementId, measurement)}
            onPlacementVisualMeasurement={onPlacementVisualMeasurement}
            onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
            onPlacementVisualStateChange={onPlacementVisualStateChange}
            onActivate={(_placementId: string, button: ButtonRecord) => onOwnerActivate(button)}
            onHoverStart={() => onHoverStart?.()}
            onHoverEnd={() => onHoverEnd?.()}
            onHoverCancel={() => onHoverCancel?.()}
          />
        </div>
      </div>
    );
  }

  const surface = document.surfaces[setup.fanSurfaceId];
  if (!surface) {
    return <div className="button-window-error">Fan surface is missing.</div>;
  }

  const envelope = surfaceEnvelope ?? { x: 0, y: 0, width: surface.width, height: surface.height };
  return (
    <div className="button-fan-renderer__surface-frame" style={{ width: envelope.width, height: envelope.height }}>
      <div
        ref={expandedSurfaceRef}
        className="button-fan-renderer button-fan-renderer--expanded"
        style={{
          width: surface.width,
          height: surface.height,
          transform: `translate(${-envelope.x}px, ${-envelope.y}px)`
        }}
      >
      <ButtonSurface
        document={document}
        programPopoutThemeScreenGeometry={programPopoutThemeScreenGeometry}
        surfaceId={surface.id}
        mode="run"
        onPlacementMeasurement={onPlacementMeasurement}
        visualMeasurementSamplingKey={motionPhase === "resting" ? motionSequence : undefined}
        onPlacementNaturalMeasurement={onPlacementNaturalMeasurement}
        onPlacementVisualMeasurement={onPlacementVisualMeasurement}
        onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
        onPlacementVisualStateChange={onPlacementVisualStateChange}
        onExecutionResult={onExecutionResult}
        onActivate={async (_placementId: string, button: ButtonRecord, event) => {
          if (button.id === setup.panelOwnerButtonId) {
            await onOwnerActivate(button);
            return;
          }
          await executeButtonRecord(button, "click", {
            payloadOverride: { modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }
          });
        }}
        onHoverStart={() => onHoverStart?.()}
        onHoverEnd={() => onHoverEnd?.()}
        onHoverCancel={() => onHoverCancel?.()}
      />
      </div>
    </div>
  );
}

export default ButtonFanRenderer;
