import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEventHandler,
  type ReactElement,
  type Ref
} from "react";
import type { ImportedSkin, StyleGroup } from "../types";

export const IMPORTED_SKIN_LABEL_PLACEHOLDER = "{{label}}";
export type FlowButtonActionPhase = "idle" | "press" | "hold" | "release" | "error";
export type FlowButtonTransition = "none" | "in" | "out";
export type FlowButtonTrigger = "pointer" | "keyboard" | "shortcut" | "programmatic";
export type FlowButtonSizingMode =
  | "intrinsic"
  | "fit-uniform"
  | "responsive-uniform"
  | "fill-stretch"
  | "cover-crop";
export type FlowButtonFootprintMode = "default-axis-normalized";

export interface FlowButtonSkinContract {
  flowId: string;
  flowLabel?: string;
  hovered?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  active?: boolean;
  pressed?: boolean;
  held?: boolean;
  disabled?: boolean;
  error?: boolean;
  compact?: boolean;
  actionPhase?: FlowButtonActionPhase;
  transition?: FlowButtonTransition;
  trigger?: FlowButtonTrigger;
  sizingMode?: FlowButtonSizingMode;
  allowOverflow?: boolean;
  hostWidth?: number;
  hostHeight?: number;
  scale?: number;
  density?: number | string;
  aspectRatio?: number;
}

function toBooleanData(value: boolean | undefined): "true" | "false" {
  return value ? "true" : "false";
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildFlowButtonDataAttributes(contract: FlowButtonSkinContract) {
  const attrs: Record<string, string> = {
    "data-flow-id": contract.flowId,
    "data-hovered": toBooleanData(contract.hovered),
    "data-highlighted": toBooleanData(contract.highlighted),
    "data-selected": toBooleanData(contract.selected),
    "data-active": toBooleanData(contract.active),
    "data-pressed": toBooleanData(contract.pressed),
    "data-held": toBooleanData(contract.held),
    "data-disabled": toBooleanData(contract.disabled),
    "data-error": toBooleanData(contract.error),
    "data-action-phase": contract.actionPhase ?? (contract.error ? "error" : "idle"),
    "data-transition": contract.transition ?? "none",
    "data-trigger": contract.trigger ?? "programmatic",
    "data-compact": toBooleanData(contract.compact),
    "data-flow-sizing": contract.sizingMode ?? "fill-stretch",
    "data-flow-overflow": toBooleanData(contract.allowOverflow)
  };
  if (contract.flowLabel) {
    attrs["data-flow-label"] = contract.flowLabel;
  }
  return attrs;
}

export function buildFlowButtonCssVars(contract: FlowButtonSkinContract): CSSProperties {
  const vars = {} as CSSProperties & Record<string, string | number>;
  vars["--flow-scale"] = isFiniteNumber(contract.scale) ? contract.scale : 1;
  vars["--flow-density"] = contract.density ?? (contract.compact ? 0.82 : 1);
  if (isFiniteNumber(contract.hostWidth)) {
    vars["--flow-host-width"] = `${contract.hostWidth}px`;
  }
  if (isFiniteNumber(contract.hostHeight)) {
    vars["--flow-host-height"] = `${contract.hostHeight}px`;
  }
  if (isFiniteNumber(contract.aspectRatio)) {
    vars["--flow-aspect-ratio"] = String(contract.aspectRatio);
  }
  return vars;
}

export function buildFlowButtonClassName(
  baseClassNames: Array<string | false | null | undefined>,
  contract: FlowButtonSkinContract
): string {
  return [
    ...baseClassNames,
    contract.hovered ? "is-hovered" : "",
    contract.highlighted ? "is-highlighted" : "",
    contract.selected ? "is-selected" : "",
    contract.active ? "is-active" : "",
    contract.pressed ? "is-pressed" : "",
    contract.held ? "is-held" : "",
    contract.disabled ? "is-disabled" : "",
    contract.error ? "is-error" : "",
    contract.compact ? "is-compact" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function sanitizeMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

function renderImportedTemplate(markup: string, label: string): string {
  return sanitizeMarkup(markup).replace(/\{\{label\}\}/g, label);
}

function extractImportedInlineStyles(markup: string): {
  markup: string;
  inlineCssBlocks: string[];
} {
  const inlineCssBlocks: string[] = [];
  const markupWithoutStyles = markup.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_match, cssBlock: string) => {
      inlineCssBlocks.push(cssBlock);
      return "";
    }
  );

  return {
    markup: markupWithoutStyles,
    inlineCssBlocks
  };
}

function sanitizeScopeToken(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return sanitized.length > 0 ? sanitized : "imported-skin";
}

function buildImportedSkinScopeClass(importedSkinId: string | undefined): string {
  return `imported-skin-scope--${sanitizeScopeToken(importedSkinId ?? "")}`;
}

function mapButtonSkinSelectorToHost(selector: string): string {
  return selector.replace(
    /\.button-skin((?:(?:\.[a-z0-9_-]+)|(?:\[[^\]]+\])|(?:::[a-z0-9_-]+(?:\([^)]*\))?)|(?::[a-z0-9_-]+(?:\([^)]*\))?))*)/gi,
    (_match, suffix: string) => {
      const tokens =
        suffix.match(
          /(\.[a-z0-9_-]+|\[[^\]]+\]|::?[a-z0-9_-]+(?:\([^)]*\))?)/gi
        ) ?? [];
      const hostStates: string[] = [];
      const hostFilters: string[] = [];
      const hostPseudoElements: string[] = [];

      for (const token of tokens) {
        const normalized = token.toLowerCase();
        switch (normalized) {
          case ".is-hovered":
          case ":hover":
            hostStates.push('[data-hovered="true"]');
            break;
          case ".is-selected":
            hostStates.push('[data-selected="true"]');
            break;
          case ".is-active":
            hostStates.push('[data-active="true"]');
            break;
          case ".is-pressed":
          case ":active":
            hostStates.push('[data-pressed="true"]');
            break;
          case ".is-held":
            hostStates.push('[data-held="true"]');
            break;
          case ".is-disabled":
            hostStates.push('[data-disabled="true"]');
            break;
          case ".is-error":
            hostStates.push('[data-error="true"]');
            break;
          case ".is-compact":
            hostStates.push('[data-compact="true"]');
            break;
          default:
            if (token.startsWith("[")) {
              hostFilters.push(token);
              break;
            }
            if (token.startsWith("::")) {
              hostPseudoElements.push(token);
              break;
            }
            if (token.startsWith(":")) {
              hostFilters.push(token);
            }
        }
      }

      const hostCondition = `${hostStates.join("")}${hostFilters.join("")}`;
      if (!hostCondition) {
        return `:host${hostPseudoElements.join("")}`;
      }
      return `:host(${hostCondition})${hostPseudoElements.join("")}`;
    }
  );
}

