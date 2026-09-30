# Description: Create a hexagon by default (6 sides). Shift-click prompts for the number of sides (minimum 3).

import math

import bpy
from bpy.props import IntProperty


DESCRIPTION = "Create a hexagon by default (6 sides). Shift-click prompts for the number of sides (minimum 3)."
MAX_SIDES = 10000


def create_polygon(context=None, sides=6):
    ctx = context or bpy.context
    if isinstance(sides, bool) or not isinstance(sides, int) or not 3 <= sides <= MAX_SIDES:
        raise ValueError(f"Number of sides must be a whole number from 3 to {MAX_SIDES}.")
    if ctx.active_object and ctx.active_object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    scale = ctx.scene.unit_settings.scale_length or 1.0
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=sides,
        radius=0.020 / (2.0 * math.sin(math.pi / sides)) / scale,
        depth=0.004 / scale,
        end_fill_type="NGON",
        enter_editmode=False,
        align="WORLD",
        location=(0.0, 0.0, 0.0),
    )
    obj = ctx.active_object
    if obj is None:
        raise RuntimeError("Blender did not create the polygon.")
    base_name = "Hexagon" if sides == 6 else f"{sides}-Sided Polygon"
    used_names = {other.name for other in bpy.data.objects if other != obj}
    name = base_name
    suffix = 1
    while name in used_names:
        name = f"{base_name}{suffix}"
        suffix += 1
    obj.name = name
    return {
        "status": "FINISHED",
        "message": f"Added '{obj.name}' with {sides} sides.",
        "changed": 1,
        "object_name": obj.name,
        "sides": sides,
    }


class FLOWCELL_OT_hex_sides(bpy.types.Operator):
    bl_idname = "flowcell.hex_sides"
    bl_label = "Hex — Number of sides"
    bl_description = DESCRIPTION
    bl_options = {"REGISTER", "UNDO"}
    _prompt_active = False

    sides: IntProperty(
        name="Number of sides",
        description="6 creates a hexagon; enter another whole number to create a polygon",
        default=6,
        min=3,
        max=MAX_SIDES,
    )

    def draw(self, context):
        self.layout.label(text="Default: hexagon (6 sides)")
        self.layout.prop(self, "sides")

    def invoke(self, context, event):
        type(self)._prompt_active = True
        try:
            return context.window_manager.invoke_props_dialog(self, width=340)
        except Exception:
            type(self)._prompt_active = False
            raise

    def execute(self, context):
        try:
            result = create_polygon(context, self.sides)
            self.report({"INFO"}, result["message"])
            return {"FINISHED"}
        finally:
            type(self)._prompt_active = False

    def cancel(self, context):
        type(self)._prompt_active = False


def prompt_for_sides():
    existing = getattr(bpy.types, "FLOWCELL_OT_hex_sides", None)
    if existing is not None and getattr(existing, "_prompt_active", False):
        return {"status": "CANCELLED", "message": "The number-of-sides prompt is already open.", "changed": 0}
    window_manager = bpy.context.window_manager
    for window in window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            region = next((item for item in area.regions if item.type == "WINDOW"), None)
            if region is None:
                continue
            if existing is not None and existing is not FLOWCELL_OT_hex_sides:
                bpy.utils.unregister_class(existing)
            if existing is not FLOWCELL_OT_hex_sides:
                bpy.utils.register_class(FLOWCELL_OT_hex_sides)
            with bpy.context.temp_override(window=window, area=area, region=region):
                result = bpy.ops.flowcell.hex_sides("INVOKE_DEFAULT", sides=6)
            if "RUNNING_MODAL" not in result:
                FLOWCELL_OT_hex_sides._prompt_active = False
                raise RuntimeError("Blender did not open the number-of-sides prompt.")
            return {"status": "FINISHED", "message": "Enter the number of sides in Blender (default 6).", "changed": 0}
    raise RuntimeError("Open a Blender 3D View to enter the number of sides.")


def run_flowcell_action(context=None, data=None):
    data = data if isinstance(data, dict) else {}
    modifiers = data.get("modifiers") or {}
    if "sides" not in data and modifiers.get("shift"):
        return prompt_for_sides()
    return create_polygon(context, data.get("sides", 6))
