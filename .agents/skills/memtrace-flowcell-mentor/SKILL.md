---
name: memtrace-flowcell-mentor
description: "Use when working in the FlowCell repo on coding help, fixes, debugging, refactors, architecture questions, button skins, panels, popouts, organization profiles, Blender bridge work, command-host work, layout work, script integration, or any FlowCell source change. Teaches Codex to use MemTrace MCP as the first navigation layer to find exact files, symbols, callers, dependencies, blast radius, and bounded source windows before broad file reads or edits."
---

# MemTrace FlowCell Mentor

Use MemTrace as the first navigation layer for FlowCell repo work. The goal is to find the exact owners and blast radius before reading large files or changing code.

## Source Of Truth

1. Read `PROGRAM_SUMMARY.txt` first.
2. Read only the relevant section of `docs/ai-skills.md`:
   - Start with `flowcell`.
   - Add specific sections only when relevant, such as `layout`, `toolsets`, `flowcell-fanout-buttons`, `blender-theme`, or `react-tauri-button-skin-contract`.
3. Prefer current repo files, fresh logs, and MemTrace results over chat memory.
4. For runtime failures, inspect relevant fresh logs under `flowcellbackend/local/logs` before guessing.
5. Do not write secrets, API keys, MemTrace tokens, credential-bearing dashboard URLs, or local-only machine paths into repo files.

## MemTrace First

1. Confirm MemTrace MCP is available. Inspect the active MCP/tool names before assuming exact names.
2. If available, call the repository listing tool first and identify the FlowCell `repo_id`.
3. Prefer MemTrace graph/search tools before file browsing:
   - code search for behavior descriptions, strings, errors, or concepts,
   - symbol search for known identifiers,
   - symbol context for callers, callees, imports, communities, and process membership,
   - relationship/dependency/caller lookup where available,
   - impact or blast-radius tools before edits,
   - bounded source-window reading for exact spans.
4. Do not open whole large files until MemTrace has narrowed the target.
5. If tool names differ, adapt to the exposed MCP surface; do not invent MemTrace results.

## Token-Saving Workflow

Use this order for FlowCell work:

1. Ask MemTrace what files and symbols own the requested behavior.
2. Ask MemTrace for callers, imports, dependencies, and blast radius.
3. Read only the smallest source windows needed.
4. Check current logs or runtime state only where the request depends on live behavior.
5. Propose or edit code only after ownership and impact are clear.

Avoid "read the whole frontend/backend" behavior unless MemTrace is unavailable or no narrower path exists.

## FlowCell Architecture Boundaries

Preserve the three-layer split:

- State Layer owns identity, persistence, bindings, script targets, panel membership, popout state, selected tabs, and `style_group_id`.
- Functional Host Layer owns command execution, selection, drag/reorder, context menus, popouts, validation, and dispatch.
- Visual Skin Layer owns appearance only.

Visual skins must not execute actions, mutate state, own bindings, own script targets, or control behavior. Imported visual code must stay render-only and sandboxed inside host surfaces.

Do not rename existing architecture fields such as `style_group_id`. Do not merge visual skin logic with functional button logic.

## Required Navigation Result

Before non-trivial edits, produce a short navigation result:

```text
Navigation result:
- Files likely involved: ...
- Symbols/functions/components likely involved: ...
- Likely blast radius: ...
- Smallest source windows to read: ...
- Validation needed: ...
```

Keep it concrete and tied to MemTrace results or current files. If MemTrace is unavailable, say that and identify the fallback evidence.

## Editing Rules

1. Make only the critical change.
2. Prefer existing FlowCell patterns.
3. Avoid broad refactors and speculative helpers.
4. Keep behavior in state/host layers and appearance in visual layers.
5. Do not touch unrelated local work.
6. Update `PROGRAM_SUMMARY.txt` when FlowCell behavior, structure, runtime paths, or architecture changes. Skill-only/documentation-only edits do not require an app build or `PROGRAM_SUMMARY.txt` update.

## Validation

Run the smallest useful validation for the touched surface:

- Frontend changes: run `npm run build` in `FlowCellFrontend`.
- PowerShell changes: parse-check changed PowerShell files.
- Blender Python changes: run `python -m py_compile` on changed Python files.
- Runtime behavior changes: inspect relevant fresh logs under `flowcellbackend/local/logs`.

State any required restart, reload, rescan, backend restart, frontend restart, or Blender add-on reload explicitly.

## If MemTrace Is Unavailable

Do not fake MemTrace results.

1. Say MemTrace is unavailable.
2. Fall back to `rg`, narrow file reads, `PROGRAM_SUMMARY.txt`, the relevant `docs/ai-skills.md` section, and current logs.
3. Keep the same navigation-result discipline.
4. Avoid broad guessing and large whole-file reads.
