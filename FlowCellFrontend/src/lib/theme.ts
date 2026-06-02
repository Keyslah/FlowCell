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

export const BLACK_TINT_THEME_BINDING = "black-tint" as const;

export const FLOW_GLASS_APP_THEME: AppTheme = {
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
  dangerColor: "#ff5969",
  mainCardBlurPx: 18,
  blackTintOpacity: 0.92
};

export const NATURE_FROST_APP_THEME: AppTheme = {
  name: "Nature Frost",
  fontFamily: "\"Segoe UI\", sans-serif",
  pageBackground:
    "linear-gradient(180deg, rgba(5, 9, 7, 0.82), rgba(7, 10, 8, 0.58) 48%, rgba(4, 6, 5, 0.7))",
  pageForeground: "#f4f7f4",
  mutedForeground: "#d4dbd4",
  surfaceColor: "#101512",
  surfaceBorder: "#edf2ed",
  surfaceShadow: "#010201",
  controlColor: "#101512",
  buttonColor: "#122a3d",
  inputColor: "#0c100d",
  accentColor: "#dce9d9",
  successColor: "#b8e7bb",
  dangerColor: "#ff8f84",
  mainCardBlurPx: 22,
  blackTintOpacity: 0.92
};

export const DEFAULT_APP_THEME: AppTheme = FLOW_GLASS_APP_THEME;

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
      dangerColor: "#c08375",
      mainCardBlurPx: 12,
      blackTintOpacity: 0.92
    }
  },
  {
    id: "flow-glass",
    name: "Flow Glass",
    theme: FLOW_GLASS_APP_THEME
  },
  {
    id: "nature-frost",
    name: "Nature Frost",
    theme: NATURE_FROST_APP_THEME
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
      dangerColor: "#ff6c67",
      mainCardBlurPx: 14,
      blackTintOpacity: 0.92
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
      dangerColor: "#ff5c7a",
      mainCardBlurPx: 16,
      blackTintOpacity: 0.92
    }
  }
];

