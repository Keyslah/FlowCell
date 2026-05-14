# Blender Active Scripts

This folder holds the managed installed Blender source copies that FlowTest owns.

- `Add Button` copies selected Blender source files and folders here first.
- The Blender bridge then syncs those managed sources into the existing runtime folders such as `ManagedActions` and `FlowCellButtons`.
- FlowCell state should point at these managed source copies, not the original picked download paths.
