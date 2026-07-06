# Contributing

## Ground Rules

- Keep the project rooted in this repository folder.
- Do not reorganize anything outside this folder.
- Update `PROGRAM_SUMMARY.txt` in the same change whenever FlowCell behavior, structure, or workflows change.
- Do not commit EXEs, logs, personal paths, private settings, or other mutable local state.
- Do not hardcode machine-specific absolute paths in tracked files. Resolve repo files relative to the current script, its folder, or the repository root instead.

## Repository Expectations

- Public source belongs in tracked folders such as `flowcellbackend/`, `FlowCellFrontend/`, `Programs/`, `docs/`, `examples/`, and `tools/`.
- Mutable runtime data belongs in `flowcellbackend/local/`, which is ignored by Git.
- Relative paths inside the repo are expected and normal. If you move files that other scripts resolve by location, update those references in the same change.

## Issues and Discussions

- Use GitHub Issues for bugs, regressions, broken scripts, and concrete feature requests.
- Use GitHub Discussions for questions, script ideas, workflow proposals, and early design feedback.
- If you are proposing a new script, call out the target folder in the discussion.

## Validation

- Parse-check PowerShell files before shipping changes.
- Keep launcher behavior working through `run.cmd` and `flowcellbackend/run.cmd`.
- If you touch panel import, layout persistence, or hotkey behavior, verify that local state still stays under `flowcellbackend/local/`.

## Pull Requests

- Describe user-facing changes and any local-state migration impact.
- Call out changes to panel behavior, hotkeys, bindings, popout layouts, or release packaging.
- Note whether `docs/`, `examples/`, and `PROGRAM_SUMMARY.txt` were updated.
