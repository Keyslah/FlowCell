import { invoke } from "@tauri-apps/api/core";
import type { LooseFileInfo, OrganizationProfile } from "./types";

export type OrganizationProjectScan = {
  projectRoot: string;
  folders: string[];
  looseFiles: LooseFileInfo[];
};

export type OrganizationProfileSummary = {
  name: string;
  path: string;
};

function formatInvokeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeOrganizationCommand<T>(
  command: string,
  args: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(formatInvokeError(error));
  }
}

export function scanOrganizationProject(projectRoot: string): Promise<OrganizationProjectScan> {
  return invokeOrganizationCommand("scan_organization_project", { projectRoot });
}

export function readOrganizationProfile(
  projectRoot: string
): Promise<OrganizationProfile | null> {
  return invokeOrganizationCommand("read_organization_profile", { projectRoot });
}

export function writeOrganizationProfile(
  projectRoot: string,
  profile: OrganizationProfile
): Promise<string> {
  return invokeOrganizationCommand("write_organization_profile", { projectRoot, profile });
}

export function listOrganizationProfiles(): Promise<OrganizationProfileSummary[]> {
  return invokeOrganizationCommand("list_organization_profiles", {});
}

export function readOrganizationProfileNamed(
  name: string
): Promise<OrganizationProfile | null> {
  return invokeOrganizationCommand("read_organization_profile_named", { name });
}

export function saveOrganizationProfileAs(
  name: string,
  profile: OrganizationProfile,
  folders: string[]
): Promise<string> {
  return invokeOrganizationCommand("save_organization_profile_as", { name, profile, folders });
}

export function applyOrganizationProfileToRoot(
  name: string,
  projectRoot: string
): Promise<string> {
  return invokeOrganizationCommand("apply_organization_profile_to_root", { name, projectRoot });
}

export function applyOrganizationProfileFolders(
  name: string,
  targetPath: string
): Promise<string> {
  return invokeOrganizationCommand("apply_organization_profile_folders", { name, targetPath });
}

export function makeOrganizationProfileScript(name: string): Promise<string> {
  return invokeOrganizationCommand("make_organization_profile_script", { name });
}

export function makeOrganizationProfileButton(name: string): Promise<string> {
  return invokeOrganizationCommand("make_organization_profile_button", { name });
}

export function createOrganizationFolder(
  projectRoot: string,
  relativePath: string
): Promise<string> {
  return invokeOrganizationCommand("create_organization_folder", { projectRoot, relativePath });
}

export function recycleOrganizationFolder(
  projectRoot: string,
  relativePath: string
): Promise<void> {
  return invokeOrganizationCommand("recycle_organization_folder", { projectRoot, relativePath });
}

export function restoreRecycledFolder(path: string): Promise<void> {
  return invokeOrganizationCommand("restore_recycled_folder", { path });
}
