"""
build_carriage.py

Builds a low poly British Rail Mk3 InterCity carriage in Blender from the
proportions of a single side view photo (loco-20-carriage.png), then saves
mk3_carriage.blend. Mirrors the approach used for the HST power car in
loco-020_blender/build_hst.py.

The whole model uses ONE material that samples ONE atlas texture
(carriage_atlas.png, made by make_carriage_atlas.py). The side livery is
projected onto the body sides from the real photo. Every other part
(buffers, wheels, roof, underframe) picks a flat colour from a swatch cell.
That keeps it to a single draw call when exported to glTF for Three.js.

Axes and units:
  - Metres. Origin at the centre of the vehicle on the rail head.
  - Length runs along Y. The livery side faces +X.
  - The carriage is end-to-end symmetric, so there is no dedicated "front".

Run it with Blender:
  blender --background --python build_carriage.py

Licence: Creative Commons BY-NC-SA 4.0 International
https://creativecommons.org/licenses/by-nc-sa/4.0/
"""
import os

import bpy
import bmesh
from mathutils import Vector

# ---------------------------------------------------------------------------
# Constants taken from the side photo (2172 x 724 px) and real Mk3 coach data
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS_PATH = os.path.join(HERE, "carriage_atlas.png")
BLEND_PATH = os.path.join(HERE, "mk3_carriage.blend")

IMG_W = 2172.0
FRONT_PX, REAR_PX = 14.0, 2158.0
METRES_PER_PX = 23.0 / (REAR_PX - FRONT_PX)   # 23 m over buffers, matching real Mk3 stock
GROUND_ROW = 580.0                             # image row where the wheel treads touch the rail
CENTRE_PX = (FRONT_PX + REAR_PX) / 2.0
ATLAS_SCALE = 1024.0 / IMG_W                   # original photo px -> atlas px
ATLAS_W, ATLAS_H = 1024.0, 1024.0
FAR_ROW_OFFSET = 350                           # far side livery sits this many atlas rows down

BODY_HALF_W = 1.37                             # 2.74 m wide body, same as the HST power car
ROOF_HALF_W = 1.25
CHAMFER_H = 0.20
BODY_BOTTOM_PX = 467.0                         # lower edge of the white/red band in the photo
UNDERFRAME_BOTTOM_PX = 545.0
BUFFER_ROW = 483.0

# Roof profile: flat along most of the length, rounding off at both ends.
ROOF_PROFILE = [
    (14, 300), (40, 270), (70, 235), (100, 215), (160, 210), (300, 209),
    (600, 208), (1086, 208), (1570, 208), (1870, 209), (2010, 210),
    (2070, 215), (2100, 235), (2130, 270), (2158, 300),
]
STATIONS_PX = [p[0] for p in ROOF_PROFILE]
END_TAPER_PX = 60.0                            # how far the rounded end caps extend inward

# Bogies: centre column and half wheelbase in pixels, from the wheel positions in the photo.
BOGIE_CENTRES_PX = (362.0, 1808.0)
HALF_WHEELBASE_PX = 141.0

# Swatch indices, matching make_carriage_atlas.py
YELLOW, DARK, GLASS, ROOF, STEEL, RED, CREAM = range(7)
SWATCH_PX, SWATCH_X0, SWATCH_Y0 = 64, 0, 700


# ---------------------------------------------------------------------------
# Helpers (same approach as build_hst.py)
# ---------------------------------------------------------------------------
def px_to_y(px):
    """
    Convert a photo column to a world Y position.

    @param {float} px Image column in pixels.
    @returns {float} Y in metres.
    """
    return (px - CENTRE_PX) * METRES_PER_PX


def row_to_z(row):
    """
    Convert a photo row to a world Z height.

    @param {float} row Image row in pixels (0 is the top).
    @returns {float} Z in metres above the rail.
    """
    return (GROUND_ROW - row) * METRES_PER_PX


def z_to_row(z):
    """
    Inverse of row_to_z.

    @param {float} z Height in metres.
    @returns {float} Image row in pixels.
    """
    return GROUND_ROW - z / METRES_PER_PX


