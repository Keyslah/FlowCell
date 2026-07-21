import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(scriptDirectory, "validate-skin.mjs");
const exactExamplePath = join(scriptDirectory, "..", "examples", "packed-turquoise-3d.skin.txt");

function completePaste(structure, base = "") {
  return [
    "=== structure ===",
    structure,
    "=== keyframes ===",
    "=== base ===",
    base,
    "=== hover ===",
    "=== play ===",
    "=== pressed ===",
    "=== held ===",
    "=== release ===",
    "=== disabled ===",
    "=== error ==="
  ].join("\n");
}

function validate(source) {
  return spawnSync(process.execPath, [validatorPath], {
    input: source,
    encoding: "utf8"
  });
}

test("skin-author preflight keeps labeled core typography deterministic", () => {
  const passing = [
    readFileSync(exactExamplePath, "utf8"),
    completePaste(
      '<div data-core style="width:80px;height:30px;">{{label}}</div>',
      "font-size:13px;line-height:17px;"
    ),
    completePaste('<div data-core style="width:80px;height:30px;"></div>')
  ];
  const failing = [
    completePaste('<div data-core style="min-width:10em;height:30px;">{{label}}</div>'),
    completePaste('<div data-core style="width:80px;height:30px;">{{label}}</div>'),
    completePaste('<div data-core style="width:80px;height:30px;font:inherit;">{{label}}</div>'),
    completePaste('<div data-core style="width:80px;height:30px;font-size:13px;">{{label}}</div>'),
    completePaste('<div data-core style="width:80px;height:30px;font-size:13px;line-height:1.2;">{{label}}</div>'),
    completePaste('<div data-core style="width:80px;height:30px;font-size:13px;line-height:inherit;">{{label}}</div>'),
    completePaste('<div data-core style="min-width:10em;height:30px;"></div>')
  ];

  passing.forEach((source, index) => {
    const result = validate(source);
    assert.equal(result.status, 0, `passing case ${index + 1}: ${result.stderr}`);
  });
  failing.forEach((source, index) => {
    const result = validate(source);
    assert.notEqual(result.status, 0, `failing case ${index + 1} unexpectedly passed`);
  });
});
