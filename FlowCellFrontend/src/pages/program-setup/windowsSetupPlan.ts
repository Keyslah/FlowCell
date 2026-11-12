import type { AddProgramPlanRequest, AvailableProgramPackage } from "../../lib/programRails.js";

export function buildWindowsSetupPlan(
  program: AvailableProgramPackage,
  selectedPanelNames: ReadonlySet<string>
): AddProgramPlanRequest {
  if (program.programId.toLowerCase() !== "windows" || program.programName.toLowerCase() !== "windows") {
    throw new Error("Windows setup received a different program package.");
  }
  const selectedPanels = program.panels
    .filter((panel) => panel.label === "Startup" || selectedPanelNames.has(panel.label))
    .map((panel) => panel.label);
  const selectedSources = program.sources
    .filter((source) => selectedPanels.includes(source.panelName) && (source.defaultSelected || source.required))
    .map((source) => ({ sourceId: source.id, destinationPanel: source.panelName }));
  return {
    programName: program.programName,
    executablePath: program.suggestedExecutable,
    createPlainProgram: false,
    selectedPanels,
    selectedSources
  };
}
