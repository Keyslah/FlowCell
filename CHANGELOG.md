# Changelog

## 0.1.13

- Open the Main Page Add picker directly in the selected Program's Git Scripts folder.
- Remove the Open Chrome Workspace and Save Chrome Workspace Buttons from Windows catalogs and release packages.
- Improve Screenshots setup, Main Button spacing, and Program executable discovery.
- Update popped Button colors and the Blender Theme page, including scatter and full-width color swatches.

## Unreleased

- Fixed portable Blender bridge discovery so valid installed addons work without a machine-local `automation.bridgeFolder`, with explicit diagnostics and a bridge health command.
- Made normal Blender panel actions fire-and-forget with stale request cleanup and unique request IDs so an inactive bridge cannot freeze FlowCell.
- Fixed the Blender polling timer crashing at startup and being invalidated after one action; Make Layers now moves visible objects into Live so Snapshot works immediately afterward.
- Prepared FlowCell for a public GitHub repository layout with tracked source, docs, examples, tools, and release notes.
- Moved mutable runtime data into ignored `flowcellbackend/local/` storage.
- Updated the main panel `Add Script` flow to open in the current program folder, support multi-select, and add buttons only to the currently selected panel.
- Added display-only filename prefix stripping for `file_`, `util_`, and `org_`.
- Moved the optional launcher source into `tools/launcher/` and removed the built EXE from the publishable repo path.
- Replaced tracked personal Windows helper paths with documented local environment overrides and added a public example override file.
