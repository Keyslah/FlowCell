import type { CSSProperties } from "react";
import type { AppTheme, ImportedSkin } from "../types";

export interface AppThemePreset {
  id: string;
  name: string;
  theme: AppTheme;
}

export interface ImportedSkinPreset {
  id: string;
  name: string;
  skin: ImportedSkin;
}

export const DEFAULT_APP_THEME: AppTheme = {
  name: "Flow Glass",
  fontFamily: "\"Segoe UI\", sans-serif",
  pageBackground:
    "radial-gradient(circle at top left, color-mix(in srgb, #71d0ff 18%, transparent), transparent 28%), radial-gradient(circle at top right, color-mix(in srgb, #a4ff8e 18%, transparent), transparent 30%), linear-gradient(180deg, #061018, #091520 45%, #05080c)",
  pageForeground: "#f4fbff",
  mutedForeground: "#c6ddeb",
  surfaceColor: "#0b1621",
  surfaceBorder: "#d8efff",
  surfaceShadow: "#000000",
  controlColor: "#102535",
  buttonColor: "#122a3d",
  inputColor: "#07131d",
  accentColor: "#68d9ff",
  successColor: "#9cf667",
  dangerColor: "#ff5969"
};

export const APP_THEME_PRESETS: AppThemePreset[] = [
  {
    id: "eggshell-paper",
    name: "Eggshell Paper",
    theme: {
      name: "Eggshell Paper",
      fontFamily: "\"Segoe UI\", sans-serif",
      pageBackground:
        "linear-gradient(180deg, #f6f0e4, #f2eadc 48%, #ebe0cf)",
      pageForeground: "#4f4336",
      mutedForeground: "#77695b",
      surfaceColor: "#fffaf1",
      surfaceBorder: "#d4c4ae",
      surfaceShadow: "#9b8d7b",
      controlColor: "#f1e4d3",
      buttonColor: "#efe1cf",
      inputColor: "#fffaf2",
      accentColor: "#b89b74",
      successColor: "#96ab7f",
      dangerColor: "#c08375"
    }
  },
  {
    id: "flow-glass",
    name: "Flow Glass",
    theme: DEFAULT_APP_THEME
  },
  {
    id: "ember-console",
    name: "Ember Console",
    theme: {
      name: "Ember Console",
      fontFamily: "\"Trebuchet MS\", \"Segoe UI\", sans-serif",
      pageBackground:
        "radial-gradient(circle at top left, color-mix(in srgb, #ffb469 22%, transparent), transparent 28%), radial-gradient(circle at bottom right, color-mix(in srgb, #ff5969 16%, transparent), transparent 30%), linear-gradient(180deg, #140b08, #1d100c 42%, #0b0605)",
      pageForeground: "#fff3e8",
      mutedForeground: "#d8bfb0",
      surfaceColor: "#23110e",
      surfaceBorder: "#ffd2b3",
      surfaceShadow: "#050201",
      controlColor: "#311815",
      buttonColor: "#3b1d18",
      inputColor: "#170b09",
      accentColor: "#ffb469",
      successColor: "#d8ff72",
      dangerColor: "#ff6c67"
    }
  },
  {
    id: "signal-night",
    name: "Signal Night",
    theme: {
      name: "Signal Night",
      fontFamily: "\"Bahnschrift\", \"Segoe UI\", sans-serif",
      pageBackground:
        "radial-gradient(circle at top left, color-mix(in srgb, #87c7ff 16%, transparent), transparent 30%), radial-gradient(circle at center right, color-mix(in srgb, #6effd6 14%, transparent), transparent 26%), linear-gradient(180deg, #040912, #07111a 48%, #02050a)",
      pageForeground: "#ffffff",
      mutedForeground: "#ffffff",
      surfaceColor: "#091723",
      surfaceBorder: "#bbdef3",
      surfaceShadow: "#010305",
      controlColor: "#0f2332",
      buttonColor: "#133248",
      inputColor: "#07121c",
      accentColor: "#6effd6",
      successColor: "#92ff7a",
      dangerColor: "#ff5c7a"
    }
  }
];