const DEFAULT_FLOW_IMPORTED_CARD_HTML = `<div class="soft-surface"><span class="soft-surface__label">{{label}}</span></div>`;
const DEFAULT_FLOW_IMPORTED_CARD_CSS = `.soft-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.46),inset 0 -24px 40px rgba(95,137,164,.1);overflow:hidden}.soft-surface::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,0) 48%)}.soft-surface__label{position:absolute;top:16px;right:20px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:rgba(245,248,250,.54)}`;
const DEFAULT_FLOW_IMPORTED_BUTTON_HTML = `<div class="body"><div class="button-wrap"><button class="button"><span class="span">{{label}}</span></button><div class="button-shadow"></div></div></div>`;
const DEFAULT_FLOW_IMPORTED_BUTTON_CSS = `.body{--global--size:clamp(2rem,3em,5rem);--anim--hover-time:400ms;--anim--hover-ease:cubic-bezier(0.25,1,0.5,1)}
.body{width:100%;height:100%;margin:0;padding:0;display:flex;align-items:center;justify-content:center;font-size:var(--global--size);background-color:#d7d7d7;font-family:"Inter",sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow:hidden}
.button-wrap{position:relative;z-index:2;border-radius:999px;background:transparent;pointer-events:none;transition:all var(--anim--hover-time) var(--anim--hover-ease)}
.button-shadow{--shadow-cuttoff-fix:2em;position:absolute;width:calc(100% + var(--shadow-cuttoff-fix));height:calc(100% + var(--shadow-cuttoff-fix));top:calc(0% - var(--shadow-cuttoff-fix) / 2);left:calc(0% - var(--shadow-cuttoff-fix) / 2);filter:blur(clamp(2px,0.125em,12px));-webkit-filter:blur(clamp(2px,0.125em,12px));-moz-filter:blur(clamp(2px,0.125em,12px));-ms-filter:blur(clamp(2px,0.125em,12px));overflow:visible;pointer-events:none}
.button-shadow::after{content:"";position:absolute;z-index:0;inset:0;border-radius:999px;background:linear-gradient(180deg,rgba(0,0,0,0.2),rgba(0,0,0,0.1));width:calc(100% - var(--shadow-cuttoff-fix) - 0.25em);height:calc(100% - var(--shadow-cuttoff-fix) - 0.25em);top:calc(var(--shadow-cuttoff-fix) - 0.5em);left:calc(var(--shadow-cuttoff-fix) - 0.875em);padding:0.125em;box-sizing:border-box;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;transition:all var(--anim--hover-time) var(--anim--hover-ease);overflow:visible;opacity:1}
.button{--border-width:clamp(1px,0.0625em,4px);all:unset;cursor:pointer;position:relative;-webkit-tap-highlight-color:rgba(0,0,0,0);pointer-events:auto;z-index:3;background:linear-gradient(-75deg,rgba(255,255,255,0.05),rgba(255,255,255,0.2),rgba(255,255,255,0.05));border-radius:999px;box-shadow:inset 0 0.125em 0.125em rgba(0,0,0,0.05),inset 0 -0.125em 0.125em rgba(255,255,255,0.5),0 0.25em 0.125em -0.125em rgba(0,0,0,0.2),0 0 0.1em 0.25em inset rgba(255,255,255,0.2),0 0 0 0 rgba(255,255,255,1);backdrop-filter:blur(clamp(1px,0.125em,4px));-webkit-backdrop-filter:blur(clamp(1px,0.125em,4px));-moz-backdrop-filter:blur(clamp(1px,0.125em,4px));-ms-backdrop-filter:blur(clamp(1px,0.125em,4px));transition:all var(--anim--hover-time) var(--anim--hover-ease)}
.button:hover{transform:scale(0.975);backdrop-filter:blur(0.01em);-webkit-backdrop-filter:blur(0.01em);-moz-backdrop-filter:blur(0.01em);-ms-backdrop-filter:blur(0.01em);box-shadow:inset 0 0.125em 0.125em rgba(0,0,0,0.05),inset 0 -0.125em 0.125em rgba(255,255,255,0.5),0 0.15em 0.05em -0.1em rgba(0,0,0,0.25),0 0 0.05em 0.1em inset rgba(255,255,255,0.5),0 0 0 0 rgba(255,255,255,1)}
.button .span{position:relative;display:block;user-select:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;font-family:"Inter",sans-serif;letter-spacing:-0.05em;font-weight:500;font-size:1em;color:rgba(50,50,50,1);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-shadow:0em 0.25em 0.05em rgba(0,0,0,0.1);transition:all var(--anim--hover-time) var(--anim--hover-ease);padding-inline:1.5em;padding-block:0.875em}
.button:hover .span{text-shadow:0.025em 0.025em 0.025em rgba(0,0,0,0.12)}
.button .span::after{content:"";display:block;position:absolute;z-index:1;width:calc(100% - var(--border-width));height:calc(100% - var(--border-width));top:calc(0% + var(--border-width) / 2);left:calc(0% + var(--border-width) / 2);box-sizing:border-box;border-radius:999px;overflow:clip;background:linear-gradient(var(--angle-2),rgba(255,255,255,0) 0%,rgba(255,255,255,0.5) 40% 50%,rgba(255,255,255,0) 55%);z-index:3;mix-blend-mode:screen;pointer-events:none;background-size:200% 200%;background-position:0% 50%;background-repeat:no-repeat;transition:background-position calc(var(--anim--hover-time) * 1.25) var(--anim--hover-ease),--angle-2 calc(var(--anim--hover-time) * 1.25) var(--anim--hover-ease)}
.button:hover .span::after{background-position:25% 50%}
.button:active .span::after{background-position:50% 15%;--angle-2:-15deg}
.button::after{content:"";position:absolute;z-index:1;inset:0;border-radius:999px;width:calc(100% + var(--border-width));height:calc(100% + var(--border-width));top:calc(0% - var(--border-width) / 2);left:calc(0% - var(--border-width) / 2);padding:var(--border-width);box-sizing:border-box;background:conic-gradient(from var(--angle-1) at 50% 50%,rgba(0,0,0,0.5),rgba(0,0,0,0) 5% 40%,rgba(0,0,0,0.5) 50%,rgba(0,0,0,0) 60% 95%,rgba(0,0,0,0.5)),linear-gradient(180deg,rgba(255,255,255,0.5),rgba(255,255,255,0.5));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;transition:all var(--anim--hover-time) var(--anim--hover-ease),--angle-1 500ms ease;box-shadow:inset 0 0 0 calc(var(--border-width) / 2) rgba(255,255,255,0.5)}
.button:hover::after{--angle-1:-125deg}
.button:active::after{--angle-1:-75deg}
.button-wrap:has(button:hover) .button-shadow{filter:blur(clamp(2px,0.0625em,6px));-webkit-filter:blur(clamp(2px,0.0625em,6px));-moz-filter:blur(clamp(2px,0.0625em,6px));-ms-filter:blur(clamp(2px,0.0625em,6px));transition:filter var(--anim--hover-time) var(--anim--hover-ease)}
.button-wrap:has(button:hover) .button-shadow::after{top:calc(var(--shadow-cuttoff-fix) - 0.875em);opacity:1}
.button-wrap:has(button:active){transform:rotate3d(1,0,0,25deg)}
.button-wrap:has(button:active) button{box-shadow:inset 0 0.125em 0.125em rgba(0,0,0,0.05),inset 0 -0.125em 0.125em rgba(255,255,255,0.5),0 0.125em 0.125em -0.125em rgba(0,0,0,0.2),0 0 0.1em 0.25em inset rgba(255,255,255,0.2),0 0.225em 0.05em 0 rgba(0,0,0,0.05),0 0.25em 0 0 rgba(255,255,255,0.75),inset 0 0.25em 0.05em 0 rgba(0,0,0,0.15)}
.button-wrap:has(button:active) .button-shadow{filter:blur(clamp(2px,0.125em,12px));-webkit-filter:blur(clamp(2px,0.125em,12px));-moz-filter:blur(clamp(2px,0.125em,12px));-ms-filter:blur(clamp(2px,0.125em,12px))}
.button-wrap:has(button:active) .button-shadow::after{top:calc(var(--shadow-cuttoff-fix) - 0.5em);opacity:0.75}
.button-wrap:has(button:active) span{text-shadow:0.025em 0.25em 0.05em rgba(0,0,0,0.12)}`;
export const DEFAULT_IMPORTED_SKIN_BRIDGE_JS = `if (bridge.hostSurfaceIncludes("chrome-action")) {
  return bridge.mountButton({
    interactive: ".button",
    measure: ".button",
    label: ".span"
  });
}
return bridge.mountButton({
  interactive: ".button",
  measure: ".button",
  label: ".span",
  fitLabel: true,
  minFontScale: 0.6
});`;

