"""
build_pacific.py

Builds a low poly streamlined steam locomotive and tender in Blender from a single side
view image (461 x 153 px), then saves streamlined_pacific.blend next to this script.

One material, one atlas texture (pacific_atlas.png, made by make_atlas.py).
  - Tender, coal, cab and the streamlined casing are lofted through cross sections that
    follow the silhouette. The side image is projected onto their sides.
  - Wheels are thin discs. Their crops keep the source alpha, so the gaps between the
    spokes are see through (alpha clip, exported as glTF MASK).

Axes and units:
  - Metres, Z up, origin at the middle of the engine on the rail.
  - Length along Y. The streamlined nose is the front and faces -Y.
  - The source image is applied to the -X side (SIDE = -1), so the Left view matches the picture.
  - Lateral sizes are set in image pixels, so the proportions follow the drawing.

Run it with Blender:
  blender --background --python build_pacific.py
or with the bpy module (Python 3.11):
  python build_pacific.py

Licence: Creative Commons BY-NC-SA 4.0 International
https://creativecommons.org/licenses/by-nc-sa/4.0/
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS_PATH = os.path.join(HERE, "pacific_atlas.png")
BLEND_PATH = os.path.join(HERE, "streamlined_pacific.blend")

# ---------------------------------------------------------------------------
# Scale and atlas layout. Image pixels are (column, row) with row 0 at the top.
# ---------------------------------------------------------------------------
IMG_W = 461.0
M = 21.3 / 448.0             # metres per pixel (21.3 m between buffers, columns 8 to 456)
CENTRE_PX = 232.0            # image column mapped to Y = 0
GROUND_ROW = 148.5           # image row of the wheel treads
SIDE = -1                    # which X side the image is applied to
ATLAS = 1024.0
FAR_X0 = 464.0               # mirrored far side starts at this atlas column
SW_X0, SW_PX = 932, 64
GREEN, DARK, SILVER, COAL, RED, STEEL = range(6)

# Wheel crops: key -> (atlas centre x, atlas centre y)
WHEEL_CROPS = {"A": (36, 206), "B": (112, 206), "C": (188, 206), "S": (243, 185), "T": (277, 185)}


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
    return atlas_uv(SW_X0 + SW_PX / 2, i * SW_PX + SW_PX / 2)


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
    @param {float} x_dir Outward X direction of a face (sign is what matters).
    @returns {bool} True if that face looks toward the image side.
    """
    return x_dir * SIDE > 0


def lerp(table, x):
    """
    Linear interpolation through a sorted (x, value) table, clamped at the ends.

    @param {list[tuple]} table Sorted pairs.
    @param {float} x Query.
    @returns {float} Interpolated value.
    """
    if x <= table[0][0]:
        return table[0][1]
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if x <= x1:
            return v0 + (x - x0) / (x1 - x0) * (v1 - v0)
    return table[-1][1]


