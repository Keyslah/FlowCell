import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createStarterOrganizationProfile,
  makeAmbiguousFilePrompt,
  normalizeFileTypes,
  normalizeOrganizationProfile,
  resolveLooseFile
} from "../../features/organization/organizationEngine";
import {
  applyOrganizationProfileFolders,
  applyOrganizationProfileToRoot,
  createOrganizationFolder,
  listOrganizationProfiles,
  makeOrganizationProfileButton,
  readOrganizationProfile,
  readOrganizationProfileNamed,
  recycleOrganizationFolder,
  restoreRecycledFolder,
  saveOrganizationProfileAs,
  scanOrganizationProject,
  writeOrganizationProfile,
  type OrganizationProfileSummary,
  type OrganizationProjectScan
} from "../../features/organization/organizationStore";
import type {
  AmbiguousFilePrompt,
  OrganizationProfile,
  OrganizationRole,
  ProgramFolderRule
} from "../../features/organization/types";
import { showOpenFolderDialog } from "../../lib/tauri";
import "./organizationSetupWindowPage.css";

const LAST_PROJECT_ROOT_KEY = "flowcell.organizationSetup.lastProjectRoot";
const UNKNOWN_ROLE_ID = "unknown";
const PROJECT_ROOT_ROLE_ID = "project_root";
// Roles created from the per-folder "File Types" input are not reusable, named
// roles, so they are kept out of the Role dropdown and shown as a "File Types"
// row instead. They are still ordinary roles in the saved profile.
const DIRECT_FILE_TYPES_PREFIX = "folder_filetypes_";
const CUSTOM_GROUPS_KEY = "flowcell.organizationSetup.customFileGroups";

type FileTypeGroup = { label: string; types: string[] };

const FILE_TYPE_GROUPS: FileTypeGroup[] = [
  {
    label: "Images",
    types: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".svg"]
  },
  {
    label: "3D Files",
    types: [
      ".stl", ".obj", ".fbx", ".glb", ".gltf", ".3mf", ".ply", ".dae", ".usd", ".usdz",
      ".abc", ".x3d", ".step", ".stp", ".iges", ".igs"
    ]
  },
  { label: "Illustrator", types: [".ai", ".ait", ".eps", ".svg", ".pdf"] },
  {
    label: "Blender",
    types: [".blend", ".blend1", ".obj", ".fbx", ".glb", ".gltf", ".stl", ".ply", ".abc", ".dae"]
  },
  {
    label: "Fusion 360",
    types: [".f3d", ".f3z", ".step", ".stp", ".iges", ".igs", ".sat", ".smt", ".dxf", ".dwg"]
  },
  { label: "GCode / CNC", types: [".gcode", ".nc", ".tap", ".cnc", ".ngc", ".iso"] },
  {
    label: "Reference / Documents",
    types: [".pdf", ".txt", ".md", ".doc", ".docx", ".rtf", ".csv", ".json", ".url", ".lnk"]
  }
];

// Lifecycle subfolders created inside every program folder on apply.
const PROGRAM_LIFECYCLE_FOLDERS = ["01 live", "02 snapshots", "03 archive", "04 trash"];

// The only default program folders. Each makes its folder from its native files.
const PROGRAM_FOLDER_PRESETS: Array<{ name: string; fileTypes: string[] }> = [
  { name: "Illustrator", fileTypes: [".ai", ".ait"] },
  { name: "Photoshop", fileTypes: [".psd", ".psb"] },
  { name: "Blender", fileTypes: [".blend", ".blend1"] },
  { name: "Fusion 360", fileTypes: [".f3d", ".f3z"] }
];

type RoleDraft = Omit<OrganizationRole, "fileTypes"> & {
  fileTypesText: string;
};

type ProgramFolderDraft = Omit<ProgramFolderRule, "roles" | "fileTypes"> & {
  rolesText: string;
  fileTypesText: string;
};

type AmbiguityScope = AmbiguousFilePrompt["scopes"][number];

function roleToDraft(role: OrganizationRole): RoleDraft {
  return {
    ...role,
    fileTypesText: normalizeFileTypes(role.fileTypes).join("\n")
  };
}

function profileToDraft(profile: OrganizationProfile): {
  roles: RoleDraft[];
  programFolders: ProgramFolderDraft[];
} {
  const normalized = normalizeOrganizationProfile(profile);
  return {
    roles: normalized.roles.map(roleToDraft),
    programFolders: normalized.programFolders.map(
      ({ roles: programRoles, fileTypes: programFileTypes, ...program }) => ({
      ...program,
      rolesText: programRoles.join(", "),
      fileTypesText: normalizeFileTypes(programFileTypes).join(", ")
      })
    )
  };
}

function normalizeRoleId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "");
}

function roleIdToDisplayName(roleId: string): string {
  return roleId
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function splitRoleIds(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,;\s]+/)
        .map(normalizeRoleId)
        .filter(Boolean)
    )
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

// The parent folder of a path, or "." for a top-level folder.
function parentFolderPath(value: string): string {
  const normalized = normalizeFolderPath(value);
  if (!normalized || normalized === ".") {
    return ".";
  }
  const segments = normalized.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : ".";
}

function isDirectTypeRole(roleId: string): boolean {
  return roleId.startsWith(DIRECT_FILE_TYPES_PREFIX);
}

