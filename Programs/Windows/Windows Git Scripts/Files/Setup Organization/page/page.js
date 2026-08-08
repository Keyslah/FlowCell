(function setupOrganizationPage() {
  "use strict";

  const bridge = window.flowcellPage;
  if (!bridge || typeof bridge.request !== "function") {
    throw new Error("The FlowCell installed-page bridge is unavailable.");
  }

  const descriptor = bridge.descriptor && typeof bridge.descriptor === "object" ? bridge.descriptor : {};
  const config = descriptor.config && typeof descriptor.config === "object" ? descriptor.config : {};
  const DEFAULT_CAP = 12;

  const elements = {
    profileSelect: document.getElementById("profile-select"),
    profileName: document.getElementById("profile-name"),
    recycleOtherFolders: document.getElementById("recycle-other-folders"),
    recyclePreviousIgnoredFolders: document.getElementById("recycle-previous-ignored-folders"),
    newProfile: document.getElementById("new-profile"),
    saveProfile: document.getElementById("save-profile"),
    saveProfileAs: document.getElementById("save-profile-as"),
    deleteProfile: document.getElementById("delete-profile"),

    folderCount: document.getElementById("folder-count"),
    addFolder: document.getElementById("add-folder"),
    addSubfolder: document.getElementById("add-subfolder"),
    renameFolder: document.getElementById("rename-folder"),
    deleteFolder: document.getElementById("delete-folder"),
    loadTree: document.getElementById("load-tree"),
    capEnabled: document.getElementById("cap-enabled"),
    capCount: document.getElementById("cap-count"),
    folderList: document.getElementById("folder-list"),

    filesTarget: document.getElementById("files-target"),
    groupList: document.getElementById("group-list"),
    toggleCreateGroup: document.getElementById("toggle-create-group"),
    groupForm: document.getElementById("group-form"),
    groupFormTitle: document.getElementById("group-form-title"),
    groupName: document.getElementById("group-name"),
    groupExtensions: document.getElementById("group-extensions"),
    groupIsProgram: document.getElementById("group-is-program"),
    programGroupList: document.getElementById("program-group-list"),
    createProgramGroup: document.getElementById("create-program-group"),
    saveGroup: document.getElementById("save-group"),
    cancelGroup: document.getElementById("cancel-group"),
    directTypes: document.getElementById("direct-types"),
    catchAllFolder: document.getElementById("catch-all-folder"),
    ignoreFolder: document.getElementById("ignore-folder"),
    applyFiles: document.getElementById("apply-files"),

    panelSelect: document.getElementById("panel-select"),
    installButton: document.getElementById("install-button"),
    installedList: document.getElementById("installed-list"),

    status: document.getElementById("status"),
    busy: document.getElementById("busy-indicator"),

    promptDialog: document.getElementById("prompt-dialog"),
    promptTitle: document.getElementById("prompt-title"),
    promptCopy: document.getElementById("prompt-copy"),
    promptInput: document.getElementById("prompt-input"),
    promptAccept: document.getElementById("prompt-accept"),
    promptCancel: document.getElementById("prompt-cancel"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmTitle: document.getElementById("confirm-title"),
    confirmCopy: document.getElementById("confirm-copy"),
    confirmAccept: document.getElementById("confirm-accept"),
    confirmCancel: document.getElementById("confirm-cancel")
  };

  const state = {
    busy: false,
    profiles: [],
    groups: [],
    installed: [],
    profileId: "",
    /** Ordered folder entries: order is the routing order. */
    folders: [],
    /** Profile-level program folders: [{ groupId, createInRoot, profileId }]. */
    programFolders: [],
    selectedPath: "",
    /** Uncommitted Files-panel edits for the selected folder. */
    draftGroupIds: [],
    draftTypes: "",
    draftIgnored: false,
    draftCatchAll: false,
    dirty: false,
    confirmResolve: null,
    promptResolve: null,
    /** groupId the group form is editing; empty means it is creating a new one. */
    editingGroupId: ""
  };

  function request(actionId, payload = {}) {
    return bridge.request(actionId, payload);
  }

  function formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function setStatus(message, tone = "neutral") {
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  function setBusy(busy, message) {
    state.busy = busy === true;
    elements.busy.dataset.busy = state.busy ? "true" : "false";
    if (message) setStatus(message);
    renderControls();
  }

  async function runBusy(message, work) {
    if (state.busy) return;
    setBusy(true, message);
    try {
      await work();
    } catch (error) {
      setStatus(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------- value helpers

  function normalizeFolderPath(value) {
    return String(value || "")
      .trim()
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .join("/");
  }

  function parseExtensions(value) {
    const seen = new Set();
    return String(value || "")
      .split(/[,;\s]+/)
      .map((raw) => raw.trim().toLowerCase())
      .filter(Boolean)
      .map((raw) => (raw.startsWith(".") ? raw : `.${raw}`))
      .filter((extension) => {
        if (!/^\.[a-z0-9][a-z0-9._+-]*$/.test(extension) || seen.has(extension)) return false;
        seen.add(extension);
        return true;
      });
  }

  function fileGroups() {
    return state.groups.filter((group) => group.isProgram !== true);
  }

  function programGroups() {
    return state.groups.filter((group) => group.isProgram === true);
  }

  function programFolderFor(groupId) {
    return state.programFolders.find((entry) => entry.groupId === groupId) || null;
  }

  function setProgramFolder(groupId, changes) {
    let entry = programFolderFor(groupId);
    if (!entry) {
      entry = { groupId, createInRoot: false, profileId: "" };
      state.programFolders.push(entry);
    }
    Object.assign(entry, changes);
    // An entry that does nothing is not worth persisting.
    state.programFolders = state.programFolders.filter(
      (item) => item.createInRoot === true || item.profileId
    );
    markDirty();
  }

  function groupById(groupId) {
    const key = String(groupId || "").toLowerCase();
    return state.groups.find((group) => group.groupId.toLowerCase() === key) || null;
  }

  /** Group-referenced extensions plus directly assigned ones, in that order. */
  function effectiveExtensions(folder) {
    const seen = new Set();
    const result = [];
    for (const groupId of folder.groupIds || []) {
      const group = groupById(groupId);
      if (!group) continue;
      for (const extension of group.fileTypes || []) {
        if (seen.has(extension)) continue;
        seen.add(extension);
        result.push(extension);
      }
    }
    for (const extension of folder.fileTypes || []) {
      if (seen.has(extension)) continue;
      seen.add(extension);
      result.push(extension);
    }
    return result;
  }

  /**
   * Extensions claimed by more than one folder. The first folder in order wins
   * at run time, so the editor flags the conflict instead of resolving it later.
   */
  function conflictedExtensions() {
    const owners = new Map();
    const conflicts = new Set();
    for (const folder of state.folders) {
      if (folder.ignored) continue;
      for (const extension of effectiveExtensions(folder)) {
        if (owners.has(extension) && owners.get(extension) !== folder.path) {
          conflicts.add(extension);
          continue;
        }
        owners.set(extension, folder.path);
      }
    }
    return conflicts;
  }

  function findFolder(path) {
    return state.folders.find((folder) => folder.path === path) || null;
  }

  function markDirty() {
    state.dirty = true;
    renderControls();
  }

  // ---------------------------------------------------------------- rendering

  function emptyMessage(container, message) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = message;
    container.replaceChildren(div);
  }

  function renderFolders() {
    elements.folderCount.textContent = String(state.folders.length);
    if (state.folders.length === 0) {
      emptyMessage(elements.folderList, "No folders yet. Add one, or load a tree from a folder.");
      return;
    }

    const conflicts = conflictedExtensions();
    const fragment = document.createDocumentFragment();
    for (const folder of state.folders) {
      const isRoot = isRootFolder(folder);
      const depth = isRoot ? 0 : folder.path.split("/").length - 1;
      const row = document.createElement("button");
      row.type = "button";
      row.className = "tree-row";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", folder.path === state.selectedPath ? "true" : "false");
      row.dataset.ignored = folder.ignored ? "true" : "false";
      row.style.paddingLeft = `${6 + depth * 14}px`;

      const name = document.createElement("span");
      name.className = "tree-name";
      name.textContent = isRoot
        ? "(project root)"
        : (folder.path.split("/").pop() || folder.path);
      row.append(name);

      if (folder.ignored) {
        const badge = document.createElement("span");
        badge.className = "tree-types";
        badge.textContent = "ignored";
        row.append(badge);
      } else if (folder.catchAll) {
        const parts = [];
        for (const groupId of folder.groupIds || []) {
          const group = groupById(groupId);
          parts.push(group ? group.label : groupId);
        }
        parts.push(...(folder.fileTypes || []));
        parts.push("everything else");
        const badge = document.createElement("span");
        badge.className = "tree-types";
        badge.textContent = parts.join(", ");
        row.append(badge);
      } else {
        // Assigned groups read as their names, so a 40-extension group shows as
        // "3D" instead of a wall of extensions. Only direct types are listed.
        const parts = [];
        for (const groupId of folder.groupIds || []) {
          const group = groupById(groupId);
          parts.push(group ? group.label : groupId);
        }
        const direct = folder.fileTypes || [];
        parts.push(...direct.slice(0, 3));
        if (direct.length > 3) parts.push(`+${direct.length - 3}`);

        if (parts.length > 0) {
          const extensions = effectiveExtensions(folder);
          const hasConflict = extensions.some((extension) => conflicts.has(extension));
          const types = document.createElement("span");
          types.className = hasConflict ? "tree-types tree-warn" : "tree-types";
          types.textContent = hasConflict ? `! ${parts.join(", ")}` : parts.join(", ");
          types.title = extensions.join(" ");
          row.append(types);
        }
      }

      row.addEventListener("click", () => selectFolder(folder.path));
      fragment.append(row);
    }
    elements.folderList.replaceChildren(fragment);
  }

  function renderGroups() {
    const folder = findFolder(state.selectedPath);
    const listed = fileGroups();
    if (listed.length === 0) {
      emptyMessage(elements.groupList, "No file groups yet. Create one below.");
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const group of listed) {
      const row = document.createElement("label");
      row.className = "group-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.draftGroupIds.includes(group.groupId);
      checkbox.disabled = state.busy || !folder || state.draftIgnored;
      checkbox.addEventListener("change", () => {
        state.draftGroupIds = checkbox.checked
          ? [...state.draftGroupIds, group.groupId]
          : state.draftGroupIds.filter((groupId) => groupId !== group.groupId);
        renderControls();
      });

      const label = document.createElement("span");
      label.className = "group-label";
      label.textContent = group.label;

      const extensions = document.createElement("span");
      extensions.className = "group-ext";
      extensions.textContent = (group.fileTypes || []).join(" ");

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "group-remove group-edit";
      edit.textContent = "edit";
      edit.title = `Add or remove file types in ${group.label}`;
      edit.disabled = state.busy;
      edit.addEventListener("click", (event) => {
        event.preventDefault();
        beginEditGroup(group);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "group-remove";
      remove.textContent = "×";
      remove.title = `Delete the ${group.label} group`;
      remove.disabled = state.busy;
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        void deleteGroup(group);
      });

      row.append(checkbox, label, extensions, edit, remove);
      fragment.append(row);
    }
    elements.groupList.replaceChildren(fragment);
  }

  /**
   * Program file groups are profile-level, not folder-level: each one can claim
   * its own root folder and hand the inside of it to another profile.
   */
  function renderProgramGroups() {
    const listed = programGroups();
    if (listed.length === 0) {
      emptyMessage(elements.programGroupList, "No program file groups yet.");
      return;
    }

    const folder = findFolder(state.selectedPath);
    const fragment = document.createDocumentFragment();
    for (const group of listed) {
      const entry = programFolderFor(group.groupId);
      const card = document.createElement("div");
      card.className = "program-group";

      // The head is identity only. A program folder goes in the project root,
      // so nothing here depends on which folder is selected.
      const head = document.createElement("div");
      head.className = "program-group-head";

      const label = document.createElement("strong");
      label.className = "group-label";
      label.textContent = group.label;

      const extensions = document.createElement("span");
      extensions.className = "group-ext";
      extensions.textContent = (group.fileTypes || []).join(" ");

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "group-remove group-edit";
      edit.textContent = "edit";
      edit.disabled = state.busy;
      edit.addEventListener("click", (event) => {
        event.preventDefault();
        beginEditGroup(group);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "group-remove";
      remove.textContent = "\u00d7";
      remove.disabled = state.busy;
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        void deleteGroup(group);
      });

      head.append(label, extensions, edit, remove);

      const createRow = document.createElement("label");
      createRow.className = "checkbox program-option";
      const createBox = document.createElement("input");
      createBox.type = "checkbox";
      createBox.checked = entry ? entry.createInRoot === true : false;
      createBox.disabled = state.busy;
      createBox.addEventListener("change", () => {
        setProgramFolder(group.groupId, { createInRoot: createBox.checked });
        renderProgramGroups();
        renderControls();
      });
      const createText = document.createElement("span");
      createText.textContent =
        `Create a "${group.label}" folder in the project root when these files are present`;
      createRow.append(createBox, createText);

      const profileRow = document.createElement("label");
      profileRow.className = "checkbox program-option";
      const profileBox = document.createElement("input");
      profileBox.type = "checkbox";
      profileBox.checked = Boolean(entry && entry.profileId);
      profileBox.disabled = state.busy;
      const profileSelect = document.createElement("select");
      profileSelect.disabled = state.busy || !profileBox.checked;

      const none = document.createElement("option");
      none.value = "";
      none.textContent = "Choose a profile\u2026";
      profileSelect.append(none);
      for (const candidate of state.profiles) {
        if (candidate.profileId === state.profileId) continue;
        const option = document.createElement("option");
        option.value = candidate.profileId;
        option.textContent = candidate.name;
        profileSelect.append(option);
      }
      profileSelect.value = entry && entry.profileId ? entry.profileId : "";

      profileBox.addEventListener("change", () => {
        // Ticking only reveals the picker: re-rendering here would rebuild from
        // state, which has no profile yet, and immediately undo the tick.
        profileSelect.disabled = state.busy || !profileBox.checked;
        if (!profileBox.checked) {
          setProgramFolder(group.groupId, { profileId: "" });
          renderProgramGroups();
        }
        renderControls();
      });
      profileSelect.addEventListener("change", () => {
        setProgramFolder(group.groupId, { profileId: profileSelect.value });
        renderProgramGroups();
        renderControls();
      });

      const profileText = document.createElement("span");
      profileText.textContent = "Organize inside it with";
      profileRow.append(profileBox, profileText, profileSelect);

      card.append(head, createRow, profileRow);

      // Assigning a program group to a folder only means something inside a
      // profile that is itself used within a program folder, so it is offered
      // last and only once a folder is actually selected.
      if (folder) {
        const assignRow = document.createElement("label");
        assignRow.className = "checkbox program-option program-option-advanced";
        const assign = document.createElement("input");
        assign.type = "checkbox";
        assign.checked = state.draftGroupIds.includes(group.groupId);
        assign.disabled = state.busy || state.draftIgnored;
        assign.addEventListener("change", () => {
          state.draftGroupIds = assign.checked
            ? [...state.draftGroupIds, group.groupId]
            : state.draftGroupIds.filter((groupId) => groupId !== group.groupId);
          renderControls();
        });
        const assignText = document.createElement("span");
        assignText.textContent = `Also put these files in "${folder.path}"`;
        assignRow.append(assign, assignText);
        card.append(assignRow);
      }

      fragment.append(card);
    }
    elements.programGroupList.replaceChildren(fragment);
  }

  function renderFilesPanel() {
    const folder = findFolder(state.selectedPath);
    elements.filesTarget.textContent = folder ? folder.path : "No folder selected";
    elements.directTypes.value = state.draftTypes;
    elements.ignoreFolder.checked = state.draftIgnored;
    elements.catchAllFolder.checked = state.draftCatchAll;
    renderGroups();
    renderProgramGroups();
  }

  function renderProfiles() {
    const fragment = document.createDocumentFragment();
    if (state.profiles.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No saved profiles yet";
      fragment.append(option);
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Unsaved profile";
      fragment.append(placeholder);
      for (const profile of state.profiles) {
        const option = document.createElement("option");
        option.value = profile.profileId;
        option.textContent = `${profile.name} (${profile.folderCount})`;
        fragment.append(option);
      }
    }
    elements.profileSelect.replaceChildren(fragment);
    elements.profileSelect.value = state.profileId;
  }

  function renderInstalled() {
    if (state.installed.length === 0) {
      emptyMessage(elements.installedList, "No organizer Buttons installed yet.");
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const button of state.installed) {
      const row = document.createElement("div");
      row.className = "installed-row";

      const label = document.createElement("strong");
      label.textContent = button.label;

      const uses = document.createElement("span");
      uses.textContent = button.profileMissing
        ? "profile deleted"
        : `uses ${button.profileName}`;

      row.append(label, uses);

      if (button.profileMissing || button.labelStale) {
        const note = document.createElement("span");
        note.className = "installed-note";
        note.textContent = button.profileMissing
          ? "This Button will fail on press."
          : `Profile was renamed to ${button.profileName}; reinstall to relabel.`;
        row.append(note);
      }
      fragment.append(row);
    }
    elements.installedList.replaceChildren(fragment);
  }

  function renderControls() {
    const folder = findFolder(state.selectedPath);
    const hasName = elements.profileName.value.trim().length > 0;

    elements.renameFolder.disabled = state.busy || !folder || isRootFolder(folder);
    elements.deleteFolder.disabled = state.busy || !folder || isRootFolder(folder);
    elements.addFolder.disabled = state.busy;
    elements.addSubfolder.disabled = state.busy || !folder;
    elements.loadTree.disabled = state.busy;
    elements.capCount.disabled = state.busy || !elements.capEnabled.checked;
    elements.capEnabled.disabled = state.busy;

    elements.directTypes.disabled = state.busy || !folder || state.draftIgnored;
    elements.ignoreFolder.disabled = state.busy || !folder || isRootFolder(folder);
    elements.catchAllFolder.disabled = state.busy || !folder || state.draftIgnored;
    elements.applyFiles.disabled = state.busy || !folder;

    elements.saveProfile.disabled = state.busy || !hasName || state.folders.length === 0;
    elements.saveProfileAs.disabled = elements.saveProfile.disabled;
    elements.deleteProfile.disabled = state.busy || !state.profileId;
    elements.newProfile.disabled = state.busy;
    elements.recycleOtherFolders.disabled = state.busy;
    elements.recyclePreviousIgnoredFolders.disabled = state.busy || !elements.recycleOtherFolders.checked;
    // Install saves first when needed, so unsaved work is not a reason to block it.
    elements.installButton.disabled = state.busy || !hasName || state.folders.length === 0;
    elements.toggleCreateGroup.disabled = state.busy;
    elements.createProgramGroup.disabled = state.busy;
    elements.saveGroup.disabled = state.busy;
  }

  function renderAll() {
    renderProfiles();
    renderFolders();
    renderFilesPanel();
    renderProgramGroups();
    renderInstalled();
    renderControls();
  }

  // ----------------------------------------------------------------- dialogs

  function confirmAction(title, copy) {
    elements.confirmTitle.textContent = title;
    elements.confirmCopy.textContent = copy;
    elements.confirmDialog.hidden = false;
    return new Promise((resolve) => {
      state.confirmResolve = resolve;
    });
  }

  function promptForText(title, copy, initialValue) {
    elements.promptTitle.textContent = title;
    elements.promptCopy.textContent = copy;
    elements.promptInput.value = initialValue || "";
    elements.promptDialog.hidden = false;
    elements.promptInput.focus();
    elements.promptInput.select();
    return new Promise((resolve) => {
      state.promptResolve = resolve;
    });
  }

  function closePrompt(result) {
    elements.promptDialog.hidden = true;
    const resolve = state.promptResolve;
    state.promptResolve = null;
    if (resolve) resolve(result);
  }

  function closeConfirm(result) {
    elements.confirmDialog.hidden = true;
    const resolve = state.confirmResolve;
    state.confirmResolve = null;
    if (resolve) resolve(result);
  }

  // ------------------------------------------------------------- folder edits

  const ROOT_PATH = ".";

  function sortFolders() {
    // The project root always leads the list, so it also leads the routing order.
    state.folders.sort((left, right) => {
      if (left.path === ROOT_PATH) return -1;
      if (right.path === ROOT_PATH) return 1;
      return left.path.localeCompare(right.path, undefined, { numeric: true });
    });
  }

  function isRootFolder(folder) {
    return Boolean(folder) && folder.path === ROOT_PATH;
  }

  /** Every profile always offers the project root itself as an assignable target. */
  function ensureRootFolder() {
    if (!findFolder(ROOT_PATH)) {
      state.folders.push({
        path: ROOT_PATH, groupIds: [], fileTypes: [], ignored: false, catchAll: false
      });
    }
    sortFolders();
  }

  function clearSelection() {
    state.selectedPath = "";
    state.draftGroupIds = [];
    state.draftTypes = "";
    state.draftIgnored = false;
    state.draftCatchAll = false;
    renderFolders();
    renderFilesPanel();
    renderControls();
  }

  function selectFolder(path) {
    const folder = findFolder(path);
    if (!folder) return;
    // Clicking the highlighted folder again unhighlights it.
    if (state.selectedPath === path) {
      clearSelection();
      return;
    }
    state.selectedPath = path;
    // Committed assignments become the draft, so leaving and returning to a
    // folder shows exactly the selection that was applied to it.
    state.draftGroupIds = [...(folder.groupIds || [])];
    state.draftTypes = (folder.fileTypes || []).join(", ");
    state.draftIgnored = folder.ignored === true;
    state.draftCatchAll = folder.catchAll === true;
    renderFolders();
    renderFilesPanel();
    renderControls();
  }

  async function addFolder(nested) {
    const parent = nested && state.selectedPath !== ROOT_PATH ? state.selectedPath : "";
    const name = await promptForText(
      nested ? "New subfolder" : "New folder",
      nested ? `Added inside ${parent}.` : "Added at the top level of the profile.",
      ""
    );
    if (name === null) return;
    const relative = normalizeFolderPath(name);
    if (!relative) {
      setStatus("A folder needs a name.", "error");
      return;
    }
    const path = normalizeFolderPath(parent ? `${parent}/${relative}` : relative);
    if (findFolder(path)) {
      setStatus(`'${path}' is already in the tree.`, "error");
      return;
    }
    state.folders.push({ path, groupIds: [], fileTypes: [], ignored: false, catchAll: false });
    sortFolders();
    markDirty();
    selectFolder(path);
    setStatus(`Added ${path}.`, "success");
  }

  async function renameFolder() {
    const folder = findFolder(state.selectedPath);
    if (!folder) return;
    const current = folder.path.split("/").pop();
    const answer = await promptForText("Rename folder", `Renaming ${folder.path}.`, current);
    if (answer === null) return;
    const name = normalizeFolderPath(answer);
    if (!name || name.includes("/")) {
      setStatus("Type a single folder name, without slashes.", "error");
      return;
    }
    const segments = folder.path.split("/");
    segments[segments.length - 1] = name;
    const nextPath = segments.join("/");
    if (nextPath === folder.path) return;
    if (findFolder(nextPath)) {
      setStatus(`'${nextPath}' is already in the tree.`, "error");
      return;
    }

    // Children live under the old prefix and have to move with the parent.
    const prefix = `${folder.path}/`;
    for (const entry of state.folders) {
      if (entry === folder) continue;
      if (entry.path.startsWith(prefix)) {
        entry.path = `${nextPath}/${entry.path.slice(prefix.length)}`;
      }
    }
    folder.path = nextPath;
    sortFolders();
    markDirty();
    selectFolder(nextPath);
    setStatus(`Renamed to ${nextPath}.`, "success");
  }

  async function deleteFolder() {
    const folder = findFolder(state.selectedPath);
    if (!folder) return;
    const prefix = `${folder.path}/`;
    const children = state.folders.filter((entry) => entry.path.startsWith(prefix));
    const copy = children.length
      ? `'${folder.path}' and its ${children.length} subfolder(s) will be removed from this profile. No folders on disk are touched.`
      : `'${folder.path}' will be removed from this profile. No folders on disk are touched.`;
    const accepted = await confirmAction("Remove this folder from the profile?", copy);
    if (!accepted) return;

    state.folders = state.folders.filter(
      (entry) => entry !== folder && !entry.path.startsWith(prefix)
    );
    state.selectedPath = "";
    state.draftGroupIds = [];
    state.draftTypes = "";
    state.draftIgnored = false;
    state.draftCatchAll = false;
    markDirty();
    renderAll();
    setStatus(`Removed ${folder.path}.`);
  }

  function applyFileAssignments() {
    const folder = findFolder(state.selectedPath);
    if (!folder) return;
    folder.groupIds = [...state.draftGroupIds];
    folder.fileTypes = parseExtensions(state.draftTypes);
    folder.ignored = state.draftIgnored === true;
    folder.catchAll = state.draftCatchAll === true && !folder.ignored;
    if (folder.catchAll) {
      for (const other of state.folders) {
        if (other !== folder) other.catchAll = false;
      }
    }
    markDirty();
    renderFolders();
    renderFilesPanel();

    const conflicts = conflictedExtensions();
    if (conflicts.size > 0) {
      setStatus(
        `Applied to ${folder.path}. ${[...conflicts].join(" ")} is claimed by more than one folder — the first folder in the list wins.`,
        "error"
      );
      return;
    }
    setStatus(`Applied to ${folder.path}.`, "success");
  }

  // ------------------------------------------------------------------ loading

  async function loadTree() {
    await runBusy("Choosing a folder…", async () => {
      const selection = await request("select-root", {});
      if (!selection || selection.selected !== true || !selection.path) {
        setStatus("Load cancelled.");
        return;
      }
      if (state.folders.length > 0) {
        const accepted = await confirmAction(
          "Replace the current tree?",
          "Loading copies the folder structure of the chosen folder into this profile and replaces what is here now. The chosen folder is only read."
        );
        if (!accepted) {
          setStatus("Load cancelled.");
          return;
        }
      }

      const maxFolders = elements.capEnabled.checked
        ? Math.max(1, Number.parseInt(elements.capCount.value, 10) || DEFAULT_CAP)
        : 0;
      const result = await request("load-folder-tree", { rootPath: selection.path, maxFolders });
      const folders = Array.isArray(result?.folders) ? result.folders : [];

      state.folders = folders.map((path) => ({
        path: normalizeFolderPath(path),
        groupIds: [],
        fileTypes: [],
        ignored: false,
        catchAll: false
      }));
      ensureRootFolder();
      state.selectedPath = "";
      state.draftGroupIds = [];
      state.draftTypes = "";
      state.draftIgnored = false;
    state.draftCatchAll = false;
      markDirty();
      renderAll();

      setStatus(
        result?.capped
          ? `Loaded ${folders.length} of ${result.totalFound} folders (cap reached).`
          : `Loaded ${folders.length} folders.`,
        "success"
      );
    });
  }

  async function refreshProfiles() {
    const result = await request("list-profiles", {});
    state.profiles = Array.isArray(result?.profiles) ? result.profiles : [];
  }

  async function refreshGroups() {
    const result = await request("list-file-groups", {});
    state.groups = Array.isArray(result?.groups) ? result.groups : [];
  }

  async function refreshInstalled() {
    const result = await request("list-installed-buttons", {});
    state.installed = Array.isArray(result?.buttons) ? result.buttons : [];
  }

  function adoptProfile(profile) {
    state.profileId = String(profile.profileId || "");
    elements.profileName.value = String(profile.name || "");
    elements.recycleOtherFolders.checked = profile.recycleOtherFolders === true;
    elements.recyclePreviousIgnoredFolders.checked =
      elements.recycleOtherFolders.checked && profile.recyclePreviousIgnoredFolders === true;
    state.programFolders = (Array.isArray(profile.programFolders) ? profile.programFolders : [])
      .map((entry) => ({
        groupId: String(entry.groupId || ""),
        createInRoot: entry.createInRoot === true,
        profileId: String(entry.profileId || "")
      }))
      .filter((entry) => entry.groupId);
    state.folders = (Array.isArray(profile.folders) ? profile.folders : []).map((folder) => ({
      path: normalizeFolderPath(folder.path),
      groupIds: Array.isArray(folder.groupIds) ? [...folder.groupIds] : [],
      fileTypes: Array.isArray(folder.fileTypes) ? [...folder.fileTypes] : [],
      ignored: folder.ignored === true,
      catchAll: folder.catchAll === true
    }));
    ensureRootFolder();
    state.selectedPath = "";
    state.draftGroupIds = [];
    state.draftTypes = "";
    state.draftIgnored = false;
    state.draftCatchAll = false;
    state.dirty = false;
  }

  async function loadProfile(profileId) {
    if (!profileId) return;
    await runBusy("Loading the profile…", async () => {
      const result = await request("load-profile", { profileId });
      if (!result?.profile) throw new Error("The profile could not be loaded.");
      adoptProfile(result.profile);
      renderAll();
      setStatus(`Loaded ${result.profile.name}.`, "success");
    });
  }

  async function saveProfileAs() {
    const current = elements.profileName.value.trim();
    const answer = await promptForText(
      "Save as a new profile",
      "The name becomes the new Button label, so it has to be unique.",
      current ? `${current} copy` : ""
    );
    if (answer === null) return;
    if (!answer.trim()) {
      setStatus("A profile needs a name.", "error");
      return;
    }
    elements.profileName.value = answer.trim();
    state.profileId = "";
    await saveProfile(true);
  }

  async function saveProfile(asNew) {
    const name = elements.profileName.value.trim();
    if (!name) {
      setStatus("Give the profile a name first — it becomes the Button's name.", "error");
      return;
    }
    await runBusy("Saving the profile…", async () => {
      const payload = {
        name,
        recycleOtherFolders: elements.recycleOtherFolders.checked === true,
        recyclePreviousIgnoredFolders:
          elements.recycleOtherFolders.checked === true
          && elements.recyclePreviousIgnoredFolders.checked === true,
        programFolders: state.programFolders.map((entry) => ({
          groupId: entry.groupId,
          createInRoot: entry.createInRoot === true,
          profileId: entry.profileId || ""
        })),
        folders: state.folders.filter((folder) => !(
          isRootFolder(folder) && folder.groupIds.length === 0
          && folder.fileTypes.length === 0 && folder.catchAll !== true
        )).map((folder) => ({
          path: folder.path,
          groupIds: folder.groupIds,
          fileTypes: folder.fileTypes,
          ignored: folder.ignored === true,
          catchAll: folder.catchAll === true
        }))
      };
      if (!asNew && state.profileId) payload.profileId = state.profileId;

      const result = await request("save-profile", payload);
      if (!result?.profile) throw new Error("The profile could not be saved.");
      adoptProfile(result.profile);
      await refreshProfiles();
      await refreshInstalled();
      renderAll();
      setStatus(`Saved ${result.profile.name}.`, "success");
    });
  }

  async function deleteProfile() {
    if (!state.profileId) return;
    const current = state.profiles.find((profile) => profile.profileId === state.profileId);
    const accepted = await confirmAction(
      "Delete this profile?",
      `'${current ? current.name : state.profileId}' is sent to the Recycle Bin. Installed Buttons that use it must be deleted first.`
    );
    if (!accepted) return;

    await runBusy("Deleting the profile…", async () => {
      await request("delete-profile", { profileId: state.profileId });
      state.profileId = "";
      elements.profileName.value = "";
      elements.recycleOtherFolders.checked = false;
      elements.recyclePreviousIgnoredFolders.checked = false;
      state.folders = [];
      state.programFolders = [];
      state.selectedPath = "";
      state.dirty = false;
      await refreshProfiles();
      await refreshInstalled();
      renderAll();
      setStatus("Profile deleted.", "success");
    });
  }

  function newProfile() {
    state.profileId = "";
    elements.profileName.value = "";
    elements.recycleOtherFolders.checked = false;
    elements.recyclePreviousIgnoredFolders.checked = false;
    state.folders = [];
    state.programFolders = [];
    ensureRootFolder();
    state.selectedPath = "";
    state.draftGroupIds = [];
    state.draftTypes = "";
    state.draftIgnored = false;
    state.draftCatchAll = false;
    state.dirty = false;
    renderAll();
    setStatus("Started a new profile.");
  }

  // ------------------------------------------------------------- file groups

  function beginEditGroup(group) {
    state.editingGroupId = group.groupId;
    elements.groupName.value = group.label;
    elements.groupExtensions.value = (group.fileTypes || []).join(", ");
    elements.groupIsProgram.checked = group.isProgram === true;
    elements.groupFormTitle.textContent = `Editing ${group.label}`;
    elements.groupForm.hidden = false;
    elements.groupExtensions.focus();
    renderControls();
  }

  function resetGroupForm() {
    state.editingGroupId = "";
    elements.groupName.value = "";
    elements.groupExtensions.value = "";
    elements.groupIsProgram.checked = false;
    elements.groupFormTitle.textContent = "New group";
    elements.groupForm.hidden = true;
  }

  function openNewGroupForm(isProgram) {
    resetGroupForm();
    elements.groupIsProgram.checked = isProgram === true;
    elements.groupFormTitle.textContent = isProgram ? "New program group" : "New group";
    elements.groupForm.hidden = false;
    elements.groupName.focus();
  }

  async function saveGroup() {
    const label = elements.groupName.value.trim();
    const fileTypes = parseExtensions(elements.groupExtensions.value);
    if (!label) {
      setStatus("Name the group first.", "error");
      return;
    }
    if (fileTypes.length === 0) {
      setStatus("A group needs at least one file type.", "error");
      return;
    }

    // Editing keeps the original id so every profile referencing the group
    // follows the change; creating derives a stable id from the label.
    let groupId = state.editingGroupId;
    if (!groupId) {
      const existing = state.groups.find(
        (group) => group.label.toLowerCase() === label.toLowerCase()
      );
      groupId = existing
        ? existing.groupId
        : label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
          || `group-${state.groups.length + 1}`;
    }

    const isProgram = elements.groupIsProgram.checked;
    await runBusy("Saving the file group…", async () => {
      await request("save-file-group", { groupId, label, fileTypes, isProgram });
      await refreshGroups();
      resetGroupForm();
      renderFolders();
      renderGroups();
      renderProgramGroups();
      renderControls();
      setStatus(
        `Saved the ${label} ${isProgram ? "program group" : "group"} (${fileTypes.length} types).`,
        "success"
      );
    });
  }

  async function deleteGroup(group) {
    const accepted = await confirmAction(
      "Delete this file group?",
      `'${group.label}' is removed from every profile that references it.`
    );
    if (!accepted) return;

    await runBusy("Deleting the file group…", async () => {
      await request("delete-file-group", { groupId: group.groupId });
      await refreshGroups();
      state.draftGroupIds = state.draftGroupIds.filter((groupId) => groupId !== group.groupId);
      for (const folder of state.folders) {
        folder.groupIds = (folder.groupIds || []).filter((groupId) => groupId !== group.groupId);
      }
      state.programFolders = state.programFolders.filter((entry) => entry.groupId !== group.groupId);
      renderAll();
      setStatus(`Deleted the ${group.label} group.`, "success");
    });
  }

  // ---------------------------------------------------------------- installing

  async function installButton() {
    if (state.dirty || !state.profileId) {
      await saveProfile(false);
      if (state.dirty || !state.profileId) return;
    }
    const panelName = elements.panelSelect.value;
    if (!panelName) {
      setStatus("Choose a Windows panel first.", "error");
      return;
    }
    await runBusy("Installing the Button…", async () => {
      const staged = await request("stage-generated-button", { profileId: state.profileId });
      if (!staged?.stageToken || !staged?.stagedSourcePath) {
        throw new Error("The generated Button could not be staged.");
      }
      const installed = await request("install-generated-button", {
        stageToken: staged.stageToken,
        stagedSourcePath: staged.stagedSourcePath,
        panelName
      });
      if (installed?.installed !== true) throw new Error("The generated Button was not installed.");
      await refreshInstalled();
      renderInstalled();
      setStatus(`Installed the ${staged.label} Button on ${panelName}.`, "success");
    });
  }

  async function refreshPanels() {
    const result = await request("list-panels", {});
    const panels = Array.isArray(result?.panels) && result.panels.length > 0
      ? result.panels
      : [String(config.defaultPanel || "Files")];
    const fragment = document.createDocumentFragment();
    for (const panel of panels) {
      const option = document.createElement("option");
      option.value = panel;
      option.textContent = panel;
      fragment.append(option);
    }
    elements.panelSelect.replaceChildren(fragment);
    const preferred = String(result?.defaultPanel || config.defaultPanel || "Files");
    if (panels.includes(preferred)) elements.panelSelect.value = preferred;
  }

  // -------------------------------------------------------------------- wiring

  elements.addFolder.addEventListener("click", () => void addFolder(false));
  elements.addSubfolder.addEventListener("click", () => void addFolder(true));
  elements.renameFolder.addEventListener("click", () => void renameFolder());
  elements.deleteFolder.addEventListener("click", () => void deleteFolder());
  elements.loadTree.addEventListener("click", () => void loadTree());
  elements.capEnabled.addEventListener("change", renderControls);

  elements.directTypes.addEventListener("input", () => {
    state.draftTypes = elements.directTypes.value;
  });
  elements.ignoreFolder.addEventListener("change", () => {
    state.draftIgnored = elements.ignoreFolder.checked;
    if (state.draftIgnored) state.draftCatchAll = false;
    renderFilesPanel();
    renderControls();
  });
  elements.catchAllFolder.addEventListener("change", () => {
    state.draftCatchAll = elements.catchAllFolder.checked;
    renderControls();
  });
  elements.applyFiles.addEventListener("click", applyFileAssignments);

  elements.toggleCreateGroup.addEventListener("click", () => {
    const wasHidden = elements.groupForm.hidden;
    if (wasHidden) openNewGroupForm(false);
    else resetGroupForm();
  });
  elements.createProgramGroup.addEventListener("click", () => {
    const alreadyOpenAsProgram =
      !elements.groupForm.hidden && elements.groupIsProgram.checked && !state.editingGroupId;
    if (alreadyOpenAsProgram) resetGroupForm();
    else openNewGroupForm(true);
  });
  elements.saveGroup.addEventListener("click", () => void saveGroup());
  elements.cancelGroup.addEventListener("click", resetGroupForm);

  elements.profileSelect.addEventListener("change", () => {
    const profileId = elements.profileSelect.value;
    if (!profileId) return;
    void loadProfile(profileId);
  });
  elements.profileName.addEventListener("input", renderControls);
  elements.recycleOtherFolders.addEventListener("change", () => {
    if (!elements.recycleOtherFolders.checked) elements.recyclePreviousIgnoredFolders.checked = false;
    markDirty();
  });
  elements.recyclePreviousIgnoredFolders.addEventListener("change", markDirty);
  elements.newProfile.addEventListener("click", newProfile);
  elements.saveProfile.addEventListener("click", () => void saveProfile(false));
  elements.saveProfileAs.addEventListener("click", () => void saveProfileAs());
  elements.deleteProfile.addEventListener("click", () => void deleteProfile());
  elements.installButton.addEventListener("click", () => void installButton());

  elements.promptAccept.addEventListener("click", () => closePrompt(elements.promptInput.value));
  elements.promptCancel.addEventListener("click", () => closePrompt(null));
  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closePrompt(elements.promptInput.value);
    }
  });
  elements.confirmAccept.addEventListener("click", () => closeConfirm(true));
  elements.confirmCancel.addEventListener("click", () => closeConfirm(false));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!elements.promptDialog.hidden) closePrompt(null);
    else if (!elements.confirmDialog.hidden) closeConfirm(false);
  });

  ensureRootFolder();
  void runBusy("Loading Setup Organization…", async () => {
    await refreshGroups();
    await refreshProfiles();
    await refreshPanels();
    await refreshInstalled();
    renderAll();
    setStatus(
      state.profiles.length > 0
        ? "Pick a saved profile, or build a new folder tree."
        : "Build a folder tree, assign file types, then save the profile."
    );
  });
})();
