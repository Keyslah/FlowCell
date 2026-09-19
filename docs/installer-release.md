# Installer releases and catalog updates

The Windows installer release contains `flowcellwindowsinstaller.zip` and one
`FlowCell-<Program>.zip` for every tracked `Programs/*/flowcell.program.json`.
Current packages are Blender, Fresco, Fusion 360, Illustrator, Krita and Windows.
No new portable ZIP is produced by this release route.

## Installed storage

Tauri resources and the bundled AutoHotkey runtime live inside the application
installation. Start Menu launch runs the existing preflight and headless backend.
Writable data is `%APPDATA%\FlowCell\local`, including the existing canonical
`button-system/button-state.json`, bindings, layouts, logs and program data.
Program ZIPs retain `Programs/<ActualFolder>/...` archive roots and must be
extracted into that local root. Folder roles come from each program manifest.
Fresh launch creates only the empty `Programs/Windows` placeholder; without a
manifest it is not a valid registered program. Extraction and Add Program remain
separate. Neither upgrade nor normal uninstall removes this user data.

`FLOWCELL_LOCAL_ROOT` supplies the local root directly for development/tests.
With that override, program packages are under its `Programs` child. Without an
override, source and existing portable runs retain their existing backend-local
state and sibling Programs folder. No ignored development data is migrated.

## Optional Update Git Scripts Button

Every published program offers an ordinary `Update Git Scripts` Button in Files
through its manifest's managed setup contribution. Register program only installs
no Buttons. The contribution is optional, removable and never uses
`installIfMissing`. Users may instead create any personal panel, including Local,
and select the updater package or its declared entry with normal Add Button.

The owned installed copy identifies its program through its install record and
program manifest. Its packaged `updater.json` declares `Keyslah/FlowCell`, branch
`FlowCell`, program ID and exact remote catalog path. Each run resolves that ref
once, lists only the catalog subtree and downloads its files from that commit.
No Git installation, login, clone, upload or background poll is involved.
Blender and Fusion use Python entry points through their existing bridges,
Illustrator uses JSX, and Windows-script programs use PowerShell. Every package
carries its helper; Blender does not need the Windows package.

Downloads are staged, length/blob-hash verified and applied only after the full
listing succeeds. Truncated trees, network errors, links, unsafe paths and
concurrent runs fail closed. Shipped SHA256 baselines distinguish upstream edits
from local edits. Conflicts and unknown files survive; only unchanged managed
upstream deletions go to the Recycle Bin. Recovery and downloaded conflict copies
remain in `<local root>/catalog-updates/<program-path-hash>/`. An interrupted
apply is recovered on the next run; an unexpected edit during recovery is
preserved and reported for inspection.

The helper updates only the owning catalog and that sync metadata. It does not
install/execute downloaded scripts, run setup, change program manifests, or
replace owned Local Scripts copies (including its own). Existing managed-source
versions remain controlled by the program manifest. Normal Add Button uses a
native filesystem picker, so it sees downloaded sources directly without a
catalog cache or application restart.

## Authoring and validation

After adding a tracked publishable program manifest, run
`node release-tools/add-catalog-updaters.mjs --write`. This uses compatible
runner templates, adds an optional Files contribution and a tracked baseline
placeholder. Unknown runners are rejected until a compatible entry template is
provided. Default invocation validates the generated packages and their helper
contents. This publishing requirement never applies to arbitrary local programs
created with Any program.

Program packaging still copies only Git-tracked eligible content, rejects
mutable folders/reparse paths and validates manifest references. At staging it
fills the baseline placeholder with hashes of the actual delivered catalog
bytes. `verify-release.ps1` checks the complete ZIP inventory, baseline coverage,
hashes, declared script/tool-set source files and archive boundaries. Panels,
Local Scripts, runtime state, credentials and ignored files are not packaged.

## Reproducible build and publication

Use Windows, Node 22, the locked npm/Rust dependencies, and AutoHotkey 2.0.2 with
its GPL license. The workflow downloads the official runtime archive and checks
its pinned SHA256. Tauri's separate `tauri.installer.conf.json` enables per-user
NSIS packaging and WebView2's supported download bootstrapper. Internet access
is needed during setup if WebView2 is missing. No signing credentials are
configured; builds are unsigned.

Run `release-tools/build-installer.ps1` after committing all release source.
The tag-triggered/manual `Windows installer and program packages` workflow runs
frontend/native tests, isolated updater/path tests, builds all ZIPs, and silently
installs, launches from the Start Menu with an unrelated working directory,
upgrades and uninstalls on a disposable Windows runner. User-data sentinels must
survive. These are automated checks, not interactive installer or host-app tests.
The workflow uploads validated assets as `windows-installer-release`; it does
not publish a draft automatically. Download that successful run's artifact,
create a draft release for the exact tested tag, attach the complete ZIP set,
verify downloaded bytes against `SHA256SUMS.txt`, then publish. Preserve older
tags/releases and never move a release tag to fix a failed build.

Blender registration deploys its existing bridge/bootstrap and requires a Blender
restart/reload. Fusion registration deploys its existing add-in; restart Fusion
after add-in changes. Preserve package-specific Adobe setup notes. Restart
FlowCell after changing a program manifest. Catalog-only downloads need no host
reload until a user deliberately installs/updates a source that requires it.
