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
- Final summaries must state changed files, validation run, skipped validation reasons, and remaining risks.

Command-output rules
- Never use unbounded `cat`, `rg`, `find`, `ls -R`, `git diff`, or test/build output.
- Use `head -c` / `tail -c` caps, or the PowerShell equivalent when needed.
- Preserve exit codes when validation matters.

Communication rules
- Before non-trivial edits, state the approach briefly.
- During complex work, keep updates short.
- Final summaries must be short and factual.

FlowTest architecture guardrails
- Because this repository root is `FlowTest`, these FlowTest-specific rules apply repo-wide unless a deeper `AGENTS.md` overrides them.
- Preserve the three-layer split: State Layer, Functional Host Layer, Visual Skin Layer.
- State owns identity, persistence, bindings, script targets, panel membership, popout state, selected tabs, and `style_group_id`.
- Functional Host owns button execution, selection, drag/reorder, context menus, popouts, validation, and dispatch.
- Visual Skin owns appearance only.
- Visual Skin must never execute actions, mutate state, own bindings, own script targets, or control behavior.
- `style_group_id` is the only saved/internal style assignment field.
- Imported HTML/CSS/React/JSX/TSX/Tailwind/SVG visual code must remain render-only and sandboxed inside host surfaces.
- Do not create visual preview systems unless explicitly requested.
- Do not merge visual code with functional button logic.
- Do not rename architecture fields or invent alternate state fields.
- Keep FlowTest behavior equal to FlowCell unless the task explicitly says FlowTest should diverge.
- After changes affecting Blender add-ons, configs, generated actions, wrappers, or bridge files, state the required reload/restart/resync step.
- Check `FlowCell/local/logs`, status output, or relevant console output before guessing about runtime failures.
- Update `PROGRAM_SUMMARY.txt` whenever repo structure or FlowCell/FlowTest behavior changes.
</INSTRUCTIONS>
