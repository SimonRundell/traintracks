"""
build_loco.py

Builds a low poly early steam locomotive in Blender from a single side view image
(397 x 400 px), then saves early_loco.blend next to this script.

One material, one atlas texture (loco_atlas.png, made by make_atlas.py).
  - Round parts (boiler, smokebox, chimney, dome, pipes) are revolved low poly lathes.
    Their faces get the side image projected onto them, near side or mirrored far side.
  - Frame, cab and rods are boxes and bars, projected the same way.
  - Wheels are thin discs. Their crops keep the source alpha, so the gaps between the
    spokes are see through (alpha clip).

Axes and units:
  - Metres. Origin at the middle of the engine, Z = 0 on the rail.
  - Length along Y. The chimney end is the front and faces -Y.
  - The source image is applied to the -X side (SIDE = -1), so viewing from -X matches the picture.

Run it with Blender:
  blender --background --python build_loco.py
or with the bpy module (Python 3.11):
  python build_loco.py

Licence: Creative Commons BY-NC-SA 4.0 International
https://creativecommons.org/licenses/by-nc-sa/4.0/
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS_PATH = os.path.join(HERE, "loco_atlas.png")
BLEND_PATH = os.path.join(HERE, "early_loco.blend")

# ---------------------------------------------------------------------------
# Scale and atlas layout. Image pixels are (column, row) with row 0 at the top.
# ---------------------------------------------------------------------------
IMG_W = 397.0
M = 5.0 / 387.0              # metres per pixel (engine is about 5 m over the frame)
CENTRE_PX = 198.5            # image column mapped to Y = 0
GROUND_ROW = 394.5           # image row of the wheel treads
SIDE = -1                    # which X side the image is applied to
ATLAS = 1024.0
FAR_X0 = 400.0               # far side (mirrored) image starts at this atlas column
SWATCH_PX, SWATCH_X0, SWATCH_COLS = 64, 808, 3
BRASS, DARK, COPPER, STEEL, LIGHT = range(5)

# Wheel crops: key -> (atlas centre x, atlas centre y)
WHEEL_CROPS = {"A": (64, 484), "B": (200, 484), "S": (314, 462)}


# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------
def y_of_col(col):
    """
    @param {float} col Image column.
    @returns {float} World Y in metres. The right of the image is the front, -Y.
    """
    return (CENTRE_PX - col) * M


def z_of_row(row):
    """
    @param {float} row Image row, 0 at the top.
    @returns {float} World Z in metres above the rail.
    """
    return (GROUND_ROW - row) * M


def col_of_y(y):
    """
    @param {float} y World Y in metres.
    @returns {float} Image column.
    """
    return CENTRE_PX - y / M


def row_of_z(z):
    """
    @param {float} z World Z in metres.
    @returns {float} Image row.
    """
    return GROUND_ROW - z / M


def atlas_uv(px, py):
    """
    @param {float} px Atlas pixel column.
    @param {float} py Atlas pixel row, 0 at the top.
    @returns {tuple} Blender UV (origin bottom left).
    """
    return (px / ATLAS, 1.0 - py / ATLAS)


def swatch_uv(i):
    """
    @param {int} i Swatch index.
    @returns {tuple} UV at the centre of that flat colour cell.
    """
    col, row = i % SWATCH_COLS, i // SWATCH_COLS
    return atlas_uv(SWATCH_X0 + col * SWATCH_PX + SWATCH_PX / 2, row * SWATCH_PX + SWATCH_PX / 2)


def proj_uv(v, near):
    """
    Project a vertex onto the side image in the atlas.

    @param {Vector} v Vertex position in metres.
    @param {bool} near True for the image side, False for the mirrored far side.
    @returns {tuple} UV.
    """
    col, row = col_of_y(v.y), row_of_z(v.z)
    if near:
        return atlas_uv(col, row)
    return atlas_uv(FAR_X0 + IMG_W - col, row)


def faces_near(x_dir):
    """
    @param {float} x_dir Sign of the outward X direction of a face.
    @returns {bool} True if that face looks toward the image side.
    """
    return x_dir * SIDE > 0


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------
def add_face(bm, uvl, verts, uvs):
    """
    Add one polygon with explicit UVs.

    @param {bmesh.types.BMesh} bm Target mesh.
    @param {bmesh.types.BMLayerItem} uvl UV layer.
    @param {list[Vector]} verts Corners.
    @param {list[tuple]} uvs One UV per corner.
    """
    face = bm.faces.new([bm.verts.new(v) for v in verts])
    for loop, uv in zip(face.loops, uvs):
        loop[uvl].uv = uv


def new_part():
    """
    @returns {tuple} A fresh bmesh and its UV layer.
    """
    bm = bmesh.new()
    return bm, bm.loops.layers.uv.new("UVMap")


def finish(name, bm, mat, root):
    """
    Weld, fix normals and turn the bmesh into an object under the root.

    @param {str} name Object name.
    @param {bmesh.types.BMesh} bm Finished geometry.
    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    @returns {bpy.types.Object} The object.
    """
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = root
    bpy.context.collection.objects.link(obj)
    return obj


def lathe(bm, uvl, profile, axis, centre, segments, cap_a=DARK, cap_b=DARK):
    """
    Revolve a profile into a closed low poly solid with the side image projected on it.

    @param {list[tuple]} profile (position px, radius px) pairs along the axis.
    @param {str} axis 'Y' for a horizontal lathe along the length, 'Z' for a vertical one.
    @param {float} centre Axis position in pixels: a row for 'Y', a column for 'Z'.
    @param {int} segments Sides around the axis.
    @param {int} cap_a Swatch for the first end cap.
    @param {int} cap_b Swatch for the last end cap.
    """
    rings = []
    for pos, rad in profile:
        r = rad * M
        ring = []
        for k in range(segments):
            th = 2 * math.pi * k / segments
            if axis == "Y":
                ring.append(Vector((r * math.sin(th), y_of_col(pos), z_of_row(centre) + r * math.cos(th))))
            else:
                ring.append(Vector((r * math.sin(th), y_of_col(centre) + r * math.cos(th), z_of_row(pos))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            k2 = (k + 1) % segments
            quad = [a[k], a[k2], b[k2], b[k]]
            near = faces_near(sum(v.x for v in quad))
            add_face(bm, uvl, quad, [proj_uv(v, near) for v in quad])
    add_face(bm, uvl, rings[0][::-1], [swatch_uv(cap_a)] * segments)
    add_face(bm, uvl, rings[-1], [swatch_uv(cap_b)] * segments)


def pbox(bm, uvl, c0, c1, r0, r1, hw, top=DARK, ends=DARK, bottom=DARK):
    """
    Box spanning image columns c0..c1 and rows r0 (top)..r1 (bottom), hw wide each side of X = 0.
    The two X faces carry the projected side image.

    @param {float} c0 Left column.
    @param {float} c1 Right column.
    @param {float} r0 Top row.
    @param {float} r1 Bottom row.
    @param {float} hw Half width in metres.
    @param {int} top Swatch for the top.
    @param {int} ends Swatch for both end faces.
    @param {int} bottom Swatch for the underside.
    """
    ya, yb = y_of_col(c0), y_of_col(c1)
    z0, z1 = z_of_row(r1), z_of_row(r0)

    def c(x, y, z):
        return Vector((x, y, z))

    for x, sign in ((-hw, -1), (hw, 1)):
        q = [c(x, ya, z0), c(x, yb, z0), c(x, yb, z1), c(x, ya, z1)]
        add_face(bm, uvl, q, [proj_uv(v, faces_near(sign)) for v in q])
    add_face(bm, uvl, [c(-hw, ya, z1), c(-hw, yb, z1), c(hw, yb, z1), c(hw, ya, z1)], [swatch_uv(top)] * 4)
    add_face(bm, uvl, [c(-hw, ya, z0), c(hw, ya, z0), c(hw, yb, z0), c(-hw, yb, z0)], [swatch_uv(bottom)] * 4)
    add_face(bm, uvl, [c(-hw, ya, z0), c(-hw, ya, z1), c(hw, ya, z1), c(hw, ya, z0)], [swatch_uv(ends)] * 4)
    add_face(bm, uvl, [c(-hw, yb, z0), c(hw, yb, z0), c(hw, yb, z1), c(-hw, yb, z1)], [swatch_uv(ends)] * 4)


def bar(bm, uvl, p0, p1, width_px, xc, thick, swatch=None):
    """
    A straight bar between two image points, lying in a plane of constant X.

    @param {tuple} p0 Start (column, row).
    @param {tuple} p1 End (column, row).
    @param {float} width_px Bar width in the side view, in pixels.
    @param {float} xc Centre X in metres.
    @param {float} thick Thickness along X in metres.
    @param {int|None} swatch Flat colour for every face, or None to project the side image on the X faces.
    """
    a = Vector((y_of_col(p0[0]), z_of_row(p0[1])))
    b = Vector((y_of_col(p1[0]), z_of_row(p1[1])))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x)) * (width_px * M / 2)
    lo, hi = xc - thick / 2, xc + thick / 2

    def v(x, p, s):
        q = p + n * s
        return Vector((x, q.x, q.y))

    for x, sign in ((lo, -1), (hi, 1)):
        q = [v(x, a, -1), v(x, b, -1), v(x, b, 1), v(x, a, 1)]
        uvs = [swatch_uv(swatch)] * 4 if swatch is not None else [proj_uv(p, faces_near(sign)) for p in q]
        add_face(bm, uvl, q, uvs)
    flat = swatch if swatch is not None else DARK
    for s0, s1 in ((-1, 1), (1, -1)):
        add_face(bm, uvl, [v(lo, a, s0), v(lo, b, s0), v(hi, b, s0), v(hi, a, s0)][::1 if s0 < 0 else -1],
                 [swatch_uv(flat)] * 4)
    add_face(bm, uvl, [v(lo, a, -1), v(hi, a, -1), v(hi, a, 1), v(lo, a, 1)], [swatch_uv(flat)] * 4)
    add_face(bm, uvl, [v(lo, b, -1), v(lo, b, 1), v(hi, b, 1), v(hi, b, -1)], [swatch_uv(flat)] * 4)


def cylinder_x(bm, uvl, y, z, radius, length, segments, swatch):
    """
    Capped cylinder along X (used for axles).

    @param {float} y Centre Y in metres.
    @param {float} z Centre Z in metres.
    @param {float} radius Radius in metres.
    @param {float} length Length in metres.
    @param {int} segments Sides.
    @param {int} swatch Flat colour swatch.
    """
    ring_a, ring_b = [], []
    for k in range(segments):
        th = 2 * math.pi * k / segments
        ring_a.append(Vector((-length / 2, y + radius * math.cos(th), z + radius * math.sin(th))))
        ring_b.append(Vector((length / 2, y + radius * math.cos(th), z + radius * math.sin(th))))
    uv = swatch_uv(swatch)
    for k in range(segments):
        k2 = (k + 1) % segments
        add_face(bm, uvl, [ring_a[k], ring_a[k2], ring_b[k2], ring_b[k]], [uv] * 4)
    add_face(bm, uvl, ring_a[::-1], [uv] * segments)
    add_face(bm, uvl, ring_b, [uv] * segments)


def wheel_disc(bm, uvl, col, row, radius_px, xc, thick, crop, segments=28):
    """
    A thin disc. Its two faces sample a wheel crop that keeps the source alpha.

    @param {float} col Wheel centre column in the source image.
    @param {float} row Wheel centre row in the source image.
    @param {float} radius_px Wheel radius in pixels.
    @param {float} xc Centre X of the disc in metres.
    @param {float} thick Disc thickness in metres.
    @param {str} crop Key into WHEEL_CROPS.
    @param {int} segments Sides of the rim.
    """
    yc, zc = y_of_col(col), z_of_row(row)
    r = (radius_px + 1.0) * M
    ax, ay = WHEEL_CROPS[crop]
    ring_lo, ring_hi = [], []
    for k in range(segments):
        th = 2 * math.pi * k / segments
        dy, dz = r * math.cos(th), r * math.sin(th)
        ring_lo.append(Vector((xc - thick / 2, yc + dy, zc + dz)))
        ring_hi.append(Vector((xc + thick / 2, yc + dy, zc + dz)))
    rim = swatch_uv(DARK)
    for k in range(segments):
        k2 = (k + 1) % segments
        add_face(bm, uvl, [ring_lo[k], ring_lo[k2], ring_hi[k2], ring_hi[k]], [rim] * 4)

    def cap_uv(v, sign):
        col_off, row_off = -(v.y - yc) / M, -(v.z - zc) / M
        if not faces_near(sign):
            col_off = -col_off
        return atlas_uv(ax + col_off, ay + row_off)

    add_face(bm, uvl, ring_lo[::-1], [cap_uv(v, -1) for v in ring_lo[::-1]])
    add_face(bm, uvl, ring_hi, [cap_uv(v, 1) for v in ring_hi])


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------
def get_material():
    """
    One material that samples the packed atlas. Texture alpha, hardened by a Round node,
    drives the Principled alpha so the wheel gaps are see through.

    @returns {bpy.types.Material} Material named Loco_Atlas.
    """
    img = bpy.data.images.load(ATLAS_PATH)
    img.name = "loco_atlas.png"
    img.alpha_mode = "STRAIGHT"
    img.pack()
    mat = bpy.data.materials.new("Loco_Atlas")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    # A Round node turns the soft alpha into a hard cut. The glTF exporter recognises
    # this pattern and writes alphaMode MASK (cutoff 0.5), which Three.js handles without
    # any sorting problems.
    clip = nodes.new("ShaderNodeMath")
    clip.operation = "ROUND"
    links.new(tex.outputs["Alpha"], clip.inputs[0])
    links.new(clip.outputs["Value"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.6
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
        try:
            setattr(mat, attr, val)
        except (AttributeError, TypeError):
            pass
    return mat


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------
def build_boiler(mat, root):
    """
    Boiler barrel, smokebox, chimney, dome, standpipe, small rear column and the stay rod.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    bm, uvl = new_part()
    lathe(bm, uvl, [(84, 28), (88, 44), (94, 53), (100, 55), (262, 55)], "Y", 227, 12, BRASS, DARK)
    finish("LOCO_Boiler", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(260, 64), (264, 71), (321, 71), (327, 62)], "Y", 229, 16, DARK, DARK)
    finish("LOCO_Smokebox", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(326, 22), (330, 20), (334, 18)], "Y", 229, 12, STEEL, LIGHT)
    finish("LOCO_SmokeboxDoor", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(3, 24), (10, 23), (22, 19), (26, 18.5), (165, 19)], "Z", 291, 12, DARK, DARK)
    finish("LOCO_Chimney", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(104, 1.5), (108, 4), (112, 3.5), (117, 6), (123, 11), (131, 12), (150, 12),
                    (158, 14), (168, 17), (176, 17)], "Z", 125, 10, COPPER, COPPER)
    finish("LOCO_Dome", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(82, 10), (85, 14), (180, 14)], "Z", 206, 10, LIGHT, STEEL)
    finish("LOCO_Standpipe", bm, mat, root)

    bm, uvl = new_part()
    lathe(bm, uvl, [(190, 6), (194, 9), (198, 10), (272, 11)], "Z", 70, 10, COPPER, DARK)
    finish("LOCO_RearColumn", bm, mat, root)

    bm, uvl = new_part()
    bar(bm, uvl, (135, 126), (271, 55), 4.0, 0.0, 0.04, swatch=DARK)
    finish("LOCO_StayRod", bm, mat, root)


