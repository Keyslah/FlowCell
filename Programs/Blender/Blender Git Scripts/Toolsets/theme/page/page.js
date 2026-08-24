(() => {
  "use strict";

  const root = document.getElementById("theme-page");
  const statusNode = document.getElementById("theme-status");
  const pageApi = window.flowcellPage;

  function objectRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function setStatus(message, kind = "info") {
    statusNode.textContent = String(message || "");
    statusNode.dataset.kind = kind;
  }

  if (!root || !statusNode || !pageApi || typeof pageApi.request !== "function") {
    if (statusNode) {
      setStatus("The FlowCell page bridge is unavailable.", "error");
    }
    return;
  }

  const descriptor = objectRecord(pageApi.descriptor) || {};
  const config = objectRecord(descriptor.config) || {};
  const copy = objectRecord(config.copy) || {};
  const actions = objectRecord(config.actions) || {};
  const localActions = objectRecord(config.localActions) || {};
  const fieldDefinitions = Array.isArray(config.fields) ? config.fields : [];
  const roles = Array.isArray(config.roles) ? config.roles : [];
  const fieldById = new Map(fieldDefinitions.map((field) => [field.id, field]));
  const controlsByFieldId = new Map();
  const HEX_COLOR = /^#[0-9A-F]{6}$/i;

  const model = {
    fields: Object.fromEntries(fieldDefinitions.map((field) => [field.id, cloneValue(field.defaultValue)])),
    tone: {
      level: finiteNumber(config.tone?.defaultLevel, 0.3),
      profiles: [],
      activeProfileId: "",
      refillVariant: 0
    },
    activePackage: {
      path: "",
      name: ""
    }
  };

  let busy = false;
  let persistenceTimer = 0;

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    const record = objectRecord(value);
    if (record) return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, cloneValue(entry)]));
    return value;
  }

  function finiteNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function bounded(value, minimum = 0, maximum = 1) {
    return Math.max(minimum, Math.min(maximum, finiteNumber(value, minimum)));
  }

  function normalizeHex(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return HEX_COLOR.test(normalized) ? normalized : null;
  }

  function normalizeFieldValue(field, value) {
    if (!field) return value;
    if (field.kind === "color") return normalizeHex(value) || field.defaultValue;
    if (field.kind === "number") {
      const parsed = typeof value === "number" ? value : Number(value);
      const fallback = finiteNumber(field.defaultValue, 0);
      return Number.isFinite(parsed)
        ? Math.max(finiteNumber(field.minimum, -Number.MAX_VALUE), parsed)
        : fallback;
    }
    if (field.kind === "boolean") return Boolean(value);
    if (field.kind === "palette") return normalizePalette(value);
    if (field.kind === "select") {
      const candidate = String(value || "");
      return Array.isArray(field.options) && field.options.some((option) => option.value === candidate)
        ? candidate
        : field.defaultValue;
    }
    return typeof value === "string" ? value : String(value ?? field.defaultValue ?? "");
  }

  function fieldValue(fieldId) {
    return model.fields[fieldId];
  }

  function patchFields(patch, renderAfter = true) {
    const record = objectRecord(patch);
    if (!record) return;
    for (const [fieldId, value] of Object.entries(record)) {
      const field = fieldById.get(fieldId);
      if (field) model.fields[fieldId] = normalizeFieldValue(field, value);
    }
    if (renderAfter) render();
    else syncControls();
    schedulePersistence();
  }

  function pickFields(fieldIds) {
    return Object.fromEntries(
      (Array.isArray(fieldIds) ? fieldIds : [])
        .filter((fieldId) => fieldById.has(fieldId))
        .map((fieldId) => [fieldId, cloneValue(model.fields[fieldId])])
    );
  }

  function stateDocument() {
    return {
      schemaVersion: 1,
      fields: pickFields(fieldDefinitions.map((field) => field.id)),
      tone: cloneValue(model.tone),
      activePackage: cloneValue(model.activePackage)
    };
  }

  function schedulePersistence() {
    window.clearTimeout(persistenceTimer);
    persistenceTimer = window.setTimeout(() => {
      void pageApi.request(actions.state.write, { state: stateDocument() }).catch(() => {});
    }, 180);
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    root.dataset.busy = String(nextBusy);
    root.setAttribute("aria-busy", String(nextBusy));
    root.querySelectorAll("button").forEach((button) => {
      button.disabled = nextBusy;
    });
  }

  function responseMessage(response, fallback) {
    const record = objectRecord(response);
    return typeof record?.message === "string" && record.message.trim()
      ? record.message
      : fallback;
  }

  async function requestAction(actionId, payload, progressMessage) {
    if (busy || typeof actionId !== "string" || !actionId) return null;
    setBusy(true);
    setStatus(progressMessage || copy.working || "Working…");
    try {
      const response = await pageApi.request(actionId, payload || {});
      setStatus(responseMessage(response, copy.complete || "Complete."), "success");
      return objectRecord(response) || {};
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function actionLabel(actionId) {
    return objectRecord(config.actionLabels)?.[actionId] || actionId;
  }

  function actionTooltip(actionId) {
    return objectRecord(config.actionTooltips)?.[actionId] || "";
  }

  function actionButton(actionId, handler, tooltipOverride = "") {
    const button = element("button", "", actionLabel(actionId));
    button.type = "button";
    const tooltip = tooltipOverride || actionTooltip(actionId);
    if (tooltip) button.title = tooltip;
    button.addEventListener("click", () => void handler());
    return button;
  }

  function registerControl(fieldId, control) {
    const controls = controlsByFieldId.get(fieldId) || [];
    controls.push(control);
    controlsByFieldId.set(fieldId, controls);
  }

  function writeControlValue(control, field) {
    const value = model.fields[field.id];
    if (field.kind === "boolean") control.checked = Boolean(value);
    else if (field.kind === "palette") return;
    else control.value = String(value ?? "");
  }

  function syncControls() {
    for (const [fieldId, controls] of controlsByFieldId.entries()) {
      const field = fieldById.get(fieldId);
      if (!field) continue;
      controls.forEach((control) => writeControlValue(control, field));
    }
  }

  function updateFieldFromControl(field, control) {
    const value = field.kind === "boolean" ? control.checked : control.value;
    model.fields[field.id] = normalizeFieldValue(field, value);
    syncControls();
    schedulePersistence();
  }

  function inputForField(field, inputType) {
    const input = document.createElement("input");
    input.type = inputType || (field.kind === "number" ? "number" : field.kind === "color" ? "color" : "text");
    if (field.step !== undefined) input.step = String(field.step);
    if (field.minimum !== undefined) input.min = String(field.minimum);
    if (field.placeholder) input.placeholder = field.placeholder;
    writeControlValue(input, field);
    registerControl(field.id, input);
    input.addEventListener(field.kind === "color" || input.type === "range" ? "input" : "change", () => {
      updateFieldFromControl(field, input);
    });
    return input;
  }

  function labeledField(field, className = "") {
    const label = element("label", `theme-field ${className}`.trim());
    label.append(element("span", "", field.label), inputForField(field));
    return label;
  }

  function makeCard(title) {
    const section = element("section", "theme-card");
    const heading = element("div", "theme-card__heading");
    heading.append(element("h2", "", title));
    section.append(heading);
    return { section, heading };
  }

  function hexChannelToLinear(value) {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }

  function hexLuminance(value) {
    const normalized = normalizeHex(value);
    if (!normalized) return 0;
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    return 0.2126 * hexChannelToLinear(red) +
      0.7152 * hexChannelToLinear(green) +
      0.0722 * hexChannelToLinear(blue);
  }

  function rgbToHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
  }

  function shiftHexToLuminance(value, target) {
    const normalized = normalizeHex(value);
    if (!normalized) return value;
    const source = [
      Number.parseInt(normalized.slice(1, 3), 16),
      Number.parseInt(normalized.slice(3, 5), 16),
      Number.parseInt(normalized.slice(5, 7), 16)
    ];
    const boundedTarget = bounded(target);
    const sourceLuminance = hexLuminance(normalized);
    if (Math.abs(sourceLuminance - boundedTarget) <= 0.006) return normalized;
    const destination = boundedTarget > sourceLuminance ? 255 : 0;
    let low = 0;
    let high = 1;
    let best = normalized;
    let bestDistance = Math.abs(sourceLuminance - boundedTarget);
    for (let index = 0; index < 18; index += 1) {
      const amount = (low + high) / 2;
      const candidate = rgbToHex(
        source[0] + (destination - source[0]) * amount,
        source[1] + (destination - source[1]) * amount,
        source[2] + (destination - source[2]) * amount
      );
      const luminance = hexLuminance(candidate);
      const distance = Math.abs(luminance - boundedTarget);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
      if (boundedTarget > sourceLuminance) {
        if (luminance < boundedTarget) low = amount;
        else high = amount;
      } else if (luminance > boundedTarget) low = amount;
      else high = amount;
    }
    return best;
  }

  function normalizePalette(value) {
    const candidates = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[;,\s]+/)
        : [];
    return Array.from(new Set(candidates.map(normalizeHex).filter(Boolean)))
      .sort((left, right) => hexLuminance(left) - hexLuminance(right));
  }

  function usablePalette() {
    const paletteFieldId = config.palette?.fieldId;
    const configured = normalizePalette(model.fields[paletteFieldId]);
    const fallback = normalizePalette(config.palette?.defaultValue || []);
    const normalized = configured.length ? configured : fallback;
    const chromatic = normalized.filter((hex) => hex !== "#000000" && hex !== "#FFFFFF");
    return chromatic.length >= 2 ? chromatic : normalized;
  }

  function nearestPaletteColor(palette, target, offset) {
    const ranked = [...palette].sort((left, right) => {
      const distance = Math.abs(hexLuminance(left) - target) - Math.abs(hexLuminance(right) - target);
      return distance || left.localeCompare(right);
    });
    return ranked[offset % ranked.length] || "#808080";
  }

  function stableNoise(key) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  function tonePatch({ mode, level, targets, refillVariant }) {
    const palette = usablePalette();
    const boundedLevel = bounded(level);
    const resolvedMode = mode === "light" ? "light" : "dark";
    const patch = { [config.tone.visualModeFieldId]: resolvedMode };
    const textHex = resolvedMode === "light"
      ? "#000000"
      : shiftHexToLuminance(palette.at(-1) || "#FFFFFF", 0.92);
    roles.forEach((role, index) => {
      let value;
      if (refillVariant !== undefined) {
        const darkTarget = role.tone === "text" ? 0.86 : finiteNumber(role.tone?.dark, 0.04 + (index % 4) * 0.025);
        const lightTarget = role.tone === "text" ? 0.04 : finiteNumber(role.tone?.light, 0.22 + (index % 4) * 0.04);
        const baseTarget = darkTarget + boundedLevel * (lightTarget - darkTarget);
        const jitterScale = role.tone === "text" ? 0.035 : resolvedMode === "light" ? 0.08 : 0.06;
        const jitter = (stableNoise(`${role.id}:${Math.trunc(refillVariant)}`) - 0.5) * jitterScale;
        const target = bounded(baseTarget + jitter, 0.01, 0.96);
        const source = nearestPaletteColor(palette, target, Math.abs(Math.trunc(refillVariant)) + index);
        value = resolvedMode === "light" && role.tone === "text"
          ? "#000000"
          : shiftHexToLuminance(source, target);
      } else if (role.tone === "text") value = textHex;
      else {
        const darkTarget = finiteNumber(role.tone?.dark, 0.04 + (index % 4) * 0.025);
        const lightTarget = finiteNumber(role.tone?.light, 0.22 + (index % 4) * 0.04);
        const configuredTarget = darkTarget + boundedLevel * (lightTarget - darkTarget);
        const profileTarget = objectRecord(targets)?.[role.id];
        const target = typeof profileTarget === "number" && Number.isFinite(profileTarget)
          ? bounded(profileTarget)
          : configuredTarget;
        value = shiftHexToLuminance(nearestPaletteColor(palette, target, index), target);
      }
      patch[role.fieldId] = value;
      (role.mirrorFieldIds || []).forEach((fieldId) => { patch[fieldId] = value; });
    });
    return patch;
  }

  function normalizeProfiles(value) {
    if (!Array.isArray(value)) return [];
    const roleIds = new Set(roles.filter((role) => role.tone !== "text").map((role) => role.id));
    const profiles = value.flatMap((entry) => {
      const profile = objectRecord(entry);
      const targets = objectRecord(profile?.targetLuminanceByRoleId);
      if (typeof profile?.id !== "string" || !profile.id.trim() || typeof profile?.name !== "string" ||
          !profile.name.trim() || typeof profile?.level !== "number" ||
          !["dark", "light"].includes(profile?.mode) || !targets) return [];
      const normalizedTargets = {};
      for (const [roleId, target] of Object.entries(targets)) {
        if (roleIds.has(roleId) && typeof target === "number" && Number.isFinite(target)) {
          normalizedTargets[roleId] = bounded(target);
        }
      }
      return [{
        id: profile.id.trim(),
        name: profile.name.trim(),
        level: bounded(profile.level),
        mode: profile.mode,
        targetLuminanceByRoleId: normalizedTargets
      }];
    });
    return Array.from(new Map(profiles.map((profile) => [profile.id, profile])).values())
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function makeProfile(name) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return null;
    const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "profile";
    const suffix = Math.floor(stableNoise(normalizedName.toLowerCase()) * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    const targets = {};
    roles.forEach((role) => {
      if (role.tone === "text") return;
      const value = normalizeHex(model.fields[role.fieldId]);
      if (value) targets[role.id] = hexLuminance(value);
    });
    return {
      id: `tone-${slug}-${suffix}`,
      name: normalizedName,
      level: bounded(model.tone.level),
      mode: model.fields[config.tone.visualModeFieldId] === "light" ? "light" : "dark",
      targetLuminanceByRoleId: targets
    };
  }

  function stageTone(mode, level, targets) {
    model.tone.level = bounded(level);
    patchFields(tonePatch({ mode, level: model.tone.level, targets }), false);
  }

  function themePayload() {
    const map = objectRecord(config.payloadMaps?.theme) || {};
    return Object.fromEntries(Object.entries(map).map(([payloadKey, fieldId]) => [payloadKey, cloneValue(model.fields[fieldId])]));
  }

  function picturePayload() {
    const map = objectRecord(config.payloadMaps?.picture) || {};
    return Object.fromEntries(Object.entries(map).map(([payloadKey, fieldId]) => [payloadKey, cloneValue(model.fields[fieldId])]));
  }

  function environmentPayload() {
    const map = objectRecord(config.payloadMaps?.environment) || {};
    return Object.fromEntries(Object.entries(map).map(([payloadKey, fieldId]) => [payloadKey, cloneValue(model.fields[fieldId])]));
  }

  function applyResponsePatch(response) {
    if (!response) return;
    const patch = objectRecord(response.fieldPatch) || objectRecord(response.values);
    if (patch) patchFields(patch);
    else patchFields(response);
  }

  async function applyTheme() {
    const response = await requestAction(actions.theme.apply, themePayload(), copy.applyingTheme);
    applyResponsePatch(response);
    return response;
  }

  async function applyPicture() {
    const response = await requestAction(actions.picture.apply, picturePayload(), copy.applyingPicture);
    applyResponsePatch(response);
    return response;
  }

  async function browseTheme() {
    const imageFieldId = config.palette.imageFieldId;
    const selection = await requestAction(
      actions.theme.select,
      {},
      copy.samplingPalette
    );
    if (!selection?.selected) return;
    const imagePath = String(selection.path || "");
    const response = await requestAction(
      actions.theme.sample,
      { imagePath },
      copy.samplingPalette
    );
    if (!response || response.selected === false) return;
    const path = String(response.imagePath || response.path || "");
    const patch = objectRecord(response.fieldPatch) || {};
    patch[imageFieldId] = path;
    patch[config.palette.fieldId] = response.paletteHexes || [];
    if (config.palette.copyImagePathToFieldId) patch[config.palette.copyImagePathToFieldId] = path;
    patchFields(patch, false);
    model.tone.level = 0;
    model.tone.activeProfileId = "";
    patchFields(tonePatch({ mode: "dark", level: 0 }), true);
    if (path && config.palette.applyPictureAfterSample) await applyPicture();
  }

  async function absorbTheme() {
    const response = await requestAction(actions.theme.absorb, {}, copy.absorbingTheme);
    if (response) applyResponsePatch(response);
  }

  async function refillTheme() {
    model.tone.refillVariant += 1;
    const mode = model.fields[config.tone.visualModeFieldId] === "light" ? "light" : "dark";
    patchFields(tonePatch({
      mode,
      level: model.tone.level,
      refillVariant: model.tone.refillVariant
    }));
    await applyTheme();
  }

  async function saveFields() {
    await requestAction(
      actions.theme.saveFields,
      { values: pickFields(config.persistence.fieldIds) },
      copy.savingFields
    );
  }

  async function loadFields() {
    const response = await requestAction(actions.theme.loadFields, {}, copy.loadingFields);
    if (response && response.selected !== false) applyResponsePatch(response);
  }

  async function savePackage() {
    const response = await requestAction(
      actions.theme.savePackage,
      { values: pickFields(config.persistence.packageFieldIds) },
      copy.savingPackage
    );
    if (!response || response.saved === false) return;
    model.activePackage = {
      path: String(response.packagePath || response.path || ""),
      name: String(response.packageName || response.name || "")
    };
    schedulePersistence();
  }

  async function loadPackage(actionId) {
    const isCycle = actionId === actions.theme.previousPackage || actionId === actions.theme.nextPackage;
    const response = await requestAction(
      actionId,
      isCycle ? { activePackagePath: model.activePackage.path } : {},
      copy.loadingPackage
    );
    if (!response || response.selected === false) return;
    applyResponsePatch(response);
    model.activePackage = {
      path: String(response.packagePath || response.path || ""),
      name: String(response.packageName || response.name || "")
    };
    schedulePersistence();
    let pictureResponse = null;
    if (String(model.fields[config.picture.pathFieldId] || "").trim()) {
      pictureResponse = await applyPicture();
    } else {
      pictureResponse = await runPictureAction(actions.picture.clear, {}, copy.clearingPicture);
    }
    if (!pictureResponse) return;
    await applyTheme();
  }

  async function selectFile(actionId, fieldId, progressMessage) {
    const response = await requestAction(actionId, {}, progressMessage);
    if (response?.selected) patchFields({ [fieldId]: response.path });
  }

  async function runPictureAction(actionId, payload, progressMessage) {
    const response = await requestAction(actionId, payload, progressMessage);
    applyResponsePatch(response);
    return response;
  }

  async function runEnvironmentAction(actionId, payload, progressMessage) {
    const response = await requestAction(actionId, payload, progressMessage);
    applyResponsePatch(response);
  }

  function renderPalette(heading) {
    const palette = element("div", "theme-palette");
    palette.setAttribute("aria-label", copy.paletteLabel || "");
    usablePalette().forEach((hex) => {
      const swatch = element("span", "theme-palette__swatch");
      swatch.title = hex;
      swatch.style.backgroundColor = hex;
      palette.append(swatch);
    });
    heading.append(palette);
  }

  function renderToneControls(section, storage) {
    const row = element("div", "theme-row theme-row--tone");
    row.append(
      actionButton(localActions.darkMode, () => {
        model.tone.activeProfileId = "";
        stageTone("dark", 0);
        render();
      }),
      actionButton(localActions.lightMode, () => {
        model.tone.activeProfileId = "";
        stageTone("light", 1);
        render();
      })
    );
    const tone = element("label", "theme-tone");
    tone.append(element("span", "", config.tone.sliderLabel));
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(model.tone.level);
    const value = element("span", "theme-tone__value", model.tone.level.toFixed(2));
    slider.addEventListener("input", () => {
      const level = bounded(Number(slider.value));
      const mode = level >= 0.5 ? "light" : "dark";
      model.tone.activeProfileId = "";
      model.tone.level = level;
      value.textContent = level.toFixed(2);
      patchFields(tonePatch({ mode, level }), false);
    });
    tone.append(slider, value);
    row.append(tone, actionButton(actions.theme.apply, applyTheme));
    section.append(row);

    const profiles = element("div", "theme-profiles");
    const select = document.createElement("select");
    select.setAttribute("aria-label", config.tone.profileSelectLabel);
    const currentOption = document.createElement("option");
    currentOption.value = "";
    currentOption.textContent = config.tone.currentProfileLabel;
    select.append(currentOption);
    model.tone.profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.append(option);
    });
    select.value = model.tone.activeProfileId;
    select.addEventListener("change", () => {
      model.tone.activeProfileId = select.value;
      const profile = model.tone.profiles.find((candidate) => candidate.id === select.value);
      if (profile) {
        model.tone.level = profile.level;
        patchFields(tonePatch({ mode: profile.mode, level: profile.level, targets: profile.targetLuminanceByRoleId }));
      } else schedulePersistence();
    });
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = config.tone.profileNamePlaceholder;
    const saveButton = actionButton(localActions.saveProfile, () => {
      const profile = makeProfile(nameInput.value);
      if (!profile) return;
      model.tone.profiles = normalizeProfiles([
        ...model.tone.profiles.filter((candidate) => candidate.id !== profile.id),
        profile
      ]);
      model.tone.activeProfileId = profile.id;
      schedulePersistence();
      render();
    });
    profiles.append(select, nameInput, saveButton);
    storage.append(profiles);
  }

  function renderRoleGroups(section) {
    const grid = element("div", "theme-role-grid");
    roles.forEach((role) => {
      const roleNode = element("div", "theme-role");
      roleNode.title = role.label;
      const roleLabel = element("div", "theme-role__label-row");
      roleLabel.append(element("span", "theme-role__label", role.label));
      if (role.fieldId === config.gradient.gradientFieldId) {
        const gradientCheckbox = inputForField(fieldById.get(config.gradient.enabledFieldId), "checkbox");
        gradientCheckbox.setAttribute("aria-label", config.gradient.label);
        roleLabel.append(gradientCheckbox);
      }
      roleNode.append(roleLabel);
      const field = fieldById.get(role.fieldId);
      const colorInput = inputForField(field, "color");
      const textInput = inputForField(field, "text");
      roleNode.append(
        colorInput,
        textInput,
        actionButton(
          actions.theme.applyBucket,
          async () => {
            const payload = {
              ...themePayload(),
              bucket: role.bucket,
              bucket_hex: model.fields[role.fieldId]
            };
            const response = await requestAction(actions.theme.applyBucket, payload, copy.applyingBucket);
            applyResponsePatch(response);
          },
          `Apply only the ${role.label} bucket.`
        )
      );
      grid.append(roleNode);
    });
    section.append(grid);
  }

  function renderThemeCard() {
    const { section, heading } = makeCard(copy.themeSectionTitle);
    renderPalette(heading);
    const imageField = fieldById.get(config.palette.imageFieldId);
    const imageRow = element("div", "theme-row");
    imageRow.append(
      labeledField(imageField, "theme-field--path"),
      actionButton(actions.theme.select, browseTheme),
      actionButton(actions.theme.absorb, absorbTheme),
      actionButton(localActions.refill, refillTheme)
    );
    section.append(imageRow);

    const storage = element("div", "theme-row theme-storage");
    storage.append(
      actionButton(actions.theme.previousPackage, () => loadPackage(actions.theme.previousPackage)),
      actionButton(actions.theme.openPackage, () => loadPackage(actions.theme.openPackage)),
      actionButton(actions.theme.nextPackage, () => loadPackage(actions.theme.nextPackage)),
      actionButton(actions.theme.savePackage, savePackage),
      actionButton(actions.theme.saveFields, saveFields),
      actionButton(actions.theme.loadFields, loadFields)
    );
    section.append(storage);
    renderToneControls(section, storage);
    renderRoleGroups(section);
    return section;
  }

  function renderPictureCard() {
    const { section } = makeCard(copy.pictureSectionTitle);
    const pathField = fieldById.get(config.picture.pathFieldId);
    const pathRow = element("div", "theme-row");
    pathRow.append(
      labeledField(pathField, "theme-field--path"),
      actionButton(actions.picture.select, () => selectFile(
        actions.picture.select,
        pathField.id,
        copy.selectingPicture
      ))
    );
    section.append(pathRow);
    const numberGrid = element("div", "theme-number-grid theme-number-grid--picture");
    config.picture.gridFieldIds.forEach((fieldId) => numberGrid.append(labeledField(fieldById.get(fieldId))));
    section.append(numberGrid);
    const row = element("div", "theme-row theme-row--actions");
    row.append(
      actionButton(actions.picture.apply, applyPicture),
      actionButton(actions.picture.grid, () => runPictureAction(actions.picture.grid, picturePayload(), copy.applyingGrid)),
      actionButton(actions.picture.removeGrid, () => runPictureAction(
        actions.picture.removeGrid,
        {},
        copy.removingGrid
      )),
      actionButton(actions.picture.startup, () => runPictureAction(actions.picture.startup, picturePayload(), copy.savingStartup)),
      actionButton(actions.picture.clear, () => runPictureAction(actions.picture.clear, {}, copy.clearingPicture))
    );
    section.append(row);
    return section;
  }

  function renderEnvironmentCard() {
    const { section } = makeCard(copy.environmentSectionTitle);
    const pathField = fieldById.get(config.environment.pathFieldId);
    const pathRow = element("div", "theme-row");
    pathRow.append(
      labeledField(pathField, "theme-field--path"),
      actionButton(actions.environment.select, () => selectFile(
        actions.environment.select,
        pathField.id,
        copy.selectingEnvironment
      ))
    );
    section.append(pathRow);

    const numberGrid = element("div", "theme-number-grid");
    config.environment.valueFields.forEach((valueConfig) => {
      const control = element("div", "theme-number-control");
      control.append(
        labeledField(fieldById.get(valueConfig.fieldId)),
        actionButton(valueConfig.actionId, () => runEnvironmentAction(
          valueConfig.actionId,
          { [valueConfig.payloadKey]: model.fields[valueConfig.fieldId] },
          copy.applyingEnvironmentValue
        ))
      );
      numberGrid.append(control);
    });
    section.append(numberGrid);
    const row = element("div", "theme-row theme-row--actions");
    row.append(
      actionButton(actions.environment.apply, () => runEnvironmentAction(
        actions.environment.apply,
        { hdri_path: model.fields[pathField.id] },
        copy.applyingEnvironment
      )),
      actionButton(actions.environment.clear, () => runEnvironmentAction(
        actions.environment.clear,
        {},
        copy.clearingEnvironment
      )),
      actionButton(actions.environment.reset, () => runEnvironmentAction(
        actions.environment.reset,
        environmentPayload(),
        copy.resettingEnvironment
      ))
    );
    section.append(row);
    return section;
  }

  function render() {
    controlsByFieldId.clear();
    root.replaceChildren();
    root.append(
      renderThemeCard(),
      renderPictureCard(),
      renderEnvironmentCard()
    );
    setBusy(busy);
  }

  function hydrateState(value) {
    const state = objectRecord(value);
    if (!state || Object.keys(state).length === 0) return;
    const fields = objectRecord(state.fields);
    if (fields) {
      for (const [fieldId, fieldValueEntry] of Object.entries(fields)) {
        const field = fieldById.get(fieldId);
        if (field) model.fields[fieldId] = normalizeFieldValue(field, fieldValueEntry);
      }
    }
    const tone = objectRecord(state.tone);
    if (tone) {
      model.tone.level = bounded(tone.level ?? model.tone.level);
      model.tone.profiles = normalizeProfiles(tone.profiles);
      model.tone.activeProfileId = model.tone.profiles.some((profile) => profile.id === tone.activeProfileId)
        ? tone.activeProfileId
        : "";
      model.tone.refillVariant = Number.isInteger(tone.refillVariant) ? tone.refillVariant : 0;
    }
    const activePackage = objectRecord(state.activePackage);
    if (activePackage) {
      model.activePackage = {
        path: typeof activePackage.path === "string" ? activePackage.path : "",
        name: typeof activePackage.name === "string" ? activePackage.name : ""
      };
    }
  }

  async function initialize() {
    render();
    setStatus(copy.loading || "Loading…");
    try {
      const response = objectRecord(await pageApi.request(actions.state.read, {})) || {};
      hydrateState(response.state);
      render();
      setStatus(copy.ready || "Ready.", "success");
    } catch (error) {
      render();
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  }

  void initialize();
})();