function scopeCssSelector(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(from|to|\d+%)$/i.test(trimmed)) {
    return trimmed;
  }

  const hostMapped =
    scopeSelector === ":host" ? mapButtonSkinSelectorToHost(trimmed) : trimmed;
  // Replace real root selectors only; do not rewrite class names like `.body`.
  const replacedRoot = hostMapped.replace(
    /(^|[\s>+~,(])(:root|html|body)(?=($|[\s>+~.#:[,(]))/g,
    (_match, prefix: string) => `${prefix}${scopeSelector}`
  );
  if (replacedRoot.includes(scopeSelector)) {
    return replacedRoot;
  }
  if (/^[>+~]/.test(replacedRoot)) {
    return `${scopeSelector}${replacedRoot}`;
  }
  return `${scopeSelector} ${replacedRoot}`;
}

function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return source.length - 1;
}

function scopeImportedCssRules(source: string, scopeSelector: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const openBraceIndex = source.indexOf("{", cursor);
    if (openBraceIndex < 0) {
      output += source.slice(cursor);
      break;
    }

    const prelude = source.slice(cursor, openBraceIndex);
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    const blockContent = source.slice(openBraceIndex + 1, closeBraceIndex);
    const trimmedPrelude = prelude.trim();

    if (!trimmedPrelude) {
      output += `${prelude}{${blockContent}}`;
      cursor = closeBraceIndex + 1;
      continue;
    }

    if (trimmedPrelude.startsWith("@")) {
      const atRuleName = trimmedPrelude
        .slice(1)
        .split(/[\s{]/, 1)[0]
        .toLowerCase();
      if (["media", "supports", "layer", "container", "document"].includes(atRuleName)) {
        output += `${prelude}{${scopeImportedCssRules(blockContent, scopeSelector)}}`;
      } else {
        output += `${prelude}{${blockContent}}`;
      }
      cursor = closeBraceIndex + 1;
      continue;
    }

    const scopedSelectors = prelude
      .split(",")
      .map((selector) => scopeCssSelector(selector, scopeSelector));
    const scopedPrelude = Array.from(new Set(scopedSelectors)).join(", ");
    output += `${scopedPrelude}{${blockContent}}`;
    cursor = closeBraceIndex + 1;
  }

  return output;
}

export function normalizeImportedSkinHtmlMarkup(markup: string): string {
  if (typeof document === "undefined") {
    return markup;
  }

  const template = document.createElement("template");
  template.innerHTML = markup;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const textContent = current.textContent ?? "";
    if (!textContent.trim()) {
      continue;
    }
    current.textContent = textContent.replace(textContent.trim(), IMPORTED_SKIN_LABEL_PLACEHOLDER);
    return template.innerHTML;
  }

  return markup;
}

export function ensureImportedSkinLabelPlaceholder(skin: ImportedSkin): ImportedSkin {
  const currentHtml = skin.html ?? "";
  if (
    !currentHtml.trim() ||
    currentHtml.includes(IMPORTED_SKIN_LABEL_PLACEHOLDER)
  ) {
    return skin;
  }

  const normalizedHtml = normalizeImportedSkinHtmlMarkup(currentHtml);
  if (normalizedHtml === currentHtml) {
    return skin;
  }

  return {
    ...skin,
    html: normalizedHtml
  };
}

function hasSkinContent(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function usesLegacyImportedBodyShell(
  importedSkin: Pick<ImportedSkin, "html"> | undefined
): boolean {
  if (!importedSkin?.html) {
    return false;
  }
  return (
    importedSkin.html.includes('class="body"') || importedSkin.html.includes("class='body'")
  );
}

type ImportedSkinBridgeElement = string | HTMLElement | null | undefined;

type ImportedSkinBridgeMountOptions = {
  interactive?: ImportedSkinBridgeElement;
  measure?: ImportedSkinBridgeElement;
  label?: ImportedSkinBridgeElement;
  fitLabel?: boolean;
  maxInlineSize?: string;
  compactMaxInlineSize?: string;
  minFontScale?: number;
  labelScale?: number;
};

type ImportedSkinBridgeApi = {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  query: (selector: string) => HTMLElement | null;
  queryAll: (selector: string) => HTMLElement[];
  firstElement: () => HTMLElement | null;
  hostSurfaceIncludes: (token: string) => boolean;
  mountButton: (options?: ImportedSkinBridgeMountOptions) => () => void;
};

function dispatchImportedSkinCustomEvent(
  host: HTMLDivElement,
  name: string,
  detail: Record<string, unknown> = {}
) {
  host.dispatchEvent(
    new CustomEvent(name, {
      detail,
      bubbles: false
    })
  );
}

function resolveImportedSkinElement(args: {
  shadowRoot: ShadowRoot;
  htmlNode: HTMLDivElement;
  svgNode: HTMLDivElement;
  candidate: ImportedSkinBridgeElement;
  fallbackSelectors?: string[];
}): HTMLElement | null {
  const { shadowRoot, htmlNode, svgNode, candidate, fallbackSelectors } = args;
  if (candidate instanceof HTMLElement) {
    return candidate;
  }
  if (typeof candidate === "string" && candidate.trim()) {
    return shadowRoot.querySelector(candidate) as HTMLElement | null;
  }
  if (fallbackSelectors) {
    for (const selector of fallbackSelectors) {
      const matchedNode = shadowRoot.querySelector(selector) as HTMLElement | null;
      if (matchedNode) {
        return matchedNode;
      }
    }
  }

  return (
    (htmlNode.firstElementChild as HTMLElement | null) ??
    (svgNode.firstElementChild as HTMLElement | null) ??
    null
  );
}

function captureImportedSkinMeasurement(measureElement: HTMLElement) {
  measureElement.dataset.flowMeasuredOffsetWidth = String(measureElement.offsetWidth);
  measureElement.dataset.flowMeasuredOffsetHeight = String(measureElement.offsetHeight);
  measureElement.dataset.flowMeasuredScrollWidth = String(measureElement.scrollWidth);
  measureElement.dataset.flowMeasuredScrollHeight = String(measureElement.scrollHeight);
}

function removeImportedSkinTwoWordLabelOverlay(labelElement: HTMLElement) {
  labelElement
    .querySelectorAll("[data-flow-two-word-label-overlay='true']")
    .forEach((node) => node.remove());
}

function measureImportedSkinLabelTextWidth(
  labelElement: HTMLElement,
  text: string
): number {
  const ownerDocument = labelElement.ownerDocument;
  const ownerBody = ownerDocument.body;
  if (!ownerBody) {
    return labelElement.scrollWidth;
  }

  const computedStyle = window.getComputedStyle(labelElement);
  const probe = ownerDocument.createElement("span");
  probe.textContent = text;
  probe.style.position = "fixed";
  probe.style.left = "-9999px";
  probe.style.top = "-9999px";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "nowrap";
  probe.style.fontFamily = computedStyle.fontFamily;
  probe.style.fontSize = computedStyle.fontSize;
  probe.style.fontStyle = computedStyle.fontStyle;
  probe.style.fontVariant = computedStyle.fontVariant;
  probe.style.fontWeight = computedStyle.fontWeight;
  probe.style.letterSpacing = computedStyle.letterSpacing;
  probe.style.textTransform = computedStyle.textTransform;
  ownerBody.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function applyImportedSkinTwoWordLabelOverlay(
  labelElement: HTMLElement,
  measureElement: HTMLElement
): boolean {
  removeImportedSkinTwoWordLabelOverlay(labelElement);
  const normalizedLabel = (labelElement.textContent ?? "").trim().replace(/\s+/g, " ");
  const words = normalizedLabel.split(" ").filter(Boolean);
  if (words.length !== 2) {
    return false;
  }

  const visualEdgeInsetPx = 3;
  const oneLineTextWidth = measureImportedSkinLabelTextWidth(labelElement, normalizedLabel);
  const measureWidth = measureElement.getBoundingClientRect().width;
  const availableVisualWidth = Math.max(1, measureWidth - visualEdgeInsetPx * 2);
  const shouldStack = oneLineTextWidth > availableVisualWidth;
  const computedStyle = window.getComputedStyle(labelElement);
  const labelColor =
    labelElement.dataset.flowTwoWordLabelColor ?? computedStyle.color;
  const labelTextShadow =
    labelElement.dataset.flowTwoWordLabelTextShadow ?? computedStyle.textShadow;
  labelElement.dataset.flowTwoWordLabelColor = labelColor;
  labelElement.dataset.flowTwoWordLabelTextShadow = labelTextShadow;

  labelElement.style.position = "relative";
  labelElement.style.setProperty("color", "transparent", "important");
  labelElement.style.setProperty("text-shadow", "none", "important");
  labelElement.style.textAlign = "center";
  labelElement.style.whiteSpace = "nowrap";
  labelElement.style.textWrap = "nowrap";

  const overlay = document.createElement("span");
  overlay.setAttribute("data-flow-two-word-label-overlay", "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.style.position = "absolute";
  overlay.style.left = `${visualEdgeInsetPx}px`;
  overlay.style.right = `${visualEdgeInsetPx}px`;
  overlay.style.top = "0";
  overlay.style.bottom = "0";
  overlay.style.zIndex = "5";
  overlay.style.display = "flex";
  overlay.style.flexDirection = shouldStack ? "column" : "row";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.fontFamily = "inherit";
  overlay.style.fontSize = "inherit";
  overlay.style.fontWeight = "inherit";
  overlay.style.letterSpacing = "inherit";
  overlay.style.lineHeight = "0.95";
  overlay.style.textAlign = "center";
  overlay.style.whiteSpace = "nowrap";
  overlay.style.pointerEvents = "none";
  overlay.style.color = labelColor;
  overlay.style.textShadow = labelTextShadow;

  const visualRows = shouldStack ? words : [normalizedLabel];
  visualRows.forEach((word) => {
    const wordNode = document.createElement("span");
    wordNode.textContent = word;
    wordNode.style.display = "block";
    overlay.appendChild(wordNode);
  });
  labelElement.appendChild(overlay);
  return true;
}

function installImportedSkinLabelSizing(args: {
  host: HTMLDivElement;
  measureElement: HTMLElement;
  labelElement: HTMLElement | null;
  options: ImportedSkinBridgeMountOptions;
  hostSurfaceIncludes: (token: string) => boolean;
}): () => void {
  const { host, measureElement, labelElement, options, hostSurfaceIncludes } = args;
  if (!labelElement) {
    return () => undefined;
  }

  const isCompact =
    host.dataset.compact === "true" || host.classList.contains("is-compact");
  const maxInlineSize =
    options.maxInlineSize ??
    (hostSurfaceIncludes("surface-action") || hostSurfaceIncludes("chrome-action")
      ? "14ch"
      : "18ch");
  const compactMaxInlineSize = options.compactMaxInlineSize ?? "11ch";
  const baseScale = Math.min(3, Math.max(0.3, options.labelScale ?? 1));
  labelElement.style.width = "fit-content";
  labelElement.style.maxWidth = "100%";
  labelElement.style.maxInlineSize = isCompact ? compactMaxInlineSize : maxInlineSize;
  labelElement.style.whiteSpace = "nowrap";
  labelElement.style.overflowWrap = "normal";
  labelElement.style.hyphens = "manual";
  labelElement.style.textWrap = "nowrap";
  labelElement.style.wordBreak = "normal";

  const minimumScale = Math.min(1, Math.max(0.58, options.minFontScale ?? 0.72));
  let resizeObserver: ResizeObserver | null = null;
  let animationFrameId = 0;

  const fitLabelToHostHeight = () => {
    removeImportedSkinTwoWordLabelOverlay(labelElement);
    labelElement.style.fontSize = `${baseScale}em`;
    const availableWidth = Math.max(0, host.clientWidth - 8);
    const availableHeight = Math.max(0, host.clientHeight - 4);
    if (availableWidth <= 0 || availableHeight <= 0) {
      applyImportedSkinTwoWordLabelOverlay(labelElement, measureElement);
      return;
    }

    let scale = baseScale;
    while (
      (measureElement.scrollHeight > availableHeight ||
        measureElement.scrollWidth > availableWidth) &&
      scale > minimumScale
    ) {
        scale = Math.max(minimumScale, Number((scale - 0.05).toFixed(2)));
        labelElement.style.fontSize = `${scale}em`;
        if (scale === minimumScale) {
          break;
        }
    }
    captureImportedSkinMeasurement(measureElement);
    applyImportedSkinTwoWordLabelOverlay(labelElement, measureElement);
    host.dispatchEvent(new CustomEvent("flow-skin-content-ready"));
  };

  const scheduleFit = () => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = window.requestAnimationFrame(() => {
      fitLabelToHostHeight();
    });
  };

  scheduleFit();
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      scheduleFit();
    });
    resizeObserver.observe(host);
    resizeObserver.observe(measureElement);
    resizeObserver.observe(labelElement);
  }

  return () => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
    }
    resizeObserver?.disconnect();
  };
}

