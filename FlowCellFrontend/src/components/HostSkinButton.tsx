import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { resolveGreenHighlightColor } from "../lib/highlightPalette";
import type { ImportedSkin, StyleGroup } from "../types";
import { renderButtonSkin } from "../lib/skins";

interface HostSkinButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  selected?: boolean;
  skinCompact?: boolean;
  highlightKey?: string;
  hostMode?: "native-button" | "neutral";
}

export const HostSkinButton = forwardRef<HTMLElement, HostSkinButtonProps>(
  (
    {
      label,
      styleGroup,
      importedSkin,
      selected = false,
      skinCompact = false,
      highlightKey,
      hostMode = "native-button",
      className,
      style,
      type,
      disabled = false,
      tabIndex,
      onClick,
      onKeyDown,
      onKeyUp,
      ...buttonProps
    },
    ref
  ) => {
    const resolvedClassName = [className, "host-skin-button"].filter(Boolean).join(" ");
    const resolvedStyle: CSSProperties = {
      ...(style ?? {}),
      ...(highlightKey
        ? {
            ["--fc-selected-highlight" as const]: resolveGreenHighlightColor(highlightKey)
          }
        : {})
    };
    const setRootRef = (node: HTMLElement | null) => {
      if (typeof ref === "function") {
        ref(node);
        return;
      }
      if (ref) {
        ref.current = node;
      }
    };

    const handleNeutralClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      if (disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.(event as unknown as ReactMouseEvent<HTMLButtonElement>);
    };

    const handleNeutralKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.currentTarget.click();
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
      }
    };

    const handleNeutralKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      onKeyUp?.(event as unknown as ReactKeyboardEvent<HTMLButtonElement>);
      if (event.defaultPrevented || disabled) {
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.currentTarget.click();
      }
    };

    if (hostMode === "neutral") {
      const neutralProps = buttonProps as unknown as HTMLAttributes<HTMLDivElement>;
      return (
        <div
          ref={setRootRef}
          role="button"
          tabIndex={disabled ? -1 : (tabIndex ?? 0)}
          aria-disabled={disabled ? "true" : undefined}
          className={resolvedClassName}
          data-selected={selected ? "true" : "false"}
          style={resolvedStyle}
          onClick={handleNeutralClick}
          onKeyDown={handleNeutralKeyDown}
          onKeyUp={handleNeutralKeyUp}
          {...neutralProps}
        >
          <span className="host-skin-button__frame">
            {renderButtonSkin({
              label,
              styleGroup,
              importedSkin,
              selected,
              compact: skinCompact
            })}
          </span>
        </div>
      );
    }

    return (
      <button
        ref={setRootRef}
        type={type}
        disabled={disabled}
        tabIndex={tabIndex}
        className={resolvedClassName}
        data-selected={selected ? "true" : "false"}
        style={resolvedStyle}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        {...buttonProps}
      >
        <span className="host-skin-button__frame">
          {renderButtonSkin({
            label,
            styleGroup,
            importedSkin,
            selected,
            compact: skinCompact
          })}
        </span>
      </button>
    );
  }
);

HostSkinButton.displayName = "HostSkinButton";
