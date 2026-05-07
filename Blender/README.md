# Blender Structure

Blender keeps its current structured integration area.

- `FlowCellButtons/`: user-facing FlowCell Blender button scripts only.
- `SupportScripts/`: Blender support infrastructure such as the dispatcher and sync/regeneration scripts.
- `config.json`: sanitized public default Blender config.
- `FlowCell/local/private/blender.config.local.json`: local override for machine-specific bridge paths.

Use `examples/Blender/config.example.json` as the public reference shape when documenting or sharing config.
