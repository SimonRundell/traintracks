# Procedural cylindrical railway tanker wagon — Blender 5.x
# Run this script from Blender's Scripting workspace (Alt+P).
# Model axes: X = wagon length, Y = width, Z = height.
# Intended for a transparent side-profile game asset render.
#
# Output folder:
# E:\TrainTracks\TrainAssets\freight\freight-003_blender\
#
# Outputs:
#   freight-003_blender.blend
#   freight-003_blender_preview.png
#
# The tank is a TRUE cylinder along the wagon's X axis, with rounded end caps.
# It is not a box or a collection of rectangular body panels.

import bpy
import math
from mathutils import Vector

# -------------------- Reset scene --------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# -------------------- Materials --------------------
def make_mat(name, color, metallic=0.0, roughness=0.4):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return material

TANK = make_mat("Galvanised silver tank", (0.52, 0.56, 0.57), 0.72, 0.28)
TANK_LIGHT = make_mat("Tank highlight metal", (0.72, 0.75, 0.75), 0.68, 0.24)
TANK_DARK = make_mat("Tank seam metal", (0.23, 0.26, 0.27), 0.78, 0.31)
STEEL = make_mat("Blackened underframe steel", (0.025, 0.031, 0.032), 0.55, 0.38)
STEEL_HI = make_mat("Machined steel edges", (0.22, 0.24, 0.24), 0.78, 0.28)
WHEEL_METAL = make_mat("Wheel faces", (0.12, 0.14, 0.14), 0.72, 0.31)
TYRE = make_mat("Wheel tyres", (0.025, 0.027, 0.026), 0.25, 0.42)
YELLOW = make_mat("Axlebox yellow", (0.94, 0.54, 0.025), 0.48, 0.27)
GLASS_DARK = make_mat("Gauge glass", (0.035, 0.07, 0.075), 0.28, 0.22)
RED = make_mat("Hazard diamond red", (0.72, 0.025, 0.012), 0.2, 0.35)
WHITE = make_mat("Hazard symbol cream", (0.95, 0.82, 0.65), 0.08, 0.42)
RUST = make_mat("Subtle weathered seams", (0.22, 0.12, 0.07), 0.25, 0.6)

# -------------------- Geometry helpers --------------------
def assign(obj, material):
    obj.data.materials.append(material)
    return obj

def bevel(obj, width=0.01, segments=2):
    if width > 0:
        mod = obj.modifiers.new("Soft manufactured edges", 'BEVEL')
        mod.width = width
        mod.segments = segments
        obj.modifiers.new("Weighted corner normals", 'WEIGHTED_NORMAL')
    return obj

