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
- When your changes require a new FlowCell build, run that build yourself at the end of the
  task (`npm run tauri build` from `FlowCellFrontend`) so the app is up to date — don't leave
  it for the user to run. If a running FlowCell instance locks `flowcell_frontend.exe` and
  blocks the rebuild, stop that process and rebuild, then tell the user to relaunch.
- After a manual `npm run tauri build`, run `flowcellbackend/helpers/Update-FrontendBuildStamp.ps1`.
  The launcher (`Start-FlowCellFrontend.ps1`) rebuilds the frontend on startup whenever the
  `target/release` freshness stamps don't match the source, and it only writes those stamps
  after its *own* build — so without this step the user's next launch rebuilds again (making
  them wait). The helper refreshes the stamps so the next launch starts instantly.