export const DEFAULT_FLOW_IMPORTED_SKIN: ImportedSkin = {
  id: "imported-skin-default",
  name: "default",
  sizingMode: "responsive-uniform",
  allowOverflow: false,
  html: DEFAULT_FLOW_IMPORTED_BUTTON_HTML,
  css: DEFAULT_FLOW_IMPORTED_BUTTON_CSS,
  cardHtml: DEFAULT_FLOW_IMPORTED_CARD_HTML,
  cardCss: DEFAULT_FLOW_IMPORTED_CARD_CSS,
  svg: "",
  bridgeJs: DEFAULT_IMPORTED_SKIN_BRIDGE_JS
};

const DEFAULT_POPOUT_IMPORTED_BUTTON_CSS = `.body{--global--size:clamp(2rem,3em,5rem);--anim--hover-time:400ms;--anim--hover-ease:cubic-bezier(0.25,1,0.5,1)}
.body{width:100%;height:100%;margin:0;padding:0;display:flex;align-items:center;justify-content:center;font-size:var(--global--size);background-color:transparent;font-family:"Inter",sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;overflow:hidden}
.button-wrap{position:relative;z-index:2;border-radius:999px;background:transparent;pointer-events:none}
.button-shadow{--shadow-cuttoff-fix:2em;position:absolute;width:calc(100% + var(--shadow-cuttoff-fix));height:calc(100% + var(--shadow-cuttoff-fix));top:calc(0% - var(--shadow-cuttoff-fix) / 2);left:calc(0% - var(--shadow-cuttoff-fix) / 2);filter:blur(clamp(2px,0.125em,12px));-webkit-filter:blur(clamp(2px,0.125em,12px));-moz-filter:blur(clamp(2px,0.125em,12px));-ms-filter:blur(clamp(2px,0.125em,12px));overflow:visible;pointer-events:none;transition:filter var(--anim--hover-time) var(--anim--hover-ease)}
.button-shadow::after{content:"";position:absolute;z-index:0;inset:0;border-radius:999px;background:rgba(0,0,0,0.24);width:calc(100% - var(--shadow-cuttoff-fix) - 0.25em);height:calc(100% - var(--shadow-cuttoff-fix) - 0.25em);top:calc(var(--shadow-cuttoff-fix) - 0.5em);left:calc(var(--shadow-cuttoff-fix) - 0.875em);padding:0.125em;box-sizing:border-box;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;transition:all var(--anim--hover-time) var(--anim--hover-ease);overflow:visible;opacity:1}
.button{all:unset;cursor:pointer;position:relative;-webkit-tap-highlight-color:rgba(0,0,0,0);pointer-events:auto;z-index:3;background:rgba(0,0,0,0.85);border-radius:999px;backdrop-filter:blur(clamp(1px,0.125em,4px));-webkit-backdrop-filter:blur(clamp(1px,0.125em,4px));-moz-backdrop-filter:blur(clamp(1px,0.125em,4px));-ms-backdrop-filter:blur(clamp(1px,0.125em,4px));box-shadow:0 0.25em 0.125em -0.125em rgba(0,0,0,0.22);transition:background-color var(--anim--hover-time) var(--anim--hover-ease),backdrop-filter var(--anim--hover-time) var(--anim--hover-ease),-webkit-backdrop-filter var(--anim--hover-time) var(--anim--hover-ease),box-shadow var(--anim--hover-time) var(--anim--hover-ease)}
.button:hover,:host([data-hovered="true"]) .button,:host([data-selected="true"]) .button,:host([data-active="true"]) .button{background:rgba(0,0,0,0.92);backdrop-filter:blur(0.01em);-webkit-backdrop-filter:blur(0.01em);-moz-backdrop-filter:blur(0.01em);-ms-backdrop-filter:blur(0.01em);box-shadow:0 0.15em 0.05em -0.1em rgba(0,0,0,0.3)}
.button .span{position:relative;display:block;user-select:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;font-family:"Inter",sans-serif;letter-spacing:-0.05em;font-weight:500;font-size:1em;color:rgba(255,255,255,0.98);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-shadow:0 0.18em 0.08em rgba(0,0,0,0.42);transition:text-shadow var(--anim--hover-time) var(--anim--hover-ease);padding-inline:1.5em;padding-block:0.875em}
.button:hover .span,:host([data-hovered="true"]) .button .span,:host([data-selected="true"]) .button .span,:host([data-active="true"]) .button .span{text-shadow:0 0.18em 0.08em rgba(0,0,0,0.5)}
.button .span::after{content:none}
.button::after{content:none}
.button-wrap:has(button:hover) .button-shadow,:host([data-hovered="true"]) .button-wrap .button-shadow,:host([data-selected="true"]) .button-wrap .button-shadow,:host([data-active="true"]) .button-wrap .button-shadow{filter:blur(clamp(2px,0.0625em,6px));-webkit-filter:blur(clamp(2px,0.0625em,6px));-moz-filter:blur(clamp(2px,0.0625em,6px));-ms-filter:blur(clamp(2px,0.0625em,6px))}
.button-wrap:has(button:hover) .button-shadow::after,:host([data-hovered="true"]) .button-wrap .button-shadow::after,:host([data-selected="true"]) .button-wrap .button-shadow::after,:host([data-active="true"]) .button-wrap .button-shadow::after{opacity:0.9}
.button-wrap:has(button:active) button,:host([data-pressed="true"]) .button-wrap button{background:rgba(0,0,0,0.96);box-shadow:0 0.125em 0.125em -0.125em rgba(0,0,0,0.32)}
.button-wrap:has(button:active) .button-shadow,:host([data-pressed="true"]) .button-wrap .button-shadow{filter:blur(clamp(2px,0.125em,12px));-webkit-filter:blur(clamp(2px,0.125em,12px));-moz-filter:blur(clamp(2px,0.125em,12px));-ms-filter:blur(clamp(2px,0.125em,12px))}
.button-wrap:has(button:active) span,:host([data-pressed="true"]) .button-wrap span{text-shadow:0 0.18em 0.08em rgba(0,0,0,0.52)}`;

