import type { FlowCellButton, ImportedSkin, StyleGroup } from "../types";
import { getImportedSkin, resolveStyleGroup } from "../lib/skins";
import { HostSkinButton } from "./HostSkinButton";

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
    <HostSkinButton
      type="button"
      label={button.Label}
      flowId={button.Id}
      className={`button-card ${selected ? "is-selected" : ""} ${compact ? "button-card--compact" : ""}`}
      styleGroup={styleGroup}
      importedSkin={importedSkin}
      selected={selected}
      skinCompact={compact}
      onClick={onActivate}
      onFocus={compact ? undefined : onSelect}
      title={button.Tooltip || button.Label}
      afterContent={
        !compact ? (
          <span className="button-card__meta">
            <span>{button.Kind}</span>
            <span>{button.command_id}</span>
          </span>
        ) : null
      }
    />
  );
}