const LEGACY_GLASS_HOVER_HTML = `<div class="glass-pill"><span class="glass-pill__label">{{label}}</span></div>`;
const LEGACY_GLASS_HOVER_CSS = `.glass-pill{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 1.5em;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.78),rgba(243,236,224,.88));box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 12px 28px rgba(99,74,46,.12);backdrop-filter:blur(6px);overflow:hidden;transition:transform 220ms ease,box-shadow 220ms ease}.glass-pill::before{content:"";position:absolute;inset:1px;border-radius:inherit;background:linear-gradient(135deg,rgba(255,255,255,.66),rgba(255,255,255,0) 48%);opacity:.82}.glass-pill::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(187,161,130,.46));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.72}.glass-pill__label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:100%;padding:.95em 1.5em;font-family:"Segoe UI",sans-serif;letter-spacing:-.04em;font-weight:600;font-size:1em;line-height:1;color:#3f372f;text-align:center;text-transform:none;text-shadow:0 .18em .05em rgba(255,255,255,.35)}.button-skin.is-compact .glass-pill{padding:0 .18em;box-shadow:inset 0 1px 0 rgba(255,255,255,.88),0 3px 8px rgba(99,74,46,.08)}.button-skin.is-compact .glass-pill__label{padding:.12em .26em;font-size:.64em;line-height:1;letter-spacing:-.01em;text-shadow:none}.button-skin:hover .glass-pill,.button-skin.is-selected .glass-pill{transform:scale(.985);box-shadow:inset 0 1px 0 rgba(255,255,255,.92),0 10px 22px rgba(99,74,46,.15)}`;
const GLASS_HOVER_CARD_HTML = `<div class="glass-surface"><span class="glass-surface__label">{{label}}</span></div>`;
const GLASS_HOVER_CARD_CSS = `.glass-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.24),rgba(243,236,224,.12));box-shadow:inset 0 1px 0 rgba(255,255,255,.78),inset 0 -40px 64px rgba(201,175,137,.08);overflow:hidden}.glass-surface::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,rgba(193,214,135,.2),transparent 26%),linear-gradient(135deg,rgba(255,255,255,.4),rgba(255,255,255,0) 48%)}.glass-surface::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(135deg,rgba(255,255,255,.86),rgba(187,161,130,.38));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.74}.glass-surface__label{position:absolute;top:18px;right:22px;z-index:1;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:rgba(91,73,51,.42)}`;

