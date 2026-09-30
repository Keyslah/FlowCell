# Description: Fill both center openings of selected Extra Mesh Objects gears, keeping their teeth and transforms. Undo restores the openings.

import bmesh
import bpy
from mathutils.geometry import normal


def _center_rims(bm):
    """Accept the generator's two planar, closed rims; reject damaged meshes."""
    boundary = {edge for edge in bm.edges if edge.is_boundary}
    if not boundary:
        raise ValueError("The gear has no open center rims (it may already be filled).")
    if any(not edge.is_manifold and not edge.is_boundary for edge in bm.edges):
        raise ValueError("The gear has loose or non-manifold edges.")
    loops = []
    remaining = set(boundary)
    while remaining:
        start = next(iter(remaining)).verts[0]
        current = start
        loop = []
        previous = None
        while True:
            edges = [edge for edge in current.link_edges if edge in boundary]
            if len(edges) != 2:
                raise ValueError("The center rims are not simple closed loops.")
            edge = next(edge for edge in edges if edge != previous)
            if edge not in remaining:
                raise ValueError("The center rims intersect.")
            remaining.remove(edge)
            loop.append(current)
            current = edge.other_vert(current)
            previous = edge
            if current == start:
                break
        loops.append(loop)
    if len(loops) != 2 or any(len(loop) < 3 for loop in loops):
        raise ValueError("Expected the gear's two center rims; other openings were found.")
    normals = []
    for loop in loops:
        coords = [vert.co for vert in loop]
        plane = normal(coords)
        span = max((point - coords[0]).length for point in coords)
        tolerance = max(span * 1e-5, 1e-8)
        if plane.length < 0.5 or any(
            abs((point - coords[0]).dot(plane)) > tolerance for point in coords
        ):
            raise ValueError("A center rim is degenerate or no longer planar.")
        normals.append(plane)
    if abs(normals[0].dot(normals[1])) < 0.9999:
        raise ValueError("The center rims are no longer parallel.")
    return list(boundary)


def _fill_gear(obj):
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        edges = _center_rims(bm)
        material_index = edges[0].link_faces[0].material_index
        caps = bmesh.ops.holes_fill(bm, edges=edges, sides=0)["faces"]
        if len(caps) != 2 or any(not edge.is_manifold for edge in bm.edges):
            raise ValueError("Could not close both center rims cleanly.")
        for face in caps:
            face.material_index = material_index
            face.smooth = False
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        if bm.calc_volume(signed=True) < 0:
            bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        # Only commit after validation. Linked, unselected duplicates stay intact.
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        bm.to_mesh(obj.data)
        obj.data.update()
    finally:
        bm.free()


def run_flowcell_action(context=None, data=None):
    ctx = context or bpy.context
    if ctx.mode not in {"OBJECT", "EDIT_MESH"}:
        return {"status": "CANCELLED", "changed": 0,
                "message": "Use Object Mode or Mesh Edit Mode to fill selected gears."}
    selected = list(ctx.selected_objects)
    targets = [obj for obj in selected if obj.type == "MESH" and obj.data.get("Gear")]
    if not targets:
        return {"status": "CANCELLED", "changed": 0,
                "message": "Select gears created with Extra Mesh Objects, then click Fill Gear."}
    was_editing = ctx.mode == "EDIT_MESH"
    if was_editing:
        bpy.ops.object.mode_set(mode="OBJECT")
    changed = []
    skipped = []
    try:
        for obj in targets:
            if not obj.is_editable or not obj.data.is_editable:
                skipped.append(f"{obj.name}: linked library data is read-only.")
                continue
            try:
                _fill_gear(obj)
                changed.append(obj.name)
            except ValueError as error:
                skipped.append(f"{obj.name}: {error}")
    finally:
        if was_editing:
            bpy.ops.object.mode_set(mode="EDIT")
    message = f"Filled the centers of {len(changed)} selected gear(s)."
    if skipped:
        message += " Skipped: " + " ".join(skipped)
    return {"status": "FINISHED" if changed else "CANCELLED",
            "changed": len(changed), "message": message,
            "filled_objects": changed, "skipped": skipped}