export const DEFAULT_POPOUT_IMPORTED_SKIN: ImportedSkin = {
  id: "imported-skin-popout-glass",
  name: "Popout Glass",
  sizingMode: "responsive-uniform",
  allowOverflow: false,
  html: DEFAULT_FLOW_IMPORTED_BUTTON_HTML,
  css: DEFAULT_POPOUT_IMPORTED_BUTTON_CSS,
  cardHtml: DEFAULT_FLOW_IMPORTED_CARD_HTML,
  cardCss: DEFAULT_FLOW_IMPORTED_CARD_CSS,
  svg: "",
  bridgeJs: DEFAULT_IMPORTED_SKIN_BRIDGE_JS
};

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
  svg: "",
  bridgeJs: DEFAULT_IMPORTED_SKIN_BRIDGE_JS
};

function readThemeOpacity(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0.35, value));
}

function formatAlpha(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function buildBlackTintImportedSkin(
  opacity = DEFAULT_APP_THEME.blackTintOpacity,
  skinId = "imported-skin-black-tint",
  surfaceBlurPx = DEFAULT_APP_THEME.mainCardBlurPx,
  variant: "default" | "toolset" = "default"
): ImportedSkin {
  const solid = readThemeOpacity(opacity, DEFAULT_APP_THEME.blackTintOpacity);
  const depth = Math.min(1, Math.max(0, (solid - 0.35) / 0.65));
  const isToolsetVariant = variant === "toolset";
  const normalizedBlur =
    typeof surfaceBlurPx === "number" && !Number.isNaN(surfaceBlurPx)
      ? Math.min(48, Math.max(0, surfaceBlurPx))
      : DEFAULT_APP_THEME.mainCardBlurPx;
  const pillBlur = Math.max(6, Math.round(Math.max(8, normalizedBlur * 0.55)));
  const cardBlur = Math.round(normalizedBlur);
  const pillTop = formatAlpha(Math.min(1, solid + 0.06 + depth * 0.04));
  const pillBottom = formatAlpha(Math.min(0.995, solid + 0.02 + depth * 0.03));
  const pillHoverTop = formatAlpha(Math.min(1, solid + 0.1 + depth * 0.04));
  const pillHoverBottom = formatAlpha(Math.min(1, solid + 0.05 + depth * 0.04));
  const cardTop = formatAlpha(Math.min(1, solid + 0.08 + depth * 0.04));
  const cardBottom = formatAlpha(Math.min(1, solid + 0.04 + depth * 0.03));
  const pillBase = formatAlpha(Math.max(0.2, solid * 0.92));
  const cardBase = formatAlpha(Math.max(0.24, solid * 0.96));
  const pillDropShadow = formatAlpha(0.4 + depth * 0.18);
  const pillInnerShadow = formatAlpha(0.56 + depth * 0.2);
  const pillGloss = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.02, 0.05 - depth * 0.02)
  );
  const pillHighlight = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.06, 0.16 - depth * 0.06)
  );
  const pillOutline = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.03, 0.08 - depth * 0.03)
  );
  const pillVeilTop = formatAlpha(0.14 + depth * 0.14);
  const pillVeilBottom = formatAlpha(0.28 + depth * 0.2);
  const cardInnerShadow = formatAlpha(0.64 + depth * 0.2);
  const cardDropShadow = formatAlpha(0.38 + depth * 0.18);
  const cardGloss = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.02, 0.04 - depth * 0.015)
  );
  const cardHighlight = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.05, 0.14 - depth * 0.05)
  );
  const cardOutline = formatAlpha(
    isToolsetVariant ? 0 : Math.max(0.03, 0.08 - depth * 0.025)
  );
  const cardLabel = formatAlpha(Math.max(0.18, 0.28 - depth * 0.07));
  const cardVeilTop = formatAlpha(0.2 + depth * 0.14);
  const cardVeilBottom = formatAlpha(0.36 + depth * 0.2);
  const pillInsetHighlight = isToolsetVariant ? "rgba(14,18,17,.72)" : "rgba(255,255,255,.06)";
  const pillHoverInsetHighlight = isToolsetVariant ? "rgba(18,24,22,.82)" : "rgba(255,255,255,.08)";
  const pillTopLeftGlow = isToolsetVariant ? "rgba(255,255,255,0)" : "rgba(255,255,255,.03)";
  const pillBorderMid = isToolsetVariant ? "rgba(18,24,22,.94)" : "rgba(255,255,255,.02)";
  const cardInsetHighlight = isToolsetVariant ? "rgba(14,18,17,.7)" : "rgba(255,255,255,.05)";
  const cardTopLeftGlow = isToolsetVariant ? "rgba(255,255,255,0)" : "rgba(255,255,255,.03)";
  const cardBottomRightGlow = isToolsetVariant ? "rgba(255,255,255,0)" : "rgba(255,255,255,.02)";
  const cardBorderMid = isToolsetVariant ? "rgba(18,24,22,.92)" : "rgba(255,255,255,.02)";

  return {
    id: skinId,
    name: "Black Tint",
    themeBinding: BLACK_TINT_THEME_BINDING,
    html: `<div class="black-tint-pill"><span class="black-tint-pill__label">{{label}}</span></div>`,
    css: `.black-tint-pill{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 24px;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,${pillGloss}),rgba(255,255,255,0) 18%),linear-gradient(180deg,rgba(0,0,0,${pillTop}),rgba(0,0,0,${pillBottom})),rgba(0,0,0,${pillBase});box-shadow:inset 0 1px 0 ${pillInsetHighlight},inset 0 -42px 74px rgba(0,0,0,${pillInnerShadow}),0 22px 40px rgba(0,0,0,${pillDropShadow});backdrop-filter:blur(${pillBlur}px) saturate(115%);-webkit-backdrop-filter:blur(${pillBlur}px) saturate(115%);overflow:hidden}.black-tint-pill::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,${pillVeilTop}),rgba(0,0,0,${pillVeilBottom})),radial-gradient(circle at top left,${pillTopLeftGlow},transparent 34%)}.black-tint-pill::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(145deg,rgba(255,255,255,${pillHighlight}),${pillBorderMid} 42%,rgba(255,255,255,${pillOutline}));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.84}.black-tint-pill__label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:100%;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:center;color:rgba(255,255,255,.96);font:600 14px/1 "Segoe UI",sans-serif;letter-spacing:-.02em;text-shadow:0 1px 12px rgba(0,0,0,.62)}.button-skin:hover .black-tint-pill,.button-skin.is-selected .black-tint-pill{background:linear-gradient(180deg,rgba(255,255,255,${pillGloss}),rgba(255,255,255,0) 18%),linear-gradient(180deg,rgba(0,0,0,${pillHoverTop}),rgba(0,0,0,${pillHoverBottom})),rgba(0,0,0,${pillBase});box-shadow:inset 0 1px 0 ${pillHoverInsetHighlight},inset 0 -46px 78px rgba(0,0,0,${pillInnerShadow}),0 24px 42px rgba(0,0,0,${pillDropShadow})}.button-skin.is-compact .black-tint-pill{padding:0 10px;box-shadow:inset 0 1px 0 ${pillInsetHighlight},0 4px 10px rgba(0,0,0,.32)}.button-skin.is-compact .black-tint-pill__label{font-size:11px;line-height:1;padding:2px 0;letter-spacing:0}`,
    cardHtml: `<div class="black-tint-surface"><span class="black-tint-surface__label">{{label}}</span></div>`,
    cardCss: `.black-tint-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,${cardGloss}),rgba(255,255,255,0) 16%),linear-gradient(180deg,rgba(0,0,0,${cardTop}),rgba(0,0,0,${cardBottom})),rgba(0,0,0,${cardBase});box-shadow:inset 0 1px 0 ${cardInsetHighlight},inset 0 -70px 108px rgba(0,0,0,${cardInnerShadow}),0 32px 84px rgba(0,0,0,${cardDropShadow});backdrop-filter:blur(${cardBlur}px) saturate(118%);-webkit-backdrop-filter:blur(${cardBlur}px) saturate(118%);overflow:hidden}.black-tint-surface::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,${cardVeilTop}),rgba(0,0,0,${cardVeilBottom})),radial-gradient(circle at top left,${cardTopLeftGlow},transparent 32%),radial-gradient(circle at bottom right,${cardBottomRightGlow},transparent 26%)}.black-tint-surface::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(145deg,rgba(255,255,255,${cardHighlight}),${cardBorderMid} 42%,rgba(255,255,255,${cardOutline}));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.82}.black-tint-surface__label{position:absolute;top:18px;right:22px;z-index:1;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,${cardLabel})}`,
    svg: "",
    bridgeJs: DEFAULT_IMPORTED_SKIN_BRIDGE_JS
  };
}

