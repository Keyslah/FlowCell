import type { ReactElement } from "react";
import type { ImportedSkin, StyleGroup } from "../types";

export const IMPORTED_SKIN_LABEL_PLACEHOLDER = "{{label}}";

function sanitizeMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

function renderImportedTemplate(markup: string, label: string): string {
  return sanitizeMarkup(markup).replace(/\{\{label\}\}/g, label);
}

function sanitizeScopeToken(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return sanitized.length > 0 ? sanitized : "imported-skin";
}

function buildImportedSkinScopeClass(importedSkinId: string | undefined): string {
  return `imported-skin-scope--${sanitizeScopeToken(importedSkinId ?? "")}`;
}

function scopeCssSelector(selector: string, scopeSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(from|to|\d+%)$/i.test(trimmed)) {
    return trimmed;
  }

  const replacedRoot = trimmed.replace(/\bhtml\b|\bbody\b|:root/g, scopeSelector);
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

    const scopedPrelude = prelude
      .split(",")
      .map((selector) => scopeCssSelector(selector, scopeSelector))
      .join(", ");
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
}): ReactElement {
  const { label, styleGroup, importedSkin, selected, compact } = args;
  const skinId = styleGroup?.skinId ?? "glass-card";
  const accent = styleGroup?.accent ?? "#9cf667";
  const sharedClassName = [
    "button-skin",
    `button-skin--${skinId}`,
    selected ? "is-selected" : "",
    compact ? "is-compact" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (skinId === "imported-skin" && importedSkin) {
    const scopeClassName = buildImportedSkinScopeClass(importedSkin.id);
    const scopedCss = scopeImportedCssRules(sanitizeMarkup(importedSkin.css), `.${scopeClassName}`);
    return (
      <div
        className={`${sharedClassName} ${scopeClassName}`}
        style={{ ["--accent" as string]: accent }}
      >
        <style>{scopedCss}</style>
        {importedSkin.svg ? (
          <div
            className="imported-svg"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: sanitizeMarkup(importedSkin.svg)
            }}
          />
        ) : null}
        <div
          className="imported-html"
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html: renderImportedTemplate(importedSkin.html, label)
          }}
        />
        {selected ? <span className="button-skin__selected-overlay" aria-hidden="true" /> : null}
      </div>
    );
  }

  return (
    <div className={sharedClassName} style={{ ["--accent" as string]: accent }}>
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
