import type {
  ButtonStateDocument,
  ToolSetActionExecutionTarget,
  ToolSetButtonPopoutUnit
} from "../types.js";
import type { InstallButtonSourceResult } from "./ButtonStateRepository.js";
import { cloneButtonDocument } from "./buttonDefaults.js";

function toolSetChildSlot(target: unknown): string {
  if (!target || typeof target !== "object") return "";
  const candidate = target as Partial<ToolSetActionExecutionTarget>;
  return candidate.kind === "tool-set-action" && typeof candidate.command === "string"
    ? candidate.command.trim()
    : "";
}

const normalizedSlot = (value: string) => value.trim().toLocaleLowerCase("en-US");

export function applyInstalledSourceUpdate(
  document: ButtonStateDocument,
  installed: InstallButtonSourceResult
): void {
  const owner = document.buttons[installed.ownerButtonId];
  if (!owner?.sourceIdentity) {
    throw new Error(`Button '${installed.ownerButtonId}' is not an installed source owner.`);
  }

  if (installed.children.length === 0) {
    if (owner.role !== "single-script" || !installed.executionTarget) {
      throw new Error("The selected update no longer matches this single-script Button.");
    }
    owner.sourceIdentity = installed.sourceIdentity;
    owner.executionTarget = installed.executionTarget;
    return;
  }

  if (owner.role !== "tool-set-owner" || installed.executionTarget) {
    throw new Error("The selected update no longer matches this tool-set owner.");
  }
  const units = Object.values(document.popoutUnits).filter(
    (unit): unit is ToolSetButtonPopoutUnit =>
      unit.kind === "tool-set" && unit.ownerButtonId === owner.id
  );
  if (units.length !== 1) {
    throw new Error(`Tool-set owner '${owner.id}' must own exactly one canonical popout.`);
  }
  const unit = units[0];
  const childIdBySlot = new Map<string, string>();
  for (const childId of unit.childButtonIds) {
    const child = document.buttons[childId];
    if (!child || child.role !== "tool-set-child" || child.toolSetParentId !== owner.id) {
      throw new Error(`Tool-set owner '${owner.id}' has an invalid child graph.`);
    }
    const slot = normalizedSlot(toolSetChildSlot(child.executionTarget));
    if (!slot || childIdBySlot.has(slot)) {
      throw new Error(`Tool-set owner '${owner.id}' has missing or duplicate child slots.`);
    }
    childIdBySlot.set(slot, childId);
  }
  const incomingSlots = new Set(installed.children.map((child) => normalizedSlot(child.slot)));
  if (
    incomingSlots.size !== installed.children.length ||
    incomingSlots.size !== childIdBySlot.size ||
    [...incomingSlots].some((slot) => !childIdBySlot.has(slot))
  ) {
    throw new Error("Update cannot add, remove, or rename tool-set child slots. Delete and re-add the tool set to change its Button graph.");
  }

  owner.sourceIdentity = installed.sourceIdentity;
  owner.executionTarget = null;
  for (const child of installed.children) {
    const childButton = document.buttons[childIdBySlot.get(normalizedSlot(child.slot))!];
    childButton.executionTarget = child.executionTarget;
    childButton.toolSetBehavior = cloneButtonDocument(
      installed.layout?.childBehaviors?.[child.slot] ?? null
    );
  }
  unit.fields = cloneButtonDocument(installed.layout?.fields ?? []);
}
