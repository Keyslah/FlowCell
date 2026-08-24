import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "flowcell.script.json"), "utf8"));
const page = manifest.page;
const pageHtml = readFileSync(path.join(packageRoot, "page", "index.html"), "utf8");
const pageCss = readFileSync(path.join(packageRoot, "page", "page.css"), "utf8");
const pageScript = readFileSync(path.join(packageRoot, "page", "page.js"), "utf8");
const blenderSourcePath = path.join(packageRoot, "save_blender.py");
const blenderSource = readFileSync(blenderSourcePath, "utf8");
const blenderRoot = path.resolve(packageRoot, "..", "..", "..");
const blenderManifest = JSON.parse(readFileSync(path.join(blenderRoot, "flowcell.program.json"), "utf8"));
const programsRoot = path.resolve(blenderRoot, "..");
const windowsManifest = JSON.parse(
  readFileSync(path.join(programsRoot, "Windows", "flowcell.program.json"), "utf8")
);
const setupManifest = JSON.parse(
  readFileSync(
    path.join(
      programsRoot,
      "Windows",
      "Windows Git Scripts",
      "Files",
      "Setup Organization",
      "flowcell.script.json"
    ),
    "utf8"
  )
);
const actionById = new Map(page.actions.map((action) => [action.id, action]));

function assertStrictObjectSchema(schema, label) {
  assert.equal(schema.type, "object", `${label} must use an object root`);
  assert.equal(schema.additionalProperties, false, `${label} must reject undeclared properties`);
  assert.ok(schema.properties && typeof schema.properties === "object");
  for (const required of schema.required || []) {
    assert.ok(required in schema.properties, `${label} requires undeclared property ${required}`);
  }
}

test("Save Blender is a Files-panel Blender installed-page package", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "blender.save-blender");
  assert.equal(manifest.program, "Blender");
  assert.equal(manifest.source, "save_blender.py");
  assert.deepEqual(manifest.bridgeData.readOnlyCommands, ["status"]);
  assert.deepEqual(manifest.bridgeData.capabilities, ["blender-save-page"]);

  assert.equal(page.id, manifest.id);
  assert.equal(page.program, "Blender");
  assert.equal(page.ownerStateFormat, "flowcell.blender-save-page-state.v1");
  assert.deepEqual(page.supportedDataFormats, ["flowcell.organization-profile.v3"]);
  assert.equal(page.window.alwaysOnTop, true);

  const contribution = blenderManifest.bundledSources.find(({ id }) => id === manifest.id);
  assert.ok(contribution, "Blender must register the Save Blender package");
  assert.equal(contribution.panelName, "Files");
  assert.equal(contribution.sourcePath, "Blender Git Scripts/Files/Save Blender");
  assert.equal(contribution.importKind, "script");
  assert.equal(contribution.sourceKind, "page");
  assert.equal(contribution.installOnAdd, true);
  assert.equal(contribution.version, "1.2.3");
});

test("every page resource is package-contained and present", () => {
  const resources = [page.entry, ...page.scripts, ...page.styles, ...page.assets];
  assert.equal(new Set(resources.map((resource) => resource.toLowerCase())).size, resources.length);
  for (const resource of resources) {
    assert.equal(path.isAbsolute(resource), false);
    assert.equal(resource.split(/[\\/]/).includes(".."), false);
    const resolved = path.resolve(packageRoot, resource);
    assert.ok(resolved.startsWith(`${packageRoot}${path.sep}`));
    assert.equal(statSync(resolved).isFile(), true, `${resource} must exist`);
  }
});

test("every action has strict request and response schemas", () => {
  assert.equal(actionById.size, page.actions.length);
  for (const action of page.actions) {
    assertStrictObjectSchema(action.requestSchema, `${action.id} request`);
    assertStrictObjectSchema(action.responseSchema, `${action.id} response`);
  }
  assert.deepEqual(
    new Set(page.capabilities),
    new Set([
      "blender-save-page",
      "folder.select",
      "windows.setup-organization.list-profiles",
      "windows.setup-organization.prepare-existing-target",
      "windows.setup-organization.prepare-target"
    ])
  );
});

