# Blender Structure

Blender keeps its current structured integration area.

- `ScriptBank/`: public/shareable downloadable tool sources and examples.
- `ManagedActions/`: installed Python action sources that FlowTest registers with the Blender bridge.
- `FlowCellButtons/`: user-facing clickable wrapper scripts only.
- `SupportScripts/`: dispatcher, installer, cleanup, and sync/regeneration plumbing only.
- `AddonScripts/`: Blender refresh/sidebar helper scripts only.
- `ScriptDump/`: ignored loose/testing/old scripts. Nested ScriptDump folders are treated the same way.
- `config.json`: sanitized public default Blender config.
- `FlowCell/local/private/blender.config.local.json`: local override for machine-specific bridge paths.

Use `examples/Blender/config.example.json` as the public reference shape when documenting or sharing config.
