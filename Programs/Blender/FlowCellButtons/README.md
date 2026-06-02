Per-button PowerShell wrappers have been purged.

Blender script buttons now run through direct bridge metadata (`bridgeAction` plus optional `bridgeData`) from the panel records. Shareable/public `.py` tools belong in `Blender\Blender Git Scripts`, durable private copies belong in `Blender\Blender Local Scripts`, panel-local runnable copies live under `Blender\Panels`, and bridge-managed runtime sources live under ignored `ManagedActions`.

Use the Codex prompt and short Add Script contract in [docs/blender-scripts.md](../../../docs/blender-scripts.md).
