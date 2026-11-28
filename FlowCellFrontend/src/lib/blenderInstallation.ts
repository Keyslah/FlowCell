import { invoke } from "@tauri-apps/api/core";

export interface BlenderInventory {
  registered: string;
  candidates: Array<{ path: string; version: string }>;
}

export async function installLatestBlender() {
  const version = await invoke<string>("install_latest_blender");
  const inventory = await invoke<BlenderInventory>("detect_blender_installations");
  const majorMinor = version.split(".").slice(0, 2).join(".");
  const matches = inventory.candidates.filter(candidate => candidate.version === majorMinor);
  return { inventory, version, path: version && matches.length === 1 ? matches[0].path : "" };
}
