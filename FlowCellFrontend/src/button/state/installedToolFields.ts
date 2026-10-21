import type { ButtonExecutionTarget, ButtonToolField } from "../types.js";
import { cloneButtonDocument } from "./buttonDefaults.js";

/**
 * Copies installed layout fields into canonical tool fields. A field service
 * declared as `{ kind: "tool-set-action", command }` with no routing keys
 * targets its own tool set, so its routing is taken from the installed
 * children, which all dispatch through the same owner record.
 */
export function resolveInstalledToolFields(
  fields: readonly ButtonToolField[] | undefined,
  children: readonly { executionTarget: ButtonExecutionTarget | null }[]
): ButtonToolField[] {
  const resolved = cloneButtonDocument([...(fields ?? [])]);
  const route = children
    .map((child) => child.executionTarget)
    .find((target) => target?.kind === "tool-set-action");
  for (const field of resolved) {
    const target = field.serviceTarget as Partial<Extract<ButtonExecutionTarget, { kind: "tool-set-action" }>> | undefined;
    if (target?.kind !== "tool-set-action" || target.programName !== undefined) continue;
    if (!route || route.kind !== "tool-set-action") {
      throw new Error(`Tool field '${field.id}' targets its tool set, but the tool set has no action children.`);
    }
    field.serviceTarget = {
      ...target,
      kind: "tool-set-action",
      programName: route.programName,
      panelName: route.panelName,
      ownerFileName: route.ownerFileName,
      command: target.command ?? ""
    };
  }
  return resolved;
}
