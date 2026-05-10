import type { ReactElement } from "react";
import type { ImportedSkin, StyleGroup } from "../types";

function sanitizeMarkup(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

function renderImportedTemplate(markup: string, label: string): string {
  return sanitizeMarkup(markup).replace(/\{\{label\}\}/g, label);
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

  return (
    <div
      className="surface-skin"
      style={{ ["--accent" as string]: styleGroup.accent ?? "#9cf667" }}
    >
      <style>{sanitizeMarkup(cardCss)}</style>
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
    return (
      <div className={sharedClassName} style={{ ["--accent" as string]: accent }}>
        <style>{sanitizeMarkup(importedSkin.css)}</style>
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
      </div>
    );
  }

  return (
    <div className={sharedClassName} style={{ ["--accent" as string]: accent }}>
      <span className="button-skin__glow" aria-hidden="true" />
      <span className="button-skin__label">{label}</span>
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
