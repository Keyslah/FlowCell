import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(packageRoot, "flowcell.script.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const page = manifest.page;
const pageScript = readFileSync(path.join(packageRoot, "page", "page.js"), "utf8");
const pageHtml = readFileSync(path.join(packageRoot, "page", "index.html"), "utf8");
const pageCss = readFileSync(path.join(packageRoot, "page", "page.css"), "utf8");
const blenderSource = readFileSync(path.join(packageRoot, "theme.py"), "utf8");
const blenderProgramRoot = path.resolve(packageRoot, "..", "..", "..");
const sharedActionsSource = readFileSync(
  path.join(blenderProgramRoot, "Blender Addons - Copy contents Into Blender", "flowcell_actions.py"),
  "utf8"
);
const sharedBridgeSource = readFileSync(
  path.join(blenderProgramRoot, "Blender Addons - Copy contents Into Blender", "flowcell_bridge.py"),
  "utf8"
);
const removeButtonSource = readFileSync(
  path.join(blenderProgramRoot, "SupportScripts", "Remove-BlenderFlowCellButton.ps1"),
  "utf8"
);
const blenderProgramManifest = JSON.parse(
  readFileSync(path.join(blenderProgramRoot, "flowcell.program.json"), "utf8")
);

const actionById = new Map(page.actions.map((action) => [action.id, action]));
const fieldById = new Map(page.config.fields.map((field) => [field.id, field]));

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
}

function assertStrictRootSchema(schema, subject) {
  assert.equal(schema.type, "object", `${subject} must use an object root`);
  assert.equal(schema.additionalProperties, false, `${subject} must reject undeclared root properties`);
  assert.ok(schema.properties && typeof schema.properties === "object", `${subject} must declare properties`);
  for (const required of schema.required || []) {
    assert.ok(required in schema.properties, `${subject} requires undeclared property ${required}`);
  }
}

test("Theme is an ordinary page-enabled Blender script package", () => {
  assert.deepEqual(Object.keys(manifest), [
    "schemaVersion",
    "id",
    "label",
    "tooltip",
    "program",
    "source",
    "bridgeData",
    "page"
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "blender.theme");
  assert.equal(manifest.program, "Blender");
  assert.equal(manifest.source, "theme.py");
  assert.deepEqual(Object.keys(page), [
    "schemaVersion",
    "id",
    "program",
    "label",
    "tooltip",
    "entry",
    "scripts",
    "styles",
    "assets",
    "window",
    "actions",
    "capabilities",
    "ownerStateFormat",
    "sharedProgramDataNamespace",
    "supportedDataFormats",
    "refreshEvents",
    "config"
  ]);
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.id, "blender.theme");
  assert.equal(page.program, "Blender");
  assert.equal(page.ownerStateFormat, "flowcell.blender-theme-page-state.v1");
  assert.equal(page.sharedProgramDataNamespace, "blender-themes");
  assert.deepEqual(manifest.bridgeData.lifecycle, { enabled: true });
  assert.deepEqual(manifest.bridgeData.readOnlyCommands, [
    "status",
    "read_project_startup_state",
    "read_place_picture_runtime_state",
    "absorb_theme"
  ]);
});

