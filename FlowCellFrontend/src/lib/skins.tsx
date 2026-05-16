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

function prependHostCondition(selector: string, condition: string): string {
  if (!selector.startsWith(":host")) {
    return selector;
  }
  if (selector.startsWith(":host(")) {
    const closeIndex = selector.indexOf(")");
    if (closeIndex > 5) {
      const existingCondition = selector.slice(6, closeIndex);
      return `:host(${existingCondition}${condition})${selector.slice(closeIndex + 1)}`;
    }
  }
  return `:host(${condition})${selector.slice(5)}`;
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
  const replacedRoot = hostMapped.replace(/\bhtml\b|\bbody\b|:root/g, scopeSelector);
  if (replacedRoot.includes(scopeSelector)) {
    return replacedRoot;
  }
  if (/^[>+~]/.test(replacedRoot)) {
    return `${scopeSelector}${replacedRoot}`;
  }
  return `${scopeSelector} ${replacedRoot}`;
}

function buildImportedStateSelectors(
  scopedSelector: string,
  scopeSelector: string,
  stateAttribute: string,
  pseudoSelector: ":hover" | ":active"
): string[] {
  if (!scopedSelector.includes(pseudoSelector)) {
    return [];
  }

  const strippedSelector = scopedSelector
    .replaceAll(pseudoSelector, "")
    .replace(/:has\([^)]*\)/g, "");
  if (scopeSelector !== ":host") {
    return [
      strippedSelector.replace(
        scopeSelector,
        `${scopeSelector}[${stateAttribute}]`
      )
    ];
  }

  const selectors = [
    prependHostCondition(strippedSelector, `[${stateAttribute}]`)
  ];
  if (pseudoSelector === ":hover") {
    selectors.push(prependHostCondition(strippedSelector, ":hover"));
  }
  return Array.from(new Set(selectors.filter(Boolean)));
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
    const expandedSelectors = scopedSelectors.flatMap((selector) => {
      const selectors = [selector];
      const hoveredSelectors = buildImportedStateSelectors(
        selector,
        scopeSelector,
        'data-hovered="true"',
        ":hover"
      );
      for (const hoveredSelector of hoveredSelectors) {
        if (hoveredSelector !== selector) {
          selectors.push(hoveredSelector);
        }
      }
      const pressedSelectors = buildImportedStateSelectors(
        selector,
        scopeSelector,
        'data-pressed="true"',
        ":active"
      );
      for (const pressedSelector of pressedSelectors) {
        if (pressedSelector !== selector) {
          selectors.push(pressedSelector);
        }
      }
      return selectors;
    });
    const scopedPrelude = Array.from(new Set(expandedSelectors)).join(", ");
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

function buildImportedButtonShadowCss(
  importedSkin: ImportedSkin,
  inlineCssBlocks: string[] = []
): string {
  const usesLegacyBodyShell = usesLegacyImportedBodyShell(importedSkin);
  const scopedCssBlocks = [sanitizeMarkup(importedSkin.css), ...inlineCssBlocks]
    .map((cssBlock) => cssBlock.trim())
    .filter(Boolean)
    .map((cssBlock) => scopeImportedCssRules(cssBlock, ":host"));
  return [
    ":host{position:relative;display:inline-grid;place-items:center;min-width:0;min-height:0;color:inherit;text-align:center;overflow:visible;}",
    ":host([data-flow-sizing=\"fill-stretch\"]){width:100%;height:100%;}",
    ":host([data-flow-overflow=\"false\"]){overflow:hidden;}",
    ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html,:host([data-flow-sizing=\"fill-stretch\"]) .imported-svg{width:100%;height:100%;}",
    ".imported-svg{position:absolute;inset:8px;opacity:.6;}",
    ".imported-svg svg{width:100%;height:100%;}",
    ".imported-html{position:relative;z-index:1;display:inline-grid;place-items:center;width:auto;height:auto;line-height:0;}",
    ".imported-html>:first-child{margin:0!important;}",
    ".imported-html>button{display:block;margin:0;width:auto;max-width:100%;vertical-align:middle;line-height:normal;box-sizing:border-box;}",
    ":host([data-flow-footprint=\"default-axis-normalized\"]) .imported-html{display:grid;width:100%;height:100%;place-items:center;overflow:visible;}",
    ":host([data-flow-footprint=\"default-axis-normalized\"]) .imported-html>:first-child{transform:scale(var(--flow-scale,1));transform-origin:center center;}",
    usesLegacyBodyShell
      ? ".imported-html>.body{width:100%!important;height:100%!important;margin:0!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;font-size:.875rem!important;background:transparent!important;overflow:hidden!important;min-width:0!important;min-height:0!important;}"
      : ".imported-html>.body{margin:0!important;background:transparent!important;min-width:0!important;min-height:0!important;}",
    usesLegacyBodyShell
      ? ":host.is-compact .imported-html>.body{font-size:.72rem!important;}"
      : "",
    usesLegacyBodyShell
      ? ".imported-html>.body>*{flex:0 1 auto;min-width:0;min-height:0;max-width:100%;max-height:100%;}"
      : ".imported-html>.body>*{min-width:0;min-height:0;}",
    usesLegacyBodyShell
      ? ".imported-html>.body>.button-wrap,.imported-html>.body>.button,.imported-html>.body .button{max-width:100%!important;max-height:100%!important;}"
      : "",
    usesLegacyBodyShell
      ? ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body{width:100%!important;height:100%!important;}"
      : "",
    usesLegacyBodyShell
      ? ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body>.button-wrap,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body>.button-wrap{display:flex!important;align-items:stretch!important;justify-content:stretch!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;}"
      : "",
    usesLegacyBodyShell
      ? ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body>.button-wrap>.button,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body>.button-wrap>.button,:host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body .button,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body .button{display:flex!important;align-items:stretch!important;justify-content:stretch!important;width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;box-sizing:border-box!important;}"
      : "",
    usesLegacyBodyShell
      ? ":host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body>.button-wrap>.button>.span,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body>.button-wrap>.button>.span,:host([data-flow-sizing=\"fill-stretch\"]) .imported-html>.body .button>.span,:host([data-flow-sizing=\"responsive-uniform\"]) .imported-html>.body .button>.span{display:flex!important;align-items:center!important;justify-content:center!important;min-width:0!important;min-height:100%!important;box-sizing:border-box!important;}"
      : "",
    ".imported-html,.imported-html *,.imported-svg,.imported-svg *{pointer-events:none!important;}",
    ".glass-hover-label,.imported-pill__label{color:var(--fc-theme-page-foreground)!important;text-shadow:0 .18em .08em color-mix(in srgb,var(--fc-theme-surface-shadow) 34%,transparent)!important;}",
    ...scopedCssBlocks
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
        window.cancelAnimationFrame(animationFrameId);
        observer.disconnect();
      };
    }, [importedSkin, label]);

    return (
      <div
        ref={setHostRef}
        className={className}
        style={style}
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
