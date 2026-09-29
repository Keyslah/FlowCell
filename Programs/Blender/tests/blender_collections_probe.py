"""Exercise Collections in disposable factory-startup Blender, never the live scene.

blender --background --factory-startup --python-exit-code 1 --python <this file>
Optional -- <addon-directory> validates the deployed copy.
"""
import sys
import tempfile
from pathlib import Path

import bpy

addon = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else (
    Path(__file__).resolve().parent.parent / "Blender Addons - Copy contents Into Blender"
)
sys.path.insert(0, str(addon))
import flowcell_actions as actions

ctx = bpy.context
passed = []


def reset():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    return actions.ensure_root_structure(ctx.scene.collection)


def collection(name, parent=None):
    item = bpy.data.collections.new(name)
    (parent or ctx.scene.collection).children.link(item)
    return item


def obj(name, *homes, mesh=True):
    data = bpy.data.meshes.new(name) if mesh else None
    if mesh:
        data.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
    item = bpy.data.objects.new(name, data)
    for home in homes:
        home.objects.link(item)
    return item


def select(*items):
    bpy.ops.object.select_all(action="DESELECT")
    for item in items:
        actions.reveal_object_collection_paths(ctx, item)
        item.hide_set(False)
        item.select_set(True)
    ctx.view_layer.objects.active = items[-1] if items else None
    ctx.view_layer.update()


def snapshot(item, roots):
    select(item)
    assert actions.perform_snapshot(ctx) == "Saved 1 snapshot object(s)."
    bucket = actions.find_named_bucket(roots["Snapshots"], item.get(actions.TARGET_NAME_PROP, item.name))
    return actions.find_latest_version_object(bucket, "s")


for home_kind in ("external", "nested-live", "scene-root", "multi-linked"):
    roots = reset()
    if home_kind == "scene-root":
        homes = [ctx.scene.collection]
    elif home_kind == "nested-live":
        homes = [collection("Nested", roots["Live"])]
    else:
        homes = [collection("Nested", collection("Outside"))]
        if home_kind == "multi-linked":
            homes.append(collection("Second home"))
    original = obj("Subject", *homes)
    snap = snapshot(original, roots)
    assert set(original.users_collection) == set(homes)
    assert set(actions.stored_origin_collections(snap)) == set(homes)
    assert snap.data != original.data
    assert ctx.active_object == original and original.select_get() and snap.hide_get()
    original.location.x = 12
    result = actions.perform_cycle_live_versions(ctx)
    assert result["display"] == "s1" and ctx.active_object == snap and original.hide_get()
    result = actions.perform_cycle_live_versions(ctx, "backward")
    assert result["display"] == "original" and ctx.active_object == original and snap.hide_get()
    select(snap)
    actions.perform_restore(ctx)
    restored = bpy.data.objects["Subject"]
    assert set(restored.users_collection) == set(homes) and restored.location.x == 0
    assert original.name.startswith("(t1)") and original.hide_get()
    select(restored)
    actions.perform_back(ctx)
    assert set(bpy.data.objects["Subject"].users_collection) == set(homes)
    assert actions.find_named_bucket(roots["Snapshots"], "Subject") is None
    passed.append(home_kind + " snapshot/cycle/restore/back")

roots = reset()
home = collection("Rename me")
original = obj("Empty", home, mesh=False)
snap = snapshot(original, roots)
home.name = "Renamed home"
select(original)
actions.perform_trash(ctx)
assert bpy.data.collections.get("Renamed home") == home  # Home survives automatic cleanup.
select(snap)
actions.perform_restore(ctx)
assert tuple(bpy.data.objects["Empty"].users_collection) == (home,)
passed.append("renamed home/non-mesh/trash origin")

