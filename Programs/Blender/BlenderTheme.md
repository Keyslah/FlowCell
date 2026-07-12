# Blender Theme Tool Set

Blender Theme is a manifest-defined tool set. Its catalog package is:

```text
Blender Git Scripts/Toolsets/theme/
|-- flowcell.toolset.json
`-- theme.py
```

The imported owner and children use the shared canonical Button host and
tool-set popout. Explicit manifest selection and the installed active record
define the package; the shared host does not infer package identity.

## Install And Ownership

Use Add Tool Set in the Buttons Editor and select `flowcell.toolset.json`.
FlowCell creates a new owner and copies the complete catalog package into:

```text
Blender Local Scripts/<ownerButtonId>/source/
```

That owned copy is the installed runtime source of truth. The matching active
record is:

```text
Panels/<Panel>/<ownerButtonId>.flowcell-source.json
```

Canonical Button state owns the owner and child identities, skins, placements,
tool-field definitions, tool-set surface, and popout bounds. Blender deployment
creates an owner-scoped bridge action from the installed source. Editing the Git
Scripts package does not modify an installed Theme Button; use Update for the
same owner when the catalog package should replace the installed copy.

Deleting the owner removes its children, placements, popout, bindings, active
record, Local Scripts package, and generated bridge artifacts through the
rollback-capable Recycle Bin lifecycle. The catalog package remains.

## Manifest-Declared Controls

`flowcell.toolset.json` declares every child slot, field, payload, and starter
geometry. FlowCell core provides only shared host services and does not identify
Theme by its filename.

Theme controls:

- `Browse` selects `theme_image_path`, samples the image through the registered
  core action, and stages the returned colors.
- `Absorb Theme` reads Blender's current theme into declared fields.
- `Save Buckets` and `Load Buckets` save or load declared field values as JSON.
- `Dark Theme` and `Light Theme` change the staged visual mode without calling
  Blender.
- `Apply` sends the declared theme colors and visual mode through the installed
  owner bridge action.

Place Picture controls:

- `Place Picture`, `Grid`, `Browse`, `Startup`, and `Clear` operate on the
  declared image-path and grid fields.
- Near spacing, distance, and far spacing are ordinary manifest fields included
  in the child payloads.

HDRI controls:

- `HDRI Apply`, `HDRI Browse`, `Clear`, and `Reset` manage the world image.
- `X`, `Y`, `Z`, and `WS` apply the declared rotation and strength fields.

The package declares the `restore-project-theme-state` capability in
`bridgeData`. Blender startup restoration resolves that installed capability;
it does not depend on a hardcoded Theme action name.

## Validation And Reload

After changing the catalog package:

1. Parse `flowcell.toolset.json` and compile-check `theme.py`.
2. Use Update in the Buttons Editor to replace the intended owner's installed
   package and deployment artifacts.
3. Reload the FlowCell Blender add-on or restart Blender before runtime testing.

See [`../../docs/blendertheme.md`](../../docs/blendertheme.md) for the user
workflow and [`../../docs/flowcell-toolset-manifest.md`](../../docs/flowcell-toolset-manifest.md)
for the general package contract.
