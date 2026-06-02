import { DEFAULT_POPOUT_IMPORTED_SKIN } from "./theme";
import type { ImportedSkin } from "../types";

const SHAPES_PANEL_NAME = "shapes";

const SHAPE_PATH_MAP: Record<string, string> = {
  cone: `
    <ellipse cx="32" cy="47" rx="16" ry="5" fill="none" stroke="#ffffff" stroke-width="4"/>
    <path d="M20 46L32 16L44 46" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  `,
  cube: `
    <path d="M32 13L47 21V41L32 49L17 41V21L32 13Z" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
    <path d="M32 13V32M47 21L32 32L17 21M32 32V49" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
  `,
  cylinder: `
    <ellipse cx="32" cy="18" rx="15" ry="6" fill="none" stroke="#ffffff" stroke-width="4"/>
    <path d="M17 18V44C17 47.314 23.716 50 32 50C40.284 50 47 47.314 47 44V18" fill="none" stroke="#ffffff" stroke-width="4"/>
    <path d="M17 44C17 47.314 23.716 50 32 50C40.284 50 47 47.314 47 44" fill="none" stroke="#ffffff" stroke-width="4"/>
  `,
  triangle: `
    <path d="M32 15L48 46H16L32 15Z" fill="none" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
  `,
  sphere: `
    <circle cx="32" cy="32" r="18" fill="none" stroke="#ffffff" stroke-width="4"/>
    <path d="M14 32H50M32 14C39 20 39 44 32 50M32 14C25 20 25 44 32 50" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
  `
};

function renderSingleSymbolSvg(pathMarkup: string): string {
  return `
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      ${pathMarkup}
    </svg>
  `;
}

function renderOwnerSymbolSvg(): string {
  return `
    <svg viewBox="0 0 192 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g transform="translate(20 14) rotate(-16 16 16)">
        <rect x="0" y="0" width="32" height="32" rx="5" fill="#ff7f50" stroke="#311703" stroke-width="3"/>
        <g transform="translate(0 0)">
          <ellipse cx="16" cy="23" rx="8" ry="2.5" fill="none" stroke="#ffffff" stroke-width="2.5"/>
          <path d="M10 22L16 7L22 22" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
      <g transform="translate(80 8)">
        <rect x="0" y="0" width="32" height="32" rx="5" fill="#ffd700" stroke="#311703" stroke-width="3"/>
        <g transform="translate(0 0)">
          <path d="M16 7L25 12V24L16 29L7 24V12L16 7Z" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M16 7V18M25 12L16 18L7 12M16 18V29" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>
        </g>
      </g>
      <g transform="translate(140 14) rotate(16 16 16)">
        <rect x="0" y="0" width="32" height="32" rx="5" fill="#019b98" stroke="#311703" stroke-width="3"/>
        <g transform="translate(0 0)">
          <circle cx="16" cy="16" r="9" fill="none" stroke="#ffffff" stroke-width="2.5"/>
          <path d="M7 16H25M16 7C19.5 10 19.5 22 16 25M16 7C12.5 10 12.5 22 16 25" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
        </g>
      </g>
    </svg>
  `;
}

function buildOverlaySkin(args: {
  id: string;
  name: string;
  svg: string;
}): ImportedSkin {
  return {
    ...DEFAULT_POPOUT_IMPORTED_SKIN,
    id: args.id,
    name: args.name,
    svg: args.svg
  };
}

const SHAPES_OWNER_SKIN = buildOverlaySkin({
  id: "shapes-panel-fan-owner",
  name: "Shapes Panel Fan Owner",
  svg: renderOwnerSymbolSvg()
});

const SHAPES_CHILD_SKINS = new Map<string, ImportedSkin>(
  Object.entries(SHAPE_PATH_MAP).map(([shapeKey, pathMarkup]) => [
    shapeKey,
    buildOverlaySkin({
      id: `shapes-panel-fan-${shapeKey}`,
      name: `Shapes Panel Fan ${shapeKey}`,
      svg: renderSingleSymbolSvg(pathMarkup)
    })
  ])
);

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

export function isShapesPanel(panelName: string): boolean {
  return normalizeToken(panelName) === SHAPES_PANEL_NAME;
}

export function getShapesPanelOwnerSkin(): ImportedSkin {
  return SHAPES_OWNER_SKIN;
}

export function resolveShapesPanelFanChildSkin(label: string): ImportedSkin | undefined {
  return SHAPES_CHILD_SKINS.get(normalizeToken(label));
}
