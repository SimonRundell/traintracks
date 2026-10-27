"""
Exports the HST Class 43 model from hst_class43.blend to GLB for Three.js.

Excludes the Preview_NotExported collection (camera/sun), selects only the
objects under the HST_Class43 empty, and writes a binary glTF next to the
web app's public assets.

Run with:
    blender --background hst_class43.blend --python export_gltf.py
"""

import bpy
import os

OUT_PATH = os.path.normpath(
    os.path.join(os.path.dirname(bpy.data.filepath), "..", "..", "public", "models", "loco-020.glb")
)


def select_export_objects():
    """
    Selects HST_Class43 and all its mesh children, deselecting everything else.

    @returns {None}
    """
    bpy.ops.object.select_all(action="DESELECT")
    root = bpy.data.objects.get("HST_Class43")
    if root is None:
        raise RuntimeError("HST_Class43 root empty not found in this file")

    def select_recursive(obj):
        obj.select_set(True)
        for child in obj.children:
            select_recursive(child)

    select_recursive(root)


def main():
    """
    Selects the exportable hierarchy and writes loco-020.glb.

    @returns {None}
    """
    select_export_objects()
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_PATH,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
    )
    print(f"exported {OUT_PATH}")


if __name__ == "__main__":
    main()
