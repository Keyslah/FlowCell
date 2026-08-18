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

test("Add Program always offers a registration-only executable path beside managed packages", () => {
  const addProgram = read(
    frontendRoot,
    "src",
    "pages",
    "program-setup",
    "AddProgramWindowPage.tsx"
  );
  assert.match(addProgram, />Any program<\/button>/);
  assert.match(addProgram, />Managed package<\/button>/);
  assert.match(addProgram, /<label>Program name/);
  assert.match(addProgram, /<label>Application executable/);
  assert.match(addProgram, /createPlainProgram:\s*true/);
  assert.match(addProgram, /createPlainProgram:\s*false/);
  assert.match(addProgram, /selectedPanels:\s*\[\]/);
  assert.match(addProgram, /selectedSources:\s*\[\]/);
  assert.match(addProgram, /inventory\.packages\.length === 0/);
  assert.match(addProgram, /Choose Any program to add an executable directly/);
  assert.match(addProgram, /const addPlainProgram = async/);
  assert.match(
    addProgram,
    /const addPlainProgram = async[\s\S]*preflightAddProgramPlan\(request\)[\s\S]*installValidatedPlan\(validatedRequest, validated\)/
  );
  assert.match(addProgram, /onClick=\{\(\) => void addPlainProgram\(\)\}/);
  assert.doesNotMatch(addProgram, /I confirm this EXE filename identifies/);
  assert.doesNotMatch(addProgram, />Review program<\/button>/);
  assert.match(addProgram, />Review plan<\/button>/);
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
  assert.match(nativeWebview, /parent_webview\.environment\(\)/);
  const rawChildBuilder = nativeWebview.match(
    /WebViewBuilder::new\(\)[\s\S]*?\.build_as_child\(&parent\)/
  )?.[0] ?? "";
  assert.match(
    rawChildBuilder,
    /\.with_environment\(parent_environment\)/,
    "the raw installed-page child must reuse its parent WebView2 environment"
  );
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
  const fatalErrorLifecycleStart = host.indexOf("async function revealInstalledPageError(");
  const fatalErrorLifecycleEnd = host.indexOf("export default", fatalErrorLifecycleStart);
  assert.ok(fatalErrorLifecycleStart >= 0 && fatalErrorLifecycleEnd > fatalErrorLifecycleStart);
  const fatalErrorLifecycle = host.slice(fatalErrorLifecycleStart, fatalErrorLifecycleEnd);
  assert.ok(
    fatalErrorLifecycle.indexOf('await invoke<void>("unmount_installed_page_webview")') <
      fatalErrorLifecycle.indexOf("reveal(message)"),
    "the raw child must unmount before the React error surface is revealed"
  );
  assert.match(
    fatalErrorLifecycle,
    /catch\s*\{[\s\S]*getCurrentWindow\(\)\.destroy\(\)/,
    "a failed fatal-error unmount must close the parent instead of leaving the raw child over React"
  );
  const closeLifecycleStart = host.indexOf("const disposeClose = await currentWindow.onCloseRequested");
  const closeLifecycleEnd = host.indexOf("\n      if (disposed)", closeLifecycleStart);
  assert.ok(closeLifecycleStart >= 0 && closeLifecycleEnd > closeLifecycleStart);
  const closeLifecycle = host.slice(closeLifecycleStart, closeLifecycleEnd);
  assert.ok(
    closeLifecycle.indexOf('await invoke<void>("unmount_installed_page_webview")') <
      closeLifecycle.indexOf("await currentWindow.destroy()"),
    "close must attempt child unmount before destroying the parent"
  );
  assert.match(
    closeLifecycle,
    /try\s*\{[\s\S]*unmount_installed_page_webview[\s\S]*\}\s*catch\s*\{[\s\S]*\}\s*try\s*\{[\s\S]*currentWindow\.destroy\(\)/,
    "close must still destroy the parent when child unmount fails"
  );
  assert.match(host, /resize_installed_page_webview[\s\S]*catch\(\(reason\) => \{[\s\S]*failPage\(reason\)/);
  assert.match(host, /default-world proof was not received\."\)/);
  assert.match(
    host,
    /await currentWindow\.onCloseRequested[\s\S]*await invoke\("mount_installed_page_webview"/
  );
  assert.match(
    coreWindows,
    /existing\.once\("tauri:\/\/destroyed"[\s\S]*existing\.close\(\)[\s\S]*await destroyed/
  );
  assert.match(coreWindows, /registerLayoutWindow\(\{[\s\S]*kind:\s*"installed-page"/);
  assert.match(coreWindows, /installedPageFileName:\s*args\.fileName/);
  assert.match(coreWindows, /installedPageId:\s*args\.pageId/);
  assert.match(coreWindows, /resolveInstalledPageOpenDescriptor[\s\S]*resolve_installed_page/);
  assert.match(coreWindows, /resolveAndOpenInstalledPageWindow[\s\S]*resolveInstalledPageOpenDescriptor/);
  assert.match(coreWindows, /savedBounds:\s*args\.bounds/);
  assert.match(coreWindows, /placement\.unit === "physical"[\s\S]*new PhysicalPosition/);
  assert.match(coreWindows, /placement\.unit === "physical"[\s\S]*new PhysicalSize/);
  assert.match(coreWindows, /await destroyed;[\s\S]*unregisterLayoutWindow\(label\)/);
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

test("generated page Buttons update by authenticated package identity instead of duplicating", () => {
  const broker = read(
    frontendRoot,
    "src",
    "pages",
    "installed-page",
    "installedPageCoreBroker.ts"
  );
  const nativePage = read(
    frontendRoot,
    "src-tauri",
    "src",
    "program_sources",
    "installed_page.rs"
  );
  assert.match(nativePage, /AuthorizedGeneratedStage[\s\S]*package_id:\s*String/);
  assert.match(nativePage, /package_id:\s*stage\.paths\.package_id/);
  assert.match(broker, /authorizedStage\.packageId/);
  assert.match(broker, /subtle\.digest\("SHA-256"/);
  assert.match(broker, /existingOwner\s*\?\s*updateButtonSource\s*:\s*installButtonSource/);
  assert.match(broker, /applyInstalledSourceUpdate\(next, installed\)/);
  assert.match(broker, /finalizeButtonSourceUpdate\(/);
  assert.match(broker, /rollbackButtonSourceUpdate\(/);
  assert.match(broker, /outcome\s*===\s*"finalized"/);
  assert.match(broker, /existingOwner\?\.sourceIdentity\?\.displayPanelName\s*\|\|\s*panelName/);
  assert.doesNotMatch(broker, /createStableButtonId\("button-generated"\)/);
  assert.match(
    read(frontendRoot, "src", "button", "state", "ButtonStateRepository.ts"),
    /invoke<Record<string, unknown>>\("update_button_source"/
  );
  const sourceUpdates = read(
    frontendRoot,
    "src",
    "button",
    "state",
    "sourceUpdateOperations.ts"
  );
  assert.match(sourceUpdates, /flowcellSourceRevision:\s*installed\.updateTransactionToken/);
  assert.match(
    read(frontendRoot, "src-tauri", "src", "main.rs"),
    /program_sources::install::update_button_source/
  );
});

test("installed pages can opt into fixed always-on-top window behavior", () => {
  const appBase = read(frontendRoot, "src", "AppBase.tsx");
  const coreWindows = read(frontendRoot, "src", "lib", "coreWindows.ts");
  const windowContext = read(frontendRoot, "src", "lib", "windowContext.ts");
  const mainPage = read(frontendRoot, "src", "pages", "main", "MainPage.tsx");

  assert.match(coreWindows, /alwaysOnTop:\s*options\.alwaysOnTop\s*\?\?\s*false/);
  assert.match(coreWindows, /programName\s*&&\s*!options\.alwaysOnTop/);
  assert.match(
    coreWindows,
    /if \(options\.alwaysOnTop\)[\s\S]*await unregisterScopedWindowTopmost\(options\.label\);/
  );
  assert.match(
    coreWindows,
    /if \(options\.alwaysOnTop\)[\s\S]*else \{[\s\S]*setAlwaysOnTop\(false\)[\s\S]*registerScopedWindowTopmost[\s\S]*refreshScopedWindowTopmost/
  );
  assert.match(coreWindows, /alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/);
  assert.match(windowContext, /alwaysOnTop:\s*parsed\.alwaysOnTop\s*===\s*true/);
  assert.match(appBase, /if \(fixedAlwaysOnTop\)[\s\S]*applyTopmost\(true\)/);
  assert.match(mainPage, /alwaysOnTop:\s*descriptor\.window\.alwaysOnTop/);
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
  const nativeRuntime = native.split("#[cfg(test)]", 1)[0];
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
  assert.doesNotMatch(
    nativeRuntime,
    /windows\.setup-organization|flowcell\.windows\.setup-organization/
  );
});