def smoothstep(a, b, x):
    """
    @param {float} a Start.
    @param {float} b End.
    @param {float} x Value.
    @returns {float} Eased 0 to 1 ramp.
    """
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------
def add_face(bm, uvl, verts, uvs):
    """
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
    Weld, make normals point outward, and turn the bmesh into an object under the root.

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


def loft(bm, uvl, stations, roof=GREEN, cap_a=DARK, cap_b=DARK):
    """
    Loft a body through cross sections. Each section has six corners: two at the bottom,
    two at the shoulder, two on the roof. Sides and chamfers carry the projected image.

    @param {list[tuple]} stations (column, top row, bottom row, half width px, roof half width px, chamfer px).
    @param {int} roof Swatch for the roof.
    @param {int} cap_a Swatch for the first end cap.
    @param {int} cap_b Swatch for the last end cap.
    """
    rings = []
    for col, top, bot, hw, hr, ch in stations:
        y, zt, zb = y_of_col(col), z_of_row(top), z_of_row(bot)
        w, r = hw * M, hr * M
        zs = max(zt - ch * M, zb + 0.05)
        rings.append([Vector((-w, y, zb)), Vector((w, y, zb)), Vector((w, y, zs)),
                      Vector((r, y, zt)), Vector((-r, y, zt)), Vector((-w, y, zs))])
    for a, b in zip(rings, rings[1:]):
        add_face(bm, uvl, [a[0], a[1], b[1], b[0]], [swatch_uv(DARK)] * 4)
        for i, j in ((1, 2), (2, 3), (4, 5), (5, 0)):
            q = [a[i], a[j], b[j], b[i]]
            near = faces_near(sum(v.x for v in q))
            add_face(bm, uvl, q, [proj_uv(v, near) for v in q])
        add_face(bm, uvl, [a[3], a[4], b[4], b[3]], [swatch_uv(roof)] * 4)
    add_face(bm, uvl, rings[0][::-1], [swatch_uv(cap_a)] * 6)
    add_face(bm, uvl, rings[-1], [swatch_uv(cap_b)] * 6)


def bar(bm, uvl, p0, p1, width_px, xc, thick):
    """
    A straight bar between two image points, lying in a plane of constant X, with the
    side image projected on its two broad faces.

    @param {tuple} p0 Start (column, row).
    @param {tuple} p1 End (column, row).
    @param {float} width_px Width in the side view, in pixels.
    @param {float} xc Centre X in metres.
    @param {float} thick Thickness along X in metres.
    """
    a = Vector((y_of_col(p0[0]), z_of_row(p0[1])))
    b = Vector((y_of_col(p1[0]), z_of_row(p1[1])))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x)) * (width_px * M / 2)

    def v(x, p, s):
        q = p + n * s
        return Vector((x, q.x, q.y))

    lo, hi = xc - thick / 2, xc + thick / 2
    for x, sign in ((lo, -1), (hi, 1)):
        q = [v(x, a, -1), v(x, b, -1), v(x, b, 1), v(x, a, 1)]
        add_face(bm, uvl, q, [proj_uv(p, faces_near(sign)) for p in q])
    flat = [swatch_uv(DARK)] * 4
    add_face(bm, uvl, [v(lo, a, -1), v(lo, b, -1), v(hi, b, -1), v(hi, a, -1)], flat)
    add_face(bm, uvl, [v(lo, a, 1), v(hi, a, 1), v(hi, b, 1), v(lo, b, 1)], flat)
    add_face(bm, uvl, [v(lo, a, -1), v(hi, a, -1), v(hi, a, 1), v(lo, a, 1)], flat)
    add_face(bm, uvl, [v(lo, b, -1), v(lo, b, 1), v(hi, b, 1), v(hi, b, -1)], flat)


def cylinder(bm, uvl, axis, centre, length, radius, segments, swatch):
    """
    Capped cylinder along X or Y with a flat colour.

    @param {str} axis 'X' or 'Y'.
    @param {tuple} centre (x, y, z) in metres.
    @param {float} length Length in metres.
    @param {float} radius Radius in metres.
    @param {int} segments Sides.
    @param {int} swatch Flat colour swatch.
    """
    cx, cy, cz = centre
    ring_a, ring_b = [], []
    for k in range(segments):
        th = 2 * math.pi * k / segments
        c, s = radius * math.cos(th), radius * math.sin(th)
        if axis == "X":
            ring_a.append(Vector((cx - length / 2, cy + c, cz + s)))
            ring_b.append(Vector((cx + length / 2, cy + c, cz + s)))
        else:
            ring_a.append(Vector((cx + c, cy - length / 2, cz + s)))
            ring_b.append(Vector((cx + c, cy + length / 2, cz + s)))
    uv = swatch_uv(swatch)
    for k in range(segments):
        k2 = (k + 1) % segments
        add_face(bm, uvl, [ring_a[k], ring_a[k2], ring_b[k2], ring_b[k]], [uv] * 4)
    add_face(bm, uvl, ring_a[::-1], [uv] * segments)
    add_face(bm, uvl, ring_b, [uv] * segments)


def wheel_disc(bm, uvl, col, row, radius_px, xc, thick, crop, segments=28):
    """
    A thin disc whose two faces sample a wheel crop that keeps the source alpha.

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
    lo, hi = [], []
    for k in range(segments):
        th = 2 * math.pi * k / segments
        dy, dz = r * math.cos(th), r * math.sin(th)
        lo.append(Vector((xc - thick / 2, yc + dy, zc + dz)))
        hi.append(Vector((xc + thick / 2, yc + dy, zc + dz)))
    rim = swatch_uv(DARK)
    for k in range(segments):
        k2 = (k + 1) % segments
        add_face(bm, uvl, [lo[k], lo[k2], hi[k2], hi[k]], [rim] * 4)

    def cap_uv(v, sign):
        c_off, r_off = -(v.y - yc) / M, -(v.z - zc) / M
        if not faces_near(sign):
            c_off = -c_off
        return atlas_uv(ax + c_off, ay + r_off)

    add_face(bm, uvl, lo[::-1], [cap_uv(v, -1) for v in lo[::-1]])
    add_face(bm, uvl, hi, [cap_uv(v, 1) for v in hi])


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------
def get_material():
    """
    One material that samples the packed atlas. Texture alpha, hardened by a Round node,
    drives the Principled alpha so the wheel gaps are see through. The glTF exporter
    recognises the Round node and writes alphaMode MASK.

    @returns {bpy.types.Material} Material named Pacific_Atlas.
    """
    img = bpy.data.images.load(ATLAS_PATH)
    img.name = "pacific_atlas.png"
    img.alpha_mode = "STRAIGHT"
    img.pack()
    mat = bpy.data.materials.new("Pacific_Atlas")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    clip = nodes.new("ShaderNodeMath")
    clip.operation = "ROUND"
    links.new(tex.outputs["Alpha"], clip.inputs[0])
    links.new(clip.outputs["Value"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.5
    for attr, val in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
        try:
            setattr(mat, attr, val)
        except (AttributeError, TypeError):
            pass
    return mat


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------
# Streamlined casing profile (image columns and rows)
CASING_COLS = [160, 175, 190, 220, 280, 335, 342, 375, 392, 405, 417, 428, 438, 446, 452, 455]
CASING_TOP = [(160, 14), (200, 8), (280, 5), (375, 4), (392, 10), (405, 24), (417, 38), (428, 52),
              (438, 70), (446, 88), (452, 104), (455, 112)]
CASING_BOTTOM = [(160, 96), (172, 88), (190, 81), (335, 80), (342, 118), (415, 124), (440, 128), (455, 116)]


def casing_stations():
    """
    Cross sections for the boiler casing and wedge nose.

    @returns {list[tuple]} Stations for loft().
    """
    out = []
    for col in CASING_COLS:
        top, bot = lerp(CASING_TOP, col), lerp(CASING_BOTTOM, col)
        hw = 52.0 * (1 - 0.75 * smoothstep(385, 455, col))
        out.append((col, top, bot, hw, hw * 0.78, min(16.0, (bot - top) / 3)))
    return out


def build_bodies(mat, root):
    """
    Tender, coal, cab, casing and the dark chassis fillers.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    bm, uvl = new_part()
    loft(bm, uvl, [(12, 38, 100, 50, 49, 3), (100, 38, 100, 50, 49, 3)], roof=DARK)
    finish("LOCO_Tender", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(40, 34, 38.5, 40, 30, 6), (52, 24, 38.5, 40, 30, 8),
                   (72, 16, 38.5, 40, 26, 8), (100, 13, 38.5, 40, 26, 8)], roof=COAL, cap_a=COAL, cap_b=COAL)
    finish("LOCO_Coal", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(14, 100, 122, 34, 34, 2), (98, 100, 122, 34, 34, 2)])
    finish("LOCO_TenderUnderframe", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(99, 30, 100, 42, 40, 4), (113, 30, 100, 42, 40, 4)], roof=DARK)
    finish("LOCO_Gangway", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(112, 28, 100, 50, 44, 6), (162, 14, 100, 50, 44, 6)], roof=SILVER)
    finish("LOCO_Cab", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, casing_stations(), roof=GREEN, cap_a=GREEN, cap_b=SILVER)
    finish("LOCO_Casing", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(165, 100, 112, 24, 24, 2), (420, 100, 112, 24, 24, 2)])
    finish("LOCO_Frame", bm, mat, root)

    bm, uvl = new_part()
    loft(bm, uvl, [(170, 80, 104, 29, 29, 2), (335, 80, 104, 29, 29, 2)])
    finish("LOCO_UnderCasingFiller", bm, mat, root)


def build_wheels(mat, root):
    """
    Three driving wheel pairs, the two front bogie wheel pairs and three tender wheel pairs,
    each pair with an axle, plus rods outside the driving wheels.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    sets = [("Drv1", 182, 116, 32.5, "A", 34), ("Drv2", 240, 116, 32.5, "B", 38.5), ("Drv3", 299, 116, 32.5, "C", 34),
            ("Bogie1", 345, 135, 13.5, "T", 30), ("Bogie2", 398, 135, 13.5, "S", 30),
            ("Tend1", 33, 134, 14, "S", 38), ("Tend2", 63, 134, 14, "S", 38), ("Tend3", 92, 134, 14, "S", 38)]
    for tag, col, row, rad, crop, lat in sets:
        for side, sx in (("L", -1), ("R", 1)):
            bm, uvl = new_part()
            wheel_disc(bm, uvl, col, row, rad, sx * lat * M, 4 * M, crop)
            finish(f"LOCO_Wheel_{tag}_{side}", bm, mat, root)
        bm, uvl = new_part()
        cylinder(bm, uvl, "X", (0, y_of_col(col), z_of_row(row)), 2 * lat * M, 2.2 * M, 8, STEEL)
        finish(f"LOCO_Axle_{tag}", bm, mat, root)

    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 45 * M
        for name, p0, p1, w in (("Coupling", (182, 117), (299, 117), 9), ("Connecting", (297, 116), (332, 96), 7),
                                ("Piston", (305, 96), (336, 94), 8)):
            bm, uvl = new_part()
            lift = 3 * M if name == "Connecting" else 0.0   # keeps overlapping rods from z-fighting
            bar(bm, uvl, p0, p1, w, x + sx * lift, 3 * M)
            finish(f"LOCO_{name}Rod_{side}", bm, mat, root)


def build_buffers(mat, root):
    """
    Front buffers under the nose and rear buffers on the tender.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    bm, uvl = new_part()
    loft(bm, uvl, [(444, 108, 122, 38, 38, 2), (453, 108, 122, 38, 38, 2)])
    finish("LOCO_BufferBeam_Front", bm, mat, root)
    for end, col0, col1, row, direction in (("Front", 452, 458, 114, -1), ("Rear", 12, 6, 106, 1)):
        for side, sx in (("L", -1), ("R", 1)):
            x = sx * 30 * M
            y0, y1 = y_of_col(col0), y_of_col(col1)
            bm, uvl = new_part()
            cylinder(bm, uvl, "Y", (x, (y0 + y1) / 2, z_of_row(row)), abs(y1 - y0), 3.5 * M, 8, STEEL)
            finish(f"LOCO_BufferStock_{end}_{side}", bm, mat, root)
            bm, uvl = new_part()
            cylinder(bm, uvl, "Y", (x, y1 + direction * 1.0 * M, z_of_row(row)), 2 * M, 7 * M, 10, RED)
            finish(f"LOCO_BufferHead_{end}_{side}", bm, mat, root)


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
    cam.location = (-22.0, -24.0, 11.0)
    cam.rotation_euler = (Vector((0, 0, 3.5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    coll.objects.link(cam)
    bpy.context.scene.camera = cam


def main():
    """
    Build the scene from scratch and save the .blend next to this script.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new("StreamlinedPacific", None)
    bpy.context.collection.objects.link(root)
    mat = get_material()
    build_bodies(mat, root)
    build_wheels(mat, root)
    build_buffers(mat, root)
    add_preview_rig()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"saved {BLEND_PATH}, {len(bpy.data.objects)} objects, {faces} faces")


if __name__ == "__main__":
    main()
