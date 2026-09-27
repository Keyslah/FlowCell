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
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CURVE_MAX_POINTS = 32;
  const CURVE_MIN_GAP = 0.002;
  const CURVE_POINT_KEYS = ["x", "y", "mode"];
  const CURVE_HANDLE_POINT_KEYS = ["x", "y", "mode", "inX", "inY", "outX", "outY"];
  const CURVE_MODE_LABELS = { auto: "Smooth", corner: "Corner", aligned: "Bezier", free: "Broken" };
  const CURVE_MODE_TOOLTIPS = {
    auto: "Smooth: the curve flows through this point and its handles follow the neighboring points.",
    corner: "Corner: straight lines meet at a sharp point.",
    aligned: "Bezier: drag either handle to bend the curve; the opposite handle stays in line.",
    free: "Broken: each handle moves on its own, for a sharp kink."
  };
  const GRADIENT_CHANNELS = {
    fill: {
      title: buttonThemeConfig.fillTitle || "Button Fill",
      colorsKey: "gradientColors",
      angleKey: "angle",
      curveKey: "curve",
      screenKey: "screenTopToBottom",
      ariaPrefix: ""
    },
    text: {
      title: buttonThemeConfig.textTitle || "Button Text",
      colorsKey: "textColors",
      angleKey: "textAngle",
      curveKey: "textCurve",
      screenKey: "textScreenTopToBottom",
      ariaPrefix: "Text "
    }
  };

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
      angle: 0,
      curve: linearCurve(),
      lockSettings: false,
      lastAppliedSettings: null,
      textColor: "#FFFFFF",
      textColors: ["#FFFFFF"],
      textAngle: 0,
      textCurve: linearCurve(),
      textScreenTopToBottom: false,
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
  // Curve-editor selection and live redraw hooks are view state, never persisted.
  const curveSelection = { fill: -1, text: -1 };
  const gradientRedraws = new Map();

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

  function linearCurve() {
    return [{ x: 0, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }];
  }

  function inUnitRange(value, minimum, maximum) {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
  }

  // Mirrors Core's curve contract so the page never stages a curve Core would reject.
  function normalizeCurve(value) {
    if (!Array.isArray(value) || value.length < 2 || value.length > CURVE_MAX_POINTS) return null;
    const points = [];
    for (const entry of value) {
      const point = objectRecord(entry);
      if (!point || typeof point.mode !== "string" || !Object.hasOwn(CURVE_MODE_LABELS, point.mode)) return null;
      const hasHandles = point.mode === "aligned" || point.mode === "free";
      const allowed = hasHandles ? CURVE_HANDLE_POINT_KEYS : CURVE_POINT_KEYS;
      if (Object.keys(point).some((key) => !allowed.includes(key))) return null;
      if (!inUnitRange(point.x, 0, 1) || !inUnitRange(point.y, 0, 1)) return null;
      const normalized = { x: point.x, y: point.y, mode: point.mode };
      if (hasHandles) {
        if (!inUnitRange(point.inX, -1, 0) || !inUnitRange(point.inY, -1, 1) ||
            !inUnitRange(point.outX, 0, 1) || !inUnitRange(point.outY, -1, 1)) return null;
        Object.assign(normalized, { inX: point.inX, inY: point.inY, outX: point.outX, outY: point.outY });
      }
      points.push(normalized);
    }
    if (points[0].x !== 0 || points[points.length - 1].x !== 1) return null;
    if (points.some((point, index) => index > 0 && point.x <= points[index - 1].x)) return null;
    return points;
  }

  function normalizeAngle(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    let angle = Math.round(numeric) % 360;
    if (angle > 180) angle -= 360;
    if (angle < -180) angle += 360;
    return angle === -180 ? 180 : angle;
  }

  // The evaluation below mirrors Core's programPopoutGradient.ts exactly.
  function curveAutoSlope(points, index) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (!previous) return (next.y - current.y) / (next.x - current.x);
    if (!next) return (current.y - previous.y) / (current.x - previous.x);
    if ((current.y - previous.y) * (next.y - current.y) <= 0) return 0;
    return (next.y - previous.y) / (next.x - previous.x);
  }

  function curveFittedHandle(dx, dy, width) {
    const extent = Math.abs(dx);
    return extent > width ? [dx * width / extent, dy * width / extent] : [dx, dy];
  }

  function curveHandle(points, index, side) {
    const point = points[index];
    const neighbor = points[side === "out" ? index + 1 : index - 1];
    if (!neighbor) return [0, 0];
    const width = Math.abs(neighbor.x - point.x);
    if (point.mode === "aligned" || point.mode === "free") {
      return side === "out"
        ? curveFittedHandle(point.outX || 0, point.outY || 0, width)
        : curveFittedHandle(point.inX || 0, point.inY || 0, width);
    }
    if (point.mode === "corner") return [(neighbor.x - point.x) / 3, (neighbor.y - point.y) / 3];
    const slope = curveAutoSlope(points, index);
    return side === "out" ? [width / 3, slope * width / 3] : [-width / 3, -slope * width / 3];
  }

  function curveLerp(start, end, t) {
    return start + (end - start) * t;
  }

  function curveCubic(p0, p1, p2, p3, t) {
    const a = curveLerp(p0, p1, t);
    const b = curveLerp(p1, p2, t);
    const c = curveLerp(p2, p3, t);
    return curveLerp(curveLerp(a, b, t), curveLerp(b, c, t), t);
  }

  function curveValue(curve, value) {
    const position = bounded(value, 0, 1);
    if (!Array.isArray(curve) || curve.length < 2) return position;
    let index = 0;
    while (index < curve.length - 2 && position > curve[index + 1].x) index += 1;
    const start = curve[index];
    const end = curve[index + 1];
    if (position <= start.x) return bounded(start.y, 0, 1);
    if (position >= end.x) return bounded(end.y, 0, 1);
    const [outX, outY] = curveHandle(curve, index, "out");
    const [inX, inY] = curveHandle(curve, index + 1, "in");
    let low = 0;
    let high = 1;
    for (let step = 0; step < 48; step += 1) {
      const middle = (low + high) / 2;
      if (curveCubic(start.x, start.x + outX, end.x + inX, end.x, middle) < position) low = middle;
      else high = middle;
    }
    return bounded(curveCubic(start.y, start.y + outY, end.y + inY, end.y, (low + high) / 2), 0, 1);
  }

  function gradientDirection(angle) {
    const radians = angle * Math.PI / 180;
    const snap = (value) => Math.round(value * 1e12) / 1e12 || 0;
    return { x: snap(Math.sin(radians)), y: snap(Math.cos(radians)) };
  }

  function gradientProjection(point, angle) {
    const direction = gradientDirection(angle);
    return point.x * direction.x + point.y * direction.y;
  }

  // Core's popped gradient without Scatter's per-Button jitter.
  function gradientStopColor(colors, spread, position) {
    if (colors.length === 1) return colors[0];
    const scaled = bounded(position, 0, 1) * (colors.length - 1);
    const anchor = Math.round(scaled);
    if (Math.abs(scaled - anchor) < 1e-10) return colors[anchor];
    const index = Math.floor(scaled);
    const fraction = scaled - index;
    const width = bounded(spread / 100, 0, 1);
    const blend = width > 0 ? 0.5 + (fraction - 0.5) / width : fraction < 0.5 ? 0 : 1;
    return interpolatedButtonThemeColor(colors[index], colors[index + 1], blend);
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
      const resolved = Number.isFinite(parsed) ? parsed : fallback;
      return bounded(field.integer ? Math.round(resolved) : resolved,
        finiteNumber(field.minimum, -Number.MAX_VALUE), finiteNumber(field.maximum, Number.MAX_VALUE));
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
        control.dataset.curveDisabled === "true";
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
    if (field.maximum !== undefined) input.max = String(field.maximum);
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
    // Gradient shape keys are optional so packages saved before them stay valid.
    for (const key of ["angle", "textAngle"]) {
      if (settings[key] === undefined) continue;
      if (!inUnitRange(settings[key], -360, 360)) return null;
      result[key] = settings[key];
    }
    for (const key of ["curve", "textCurve"]) {
      if (settings[key] === undefined) continue;
      const curve = normalizeCurve(settings[key]);
      if (!curve) return null;
      result[key] = curve;
    }
    if (settings.textColors !== undefined) {
      const textColors = orderedButtonThemeGradientColors(settings.textColors);
      if (textColors.length < 2 || textColors.length !== settings.textColors?.length) return null;
      result.textColors = textColors;
    }
    if (settings.textScreenTopToBottom !== undefined) {
      if (typeof settings.textScreenTopToBottom !== "boolean") return null;
      result.textScreenTopToBottom = settings.textScreenTopToBottom;
    }
    return result;
  }

  function buttonThemeEffects() {
    return Object.fromEntries([
      "hoverEnabled", "activeEnabled", "hoverColor", "activeColor",
      "hoverHighlightAmount", "activeHighlightAmount", "hoverGlowAmount", "activeGlowAmount"
    ].map((key) => [key, model.buttonTheme[key]]));
  }

  function adoptPoppedButtonSettings(value, adoptGradient = true, adoptText = adoptGradient) {
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
      model.buttonTheme.angle = normalizeAngle(settings.angle ?? 0);
      model.buttonTheme.curve = settings.curve ? cloneValue(settings.curve) : linearCurve();
      synchronizeButtonThemeGradientEndpoints();
    }
    if (adoptText) {
      model.buttonTheme.textColor = settings.textColor;
      model.buttonTheme.textColors = settings.textColors
        ? [...settings.textColors]
        : [opaqueButtonThemeColor(settings.textColor) || "#FFFFFF"];
      model.buttonTheme.textAngle = normalizeAngle(settings.textAngle ?? 0);
      model.buttonTheme.textCurve = settings.textCurve ? cloneValue(settings.textCurve) : linearCurve();
      model.buttonTheme.textScreenTopToBottom = settings.textScreenTopToBottom === true;
    }
    schedulePersistence();
    return settings;
  }

  async function readPoppedButtonSettings(
    withinOperation = false, adoptGradient = false, adoptSettings = true, adoptText = adoptGradient
  ) {
    const response = await requestAction(buttonThemeActions.settings, {}, "Reading Blender popped Button settings…", withinOperation);
    const settings = adoptSettings
      ? adoptPoppedButtonSettings(response?.settings, adoptGradient, adoptText)
      : normalizePoppedButtonSettings(response?.settings);
    if (response && !settings) setStatus("Blender returned invalid popped Button settings.", "error");
    return settings;
  }

  async function applyPoppedButtonSettings(settings, withinOperation = false, resetOverrides = false, adoptGradient = true) {
    if (busy && !withinOperation) return null;
    if (!withinOperation) setBusy(true);
    try {
      const response = await requestAction(buttonThemeActions.settings, {
        settings, ...(resetOverrides ? { resetOverrides: true } : {})
      }, "Applying Blender popped Button settings…", true);
      if (!response) return null;
      const applied = adoptPoppedButtonSettings(response.settings, adoptGradient);
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
      // Staged Fill and Text gradients wait for their own Apply buttons.
      if (settings) await applyPoppedButtonSettings({ ...settings, ...effects }, true, false, false);
    } finally {
      setBusy(false);
    }
  }

  function buttonThemeTextSettings() {
    const colors = model.buttonTheme.textColors;
    return {
      textColor: colors[0],
      ...(colors.length > 1 ? { textColors: [...colors] } : {}),
      textAngle: model.buttonTheme.textAngle,
      textCurve: cloneValue(model.buttonTheme.textCurve),
      textScreenTopToBottom: model.buttonTheme.textScreenTopToBottom
    };
  }

  // Text applies through the settings contract; the staged Fill gradient is left untouched.
  async function applyButtonThemeText() {
    if (busy) return;
    setBusy(true);
    try {
      const settings = await readPoppedButtonSettings(true);
      if (!settings) return;
      const { textColors: _replacedTextColors, ...rest } = settings;
      await applyPoppedButtonSettings({ ...rest, ...buttonThemeTextSettings() }, true, false, false);
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
    model.buttonTheme.angle = normalizeAngle(finiteNumber(state.angle, model.buttonTheme.angle));
    model.buttonTheme.curve = normalizeCurve(state.curve) || model.buttonTheme.curve;
    const textColors = orderedButtonThemeGradientColors(state.textColors);
    if (textColors.length) model.buttonTheme.textColors = textColors;
    model.buttonTheme.textAngle = normalizeAngle(finiteNumber(state.textAngle, model.buttonTheme.textAngle));
    model.buttonTheme.textCurve = normalizeCurve(state.textCurve) || model.buttonTheme.textCurve;
    model.buttonTheme.textScreenTopToBottom = typeof state.textScreenTopToBottom === "boolean"
      ? state.textScreenTopToBottom
      : model.buttonTheme.textScreenTopToBottom;
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

  function applySavedFields(response) {
    const patch = objectRecord(response.fieldPatch) || objectRecord(response.values);
    if (!patch) return;
    const gridDefaults = Object.fromEntries(config.picture.gridFieldIds.map((fieldId) =>
      [fieldId, cloneValue(fieldById.get(fieldId).defaultValue)]));
    patchFields({ ...gridDefaults, ...patch });
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
      screenTopToBottom: model.buttonTheme.screenTopToBottom,
      angle: model.buttonTheme.angle,
      curve: cloneValue(model.buttonTheme.curve)
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
        await readPoppedButtonSettings(true, false, true, true);
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
    if (response && response.selected !== false) applySavedFields(response);
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
      applySavedFields(response);
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

  function gradientStopLabel(channel, index) {
    const colors = model.buttonTheme[GRADIENT_CHANNELS[channel].colorsKey];
    if (colors.length === 1) return buttonThemeConfig.soloColorLabel || "Color";
    if (index === 0) return buttonThemeConfig.topLabel || "Start";
    if (index === colors.length - 1) return buttonThemeConfig.bottomLabel || "End";
    return `Color ${index + 1}`;
  }

  function renderGradientStopControl(channel, index) {
    const spec = GRADIENT_CHANNELS[channel];
    const colors = () => model.buttonTheme[spec.colorsKey];
    const labelText = gradientStopLabel(channel, index);
    const control = element("label", "button-theme-gradient__color");
    control.append(element("span", "button-theme-gradient__label", labelText));
    const inputs = element("span", "button-theme-gradient__color-inputs");
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = colors()[index];
    picker.setAttribute("aria-label", `${spec.ariaPrefix}${labelText} color picker`);
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = colors()[index];
    textInput.setAttribute("aria-label", `${spec.ariaPrefix}${labelText} color`);
    const update = (value) => {
      const color = normalizeHex(value);
      if (!color) {
        textInput.value = colors()[index];
        return;
      }
      colors()[index] = color;
      if (channel === "fill") synchronizeButtonThemeGradientEndpoints();
      picker.value = color;
      textInput.value = color;
      schedulePersistence();
      redrawGradientChannel(channel);
    };
    picker.addEventListener("input", () => update(picker.value));
    textInput.addEventListener("change", () => update(textInput.value));
    inputs.append(picker, textInput);
    control.append(inputs);
    return control;
  }

  function populateGradientStops(channel, stops) {
    stops.replaceChildren();
    model.buttonTheme[GRADIENT_CHANNELS[channel].colorsKey].forEach((_color, index) => {
      stops.append(renderGradientStopControl(channel, index));
    });
  }

  function renderGradientStops(channel) {
    const stops = element("div", "button-theme-gradient__stops");
    populateGradientStops(channel, stops);
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
      if (key === "spread") redrawGradientChannel("fill");
    });
    control.append(labelRow, slider);
    return control;
  }

  function renderGradientScreenControl(channel) {
    const key = GRADIENT_CHANNELS[channel].screenKey;
    const control = element("label", "button-theme-gradient__screen-toggle");
    control.title = buttonThemeConfig.screenTopToBottomTooltip ||
      "Blend across every open popped Button on each monitor instead of within each window.";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = model.buttonTheme[key] === true;
    checkbox.addEventListener("change", () => {
      model.buttonTheme[key] = checkbox.checked === true;
      schedulePersistence();
    });
    control.append(
      checkbox,
      element(
        "span",
        "button-theme-gradient__screen-label",
        buttonThemeConfig.screenTopToBottomLabel || "Whole Screen"
      )
    );
    return control;
  }

  function resampledChannelColors(channel, count) {
    const colors = model.buttonTheme[GRADIENT_CHANNELS[channel].colorsKey];
    if (count === 1) return [colors[0]];
    const source = colors.length === 1 ? [colors[0], colors[0]] : colors;
    return resampledButtonThemeGradientColors(source, count, source[0], source[source.length - 1]);
  }

  function renderGradientColorCountControl(channel, stops) {
    const spec = GRADIENT_CHANNELS[channel];
    const isFill = channel === "fill";
    const minimum = isFill ? boundedInteger(buttonThemeConfig.gradientColorCountMinimum, 2, 2, 16) : 1;
    const maximum = isFill ? boundedInteger(buttonThemeConfig.gradientColorCountMaximum, 16, minimum, 16) : 16;
    const labelText = isFill
      ? buttonThemeConfig.gradientColorCountLabel || "Gradient Colors"
      : buttonThemeConfig.textColorCountLabel || "Text Colors";
    const control = element("label", "button-theme-gradient__color-count");
    control.title = isFill
      ? buttonThemeConfig.gradientColorCountTooltip ||
        "Choose how many colors the popped-Button gradient uses. Refill samples this many colors from the current Theme image."
      : buttonThemeConfig.textColorCountTooltip ||
        "Choose how many colors the text gradient uses. One color keeps every label a solid color.";
    control.append(element("span", "button-theme-gradient__color-count-label", labelText));
    const inputs = element("span", "button-theme-gradient__color-count-inputs");
    const current = () => model.buttonTheme[spec.colorsKey].length;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(minimum);
    slider.max = String(maximum);
    slider.step = "1";
    slider.value = String(current());
    slider.setAttribute("aria-label", `${labelText} slider`);
    const number = document.createElement("input");
    number.type = "number";
    number.min = String(minimum);
    number.max = String(maximum);
    number.step = "1";
    number.value = String(current());
    number.setAttribute("aria-label", labelText);
    const update = (value) => {
      const nextCount = boundedInteger(value, current(), minimum, maximum);
      model.buttonTheme[spec.colorsKey] = resampledChannelColors(channel, nextCount);
      if (isFill) {
        model.buttonTheme.gradientColorCount = nextCount;
        synchronizeButtonThemeGradientEndpoints();
      }
      slider.value = String(nextCount);
      number.value = String(nextCount);
      schedulePersistence();
      populateGradientStops(channel, stops);
      redrawGradientChannel(channel);
    };
    slider.addEventListener("input", () => update(slider.value));
    number.addEventListener("change", () => update(number.value));
    inputs.append(slider, number);
    control.append(inputs);
    return control;
  }

  function svgElement(tagName, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tagName);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000 || 0;
  }

  function channelGradient(channel) {
    const spec = GRADIENT_CHANNELS[channel];
    return {
      colors: model.buttonTheme[spec.colorsKey],
      curve: model.buttonTheme[spec.curveKey],
      angle: model.buttonTheme[spec.angleKey],
      spread: channel === "fill" ? model.buttonTheme.spread : 100
    };
  }

  function channelColorAt(channel, position) {
    const { colors, curve, spread } = channelGradient(channel);
    return gradientStopColor(colors, spread, curveValue(curve, position));
  }

  function registerGradientRedraw(channel, redraw) {
    const redraws = gradientRedraws.get(channel) || [];
    redraws.push(redraw);
    gradientRedraws.set(channel, redraws);
    redraw();
  }

  function redrawGradientChannel(channel) {
    for (const redraw of gradientRedraws.get(channel) || []) redraw();
    for (const redraw of gradientRedraws.get("sample") || []) redraw();
  }

  function fillLinearGradient(gradient, sample, count = 48) {
    gradient.replaceChildren(...Array.from({ length: count + 1 }, (_, index) => svgElement("stop", {
      offset: String(index / count),
      "stop-color": sample(index / count)
    })));
  }

  function curvePathData(curve, samples = 160) {
    return Array.from({ length: samples + 1 }, (_, index) => {
      const x = index / samples;
      return `${index === 0 ? "M" : "L"}${round4(x * 100)} ${round4(100 - curveValue(curve, x) * 100)}`;
    }).join("");
  }

  function editableCurve(channel) {
    return model.buttonTheme[GRADIENT_CHANNELS[channel].curveKey];
  }

  function handlePoint(x, y, inX, inY, outX, outY) {
    return { x, y, mode: "free", inX, inY, outX, outY };
  }

  function stepsCurve(count) {
    const bands = Math.max(2, Math.min(16, count));
    const points = [{ x: 0, y: 0, mode: "corner" }];
    for (let band = 1; band < bands; band += 1) {
      const edge = round4(band / bands);
      points.push(
        { x: round4(edge - 0.004), y: round4((band - 1) / (bands - 1)), mode: "corner" },
        { x: edge, y: round4(band / (bands - 1)), mode: "corner" }
      );
    }
    points.push({ x: 1, y: 1, mode: "corner" });
    return points;
  }

  const CURVE_PRESETS = [
    ["Linear", "An even blend from Start to End.", () => linearCurve()],
    ["Ease In", "Hold near Start, then speed toward End.", () => [
      handlePoint(0, 0, 0, 0, 0.42, 0), handlePoint(1, 1, 0, 0, 0, 0)
    ]],
    ["Ease Out", "Leave Start quickly, then settle into End.", () => [
      handlePoint(0, 0, 0, 0, 0, 0), handlePoint(1, 1, -0.42, 0, 0, 0)
    ]],
    ["Ease In-Out", "Gentle at both ends, fastest through the middle.", () => [
      handlePoint(0, 0, 0, 0, 0.42, 0), handlePoint(1, 1, -0.42, 0, 0, 0)
    ]],
    ["Hold Middle", "Rush through both ends and linger on the middle colors.", () => [
      handlePoint(0, 0, 0, 0, 0, 0.6), handlePoint(1, 1, 0, -0.6, 0, 0)
    ]],
    ["Peak", "Start at both edges and reach End in the middle.", () => [
      { x: 0, y: 0, mode: "auto" }, { x: 0.5, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }
    ]],
    ["Valley", "End at both edges and Start in the middle.", () => [
      { x: 0, y: 1, mode: "auto" }, { x: 0.5, y: 0, mode: "auto" }, { x: 1, y: 1, mode: "auto" }
    ]],
    ["Wave", "Sweep through the colors twice.", () => [
      { x: 0, y: 0, mode: "auto" }, { x: 0.25, y: 1, mode: "auto" }, { x: 0.5, y: 0, mode: "auto" },
      { x: 0.75, y: 1, mode: "auto" }, { x: 1, y: 0, mode: "auto" }
    ]],
    ["Steps", "Solid bands, one per color, with hard edges.", (channel) => stepsCurve(
      model.buttonTheme[GRADIENT_CHANNELS[channel].colorsKey].length
    )]
  ];

  function replaceCurve(channel, curve) {
    model.buttonTheme[GRADIENT_CHANNELS[channel].curveKey] = curve;
    curveSelection[channel] = -1;
    schedulePersistence();
    redrawGradientChannel(channel);
  }

  function flippedCurve(curve) {
    return curve.map((point) => point.mode === "aligned" || point.mode === "free"
      ? { ...point, y: round4(1 - point.y), inY: round4(-point.inY), outY: round4(-point.outY) }
      : { ...point, y: round4(1 - point.y) });
  }

  function mirroredCurve(curve) {
    return curve.slice().reverse().map((point) => point.mode === "aligned" || point.mode === "free"
      ? {
          x: round4(1 - point.x), y: point.y, mode: point.mode,
          inX: round4(-point.outX), inY: point.outY, outX: round4(-point.inX), outY: point.inY
        }
      : { x: round4(1 - point.x), y: point.y, mode: point.mode });
  }

  function materializedCurvePoint(curve, index, mode) {
    const point = curve[index];
    if (point.mode === "aligned" || point.mode === "free") return { ...point, mode };
    const [inX, inY] = curveHandle(curve, index, "in");
    const [outX, outY] = curveHandle(curve, index, "out");
    return {
      x: point.x, y: point.y, mode,
      inX: round4(bounded(inX, -1, 0)), inY: round4(bounded(inY, -1, 1)),
      outX: round4(bounded(outX, 0, 1)), outY: round4(bounded(outY, -1, 1))
    };
  }

  function setCurvePointMode(channel, index, mode) {
    const curve = editableCurve(channel);
    const point = curve[index];
    if (!point || point.mode === mode) return;
    curve[index] = mode === "aligned" || mode === "free"
      ? materializedCurvePoint(curve, index, mode)
      : { x: point.x, y: point.y, mode };
    schedulePersistence();
    redrawGradientChannel(channel);
  }

  function insertCurvePoint(channel, position) {
    const curve = editableCurve(channel);
    if (curve.length >= CURVE_MAX_POINTS) {
      setStatus(`A curve holds at most ${CURVE_MAX_POINTS} points.`, "error");
      return -1;
    }
    const x = round4(bounded(position.x, 0, 1));
    const index = curve.findIndex((point) => point.x >= x);
    if (index <= 0 || x - curve[index - 1].x < CURVE_MIN_GAP || curve[index].x - x < CURVE_MIN_GAP) return -1;
    curve.splice(index, 0, { x, y: round4(bounded(position.y, 0, 1)), mode: "auto" });
    curveSelection[channel] = index;
    return index;
  }

  function snapped(value, snap) {
    return snap ? Math.round(value * 20) / 20 : value;
  }

  function moveCurvePoint(channel, index, position, snap = false) {
    const curve = editableCurve(channel);
    const point = curve[index];
    if (!point) return;
    if (index > 0 && index < curve.length - 1 && Number.isFinite(position.x)) {
      const previous = curve[index - 1].x;
      const next = curve[index + 1].x;
      const x = round4(Math.min(next - CURVE_MIN_GAP, Math.max(previous + CURVE_MIN_GAP, snapped(position.x, snap))));
      if (x > previous && x < next) point.x = x;
    }
    if (Number.isFinite(position.y)) point.y = round4(bounded(snapped(position.y, snap), 0, 1));
  }

  function moveCurveHandle(channel, index, side, position, breakHandles = false, snap = false) {
    const curve = editableCurve(channel);
    if (!curve[index]) return;
    if (curve[index].mode === "auto" || curve[index].mode === "corner") {
      curve[index] = materializedCurvePoint(curve, index,
        curve[index].mode === "auto" && !breakHandles ? "aligned" : "free");
    } else if (breakHandles) {
      curve[index].mode = "free";
    }
    const point = curve[index];
    const dx = side === "out"
      ? bounded(snapped(position.x, snap) - point.x, 0, 1)
      : bounded(snapped(position.x, snap) - point.x, -1, 0);
    const dy = bounded(snapped(position.y, snap) - point.y, -1, 1);
    point[`${side}X`] = round4(dx);
    point[`${side}Y`] = round4(dy);
    if (point.mode !== "aligned") return;
    const other = side === "out" ? "in" : "out";
    const ownLength = Math.hypot(dx, dy);
    const otherLength = Math.hypot(point[`${other}X`], point[`${other}Y`]);
    if (ownLength < 1e-6 || otherLength < 1e-6) return;
    point[`${other}X`] = round4(other === "out"
      ? bounded(-dx * otherLength / ownLength, 0, 1)
      : bounded(-dx * otherLength / ownLength, -1, 0));
    point[`${other}Y`] = round4(bounded(-dy * otherLength / ownLength, -1, 1));
  }

  function deleteCurvePoint(channel, index) {
    const curve = editableCurve(channel);
    if (index <= 0 || index >= curve.length - 1) return;
    curve.splice(index, 1);
    curveSelection[channel] = -1;
    schedulePersistence();
    redrawGradientChannel(channel);
  }

  function curveToolButton(label, tooltip, handler) {
    const button = element("button", "gradient-curve__tool", label);
    button.type = "button";
    button.title = tooltip;
    button.addEventListener("click", () => {
      if (!busy) handler();
    });
    return button;
  }

  function setCurveControlDisabled(control, disabled) {
    control.dataset.curveDisabled = String(disabled);
    control.disabled = busy || disabled;
  }

  function curveGlyph(curve) {
    const glyph = svgElement("svg", { class: "gradient-curve__glyph", viewBox: "-6 -6 112 112", "aria-hidden": "true" });
    glyph.append(
      svgElement("rect", { class: "gradient-curve__glyph-frame", x: 0, y: 0, width: 100, height: 100, rx: 8 }),
      svgElement("path", { class: "gradient-curve__glyph-line", d: curvePathData(curve, 40) })
    );
    return glyph;
  }

  function renderGradientCurveEditor(channel) {
    const spec = GRADIENT_CHANNELS[channel];
    const editor = element("div", "gradient-curve");
    const box = svgElement("svg", {
      class: "gradient-curve__box",
      viewBox: "-10 -4 114 121",
      tabindex: "0",
      role: "application",
      "aria-label": `${spec.title} gradient curve. Click to add a point, drag points or handles, double-click a point to delete it.`
    });
    const stopsGradient = svgElement("linearGradient", { id: `${channel}-curve-stops`, x1: 0, y1: 1, x2: 0, y2: 0 });
    const resultGradient = svgElement("linearGradient", { id: `${channel}-curve-result`, x1: 0, y1: 0, x2: 1, y2: 0 });
    const defs = svgElement("defs");
    defs.append(stopsGradient, resultGradient);
    const dynamic = svgElement("g");
    box.append(
      defs,
      svgElement("rect", { class: "gradient-curve__frame", x: 0, y: 0, width: 100, height: 100, rx: 1.5 }),
      svgElement("path", { class: "gradient-curve__grid", d: "M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" }),
      svgElement("line", { class: "gradient-curve__diagonal", x1: 0, y1: 100, x2: 100, y2: 0 }),
      svgElement("rect", { class: "gradient-curve__strip", x: -8.5, y: 0, width: 5, height: 100, rx: 1, fill: `url(#${channel}-curve-stops)` }),
      svgElement("rect", { class: "gradient-curve__strip", x: 0, y: 104, width: 100, height: 10, rx: 1.5, fill: `url(#${channel}-curve-result)` }),
      dynamic
    );

    const tools = element("div", "gradient-curve__tools");
    const presets = element("div", "gradient-curve__presets");
    CURVE_PRESETS.forEach(([label, tooltip, build]) => {
      const button = curveToolButton("", `${label}: ${tooltip}`, () => replaceCurve(channel, build(channel)));
      button.className = "gradient-curve__tool gradient-curve__preset";
      button.setAttribute("aria-label", `${label} curve`);
      button.append(curveGlyph(build(channel)));
      presets.append(button);
    });
    const transforms = element("div", "gradient-curve__row");
    transforms.append(
      curveToolButton("Flip", "Turn the curve upside down so the colors run in reverse.", () =>
        replaceCurve(channel, flippedCurve(editableCurve(channel)))),
      curveToolButton("Mirror", "Mirror the curve left to right.", () =>
        replaceCurve(channel, mirroredCurve(editableCurve(channel)))),
      curveToolButton("Reset", "Return to a straight line.", () => replaceCurve(channel, linearCurve()))
    );
    const pointPanel = element("div", "gradient-curve__point");
    const pointLabel = element("span", "gradient-curve__point-label");
    const modes = element("div", "gradient-curve__modes");
    const modeButtons = Object.entries(CURVE_MODE_LABELS).map(([mode, label]) => {
      const button = curveToolButton(label, CURVE_MODE_TOOLTIPS[mode], () =>
        setCurvePointMode(channel, curveSelection[channel], mode));
      button.dataset.curveMode = mode;
      modes.append(button);
      return button;
    });
    const numberField = (labelText, axis) => {
      const field = element("label", "gradient-curve__number");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "0.1";
      input.setAttribute("aria-label", `${spec.title} point ${labelText.toLowerCase()} percent`);
      input.addEventListener("change", () => {
        const index = curveSelection[channel];
        const value = Number(input.value) / 100;
        if (!editableCurve(channel)[index] || !Number.isFinite(value)) return;
        moveCurvePoint(channel, index, axis === "x" ? { x: value, y: Number.NaN } : { x: Number.NaN, y: value });
        schedulePersistence();
        redrawGradientChannel(channel);
      });
      field.append(element("span", "", labelText), input);
      return { field, input };
    };
    const position = numberField("Position", "x");
    const value = numberField("Value", "y");
    const remove = curveToolButton("Delete", "Delete the selected point.", () =>
      deleteCurvePoint(channel, curveSelection[channel]));
    const fields = element("div", "gradient-curve__row");
    fields.append(position.field, value.field, remove);
    pointPanel.append(pointLabel, modes, fields);
    tools.append(presets, transforms, pointPanel, element("p", "gradient-curve__hint",
      "Click the box to add a point. Drag points or handles; double-click or Delete removes a point. Shift snaps, Alt breaks a handle."));
    editor.append(box, tools);

    const redraw = () => {
      const curve = editableCurve(channel);
      const { colors, spread } = channelGradient(channel);
      if (!curve[curveSelection[channel]]) curveSelection[channel] = -1;
      const selected = curveSelection[channel];
      fillLinearGradient(stopsGradient, (offset) => gradientStopColor(colors, spread, offset));
      fillLinearGradient(resultGradient, (offset) => channelColorAt(channel, offset), 64);
      const guides = colors.length > 1 ? colors.map((_color, index) => {
        const y = round4(100 - index * 100 / (colors.length - 1));
        return `M0 ${y}H100`;
      }).join("") : "";
      const shapes = [
        svgElement("path", { class: "gradient-curve__guides", d: guides || "M0 0" }),
        svgElement("path", { class: "gradient-curve__line", d: curvePathData(curve) })
      ];
      const point = curve[selected];
      if (point) {
        for (const side of ["in", "out"]) {
          if ((side === "in" && selected === 0) || (side === "out" && selected === curve.length - 1)) continue;
          const [dx, dy] = curveHandle(curve, selected, side);
          // Draw long handles shortened so their grip stays inside the box and can be grabbed.
          const endY = point.y + dy;
          const fit = endY > 1.02 ? (1.02 - point.y) / dy : endY < -0.02 ? (-0.02 - point.y) / dy : 1;
          const hx = (point.x + dx * fit) * 100;
          const hy = 100 - (point.y + dy * fit) * 100;
          shapes.push(
            svgElement("line", { class: "gradient-curve__handle-line", x1: point.x * 100, y1: 100 - point.y * 100, x2: hx, y2: hy }),
            svgElement("circle", { class: "gradient-curve__handle", cx: hx, cy: hy, r: 1.9 })
          );
          const hit = svgElement("circle", { class: "gradient-curve__hit", cx: hx, cy: hy, r: 4.5 });
          hit.dataset.kind = "handle";
          hit.dataset.index = String(selected);
          hit.dataset.side = side;
          shapes.push(hit);
        }
      }
      curve.forEach((entry, index) => {
        const cx = entry.x * 100;
        const cy = 100 - entry.y * 100;
        shapes.push(svgElement("circle", {
          class: `gradient-curve__point-dot${index === selected ? " gradient-curve__point-dot--selected" : ""}`,
          cx, cy, r: entry.mode === "corner" ? 2.2 : 2.5
        }));
        const hit = svgElement("circle", { class: "gradient-curve__hit", cx, cy, r: 5 });
        hit.dataset.kind = "point";
        hit.dataset.index = String(index);
        shapes.push(hit);
      });
      dynamic.replaceChildren(...shapes);
      const endpoint = selected === 0 || selected === curve.length - 1;
      pointLabel.textContent = point
        ? `Point ${selected + 1} of ${curve.length}${endpoint ? selected === 0 ? " · Start" : " · End" : ""}`
        : `${curve.length} points · select one to edit it`;
      modeButtons.forEach((button) => {
        button.setAttribute("aria-pressed", String(Boolean(point) && point.mode === button.dataset.curveMode));
        setCurveControlDisabled(button, !point);
      });
      position.input.value = point ? String(round4(point.x * 100)) : "";
      value.input.value = point ? String(round4(point.y * 100)) : "";
      setCurveControlDisabled(position.input, !point || endpoint);
      setCurveControlDisabled(value.input, !point);
      setCurveControlDisabled(remove, !point || endpoint);
    };

    let drag = null;
    const unitPoint = (event) => {
      const matrix = typeof box.getScreenCTM === "function" ? box.getScreenCTM() : null;
      if (!matrix || typeof DOMPoint !== "function") return null;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      return { x: local.x / 100, y: 1 - local.y / 100 };
    };
    box.addEventListener("pointerdown", (event) => {
      if (busy || event.button !== 0) return;
      const target = event.target?.dataset || {};
      if (target.kind === "handle") {
        drag = { kind: "handle", index: Number(target.index), side: target.side };
      } else if (target.kind === "point") {
        curveSelection[channel] = Number(target.index);
        drag = { kind: "point", index: curveSelection[channel] };
      } else {
        const position = unitPoint(event);
        if (!position || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) return;
        const inserted = insertCurvePoint(channel, position);
        if (inserted < 0) return;
        drag = { kind: "point", index: inserted };
      }
      box.setPointerCapture?.(event.pointerId);
      box.focus?.();
      event.preventDefault();
      redrawGradientChannel(channel);
    });
    box.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const position = unitPoint(event);
      if (!position) return;
      if (drag.kind === "point") moveCurvePoint(channel, drag.index, position, event.shiftKey);
      else moveCurveHandle(channel, drag.index, drag.side, position, event.altKey, event.shiftKey);
      redrawGradientChannel(channel);
    });
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      schedulePersistence();
    };
    box.addEventListener("pointerup", endDrag);
    box.addEventListener("pointercancel", endDrag);
    box.addEventListener("dblclick", (event) => {
      const target = event.target?.dataset || {};
      if (!busy && target.kind === "point") deleteCurvePoint(channel, Number(target.index));
    });
    box.addEventListener("keydown", (event) => {
      const index = curveSelection[channel];
      const point = editableCurve(channel)[index];
      if (busy || !point) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteCurvePoint(channel, index);
      } else if (event.key.startsWith("Arrow")) {
        const step = event.shiftKey ? 0.05 : 0.01;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0;
        moveCurvePoint(channel, index, { x: point.x + dx, y: point.y + dy });
        schedulePersistence();
        redrawGradientChannel(channel);
      } else {
        return;
      }
      event.preventDefault();
    });

    registerGradientRedraw(channel, redraw);
    return editor;
  }

  function renderGradientAngleControl(channel) {
    const spec = GRADIENT_CHANNELS[channel];
    const control = element("div", "gradient-angle");
    control.title = "Tilt the gradient. 0° runs top to bottom, 90° left to right, 180° bottom to top and -90° right to left.";
    const dial = svgElement("svg", {
      class: "gradient-angle__dial",
      viewBox: "-24 -24 48 48",
      tabindex: "0",
      role: "slider",
      "aria-label": `${spec.title} angle dial`,
      "aria-valuemin": "-180",
      "aria-valuemax": "180"
    });
    const dialGradient = svgElement("linearGradient", { id: `${channel}-angle-fill` });
    const defs = svgElement("defs");
    defs.append(dialGradient);
    const arrow = svgElement("g", { class: "gradient-angle__arrow" });
    arrow.append(
      svgElement("line", { x1: 0, y1: -13, x2: 0, y2: 12 }),
      svgElement("path", { d: "M-4.5 8L0 14L4.5 8" })
    );
    dial.append(
      defs,
      svgElement("circle", { class: "gradient-angle__face", r: 20, fill: `url(#${channel}-angle-fill)` }),
      arrow
    );
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "-180";
    slider.max = "180";
    slider.step = "1";
    slider.setAttribute("aria-label", `${spec.title} angle slider`);
    const number = document.createElement("input");
    number.type = "number";
    number.min = "-180";
    number.max = "180";
    number.step = "1";
    number.setAttribute("aria-label", `${spec.title} angle`);
    const setAngle = (value) => {
      model.buttonTheme[spec.angleKey] = normalizeAngle(value);
      schedulePersistence();
      redrawGradientChannel(channel);
    };
    slider.addEventListener("input", () => setAngle(slider.value));
    number.addEventListener("change", () => setAngle(number.value));
    let dragging = false;
    const dialAngle = (event) => {
      const matrix = typeof dial.getScreenCTM === "function" ? dial.getScreenCTM() : null;
      if (!matrix || typeof DOMPoint !== "function") return null;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      if (Math.hypot(local.x, local.y) < 1) return null;
      const angle = Math.atan2(local.x, local.y) * 180 / Math.PI;
      return event.shiftKey ? Math.round(angle / 15) * 15 : angle;
    };
    dial.addEventListener("pointerdown", (event) => {
      if (busy || event.button !== 0) return;
      dragging = true;
      dial.setPointerCapture?.(event.pointerId);
      const angle = dialAngle(event);
      if (angle !== null) setAngle(angle);
      event.preventDefault();
    });
    dial.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const angle = dialAngle(event);
      if (angle !== null) setAngle(angle);
    });
    const stop = () => {
      dragging = false;
    };
    dial.addEventListener("pointerup", stop);
    dial.addEventListener("pointercancel", stop);
    dial.addEventListener("keydown", (event) => {
      if (busy) return;
      const step = event.shiftKey ? 15 : 1;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") setAngle(model.buttonTheme[spec.angleKey] + step);
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") setAngle(model.buttonTheme[spec.angleKey] - step);
      else return;
      event.preventDefault();
    });
    const inputs = element("span", "gradient-angle__inputs");
    inputs.append(slider, number);
    control.append(dial, element("span", "gradient-angle__label", buttonThemeConfig.angleLabel || "Angle"), inputs);
    registerGradientRedraw(channel, () => {
      const angle = model.buttonTheme[spec.angleKey];
      const direction = gradientDirection(angle);
      slider.value = String(angle);
      number.value = String(angle);
      dial.setAttribute("aria-valuenow", String(angle));
      dial.setAttribute("aria-valuetext", `${angle} degrees`);
      arrow.setAttribute("transform", `rotate(${-angle})`);
      for (const [name, value] of [
        ["x1", 0.5 - direction.x / 2], ["y1", 0.5 - direction.y / 2],
        ["x2", 0.5 + direction.x / 2], ["y2", 0.5 + direction.y / 2]
      ]) dialGradient.setAttribute(name, String(round4(value)));
      fillLinearGradient(dialGradient, (offset) => channelColorAt(channel, offset), 24);
    });
    return control;
  }

  // A schematic grid: every chip uses the page's copy of Core's projection and curve math.
  function renderGradientSample() {
    const sample = element("div", "button-theme-sample");
    sample.title = "Sample layout: how the Fill and Text gradients, curves and angles fall across a grid of Buttons in one window. Scatter is not shown.";
    const chips = [];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        const chip = element("span", "button-theme-sample__button", "Aa");
        chips.push({ chip, center: { x: column * 58, y: row * 28 } });
        sample.append(chip);
      }
    }
    registerGradientRedraw("sample", () => {
      for (const channel of ["fill", "text"]) {
        const { angle } = channelGradient(channel);
        const projections = chips.map(({ center }) => gradientProjection(center, angle));
        const minimum = Math.min(...projections);
        const maximum = Math.max(...projections);
        chips.forEach(({ chip }, index) => {
          const position = maximum > minimum ? (projections[index] - minimum) / (maximum - minimum) : 0;
          const color = channelColorAt(channel, position);
          if (channel === "fill") chip.style.backgroundColor = color;
          else chip.style.color = color;
        });
      }
    });
    return sample;
  }

  function renderGradientChannel(channel) {
    const spec = GRADIENT_CHANNELS[channel];
    const box = element("section", `button-theme-channel button-theme-channel--${channel}`);
    const heading = element("div", "theme-card__heading");
    heading.append(element("h3", "", spec.title));
    const controls = element("div", channel === "fill"
      ? "button-theme-gradient"
      : "button-theme-gradient button-theme-gradient--text");
    const stops = renderGradientStops(channel);
    controls.append(stops, renderGradientColorCountControl(channel, stops));
    if (channel === "fill") {
      controls.append(
        renderButtonThemeRangeControl(buttonThemeConfig.spreadLabel || "Spread", "spread"),
        renderButtonThemeRangeControl(buttonThemeConfig.scatterLabel || "Scatter", "scatter")
      );
    }
    const footer = element("div", "button-theme-channel__footer");
    footer.append(
      renderGradientScreenControl(channel),
      channel === "fill"
        ? actionButton(localActions.applyButtonGradient, applyButtonThemeGradient)
        : actionButton(localActions.applyButtonText, applyButtonThemeText)
    );
    controls.append(renderGradientCurveEditor(channel), renderGradientAngleControl(channel), footer);
    box.append(heading, controls);
    return box;
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
        ? "Locked: fill and text gradients, curves, angles, Spread, Scatter, highlights and glow stay as they are when switching packages. Unlock to restore the selected package's saved appearance."
        : "Lock the entire popped Button appearance: fill and text gradients, curves, angles, Spread, Scatter, highlights and glow. The lock is temporary and does not change saved packages."
    ));
    if (buttonThemeScanNote) section.append(element("p", "button-theme-effects__help button-theme-scan-note", buttonThemeScanNote));

    const actionsRow = element("div", "theme-row theme-row--actions button-theme-actions");
    actionsRow.append(
      actionButton(buttonThemeActions.scan, rescanButtonTheme),
      actionButton(buttonThemeActions.apply, applyButtonThemeBuckets),
      actionButton(localActions.refillButtonColors, refillButtonTheme),
      actionButton(localActions.scatterButtonColors, scatterButtonTheme),
      actionButton(buttonThemeActions.toggleText, toggleButtonThemeText)
    );
    section.append(actionsRow);

    const gradients = element("div", "button-theme-gradients");
    gradients.append(renderGradientSample(), renderGradientChannel("fill"), renderGradientChannel("text"));
    section.append(gradients);

    if (model.buttonTheme.buckets.length) {
      const buckets = element("div", "button-theme-buckets");
      model.buttonTheme.buckets.forEach((bucket) => buckets.append(renderButtonThemeBucket(bucket)));
      section.append(buckets);
    }
    section.append(renderButtonThemeEffects());
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
      "Highlights and glow apply to every Blender popped Button. Lock All Popped Button Settings above includes these controls and both gradients."
    );
    const grid = element("div", "button-theme-effects__grid");
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
    if (config.picture.gridHelp) section.append(element("p", "button-theme-effects__help", config.picture.gridHelp));
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
    gradientRedraws.clear();
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