export const DEFAULT_BLACK_TINT_IMPORTED_SKIN: ImportedSkin = buildBlackTintImportedSkin();
export const TOOLSET_BLACK_TINT_IMPORTED_SKIN: ImportedSkin = buildBlackTintImportedSkin(
  0.85,
  "imported-skin-toolset-black-tint",
  DEFAULT_APP_THEME.mainCardBlurPx,
  "toolset"
);

export function isBlackTintImportedSkin(skin: ImportedSkin | undefined | null): boolean {
  if (!skin) {
    return false;
  }
  if (skin.themeBinding === BLACK_TINT_THEME_BINDING) {
    return true;
  }
  return (
    skin.html.includes("black-tint-pill") &&
    skin.css.includes(".black-tint-pill") &&
    (skin.cardHtml ?? "").includes("black-tint-surface") &&
    (skin.cardCss ?? "").includes(".black-tint-surface")
  );
}

export function isLegacyGlassHoverImportedSkin(skin: ImportedSkin): boolean {
  return (
    skin.id === "imported-skin-glass-hover" &&
    skin.html === LEGACY_GLASS_HOVER_HTML &&
    skin.css === LEGACY_GLASS_HOVER_CSS
  );
}

export function isLegacyShadeImportedSkin(skin: ImportedSkin): boolean {
  const normalizedName = skin.name.trim().toLowerCase();
  return (
    normalizedName === "shade" &&
    skin.html.includes('class="body"') &&
    skin.html.includes('class="button-wrap"') &&
    skin.html.includes('class="button-shadow"')
  );
}

