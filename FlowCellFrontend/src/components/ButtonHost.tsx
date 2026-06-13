import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { HostSkinButton } from "./HostSkinButton";
import { DEFAULT_FLOW_IMPORTED_SKIN } from "../lib/theme";
import type { ImportedSkin, StyleGroup } from "../types";
import type { ButtonRecord } from "../pages/main/mainLayout";

type ButtonHostProps = {
  button: ButtonRecord;
  onActivate?: (
    button: ButtonRecord,
    event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>
  ) => void;
  onDoubleActivate?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  onRequestContextMenu?: (button: ButtonRecord, event: ReactMouseEvent<HTMLElement>) => void;
  absolute?: boolean;
  targetHeightOverride?: number;
  importedSkinOverride?: ImportedSkin;
  styleGroupOverride?: StyleGroup;
  skinProfileHighlight?: boolean;
  activateOnPointerDown?: boolean;
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
  absolute = true,
  targetHeightOverride,
  importedSkinOverride,
  styleGroupOverride,
  skinProfileHighlight = false,
  activateOnPointerDown = false
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
  const hoverTitle = button.tooltip?.trim() || button.label || button.actionId;
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
    if (activateOnPointerDown && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onActivate?.(button, event);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      !activateOnPointerDown ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

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
      title={hoverTitle}
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
      disabled={button.disabled ?? false}
      data-button-id={button.id}
      data-action-id={button.actionId}
      data-group-id={button.groupId ?? ""}
      data-rail-id={button.railId ?? ""}
      data-shape-type={button.shapeType}
      onPointerDown={handlePointerDown}
      onClick={activate}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
}