def build_chassis(mat, root):
    """
    Frame beams, the cab box and the two rods that sit outside the wheels.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    bm, uvl = new_part()
    pbox(bm, uvl, 5, 262, 283, 304, 0.70)
    finish("LOCO_Frame_Rear", bm, mat, root)

    bm, uvl = new_part()
    pbox(bm, uvl, 262, 392, 299, 319, 0.70)
    finish("LOCO_Frame_Front", bm, mat, root)

    bm, uvl = new_part()
    pbox(bm, uvl, 10, 55, 222, 284, 0.65, top=DARK, ends=BRASS)
    finish("LOCO_Cab", bm, mat, root)

    for side, x in (("L", -0.76), ("R", 0.76)):
        bm, uvl = new_part()
        bar(bm, uvl, (118, 265), (246, 264), 12.0, x, 0.10)
        finish(f"LOCO_PistonRod_{side}", bm, mat, root)
    for side, x in (("L", -0.95), ("R", 0.95)):
        bm, uvl = new_part()
        bar(bm, uvl, (88, 315), (323, 330), 7.0, x, 0.05)
        finish(f"LOCO_CouplingRod_{side}", bm, mat, root)


def build_wheels(mat, root):
    """
    Three wheel pairs (two large, one small) with axles.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    wheels = (("1", 78, 332, 61, "A"), ("2", 205, 332, 61, "B"), ("3", 338, 357, 38, "S"))
    for tag, col, row, rad, crop in wheels:
        for side, x in (("L", -0.84), ("R", 0.84)):
            bm, uvl = new_part()
            wheel_disc(bm, uvl, col, row, rad, x, 0.10, crop)
            finish(f"LOCO_Wheel{tag}_{side}", bm, mat, root)
        bm, uvl = new_part()
        cylinder_x(bm, uvl, y_of_col(col), z_of_row(row), 0.06, 1.70, 8, STEEL)
        finish(f"LOCO_Axle{tag}", bm, mat, root)


def add_preview_rig():
    """
    Camera and sun in their own collection so they are easy to leave out of an export.
    """
    coll = bpy.data.collections.new("Preview_NotExported")
    bpy.context.scene.collection.children.link(coll)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(-10), math.radians(-35))
    coll.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.location = (-9.0, -9.0, 4.0)
    cam.rotation_euler = (Vector((0, 0, 2.2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    coll.objects.link(cam)
    bpy.context.scene.camera = cam


def main():
    """
    Build the scene from scratch and save the .blend next to this script.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new("EarlyLoco", None)
    bpy.context.collection.objects.link(root)
    mat = get_material()
    build_boiler(mat, root)
    build_chassis(mat, root)
    build_wheels(mat, root)
    add_preview_rig()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"saved {BLEND_PATH}, {len(bpy.data.objects)} objects, {faces} faces")


if __name__ == "__main__":
    main()
