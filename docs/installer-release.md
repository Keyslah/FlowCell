# Installer releases and catalog updates

The Windows installer release contains `flowcellwindowsinstaller.zip` and one
`FlowCell-<Program>.zip` for every tracked `Programs/*/flowcell.program.json`.
Current packages are Blender, Fresco, Fusion 360, Illustrator, Krita and Windows.
For a Windows Core and Blender-only release, run
`release-tools/build-installer.ps1 -ProgramNames Blender -OutputDirectory <fresh-folder>`.
This produces only `flowcellwindowsinstaller.zip`, `FlowCell-Blender.zip` and
`SHA256SUMS.txt`. Omit `-ProgramNames` to retain the complete program set.
No new portable ZIP is produced by this release route.
Windows is also included in the Core installer, so initial Windows setup does
not depend on downloading its separate catalog ZIP.

## Installed storage

Tauri resources and the bundled AutoHotkey runtime live inside the application
installation. Setup starts the installed headless backend and registers the
per-user `FlowCell Background.lnk` Windows startup shortcut. Setup includes a
checked-by-default **Windows Files panel**, **Windows Utility panel**, and
**Toggle AutoHotkey desktop shortcut** options on its welcome page. **Windows
Startup panel (required)** is checked and cannot be disabled. Silent installation
uses the same defaults (`/NS` suppresses desktop
shortcuts). The toggle's Windows Script Host launcher, PowerShell script, green
ON/red OFF icons, and AutoHotkey runtime are bundled in the application; neither
the toggle nor background startup needs a checkout, development tools, or the UI.
Startup panel shortcuts and Temp Shots continue running when the frontend is closed
while AutoHotkey is ON. Start Menu launch runs the
existing preflight and connects to that same installed background backend.
Writable data is `%APPDATA%\FlowCell\local`, including the existing canonical
`button-system/button-state.json`, bindings, layouts, logs and program data.
When a packaged launcher redirects AppData, an existing canonical Button-state
file identifies the physical data root so Programs and their children resolve
consistently instead of mixing redirected contents with empty directory shadows.
Installed executable updates must use the payload embedded in the NSIS bundle:
Tauri restores the loose release executable's bundle marker after packaging, so
copying that loose executable into an installation loses installed-mode detection.
Program ZIPs retain `Programs/<ActualFolder>/...` archive roots. Add Program's
**Import program ZIP** validates and stages one package into the resolved program
root, then selects it for the existing registration plan. It does not execute the
package. Existing files are never overwritten; directory-only placeholders are
preserved. Manual extraction into that local root remains available for older
releases. Folder roles come from each program manifest.
The installer carries a tracked, immutable Windows catalog at
`bundled-programs/Windows` under its resource root. Setup saves the panel choices
in `installation-defaults/windows-panels.json` in the local data root. Initial
Core launch registers Windows and installs those panels automatically using the
managed setup transaction. A compact progress/error notice replaces the blocking
installation dialog; there is no separate Windows download or EXE picker. Its writable catalog,
panels and owned scripts use the normal local Programs root. After setup the user
may delete panels or Windows itself without normal launches adding them back.
Existing configured Windows programs are preserved on upgrade. Other programs
retain the separate import and registration steps in Add Program. Neither upgrade
nor normal uninstall removes this user data.

### Current Program profiles and package verification

Every Program ZIP is prepared from the current canonical saved setup. Release
resolves its donor from `-ProgramLocalRoot`, then `FLOWCELL_PROGRAM_LOCAL_ROOT`,
then the installed `%LOCALAPPDATA%/Programs/FlowCell/flowcell.runtime.json`
`localRoot`. Missing or invalid selected roots stop release; there is no fallback
to a development profile. A program without saved configuration in that root
cannot be released as a matching profile. Hosted CI must provision that root and
set `FLOWCELL_PROGRAM_LOCAL_ROOT` before the workflow starts; a path string alone
does not transfer the profile to a hosted runner.

