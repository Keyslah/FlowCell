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
  readOrganizationProfile,
  scanOrganizationProject,
  writeOrganizationProfile,
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

type RoleDraft = Omit<OrganizationRole, "fileTypes"> & {
  fileTypesText: string;
};

type ProgramFolderDraft = Omit<ProgramFolderRule, "roles"> & {
  rolesText: string;
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
    programFolders: normalized.programFolders.map(({ roles: programRoles, ...program }) => ({
      ...program,
      rolesText: programRoles.join(", ")
    }))
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
  const [programRulesOpen, setProgramRulesOpen] = useState(false);
  const [fileChoices, setFileChoices] = useState<Record<string, string>>({});
  const [runChoices, setRunChoices] = useState<Record<string, string>>({});
  const [ambiguityScope, setAmbiguityScope] = useState<AmbiguityScope>("file");
  const [roleInput, setRoleInput] = useState("");
  const [roleFileTypesInput, setRoleFileTypesInput] = useState("");
  const [warningMessage, setWarningMessage] = useState<string | null>(null);

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
        programFolders: programFolders.map(({ rolesText, ...program }) => ({
          ...program,
          programId: normalizeRoleId(program.programId),
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

  const selectedFolderRoles = currentProfile.roles.filter(
    (role) => role.folder.replace(/\\/g, "/") === selectedFolder
  );
  const selectedFolderRoleEntries = roles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => normalizeFolderPath(role.folder || ".") === selectedFolder);
  const selectedFolderRoleIds = new Set(selectedFolderRoles.map((role) => role.roleId));
  const selectedFolderPrograms = currentProfile.programFolders.filter(
    (program) =>
      program.folder.replace(/\\/g, "/") === selectedFolder ||
      program.roles.some((roleId) => selectedFolderRoleIds.has(roleId))
  );

  const applyProfile = (profile: OrganizationProfile) => {
    const draft = profileToDraft(profile);
    setRoles(draft.roles);
    setProgramFolders(draft.programFolders);
    setRememberedChoices(profile.rememberedChoices ?? {});
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
      const assignmentIssue = getUnknownRoleAssignmentIssue(profile, nextScan);
      setProjectRoot(root);
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      setScan(nextScan);
      setSelectedFolder(".");
      setFileChoices({});
      setRunChoices({});
      setAmbiguityScope("file");
      setProgramRulesOpen(false);
      setRoleInput("");
      setRoleFileTypesInput("");
      applyProfile(profile);
      setStatus(
        savedProfile
          ? `${successMessage} Loaded .flowcell/organization-profile.json.`
          : `${successMessage} No saved profile yet; showing the starter profile.`
      );
      setStatusTone("is-success");
      setWarningMessage(assignmentIssue || null);
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (projectRoot.trim()) {
      void loadProject(projectRoot, "Project reopened.");
    }
    // Load only the remembered root at window startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setWarningMessage(unknownRoleAssignmentIssue);
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
      setFileChoices({});
      setRunChoices({});
      setAmbiguityScope("file");
      setRoleInput("");
      setRoleFileTypesInput("");
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      setStatus(`Starter profile initialized: ${savedPath}`);
      setStatusTone("is-success");
      setWarningMessage(getUnknownRoleAssignmentIssue(starter, nextScan) || null);
    } catch (error) {
      setStatus(formatError(error));
      setStatusTone("is-error");
    } finally {
      setBusy(false);
    }
  };

  const updateRole = (index: number, patch: Partial<RoleDraft>) => {
    setRoles((current) =>
      current.map((role, roleIndex) => (roleIndex === index ? { ...role, ...patch } : role))
    );
  };

  const updateProgram = (index: number, patch: Partial<ProgramFolderDraft>) => {
    setProgramFolders((current) =>
      current.map((program, programIndex) =>
        programIndex === index ? { ...program, ...patch } : program
      )
    );
  };

  const assignRoleToSelectedFolder = () => {
    if (!selectedFolder) {
      setStatus("Select a folder in the Project Tree first.");
      setStatusTone("is-error");
      return;
    }

    const roleId = normalizeRoleId(roleInput);
    const fileTypesText = normalizeFileTypes(roleFileTypesInput).join(", ");
    if (!roleId) {
      setStatus("Enter or choose a role first.");
      setStatusTone("is-error");
      return;
    }
    if (roleId === "project_root" && selectedFolder !== ".") {
      setStatus("Project Root can only stay assigned to the project root.");
      setStatusTone("is-error");
      return;
    }

    setRoles((current) => {
      const existingIndex = current.findIndex((role) => role.roleId === roleId);
      if (existingIndex >= 0) {
        return current.map((role, index) =>
          index === existingIndex
            ? {
                ...role,
                folder: selectedFolder,
                fileTypesText:
                  roleId === UNKNOWN_ROLE_ID || !fileTypesText
                    ? role.fileTypesText
                    : fileTypesText
              }
            : role
        );
      }
      return [
        ...current,
        {
          roleId,
          displayName: roleIdToDisplayName(roleId) || roleId,
          folder: selectedFolder,
          fileTypesText,
          description: ""
        }
      ];
    });
    setRoleInput("");
    setRoleFileTypesInput("");
    if (roleId === UNKNOWN_ROLE_ID) {
      setWarningMessage(null);
    }
    setStatus(`Assigned ${roleId} to ${selectedFolder}.`);
    setStatusTone("is-success");
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

        <section className="organization-setup__root-card">
          <label>
            <span>Project root</span>
            <input
              value={projectRoot}
              onChange={(event) => setProjectRoot(event.target.value)}
              placeholder="Choose the project folder to organize"
              disabled={busy}
            />
          </label>
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
        </section>

        <div className="organization-setup__workspace">
          <aside className="organization-setup__folder-card">
            <div className="organization-setup__section-heading">
              <div>
                <span>Project tree</span>
                <h2>Folders</h2>
              </div>
              <strong>{scan?.folders.length ?? 0}</strong>
            </div>
            <div className="organization-setup__folder-list" role="list">
              {(scan?.folders ?? ["."]).map((folder) => (
                <button
                  type="button"
                  className={folder === selectedFolder ? "is-selected" : ""}
                  key={folder}
                  role="listitem"
                  onClick={() => {
                    setSelectedFolder(folder);
                    setRoleInput("");
                    setRoleFileTypesInput("");
                  }}
                >
                  {folder}
                </button>
              ))}
            </div>
          </aside>

          <div className="organization-setup__editors">
            {selectedFolder ? (
            <section className="organization-setup__editor-card organization-setup__role-editor">
              <div className="organization-setup__role-input-row">
                <label>
                  <span>Role</span>
                  <input
                    value={roleInput}
                    list="organization-role-options"
                    placeholder="Type or choose a role"
                    disabled={busy}
                    onChange={(event) => setRoleInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        assignRoleToSelectedFolder();
                      }
                    }}
                  />
                </label>
                <label>
                  <span>File types</span>
                  <input
                    value={roleFileTypesInput}
                    placeholder="stl, obj, 3mf"
                    disabled={busy || normalizeRoleId(roleInput) === UNKNOWN_ROLE_ID}
                    onChange={(event) => setRoleFileTypesInput(event.target.value)}
                    onBlur={() =>
                      setRoleFileTypesInput(normalizeFileTypes(roleFileTypesInput).join(", "))
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={assignRoleToSelectedFolder}
                  disabled={busy || !roleInput.trim()}
                >
                  Add role
                </button>
                <button
                  type="button"
                  onClick={() => setProgramRulesOpen(true)}
                  disabled={busy}
                >
                  Program folder rules
                </button>
                <datalist id="organization-role-options">
                  {roles.map((role) => (
                    <option key={role.roleId} value={role.roleId}>
                      {role.displayName}
                    </option>
                  ))}
                </datalist>
              </div>
              <div className="organization-setup__section-heading">
                <div>
                  <span>Roles</span>
                  <h2>{selectedFolder}</h2>
                  <p className="organization-setup__folder-meta">
                    {selectedFolderRoles.length} assigned role(s) · {selectedFolderPrograms.length}
                    {" "}program rule(s)
                    {selectedFolder === "." ? ` · ${scan?.looseFiles.length ?? 0} loose file(s)` : ""}
                  </p>
                </div>
                <div className="organization-setup__heading-actions">
                  <button
                    type="button"
                    onClick={() => setProgramRulesOpen(true)}
                    disabled={busy}
                  >
                    Program folder rules
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRoles((current) => [
                        ...current,
                        {
                          roleId: `role_${current.length + 1}`,
                          displayName: `Role ${current.length + 1}`,
                          folder: ".",
                          fileTypesText: "",
                          description: ""
                        }
                      ])
                    }
                    disabled={busy}
                  >
                    Add role
                  </button>
                </div>
              </div>
              <div className="organization-setup__role-list">
                {selectedFolderRoleEntries.map(({ role, index }) => {
                  const isPreset = role.roleId === "project_root" || role.roleId === "unknown";
                  const isUnknown = role.roleId === UNKNOWN_ROLE_ID;
                  const folderOptions = Array.from(
                    new Set([...(scan?.folders ?? ["."]), role.folder || "."])
                  ).filter((folder) => !isUnknown || folder !== ".");
                  return (
                    <article className="organization-setup__role-row" key={index}>
                      <label>
                        <span>Role ID</span>
                        <input
                          value={role.roleId}
                          disabled={busy || isPreset}
                          onChange={(event) => updateRole(index, { roleId: event.target.value })}
                          onBlur={() => updateRole(index, { roleId: normalizeRoleId(role.roleId) })}
                        />
                      </label>
                      <label>
                        <span>Display name</span>
                        <input
                          value={role.displayName}
                          disabled={busy || role.roleId === "unknown"}
                          onChange={(event) => updateRole(index, { displayName: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Assigned folder</span>
                        <select
                          value={isUnknown ? role.folder : role.folder || "."}
                          disabled={busy || role.roleId === "project_root"}
                          onChange={(event) => updateRole(index, { folder: event.target.value })}
                        >
                          {isUnknown ? (
                            <option value="" disabled>
                              Assign Unknown to a folder
                            </option>
                          ) : null}
                          {folderOptions.map((folder) => (
                            <option key={folder} value={folder}>
                              {folder}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="organization-setup__file-types">
                        <span>Optional file types</span>
                        <textarea
                          value={role.roleId === "unknown" ? "Automatic catch-all" : role.fileTypesText}
                          disabled={busy || isPreset}
                          placeholder="ai, psd, svg"
                          onChange={(event) => updateRole(index, { fileTypesText: event.target.value })}
                          onBlur={() =>
                            updateRole(index, {
                              fileTypesText: normalizeFileTypes(role.fileTypesText).join("\n")
                            })
                          }
                        />
                      </label>
                      <label className="organization-setup__description">
                        <span>Description</span>
                        <input
                          value={role.description ?? ""}
                          disabled={busy || role.roleId === "unknown"}
                          onChange={(event) => updateRole(index, { description: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="organization-setup__remove"
                        disabled={busy || isPreset}
                        onClick={() =>
                          setRoles((current) => current.filter((_, roleIndex) => roleIndex !== index))
                        }
                      >
                        Remove
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
            ) : (
              <section className="organization-setup__editor-card organization-setup__empty-settings">
                <div>
                  <h2>Select a folder</h2>
                  <p>Click a folder in the Project Tree.</p>
                </div>
              </section>
            )}

            <div
              className={`organization-setup__program-overlay ${programRulesOpen ? "is-open" : ""}`}
              aria-hidden={!programRulesOpen}
            >
            <section className="organization-setup__editor-card organization-setup__program-dialog">
              <div className="organization-setup__section-heading">
                <div>
                  <span>Templates</span>
                  <h2>Program folder rules</h2>
                </div>
                <div className="organization-setup__heading-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setProgramFolders((current) => [
                        ...current,
                        {
                          programId: `program_${current.length + 1}`,
                          displayName: `Program ${current.length + 1}`,
                          folder: ".",
                          rolesText: "",
                          createOnlyIfMatchingFilesOrRolesPresent: true
                        }
                      ])
                    }
                  >
                    Add program rule
                  </button>
                  <button type="button" onClick={() => setProgramRulesOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
              <div className="organization-setup__program-list">
                {programFolders.map((program, index) => (
                  <article
                    className="organization-setup__program-row"
                    key={index}
                  >
                    <label>
                      <span>Program ID</span>
                      <input
                        value={program.programId}
                        disabled={busy}
                        onChange={(event) => updateProgram(index, { programId: event.target.value })}
                        onBlur={() =>
                          updateProgram(index, { programId: normalizeRoleId(program.programId) })
                        }
                      />
                    </label>
                    <label>
                      <span>Display name</span>
                      <input
                        value={program.displayName}
                        disabled={busy}
                        onChange={(event) => updateProgram(index, { displayName: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Folder</span>
                      <input
                        value={program.folder}
                        disabled={busy}
                        onChange={(event) => updateProgram(index, { folder: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>Roles</span>
                      <input
                        value={program.rolesText}
                        disabled={busy}
                        onChange={(event) =>
                          updateProgram(index, { rolesText: event.target.value })
                        }
                        onBlur={() =>
                          updateProgram(index, {
                            rolesText: splitRoleIds(program.rolesText).join(", ")
                          })
                        }
                      />
                    </label>
                    <label className="organization-setup__checkbox">
                      <input
                        type="checkbox"
                        checked={program.createOnlyIfMatchingFilesOrRolesPresent}
                        disabled={busy}
                        onChange={(event) =>
                          updateProgram(index, {
                            createOnlyIfMatchingFilesOrRolesPresent: event.target.checked
                          })
                        }
                      />
                      <span>Only create this program folder if matching files or roles are present</span>
                    </label>
                    <button
                      type="button"
                      className="organization-setup__remove"
                      disabled={busy}
                      onClick={() =>
                        setProgramFolders((current) =>
                          current.filter((_, programIndex) => programIndex !== index)
                        )
                      }
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
            </section>
            </div>

            {warningMessage ? (
              <div className="organization-setup__warning-overlay">
                <section
                  className="organization-setup__warning-dialog"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="organization-warning-title"
                >
                  <span>Warning</span>
                  <h2 id="organization-warning-title">Unknown role needs a folder</h2>
                  <p>{warningMessage}</p>
                  <button type="button" onClick={() => setWarningMessage(null)}>
                    OK
                  </button>
                </section>
              </div>
            ) : null}

            {!warningMessage && pendingAmbiguity ? (
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
          <p className={statusTone}>{status}</p>
          <div>
            <button type="button" onClick={() => void saveProfile(false)} disabled={busy}>
              Save
            </button>
            <button type="button" onClick={() => void saveProfile(true)} disabled={busy}>
              Save and Rescan
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
