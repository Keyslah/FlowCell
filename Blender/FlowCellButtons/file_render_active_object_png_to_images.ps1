# Description: Render the active selected object from the current scene camera to 01 src\04 assets\01 images as a transparent PNG cropped exactly to the visible object bounds.

# Source Python File: C:\Users\aaron\AppData\Roaming\Blender Foundation\Blender\5.0\scripts\addons\flowtest_actions.py

# Source Action Function: perform_render_active_object_png_to_images_result
# Source Action Start Line: 1145

# Source Action Logic:

# def perform_render_active_object_png_to_images_result(
#     context: bpy.types.Context,
# ) -> dict[str, object]:
#     scene = context.scene
#     camera = scene.camera
#     if camera is None or camera.type != "CAMERA":
#         raise ValueError("No active scene camera exists.")
# 
#     target_object = get_active_selected_object(context)
#     depsgraph = context.evaluated_depsgraph_get()
#     if not object_intersects_camera_view(scene, camera, target_object, depsgraph):
#         raise ValueError(f"'{target_object.name}' is outside the current camera view.")
# 
#     images_dir = get_assets_images_directory_from_current_file()
#     export_stem = sanitize_export_stem(
#         strip_hidden_name_pad(strip_version_prefix(target_object.name) or target_object.name)
#     )
#     output_path = get_overwrite_export_path(images_dir, export_stem, ".png")
# 
#     render = scene.render
#     image_settings = render.image_settings
#     previous_filepath = str(render.filepath)
#     previous_film_transparent = bool(render.film_transparent)
#     previous_use_file_extension = bool(render.use_file_extension)
#     previous_use_border = bool(render.use_border)
#     previous_use_crop_to_border = bool(render.use_crop_to_border)
#     previous_use_compositing = bool(getattr(render, "use_compositing", True))
#     previous_use_sequencer = bool(getattr(render, "use_sequencer", True))
#     previous_file_format = str(image_settings.file_format)
#     previous_color_mode = str(image_settings.color_mode)
#     previous_color_depth = str(image_settings.color_depth)
#     previous_target_hide_render = bool(target_object.hide_render)
# 
#     hidden_states: list[tuple[bpy.types.Object, bool]] = []
#     temp_file = tempfile.NamedTemporaryFile(prefix="flowtest_render_", suffix=".png", delete=False)
#     temp_path = Path(temp_file.name)
#     temp_file.close()
# 
#     render_result_image = None
#     loaded_image = None
# 
#     try:
#         hidden_states = set_scene_object_render_isolation(scene, target_object)
#         target_object.hide_render = False
# 
#         render.filepath = str(temp_path)
#         render.film_transparent = True
#         render.use_file_extension = True
#         render.use_border = False
#         render.use_crop_to_border = False
#         render.use_compositing = False
#         render.use_sequencer = False
#         image_settings.file_format = "PNG"
#         image_settings.color_mode = "RGBA"
#         image_settings.color_depth = "8"
# 
#         result = bpy.ops.render.render(write_still=True, use_viewport=False)
#         if result is None or "FINISHED" not in result:
#             raise ValueError(f"Render did not finish for '{target_object.name}'.")
# 
#         if not temp_path.exists():
#             raise ValueError("Blender did not write the rendered PNG.")
# 
#         loaded_image = bpy.data.images.load(str(temp_path), check_existing=False)
#         pixels = list(loaded_image.pixels[:])
#         width, height = loaded_image.size
#         bounds = find_nontransparent_pixel_bounds(pixels, width, height)
#         if bounds is None:
#             raise ValueError(f"'{target_object.name}' is outside the current camera view.")
# 
#         cropped_width, cropped_height, cropped_pixels = crop_pixel_buffer(pixels, width, bounds)
#         save_cropped_png(output_path, cropped_width, cropped_height, cropped_pixels)
#     finally:
#         if loaded_image is not None:
#             try:
#                 bpy.data.images.remove(loaded_image)
#             except Exception:
#                 pass
# 
#         restore_scene_object_render_isolation(hidden_states)
#         try:
#             target_object.hide_render = previous_target_hide_render
#         except Exception:
#             pass
# 
#         render.filepath = previous_filepath
#         render.film_transparent = previous_film_transparent
#         render.use_file_extension = previous_use_file_extension
#         render.use_border = previous_use_border
#         render.use_crop_to_border = previous_use_crop_to_border
#         render.use_compositing = previous_use_compositing
#         render.use_sequencer = previous_use_sequencer
#         image_settings.file_format = previous_file_format
#         image_settings.color_mode = previous_color_mode
#         image_settings.color_depth = previous_color_depth
# 
#         try:
#             temp_path.unlink(missing_ok=True)
#         except Exception:
#             pass
# 
#     return {
#         "message": f"Saved PNG to {output_path}",
#         "saved_path": str(output_path),
#     }
# 
# 

$ErrorActionPreference = 'Stop'
$supportRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'SupportScripts'
$dispatcherPath = Join-Path $supportRoot 'Invoke-BlenderFlowCellAction.ps1'
& $dispatcherPath -Action 'render_active_object_png_to_images' -Label 'save png'
exit $LASTEXITCODE