export const DEFAULT_IMPORTED_SKINS: ImportedSkin[] = [
  DEFAULT_FLOW_IMPORTED_SKIN,
  {
    id: "imported-skin-01",
    name: "Imported Skin 01",
    html: `<div class="imported-pill"><span class="imported-pill__label">{{label}}</span></div>`,
    css: `.imported-pill{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0 28px;border-radius:999px;background:linear-gradient(-75deg,rgba(255,255,255,.05),rgba(255,255,255,.2),rgba(255,255,255,.05));box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.55),0 .25em .125em -.125em rgba(0,0,0,.18),0 0 .08em .18em inset rgba(255,255,255,.18),0 0 0 0 rgba(255,255,255,1);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);overflow:hidden}.imported-pill::before{content:"";position:absolute;inset:1px;border-radius:inherit;background:linear-gradient(-75deg,rgba(255,255,255,0),rgba(255,255,255,.42) 42% 50%,rgba(255,255,255,0) 56%);mix-blend-mode:screen;background-size:200% 200%;background-position:0% 50%;background-repeat:no-repeat;opacity:.72;transition:background-position .24s ease}.button-skin:hover .imported-pill::before,.button-skin.is-selected .imported-pill::before{background-position:26% 50%}.imported-pill::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:conic-gradient(from -75deg at 50% 50%,rgba(255,255,255,.34),rgba(255,255,255,0) 8% 38%,rgba(255,255,255,.24) 50%,rgba(255,255,255,0) 62% 92%,rgba(255,255,255,.28)),linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.08));mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;opacity:.9}.button-skin.is-selected .imported-pill{background:linear-gradient(-75deg,rgba(132,205,239,.08),rgba(255,255,255,.22),rgba(132,205,239,.08)),rgba(91,154,194,.12);box-shadow:inset 0 .125em .125em rgba(0,0,0,.05),inset 0 -.125em .125em rgba(255,255,255,.6),0 .25em .125em -.125em rgba(0,0,0,.18),0 0 .08em .18em inset rgba(191,233,255,.18),0 0 0 1px rgba(104,217,255,.12),0 0 18px rgba(104,217,255,.12)}.imported-pill__label{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;width:100%;min-height:100%;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:center;color:rgba(245,248,250,.96);font:500 14px/1 "Segoe UI",sans-serif;letter-spacing:-.03em;text-shadow:0 .18em .05em rgba(0,0,0,.16)}.button-skin.is-compact .imported-pill{padding:0 10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 3px 8px rgba(0,0,0,.12),0 0 .04em .08em inset rgba(255,255,255,.14)}.button-skin.is-compact .imported-pill__label{font-size:11px;line-height:1;padding:2px 0;letter-spacing:-.01em;text-shadow:none}`,
    cardHtml: `<div class="soft-surface"><span class="soft-surface__label">{{label}}</span></div>`,
    cardCss: `.soft-surface{position:relative;width:100%;height:100%;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.08));box-shadow:inset 0 1px 0 rgba(255,255,255,.46),inset 0 -24px 40px rgba(95,137,164,.1);overflow:hidden}.soft-surface::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at top right,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),linear-gradient(135deg,rgba(255,255,255,.28),rgba(255,255,255,0) 48%)}.soft-surface__label{position:absolute;top:16px;right:20px;font:600 11px/1 "Segoe UI",sans-serif;letter-spacing:.16em;text-transform:uppercase;color:rgba(245,248,250,.54)}`,
    svg: "",
    bridgeJs: DEFAULT_IMPORTED_SKIN_BRIDGE_JS
  },
  DEFAULT_GLASS_HOVER_IMPORTED_SKIN,
  DEFAULT_BLACK_TINT_IMPORTED_SKIN
];

