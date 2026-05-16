# Blender Structure

Blender keeps its current structured integration area.

- `Blender Scripts/`: public/shareable downloadable tool sources and examples, plus panel-named Add Script-ready `.py` exports generated from the live Blender panel state and recorded in `panel-add-script-manifest.json`.
- `Blender Active Scripts/`: managed installed source copies that `Add Button` owns.
- `ManagedActions/`: bridge-managed runtime action sources that FlowTest regenerates from the active copies.
- `FlowCellButtons/`: user-facing clickable wrapper scripts only.
- `SupportScripts/`: dispatcher, installer, cleanup, and sync/regeneration plumbing only.
- `AddonScripts/`: Blender refresh/sidebar helper scripts only.
- `ScriptDump/`: ignored loose/testing/old scripts. Nested ScriptDump folders are treated the same way.
- `ScriptBank/`: legacy share folder kept on disk for compatibility. New public submissions should move to `Blender Scripts/`.
- `config.json`: sanitized public default Blender config.
- `FlowCell/local/private/blender.config.local.json`: local override for machine-specific bridge paths.

Use `examples/Blender/config.example.json` as the public reference shape when documenting or sharing config.
