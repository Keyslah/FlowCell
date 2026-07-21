import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.dirname(testsRoot);
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const dispatcherPath = path.join(packageRoot, "setup_organization.ps1");
const templatePath = path.join(packageRoot, "templates", "apply_profile.ps1.template");
const pagePath = path.join(packageRoot, "page", "page.js");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const actionById = new Map(manifest.page.actions.map((action) => [action.id, action]));

function assertStrictSchema(schema, label) {
  assert.equal(typeof schema, "object", `${label} must be an object`);
  assert.ok(schema && !Array.isArray(schema), `${label} must be an object`);
  const supported = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum"
  ]);
  for (const keyword of Object.keys(schema)) {
    assert.ok(supported.has(keyword), `${label} uses unsupported schema keyword ${keyword}`);
  }
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${label} must reject extra properties`);
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      assertStrictSchema(child, `${label}.properties.${name}`);
    }
  }
  if (schema.type === "array") {
    assert.ok(schema.items, `${label} array must declare items`);
    assertStrictSchema(schema.items, `${label}.items`);
  }
}

function collectFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    assert.equal(lstatSync(absolute).isSymbolicLink(), false, `${relative} cannot be a symlink`);
    return entry.isDirectory() ? collectFiles(root, absolute) : [relative];
  });
}

function runDispatcher(scriptPath, request) {
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-FlowCellCapability",
    "windows.setup-organization",
    "-ArgsJson",
    JSON.stringify(request)
  ], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`Dispatcher failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

test("manifest is an ordinary Windows-only page-enabled script owner", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "windows.setup-organization");
  assert.equal(manifest.program, "Windows");
  assert.equal(manifest.source, "setup_organization.ps1");
  assert.equal(manifest.executionTarget, undefined);
  assert.equal(manifest.page.id, "windows.setup-organization");
  assert.equal(manifest.page.program, "Windows");
  assert.equal(manifest.page.sharedProgramDataNamespace, "setup-organization");
  assert.deepEqual(manifest.page.capabilities.sort(), [
    "button.install-generated",
    "folder.select",
    "windows.setup-organization"
  ]);
  assert.equal(JSON.stringify(manifest).includes('"Blender"'), false);
  assert.equal(JSON.stringify(manifest).includes('"Illustrator"'), false);
  assert.equal(JSON.stringify(manifest).includes('"Photoshop"'), false);
});

test("every page request and response uses the supported strict schema subset", () => {
  for (const action of manifest.page.actions) {
    assertStrictSchema(action.requestSchema, `${action.id}.requestSchema`);
    assertStrictSchema(action.responseSchema, `${action.id}.responseSchema`);
  }
});

test("package resources are self-contained and sandbox-compatible", () => {
  const files = collectFiles(packageRoot).sort();
  assert.deepEqual(files, [
    "flowcell.script.json",
    "formats/profile.v1.schema.json",
    "formats/stage.v1.schema.json",
    "page/index.html",
    "page/page.css",
    "page/page.js",
    "setup_organization.ps1",
    "templates/apply_profile.ps1.template",
    "tests/setup-organization-package.test.mjs"
  ]);
  for (const relative of [
    manifest.source,
    manifest.page.entry,
    ...manifest.page.scripts,
    ...manifest.page.styles,
    "formats/profile.v1.schema.json",
    "formats/stage.v1.schema.json",
    "templates/apply_profile.ps1.template"
  ]) {
    const absolute = path.resolve(packageRoot, relative);
    assert.ok(absolute.startsWith(`${path.resolve(packageRoot)}${path.sep}`));
    assert.ok(existsSync(absolute), `${relative} must exist`);
    assert.equal(lstatSync(absolute).isSymbolicLink(), false);
  }
  const html = readFileSync(path.join(packageRoot, manifest.page.entry), "utf8");
  assert.doesNotMatch(html, /<(?:script|style|link|base|iframe|object|embed|template)\b/i);
  assert.doesNotMatch(html, /\s(?:style|srcdoc|action|on[a-z]+)=/i);
  const page = readFileSync(pagePath, "utf8");
  assert.match(page, /window\.flowcellPage/);
  assert.doesNotMatch(page, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/);
  assert.doesNotMatch(page, /\b(?:localStorage|sessionStorage)\b/);
  assert.doesNotMatch(page, /window\.open|__TAURI__|@tauri-apps|\binvoke\s*\(/);
  assert.doesNotMatch(readFileSync(path.join(packageRoot, "page", "page.css"), "utf8"), /url\s*\(/i);
  assert.equal(
    JSON.parse(readFileSync(path.join(packageRoot, manifest.page.config.formatDefinitions.profile), "utf8")).$id,
    "flowcell.windows.setup-organization.profile.v1"
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(packageRoot, manifest.page.config.formatDefinitions.stage), "utf8")).$id,
    "flowcell.windows.setup-organization.stage.v1"
  );
});