roots = reset()
home = collection("Archive home")
original = obj("Archive subject", home)
select(original)
actions.perform_archive(ctx)
archived = next(iter(roots["Archive"].all_objects))
select(archived)
actions.perform_snapshot(ctx)
snap = actions.find_latest_version_object(actions.find_named_bucket(roots["Snapshots"], "Archive subject"), "s")
assert actions.stored_origin_collections(snap) == [home]
actions.perform_restore(ctx)
assert tuple(bpy.data.objects["Archive subject"].users_collection) == (home,)
select(snap)
actions.perform_add_to_live(ctx)
added = roots["Live"].objects[0]
assert actions.stored_origin_collections(added) == [roots["Live"]]
passed.append("archive and stored snapshot origins/add-to-live")

roots = reset()
home = collection("Legacy home")
original = obj("Legacy.001", home)
unrelated = obj("Legacy", roots["Live"])
bucket = actions.ensure_named_bucket(roots["Snapshots"], original.name)
legacy = obj("(s1)Legacy.001", bucket)
select(legacy)
actions.perform_restore(ctx)
assert tuple(bpy.data.objects["Legacy.001"].users_collection) == (home,)
assert unrelated.name == "Legacy" and tuple(unrelated.users_collection) == (roots["Live"],)
passed.append("legacy external version/exact family isolation")

roots = reset()
bucket = actions.ensure_named_bucket(roots["Snapshots"], "Legacy")
legacy = obj("(s1)Legacy", bucket)
select(legacy)
actions.perform_restore(ctx)
assert tuple(bpy.data.objects["Legacy"].users_collection) == (roots["Live"],)
passed.append("legacy version fallback")

roots = reset()
home = collection("Source")
original = obj("Source object", home)
snap = snapshot(original, roots)
select(original, snap)
before = sorted(o.name for o in bpy.data.objects)
assert actions.perform_restore(ctx).startswith("Restore cancelled:")
assert before == sorted(o.name for o in bpy.data.objects)
passed.append("mixed restore remains non-mutating")

roots = reset()
outside = collection("Outside")
nested = collection("Nested", outside)
hidden = obj("Hidden", nested)
hidden.hide_render = True
outside.hide_viewport = True
loose = obj("Loose", ctx.scene.collection, mesh=False)
loose.hide_set(True)
stored = obj("Stored", collection("Bucket", roots["Snapshots"]))
actions.perform_make_layers(ctx)
assert set(ctx.scene.collection.children) == set(roots.values())
assert outside in list(roots["Live"].children) and nested in list(outside.children)
assert tuple(hidden.users_collection) == (nested,) and outside.hide_viewport and hidden.hide_render
assert tuple(loose.users_collection) == (roots["Live"],)
assert stored in list(roots["Snapshots"].all_objects)
actions.perform_make_layers(ctx)
assert len(roots["Live"].children) == 1
passed.append("make collections retains hidden hierarchy/storage/idempotence")

roots = reset()
home = collection("Saved home")
original = obj("Persistent", home)
snapshot(original, roots)
with tempfile.TemporaryDirectory(prefix="flowcell-collections-") as folder:
    path = str(Path(folder) / "origins.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    bpy.ops.wm.open_mainfile(filepath=path)
    roots = actions.ensure_root_structure(ctx.scene.collection)
    snap = actions.find_latest_version_object(actions.find_named_bucket(roots["Snapshots"], "Persistent"), "s")
    select(snap)
    actions.perform_restore(ctx)
    assert tuple(bpy.data.objects["Persistent"].users_collection) == (bpy.data.collections["Saved home"],)
passed.append("origin references survive blend save/reopen")

roots = reset()
home = collection("Linked home")
source = obj("Library source", home)
with tempfile.TemporaryDirectory(prefix="flowcell-library-") as folder:
    path = str(Path(folder) / "library.blend")
    bpy.data.libraries.write(path, {source})
    with bpy.data.libraries.load(path, link=True) as (available, loaded):
        loaded.objects = ["Library source"]
    linked = loaded.objects[0]
    home.objects.link(linked)
    assert not linked.is_editable
    snap = snapshot(linked, roots)
    assert snap.library is None and snap.data.library is None
    assert actions.stored_origin_collections(snap) == [home]
passed.append("read-only library object can be snapshotted")

print("COLLECTIONS_PROBE_OK", len(passed), passed, flush=True)