// Deterministic roleId for the per-folder "File Types" direct assignment.
function folderTypeRoleId(folder: string): string {
  const slug = normalizeFolderPath(folder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${DIRECT_FILE_TYPES_PREFIX}${slug || "root"}`;
}

function getUnknownRoleAssignmentIssue(
  profile: OrganizationProfile,
  scan: OrganizationProjectScan | null
): string {
  const unknownRole = profile.roles.find((role) => role.roleId === UNKNOWN_ROLE_ID);
  const assignedFolder = normalizeFolderPath(unknownRole?.folder ?? "");
  if (!assignedFolder || assignedFolder === ".") {
    return "Assign the Unknown role to a folder in the Project Tree before saving.";
  }
  if (!scan) {
    return "Scan the project root to confirm the Unknown role's folder assignment.";
  }

  const scannedFolders = new Set(scan.folders.map(normalizeFolderPath));
  if (!scannedFolders.has(assignedFolder)) {
    return `The Unknown role is assigned to "${assignedFolder}", but that folder is not in the Project Tree. Assign Unknown to a scanned folder.`;
  }
  return "";
}

export default function OrganizationSetupWindowPage() {
  const [projectRoot, setProjectRoot] = useState(
    () => window.localStorage.getItem(LAST_PROJECT_ROOT_KEY) ?? ""
  );
  const [roles, setRoles] = useState<RoleDraft[]>([]);
  const [programFolders, setProgramFolders] = useState<ProgramFolderDraft[]>([]);
  const [rememberedChoices, setRememberedChoices] = useState<
    OrganizationProfile["rememberedChoices"]
  >({});
  const [scan, setScan] = useState<OrganizationProjectScan | null>(null);
  const [status, setStatus] = useState("Choose a project root to begin.");
  const [statusTone, setStatusTone] = useState<"" | "is-error" | "is-success">("");
  const [busy, setBusy] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  // Add Program Folder popup (folder-scoped).
  const [programRulesOpen, setProgramRulesOpen] = useState(false);
  const [programPickName, setProgramPickName] = useState("");
  const [programPickFileTypes, setProgramPickFileTypes] = useState("");
  const [fileChoices, setFileChoices] = useState<Record<string, string>>({});
  const [runChoices, setRunChoices] = useState<Record<string, string>>({});
  const [ambiguityScope, setAmbiguityScope] = useState<AmbiguityScope>("file");
  const [directFileTypesInput, setDirectFileTypesInput] = useState("");

  // Saved named profiles (skeleton trees under FlowCell/local/Folder Trees).
  const [savedProfiles, setSavedProfiles] = useState<OrganizationProfileSummary[]>([]);
  const [profileName, setProfileName] = useState("");
  // The profile currently loaded into the editor, ready to apply to a root.
  const [selectedProfileName, setSelectedProfileName] = useState("");
  // The loaded profile's own folder tree, for side-by-side comparison.
  const [loadedScan, setLoadedScan] = useState<OrganizationProjectScan | null>(null);
  // Selected folder in the loaded-profile tree (independent of the project tree).
  const [selectedLoadedFolder, setSelectedLoadedFolder] = useState<string | null>(null);
  // Undo stack: each entry can reverse the last folder add/delete.
  const [undoStack, setUndoStack] = useState<
    Array<{ label: string; run: () => Promise<void> }>
  >([]);

  // Add Role popup state.
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [addRoleName, setAddRoleName] = useState("");
  const [addRoleFileTypesInput, setAddRoleFileTypesInput] = useState("");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);
  // Tracks the role being edited (by roleId) so saving updates it in place.
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  // User-defined file-type groups, persisted locally so they survive restarts.
  const [customGroups, setCustomGroups] = useState<FileTypeGroup[]>(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_GROUPS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(
          (group): group is FileTypeGroup =>
            group && typeof group.label === "string" && Array.isArray(group.types)
        )
        .map((group) => ({ label: group.label, types: normalizeFileTypes(group.types) }));
    } catch {
      return [];
    }
  });
  const [groupNameOpen, setGroupNameOpen] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");

  const currentProfile = useMemo(
    () =>
      normalizeOrganizationProfile({
        profileVersion: 1,
        projectRoot: projectRoot.trim(),
        roles: roles.map(({ fileTypesText, ...role }) => ({
          ...role,
          roleId: normalizeRoleId(role.roleId),
          fileTypes: normalizeFileTypes(fileTypesText)
        })),
        programFolders: programFolders.map(({ rolesText, fileTypesText, ...program }) => ({
          ...program,
          programId: normalizeRoleId(program.programId),
          fileTypes: normalizeFileTypes(fileTypesText),
          roles: splitRoleIds(rolesText)
        })),
        rememberedChoices: rememberedChoices ?? {}
      }),
    [programFolders, projectRoot, rememberedChoices, roles]
  );

  const unknownRoleAssignmentIssue = useMemo(
    () => getUnknownRoleAssignmentIssue(currentProfile, scan),
    [currentProfile, scan]
  );

  const pendingAmbiguity = useMemo(() => {
    for (const file of scan?.looseFiles ?? []) {
      const extension = normalizeFileTypes([file.extension])[0] ?? "";
      const selectedRoleId = fileChoices[file.path] ?? runChoices[extension];
      if (selectedRoleId && currentProfile.roles.some((role) => role.roleId === selectedRoleId)) {
        continue;
      }

      const resolution = resolveLooseFile(currentProfile, file);
      if (resolution.status === "ambiguous") {
        return {
          file,
          prompt: makeAmbiguousFilePrompt(file, resolution.choices)
        };
      }
    }
    return null;
  }, [currentProfile, fileChoices, runChoices, scan]);

  // Roles available to assign from the dropdown: every named role except the
  // root preset (locked to ".") and the per-folder direct file-type helpers.
  const dropdownRoles = roles.filter(
    (role) => role.roleId !== PROJECT_ROOT_ROLE_ID && !isDirectTypeRole(role.roleId)
  );

  // A single active folder selection shared across both trees. Selecting a
  // folder in one tree clears the other, so only one folder is ever active and
  // its assignments show in the editor card regardless of which tree it's from.
  const activeFolder = selectedFolder ?? selectedLoadedFolder;
  const activeFolderSource: "project" | "profile" | null = selectedFolder
    ? "project"
    : selectedLoadedFolder
      ? "profile"
      : null;

  // Program folders whose parent is the active folder, shown alongside roles.
  const assignedProgramEntries = programFolders
    .map((program, index) => ({ program, index }))
    .filter(
      ({ program }) =>
        activeFolder !== null && parentFolderPath(program.folder || "") === activeFolder
    );

  // The project tree shows the project root's actual folders. Nothing is added
  // here automatically — folders appear only after you create them (Add Folder)
  // or they already exist on disk.
  const treeFolders = [...new Set(["." , ...(scan?.folders ?? ["."])])].sort((a, b) =>
    a === "." ? -1 : b === "." ? 1 : a.toLowerCase().localeCompare(b.toLowerCase())
  );

  // Roles currently assigned to the selected folder, shown as compact rows.
  const assignedRoleEntries = roles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => {
      if (role.roleId === PROJECT_ROOT_ROLE_ID) {
        return false;
      }
      return activeFolder !== null && normalizeFolderPath(role.folder || "") === activeFolder;
    });

  const applyProfile = (profile: OrganizationProfile) => {
    const draft = profileToDraft(profile);
    setRoles(draft.roles);
    setProgramFolders(draft.programFolders);
    setRememberedChoices(profile.rememberedChoices ?? {});
  };

  const refreshSavedProfiles = async () => {
    try {
      setSavedProfiles(await listOrganizationProfiles());
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    }
  };

  const chooseAmbiguousRole = (roleId: string) => {
    if (!pendingAmbiguity) {
      return;
    }

    const { file } = pendingAmbiguity;
    const extension = normalizeFileTypes([file.extension])[0] ?? "";
    if (ambiguityScope === "file") {
      setFileChoices((current) => ({ ...current, [file.path]: roleId }));
      setStatus(`Assigned ${file.fileName} for this file.`);
    } else if (ambiguityScope === "run") {
      setRunChoices((current) => ({ ...current, [extension]: roleId }));
      setStatus(`Assigned ${extension || "extensionless files"} for this run.`);
    } else {
      setRememberedChoices((current) => ({
        ...(current ?? {}),
        [extension]: { roleId, scope: "project" }
      }));
      setStatus(`Assigned ${extension || "extensionless files"} for this project. Save to persist it.`);
    }
    setStatusTone("is-success");
    setAmbiguityScope("file");
  };

  const resetTransientState = () => {
    setFileChoices({});
    setRunChoices({});
    setAmbiguityScope("file");
    setDirectFileTypesInput("");
    setProgramRulesOpen(false);
    cancelAddRole();
  };

  const loadProject = async (rootValue: string, successMessage = "Project scanned.") => {
    const root = rootValue.trim().replace(/^"+|"+$/g, "");
    if (!root) {
      setStatus("Choose a project root first.");
      setStatusTone("is-error");
      return;
    }

    setBusy(true);
    setStatus("Scanning project folders...");
    setStatusTone("");
    try {
      const [nextScan, savedProfile] = await Promise.all([
        scanOrganizationProject(root),
        readOrganizationProfile(root)
      ]);
      const profile = normalizeOrganizationProfile(
        savedProfile ?? createStarterOrganizationProfile(root)
      );
      setProjectRoot(root);
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      setScan(nextScan);
      setSelectedFolder(".");
      resetTransientState();
      applyProfile(profile);
      setStatus(
        savedProfile
          ? `${successMessage} Loaded organize-folder.profile.json.`
          : `${successMessage} No saved profile yet; showing the starter profile.`
      );
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshSavedProfiles();
    if (projectRoot.trim()) {
      void loadProject(projectRoot, "Project reopened.");
    }
    // Load only the remembered root at window startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(customGroups));
  }, [customGroups]);

  const chooseProjectRoot = async () => {
    try {
      const selected = await showOpenFolderDialog({
        title: "Choose project root",
        initialDirectory: projectRoot.trim() || undefined
      });
      if (selected[0]) {
        await loadProject(selected[0]);
      }
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    }
  };

  const buildProfile = (): OrganizationProfile => {
    const normalized = normalizeOrganizationProfile({
      ...currentProfile,
      projectRoot: projectRoot.trim()
    });
    const roleIds = new Set(normalized.roles.map((role) => role.roleId));
    normalized.programFolders = normalized.programFolders.map((program) => ({
      ...program,
      roles: program.roles.filter((roleId) => roleIds.has(roleId))
    }));
    return normalized;
  };

  const saveProfile = async (rescanAfterSave: boolean) => {
    const root = projectRoot.trim();
    if (!root) {
      setStatus("Choose a project root first.");
      setStatusTone("is-error");
      return;
    }
    if (unknownRoleAssignmentIssue) {
      setStatus(unknownRoleAssignmentIssue);
      setStatusTone("is-error");
      return;
    }

    setBusy(true);
    setStatus("Saving organization profile…");
    setStatusTone("");
    try {
      const profile = buildProfile();
      const savedPath = await writeOrganizationProfile(root, profile);
      applyProfile(profile);
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      if (rescanAfterSave) {
        setScan(await scanOrganizationProject(root));
      }
      setStatus(`${rescanAfterSave ? "Saved and rescanned" : "Saved"}: ${savedPath}`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  const initStarterProfile = async () => {
    const root = projectRoot.trim();
    if (!root) {
      setStatus("Choose a project root first.");
      setStatusTone("is-error");
      return;
    }

    const starter = createStarterOrganizationProfile(root);
    setBusy(true);
    setStatus("Initializing starter profile…");
    setStatusTone("");
    try {
      const savedPath = await writeOrganizationProfile(root, starter);
      applyProfile(starter);
      const nextScan = await scanOrganizationProject(root);
      setScan(nextScan);
      setSelectedFolder(".");
      resetTransientState();
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      setStatus(`Starter profile initialized: ${savedPath}`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  // Loading a profile only brings its roles/structure into the editor. It does
  // NOT touch the project root — you then apply it to a root of your choosing.
  const loadNamedProfile = async (name: string) => {
    if (!name) {
      return;
    }

    setBusy(true);
    setStatus("Loading profile…");
    setStatusTone("");
    try {
      const saved = await readOrganizationProfileNamed(name);
      if (!saved) {
        throw new Error(`Profile "${name}" was not found.`);
      }
      const profile = normalizeOrganizationProfile(saved);
      resetTransientState();
      applyProfile(profile);
      setSelectedProfileName(name);
      // Load the profile's own folder tree (the saved skeleton) for comparison.
      setSelectedLoadedFolder(null);
      try {
        const skeletonRoot = profile.projectRoot.trim();
        setLoadedScan(skeletonRoot ? await scanOrganizationProject(skeletonRoot) : null);
      } catch {
        setLoadedScan(null);
      }
      setStatus(
        projectRoot.trim()
          ? `Loaded profile "${name}". Click "Apply profile to root" to build it in ${projectRoot.trim()}.`
          : `Loaded profile "${name}". Choose a project root, then "Apply profile to root".`
      );
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  // Copy the current project root's folder structure into the profile section as
  // an unsaved scratch tree. No profile is saved — it just lets you see and edit
  // the root's depth structure in the profile panel before saving it as one.
  const copyRootToProfile = () => {
    if (!scan) {
      setStatus("Scan a project root first, then copy it to the profile section.");
      setStatusTone("is-error");
      return;
    }
    setSelectedProfileName("");
    setLoadedScan({
      projectRoot: scan.projectRoot,
      folders: [...treeFolders],
      looseFiles: []
    });
    setSelectedLoadedFolder(null);
    setStatus(
      "Copied the project root structure into the profile section (unsaved). Edit it, then Save Profile to keep it."
    );
    setStatusTone("is-success");
  };

  const pushUndo = (label: string, run: () => Promise<void>) => {
    setUndoStack((current) => [...current, { label, run }]);
  };

  const runUndo = async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) {
      return;
    }
    setUndoStack((current) => current.slice(0, -1));
    setBusy(true);
    setStatus(`Undoing: ${entry.label}…`);
    setStatusTone("");
    try {
      await entry.run();
      setStatus(`Undid: ${entry.label}.`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  // Apply the loaded profile's folder structure into the selected folder. At the
  // project root it also writes the profile; in a subfolder it only builds folders.
  const applyProfileToSelected = async (profileNameToApply = selectedProfileName) => {
    const root = projectRoot.trim();
    if (!profileNameToApply) {
      setStatus("Load or pick a profile first.");
      setStatusTone("is-error");
      return;
    }
    if (!root) {
      setStatus("Choose a project root first.");
      setStatusTone("is-error");
      return;
    }
    if (!selectedFolder) {
      setStatus("Select a folder to apply the profile into.");
      setStatusTone("is-error");
      return;
    }

    const targetPath =
      selectedFolder === "." ? root : `${root.replace(/[\\/]+$/, "")}/${selectedFolder}`;
    setBusy(true);
    setStatus(`Applying "${profileNameToApply}" to ${selectedFolder}…`);
    setStatusTone("");
    try {
      if (selectedFolder === ".") {
        await applyOrganizationProfileToRoot(profileNameToApply, root);
      } else {
        await applyOrganizationProfileFolders(profileNameToApply, targetPath);
      }
      setScan(await scanOrganizationProject(root));
      setStatus(`Applied "${profileNameToApply}" to ${selectedFolder}.`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  // Save the current editor state into a named profile. Used by Save Profile
  // (typed name) and Apply to profile (the loaded profile).
  const saveCurrentToProfile = async (name: string, label: string) => {
    if (!name) {
      setStatus("Enter or load a profile name first.");
      setStatusTone("is-error");
      return;
    }

    setBusy(true);
    setStatus(`${label} "${name}"…`);
    setStatusTone("");
    try {
      const profile = buildProfile();
      // Capture the planned structure. For an unsaved "copy root to profile"
      // scratch tree, save the (possibly edited) profile-section tree; otherwise
      // use the project tree's scanned folders plus added program folders.
      const sourceFolders =
        loadedScan && !selectedProfileName ? loadedScan.folders : treeFolders;
      const folders = sourceFolders.filter((folder) => folder !== ".");
      const savedPath = await saveOrganizationProfileAs(name, profile, folders);
      await refreshSavedProfiles();
      setSelectedProfileName(name);
      setStatus(`${label} "${name}". Folder tree: ${savedPath}`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  const saveNamedProfile = () => saveCurrentToProfile(profileName.trim(), "Saved profile");

  // Apply to profile: write the current setup into the loaded profile so you can
  // build a profile up incrementally.
  const applyToProfile = () =>
    saveCurrentToProfile((selectedProfileName || profileName.trim()).trim(), "Updated profile");

  // Create a button in the Windows Files panel that applies this profile to a
  // clipboard folder path. The button is named after the profile.
  const makeButton = async () => {
    const name = (profileName.trim() || selectedProfileName).trim();
    if (!name) {
      setStatus("Save or load a profile first, then Make Button.");
      setStatusTone("is-error");
      return;
    }

    setBusy(true);
    setStatus(`Making button for "${name}"…`);
    setStatusTone("");
    try {
      await makeOrganizationProfileButton(name);
      setStatus(
        `Made button "${name}" in the Windows Files panel. Reselect the Files panel to see it.`
      );
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  const roleDisplayName = (roleId: string): string =>
    roles.find((role) => role.roleId === roleId)?.displayName || roleId;

  const openAddProgramFolder = () => {
    setProgramPickName("");
    setProgramPickFileTypes("");
    setProgramRulesOpen(true);
  };

  const cancelAddProgramFolder = () => {
    setProgramRulesOpen(false);
    setProgramPickName("");
    setProgramPickFileTypes("");
  };

  // Add a folder to the selected folder. `addNow` creates it on disk right away
  // (so it shows in the tree); otherwise it's a conditional rule created on apply
  // only when its file types show up.
  const addProgramFolderToSelected = async (addNow: boolean) => {
    if (!selectedFolder) {
      setStatus("Select a folder in the Project Tree first.");
      setStatusTone("is-error");
      return;
    }
    const name = programPickName.trim();
    if (!name) {
      setStatus("Name the folder first.");
      setStatusTone("is-error");
      return;
    }
    const programId = normalizeRoleId(name);
    const fileTypesText = normalizeFileTypes(programPickFileTypes).join(", ");
    // The new folder lives inside the selected folder.
    const folderPath = selectedFolder === "." ? name : `${selectedFolder}/${name}`;

    setProgramFolders((current) => {
      const existingIndex = current.findIndex(
        (program) =>
          program.programId === programId &&
          parentFolderPath(program.folder || "") === selectedFolder
      );
      const next: ProgramFolderDraft = {
        programId,
        displayName: name,
        folder: folderPath,
        fileTypesText,
        rolesText: "",
        createOnlyIfMatchingFilesOrRolesPresent: !addNow
      };
      if (existingIndex >= 0) {
        return current.map((program, index) => (index === existingIndex ? next : program));
      }
      return [...current, next];
    });
    cancelAddProgramFolder();

    if (addNow && projectRoot.trim()) {
      const root = projectRoot.trim();
      setBusy(true);
      setStatus(`Creating ${folderPath}…`);
      setStatusTone("");
      try {
        await createOrganizationFolder(root, folderPath);
        setScan(await scanOrganizationProject(root));
        setSelectedFolder(folderPath);
        pushUndo(`Add ${folderPath}`, async () => {
          await recycleOrganizationFolder(root, folderPath);
          setProgramFolders((current) =>
            current.filter(
              (program) =>
                normalizeFolderPath(program.folder || "") !== normalizeFolderPath(folderPath)
            )
          );
          setScan(await scanOrganizationProject(root));
          setSelectedFolder(".");
        });
        setStatus(`Created ${folderPath}.`);
        setStatusTone("is-success");
      } catch (error) {
        setStatus(formatError(error));
        setStatusTone("is-error");
      } finally {
        setBusy(false);
      }
      return;
    }

    setStatus(`Added ${name} under ${selectedFolder} (created when matching files are present).`);
    setStatusTone("is-success");
  };

  // Delete the selected project-tree folder (to the Recycle Bin) and drop any
  // program rules under it.
  const deleteSelectedProjectFolder = async () => {
    const root = projectRoot.trim();
    if (!root || !selectedFolder || selectedFolder === ".") {
      setStatus("Select a folder (not the project root) to delete.");
      setStatusTone("is-error");
      return;
    }
    const target = selectedFolder;
    const fullPath = `${root.replace(/[\\/]+$/, "")}/${target}`;
    const removedPrograms = programFolders.filter((program) => {
      const folder = normalizeFolderPath(program.folder || "");
      return folder === target || folder.startsWith(`${target}/`);
    });
    setBusy(true);
    setStatus(`Deleting ${target}…`);
    setStatusTone("");
    try {
      await recycleOrganizationFolder(root, target);
      setProgramFolders((current) =>
        current.filter((program) => !removedPrograms.includes(program))
      );
      setScan(await scanOrganizationProject(root));
      setSelectedFolder(".");
      pushUndo(`Delete ${target}`, async () => {
        await restoreRecycledFolder(fullPath);
        if (removedPrograms.length) {
          setProgramFolders((current) => [...current, ...removedPrograms]);
        }
        setScan(await scanOrganizationProject(root));
      });
      setStatus(`Sent ${target} to the Recycle Bin.`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  // Delete the selected loaded-profile folder from the saved skeleton.
  const deleteSelectedLoadedFolder = async () => {
    if (!loadedScan || !selectedLoadedFolder || selectedLoadedFolder === ".") {
      setStatus("Select a folder (not the root) in the loaded profile to delete.");
      setStatusTone("is-error");
      return;
    }
    const target = selectedLoadedFolder;
    // A scratch "copy root to profile" tree has no saved skeleton on disk, so
    // deletion just drops the folder (and its descendants) from the in-memory list.
    if (!selectedProfileName) {
      setLoadedScan((current) =>
        current
          ? {
              ...current,
              folders: current.folders.filter(
                (folder) => folder !== target && !folder.startsWith(`${target}/`)
              )
            }
          : current
      );
      setSelectedLoadedFolder(null);
      setStatus(`Removed ${target} from the profile section.`);
      setStatusTone("is-success");
      return;
    }
    const root = loadedScan.projectRoot;
    const fullPath = `${root.replace(/[\\/]+$/, "")}/${target}`;
    setBusy(true);
    setStatus(`Deleting ${target} from the profile…`);
    setStatusTone("");
    try {
      await recycleOrganizationFolder(root, target);
      setLoadedScan(await scanOrganizationProject(root));
      setSelectedLoadedFolder(null);
      pushUndo(`Delete ${target} (profile)`, async () => {
        await restoreRecycledFolder(fullPath);
        setLoadedScan(await scanOrganizationProject(root));
      });
      setStatus(`Removed ${target} from the profile tree.`);
      setStatusTone("is-success");
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  const removeProgramFolder = (index: number) => {
    setProgramFolders((current) => current.filter((_, programIndex) => programIndex !== index));
  };

  // Selecting a role from the dropdown assigns it to the selected folder
  // immediately — there is no separate confirm step.
  const assignRoleFromDropdown = (roleId: string) => {
    if (!roleId || !activeFolder) {
      return;
    }
    if (roleId === PROJECT_ROOT_ROLE_ID && activeFolder !== ".") {
      setStatus("Project Root can only stay assigned to the project root.");
      setStatusTone("is-error");
      return;
    }

    setRoles((current) =>
      current.map((role) => (role.roleId === roleId ? { ...role, folder: activeFolder } : role))
    );
    setStatus(`Assigned ${roleDisplayName(roleId)} to ${activeFolder}.`);
    setStatusTone("is-success");
  };

  // X on a normal role unassigns it (it stays available in the dropdown).
  const unassignRole = (index: number) => {
    setRoles((current) =>
      current.map((role, roleIndex) => (roleIndex === index ? { ...role, folder: "" } : role))
    );
  };

  // X on a per-folder "File Types" row removes that helper role entirely.
  const removeDirectTypeRole = (index: number) => {
    setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index));
  };

  // Delete removes the role from the profile entirely (dropdown included).
  const deleteRole = (index: number) => {
    setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index));
  };

  // Edit reopens the Add Role popup pre-filled; saving updates this role.
  const editRole = (role: RoleDraft) => {
    setEditingRoleId(role.roleId);
    setAddRoleName(role.displayName);
    setAddRoleFileTypesInput(normalizeFileTypes(role.fileTypesText).join(", "));
    setPickerSelected([]);
    setGroupNameOpen(false);
    setGroupNameInput("");
    setAddRoleOpen(true);
  };

  const openAddRole = () => {
    setEditingRoleId(null);
    setAddRoleName("");
    setAddRoleFileTypesInput("");
    setPickerSelected([]);
    setGroupNameOpen(false);
    setGroupNameInput("");
    setAddRoleOpen(true);
  };

  const assignDirectFileTypes = () => {
    if (!activeFolder) {
      setStatus("Select a folder first.");
      setStatusTone("is-error");
      return;
    }
    const types = normalizeFileTypes(directFileTypesInput);
    if (!types.length) {
      setStatus("Enter file types to assign first.");
      setStatusTone("is-error");
      return;
    }

    const roleId = folderTypeRoleId(activeFolder);
    setRoles((current) => {
      const existingIndex = current.findIndex((role) => role.roleId === roleId);
      if (existingIndex >= 0) {
        return current.map((role, index) =>
          index === existingIndex
            ? {
                ...role,
                folder: activeFolder,
                fileTypesText: normalizeFileTypes([
                  ...normalizeFileTypes(role.fileTypesText),
                  ...types
                ]).join(", ")
              }
            : role
        );
      }
      return [
        ...current,
        {
          roleId,
          displayName: "File Types",
          folder: activeFolder,
          fileTypesText: types.join(", "),
          description: ""
        }
      ];
    });
    setDirectFileTypesInput("");
    setStatus(`Assigned file types to ${activeFolder}.`);
    setStatusTone("is-success");
  };

  // --- Add Role popup helpers ---
  const togglePickerType = (type: string) => {
    setPickerSelected((current) =>
      current.includes(type) ? current.filter((value) => value !== type) : [...current, type]
    );
  };

  const toggleGroup = (types: string[]) => {
    setPickerSelected((current) => {
      const allSelected = types.every((type) => current.includes(type));
      if (allSelected) {
        return current.filter((value) => !types.includes(value));
      }
      const next = new Set(current);
      types.forEach((type) => next.add(type));
      return [...next];
    });
  };

  const addPickerToInput = () => {
    if (!pickerSelected.length) {
      return;
    }
    setAddRoleFileTypesInput((previous) =>
      normalizeFileTypes([...normalizeFileTypes(previous), ...pickerSelected]).join(", ")
    );
    setPickerSelected([]);
  };

  // Save File Group turns the currently selected picker buttons into a named,
  // reusable group shown at the bottom of the picker.
  const confirmSaveFileGroup = () => {
    const label = groupNameInput.trim();
    if (!label) {
      return;
    }
    if (!pickerSelected.length) {
      setGroupNameOpen(false);
      setGroupNameInput("");
      return;
    }

    const types = normalizeFileTypes(pickerSelected);
    setCustomGroups((current) => {
      const existingIndex = current.findIndex(
        (group) => group.label.toLowerCase() === label.toLowerCase()
      );
      if (existingIndex >= 0) {
        return current.map((group, index) =>
          index === existingIndex ? { label, types } : group
        );
      }
      return [...current, { label, types }];
    });
    setGroupNameOpen(false);
    setGroupNameInput("");
    setStatus(`Saved file group "${label}".`);
    setStatusTone("is-success");
  };

  const removeCustomGroup = (label: string) => {
    setCustomGroups((current) => current.filter((group) => group.label !== label));
  };

  function cancelAddRole() {
    setAddRoleOpen(false);
    setAddRoleName("");
    setAddRoleFileTypesInput("");
    setPickerSelected([]);
    setEditingRoleId(null);
    setGroupNameOpen(false);
    setGroupNameInput("");
  }

  const saveRole = () => {
    const name = addRoleName.trim();
    const roleId = normalizeRoleId(name);
    if (!roleId) {
      setStatus("Enter a role name first.");
      setStatusTone("is-error");
      return;
    }

    const fileTypes = normalizeFileTypes(addRoleFileTypesInput);

    // Editing: update the existing role in place, keeping its id and folder so
    // current assignments are preserved even if the display name changed.
    if (editingRoleId) {
      setRoles((current) =>
        current.map((role) =>
          role.roleId === editingRoleId
            ? { ...role, displayName: name, fileTypesText: fileTypes.join(", ") }
            : role
        )
      );
      setStatus(`Updated role "${name}".`);
      setStatusTone("is-success");
      cancelAddRole();
      return;
    }

    setRoles((current) => {
      const existingIndex = current.findIndex((role) => role.roleId === roleId);
      if (existingIndex >= 0) {
        return current.map((role, index) =>
          index === existingIndex
            ? {
                ...role,
                displayName: name || role.displayName,
                fileTypesText: fileTypes.join(", ")
              }
            : role
        );
      }
      // New roles start unassigned; the user assigns them from the dropdown.
      return [
        ...current,
        {
          roleId,
          displayName: name || roleIdToDisplayName(roleId) || roleId,
          folder: "",
          fileTypesText: fileTypes.join(", "),
          description: ""
        }
      ];
    });
    setStatus(`Saved role "${name}". Select it from the dropdown to assign it.`);
    setStatusTone("is-success");
    cancelAddRole();
  };

  return (
    <main className="organization-setup-page">
      <section className="organization-setup">
        <header className="organization-setup__header">
          <div className="organization-setup__title" data-tauri-drag-region>
            <span>Dynamic Organization</span>
            <h1>Setup Organization</h1>
          </div>
          <button type="button" onClick={() => void getCurrentWindow().close()}>
            Close
          </button>
        </header>

        <div className="organization-setup__workspace">
          <aside className="organization-setup__sidebar">
            <section className="organization-setup__panel">
              <div className="organization-setup__rail organization-setup__root-rail">
                <span>Project root</span>
                <input
                  value={projectRoot}
                  onChange={(event) => setProjectRoot(event.target.value)}
                  placeholder="Choose a project folder"
                  disabled={busy}
                />
                <div className="organization-setup__rail-actions">
                  <button type="button" onClick={() => void chooseProjectRoot()} disabled={busy}>
                    Browse
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadProject(projectRoot)}
                    disabled={busy || !projectRoot.trim()}
                  >
                    Rescan
                  </button>
                </div>
                <button
                  type="button"
                  className="organization-setup__apply-profile"
                  onClick={() => void applyProfileToSelected()}
                  disabled={busy || !selectedProfileName || !selectedFolder || !projectRoot.trim()}
                  title={
                    selectedProfileName
                      ? `Build "${selectedProfileName}" into ${selectedFolder ?? "the selected folder"}`
                      : "Load a profile first"
                  }
                >
                  Apply profile to {selectedFolder === "." ? "root" : selectedFolder ?? "folder"}
                </button>
              </div>

              <div className="organization-setup__section-heading">
                <div>
                  <span>Tree</span>
                  <h2>Structure</h2>
                </div>
                <strong>{treeFolders.length}</strong>
              </div>
              <div className="organization-setup__folder-list" role="list">
                {treeFolders.map((folder) => (
                  <button
                    type="button"
                    className={folder === selectedFolder ? "is-selected" : ""}
                    key={folder}
                    role="listitem"
                    onClick={() => {
                      setSelectedFolder(folder);
                      setSelectedLoadedFolder(null);
                      setDirectFileTypesInput("");
                    }}
                  >
                    {folder}
                  </button>
                ))}
              </div>
              <div className="organization-setup__folder-actions">
                <button
                  type="button"
                  className="organization-setup__delete-folder"
                  onClick={() => void deleteSelectedProjectFolder()}
                  disabled={busy || !selectedFolder || selectedFolder === "."}
                  title="Send the selected folder to the Recycle Bin"
                >
                  Delete folder
                </button>
                <button
                  type="button"
                  onClick={() => void runUndo()}
                  disabled={busy || undoStack.length === 0}
                  title={
                    undoStack.length
                      ? `Undo: ${undoStack[undoStack.length - 1].label}`
                      : "Nothing to undo"
                  }
                >
                  Undo
                </button>
              </div>
            </section>

            <section className="organization-setup__panel">
              <div className="organization-setup__rail organization-setup__profiles">
                <span>Load profile</span>
                <select
                  value=""
                  disabled={busy}
                  onChange={(event) => void loadNamedProfile(event.target.value)}
                >
                  <option value="" disabled>
                    {savedProfiles.length ? "Choose a saved profile…" : "No saved profiles yet"}
                  </option>
                  {savedProfiles.map((profile) => (
                    <option key={profile.path} value={profile.name}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <div className="organization-setup__profile-save">
                  <input
                    value={profileName}
                    placeholder="Profile name"
                    disabled={busy}
                    onChange={(event) => setProfileName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveNamedProfile();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void saveNamedProfile()}
                    disabled={busy || !profileName.trim()}
                  >
                    Save Profile
                  </button>
                </div>
                <button
                  type="button"
                  className="organization-setup__copy-root"
                  onClick={copyRootToProfile}
                  disabled={busy || !scan}
                  title="Copy the project root's folder structure into the profile section (unsaved) so you can see and edit its tree"
                >
                  Copy root to profile
                </button>
                <button
                  type="button"
                  className="organization-setup__make-script"
                  onClick={() => void makeButton()}
                  disabled={busy || !(profileName.trim() || selectedProfileName)}
                  title="Create a Windows Files panel button (named after the profile) that applies this profile to a clipboard folder"
                >
                  Make button
                </button>
              </div>

              <div className="organization-setup__section-heading">
                <div>
                  <span>Profile</span>
                  <h2>{selectedProfileName || (loadedScan ? "From root (unsaved)" : "—")}</h2>
                </div>
                <strong>{loadedScan?.folders.length ?? 0}</strong>
              </div>
              <div className="organization-setup__folder-list" role="list">
                {loadedScan ? (
                  loadedScan.folders.map((folder) => (
                    <button
                      type="button"
                      className={folder === selectedLoadedFolder ? "is-selected" : ""}
                      key={folder}
                      role="listitem"
                      onClick={() => {
                        setSelectedLoadedFolder(folder);
                        setSelectedFolder(null);
                        setDirectFileTypesInput("");
                      }}
                    >
                      {folder}
                    </button>
                  ))
                ) : (
                  <p className="organization-setup__assigned-empty">
                    Load a profile or use “Copy root to profile” to show a tree here.
                  </p>
                )}
              </div>
              <div className="organization-setup__folder-actions">
                <button
                  type="button"
                  className="organization-setup__delete-folder"
                  onClick={() => void deleteSelectedLoadedFolder()}
                  disabled={busy || !selectedLoadedFolder || selectedLoadedFolder === "."}
                  title="Send the selected profile folder to the Recycle Bin"
                >
                  Delete folder
                </button>
                <button
                  type="button"
                  onClick={() => void runUndo()}
                  disabled={busy || undoStack.length === 0}
                  title={
                    undoStack.length
                      ? `Undo: ${undoStack[undoStack.length - 1].label}`
                      : "Nothing to undo"
                  }
                >
                  Undo
                </button>
              </div>
            </section>
          </aside>

          <div className="organization-setup__editors">
            {activeFolder ? (
              <section className="organization-setup__editor-card organization-setup__folder-settings">
                <div className="organization-setup__section-heading">
                  <div>
                    <span>{activeFolderSource === "profile" ? "Profile folder" : "Folder"}</span>
                    <h2>{activeFolder === "." ? "Project Root (.)" : activeFolder}</h2>
                    <p className="organization-setup__folder-meta">
                      {assignedRoleEntries.length} assigned role(s)
                      {activeFolderSource === "project" && activeFolder === "."
                        ? ` · ${scan?.looseFiles.length ?? 0} loose file(s)`
                        : ""}
                    </p>
                  </div>
                </div>

                <div className="organization-setup__folder-body">
                  <div className="organization-setup__assign-controls">
                    <label className="organization-setup__assign-role">
                      <span>Assign role</span>
                      <select
                        value=""
                        disabled={busy}
                        onChange={(event) => assignRoleFromDropdown(event.target.value)}
                      >
                        <option value="" disabled>
                          Select a role to assign…
                        </option>
                        {dropdownRoles.map((role) => (
                          <option key={role.roleId} value={role.roleId}>
                            {role.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={openAddRole} disabled={busy}>
                      Add Role
                    </button>
                    <button
                      type="button"
                      onClick={openAddProgramFolder}
                      disabled={busy || activeFolderSource !== "project"}
                      title={
                        activeFolderSource === "project"
                          ? "Add a folder under the selected project folder"
                          : "Select a folder in the Project tree to add a folder on disk"
                      }
                    >
                      Add Folder
                    </button>
                  </div>

                  <div className="organization-setup__assigned-list">
                    {assignedRoleEntries.length === 0 && assignedProgramEntries.length === 0 ? (
                      <p className="organization-setup__assigned-empty">
                        Nothing assigned to this folder yet.
                      </p>
                    ) : null}
                    {assignedRoleEntries.map(({ role, index }) => {
                        const isDirect = isDirectTypeRole(role.roleId);
                        const isPreset = role.roleId === UNKNOWN_ROLE_ID;
                        const name = isDirect ? "File Types" : role.displayName;
                        const types = normalizeFileTypes(role.fileTypesText);
                        const typesLabel = isPreset
                          ? "catch-all"
                          : types.length
                            ? types.join(" ")
                            : "—";
                        return (
                          <div className="organization-setup__assigned-row" key={index}>
                            <span className="organization-setup__assigned-name">{name}</span>
                            <span className="organization-setup__assigned-types">{typesLabel}</span>
                            <div className="organization-setup__assigned-actions">
                              {!isDirect && !isPreset ? (
                                <button
                                  type="button"
                                  className="organization-setup__assigned-action"
                                  disabled={busy}
                                  aria-label={`Edit ${name}`}
                                  title="Edit role"
                                  onClick={() => editRole(role)}
                                >
                                  Edit
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="organization-setup__assigned-action"
                                disabled={busy}
                                aria-label={`Unassign ${name} from this folder`}
                                title="Remove from this folder"
                                onClick={() =>
                                  isDirect ? removeDirectTypeRole(index) : unassignRole(index)
                                }
                              >
                                Unassign
                              </button>
                              {!isDirect && !isPreset ? (
                                <button
                                  type="button"
                                  className="organization-setup__remove organization-setup__assigned-action"
                                  disabled={busy}
                                  aria-label={`Delete ${name}`}
                                  title="Delete role entirely"
                                  onClick={() => deleteRole(index)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    {assignedProgramEntries.map(({ program, index }) => {
                      const types = normalizeFileTypes(program.fileTypesText);
                      const isProgram = types.length > 0;
                      return (
                        <div className="organization-setup__program-entry" key={`program-${index}`}>
                          <div className="organization-setup__assigned-row organization-setup__program-assigned">
                            <span className="organization-setup__assigned-name">
                              <span className="organization-setup__program-tag">Folder</span>
                              {program.displayName}
                            </span>
                            <span className="organization-setup__assigned-types">
                              {types.length ? types.join(" ") : "—"}
                              {program.createOnlyIfMatchingFilesOrRolesPresent ? "" : " · always"}
                            </span>
                            <div className="organization-setup__assigned-actions">
                              <button
                                type="button"
                                className="organization-setup__remove organization-setup__assigned-action"
                                disabled={busy}
                                aria-label={`Remove folder ${program.displayName}`}
                                title="Remove this folder"
                                onClick={() => removeProgramFolder(index)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          {isProgram ? (
                            <div className="organization-setup__program-preview">
                              <span className="organization-setup__program-preview-note">
                                {program.createOnlyIfMatchingFilesOrRolesPresent
                                  ? "Not made yet — built when matching files appear:"
                                  : "Will be built:"}
                              </span>
                              <div className="organization-setup__program-preview-folders">
                                {PROGRAM_LIFECYCLE_FOLDERS.map((lifecycle) => (
                                  <span key={lifecycle}>{lifecycle}</span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="organization-setup__direct-types">
                    <label>
                      <span>File types</span>
                      <input
                        value={directFileTypesInput}
                        placeholder="png, jpg, stl"
                        disabled={busy}
                        onChange={(event) => setDirectFileTypesInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            assignDirectFileTypes();
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={assignDirectFileTypes}
                      disabled={busy || !directFileTypesInput.trim()}
                    >
                      Assign File Types
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="organization-setup__editor-card organization-setup__empty-settings">
                <div>
                  <h2>Select a folder</h2>
                  <p>Click a folder in the Project tree or the Profile section.</p>
                </div>
              </section>
            )}

            {programRulesOpen ? (
              <div
                className="organization-setup__add-role-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="organization-add-program-title"
              >
                <section className="organization-setup__program-dialog-card">
                  <h2
                    id="organization-add-program-title"
                    className="organization-setup__add-role-title"
                  >
                    Add folder to {selectedFolder === "." ? "Project Root (.)" : selectedFolder}
                  </h2>

                  <div className="organization-setup__program-presets">
                    {PROGRAM_FOLDER_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.name}
                        className={`organization-setup__program-preset ${
                          programPickName.trim() === preset.name ? "is-selected" : ""
                        }`}
                        disabled={busy}
                        title="Program preset — fills the name and file types"
                        onClick={() => {
                          setProgramPickName(preset.name);
                          setProgramPickFileTypes(preset.fileTypes.join(", "));
                        }}
                      >
                        <strong>{preset.name}</strong>
                        <span>{preset.fileTypes.join(" ")}</span>
                      </button>
                    ))}
                  </div>

                  {savedProfiles.length ? (
                    <div className="organization-setup__program-presets">
                      {savedProfiles.map((profile) => (
                        <button
                          type="button"
                          key={`profile:${profile.path}`}
                          className="organization-setup__program-preset organization-setup__profile-preset"
                          disabled={busy}
                          title={`Build the "${profile.name}" profile structure into ${selectedFolder}`}
                          onClick={() => {
                            cancelAddProgramFolder();
                            void applyProfileToSelected(profile.name);
                          }}
                        >
                          <strong>{profile.name}</strong>
                          <span>profile</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="organization-setup__add-role-top">
                    <label>
                      <span>Folder name</span>
                      <input
                        value={programPickName}
                        placeholder="any folder name"
                        disabled={busy}
                        autoFocus
                        onChange={(event) => setProgramPickName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void addProgramFolderToSelected(true);
                          }
                        }}
                      />
                    </label>
                    <label>
                      <span>File types (optional)</span>
                      <input
                        value={programPickFileTypes}
                        placeholder=".ai, .ait"
                        disabled={busy}
                        onChange={(event) => setProgramPickFileTypes(event.target.value)}
                        onBlur={() =>
                          setProgramPickFileTypes(
                            normalizeFileTypes(programPickFileTypes).join(", ")
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void addProgramFolderToSelected(true)}
                      disabled={busy || !programPickName.trim()}
                      title="Create this folder now under the selected folder"
                    >
                      Add folder
                    </button>
                    <button
                      type="button"
                      onClick={() => void addProgramFolderToSelected(false)}
                      disabled={busy || !programPickName.trim() || !programPickFileTypes.trim()}
                      title="Create this folder only when its file types are present"
                    >
                      Add when files match
                    </button>
                    <button type="button" onClick={cancelAddProgramFolder} disabled={busy}>
                      Cancel
                    </button>
                  </div>

                  <p className="organization-setup__folder-meta">
                    Add folder adds it now (always created). Add when files match creates it only
                    if its file types show up. File types are optional — leave them blank for a
                    plain folder. Either way it goes under the selected folder.
                  </p>
                </section>
              </div>
            ) : null}

            {addRoleOpen ? (
              <div
                className="organization-setup__add-role-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="organization-add-role-title"
              >
                <section className="organization-setup__add-role-dialog">
                  <h2 id="organization-add-role-title" className="organization-setup__add-role-title">
                    {editingRoleId ? "Edit role" : "Add role"}
                  </h2>

                  <div className="organization-setup__add-role-top">
                    <label>
                      <span>Role name</span>
                      <input
                        value={addRoleName}
                        placeholder="e.g. Reference"
                        disabled={busy}
                        autoFocus
                        onChange={(event) => setAddRoleName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveRole();
                          }
                        }}
                      />
                    </label>
                    <label>
                      <span>File types</span>
                      <input
                        value={addRoleFileTypesInput}
                        placeholder="png, jpg, stl"
                        disabled={busy}
                        onChange={(event) => setAddRoleFileTypesInput(event.target.value)}
                        onBlur={() =>
                          setAddRoleFileTypesInput(
                            normalizeFileTypes(addRoleFileTypesInput).join(", ")
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={saveRole}
                      disabled={busy || !addRoleName.trim()}
                    >
                      Save Role
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGroupNameInput("");
                        setGroupNameOpen(true);
                      }}
                      disabled={busy || pickerSelected.length === 0}
                      title="Save the selected file types as a reusable group"
                    >
                      Save File Group
                    </button>
                    <button type="button" onClick={cancelAddRole} disabled={busy}>
                      Cancel
                    </button>
                  </div>

                  <div className="organization-setup__type-groups">
                    {[
                      ...FILE_TYPE_GROUPS.map((group) => ({ group, custom: false })),
                      ...customGroups.map((group) => ({ group, custom: true }))
                    ].map(({ group, custom }) => {
                      const allSelected =
                        group.types.length > 0 &&
                        group.types.every((type) => pickerSelected.includes(type));
                      return (
                        <div className="organization-setup__type-group" key={`${custom ? "custom" : "builtin"}:${group.label}`}>
                          <div className="organization-setup__type-group-head">
                            <button
                              type="button"
                              className={`organization-setup__type-group-btn ${
                                allSelected ? "is-selected" : ""
                              }`}
                              onClick={() => toggleGroup(group.types)}
                              disabled={busy}
                            >
                              {group.label}
                            </button>
                            {custom ? (
                              <button
                                type="button"
                                className="organization-setup__remove organization-setup__type-group-remove"
                                disabled={busy}
                                aria-label={`Delete group ${group.label}`}
                                title="Delete this group"
                                onClick={() => removeCustomGroup(group.label)}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                          <div className="organization-setup__type-list">
                            {group.types.map((type) => (
                              <button
                                key={type}
                                type="button"
                                className={`organization-setup__type-btn ${
                                  pickerSelected.includes(type) ? "is-selected" : ""
                                }`}
                                onClick={() => togglePickerType(type)}
                                disabled={busy}
                              >
                                {type}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="organization-setup__add-role-footer">
                    <button
                      type="button"
                      onClick={addPickerToInput}
                      disabled={busy || pickerSelected.length === 0}
                    >
                      Add File Types
                    </button>
                  </div>

                  {groupNameOpen ? (
                    <div
                      className="organization-setup__group-name-overlay"
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="organization-group-name-title"
                    >
                      <section className="organization-setup__group-name-dialog">
                        <h2
                          id="organization-group-name-title"
                          className="organization-setup__add-role-title"
                        >
                          Name file group
                        </h2>
                        <input
                          value={groupNameInput}
                          placeholder="e.g. My Renders"
                          disabled={busy}
                          autoFocus
                          onChange={(event) => setGroupNameInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              confirmSaveFileGroup();
                            }
                          }}
                        />
                        <div className="organization-setup__group-name-actions">
                          <button
                            type="button"
                            onClick={confirmSaveFileGroup}
                            disabled={busy || !groupNameInput.trim()}
                          >
                            Save Group
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setGroupNameOpen(false);
                              setGroupNameInput("");
                            }}
                            disabled={busy}
                          >
                            Cancel
                          </button>
                        </div>
                      </section>
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}

            {pendingAmbiguity ? (
              <div className="organization-setup__ambiguity-overlay">
                <section
                  className="organization-setup__ambiguity-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="organization-ambiguity-title"
                >
                  <div>
                    <span>Loose file needs a choice</span>
                    <h2 id="organization-ambiguity-title">{pendingAmbiguity.prompt.title}</h2>
                    <p className="organization-setup__ambiguity-file">
                      {pendingAmbiguity.prompt.fileName}
                    </p>
                  </div>

                  <div className="organization-setup__ambiguity-scopes">
                    {pendingAmbiguity.prompt.scopes.map((scope) => (
                      <button
                        type="button"
                        className={scope === ambiguityScope ? "is-selected" : ""}
                        key={scope}
                        onClick={() => setAmbiguityScope(scope)}
                      >
                        {scope === "file" ? "This file" : scope === "run" ? "This run" : "This project"}
                      </button>
                    ))}
                  </div>
                  <p className="organization-setup__ambiguity-help">
                    Choose how long FlowCell should remember this decision, then pick the destination role.
                  </p>

                  <div className="organization-setup__ambiguity-choices">
                    {pendingAmbiguity.prompt.choices.map((choice) => (
                      <button
                        type="button"
                        key={choice.roleId}
                        onClick={() => chooseAmbiguousRole(choice.roleId)}
                      >
                        <strong>{choice.displayName}</strong>
                        <span>{choice.folder}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="organization-setup__footer">
          <div className="organization-setup__footer-status">
            {unknownRoleAssignmentIssue ? (
              <p className="organization-setup__bottom-warning">⚠ {unknownRoleAssignmentIssue}</p>
            ) : null}
            <p className={statusTone}>{status}</p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => void saveProfile(false)}
              disabled={busy}
              title="Write this profile (organize-folder.profile.json) into the current project root"
            >
              Apply to tree
            </button>
            <button
              type="button"
              onClick={() => void applyToProfile()}
              disabled={busy || !(selectedProfileName || profileName.trim())}
              title="Save the current setup into the loaded profile (build it up incrementally)"
            >
              Apply to profile
            </button>
            <button type="button" onClick={() => void saveProfile(true)} disabled={busy}>
              Apply &amp; rescan
            </button>
            <button type="button" onClick={() => void initStarterProfile()} disabled={busy}>
              Init Starter Profile
            </button>
            <button type="button" onClick={() => void getCurrentWindow().close()}>
              Close
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
