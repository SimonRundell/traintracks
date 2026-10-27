# High-detail British diesel locomotive — procedural Blender generator
# Blender 5.x compatible. Run from Blender > Scripting workspace > Alt+P.
# Stylised game asset based on the supplied blue diesel / yellow cab reference.
# Axes: X length, Y width, Z height. Detailed side is -Y.
#
# Outputs:
# E:\TrainTracks\TrainAssets\locos\loco-016_blender\loco-016_blender.blend
# E:\TrainTracks\TrainAssets\locos\loco-016_blender\loco-016_blender_preview.png

import bpy, math
from mathutils import Vector

# Reset scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Materials
def material(name, color, metallic=0.0, roughness=0.4):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return m

BLUE = material("Deep British diesel blue", (0.018, 0.105, 0.17), .48, .34)
BLUE2 = material("Blue body panel", (0.03, .15, .22), .42, .35)
BLUED = material("Blue shadow trim", (.008, .04, .06), .5, .42)
YELLOW = material("Warning yellow", (1, .48, .012), .18, .34)
YELLOW2 = material("Yellow highlights", (1, .65, .04), .15, .31)
GLASS = material("Dark cab glass", (.008, .02, .026), .3, .2)
GLASSHI = material("Glass reflections", (.13, .24, .27), .4, .2)
BLACK = material("Underframe black", (.016, .019, .02), .45, .4)
BLACKHI = material("Raised black steel", (.09, .11, .11), .65, .3)
STEEL = material("Machined steel", (.29, .31, .30), .78, .27)
RUBBER = material("Wheel tyres", (.022, .024, .024), .2, .43)
WHEEL = material("Wheel centres", (.12, .14, .14), .7, .3)
WHITE = material("Emblem white", (.94, .95, .92), .08, .3)
RED = material("Red marker lamps", (.62, .012, .006), .12, .24)
LAMP = material("Warm headlamp lenses", (1, .68, .18), .08, .23)

def assign(o, m):
    o.data.materials.append(m)
    return o

def bevel(o, width=.01, segments=2):
    if width:
        b = o.modifiers.new("Manufactured edge bevel", 'BEVEL')
        b.width, b.segments = width, segments
        o.modifiers.new("Weighted normals", 'WEIGHTED_NORMAL')
    return o

