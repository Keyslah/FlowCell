# Save Clipboard Text

Save the current Windows clipboard text as a new timestamped UTF-8 `.txt` file.

## FlowCell

Add `flowcell.script.json` to the Windows **Files** panel once for every
destination you want. Each import creates a separate Button owner with its own
saved folder; the Buttons do not share configuration.

- First run: choose that Button's destination folder.
- Normal run: save the current clipboard text to that folder.
- Hold **Shift** while running: choose a different folder for that Button.
- Import the manifest again: create another independently configured Button.

Rename each Button in the FlowCell Buttons Editor to match its destination if
desired. Folder choices are user-local runtime data and are never written into
this shareable package.

## Standalone Windows Use

Run `save_clipboard_text.ps1` with Windows PowerShell 5.1 or newer:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\save_clipboard_text.ps1
```

To choose a different standalone destination later:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\save_clipboard_text.ps1 -Configure
```

Standalone settings are stored under the current user's Local AppData. No user,
repository, or destination path is hardcoded in the package.
