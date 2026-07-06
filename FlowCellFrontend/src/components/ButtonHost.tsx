import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent
} from "react";
import { HostSkinButton } from "./HostSkinButton";
import { hideFlowTooltip, showFlowTooltipForElement } from "../lib/flowTooltip";
import { DEFAULT_FLOW_IMPORTED_SKIN } from "../lib/theme";
import type { ImportedSkin, StyleGroup } from "../types";
import type { ButtonRecord } from "../pages/main/mainLayout";

type ButtonHostProps = {
  button: ButtonRecord;
  onActivate?: (
    button: ButtonRecord,
    event: ReactMouseEvent<HTMLElement>
  ) => void;
  onDoubleActivate?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  onRequestContextMenu?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  onHoverStart?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  onHoverEnd?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  onHoverCancel?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  absolute?: boolean;
  targetHeightOverride?: number;
  importedSkinOverride?: ImportedSkin;
  styleGroupOverride?: StyleGroup;
  skinProfileHighlight?: boolean;
};

type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

export const MAIN_PAGE_IMPORTED_STYLE_GROUP: StyleGroup = {
  id: "main-page-imported-button-style",
  index: 0,
  name: "Main Page Imported Button",
  skinId: "imported-skin",
  importedSkinId: DEFAULT_FLOW_IMPORTED_SKIN.id,
  accent: "#d2b28a"
};

export function ButtonHost({
  button,
  onActivate,
  onDoubleActivate,
  onRequestContextMenu,
  onHoverStart,
  onHoverEnd,
  onHoverCancel,
  absolute = true,
  targetHeightOverride,
  importedSkinOverride,
  styleGroupOverride,
  skinProfileHighlight = false
}: ButtonHostProps) {
  const isChromeAction =
    button.groupId === "top-left-actions" || button.groupId === "top-right-actions";
  const isSelectablePanelScript = button.actionId === "run-panel-script";
  const supportsContextMenu =
    isSelectablePanelScript ||
    button.actionId === "select-program-folder" ||
    button.actionId === "select-panel-folder";
  const allowVariableWidth = isChromeAction;
  const renderedLabel = isChromeAction
    ? button.label.replace(/ /g, "\u00A0")
    : button.label;
  const hoverDescription = button.tooltip?.trim() ?? "";
  const resolvedHeight = targetHeightOverride ?? button.height;
  const resolvedImportedSkin = importedSkinOverride ?? DEFAULT_FLOW_IMPORTED_SKIN;
  const resolvedStyleGroup = styleGroupOverride ?? MAIN_PAGE_IMPORTED_STYLE_GROUP;
  const heightRatio = button.height > 0 ? resolvedHeight / button.height : 1;
  const style: StyleWithVars = {
    position: absolute ? "absolute" : "relative",
    ...(absolute
      ? {
          left: `${button.x}px`,
          top: `${button.y}px`
        }
      : {}),
    ...(allowVariableWidth
      ? { minWidth: `${button.width * heightRatio}px` }
      : { width: `${button.width}px` }),
    height: `${resolvedHeight}px`,
    borderRadius: `${(button.radius ?? 0) * heightRatio}px`,
    "--button-radius": `${(button.radius ?? 0) * heightRatio}px`
  };

  const activate = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate?.(button, event);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onDoubleActivate?.(button, event);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!supportsContextMenu || !onRequestContextMenu) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onRequestContextMenu(button, event);
  };

  const showTooltip = (element: HTMLElement) => {
    if (!hoverDescription) {
      return;
    }
    void showFlowTooltipForElement(hoverDescription, element);
  };

  const handleTooltipPointerEnter = (event: ReactMouseEvent<HTMLElement>) => {
    onHoverStart?.(button, event);
    showTooltip(event.currentTarget);
  };

  const handleTooltipPointerLeave = (event: ReactMouseEvent<HTMLElement>) => {
    onHoverEnd?.(button, event);
    void hideFlowTooltip();
  };

  const handleTooltipPointerCancel = (event: ReactMouseEvent<HTMLElement>) => {
    onHoverCancel?.(button, event);
    void hideFlowTooltip();
  };

  const handleTooltipFocus = (event: ReactFocusEvent<HTMLElement>) => {
    showTooltip(event.currentTarget);
  };

  const handleTooltipBlur = () => {
    void hideFlowTooltip();
  };

  const hostClassName = [
    "button-host",
    isChromeAction ? "chrome-action" : "",
    button.railId ? "rail-action" : "",
    skinProfileHighlight ? "button-host--skin-profile-highlight" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <HostSkinButton
      type="button"
      label={renderedLabel}
      flowId={button.id}
      className={hostClassName}
      styleGroup={resolvedStyleGroup}
      importedSkin={resolvedImportedSkin}
      selected={button.isSelected ?? false}
      highlightKey={skinProfileHighlight ? `main-page:${button.id}` : undefined}
      targetHeight={resolvedHeight}
      autoInlineSize={allowVariableWidth}
      allowOverflow
      hostMode="neutral"
      style={style}
      role="button"
      aria-label={button.label || button.actionId}
      aria-description={button.tooltip?.trim() || undefined}
      aria-pressed={isSelectablePanelScript ? (button.isSelected ?? false) : undefined}
      title={hoverDescription || undefined}
      disabled={button.disabled ?? false}
      data-button-id={button.id}
      data-action-id={button.actionId}
      data-group-id={button.groupId ?? ""}
      data-rail-id={button.railId ?? ""}
      data-shape-type={button.shapeType}
      data-flow-tooltip={hoverDescription || undefined}
      onPointerEnter={handleTooltipPointerEnter}
      onPointerLeave={handleTooltipPointerLeave}
      onPointerCancel={handleTooltipPointerCancel}
      onFocus={handleTooltipFocus}
      onBlur={handleTooltipBlur}
      onClick={activate}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
}