export const DEFAULT_GLASS_HOVER_IMPORTED_SKIN: ImportedSkin = {
  id: "imported-skin-glass-hover",
  name: "Glass Hover Pill",
  html: `<div class="glass-hover-wrap"><div class="glass-hover-button"><span class="glass-hover-label">{{label}}</span></div><div class="glass-hover-shadow"></div></div>`,
  css: `@property --glass-hover-angle-1{syntax:"<angle>";inherits:false;initial-value:-75deg}@property --glass-hover-angle-2{syntax:"<angle>";inherits:false;initial-value:-75deg}.glass-hover-wrap{--glass-hover-border-width:clamp(1px,0.0625em,4px);--glass-hover-shadow-fix:2em;--glass-hover-time:400ms;--glass-hover-ease:cubic-bezier(0.25,1,0.5,1);position:relative;display:flex;align-items:stretch;justify-content:stretch;width:100%;height:100%;border-radius:999px}.glass-hover-button{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:999px;background:linear-gradient(-75deg,rgba(255,255,255,.05),rgba(255,255,255,.2),rgba(255,255,255,.05));box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.5),0 .25em .125em -.125em rgba(0,0,0,.2),0 0 .1em .25em inset rgba(255,255,255,.2),0 0 0 0 rgba(255,255,255,1);backdrop-filter:blur(clamp(1px,0.125em,4px));-webkit-backdrop-filter:blur(clamp(1px,0.125em,4px));overflow:hidden;transition:all var(--glass-hover-time) var(--glass-hover-ease)}.glass-hover-label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;flex:1 1 auto;min-width:0;height:100%;padding-inline:1.5em;padding-block:.875em;font-family:"Inter","Segoe UI",sans-serif;letter-spacing:-.05em;font-weight:500;font-size:1em;line-height:1;color:rgba(50,50,50,1);text-align:center;text-shadow:0 .25em .05em rgba(0,0,0,.1);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;transition:all var(--glass-hover-time) var(--glass-hover-ease)}.glass-hover-label::after{content:"";display:block;position:absolute;z-index:3;width:calc(100% - var(--glass-hover-border-width));height:calc(100% - var(--glass-hover-border-width));top:calc(var(--glass-hover-border-width) / 2);left:calc(var(--glass-hover-border-width) / 2);box-sizing:border-box;border-radius:999px;background:linear-gradient(var(--glass-hover-angle-2),rgba(255,255,255,0) 0%,rgba(255,255,255,.5) 40% 50%,rgba(255,255,255,0) 55%);mix-blend-mode:screen;pointer-events:none;background-size:200% 200%;background-position:0% 50%;background-repeat:no-repeat;transition:background-position calc(var(--glass-hover-time) * 1.25) var(--glass-hover-ease),--glass-hover-angle-2 calc(var(--glass-hover-time) * 1.25) var(--glass-hover-ease)}.glass-hover-button::after{content:"";position:absolute;z-index:1;inset:0;border-radius:999px;width:calc(100% + var(--glass-hover-border-width));height:calc(100% + var(--glass-hover-border-width));top:calc(0% - var(--glass-hover-border-width) / 2);left:calc(0% - var(--glass-hover-border-width) / 2);padding:var(--glass-hover-border-width);box-sizing:border-box;background:conic-gradient(from var(--glass-hover-angle-1) at 50% 50%,rgba(0,0,0,.5),rgba(0,0,0,0) 5% 40%,rgba(0,0,0,.5) 50%,rgba(0,0,0,0) 60% 95%,rgba(0,0,0,.5)),linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,.5));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;box-shadow:inset 0 0 0 calc(var(--glass-hover-border-width) / 2) rgba(255,255,255,.5);transition:all var(--glass-hover-time) var(--glass-hover-ease),--glass-hover-angle-1 500ms ease}.glass-hover-shadow{position:absolute;inset:calc(0% - var(--glass-hover-shadow-fix) / 2);z-index:0;filter:blur(clamp(2px,0.125em,12px));pointer-events:none}.glass-hover-shadow::after{content:"";position:absolute;inset:0;border-radius:999px;background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.1));width:calc(100% - var(--glass-hover-shadow-fix) - .25em);height:calc(100% - var(--glass-hover-shadow-fix) - .25em);top:calc(var(--glass-hover-shadow-fix) - .5em);left:calc(var(--glass-hover-shadow-fix) - .875em);padding:.125em;box-sizing:border-box;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:1;transition:all var(--glass-hover-time) var(--glass-hover-ease)}.button-skin:hover .glass-hover-button,.button-skin.is-selected .glass-hover-button{transform:scale(.975);backdrop-filter:blur(.01em);-webkit-backdrop-filter:blur(.01em);box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.5),0 .15em .05em -.1em rgba(0,0,0,.25),0 0 .05em .1em inset rgba(255,255,255,.5),0 0 0 0 rgba(255,255,255,1)}.button-skin:hover .glass-hover-label,.button-skin.is-selected .glass-hover-label{text-shadow:.025em .025em .025em rgba(0,0,0,.12)}.button-skin:hover .glass-hover-label::after,.button-skin.is-selected .glass-hover-label::after{background-position:25% 50%}.button-skin:hover .glass-hover-button::after,.button-skin.is-selected .glass-hover-button::after{--glass-hover-angle-1:-125deg}.button-skin:hover .glass-hover-shadow,.button-skin.is-selected .glass-hover-shadow{filter:blur(clamp(2px,0.0625em,6px))}.button-skin:hover .glass-hover-shadow::after,.button-skin.is-selected .glass-hover-shadow::after{top:calc(var(--glass-hover-shadow-fix) - .875em);opacity:1}.button-skin.is-compact .glass-hover-wrap{font-size:.72rem}.button-skin.is-compact .glass-hover-label{padding-inline:1em;padding-block:.5em;font-size:1em;line-height:1;text-shadow:none}.button-skin.is-compact .glass-hover-button{box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.5),0 .125em .125em -.125em rgba(0,0,0,.14),0 0 .05em .12em inset rgba(255,255,255,.2)}.button-skin.is-compact .glass-hover-shadow::after{top:calc(var(--glass-hover-shadow-fix) - .65em);left:calc(var(--glass-hover-shadow-fix) - .7em)}`,
  cardHtml: GLASS_HOVER_CARD_HTML,
  cardCss: GLASS_HOVER_CARD_CSS,
  svg: ""
};

export function isLegacyGlassHoverImportedSkin(skin: ImportedSkin): boolean {
  return (
    skin.id === "imported-skin-glass-hover" &&
    skin.html === LEGACY_GLASS_HOVER_HTML &&
    skin.css === LEGACY_GLASS_HOVER_CSS
  );
}

