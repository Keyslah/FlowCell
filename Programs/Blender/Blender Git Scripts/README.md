# Blender Git Scripts

Tracked shared Blender script sources live here, organized by panel subfolder. Portable Add Script sources must contain their actual Blender logic in this folder, expose `run_flowcell_action(context=None, data=None)`, and include a `# Description: ...` header.

`ManagedActions` is generated installed runtime output, not source. Bridge-only wrappers that call `bridge.execute_bridge_operator(...)` are not portable Add Script sources; files marked `# FLOWCELL_BUILTIN_ONLY: true` are intentionally blocked from Add Script and only document legacy/built-in bridge routes.

After adding, deleting, or repairing Blender scripts/toolsets, reload the FlowCell Blender add-on or restart Blender so runtime registrations refresh.

Deleting an installed Blender button/toolset cleans FlowCell runtime state only: config entries, registry entries, generated `ManagedActions` copies, panel metadata references, and unreferenced stale variants. Source files in this Git Scripts library remain until the user explicitly deletes the source script.
