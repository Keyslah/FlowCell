# Illustrator Program Workflow

Illustrator uses the shared Git/local/panel script workflow.

- `Illustrator Git Scripts/`: tracked shareable source scripts, organized by panel subfolder.
- `Illustrator Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `HelperScripts/`: internal Illustrator helpers only.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Illustrator Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.
