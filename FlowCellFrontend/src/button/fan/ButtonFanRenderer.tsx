import { useMemo } from "react";
import { ButtonSurface } from "../ButtonSurface";
import { executeButtonRecord } from "../runtime/ButtonRuntimeAdapter";
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
import "./buttonFan.css";

function buildCollapsedPanelOwnerDocument(args: {
  document: ButtonStateDocument;
  setup: ButtonFanSetup;
}): { document: ButtonStateDocument; surfaceId: string } | null {
  const sourcePlacement = resolvePanelOwnerFanPlacement(args.document, args.setup.id);
  if (!sourcePlacement) {
    return null;
  }

  const surfaceId = `button-window-panel-owner-surface:${args.setup.panelOwnerButtonId}`;
  const placementId = `button-window-panel-owner-placement:${args.setup.panelOwnerButtonId}`;
  return {
    surfaceId,
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
          visualOverflowAllowance: 0
        }
      }
    }
  };
}

export interface ButtonFanRendererProps {
  document: ButtonStateDocument;
  setup: ButtonFanSetup;
  expanded: boolean;
  onOwnerActivate: (button: ButtonRecord) => void | Promise<void>;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onHoverCancel?: () => void;
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
  surfaceEnvelope?: ButtonRect;
}

export function ButtonFanRenderer({
  document,
  setup,
  expanded,
  onOwnerActivate,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  onPlacementMeasurement,
  onPlacementVisualMeasurement,
  onPreparePlacementVisualStateChange,
  onPlacementVisualStateChange,
  surfaceEnvelope
}: ButtonFanRendererProps) {
  const collapsedOwner = useMemo(
    () => buildCollapsedPanelOwnerDocument({ document, setup }),
    [document, setup]
  );

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
            surfaceId={collapsedOwner.surfaceId}
            mode="run"
            onPlacementMeasurement={onPlacementMeasurement}
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
        className="button-fan-renderer button-fan-renderer--expanded"
        style={{
          width: surface.width,
          height: surface.height,
          transform: `translate(${-envelope.x}px, ${-envelope.y}px)`
        }}
      >
      <ButtonSurface
        document={document}
        surfaceId={surface.id}
        mode="run"
        onPlacementMeasurement={onPlacementMeasurement}
        onPlacementVisualMeasurement={onPlacementVisualMeasurement}
        onPreparePlacementVisualStateChange={onPreparePlacementVisualStateChange}
        onPlacementVisualStateChange={onPlacementVisualStateChange}
        onActivate={async (_placementId: string, button: ButtonRecord) => {
          if (button.id === setup.panelOwnerButtonId) {
            await onOwnerActivate(button);
            return;
          }
          await executeButtonRecord(button, "click");
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
