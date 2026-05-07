# Security Policy

## Reporting

If you find a security issue, do not open a public issue with secrets, private paths, or exploit details. Report it privately to the maintainers first.

## Scope

Security-sensitive areas for this repository include:

- local settings under `FlowCell/local/private/`
- bridge folders or automation paths for external tools
- script execution and launcher flows
- packaged release artifacts

## Public Issue Hygiene

- Remove personal paths, account names, secrets, and machine-specific config before sharing logs or repro steps.
- Do not attach files from `FlowCell/local/` unless they have been sanitized first.
