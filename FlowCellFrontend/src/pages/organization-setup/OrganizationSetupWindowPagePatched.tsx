import { useEffect } from "react";
import {
  createStarterOrganizationProfile,
  normalizeOrganizationProfile,
  normalizeProtectedFolders
} from "../../features/organization/organizationEngine";
import {
  readOrganizationProfile,
  readOrganizationProfileNamed,
  saveOrganizationProfileAs,
  scanOrganizationProject,
  writeOrganizationProfile
} from "../../features/organization/organizationStore";
import type { OrganizationProfile } from "../../features/organization/types";
import OrganizationSetupWindowPage from "./OrganizationSetupWindowPage";

const PROTECTED_FOLDERS_KEY = "flowcell.organizationSetup.protectedFolders";
const ALLOWED_ASSIGNMENT_GROUPS = new Set(["unknown", "images", "svg", "3d"]);

type ProtectedFolderStore = Record<string, string[]>;

function readProtectedStore(): ProtectedFolderStore {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROTECTED_FOLDERS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [
        key,
        normalizeProtectedFolders(Array.isArray(value) ? value.map(String) : [])
      ])
    );
  } catch {
    return {};
  }
}

function writeProtectedStore(store: ProtectedFolderStore) {
  window.localStorage.setItem(PROTECTED_FOLDERS_KEY, JSON.stringify(store));
}

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function getProjectRootFromPage(): string {
  const rootRail = Array.from(document.querySelectorAll<HTMLElement>(".organization-setup__rail"))
    .find((rail) => rail.querySelector("span")?.textContent?.trim() === "Project root");
  return rootRail?.querySelector<HTMLInputElement>("input")?.value.trim() ?? "";
}

function getActiveFolderFromPage(): string {
  const heading = document
    .querySelector<HTMLElement>(".organization-setup__folder-settings h2")
    ?.textContent?.trim() ?? "";
  return heading === "Project Root (.)" ? "." : normalizeFolderPath(heading);
}

function getActiveFolderSourceFromPage(): "project" | "profile" | null {
  const label = document
    .querySelector<HTMLElement>(".organization-setup__folder-settings .organization-setup__section-heading span")
    ?.textContent?.trim();
  if (label === "Profile folder") {
    return "profile";
  }
  if (label === "Folder") {
    return "project";
  }
  return null;
}

function getSelectedProfileNameFromPage(): string {
  const profilePanel = Array.from(document.querySelectorAll<HTMLElement>(".organization-setup__panel"))
    .find((panel) => panel.querySelector(".organization-setup__section-heading span")?.textContent?.trim() === "Profile");
  const title = profilePanel?.querySelector(".organization-setup__section-heading h2")?.textContent?.trim() ?? "";
  if (!title || title === "—" || title.toLowerCase().includes("unsaved")) {
    return "";
  }
  return title;
}

function protectedStorageKey(): string {
  const source = getActiveFolderSourceFromPage();
  const profileName = getSelectedProfileNameFromPage();
  if (source === "profile" && profileName) {
    return `profile:${profileName}`;
  }
  return `root:${getProjectRootFromPage()}`;
}

function readProtectedFoldersForKey(key: string): string[] {
  return normalizeProtectedFolders(readProtectedStore()[key] ?? []);
}

function writeProtectedFoldersForKey(key: string, folders: string[]) {
  const store = readProtectedStore();
  const normalized = normalizeProtectedFolders(folders);
  if (normalized.length) {
    store[key] = normalized;
  } else {
    delete store[key];
  }
  writeProtectedStore(store);
}

async function writeProtectedFoldersToProjectRoot(projectRoot: string, folders: string[]) {
  if (!projectRoot.trim()) {
    return;
  }
  const existing = await readOrganizationProfile(projectRoot).catch(() => null);
  const profile = normalizeOrganizationProfile(
    (existing as OrganizationProfile | null) ?? createStarterOrganizationProfile(projectRoot)
  );
  await writeOrganizationProfile(projectRoot, {
    ...profile,
    protectedFolders: normalizeProtectedFolders(folders)
  });
}

async function writeProtectedFoldersToNamedProfile(profileName: string, folders: string[]) {
  if (!profileName.trim()) {
    return;
  }
  const existing = await readOrganizationProfileNamed(profileName).catch(() => null);
  if (!existing) {
    return;
  }
  const profile = normalizeOrganizationProfile(existing as OrganizationProfile);
  const skeletonRoot = profile.projectRoot.trim();
  const scan = skeletonRoot ? await scanOrganizationProject(skeletonRoot).catch(() => null) : null;
  await saveOrganizationProfileAs(
    profileName,
    {
      ...profile,
      protectedFolders: normalizeProtectedFolders(folders)
    },
    (scan?.folders ?? []).filter((folder) => folder !== ".")
  );
}

async function syncProtectedFoldersToProfile() {
  const key = protectedStorageKey();
  const folders = readProtectedFoldersForKey(key);
  const source = getActiveFolderSourceFromPage();
  const profileName = getSelectedProfileNameFromPage();
  if (source === "profile" && profileName) {
    await writeProtectedFoldersToNamedProfile(profileName, folders);
    return;
  }
  await writeProtectedFoldersToProjectRoot(getProjectRootFromPage(), folders);
}

function isActiveFolderProtected(): boolean {
  const folder = getActiveFolderFromPage();
  if (!folder || folder === ".") {
    return false;
  }
  return readProtectedFoldersForKey(protectedStorageKey()).includes(folder);
}

