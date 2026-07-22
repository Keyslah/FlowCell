import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const frontendRoot = join(import.meta.dirname, "..");
const repoRoot = join(frontendRoot, "..");

function read(...parts) {
  return readFileSync(join(...parts), "utf8");
}

test("Main exposes one Add Button action and keeps the serialized action ID", () => {
  const layout = read(frontendRoot, "src", "pages", "main", "mainLayout.ts");
  assert.match(layout, /label:\s*"Add Button"/);
  assert.match(layout, /actionId:\s*"add-panel-script"/);
  for (const forbidden of ["Add Script", "Add Package", "Add Tool Set", "Add Page"]) {
    assert.doesNotMatch(layout, new RegExp(`label:\\s*"${forbidden}"`));
  }
});

test("managed Add Program and Add Panel windows receive the default Tauri capability", () => {
  const capability = JSON.parse(
    read(frontendRoot, "src-tauri", "capabilities", "default.json")
  );
  assert.ok(capability.windows.includes("flowcell-add-program"));
  assert.ok(capability.windows.includes("flowcell-add-panel"));
});

test("Add Button fixes its destination and delegates exact content detection to native auto import", () => {
  const main = read(frontendRoot, "src", "pages", "main", "MainPage.tsx");
  const editor = read(frontendRoot, "src", "button", "editor", "ButtonEditorPage.tsx");
  assert.match(main, /lockImportDestination:\s*true/);
  assert.match(editor, /importKind:\s*"auto"/);
  assert.match(editor, /lockedImportDestination\?\.programName\s*\?\?\s*programName/);
  assert.match(editor, /installed!\.children\.length\s*===\s*0/);
  assert.match(
    editor,
    /initialContext\?\.lockImportDestination[\s\S]{0,180}\?\s*1\s*:\s*0/
  );
  assert.match(editor, /setAutoImportRequest\(\(current\)\s*=>\s*current\s*\+\s*1\)/);
  assert.match(
    editor,
    /handledAutoImportRequestRef\.current\s*=\s*autoImportRequest;\s*void importSource\(\);/
  );
});

