# High-detail procedural British Rail blue diesel locomotive
# Blender 5.x compatible. Run from Blender's Scripting workspace.
# Keeps the same output path:
# E:\TrainTracks\TrainAssets\loco-034_blender\loco-034_blender.blend
#
# This is a detailed, editable stylised reconstruction based on the supplied
# side-profile image, not an exact engineering model. Main axis: X length,
# Y width, Z height. The -Y side is the primary presentation side.

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

BLUE = make_mat("BR blue enamel", (0.012, 0.075, 0.22), 0.38, 0.28)
BLUE_LIGHT = make_mat("Blue panel highlight", (0.025, 0.12, 0.30), 0.30, 0.30)
BLUE_DARK = make_mat("Deep blue panel shadow", (0.006, 0.035, 0.095), 0.25, 0.42)
YELLOW = make_mat("Warning yellow", (1.0, 0.56, 0.008), 0.18, 0.3)
YELLOW_LIGHT = make_mat("Yellow highlight", (1.0, 0.72, 0.045), 0.15, 0.28)
FRAME = make_mat("Underframe black", (0.018, 0.022, 0.026), 0.24, 0.44)
FRAME_EDGE = make_mat("Underframe edge steel", (0.09, 0.105, 0.11), 0.55, 0.32)
RUBBER = make_mat("Wheel tyre dark steel", (0.025, 0.028, 0.03), 0.22, 0.4)
WHEEL = make_mat("Wheel web steel", (0.09, 0.10, 0.105), 0.68, 0.27)
METAL = make_mat("Bright steel", (0.42, 0.46, 0.48), 0.78, 0.23)
METAL_DARK = make_mat("Dark steel", (0.075, 0.085, 0.09), 0.68, 0.3)
GLASS = make_mat("Cab glass blue-black", (0.012, 0.065, 0.085), 0.42, 0.15)
GLASS_HI = make_mat("Glass reflection", (0.11, 0.25, 0.29), 0.35, 0.2)
WHITE = make_mat("BR emblem white", (0.9, 0.92, 0.88), 0.15, 0.3)
RED = make_mat("Marker lamp red", (0.55, 0.012, 0.008), 0.15, 0.23)
LENS = make_mat("Lamp glass", (1.0, 0.78, 0.25), 0.15, 0.18)
VENT_DARK = make_mat("Vent interiors", (0.004, 0.012, 0.022), 0.1, 0.55)
GRIME = make_mat("Weathered blue lower edge", (0.025, 0.045, 0.065), 0.22, 0.52)
RUST = make_mat("Subtle rust brown", (0.18, 0.055, 0.018), 0.18, 0.65)

# -------------------- Helpers --------------------
def assign(obj, material):
    if material:
        obj.data.materials.append(material)
    return obj

def bevel_obj(obj, width=0.025, segments=2):
    if width > 0:
        mod = obj.modifiers.new("Small manufactured edge bevel", 'BEVEL')
        mod.width = width
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        obj.modifiers.new("Weighted corner normals", 'WEIGHTED_NORMAL')
    return obj

