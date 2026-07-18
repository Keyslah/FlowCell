import { invoke } from "@tauri-apps/api/core";

export type ProgramTreeNode = {
  key: string;
  name: string;
  locked: boolean;
  hidden: boolean;
  depth: number;
  itemCount: number;
  children: ProgramTreeNode[];
};

export type ProgramTreeSnapshot = {
  active: string;
  tree: ProgramTreeNode[];
};

export type ProgramToolPageSource = {
  programName: string;
  panelName: string;
  fileName: string;
  capability: string;
};

type ProgramTreeOperation =
  | { op: "scan" }
  | { op: "create"; parentKey?: string; name?: string }
  | { op: "rename"; key: string; name: string }
  | { op: "delete"; keys: string[]; force?: boolean }
  | { op: "duplicate"; keys: string[] }
  | { op: "setlock"; keys: string[]; locked: boolean }
  | { op: "setvis"; keys: string[]; visible: boolean }
  | { op: "move"; key: string; targetKey?: string }
  | { op: "select"; key: string };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonValue(value: unknown, subject: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${subject} was unreadable: ${String(error)}`);
  }
}

function unwrapCapabilityResponse(raw: unknown): Record<string, unknown> {
  const outerValue = parseJsonValue(raw, "Program capability response");
  const outer = recordValue(outerValue);
  if (!outer) throw new Error("Program capability returned no response object.");
  if (outer.ok === false) {
    throw new Error(typeof outer.error === "string" && outer.error.trim()
      ? outer.error
      : "Program capability action failed.");
  }
  if (!("result" in outer)) return outer;
  const innerValue = parseJsonValue(outer.result, "Program capability result");
  const inner = recordValue(innerValue);
  if (!inner) throw new Error("Program capability returned no result object.");
  if (inner.ok === false) {
    throw new Error(typeof inner.error === "string" && inner.error.trim()
      ? inner.error
      : "Program capability action failed.");
  }
  return inner;
}

function normalizeTreeNode(value: unknown): ProgramTreeNode | null {
  const node = recordValue(value);
  if (!node || typeof node.key !== "string" || typeof node.name !== "string") return null;
  const children = Array.isArray(node.children)
    ? node.children.map(normalizeTreeNode).filter((child): child is ProgramTreeNode => child !== null)
    : [];
  return {
    key: node.key,
    name: node.name,
    locked: node.locked === true,
    hidden: node.hidden === true,
    depth: typeof node.depth === "number" ? node.depth : 0,
    itemCount: typeof node.itemCount === "number" ? node.itemCount : 0,
    children
  };
}

async function runTreeOperation(
  source: ProgramToolPageSource,
  operation: ProgramTreeOperation
): Promise<ProgramTreeSnapshot> {
  const raw = await invoke<unknown>("run_program_capability_action", {
    ...source,
    argsJson: JSON.stringify(operation)
  });
  const result = unwrapCapabilityResponse(raw);
  return {
    active: typeof result.active === "string" ? result.active : "",
    tree: Array.isArray(result.tree)
      ? result.tree.map(normalizeTreeNode).filter((node): node is ProgramTreeNode => node !== null)
      : []
  };
}

export const scanProgramTree = (source: ProgramToolPageSource) =>
  runTreeOperation(source, { op: "scan" });

export const createProgramTreeItem = (
  source: ProgramToolPageSource,
  parentKey: string,
  name: string
) => runTreeOperation(source, { op: "create", parentKey, name });

export const renameProgramTreeItem = (
  source: ProgramToolPageSource,
  key: string,
  name: string
) => runTreeOperation(source, { op: "rename", key, name });

export const deleteProgramTreeItems = (
  source: ProgramToolPageSource,
  keys: string[],
  force: boolean
) => runTreeOperation(source, { op: "delete", keys, force });

export const duplicateProgramTreeItems = (
  source: ProgramToolPageSource,
  keys: string[]
) => runTreeOperation(source, { op: "duplicate", keys });

export const setProgramTreeItemsLocked = (
  source: ProgramToolPageSource,
  keys: string[],
  locked: boolean
) => runTreeOperation(source, { op: "setlock", keys, locked });

export const setProgramTreeItemsVisible = (
  source: ProgramToolPageSource,
  keys: string[],
  visible: boolean
) => runTreeOperation(source, { op: "setvis", keys, visible });

export const selectProgramTreeItemContents = (
  source: ProgramToolPageSource,
  key: string
) => runTreeOperation(source, { op: "select", key });

export async function writeProgramToolPageSelection(
  source: ProgramToolPageSource,
  keys: string[]
): Promise<void> {
  await invoke("set_program_capability_state", {
    ...source,
    stateJson: JSON.stringify({ keys })
  });
}
