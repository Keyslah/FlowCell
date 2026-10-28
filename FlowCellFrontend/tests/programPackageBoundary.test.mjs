import assert from "node:assert/strict";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const programsRoot = path.join(repoRoot, "Programs");

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(entry.name) ? [filename] : [];
  });
}

// Parsing only: this test does not create a TypeScript Program, transpile,
// typecheck, emit, import application modules, or read generated build output.
function staticModuleReferences(filename) {
  const source = readFileSync(filename, "utf8");
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const references = [];
  const add = (node) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) references.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isIdentifier(node.expression) && node.expression.text === "require" ||
      ts.isPropertyAccessExpression(node.expression) &&
        ["glob", "globEager"].includes(node.expression.name.text) && node.expression.expression.getText(parsed) === "import.meta"
    )) {
      const first = node.arguments[0];
      if (first && ts.isArrayLiteralExpression(first)) first.elements.forEach(add);
      else add(first);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" &&
        node.arguments?.[1]?.getText(parsed) === "import.meta.url") add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return references;
}

function localReferencePath(filename, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (clean.startsWith("file:")) return fileURLToPath(clean);
  if (clean.startsWith("/")) return path.resolve(frontendRoot, `.${clean}`); // Vite root-relative import.
  if (path.isAbsolute(clean)) return clean;
  if (clean.startsWith(".")) return path.resolve(path.dirname(filename), clean);
  return null; // Bare package names are provided by node_modules, not this repository.
}

function packagePath(root, reference) {
  assert.equal(typeof reference, "string", "Package paths must be declared strings.");
  assert.ok(reference.trim(), "Package paths must not be empty.");
  assert.equal(path.isAbsolute(reference), false, `Package path must be relative: ${reference}`);
  const filename = path.resolve(root, reference);
  assert.ok(isInside(root, filename), `Package path escapes its owner: ${reference}`);
  assert.ok(isInside(realpathSync(root), realpathSync(filename)), `Package path resolves outside its owner: ${reference}`);
  return filename;
}

function readIni(filename) {
  const sections = new Map();
  let section;
  for (const raw of readFileSync(filename, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const heading = /^\[([^\]]+)\]$/.exec(line);
    if (heading) {
      section = new Map();
      sections.set(heading[1].toLowerCase(), section);
      continue;
    }
    const separator = line.indexOf("=");
    if (section && separator > 0) section.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return sections;
}

test("production frontend module dependencies stay outside program packages", () => {
  const violations = [];
  for (const filename of sourceFiles(path.join(frontendRoot, "src"))) {
    for (const reference of staticModuleReferences(filename)) {
      const resolved = localReferencePath(filename, reference);
      if (resolved && isInside(programsRoot, resolved)) violations.push(`${path.relative(frontendRoot, filename)} -> ${reference}`);
    }
  }
  assert.deepEqual(violations, [], `Core must not compile program package assets:\n${violations.join("\n")}`);
});

test("core binding adapters contain no Illustrator Set Anchor implementation", () => {
  const coreFiles = [
    "flowcellbackend/FlowCellBackend.ahk",
    "flowcellbackend/helpers/ProgramBindActions.ahk",
    "FlowCellFrontend/src-tauri/src/commands/bindings.rs",
    "FlowCellFrontend/src-tauri/src/program_sources/bind_actions.rs"
  ];
  const forbidden = /\b(?:SetIllustratorAnchorAction|GetFlowCellIllustratorAnchorScriptPath|ILLUSTRATOR_SET_ANCHOR_ACTION_ID)\b|FlowCell_Illustrator_SetAnchorHotkey\.jsx/;
  for (const relative of coreFiles) {
    assert.doesNotMatch(readFileSync(path.join(repoRoot, relative), "utf8"), forbidden, `${relative} must consume generic package declarations.`);
  }
});

test("Illustrator owns the existing pass-through Set Anchor action and its helper", () => {
  const root = path.join(programsRoot, "Illustrator");
  const manifest = JSON.parse(readFileSync(path.join(root, "flowcell.program.json"), "utf8"));
  const actions = readIni(packagePath(root, manifest.bindActionsFile));
  const anchor = actions.get("action_illustrator_set_anchor");
  assert.ok(anchor, "The package must retain the saved Set Anchor action identity.");
  assert.equal(anchor.get("label"), "Set Anchor");
  assert.equal(anchor.get("passthrough"), "1", "Native Illustrator V must remain unsuppressed.");
  assert.equal(anchor.get("successreturnvalue"), "anchor set", "Delivery alone must not confirm anchor capture.");
  assert.ok(manifest.processNames.some((name) => name.toLowerCase().replace(/\.exe$/, "") === "illustrator"));
  const helper = packagePath(root, anchor.get("source"));
  assert.equal(statSync(helper).isFile(), true);
  assert.match(readFileSync(helper, "utf8"), /FLOWCELL_ILLUSTRATOR_ANCHOR_COMMAND\s*=\s*\{\s*command:\s*["']set_anchor["']/);
});

test("Blender continues to own and declare its complete Theme page", () => {
  const root = path.join(programsRoot, "Blender");
  const program = JSON.parse(readFileSync(path.join(root, "flowcell.program.json"), "utf8"));
  const theme = program.bundledSources.find((source) => source.id === "blender.theme");
  assert.ok(theme, "Blender must retain its Theme contribution.");
  const sourcePath = packagePath(root, theme.sourcePath);
  const manifestPath = statSync(sourcePath).isDirectory() ? path.join(sourcePath, "flowcell.script.json") : sourcePath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.program, "Blender");
  assert.equal(manifest.page.id, "blender.theme");
  const packageRoot = path.dirname(manifestPath);
  const resources = [manifest.source, manifest.page.entry, ...manifest.page.scripts, ...manifest.page.styles];
  assert.ok(manifest.page.scripts.length > 0 && manifest.page.styles.length > 0);
  for (const reference of resources) assert.equal(statSync(packagePath(packageRoot, reference)).isFile(), true);
});