export const DEFAULT_IMPORTED_SKINS: ImportedSkin[] = [
  {
    id: "imported-skin-01",
    name: "Imported Skin 01",
    html: `<div class="imported-pill"><span class="imported-pill__label">{{label}}</span></div>`,
    css: `.imported-pill{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 28px;border-radius:999px;background:linear-gradient(-75deg,rgba(255,255,255,.05),rgba(255,255,255,.2),rgba(255,255,255,.05));box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.55),0 .25em .125em -.125em rgba(0,0,0,.18),0 0 .08em .18em inset rgba(255,255,255,.18),0 0 0 0 rgba(255,255,255,1);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow:hidden}.imported-pill::before{content:"";position:absolute;inset:1px;border-radius:inherit;background:linear-gradient(-75deg,rgba(255,255,255,0),rgba(255,255,255,.42) 42% 50%,rgba(255,255,255,0) 56%);mix-blend-mode:screen;background-size:200% 200%;background-position:0% 50%;background-repeat:no-repeat;opacity:.72;transition:background-position .24s ease}.button-skin:hover .imported-pill::before,.button-skin.is-selected .imported-pill::before{background-position:26% 50%}.imported-pill::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:conic-gradient(from -75deg at 50% 50%,rgba(255,255,255,.34),rgba(255,255,255,0) 8% 38%,rgba(255,255,255,.24) 50%,rgba(255,255,255,0) 62% 92%,rgba(255,255,255,.28)),linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.08));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.9}.button-skin.is-selected .imported-pill{background:linear-gradient(-75deg,rgba(132,205,239,.08),rgba(255,255,255,.22),rgba(132,205,239,.08)),rgba(91,154,194,.12);box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.6),0 .25em .125em -.125em rgba(0,0,0,.18),0 0 .08em .18em inset rgba(191,233,255,.18),0 0 0 1px rgba(104,217,255,.12),0 0 18px rgba(104,217,255,.12)}.imported-pill__label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:100%;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:center;color:rgba(245,248,250,.96);font:500 14px/1 "Segoe UI",sans-serif;letter-spacing:-.03em;text-shadow:0 .18em .05em rgba(0,0,0,.16)}.button-skin.is-compact .imported-pill{padding:0 10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 3px 8px rgba(0,0,0,.12),0 0 .04em .08em inset rgba(255,255,255,.14)}.button-skin.is-compact .imported-pill__label{font-size:11px;line-height:1;padding:2px 0;letter-spacing:-.01em;text-shadow:none}`,
    cardHtml: `<div class="soft-surface"><span class="soft-surface__label">{{label}}</span></div>`,
    cardCss: `.soft-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.46),inset 0 -24px 40px rgba(95,137,164,.1);overflow:hidden}.soft-surface::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,0) 48%)}.soft-surface__label{position:absolute;top:16px;right:20px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:rgba(245,248,250,.54)}`,
    svg: ""
  },
  DEFAULT_GLASS_HOVER_IMPORTED_SKIN
];

export const IMPORTED_SKIN_PRESETS: ImportedSkinPreset[] = [
  {
    id: "glass-hover-pill",
    name: "Glass Hover Pill",
    skin: DEFAULT_IMPORTED_SKINS.find((skin) => skin.id === "imported-skin-glass-hover") as ImportedSkin
  }
];

