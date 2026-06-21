# Organization Profiles

Organization Profiles are the dynamic Windows Files organization path.

- `Setup Organization` saves named profiles under `FlowCell/local/organization/profiles`.
- Each profile stores one project root plus role rows.
- A role contains a stable role ID, allowed file types, and a destination folder relative to the project root.
- `New Organization` reads the active profile by default and moves files whose extension maps to exactly one role.
- If one extension is assigned to multiple roles, the organizer leaves that file in place and logs it as ambiguous. Role-specific workflow buttons should pass a specific profile/role instead of guessing from extension alone.

To make a profile-specific organization button, copy `Programs/Windows/Windows Git Scripts/Files/new_organization_active_example.ps1`, rename it, and set:

```powershell
$ProfileId = 'your-profile-id'
```

Then add/copy that script into the desired Windows Files panel button location.
