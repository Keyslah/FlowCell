# Blender Structure

Blender keeps its structured bridge integration area.

- `Blender Git Scripts/`: tracked shareable `.py` tools, organized by panel subfolder.
- `Blender Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local button records plus panel-local runnable `.py` copies.
- `ManagedActions/`: ignored bridge-managed runtime action sources that FlowCell regenerates.
- `FlowCellButtons/`: deprecated per-button wrapper compatibility folder; active Blender buttons use direct `bridgeAction` metadata instead.
- `SupportScripts/`: dispatcher, installer, cleanup, and sync/regeneration plumbing only.
- `AddonScripts/`: Blender refresh/sidebar helper scripts only.
- `ScriptDump/`: ignored loose/testing/old scripts. Nested ScriptDump folders are treated the same way.
- `config.json`: sanitized public default Blender config.
- `FlowCell/local/private/blender.config.local.json`: local override for machine-specific bridge paths.

Use `examples/Blender/config.example.json` as the public reference shape when documenting or sharing config.
