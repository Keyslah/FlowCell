import { useMemo } from "react";
import { ButtonHost } from "./ButtonHost";
import { DEFAULT_BUTTON_SKIN } from "./skins/defaultButtonSkin";
import type { ButtonPlacement, ButtonRecord } from "./types";

export interface CanonicalActionButtonProps {
  id: string;
  label: string;
  tooltip?: string;
  width?: number;
  height?: number;
  disabled?: boolean;
  className?: string;
  onActivate: () => void | Promise<void>;
}

export function CanonicalActionButton({
  id,
  label,
  tooltip = "",
  width = 220,
  height = 44,
  disabled = false,
  className,
  onActivate
}: CanonicalActionButtonProps) {
  const button = useMemo<ButtonRecord>(() => ({
    id,
    role: "panel-owner",
    sourceIdentity: null,
    label,
    tooltip,
    executionTarget: null,
    defaultSkinId: DEFAULT_BUTTON_SKIN.id,
    defaultTextFitMode: "shrink-and-stack",
    disabled,
    activationAnimation: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  }), [disabled, id, label, tooltip]);
  const placement = useMemo<ButtonPlacement>(() => ({
    id: `action-placement:${id}`,
    buttonId: id,
    surfaceId: "action-control-surface",
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink-and-stack",
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    resizeAnchor: "top-left"
  }), [height, id, width]);
  return (
    <span
      className={className}
      style={{ display: "block", width, height, pointerEvents: "none" }}
    >
      <ButtonHost
        button={button}
        placement={placement}
        skin={DEFAULT_BUTTON_SKIN}
        onActivate={() => onActivate()}
      />
    </span>
  );
}

export default CanonicalActionButton;