test("Theme owns its Blender lifecycle and generic deletion owns its sidecar", () => {
  assert.match(blenderSource, /def register_flowcell_action_lifecycle\(\)/);
  assert.match(blenderSource, /def unregister_flowcell_action_lifecycle\(reason:/);
  assert.match(blenderSource, /\.flowcell-runtime/);
  assert.match(blenderSource, /_remove_viewport_overlay_handler\(\)/);
  assert.match(blenderSource, /_unregister_place_picture_modal_operator\(\)/);
  assert.match(blenderSource, /if reason == "removed" and/);
  assert.doesNotMatch(blenderSource, /import flowcell_actions/);
  assert.doesNotMatch(blenderSource, /import flowcell_bridge/);

  assert.match(sharedBridgeSource, /def sync_custom_action_lifecycles\(\)/);
  assert.match(sharedBridgeSource, /def cleanup_custom_action_lifecycles\(reason:/);
  assert.match(sharedBridgeSource, /removalRequested/);
  assert.match(sharedBridgeSource, /_write_custom_action_lifecycle_removal_ack/);
  assert.doesNotMatch(sharedBridgeSource, /PROJECT_THEME|project_theme|place_picture|Blender Theme/i);
  assert.doesNotMatch(sharedActionsSource, /PROJECT_THEME|project_theme|place_picture|Blender Theme/i);
  assert.match(sharedActionsSource, /get_custom_action_read_only_commands/);
  assert.match(removeButtonSource, /Test-FlowCellCustomActionLifecycleEnabled/);
  assert.match(removeButtonSource, /Request-FlowCellCustomActionLifecycleRemoval/);
  assert.match(removeButtonSource, /Blender did not acknowledge lifecycle cleanup/);
  assert.match(removeButtonSource, /\.flowcell-runtime/);
  assert.match(removeButtonSource, /Move-FlowCellDirectoryToRecycleBin/);
  const removalRequestCall = removeButtonSource.lastIndexOf("Request-FlowCellCustomActionLifecycleRemoval");
  const registryPrune = removeButtonSource.indexOf("$registry.actions = @($remainingRegistry.ToArray())");
  const runtimeRecycle = removeButtonSource.indexOf("Move-FlowCellFileToRecycleBin -Path $runtimePath");
  assert.ok(removalRequestCall > 0 && removalRequestCall < registryPrune);
  assert.ok(registryPrune > 0 && registryPrune < runtimeRecycle);
});

test("Theme is default-selected through the ordinary bundled script lifecycle", () => {
  const contribution = blenderProgramManifest.bundledSources.find(({ id }) => id === "blender.theme");
  assert.ok(contribution);
  assert.equal(contribution.version, "3.0.0");
  assert.equal(contribution.sourcePath, "Blender Git Scripts/Toolsets/theme");
  assert.equal(contribution.importKind, "script");
  assert.equal(contribution.installOnAdd, true);
  assert.equal("installIfMissing" in contribution, false);
  assert.equal(contribution.legacyMatchKind, "script");
  assert.equal(blenderProgramManifest.bundledSources.some(({ importKind }) => importKind === "tool-set"), false);
});

test("every declared page resource is package-contained and present", () => {
  const resources = [page.entry, ...page.scripts, ...page.styles, ...page.assets];
  assert.equal(new Set(resources.map((value) => value.toLowerCase())).size, resources.length);
  for (const resource of resources) {
    assert.equal(path.isAbsolute(resource), false, `${resource} must be relative`);
    assert.equal(resource.split(/[\\/]/).includes(".."), false, `${resource} must not traverse`);
    const resolved = path.resolve(packageRoot, resource);
    assert.ok(resolved.startsWith(`${packageRoot}${path.sep}`));
    assert.equal(statSync(resolved).isFile(), true, `${resource} must resolve to a file`);
  }
});

test("all page actions are unique, schema-bound, and capability-declared", () => {
  assert.equal(actionById.size, page.actions.length);
  const declaredCapabilities = new Set(page.capabilities);
  for (const action of page.actions) {
    assertStrictRootSchema(action.requestSchema, `${action.id} request`);
    assertStrictRootSchema(action.responseSchema, `${action.id} response`);
    if (action.handler.kind === "program" || action.handler.kind === "core") {
      assert.ok(declaredCapabilities.has(action.handler.capability), `${action.id} capability is undeclared`);
    }
    if (action.handler.kind === "program") {
      assert.equal(action.handler.capability, "blender-theme-page");
      assert.deepEqual(Object.keys(action.handler.payload), ["command", "action"]);
      assert.equal(action.handler.payload.action, action.handler.payload.command);
    }
  }
});

test("page configuration only dispatches declared actions", () => {
  const configuredActions = collectStrings(page.config.actions);
  for (const actionId of configuredActions) {
    assert.ok(actionById.has(actionId), `config action ${actionId} must be declared`);
  }
  for (const localActionId of Object.values(page.config.localActions)) {
    assert.equal(actionById.has(localActionId), false, `${localActionId} must remain page-local`);
    assert.equal(typeof page.config.actionLabels[localActionId], "string");
  }
  for (const valueField of page.config.environment.valueFields) {
    assert.ok(actionById.has(valueField.actionId));
    assert.equal(typeof page.config.actionLabels[valueField.actionId], "string");
  }
});

test("generic Core capability contracts are explicit and stable", () => {
  const expected = {
    "theme.image.select": ["file.select", [], ["path", "selected"]],
    "picture.file.select": ["file.select", [], ["path", "selected"]],
    "environment.file.select": ["file.select", [], ["path", "selected"]],
    "theme.image.sample": ["image.sample-palette", ["imagePath"], ["fieldPatch", "imagePath", "message", "paletteHexes", "selected"]],
    "theme.fields.save": ["tool-fields.save", ["values"], ["message", "saved", "savedPath"]],
    "theme.fields.load": ["tool-fields.load", [], ["fieldPatch", "message", "selected", "sourcePath"]],
    "theme.package.save": ["tool-package.save", ["values"], ["message", "packageName", "packagePath", "saved", "savedPath"]],
    "theme.package.open": ["tool-package.open", [], ["fieldPatch", "message", "packageName", "packagePath", "selected"]],
    "theme.package.previous": ["tool-package.cycle", ["activePackagePath"], ["fieldPatch", "message", "packageName", "packagePath", "selected"]],
    "theme.package.next": ["tool-package.cycle", ["activePackagePath"], ["fieldPatch", "message", "packageName", "packagePath", "selected"]]
  };
  for (const [actionId, [capability, requestKeys, responseKeys]] of Object.entries(expected)) {
    const action = actionById.get(actionId);
    assert.equal(action.handler.kind, "core");
    assert.equal(action.handler.capability, capability);
    assert.deepEqual(Object.keys(action.requestSchema.properties).sort(), requestKeys);
    assert.deepEqual(Object.keys(action.responseSchema.properties).sort(), responseKeys);
  }
  assert.equal(actionById.get("theme.package.previous").handler.options.direction, -1);
  assert.equal(actionById.get("theme.package.next").handler.options.direction, 1);
  assert.deepEqual(actionById.get("picture.file.select").handler.options.extensions, ["png", "jpg", "jpeg", "webp"]);
  assert.deepEqual(actionById.get("theme.image.select").handler.options.extensions, ["png", "jpg", "jpeg", "webp"]);
  assert.deepEqual(actionById.get("environment.file.select").handler.options.extensions, ["hdr", "exr"]);
  assert.match(
    pageScript,
    /browseTheme[\s\S]*requestAction\(\s*actions\.theme\.select[\s\S]*requestAction\(\s*actions\.theme\.sample/,
    "Browse must select a fresh image before sampling its palette"
  );
});

test("all existing Theme fields, buckets, and mappings are package-owned", () => {
  assert.equal(fieldById.size, page.config.fields.length);
  const expectedBuckets = [
    "tabs_hex",
    "headers_hex",
    "editor_background_hex",
    "scene_hex",
    "controls_hex",
    "tabs_text_hex",
    "header_text_hex",
    "text_hex",
    "control_text_hex",
    "accent_text_hex",
    "highlights_hex",
    "viewport_background_hex",
    "viewport_gradient_hex"
  ];
  assert.deepEqual(page.config.roles.map((role) => role.bucket), expectedBuckets);
  for (const role of page.config.roles) {
    assert.ok(fieldById.has(role.fieldId));
    assert.match(blenderSource, new RegExp(`['\"]${role.bucket}['\"]`));
  }
  const applyBucketSchema = actionById.get("theme.apply-bucket").requestSchema;
  assert.deepEqual(applyBucketSchema.properties.bucket.enum, expectedBuckets);
  for (const fieldId of Object.values(page.config.payloadMaps.theme)) {
    assert.ok(fieldById.has(fieldId), `theme payload maps unknown field ${fieldId}`);
  }
  for (const fieldId of page.config.persistence.fieldIds) assert.ok(fieldById.has(fieldId));
  for (const fieldId of page.config.persistence.packageFieldIds) assert.ok(fieldById.has(fieldId));
  for (const fieldId of page.config.persistence.assetFieldIds) assert.ok(fieldById.has(fieldId));
});

test("every program action resolves to an existing fixed theme.py command", () => {
  const expectedCommands = [
    "status",
    "absorb_theme",
    "apply_theme_from_photo_manual_colors",
    "apply_theme_bucket",
    "place_picture",
    "set_grid_spacing",
    "set_place_picture_startup",
    "clear_place_picture",
    "set_hdri_path",
    "clear_world",
    "reset_world",
    "set_rotation_x",
    "set_rotation_y",
    "set_rotation_z",
    "set_world_strength",
    "read_project_startup_state",
    "restore_project_startup_state",
    "read_place_picture_runtime_state"
  ];
  const declaredCommands = page.actions
    .filter((action) => action.handler.kind === "program")
    .map((action) => action.handler.payload.command);
  assert.deepEqual(declaredCommands, expectedCommands);
  assert.match(blenderSource, /def run_flowcell_action\(/);
  for (const command of expectedCommands) {
    assert.ok(blenderSource.includes(`"${command}"`), `theme.py must declare ${command}`);
  }
  for (const legacyCommand of [
    "read_startup_state",
    "restore_startup_state",
    "set_static_background_image",
    "apply_all"
  ]) {
    assert.equal(blenderSource.includes(`"${legacyCommand}"`), false);
  }
});

test("package page has no direct privileged or legacy Core UI path", () => {
  const pageFiles = `${pageHtml}\n${pageCss}\n${pageScript}`;
  const forbiddenApis = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /@tauri-apps/,
    /\binvoke\s*\(/,
    /\bwindow\.open\s*\(/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bimport\s*\(/,
    /\brequire\s*\(/
  ];
  for (const pattern of forbiddenApis) assert.doesNotMatch(pageFiles, pattern);
  assert.match(pageScript, /window\.flowcellPage/);
  assert.match(pageScript, /pageApi\.request\(/);
  assert.match(pageHtml, /default-src 'none'/);
  assert.match(pageHtml, /connect-src 'none'/);
  assert.doesNotMatch(pageHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);

  const newPackage = `${JSON.stringify(manifest)}\n${pageFiles}`;
  for (const legacyIdentifier of [
    "theme-workbench",
    "ThemeWorkbench",
    "open-tool-page",
    "sample-blender-theme-image",
    "open-blender-theme",
    "theme.legacy-profiles.read",
    "legacy-state.read",
    "theme-legacy-state",
    "legacyProfiles",
    "readLegacyProfiles",
    "completedMigrationIds"
  ]) {
    assert.equal(newPackage.includes(legacyIdentifier), false, `new package must not use ${legacyIdentifier}`);
  }
});

test("package page keeps every control scroll-accessible without a visible scrollbar", () => {
  assert.match(pageCss, /body\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(pageCss, /\.theme-page\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(pageCss, /scrollbar-width:\s*none;/);
  assert.match(pageCss, /\.theme-page::\-webkit-scrollbar\s*\{[\s\S]*display:\s*none;/);
});
