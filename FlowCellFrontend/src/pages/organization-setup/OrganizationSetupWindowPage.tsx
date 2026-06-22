import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  createStarterOrganizationProfile,
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
  OrganizationProfile,
  OrganizationRole,
  ProgramFolderRule
} from "../../features/organization/types";
import { showOpenFolderDialog } from "../../lib/tauri";
import "./organizationSetupWindowPage.css";

const LAST_PROJECT_ROOT_KEY = "flowcell.organizationSetup.lastProjectRoot";

type RoleDraft = Omit<OrganizationRole, "fileTypes"> & {
  fileTypesText: string;
};

type ProgramFolderDraft = Omit<ProgramFolderRule, "roles"> & {
  rolesText: string;
};

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

  const ambiguousFiles = useMemo(
    () =>
      (scan?.looseFiles ?? [])
        .map((file) => ({ file, resolution: resolveLooseFile(currentProfile, file) }))
        .filter((entry) => entry.resolution.status === "ambiguous"),
    [currentProfile, scan]
  );

  const selectedFolderRoles = currentProfile.roles.filter(
    (role) => role.folder.replace(/\\/g, "/") === selectedFolder
  );
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
      const profile = savedProfile ?? createStarterOrganizationProfile(root);
      setProjectRoot(root);
      window.localStorage.setItem(LAST_PROJECT_ROOT_KEY, root);
      setScan(nextScan);
      setSelectedFolder(null);
      applyProfile(profile);
      setStatus(
        savedProfile
          ? `${successMessage} Loaded .flowcell/organization-profile.json.`
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
      setScan(await scanOrganizationProject(root));
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
                  onClick={() => setSelectedFolder(folder)}
                >
                  {folder}
                </button>
              ))}
            </div>

            <div className="organization-setup__ambiguity">
              <div className="organization-setup__section-heading">
                <div>
                  <span>Unresolved / needs choice</span>
                  <h2>Ambiguous loose files</h2>
                </div>
                <strong>{ambiguousFiles.length}</strong>
              </div>
              {ambiguousFiles.length === 0 ? (
                <p>No ambiguous loose files.</p>
              ) : (
                <ul>
                  {ambiguousFiles.map(({ file, resolution }) => (
                    <li key={file.path}>
                      <strong>{file.fileName}</strong>
                      <span>
                        {resolution.status === "ambiguous"
                          ? resolution.choices.map((choice) => choice.displayName).join(" or ")
                          : "Needs choice"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <div className="organization-setup__editors">
            {selectedFolder ? (
            <section className="organization-setup__editor-card">
              <div className="organization-setup__section-heading">
                <div>
                  <span>Folder settings</span>
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
                {roles.map((role, index) => {
                  const isPreset = role.roleId === "project_root" || role.roleId === "unknown";
                  const folderOptions = Array.from(
                    new Set([...(scan?.folders ?? ["."]), role.folder || "."])
                  );
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
                          value={role.folder || "."}
                          disabled={busy || role.roleId === "project_root"}
                          onChange={(event) => updateRole(index, { folder: event.target.value })}
                        >
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
                  <span>Folder settings</span>
                  <h2>Select a folder</h2>
                  <p>Click a scanned folder under Project Tree to open its settings here.</p>
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
