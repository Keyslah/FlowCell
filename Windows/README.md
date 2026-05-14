# Windows Scripts

Windows now separates public library sources from managed active installs.

- `Windows Scripts/` is the public downloadable library/source folder.
- `Windows Active Scripts/` is the managed install target that FlowTest buttons execute from.
- `ScriptBank/` remains only as a legacy compatibility folder.
- Preferred filename prefixes: `file_`, `util_`, `org_`
- Prefixes do not affect routing or execution behavior.
- Machine-specific helper inputs should come from local environment overrides, not tracked personal paths.
- Use `examples/Windows/windows.env.example` as the public reference for Windows-only local overrides.
