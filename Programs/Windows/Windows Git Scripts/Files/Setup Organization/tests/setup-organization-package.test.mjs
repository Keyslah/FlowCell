import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
const templatePath = path.join(packageRoot, "templates", "organize_folder.ps1.template");
const pagePath = path.join(packageRoot, "page", "page.js");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const actionById = new Map(manifest.page.actions.map((action) => [action.id, action]));

const PAGE_ACTION_IDS = [
  "delete-file-group",
  "delete-profile",
  "install-generated-button",
  "list-file-groups",
  "list-installed-buttons",
  "list-panels",
  "list-profiles",
  "load-folder-tree",
  "load-profile",
  "save-file-group",
  "save-profile",
  "select-root",
  "stage-generated-button"
];
const EXPECTED_ACTION_IDS = [
  ...PAGE_ACTION_IDS,
  "prepare-existing-target",
  "prepare-target"
].sort();

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
  assert.ok(Object.keys(schema).length > 0, `${label} must declare a supported schema keyword`);
  if (schema.properties !== undefined) {
    assert.equal(schema.type, "object", `${label}.properties requires object type`);
    for (const [name, child] of Object.entries(schema.properties)) {
      assertStrictSchema(child, `${label}.properties.${name}`);
    }
  }
  if (schema.additionalProperties !== undefined) {
    assert.equal(schema.type, "object", `${label}.additionalProperties requires object type`);
    if (typeof schema.additionalProperties !== "boolean") {
      assertStrictSchema(schema.additionalProperties, `${label}.additionalProperties`);
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
  }).sort();
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
  assert.deepEqual(manifest.page.capabilities.slice().sort(), [
    "button.install-generated",
    "folder.select",
    "windows.setup-organization",
    "windows.setup-organization.list-profiles",
    "windows.setup-organization.prepare-existing-target",
    "windows.setup-organization.prepare-target"
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
  assert.deepEqual(collectFiles(packageRoot), [
    "flowcell.script.json",
    "formats/profile.v3.schema.json",
    "formats/project-marker.v1.schema.json",
    "formats/stage.v1.schema.json",
    "page/index.html",
    "page/page.css",
    "page/page.js",
    "setup_organization.ps1",
    "templates/organize_folder.ps1.template",
    "tests/setup-organization-package.test.mjs"
  ]);
  for (const relative of [
    manifest.source,
    manifest.page.entry,
    ...manifest.page.scripts,
    ...manifest.page.styles,
    "formats/profile.v3.schema.json",
    "formats/project-marker.v1.schema.json",
    "formats/stage.v1.schema.json",
    "templates/organize_folder.ps1.template"
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

  const formatIds = Object.values(manifest.page.config.formatDefinitions)
    .map((relative) => JSON.parse(readFileSync(path.join(packageRoot, relative), "utf8")).$id)
    .sort();
  assert.deepEqual(formatIds, [
    "flowcell.project.v1",
    "flowcell.windows.setup-organization.profile.v3",
    "flowcell.windows.setup-organization.stage.v1"
  ]);
});

test("page calls only declared actions and program operations match the dispatcher", () => {
  const page = readFileSync(pagePath, "utf8");
  const requested = new Set([...page.matchAll(/request\("([a-z0-9.-]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...requested].sort(), PAGE_ACTION_IDS);
  assert.deepEqual([...actionById.keys()].sort(), EXPECTED_ACTION_IDS);

  const dispatcher = readFileSync(dispatcherPath, "utf8");
  for (const action of manifest.page.actions) {
    if (action.handler.kind !== "program") continue;
    assert.equal(action.handler.capability, "windows.setup-organization");
    const operation = action.handler.payload.operation;
    assert.ok(
      dispatcher.includes(`'${operation}'`),
      `dispatcher must handle the ${operation} operation`
    );
  }
});

test("prepare-target publishes the Save Blender provider contract", () => {
  const prepare = actionById.get("prepare-target");
  assert.deepEqual(prepare.handler, {
    kind: "program",
    capability: "windows.setup-organization",
    payload: { operation: "prepare-target" }
  });
  assert.deepEqual(prepare.requestSchema.required.slice().sort(), [
    "plannedExtension", "projectRoot"
  ]);
  assert.deepEqual(Object.keys(prepare.requestSchema.properties).sort(), [
    "plannedExtension", "profileId", "profilePath", "projectRoot"
  ]);
  assert.deepEqual(prepare.requestSchema.properties.plannedExtension.enum, [".blend"]);
  assert.deepEqual(prepare.responseSchema.required.slice().sort(), [
    "destinationDirectory",
    "destinationRelativePath",
    "markerPath",
    "plannedExtension",
    "prepared",
    "profileId",
    "profileName",
    "profilePath",
    "projectRoot"
  ]);
});

test("prepare-existing-target publishes a marker-derived provider contract", () => {
  const prepare = actionById.get("prepare-existing-target");
  assert.deepEqual(prepare.handler, {
    kind: "program",
    capability: "windows.setup-organization",
    payload: { operation: "prepare-existing-target" }
  });
  assert.equal(
    prepare.providerCapability,
    "windows.setup-organization.prepare-existing-target"
  );
  assert.deepEqual(prepare.requestSchema.required.slice().sort(), [
    "plannedExtension", "projectRoot"
  ]);
  assert.deepEqual(Object.keys(prepare.requestSchema.properties).sort(), [
    "plannedExtension", "projectRoot"
  ]);
  assert.deepEqual(prepare.requestSchema.properties.plannedExtension.enum, [".blend"]);
  assert.deepEqual(
    prepare.responseSchema,
    actionById.get("prepare-target").responseSchema,
    "existing preparation returns the same strict response shape"
  );
});

test("list-profiles publishes the human-readable profile provider contract", () => {
  const list = actionById.get("list-profiles");
  assert.deepEqual(list.handler, {
    kind: "program",
    capability: "windows.setup-organization",
    payload: { operation: "list-profiles" }
  });
  assert.equal(list.providerCapability, "windows.setup-organization.list-profiles");
  assert.deepEqual(list.requestSchema, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });
  assert.deepEqual(list.responseSchema.required, ["profiles"]);
  assert.deepEqual(list.responseSchema.properties.profiles.items.required, [
    "profileId", "name", "updatedAt", "folderCount", "assignedCount"
  ]);
});

test("the profile format drops roles and ambiguity resolution", () => {
  const schema = JSON.parse(
    readFileSync(path.join(packageRoot, "formats", "profile.v3.schema.json"), "utf8")
  );
  assert.equal(schema.$id, "flowcell.windows.setup-organization.profile.v3");
  assert.deepEqual(schema.required.slice().sort(), [
    "createdAt",
    "folders",
    "format",
    "name",
    "profileId",
    "programFolders",
    "schemaVersion",
    "updatedAt"
  ]);
  const serialized = JSON.stringify(schema);
  for (const removed of ["roles", "rememberedChoices", "resolutionMode", "matchAll", "nameContains"]) {
    assert.equal(serialized.includes(`"${removed}"`), false, `${removed} must be gone from v3`);
  }
  // A program folder is a group reference plus two switches, nothing like v2's
  // role-carrying programFolder.
  assert.deepEqual(schema.$defs.programFolder.required.slice().sort(), [
    "createInRoot", "groupId", "profileId"
  ]);
  assert.equal(JSON.stringify(schema.$defs.programFolder).includes('"roles"'), false);
  assert.deepEqual(schema.$defs.folder.required.slice().sort(), [
    "catchAll", "fileTypes", "groupIds", "ignored", "path"
  ]);
  assert.equal(schema.properties.recycleOtherFolders.type, "boolean");
  assert.equal(schema.properties.recyclePreviousIgnoredFolders.type, "boolean");
  assert.equal(schema.required.includes("recycleOtherFolders"), false,
    "existing v3 profiles must remain valid with cleanup disabled");
  assert.equal(schema.required.includes("recyclePreviousIgnoredFolders"), false,
    "existing v3 profiles must remain valid with stale-ignored cleanup disabled");
  const dependency = schema.allOf.find(
    (entry) => entry?.if?.properties?.recyclePreviousIgnoredFolders
  );
  assert.equal(dependency.if.properties.recyclePreviousIgnoredFolders.const, true);
  assert.equal(dependency.then.properties.recycleOtherFolders.const, true);
  for (const retired of ["recycleIgnoredFolders", "recycleNonProfileFoldersWithContents"]) {
    assert.equal(serialized.includes(`"${retired}"`), false,
      `${retired} must not imply current-profile ignored folders are cleanup targets`);
  }
});

test("profile cleanup controls are adjacent, persisted, and dependency-safe", () => {
  const html = readFileSync(path.join(packageRoot, "page", "index.html"), "utf8");
  const nameIndex = html.indexOf('id="profile-name"');
  const otherIndex = html.indexOf('id="recycle-other-folders"');
  const previousIgnoredIndex = html.indexOf('id="recycle-previous-ignored-folders"');
  const newIndex = html.indexOf('id="new-profile"');
  assert.ok(nameIndex >= 0 && otherIndex > nameIndex && previousIgnoredIndex > otherIndex && newIndex > previousIgnoredIndex,
    "the paired cleanup controls must sit between the profile name and New button");
  assert.match(html, /Recycle empty folders not in current profile/);
  assert.match(html, /Also recycle ignored folders left by the previous profile/);
  assert.doesNotMatch(html, /Include ignored folders/i);

  const page = readFileSync(pagePath, "utf8");
  assert.match(page, /recycleOtherFolders:\s*elements\.recycleOtherFolders\.checked === true/);
  assert.match(page, /recyclePreviousIgnoredFolders:\s*[\s\S]*elements\.recyclePreviousIgnoredFolders\.checked === true/);
  assert.match(page, /if \(!elements\.recycleOtherFolders\.checked\) elements\.recyclePreviousIgnoredFolders\.checked = false/);
  assert.match(page, /elements\.recyclePreviousIgnoredFolders\.disabled = state\.busy \|\| !elements\.recycleOtherFolders\.checked/);

  const save = actionById.get("save-profile");
  assert.equal(save.requestSchema.properties.recycleOtherFolders.type, "boolean");
  assert.equal(save.requestSchema.properties.recyclePreviousIgnoredFolders.type, "boolean");
  for (const actionId of ["load-profile", "save-profile"]) {
    const profile = actionById.get(actionId).responseSchema.properties.profile;
    assert.ok(profile.required.includes("recycleOtherFolders"));
    assert.ok(profile.required.includes("recyclePreviousIgnoredFolders"));
  }
});

test("the project marker maps extensions to project-relative folders", () => {
  const schema = JSON.parse(
    readFileSync(path.join(packageRoot, "formats", "project-marker.v1.schema.json"), "utf8")
  );
  assert.equal(schema.$id, "flowcell.project.v1");
  assert.deepEqual(schema.required.slice().sort(), [
    "catchAll",
    "format",
    "ignored",
    "organizedAt",
    "profileFolders_placeholder_removed",
    "profileId",
    "profileName",
    "programFolders",
    "schemaVersion",
    "where"
  ].filter((x) => x !== "profileFolders_placeholder_removed"));
  // Destinations must stay inside the project: no drive letters, no leading
  // separator, no parent traversal.
  const pattern = new RegExp(schema.$defs.relativeFolder.pattern);
  assert.equal(pattern.test("01 src/00 assets/03 3d"), true);
  assert.equal(pattern.test("C:/somewhere"), false);
  assert.equal(pattern.test("/absolute"), false);
  assert.equal(pattern.test("../escape"), false);
});

test("the generated organizer template is bound to one profile and writes the marker", () => {
  const template = readFileSync(templatePath, "utf8");
  assert.ok(template.includes("{{PROFILE_ID}}"), "template needs the profile token");
  assert.ok(template.includes(".flowcell-project.json"), "template must write the project marker");
  assert.ok(template.includes("flowcell.project.v1"), "marker must declare its format");
  assert.ok(template.includes("Get-Clipboard"), "template must resolve the clipboard folder");
  // Recursive discovery, with ignored subtrees excluded.
  assert.match(template, /Get-ChildItem[^\n]*-Recurse/);
  assert.ok(template.includes("ignoredRoots"), "template must skip ignored subtrees");
  assert.ok(template.includes("catchAllRoute"), "template must route unmatched files to the catch-all");
  // Never overwrite an existing destination file.
  assert.ok(template.includes("Test-Path -LiteralPath $destination"));
});

test("the organizer recycles legacy metadata and performs cleanup only after routing", () => {
  const template = readFileSync(templatePath, "utf8");
  assert.ok(template.includes("organize-folder.profile.json"));
  assert.ok(template.includes("organize-folder.undo.json"));
  assert.ok(template.includes("Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin"));
  assert.ok(template.includes("Get-SafeDirectorySnapshot"));
  assert.ok(template.includes("Assert-TreeSafeForRecycle"));
  assert.ok(template.includes("Read-PreviousIgnoredRoots"));
  assert.ok(template.includes("Write-ProjectMarker"));
  assert.match(template, /\$nestedProfilesById = @\{\}[\s\S]*if \(\$recycleOtherFolders\)/,
    "any folder cleanup must resolve configured program and nested-profile ownership first");
  assert.ok(template.includes("Get-OptionalProfileBoolean"),
    "destructive profile switches must reject non-boolean saved values");
  assert.ok(template.includes("protectedDirectories"));
  assert.ok(template.includes("insideIgnoredTree"));
  assert.ok(template.includes("Add-ProtectedDirectoryAndAncestors"));
  assert.ok(template.includes("$remaining.Count -gt 0"),
    "ordinary folder cleanup must preserve folders containing unmoved files");

  const ignoredSkip = template.indexOf("if ($isIgnored) { continue }");
  const previousIgnoredSkip = template.indexOf("if ($insidePreviousIgnoredFolderToRecycle) { continue }");
  const legacyCollect = template.indexOf("$legacyArtifacts.Add($file.FullName)");
  const move = template.indexOf("Move-Item -LiteralPath $file.FullName");
  const legacyCleanup = template.indexOf("$legacyArtifactsRecycled = 0");
  const previousIgnoredCleanup = template.indexOf("if ($recyclePreviousIgnoredFolders)", legacyCleanup);
  const folderCleanup = template.indexOf(
    "if ($recycleOtherFolders -and $null -eq $staleCleanupFailure)", previousIgnoredCleanup);
  assert.ok(ignoredSkip >= 0 && previousIgnoredSkip > ignoredSkip && legacyCollect > previousIgnoredSkip,
    "legacy files inside a preserved ignored subtree must remain untouched");
  assert.ok(move >= 0 && legacyCleanup > move && previousIgnoredCleanup > legacyCleanup && folderCleanup > previousIgnoredCleanup,
    "file moves must finish before any legacy, stale-ignored, or empty-folder cleanup");
  assert.doesNotMatch(template, /\$recycleIgnoredFolders\b|ignoredFoldersRecycled/,
    "current-profile ignored folders must never be exposed as direct cleanup targets");
});

test("the generated organizer falls back from an empty file-drop clipboard to copied text", () => {
  const template = readFileSync(templatePath, "utf8");
  assert.ok(template.includes("$fileDropList = $null"));
  assert.ok(template.includes("if ($null -ne $fileDropList)"));
  assert.ok(template.includes("Get-Clipboard -Format Text -ErrorAction Stop"));
  assert.ok(!template.includes("@(Get-Clipboard -Format FileDropList"),
    "a null file-drop result must not become a one-entry array that blocks text fallback");
});

function runPowerShell(scriptPath, args) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { encoding: "utf8" }
  );
}

function renderOrganizerForTest(profileId, dataRoot, options = {}) {
  let source = readFileSync(templatePath, "utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("{{PROFILE_ID}}", profileId);

  const dataFunctionStart = source.indexOf("function Get-ProgramDataRoot {");
  const dataFunctionEnd = source.indexOf("\n}", dataFunctionStart) + 2;
  assert.ok(dataFunctionStart >= 0 && dataFunctionEnd > dataFunctionStart,
    "organizer data-root function must be replaceable for an isolated runtime test");
  const escapedDataRoot = dataRoot.replaceAll("'", "''");
  source = `${source.slice(0, dataFunctionStart)}function Get-ProgramDataRoot {\n`+
    `    return '${escapedDataRoot}'\n`+
    `}${source.slice(dataFunctionEnd)}`;

  // The test workspace is short-lived, so override only this rendered copy to
  // remove its temp trees directly instead of filling the user's Recycle Bin.
  const tryMarker = "try {\n    $target = Resolve-TargetFolder";
  assert.ok(source.includes(tryMarker), "organizer entry point must be present");
  const recycleOverride = [
    "function Send-PathToRecycleBin {",
    "    param([Parameter(Mandatory = $true)][string]$Path)",
    ...(options.failRecycleName ? [
      `    if ([System.IO.Path]::GetFileName($Path) -eq '${String(options.failRecycleName).replaceAll("'", "''")}') {`,
      "        throw 'simulated recycle failure'",
      "    }"
    ] : []),
    "    if (Test-Path -LiteralPath $Path -PathType Container) {",
    "        Remove-Item -LiteralPath $Path -Recurse -Force",
    "        return",
    "    }",
    "    Remove-Item -LiteralPath $Path -Force",
    "}",
    ""
  ].join("\n");
  return source.replace(tryMarker, `${recycleOverride}${tryMarker}`);
}

function createIsolatedDispatcher(workspace) {
  const isolatedPackageRoot = path.join(
    workspace, "Programs", "Windows", "Windows Git Scripts", "Files", "Setup Organization"
  );
  mkdirSync(path.join(isolatedPackageRoot, "templates"), { recursive: true });
  mkdirSync(path.join(workspace, "flowcellbackend"), { recursive: true });
  const isolatedDispatcher = path.join(isolatedPackageRoot, "setup_organization.ps1");
  const isolatedTemplate = path.join(isolatedPackageRoot, "templates", "organize_folder.ps1.template");
  writeFileSync(isolatedDispatcher, readFileSync(dispatcherPath, "utf8"), "utf8");
  writeFileSync(isolatedTemplate, readFileSync(templatePath, "utf8"), "utf8");
  return { isolatedDispatcher, isolatedPackageRoot };
}

function runSetupOperation(dispatcher, payload) {
  return runPowerShell(dispatcher, [
    "-FlowCellCapability", "windows.setup-organization", "-ArgsJson", JSON.stringify(payload)
  ]);
}

function validProjectMarker(profileId, overrides = {}) {
  return {
    schemaVersion: 1,
    format: "flowcell.project.v1",
    profileId,
    profileName: "Program Kiln",
    organizedAt: "2026-08-04T12:00:00.000Z",
    where: {},
    catchAll: "",
    programFolders: {},
    ignored: [],
    ...overrides
  };
}

test("list-profiles returns names and stable IDs without exposing storage paths", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-list-profiles-"));
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const profilesRoot = path.join(
      workspace, "flowcellbackend", "local", "program-data", "windows", "setup-organization", "profiles"
    );
    mkdirSync(profilesRoot, { recursive: true });
    const records = [
      ["22222222-2222-4222-8222-222222222222", "Zebra"],
      ["11111111-1111-4111-8111-111111111111", "Alpha"]
    ];
    for (const [profileId, name] of records) {
      writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
        schemaVersion: 3,
        format: "flowcell.windows.setup-organization.profile.v3",
        profileId,
        name,
        recycleOtherFolders: false,
        recyclePreviousIgnoredFolders: false,
        folders: [{ path: "Loose files", groupIds: [], fileTypes: [], ignored: false, catchAll: true }],
        programFolders: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z"
      }), "utf8");
    }

    const result = runPowerShell(isolatedDispatcher, [
      "-FlowCellCapability", "windows.setup-organization", "-ArgsJson",
      JSON.stringify({ operation: "list-profiles" })
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout.trim());
    assert.deepEqual(response.profiles.map(({ name }) => name), ["Alpha", "Zebra"]);
    assert.deepEqual(response.profiles.map(({ profileId }) => profileId), [records[1][0], records[0][0]]);
    assert.ok(response.profiles.every((profile) => !("profilePath" in profile) && !("path" in profile)));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("prepare-existing-target creates a Blender folder for an unmarked project", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-existing-unmarked-"));
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const projectRoot = path.join(workspace, "Existing Project");
    const illustratorFile = path.join(projectRoot, "Illustrator", "kiln.ai");
    mkdirSync(path.dirname(illustratorFile), { recursive: true });
    writeFileSync(illustratorFile, "illustrator bytes stay here", "utf8");
    const beforeFiles = collectFiles(projectRoot);

    const result = runSetupOperation(isolatedDispatcher, {
      operation: "prepare-existing-target",
      projectRoot,
      plannedExtension: ".blend"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout.trim());
    assert.equal(response.prepared, true);
    assert.equal(response.destinationRelativePath, "Blender");
    assert.equal(response.destinationDirectory.toLowerCase(), path.join(projectRoot, "Blender").toLowerCase());
    assert.equal(response.profileId, "");
    assert.equal(response.profileName, "");
    assert.equal(response.profilePath, "");
    assert.equal(response.markerPath, "");
    assert.ok(existsSync(path.join(projectRoot, "Blender")));
    assert.deepEqual(collectFiles(projectRoot), beforeFiles);
    assert.equal(readFileSync(illustratorFile, "utf8"), "illustrator bytes stay here");
    assert.equal(existsSync(path.join(projectRoot, ".flowcell-project.json")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("prepare-existing-target trusts an existing marker route without requiring its profile", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-existing-marker-route-"));
  const profileId = "30303030-3030-4030-8030-303030303030";
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const projectRoot = path.join(workspace, "Mapped Project");
    const illustratorFile = path.join(projectRoot, "Illustrator", "mapped.ai");
    mkdirSync(path.dirname(illustratorFile), { recursive: true });
    writeFileSync(illustratorFile, "mapped illustrator", "utf8");
    const markerPath = path.join(projectRoot, ".flowcell-project.json");
    const markerText = JSON.stringify(validProjectMarker(profileId, {
      where: { ".ai": "Illustrator", ".blend": "Custom Blender" },
      programFolders: { Illustrator: "Illustrator" }
    }), null, 2);
    writeFileSync(markerPath, markerText, "utf8");

    const result = runSetupOperation(isolatedDispatcher, {
      operation: "prepare-existing-target",
      projectRoot,
      plannedExtension: ".blend"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout.trim());
    assert.equal(response.destinationRelativePath, "Custom Blender");
    assert.equal(
      response.destinationDirectory.toLowerCase(),
      path.join(projectRoot, "Custom Blender").toLowerCase()
    );
    assert.equal(response.profileId, profileId);
    assert.equal(response.profilePath, "", "the deleted profile is not needed for a marker-owned route");
    assert.ok(existsSync(path.join(projectRoot, "Custom Blender")));
    assert.equal(readFileSync(markerPath, "utf8"), markerText);
    assert.equal(readFileSync(illustratorFile, "utf8"), "mapped illustrator");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("prepare-existing-target resolves only the Program Kiln Blender destination", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-existing-program-route-"));
  const profileId = "40404040-4040-4040-8040-404040404040";
  const nestedProfileId = "50505050-5050-4050-8050-505050505050";
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const dataRoot = path.join(
      workspace, "flowcellbackend", "local", "program-data", "windows", "setup-organization"
    );
    const profilesRoot = path.join(dataRoot, "profiles");
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.windows.setup-organization.custom-file-groups.v1",
      groups: [
        {
          groupId: "blender", label: "Blender", fileTypes: [".blend", ".blend1"],
          isProgram: true, createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        {
          groupId: "illustrator", label: "Illustrator", fileTypes: [".ai"],
          isProgram: true, createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    }), "utf8");
    const profilePath = path.join(profilesRoot, `${profileId}.json`);
    writeFileSync(profilePath, JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Program Kiln",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [{
        path: "Loose files", groupIds: [], fileTypes: [], ignored: false, catchAll: true
      }],
      programFolders: [
        { groupId: "blender", createInRoot: true, profileId: nestedProfileId },
        { groupId: "illustrator", createInRoot: true, profileId: nestedProfileId }
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${nestedProfileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: nestedProfileId,
      name: "Program Tree",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: [
        { path: "02 snapshots", groupIds: [], fileTypes: [], ignored: true, catchAll: false },
        { path: "03 archive", groupIds: [], fileTypes: [], ignored: true, catchAll: false },
        { path: "04 trash", groupIds: [], fileTypes: [], ignored: true, catchAll: false }
      ],
      programFolders: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }), "utf8");

    const projectRoot = path.join(workspace, "Program Kiln Project");
    const illustratorFile = path.join(projectRoot, "Illustrator", "kiln.ai");
    const assetFile = path.join(projectRoot, "Loose files", "reference.txt");
    mkdirSync(path.dirname(illustratorFile), { recursive: true });
    mkdirSync(path.dirname(assetFile), { recursive: true });
    writeFileSync(illustratorFile, "do not move illustrator", "utf8");
    writeFileSync(assetFile, "do not collect or recycle", "utf8");
    const markerPath = path.join(projectRoot, ".flowcell-project.json");
    const markerText = JSON.stringify(validProjectMarker(profileId, {
      where: { ".ai": "Illustrator" },
      catchAll: "Loose files",
      programFolders: { Illustrator: "Illustrator" },
      ignored: ["Illustrator/02 snapshots", "Illustrator/03 archive", "Illustrator/04 trash"]
    }), null, 2);
    writeFileSync(markerPath, markerText, "utf8");
    const beforeFiles = collectFiles(projectRoot);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runSetupOperation(isolatedDispatcher, {
        operation: "prepare-existing-target",
        projectRoot,
        plannedExtension: ".blend"
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const response = JSON.parse(result.stdout.trim());
      assert.equal(response.profileId, profileId);
      assert.equal(response.profileName, "Program Kiln");
      assert.equal(response.profilePath.toLowerCase(), profilePath.toLowerCase());
      assert.equal(response.markerPath.toLowerCase(), markerPath.toLowerCase());
      assert.equal(response.destinationRelativePath, "Blender");
      assert.equal(
        response.destinationDirectory.toLowerCase(),
        path.join(projectRoot, "Blender").toLowerCase()
      );
      assert.ok(existsSync(path.join(projectRoot, "Blender")));
      for (const helper of ["02 snapshots", "03 archive", "04 trash"]) {
        assert.equal(existsSync(path.join(projectRoot, "Blender", helper)), false);
      }
      assert.equal(readFileSync(markerPath, "utf8"), markerText, "the marker stays byte-identical");
      assert.deepEqual(collectFiles(projectRoot), beforeFiles);
      assert.equal(readFileSync(illustratorFile, "utf8"), "do not move illustrator");
      assert.equal(readFileSync(assetFile, "utf8"), "do not collect or recycle");
      assert.equal(existsSync(path.join(dataRoot, "undo")), false);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("prepare-existing-target fails closed for invalid markers and route conflicts", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-existing-invalid-"));
  const profileId = "60606060-6060-4060-8060-606060606060";
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const invalidRoot = path.join(workspace, "Invalid Marker");
    mkdirSync(invalidRoot, { recursive: true });
    const invalidMarkerPath = path.join(invalidRoot, ".flowcell-project.json");
    writeFileSync(invalidMarkerPath, "{not json", "utf8");
    writeFileSync(path.join(invalidRoot, "keep.ai"), "keep", "utf8");
    const invalidBefore = collectFiles(invalidRoot);
    const invalid = runSetupOperation(isolatedDispatcher, {
      operation: "prepare-existing-target",
      projectRoot: invalidRoot,
      plannedExtension: ".blend"
    });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /existing project marker is invalid/i);
    assert.deepEqual(collectFiles(invalidRoot), invalidBefore);
    assert.equal(readFileSync(invalidMarkerPath, "utf8"), "{not json");

    const dataRoot = path.join(
      workspace, "flowcellbackend", "local", "program-data", "windows", "setup-organization"
    );
    const profilesRoot = path.join(dataRoot, "profiles");
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.windows.setup-organization.custom-file-groups.v1",
      groups: [
        { groupId: "blend-one", label: "Blender One", fileTypes: [".blend"], isProgram: true },
        { groupId: "blend-two", label: "Blender Two", fileTypes: [".blend"], isProgram: true }
      ]
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Conflicting Kiln",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: [],
      programFolders: [
        { groupId: "blend-one", createInRoot: true, profileId: "" },
        { groupId: "blend-two", createInRoot: true, profileId: "" }
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }), "utf8");
    const conflictRoot = path.join(workspace, "Conflicting Route");
    mkdirSync(conflictRoot, { recursive: true });
    const conflictMarkerPath = path.join(conflictRoot, ".flowcell-project.json");
    const conflictMarkerText = JSON.stringify(validProjectMarker(profileId));
    writeFileSync(conflictMarkerPath, conflictMarkerText, "utf8");
    writeFileSync(path.join(conflictRoot, "keep.ai"), "still keep", "utf8");
    const conflictBefore = collectFiles(conflictRoot);
    const conflict = runSetupOperation(isolatedDispatcher, {
      operation: "prepare-existing-target",
      projectRoot: conflictRoot,
      plannedExtension: ".blend"
    });
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /conflicting program routes/i);
    assert.deepEqual(collectFiles(conflictRoot), conflictBefore);
    assert.equal(readFileSync(conflictMarkerPath, "utf8"), conflictMarkerText);
    assert.equal(existsSync(path.join(conflictRoot, "Blender One")), false);
    assert.equal(existsSync(path.join(conflictRoot, "Blender Two")), false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("prepare-target activates a planned Blender route through the real organizer engine", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-prepare-"));
  const profileId = "78787878-7878-4878-8878-787878787878";
  const nestedProfileId = "89898989-8989-4989-8989-898989898989";
  try {
    const { isolatedDispatcher } = createIsolatedDispatcher(workspace);
    const dataRoot = path.join(
      workspace, "flowcellbackend", "local", "program-data", "windows", "setup-organization"
    );
    const profilesRoot = path.join(dataRoot, "profiles");
    const projectRoot = path.join(workspace, "New Blender Project");
    mkdirSync(profilesRoot, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.windows.setup-organization.custom-file-groups.v1",
      groups: [{
        groupId: "blender",
        label: "Blender",
        fileTypes: [".blend"],
        isProgram: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }]
    }), "utf8");
    const profilePath = path.join(profilesRoot, `${profileId}.json`);
    writeFileSync(profilePath, JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Project",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: [{
        path: "Loose files", groupIds: [], fileTypes: [], ignored: false, catchAll: true
      }],
      programFolders: [{ groupId: "blender", createInRoot: true, profileId: nestedProfileId }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${nestedProfileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: nestedProfileId,
      name: "Program Tree",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: [
        { path: "02 snapshots", groupIds: [], fileTypes: [], ignored: true, catchAll: false },
        { path: "03 archive", groupIds: [], fileTypes: [], ignored: true, catchAll: false },
        { path: "04 trash", groupIds: [], fileTypes: [], ignored: true, catchAll: false }
      ],
      programFolders: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }), "utf8");

    const capabilityArgs = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];
    const result = runPowerShell(isolatedDispatcher, [
      ...capabilityArgs,
      JSON.stringify({
        operation: "prepare-target",
        projectRoot,
        plannedExtension: ".blend",
        profilePath
      })
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const response = JSON.parse(result.stdout.trim());
    assert.equal(response.prepared, true);
    assert.equal(response.profileId, profileId);
    assert.equal(response.profilePath.toLowerCase(), profilePath.toLowerCase());
    assert.equal(response.destinationRelativePath, "Blender");
    assert.equal(response.destinationDirectory.toLowerCase(), path.join(projectRoot, "Blender").toLowerCase());
    assert.ok(existsSync(response.destinationDirectory));
    for (const relative of ["02 snapshots", "03 archive", "04 trash"]) {
      assert.ok(existsSync(path.join(projectRoot, "Blender", relative)));
    }
    const marker = JSON.parse(readFileSync(path.join(projectRoot, ".flowcell-project.json"), "utf8"));
    assert.equal(marker.format, "flowcell.project.v1");
    assert.equal(marker.profileId, profileId);
    assert.equal(marker.where[".blend"], "Blender");
    assert.equal(collectFiles(projectRoot).some((relative) => relative.endsWith(".blend")), false,
      "planned routing must not create a placeholder Blender file");

    const identityRoot = path.join(workspace, "Profile Id Project");
    mkdirSync(identityRoot, { recursive: true });
    const identityResult = runPowerShell(isolatedDispatcher, [
      ...capabilityArgs,
      JSON.stringify({
        operation: "prepare-target",
        projectRoot: identityRoot,
        plannedExtension: ".blend",
        profileId
      })
    ]);
    assert.equal(identityResult.status, 0, identityResult.stderr || identityResult.stdout);
    assert.equal(JSON.parse(identityResult.stdout.trim()).destinationRelativePath, "Blender");

    const volumeRoot = path.parse(workspace).root;
    const rootResult = runPowerShell(isolatedDispatcher, [
      ...capabilityArgs,
      JSON.stringify({
        operation: "prepare-target",
        projectRoot: volumeRoot,
        plannedExtension: ".blend",
        profileId
      })
    ]);
    assert.equal(rootResult.status, 1);
    assert.match(rootResult.stderr, /drive or share root/i);

    const conflictingRoot = path.join(workspace, "Existing Project");
    mkdirSync(conflictingRoot, { recursive: true });
    writeFileSync(path.join(conflictingRoot, "keep.txt"), "untouched", "utf8");
    const conflict = runPowerShell(isolatedDispatcher, [
      ...capabilityArgs,
      JSON.stringify({
        operation: "prepare-target",
        projectRoot: conflictingRoot,
        plannedExtension: ".blend",
        profileId
      })
    ]);
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /newly created empty projectRoot/i);
    assert.equal(readFileSync(path.join(conflictingRoot, "keep.txt"), "utf8"), "untouched");
    assert.equal(existsSync(path.join(conflictingRoot, ".flowcell-project.json")), false);

    const ambiguousRoot = path.join(workspace, "Ambiguous Profile");
    mkdirSync(ambiguousRoot, { recursive: true });
    const ambiguous = runPowerShell(isolatedDispatcher, [
      ...capabilityArgs,
      JSON.stringify({
        operation: "prepare-target",
        projectRoot: ambiguousRoot,
        plannedExtension: ".blend",
        profileId,
        profilePath
      })
    ]);
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stderr, /exactly one of profileId or profilePath/i);
    assert.deepEqual(readdirSync(ambiguousRoot), []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the dispatcher and rendered organizer template both parse", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-parse-"));
  try {
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(
      rendered,
      readFileSync(templatePath, "utf8").replaceAll("{{PROFILE_ID}}", "00000000-0000-0000-0000-000000000000"),
      "utf8"
    );
    const checker = path.join(workspace, "parse.ps1");
    writeFileSync(
      checker,
      [
        "param([string]$Target)",
        "$errors = $null; $tokens = $null",
        "[System.Management.Automation.Language.Parser]::ParseFile($Target, [ref]$tokens, [ref]$errors) | Out-Null",
        "if ($errors -and $errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }",
        "exit 0"
      ].join("\n"),
      "utf8"
    );
    for (const target of [dispatcherPath, rendered]) {
      const result = runPowerShell(checker, [target]);
      assert.equal(result.status, 0, `${path.basename(target)} must parse: ${result.stdout}${result.stderr}`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("load-folder-tree copies structure breadth-first, caps, and never writes to the source", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-tree-"));
  try {
    // A source tree wide at the top and deep on one branch: a cap must keep the
    // shallow structure rather than one spine.
    const source = path.join(workspace, "source");
    for (const relative of [
      "01 src",
      "02 images",
      "03 docs",
      "01 src/00 assets",
      "01 src/00 assets/03 3d",
      "01 src/00 assets/03 3d/deep"
    ]) {
      mkdirSync(path.join(source, relative), { recursive: true });
    }
    writeFileSync(path.join(source, "keep.txt"), "untouched", "utf8");
    const before = collectFiles(source);

    const args = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];
    const capped = runPowerShell(dispatcherPath, [
      ...args,
      JSON.stringify({ operation: "load-folder-tree", rootPath: source, maxFolders: 3 })
    ]);
    assert.equal(capped.status, 0, capped.stderr);
    const cappedPayload = JSON.parse(capped.stdout.trim());
    assert.equal(cappedPayload.folders.length, 3);
    assert.equal(cappedPayload.capped, true);
    assert.deepEqual(cappedPayload.folders.slice().sort(), ["01 src", "02 images", "03 docs"]);

    const full = runPowerShell(dispatcherPath, [
      ...args,
      JSON.stringify({ operation: "load-folder-tree", rootPath: source, maxFolders: 0 })
    ]);
    assert.equal(full.status, 0, full.stderr);
    const fullPayload = JSON.parse(full.stdout.trim());
    assert.equal(fullPayload.capped, false);
    assert.equal(fullPayload.folders.length, 6);
    assert.ok(fullPayload.folders.includes("01 src/00 assets/03 3d/deep"));

    // Reading a tree must not create, move, or delete anything in the source.
    assert.deepEqual(collectFiles(source), before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("save-profile rejects one extension claimed by two folders", () => {
  const args = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];
  const result = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `conflict-check-${Date.now()}`,
      folders: [
        { path: "02 images", groupIds: [], fileTypes: [".png"], ignored: false },
        { path: "04 export", groupIds: [], fileTypes: [".png"], ignored: false }
      ]
    })
  ]);
  assert.equal(result.status, 1, "a duplicate extension claim must fail closed");
  assert.match(result.stderr, /assigned to both/i);
});

test("save-profile allows at most one catch-all folder", () => {
  const args = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];
  const twoCatchAlls = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `catchall-check-${Date.now()}`,
      folders: [
        { path: "98 misc", groupIds: [], fileTypes: [], ignored: false, catchAll: true },
        { path: "99 other", groupIds: [], fileTypes: [], ignored: false, catchAll: true }
      ]
    })
  ]);
  assert.equal(twoCatchAlls.status, 1, "two catch-all folders must fail closed");
  assert.match(twoCatchAlls.stderr, /Only one folder can collect all other files/i);

  const ignoredCatchAll = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `catchall-ignored-${Date.now()}`,
      folders: [{ path: "98 misc", groupIds: [], fileTypes: [], ignored: true, catchAll: true }]
    })
  ]);
  assert.equal(ignoredCatchAll.status, 1, "an ignored folder cannot also collect files");
  assert.match(ignoredCatchAll.stderr, /cannot both collect other files and be ignored/i);
});

