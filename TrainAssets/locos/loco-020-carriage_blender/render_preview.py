import os
import bpy

HERE = os.path.dirname(os.path.abspath(bpy.data.filepath))
bpy.context.scene.render.engine = 'BLENDER_EEVEE'
bpy.context.scene.render.resolution_x = 1400
bpy.context.scene.render.resolution_y = 500
bpy.context.scene.render.filepath = os.path.join(HERE, "carriage_preview.png")
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("rendered", bpy.context.scene.render.filepath)
