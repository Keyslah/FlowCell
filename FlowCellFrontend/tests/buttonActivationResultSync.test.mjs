import test from "node:test";
import assert from "node:assert/strict";
import {
  buttonPlacementActivationCycleUsesResultMatches,
  resolveButtonActivationResultAssignments
} from "./.compiled-button-system/button/runtime/buttonActivationResultSync.js";

function axisCycle(axis) {
  return {
    states: [
      {
        id: `${axis}-neutral`,
        label: axis,
        advanceTrigger: "press",
        visualState: "base",
        resultMatches: [
          { axis, mode: "NONE" },
          { modes: { [axis]: "NONE" } }
        ]
      },
      {
        id: `${axis}-negative`,
        label: `${axis}-`,
        advanceTrigger: "press",
        visualState: "base",
        resultMatches: [
          { axis, mode: "MIN" },
          { modes: { [axis]: "MIN" } }
        ]
      },
      {
        id: `${axis}-positive`,
        label: `${axis}+`,
        advanceTrigger: "press",
        visualState: "base",
        resultMatches: [
          { axis, mode: "MAX" },
          { modes: { [axis]: "MAX" } }
        ]
      }
    ]
  };
}

function placement(id, activationCycle) {
  return { id, activationCycle };
}

test("Smart Axis status assigns the authoritative X, Y, Z, and Live placement states", () => {
  const document = {
    placements: {
      x: placement("x", axisCycle("X")),
      y: placement("y", axisCycle("Y")),
      z: placement("z", axisCycle("Z")),
      live: placement("live", {
        states: [
          {
            id: "live-off",
            label: "Live",
            advanceTrigger: "press",
            visualState: "base",
            resultMatches: [{ live_enabled: false }]
          },
          {
            id: "live-on",
            label: "Live",
            advanceTrigger: "press",
            visualState: "hover",
            resultMatches: [{ live_enabled: true }]
          }
        ]
      })
    }
  };

  assert.deepEqual(
    resolveButtonActivationResultAssignments(
      document,
      ["x", "y", "z", "live"],
      { modes: { X: "MIN", Y: "NONE", Z: "MAX" }, live_enabled: true }
    ),
    [
      { activationKey: "x", stateCount: 3, index: 1 },
      { activationKey: "y", stateCount: 3, index: 0 },
      { activationKey: "z", stateCount: 3, index: 2 },
      { activationKey: "live", stateCount: 2, index: 1 }
    ]
  );
  assert.equal(buttonPlacementActivationCycleUsesResultMatches(document.placements.live.activationCycle), true);
});

test("a child action response updates only the matching axis state", () => {
  const document = {
    placements: {
      x: placement("x", axisCycle("X")),
      y: placement("y", axisCycle("Y")),
      z: placement("z", axisCycle("Z"))
    }
  };

  assert.deepEqual(
    resolveButtonActivationResultAssignments(
      document,
      ["x", "y", "z"],
      { axis: "X", mode: "NONE" }
    ),
    [{ activationKey: "x", stateCount: 3, index: 0 }]
  );
  assert.deepEqual(
    resolveButtonActivationResultAssignments(
      document,
      ["x", "y", "z"],
      { axis: "X", mode: "UNKNOWN" }
    ),
    []
  );
});

test("ambiguous response mappings do not choose an arbitrary state", () => {
  const cycle = axisCycle("X");
  cycle.states[1].resultMatches = [{ axis: "X" }];
  cycle.states[2].resultMatches = [{ axis: "X" }];
  const document = { placements: { x: placement("x", cycle) } };

  assert.deepEqual(
    resolveButtonActivationResultAssignments(document, ["x"], { axis: "X", mode: "MIN" }),
    []
  );
});