def cube(name, loc, dims, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(ob, material)
    return bevel_obj(ob, bevel, 3 if bevel > 0.035 else 2)

def uv_sphere(name, loc, scale, material, segments=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(ob, material)
    return ob

def cylinder(name, loc, radius, depth, material, axis='Y', vertices=32, bevel=0.012):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    ob = bpy.context.object
    ob.name = name
    if axis == 'Y':
        ob.rotation_euler[0] = math.radians(90)
    elif axis == 'X':
        ob.rotation_euler[1] = math.radians(90)
    elif axis == 'Z':
        pass
    assign(ob, material)
    if bevel:
        bevel_obj(ob, bevel, 2)
    return ob

def rod(name, p1, p2, radius, material, vertices=12):
    a, b = Vector(p1), Vector(p2)
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length, location=(a+b)/2)
    ob = bpy.context.object
    ob.name = name
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = delta.to_track_quat('Z', 'Y')
    assign(ob, material)
    return ob

def side_panel(name, x, z, width, height, y=-0.666, material=BLUE_LIGHT, thickness=0.018, bevel=0.008):
    return cube(name, (x, y, z), (width, thickness, height), material, bevel)

def torus(name, loc, major, minor, material, rotation=(math.pi/2, 0, 0), major_segments=32, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                    major_segments=major_segments, minor_segments=minor_segments,
                                    location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    assign(ob, material)
    return ob

# -------------------- Main body shell --------------------
# Six-wheel diesel silhouette: long hood, slightly raised cab ends and rounded roof.
cube("Main chassis spine", (0, 0, 1.08), (7.55, 1.20, 0.42), FRAME, 0.06)
cube("Long blue engine hood", (-0.20, 0, 2.08), (5.55, 1.28, 1.54), BLUE, 0.11)
cube("Cab centre body", (2.90, 0, 2.12), (1.10, 1.30, 1.58), BLUE, 0.09)
cube("Cab left end body", (-3.23, 0, 2.12), (0.88, 1.30, 1.58), BLUE, 0.08)
cube("Cab right end body", (3.55, 0, 2.12), (0.55, 1.30, 1.58), BLUE, 0.07)

# Roof with raised rounded shoulders and multiple access plates.
cube("Continuous roof cap", (0.0, 0, 2.91), (7.20, 1.18, 0.17), BLUE_DARK, 0.075)
cube("Roof centre enamel", (0.0, 0, 2.995), (6.45, 1.02, 0.065), BLUE, 0.025)
for x in (-2.85, -2.15, -1.45, -0.75, 0.0, 0.75, 1.45, 2.15):
    cube("Roof panel seam", (x, 0, 3.033), (0.018, 0.94, 0.012), METAL_DARK, 0.003)
for x in (-2.25, -1.25, 0.85, 1.75):
    cube("Roof cooling grille base", (x, 0, 3.045), (0.50, 0.62, 0.035), FRAME, 0.018)
    for i in range(7):
        cube("Roof cooling grille slat", (x, -0.27 + i*0.09, 3.071), (0.39, 0.025, 0.018), METAL_DARK, 0.004)
for x in (-0.25, 0.35):
    cube("Roof hatch", (x, 0, 3.05), (0.42, 0.48, 0.055), BLUE_LIGHT, 0.018)
    for y in (-0.16, 0.16):
        cube("Roof hatch rib", (x, y, 3.083), (0.34, 0.018, 0.015), METAL, 0.003)

# Yellow cab end faces and front/rear corner wraps.
for s in (-1, 1):
    x = s * 3.82
    cube("Yellow end face", (x, 0, 2.08), (0.16, 1.31, 1.55), YELLOW, 0.045)
    cube("Yellow upper corner wrap", (s*3.61, 0, 2.68), (0.28, 1.32, 0.36), YELLOW, 0.035)
    # End windscreen panes (front face at +/-X)
    for y in (-0.40, 0.40):
        cube("End windscreen rubber seal", (s*3.915, y, 2.39), (0.025, 0.40, 0.34), FRAME, 0.02)
        cube("End windscreen glass", (s*3.932, y, 2.39), (0.018, 0.34, 0.28), GLASS, 0.018)
        cube("Windscreen glint", (s*3.945, y-0.06, 2.43), (0.008, 0.045, 0.18), GLASS_HI, 0.005)
    # End access grille / steps
    for z in (1.82, 1.96, 2.10):
        cube("End grille slot", (s*3.925, 0, z), (0.02, 0.30, 0.045), FRAME, 0.006)
    # Corner side windows, framed separately.
    for wx in (s*3.18, s*2.72):
        cube("Cab side window frame", (wx, -0.667, 2.42), (0.34, 0.04, 0.44), FRAME, 0.035)
        cube("Cab side glass", (wx, -0.691, 2.42), (0.275, 0.018, 0.365), GLASS, 0.025)
        cube("Window reflection", (wx-0.065, -0.704, 2.44), (0.035, 0.008, 0.27), GLASS_HI, 0.006)
        cube("Window vertical divider", (wx+0.08, -0.711, 2.42), (0.018, 0.012, 0.39), METAL_DARK, 0.003)
    # Windscreen wipers
    rod("Windscreen wiper", (s*3.92, -0.58, 2.20), (s*3.92, -0.27, 2.25), 0.012, FRAME)
    # Side yellow warning panels wrapping round corners.
    side_panel("Yellow side warning panel", s*3.57, 2.05, 0.30, 1.32, -0.673, YELLOW, 0.025, 0.018)
    # Headlamps on both ends, paired vertically.
    for z in (1.86, 2.72):
        cylinder("End lamp housing", (s*3.94, 0, z), 0.095, 0.075, METAL_DARK, axis='X', vertices=24)
        cylinder("End lamp lens", (s*3.985, 0, z), 0.060, 0.025, LENS, axis='X', vertices=24)
    # Buffer beams and coupling.
    cube("Red buffer beam", (s*3.94, 0, 1.13), (0.18, 1.30, 0.26), RED, 0.025)
    for y in (-0.49, 0.49):
        cylinder("Buffer shank", (s*4.02, y, 1.20), 0.075, 0.22, FRAME, axis='X', vertices=24)
        cylinder("Buffer head", (s*4.14, y, 1.20), 0.13, 0.075, METAL, axis='X', vertices=32)
        cylinder("Buffer face inset", (s*4.182, y, 1.20), 0.085, 0.02, METAL_DARK, axis='X', vertices=32)
    cube("Centre coupling block", (s*4.08, 0, 0.96), (0.22, 0.20, 0.10), METAL_DARK, 0.018)
    rod("Coupling hook", (s*4.18, 0, 0.95), (s*4.34, 0, 0.91), 0.025, METAL)
    torus("Coupling loop", (s*4.34, 0, 0.88), 0.075, 0.018, METAL, rotation=(0, math.pi/2, 0), major_segments=20, minor_segments=6)

# Cab door outlines, handles and step ladders.
for s in (-1, 1):
    x = s*3.34
    side_panel("Cab door dark outline", x, 1.98, 0.32, 0.86, -0.690, FRAME, 0.022, 0.015)
    side_panel("Cab door blue inset", x, 1.99, 0.27, 0.80, -0.708, BLUE_LIGHT, 0.012, 0.01)
    rod("Cab door handle", (x+s*0.08, -0.735, 1.98), (x+s*0.08, -0.735, 2.12), 0.012, METAL)
    for z in (1.22, 1.38, 1.54):
        rod("Cab access step", (s*3.56, -0.75, z), (s*3.88, -0.75, z), 0.025, METAL_DARK)
    rod("Cab vertical grab rail", (s*3.50, -0.75, 1.44), (s*3.50, -0.75, 2.30), 0.022, METAL)
    rod("Cab second grab rail", (s*2.56, -0.75, 1.68), (s*2.56, -0.75, 2.25), 0.018, METAL)

# -------------------- Bodyside panels, doors and ventilation --------------------
# Panel seams over the hood; slightly raised rims make the body read less like a box.
for y in (-0.657, 0.657):
    for x in (-2.55, -1.78, -0.98, -0.15, 0.70, 1.50, 2.22):
        side_panel("Body panel seam", x, 2.00, 0.018, 1.22, y, BLUE_DARK, 0.012, 0.003)
    # Large access doors, hinge plates and catches.
    for x, w in ((-2.30, 0.62), (-1.28, 0.70), (0.15, 0.70), (1.20, 0.72), (2.12, 0.48)):
        side_panel("Engine access door rim", x, 1.93, w, 0.62, y, BLUE_DARK, 0.018, 0.015)
        side_panel("Engine access door inset", x, 1.93, w-0.055, 0.565, y-0.014 if y < 0 else y+0.014, BLUE, 0.012, 0.01)
        for dx in (-w*0.38, w*0.38):
            for z in (1.70, 2.16):
                cube("Door hinge", (x+dx, y*1.055, z), (0.055, 0.028, 0.10), METAL_DARK, 0.008)
        cube("Door latch", (x+w*0.30, y*1.075, 1.95), (0.045, 0.028, 0.14), METAL, 0.008)
    # Multiple vent groups with deep recesses, frames and individual slats.
    vent_groups = [(-1.92, 0.43, 0.58), (-1.23, 0.43, 0.58),
                   (0.92, 0.45, 0.50), (1.65, 0.45, 0.50), (2.32, 0.27, 0.42)]
    for x, w, h in vent_groups:
        side_panel("Vent outer frame", x, 2.34, w+0.08, h+0.08, y*1.02, METAL_DARK, 0.022, 0.01)
        side_panel("Vent dark recess", x, 2.34, w, h, y*1.045, VENT_DARK, 0.018, 0.006)
        count = 7 if h > 0.45 else 6
        for i in range(count):
            z = 2.34 - h*0.40 + i*(h*0.80/(count-1))
            side_panel("Vent horizontal blade", x, z, w*0.84, 0.027, y*1.075, METAL_DARK, 0.016, 0.008)
        for dx in (-w*0.42, w*0.42):
            side_panel("Vent frame upright", x+dx, 2.34, 0.025, h, y*1.09, METAL, 0.012, 0.004)
    # Small round access covers, rivets and body fasteners.
    for x, z in ((-0.45, 1.77), (0.42, 1.77), (2.48, 1.82)):
        cylinder("Circular service cover", (x, y*1.06, z), 0.12, 0.025, BLUE_DARK, axis='Y', vertices=32)
        cylinder("Service cover centre", (x, y*1.09, z), 0.095, 0.018, BLUE_LIGHT, axis='Y', vertices=32)
        for a in range(8):
            ang = 2*math.pi*a/8
            uv_sphere("Service cover bolt", (x+0.085*math.cos(ang), y*1.12, z+0.085*math.sin(ang)),
                      (0.012, 0.008, 0.012), METAL, 8, 4)
    # Small rivets along lower body edge.
    for x in [i*0.18-2.7 for i in range(31)]:
        uv_sphere("Lower bodyside rivet", (x, y*1.055, 1.40), (0.014, 0.009, 0.014), METAL_DARK, 8, 4)
    # Long handrails on the bodyside.
    rod("Long upper handrail", (-2.65, y*1.08, 2.63), (2.48, y*1.08, 2.63), 0.018, METAL)
    for x in (-2.65, -1.45, -0.25, 0.95, 2.15):
        rod("Handrail stanchion", (x, y*1.08, 2.60), (x, y*1.08, 2.67), 0.018, METAL)

# Lower side sill, stripe and weathering details.
for y in (-0.672, 0.672):
    cube("Lower blue sill trim", (0, y, 1.31), (6.85, 0.035, 0.075), BLUE_DARK, 0.012)
    cube("Fine sill highlight", (0, y*1.03, 1.36), (6.70, 0.018, 0.018), BLUE_LIGHT, 0.004)
    for x in (-2.8, -2.0, -1.2, -0.4, 0.4, 1.2, 2.0, 2.8):
        cube("Underbody access latch", (x, y*1.07, 1.48), (0.11, 0.025, 0.045), METAL_DARK, 0.008)

# -------------------- BR double-arrow style emblem --------------------
# Abstract double-arrow mark built from tapered polygon meshes on both sides.
def flat_polygon(name, verts, y, material):
    mesh = bpy.data.meshes.new(name + " mesh")
    # vertices are x,z pairs; place the flat graphic on a side plane
    mesh.from_pydata([(x, y, z) for x,z in verts], [], [list(range(len(verts)))])
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    # Add tiny thickness so the mark catches light.
    solid = ob.modifiers.new("Raised enamel emblem", 'SOLIDIFY')
    solid.thickness = 0.018
    return ob

for y in (-0.705, 0.705):
    # two opposed chevrons separated by a narrow central gap
    flat_polygon("BR double arrow upper", [(-0.42,2.22),(0.08,2.22),(0.34,2.34),(0.34,2.27),(0.10,2.15),(-0.42,2.15)], y, WHITE)
    flat_polygon("BR double arrow lower", [(-0.42,2.05),(0.10,2.05),(0.34,1.93),(0.34,1.86),(0.08,1.98),(-0.42,1.98)], y, WHITE)

# Small raised identification plates (no generated text so the model remains robust).
for y in (-0.70, 0.70):
    cube("Locomotive number plate", (-2.72, y, 1.72), (0.42, 0.035, 0.16), METAL_DARK, 0.012)
    cube("Plate inset", (-2.72, y*1.055, 1.72), (0.36, 0.018, 0.105), BLUE_DARK, 0.006)
    for x in (-2.86, -2.58):
        uv_sphere("Number plate screw", (x, y*1.075, 1.72), (0.012, 0.008, 0.012), METAL, 8, 4)

# -------------------- Detailed bogies and wheelsets --------------------
# Six wheelsets; each wheel has a tyre, web, hub, rim and eight spokes.
wheel_xs = (-2.68, -1.88, -1.08, 1.08, 1.88, 2.68)
wheel_z = 0.72
wheel_r = 0.385
for x in wheel_xs:
    cylinder("Through axle", (x, 0, wheel_z), 0.075, 1.40, METAL_DARK, axis='Y', vertices=20, bevel=0.01)
    for side in (-1, 1):
        y = side*0.69
        # Tyre and inset wheel disc
        cylinder("Wheel tyre", (x, y, wheel_z), wheel_r, 0.16, RUBBER, axis='Y', vertices=48, bevel=0.018)
        cylinder("Wheel web", (x, y+side*0.085, wheel_z), wheel_r*0.82, 0.035, WHEEL, axis='Y', vertices=48, bevel=0.008)
        torus("Outer wheel rim", (x, y+side*0.108, wheel_z), wheel_r*0.84, 0.025, METAL_DARK,
              rotation=(math.pi/2,0,0), major_segments=48, minor_segments=8)
        cylinder("Wheel hub base", (x, y+side*0.115, wheel_z), 0.145, 0.065, METAL_DARK, axis='Y', vertices=32, bevel=0.012)
        cylinder("Wheel hub cap", (x, y+side*0.155, wheel_z), 0.085, 0.04, METAL, axis='Y', vertices=32, bevel=0.008)
        cylinder("Grease cap", (x, y+side*0.18, wheel_z), 0.043, 0.025, METAL_DARK, axis='Y', vertices=24, bevel=0.005)
        # Eight spokes per wheel face, oriented in the wheel plane.
        for n in range(8):
            a = (2*math.pi*n/8) + math.pi/8
            p1 = (x+0.115*math.cos(a), y+side*0.112, wheel_z+0.115*math.sin(a))
            p2 = (x+0.285*math.cos(a), y+side*0.112, wheel_z+0.285*math.sin(a))
            rod("Wheel spoke", p1, p2, 0.018, METAL_DARK, vertices=8)
    # Axlebox details at both sides
    for side in (-1, 1):
        y = side*0.78
        cube("Axlebox", (x, y, 0.72), (0.27, 0.12, 0.28), FRAME, 0.025)
        cube("Axlebox face", (x, y+side*0.07, 0.72), (0.17, 0.025, 0.16), METAL_DARK, 0.018)
        cylinder("Axlebox bolt", (x, y+side*0.09, 0.72), 0.035, 0.025, METAL, axis='Y', vertices=16)

# Two bogie frames with raised side plates, springs, dampers and brake gear.
for centre in (-1.88, 1.88):
    for side in (-1, 1):
        y = side*0.77
        cube("Bogie main side beam", (centre, y, 0.93), (2.42, 0.16, 0.22), FRAME, 0.035)
        cube("Bogie beam highlight", (centre, y+side*0.085, 0.96), (2.20, 0.025, 0.045), FRAME_EDGE, 0.008)
        # spring groups above each axle
        for dx in (-0.80, 0, 0.80):
            x = centre+dx
            cube("Suspension spring top", (x, y+side*0.10, 1.08), (0.30, 0.08, 0.055), METAL_DARK, 0.01)
            for j in range(4):
                cube("Leaf spring layer", (x, y+side*0.11, 1.045-j*0.028), (0.28-j*0.025, 0.07, 0.018), METAL_DARK, 0.005)
            rod("Brake linkage", (x-0.12, y+side*0.12, 0.84), (x+0.12, y+side*0.12, 0.84), 0.018, METAL)
        # brake cylinders and cross members
        for dx in (-0.58, 0.58):
            cylinder("Brake cylinder", (centre+dx, y, 1.10), 0.075, 0.20, METAL_DARK, axis='Y', vertices=20)
    cube("Bogie cross member", (centre, 0, 0.91), (0.18, 1.45, 0.20), FRAME, 0.025)

# Underframe equipment: tanks, boxes, pipes and exhaust.
cube("Fuel tank", (-0.25, 0, 0.88), (1.30, 0.86, 0.35), METAL_DARK, 0.05)
for x in (-0.75, -0.25, 0.25):
    cube("Fuel tank reinforcement rib", (x, -0.45, 0.88), (0.035, 0.025, 0.29), METAL, 0.006)
for x, dims in ((0.75,(0.62,0.78,0.34)), (1.52,(0.48,0.80,0.30)), (-1.15,(0.48,0.75,0.30))):
    cube("Underframe equipment cabinet", (x, 0, 0.98), dims, FRAME, 0.035)
    for side in (-1,1):
        cube("Equipment cabinet door", (x, side*0.41, 0.99), (dims[0]*0.68, 0.025, dims[2]*0.66), METAL_DARK, 0.012)
cylinder("Air reservoir tank", (-1.45, 0, 0.68), 0.14, 0.94, METAL_DARK, axis='Y', vertices=32)
for x in (-1.75, -1.40, -1.05):
    rod("Brake pipe", (x, -0.55, 0.61), (x+0.18, -0.55, 0.52), 0.022, METAL_DARK)
rod("Long underframe pipe", (-2.45,-0.58,0.60), (2.35,-0.58,0.60), 0.022, METAL_DARK)

# -------------------- Ground reference --------------------
# A hidden viewport wire reference plane is not included in final render.
cube("Track reference - hide in render", (0, 0, 0.20), (8.9, 1.55, 0.08), FRAME, 0.01)
bpy.context.object.hide_render = True
bpy.context.object.display_type = 'WIRE'

# -------------------- Camera and lighting --------------------
bpy.ops.object.camera_add(location=(0, -17.5, 3.0))
camera = bpy.context.object
camera.name = "Side profile preview camera"
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 9.5
camera.rotation_euler = (math.radians(90), 0, 0)
bpy.context.scene.camera = camera

bpy.ops.object.light_add(type='AREA', location=(-2.5, -7.0, 7.5))
key = bpy.context.object
key.name = "Large softbox"
key.data.energy = 1800
key.data.shape = 'DISK'
key.data.size = 8
key.rotation_euler = (Vector((0, 0, 1.65)) - key.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.light_add(type='AREA', location=(4.0, 3.5, 5.5))
fill = bpy.context.object
fill.name = "Fill light"
fill.data.energy = 1100
fill.data.size = 6
fill.rotation_euler = (Vector((0, 0, 1.5)) - fill.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.object.light_add(type='AREA', location=(-4.0, 1.5, 3.5))
rim = bpy.context.object
rim.name = "Rear rim light"
rim.data.energy = 700
rim.data.size = 5
rim.rotation_euler = (Vector((0, 0, 1.7)) - rim.location).to_track_quat('-Z', 'Y').to_euler()

# -------------------- Render settings and save --------------------
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.render.resolution_x = 1600
scene.render.resolution_y = 520
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.filepath = r"E:\TrainTracks\TrainAssets\loco-034_blender\loco-034_blender_preview.png"
scene.view_settings.view_transform = 'AgX'
scene.world.color = (0.025, 0.025, 0.025)

# Select the locomotive parts, leave camera and lights unselected.
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.context.scene.objects:
    if ob.type == 'MESH' and not ob.name.startswith("Track reference"):
        ob.select_set(True)
# Keep all components separate and editable in this detailed version.
bpy.context.view_layer.objects.active = bpy.context.selected_objects[0] if bpy.context.selected_objects else None

# Save using the same destination as requested.
blend_path = r"E:\TrainTracks\TrainAssets\loco-034_blender\loco-034_blender.blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

print("=" * 60)
print("HIGH-DETAIL LOCOMOTIVE SCENE CREATED")
print(f"Blender project: {blend_path}")
print(f"Render output: {scene.render.filepath}")
print(f"Scene object count: {len(scene.objects)}")
print("Press F12 to render the transparent side-profile preview.")
print("=" * 60)