def cube(name, loc, dims, material, edge=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(obj, material)
    if edge:
        bevel(obj, edge, 3 if edge > 0.025 else 2)
    return obj

def cylinder(name, loc, radius, depth, material, axis='Y', vertices=48, edge=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    obj.name = name
    if axis == 'X':
        obj.rotation_euler[1] = math.radians(90)
    elif axis == 'Y':
        obj.rotation_euler[0] = math.radians(90)
    assign(obj, material)
    if edge:
        bevel(obj, edge, 2)
    return obj

def rod(name, p1, p2, radius, material, vertices=10):
    a, b = Vector(p1), Vector(p2)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    assign(obj, material)
    return obj

def torus(name, loc, major, minor, material, rotation=(math.pi/2, 0, 0),
          major_segments=40, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                    major_segments=major_segments, minor_segments=minor_segments,
                                    location=loc, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign(obj, material)
    return obj

def side_panel(name, x, z, width, height, y=-0.76, depth=0.025, material=STEEL_HI, edge=0.004):
    return cube(name, (x, y, z), (width, depth, height), material, edge)

# -------------------- Main cylindrical tank --------------------
# Tank barrel axis is X. Blender's default cylinder axis is Z, so rotate 90° about Y.
TANK_LENGTH = 7.05
TANK_RADIUS = 0.91
TANK_CENTRE_Z = 2.05
TANK_CENTRE_Y = 0.0

bpy.ops.mesh.primitive_cylinder_add(
    vertices=96,
    radius=TANK_RADIUS,
    depth=TANK_LENGTH,
    location=(0, TANK_CENTRE_Y, TANK_CENTRE_Z),
    rotation=(0, math.radians(90), 0)
)
tank = bpy.context.object
tank.name = "MAIN TANK — continuous cylindrical barrel"
assign(tank, TANK)
for poly in tank.data.polygons:
    poly.use_smooth = True
# Small bevels soften the ends without turning the barrel into a box.
bev = tank.modifiers.new("Rounded tank end edges", 'BEVEL')
bev.width = 0.10
bev.segments = 5
tank.modifiers.new("Tank weighted normals", 'WEIGHTED_NORMAL')

# Rounded end caps: UV spheres scaled into domed end heads, intersecting the barrel slightly.
# Their circular cross-section remains consistent with the cylindrical vessel.
for s in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=48, ring_count=24,
        radius=1,
        location=(s * (TANK_LENGTH/2 - 0.025), 0, TANK_CENTRE_Z)
    )
    cap = bpy.context.object
    cap.name = "Domed pressure-vessel end cap"
    cap.scale = (0.20, TANK_RADIUS, TANK_RADIUS)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(cap, TANK_LIGHT)
    for poly in cap.data.polygons:
        poly.use_smooth = True

# Circular transverse weld seams and reinforcing bands, placed around the curved barrel.
# Torus is initially in XY plane; rotate it so its ring plane is YZ (normal along X).
for x in (-3.38, -2.55, -1.70, -0.85, 0.0, 0.85, 1.70, 2.55, 3.38):
    torus("Circumferential tank seam / band", (x, 0, TANK_CENTRE_Z),
          TANK_RADIUS * 0.995, 0.014, TANK_DARK,
          rotation=(0, math.pi/2, 0), major_segments=64, minor_segments=8)

# Fine longitudinal rolled seams along the visible upper/lower silhouette.
for angle in (math.radians(38), math.radians(142), math.radians(218), math.radians(322)):
    y = (TANK_RADIUS + 0.006) * math.sin(angle)
    z = TANK_CENTRE_Z + (TANK_RADIUS + 0.006) * math.cos(angle)
    rod("Longitudinal barrel seam", (-TANK_LENGTH/2+0.10, y, z),
        (TANK_LENGTH/2-0.10, y, z), 0.009, TANK_LIGHT, vertices=8)

# Subtle side reflections: very thin rods follow the barrel length, near the visible side.
# Positioned just outside the surface, but not enough to distort the cylinder silhouette.
for z_offset, radius, material in (
    (0.35, 0.012, TANK_LIGHT),
    (0.18, 0.007, TANK_DARK),
    (-0.42, 0.009, TANK_LIGHT),
):
    # At the visible side y, solve circular cross-section for the given z offset.
    zoff = z_offset
    y = -math.sqrt(max(0.0, TANK_RADIUS*TANK_RADIUS - zoff*zoff)) - 0.006
    rod("Subtle lengthwise tank highlight seam",
        (-TANK_LENGTH/2+0.12, y, TANK_CENTRE_Z+zoff),
        (TANK_LENGTH/2-0.12, y, TANK_CENTRE_Z+zoff),
        radius, material, vertices=8)

# -------------------- Top walkway, ladder and fittings --------------------
# Narrow catwalk along the crown.
cube("Top service walkway", (0, 0, TANK_CENTRE_Z + TANK_RADIUS + 0.09),
     (3.95, 0.48, 0.07), STEEL, 0.018)
for x in [i*0.22-1.87 for i in range(18)]:
    cube("Catwalk anti-slip crossbar", (x, 0, TANK_CENTRE_Z+TANK_RADIUS+0.132),
         (0.025, 0.44, 0.012), STEEL_HI, 0.002)

# Catwalk handrails along both sides.
for y in (-0.24, 0.24):
    rod("Walkway handrail", (-1.98, y, 3.10), (1.98, y, 3.10), 0.018, STEEL_HI)
    for x in (-1.90, -1.25, -0.60, 0.05, 0.70, 1.35, 1.90):
        rod("Handrail stanchion", (x, y, 2.92), (x, y, 3.10), 0.016, STEEL_HI)
# End handrail sections across width.
for x in (-1.98, 1.98):
    rod("Walkway end rail", (x, -0.24, 3.10), (x, 0.24, 3.10), 0.018, STEEL_HI)

# Ladder on near side: twin vertical rails plus individual rungs.
ladder_x = -0.85
for y in (-0.83, -0.62):
    rod("Tank access ladder rail", (ladder_x, y, 1.35), (ladder_x, y, 3.23), 0.026, STEEL_HI)
for z in [1.42 + i*0.17 for i in range(11)]:
    rod("Tank ladder rung", (ladder_x, -0.84, z), (ladder_x, -0.61, z), 0.018, STEEL_HI, vertices=8)
# Ladder fixing brackets.
for z in (1.65, 2.35, 3.00):
    rod("Ladder mounting bracket", (ladder_x, -0.70, z), (ladder_x, -0.91, z), 0.018, STEEL)

# Dome/manway on top.
cylinder("Manway base flange", (0.10, 0, 3.00), 0.27, 0.09, TANK_DARK, axis='Z', vertices=48, edge=0.012)
cylinder("Manway lid", (0.10, 0, 3.08), 0.22, 0.10, TANK_LIGHT, axis='Z', vertices=48, edge=0.014)
for n in range(12):
    a = 2*math.pi*n/12
    cylinder("Manway bolt", (0.10+0.245*math.cos(a), 0.245*math.sin(a), 3.055),
             0.018, 0.035, STEEL_HI, axis='Z', vertices=12, edge=0.002)

# Small valve, pipework and safety fittings on the top.
cylinder("Vent valve base", (-1.65, 0.10, 3.00), 0.10, 0.08, TANK_DARK, axis='Z', vertices=32, edge=0.01)
cylinder("Vent valve cap", (-1.65, 0.10, 3.09), 0.075, 0.10, STEEL_HI, axis='Z', vertices=32, edge=0.01)
rod("Valve pipe", (-1.65, 0.10, 3.12), (-1.65, 0.10, 3.28), 0.022, STEEL_HI)
for x in (-2.65, -2.35, 1.55, 1.85, 2.15):
    cube("Tank top mounting bracket", (x, 0, 2.96), (0.08, 0.60, 0.07), STEEL, 0.008)

# -------------------- Hazard placard on visible side --------------------
# Small diamond plate mounted just in front of the curved shell.
placard_x = 1.18
placard_z = 1.96
placard_y = -math.sqrt(TANK_RADIUS*TANK_RADIUS - (placard_z-TANK_CENTRE_Z)**2) - 0.035
placard = cube("Red hazard placard", (placard_x, placard_y, placard_z), (0.30, 0.035, 0.30), RED, 0.008)
placard.rotation_euler[1] = math.radians(45)
# Simple pale central hazard mark.
cube("Hazard placard symbol", (placard_x, placard_y-0.025, placard_z), (0.09, 0.018, 0.09), WHITE, 0.006)

# -------------------- Underframe and wagon ends --------------------
cube("Main underframe spine", (0, 0, 0.88), (8.0, 1.25, 0.20), STEEL, 0.025)
for y in (-0.67, 0.67):
    cube("Outer solebar", (0, y, 0.91), (7.85, 0.11, 0.20), STEEL, 0.018)
    cube("Solebar highlight", (0, y*1.06, 0.83), (7.60, 0.035, 0.025), STEEL_HI, 0.004)
    for x in [i*0.24-3.72 for i in range(32)]:
        cylinder("Solebar rivet", (x, y*1.09, 0.93), 0.014, 0.018, STEEL_HI, axis='Y', vertices=10, edge=0.0015)

for x in (-3.10, -2.10, -1.10, 0.0, 1.10, 2.10, 3.10):
    cube("Underframe crossbearer", (x, 0, 0.77), (0.14, 1.25, 0.13), STEEL_HI, 0.012)

for s in (-1, 1):
    cube("End buffer beam", (s*4.02, 0, 0.90), (0.17, 1.38, 0.20), STEEL, 0.022)
    for y in (-0.47, 0.47):
        cylinder("Buffer shank", (s*4.10, y, 0.95), 0.055, 0.20, STEEL, axis='X', vertices=24, edge=0.006)
        cylinder("Buffer head", (s*4.22, y, 0.95), 0.105, 0.07, STEEL_HI, axis='X', vertices=32, edge=0.008)
    cube("Coupling block", (s*4.14, 0, 0.70), (0.18, 0.20, 0.12), STEEL_HI, 0.012)
    rod("Coupling shank", (s*4.20, 0, 0.70), (s*4.34, 0, 0.68), 0.022, STEEL_HI)
    torus("Coupling loop", (s*4.34, 0, 0.66), 0.065, 0.014, STEEL_HI,
          rotation=(0, math.pi/2, 0), major_segments=20, minor_segments=6)

# -------------------- Four wheelsets and two bogies --------------------
wheel_xs = (-3.05, -2.35, 2.35, 3.05)
wheel_z = 0.47
wheel_r = 0.29

for x in wheel_xs:
    cylinder("Wheel axle", (x, 0, wheel_z), 0.052, 1.42, STEEL_HI, axis='Y', vertices=20)
    for side in (-1, 1):
        y = side * 0.72
        cylinder("Wheel tyre", (x, y, wheel_z), wheel_r, 0.14, TYRE, axis='Y', vertices=48, edge=0.010)
        cylinder("Wheel disc", (x, y+side*0.075, wheel_z), wheel_r*0.78, 0.035, WHEEL_METAL, axis='Y', vertices=48, edge=0.005)
        torus("Wheel rim", (x, y+side*0.096, wheel_z), wheel_r*0.78, 0.018, STEEL_HI,
              rotation=(math.pi/2, 0, 0), major_segments=36, minor_segments=8)
        cylinder("Wheel hub", (x, y+side*0.115, wheel_z), 0.078, 0.045, YELLOW, axis='Y', vertices=28, edge=0.006)
        cylinder("Hub cap", (x, y+side*0.145, wheel_z), 0.039, 0.02, STEEL_HI, axis='Y', vertices=20, edge=0.003)
        # Eight spokes add readable detail if the wagon is viewed close up.
        for n in range(8):
            a = 2*math.pi*n/8
            rod("Wheel spoke", (x+0.065*math.cos(a), y+side*0.103, wheel_z+0.065*math.sin(a)),
                (x+0.205*math.cos(a), y+side*0.103, wheel_z+0.205*math.sin(a)),
                0.010, STEEL_HI, vertices=8)
        cube("Axlebox housing", (x, side*0.81, 0.49), (0.18, 0.12, 0.18), STEEL, 0.012)
        cube("Yellow axlebox cover", (x, side*0.88, 0.49), (0.11, 0.025, 0.11), YELLOW, 0.012)

for centre in (-2.70, 2.70):
    for side in (-1, 1):
        y = side*0.81
        cube("Bogie side frame", (centre, y, 0.65), (1.25, 0.13, 0.14), STEEL, 0.018)
        cube("Bogie frame highlight", (centre, y+side*0.075, 0.69), (1.10, 0.025, 0.022), STEEL_HI, 0.004)
        for dx in (-0.36, 0, 0.36):
            x = centre+dx
            cube("Suspension spring seat", (x, y+side*0.08, 0.76), (0.16, 0.055, 0.025), STEEL_HI, 0.004)
            for j in range(3):
                cube("Suspension leaf spring", (x, y+side*0.10, 0.735-j*0.018),
                     (0.14-j*0.015, 0.04, 0.012), STEEL, 0.002)

# Brake rigging and visible pipes.
for x in (-3.2, -2.7, -2.0, -1.2, 0, 1.2, 2.0, 2.7, 3.2):
    rod("Brake rigging pipe", (x, -0.52, 0.59), (x+0.10, -0.52, 0.54), 0.012, STEEL_HI)

# -------------------- Camera and lights --------------------
bpy.ops.object.camera_add(location=(0, -19.5, 2.05))
camera = bpy.context.object
camera.name = "Tanker orthographic side camera"
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 9.45
camera.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = camera

bpy.ops.object.light_add(type='AREA', location=(-3.5, -7.0, 7.2))
key = bpy.context.object
key.name = "Large soft key"
key.data.energy = 1900
key.data.shape = 'DISK'
key.data.size = 8
key.rotation_euler = (Vector((0, 0, 1.7)) - key.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.light_add(type='AREA', location=(3.5, 2.5, 5.2))
fill = bpy.context.object
fill.name = "Soft fill"
fill.data.energy = 1000
fill.data.size = 6
fill.rotation_euler = (Vector((0, 0, 1.7)) - fill.location).to_track_quat('-Z', 'Y').to_euler()

# -------------------- Render settings and save --------------------
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.render.resolution_x = 1800
scene.render.resolution_y = 520
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.filepath = r"E:\TrainTracks\TrainAssets\freight\freight-003_blender\freight-003_blender_preview.png"
scene.view_settings.view_transform = 'AgX'
scene.world.color = (0.025, 0.025, 0.025)

blend_path = r"E:\TrainTracks\TrainAssets\freight\freight-003_blender\freight-003_blender.blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print("=" * 64)
print("CYLINDRICAL TANKER WAGON CREATED")
print(f"Blender project: {blend_path}")
print(f"Transparent preview: {scene.render.filepath}")
print(f"Scene object count: {len(scene.objects)}")
print("Press F12 to render the transparent side-profile image.")
print("=" * 64)