test("installed pages use a raw WRY boundary without Tauri initialization scripts", () => {
  const host = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "InstalledPageWindowPage.tsx"
  );
  const nativeWebview = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page_webview.rs"
  );
  const coreWindows = read(frontendRoot, "src", "lib", "coreWindows.ts");
  assert.doesNotMatch(host, /<iframe|srcDoc=|sandbox="allow-scripts"/);
  assert.match(host, /mount_installed_page_webview/);
  assert.match(host, /flowcell-installed-page-native-message/);
  assert.match(host, /hasTauriInternals/);
  assert.match(host, /hasTauriInvoke/);
  assert.match(host, /href:\s*window\.location\.href/);
  assert.match(host, /hasFlowcellPage/);
  assert.match(host, /hasRawWryIpc/);
  assert.match(host, /default-world proof was not received/);
  assert.doesNotMatch(host, /probe_installed_page_webview_security/);
  assert.match(nativeWebview, /WebViewBuilder::new\(\)/);
  assert.match(nativeWebview, /build_as_child/);
  assert.match(nativeWebview, /security_probe_passed/);
  assert.match(nativeWebview, /compare_exchange\([\s\S]*ISOLATION_PENDING/);
  assert.doesNotMatch(nativeWebview, /evaluate_script_with_callback|recv_timeout/);
  assert.match(nativeWebview, /with_navigation_handler/);
  assert.match(nativeWebview, /with_download_started_handler\(\|_, _\| false\)/);
  assert.match(nativeWebview, /with_new_window_req_handler\(\|_, _\| NewWindowResponse::Deny\)/);
  assert.doesNotMatch(nativeWebview, /WindowEvent::Destroyed/);
  assert.doesNotMatch(nativeWebview, /initialization_script/);
  assert.match(
    host,
    /onCloseRequested[\s\S]*preventDefault\(\)[\s\S]*unmount_installed_page_webview[\s\S]*currentWindow\.destroy\(\)/
  );
  assert.match(
    host,
    /await currentWindow\.onCloseRequested[\s\S]*await invoke\("mount_installed_page_webview"/
  );
  assert.match(
    coreWindows,
    /existing\.once\("tauri:\/\/destroyed"[\s\S]*existing\.close\(\)[\s\S]*await destroyed/
  );
  assert.match(
    coreWindows,
    /openInstalledPageWindow[\s\S]*decorations:\s*true,[\s\S]*programName:\s*args\.programName/,
    "every installed page must use standard draggable window chrome"
  );
  for (const directive of [
    "default-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'"
  ]) {
    assert.ok(host.includes(directive), `host is missing CSP directive ${directive}`);
    assert.ok(nativeWebview.includes(directive), `native webview is missing CSP directive ${directive}`);
  }
  assert.match(host, /run_installed_page_action/);
  assert.match(host, /complete_installed_page_core_action/);
  assert.match(host, /sanitizeEntryHtml/);
});

test("installed-page styles stay scoped away from transparent Pop and Fan roots", () => {
  const styles = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageWindowPage.css"
  );
  assert.match(styles, /\.installed-page-host\s*\{/);
  assert.doesNotMatch(styles, /(^|,)\s*(?::root|html|body|#root)\s*(?:,|\{)/m);
});

test("Illustrator page bridge reacquires stale COM once without replaying script errors", () => {
  const bridge = read(
    repoRoot,
    "Programs",
    "Illustrator",
    "SupportScripts",
    "Start-IllustratorFlowCellBridge.ps1"
  );
  assert.match(bridge, /Test-IsStaleIllustratorComError/);
  assert.match(bridge, /0x800706BA\|RPC server is unavailable/);
  assert.match(bridge, /for \(\$attempt = 0; \$attempt -lt 2; \$attempt \+= 1\)/);
  assert.match(bridge, /\$script:IllustratorApp = \$null/);
  assert.match(bridge, /-not \(Test-IsStaleIllustratorComError -Exception \$_\.Exception\)/);
});

test("all Tauri-owned Illustrator actions share the native persistent bridge", () => {
  const execution = read(
    frontendRoot,
    "src-tauri",
    "src",
    "commands",
    "execution.rs"
  );
  const bridge = read(
    repoRoot,
    "Programs",
    "Illustrator",
    "SupportScripts",
    "Start-IllustratorFlowCellBridge.ps1"
  );
  const programExecution = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "execute.rs"
  );
  assert.ok(execution.includes(String.raw`\\.\pipe\FlowCell.Illustrator.Bridge.v2`));
  assert.match(execution, /ILLUSTRATOR_BRIDGE_PROTOCOL_VERSION: u64 = 2/);
  assert.match(execution, /Illustrator bridge protocol mismatch/);
  assert.match(execution, /run_illustrator_bridge_action_direct/);
  assert.match(execution, /"-NoPrewarm"/);
  assert.match(execution, /start_illustrator_bridge_prewarm_worker/);
  assert.match(execution, /find_running_illustrator_process_id/);
  assert.match(execution, /ILLUSTRATOR_BRIDGE_PREWARM_IN_PROGRESS/);
  assert.match(execution, /IllustratorBridgeSendFailure::Busy/);
  assert.match(execution, /process_id_is_alive\(warmed_bridge_process_id\)/);
  assert.doesNotMatch(execution, /illustrator_bridge_pid_is_alive/);
  assert.match(execution, /"command": "prewarm"/);
  assert.match(bridge, /FlowCell\.Illustrator\.Bridge\.v2/);
  assert.match(bridge, /BridgeProtocolVersion = 2/);
  assert.match(bridge, /protocolVersion/);
  assert.match(bridge, /Get-IllustratorApplication -ExistingOnly/);
  assert.match(bridge, /if \(\$ExistingOnly\) \{\s*throw\s*\}/);
  assert.match(bridge, /Another Illustrator bridge process already owns pipe/);
  assert.match(bridge, /Global\\FlowCell\.Illustrator\.Bridge\.Process/);
  assert.doesNotMatch(execution, /run_illustrator_backend_script_direct|FLOWCELL_DIRECT_SCRIPT/);
  assert.match(execution, /pub\(crate\) async fn run_panel_script_response\(/);
  assert.match(execution, /Panel script task failed/);
  assert.match(programExecution, /execution\.get\("waitForCompletion"\)/);
  assert.equal(
    programExecution.match(/run_illustrator_bridge_action_direct/g)?.length,
    3,
    "single scripts, tool sets, and page capabilities must use the same bridge"
  );
});

test("scoped-window IPC cannot block the main thread during installed-page WebView focus", () => {
  const windows = read(
    frontendRoot,
    "src-tauri",
    "src",
    "commands",
    "windows.rs"
  );
  for (const command of [
    "register_scoped_window_topmost",
    "unregister_scoped_window_topmost",
    "get_scoped_window_input_state",
    "refresh_scoped_window_topmost"
  ]) {
    assert.match(
      windows,
      new RegExp(`pub\\(crate\\) async fn ${command}\\(`),
      `${command} must execute off the main thread while sharing the worker apply lock`
    );
  }
  assert.match(
    windows,
    /last_external_matches_target\s*\|\|\s*!entry\.selective_input/,
    "full installed pages must remain an interactive scoped-window continuation"
  );
  assert.match(
    windows,
    /if\s+!entry\.selective_input\s*\{\s*window\.set_ignore_cursor_events\(false\)/,
    "full installed pages must never inherit transparent-host click-through"
  );
});

test("Blender Theme and Illustrator Layer Tree are ordinary program-owned page sources", () => {
  const cases = [
    ["Blender", "Blender Git Scripts", "Toolsets", "theme", "flowcell.script.json"],
    ["Illustrator", "Illustrator Git Scripts", "LayersBuilder", "flowcell.script.json"]
  ];
  for (const parts of cases) {
    const manifest = JSON.parse(read(repoRoot, "Programs", ...parts));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.program, parts[0]);
    assert.ok(manifest.page);
    assert.equal(manifest.page.program, parts[0]);
    assert.equal(manifest.page.schemaVersion, 1);
    assert.ok(manifest.page.entry.startsWith("page/"));
    assert.ok(Array.isArray(manifest.page.actions) && manifest.page.actions.length > 0);
    const serialized = JSON.stringify(manifest);
    assert.doesNotMatch(serialized, /theme-workbench|tree-inspector|open-tool-page/);
  }
});

test("Core contains no retired product page routes, actions, modules, or fallbacks", () => {
  const retiredPaths = [
    ["src", "button", "toolPages"],
    ["src", "pages", "build-layers"],
    ["src", "pages", "organization-setup"],
    ["src", "features", "organization"],
    ["src", "button", "runtime", "registerInstalledCompatibilityActions.ts"],
    ["src", "button", "runtime", "registerLegacyProgramCoreActions.ts"],
    ["src", "button", "state", "organizationProfileButtonOperations.ts"],
    ["src", "button", "state", "toolPageLifecycle.ts"],
    ["src", "lib", "illustratorLayers.ts"],
    ["src-tauri", "src", "commands", "illustrator.rs"],
    ["src-tauri", "src", "commands", "organization.rs"],
    ["src-tauri", "src", "commands", "themes.rs"],
    ["src-tauri", "src", "commands", "tool_state.rs"]
  ];
  for (const parts of retiredPaths) {
    assert.equal(existsSync(join(frontendRoot, ...parts)), false, parts.join("/"));
  }

  const runtimeFiles = [
    ["src", "AppBase.tsx"],
    ["src", "lib", "coreWindows.ts"],
    ["src", "lib", "windowContext.ts"],
    ["src", "pages", "main", "MainPage.tsx"],
    ["src", "button", "popout", "ButtonPopoutRenderer.tsx"],
    ["src", "pages", "window-grid", "WindowGridWindowPage.tsx"],
    ["src", "button", "runtime", "registerBuiltinCoreActions.ts"],
    ["src-tauri", "capabilities", "default.json"],
    ["src-tauri", "src", "main.rs"],
    ["src-tauri", "src", "commands", "mod.rs"],
    ["src-tauri", "src", "program_sources", "install.rs"],
    ["src-tauri", "src", "program_sources", "installed_page.rs"]
  ];
  const forbidden = /organization-setup|build-layers|flowcell-tool-page|open-tool-page|open-illustrator-layer-tree|illustrator-layer-tree|theme-workbench|sample-blender-theme|save-blender-theme|load-blender-theme|legacy-state\.read/i;
  for (const parts of runtimeFiles) {
    const raw = read(frontendRoot, ...parts);
    const runtimeOnly = parts.at(-1)?.endsWith(".rs")
      ? raw.split("#[cfg(test)]", 1)[0]
      : raw;
    assert.doesNotMatch(runtimeOnly, forbidden, parts.join("/"));
  }
});

test("generated Button staging is token-bound, hash-verified, and product-neutral in Core", () => {
  const broker = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageCoreBroker.ts"
  );
  const native = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page.rs"
  );
  assert.match(broker, /const stageToken = stringValue\(payload, "stageToken"\)/);
  assert.match(broker, /invoke<AuthorizedGeneratedStage>[\s\S]*stageToken,[\s\S]*stagedSourcePath/);
  assert.match(broker, /sourcePath:\s*authorizedStage\.manifestPath/);
  assert.match(
    broker,
    /discard_installed_page_generated_stage[\s\S]*stageToken,[\s\S]*authorizedStage\.manifestPath/
  );
  assert.match(native, /struct GeneratedStageManifest/);
  assert.match(native, /deny_unknown_fields/);
  assert.match(native, /source\/flowcell\.script\.json/);
  assert.match(native, /source manifest SHA-256 does not match stage\.json/);
  assert.match(native, /script SHA-256 does not match stage\.json/);
  assert.doesNotMatch(native, /windows\.setup-organization|flowcell\.windows\.setup-organization/);
});
