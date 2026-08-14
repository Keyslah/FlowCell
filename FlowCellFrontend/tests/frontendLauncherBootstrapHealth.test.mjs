import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcherSource = readFileSync(
  new URL("../../flowcellbackend/helpers/Start-FlowCellFrontend.ps1", import.meta.url),
  "utf8",
);

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
