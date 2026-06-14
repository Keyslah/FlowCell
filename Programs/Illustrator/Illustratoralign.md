# Illustrator Align Tool

This note describes FlowCell's Illustrator `Ill Align` toolset. The tool moves selected Illustrator `PageItem` objects by their `visibleBounds`, using a stored FlowCell anchor unless the `Art` button is used.

## How It Works

Select one or more Illustrator page items and press the FlowCell anchor hotkey (`v`) to store the current selection as the anchor. FlowCell sends `v` to Illustrator immediately for the Selection Tool, then queues anchor capture in the background. The helper stores only the selection's current visible-bounds box and center point in `FlowCell/local/illustrator_anchor_bounds.json`.

After the anchor is set, select the object or objects you want to move and press an align button. Anchor-based moves use the stored bounds and center as a fixed target and include every selected page item, including the object that originally captured the anchor. The `Art` button targets the active artboard directly.

## Button Reference

| Button | Description |
| --- | --- |
| `X Min` | Moves each selected object so its left visible edge matches the anchor's left visible edge. |
| `X Center` | Moves each selected object horizontally so its visible center matches the anchor's horizontal center. |
| `X Max` | Moves each selected object so its right visible edge matches the anchor's right visible edge. |
| `X Surface` | Toggles surface mode for the X row. With surface mode active, `X Min` places the selected object's right edge against the anchor's left edge, `X Max` places the selected object's left edge against the anchor's right edge, and `X Center` chooses the nearest outside side based on which side of the anchor the object is on. |
| `X Origin` | Toggles origin mode for the X row. In the Illustrator variant this uses the same horizontal center move as normal X center alignment. |
| `Y Min` | Moves each selected object so its bottom visible edge matches the anchor's bottom visible edge. |
| `Y Center` | Moves each selected object vertically so its visible center matches the anchor's vertical center. |
| `Y Max` | Moves each selected object so its top visible edge matches the anchor's top visible edge. |
| `Y Surface` | Toggles surface mode for the Y row. With surface mode active, `Y Min` places the selected object's top edge against the anchor's bottom edge, `Y Max` places the selected object's bottom edge against the anchor's top edge, and `Y Center` chooses the nearest outside side based on whether the object is below or above the anchor. |
| `Y Origin` | Toggles origin mode for the Y row. In the Illustrator variant this uses the same vertical center move as normal Y center alignment. |
| `Art` | Centers every selected page item on the active Illustrator artboard instead of the stored anchor. |
| `Anchor` | Centers every selected page item on the stored FlowCell anchor in both X and Y. |
| `Group` | Toggles virtual group movement. When active, FlowCell calculates one combined visible-bounds box and moves the participating items by the same delta, preserving their spacing. |

## Notes

- The tool works on Illustrator page items from the current selection.
- Selection scans are capped to avoid Illustrator hangs; select 250 or fewer items.
- Anchor lookup uses the stored bounds file directly; the helper does not scan the document for tagged anchor objects.
- Command status is written to `FlowCell/local/logs/illustrator-anchor-status.txt`, and detailed activity is logged to `FlowCell/local/logs/illustrator-anchor.log`.
