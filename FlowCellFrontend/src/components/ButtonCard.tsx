import type { FlowCellButton, ImportedSkin, StyleGroup } from "../types";
import { getImportedSkin, renderButtonSkin, resolveStyleGroup } from "../lib/skins";

interface ButtonCardProps {
  button: FlowCellButton;
  selected: boolean;
  compact?: boolean;
  styleGroups?: StyleGroup[];
  importedSkins?: ImportedSkin[];
  styleGroupOverride?: StyleGroup;
  importedSkinOverride?: ImportedSkin;
  onSelect: () => void;
  onActivate: () => void;
}

export function ButtonCard({
  button,
  selected,
  compact = false,
  styleGroups,
  importedSkins,
  styleGroupOverride,
  importedSkinOverride,
  onSelect,
  onActivate
}: ButtonCardProps) {
  const specificButtonStyleGroup = resolveStyleGroup(styleGroups, button.style_group_id ?? "");
  const styleGroup = specificButtonStyleGroup ?? styleGroupOverride;
  const importedSkin =
    getImportedSkin(importedSkins, styleGroup?.importedSkinId) ?? importedSkinOverride;

  return (
    <button
      type="button"
      className={`button-card ${selected ? "is-selected" : ""} ${compact ? "button-card--compact" : ""}`}
      onClick={onActivate}
      onFocus={compact ? undefined : onSelect}
      title={button.Tooltip || button.Label}
    >
      {renderButtonSkin({
        label: button.Label,
        styleGroup,
        importedSkin,
        selected,
        compact
      })}
      {!compact ? (
        <span className="button-card__meta">
          <span>{button.Kind}</span>
          <span>{button.command_id}</span>
        </span>
      ) : null}
    </button>
  );
}
