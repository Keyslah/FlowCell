<INSTRUCTIONS>
Always move deleted files and folders to the Recycle Bin. Do not permanently delete anything unless the user explicitly says to permanently delete it. The only exception is short-lived temp files created during the current task.

Keep PROGRAM_SUMMARY.txt updated. Any time FlowCell is updated, fixed, reorganized, or extended, update PROGRAM_SUMMARY.txt in the same change so it remains accurate.

Repository guardrails
- Make the smallest maintainable change that solves the request.
- Prefer existing patterns over new abstractions.
- Avoid broad refactors and speculative helpers.
- Inspect narrow code slices first.
- Use `rg`, imports, and references before opening broad files.
- Protect context aggressively.
- Cap unknown command output by bytes.
- Validate based on risk.
- If any build-affecting FlowCell source changed during the task (frontend, Tauri/Rust, build configuration, or bundled/generated runtime assets), rebuild the compiled release before finishing, even when the final follow-up edit is only local state or data. Judge this across the whole task, not only the last file touched.
- Use `flowcellbackend/helpers/Start-FlowCellFrontend.ps1 -ForceRestart` as the normal full stop/build/stamp/restart path. Run it once after all build-affecting edits and before the final response.
- Skip that release rebuild only when no build-affecting source changed, or when the user explicitly says not to rebuild/restart; state the exact reason in the final summary.
- Final summaries must state changed files, validation run, skipped validation reasons, and remaining risks.

Optional Memtrace policy
- Memtrace is explicit opt-in for FlowCell. Do not invoke any `memtrace-*` skill or MCP tool, run Memtrace Rail, start/index/repair Memtrace, or require Memtrace unless the user explicitly names Memtrace in the current request.
- Requests for code discovery, scope, impact, history, architecture, debugging, or refactoring do not imply permission to use Memtrace. Default to current repo files, narrow `rg`, bounded reads, focused docs, fresh logs, and live runtime validation.
- When the user explicitly asks for Memtrace, default to a read-only scope report and stop before editing unless the same request also asks for implementation. Verify that the index is current and confirm critical findings against current files or logs.
- If Memtrace is unavailable or stale, say so plainly. Do not silently substitute ordinary file search and present it as Memtrace output.

Command-output rules
- Never use unbounded `cat`, `rg`, `find`, `ls -R`, `git diff`, or test/build output.
- Use `head -c` / `tail -c` caps, or the PowerShell equivalent when needed.
- Preserve exit codes when validation matters.

Communication rules
- Before non-trivial edits, state the approach briefly.
- During complex work, keep updates short.
- Final summaries must be short and factual.

FlowCell implementation notes
- After changes affecting Blender add-ons, configs, generated actions, wrappers, or bridge files, state the required reload/restart/resync step.
- Check `flowcellbackend/local/logs`, status output, or relevant console output before guessing about runtime failures.
- Update `PROGRAM_SUMMARY.txt` whenever repo structure or FlowCell behavior changes.
</INSTRUCTIONS>