def lerp_profile(table, px):
    """
    Linear interpolation through a sorted (x, value) table.

    @param {list[tuple]} table Sorted pairs.
    @param {float} px Query position.
    @returns {float} Interpolated value, clamped at both ends.
    """
    if px <= table[0][0]:
        return table[0][1]
    for (x0, v0), (x1, v1) in zip(table, table[1:]):
        if px <= x1:
            t = (px - x0) / (x1 - x0)
            return v0 + t * (v1 - v0)
    return table[-1][1]


def smoothstep(a, b, x):
    """
    Smooth 0..1 ramp between a and b.

    @param {float} a Start.
    @param {float} b End.
    @param {float} x Value.
    @returns {float} Eased value in [0, 1].
    """
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def swatch_uv(index):
    """
    UV at the centre of a flat colour swatch cell in the atlas.

    @param {int} index Swatch number.
    @returns {tuple} (u, v) in Blender UV space (origin bottom left).
    """
    x = SWATCH_X0 + index * SWATCH_PX + SWATCH_PX / 2
    y = SWATCH_Y0 + SWATCH_PX / 2
    return (x / ATLAS_W, 1.0 - y / ATLAS_H)


def livery_uv(world_y, world_z, far_side):
    """
    Project a point on the body side onto the livery part of the atlas.

    @param {float} world_y Y position in metres.
    @param {float} world_z Z position in metres.
    @param {bool} far_side True for the -X side (mirrored photo).
    @returns {tuple} (u, v).
    """
    col = world_y / METRES_PER_PX + CENTRE_PX
    row = z_to_row(world_z)
    if far_side:
        col = IMG_W - col
    atlas_col = col * ATLAS_SCALE
    atlas_row = row * ATLAS_SCALE + (FAR_ROW_OFFSET if far_side else 0)
    return (atlas_col / ATLAS_W, 1.0 - atlas_row / ATLAS_H)


def get_material():
    """
    Create the single shared material from the atlas image. The image is packed
    into the .blend so the file is self contained.

    @returns {bpy.types.Material} Material named Carriage_Atlas.
    """
    img = bpy.data.images.load(ATLAS_PATH)
    img.name = "carriage_atlas.png"
    img.pack()
    mat = bpy.data.materials.new("Carriage_Atlas")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def make_object(name, bm, mat, parent):
    """
    Weld the corners, make every normal point outward, and turn the bmesh into a named
    object that uses the shared material.

    @param {str} name Object name.
    @param {bmesh.types.BMesh} bm Finished geometry.
    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} parent Root empty.
    @returns {bpy.types.Object} The new object.
    """
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    obj.parent = parent
    bpy.context.collection.objects.link(obj)
    return obj


def add_quad(bm, uv_layer, verts, uvs):
    """
    Add one face with explicit UVs.

    @param {bmesh.types.BMesh} bm Target mesh.
    @param {bmesh.types.BMLayerItem} uv_layer UV layer.
    @param {list[Vector]} verts Corner positions, counter clockwise seen from outside.
    @param {list[tuple]} uvs One UV per corner.
    """
    bverts = [bm.verts.new(v) for v in verts]
    face = bm.faces.new(bverts)
    for loop, uv in zip(face.loops, uvs):
        loop[uv_layer].uv = uv


