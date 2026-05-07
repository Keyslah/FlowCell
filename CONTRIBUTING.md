# Contributing

## Ground Rules

- Keep the project rooted in this repository folder.
- Do not reorganize anything outside this folder.
- Update `PROGRAM_SUMMARY.txt` in the same change whenever FlowCell behavior, structure, or workflows change.
- Do not commit EXEs, logs, personal paths, private settings, or other mutable local state.
- Do not hardcode machine-specific absolute paths in tracked files. Resolve repo files relative to the current script, its folder, or the repository root instead.

## Repository Expectations

- Public source belongs in tracked folders such as `FlowCell/`, `Blender/`, `Illustrator/`, `Windows/`, `Photoshop/`, `docs/`, `examples/`, and `tools/`.
- Mutable runtime data belongs in `FlowCell/local/`, which is ignored by Git.
- Blender FlowCell button wrappers belong in `Blender/FlowCellButtons/`.
- Illustrator user-facing scripts should stay directly in `Illustrator/`.
- Windows user-facing scripts should stay directly in `Windows/`.
- Photoshop repo-safe public scripts should stay directly in `Photoshop/`.
- Internal Illustrator helpers belong in `Illustrator/HelperScripts/`.
- Relative paths inside the repo are expected and normal. If you move files that other scripts resolve by location, update those references in the same change.

## Script Naming

- Optional prefixes are `file_`, `util_`, and `org_`.
- Use `org_` for organization actions, `file_` for file-oriented scripts, and `util_` for utility scripts.
- These prefixes are for file organization and display cleanup only.
- Do not build routing logic around filename prefixes.

## Issues and Discussions

- Use GitHub Issues for bugs, regressions, broken scripts, and concrete feature requests.
- Use GitHub Discussions for questions, script ideas, workflow proposals, and early design feedback.
- If you are proposing a new script, call out the target folder and intended prefix in the issue or discussion.

## Validation

- Parse-check PowerShell files before shipping changes.
- Keep launcher behavior working through `run.cmd` and `FlowCell/run.cmd`.
- If you touch panel import, layout persistence, or hotkey behavior, verify that local state still stays under `FlowCell/local/`.

## Pull Requests

- Describe user-facing changes and any local-state migration impact.
- Call out changes to panel behavior, hotkeys, bindings, popout layouts, or release packaging.
- Note whether `docs/`, `examples/`, and `PROGRAM_SUMMARY.txt` were updated.
