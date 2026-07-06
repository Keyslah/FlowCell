import * as Babel from "@babel/standalone";
import React from "react";
import { createRoot } from "react-dom/client";
import { install } from "@twind/core";
import presetTailwind from "@twind/preset-tailwind";

const tw = install({
  presets: [presetTailwind()]
});

const runtimeRoot = document.getElementById("runtime-root");
let reactRoot = null;
let lastHostConfig = null;
let scopeResizeObserver = null;
let hostClickEnabled = false;

const DEFAULT_PAYLOAD = {
  schemaVersion: 1,
  renderTarget: "button",
  group: {
    id: 0,
    name: "Unassigned"
  },
  panel: {
    id: "",
    name: "",
    programTabId: 0,
    programLabel: ""
  },
  button: {
    id: "",
    label: "FlowCell",
    tooltip: "",
    shortcut: "",
    kind: "script",
    target: "",
    accentColor: "#9CFF18",
    styleGroupId: 0
  },
  states: {
    hovered: false,
    active: false,
    pressed: false,
    disabled: false,
    selected: false,
    longLabel: false
  }
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildDefaultButtonMarkup = (payload) => {
  const label = escapeHtml(payload?.button?.label || "FlowCell");
  const shortcut = escapeHtml(payload?.button?.shortcut || "");
  const badge = shortcut
    ? `<span class="flowcell-default-shortcut">${shortcut}</span>`
    : "";

  return `
    <div class="flowcell-default-button" role="presentation" aria-hidden="true">
      <span class="flowcell-default-sheen"></span>
      <span class="flowcell-default-label">${label}</span>
      ${badge}
    </div>
  `;
};

const buildDefaultPanelMarkup = (payload) => {
  const buttons = Array.isArray(payload?.buttons) ? payload.buttons : [];
  const items = buttons
    .map((buttonPayload) => {
      const label = escapeHtml(buttonPayload?.button?.label || "FlowCell");
      return `
        <div class="flowcell-default-panel-button" role="presentation" aria-hidden="true" data-button-id="${escapeHtml(buttonPayload?.button?.id || "")}">
          ${label}
        </div>
      `;
    })
    .join("");

  return `
    <div class="flowcell-default-panel">
      <div class="flowcell-default-panel-title">${escapeHtml(payload?.panel?.name || "Panel")}</div>
      <div class="flowcell-default-panel-grid">${items}</div>
    </div>
  `;
};

const buildDefaultCss = () => `
  :root {
    color-scheme: dark;
  }

  body {
    background: transparent;
  }

  #flowcell-runtime-scope {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    user-select: none;
    --flowcell-accent: var(--flowcell-accent-color, #9cff18);
  }

  #flowcell-runtime-scope,
  #flowcell-runtime-scope *,
  #flowcell-runtime-scope *::before,
  #flowcell-runtime-scope *::after {
    user-select: none;
  }

  .flowcell-default-button,
  .flowcell-default-panel-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    min-height: 40px;
    box-sizing: border-box;
    padding: 8px 16px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 16px;
    background:
      radial-gradient(circle at top, rgba(255,255,255,0.28), transparent 50%),
      linear-gradient(180deg, rgba(44, 61, 19, 0.94), rgba(17, 24, 8, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.22),
      0 0 0 1px rgba(0,0,0,0.08),
      0 10px 24px rgba(0,0,0,0.28),
      0 0 18px color-mix(in srgb, var(--flowcell-accent) 35%, transparent);
    color: #f6ffe4;
    font: 300 14px/1.2 "Segoe UI", sans-serif;
    text-align: center;
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 140ms ease,
      filter 140ms ease,
      box-shadow 140ms ease,
      border-color 140ms ease;
  }

  .flowcell-default-button:hover,
  .flowcell-default-panel-button:hover,
  #flowcell-runtime-scope[data-hovered="true"] .flowcell-default-button,
  #flowcell-runtime-scope[data-hovered="true"] .flowcell-default-panel-button {
    transform: translateY(-1px);
    filter: brightness(1.06);
    border-color: color-mix(in srgb, var(--flowcell-accent) 55%, white);
  }

  .flowcell-default-button:active,
  .flowcell-default-panel-button:active,
  #flowcell-runtime-scope[data-pressed="true"] .flowcell-default-button,
  #flowcell-runtime-scope[data-pressed="true"] .flowcell-default-panel-button,
  #flowcell-runtime-scope[data-active="true"] .flowcell-default-button,
  #flowcell-runtime-scope[data-active="true"] .flowcell-default-panel-button {
    transform: translateY(1px) scale(0.985);
    filter: brightness(0.97);
  }

  #flowcell-runtime-scope[data-selected="true"] .flowcell-default-button,
  #flowcell-runtime-scope[data-selected="true"] .flowcell-default-panel-button {
    box-shadow:
      inset 0 0 0 2px rgba(255,255,255,0.38),
      0 0 0 1px rgba(0,0,0,0.08),
      0 0 0 2px color-mix(in srgb, var(--flowcell-accent) 72%, transparent),
      0 0 22px color-mix(in srgb, var(--flowcell-accent) 44%, transparent);
  }

  #flowcell-runtime-scope[data-disabled="true"] .flowcell-default-button,
  #flowcell-runtime-scope[data-disabled="true"] .flowcell-default-panel-button {
    cursor: default;
    opacity: 0.52;
    filter: saturate(0.45);
  }

  .flowcell-default-sheen {
    position: absolute;
    inset: 0;
    background: linear-gradient(125deg, rgba(255,255,255,0.2), transparent 28%, transparent 65%, rgba(255,255,255,0.16));
    pointer-events: none;
  }

  .flowcell-default-label {
    position: relative;
    z-index: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .flowcell-default-shortcut {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    padding: 3px 6px;
    border-radius: 999px;
    background: rgba(0,0,0,0.24);
    border: 1px solid rgba(255,255,255,0.14);
    font-size: 11px;
    letter-spacing: 0.05em;
  }

  .flowcell-default-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 14px;
    border-radius: 20px;
    background: linear-gradient(180deg, rgba(16, 22, 10, 0.84), rgba(9, 12, 6, 0.94));
    border: 1px solid rgba(255,255,255,0.18);
  }

  .flowcell-default-panel-title {
    font: 300 15px/1.2 "Segoe UI", sans-serif;
    color: rgba(247, 255, 242, 0.92);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .flowcell-default-panel-grid {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    flex: 1;
  }
`;

function normalizePayload(rawPayload) {
  const payload = structuredClone(DEFAULT_PAYLOAD);
  if (!rawPayload || typeof rawPayload !== "object") {
    return payload;
  }

  return {
    ...payload,
    ...rawPayload,
    group: {
      ...payload.group,
      ...(rawPayload.group || {})
    },
    panel: {
      ...payload.panel,
      ...(rawPayload.panel || {})
    },
    button: {
      ...payload.button,
      ...(rawPayload.button || {})
    },
    states: {
      ...payload.states,
      ...(rawPayload.states || {})
    }
  };
}

function applyPayloadStateAttributes(scope, payload) {
  const states = payload.states || {};
  scope.dataset.hovered = String(Boolean(states.hovered));
  scope.dataset.active = String(Boolean(states.active));
  scope.dataset.pressed = String(Boolean(states.pressed));
  scope.dataset.disabled = String(Boolean(states.disabled));
  scope.dataset.selected = String(Boolean(states.selected));
  scope.dataset.longLabel = String(Boolean(states.longLabel));
  scope.style.setProperty("--flowcell-accent-color", payload?.button?.accentColor || "#9CFF18");
}

async function safeReadText(relativePath) {
  if (!relativePath) {
    return "";
  }

  const response = await fetch(`https://flowcell-group/${relativePath}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${relativePath}: ${response.status}`);
  }
  return response.text();
}

