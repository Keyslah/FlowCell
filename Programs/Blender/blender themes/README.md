# Blender themes in FlowCell releases

Every build of the release asset **FlowCell-Blender.zip** reads the saved themes
folder again and includes all its theme packages and their referenced images.
New themes and edits saved through **Save Package** are included automatically.
Removed themes stay removed. There is no separate snapshot to refresh or commit.

The source folder is configured in the ignored
`flowcellbackend/local/program-package-sources.json`:

```json
{
  "blenderThemeLibrary": "C:/path/to/FlowCell/local/blender_themes"
}
```

Both `release-tools/package-portable.ps1` and `release-tools/build-installer.ps1`
also accept `-BlenderThemeLibrary` to select a different saved library explicitly.
A missing configuration or source folder stops the release build before it
creates release assets. Missing images or invalid packages also stop packaging.
Old exported copies cannot silently substitute for the saved themes folder.
Backups and unrelated files are excluded; saved themes are never modified.

Inside the ZIP, complete packages are placed under
`Programs/Blender/blender themes/Packages/`, with relative image references so
they work after extraction on another computer. Use Theme's **Open Package** to
open a `.flowcell-theme-pack.json`. `Buckets/` contains separate palette saves.

Any build runner must have the actual source folder available. The GitHub
workflow requires `FLOWCELL_BLENDER_THEME_LIBRARY` to point to that folder on its
runner and stops immediately if it is unavailable. A hosted runner cannot read
this computer's files automatically; it never falls back to older repository data.
