import { invoke } from "@tauri-apps/api/core";
import { cloneButtonDocument } from "../../button/state/buttonDefaults";
import { publishButtonCommit } from "../../button/state/ButtonDraftBus";
import {
  installButtonSource,
  loadButtonStateDocument,
  saveButtonStateDocument,
  uninstallButtonSource,
  updateButtonSource,
  type InstallButtonSourceResult
} from "../../button/state/ButtonStateRepository";
import {
  attachCanonicalOrganizationProfileButton,
  isCanonicalOrganizationProfileButton,
  ORGANIZATION_PROFILE_PANEL_NAME,
  ORGANIZATION_PROFILE_PROGRAM_NAME,
  organizationProfileOwnerButtonId,
  resolveOrganizationProfileOwnerButtonId
} from "../../button/state/organizationProfileButtonOperations";
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

function isButtonRevisionConflict(error: unknown): boolean {
  return formatInvokeError(error).includes("Button state changed before Save.");
}

export async function makeOrganizationProfileButton(name: string): Promise<string> {
  if (!(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) {
    throw new Error("Organization profile Buttons can only be created from the desktop host.");
  }
  const profileName = name.trim();
  if (!profileName) throw new Error("Save or load a profile before making its Button.");

  const sourcePath = await makeOrganizationProfileScript(profileName);
  let current = await loadButtonStateDocument();
  const existingOwnerButtonId = resolveOrganizationProfileOwnerButtonId(current, profileName);
  const ownerButtonId = existingOwnerButtonId ?? organizationProfileOwnerButtonId(profileName);
  const occupied = current.buttons[ownerButtonId];
  if (occupied && !isCanonicalOrganizationProfileButton(occupied, profileName)) {
    throw new Error(`Canonical organization profile Button ID '${ownerButtonId}' is already in use.`);
  }

  const request = {
    ownerButtonId,
    programName: ORGANIZATION_PROFILE_PROGRAM_NAME,
    panelName: ORGANIZATION_PROFILE_PANEL_NAME,
    sourcePath,
    importKind: "script" as const
  };
  let installed: InstallButtonSourceResult;
  const createdInstall = existingOwnerButtonId === null;
  if (createdInstall) {
    installed = await installButtonSource(request);
  } else {
    installed = await updateButtonSource(request);
  }
  if (installed.children.length > 0 || !installed.executionTarget) {
    if (createdInstall) {
      await uninstallButtonSource({
        ownerButtonId: installed.ownerButtonId,
        sourceIdentity: installed.sourceIdentity
      }).catch(() => {});
    }
    throw new Error("Organization profile source did not install as a single-script Button.");
  }

  let stateCommitted = false;
  try {
    let saved = current;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = cloneButtonDocument(current);
      const result = attachCanonicalOrganizationProfileButton(next, profileName, installed);
      if (!result.changed) {
        saved = current;
        stateCommitted = true;
        break;
      }
      try {
        saved = await saveButtonStateDocument(next, current.revision);
        stateCommitted = true;
        break;
      } catch (error) {
        if (attempt === 2 || !isButtonRevisionConflict(error)) throw error;
        current = await loadButtonStateDocument();
      }
    }
    if (!stateCommitted) {
      throw new Error("Canonical organization profile Button state could not be committed.");
    }
    await publishButtonCommit(saved);
    return installed.ownerButtonId;
  } catch (error) {
    if (createdInstall && !stateCommitted) {
      await uninstallButtonSource({
        ownerButtonId: installed.ownerButtonId,
        sourceIdentity: installed.sourceIdentity
      }).catch(() => {});
    }
    throw error;
  }
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