def cube(name, loc, dims, mat, edge=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(o, mat)
    if edge: bevel(o, edge, 3 if edge > .025 else 2)
    return o

def cylinder(name, loc, radius, depth, mat, axis='Y', vertices=32, edge=0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    if axis == 'X': o.rotation_euler[1] = math.radians(90)
    elif axis == 'Y': o.rotation_euler[0] = math.radians(90)
    assign(o, mat)
    if edge: bevel(o, edge, 2)
    return o

def rod(name, a, b, radius, mat, vertices=10):
    a, b = Vector(a), Vector(b)
    d = b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=d.length, location=(a+b)/2)
    o = bpy.context.object
    o.name = name
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    assign(o, mat)
    return o

def torus(name, loc, major, minor, mat, rotation=(math.pi/2,0,0), major_segments=32, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_segments,
                                    minor_segments=minor_segments, location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    assign(o, mat)
    return o

def side_cube(name, x, z, width, height, y, depth=.025, mat=BLUE2, edge=.004):
    return cube(name, (x,y,z), (width,depth,height), mat, edge)

def side_poly(name, points, y, mat, thickness=.012):
    mesh = bpy.data.meshes.new(name+" mesh")
    mesh.from_pydata([(x,y,z) for x,z in points], [], [list(range(len(points)))])
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(o)
    sol = o.modifiers.new("Raised emblem thickness", 'SOLIDIFY')
    sol.thickness = thickness
    bevel(o, .002, 1)
    return o

# Main body: long, rounded-edged diesel engine compartment.
cube("Main blue engine casing", (0,0,2.38), (8.35,2.48,1.90), BLUE, .12)
cube("Roof shoulder", (0,0,3.35), (8.20,2.34,.28), BLUED, .11)
cube("Roof crown", (0,0,3.49), (7.92,2.15,.13), BLUE, .055)

# Sloped yellow cab-end bodies at both ends, extruded across locomotive width.
for s in (-1,1):
    x = s*3.82
    verts = [
        (x-s*.62,-1.19,1.48),(x+s*.42,-1.19,1.48),(x+s*.64,-1.19,2.12),
        (x+s*.30,-1.19,3.26),(x-s*.54,-1.19,3.29),
        (x-s*.62,1.19,1.48),(x+s*.42,1.19,1.48),(x+s*.64,1.19,2.12),
        (x+s*.30,1.19,3.26),(x-s*.54,1.19,3.29)]
    faces=[(0,1,2,3,4),(5,9,8,7,6),(0,5,6,1),(1,6,7,2),(2,7,8,3),(3,8,9,4),(4,9,5,0)]
    me=bpy.data.meshes.new("Sloped yellow cab mesh")
    me.from_pydata(verts,[],faces); me.materials.append(YELLOW)
    ob=bpy.data.objects.new("Yellow sloped cab end",me); bpy.context.collection.objects.link(ob)
    bevel(ob,.055,3)

# Side body panels, access doors, hinges, vent grilles and BR-style double arrow.
for side in (-1,1):
    y=side*1.255
    side_cube("Side belt rail",0,1.50,7.7,.16,y-side*.035,.035,BLUED,.012)
    panel_xs=(-3.15,-2.40,-1.55,-.62,.32,1.25,2.15,3.0)
    for i,x in enumerate(panel_xs):
        w=.68 if i not in (0,7) else .48
        side_cube("Engine access door",x,2.40,w,1.27,y-side*.035,.026,BLUE2 if i%3==1 else BLUE,.012)
        for dx in (-w/2+.04,w/2-.04):
            side_cube("Door seam",x+dx,2.40,.016,1.16,y-side*.060,.012,BLUED,.002)
        for z in (1.86,2.95):
            side_cube("Door hinge",x-w/2+.10,z,.075,.032,y-side*.068,.018,STEEL,.003)
        side_cube("Door handle",x+w/2-.10,2.42,.03,.09,y-side*.075,.016,STEEL,.003)
    for cx,w in ((-2.55,.78),(-.80,.90),(1.05,.88),(2.63,.78)):
        side_cube("Vent recess",cx,2.86,w,.40,y-side*.075,.025,BLUED,.006)
        for j in range(5):
            side_cube("Vent horizontal louvre",cx,2.71+j*.075,w-.07,.025,y-side*.10,.02,BLACKHI,.003)
        for dx in (-w/2,w/2):
            side_cube("Vent upright",cx+dx,2.86,.03,.42,y-side*.11,.02,BLUE2,.003)
    for x in (-2.9,-1.75,-.45,.8,2.0,3.05):
        side_cube("Lower equipment hatch",x,1.72,.52,.28,y-side*.06,.024,BLUED,.006)
        for dx in (-.18,.18):
            cylinder("Hatch fastener",(x+dx,y-side*.085,1.72),.016,.018,STEEL,'Y',12,.002)

    # Geometric British Rail double-arrow, close to the emblem visible in reference.
    ly=y-side*.13; lx=-.10; lz=2.38
    side_cube("BR emblem upper bar",lx,lz+.085,.42,.032,ly,.018,WHITE,.002)
    side_poly("BR emblem upper arrow",[(lx-.21,lz+.085),(lx-.09,lz+.16),(lx-.02,lz+.16),
             (lx-.11,lz+.085),(lx-.02,lz+.01),(lx-.09,lz+.01)],ly-side*.012,WHITE,.012)
    side_cube("BR emblem lower bar",lx,lz-.085,.42,.032,ly,.018,WHITE,.002)
    side_poly("BR emblem lower arrow",[(lx+.21,lz-.085),(lx+.09,lz-.16),(lx+.02,lz-.16),
             (lx+.11,lz-.085),(lx+.02,lz+.01),(lx+.09,lz+.01)],ly-side*.012,WHITE,.012)

# Cab windscreen panels and front-facing yellow faces, lamps, wipers and handrails.
for s in (-1,1):
    fx=s*4.37
    for yy in (-.73,0,.73):
        cube("Cab windscreen",(fx,yy,2.83),(.035,.49,.45),GLASS,.025)
        cube("Windscreen reflection",(fx+s*.022,yy-.06,2.88),(.012,.09,.27),GLASSHI,.008)
        rod("Windscreen wiper",(fx+s*.035,yy-.17,2.66),(fx+s*.035,yy+.12,2.70),.009,BLACKHI,8)
    cube("Yellow lower nose face",(fx+s*.015,0,2.10),(.055,1.72,.78),YELLOW,.02)
    for yy in (-.72,.72):
        cylinder("Headlamp bezel",(fx+s*.06,yy,2.18),.095,.06,STEEL,'X',32,.006)
        cylinder("Headlamp lens",(fx+s*.095,yy,2.18),.064,.025,LAMP,'X',32,.004)
        cylinder("Red marker light",(fx+s*.07,yy,1.90),.040,.03,RED,'X',24,.003)
    # Side cab windows near each end.
    side_y=s*1.285
    for xx in (s*3.48,s*3.78):
        side_cube("Cab side window",xx,2.87,.22,.40,side_y,.035,GLASS,.018)
        side_cube("Cab window glint",xx-.035,2.91,.045,.24,side_y-s*.025,.012,GLASSHI,.006)
    # Grab rails on yellow nose.
    for yy in (-.94,.94):
        rod("Cab nose grab rail",(s*4.05,yy,1.78),(s*4.15,yy,2.48),.018,STEEL,10)

# Roof grilles, longitudinal seams, fan covers and exhaust.
cube("Roof central service panel",(0,0,3.56),(6.72,1.78,.10),BLUE2,.035)
for x in (-3.15,-2.25,-1.35,-.45,.45,1.35,2.25,3.15):
    cube("Roof seam",(x,0,3.62),(.022,1.75,.022),STEEL,.004)
for x,w in ((-2.7,.64),(-1.55,.70,-0.0),(-.25,.70),(1.1,.72),(2.48,.64)):
    # Handle tuple form uniformly: first two values are x and width.
    pass
for x,w in ((-2.7,.64),(-1.55,.70),(-.25,.70),(1.1,.72),(2.48,.64)):
    cube("Roof grille inset",(x,-.15,3.63),(w,.56,.024),BLUED,.006)
    for i in range(9):
        xx=x-w/2+.045+i*(w-.09)/8
        cube("Roof grille slat",(xx,-.15,3.655),(.02,.49,.022),STEEL,.0025)
for x,r in ((-2.1,.18),(.30,.22),(2.35,.17)):
    cylinder("Roof fan base",(x,.36,3.64),r*1.25,.055,BLUED,'Z',40,.006)
    cylinder("Roof fan cover",(x,.36,3.70),r,.07,STEEL,'Z',40,.006)
    for n in range(8):
        a=2*math.pi*n/8
        rod("Fan grille spoke",(x+r*.15*math.cos(a),.36+r*.15*math.sin(a),3.74),
            (x+r*.82*math.cos(a),.36+r*.82*math.sin(a),3.74),.008,BLACKHI,8)
cylinder("Exhaust base",(-.95,.38,3.64),.14,.07,BLUED,'Z',32,.006)
cylinder("Exhaust stack",(-.95,.38,3.75),.08,.18,BLACKHI,'Z',32,.006)

# Chassis, equipment boxes and solebars.
cube("Main underframe chassis",(0,0,1.12),(8.30,2.42,.28),BLACK,.035)
for side in (-1,1):
    y=side*1.20
    cube("Long underframe beam",(0,y,1.16),(8.05,.14,.25),BLACKHI,.025)
    cube("Underframe lower lip",(0,y+side*.08,1.04),(7.85,.035,.035),STEEL,.005)
    for x in (-3.35,-2.6,-1.85,-1.1,-.35,.4,1.15,1.9,2.65,3.4):
        cube("Underframe equipment box",(x,y,.92),(.42,.20,.24),BLACK,.016)
        cube("Equipment box lid",(x,y+side*.11,.93),(.32,.025,.14),BLACKHI,.006)

# Six axles / twelve wheels in two three-axle bogies.
wheel_xs=(-3.15,-2.55,-1.95,1.95,2.55,3.15)
wheel_z=.57; wheel_r=.34
for x in wheel_xs:
    cylinder("Wheel axle",(x,0,wheel_z),.06,2.48,STEEL,'Y',20)
    for side in (-1,1):
        y=side*1.23
        cylinder("Wheel tyre",(x,y,wheel_z),wheel_r,.16,RUBBER,'Y',48,.012)
        cylinder("Wheel disc",(x,y+side*.09,wheel_z),wheel_r*.78,.04,WHEEL,'Y',48,.005)
        torus("Wheel rim",(x,y+side*.115,wheel_z),wheel_r*.78,.018,STEEL,(math.pi/2,0,0),36,8)
        cylinder("Wheel hub",(x,y+side*.14,wheel_z),.09,.05,BLACKHI,'Y',28,.005)
        cylinder("Wheel hub cap",(x,y+side*.175,wheel_z),.045,.025,STEEL,'Y',24,.003)
        for n in range(10):
            a=2*math.pi*n/10
            rod("Wheel spoke",(x+.08*math.cos(a),y+side*.12,wheel_z+.08*math.sin(a)),
                (x+.26*math.cos(a),y+side*.12,wheel_z+.26*math.sin(a)),.012,STEEL,8)
        cube("Axlebox casing",(x,side*1.31,.61),(.22,.15,.22),BLACK,.016)
        cylinder("Axlebox circular cover",(x,side*1.40,.61),.075,.035,BLACKHI,'Y',24,.003)

for centre in (-2.55,2.55):
    for side in (-1,1):
        y=side*1.34
        cube("Bogie main sideframe",(centre,y,.75),(1.55,.16,.18),BLACK,.022)
        cube("Bogie raised edge",(centre,y+side*.09,.80),(1.34,.025,.025),STEEL,.004)
        for dx in (-.52,-.26,0,.26,.52):
            x=centre+dx
            cube("Suspension spring seat",(x,y+side*.09,.91),(.18,.07,.04),BLACKHI,.004)
            for j in range(4):
                cube("Suspension leaf spring",(x,y+side*.10,.885-j*.023),(.16-j*.018,.05,.012),STEEL,.002)
        for dx in (-.60,.60):
            rod("Brake linkage",(centre+dx,y+side*.12,.59),(centre+dx*.70,y+side*.12,.56),.014,STEEL,8)

# Buffers, couplers, end plates.
for s in (-1,1):
    cube("End buffer beam",(s*4.20,0,1.05),(.16,2.25,.22),BLACK,.022)
    for y in (-.85,.85):
        cylinder("Buffer shank",(s*4.27,y,1.12),.065,.20,BLACK,'X',24,.005)
        cylinder("Buffer head",(s*4.39,y,1.12),.115,.07,STEEL,'X',32,.007)
    cube("Coupling block",(s*4.31,0,.82),(.20,.28,.13),BLACKHI,.012)
    rod("Coupling shank",(s*4.39,0,.82),(s*4.57,0,.80),.025,STEEL,10)
    torus("Coupling loop",(s*4.57,0,.78),.075,.016,STEEL,(0,math.pi/2,0),20,6)

# Camera / lights / transparent output.
bpy.ops.object.camera_add(location=(0,-21,2.10))
camera=bpy.context.object
camera.name="Loco 016 orthographic side camera"
camera.data.type='ORTHO'
camera.data.ortho_scale=9.85
camera.rotation_euler=(math.radians(90),0,0)
bpy.context.scene.camera=camera

bpy.ops.object.light_add(type='AREA',location=(-3.5,-7.5,8))
key=bpy.context.object; key.name="Large softbox key"
key.data.energy=2200; key.data.shape='DISK'; key.data.size=8
key.rotation_euler=(Vector((0,0,2))-key.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='AREA',location=(4,2.5,6))
fill=bpy.context.object; fill.name="Soft fill"
fill.data.energy=1200; fill.data.size=7
fill.rotation_euler=(Vector((0,0,2))-fill.location).to_track_quat('-Z','Y').to_euler()

scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=64
scene.render.resolution_x=1800
scene.render.resolution_y=620
scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA'
scene.render.image_settings.color_depth='8'
scene.render.filepath=r"E:\TrainTracks\TrainAssets\locos\loco-016_blender\loco-016_blender_preview.png"
scene.view_settings.view_transform='AgX'
scene.world.color=(.025,.025,.025)

blend_path=r"E:\TrainTracks\TrainAssets\locos\loco-016_blender\loco-016_blender.blend"
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
print("="*60)
print("HIGH-DETAIL DIESEL LOCOMOTIVE CREATED")
print("Blender project:",blend_path)
print("Transparent preview:",scene.render.filepath)
print("Scene objects:",len(scene.objects))
print("Press F12 to render the transparent side-profile preview.")
print("="*60)
