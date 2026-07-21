import {
  BUTTON_SKIN_COMPILER_VERSION,
  type ButtonSkin,
  type ButtonSkinSectionName
} from "../types.js";
import {
  BUTTON_SKIN_STATE_SECTIONS,
  serializeButtonSkinSections,
  type ButtonSkinSectionSource,
  type ButtonSkinStateSectionName
} from "./buttonSkinFormat.js";
import {
  fingerprintButtonSkinSource,
  parseCssDeclarations,
  parseCssKeyframes,
  replaceCssIdentifier
} from "./cssSyntax.js";
import {
  sanitizeButtonSkinStructure,
  validateButtonSkin,
  type ButtonSkinDiagnostic
} from "./skinValidator.js";

export interface CompiledButtonSkin {
  skinId: string;
  compilerVersion: typeof BUTTON_SKIN_COMPILER_VERSION;
  sourceFingerprint: string;
  sanitizedMarkupTemplate: string;
  scopedCss: string;
  animationTokens: string[];
  hasLabelToken: boolean;
}

export type ButtonSkinCompileResult =
  | { ok: true; compiled: CompiledButtonSkin }
  | { ok: false; diagnostics: ButtonSkinDiagnostic[] };

const STATE_ATTRIBUTE: Record<ButtonSkinStateSectionName, string | null> = {
  base: null,
  hover: "data-button-hover",
  play: "data-button-play",
  pressed: "data-button-pressed",
  held: "data-button-held",
  release: "data-button-release",
  disabled: "data-button-disabled",
  error: "data-button-error"
};

function safeCssId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "skin";
}

function sourceFromSkin(skin: ButtonSkin): ButtonSkinSectionSource {
  return {
    structure: skin.structure,
    keyframes: skin.keyframes,
    base: skin.base,
    hover: skin.hover,
    play: skin.play,
    pressed: skin.pressed,
    held: skin.held,
    release: skin.release,
    disabled: skin.disabled,
    error: skin.error
  };
}

function stateSelectors(section: ButtonSkinStateSectionName): { root: string; core: string } {
  const attribute = STATE_ATTRIBUTE[section];
  if (!attribute) return { root: ":host", core: "[data-core]" };
  return {
    root: `:host([${attribute}="true"])`,
    core: `:host([${attribute}="true"]) [data-core]`
  };
}

function rewriteKeyframeReferences(
  value: string,
  names: ReadonlyMap<string, string>
): string {
  let next = value;
  for (const [name, replacement] of names) {
    next = replaceCssIdentifier(next, name, replacement);
  }
  return next;
}

function compileStateSection(
  section: ButtonSkinStateSectionName,
  source: string,
  keyframeNames: ReadonlyMap<string, string>
): string[] {
  const parsed = parseCssDeclarations(source);
  if (!parsed.ok || parsed.declarations.length === 0) return [];
  const rootDeclarations: string[] = [];
  const coreDeclarations: string[] = [];
  const animationRules: string[] = [];
  const selectors = stateSelectors(section);

  for (const declaration of parsed.declarations) {
    const value = rewriteKeyframeReferences(declaration.value, keyframeNames);
    if (declaration.property.startsWith("--anim-")) {
      const token = declaration.property.slice("--anim-".length);
      animationRules.push(
        `${selectors.root} [data-anim="${token}"]{animation:${value};}`
      );
    } else if (declaration.property.startsWith("--")) {
      rootDeclarations.push(`${declaration.property}:${value};`);
    } else {
      coreDeclarations.push(`${declaration.property}:${value};`);
    }
  }

  const rules: string[] = [];
  if (rootDeclarations.length > 0) rules.push(`${selectors.root}{${rootDeclarations.join("")}}`);
  if (coreDeclarations.length > 0) rules.push(`${selectors.core}{${coreDeclarations.join("")}}`);
  rules.push(...animationRules);
  return rules;
}

export function compileButtonSkin(skin: ButtonSkin): ButtonSkinCompileResult {
  const source = sourceFromSkin(skin);
  const validation = validateButtonSkin(source);
  if (!validation.valid || !validation.analysis) {
    return { ok: false, diagnostics: validation.diagnostics };
  }

  const serialized = serializeButtonSkinSections(source);
  const sourceFingerprint = fingerprintButtonSkinSource(serialized);
  const sanitized = sanitizeButtonSkinStructure(source.structure);
  const sanitizedMarkupTemplate = sanitized.markup;
  const namespace = `fc-${safeCssId(skin.id)}-${sourceFingerprint}`;
  const parsedKeyframes = parseCssKeyframes(source.keyframes);
  const keyframeNames = new Map<string, string>();
  if (parsedKeyframes.ok) {
    for (const block of parsedKeyframes.blocks) {
      keyframeNames.set(block.name, `${namespace}-${block.name}`);
    }
  }

  const css = [
    ":host{display:inline-block;box-sizing:border-box;overflow:visible;line-height:normal;pointer-events:auto;contain:layout style;}",
    "[data-button-skin-root]{display:inline-block;position:relative;box-sizing:border-box;overflow:visible;pointer-events:none;}",
    "[data-button-skin-root] *{pointer-events:none;}",
    "[data-core]{pointer-events:auto!important;touch-action:none;user-select:none;-webkit-user-select:none;}",
    "svg[data-core]{pointer-events:bounding-box!important;}",
    "[data-button-label-node]{font-size:var(--button-label-font-size,inherit);line-height:inherit;}",
    "[data-button-label-line]{display:block;white-space:nowrap;}",
    ":host([data-button-constrained=\"true\"]) [data-core]{box-sizing:border-box;width:var(--button-core-width);height:var(--button-core-height);}",
    ":host([data-button-text-overflow=\"true\"]) [data-core]{outline:1px dashed rgba(255,105,105,.9);outline-offset:-1px;}"
  ];

  // The core's authored inline style is compiled as the lowest-priority core
  // rule so state-section declarations (same selector, later in the sheet) win.
  if (sanitized.coreInlineStyle) {
    css.push(`[data-core]{${sanitized.coreInlineStyle}}`);
  }

  if (parsedKeyframes.ok) {
    for (const block of parsedKeyframes.blocks) {
      let body = block.body;
      for (const [name, replacement] of keyframeNames) {
        body = replaceCssIdentifier(body, name, replacement);
      }
      css.push(`${block.prefix} ${keyframeNames.get(block.name)}{${body}}`);
    }
  }
  for (const section of BUTTON_SKIN_STATE_SECTIONS) {
    css.push(...compileStateSection(section, source[section], keyframeNames));
  }

  return {
    ok: true,
    compiled: {
      skinId: skin.id,
      compilerVersion: BUTTON_SKIN_COMPILER_VERSION,
      sourceFingerprint,
      sanitizedMarkupTemplate,
      scopedCss: css.join("\n"),
      animationTokens: validation.analysis.animationTokens,
      hasLabelToken: validation.analysis.hasLabelToken
    }
  };
}

export function diagnosticsBySkinSection(
  diagnostics: readonly ButtonSkinDiagnostic[]
): Partial<Record<ButtonSkinSectionName, ButtonSkinDiagnostic[]>> {
  const grouped: Partial<Record<ButtonSkinSectionName, ButtonSkinDiagnostic[]>> = {};
  for (const diagnostic of diagnostics) {
    (grouped[diagnostic.section] ??= []).push(diagnostic);
  }
  return grouped;
}