test("previous-profile ignored cleanup requires empty-folder cleanup", () => {
  const args = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];
  const result = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `cleanup-dependency-${Date.now()}`,
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: true,
      folders: [{ path: "01 src", groupIds: [], fileTypes: [], ignored: false, catchAll: false }]
    })
  ]);
  assert.equal(result.status, 1, "stale ignored cleanup without empty cleanup must fail closed");
  assert.match(result.stderr, /recyclePreviousIgnoredFolders requires recycleOtherFolders/i);
});

test("program folders are validated against real program groups", () => {
  const args = ["-FlowCellCapability", "windows.setup-organization", "-ArgsJson"];

  // A plain file group cannot back a program folder.
  const notAProgramGroup = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `program-check-${Date.now()}`,
      folders: [{ path: "01 src", groupIds: [], fileTypes: [], ignored: false, catchAll: false }],
      programFolders: [{ groupId: "images", createInRoot: true, profileId: "" }]
    })
  ]);
  assert.equal(notAProgramGroup.status, 1, "a non-program group must be rejected");
  assert.match(notAProgramGroup.stderr, /not a program file group/i);

  // An unknown group id is rejected the same way.
  const unknown = runPowerShell(dispatcherPath, [
    ...args,
    JSON.stringify({
      operation: "save-profile",
      name: `program-unknown-${Date.now()}`,
      folders: [{ path: "01 src", groupIds: [], fileTypes: [], ignored: false, catchAll: false }],
      programFolders: [{ groupId: "no-such-group", createInRoot: true, profileId: "" }]
    })
  ]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /not a program file group/i);
});

