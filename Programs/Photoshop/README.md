# Photoshop Program Workflow

Photoshop uses the shared Git/local/panel script workflow.

- `Photoshop Git Scripts/`: tracked shareable source scripts, organized by panel subfolder.
- `Photoshop Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Photoshop Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.

Local bindings, panel state, and generated runtime data still belong under `FlowCell/local/`.
