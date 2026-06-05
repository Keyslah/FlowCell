# Windows Program Workflow

Windows uses the shared Git/local/panel script workflow.

- `Windows Git Scripts/`: tracked shareable scripts, organized by panel subfolder.
- `Windows Local Scripts/`: ignored flat private backup/core copies. FlowCell never auto-deletes these.
- `Panels/`: ignored local panel runnable script copies.
- `ScriptDump/`: ignored loose/testing/old scripts.

Add Script copies the selected source into both `Windows Local Scripts` and the selected panel folder. Deleting a panel button never deletes the Local Scripts copy.

## Utility notes

- The portable AutoHotkey on/off toggle moved out of Windows Utility and now lives in [`tools/autohotkey v2 on off`](../../tools/autohotkey%20v2%20on%20off/). See [Toggle AutoHotkey for anti-cheat games](../../docs/toggle-autohotkey-for-anticheat.md).
