import React from "react";
import { createRoot } from "react-dom/client";
import { ButtonFanRenderer } from "../src/button/fan/ButtonFanRenderer";
import { buildQuickDefaultFanDocument } from "../src/button/state/buttonDocumentOperations";
import { unpackButtonDocumentTransport } from "../src/button/state/buttonDocumentTransport";
import type { ButtonStateDocument } from "../src/button/types";
import "../src/app.css";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const root = createRoot(document.getElementById("root")!);
void (async () => {
  const results: unknown[] = [];
  try {
    const canonical = unpackButtonDocumentTransport(await (await fetch("/profile")).json()) as ButtonStateDocument;
    const before = JSON.stringify(canonical);
    await document.fonts.ready;
    const legacyFiles = Object.values(canonical.fanSetups).find(setup => setup.name === "Files Fan")!;
    assert(legacyFiles, "The actual stale Files Fan fixture must be present");
    const cases = [
      { name: "Files", ids: legacyFiles.fanMemberButtonIds },
      { name: "Shapes", ids: Object.values(canonical.fanSetups).find(setup => setup.panelName === "Shapes")!.fanMemberButtonIds }
    ];
    for (const entry of cases) {
      for (const direction of ["right", "left", "top", "bottom"] as const) {
      const panelOwner = Object.values(canonical.buttons).find(button => button.role === "panel-owner" &&
        button.metadata.programName === "Blender" && button.metadata.panelName === entry.name)!;
      const directedCanonical = { ...canonical, buttons: { ...canonical.buttons, [panelOwner.id]: {
        ...panelOwner, metadata: { ...panelOwner.metadata, panelFanDirection: direction }
      } } };
      const fresh = buildQuickDefaultFanDocument({ document: directedCanonical, programName: "Blender", panelName: entry.name,
        buttons: entry.ids.map(id => canonical.buttons[id]) });
      root.render(<ButtonFanRenderer document={fresh.document} setup={fresh.setup} expanded onOwnerActivate={() => {}} />);
      for (let i = 0; i < 12; i++) await frame();
      const measure = (id: string) => {
        const placement = fresh.document.placements[id];
        const outer = document.querySelector(`[data-button-placement-id="${id}"]`);
        const shadow = outer?.querySelector("[data-button-skin-host]")?.shadowRoot;
        const core = shadow?.querySelector("[data-core]");
        const label = shadow?.querySelector("[data-button-label-node]");
        assert(core && label, `Rendered core and label missing: ${id}`);
        const bounds = core!.getBoundingClientRect();
        assert(Math.abs(bounds.width - placement.width) < 0.1, `Visible width differs from packed width: ${id}`);
        const range = document.createRange(); range.selectNodeContents(label!);
        const text = range.getBoundingClientRect();
        assert(text.left >= bounds.left - 0.5 && text.right <= bounds.right + 0.5, `Text spills outside button: ${id}`);
        assert(placement.skinOverrideId === "skin-default-neutral", "Quick default inherited a concrete/saved skin");
        return { label: fresh.document.buttons[placement.buttonId].label, left: bounds.left, top: bounds.top,
          right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
      };
      const members = fresh.setup.fanMemberPlacementIds.map(measure);
      assert(new Set(members.map(item => Math.round(item.width * 100))).size > 1, "Different labels must have variable widths");
      for (let index = 1; index < members.length; index++) {
        if (index % 4 === 0) continue;
        assert(Math.abs(members[index].left - members[index - 1].right) < 0.1, "Visible neighbors must touch without overlap");
      }
      const ownerId = fresh.document.surfaces[fresh.setup.fanSurfaceId].placementIds.find(id =>
        fresh.document.placements[id].buttonId === fresh.setup.panelOwnerButtonId)!;
      const owner = measure(ownerId);
      if (direction === "right") assert(Math.min(...members.map(item => item.left)) >= owner.right - 0.1, "Fan must open right");
      if (direction === "left") assert(Math.max(...members.map(item => item.right)) <= owner.left + 0.1, "Fan must open left");
      if (direction === "top") assert(Math.max(...members.map(item => item.bottom)) <= owner.top + 0.1, "Fan must open above");
      if (direction === "bottom") assert(Math.min(...members.map(item => item.top)) >= owner.bottom - 0.1, "Fan must open below");
      root.render(<ButtonFanRenderer document={fresh.document} setup={fresh.setup} expanded={false} onOwnerActivate={() => {}} />);
      for (let i = 0; i < 5; i++) await frame();
      const collapsed = document.querySelector("[data-button-skin-host]")?.shadowRoot?.querySelector("[data-core]");
      assert(collapsed && Math.abs(collapsed.getBoundingClientRect().width - fresh.document.placements[ownerId].width) < 0.1,
        "Collapsed owner must retain its own default skin width");
      results.push({ panel: entry.name, direction, members, equalSizes: false, rowGap: 0, labelOverflow: false, collapsedOwner: "passed" });
      }
    }
    assert(JSON.stringify(canonical) === before, "Rendering or creating defaults changed saved state");
    await fetch("/result", { method: "POST", body: JSON.stringify({ ok: true, results }) });
  } catch (error) {
    await fetch("/result", { method: "POST", body: JSON.stringify({ ok: false, error: String(error), results }) });
  }
})();
