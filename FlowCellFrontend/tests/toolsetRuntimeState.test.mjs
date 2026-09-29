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


test("Align manifest keeps separate limits and equal bottom controls", () => {
  const manifest = JSON.parse(readFileSync(join(frontendRoot, "..", "Programs", "Blender", "Blender Git Scripts", "Toolsets", "alignment-tools", "flowcell.toolset.json"), "utf8"));
  assert.doesNotThrow(() => validateInstalledButtonLayout(manifest.layout));
  assert.equal(manifest.children.length, 18);
  assert.equal(manifest.children.filter(child => child.slot.endsWith("_max")).length, 3);
  for (const axis of ["x", "y", "z"]) {
    const { placements, childBehaviors } = manifest.layout;
    assert.equal(placements[`${axis}_min`].y, placements[`${axis}_surface`].y);
    assert.equal(childBehaviors[`${axis}_min`], undefined);
    for (const suffix of ["center", "surface", "geo"]) {
      assert.equal(placements[`${axis}_min`].y, placements[`${axis}_${suffix}`].y);
      assert.ok(!manifest.children.find(child => child.slot === `${axis}_${suffix}`).label.startsWith(axis.toUpperCase()+" "));
    }
  }
  const bottoms = ["center_everything", "center_xy", "group"].map(slot => manifest.layout.placements[slot]);
  assert.equal(new Set(bottoms.map(rect => rect.width)).size, 1);
  assert.equal(new Set(bottoms.map(rect => rect.y)).size, 1);
  assert.ok(bottoms[0].y > manifest.layout.placements.z_min.y);
  const broken = structuredClone(manifest.layout);
  broken.childBehaviors.x_min = { labelField: "missing" };
  assert.throws(() => validateInstalledButtonLayout(broken), /unknown field/);
  assert.deepEqual(manifest.layout.childBehaviors.group, { toggleFields: ["group"], execute: false });
});


test("Blender Align Surface and Origin execute every click without latching or disabling", async () => {
  const { executeButtonRecord, isToolSetChildStateSelected, registerButtonCoreAction } = await import("./.compiled-button-system/button/runtime/ButtonRuntimeAdapter.js");
  const manifest = JSON.parse(readFileSync(join(frontendRoot, "..", "Programs", "Blender", "Blender Git Scripts", "Toolsets", "alignment-tools", "flowcell.toolset.json"), "utf8"));
  const fields = manifest.layout.fields;
  const values = Object.fromEntries(fields.map(field => [field.id, field.defaultValue]));
  assert.deepEqual(Object.keys(values),["group"]);
  let executions = 0;
  const unregister = registerButtonCoreAction("align-test", async () => { executions++; return {}; });
  try {
    for (const axis of ["x", "y", "z"]) {
      for (const suffix of ["surface", "geo", "min", "max"]) {
        const slot=`${axis}_${suffix}`;
        const child={ id:slot, label:slot, role:"tool-set-child", disabled:false,
          executionTarget:{kind:"core-action", actionId:"align-test", payload:manifest.children.find(c => c.slot===slot).payload},
          toolSetBehavior:manifest.layout.childBehaviors[slot] };
        for (let click=0; click<3; click++) {
          const result=await executeButtonRecord(child, "click", {fields,fieldValues:values});
          assert.equal(result.executed,true);
          assert.equal(isToolSetChildStateSelected(child,result.fieldValues),false);
          assert.deepEqual(result.fieldValues,values);
          assert.equal(child.disabled,false);
        }
      }
    }
    assert.equal(executions,36);
  } finally { unregister(); }
});
