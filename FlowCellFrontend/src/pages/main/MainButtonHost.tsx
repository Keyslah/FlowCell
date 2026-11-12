import { useCallback, useState } from "react";
import { ButtonHost } from "../../button/ButtonHost";
import { getChippedConcreteButtonSkin } from "../../button/skins/chippedConcreteButtonSkin";
import type {
  ButtonPlacement,
  ButtonCoreMeasurement,
  ButtonRecord as CanonicalButtonRecord,
  ButtonSkin
} from "../../button/types";
import { rails, type ButtonRecord as MainLayoutButtonRecord } from "./mainLayout";

function useMainRailPosition(button: MainLayoutButtonRecord, absolute: boolean, fallbackWidth: number) {
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const rail = absolute && (button.railId === "program-rail" || button.railId === "panel-rail")
    ? rails.find((candidate) => candidate.id === button.railId)
    : undefined;
  const onMeasurement = useCallback((measurement: ButtonCoreMeasurement) => {
    if (!Number.isFinite(measurement.width) || measurement.width <= 0) return;
    setMeasuredWidth((previous) => previous !== null && Math.abs(previous - measurement.width) < 0.01
      ? previous : measurement.width);
  }, []);
  return {
    left: absolute
      ? rail ? rail.x + (rail.width - (measuredWidth ?? fallbackWidth)) / 2 : button.x
      : undefined,
    onMeasurement: rail ? onMeasurement : undefined
  };
}

export interface MainButtonHostProps {
  button: MainLayoutButtonRecord;
  canonicalPresentation: {
    button: CanonicalButtonRecord;
    placement: ButtonPlacement;
    skin: ButtonSkin;
  };
  absolute?: boolean;
  targetHeightOverride?: number;
  onActivate?: (
    button: MainLayoutButtonRecord,
    event: PointerEvent | KeyboardEvent
  ) => void | Promise<void>;
  onDoubleActivate?: (
    button: MainLayoutButtonRecord,
    event: MouseEvent
  ) => void | Promise<void>;
  onRequestContextMenu?: (button: MainLayoutButtonRecord, event: MouseEvent) => void;
  onHoverStart?: (button: MainLayoutButtonRecord) => void;
  onHoverEnd?: (button: MainLayoutButtonRecord) => void;
  onHoverCancel?: (button: MainLayoutButtonRecord) => void;
}

export function MainButtonHost({
  button,
  canonicalPresentation,
  absolute = true,
  targetHeightOverride,
  onActivate,
  onDoubleActivate,
  onRequestContextMenu,
  onHoverStart,
  onHoverEnd,
  onHoverCancel
}: MainButtonHostProps) {
  const { button: canonical, placement, skin } = canonicalPresentation;
  const renderedPlacement = targetHeightOverride === undefined
    ? placement
    : { ...placement, height: targetHeightOverride };
  const railPosition = useMainRailPosition(button, absolute, renderedPlacement.width);
  const mainPageDefaultLabel = typeof canonical.metadata.mainPageDefaultLabel === "string"
    ? canonical.metadata.mainPageDefaultLabel
    : null;
  const mainPageDefaultTooltip = typeof canonical.metadata.mainPageDefaultTooltip === "string"
    ? canonical.metadata.mainPageDefaultTooltip
    : null;
  const effectiveCanonical = mainPageDefaultLabel !== null
    ? {
        ...canonical,
        label: canonical.label === mainPageDefaultLabel ? button.label : canonical.label,
        tooltip:
          mainPageDefaultTooltip !== null &&
          canonical.tooltip === mainPageDefaultTooltip
            ? button.tooltip ?? canonical.tooltip
            : canonical.tooltip,
        disabled: canonical.disabled || Boolean(button.disabled)
      }
    : canonical;

  return (
    <span
      data-main-button-host={button.id}
      style={{
        position: absolute ? "absolute" : "relative",
        left: railPosition.left,
        top: absolute ? button.y : undefined,
        display: "inline-block",
        width: renderedPlacement.width,
        height: renderedPlacement.height,
        overflow: "visible",
        pointerEvents: "none",
        // Match .rail-surface's z-index so DOM order keeps buttons above the rails.
        zIndex: 1
      }}
    >
      <ButtonHost
        button={effectiveCanonical}
        placement={renderedPlacement}
        skin={skin}
        familySkinCentering={railPosition.onMeasurement ? "vertical" : undefined}
        onMeasurement={railPosition.onMeasurement}
        selected={Boolean(button.isSelected)}
        selectionOnly={Boolean(button.scriptFileName)}
        onActivate={onActivate ? (_canonical, event) => onActivate(button, event) : undefined}
        onDoubleActivate={onDoubleActivate ? (_canonical, event) => onDoubleActivate(button, event) : undefined}
        onRequestContextMenu={onRequestContextMenu ? (_canonical, event) => onRequestContextMenu(button, event) : undefined}
        onHoverStart={onHoverStart ? () => onHoverStart(button) : undefined}
        onHoverEnd={onHoverEnd ? () => onHoverEnd(button) : undefined}
        onHoverCancel={onHoverCancel ? () => onHoverCancel(button) : undefined}
      />
    </span>
  );
}