async function loadManifest() {
  try {
    const response = await fetch("https://flowcell-group/metadata.json");
    if (!response.ok) {
      return {
        name: "Unassigned",
        button: {},
        panel: {},
        css: {}
      };
    }
    return response.json();
  } catch {
    return {
      name: "Unassigned",
      button: {},
      panel: {},
      css: {}
    };
  }
}

function preprocessModuleSource(sourceText) {
  return String(sourceText)
    .replace(/^\s*import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]react['"];?\s*$/gm, "")
    .replace(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]react['"];?\s*$/gm, "")
    .replace(/^\s*import\s+['"][^'"]+\.(css|scss|sass|less)['"];?\s*$/gm, "")
    .replace(/^\s*import\s+.+?\s+from\s+['"][^'"]+\.(png|jpe?g|gif|svg|webp)['"];?\s*$/gm, "")
    .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
    .replace(/\bexport\s+function\s+/g, "function ")
    .replace(/\bexport\s+const\s+/g, "const ")
    .replace(/\bexport\s+let\s+/g, "let ")
    .replace(/\bexport\s+var\s+/g, "var ");
}

function applyTailwindClasses(scope) {
  const elements = scope.querySelectorAll("[class]");
  for (const element of elements) {
    const raw = element.getAttribute("class");
    if (!raw) {
      continue;
    }
    element.setAttribute("class", tw(raw));
  }
}

function buildRuntimeHelpers(payload) {
  return {
    payload,
    skin: {
      label: String(payload?.button?.label || "FlowCell"),
      selected: Boolean(payload?.states?.selected),
      hovered: Boolean(payload?.states?.hovered),
      pressed: Boolean(payload?.states?.pressed),
      disabled: Boolean(payload?.states?.disabled),
      accentColor: String(payload?.button?.accentColor || "#9cff18"),
      styleGroupId: Number(payload?.button?.styleGroupId || 0),
      groupName: String(payload?.group?.name || "Group")
    },
    React,
  };
}

function disposeReactRoot() {
  if (reactRoot) {
    reactRoot.unmount();
    reactRoot = null;
  }
}

function disconnectScopeResizeObserver() {
  if (scopeResizeObserver) {
    scopeResizeObserver.disconnect();
    scopeResizeObserver = null;
  }
}

function applyScopeMetrics(scope) {
  if (!scope) {
    return;
  }

  const rect = scope.getBoundingClientRect();
  const width = Math.max(Math.round(rect.width || 0), 0);
  const height = Math.max(Math.round(rect.height || 0), 0);
  scope.style.setProperty("--flowcell-host-width", `${width}px`);
  scope.style.setProperty("--flowcell-host-height", `${height}px`);
  scope.dataset.hostWidth = String(width);
  scope.dataset.hostHeight = String(height);
  scope.dataset.compact = String(width <= 108 || height <= 34);
  scope.dataset.tiny = String(width <= 76 || height <= 28);
}

function observeScopeMetrics(scope) {
  disconnectScopeResizeObserver();
  applyScopeMetrics(scope);

  if (typeof ResizeObserver !== "function") {
    return;
  }

  scopeResizeObserver = new ResizeObserver(() => {
    applyScopeMetrics(scope);
  });
  scopeResizeObserver.observe(scope);
}

async function renderModuleSource({ sourceText, sourceType, payload, hostScope }) {
  const preprocessed = preprocessModuleSource(sourceText);
  const transformed = Babel.transform(preprocessed, {
    presets: [["react", { runtime: "classic" }], "typescript"],
    sourceType: "script",
    comments: false,
    compact: false
  }).code;

  const factory = new Function(
    "React",
    "payload",
    "helpers",
    `
      const module = { exports: {} };
      const exports = module.exports;
      ${transformed}
      return (
        module.exports.default ||
        exports.default ||
        (typeof FlowCellButton !== "undefined" ? FlowCellButton : undefined) ||
        (typeof FlowCellPanel !== "undefined" ? FlowCellPanel : undefined) ||
        (typeof App !== "undefined" ? App : undefined)
      );
    `
  );

  const component = factory(React, payload, buildRuntimeHelpers(payload));
  if (typeof component !== "function") {
    throw new Error(`Runtime source did not expose a component for ${sourceType}.`);
  }

  disposeReactRoot();
  reactRoot = createRoot(hostScope);
  reactRoot.render(React.createElement(component, { payload, helpers: buildRuntimeHelpers(payload) }));
  applyTailwindClasses(hostScope);
}

async function renderHtmlSource({ htmlText, payload, hostScope }) {
  disposeReactRoot();
  hostScope.innerHTML = htmlText;
  applyTailwindClasses(hostScope);
  applyTemplateBindings(hostScope, payload);
}

function applyTemplateBindings(scope, payload) {
  const replacements = new Map([
    ["{{label}}", String(payload?.button?.label || "")],
    ["{{shortcut}}", String(payload?.button?.shortcut || "")],
    ["{{accentColor}}", String(payload?.button?.accentColor || "#9CFF18")],
    ["{{buttonId}}", String(payload?.button?.id || "")],
    ["{{groupId}}", String(payload?.group?.id ?? 0)],
    ["{{groupName}}", String(payload?.group?.name || "Group")],
    ["{{selected}}", String(Boolean(payload?.states?.selected))],
    ["{{hovered}}", String(Boolean(payload?.states?.hovered))],
    ["{{pressed}}", String(Boolean(payload?.states?.pressed))],
    ["{{disabled}}", String(Boolean(payload?.states?.disabled))]
  ]);

  const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    let nextValue = walk.currentNode.nodeValue || "";
    for (const [token, replacement] of replacements) {
      nextValue = nextValue.split(token).join(replacement);
    }
    walk.currentNode.nodeValue = nextValue;
  }
}

function postRuntimeMessage(message) {
  if (window.chrome?.webview?.postMessage) {
    window.chrome.webview.postMessage(message);
  }
}

function installHostInteractionRelay(scope) {
  const relayActivate = (event) => {
    if (!hostClickEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    postRuntimeMessage({ type: "activate" });
  };

  const relayContextMenu = (event) => {
    if (!hostClickEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    postRuntimeMessage({ type: "contextmenu" });
  };

  const relayKeyboard = (event) => {
    if (!hostClickEnabled) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    postRuntimeMessage({ type: "activate" });
  };

  scope.addEventListener("click", relayActivate);
  scope.addEventListener("contextmenu", relayContextMenu);
  scope.addEventListener("keydown", relayKeyboard);
}

async function renderVisual(hostConfig) {
  lastHostConfig = hostConfig;
  const payload = normalizePayload(hostConfig?.payload);
  hostClickEnabled = Boolean(hostConfig?.clickEnabled);
  const manifest = await loadManifest();
  const targetKey = payload.renderTarget === "panel" ? "panel" : "button";
  const targetManifest = manifest?.[targetKey] || {};
  const cssManifest = manifest?.css || {};
  const sourceType = String(targetManifest.sourceType || "").toLowerCase();
  const sourcePath = String(targetManifest.entryFile || "");
  const cssPath = String(cssManifest.entryFile || "");

  const sourceText = sourcePath ? await safeReadText(sourcePath) : "";
  const cssText = cssPath ? await safeReadText(cssPath) : "";

  disconnectScopeResizeObserver();
  runtimeRoot.innerHTML = "";
  const scope = document.createElement("div");
  scope.id = "flowcell-runtime-scope";
  scope.setAttribute("role", "presentation");
  scope.setAttribute("aria-hidden", "true");
  applyPayloadStateAttributes(scope, payload);
  installHostInteractionRelay(scope);
  runtimeRoot.appendChild(scope);
  observeScopeMetrics(scope);

  const styleElement = document.createElement("style");
  styleElement.textContent = [buildDefaultCss(), cssText || ""].join("\n");
  runtimeRoot.appendChild(styleElement);

  if (!sourceText && !cssText) {
    const fallbackMarkup =
      payload.renderTarget === "panel"
        ? buildDefaultPanelMarkup(payload)
        : buildDefaultButtonMarkup(payload);
    await renderHtmlSource({ htmlText: fallbackMarkup, payload, hostScope: scope });
    postRuntimeMessage({ type: "status", state: "rendered-fallback" });
    return;
  }

  if (sourceType === "jsx" || sourceType === "tsx" || sourceType === "react") {
    await renderModuleSource({
      sourceText,
      sourceType,
      payload,
      hostScope: scope
    });
  } else if (sourceType === "css") {
    const fallbackMarkup =
      payload.renderTarget === "panel"
        ? buildDefaultPanelMarkup(payload)
        : buildDefaultButtonMarkup(payload);
    await renderHtmlSource({ htmlText: fallbackMarkup, payload, hostScope: scope });
  } else {
    await renderHtmlSource({ htmlText: sourceText, payload, hostScope: scope });
  }

  postRuntimeMessage({
    type: "status",
    state: "rendered",
    renderTarget: payload.renderTarget,
    sourceType
  });
}

window.FlowCellRuntime = {
  receiveHostConfig: async (hostConfig) => {
    try {
      await renderVisual(hostConfig || {});
    } catch (error) {
      runtimeRoot.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:10px;box-sizing:border-box;border:1px solid rgba(255,120,120,0.4);border-radius:12px;background:rgba(72,14,18,0.82);color:#fff5f5;font:12px/1.4 Segoe UI,sans-serif;">
          ${escapeHtml(error?.message || String(error))}
        </div>
      `;
      postRuntimeMessage({
        type: "error",
        message: error?.message || String(error)
      });
    }
  }
};

if (window.chrome?.webview?.addEventListener) {
  window.chrome.webview.addEventListener("message", (event) => {
    if (!event?.data || event.data.type !== "host-config") {
      return;
    }
    window.FlowCellRuntime.receiveHostConfig(event.data);
  });
}

postRuntimeMessage({ type: "status", state: "runtime-ready" });