function readThemeField(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function normalizeAppTheme(theme?: Partial<AppTheme> | null): AppTheme {
  return {
    name: readThemeField(theme?.name, DEFAULT_APP_THEME.name),
    fontFamily: readThemeField(theme?.fontFamily, DEFAULT_APP_THEME.fontFamily),
    pageBackground: readThemeField(theme?.pageBackground, DEFAULT_APP_THEME.pageBackground),
    pageForeground: readThemeField(theme?.pageForeground, DEFAULT_APP_THEME.pageForeground),
    mutedForeground: readThemeField(theme?.mutedForeground, DEFAULT_APP_THEME.mutedForeground),
    surfaceColor: readThemeField(theme?.surfaceColor, DEFAULT_APP_THEME.surfaceColor),
    surfaceBorder: readThemeField(theme?.surfaceBorder, DEFAULT_APP_THEME.surfaceBorder),
    surfaceShadow: readThemeField(theme?.surfaceShadow, DEFAULT_APP_THEME.surfaceShadow),
    controlColor: readThemeField(theme?.controlColor, DEFAULT_APP_THEME.controlColor),
    buttonColor: readThemeField(theme?.buttonColor, DEFAULT_APP_THEME.buttonColor),
    inputColor: readThemeField(theme?.inputColor, DEFAULT_APP_THEME.inputColor),
    accentColor: readThemeField(theme?.accentColor, DEFAULT_APP_THEME.accentColor),
    successColor: readThemeField(theme?.successColor, DEFAULT_APP_THEME.successColor),
    dangerColor: readThemeField(theme?.dangerColor, DEFAULT_APP_THEME.dangerColor)
  };
}

export function getAppThemePreset(presetId: string): AppTheme | undefined {
  const preset = APP_THEME_PRESETS.find((entry) => entry.id === presetId);
  return preset ? normalizeAppTheme(preset.theme) : undefined;
}

export function buildAppThemeCssVars(theme: AppTheme): CSSProperties {
  const normalized = normalizeAppTheme(theme);
  return {
    ["--fc-theme-font-family" as string]: normalized.fontFamily,
    ["--fc-theme-page-background" as string]: normalized.pageBackground,
    ["--fc-theme-page-foreground" as string]: normalized.pageForeground,
    ["--fc-theme-muted-foreground" as string]: normalized.mutedForeground,
    ["--fc-theme-surface-color" as string]: normalized.surfaceColor,
    ["--fc-theme-surface-border" as string]: normalized.surfaceBorder,
    ["--fc-theme-surface-shadow" as string]: normalized.surfaceShadow,
    ["--fc-theme-control-color" as string]: normalized.controlColor,
    ["--fc-theme-button-color" as string]: normalized.buttonColor,
    ["--fc-theme-input-color" as string]: normalized.inputColor,
    ["--fc-theme-accent" as string]: normalized.accentColor,
    ["--fc-theme-success" as string]: normalized.successColor,
    ["--fc-theme-danger" as string]: normalized.dangerColor
  };
}

export function buildEggshellImportedSkin(skinId: string): ImportedSkin {
  return {
    id: skinId,
    name: "Eggshell Pill",
    html: `<div class="imported-pill"><span class="imported-pill__label">{{label}}</span></div>`,
    css: `.imported-pill{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 28px;border-radius:999px;background:linear-gradient(180deg,#fbf6ec,#efe3d0);border:1px solid rgba(173,144,106,.36);box-shadow:inset 0 1px 0 rgba(255,255,255,.82),0 10px 22px rgba(154,132,100,.14);overflow:hidden}.imported-pill::before{content:"";position:absolute;inset:1px;border-radius:inherit;background:linear-gradient(90deg,rgba(255,255,255,.34),rgba(255,255,255,0));opacity:.82}.button-skin:hover .imported-pill,.button-skin.is-selected .imported-pill{background:linear-gradient(180deg,#fffaf0,#ecdcc5);border-color:rgba(184,155,116,.58);box-shadow:inset 0 1px 0 rgba(255,255,255,.92),0 12px 26px rgba(154,132,100,.18),0 0 0 1px rgba(184,155,116,.14)}.imported-pill__label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:100%;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:center;color:#564734;font:600 14px/1 "Segoe UI",sans-serif;letter-spacing:.02em;text-transform:uppercase}.button-skin.is-compact .imported-pill{padding:0 10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.88),0 4px 10px rgba(154,132,100,.08)}.button-skin.is-compact .imported-pill__label{font-size:11px;line-height:1;padding:2px 0;letter-spacing:.01em}`,
    cardHtml: `<div class="eggshell-surface"><span class="eggshell-surface__label">{{label}}</span></div>`,
    cardCss: `.eggshell-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,250,242,.92),rgba(239,225,207,.72));box-shadow:inset 0 1px 0 rgba(255,255,255,.92),inset 0 -28px 52px rgba(184,155,116,.08);overflow:hidden}.eggshell-surface::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.58),rgba(255,255,255,0) 48%),radial-gradient(circle at top right,rgba(184,155,116,.12),transparent 28%)}.eggshell-surface::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(184,155,116,.32));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.9}.eggshell-surface__label{position:absolute;top:18px;right:22px;z-index:1;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:rgba(86,71,52,.4)}`,
    svg: ""
  };
}

export function getImportedSkinPreset(presetId: string): ImportedSkin | undefined {
  const preset = IMPORTED_SKIN_PRESETS.find((entry) => entry.id === presetId);
  return preset ? { ...preset.skin } : undefined;
}
