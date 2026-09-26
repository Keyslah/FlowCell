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
  const buttonThemeActions = objectRecord(actions.buttonTheme) || {};
  const localActions = objectRecord(config.localActions) || {};
  const buttonThemeConfig = objectRecord(config.buttonTheme) || {};
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
      name: "",
      poppedButtonSettings: null
    },
    buttonTheme: {
      revision: null,
      topColor: normalizeHex(buttonThemeConfig.topColor) || "#8FDB0A",
      bottomColor: normalizeHex(buttonThemeConfig.bottomColor) || "#141414",
      spread: bounded(finiteNumber(buttonThemeConfig.spread, 100), 0, 100),
      scatter: bounded(finiteNumber(buttonThemeConfig.scatter, 20), 0, 100),
      seed: Number.isSafeInteger(buttonThemeConfig.seed) ? buttonThemeConfig.seed : 1,
      gradientColorCount: boundedInteger(buttonThemeConfig.gradientColorCount, 5, 2, 16),
      gradientColors: [],
      screenTopToBottom: buttonThemeConfig.screenTopToBottom === true,
      lockSettings: false,
      selectionTextColor: "#FFFFFF",
      lastAppliedSettings: null,
      textColor: "#FFFFFF",
      hoverEnabled: true,
      activeEnabled: true,
      hoverColor: "#FFFFFF",
      activeColor: "#FFFFFF",
      hoverHighlightAmount: 100,
      activeHighlightAmount: 100,
      hoverGlowAmount: 0,
      activeGlowAmount: 0,
      placements: [],
      buckets: []
    }
  };
  model.buttonTheme.gradientColors = resampledButtonThemeGradientColors(
    buttonThemeConfig.gradientColors,
    model.buttonTheme.gradientColorCount,
    model.buttonTheme.topColor,
    model.buttonTheme.bottomColor
  );

  let busy = false;
  let persistenceTimer = 0;
  let buttonThemeScanGeneration = 0;
  let buttonThemeScanInFlight = false;
  let buttonThemeScanPending = false;
  let buttonThemeScanNote = "";
  const selectedButtonPlacements = new Set();

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

  function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = typeof value === "number" ? value : Number(value);
    const resolved = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.max(minimum, Math.min(maximum, resolved));
  }

  function normalizeHex(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return HEX_COLOR.test(normalized) ? normalized : null;
  }

  function normalizeEffectColor(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/.test(normalized) ? normalized : null;
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
      activePackage: cloneValue(model.activePackage),
      buttonTheme: cloneValue(model.buttonTheme)
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
    ["button", "input", "select"].forEach((tag) => root.querySelectorAll(tag).forEach((control) => {
      control.disabled = nextBusy ||
        (control.dataset.paletteEdit === "true" && !Number.isSafeInteger(model.buttonTheme.revision)) ||
        (control.dataset.requiresSelection === "true" && selectedButtonPlacements.size === 0);
    }));
    if (!nextBusy) startButtonThemeScan();
  }

  function responseMessage(response, fallback) {
    const record = objectRecord(response);
    return typeof record?.message === "string" && record.message.trim()
      ? record.message
      : fallback;
  }

  async function requestAction(actionId, payload, progressMessage, withinOperation = false) {
    if ((busy && !withinOperation) || typeof actionId !== "string" || !actionId) return null;
    if (!withinOperation) setBusy(true);
    if ([buttonThemeActions.apply, buttonThemeActions.refill, buttonThemeActions.toggleText, buttonThemeActions.edit].includes(actionId) ||
        (actionId === buttonThemeActions.settings && payload?.settings)) {
      invalidateButtonThemeScan();
    }
    setStatus(progressMessage || copy.working || "Working…");
    try {
      const response = await pageApi.request(actionId, payload || {});
      const record = objectRecord(response) || {};
      const statusKind = record.changedCount === 0 ? "info" : "success";
      setStatus(responseMessage(record, copy.complete || "Complete."), statusKind);
      return record;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      return null;
    } finally {
      if (!withinOperation) setBusy(false);
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
    if (actionId === buttonThemeActions.apply || actionId === localActions.scatterButtonColors) button.dataset.paletteEdit = "true";
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

  function normalizeMaterialColors(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.flatMap((entry) => {
      if (typeof entry !== "string") return [];
      const normalized = entry.trim().toUpperCase();
      return /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/.test(normalized) ? [normalized] : [];
    }))).sort();
  }

  function countedButtonThemeBuckets(placements, buckets) {
    const counts = new Map();
    placements.forEach(({ bucketId }) => counts.set(bucketId, (counts.get(bucketId) || 0) + 1));
    return buckets
      .map((bucket) => ({ ...bucket, count: counts.get(bucket.id) || 0 }))
      .filter((bucket) => bucket.count > 0)
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "surface" ? -1 : 1;
        if (left.kind === "surface") return hexLuminance(left.color) - hexLuminance(right.color) || left.color.localeCompare(right.color);
        return left.id.localeCompare(right.id);
      });
  }

  function scannedButtonThemePalette(value) {
    const placementById = new Map();
    const bucketById = new Map();
    (Array.isArray(value) ? value : []).forEach((entry) => {
      const placement = objectRecord(entry);
      const placementId = typeof placement?.placementId === "string" ? placement.placementId.trim() : "";
      if (!placementId) return;
      const color = normalizeHex(placement.color);
      const materialColors = color ? [] : normalizeMaterialColors(placement.materialColors);
      const bucketId = color
        ? `surface:${color}`
        : `material:${materialColors.join("|") || "unresolved"}`;
      if (!bucketById.has(bucketId)) {
        bucketById.set(bucketId, color
          ? { id: bucketId, kind: "surface", color, materialColors: [] }
          : { id: bucketId, kind: "material", color: null, materialColors });
      }
      placementById.set(placementId, {
        placementId, bucketId, color,
        label: typeof placement.label === "string" && placement.label.trim() ? placement.label.trim() : "Button",
        groupLabel: typeof placement.groupLabel === "string" ? placement.groupLabel : "Blender",
        textColor: normalizeEffectColor(placement.textColor) || model.buttonTheme.textColor
      });
    });
    const placements = [...placementById.values()];
    return {
      placements,
      buckets: countedButtonThemeBuckets(placements, [...bucketById.values()])
    };
  }

  function adoptButtonThemeResponse(response, fromScan = false) {
    const record = objectRecord(response);
    if (!record || !Array.isArray(record.placements) || !Number.isSafeInteger(record.revision)) return false;
    if (!fromScan) {
      buttonThemeScanGeneration += 1;
      buttonThemeScanPending = false;
    }
    const palette = scannedButtonThemePalette(record.placements);
    model.buttonTheme.revision = record.revision;
    model.buttonTheme.placements = palette.placements;
    model.buttonTheme.buckets = palette.buckets;
    const liveIds = new Set(palette.placements.map(({ placementId }) => placementId));
    for (const placementId of selectedButtonPlacements) {
      if (!liveIds.has(placementId)) selectedButtonPlacements.delete(placementId);
    }
    buttonThemeScanNote = "";
    schedulePersistence();
    render();
    return true;
  }

  function invalidateButtonThemeScan() {
    buttonThemeScanGeneration += 1;
    buttonThemeScanPending = false;
    model.buttonTheme.revision = null;
  }

  function queueButtonThemeScan() {
    invalidateButtonThemeScan();
    buttonThemeScanPending = true;
    buttonThemeScanNote = "Refreshing buttons…";
    render();
  }

  function startButtonThemeScan() {
    if (busy || buttonThemeScanInFlight || !buttonThemeScanPending) return;
    buttonThemeScanPending = false;
    buttonThemeScanInFlight = true;
    const generation = buttonThemeScanGeneration;
    void pageApi.request(buttonThemeActions.scan, {}).then((response) => {
      if (generation !== buttonThemeScanGeneration) return;
      if (busy) {
        buttonThemeScanPending = true;
        return;
      }
      if (!adoptButtonThemeResponse(response, true)) {
        buttonThemeScanNote = "Button list could not refresh. Press Rescan to enable editing.";
        render();
      }
    }).catch(() => {
      if (generation !== buttonThemeScanGeneration) return;
      buttonThemeScanNote = "Button list could not refresh. Press Rescan to enable editing.";
      render();
    }).finally(() => {
      buttonThemeScanInFlight = false;
      startButtonThemeScan();
    });
  }

  function buttonThemeAssignments() {
    const buckets = new Map(model.buttonTheme.buckets.map((bucket) => [bucket.id, bucket]));
    return model.buttonTheme.placements.map(({ placementId, bucketId }) => {
      const bucket = buckets.get(bucketId);
      if (!bucket) throw new Error("The popped Button palette is incomplete. Press Rescan and try again.");
      return bucket.kind === "surface"
        ? { placementId, color: bucket.color }
        : { placementId };
    });
  }

  function opaqueButtonThemeColor(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim().toUpperCase();
    return normalizeHex(/^#[0-9A-F]{8}$/.test(normalized) ? normalized.slice(0, 7) : normalized);
  }

  function exactButtonThemePalette(value) {
    return Array.from(new Set((Array.isArray(value) ? value : []).map(opaqueButtonThemeColor).filter(Boolean)));
  }

  function orderedButtonThemeGradientColors(value) {
    return (Array.isArray(value) ? value : [])
      .map(opaqueButtonThemeColor)
      .filter(Boolean)
      .slice(0, 16);
  }

  function interpolatedButtonThemeColor(topColor, bottomColor, amount) {
    const top = normalizeHex(topColor);
    const bottom = normalizeHex(bottomColor);
    if (!top || !bottom) return top || bottom || "#000000";
    const boundedAmount = bounded(amount, 0, 1);
    return rgbToHex(
      Number.parseInt(top.slice(1, 3), 16) +
        (Number.parseInt(bottom.slice(1, 3), 16) - Number.parseInt(top.slice(1, 3), 16)) * boundedAmount,
      Number.parseInt(top.slice(3, 5), 16) +
        (Number.parseInt(bottom.slice(3, 5), 16) - Number.parseInt(top.slice(3, 5), 16)) * boundedAmount,
      Number.parseInt(top.slice(5, 7), 16) +
        (Number.parseInt(bottom.slice(5, 7), 16) - Number.parseInt(top.slice(5, 7), 16)) * boundedAmount
    );
  }

  function resampledButtonThemeGradientColors(value, count, topColor, bottomColor) {
    const requestedCount = boundedInteger(count, 5, 2, 16);
    let colors = orderedButtonThemeGradientColors(value);
    if (colors.length < 2) {
      colors = [normalizeHex(topColor), normalizeHex(bottomColor)].filter(Boolean);
    }
    if (colors.length < 2) colors = [colors[0] || "#8FDB0A", colors[0] || "#141414"];
    if (requestedCount <= colors.length) {
      return Array.from({ length: requestedCount }, (_, index) => (
        colors[Math.round(index * (colors.length - 1) / (requestedCount - 1))]
      ));
    }
    // Keep every chosen stop exact; only fill the new slots between them.
    const expanded = [colors[0]];
    for (let index = 0; index < colors.length - 1; index += 1) {
      const start = Math.round(index * (requestedCount - 1) / (colors.length - 1));
      const end = Math.round((index + 1) * (requestedCount - 1) / (colors.length - 1));
      for (let step = 1; step <= end - start; step += 1) {
        expanded.push(interpolatedButtonThemeColor(colors[index], colors[index + 1], step / (end - start)));
      }
    }
    return expanded;
  }

  function synchronizeButtonThemeGradientEndpoints() {
    const colors = model.buttonTheme.gradientColors;
    model.buttonTheme.topColor = colors[0] || model.buttonTheme.topColor;
    model.buttonTheme.bottomColor = colors[colors.length - 1] || model.buttonTheme.bottomColor;
  }

  function currentButtonThemePalette() {
    return exactButtonThemePalette(model.buttonTheme.buckets.flatMap((bucket) => (
      bucket.kind === "surface" ? [bucket.color] : bucket.materialColors
    )));
  }

  function normalizePoppedButtonSettings(value) {
    const settings = objectRecord(value);
    if (!settings || settings.version !== 1) return null;
    const colors = orderedButtonThemeGradientColors(settings.colors);
    if (!colors.length || colors.length !== settings.colors?.length) return null;
    const result = { version: 1, colors };
    for (const key of ["textColor", "hoverColor", "activeColor"]) {
      const color = normalizeEffectColor(settings[key]);
      if (!color) return null;
      result[key] = color;
    }
    for (const key of ["screenTopToBottom", "hoverEnabled", "activeEnabled"]) {
      if (typeof settings[key] !== "boolean") return null;
      result[key] = settings[key];
    }
    for (const key of ["spread", "scatter", "hoverHighlightAmount", "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount"]) {
      const maximum = key.endsWith("HighlightAmount") ? 1000 : 100;
      if (typeof settings[key] !== "number" || !Number.isFinite(settings[key]) || settings[key] < 0 || settings[key] > maximum) return null;
      result[key] = settings[key];
    }
    if (!Number.isSafeInteger(settings.seed)) return null;
    result.seed = settings.seed;
    return result;
  }

  function buttonThemeEffects() {
    return Object.fromEntries([
      "textColor", "hoverEnabled", "activeEnabled", "hoverColor", "activeColor",
      "hoverHighlightAmount", "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount"
    ].map((key) => [key, model.buttonTheme[key]]));
  }

  function adoptPoppedButtonSettings(value, adoptGradient = true) {
    const settings = normalizePoppedButtonSettings(value);
    if (!settings) return null;
    model.buttonTheme.lastAppliedSettings = cloneValue(settings);
    for (const key of Object.keys(buttonThemeEffects())) model.buttonTheme[key] = settings[key];
    if (adoptGradient) {
      model.buttonTheme.gradientColors = settings.colors.length === 1
        ? [settings.colors[0], settings.colors[0]]
        : [...settings.colors];
      model.buttonTheme.gradientColorCount = model.buttonTheme.gradientColors.length;
      for (const key of ["spread", "scatter", "seed", "screenTopToBottom"]) model.buttonTheme[key] = settings[key];
      synchronizeButtonThemeGradientEndpoints();
    }
    schedulePersistence();
    return settings;
  }

  async function readPoppedButtonSettings(withinOperation = false, adoptGradient = false, adoptSettings = true) {
    const response = await requestAction(buttonThemeActions.settings, {}, "Reading Blender popped Button settings…", withinOperation);
    const settings = adoptSettings
      ? adoptPoppedButtonSettings(response?.settings, adoptGradient)
      : normalizePoppedButtonSettings(response?.settings);
    if (response && !settings) setStatus("Blender returned invalid popped Button settings.", "error");
    return settings;
  }

  async function applyPoppedButtonSettings(settings, withinOperation = false, resetOverrides = false) {
    if (busy && !withinOperation) return null;
    if (!withinOperation) setBusy(true);
    try {
      const response = await requestAction(buttonThemeActions.settings, {
        settings, ...(resetOverrides ? { resetOverrides: true } : {})
      }, "Applying Blender popped Button settings…", true);
      if (!response) return null;
      const applied = adoptPoppedButtonSettings(response.settings);
      if (!applied) {
        setStatus("Blender returned invalid popped Button settings after applying them.", "error");
        return null;
      }
      // Keep the named list visible while its current colors refresh separately.
      queueButtonThemeScan();
      return applied;
    } finally {
      if (!withinOperation) setBusy(false);
    }
  }

  async function applyButtonThemeEffects() {
    if (busy) return;
    const effects = buttonThemeEffects();
    setBusy(true);
    try {
      const settings = await readPoppedButtonSettings(true);
      if (settings) await applyPoppedButtonSettings({ ...settings, ...effects }, true);
    } finally {
      setBusy(false);
    }
  }

  async function setButtonThemeLock(locked) {
    if (busy) return;
    if (locked) {
      model.buttonTheme.lockSettings = true;
      schedulePersistence();
      render();
      return;
    }
    const settings = model.activePackage.poppedButtonSettings;
    if (settings && !await applyPoppedButtonSettings(settings, false, true)) {
      render();
      return;
    }
    model.buttonTheme.lockSettings = false;
    schedulePersistence();
    render();
  }

  function scatteredButtonThemeAssignments(colors, seed) {
    const palette = exactButtonThemePalette(colors);
    if (!palette.length) throw new Error(copy.buttonThemeNeedsColors || "No popped Button colors are available. Press Rescan and try again.");
    return model.buttonTheme.placements
      .map(({ placementId }) => ({ placementId, rank: stableNoise(`${seed}\u0000${placementId}`) }))
      .sort((left, right) => left.rank - right.rank || left.placementId.localeCompare(right.placementId))
      .map(({ placementId }, index) => ({ placementId, color: palette[index % palette.length] }));
  }

  function hydrateButtonThemeState(value) {
    const state = objectRecord(value);
    if (!state) return;
    adoptPoppedButtonSettings(state.lastAppliedSettings, false);
    model.buttonTheme.lockSettings = state.lockSettings === true;
    model.buttonTheme.selectionTextColor = normalizeHex(state.selectionTextColor) || "#FFFFFF";
    model.buttonTheme.topColor = normalizeHex(state.topColor) || model.buttonTheme.topColor;
    model.buttonTheme.bottomColor = normalizeHex(state.bottomColor) || model.buttonTheme.bottomColor;
    model.buttonTheme.spread = bounded(finiteNumber(state.spread, model.buttonTheme.spread), 0, 100);
    model.buttonTheme.scatter = bounded(finiteNumber(state.scatter, model.buttonTheme.scatter), 0, 100);
    model.buttonTheme.seed = Number.isSafeInteger(state.seed) ? state.seed : model.buttonTheme.seed;
    model.buttonTheme.gradientColorCount = boundedInteger(
      state.gradientColorCount ?? state.refillRange,
      model.buttonTheme.gradientColorCount,
      2,
      16
    );
    model.buttonTheme.gradientColors = resampledButtonThemeGradientColors(
      state.gradientColors,
      model.buttonTheme.gradientColorCount,
      model.buttonTheme.topColor,
      model.buttonTheme.bottomColor
    );
    synchronizeButtonThemeGradientEndpoints();
    model.buttonTheme.screenTopToBottom = typeof state.screenTopToBottom === "boolean"
      ? state.screenTopToBottom
      : model.buttonTheme.screenTopToBottom;
    model.buttonTheme.revision = Number.isSafeInteger(state.revision) ? state.revision : null;

    const bucketById = new Map();
    (Array.isArray(state.buckets) ? state.buckets : []).forEach((entry) => {
      const bucket = objectRecord(entry);
      const id = typeof bucket?.id === "string" ? bucket.id.trim() : "";
      if (!id || !["surface", "material"].includes(bucket.kind)) return;
      if (bucket.kind === "surface") {
        const color = normalizeHex(bucket.color);
        if (color) bucketById.set(id, { id, kind: "surface", color, materialColors: [] });
      } else {
        bucketById.set(id, {
          id,
          kind: "material",
          color: null,
          materialColors: normalizeMaterialColors(bucket.materialColors)
        });
      }
    });
    const placementById = new Map();
    (Array.isArray(state.placements) ? state.placements : []).forEach((entry) => {
      const placement = objectRecord(entry);
      const placementId = typeof placement?.placementId === "string" ? placement.placementId.trim() : "";
      const bucketId = typeof placement?.bucketId === "string" ? placement.bucketId.trim() : "";
      if (placementId && bucketById.has(bucketId)) placementById.set(placementId, {
        placementId, bucketId,
        color: normalizeHex(placement.color) || bucketById.get(bucketId).color,
        label: typeof placement.label === "string" && placement.label.trim() ? placement.label.trim() : "Button",
        groupLabel: typeof placement.groupLabel === "string" ? placement.groupLabel : "Blender",
        textColor: normalizeEffectColor(placement.textColor) || model.buttonTheme.textColor
      });
    });
    const placements = [...placementById.values()];
    model.buttonTheme.placements = placements;
    model.buttonTheme.buckets = countedButtonThemeBuckets(placements, [...bucketById.values()]);
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

  async function applyTheme(withinOperation = false) {
    const response = await requestAction(actions.theme.apply, themePayload(), copy.applyingTheme, withinOperation);
    applyResponsePatch(response);
    return response;
  }

  async function applyPicture(withinOperation = false) {
    const response = await requestAction(actions.picture.apply, picturePayload(), copy.applyingPicture, withinOperation);
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

  async function rescanButtonTheme() {
    if (!busy) queueButtonThemeScan();
  }

  async function editPoppedButtons(edits) {
    if (busy || !edits.length) return;
    if (!Number.isSafeInteger(model.buttonTheme.revision)) {
      setStatus("Wait for the button list to refresh, or press Rescan before editing.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await requestAction(buttonThemeActions.edit, {
        expectedRevision: model.buttonTheme.revision, edits
      }, "Updating selected popped Buttons…", true);
      if (!response || !adoptButtonThemeResponse(response)) queueButtonThemeScan();
    } finally {
      setBusy(false);
    }
  }

  async function editSelectedPoppedButtons(patch) {
    const edits = model.buttonTheme.placements
      .filter(({ placementId }) => selectedButtonPlacements.has(placementId))
      .map(({ placementId }) => ({ placementId, ...patch }));
    await editPoppedButtons(edits);
  }

  async function applyButtonThemeBuckets() {
    let assignments;
    try {
      assignments = buttonThemeAssignments();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    await applyButtonThemeAssignments(assignments, copy.applyingButtonTheme);
  }

  async function applyButtonThemeAssignments(assignments, progressMessage) {
    if (!Number.isSafeInteger(model.buttonTheme.revision)) {
      setStatus(copy.buttonThemeNeedsScan || "Press Rescan before applying popped Button colors.", "error");
      return null;
    }
    const response = await requestAction(
      buttonThemeActions.apply,
      { expectedRevision: model.buttonTheme.revision, assignments },
      progressMessage || copy.applyingButtonTheme
    );
    if (response) adoptButtonThemeResponse(response);
    return response;
  }

  function buttonThemeGradientPayload(seed, colors = model.buttonTheme.gradientColors) {
    return {
      colors: [...colors],
      spread: model.buttonTheme.spread,
      scatter: model.buttonTheme.scatter,
      seed,
      screenTopToBottom: model.buttonTheme.screenTopToBottom
    };
  }

  async function applyButtonThemeGradient() {
    const response = await requestAction(
      buttonThemeActions.refill,
      buttonThemeGradientPayload(model.buttonTheme.seed),
      copy.applyingButtonThemeGradient || copy.applyingButtonTheme
    );
    if (response) adoptButtonThemeResponse(response);
  }

  async function refillButtonTheme() {
    const imageFieldId = config.palette?.imageFieldId;
    const imagePath = String(model.fields[imageFieldId] || "").trim();
    if (!imagePath) {
      setStatus(copy.buttonThemeNeedsImage || "Choose a theme image before refilling the popped Button gradient.", "error");
      return;
    }
    const sample = await requestAction(
      actions.theme.sample,
      { imagePath },
      copy.samplingButtonThemePalette || copy.samplingPalette
    );
    if (!sample || sample.selected === false) return;
    const sampledPalette = exactButtonThemePalette(sample.paletteHexes);
    const requestedCount = model.buttonTheme.gradientColorCount;
    if (sampledPalette.length < requestedCount) {
      setStatus(
        `The theme image returned only ${sampledPalette.length} distinct color${sampledPalette.length === 1 ? "" : "s"}. Lower Gradient Colors and try again.`,
        "error"
      );
      return;
    }
    const nextSeed = Number.isSafeInteger(model.buttonTheme.seed + 1) ? model.buttonTheme.seed + 1 : 1;
    const nextColors = sampledPalette.slice(0, requestedCount);
    const response = await requestAction(
      buttonThemeActions.refill,
      buttonThemeGradientPayload(nextSeed, nextColors),
      copy.refillingButtonTheme
    );
    if (!response) return;
    const previousSeed = model.buttonTheme.seed;
    const previousColors = model.buttonTheme.gradientColors;
    model.buttonTheme.seed = nextSeed;
    model.buttonTheme.gradientColors = nextColors;
    synchronizeButtonThemeGradientEndpoints();
    if (!adoptButtonThemeResponse(response)) {
      model.buttonTheme.seed = previousSeed;
      model.buttonTheme.gradientColors = previousColors;
      synchronizeButtonThemeGradientEndpoints();
    }
  }

  async function scatterButtonTheme() {
    if (busy) return;
    if (!Number.isSafeInteger(model.buttonTheme.revision)) {
      setStatus(copy.buttonThemeNeedsScan || "Press Rescan before applying popped Button colors.", "error");
      return;
    }
    let assignments;
    const previousSeed = model.buttonTheme.seed;
    model.buttonTheme.seed = Number.isSafeInteger(previousSeed + 1) ? previousSeed + 1 : 1;
    try {
      assignments = scatteredButtonThemeAssignments(currentButtonThemePalette(), model.buttonTheme.seed);
    } catch (error) {
      model.buttonTheme.seed = previousSeed;
      setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    setBusy(true);
    try {
      const seed = model.buttonTheme.seed;
      const settings = await readPoppedButtonSettings(true);
      const colors = currentButtonThemePalette();
      const response = await requestAction(buttonThemeActions.apply, {
        expectedRevision: model.buttonTheme.revision,
        assignments,
        ...(settings ? { settings: {
          ...settings,
          colors: colors.length > 16 ? resampledButtonThemeGradientColors(colors, 16) : colors,
          seed,
          spread: 100,
          scatter: 100,
          screenTopToBottom: false
        } } : {})
      }, copy.scatteringButtonTheme, true);
      if (response) adoptButtonThemeResponse(response);
      else model.buttonTheme.seed = previousSeed;
    } finally {
      setBusy(false);
    }
  }

  async function toggleButtonThemeText() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await requestAction(
        buttonThemeActions.toggleText,
        {},
        copy.togglingButtonThemeText || "Toggling popped Button text...",
        true
      );
      if (response) {
        await readPoppedButtonSettings(true);
        adoptButtonThemeResponse(response);
      }
    } finally {
      setBusy(false);
    }
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
    if (busy) return;
    setBusy(true);
    try {
      const settings = await readPoppedButtonSettings(true);
      if (!settings) return;
      const response = await requestAction(
        actions.theme.savePackage,
        { values: { ...pickFields(config.persistence.packageFieldIds), popped_button_settings: settings } },
        copy.savingPackage,
        true
      );
      if (!response || response.saved === false) return;
      model.activePackage = {
        path: String(response.packagePath || response.path || ""),
        name: String(response.packageName || response.name || ""),
        poppedButtonSettings: cloneValue(settings)
      };
      schedulePersistence();
    } finally {
      setBusy(false);
    }
  }

  async function loadPackage(actionId) {
    if (busy) return;
    setBusy(true);
    invalidateButtonThemeScan();
    try {
      const isCycle = actionId === actions.theme.previousPackage || actionId === actions.theme.nextPackage;
      const response = await requestAction(
        actionId,
        isCycle ? { activePackagePath: model.activePackage.path } : {},
        copy.loadingPackage,
        true
      );
      if (!response || response.selected === false) return;
      const patch = objectRecord(response.fieldPatch) || objectRecord(response.values) || {};
      const savedSettings = normalizePoppedButtonSettings(patch.popped_button_settings);
      if (Object.prototype.hasOwnProperty.call(patch, "popped_button_settings") && !savedSettings) {
        setStatus("This package contains invalid popped Button settings. The package was not applied.", "error");
        return;
      }
      const previousSettings = savedSettings || await readPoppedButtonSettings(true, true, !model.buttonTheme.lockSettings);
      if (!previousSettings) return;
      applyResponsePatch(response);
      model.activePackage = {
        path: String(response.packagePath || response.path || ""),
        name: String(response.packageName || response.name || ""),
        poppedButtonSettings: cloneValue(previousSettings)
      };
      schedulePersistence();
      // Popped Buttons apply independently of Blender's picture/theme bridge.
      let settingsError = "";
      if (!model.buttonTheme.lockSettings && savedSettings) {
        if (!await applyPoppedButtonSettings(savedSettings, true, true)) settingsError = statusNode.textContent;
      }
      let pictureResponse = null;
      if (String(model.fields[config.picture.pathFieldId] || "").trim()) {
        pictureResponse = await applyPicture(true);
      } else {
        pictureResponse = await runPictureAction(actions.picture.clear, {}, copy.clearingPicture, true);
      }
      if (!pictureResponse) return;
      await applyTheme(true);
      if (settingsError) setStatus(settingsError, "error");
      render();
    } finally {
      queueButtonThemeScan();
      setBusy(false);
    }
  }

  async function selectFile(actionId, fieldId, progressMessage) {
    const response = await requestAction(actionId, {}, progressMessage);
    if (response?.selected) patchFields({ [fieldId]: response.path });
  }

  async function runPictureAction(actionId, payload, progressMessage, withinOperation = false) {
    const response = await requestAction(actionId, payload, progressMessage, withinOperation);
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

  function renderButtonThemeGradientStopControl(index) {
    const lastIndex = model.buttonTheme.gradientColors.length - 1;
    const labelText = index === 0
      ? buttonThemeConfig.topLabel || "Top"
      : index === lastIndex
        ? buttonThemeConfig.bottomLabel || "Bottom"
        : `Color ${index + 1}`;
    const control = element("label", "button-theme-gradient__color");
    control.append(element("span", "button-theme-gradient__label", labelText));
    const inputs = element("span", "button-theme-gradient__color-inputs");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = model.buttonTheme.gradientColors[index];
    picker.setAttribute("aria-label", `${labelText} color picker`);
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = model.buttonTheme.gradientColors[index];
    textInput.setAttribute("aria-label", `${labelText} color`);
    const update = (value) => {
      const color = normalizeHex(value);
      if (!color) {
        textInput.value = model.buttonTheme.gradientColors[index];
        return;
      }
      model.buttonTheme.gradientColors[index] = color;
      if (index === 0) model.buttonTheme.topColor = color;
      if (index === lastIndex) model.buttonTheme.bottomColor = color;
      picker.value = color;
      textInput.value = color;
      schedulePersistence();
    };
    picker.addEventListener("input", () => update(picker.value));
    textInput.addEventListener("change", () => update(textInput.value));
    inputs.append(picker, textInput);
    control.append(inputs);
    return control;
  }

  function populateButtonThemeGradientStops(stops) {
    stops.replaceChildren();
    model.buttonTheme.gradientColors.forEach((_color, index) => {
      stops.append(renderButtonThemeGradientStopControl(index));
    });
  }

  function renderButtonThemeGradientStops() {
    const stops = element("div", "button-theme-gradient__stops");
    populateButtonThemeGradientStops(stops);
    return stops;
  }

  function renderButtonThemeRangeControl(labelText, key, maximum = 100) {
    const control = element("label", "button-theme-gradient__range");
    const labelRow = element("span", "button-theme-gradient__range-label");
    const valueNode = element("span", "button-theme-gradient__value", Math.round(model.buttonTheme[key]));
    labelRow.append(element("span", "", labelText), valueNode);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(maximum);
    slider.step = "1";
    slider.value = String(model.buttonTheme[key]);
    slider.dataset.setting = key;
    slider.setAttribute("aria-label", labelText);
    slider.addEventListener("input", () => {
      model.buttonTheme[key] = bounded(Number(slider.value), 0, maximum);
      valueNode.textContent = String(Math.round(model.buttonTheme[key]));
      schedulePersistence();
    });
    control.append(labelRow, slider);
    return control;
  }

  function renderButtonThemeScreenGradientControl() {
    const control = element("label", "button-theme-gradient__screen-toggle");
    control.title = buttonThemeConfig.screenTopToBottomTooltip ||
      "Blend from the topmost to bottommost open popped Buttons on each screen.";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = model.buttonTheme.screenTopToBottom;
    checkbox.addEventListener("change", () => {
      model.buttonTheme.screenTopToBottom = checkbox.checked === true;
      schedulePersistence();
    });
    control.append(
      checkbox,
      element(
        "span",
        "button-theme-gradient__screen-label",
        buttonThemeConfig.screenTopToBottomLabel || "Screen Top-to-Bottom"
      )
    );
    return control;
  }

  function renderButtonThemeGradientColorCountControl(stops) {
    const minimum = boundedInteger(buttonThemeConfig.gradientColorCountMinimum, 2, 2, 16);
    const maximum = boundedInteger(buttonThemeConfig.gradientColorCountMaximum, 16, minimum, 16);
    const labelText = buttonThemeConfig.gradientColorCountLabel || "Gradient Colors";
    const control = element("label", "button-theme-gradient__color-count");
    control.title = buttonThemeConfig.gradientColorCountTooltip ||
      "Choose how many colors the popped-Button gradient uses. Refill samples this many colors from the current Theme image.";
    control.append(element("span", "button-theme-gradient__color-count-label", labelText));
    const inputs = element("span", "button-theme-gradient__color-count-inputs");
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(minimum);
    slider.max = String(maximum);
    slider.step = "1";
    slider.value = String(model.buttonTheme.gradientColorCount);
    slider.setAttribute("aria-label", `${labelText} slider`);
    const number = document.createElement("input");
    number.type = "number";
    number.min = String(minimum);
    number.max = String(maximum);
    number.step = "1";
    number.value = String(model.buttonTheme.gradientColorCount);
    number.setAttribute("aria-label", labelText);
    const update = (value) => {
      const nextCount = boundedInteger(value, model.buttonTheme.gradientColorCount, minimum, maximum);
      model.buttonTheme.gradientColors = resampledButtonThemeGradientColors(
        model.buttonTheme.gradientColors,
        nextCount,
        model.buttonTheme.topColor,
        model.buttonTheme.bottomColor
      );
      model.buttonTheme.gradientColorCount = nextCount;
      synchronizeButtonThemeGradientEndpoints();
      slider.value = String(model.buttonTheme.gradientColorCount);
      number.value = String(model.buttonTheme.gradientColorCount);
      schedulePersistence();
      populateButtonThemeGradientStops(stops);
    };
    slider.addEventListener("input", () => update(slider.value));
    number.addEventListener("change", () => update(number.value));
    inputs.append(slider, number);
    control.append(inputs);
    return control;
  }

  function updateButtonThemeBucketColor(bucket, value, picker, textInput) {
    const color = normalizeHex(value);
    if (!color) {
      textInput.value = bucket.color;
      return;
    }
    bucket.color = color;
    picker.value = color;
    textInput.value = color;
    schedulePersistence();
  }

  function renderButtonThemeBucket(bucket) {
    const node = element("div", `button-theme-bucket button-theme-bucket--${bucket.kind}`);
    const countLabel = `${bucket.count} Button${bucket.count === 1 ? "" : "s"}`;
    if (bucket.kind === "surface") {
      node.title = `${bucket.color} is currently present on ${countLabel}.`;
      node.append(element("div", "button-theme-bucket__label", `Surface · ${countLabel}`));
      const controls = element("div", "button-theme-bucket__controls");
      const picker = document.createElement("input");
      picker.type = "color";
      picker.value = bucket.color;
      const textInput = document.createElement("input");
      textInput.type = "text";
      textInput.value = bucket.color;
      picker.addEventListener("input", () => updateButtonThemeBucketColor(bucket, picker.value, picker, textInput));
      textInput.addEventListener("change", () => updateButtonThemeBucketColor(bucket, textInput.value, picker, textInput));
      controls.append(picker, textInput);
      node.append(controls);
      return node;
    }

    node.title = copy.buttonThemeMaterialTooltip ||
      "These exact skin material colors have no single Surface root. Refill creates an editable Surface color.";
    node.append(element("div", "button-theme-bucket__label", `Skin materials · ${countLabel}`));
    const swatches = element("div", "button-theme-bucket__materials");
    if (bucket.materialColors.length === 0) {
      swatches.append(element("span", "button-theme-bucket__unresolved", "No editable Surface root"));
    } else {
      bucket.materialColors.forEach((color) => {
        const swatch = element("span", "button-theme-bucket__material");
        swatch.title = color;
        swatch.style.backgroundColor = color;
        swatches.append(swatch);
      });
    }
    node.append(swatches);
    return node;
  }

  function renderButtonThemeCard() {
    const { section, heading } = makeCard(copy.buttonThemeSectionTitle || "Popped Button Colors");
    heading.append(renderButtonThemeEffectToggle("Lock All Popped Button Settings", "lockSettings"));
    const presentColors = new Set();
    model.buttonTheme.buckets.forEach((bucket) => {
      if (bucket.kind === "surface") presentColors.add(bucket.color);
      else bucket.materialColors.forEach((color) => presentColors.add(color));
    });
    const buttonCount = model.buttonTheme.placements.length;
    heading.append(element(
      "span",
      "button-theme-summary",
      buttonCount
        ? `${presentColors.size} color${presentColors.size === 1 ? "" : "s"} · ${buttonCount} scoped popped Button${buttonCount === 1 ? "" : "s"}`
        : copy.buttonThemeEmpty || "Press Rescan to collect popped Button colors."
    ));
    section.append(element("p", "button-theme-effects__help",
      model.buttonTheme.lockSettings
        ? "Locked: colors, all gradient stops, Spread, Scatter, text, highlights and glow stay as they are when switching packages. Unlock to restore the selected package's saved appearance."
        : "Lock the entire popped Button appearance: colors, all gradient stops, Spread, Scatter, text, highlights and glow. The lock is temporary and does not change saved packages."
    ));

    const actionsRow = element("div", "theme-row theme-row--actions button-theme-actions");
    actionsRow.append(
      actionButton(buttonThemeActions.scan, rescanButtonTheme),
      actionButton(localActions.applyButtonGradient, applyButtonThemeGradient),
      actionButton(buttonThemeActions.apply, applyButtonThemeBuckets),
      actionButton(localActions.refillButtonColors, refillButtonTheme),
      actionButton(localActions.scatterButtonColors, scatterButtonTheme),
      actionButton(buttonThemeActions.toggleText, toggleButtonThemeText)
    );
    section.append(actionsRow);

    const gradient = element("div", "button-theme-gradient");
    const gradientStops = renderButtonThemeGradientStops();
    gradient.append(
      gradientStops,
      renderButtonThemeGradientColorCountControl(gradientStops),
      renderButtonThemeRangeControl(buttonThemeConfig.spreadLabel || "Spread", "spread"),
      renderButtonThemeRangeControl(buttonThemeConfig.scatterLabel || "Scatter", "scatter"),
      renderButtonThemeScreenGradientControl()
    );
    section.append(gradient);

    if (model.buttonTheme.buckets.length) {
      const buckets = element("div", "button-theme-buckets");
      model.buttonTheme.buckets.forEach((bucket) => buckets.append(renderButtonThemeBucket(bucket)));
      section.append(buckets);
    }
    section.append(renderIndividualPoppedButtons());
    section.append(renderButtonThemeEffects());
    return section;
  }

  function individualButtonAction(label, tooltip, handler, editSelection = false) {
    const button = actionButton(buttonThemeActions.edit, handler, tooltip);
    button.textContent = label;
    if (editSelection) {
      button.dataset.paletteEdit = "true";
      button.dataset.requiresSelection = "true";
    }
    return button;
  }

  function individualButtonColor(placement, key, label, value) {
    const control = element("label", "button-theme-individual__color");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = opaqueButtonThemeColor(value) || "#808080";
    picker.dataset.paletteEdit = "true";
    picker.dataset.individualColor = key;
    picker.setAttribute("aria-label", `${placement.label} ${label.toLowerCase()} color`);
    picker.title = `Change only ${placement.label}'s ${label.toLowerCase()} color.`;
    picker.addEventListener("change", () => {
      const color = normalizeHex(picker.value);
      if (color) void editPoppedButtons([{ placementId: placement.placementId, [key]: color }]);
    });
    control.append(element("span", "", label), picker);
    return control;
  }

  function renderIndividualPoppedButtons() {
    const section = element("div", "button-theme-individuals");
    const heading = element("div", "theme-card__heading");
    heading.append(element("h3", "", "Individual Buttons"), element("span", "button-theme-summary",
      `${selectedButtonPlacements.size} selected · ${model.buttonTheme.placements.length} buttons`));
    section.append(heading);
    section.append(element("p", "button-theme-effects__help",
      buttonThemeScanNote || "Select buttons to change their text together, or use each button's Fill and Text controls."
    ));
    const actions = element("div", "button-theme-individuals__actions");
    actions.append(
      individualButtonAction("Select All", "Select every button in this list.", () => {
        model.buttonTheme.placements.forEach(({ placementId }) => selectedButtonPlacements.add(placementId));
        render();
      }),
      individualButtonAction("Clear Selection", "Clear the selected buttons.", () => {
        selectedButtonPlacements.clear();
        render();
      }),
      individualButtonAction("Black Text", "Make the selected buttons' text black without changing their fill colors.",
        () => editSelectedPoppedButtons({ textColor: "#000000" }), true),
      individualButtonAction("White Text", "Make the selected buttons' text white without changing their fill colors.",
        () => editSelectedPoppedButtons({ textColor: "#FFFFFF" }), true)
    );
    const textControl = element("label", "button-theme-individuals__text");
    const textPicker = document.createElement("input");
    textPicker.type = "color";
    textPicker.value = model.buttonTheme.selectionTextColor;
    textPicker.setAttribute("aria-label", "Selected buttons custom text color");
    textPicker.addEventListener("input", () => {
      model.buttonTheme.selectionTextColor = normalizeHex(textPicker.value) || model.buttonTheme.selectionTextColor;
      schedulePersistence();
    });
    textControl.append(element("span", "", "Text"), textPicker);
    actions.append(textControl,
      individualButtonAction("Apply to Selected", "Apply the chosen text color to selected buttons without changing their fills.",
        () => editSelectedPoppedButtons({ textColor: model.buttonTheme.selectionTextColor }), true),
      individualButtonAction("Use Theme Colors", "Restore the selected buttons' fill and text colors from the current Blender popped Button theme.",
        () => editSelectedPoppedButtons({ reset: true }), true));
    section.append(actions);
    const list = element("div", "button-theme-individuals__list");
    const buckets = new Map(model.buttonTheme.buckets.map((bucket) => [bucket.id, bucket]));
    model.buttonTheme.placements.forEach((placement) => {
      const row = element("div", "button-theme-individual");
      const selected = selectedButtonPlacements.has(placement.placementId);
      row.dataset.selected = String(selected);
      const select = element("label", "button-theme-individual__select");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected;
      checkbox.setAttribute("aria-label", `Select ${placement.label} (${placement.groupLabel})`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedButtonPlacements.add(placement.placementId);
        else selectedButtonPlacements.delete(placement.placementId);
        render();
      });
      select.append(checkbox);
      const preview = element("div", "button-theme-individual__preview");
      const bucket = buckets.get(placement.bucketId);
      const fill = placement.color || bucket?.color;
      if (fill) preview.style.backgroundColor = fill;
      else if (bucket?.materialColors.length) preview.style.background = `linear-gradient(135deg, ${bucket.materialColors.join(", ")})`;
      preview.style.color = placement.textColor;
      preview.append(element("span", "button-theme-individual__name", placement.label),
        element("span", "button-theme-individual__group", placement.groupLabel));
      preview.title = `${placement.groupLabel} · ${placement.label}`;
      row.append(select, preview,
        individualButtonColor(placement, "color", "Fill", fill || bucket?.materialColors[0]),
        individualButtonColor(placement, "textColor", "Text", placement.textColor));
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function renderButtonThemeEffectColor(labelText, key) {
    const control = element("label", "button-theme-effect-color");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = model.buttonTheme[key].slice(0, 7);
    picker.dataset.setting = key;
    picker.setAttribute("aria-label", labelText);
    picker.addEventListener("input", () => {
      const color = normalizeHex(picker.value);
      if (color) model.buttonTheme[key] = color + model.buttonTheme[key].slice(7);
      schedulePersistence();
    });
    control.append(element("span", "", labelText), picker);
    return control;
  }

  function renderButtonThemeEffectToggle(labelText, key) {
    const control = element("label", "button-theme-effect-toggle");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = model.buttonTheme[key];
    checkbox.dataset.setting = key;
    checkbox.setAttribute("aria-label", labelText);
    checkbox.addEventListener("change", () => {
      if (key === "lockSettings") void setButtonThemeLock(checkbox.checked === true);
      else {
        model.buttonTheme[key] = checkbox.checked === true;
        schedulePersistence();
      }
    });
    control.append(checkbox, element("span", "", labelText));
    return control;
  }

  function renderButtonThemeEffects() {
    const effects = element("div", "button-theme-effects");
    const heading = element("div", "theme-card__heading");
    heading.append(element("h3", "", "Popped Highlights & Glow"));
    const description = element("p", "button-theme-effects__help",
      "Text, highlights and glow apply to every Blender popped Button. Lock All Popped Button Settings above includes these controls and the colors and gradients."
    );
    const grid = element("div", "button-theme-effects__grid");
    grid.append(renderButtonThemeEffectColor("Text Color", "textColor"));
    for (const [prefix, label] of [["hover", "Hover"], ["active", "Active"]]) {
      const group = element("div", "button-theme-effects__group");
      group.append(
        renderButtonThemeEffectToggle(`${label} Enabled`, `${prefix}Enabled`),
        renderButtonThemeEffectColor(`${label} Color`, `${prefix}Color`),
        renderButtonThemeRangeControl(`${label} Highlight`, `${prefix}HighlightAmount`, 1000),
        renderButtonThemeRangeControl(`${label} Glow`, `${prefix}GlowAmount`)
      );
      grid.append(group);
    }
    effects.append(heading, description, grid,
      actionButton(buttonThemeActions.settings, applyButtonThemeEffects));
    return effects;
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
      renderButtonThemeCard(),
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
        name: typeof activePackage.name === "string" ? activePackage.name : "",
        poppedButtonSettings: normalizePoppedButtonSettings(activePackage.poppedButtonSettings)
      };
    }
    hydrateButtonThemeState(state.buttonTheme);
  }

  async function initialize() {
    render();
    setBusy(true);
    setStatus(copy.loading || "Loading…");
    try {
      const response = objectRecord(await pageApi.request(actions.state.read, {})) || {};
      hydrateState(response.state);
      const previousGradient = objectRecord(response.state?.buttonTheme)
        ? buttonThemeGradientPayload(model.buttonTheme.seed)
        : null;
      const settingsResponse = await pageApi.request(buttonThemeActions.settings, {});
      const settings = normalizePoppedButtonSettings(settingsResponse?.settings);
      if (!settings) throw new Error("Blender returned invalid popped Button settings.");
      if (settingsResponse.configured === false) {
        const applied = await applyPoppedButtonSettings({ ...settings, ...(previousGradient || {}) }, true);
        if (!applied || statusNode.dataset.kind === "error") {
          render();
          return;
        }
      } else {
        adoptPoppedButtonSettings(settings);
      }
      render();
      setStatus(copy.ready || "Ready.", "success");
    } catch (error) {
      render();
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      queueButtonThemeScan();
      setBusy(false);
    }
  }

  void initialize();
})();
