import type { ButtonPlacementSizingMode } from "../editor/buttonSizeAssignments.js";

/** Optional skin-authored presets. Undeclared skins retain the existing choices. */
export function readButtonSkinSizing(source: { base: string } | null | undefined): {
  defaultMode: ButtonPlacementSizingMode;
  supportsResponsive: boolean;
} {
  const declarations = new Map<string, string>();
  for (const declaration of (source?.base ?? "").replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator >= 0) declarations.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
  }
  const supportsResponsive = !["0", "false", "off"].includes(declarations.get("--flowcell-sizing-responsive") ?? "");
  const requested = declarations.get("--flowcell-sizing-default");
  const defaultMode = requested === "proportional" || requested === "stretch" ? requested
    : supportsResponsive ? "responsive" : "proportional";
  return { defaultMode, supportsResponsive };
}

export function resolveButtonSkinSizingMode(
  source: { base: string } | null | undefined,
  requested?: ButtonPlacementSizingMode
): ButtonPlacementSizingMode {
  const policy = readButtonSkinSizing(source);
  return !requested || (requested === "responsive" && !policy.supportsResponsive) ? policy.defaultMode : requested;
}