function installImportedSkinBridgeButton(args: {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  htmlNode: HTMLDivElement;
  svgNode: HTMLDivElement;
  options: ImportedSkinBridgeMountOptions;
  hostSurfaceIncludes: (token: string) => boolean;
}): () => void {
  const { host, shadowRoot, htmlNode, svgNode, options, hostSurfaceIncludes } = args;
  const interactiveElement = resolveImportedSkinElement({
    shadowRoot,
    htmlNode,
    svgNode,
    candidate: options.interactive,
    fallbackSelectors: [
      "[data-flow-interactive]",
      ".button",
      "button",
      ".glass-hover-button",
      ".black-tint-pill",
      ".imported-pill",
      ".glass-pill"
    ]
  });
  const measureElement =
    resolveImportedSkinElement({
      shadowRoot,
      htmlNode,
      svgNode,
      candidate: options.measure,
      fallbackSelectors: [
        "[data-flow-measure]",
        ".button",
        "button",
        ".glass-hover-wrap",
        ".black-tint-pill",
        ".imported-pill",
        ".glass-pill",
        ".default-root",
        ".body"
      ]
    }) ?? interactiveElement;
  const labelElement = resolveImportedSkinElement({
    shadowRoot,
    htmlNode,
    svgNode,
    candidate: options.label,
    fallbackSelectors: [
      "[data-flow-label-node]",
      ".span",
      ".glass-hover-label",
      ".black-tint-pill__label",
      ".imported-pill__label",
      ".glass-pill__label"
    ]
  });

  measureElement?.setAttribute("data-flow-measure", "true");
  if (measureElement) {
    captureImportedSkinMeasurement(measureElement);
  }
  const cleanupLabelSizing =
    measureElement &&
    labelElement &&
    (options.fitLabel === true ||
      options.maxInlineSize !== undefined ||
      options.compactMaxInlineSize !== undefined ||
      options.minFontScale !== undefined)
      ? installImportedSkinLabelSizing({
          host,
          measureElement,
          labelElement,
          options,
          hostSurfaceIncludes
        })
      : () => undefined;
  if (labelElement && measureElement) {
    applyImportedSkinTwoWordLabelOverlay(labelElement, measureElement);
  }

  if (!interactiveElement) {
    return cleanupLabelSizing;
  }

  interactiveElement.setAttribute("data-flow-interactive", "true");
  let pressed = false;
  const releasePressed = () => {
    if (!pressed) {
      return;
    }
    pressed = false;
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", { pressed: false });
  };

  const handlePointerEnter = () => {
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", { hovered: true });
  };
  const handlePointerLeave = () => {
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", {
      hovered: false,
      pressed: false
    });
    pressed = false;
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    pressed = true;
    dispatchImportedSkinCustomEvent(host, "flow-skin-request-focus");
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", {
      hovered: true,
      pressed: true
    });
  };
  const handlePointerUp = () => {
    releasePressed();
  };
  const handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchImportedSkinCustomEvent(host, "flow-skin-request-focus");
    dispatchImportedSkinCustomEvent(host, "flow-skin-activate", {
      altKey: event.altKey,
      button: event.button,
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      detail: event.detail,
      metaKey: event.metaKey,
      screenX: event.screenX,
      screenY: event.screenY,
      shiftKey: event.shiftKey
    });
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchImportedSkinCustomEvent(host, "flow-skin-request-focus");
    dispatchImportedSkinCustomEvent(host, "flow-skin-contextmenu", {
      clientX: event.clientX,
      clientY: event.clientY
    });
  };
  const handleFocusIn = () => {
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", { focused: true });
  };
  const handleFocusOut = () => {
    dispatchImportedSkinCustomEvent(host, "flow-skin-state", { focused: false });
    releasePressed();
  };

  interactiveElement.addEventListener("pointerenter", handlePointerEnter);
  interactiveElement.addEventListener("pointerleave", handlePointerLeave);
  interactiveElement.addEventListener("pointerdown", handlePointerDown);
  interactiveElement.addEventListener("pointerup", handlePointerUp);
  interactiveElement.addEventListener("click", handleClick);
  interactiveElement.addEventListener("contextmenu", handleContextMenu);
  interactiveElement.addEventListener("focusin", handleFocusIn);
  interactiveElement.addEventListener("focusout", handleFocusOut);
  window.addEventListener("pointerup", releasePressed);
  window.addEventListener("pointercancel", releasePressed);

  return () => {
    cleanupLabelSizing();
    interactiveElement.removeEventListener("pointerenter", handlePointerEnter);
    interactiveElement.removeEventListener("pointerleave", handlePointerLeave);
    interactiveElement.removeEventListener("pointerdown", handlePointerDown);
    interactiveElement.removeEventListener("pointerup", handlePointerUp);
    interactiveElement.removeEventListener("click", handleClick);
    interactiveElement.removeEventListener("contextmenu", handleContextMenu);
    interactiveElement.removeEventListener("focusin", handleFocusIn);
    interactiveElement.removeEventListener("focusout", handleFocusOut);
    window.removeEventListener("pointerup", releasePressed);
    window.removeEventListener("pointercancel", releasePressed);
  };
}

