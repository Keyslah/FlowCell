# Illustrator Scripts

Illustrator now separates public library sources from managed active installs.

- `Illustrator Scripts/` is the public downloadable library/source folder.
- `Illustrator Active Scripts/` is the managed install target that FlowTest owns.
- FlowTest syncs runnable copies from the active folder into Illustrator's required Scripts runtime folder.
- Preferred filename prefixes: `file_`, `util_`, `org_`
- Prefixes are display-only in FlowCell.
- Internal helper scripts belong in `HelperScripts/`.
