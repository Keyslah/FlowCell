import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..", "..", "..", "..");
const frontendRoot = join(repoRoot, "FlowCellFrontend");
const tscPath = join(frontendRoot, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(tscPath)) {
  console.error("FlowCellFrontend dependencies are missing. Run npm install before validating a skin.");
  process.exit(1);
}

const compile = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.button-tests.json"], {
  cwd: frontendRoot,
  encoding: "utf8"
});
if (compile.status !== 0) {
  if (compile.stdout) process.stdout.write(compile.stdout);
  if (compile.stderr) process.stderr.write(compile.stderr);
  process.exit(compile.status ?? 1);
}

const sourcePathArgument = process.argv[2];
const source = sourcePathArgument
  ? readFileSync(isAbsolute(sourcePathArgument) ? sourcePathArgument : resolve(process.cwd(), sourcePathArgument), "utf8")
  : readFileSync(0, "utf8");

const compiledRoot = join(frontendRoot, "tests", ".compiled-button-system", "button", "skins");
const [{ BUTTON_SKIN_SECTION_ORDER, createEmptyButtonSkinSections }, { applyNamedButtonSkinSections, parseButtonSkinPaste }, { validateButtonSkin }, { parseCssDeclarations }] = await Promise.all([
  import(pathToFileURL(join(compiledRoot, "buttonSkinFormat.js")).href),
  import(pathToFileURL(join(compiledRoot, "skinPasteParser.js")).href),
  import(pathToFileURL(join(compiledRoot, "skinValidator.js")).href),
  import(pathToFileURL(join(compiledRoot, "cssSyntax.js")).href)
]);

const parsed = parseButtonSkinPaste(source);
if (!parsed.ok) {
  console.error(`Paste parse failed${parsed.line ? ` at line ${parsed.line}` : ""}: ${parsed.message}`);
  process.exit(1);
}

const missingSections = BUTTON_SKIN_SECTION_ORDER.filter(
  (section) => !parsed.presentSections.includes(section)
);
if (missingSections.length > 0) {
  console.error(`Replacement paste is missing canonical sections: ${missingSections.join(", ")}`);
  process.exit(1);
}

let skin;
try {
  const structure = parsed.sections.structure;
  if (typeof structure !== "string" || structure.trim().length === 0) {
    throw new Error("Replacement skin requires a nonempty structure section.");
  }
  skin = applyNamedButtonSkinSections(createEmptyButtonSkinSections(), parsed);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const validation = validateButtonSkin(skin);
if (!validation.valid) {
  for (const diagnostic of validation.diagnostics) {
    console.error(`[${diagnostic.section}] ${diagnostic.message}`);
  }
  process.exit(1);
}

const coreOpeningTag = skin.structure.match(/<[^>]*\bdata-core(?:\s|=|>)[^>]*>/i)?.[0] ?? "";
const coreStyle = coreOpeningTag.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] ?? "";
const inlineDeclarations = parseCssDeclarations(coreStyle);
const baseDeclarations = parseCssDeclarations(skin.base);
const effectiveCoreDeclarations = new Map();
for (const parsedDeclarations of [inlineDeclarations, baseDeclarations]) {
  if (!parsedDeclarations.ok) continue;
  for (const declaration of parsedDeclarations.declarations) {
    if (!declaration.property.startsWith("--")) {
      effectiveCoreDeclarations.set(declaration.property, declaration.value);
    }
  }
}

let effectiveFontSize = null;
let effectiveLineHeight = null;
for (const parsedDeclarations of [inlineDeclarations, baseDeclarations]) {
  if (!parsedDeclarations.ok) continue;
  for (const declaration of parsedDeclarations.declarations) {
    if (declaration.property === "font") {
      const shorthand = declaration.value.match(/(?:^|\s)(\d+(?:\.\d+)?px)(?:\s*\/\s*([^\s;]+))?/i);
      effectiveFontSize = shorthand?.[1] ?? declaration.value;
      effectiveLineHeight = shorthand?.[2] ?? null;
    } else if (declaration.property === "font-size") {
      effectiveFontSize = declaration.value;
    } else if (declaration.property === "line-height") {
      effectiveLineHeight = declaration.value;
    }
  }
}

const usesEmGeometry = [...effectiveCoreDeclarations.entries()].some(([property, value]) =>
  /^(?:min-|max-)?(?:width|height)$/.test(property) && /\d+(?:\.\d+)?em\b/i.test(value)
);
const normalizeCssValue = (value) =>
  (value ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*!important\s*$/i, "")
    .trim();
const inheritsFontMetrics = [inlineDeclarations, baseDeclarations].some((parsedDeclarations) =>
  parsedDeclarations.ok && parsedDeclarations.declarations.some(({ property, value }) =>
    /^(?:font|font-size|line-height)$/.test(property) &&
    /^(?:inherit|unset|revert|revert-layer)$/i.test(normalizeCssValue(value))
  )
);
if (inheritsFontMetrics) {
  console.error("[structure/base] data-core must not inherit font, font-size, or line-height; authored geometry must be host-independent.");
  process.exit(1);
}
const isPixelLength = (value) => /^\d+(?:\.\d+)?px$/i.test(normalizeCssValue(value));
const requiresStableCoreMetrics = validation.analysis?.hasLabelToken === true || usesEmGeometry;
if (requiresStableCoreMetrics && (!isPixelLength(effectiveFontSize) || !isPixelLength(effectiveLineHeight))) {
  console.error("[structure/base] a labeled or em-sized data-core requires an effective pixel font size and pixel line-height; inherited host typography changes packed geometry.");
  process.exit(1);
}

console.log("Skin paste is valid: all canonical sections are present and semantic validation returned zero diagnostics.");
