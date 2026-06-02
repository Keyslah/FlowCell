# Windows Program Workflow

Windows uses the shared Git/local/panel script workflow.

- `Windows Git Scripts/`: tracked shareable scripts, organized by panel subfolder.
- `Windows Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Windows Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.