export const IMPORTED_SKIN_PRESETS: ImportedSkinPreset[] = [
  {
    id: "default",
    name: "default",
    skin: DEFAULT_FLOW_IMPORTED_SKIN
  },
  {
    id: "black-tint",
    name: "Black Tint",
    skin: DEFAULT_BLACK_TINT_IMPORTED_SKIN
  },
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

function readThemeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(48, Math.max(0, value));
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
    dangerColor: readThemeField(theme?.dangerColor, DEFAULT_APP_THEME.dangerColor),
    mainCardBlurPx: readThemeNumber(theme?.mainCardBlurPx, DEFAULT_APP_THEME.mainCardBlurPx),
    blackTintOpacity: readThemeOpacity(
      theme?.blackTintOpacity,
      DEFAULT_APP_THEME.blackTintOpacity
    )
  };
}

export function getAppThemePreset(presetId: string): AppTheme | undefined {
  const preset = APP_THEME_PRESETS.find((entry) => entry.id === presetId);
  return preset ? normalizeAppTheme(preset.theme) : undefined;
}

export function getAppThemeVariant(theme: AppTheme): "nature-frost" | "standard" {
  return normalizeAppTheme(theme).name === NATURE_FROST_APP_THEME.name
    ? "nature-frost"
    : "standard";
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
    ["--fc-theme-danger" as string]: normalized.dangerColor,
    ["--fc-theme-main-card-blur" as string]: `${normalized.mainCardBlurPx}px`
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
