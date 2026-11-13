import assert from "node:assert/strict";

// Known rendered core measurements exercise the real size/packing path without
// guessing a browser font's glyph advances in Node.
export function withNeutralSkinMeasurements(coreWidths, run) {
  const previous = globalThis.document;
  const probes = new Set();
  globalThis.document = {
    body: { append: (probe) => probes.add(probe) },
    createElement() {
      const carrier = { textContent: "", style: {} };
      const core = {
        querySelector: () => carrier,
        getBoundingClientRect: () => ({ width: coreWidths[carrier.textContent] ?? 104, height: 52 })
      };
      const probe = { style: {}, remove: () => probes.delete(probe), attachShadow: () => ({
        set innerHTML(source) {
          assert.match(source, /data-core/);
          assert.match(source, /padding:1em 1\.5em/);
        },
        querySelector: () => core
      }) };
      return probe;
    }
  };
  try {
    return run();
  } finally {
    globalThis.document = previous;
    assert.equal(probes.size, 0, "natural sizing must remove its offscreen probes");
  }
}
