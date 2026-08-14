import type { BindableButtonRecord, FrontendMacroSummaryRecord } from "../types.js";

export type BindsPanelMacroScope = {
  macroButtons: BindableButtonRecord[];
  selectedMacroId: string;
};

function scopeNameMatches(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

export function deriveBindsPanelMacroScope(
  macros: readonly FrontendMacroSummaryRecord[],
  actionHotkeys: Readonly<Record<string, string>>,
  programName: string,
  panelName: string,
  selectedMacroId: string
): BindsPanelMacroScope {
  if (!programName.trim() || !panelName.trim()) {
    return {
      macroButtons: [],
      selectedMacroId: ""
    };
  }

  const macroButtons = macros
    .filter(
      (macro) =>
        scopeNameMatches(macro.programName, programName) &&
        scopeNameMatches(macro.panelName, panelName)
    )
    .map<BindableButtonRecord>((macro) => ({
      id: macro.id,
      label: macro.label,
      kind: "macro",
      target: macro.id,
      shortcut: actionHotkeys[macro.id]
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  return {
    macroButtons,
    selectedMacroId: macroButtons.some((macro) => macro.target === selectedMacroId)
      ? selectedMacroId
      : macroButtons[0]?.target ?? ""
  };
}
