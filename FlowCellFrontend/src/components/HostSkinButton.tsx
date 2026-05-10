import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { ImportedSkin, StyleGroup } from "../types";
import { renderButtonSkin } from "../lib/skins";

interface HostSkinButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  selected?: boolean;
  skinCompact?: boolean;
}

export const HostSkinButton = forwardRef<HTMLButtonElement, HostSkinButtonProps>(
  (
    {
      label,
      styleGroup,
      importedSkin,
      selected = false,
      skinCompact = false,
      className,
      ...buttonProps
    },
    ref
  ) => {
    const resolvedClassName = [className, styleGroup ? "host-skin-button" : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <button ref={ref} className={resolvedClassName} {...buttonProps}>
        {styleGroup ? (
          <span className="host-skin-button__frame">
            {renderButtonSkin({
              label,
              styleGroup,
              importedSkin,
              selected,
              compact: skinCompact
            })}
          </span>
        ) : (
          <span className="host-skin-button__fallback">{label}</span>
        )}
      </button>
    );
  }
);

HostSkinButton.displayName = "HostSkinButton";
