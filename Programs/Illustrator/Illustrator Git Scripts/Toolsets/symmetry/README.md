# Illustrator Symmetry Tool Set

Import this catalog package through FlowCell **Add Button**. FlowCell copies the
complete package into the Button-owned Illustrator Local Scripts folder; that
installed `source/` copy is the only code and launcher used at runtime. State,
commands, status, watcher records, and logs stay in that same owner's
`runtime/` folder.

Use **Update selected Button content** for an installed owner rather than
adding another Symmetry Button. Update and Delete first run the package's
owner-scoped stop lifecycle and wait for its watcher mutex to release before
the old source package can move.

If that stop succeeds but a later Update or Delete transaction fails, Symmetry
remains Off deliberately. Recover or retry the owner transaction before
turning it on again; this prevents an outdated watcher from running against a
partly changed package.

An owner installed from version 1.0 has no stop lifecycle in its own package.
FlowCell therefore refuses to Delete that legacy owner until it has first been
updated to version 1.1 through **Update selected Button content**.

## Detection limitation

Illustrator scripting does not expose a reliable active-tool identity, so this
package cannot prove that a completed path came from the Pencil Tool. While
Symmetry is on, it reacts to a primary-button release followed by one newly
created or changed eligible vector path. It deliberately skips ambiguous
multi-path changes rather than risk modifying unrelated artwork. Avoid editing
other eligible paths during a Pencil stroke, and give the watcher a moment to
baseline a newly opened document before the first stroke.

Generated symmetry copies carry the private `FlowCellSymmetryCopy` tag and are
ignored as future sources. They remain normal editable Illustrator paths.
