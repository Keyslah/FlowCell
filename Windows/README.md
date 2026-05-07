# Windows Scripts

User-facing Windows scripts should live directly in this folder.

- Preferred filename prefixes: `file_`, `util_`, `org_`
- Prefixes do not affect routing or execution behavior.
- Machine-specific helper inputs should come from local environment overrides, not tracked personal paths.
- Use `examples/Windows/windows.env.example` as the public reference for Windows-only local overrides.
