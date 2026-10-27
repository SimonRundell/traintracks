# High-detail procedural wooden railway freight van / box truck
# Blender 5.x compatible. Run from Blender's Scripting workspace.
# Reference: user-provided side-profile image of a red-brown wooden freight van.
# Main axis: X length, Y width, Z height. -Y side is the detailed presentation side.
#
# Outputs:
# E:\TrainTracks\TrainAssets\freight\freight-001_blender\freight-001_blender.blend
# E:\TrainTracks\TrainAssets\freight\freight-001_blender\freight-001_blender_preview.png
#
# This is a detailed stylised game asset, not an engineering-accurate replica.

import bpy
import math
from mathutils import Vector

# -------------------- Reset scene --------------------
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# -------------------- Materials --------------------
def mat(name, color, metallic=0.0, roughness=0.4):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m

WOOD = mat("Oxide red painted timber", (0.32, 0.045, 0.018), 0.08, 0.52)
WOOD_LIGHT = mat("Sun-faded red timber", (0.43, 0.075, 0.032), 0.05, 0.56)
WOOD_DARK = mat("Dark red timber shadows", (0.16, 0.022, 0.012), 0.08, 0.62)
WOOD_EDGE = mat("Timber edge highlights", (0.53, 0.12, 0.045), 0.05, 0.5)
BLACK = mat("Underframe blackened steel", (0.018, 0.022, 0.023), 0.32, 0.43)
BLACK_HI = mat("Underframe edge steel", (0.09, 0.10, 0.10), 0.62, 0.32)
IRON = mat("Forged iron", (0.14, 0.15, 0.15), 0.68, 0.32)
IRON_HI = mat("Polished steel edges", (0.43, 0.45, 0.43), 0.75, 0.25)
RUBBER = mat("Wheel tyres", (0.025, 0.026, 0.025), 0.2, 0.44)
WHEEL = mat("Wheel faces", (0.16, 0.17, 0.16), 0.7, 0.3)
YELLOW = mat("Axlebox brass yellow", (0.95, 0.53, 0.025), 0.45, 0.28)
GLASS = mat("Small dark louvre opening", (0.008, 0.012, 0.012), 0.12, 0.6)
RUST = mat("Weathering rust", (0.20, 0.055, 0.018), 0.18, 0.68)
RED_LAMP = mat("Tail lamp red", (0.55, 0.012, 0.005), 0.18, 0.25)

# -------------------- Helpers --------------------
def assign(obj, material):
    if material:
        obj.data.materials.append(material)
    return obj

def bevel(obj, width=0.012, segments=2):
    if width > 0:
        mod = obj.modifiers.new("Worn manufactured edges", 'BEVEL')
        mod.width = width
        mod.segments = segments
        obj.modifiers.new("Weighted corner normals", 'WEIGHTED_NORMAL')
    return obj

def cube(name, loc, dims, material, edge=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(ob, material)
    return bevel(ob, edge, 3 if edge > 0.025 else 2)

def cylinder(name, loc, radius, depth, material, axis='Y', vertices=32, edge=0.006):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    ob = bpy.context.object
    ob.name = name
    if axis == 'Y':
        ob.rotation_euler[0] = math.radians(90)
    elif axis == 'X':
        ob.rotation_euler[1] = math.radians(90)
    assign(ob, material)
    if edge:
        bevel(ob, edge, 2)
    return ob

def rod(name, p1, p2, radius, material, vertices=10):
    a, b = Vector(p1), Vector(p2)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(a+b)/2)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    assign(ob, material)
    return ob

