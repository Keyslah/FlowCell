# Blender Git Scripts

Tracked shared Blender Button sources live here, organized by panel subfolder. Any raw script selected through Add Button must expose `run_flowcell_action(context=None, data=None)` and include a `# Description: ...` header.

`ManagedActions` is generated installed runtime output, not source. Add Button detects each source kind, and a single script, a tool set, a page-enabled source, or a thin wrapper whose `run_flowcell_action` calls `bridge.execute_bridge_operator(...)` all use the same owner-scoped install, delete, and re-add lifecycle. (Bridge wrappers run because the referenced bridge operator lives in the installed add-on.)

After adding, deleting, or repairing Blender scripts/toolsets, reload the FlowCell Blender add-on or restart Blender so runtime registrations refresh.

Deleting an installed Blender button/toolset cleans FlowCell runtime state only: config entries, registry entries, generated `ManagedActions` copies, panel metadata references, and unreferenced stale variants. Source files in this Git Scripts library remain until the user explicitly deletes the source script.
