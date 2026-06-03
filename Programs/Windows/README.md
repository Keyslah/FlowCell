# Windows Program Workflow

Windows uses the shared Git/local/panel script workflow.

- `Windows Git Scripts/`: tracked shareable scripts, organized by panel subfolder.
- `Windows Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Windows Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.

## Utility scripts

- `Windows Git Scripts/Utility/Toggle-AutoHotkey.vbs` launches `Toggle-AutoHotkey.ps1` from the same folder, so a GitHub checkout can toggle AutoHotkey off for anti-cheat games without Aaron-specific paths. Its shortcut icon stays green while AutoHotkey is active and changes to the off icon only after AutoHotkey processes are verified stopped. See [Toggle AutoHotkey for anti-cheat games](../../docs/toggle-autohotkey-for-anticheat.md).
