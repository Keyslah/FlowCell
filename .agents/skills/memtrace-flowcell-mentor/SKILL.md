---
name: memtrace-flowcell-mentor
description: "Opt-in, read-only MemTrace scope analysis for FlowCell. Use only when the user explicitly names MemTrace in the current request or invokes $memtrace-flowcell-mentor. Do not trigger for ordinary FlowCell coding, debugging, refactoring, impact, architecture, history, or exploration requests. When explicitly invoked, map owners, execution paths, callers, dependencies, blast radius, and validation scope before any separately requested implementation."
---

# MemTrace FlowCell Scope

Use MemTrace only for an explicitly requested FlowCell scope pass. Default to a read-only navigation report and stop before editing unless the same user request also asks for implementation.

## Activation Gate

1. The current request must explicitly name `MemTrace` or invoke `$memtrace-flowcell-mentor`.
2. A request for scope, impact, architecture, history, debugging, or refactoring alone is not opt-in.
3. Without explicit opt-in, do not call MemTrace, start or repair its runtime, or frame the task around MemTrace. Use current repo files, narrow `rg`, focused docs, fresh logs, and live runtime evidence.
4. If MemTrace is unavailable or stale after explicit opt-in, say so. Do not silently replace it with file search and label the result as MemTrace output.

## Manual Session

For a deliberate scope session, have the user run these commands from the FlowCell root:

```powershell
memtrace doctor
memtrace index .
memtrace start --headless
```

If `memtrace doctor` reports stale runtime state, explain that
`memtrace doctor --fix` performs immediate cleanup and wait for authorization
before running it. Wait for `memtrace index .` to finish, then leave
`memtrace start --headless` running so MemDB and the file watcher stay live.
Open a new Codex task and explicitly invoke this skill. When finished, stop the
runtime with `Ctrl+C` in that terminal or run `memtrace stop` from the same
FlowCell directory. Do not use `--clear` for a routine scope pass.

## Source Of Truth

1. Read `PROGRAM_SUMMARY.txt` first.
2. Read only the relevant section of `docs/ai-skills.md`:
   - Start with `flowcell`.
   - Add specific sections only when relevant, such as `layout`, `toolsets`, `flowcell-fanout-buttons`, `blender-theme`, or `react-tauri-button-skin-contract`.
3. For Button, panel, popout, fan, skin, or script-install work, read the
   canonical ownership map in `docs/buttons.md` before inspecting old history.
4. Prefer current repo files and fresh logs over chat memory. Treat MemTrace as a navigation aid, not runtime truth.
5. For runtime failures, inspect relevant fresh logs under `flowcellbackend/local/logs` before guessing.
6. Do not write secrets, API keys, MemTrace tokens, credential-bearing dashboard URLs, or local-only machine paths into repo files.

## Explicit Scope Workflow

1. Confirm MemTrace MCP is available and identify the FlowCell `repo_id`.
2. Check the repository's last-indexed time and active watcher before relying on graph results.
3. Use MemTrace graph/search tools for the requested scope:
   - code search for behavior descriptions, strings, errors, or concepts,
   - symbol search for known identifiers,
   - symbol context for callers, callees, imports, communities, and process membership,
   - relationship/dependency/caller lookup where available,
   - impact or blast-radius tools before edits,
   - bounded source-window reading for exact spans.
4. Verify critical owners and runtime-sensitive claims against bounded current source, config, or fresh logs.
5. Do not edit during a scope-only request. If implementation was also requested, read only the smallest source windows needed before editing.
6. If tool names differ, adapt to the exposed MCP surface; do not invent results.

## Scope Report

Return:

- likely owner files and symbols,
- execution path and important callers/dependencies,
- blast radius and historical coupling when relevant,
- any stale-index or cannot-prove limitations,
- smallest current source/log windows to verify,
- validation and restart/reload scope.

Stop after the report unless implementation was explicitly requested in the same request.

## FlowCell Architecture Boundaries

Preserve the canonical Button split under `FlowCellFrontend/src/button/`:

- The state layer owns stable Button/source identities, execution targets,
  placements, surfaces, skins, popout units, fan setups, and persistence in
  `flowcellbackend/local/button-system/button-state.json`.
- The functional host layer owns execution, selection, drag/reorder, context
  menus, window behavior, validation, field services, and dispatch.
- The visual skin layer owns render-only HTML/inline SVG, declaration sections,
  and finite decorative animation.

Visual skins must not execute actions, mutate state, own bindings, own script targets, or control behavior. Imported visual code must stay render-only and sandboxed inside host surfaces.

The skin's single `[data-core]` element, after the real label is inserted, is
the actual interactive geometry. `ButtonHost` attaches input behavior directly
to that element; never add a host overlay or second hitbox.

Git Scripts is a catalog only. Add/import copies the selected source or package
into `<Program> Local Scripts/<ownerButtonId>/source/`; that owned copy is the
installed runtime truth. `Panels/<Panel>/<ownerButtonId>.flowcell-source.json`
is the only active source record. Deleting a Button removes its whole owned
graph, active record, Local package, bindings, and owned bridge artifacts
transactionally through the Recycle Bin path.

Do not recreate `LegacyButton`, style groups, `style_group_id`, old toolbox
pages, old fan/popout renderers, flat Local execution, config-driven button
inventories, or `.flowcell-panel-item.json` runtime readers. Pre-cutover records
and comment directives may be read only inside the one-time
`program_sources/migrate.rs` bootstrap.

## Required Navigation Result

For an explicitly requested MemTrace pass, produce:

```text
Navigation result:
- Files likely involved: ...
- Symbols/functions/components likely involved: ...
- Likely blast radius: ...
- Smallest source windows to read: ...
- Validation needed: ...
```

Keep it concrete and distinguish MemTrace graph evidence from current-file/log verification.

## Editing Rules

These rules apply only when the same request explicitly asks for implementation after or alongside the MemTrace scope pass.

1. Make only the critical change.
2. Prefer existing FlowCell patterns.
3. Avoid broad refactors and speculative helpers.
4. Keep behavior in state/host layers and appearance in visual layers.
5. Do not touch unrelated local work.
6. Update `PROGRAM_SUMMARY.txt` when FlowCell behavior, structure, runtime paths, or architecture changes. Skill-only/documentation-only edits do not require an app build or `PROGRAM_SUMMARY.txt` update.

## Validation

Run the smallest useful validation for the touched surface:

- Button changes: run `npm run test:button` and `npx tsc --noEmit` in
  `FlowCellFrontend`.
- Frontend release changes: run the requested Tauri build before finishing.
- Rust/Tauri changes: run `cargo fmt --check`, `cargo check`, and `cargo test`.
- PowerShell changes: parse-check changed PowerShell files.
- Blender Python changes: run `python -m py_compile` on changed Python files.
- Runtime behavior changes: inspect relevant fresh logs under `flowcellbackend/local/logs`.

State any required restart, reload, rescan, backend restart, frontend restart, or Blender add-on reload explicitly.

## If MemTrace Is Unavailable

Do not fake MemTrace results.

1. Say MemTrace is unavailable.
2. If the user requested only MemTrace scope, stop and provide the manual start/retry instructions.
3. Fall back to `rg`, narrow file reads, `PROGRAM_SUMMARY.txt`, the relevant `docs/ai-skills.md` section, and current logs only when the user also requested or accepts a local-file scope pass.
4. Label any fallback clearly as local-file evidence, not MemTrace output.
