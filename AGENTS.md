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
- When a FlowCell change requires a new build, automatically run that build before finishing the task.
- Final summaries must state changed files, validation run, skipped validation reasons, and remaining risks.

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
- Check `FlowCell/local/logs`, status output, or relevant console output before guessing about runtime failures.
- Update `PROGRAM_SUMMARY.txt` whenever repo structure or FlowCell behavior changes.
</INSTRUCTIONS>