test("the organizer creates program folders only when their files are present", () => {
  const template = readFileSync(templatePath, "utf8");
  assert.ok(template.includes("programRoutes"), "template must build program routes");
  assert.ok(template.includes("presentExtensions"), "template must pre-scan for matching files");
  // Program routes are consulted before ordinary folder routes.
  const programIndex = template.indexOf("foreach ($candidate in $programRoutes)");
  const normalIndex = template.indexOf("foreach ($candidate in $routes)");
  assert.ok(programIndex > 0 && normalIndex > programIndex,
    "program routes must be checked before ordinary routes");
  assert.ok(template.includes("Normalize-ProgramFolderName"),
    "a group label becomes a folder name and must be sanitised");
});

test("cleanup recycles only stale ignored folders from the previous profile", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-program-tree-"));
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const target = path.join(workspace, "project");
  const outerId = "11111111-1111-4111-8111-111111111111";
  const nestedId = "22222222-2222-4222-8222-222222222222";
  const previousId = "33333333-3333-4333-8333-333333333333";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";

  try {
    mkdirSync(profilesRoot, { recursive: true });
    mkdirSync(path.join(target, "Old Profile", "stale ignored", "nested"), { recursive: true });
    mkdirSync(path.join(target, "Blender", "02 snapshots"), { recursive: true });
    writeFileSync(path.join(target, "scene.blend"), "route me", "utf8");
    writeFileSync(path.join(target, "Old Profile", "stale ignored", "do-not-sort.blend"), "remove with tree", "utf8");
    writeFileSync(path.join(target, "Old Profile", "stale ignored", "nested", "note.txt"), "remove with tree", "utf8");
    writeFileSync(path.join(target, "Blender", "02 snapshots", "keep.blend"), "profile ignored", "utf8");
    writeFileSync(path.join(target, ".flowcell-project.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: previousId,
      profileName: "Previous Project",
      organizedAt: timestamp,
      where: {},
      catchAll: "",
      programFolders: {},
      ignored: ["Old Profile/stale ignored", "Blender/02 snapshots", "00 Assets"]
    }), "utf8");

    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.windows.setup-organization.custom-file-groups.v1",
      groups: [{ groupId: "blender", label: "Blender", fileTypes: [".blend"], isProgram: true }]
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${outerId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: outerId,
      name: "Project",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [
        { path: "00 Assets/Loose files", groupIds: [], fileTypes: [], ignored: false, catchAll: true }
      ],
      programFolders: [{ groupId: "blender", createInRoot: true, profileId: nestedId }],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${nestedId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: nestedId,
      name: "Program Tree",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: ["02 snapshots", "03 archive", "04 trash"].map((folderPath) => ({
        path: folderPath,
        groupIds: [],
        fileTypes: [],
        ignored: true,
        catchAll: false
      })),
      programFolders: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");

    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(outerId, dataRoot), "utf8");
    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

    assert.ok(existsSync(path.join(target, "Blender", "scene.blend")));
    assert.ok(existsSync(path.join(target, "00 Assets", "Loose files")),
      "an implicit ancestor of an authored profile folder must be protected");
    assert.ok(existsSync(path.join(target, "Blender", "02 snapshots", "keep.blend")),
      "the current profile's ignored subtree and contents must survive");
    for (const folderPath of ["02 snapshots", "03 archive", "04 trash"]) {
      assert.ok(existsSync(path.join(target, "Blender", folderPath)),
        `${folderPath} must remain beside the Blender files`);
    }
    assert.equal(existsSync(path.join(target, "Old Profile")), false,
      "the stale ignored folder and now-empty old-profile parent must be recycled");
    assert.equal(existsSync(path.join(target, "Blender", "do-not-sort.blend")), false,
      "a file inside the stale ignored tree must not be sorted first");

    const firstMarker = JSON.parse(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"));
    assert.deepEqual(firstMarker.ignored.slice().sort(), [
      "Blender/02 snapshots", "Blender/03 archive", "Blender/04 trash"
    ]);
    const firstOutput = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(firstOutput.previousIgnoredFoldersRecycled, 1);

    // Run again with no activatable Blender file outside the current ignored
    // tree. Logical current ownership must still preserve and re-record the
    // Program Tree, while permanent empty-folder cleanup continues to run.
    rmSync(path.join(target, "Blender", "scene.blend"), { force: true });
    writeFileSync(path.join(target, "Blender", "02 snapshots", "later.blend"), "still current", "utf8");
    mkdirSync(path.join(target, "new empty folder"), { recursive: true });
    const second = runPowerShell(rendered, [target]);
    assert.equal(second.status, 0, `${second.stdout}${second.stderr}`);
    assert.ok(existsSync(path.join(target, "Blender", "02 snapshots", "keep.blend")));
    assert.ok(existsSync(path.join(target, "Blender", "02 snapshots", "later.blend")));
    assert.equal(existsSync(path.join(target, "new empty folder")), false,
      "empty non-profile cleanup is a permanent rule, not a first-run rule");
    const secondMarker = JSON.parse(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"));
    assert.deepEqual(secondMarker.ignored.slice().sort(), firstMarker.ignored.slice().sort(),
      "inactive configured Program Tree paths must stay in the marker lineage");
    const secondOutput = JSON.parse(second.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(secondOutput.previousIgnoredFoldersRecycled, 0,
      "current ignored paths from the previous marker must not become stale");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a program file found only inside a stale ignored tree does not activate its program folder", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-stale-program-only-"));
  const target = path.join(workspace, "project");
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const outerId = "12121212-1212-4212-8212-121212121212";
  const nestedId = "13131313-1313-4313-8313-131313131313";
  const previousId = "14141414-1414-4414-8414-141414141414";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";
  try {
    mkdirSync(path.join(target, "Old ignored"), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(target, "Old ignored", "only.blend"), "remove unsorted", "utf8");
    writeFileSync(path.join(target, ".flowcell-project.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: previousId,
      profileName: "Previous",
      organizedAt: timestamp,
      where: {},
      catchAll: "",
      programFolders: {},
      ignored: ["Old ignored"]
    }), "utf8");
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      groups: [{ groupId: "blender", label: "Blender", fileTypes: [".blend"], isProgram: true }]
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${outerId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: outerId,
      name: "Current",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [],
      programFolders: [{ groupId: "blender", createInRoot: true, profileId: nestedId }],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${nestedId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId: nestedId,
      name: "Program Tree",
      recycleOtherFolders: false,
      recyclePreviousIgnoredFolders: false,
      folders: ["02 snapshots", "03 archive", "04 trash"].map((folderPath) => ({
        path: folderPath,
        groupIds: [],
        fileTypes: [],
        ignored: true,
        catchAll: false
      })),
      programFolders: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(outerId, dataRoot), "utf8");

    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(existsSync(path.join(target, "Old ignored")), false);
    assert.equal(existsSync(path.join(target, "Blender")), false,
      "stale content must not count as a live Blender file");
    const marker = JSON.parse(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"));
    assert.deepEqual(marker.programFolders, {});
    assert.deepEqual(marker.ignored.slice().sort(), [
      "Blender/02 snapshots", "Blender/03 archive", "Blender/04 trash"
    ]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an invalid existing project marker aborts before any mutation", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-invalid-marker-"));
  const target = path.join(workspace, "project");
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "keep.txt"), "untouched", "utf8");
    writeFileSync(path.join(target, ".flowcell-project.json"), "{not valid json", "utf8");
    const before = collectFiles(target);
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(
      "44444444-4444-4444-8444-444444444444", path.join(workspace, "program-data")), "utf8");
    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing project marker is invalid/i);
    assert.deepEqual(collectFiles(target), before);

    writeFileSync(path.join(target, ".flowcell-project.json"), JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: "44444444-4444-4444-8444-444444444444",
      ignored: []
    }), "utf8");
    const incompleteBefore = collectFiles(target);
    const incompleteResult = runPowerShell(rendered, [target]);
    assert.equal(incompleteResult.status, 1);
    assert.match(incompleteResult.stderr, /does not match the FlowCell project-marker v1 contract/i);
    assert.deepEqual(collectFiles(target), incompleteBefore);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("current ignored folders survive when there is no previous marker", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-no-marker-"));
  const target = path.join(workspace, "project");
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const profileId = "55555555-5555-4555-8555-555555555555";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";
  try {
    mkdirSync(path.join(target, "Keep"), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(target, "Keep", "untouched.txt"), "current ignored", "utf8");
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({ groups: [] }), "utf8");
    writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Current",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [{ path: "Keep", groupIds: [], fileTypes: [], ignored: true, catchAll: false }],
      programFolders: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(profileId, dataRoot), "utf8");

    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.ok(existsSync(path.join(target, "Keep", "untouched.txt")));
    const marker = JSON.parse(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"));
    assert.deepEqual(marker.ignored, ["Keep"]);
    assert.equal(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)).previousIgnoredFoldersRecycled, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an existing stale marker path that is not a safe folder aborts before mutation", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-unsafe-stale-path-"));
  const target = path.join(workspace, "project");
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const profileId = "15151515-1515-4515-8515-151515151515";
  const previousId = "16161616-1616-4616-8616-161616161616";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";
  try {
    mkdirSync(target, { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(target, "Old ignored"), "this is a file", "utf8");
    const markerText = JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: previousId,
      profileName: "Previous",
      organizedAt: timestamp,
      where: {},
      catchAll: "",
      programFolders: {},
      ignored: ["Old ignored"]
    });
    writeFileSync(path.join(target, ".flowcell-project.json"), markerText, "utf8");
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({ groups: [] }), "utf8");
    writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Current",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [{ path: "Current", groupIds: [], fileTypes: [], ignored: false, catchAll: false }],
      programFolders: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(profileId, dataRoot), "utf8");

    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a safe in-project folder.*previous marker was kept/i);
    assert.equal(existsSync(path.join(target, "Current")), false);
    assert.equal(readFileSync(path.join(target, "Old ignored"), "utf8"), "this is a file");
    assert.equal(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"), markerText);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("stale cleanup aborts before mutation when current nested ownership is unavailable", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-missing-nested-"));
  const target = path.join(workspace, "project");
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const profileId = "66666666-6666-4666-8666-666666666666";
  const missingNestedId = "77777777-7777-4777-8777-777777777777";
  const previousId = "88888888-8888-4888-8888-888888888888";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";
  try {
    mkdirSync(path.join(target, "Blender", "02 snapshots"), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(target, "Blender", "02 snapshots", "keep.blend"), "must survive", "utf8");
    const markerText = JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: previousId,
      profileName: "Previous",
      organizedAt: timestamp,
      where: {},
      catchAll: "",
      programFolders: {},
      ignored: ["Blender/02 snapshots"]
    });
    writeFileSync(path.join(target, ".flowcell-project.json"), markerText, "utf8");
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({
      groups: [{ groupId: "blender", label: "Blender", fileTypes: [".blend"], isProgram: true }]
    }), "utf8");
    writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Current",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [{ path: "Current", groupIds: [], fileTypes: [], ignored: false, catchAll: false }],
      programFolders: [{ groupId: "blender", createInRoot: true, profileId: missingNestedId }],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    const before = collectFiles(target);
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(profileId, dataRoot), "utf8");

    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /configured nested profile .* is missing/i);
    assert.deepEqual(collectFiles(target), before);
    assert.equal(existsSync(path.join(target, "Current")), false,
      "ownership resolution must fail before current folders are created");
    assert.equal(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"), markerText);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("a stale-folder recycle failure preserves the previous marker for retry", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "setup-org-recycle-failure-"));
  const target = path.join(workspace, "project");
  const dataRoot = path.join(workspace, "program-data");
  const profilesRoot = path.join(dataRoot, "profiles");
  const profileId = "99999999-9999-4999-8999-999999999999";
  const previousId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const timestamp = "2026-08-03T00:00:00.0000000+00:00";
  try {
    mkdirSync(path.join(target, "Old ignored"), { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(path.join(target, "Old ignored", "keep.txt"), "retry later", "utf8");
    const markerText = JSON.stringify({
      schemaVersion: 1,
      format: "flowcell.project.v1",
      profileId: previousId,
      profileName: "Previous",
      organizedAt: timestamp,
      where: {},
      catchAll: "",
      programFolders: {},
      ignored: ["Old ignored"]
    });
    writeFileSync(path.join(target, ".flowcell-project.json"), markerText, "utf8");
    writeFileSync(path.join(dataRoot, "file-groups.json"), JSON.stringify({ groups: [] }), "utf8");
    writeFileSync(path.join(profilesRoot, `${profileId}.json`), JSON.stringify({
      schemaVersion: 3,
      format: "flowcell.windows.setup-organization.profile.v3",
      profileId,
      name: "Current",
      recycleOtherFolders: true,
      recyclePreviousIgnoredFolders: true,
      folders: [{ path: "Current", groupIds: [], fileTypes: [], ignored: false, catchAll: false }],
      programFolders: [],
      createdAt: timestamp,
      updatedAt: timestamp
    }), "utf8");
    const rendered = path.join(workspace, "organize_folder.ps1");
    writeFileSync(rendered, renderOrganizerForTest(profileId, dataRoot, {
      failRecycleName: "Old ignored"
    }), "utf8");

    const result = runPowerShell(rendered, [target]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /previous project marker was kept so cleanup can retry/i);
    assert.ok(existsSync(path.join(target, "Old ignored", "keep.txt")));
    assert.equal(readFileSync(path.join(target, ".flowcell-project.json"), "utf8"), markerText);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("the staged Button manifest only uses fields the host accepts", () => {
  // src-tauri/.../installed_page.rs deserializes this with deny_unknown_fields;
  // any extra key fails the install with an opaque validation error.
  const allowed = ["schemaVersion", "id", "label", "tooltip", "program", "source"];
  const dispatcher = readFileSync(dispatcherPath, "utf8");
  const block = dispatcher.slice(
    dispatcher.indexOf("$manifest = [ordered]@{"),
    dispatcher.indexOf("$manifestPath = Join-Path $sourceRoot")
  );
  assert.ok(block.length > 0, "generated manifest block not found");
  const keys = [...block.matchAll(/^\s{12}([A-Za-z][A-Za-z0-9]*)\s*=/gm)].map((m) => m[1]);
  assert.ok(keys.length > 0, "no manifest keys parsed");
  for (const key of keys) {
    assert.ok(allowed.includes(key), `generated manifest key '${key}' is rejected by the host`);
  }
  assert.deepEqual(keys.slice().sort(), allowed.slice().sort());
  // The profile id therefore has to live in the script, not the manifest.
  assert.match(readFileSync(templatePath, "utf8"), /\$script:ProfileId = '\{\{PROFILE_ID\}\}'/);
  assert.ok(dispatcher.includes("$script:ProfileId"),
    "installed-Button detection must read the id back from the script");
});
