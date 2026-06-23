# FlowCell — Claude Code instructions

The standing rules for this repo live in **AGENTS.md**. They are imported below so
they load automatically every session. Edit AGENTS.md to change them (single source
of truth — do not duplicate rules here).

@AGENTS.md

## Quick reminders
- Keep `PROGRAM_SUMMARY.txt` (repo root) updated in the same change whenever FlowCell
  behavior or repo structure changes.
- Never permanently delete — send files/folders to the Recycle Bin.
- Validate edits: `npx tsc --noEmit` (frontend), `cargo check` in `FlowCellFrontend/src-tauri`
  (backend), and parse-check any `.ps1` you touch.
