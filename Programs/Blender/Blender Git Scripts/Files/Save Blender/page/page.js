(() => {
  "use strict";

  const pageRoot = document.querySelector(".save-page");
  const summaryNode = document.getElementById("save-summary");
  const statusNode = document.getElementById("save-status");
  const savedPanel = document.getElementById("saved-panel");
  const savedHeading = savedPanel?.querySelector("h2");
  const savedPathNode = document.getElementById("saved-path");
  const projectForm = document.getElementById("project-form");
  const saveModeInputs = Array.from(document.querySelectorAll('input[name="saveMode"]'));
  const projectNameLabel = document.getElementById("project-name-label");
  const projectNameInput = document.getElementById("project-name");
  const parentFolderInput = document.getElementById("parent-folder");
  const profileSelect = document.getElementById("profile-select");
  const settingsPanel = document.getElementById("settings-panel");
  const existingProjectPanel = document.getElementById("existing-project-panel");
  const existingProjectFolderInput = document.getElementById("existing-project-folder");
  const browseParentButton = document.getElementById("browse-parent");
  const browseExistingProjectButton = document.getElementById("browse-existing-project");
  const saveProjectButton = document.getElementById("save-project");
  const changeSettingsButton = document.getElementById("change-settings");
  const pageApi = window.flowcellPage;

  function objectRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "Unknown error.");
  }

  function setStatus(message, kind = "info") {
    if (!statusNode) return;
    statusNode.textContent = String(message || "");
    statusNode.dataset.kind = kind;
  }

  if (
    !pageRoot ||
    !summaryNode ||
    !savedPanel ||
    !savedHeading ||
    !savedPathNode ||
    !projectForm ||
    saveModeInputs.length !== 2 ||
    !projectNameLabel ||
    !projectNameInput ||
    !parentFolderInput ||
    !profileSelect ||
    !settingsPanel ||
    !existingProjectPanel ||
    !existingProjectFolderInput ||
    !browseParentButton ||
    !browseExistingProjectButton ||
    !saveProjectButton ||
    !changeSettingsButton ||
    !pageApi ||
    typeof pageApi.request !== "function"
  ) {
    setStatus("The FlowCell page bridge is unavailable. Close and reopen this Button.", "error");
    return;
  }

  const configuredActions = objectRecord(objectRecord(pageApi.descriptor)?.config)?.actions;
  const actions = {
    stateRead: configuredActions?.stateRead || "owner-state.read",
    stateWrite: configuredActions?.stateWrite || "owner-state.write",
    selectParentFolder: configuredActions?.selectParentFolder || "parent-folder.select",
    selectExistingProjectFolder:
      configuredActions?.selectExistingProjectFolder || "existing-project-folder.select",
    listProfiles: configuredActions?.listProfiles || "profile.list",
    status: configuredActions?.status || "project.status",
    saveCurrent: configuredActions?.saveCurrent || "project.save-current",
    createRoot: configuredActions?.createRoot || "project.create-root",
    prepareTarget: configuredActions?.prepareTarget || "project.prepare-target",
    saveTarget: configuredActions?.saveTarget || "project.save-target",
    prepareExistingTarget:
      configuredActions?.prepareExistingTarget || "project.prepare-existing-target",
    saveExistingTarget:
      configuredActions?.saveExistingTarget || "project.save-existing-target"
  };

  const settings = {
    baseFolder: "",
    profileId: ""
  };
  let profiles = [];
  let settingsExpanded = true;
  let saveMode = "new";
  let existingProjectRoot = "";
  let busy = false;
  let preparedAttempt = null;

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    pageRoot.setAttribute("aria-busy", String(busy));
    pageRoot.querySelectorAll("button, input, select").forEach((control) => {
      control.disabled = busy;
    });
  }

  function renderProfiles() {
    profileSelect.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No organization profile";
    profileSelect.append(none);

    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.profileId;
      option.textContent = profile.name;
      profileSelect.append(option);
    }
    profileSelect.value = profiles.some((profile) => profile.profileId === settings.profileId)
      ? settings.profileId
      : "";
  }

  function syncSettings() {
    parentFolderInput.value = settings.baseFolder;
    renderProfiles();
    const configured = Boolean(settings.baseFolder);
    const addingToExistingProject = saveMode === "existing";
    settingsPanel.hidden = configured && !settingsExpanded;
    changeSettingsButton.hidden = !configured || settingsExpanded;
    if (addingToExistingProject) {
      settingsPanel.hidden = true;
      changeSettingsButton.hidden = true;
    }
    existingProjectPanel.hidden = !addingToExistingProject;
    projectNameLabel.textContent = addingToExistingProject ? "Blender file name" : "Project name";
    projectNameInput.placeholder = addingToExistingProject ? "My Blender file" : "My project";
    saveProjectButton.textContent = addingToExistingProject ? "Add Blender File" : "Save";
    for (const input of saveModeInputs) {
      input.checked = input.value === saveMode;
    }
  }

  function syncUntitledSummary() {
    if (projectForm.hidden) return;
    if (saveMode === "existing") {
      summaryNode.textContent = "Name this Blender file and choose the existing project it belongs to.";
      return;
    }
    summaryNode.textContent = settings.baseFolder
      ? "Name this project, or change the saved destination settings."
      : "Choose the project name and where new Blender projects should be created.";
  }

  function normalizedState(value) {
    const state = objectRecord(value) || {};
    const legacyProfilePath = typeof state.profilePath === "string" ? state.profilePath.trim() : "";
    const legacyProfileMatch = legacyProfilePath.match(
      /(?:^|[\\/])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i
    );
    return {
      baseFolder: typeof state.baseFolder === "string" ? state.baseFolder.trim() : "",
      profileId: typeof state.profileId === "string" && state.profileId.trim()
        ? state.profileId.trim().toLocaleLowerCase("en")
        : (legacyProfileMatch?.[1] || "").toLocaleLowerCase("en")
    };
  }

  async function writeSettings() {
    await pageApi.request(actions.stateWrite, {
      state: {
        schemaVersion: 1,
        baseFolder: settings.baseFolder,
        profileId: settings.profileId
      }
    });
  }

  async function chooseParentFolder() {
    if (busy) return;
    setBusy(true);
    setStatus("Choosing the parent folder…");
    try {
      const response = objectRecord(await pageApi.request(actions.selectParentFolder, {})) || {};
      if (response.selected === true && typeof response.path === "string" && response.path.trim()) {
        settings.baseFolder = response.path.trim();
        await writeSettings();
        syncSettings();
        setStatus("Parent folder saved.", "success");
      } else {
        setStatus("Parent folder selection cancelled.");
      }
    } catch (error) {
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function chooseExistingProjectFolder() {
    if (busy) return;
    setBusy(true);
    setStatus("Choosing an existing project folder…");
    try {
      const response = objectRecord(
        await pageApi.request(actions.selectExistingProjectFolder, {})
      ) || {};
      if (response.selected === true && typeof response.path === "string" && response.path.trim()) {
        existingProjectRoot = response.path.trim();
        existingProjectFolderInput.value = existingProjectRoot;
        setStatus("Existing project folder selected.", "success");
      } else {
        setStatus("Existing project folder selection cancelled.");
      }
    } catch (error) {
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function changeSaveMode(nextMode) {
    if (busy || (nextMode !== "new" && nextMode !== "existing")) return;
    if (saveMode !== nextMode) {
      saveMode = nextMode;
      preparedAttempt = null;
    }
    syncSettings();
    syncUntitledSummary();
    if (saveMode === "existing") {
      setStatus(
        existingProjectRoot ? "Ready to add a Blender file." : "Choose an existing project folder to continue."
      );
    } else {
      setStatus(settings.baseFolder ? "Ready to save a new Blender project." : "Choose a parent folder to continue.");
    }
    projectNameInput.focus();
  }

  async function refreshProfiles() {
    try {
      const response = objectRecord(await pageApi.request(actions.listProfiles, {})) || {};
      profiles = (Array.isArray(response.profiles) ? response.profiles : [])
        .map((profile) => objectRecord(profile))
        .filter((profile) => profile && typeof profile.profileId === "string" && typeof profile.name === "string")
        .map((profile) => ({
          profileId: profile.profileId.trim().toLocaleLowerCase("en"),
          name: profile.name.trim()
        }))
        .filter((profile) => profile.profileId && profile.name);
    } catch (error) {
      profiles = [];
      settings.profileId = "";
      return `Organization profiles could not be loaded: ${errorMessage(error)} Direct save is still available.`;
    }

    if (settings.profileId && !profiles.some((profile) => profile.profileId === settings.profileId)) {
      settings.profileId = "";
      return "The previously selected organization profile no longer exists. Choose another profile or save directly.";
    }
    return "";
  }

  async function changeProfile() {
    if (busy) return;
    const selectedProfileId = profileSelect.value.trim().toLocaleLowerCase("en");
    setBusy(true);
    try {
      settings.profileId = selectedProfileId;
      preparedAttempt = null;
      await writeSettings();
      syncSettings();
      const selected = profiles.find((profile) => profile.profileId === settings.profileId);
      setStatus(
        selected ? `Organization profile set to ${selected.name}.` : "Organization profile cleared.",
        "success"
      );
    } catch (error) {
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function sanitizeProjectName(value) {
    let name = String(value || "")
      .replace(/\s+/gu, "")
      .replace(/[<>:"/\\|?*]|[\u0000-\u001f]/g, "")
      .replace(/\.+$/g, "");
    name = Array.from(name).slice(0, 120).join("").replace(/\.+$/g, "");
    if (!name) {
      throw new Error("Enter a name containing at least one valid filename character.");
    }
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
      name = `_${name}`;
    }
    return Array.from(name).slice(0, 120).join("").replace(/\.+$/g, "");
  }

  function joinWindowsPath(folder, leaf) {
    const rawBase = String(folder || "");
    const separator = rawBase.includes("\\") ? "\\" : "/";
    const base = rawBase.replace(/[\\/]+$/, "");
    return `${base}${separator}${leaf}`;
  }

  function comparableWindowsPath(value) {
    return String(value || "")
      .replace(/\//g, "\\")
      .replace(/\\+$/, "")
      .toLocaleLowerCase("en");
  }

  function canReusePreparedAttempt(projectName) {
    return Boolean(
      preparedAttempt &&
      preparedAttempt.projectName === projectName &&
      preparedAttempt.parentFolder === settings.baseFolder &&
      preparedAttempt.profileId === settings.profileId
    );
  }

  function showSaved(path, heading) {
    projectForm.hidden = true;
    savedHeading.textContent = heading;
    savedPathNode.textContent = path;
    savedPanel.hidden = false;
  }

  async function saveNewProject(event) {
    event.preventDefault();
    if (busy) return;

    let projectName;
    try {
      projectName = sanitizeProjectName(projectNameInput.value);
      projectNameInput.value = projectName;
      if (!settings.baseFolder) throw new Error("Choose a parent folder first.");
    } catch (error) {
      setStatus(errorMessage(error), "error");
      return;
    }

    setBusy(true);
    setStatus(settings.profileId ? "Preparing the organized project…" : "Creating the Blender project…");
    try {
      await writeSettings();
      let preparedByProfile = false;
      let projectRoot = "";
      let finalPath = "";

      if (settings.profileId) {
        const requestedProjectRoot = joinWindowsPath(settings.baseFolder, projectName);
        if (canReusePreparedAttempt(projectName)) {
          projectRoot = preparedAttempt.projectRoot;
          finalPath = preparedAttempt.finalPath;
        } else {
          const created = objectRecord(await pageApi.request(actions.createRoot, {
            projectName,
            parentFolder: settings.baseFolder
          })) || {};
          if (
            created.prepared !== true ||
            typeof created.projectRoot !== "string" ||
            !created.projectRoot.trim()
          ) {
            throw new Error("Blender did not return a valid empty project folder.");
          }
          projectRoot = created.projectRoot.trim();
          if (comparableWindowsPath(projectRoot) !== comparableWindowsPath(requestedProjectRoot)) {
            throw new Error("Blender prepared a different project folder than requested.");
          }
          const prepared = objectRecord(await pageApi.request(actions.prepareTarget, {
            projectRoot,
            profileId: settings.profileId
          })) || {};
          if (
            prepared.prepared !== true ||
            typeof prepared.projectRoot !== "string" ||
            !prepared.projectRoot.trim() ||
            prepared.plannedExtension !== ".blend" ||
            typeof prepared.destinationDirectory !== "string" ||
            !prepared.destinationDirectory.trim()
          ) {
            throw new Error("Setup Organization did not return a valid prepared Blender target.");
          }
          projectRoot = prepared.projectRoot.trim();
          finalPath = joinWindowsPath(prepared.destinationDirectory.trim(), `${projectName}.blend`);
          preparedAttempt = {
            projectName,
            parentFolder: settings.baseFolder,
            profileId: settings.profileId,
            projectRoot,
            finalPath
          };
        }
        preparedByProfile = true;
      }

      setStatus("Saving the Blender file…");
      const saved = objectRecord(await pageApi.request(actions.saveTarget, {
        projectName,
        parentFolder: settings.baseFolder,
        preparedByProfile,
        projectRoot,
        finalPath
      })) || {};
      if (saved.saved !== true || typeof saved.finalPath !== "string" || !saved.finalPath.trim()) {
        throw new Error("Blender did not return a saved file path.");
      }

      projectNameInput.value = "";
      preparedAttempt = null;
      summaryNode.textContent = "The current Blender file is saved.";
      showSaved(saved.finalPath.trim(), "Project saved");
      setStatus(typeof saved.message === "string" ? saved.message : "Blender project saved.", "success");
    } catch (error) {
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveExistingProject(event) {
    event.preventDefault();
    if (busy) return;

    let fileName;
    let projectRoot;
    try {
      fileName = sanitizeProjectName(projectNameInput.value);
      projectNameInput.value = fileName;
      projectRoot = existingProjectRoot.trim();
      if (!projectRoot) throw new Error("Choose an existing project folder first.");
    } catch (error) {
      setStatus(errorMessage(error), "error");
      return;
    }

    setBusy(true);
    setStatus("Preparing the existing project target…");
    try {
      const prepared = objectRecord(await pageApi.request(actions.prepareExistingTarget, {
        projectRoot
      })) || {};
      if (
        prepared.prepared !== true ||
        typeof prepared.projectRoot !== "string" ||
        !prepared.projectRoot.trim() ||
        typeof prepared.destinationDirectory !== "string" ||
        !prepared.destinationDirectory.trim()
      ) {
        throw new Error("The existing project did not return a valid Blender destination.");
      }

      const returnedRoot = prepared.projectRoot.trim();
      if (comparableWindowsPath(returnedRoot) !== comparableWindowsPath(projectRoot)) {
        throw new Error("The existing project target resolved to a different project folder.");
      }
      const finalPath = joinWindowsPath(
        prepared.destinationDirectory.trim(),
        `${fileName}.blend`
      );

      setStatus("Saving the Blender file…");
      const saved = objectRecord(await pageApi.request(actions.saveExistingTarget, {
        fileName,
        projectRoot: returnedRoot,
        finalPath
      })) || {};
      if (saved.saved !== true || typeof saved.finalPath !== "string" || !saved.finalPath.trim()) {
        throw new Error("Blender did not return a saved file path.");
      }

      projectNameInput.value = "";
      existingProjectRoot = "";
      existingProjectFolderInput.value = "";
      preparedAttempt = null;
      summaryNode.textContent = "The current Blender file is saved.";
      showSaved(saved.finalPath.trim(), "Blender file added");
      setStatus(typeof saved.message === "string" ? saved.message : "Blender file added to the project.", "success");
    } catch (error) {
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  function submitProject(event) {
    if (saveMode === "existing") {
      void saveExistingProject(event);
      return;
    }
    void saveNewProject(event);
  }

  async function initialize() {
    setBusy(true);
    setStatus("Checking Blender…");
    try {
      const status = objectRecord(await pageApi.request(actions.status, {})) || {};
      if (status.saved === true && typeof status.filePath === "string" && status.filePath.trim()) {
        summaryNode.textContent = "Saving the current Blender file in place…";
        const response = objectRecord(await pageApi.request(actions.saveCurrent, {})) || {};
        if (response.saved !== true || typeof response.finalPath !== "string" || !response.finalPath.trim()) {
          throw new Error("Blender did not confirm the in-place save.");
        }
        summaryNode.textContent = "The current Blender file was saved in place.";
        showSaved(response.finalPath.trim(), "Saved in place");
        setStatus(typeof response.message === "string" ? response.message : "Blender file saved.", "success");
        return;
      }

      const stateResponse = objectRecord(await pageApi.request(actions.stateRead, {})) || {};
      Object.assign(settings, normalizedState(stateResponse.state));
      const profileWarning = await refreshProfiles();
      saveMode = "new";
      existingProjectRoot = "";
      existingProjectFolderInput.value = "";
      settingsExpanded = !settings.baseFolder;
      syncSettings();
      savedPanel.hidden = true;
      projectForm.hidden = false;
      syncUntitledSummary();
      projectNameInput.focus();
      if (profileWarning) {
        setStatus(profileWarning, "error");
      } else {
        setStatus(settings.baseFolder ? "Ready to save a new Blender project." : "Choose a parent folder to continue.");
      }
    } catch (error) {
      summaryNode.textContent = "Save Blender could not complete the request.";
      setStatus(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  browseParentButton.addEventListener("click", () => void chooseParentFolder());
  browseExistingProjectButton.addEventListener("click", () => void chooseExistingProjectFolder());
  for (const input of saveModeInputs) {
    input.addEventListener("change", () => changeSaveMode(input.value));
  }
  profileSelect.addEventListener("change", () => void changeProfile());
  changeSettingsButton.addEventListener("click", () => {
    settingsExpanded = true;
    syncSettings();
    parentFolderInput.focus();
  });
  projectForm.addEventListener("submit", submitProject);

  void initialize();
})();