test("Setup Organization prepare-target is an explicit provider action contract", () => {
  const action = actionById.get("project.prepare-target");
  assert.deepEqual(action.handler, {
    kind: "provider",
    capability: "windows.setup-organization.prepare-target",
    program: "Windows",
    bundledSourceId: "windows.setup-organization",
    pageId: "windows.setup-organization",
    actionId: "prepare-target",
    payload: {
      plannedExtension: ".blend"
    }
  });
  assert.deepEqual(Object.keys(action.requestSchema.properties).sort(), [
    "profileId",
    "projectRoot"
  ]);
  assert.deepEqual(action.requestSchema.required, ["projectRoot", "profileId"]);
  assert.deepEqual(Object.keys(action.responseSchema.properties).sort(), [
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
  assert.deepEqual(action.responseSchema.required, [
    "prepared",
    "projectRoot",
    "profileId",
    "profileName",
    "profilePath",
    "plannedExtension",
    "markerPath",
    "destinationRelativePath",
    "destinationDirectory"
  ]);
  assert.deepEqual(action.responseSchema.properties.prepared.enum, [true]);
  assert.deepEqual(action.responseSchema.properties.plannedExtension.enum, [".blend"]);
});

test("existing-project preparation is a separate minimal provider contract", () => {
  const action = actionById.get("project.prepare-existing-target");
  assert.deepEqual(action.handler, {
    kind: "provider",
    capability: "windows.setup-organization.prepare-existing-target",
    program: "Windows",
    bundledSourceId: "windows.setup-organization",
    pageId: "windows.setup-organization",
    actionId: "prepare-existing-target",
    payload: {
      plannedExtension: ".blend"
    }
  });
  assert.deepEqual(action.requestSchema.required, ["projectRoot"]);
  assert.deepEqual(Object.keys(action.requestSchema.properties), ["projectRoot"]);
  assert.deepEqual(action.responseSchema.required, [
    "prepared",
    "projectRoot",
    "profileId",
    "profileName",
    "profilePath",
    "plannedExtension",
    "markerPath",
    "destinationRelativePath",
    "destinationDirectory"
  ]);
});

test("Setup Organization profile names come from an explicit provider action", () => {
  const action = actionById.get("profile.list");
  assert.deepEqual(action.handler, {
    kind: "provider",
    capability: "windows.setup-organization.list-profiles",
    program: "Windows",
    bundledSourceId: "windows.setup-organization",
    pageId: "windows.setup-organization",
    actionId: "list-profiles",
    payload: {}
  });
  assert.deepEqual(action.requestSchema, {
    type: "object",
    additionalProperties: false,
    properties: {}
  });
  assert.deepEqual(action.responseSchema.required, ["profiles"]);
  assert.deepEqual(action.responseSchema.properties.profiles.items.required, [
    "profileId", "name", "updatedAt", "folderCount", "assignedCount"
  ]);
});

test("provider identity and schemas match the installed Setup Organization package", () => {
  const consumer = actionById.get("project.prepare-target");
  const providerContribution = windowsManifest.bundledSources.find(
    ({ id }) => id === consumer.handler.bundledSourceId
  );
  assert.ok(providerContribution);
  assert.equal(providerContribution.sourceKind, "page");

  assert.equal(setupManifest.page.id, consumer.handler.pageId);
  const provider = setupManifest.page.actions.find(({ id }) => id === consumer.handler.actionId);
  assert.ok(provider);
  assert.equal(provider.providerCapability, "windows.setup-organization.prepare-target");
  assert.equal(provider.handler.kind, "program");

  const mergedRequestKeys = [
    ...Object.keys(consumer.requestSchema.properties),
    ...Object.keys(consumer.handler.payload)
  ].sort();
  assert.deepEqual(mergedRequestKeys, ["plannedExtension", "profileId", "projectRoot"]);
  assert.ok(mergedRequestKeys.every((key) => key in provider.requestSchema.properties));
  assert.ok(provider.requestSchema.required.every((key) => mergedRequestKeys.includes(key)));
  assert.deepEqual(
    Object.keys(consumer.responseSchema.properties).sort(),
    Object.keys(provider.responseSchema.properties).sort()
  );
  assert.deepEqual(
    [...consumer.responseSchema.required].sort(),
    [...provider.responseSchema.required].sort()
  );

  const listConsumer = actionById.get("profile.list");
  const listProvider = setupManifest.page.actions.find(({ id }) => id === listConsumer.handler.actionId);
  assert.ok(listProvider);
  assert.equal(listProvider.providerCapability, "windows.setup-organization.list-profiles");
  assert.deepEqual(listConsumer.responseSchema, listProvider.responseSchema);

  const existingConsumer = actionById.get("project.prepare-existing-target");
  const existingProvider = setupManifest.page.actions.find(
    ({ id }) => id === existingConsumer.handler.actionId
  );
  assert.ok(existingProvider);
  assert.equal(
    existingProvider.providerCapability,
    "windows.setup-organization.prepare-existing-target"
  );
  assert.equal(existingProvider.handler.kind, "program");
  assert.deepEqual(
    [
      ...Object.keys(existingConsumer.requestSchema.properties),
      ...Object.keys(existingConsumer.handler.payload)
    ].sort(),
    ["plannedExtension", "projectRoot"]
  );
  assert.deepEqual(existingConsumer.responseSchema, existingProvider.responseSchema);
});

test("page implements saved, first-use, configured, and Change Settings modes", () => {
  assert.match(pageScript, /status\.saved === true[\s\S]*actions\.saveCurrent/);
  assert.match(pageScript, /settingsExpanded = !settings\.baseFolder/);
  assert.match(pageScript, /settingsPanel\.hidden = configured && !settingsExpanded/);
  assert.match(pageScript, /changeSettingsButton\.hidden = !configured \|\| settingsExpanded/);
  assert.match(pageScript, /changeSettingsButton\.addEventListener\("click"/);
  assert.match(pageHtml, /id="project-name"/);
  assert.match(pageHtml, /id="save-project"/);
  assert.match(pageHtml, /id="change-settings"/);
  assert.match(pageHtml, /<select id="profile-select">/);
  assert.doesNotMatch(pageHtml, /id="(?:profile-path|browse-profile|clear-profile)"/);
});

test("untitled files can be named and added to one existing project folder", () => {
  assert.match(pageHtml, /value="new"[\s\S]*Create new project/);
  assert.match(pageHtml, /value="existing"[\s\S]*Add to existing project/);
  assert.match(pageHtml, /id="existing-project-folder"/);
  assert.match(pageHtml, /id="browse-existing-project"/);
  assert.match(pageScript, /projectNameLabel\.textContent = addingToExistingProject \? "Blender file name"/);

  const prepare = pageScript.indexOf("pageApi.request(actions.prepareExistingTarget");
  const returnedDestination = pageScript.indexOf("prepared.destinationDirectory.trim()", prepare);
  const save = pageScript.indexOf("pageApi.request(actions.saveExistingTarget", returnedDestination);
  assert.ok(prepare > 0 && prepare < returnedDestination && returnedDestination < save);
  assert.match(pageScript, /fileName,\s*projectRoot: returnedRoot,\s*finalPath/);
});

test("page removes spaces and unsafe Windows filename characters before saving", () => {
  assert.match(pageScript, /function sanitizeProjectName\(value\)/);
  assert.ok(pageScript.includes('.replace(/\\s+/gu, "")'));
  assert.ok(pageScript.includes('.replace(/[<>:"/\\\\|?*]|[\\u0000-\\u001f]/g, "")'));
  assert.match(
    pageScript,
    /projectName = sanitizeProjectName\(projectNameInput\.value\);\s*projectNameInput\.value = projectName;/
  );
  assert.match(
    pageScript,
    /fileName = sanitizeProjectName\(projectNameInput\.value\);\s*projectNameInput\.value = fileName;/
  );
});

test("page persists only reusable destination settings and clears the project name", () => {
  assert.match(
    pageScript,
    /state:\s*\{\s*schemaVersion:\s*1,\s*baseFolder:\s*settings\.baseFolder,\s*profileId:\s*settings\.profileId\s*\}/
  );
  assert.match(pageScript, /legacyProfilePath[\s\S]*legacyProfileMatch/);
  assert.doesNotMatch(pageScript, /state:\s*\{[^}]*projectName/s);
  assert.doesNotMatch(pageScript, /state:\s*\{[^}]*(?:saveMode|existingProjectRoot)/s);
  assert.match(pageScript, /projectNameInput\.value = ""/);
});

test("profile preparation happens before Blender saves the returned target", () => {
  const profileGuard = pageScript.indexOf("if (settings.profileId)");
  const computedRoot = pageScript.indexOf("const requestedProjectRoot = joinWindowsPath", profileGuard);
  const createRootRequest = pageScript.indexOf("pageApi.request(actions.createRoot", computedRoot);
  const prepareRequest = pageScript.indexOf("pageApi.request(actions.prepareTarget", createRootRequest);
  const returnedPath = pageScript.indexOf("prepared.destinationDirectory.trim()", prepareRequest);
  const saveRequest = pageScript.indexOf("pageApi.request(actions.saveTarget", returnedPath);
  assert.ok(profileGuard > 0 && profileGuard < computedRoot);
  assert.ok(computedRoot < createRootRequest && createRootRequest < prepareRequest);
  assert.ok(prepareRequest < returnedPath && returnedPath < saveRequest);
  assert.match(pageScript, /projectRoot,\s*profileId:\s*settings\.profileId/);
  assert.match(pageScript, /finalPath = joinWindowsPath\(prepared\.destinationDirectory\.trim\(\), `\$\{projectName\}\.blend`\)/);
  assert.match(pageScript, /preparedByProfile,\s*projectRoot,\s*finalPath/);
});

test("profile-backed retries reuse the prepared target and normalize Windows separators", () => {
  assert.match(pageScript, /function comparableWindowsPath\(value\)/);
  assert.match(
    pageScript,
    /comparableWindowsPath\(projectRoot\) !== comparableWindowsPath\(requestedProjectRoot\)/
  );
  assert.match(pageScript, /if \(canReusePreparedAttempt\(projectName\)\)/);
  assert.match(pageScript, /preparedAttempt = \{\s*projectName,\s*parentFolder: settings\.baseFolder,/s);
  assert.match(pageScript, /projectNameInput\.value = "";\s*preparedAttempt = null;/s);
});

test("without a profile the Blender action owns the direct base/name/Blender/name.blend path", () => {
  assert.match(blenderSource, /project_root = parent_folder \/ project_name/);
  assert.match(blenderSource, /blender_folder = project_root \/ "Blender"/);
  assert.match(blenderSource, /final_path = blender_folder \/ f"\{project_name\}\.blend"/);
  assert.match(pageScript, /let preparedByProfile = false;\s*let projectRoot = "";\s*let finalPath = "";/);
  assert.match(blenderSource, /Direct saves cannot supply a precomputed project or Blender path/);
});

test("Blender source sanitizes names and refuses empty names, nonempty targets, reparse paths, and overwrite", () => {
  assert.match(blenderSource, /INVALID_WINDOWS_NAME_CHARS/);
  assert.match(blenderSource, /WINDOWS_RESERVED_NAMES/);
  assert.match(blenderSource, /def _sanitize_project_name/);
  assert.match(blenderSource, /Project folder already exists and is not empty/);
  assert.match(blenderSource, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.match(blenderSource, /_assert_no_reparse_between/);
  assert.match(blenderSource, /_validate_existing_project_target/);
  assert.match(blenderSource, /save-existing-target/);
  assert.match(blenderSource, /save-prepared-existing-target/);
  assert.match(blenderSource, /destination \/ f"\{file_name\}\.blend"/);
  assert.match(blenderSource, /Refusing to overwrite an existing Blender file/);
  assert.match(blenderSource, /bpy\.ops\.wm\.save_as_mainfile/);
  assert.doesNotMatch(blenderSource, /setup_organization|subprocess|powershell/i);
});

test("Blender source compiles and its path policy works against a fake bpy host", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "flowcell-save-blender-test-"));
  try {
    const harness = String.raw`
import pathlib
import sys
import types

source_path = pathlib.Path(sys.argv[1])
temp_root = pathlib.Path(sys.argv[2])

class SaveOperator:
    def __init__(self):
        self.paths = []
    def __call__(self, **kwargs):
        assert pathlib.Path(kwargs["filepath"]).parent.is_dir()
        self.paths.append(kwargs["filepath"])
        return {"FINISHED"}

save_operator = SaveOperator()
bpy = types.SimpleNamespace(
    data=types.SimpleNamespace(filepath=""),
    ops=types.SimpleNamespace(wm=types.SimpleNamespace(save_as_mainfile=save_operator)),
)
sys.modules["bpy"] = bpy
namespace = {}
exec(compile(source_path.read_text(encoding="utf-8"), str(source_path), "exec"), namespace)

parent = temp_root / "projects"
parent.mkdir()
result = namespace["_save_target"]({
    "projectName": " Direct / Project? ",
    "parentFolder": str(parent),
    "preparedByProfile": False,
    "projectRoot": "",
    "finalPath": "",
})
expected = parent / "DirectProject" / "Blender" / "DirectProject.blend"
assert pathlib.Path(result["finalPath"]) == expected
assert save_operator.paths[-1] == str(expected)
assert expected.parent.is_dir()

bpy.data.filepath = ""
prepared = namespace["_prepare_root"]({
    "projectName": " Profile Project ",
    "parentFolder": str(parent),
})
prepared_root = pathlib.Path(prepared["projectRoot"])
assert prepared_root == parent / "ProfileProject"
assert prepared_root.is_dir()
assert list(prepared_root.iterdir()) == []

bpy.data.filepath = ""
nonempty = parent / "Taken"
nonempty.mkdir()
(nonempty / "keep.txt").write_text("keep", encoding="utf-8")
try:
    namespace["_save_target"]({
        "projectName": "Taken",
        "parentFolder": str(parent),
        "preparedByProfile": False,
        "projectRoot": "",
        "finalPath": "",
    })
except ValueError as exc:
    assert "not empty" in str(exc)
else:
    raise AssertionError("nonempty project was accepted")

prepared_root = parent / "Organized"
prepared_folder = prepared_root / "Blender"
prepared_folder.mkdir(parents=True)
prepared_file = prepared_folder / "Organized.blend"
result = namespace["_save_target"]({
    "projectName": "Organized",
    "parentFolder": str(parent),
    "preparedByProfile": True,
    "projectRoot": str(prepared_root),
    "finalPath": str(prepared_file),
})
assert pathlib.Path(result["finalPath"]) == prepared_file

bpy.data.filepath = ""
existing_root = parent / "Existing Illustrator Project"
existing_destination = existing_root / "Blender"
existing_destination.mkdir(parents=True)
illustrator_file = existing_root / "Illustrator" / "existing.ai"
illustrator_file.parent.mkdir()
illustrator_file.write_bytes(b"illustrator-sentinel")
existing_file = existing_destination / "NamedBlenderWork.blend"
result = namespace["_save_existing_target"]({
    "fileName": " Named: Blender Work? ",
    "projectRoot": str(existing_root),
    "finalPath": str(existing_file),
})
assert pathlib.Path(result["finalPath"]) == existing_file
assert save_operator.paths[-1] == str(existing_file)
assert illustrator_file.read_bytes() == b"illustrator-sentinel"

bpy.data.filepath = ""
prepared_existing_result = namespace["run_flowcell_action"](data={
    "command": "save-prepared-existing-target",
    "fileName": " Illustrator: Art? ",
    "projectRoot": str(existing_root),
    "destinationDirectory": str(existing_destination),
})
prepared_existing_file = existing_destination / "IllustratorArt.blend"
assert pathlib.Path(prepared_existing_result["finalPath"]) == prepared_existing_file
assert save_operator.paths[-1] == str(prepared_existing_file)

prepared_existing_file.write_bytes(b"prepared-existing-sentinel")
bpy.data.filepath = ""
try:
    namespace["run_flowcell_action"](data={
        "command": "save-prepared-existing-target",
        "fileName": " Illustrator: Art? ",
        "projectRoot": str(existing_root),
        "destinationDirectory": str(existing_destination),
    })
except ValueError as exc:
    assert "Refusing to overwrite" in str(exc)
else:
    raise AssertionError("prepared existing-project Blender file was overwritten")
assert prepared_existing_file.read_bytes() == b"prepared-existing-sentinel"

bpy.data.filepath = ""
try:
    namespace["run_flowcell_action"](data={
        "command": "save-prepared-existing-target",
        "fileName": "Outside",
        "projectRoot": str(existing_root),
        "destinationDirectory": str(parent),
    })
except ValueError as exc:
    assert "outside the selected project folder" in str(exc)
else:
    raise AssertionError("outside prepared destination was accepted")

existing_file.write_bytes(b"existing-blender-sentinel")
bpy.data.filepath = ""
try:
    namespace["_save_existing_target"]({
        "fileName": " Named: Blender Work? ",
        "projectRoot": str(existing_root),
        "finalPath": str(existing_file),
    })
except ValueError as exc:
    assert "Refusing to overwrite" in str(exc)
else:
    raise AssertionError("existing Blender file was overwritten")
assert existing_file.read_bytes() == b"existing-blender-sentinel"

bpy.data.filepath = ""
try:
    namespace["_save_existing_target"]({
        "fileName": "Outside",
        "projectRoot": str(existing_root),
        "finalPath": str(parent / "Outside.blend"),
    })
except ValueError as exc:
    assert "outside the selected project folder" in str(exc)
else:
    raise AssertionError("outside existing-project target was accepted")

assert namespace["_sanitize_project_name"](" Water: Project? ") == "WaterProject"
assert namespace["_sanitize_project_name"]("bad.") == "bad"
assert namespace["_sanitize_project_name"]("CON") == "_CON"
assert namespace["_sanitize_project_name"]("A B\tC") == "ABC"

for invalid_name in ("", " \t ", "<>:?/|*"):
    try:
        namespace["_sanitize_project_name"](invalid_name)
    except ValueError:
        pass
    else:
        raise AssertionError(f"empty sanitized project name was accepted: {invalid_name!r}")
`;
    const result = spawnSync("python", ["-c", harness, blenderSourcePath, tempRoot], {
      encoding: "utf8",
      windowsHide: true
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("page is CSP-bound and cannot reach privileged APIs directly", () => {
  const pageFiles = `${pageHtml}\n${pageCss}\n${pageScript}`;
  assert.match(pageHtml, /default-src 'none'/);
  assert.match(pageHtml, /connect-src 'none'/);
  assert.match(pageScript, /window\.flowcellPage/);
  for (const forbidden of [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /@tauri-apps/,
    /\binvoke\s*\(/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bwindow\.open\s*\(/
  ]) {
    assert.doesNotMatch(pageFiles, forbidden);
  }
});