def torus(name, loc, major, minor, material, rotation=(math.pi/2,0,0), major_segments=32, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                    minor_segments=minor_segments, location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    assign(ob, material)
    return ob

def side_cube(name, x, z, width, height, y=-0.63, material=WOOD_LIGHT, depth=0.025, edge=0.006):
    return cube(name, (x, y, z), (width, depth, height), material, edge)

def flat_poly(name, points, y, material, thickness=0.018):
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata([(x, y, z) for x, z in points], [], [list(range(len(points)))])
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    solid = ob.modifiers.new("Raised ironwork", 'SOLIDIFY')
    solid.thickness = thickness
    bevel(ob, 0.004, 1)
    return ob

# -------------------- Wagon underframe --------------------
# Overall dimensions are deliberately similar to a long British goods van.
L = 8.2
BODY_BOTTOM = 1.25
BODY_TOP = 3.15
SIDE_Y = 0.67

cube("Long steel solebar chassis", (0, 0, 1.02), (8.05, 1.42, 0.24), BLACK, 0.035)
for y in (-0.68, 0.68):
    cube("Outer solebar", (0, y, 1.12), (7.85, 0.12, 0.24), BLACK_HI, 0.025)
    cube("Solebar lower lip", (0, y*1.07, 1.00), (7.65, 0.045, 0.045), IRON, 0.008)
    # Repeated rivets along solebar
    for x in [i*0.22-3.65 for i in range(34)]:
        cylinder("Solebar rivet", (x, y*1.095, 1.13), 0.018, 0.018, IRON_HI, axis='Y', vertices=12, edge=0.002)

# Crossbearers visible below the body.
for x in (-3.1, -2.0, -0.9, 0.2, 1.3, 2.4, 3.2):
    cube("Underframe crossbearer", (x, 0, 0.91), (0.14, 1.35, 0.15), IRON, 0.018)

# Wooden body panels, lower and upper frame.
cube("Wooden van body core", (0, 0, 2.20), (7.72, 1.24, 1.95), WOOD, 0.035)
# Keep the broad wall face visually panelled rather than flat.
for side in (-1, 1):
    y = side * 0.635
    # Horizontal planks, individually modelled.
    plank_count = 11
    z0, z1 = 1.36, 3.12
    plank_h = (z1-z0)/plank_count
    for i in range(plank_count):
        z = z0 + plank_h*(i+0.5)
        material = WOOD_LIGHT if i % 4 in (1, 2) else WOOD
        side_cube("Individual horizontal timber plank", 0, z, 7.64, plank_h-0.018,
                  y=y, material=material, depth=0.035, edge=0.008)
        # Fine plank joint / grain streaks, restrained so the model stays readable.
        if i % 2 == 0:
            side_cube("Subtle timber grain strip", -1.45+(i%3)*0.17, z+plank_h*0.15,
                      1.15, 0.012, y=y-side*0.022, material=WOOD_EDGE, depth=0.008, edge=0.002)
    # Vertical structural stanchions and end posts.
    for x in (-3.78, -3.12, -2.35, -1.58, -0.82, 0.82, 1.58, 2.35, 3.12, 3.78):
        side_cube("Vertical timber stanchion", x, 2.22, 0.075, 1.88,
                  y=y-side*0.026, material=WOOD_DARK, depth=0.07, edge=0.012)
        side_cube("Stanchion raised edge", x+0.018, 2.22, 0.018, 1.84,
                  y=y-side*0.068, material=WOOD_EDGE, depth=0.012, edge=0.003)
    # Heavy top and bottom rails.
    side_cube("Top timber rail", 0, 3.12, 7.72, 0.11, y=y-side*0.03, material=WOOD_DARK, depth=0.08, edge=0.018)
    side_cube("Top rail highlight", 0, 3.16, 7.62, 0.025, y=y-side*0.075, material=WOOD_EDGE, depth=0.012, edge=0.003)
    side_cube("Bottom timber rail", 0, 1.37, 7.72, 0.12, y=y-side*0.03, material=WOOD_DARK, depth=0.08, edge=0.015)

    # Central sliding freight door: two leaves, heavy outer frame, vertical planks.
    door_cx = 0.0
    side_cube("Door outer frame left", -0.53, 2.23, 0.09, 1.66, y=y-side*0.09, material=WOOD_DARK, depth=0.07, edge=0.01)
    side_cube("Door outer frame right", 0.53, 2.23, 0.09, 1.66, y=y-side*0.09, material=WOOD_DARK, depth=0.07, edge=0.01)
    side_cube("Door lintel", 0, 3.02, 1.10, 0.09, y=y-side*0.09, material=WOOD_DARK, depth=0.07, edge=0.01)
    side_cube("Door threshold", 0, 1.43, 1.10, 0.09, y=y-side*0.09, material=IRON, depth=0.07, edge=0.01)
    for j in range(8):
        x = -0.46 + j*(0.92/7)
        side_cube("Vertical sliding door board", x, 2.22, 0.105, 1.49,
                  y=y-side*0.11, material=WOOD_LIGHT if j%3 else WOOD, depth=0.04, edge=0.006)
    # Door rollers and locking bars.
    for x in (-0.42, 0.42):
        rod("Door vertical iron locking bar", (x, y-side*0.15, 1.56), (x, y-side*0.15, 2.88), 0.018, IRON_HI)
        for z in (1.67, 2.77):
            cube("Locking bar bracket", (x, y-side*0.16, z), (0.10, 0.035, 0.075), IRON, 0.008)
        cube("Locking handle", (x, y-side*0.18, 2.15), (0.12, 0.035, 0.07), IRON_HI, 0.012)

    # Diagonal braces form the characteristic freight-van X/chevron structure.
    flat_poly("Diagonal timber brace left lower", [(-3.62,1.48),(-3.49,1.48),(-2.32,2.97),(-2.46,2.97)], y-side*0.075, WOOD_DARK)
    flat_poly("Diagonal brace highlight left", [(-3.57,1.50),(-3.53,1.50),(-2.38,2.92),(-2.42,2.92)], y-side*0.09, WOOD_EDGE, 0.01)
    flat_poly("Diagonal timber brace left upper", [(-3.62,2.98),(-3.48,2.98),(-2.32,1.50),(-2.46,1.50)], y-side*0.075, WOOD_DARK)
    flat_poly("Diagonal timber brace right upper", [(2.32,2.98),(2.46,2.98),(3.62,1.50),(3.48,1.50)], y-side*0.075, WOOD_DARK)
    flat_poly("Diagonal timber brace right lower", [(2.32,1.50),(2.46,1.50),(3.62,2.98),(3.48,2.98)], y-side*0.075, WOOD_DARK)

    # End door-side louvred vent near the upper right.
    side_cube("Vent recess", 2.55, 2.77, 0.52, 0.36, y=y-side*0.09, material=GLASS, depth=0.035, edge=0.008)
    for z in (2.63, 2.70, 2.77, 2.84, 2.91):
        side_cube("Vent louvre slat", 2.55, z, 0.43, 0.025, y=y-side*0.12, material=IRON, depth=0.025, edge=0.004)
    for x in (2.28, 2.82):
        side_cube("Vent frame upright", x, 2.77, 0.035, 0.42, y=y-side*0.13, material=IRON_HI, depth=0.025, edge=0.004)

    # Small metal brackets / bolt heads along the frame.
    for x in (-3.45, -2.75, -1.95, 1.95, 2.75, 3.45):
        for z in (1.58, 2.95):
            cylinder("Timber-frame bolt", (x, y-side*0.13, z), 0.025, 0.022, IRON_HI, axis='Y', vertices=12, edge=0.002)

# Roof: narrow curved-looking roof built from overlapping boards and metal hoops.
cube("Roof substrate", (0, 0, 3.20), (7.82, 1.32, 0.14), BLACK, 0.035)
cube("Roof timber crown", (0, 0, 3.275), (7.65, 1.25, 0.09), WOOD_DARK, 0.025)
for x in [i*0.42-3.55 for i in range(18)]:
    cube("Roof board seam", (x, 0, 3.325), (0.018, 1.18, 0.012), WOOD_EDGE, 0.003)
for x in (-3.55, -2.65, -1.75, -0.85, 0.05, 0.95, 1.85, 2.75, 3.55):
    # roof hoop runs across width and is visible as a slim dark rail from the side
    rod("Roof hoop side segment", (x, -0.68, 3.22), (x, 0.68, 3.22), 0.018, IRON)

# -------------------- Buffers, coupling and tail lamps --------------------
for s in (-1, 1):
    # End buffer beam
    cube("End buffer beam", (s*4.00, 0, 1.02), (0.16, 1.40, 0.20), BLACK, 0.025)
    for y in (-0.48, 0.48):
        cylinder("Buffer shank", (s*4.08, y, 1.08), 0.065, 0.22, BLACK, axis='X', vertices=24)
        cylinder("Round buffer head", (s*4.20, y, 1.08), 0.12, 0.075, IRON_HI, axis='X', vertices=32)
        cylinder("Buffer face dark centre", (s*4.245, y, 1.08), 0.075, 0.018, IRON, axis='X', vertices=24)
    cylinder("Tail lamp housing", (s*4.08, -0.58, 1.19), 0.075, 0.065, BLACK, axis='Y', vertices=24)
    cylinder("Tail lamp lens", (s*4.08, -0.625, 1.19), 0.048, 0.025, RED_LAMP, axis='Y', vertices=24)
    cube("Coupling block", (s*4.13, 0, 0.86), (0.20, 0.22, 0.12), IRON, 0.018)
    rod("Coupling shank", (s*4.20, 0, 0.86), (s*4.36, 0, 0.83), 0.026, IRON_HI)
    torus("Coupling loop", (s*4.36, 0, 0.81), 0.075, 0.018, IRON_HI,
          rotation=(0, math.pi/2, 0), major_segments=20, minor_segments=6)

# -------------------- Two detailed two-axle bogies --------------------
wheel_centres = (-2.85, -2.25, 2.25, 2.85)
wheel_z = 0.68
wheel_r = 0.34

for x in wheel_centres:
    cylinder("Axle", (x, 0, wheel_z), 0.065, 1.48, BLACK_HI, axis='Y', vertices=20)
    for side in (-1, 1):
        y = side*0.73
        cylinder("Wheel tyre", (x, y, wheel_z), wheel_r, 0.15, RUBBER, axis='Y', vertices=48, edge=0.014)
        cylinder("Wheel disc", (x, y+side*0.08, wheel_z), wheel_r*0.80, 0.035, WHEEL, axis='Y', vertices=48, edge=0.006)
        torus("Wheel rim", (x, y+side*0.105, wheel_z), wheel_r*0.80, 0.022, IRON_HI,
              rotation=(math.pi/2,0,0), major_segments=40, minor_segments=8)
        cylinder("Wheel hub", (x, y+side*0.12, wheel_z), 0.105, 0.055, YELLOW, axis='Y', vertices=32, edge=0.008)
        cylinder("Hub centre", (x, y+side*0.16, wheel_z), 0.052, 0.025, IRON, axis='Y', vertices=24, edge=0.004)
        # Decorative wheel spokes on both outer faces.
        for n in range(8):
            a = 2*math.pi*n/8
            p1 = (x+0.09*math.cos(a), y+side*0.112, wheel_z+0.09*math.sin(a))
            p2 = (x+0.25*math.cos(a), y+side*0.112, wheel_z+0.25*math.sin(a))
            rod("Wheel spoke", p1, p2, 0.014, IRON, vertices=8)
    # Axlebox on each side
    for side in (-1,1):
        y = side*0.82
        cube("Axlebox housing", (x, y, 0.70), (0.22, 0.12, 0.22), BLACK, 0.018)
        cube("Axlebox cover", (x, y+side*0.07, 0.70), (0.13, 0.025, 0.13), YELLOW, 0.015)
        cylinder("Axlebox bolt", (x, y+side*0.09, 0.70), 0.022, 0.02, IRON_HI, axis='Y', vertices=12, edge=0.002)

# Bogie frames and suspension components
for centre in (-2.55, 2.55):
    for side in (-1,1):
        y = side*0.82
        cube("Bogie side beam", (centre, y, 0.86), (1.35, 0.13, 0.16), BLACK, 0.022)
        cube("Bogie upper edge", (centre, y+side*0.075, 0.91), (1.18, 0.025, 0.025), IRON, 0.004)
        for dx in (-0.40, 0, 0.40):
            x = centre+dx
            cube("Spring seat", (x, y+side*0.09, 0.98), (0.20, 0.06, 0.035), IRON, 0.005)
            for j in range(3):
                cube("Leaf spring", (x, y+side*0.10, 0.955-j*0.025), (0.18-j*0.02, 0.055, 0.014), BLACK_HI, 0.003)
        for dx in (-0.48,0.48):
            rod("Brake pull rod", (centre+dx, y+side*0.11, 0.74), (centre+dx*0.65, y+side*0.11, 0.74), 0.014, IRON_HI)

# -------------------- Brake rigging and underside details --------------------
for x in (-3.1, -2.4, -1.4, -0.4, 0.6, 1.6, 2.5, 3.1):
    rod("Brake pipe", (x, -0.54, 0.72), (x+0.12, -0.54, 0.66), 0.018, IRON)
cube("Central underframe equipment box", (0, 0, 0.82), (1.25, 0.82, 0.25), BLACK, 0.035)
for x in (-0.45, 0, 0.45):
    cube("Equipment access panel", (x, -0.43, 0.82), (0.28, 0.025, 0.15), BLACK_HI, 0.008)

# -------------------- Camera and lighting --------------------
bpy.ops.object.camera_add(location=(0, -18.5, 3.15))
camera = bpy.context.object
camera.name = "Freight van side profile camera"
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 9.5
camera.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = camera

bpy.ops.object.light_add(type='AREA', location=(-3.0, -7.0, 7.5))
key = bpy.context.object
key.name = "Large softbox"
key.data.energy = 1800
key.data.shape = 'DISK'
key.data.size = 8
key.rotation_euler = (Vector((0, 0, 2.0)) - key.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.light_add(type='AREA', location=(3.5, 3.0, 5.5))
fill = bpy.context.object
fill.name = "Fill light"
fill.data.energy = 1000
fill.data.size = 6
fill.rotation_euler = (Vector((0, 0, 2.0)) - fill.location).to_track_quat('-Z', 'Y').to_euler()

# -------------------- Transparent render settings and save --------------------
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
scene.render.filepath = r"E:\TrainTracks\TrainAssets\freight\freight-001_blender\freight-001_blender_preview.png"
scene.view_settings.view_transform = 'AgX'
scene.world.color = (0.025, 0.025, 0.025)

# Save .blend project. Folder must exist first.
blend_path = r"E:\TrainTracks\TrainAssets\freight\freight-001_blender\freight-001_blender.blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print("=" * 60)
print("FREIGHT VAN MODEL CREATED")
print(f"Blender project: {blend_path}")
print(f"Render output: {scene.render.filepath}")
print(f"Scene object count: {len(scene.objects)}")
print("Press F12 to render the transparent side-profile preview.")
print("=" * 60)