The shared `prepare-program-profile.mjs` reads the current saved revision,
installed source records, scripts and companion files, and local skin families.
It matches stable source identities or unique exact execution matches, never
visible labels. Uncataloged controls, altered scripts, missing helpers, ambiguous
legacy identities, command/field mismatches, and missing skin families stop the
release with the affected source identified. An optional `-ProgramOwnerMap` can
resolve audited legacy identities; it cannot bypass content comparison.
The producer captures a fresh preset and source selections into staging for
each release, so a later saved label, state cycle, skin, color or arrangement is
included without manually updating a Blender-specific snapshot. Original saved
data and repository catalogs are not rewritten by this preparation.

The staged manifest declares `defaultTheme` as a package-relative immutable JSON
file under its support directory, outside the saved theme-library replacement directory. Add
Program selects its source dependencies and offers **Use packaged appearance and
layout**, checked by default. The preset restores the captured Button skins and
numbered variants, labels, state cycles, text settings, colors, highlights, glow,
panel ordering, and Pop/Fan arrangements through the existing portable-theme
importer in the same canonical setup commit. Execution still comes only from the
normal declared source installer. Missing source versions or moved dependencies
fail before installation; existing saved settings for that Program require
turning the preset off instead of being overwritten.

`FlowCellProgramAppearance` version 1 stores repeated skin sections and variants
once in literal JSON dictionaries; it does not alter their source.
`default-appearance-provenance.json` records the donor revision/hash, captured
counts and checked source hashes. Every captured occurrence is imported into a
fresh recipient model using production installation, surface preparation and
theme application logic, then compared for exact presentation, skin variants,
field geometry and arrangements. Command targets and field definitions must
survive unchanged. Inputs are checked again before preparation succeeds.

For a read-only check, first compile the production test modules from
`FlowCellFrontend` with `node_modules/.bin/tsc -p tsconfig.button-tests.json`, then
run `node release-tools/prepare-program-profile.mjs --program-root Programs/<name>
--local-root <saved-local-root>` from the repository root. The release driver
performs this compilation itself and supplies a separate staging output folder.
The older Blender-only capture helper remains an explicit catalog-maintenance
utility; release does not use its frozen preset as the donor.

After staging substitutions, `flowcell.package.json` inventories every immutable
file by relative path, exact byte count and SHA-256. Release compares the archive
to that exact inventory before publishing; the separate release verifier repeats
the check. Native import validates the complete inventory and default appearance
before committing the incoming directory. Missing, added, truncated or changed
files fail. Older ZIPs without an inventory remain importable for compatibility;
they do not receive this new byte-integrity guarantee. This proves the selected
profile and packaged contents, not execution inside every host version or target
computer; host runtime and live UI verification remain separate checks.

The required Windows Startup panel uses the usual Button ownership,
scripts and bindings. Setup preserves existing panel choices and settings.
Sign-in registration passes `--logon` to the installed background launcher,
which explicitly enables AutoHotkey for a new Windows sign-in and reuses an existing
backend. Manual OFF remains in force throughout that session, including UI launch,
upgrade, binding saves, sleep and unlock. Turning ON restores stopped scripts and
current Startup bindings. Setup's immediate background start is an ordinary launch,
so upgrading does not override a current-session OFF choice. The desktop icon is
based on observed AutoHotkey processes; setup failures are reported by the installer.

Source and existing portable runs retain their own backend-local state and
sibling Programs folder. Their development backend does not register global
shortcuts. Normal launch derives its role and roots from its own resources,
discarding inherited roots from another FlowCell copy. Explicit environment
overrides are available only to fixture definitions/tests. No ignored
development data is migrated.

## Optional Update Git Scripts Button

Every published program offers an ordinary `Update Git Scripts` Button in Files
through its manifest's managed setup contribution. Register program only installs
no Buttons. The contribution is optional, removable and never uses
`installIfMissing`. Users may instead create any personal panel, including Local,
and select the updater package or its declared entry with normal Add Button.

The owned installed copy identifies its program through its install record and
program manifest. Its packaged `updater.json` declares `Keyslah/FlowCell`, branch
`main`, program ID and exact remote catalog path. Each run resolves that ref
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

