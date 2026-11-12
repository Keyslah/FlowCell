import { useId, useMemo } from "react";
import { ButtonHost } from "./ButtonHost";
import {
  getChippedConcreteButtonSize,
  getChippedConcreteButtonSkin
} from "./skins/chippedConcreteButtonSkin";
import type { ButtonPlacement, ButtonRecord } from "./types";

export default function ChippedConcreteActionButton({ children, className = "", disabled = false, title = "", onClick }: {
  children: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  type?: "button";
  onClick?(): void | Promise<void>;
}) {
  const id = useId();
  const label = children;
  const skin = useMemo(() => getChippedConcreteButtonSkin(label), [label]);
  const size = getChippedConcreteButtonSize(label);
  const button: ButtonRecord = {
    id: `action:${id}`,
    role: "panel-owner",
    sourceIdentity: null,
    label,
    tooltip: title,
    executionTarget: null,
    defaultSkinId: skin.id,
    defaultTextFitMode: "shrink",
    disabled,
    activationAnimation: null,
    activationBehavior: null,
    toolSetParentId: null,
    toolSetBehavior: null,
    metadata: {}
  };
  const placement: ButtonPlacement = {
    id: `action-placement:${id}`,
    buttonId: button.id,
    surfaceId: "action-controls",
    x: 0,
    y: 0,
    ...size,
    zIndex: 0,
    skinOverrideId: null,
    textFitMode: "shrink",
    textAlignment: "skin",
    textOffsetX: 0,
    textOffsetY: 0,
    minimumFontSize: 8,
    textSizeOverride: null,
    allowLabelResize: false,
    matchHitboxToSkin: true,
    allowStretching: false,
    highlightOnHover: false,
    resizeAnchor: "top-left",
    activationCycle: null,
    visualStateMap: null
  };
  return <span className={`chipped-concrete-action-button ${className}`} style={{
    ...size,
    display: "inline-block",
    position: "relative",
    flexShrink: 0,
    verticalAlign: "middle",
    overflow: "visible",
    pointerEvents: "none",
    padding: 0,
    border: 0,
    background: "none"
  }}>
    <ButtonHost
      button={button}
      placement={placement}
      skin={skin}
      selected={className.split(/\s+/).includes("is-active")}
      onActivate={() => onClick?.()}
    />
  </span>;
}