export interface MainControlHostProps {
  control: MainLayoutButtonRecord;
  absolute?: boolean;
  targetHeightOverride?: number;
  onActivate?: (
    control: MainLayoutButtonRecord,
    event: PointerEvent | KeyboardEvent
  ) => void | Promise<void>;
  onDoubleActivate?: (
    control: MainLayoutButtonRecord,
    event: MouseEvent
  ) => void | Promise<void>;
  onRequestContextMenu?: (control: MainLayoutButtonRecord, event: MouseEvent) => void;
}

export function MainControlHost({
  control,
  absolute = true,
  targetHeightOverride,
  onActivate,
  onDoubleActivate,
  onRequestContextMenu
}: MainControlHostProps) {
  const isHeader = control.groupId === "top-left-actions" || control.groupId === "top-right-actions";
  const skin = getChippedConcreteButtonSkin(control.label, isHeader ? control.width : undefined);
  const height = targetHeightOverride ?? control.height;
  const railPosition = useMainRailPosition(control, absolute, control.width);
  const canonicalControl: CanonicalButtonRecord = {
    id: control.id,
    role: "panel-owner",
    sourceIdentity: null,
    label: control.label,
    tooltip: control.tooltip ?? "",
    executionTarget: null,
    defaultSkinId: skin.id,
    defaultTextFitMode: "shrink",
    disabled: Boolean(control.disabled),
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {
      actionId: control.actionId,
      mainPageControl: true,
      ...(isHeader ? { mainPageSection: "Header Buttons" } : {})
    }
  };
  const placement: ButtonPlacement = {
    id: `main-control-placement:${control.id}`,
    buttonId: control.id,
    surfaceId: "main-control-surface",
    x: control.x,
    y: control.y,
    width: control.width,
    height,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: !isHeader,
    allowStretching: false,
    highlightOnHover: false,
    activationCycle: null,
    visualStateMap: null,
    resizeAnchor: "top-left"
  };

  return (
    <span
      data-main-control-host={control.id}
      style={{
        position: absolute ? "absolute" : "relative",
        left: railPosition.left,
        top: absolute ? control.y : undefined,
        display: "inline-block",
        width: placement.width,
        height: placement.height,
        overflow: "visible",
        pointerEvents: "none",
        // Match .rail-surface's z-index so DOM order keeps controls above the rails.
        zIndex: 1
      }}
    >
      <ButtonHost
        button={canonicalControl}
        placement={placement}
        skin={skin}
        familySkinCentering={railPosition.onMeasurement ? "vertical" : undefined}
        onMeasurement={railPosition.onMeasurement}
        selected={Boolean(control.isSelected)}
        onActivate={onActivate ? (_canonical, event) => onActivate(control, event) : undefined}
        onDoubleActivate={onDoubleActivate ? (_canonical, event) => onDoubleActivate(control, event) : undefined}
        onRequestContextMenu={onRequestContextMenu ? (_canonical, event) => onRequestContextMenu(control, event) : undefined}
      />
    </span>
  );
}

export default MainButtonHost;