Program packaging copies Git-tracked eligible content, rejects
mutable folders/reparse paths and validates manifest references. At staging it
fills the baseline placeholder with hashes of the actual delivered catalog
bytes. `verify-release.ps1` checks the complete ZIP inventory, baseline coverage,
hashes, declared script/tool-set source files and archive boundaries. Panels,
Local Scripts, runtime state, credentials and ignored files are not packaged.

Blender's saved theme library is the explicit data exception: staging reads
`blenderThemeLibrary` from the ignored
`flowcellbackend/local/program-package-sources.json`, or an explicit
`-BlenderThemeLibrary` argument to either packaging driver. Each build collects
the current saved packages and only their referenced image assets into
`Programs/Blender/themes/Blender/`. Newly saved themes and updated images
are included automatically in **FlowCell-Blender.zip**, the same program ZIP
attached to FlowCell releases. Removed themes are not restored from older
exports. Manifest image paths are made relative in the staged copies. Saved
themes and source files are never modified. Missing source configuration or a
missing source folder stops both release entry points before they build or write
release assets. Invalid packages or missing images stop packaging.

There is no repository snapshot fallback or manual snapshot-refresh step.
Every build runner needs access to the actual saved themes folder. The GitHub
workflow checks the repository variable `FLOWCELL_BLENDER_THEME_LIBRARY` as a
runner-accessible folder before starting the build. Hosted runners cannot access
this machine's saved library, so the workflow stops unless that source folder is
made available to the runner. See the [theme library notes](../Programs/Blender/blender%20themes/README.md).

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
checks the installed sign-in shortcut and background backend independently of
the UI, upgrades and uninstalls on a disposable Windows runner. User-data sentinels must
survive. These are automated checks, not interactive installer or host-app tests.
The workflow uploads validated assets as `windows-installer-release`; it does
not publish a draft automatically. Download that successful run's artifact,
create a draft release for the exact tested tag, attach the complete ZIP set,
verify downloaded bytes against `SHA256SUMS.txt`, then publish. Preserve older
tags/releases and never move a release tag to fix a failed build.

For an installer built locally with the saved theme library, attach the complete
validated ZIP set (the selected program set when `-ProgramNames` was used) and
`SHA256SUMS.txt` to a draft release, then dispatch
**Validate prebuilt Windows installer** with that release tag and the installer's
ZIP SHA256. This workflow checks out the tag, downloads only
`flowcellwindowsinstaller.zip`, verifies its exact hash and archive boundary, and
runs the same install, Start Menu launch, backend, upgrade and uninstall smoke
test on a disposable Windows runner. It does not rebuild packages or require the
saved theme folder on that runner. Review the run and its
`prebuilt-windows-installer-smoke` diagnostics before publishing. This process
checks unattended installation and bootstrap; Windows panel choices and host-app
interaction still require their separate regression and manual checks.

Blender registration deploys its existing bridge/bootstrap and requires a Blender
restart/reload. Fusion registration deploys its existing add-in; restart Fusion
after add-in changes. Preserve package-specific Adobe setup notes. Restart
FlowCell after changing a program manifest. Catalog-only downloads need no host
reload until a user deliberately installs/updates a source that requires it.

First startup registration creates `flowcell.runtime.json` beside the executable
with the resolved physical writable `localRoot`; existing configuration survives
upgrades. Native startup and backend helpers honor this config ahead of inherited
environment. The resolver follows the physical canonical Button-state file when
AppData is redirected, keeping Explorer and packaged launches on the same data.
`HKCU\Software\FlowCell\InstalledResourceRoot` lets standalone installed script
launchers find this backend while the frontend is closed. Uninstall removes only
its own registry pointer and recycles its owned startup and AutoHotkey desktop
shortcuts. The data folder
and existing runtime configuration are preserved.
Registration also recognizes the old `FlowCell Hotkeys Startup.vbs` only when
its literal target resolves to an existing FlowCell backend launcher. It moves
that entry unchanged into `local/backups/startup-migration/<timestamp-id>/`
and stops only the corresponding legacy headless backend lacking an explicit
role. Unrelated startup entries and modern development backends are preserved.