function runImportedSkinBridge(args: {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  htmlNode: HTMLDivElement;
  svgNode: HTMLDivElement;
  importedSkin: ImportedSkin;
}): () => void {
  const { host, shadowRoot, htmlNode, svgNode, importedSkin } = args;
  const hostSurfaceTokens = (host.dataset.flowSurface ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const hostSurfaceIncludes = (token: string) => hostSurfaceTokens.includes(token);
  let implicitCleanup: () => void = () => undefined;
  const bridgeApi: ImportedSkinBridgeApi = {
    host,
    shadowRoot,
    query: (selector) => shadowRoot.querySelector(selector) as HTMLElement | null,
    queryAll: (selector) =>
      Array.from(shadowRoot.querySelectorAll(selector)).filter(
        (node): node is HTMLElement => node instanceof HTMLElement
      ),
    firstElement: () =>
      ((htmlNode.firstElementChild as HTMLElement | null) ??
        (svgNode.firstElementChild as HTMLElement | null) ??
        null),
    hostSurfaceIncludes,
    mountButton: (options = {}) => {
      const mergedOptions = {
        ...options,
        maxInlineSize:
          typeof importedSkin.labelMaxWidth === "number" &&
          Number.isFinite(importedSkin.labelMaxWidth) &&
          importedSkin.labelMaxWidth > 0
            ? `${Math.round(importedSkin.labelMaxWidth * 1000) / 1000}px`
            : options.maxInlineSize,
        minFontScale:
          typeof importedSkin.labelMinScale === "number" &&
          Number.isFinite(importedSkin.labelMinScale) &&
          importedSkin.labelMinScale > 0
            ? importedSkin.labelMinScale
            : options.minFontScale,
        labelScale:
          typeof importedSkin.labelScale === "number" &&
          Number.isFinite(importedSkin.labelScale) &&
          importedSkin.labelScale > 0
            ? importedSkin.labelScale
            : options.labelScale
      };
      implicitCleanup = installImportedSkinBridgeButton({
        host,
        shadowRoot,
        htmlNode,
        svgNode,
        options: mergedOptions,
        hostSurfaceIncludes
      });
      return implicitCleanup;
    }
  };

  const bridgeSource = importedSkin.bridgeJs?.trim();
  if (!bridgeSource) {
    return bridgeApi.mountButton();
  }

  try {
    const bridgeRunner = new Function("bridge", bridgeSource);
    const bridgeResult = bridgeRunner(bridgeApi);
    if (typeof bridgeResult === "function") {
      return bridgeResult as () => void;
    }
    return implicitCleanup;
  } catch (error) {
    console.error("Imported skin bridge failed.", error, {
      importedSkinId: importedSkin.id
    });
    return bridgeApi.mountButton();
  }

  return () => undefined;
}

function buildImportedButtonShadowCss(
  importedSkin: ImportedSkin,
  inlineCssBlocks: string[] = []
): string {
  const scopedCssBlocks = [sanitizeMarkup(importedSkin.css), ...inlineCssBlocks]
    .map((cssBlock) => cssBlock.trim())
    .filter(Boolean)
    .map((cssBlock) => scopeImportedCssRules(cssBlock, ":host"));
  return [
    "@property --angle-1{syntax:\"<angle>\";inherits:false;initial-value:-75deg}",
    "@property --angle-2{syntax:\"<angle>\";inherits:false;initial-value:-75deg}",
    ":host{--angle-1:-75deg;--angle-2:-75deg;position:relative;display:inline-grid;place-items:center;min-width:0;min-height:0;color:inherit;text-align:center;overflow:visible;}",
    ":host([data-flow-sizing=\"fill-stretch\"]){width:100%;height:100%;}",
    ":host([data-flow-overflow=\"false\"]){overflow:hidden;}",
    ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html,:host([data-flow-sizing=\"fill-stretch\"]) .imported-svg{width:100%;height:100%;}",
    ".imported-svg{position:absolute;inset:8px;opacity:.6;}",
    ".imported-svg svg{width:100%;height:100%;}",
    ".imported-html{position:relative;z-index:1;display:inline-grid;place-items:center;width:auto;height:auto;line-height:0;pointer-events:none;}",
    ".imported-html>:first-child{margin:0!important;}",
    ".imported-html>button{display:block;margin:0;width:auto;max-width:100%;vertical-align:middle;line-height:normal;box-sizing:border-box;}",
    "[data-flow-interactive='true']{pointer-events:auto!important;}",
    ":host([data-flow-sizing=\"fit-uniform\"]) .imported-html,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html,:host([data-flow-footprint=\"default-axis-normalized\"]) .imported-html{display:grid;width:100%;height:100%;place-items:center;overflow:visible;}",
    ":host([data-flow-sizing=\"fit-uniform\"]) .imported-html>:first-child,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>:first-child,:host([data-flow-footprint=\"default-axis-normalized\"]) .imported-html>:first-child{transform:scale(var(--flow-scale,1));transform-origin:center center;}",
    ".imported-svg,.imported-svg *{pointer-events:none!important;}",
    ".glass-hover-label,.imported-pill__label{color:var(--fc-theme-page-foreground)!important;text-shadow:0 .18em .08em color-mix(in srgb,var(--fc-theme-surface-shadow) 34%,transparent)!important;}",
    ...scopedCssBlocks,
    ".imported-html>.body{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;background:transparent!important;overflow:visible!important;}",
    ".imported-html>.body>*{min-width:0;min-height:0;}"
  ]
    .filter(Boolean)
    .join("\n");
}

interface ImportedButtonSkinRootProps {
  className: string;
  label: string;
  importedSkin: ImportedSkin;
  style?: CSSProperties;
  forwardedRef?: Ref<HTMLDivElement>;
  dataAttributes?: Record<string, string>;
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}

const ImportedButtonSkinRoot = forwardRef<HTMLDivElement, ImportedButtonSkinRootProps>(
  (
    {
      className,
      label,
      importedSkin,
      style,
      forwardedRef,
      dataAttributes,
      onPointerEnter,
      onPointerLeave
    },
    ref
  ) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const resolvedSizingMode = dataAttributes?.["data-flow-sizing"];
    const shouldFillHost =
      resolvedSizingMode === "fill-stretch" ||
      resolvedSizingMode === "fit-uniform" ||
      resolvedSizingMode === "responsive-uniform" ||
      Boolean(dataAttributes?.["data-flow-footprint"]);
    const hostStyle: CSSProperties = {
      ...(style ?? {}),
      display: "inline-grid",
      width: shouldFillHost ? "100%" : "fit-content",
      height: shouldFillHost ? "100%" : "fit-content",
      minWidth: 0,
      minHeight: 0,
      justifySelf: shouldFillHost ? "stretch" : "center",
      alignSelf: shouldFillHost ? "stretch" : "center",
      pointerEvents: "none"
    };

    const setHostRef = (node: HTMLDivElement | null) => {
      hostRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      const renderedMarkup = renderImportedTemplate(importedSkin.html, label);
      const preparedMarkup = extractImportedInlineStyles(renderedMarkup);

      const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
      let styleNode = shadowRoot.querySelector(
        "style[data-flow-imported-skin]"
      ) as HTMLStyleElement | null;
      if (!styleNode) {
        styleNode = document.createElement("style");
        styleNode.setAttribute("data-flow-imported-skin", "true");
        shadowRoot.appendChild(styleNode);
      }

      let svgNode = shadowRoot.querySelector(
        "div[data-flow-imported-svg]"
      ) as HTMLDivElement | null;
      if (!svgNode) {
        svgNode = document.createElement("div");
        svgNode.className = "imported-svg";
        svgNode.setAttribute("data-flow-imported-svg", "true");
        shadowRoot.appendChild(svgNode);
      }

      let htmlNode = shadowRoot.querySelector(
        "div[data-flow-imported-html]"
      ) as HTMLDivElement | null;
      if (!htmlNode) {
        htmlNode = document.createElement("div");
        htmlNode.className = "imported-html";
        htmlNode.setAttribute("data-flow-imported-html", "true");
        shadowRoot.appendChild(htmlNode);
      }

      styleNode.textContent = buildImportedButtonShadowCss(
        importedSkin,
        preparedMarkup.inlineCssBlocks
      );
      svgNode.innerHTML = importedSkin.svg ? sanitizeMarkup(importedSkin.svg) : "";
      htmlNode.innerHTML = preparedMarkup.markup;
      const cleanupBridge = runImportedSkinBridge({
        host,
        shadowRoot,
        htmlNode,
        svgNode,
        importedSkin
      });
      host.dispatchEvent(new CustomEvent("flow-skin-content-ready"));

      const applyNormalizedFootprintScale = () => {
        const rootContent = htmlNode.firstElementChild as HTMLElement | null;
        if (!rootContent) {
          return;
        }
        const isButtonRoot = rootContent.tagName === "BUTTON";
        if (host.dataset.flowFootprint !== "default-axis-normalized") {
          host.style.removeProperty("overflow");
          htmlNode.style.removeProperty("overflow");
          rootContent.style.removeProperty("overflow");
          rootContent.style.removeProperty("transform");
          rootContent.style.removeProperty("transform-origin");
          return;
        }
        host.style.overflow = isButtonRoot ? "visible" : "hidden";
        htmlNode.style.overflow = isButtonRoot ? "visible" : "hidden";
        rootContent.style.overflow = "visible";
        const hostWidth = host.clientWidth;
        const hostHeight = host.clientHeight;
        const contentWidth = rootContent.offsetWidth;
        const contentHeight = rootContent.offsetHeight;
        if (
          hostWidth <= 0 ||
          hostHeight <= 0 ||
          contentWidth <= 0 ||
          contentHeight <= 0
        ) {
          return;
        }
        const aspectRatio = contentWidth / contentHeight;
        const isWideContent = aspectRatio >= 1;
        const widePrimaryInset = isButtonRoot ? 0.7 : 1;
        const wideCrossInset = isButtonRoot ? 0.92 : 1;
        const tallPrimaryInset = isButtonRoot ? 1 : 0.82;
        const tallCrossInset = isButtonRoot ? 1 : 0.94;
        const primaryAxisScale = isWideContent
          ? (hostHeight * widePrimaryInset) / contentHeight
          : (hostWidth * tallPrimaryInset) / contentWidth;
        const crossAxisScale = isWideContent
          ? (hostWidth * wideCrossInset) / contentWidth
          : (hostHeight * tallCrossInset) / contentHeight;
        const scale = Math.min(
          primaryAxisScale,
          crossAxisScale
        );
        rootContent.style.transform = `scale(${scale > 0 ? scale : 1})`;
        rootContent.style.transformOrigin = "center center";
      };

      const animationFrameId = window.requestAnimationFrame(() => {
        applyNormalizedFootprintScale();
      });

      if (typeof ResizeObserver === "undefined") {
        return () => {
          cleanupBridge();
          window.cancelAnimationFrame(animationFrameId);
        };
      }

      const observer = new ResizeObserver(() => {
        applyNormalizedFootprintScale();
      });
      observer.observe(host);
      if (htmlNode.firstElementChild instanceof HTMLElement) {
        observer.observe(htmlNode.firstElementChild);
      }
      return () => {
        cleanupBridge();
        window.cancelAnimationFrame(animationFrameId);
        observer.disconnect();
      };
    }, [importedSkin, label]);

    return (
      <div
        ref={setHostRef}
        className={className}
        style={hostStyle}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        {...dataAttributes}
      />
    );
  }
);

ImportedButtonSkinRoot.displayName = "ImportedButtonSkinRoot";

export function resolveStyleGroup(
  styleGroups: StyleGroup[] | undefined,
  styleGroupId: string
): StyleGroup | undefined {
  return styleGroups?.find((styleGroup) => styleGroup.id === styleGroupId);
}

export function getImportedSkin(
  importedSkins: ImportedSkin[] | undefined,
  importedSkinId: string | undefined
): ImportedSkin | undefined {
  return importedSkins?.find((skin) => skin.id === importedSkinId);
}

export function renderSurfaceSkin(args: {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
}): ReactElement | null {
  const { label, styleGroup, importedSkin } = args;
  if (!styleGroup || styleGroup.skinId !== "imported-skin" || !importedSkin) {
    return null;
  }

  const cardHtml = importedSkin.cardHtml ?? "";
  const cardCss = importedSkin.cardCss ?? "";
  const cardSvg = importedSkin.cardSvg ?? "";
  if (!hasSkinContent(cardHtml) && !hasSkinContent(cardCss) && !hasSkinContent(cardSvg)) {
    return null;
  }

  const scopeClassName = buildImportedSkinScopeClass(importedSkin.id);
  const scopedCss = scopeImportedCssRules(sanitizeMarkup(cardCss), `.${scopeClassName}`);

  return (
    <div
      className={`surface-skin ${scopeClassName}`}
      style={{ ["--accent" as string]: styleGroup.accent ?? "#9cf667" }}
    >
      <style>{scopedCss}</style>
      {cardSvg ? (
        <div
          className="imported-svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html: sanitizeMarkup(cardSvg)
          }}
        />
      ) : null}
      <div
        className="imported-html"
        aria-hidden="true"
        dangerouslySetInnerHTML={{
          __html: renderImportedTemplate(cardHtml, label)
        }}
      />
    </div>
  );
}