def box_mesh(centre, size, swatch):
    """
    Axis aligned box with every face on one flat colour swatch.

    @param {tuple} centre (x, y, z) in metres.
    @param {tuple} size (sx, sy, sz) in metres.
    @param {int} swatch Swatch index.
    @returns {bmesh.types.BMesh} Geometry.
    """
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    cx, cy, cz = centre
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    c = [(cx + sx * hx, cy + sy * hy, cz + sz * hz)
         for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    uv = swatch_uv(swatch)
    for f in faces:
        add_quad(bm, uvl, [Vector(c[i]) for i in f], [uv] * 4)
    return bm


def cylinder_mesh(centre, axis, radius, length, segments, swatch):
    """
    Capped cylinder along X or Y with flat colour.

    @param {tuple} centre (x, y, z) in metres.
    @param {str} axis 'X' or 'Y'.
    @param {float} radius Radius in metres.
    @param {float} length Length in metres.
    @param {int} segments Sides.
    @param {int} swatch Swatch index.
    @returns {bmesh.types.BMesh} Geometry.
    """
    import math
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    uv = swatch_uv(swatch)
    cx, cy, cz = centre

    def pt(a, k):
        r = (math.cos(a) * radius, math.sin(a) * radius)
        if axis == "X":
            return Vector((cx + k * length / 2, cy + r[0], cz + r[1]))
        return Vector((cx + r[0], cy + k * length / 2, cz + r[1]))

    angles = [2 * math.pi * i / segments for i in range(segments)]
    ring_a = [pt(a, -1) for a in angles]
    ring_b = [pt(a, 1) for a in angles]
    for i in range(segments):
        j = (i + 1) % segments
        add_quad(bm, uvl, [ring_a[i], ring_a[j], ring_b[j], ring_b[i]], [uv] * 4)
    add_quad(bm, uvl, ring_a[::-1], [uv] * segments)
    add_quad(bm, uvl, ring_b, [uv] * segments)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------
def end_round_factor(px):
    """
    Width multiplier in [0.75, 1] that rounds the body in at both ends.

    @param {float} px Image column in pixels.
    @returns {float} Width multiplier.
    """
    front = 0.75 + 0.25 * smoothstep(FRONT_PX, FRONT_PX + END_TAPER_PX, px)
    rear = 0.75 + 0.25 * (1 - smoothstep(REAR_PX - END_TAPER_PX, REAR_PX, px))
    return min(front, rear)


def build_body(mat, root):
    """
    Loft the main body through cross sections that follow the side silhouette.
    Each section has six corners: two at the bottom, two at the shoulder, two on
    the roof. Plan view width rounds off at both ends, since this coach has no
    distinct front.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    @returns {bpy.types.Object} Carriage_Body.
    """
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings = []
    zb_flat = row_to_z(BODY_BOTTOM_PX)
    for px in STATIONS_PX:
        y = px_to_y(px)
        zt = row_to_z(lerp_profile(ROOF_PROFILE, px))
        zb = min(zb_flat, zt - 0.3)
        hw = BODY_HALF_W * end_round_factor(px)
        hr = min(ROOF_HALF_W, hw * 0.85)
        zs = max(zt - CHAMFER_H, zb + 0.15)
        rings.append((y, [
            Vector((-hw, y, zb)), Vector((hw, y, zb)),
            Vector((hw, y, zs)), Vector((hr, y, zt)),
            Vector((-hr, y, zt)), Vector((-hw, y, zs)),
        ]))

    dark, roof = swatch_uv(DARK), swatch_uv(ROOF)
    for (ya, ra), (yb, rb) in zip(rings, rings[1:]):
        # 0 bottom, 1 +X side, 2 +X chamfer, 3 roof, 4 -X chamfer, 5 -X side
        for k in range(6):
            if k == 0:
                add_quad(bm, uvl, [ra[0], rb[0], rb[1], ra[1]], [dark] * 4)
            elif k == 3:
                add_quad(bm, uvl, [ra[3], ra[4], rb[4], rb[3]], [roof] * 4)
            elif k in (1, 2):
                q = [ra[1], rb[1], rb[2], ra[2]] if k == 1 else [ra[2], rb[2], rb[3], ra[3]]
                add_quad(bm, uvl, q, [livery_uv(v.y, v.z, False) for v in q])
            else:
                q = [ra[4], rb[4], rb[5], ra[5]] if k == 4 else [ra[5], rb[5], rb[0], ra[0]]
                add_quad(bm, uvl, q, [livery_uv(v.y, v.z, True) for v in q])

    yellow = swatch_uv(YELLOW)
    front = [Vector(v) for v in rings[0][1]]
    rear = [Vector(v) for v in rings[-1][1]]
    add_quad(bm, uvl, front[::-1], [yellow] * 6)
    add_quad(bm, uvl, rear, [yellow] * 6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return make_object("Carriage_Body", bm, mat, root)


def build_ends(mat, root):
    """
    Buffer beams and the four buffers (stock plus head) at each end.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    zb = row_to_z(BUFFER_ROW)
    for name, px, direction in (("A", FRONT_PX, -1), ("B", REAR_PX, 1)):
        y = px_to_y(px)
        beam = box_mesh((0, y + direction * 0.06, zb), (2.60, 0.16, 0.40), DARK)
        make_object(f"Carriage_BufferBeam_{name}", beam, mat, root)
        for side, x in (("L", -0.875), ("R", 0.875)):
            stock = cylinder_mesh((x, y + direction * 0.20, zb), "Y", 0.09, 0.26, 8, STEEL)
            make_object(f"Carriage_BufferStock_{name}_{side}", stock, mat, root)
            head = cylinder_mesh((x, y + direction * 0.36, zb), "Y", 0.19, 0.07, 10, STEEL)
            make_object(f"Carriage_BufferHead_{name}_{side}", head, mat, root)


def build_underframe(mat, root):
    """
    Dark filler under the body: a narrow skirt along the full length so the
    bogies read clearly, and wider equipment boxes between them.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    z_top, z_bot = row_to_z(BODY_BOTTOM_PX), row_to_z(UNDERFRAME_BOTTOM_PX)
    y0, y1 = px_to_y(FRONT_PX + 40), px_to_y(REAR_PX - 40)
    skirt = box_mesh((0, (y0 + y1) / 2, (z_top + z_bot) / 2 + 0.02),
                     (1.30, y1 - y0, z_top - z_bot + 0.04), DARK)
    make_object("Carriage_Underframe", skirt, mat, root)
    c0, c1 = BOGIE_CENTRES_PX
    t0, t1 = px_to_y(c0 + 160), px_to_y(c1 - 160)
    equip = box_mesh((0, (t0 + t1) / 2, (z_top + z_bot) / 2 + 0.02),
                     (2.00, t1 - t0, z_top - z_bot - 0.02), DARK)
    make_object("Carriage_Equipment", equip, mat, root)


def build_bogie(index, centre_px, mat, root):
    """
    One two axle bogie: two side frames, a transom, two axles and four wheels.
    Unlike the HST power car, coach bogies carry no traction motors.

    @param {int} index 1 for the A-end bogie, 2 for the B-end.
    @param {float} centre_px Bogie centre column in the photo.
    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    yc = px_to_y(centre_px)
    half_wb = HALF_WHEELBASE_PX * METRES_PER_PX
    r = 0.52
    for side, x in (("L", -1.0), ("R", 1.0)):
        frame = box_mesh((x, yc, 0.80), (0.16, 3.10, 0.30), DARK)
        make_object(f"Carriage_Bogie{index}_Sideframe_{side}", frame, mat, root)
    transom = box_mesh((0, yc, 0.80), (1.90, 0.45, 0.28), DARK)
    make_object(f"Carriage_Bogie{index}_Transom", transom, mat, root)
    for ax, dy in (("A", -half_wb), ("B", half_wb)):
        axle = cylinder_mesh((0, yc + dy, r), "X", 0.07, 1.60, 8, STEEL)
        make_object(f"Carriage_Bogie{index}_Axle_{ax}", axle, mat, root)
        for side, x in (("L", -0.76), ("R", 0.76)):
            wheel = cylinder_mesh((x, yc + dy, r), "X", r, 0.13, 14, STEEL)
            make_object(f"Carriage_Bogie{index}_Wheel_{ax}{side}", wheel, mat, root)


def build_roof_vents(mat, root):
    """
    Two flat grille panels on the roof.

    @param {bpy.types.Material} mat Shared material.
    @param {bpy.types.Object} root Parent empty.
    """
    for i, px in enumerate((800, 1370)):
        zt = row_to_z(lerp_profile(ROOF_PROFILE, px))
        vent = box_mesh((0, px_to_y(px), zt + 0.015), (1.20, 1.10, 0.05), DARK)
        make_object(f"Carriage_RoofVent_{i + 1}", vent, mat, root)


def add_preview_rig():
    """
    Camera and sun in their own collection so they are easy to exclude from export.

    @returns {None}
    """
    import math
    coll = bpy.data.collections.new("Preview_NotExported")
    bpy.context.scene.collection.children.link(coll)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    coll.objects.link(sun)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.location = (24.0, -26.0, 7.0)
    direction = Vector((0, 0, 1.9)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 50
    coll.objects.link(cam)
    bpy.context.scene.camera = cam


def main():
    """
    Build the scene from scratch and save the .blend next to this script.

    @returns {None}
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new("Mk3Carriage", None)
    bpy.context.collection.objects.link(root)
    mat = get_material()

    build_body(mat, root)
    build_ends(mat, root)
    build_underframe(mat, root)
    for i, c in enumerate(BOGIE_CENTRES_PX, start=1):
        build_bogie(i, c, mat, root)
    build_roof_vents(mat, root)
    add_preview_rig()

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"saved {BLEND_PATH}, {len(bpy.data.objects)} objects, {tris} faces")


if __name__ == "__main__":
    main()
