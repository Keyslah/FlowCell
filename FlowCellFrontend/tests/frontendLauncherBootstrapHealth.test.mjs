import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const launcherSource = readFileSync(
  new URL("../../flowcellbackend/helpers/Start-FlowCellFrontend.ps1", import.meta.url),
  "utf8",
);

test("launcher process lookup supports zero, one, or two built executables", { skip: process.platform !== "win32" }, () => {
  const script = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($env:FLOWCELL_TEST_LAUNCHER, [ref]$null, [ref]$null)
    $function = $ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FlowCellFrontendProcess'}, $true)
    Invoke-Expression $function.Extent.Text
    $frontendReleaseExePath = Join-Path $env:TEMP 'FlowCell-launcher-test-release.exe'
    $frontendDebugExePath = Join-Path $env:TEMP 'FlowCell-launcher-test-debug.exe'
    function Get-Process { param($Name, $ErrorAction) @([pscustomobject]@{Path=$frontendReleaseExePath}, [pscustomobject]@{Path=$frontendDebugExePath}, [pscustomobject]@{Path=(Join-Path $env:TEMP 'unrelated.exe')}) }
    function Test-Path { param($LiteralPath, $PathType) $availablePaths -contains $LiteralPath }
    foreach ($count in 0,1,2) {
      $availablePaths = @(@($frontendReleaseExePath,$frontendDebugExePath) | Select-Object -First $count)
      $matches = @(Get-FlowCellFrontendProcess)
      $expected = if ($count -eq 0) { 3 } else { $count }
      if ($matches.Count -ne $expected) { throw "Expected $expected matches for $count built executables, got $($matches.Count)" }
      if ($count -eq 1 -and $matches[0].Path -ne $frontendReleaseExePath) { throw 'Selected another installed copy' }
    }
  `;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    env: { ...process.env, FLOWCELL_TEST_LAUNCHER: fileURLToPath(new URL("../../flowcellbackend/helpers/Start-FlowCellFrontend.ps1", import.meta.url)) },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("fresh frontend launches must prove Button-state bootstrap health", () => {
  assert.match(
    launcherSource,
    /buttonBootstrapErrorPath\s*=\s*Join-Path\s+\$buttonStateRoot\s+'last-bootstrap-error\.log'/,
  );
  assert.match(
    launcherSource,
    /FLOWCELL_FRONTEND_BOOTSTRAP_PENDING:\{0\}.*NewGuid\(\)/s,
  );
  assert.match(
    launcherSource,
    /Start-Process\s+-FilePath\s+\$frontendExePath\s+-WorkingDirectory\s+\$frontendRoot\s+-PassThru/,
  );
  assert.match(
    launcherSource,
    /if \(\$Process\.HasExited\)[\s\S]*?exited before Button-state bootstrap completed/,
  );
  assert.match(
    launcherSource,
    /\$status -ne \$Sentinel\)[\s\S]*?Button-state bootstrap failed/,
  );
  assert.match(
    launcherSource,
    /Timed out waiting \$TimeoutMilliseconds ms for FlowCell frontend Button-state bootstrap health/,
  );

  const existingProcessReturn = launcherSource.indexOf(
    "Frontend already running in process {0}; focused existing window after launch request.",
  );
  const sentinelArm = launcherSource.indexOf(
    "$bootstrapSentinel = New-FlowCellFrontendBootstrapSentinel",
  );
  const freshLaunch = launcherSource.indexOf(
    "$launchedFrontend = Start-Process -FilePath $frontendExePath",
  );
  const bootstrapWait = launcherSource.indexOf(
    "Wait-FlowCellFrontendBootstrap -Process $launchedFrontend",
  );
  assert.ok(existingProcessReturn >= 0, "expected existing-process reuse branch");
  assert.ok(sentinelArm > existingProcessReturn, "sentinel must only arm after reuse branches return");
  assert.ok(freshLaunch > sentinelArm, "fresh launch must follow sentinel creation");
  assert.ok(bootstrapWait > freshLaunch, "launcher must wait for fresh-process health");
});
