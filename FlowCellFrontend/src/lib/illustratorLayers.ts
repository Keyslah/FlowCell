import { invoke } from "@tauri-apps/api/core";

export type LayerNode = {
  key: string;
  name: string;
  locked: boolean;
  hidden: boolean;
  depth: number;
  itemCount: number;
  children: LayerNode[];
};

export type LayerTreeSnapshot = {
  active: string;
  tree: LayerNode[];
};

type IllLayersOp =
  | { op: "scan" }
  | { op: "create"; parentKey?: string; name?: string }
  | { op: "rename"; key: string; name: string }
  | { op: "delete"; keys: string[]; force?: boolean }
  | { op: "duplicate"; keys: string[] }
  | { op: "setlock"; keys: string[]; locked: boolean }
  | { op: "setvis"; keys: string[]; visible: boolean }
  | { op: "move"; key: string; targetKey?: string }
  | { op: "select"; key: string };

function normalizeNode(value: unknown): LayerNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const node = value as Partial<LayerNode> & { children?: unknown };
  if (typeof node.key !== "string" || typeof node.name !== "string") {
    return null;
  }
  const children = Array.isArray(node.children)
    ? node.children.map(normalizeNode).filter((child): child is LayerNode => child !== null)
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

async function runIllLayersOp(op: IllLayersOp): Promise<LayerTreeSnapshot> {
  const raw = await invoke<string>("run_illustrator_layers_action", {
    argsJson: JSON.stringify(op)
  });

  let outer: { ok?: boolean; error?: string; result?: string };
  try {
    outer = JSON.parse(raw) as typeof outer;
  } catch (error) {
    throw new Error(`Illustrator bridge returned an unreadable response: ${String(error)}`);
  }

  if (outer.ok === false) {
    throw new Error(outer.error || "Illustrator bridge action failed.");
  }
  if (typeof outer.result !== "string") {
    throw new Error("Illustrator bridge action returned no result payload.");
  }

  let inner: { ok?: boolean; error?: string; active?: string; tree?: unknown };
  try {
    inner = JSON.parse(outer.result) as typeof inner;
  } catch (error) {
    throw new Error(`Illustrator layers payload was unreadable: ${String(error)}`);
  }

  if (inner.ok === false) {
    throw new Error(inner.error || "Illustrator layers action failed.");
  }

  const tree = Array.isArray(inner.tree)
    ? inner.tree.map(normalizeNode).filter((node): node is LayerNode => node !== null)
    : [];

  return {
    active: typeof inner.active === "string" ? inner.active : "",
    tree
  };
}

export async function scanLayers(): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "scan" });
}

export async function createLayer(parentKey: string, name: string): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "create", parentKey, name });
}

export async function renameLayer(key: string, name: string): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "rename", key, name });
}

export async function deleteLayers(keys: string[], force: boolean): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "delete", keys, force });
}

export async function duplicateLayers(keys: string[]): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "duplicate", keys });
}

export async function setLayersLocked(keys: string[], locked: boolean): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "setlock", keys, locked });
}

export async function setLayersVisible(keys: string[], visible: boolean): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "setvis", keys, visible });
}

export async function moveLayer(key: string, targetKey: string): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "move", key, targetKey });
}

export async function selectLayerObjects(key: string): Promise<LayerTreeSnapshot> {
  return runIllLayersOp({ op: "select", key });
}

export async function writeHighlightedLayerKeys(keys: string[]): Promise<void> {
  await invoke("set_illustrator_layers_highlight", { keys });
}
