import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
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
}

export const HostSkinButton = forwardRef<HTMLButtonElement, HostSkinButtonProps>(
  (
    {
      label,
      styleGroup,
      importedSkin,
      selected = false,
      skinCompact = false,
      highlightKey,
      className,
      style,
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

    return (
      <button
        ref={ref}
        className={resolvedClassName}
        data-selected={selected ? "true" : "false"}
        style={resolvedStyle}
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
