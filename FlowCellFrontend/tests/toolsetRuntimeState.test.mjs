import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createToolFieldRuntimeState,
  reconcileToolFieldRuntimeState,
  toolFieldSchemaFingerprint
} from "./.compiled-button-system/button/popout/toolFieldRuntimeState.js";
import {
  validateInstalledButtonLayout
} from "./.compiled-button-system/button/state/installedButtonLayoutValidation.js";

const frontendRoot = join(import.meta.dirname, "..");

function numberField(defaultValue = 15) {
  return {
    id: "angle",
    kind: "number",
    label: "Angle",
    payloadKey: "angle",
    defaultValue,
    minimum: -360,
    maximum: 360,
    step: 1,
    x: 8,
    y: 8,
    width: 96,
    height: 42,
    zIndex: 1,
    hidden: true
  };
}

test("Tool Set field values survive semantically identical cloned canonical documents", () => {
  const fields = [numberField()];
  const initial = createToolFieldRuntimeState("rotate", fields);
  const edited = { ...initial, values: { angle: 47 } };
  const clonedFields = structuredClone(fields);
  const incoming = createToolFieldRuntimeState("rotate", clonedFields);

  assert.notStrictEqual(clonedFields, fields);
  assert.equal(toolFieldSchemaFingerprint(clonedFields), initial.schemaFingerprint);
  assert.strictEqual(reconcileToolFieldRuntimeState(edited, incoming), edited);
  assert.deepEqual(reconcileToolFieldRuntimeState(edited, incoming).values, { angle: 47 });
});

test("Tool Set field values reset only when the unit or field schema changes", () => {
  const current = {
    ...createToolFieldRuntimeState("rotate", [numberField()]),
    values: { angle: 47 }
  };
  const changedSchema = createToolFieldRuntimeState("rotate", [numberField(90)]);
  const changedUnit = createToolFieldRuntimeState("revolve", [numberField()]);

  assert.strictEqual(reconcileToolFieldRuntimeState(current, changedSchema), changedSchema);
  assert.deepEqual(changedSchema.values, { angle: 90 });
  assert.strictEqual(reconcileToolFieldRuntimeState(current, changedUnit), changedUnit);
  assert.deepEqual(changedUnit.values, { angle: 15 });
});

test("Tool Set field schema identity ignores object property insertion order", () => {
  const original = numberField();
  const reordered = {
    hidden: original.hidden,
    zIndex: original.zIndex,
    height: original.height,
    width: original.width,
    y: original.y,
    x: original.x,
    step: original.step,
    maximum: original.maximum,
    minimum: original.minimum,
    defaultValue: original.defaultValue,
    payloadKey: original.payloadKey,
    label: original.label,
    kind: original.kind,
    id: original.id
  };

  assert.equal(toolFieldSchemaFingerprint([original]), toolFieldSchemaFingerprint([reordered]));
});

test("frontend Tool Set layout validation accepts the supported runtime shape without rewriting it", () => {
  const layout = {
    mode: "grid",
    columns: 4,
    gap: 8,
    padding: 8,
    width: 240,
    height: 120,
    placements: {
      apply: { x: 8, y: 8, width: 96, height: 42 }
    },
    fields: [numberField()],
    childBehaviors: {
      apply: {
        fieldPatch: { angle: 90 },
        execute: true,
        payloadTemplate: { angle: { $field: "angle" } }
      }
    },
    updatePolicy: { appendMissingChildSlots: true }
  };

  assert.strictEqual(validateInstalledButtonLayout(layout), layout);
});

test("frontend Tool Set layout validation rejects malformed runtime shapes before integration", () => {
  assert.throws(
    () => validateInstalledButtonLayout({ presentation: { kind: "page" } }),
    /layout\.presentation.*not supported/
  );
  assert.throws(
    () => validateInstalledButtonLayout({ mode: "custom" }),
    /mode.*must be 'grid'/
  );
  assert.throws(
    () => validateInstalledButtonLayout({ fields: {} }),
    /layout 'fields' must be an array/
  );
  assert.throws(
    () => validateInstalledButtonLayout({
      placements: { apply: { x: 0, y: 0, width: "wide", height: 42 } }
    }),
    /placements\.apply\.width.*finite number/
  );
  assert.throws(
    () => validateInstalledButtonLayout({ childBehaviors: { apply: [] } }),
    /childBehaviors\.apply.*must be an object/
  );
  assert.throws(
    () => validateInstalledButtonLayout({
      fields: [numberField()],
      childBehaviors: {
        apply: { payloadTemplate: { angle: { $field: "missing" } } }
      }
    }),
    /references unknown field 'missing'/
  );
});

test("new and updated Tool Sets validate layout data before consuming it", () => {
  const editor = readFileSync(
    join(frontendRoot, "src", "button", "editor", "ButtonEditorPage.tsx"),
    "utf8"
  );
  const updates = readFileSync(
    join(frontendRoot, "src", "button", "state", "sourceUpdateOperations.ts"),
    "utf8"
  );
  const repository = readFileSync(
    join(frontendRoot, "src", "button", "state", "ButtonStateRepository.ts"),
    "utf8"
  );

  assert.match(
    editor,
    /function addInstalledToolSet[\s\S]{0,300}const layout = validateInstalledButtonLayout\(result\.layout\)/
  );
  assert.match(
    updates,
    /function applyInstalledSourceUpdate[\s\S]{0,220}const layout = validateInstalledButtonLayout\(installed\.layout\)/
  );
  assert.match(
    repository,
    /layout:\s*validateInstalledButtonLayout\(response\.layout/
  );
});