export function renderButtonSkin(args: {
  label: string;
  styleGroup?: StyleGroup;
  importedSkin?: ImportedSkin;
  selected?: boolean;
  compact?: boolean;
  contract?: FlowButtonSkinContract;
  hostClassName?: string;
  footprintMode?: FlowButtonFootprintMode;
  skinRef?: Ref<HTMLDivElement>;
  onSkinPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onSkinPointerLeave?: PointerEventHandler<HTMLDivElement>;
}): ReactElement {
  const {
    label,
    styleGroup,
    importedSkin,
    selected,
    compact,
    contract,
    hostClassName,
    footprintMode,
    skinRef,
    onSkinPointerEnter,
    onSkinPointerLeave
  } = args;
  const skinId = styleGroup?.skinId ?? "glass-card";
  const accent = styleGroup?.accent ?? "#9cf667";
  const skinContract: FlowButtonSkinContract | undefined = contract
    ? {
        ...contract,
        compact: contract.compact ?? compact,
        selected: contract.selected ?? selected,
        flowLabel: contract.flowLabel ?? label
      }
    : undefined;
  const sharedClassName = buildFlowButtonClassName(
    ["button-skin", `button-skin--${skinId}`],
    skinContract ?? {
      flowId: label,
      flowLabel: label,
      selected,
      compact
    }
  );
  const sharedDataAttributes = skinContract
    ? buildFlowButtonDataAttributes(skinContract)
    : undefined;
  const sharedSurfaceTokens = hostClassName
    ?.split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .join(" ");
  const sharedStyle = skinContract
    ? {
        ["--accent" as string]: accent,
        ...buildFlowButtonCssVars(skinContract)
      }
    : { ["--accent" as string]: accent };
  const sharedRootDataAttributes = {
    ...(sharedDataAttributes ?? {}),
    ...(footprintMode ? { "data-flow-footprint": footprintMode } : {}),
    ...(sharedSurfaceTokens ? { "data-flow-surface": sharedSurfaceTokens } : {})
  };

  if (skinId === "imported-skin" && importedSkin) {
    return (
      <ImportedButtonSkinRoot
        className={sharedClassName}
        label={label}
        importedSkin={importedSkin}
        style={sharedStyle}
        forwardedRef={skinRef}
        dataAttributes={sharedRootDataAttributes}
        onPointerEnter={onSkinPointerEnter}
        onPointerLeave={onSkinPointerLeave}
      />
    );
  }

  return (
    <div
      className={sharedClassName}
      style={sharedStyle}
      ref={skinRef}
      {...sharedRootDataAttributes}
    >
      <span className="button-skin__glow" aria-hidden="true" />
      <span className="button-skin__label">{label}</span>
      {selected ? <span className="button-skin__selected-overlay" aria-hidden="true" /> : null}
      {skinId === "signal-strip" ? (
        <svg
          className="button-skin__signal"
          viewBox="0 0 180 54"
          aria-hidden="true"
        >
          <path
            d="M10 27h26l10-12 12 24 14-28 12 18 18-10 14 8 14-12 12 12h16"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </div>
  );
}
