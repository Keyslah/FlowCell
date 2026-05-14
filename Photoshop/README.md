# Photoshop Scripts

Photoshop now separates public library sources from managed active installs.

- `Photoshop Scripts/` is the public downloadable library/source folder.
- `Photoshop Active Scripts/` is the managed install target that FlowTest owns.
- FlowTest syncs runnable copies from the active folder into Photoshop's required Scripts runtime folder.
Local bindings, panel state, and generated runtime data still belong under `FlowCell/local/`.
