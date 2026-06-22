import { invoke } from "@tauri-apps/api/core";
import type { LooseFileInfo, OrganizationProfile } from "./types";

export type OrganizationProjectScan = {
  projectRoot: string;
  folders: string[];
  looseFiles: LooseFileInfo[];
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
