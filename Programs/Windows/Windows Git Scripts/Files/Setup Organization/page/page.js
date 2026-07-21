(() => {
  "use strict";

  const bridge = window.flowcellPage;
  if (!bridge || typeof bridge.request !== "function") {
    throw new Error("The FlowCell installed-page bridge is unavailable.");
  }

  const descriptor = bridge.descriptor && typeof bridge.descriptor === "object"
    ? bridge.descriptor
    : {};
  const config = descriptor.config && typeof descriptor.config === "object"
    ? descriptor.config
    : {};
  const copy = config.copy && typeof config.copy === "object" ? config.copy : {};

  const elements = {
    rootPath: document.getElementById("root-path"),
    selectRoot: document.getElementById("select-root"),
    scanRoot: document.getElementById("scan-root"),
    scanSummary: document.getElementById("scan-summary"),
    folderList: document.getElementById("folder-list"),
    folderCount: document.getElementById("folder-count"),
    folderPath: document.getElementById("folder-path"),
    createFolder: document.getElementById("create-folder"),
    recycleFolder: document.getElementById("recycle-folder"),
    fileList: document.getElementById("file-list"),
    fileCount: document.getElementById("file-count"),
    profileSelect: document.getElementById("profile-select"),
    loadProfile: document.getElementById("load-profile"),
    newProfile: document.getElementById("new-profile"),
    profileName: document.getElementById("profile-name"),
    profileState: document.getElementById("profile-state"),
    saveProfile: document.getElementById("save-profile"),
    applyProfile: document.getElementById("apply-profile"),
    addRule: document.getElementById("add-rule"),
    rulesList: document.getElementById("rules-list"),
    panelSelect: document.getElementById("panel-select"),
    installProfileButton: document.getElementById("install-profile-button"),
    status: document.getElementById("status"),
    busyIndicator: document.getElementById("busy-indicator"),
    recycleDialog: document.getElementById("recycle-dialog"),
    recycleCopy: document.getElementById("recycle-copy"),
    confirmRecycle: document.getElementById("confirm-recycle"),
    cancelRecycle: document.getElementById("cancel-recycle")
  };

  const state = {
    busy: false,
    scan: null,
    selectedFolder: "",
    profiles: [],
    profileId: "",
    rules: [],
    panels: [typeof config.defaultPanel === "string" ? config.defaultPanel : "Files"],
    panelName: typeof config.defaultPanel === "string" ? config.defaultPanel : "Files",
    pendingRecyclePath: "",
    ownerReady: false
  };

  let ownerWrite = Promise.resolve();
  let ownerWriteTimer = 0;

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function stringValue(value) {
    return typeof value === "string" ? value : "";
  }

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

  function setBusy(busy, message = "") {
    state.busy = busy;
    elements.busyIndicator.dataset.busy = busy ? "true" : "false";
    document.body.setAttribute("aria-busy", busy ? "true" : "false");
    if (message) setStatus(message);
    updateControls();
  }

  function updateControls() {
    const hasRoot = Boolean(elements.rootPath.value.trim());
    const exactFolder = elements.folderPath.value.trim();
    const hasSavedProfile = Boolean(state.profileId);
    elements.selectRoot.disabled = state.busy;
    elements.scanRoot.disabled = state.busy || !hasRoot;
    elements.createFolder.disabled = state.busy || !hasRoot || !exactFolder || exactFolder === ".";
    elements.recycleFolder.disabled = state.busy || !hasRoot || !exactFolder || exactFolder === ".";
    elements.loadProfile.disabled = state.busy || !elements.profileSelect.value;
    elements.newProfile.disabled = state.busy;
    elements.saveProfile.disabled = state.busy || !elements.profileName.value.trim();
    elements.applyProfile.disabled = state.busy || !hasRoot || !hasSavedProfile;
    elements.addRule.disabled = state.busy;
    elements.installProfileButton.disabled = state.busy || !hasSavedProfile || !state.panelName;
  }

  async function runBusy(message, operation) {
    if (state.busy) return null;
    setBusy(true, message);
    try {
      return await operation();
    } catch (error) {
      setStatus(formatError(error), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function ownerStateSnapshot() {
    return {
      lastRootPath: elements.rootPath.value.trim(),
      selectedProfileId: state.profileId,
      generatedPanelName: state.panelName,
      draftProfileName: elements.profileName.value.trim()
    };
  }

  function persistOwnerState(delay = 0) {
    if (!state.ownerReady) return;
    window.clearTimeout(ownerWriteTimer);
    ownerWriteTimer = window.setTimeout(() => {
      const snapshot = ownerStateSnapshot();
      ownerWrite = ownerWrite
        .catch(() => undefined)
        .then(() => request("write-owner-state", { state: snapshot }))
        .catch((error) => setStatus(`Preferences were not saved: ${formatError(error)}`, "error"));
    }, delay);
  }

  function emptyMessage(container, message) {
    const paragraph = document.createElement("p");
    paragraph.className = "empty-state";
    paragraph.textContent = message;
    container.replaceChildren(paragraph);
  }

  function renderScan() {
    const folders = Array.isArray(state.scan?.folders) ? state.scan.folders : [];
    const files = Array.isArray(state.scan?.files) ? state.scan.files : [];
    elements.folderCount.textContent = String(folders.length);
    elements.fileCount.textContent = String(files.length);
    elements.scanSummary.textContent = state.scan
      ? `${folders.length} folders · ${files.length} loose files`
      : "Not scanned";

    if (folders.length === 0) {
      emptyMessage(elements.folderList, stringValue(copy.emptyFolders) || "No folders found.");
    } else {
      const fragment = document.createDocumentFragment();
      folders.forEach((folder) => {
        const relativePath = stringValue(folder.relativePath);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "list-row";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", state.selectedFolder === relativePath ? "true" : "false");
        button.textContent = relativePath;
        button.addEventListener("click", () => {
          state.selectedFolder = relativePath;
          elements.folderPath.value = relativePath === "." ? "" : relativePath;
          renderScan();
          updateControls();
        });
        fragment.append(button);
      });
      elements.folderList.replaceChildren(fragment);
    }

    if (files.length === 0) {
      emptyMessage(elements.fileList, stringValue(copy.emptyFiles) || "No loose files at the selected root.");
    } else {
      const fragment = document.createDocumentFragment();
      files.forEach((file) => {
        const row = document.createElement("div");
        row.className = "list-row file-row";
        row.setAttribute("role", "listitem");
        const name = document.createElement("span");
        name.textContent = stringValue(file.name);
        const meta = document.createElement("span");
        meta.className = "file-meta";
        meta.textContent = `${stringValue(file.extension) || "no extension"} · ${formatBytes(file.size)}`;
        row.append(name, meta);
        fragment.append(row);
      });
      elements.fileList.replaceChildren(fragment);
    }
  }

  function formatBytes(value) {
    const size = typeof value === "number" && Number.isFinite(value) ? value : 0;
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function renderProfiles() {
    const previous = state.profileId || elements.profileSelect.value;
    const fragment = document.createDocumentFragment();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.profiles.length
      ? "Choose a saved profile"
      : stringValue(copy.emptyProfiles) || "No saved profiles yet";
    fragment.append(placeholder);
    state.profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = stringValue(profile.profileId);
      option.textContent = `${stringValue(profile.name)} (${Number(profile.ruleCount) || 0})`;
      fragment.append(option);
    });
    elements.profileSelect.replaceChildren(fragment);
    if (state.profiles.some((profile) => profile.profileId === previous)) {
      elements.profileSelect.value = previous;
    }
    updateControls();
  }

  function newRuleId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function parseExtensions(value) {
    return [...new Set(value
      .split(/[,;\s]+/)
      .map((entry) => entry.trim().toLocaleLowerCase("en"))
      .filter(Boolean)
      .map((entry) => entry.startsWith(".") ? entry : `.${entry}`))]
      .sort();
  }

  function field(labelText, value, onInput, options = {}) {
    const label = document.createElement("label");
    label.className = `field${options.wide ? " wide" : ""}`;
    const labelSpan = document.createElement("span");
    labelSpan.textContent = labelText;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = options.placeholder || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("input", () => onInput(input.value));
    label.append(labelSpan, input);
    return label;
  }

  function renderRules() {
    if (state.rules.length === 0) {
      emptyMessage(elements.rulesList, stringValue(copy.emptyRules) || "Add a folder rule.");
      return;
    }
    const fragment = document.createDocumentFragment();
    state.rules.forEach((rule, index) => {
      const card = document.createElement("article");
      card.className = "rule-card";
      card.append(
        field("Rule name", rule.name, (value) => { rule.name = value; }),
        field("Target folder", rule.targetFolder, (value) => { rule.targetFolder = value; }, {
          placeholder: state.selectedFolder && state.selectedFolder !== "." ? state.selectedFolder : "Images"
        }),
        field("Extensions", rule.extensions.join(", "), (value) => { rule.extensions = parseExtensions(value); }, {
          wide: true,
          placeholder: ".png, .jpg, .webp"
        }),
        field("Filename contains", rule.nameContains, (value) => { rule.nameContains = value; }, {
          wide: true,
          placeholder: "Optional fragment"
        })
      );

      const flags = document.createElement("div");
      flags.className = "rule-flags";
      const enabledLabel = document.createElement("label");
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = rule.enabled;
      enabled.addEventListener("change", () => { rule.enabled = enabled.checked; });
      enabledLabel.append(enabled, document.createTextNode("Enabled"));
      const allLabel = document.createElement("label");
      const matchAll = document.createElement("input");
      matchAll.type = "checkbox";
      matchAll.checked = rule.matchAll;
      matchAll.addEventListener("change", () => { rule.matchAll = matchAll.checked; });
      allLabel.append(matchAll, document.createTextNode("Match all"));
      flags.append(enabledLabel, allLabel);

      const actions = document.createElement("div");
      actions.className = "rule-actions";
      const useFolder = smallButton("Use selected", () => {
        if (state.selectedFolder && state.selectedFolder !== ".") {
          rule.targetFolder = state.selectedFolder;
          renderRules();
        }
      });
      useFolder.disabled = !state.selectedFolder || state.selectedFolder === ".";
      const up = smallButton("↑", () => moveRule(index, -1));
      up.disabled = index === 0;
      up.setAttribute("aria-label", "Move rule up");
      const down = smallButton("↓", () => moveRule(index, 1));
      down.disabled = index === state.rules.length - 1;
      down.setAttribute("aria-label", "Move rule down");
      const remove = smallButton("Remove", () => {
        state.rules.splice(index, 1);
        renderRules();
      }, "danger");
      actions.append(useFolder, up, down, remove);
      card.append(flags, actions);
      fragment.append(card);
    });
    elements.rulesList.replaceChildren(fragment);
  }

  function smallButton(text, onClick, tone = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${tone}`;
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function moveRule(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= state.rules.length) return;
    const [rule] = state.rules.splice(index, 1);
    state.rules.splice(target, 0, rule);
    renderRules();
  }

  function renderPanels() {
    const fragment = document.createDocumentFragment();
    state.panels.forEach((panelName) => {
      const option = document.createElement("option");
      option.value = panelName;
      option.textContent = panelName;
      fragment.append(option);
    });
    elements.panelSelect.replaceChildren(fragment);
    if (state.panels.includes(state.panelName)) {
      elements.panelSelect.value = state.panelName;
    } else {
      state.panelName = state.panels[0] || "";
      elements.panelSelect.value = state.panelName;
    }
    updateControls();
  }

  function applyLoadedProfile(profile) {
    if (!isRecord(profile)) throw new Error("The saved profile response is invalid.");
    state.profileId = stringValue(profile.profileId);
    elements.profileName.value = stringValue(profile.name);
    state.rules = Array.isArray(profile.rules)
      ? profile.rules.map((rule) => ({
          ruleId: stringValue(rule.ruleId),
          name: stringValue(rule.name),
          targetFolder: stringValue(rule.targetFolder),
          extensions: Array.isArray(rule.extensions) ? rule.extensions.map(stringValue) : [],
          nameContains: stringValue(rule.nameContains),
          matchAll: rule.matchAll === true,
          enabled: rule.enabled === true
        }))
      : [];
    elements.profileSelect.value = state.profileId;
    elements.profileState.textContent = "Saved";
    renderRules();
    updateControls();
    persistOwnerState();
  }

  async function recycleLegacySidecars(rootPath) {
    const result = await request("recycle-legacy-sidecars", { rootPath });
    return Array.isArray(result?.recycledPaths) ? result.recycledPaths : [];
  }

  async function scanRoot(successMessage = "Root scanned.") {
    const rootPath = elements.rootPath.value.trim();
    if (!rootPath) {
      setStatus("Choose or enter an absolute root path first.", "error");
      return;
    }
    await runBusy("Scanning folders and loose files…", async () => {
      const recycledPaths = await recycleLegacySidecars(rootPath);
      const result = await request("scan-root", { rootPath });
      state.scan = isRecord(result) ? result : null;
      elements.rootPath.value = stringValue(result.rootPath) || rootPath;
      if (state.selectedFolder && !result.folders.some((folder) => folder.relativePath === state.selectedFolder)) {
        state.selectedFolder = "";
        elements.folderPath.value = "";
      }
      renderScan();
      persistOwnerState();
      setStatus(
        recycledPaths.length
          ? `${successMessage} Recycled ${recycledPaths.length} exact legacy sidecar${recycledPaths.length === 1 ? "" : "s"}.`
          : successMessage,
        "success"
      );
    });
  }

  async function listProfiles() {
    const result = await request("list-profiles", {});
    state.profiles = Array.isArray(result?.profiles) ? result.profiles : [];
    renderProfiles();
  }

  async function loadProfile(profileId = elements.profileSelect.value) {
    if (!profileId) return;
    await runBusy("Loading saved profile…", async () => {
      const result = await request("load-profile", { profileId });
      applyLoadedProfile(result.profile);
      setStatus(`Loaded ${result.profile.name}.`, "success");
    });
  }

  function validateRules() {
    return state.rules.map((rule, index) => {
      const position = index + 1;
      const name = rule.name.trim();
      const targetFolder = rule.targetFolder.trim();
      const nameContains = rule.nameContains.trim();
      const extensions = parseExtensions(rule.extensions.join(","));
      if (!name) throw new Error(`Rule ${position} needs a name.`);
      if (!targetFolder || targetFolder === ".") throw new Error(`Rule ${position} needs a target folder below the root.`);
      if (!rule.matchAll && extensions.length === 0 && !nameContains) {
        throw new Error(`Rule ${position} needs extensions, a filename fragment, or Match all.`);
      }
      return {
        ruleId: rule.ruleId,
        name,
        targetFolder,
        extensions,
        nameContains,
        matchAll: rule.matchAll,
        enabled: rule.enabled
      };
    });
  }

  async function saveProfile() {
    const name = elements.profileName.value.trim();
    if (!name) {
      setStatus("Enter a profile name.", "error");
      return;
    }
    await runBusy("Saving profile to shared Windows data…", async () => {
      const rules = validateRules();
      const result = await request("save-profile", {
        profileId: state.profileId,
        name,
        rules
      });
      applyLoadedProfile(result.profile);
      await listProfiles();
      elements.profileSelect.value = state.profileId;
      setStatus(`Saved ${result.profile.name}.`, "success");
    });
  }

  async function applyProfile() {
    const rootPath = elements.rootPath.value.trim();
    if (!state.profileId || !rootPath) return;
    await runBusy("Applying saved profile to loose root files…", async () => {
      await recycleLegacySidecars(rootPath);
      const result = await request("apply-profile", { profileId: state.profileId, rootPath });
      await scanRootAfterNestedBusy(result);
      setStatus(
        `Applied profile: ${result.moved} moved, ${result.skipped} skipped, ${result.unmatched} unmatched.`,
        "success"
      );
    });
  }

  async function scanRootAfterNestedBusy(applyResult) {
    const result = await request("scan-root", { rootPath: applyResult.rootPath });
    state.scan = isRecord(result) ? result : null;
    renderScan();
  }

  async function createFolder() {
    const rootPath = elements.rootPath.value.trim();
    const relativePath = elements.folderPath.value.trim();
    if (!rootPath || !relativePath || relativePath === ".") return;
    await runBusy("Creating the exact folder…", async () => {
      await recycleLegacySidecars(rootPath);
      const result = await request("create-folder", { rootPath, relativePath });
      await scanRootAfterNestedBusy({ rootPath });
      state.selectedFolder = result.relativePath;
      elements.folderPath.value = result.relativePath;
      renderScan();
      setStatus(result.created ? `Created ${result.relativePath}.` : `${result.relativePath} already exists.`, "success");
    });
  }

  function openRecycleDialog() {
    const relativePath = elements.folderPath.value.trim();
    if (!relativePath || relativePath === ".") return;
    state.pendingRecyclePath = relativePath;
    elements.recycleCopy.textContent = `“${relativePath}” and everything inside it will be sent to the Windows Recycle Bin.`;
    elements.recycleDialog.hidden = false;
    elements.confirmRecycle.focus();
  }

  function closeRecycleDialog() {
    state.pendingRecyclePath = "";
    elements.recycleDialog.hidden = true;
    elements.recycleFolder.focus();
  }

  async function confirmRecycleFolder() {
    const rootPath = elements.rootPath.value.trim();
    const relativePath = state.pendingRecyclePath;
    elements.recycleDialog.hidden = true;
    if (!rootPath || !relativePath) return;
    await runBusy("Sending the exact folder to the Recycle Bin…", async () => {
      const result = await request("recycle-folder", { rootPath, relativePath });
      state.pendingRecyclePath = "";
      state.selectedFolder = "";
      elements.folderPath.value = "";
      await scanRootAfterNestedBusy({ rootPath });
      setStatus(`Recycled ${result.relativePath}.`, "success");
    });
  }

  async function installProfileButton() {
    if (!state.profileId || !state.panelName) return;
    await runBusy("Staging the generated profile Button…", async () => {
      const stage = await request("stage-generated-button", { profileId: state.profileId });
      setStatus(`Installing ${stage.label} into Windows / ${state.panelName}…`);
      const installed = await request("install-generated-button", {
        stageToken: stage.stageToken,
        stagedSourcePath: stage.stagedSourcePath,
        panelName: state.panelName
      });
      setStatus(`Installed ${stage.label} in Windows / ${installed.panelName}.`, "success");
    });
  }

  function resetProfile() {
    state.profileId = "";
    state.rules = [];
    elements.profileSelect.value = "";
    elements.profileName.value = "";
    elements.profileState.textContent = "New";
    renderRules();
    updateControls();
    persistOwnerState();
    setStatus("Started a new unsaved profile.");
  }

  function addRule() {
    state.rules.push({
      ruleId: newRuleId(),
      name: `Rule ${state.rules.length + 1}`,
      targetFolder: state.selectedFolder && state.selectedFolder !== "." ? state.selectedFolder : "",
      extensions: [],
      nameContains: "",
      matchAll: false,
      enabled: true
    });
    renderRules();
  }

  async function initialize() {
    renderScan();
    renderRules();
    updateControls();
    setBusy(true, "Loading Setup Organization…");
    try {
      const [ownerResult, profileResult, panelResult] = await Promise.all([
        request("read-owner-state", {}),
        request("list-profiles", {}),
        request("list-panels", {})
      ]);
      const owner = isRecord(ownerResult?.state) ? ownerResult.state : {};
      elements.rootPath.value = stringValue(owner.lastRootPath);
      elements.profileName.value = stringValue(owner.draftProfileName);
      state.profiles = Array.isArray(profileResult?.profiles) ? profileResult.profiles : [];
      state.panels = Array.isArray(panelResult?.panels)
        ? panelResult.panels.map(stringValue).filter(Boolean)
        : state.panels;
      const rememberedPanel = stringValue(owner.generatedPanelName);
      state.panelName = state.panels.includes(rememberedPanel)
        ? rememberedPanel
        : stringValue(panelResult?.defaultPanel) || state.panels[0] || "Files";
      renderProfiles();
      renderPanels();
      const rememberedProfile = stringValue(owner.selectedProfileId);
      state.ownerReady = true;
      if (state.profiles.some((profile) => profile.profileId === rememberedProfile)) {
        elements.profileSelect.value = rememberedProfile;
        const loaded = await request("load-profile", { profileId: rememberedProfile });
        applyLoadedProfile(loaded.profile);
      }
      setStatus(elements.rootPath.value ? "Root preference restored. Scan when ready." : "Choose a root folder to begin.");
    } catch (error) {
      state.ownerReady = true;
      setStatus(formatError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  elements.selectRoot.addEventListener("click", async () => {
    await runBusy("Opening the Windows folder picker…", async () => {
      const result = await request("select-root", {});
      if (!result.selected) {
        setStatus("Folder selection cancelled.");
        return;
      }
      elements.rootPath.value = stringValue(result.path);
      state.scan = null;
      state.selectedFolder = "";
      elements.folderPath.value = "";
      renderScan();
      persistOwnerState();
      const recycledPaths = await recycleLegacySidecars(elements.rootPath.value);
      setStatus(
        recycledPaths.length
          ? `Folder selected. Recycled ${recycledPaths.length} exact legacy sidecar${recycledPaths.length === 1 ? "" : "s"}. Scan when ready.`
          : "Folder selected. Scan when ready.",
        "success"
      );
    });
  });
  elements.scanRoot.addEventListener("click", () => { void scanRoot(); });
  elements.rootPath.addEventListener("input", () => {
    state.scan = null;
    state.selectedFolder = "";
    renderScan();
    updateControls();
    persistOwnerState(350);
  });
  elements.folderPath.addEventListener("input", updateControls);
  elements.createFolder.addEventListener("click", () => { void createFolder(); });
  elements.recycleFolder.addEventListener("click", openRecycleDialog);
  elements.confirmRecycle.addEventListener("click", () => { void confirmRecycleFolder(); });
  elements.cancelRecycle.addEventListener("click", closeRecycleDialog);
  elements.recycleDialog.addEventListener("click", (event) => {
    if (event.target === elements.recycleDialog) closeRecycleDialog();
  });
  elements.profileSelect.addEventListener("change", () => {
    if (elements.profileSelect.value) void loadProfile(elements.profileSelect.value);
  });
  elements.loadProfile.addEventListener("click", () => { void loadProfile(); });
  elements.newProfile.addEventListener("click", resetProfile);
  elements.profileName.addEventListener("input", () => {
    elements.profileState.textContent = state.profileId ? "Edited" : "New";
    updateControls();
    persistOwnerState(350);
  });
  elements.saveProfile.addEventListener("click", () => { void saveProfile(); });
  elements.applyProfile.addEventListener("click", () => { void applyProfile(); });
  elements.addRule.addEventListener("click", addRule);
  elements.panelSelect.addEventListener("change", () => {
    state.panelName = elements.panelSelect.value;
    updateControls();
    persistOwnerState();
  });
  elements.installProfileButton.addEventListener("click", () => { void installProfileButton(); });

  void initialize();
})();
