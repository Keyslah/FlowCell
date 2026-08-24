# Illustrator Align Tool

This note describes FlowCell's Illustrator `Ill Align` toolset. The tool moves selected Illustrator `PageItem` objects by their `visibleBounds`, using a stored FlowCell anchor unless the `Art` button is used.

## How It Works

Install the Illustrator payload, then assign `Illustrator > Actions > Set Anchor` any available shortcut in Binds. While Illustrator is foreground, select one or more Illustrator page items and use that shortcut to store the current selection as the anchor. Set Anchor uses a pass-through hotkey, so assigning an existing Illustrator key such as `V` does not suppress that key's native Illustrator command. Its foreground automation call completes the bounds capture before the hotkey action returns, preventing a later selection from replacing the intended anchor during a delayed process launch. The helper stores only the selection's current visible-bounds box and center point in `flowcellbackend/local/illustrator_anchor_bounds.json`.

After the anchor is set, select the object or objects you want to move and press an align button. Anchor-based moves use the stored bounds and center as a fixed target and include every selected page item, including the object that originally captured the anchor. The `Art` button targets the active artboard directly.

The X and Y rows each keep an independent `Origin` mode for Min and Max. With Origin released, Min and Max align matching visible edges; with Origin pressed, they align the selected artwork's center-point origin to the requested anchor edge. Clicking the already-selected Origin button releases it. Center always aligns centers and does not change Origin mode.

Surface is an immediate action instead of a mode. Pressing X Surface or Y Surface moves the selected artwork flush against the opposite outside surface of the anchor on that axis. Pressing the same Surface button again flips the artwork back to the other side, so repeated presses toggle between the Min and Max outside surfaces. Surface does not change the axis's Origin mode.

## Button Reference

| Button | Description |
| --- | --- |
| `X Min` | Matches the selected object's left edge to the anchor's left edge. In Origin mode, moves the selected object's horizontal center to the anchor's left edge. |
| `X Center` | Moves the selected object horizontally so its visible center matches the anchor's horizontal center, regardless of mode. |
| `X Max` | Matches the selected object's right edge to the anchor's right edge. In Origin mode, moves the selected object's horizontal center to the anchor's right edge. |
| `X Surface` | Moves the selected object to the opposite outside X surface. Repeated presses alternate between placing its right edge against the anchor's left edge and its left edge against the anchor's right edge. |
| `X Origin` | Toggles Origin mode for X without moving anything. Clicking it again releases Origin. |
| `Y Min` | Matches the selected object's bottom edge to the anchor's bottom edge. In Origin mode, moves the selected object's vertical center to the anchor's bottom edge. |
| `Y Center` | Moves the selected object vertically so its visible center matches the anchor's vertical center, regardless of mode. |
| `Y Max` | Matches the selected object's top edge to the anchor's top edge. In Origin mode, moves the selected object's vertical center to the anchor's top edge. |
| `Y Surface` | Moves the selected object to the opposite outside Y surface. Repeated presses alternate between placing its top edge against the anchor's bottom edge and its bottom edge against the anchor's top edge. |
| `Y Origin` | Toggles Origin mode for Y without moving anything. Clicking it again releases Origin. |
| `Art` | Centers every selected page item on the active Illustrator artboard instead of the stored anchor. |
| `Anchor` | Centers every selected page item on the stored FlowCell anchor in both X and Y. |
| `Group` | Toggles virtual group movement. When active, FlowCell calculates one combined visible-bounds box and moves the participating items by the same delta, preserving their spacing. |

## Notes

- The tool works on Illustrator page items from the current selection.
- Selection scans are capped to avoid Illustrator hangs; select 250 or fewer items.
- Anchor lookup uses the stored bounds file directly; the helper does not scan the document for tagged anchor objects.
- Command status is written to `flowcellbackend/local/logs/illustrator-anchor-status.txt`, and detailed activity is logged to `flowcellbackend/local/logs/illustrator-anchor.log`.