function replaceVisibleText() {
  const replacements = new Map([
    ["Assign role", "Assign group"],
    ["Add Role", "Add Group"],
    ["Add role", "Add group"],
    ["Edit role", "Edit group"],
    ["Role name", "Group name"],
    ["Save Role", "Save Group"],
    ["Select a role to assign…", "Select a group to assign…"],
    ["Saved role", "Saved group"]
  ]);

  document.querySelectorAll<HTMLElement>("button, span, h2, option, label").forEach((element) => {
    const text = element.textContent?.trim() ?? "";
    const replacement = replacements.get(text);
    if (replacement) {
      element.textContent = replacement;
    }
  });
}

function filterAssignmentDropdown() {
  const select = document.querySelector<HTMLSelectElement>(".organization-setup__assign-role select");
  if (!select) {
    return;
  }
  Array.from(select.options).forEach((option) => {
    if (option.value && !ALLOWED_ASSIGNMENT_GROUPS.has(option.value)) {
      option.remove();
    }
  });
}

function addProtectedRow() {
  const list = document.querySelector<HTMLElement>(".organization-setup__assigned-list");
  if (!list) {
    return;
  }
  list.querySelector("[data-flowcell-protected-folder-row]")?.remove();
  const empty = list.querySelector<HTMLElement>(".organization-setup__assigned-empty");
  const activeFolder = getActiveFolderFromPage();
  const protectedFolder = isActiveFolderProtected();
  if (empty) {
    empty.style.display = protectedFolder ? "none" : "";
  }
  if (!protectedFolder || !activeFolder || activeFolder === ".") {
    return;
  }

  const row = document.createElement("div");
  row.className = "organization-setup__assigned-row organization-setup__protected-row";
  row.dataset.flowcellProtectedFolderRow = "true";
  row.innerHTML = `
    <span class="organization-setup__assigned-name">Don’t Remove Files</span>
    <span class="organization-setup__assigned-types">protected on reapply</span>
    <div class="organization-setup__assigned-actions">
      <button type="button" class="organization-setup__assigned-action" data-flowcell-protected-remove>Remove</button>
    </div>
  `;
  row.querySelector<HTMLButtonElement>("[data-flowcell-protected-remove]")?.addEventListener("click", () => {
    void toggleProtectedFolder();
  });
  list.insertBefore(row, list.firstChild);
}

async function toggleProtectedFolder() {
  const folder = getActiveFolderFromPage();
  if (!folder || folder === ".") {
    return;
  }
  const key = protectedStorageKey();
  const current = readProtectedFoldersForKey(key);
  const next = current.includes(folder)
    ? current.filter((item) => item !== folder)
    : [folder, ...current];
  writeProtectedFoldersForKey(key, next);
  applyRuntimePatch();
  await syncProtectedFoldersToProfile().catch(() => {});
  applyRuntimePatch();
}

function addProtectButton() {
  const controls = document.querySelector<HTMLElement>(".organization-setup__assign-controls");
  if (!controls) {
    return;
  }
  const addFolderButton = Array.from(controls.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === "Add Folder");
  if (!addFolderButton) {
    return;
  }
  let protectButton = controls.querySelector<HTMLButtonElement>("[data-flowcell-protect-folder]");
  if (!protectButton) {
    protectButton = document.createElement("button");
    protectButton.type = "button";
    protectButton.dataset.flowcellProtectFolder = "true";
    protectButton.addEventListener("click", () => {
      void toggleProtectedFolder();
    });
    addFolderButton.insertAdjacentElement("afterend", protectButton);
  }

  const activeFolder = getActiveFolderFromPage();
  const protectedFolder = isActiveFolderProtected();
  protectButton.textContent = "Don’t Remove Files";
  protectButton.disabled = !activeFolder || activeFolder === ".";
  protectButton.classList.toggle("is-selected", protectedFolder);
  protectButton.title = protectedFolder
    ? "Files in this folder stay put when the profile is reapplied."
    : "Keep files in this selected folder from being moved when the profile is reapplied.";
}

function applyRuntimePatch() {
  replaceVisibleText();
  filterAssignmentDropdown();
  addProtectButton();
  addProtectedRow();
}

export default function OrganizationSetupWindowPagePatched() {
  useEffect(() => {
    let frame = 0;
    const schedulePatch = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyRuntimePatch);
    };

    const replaying = new WeakSet<HTMLButtonElement>();
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button");
      if (!button) {
        return;
      }
      const text = button.textContent?.trim() ?? "";
      if (replaying.has(button)) {
        replaying.delete(button);
        return;
      }

      if (text.startsWith("Apply profile to")) {
        const profileName = getSelectedProfileNameFromPage();
        const rootKey = `root:${getProjectRootFromPage()}`;
        const rootProtectedFolders = readProtectedFoldersForKey(rootKey);
        if (profileName && rootProtectedFolders.length) {
          event.preventDefault();
          event.stopPropagation();
          void writeProtectedFoldersToNamedProfile(profileName, rootProtectedFolders).finally(() => {
            replaying.add(button);
            button.click();
          });
          return;
        }
      }

      if (/^(Save Profile|Apply to tree|Apply & rescan|Apply to profile)$/.test(text)) {
        window.setTimeout(() => void syncProtectedFoldersToProfile().finally(applyRuntimePatch), 900);
        window.setTimeout(() => void syncProtectedFoldersToProfile().finally(applyRuntimePatch), 2200);
      }
    };

    const observer = new MutationObserver(schedulePatch);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    schedulePatch();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return <OrganizationSetupWindowPage />;
}