test("page calls only declared actions and program operations match the dispatcher", () => {
  const page = readFileSync(pagePath, "utf8");
  const requested = new Set([...page.matchAll(/request\("([a-z0-9.-]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...requested].sort(), [...actionById.keys()].sort());

  const dispatcher = readFileSync(dispatcherPath, "utf8");
  const dispatchedOperations = new Set(
    [...dispatcher.matchAll(/^\s*'([a-z-]+)'\s*\{\s*Invoke-/gm)].map((match) => match[1])
  );
  const declaredOperations = new Set(
    manifest.page.actions
      .filter((action) => action.handler.kind === "program")
      .map((action) => action.handler.payload.operation)
  );
  assert.deepEqual([...declaredOperations].sort(), [...dispatchedOperations].sort());

  const install = actionById.get("install-generated-button");
  assert.deepEqual(install.handler, {
    kind: "core",
    capability: "button.install-generated",
    options: {
      programName: "Windows",
      importKind: "script",
      stageNamespace: "windows.setup-organization",
      stageFormat: "flowcell.windows.setup-organization.stage.v1"
    }
  });
  assert.equal("programName" in install.requestSchema.properties, false);
  assert.deepEqual(actionById.get("select-root").requestSchema.properties, {});
});

test("new implementation uses only the clean namespace and legacy names are recycle-only", () => {
  const dispatcher = readFileSync(dispatcherPath, "utf8");
  const implementation = [
    dispatcher,
    readFileSync(templatePath, "utf8"),
    readFileSync(pagePath, "utf8"),
    readFileSync(manifestPath, "utf8")
  ].join("\n");
  assert.match(implementation, /program-data[\\/]+windows[\\/]+setup-organization/i);
  for (const forbidden of [
    /flowcellbackend[\\/]+local[\\/]+organization/i,
    /Folder Trees/i,
    /Dynamic Organization/i,
    /New Organization Profile Template/i,
    /Apply-OrganizationProfileCore/i,
    /windows\.organization-profile/i
  ]) {
    assert.doesNotMatch(implementation, forbidden);
  }
  const cleanup = dispatcher.match(
    /function Invoke-RecycleLegacySidecars \{[\s\S]+?(?=function Get-CurrentPanelName)/
  )?.[0] ?? "";
  assert.match(cleanup, /organize-folder\.profile\.json/);
  assert.match(cleanup, /organize-folder\|new-organization/);
  assert.match(cleanup, /log\\\.txt\|undo\\\.json/);
  assert.match(cleanup, /organization-profile\.json/);
  assert.match(cleanup, /Send-FileToRecycleBin/);
  assert.match(cleanup, /Send-EmptyDirectoryToRecycleBin/);
  assert.doesNotMatch(cleanup, /Get-Content|ReadAllText|ConvertFrom-Json/);
  assert.doesNotMatch(implementation, /fix-this-folder/i);
  assert.match(dispatcher, /FileSystem\]::DeleteFile\([\s\S]+?RecycleOption\]::SendToRecycleBin/);
  assert.match(dispatcher, /FileSystem\]::DeleteDirectory\([\s\S]+?RecycleOption\]::SendToRecycleBin/);
  assert.match(implementation, /RecycleOption\]::SendToRecycleBin/);
});

test("dispatcher saves, loads, applies, and stages only new-system profile identity", {
  skip: process.platform !== "win32"
}, () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "flowcell-setup-organization-"));
  try {
    const sourceRoot = path.join(
      fixtureRoot,
      "Programs",
      "Windows",
      "Windows Local Scripts",
      "owner",
      "source"
    );
    const fixtureDispatcher = path.join(sourceRoot, "setup_organization.ps1");
    mkdirSync(path.join(fixtureRoot, "flowcellbackend"), { recursive: true });
    mkdirSync(path.join(sourceRoot, "templates"), { recursive: true });
    mkdirSync(path.join(fixtureRoot, "Programs", "Windows", "Panels", "Files"), { recursive: true });
    copyFileSync(dispatcherPath, fixtureDispatcher);
    copyFileSync(templatePath, path.join(sourceRoot, "templates", "apply_profile.ps1.template"));
    writeFileSync(
      path.join(fixtureRoot, "Programs", "Windows", "Panels", "Files", "owner.flowcell-source.json"),
      JSON.stringify({ ownerButtonId: "owner", programName: "Windows", panelName: "Files" }),
      "utf8"
    );

    const targetRoot = path.join(fixtureRoot, "target");
    mkdirSync(path.join(targetRoot, "Existing"), { recursive: true });
    writeFileSync(path.join(targetRoot, "picture.png"), "png", "utf8");
    writeFileSync(path.join(targetRoot, "notes.txt"), "notes", "utf8");
    mkdirSync(path.join(targetRoot, ".flowcell"), { recursive: true });
    writeFileSync(path.join(targetRoot, "organize-folder.profile.json"), "legacy", "utf8");
    writeFileSync(path.join(targetRoot, "organize-folder (2).log.txt"), "legacy", "utf8");
    writeFileSync(path.join(targetRoot, "new-organization.undo.json"), "legacy", "utf8");
    writeFileSync(path.join(targetRoot, ".flowcell", "organization-profile.json"), "legacy", "utf8");
    writeFileSync(path.join(targetRoot, "fix-this-folder.log.txt"), "unrelated", "utf8");

    const extendedFixtureDispatcher = `\\\\?\\${fixtureDispatcher}`;
    const cleanup = runDispatcher(extendedFixtureDispatcher, {
      operation: "recycle-legacy-sidecars",
      rootPath: targetRoot
    });
    assert.deepEqual([...cleanup.recycledPaths].sort(), [
      ".flowcell",
      ".flowcell/organization-profile.json",
      "new-organization.undo.json",
      "organize-folder (2).log.txt",
      "organize-folder.profile.json"
    ]);
    assert.equal(existsSync(path.join(targetRoot, "organize-folder.profile.json")), false);
    assert.equal(existsSync(path.join(targetRoot, "organize-folder (2).log.txt")), false);
    assert.equal(existsSync(path.join(targetRoot, "new-organization.undo.json")), false);
    assert.equal(existsSync(path.join(targetRoot, ".flowcell")), false);
    assert.equal(existsSync(path.join(targetRoot, "fix-this-folder.log.txt")), true);
    rmSync(path.join(targetRoot, "fix-this-folder.log.txt"));

    const scan = runDispatcher(extendedFixtureDispatcher, { operation: "scan-root", rootPath: targetRoot });
    assert.equal(scan.files.length, 2);
    assert.ok(scan.folders.some((folder) => folder.relativePath === "Existing"));

    const ruleId = "images-rule";
    const saved = runDispatcher(extendedFixtureDispatcher, {
      operation: "save-profile",
      profileId: "",
      name: "Identity Only Test",
      rules: [{
        ruleId,
        name: "Images",
        targetFolder: "Images",
        extensions: [".png"],
        nameContains: "",
        matchAll: false,
        enabled: true
      }]
    });
    assert.match(saved.profile.profileId, /^[0-9a-f-]{36}$/);
    const dataRoot = path.join(
      fixtureRoot,
      "flowcellbackend",
      "local",
      "program-data",
      "windows",
      "setup-organization"
    );
    assert.ok(existsSync(path.join(dataRoot, "profiles", `${saved.profile.profileId}.json`)));
    assert.equal(runDispatcher(extendedFixtureDispatcher, { operation: "list-profiles" }).profiles.length, 1);
    assert.equal(
      runDispatcher(extendedFixtureDispatcher, {
        operation: "load-profile",
        profileId: saved.profile.profileId
      }).profile.name,
      "Identity Only Test"
    );

    const applied = runDispatcher(extendedFixtureDispatcher, {
      operation: "apply-profile",
      profileId: saved.profile.profileId,
      rootPath: targetRoot
    });
    assert.equal(applied.moved, 1);
    assert.ok(existsSync(path.join(targetRoot, "Images", "picture.png")));
    assert.ok(existsSync(path.join(targetRoot, "notes.txt")));

    const created = runDispatcher(extendedFixtureDispatcher, {
      operation: "create-folder",
      rootPath: targetRoot,
      relativePath: "Exact/Nested"
    });
    assert.equal(created.created, true);
    assert.ok(existsSync(path.join(targetRoot, "Exact", "Nested")));
    const panels = runDispatcher(extendedFixtureDispatcher, { operation: "list-panels" });
    assert.deepEqual(panels.panels, ["Files"]);
    assert.equal(panels.currentPanel, "Files");
    assert.equal(panels.defaultPanel, "Files");

    const staged = runDispatcher(extendedFixtureDispatcher, {
      operation: "stage-generated-button",
      profileId: saved.profile.profileId
    });
    const stageRoot = path.dirname(path.dirname(staged.stagedSourcePath));
    const stageManifest = JSON.parse(readFileSync(path.join(stageRoot, "stage.json"), "utf8"));
    const generatedManifest = JSON.parse(readFileSync(staged.stagedSourcePath, "utf8"));
    const generatedScript = readFileSync(path.join(path.dirname(staged.stagedSourcePath), generatedManifest.source), "utf8");
    assert.equal(stageManifest.stageToken, staged.stageToken);
    assert.equal(stageManifest.namespace, "windows.setup-organization");
    assert.equal(stageManifest.metadata.profileId, saved.profile.profileId);
    assert.equal(stageManifest.programName, "Windows");
    assert.equal(stageManifest.importKind, "script");
    assert.match(stageManifest.sourceManifestSha256, /^[0-9a-f]{64}$/);
    assert.match(stageManifest.scriptSha256, /^[0-9a-f]{64}$/);
    assert.equal(generatedManifest.program, "Windows");
    assert.equal(generatedManifest.page, undefined);
    assert.match(generatedScript, new RegExp(saved.profile.profileId, "g"));
    assert.doesNotMatch(generatedScript, /Identity Only Test|images-rule|"Images"/);

    writeFileSync(path.join(targetRoot, "second.png"), "png", "utf8");
    const generatedRun = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      `\\\\?\\${path.join(path.dirname(staged.stagedSourcePath), generatedManifest.source)}`,
      "-TargetPath",
      targetRoot
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(generatedRun.status, 0, generatedRun.stderr);
    assert.ok(existsSync(path.join(targetRoot, "Images", "second.png")));

    const escaped = spawnSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      extendedFixtureDispatcher,
      "-FlowCellCapability",
      "windows.setup-organization",
      "-ArgsJson",
      JSON.stringify({ operation: "create-folder", rootPath: targetRoot, relativePath: "../escape" })
    ], { encoding: "utf8", windowsHide: true });
    assert.notEqual(escaped.status, 0);
    assert.equal(existsSync(path.join(fixtureRoot, "escape")), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
