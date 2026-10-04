"""Build the approved loop and its shared runtime geometry in MotoNeta world units.

blender --background --factory-startup --python-exit-code 1 --python scripts/build-loop-prototype.py
The manifest is used by rendering, physics and map validation.
"""
import json
import math
import re
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'track-pieces' / 'loop-prototype'
SOURCE.mkdir(parents=True, exist_ok=True)
world = (ROOT / 'src' / 'world-space.ts').read_text(encoding='utf-8')
WIDTH = float(re.search(r'LANE_WIDTH\s*=\s*([\d.]+)', world)[1])
SCALE = float(re.search(r'WORLD_SCALE\s*=\s*([\d.]+)', world)[1])
RADIUS = 3.0
EXIT_HEIGHT = 2.5
THICKNESS = 0.085
ENTRY_Z = 1.5 * WIDTH
EXIT_Z = -WIDTH  # Center between lanes 1 and 2.


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * t * (t * (6 * t - 15) + 10)


def loop_point(theta):
    # Raise the circular part during the initial ascent, while still in lane 4.
    # The final descending quarter then ends horizontally at the raised exit.
    lift = EXIT_HEIGHT * smooth(theta / (math.pi / 2))
    sideways = smooth((theta - math.pi / 2) / (1.25 * math.pi))
    return Vector((RADIUS * math.sin(theta),
                   RADIUS * (1 - math.cos(theta)) + lift + 0.012,
                   ENTRY_Z + (EXIT_Z - ENTRY_Z) * sideways))


def loop_width(theta):
    # Widen before steering starts; keep both lanes all the way to takeoff.
    widen = smooth((theta - math.pi / 3) / (math.pi / 3))
    return WIDTH * (1 + widen)


points = [Vector((-3 + 3 * i / 24, 0.012, ENTRY_Z)) for i in range(25)]
points += [loop_point(2 * math.pi * i / 256) for i in range(1, 257)]
points += [Vector((2 * i / 24, EXIT_HEIGHT + 0.012, EXIT_Z)) for i in range(1, 25)]
widths = [WIDTH] * 25
widths += [loop_width(2 * math.pi * i / 256) for i in range(1, 257)]
widths += [2 * WIDTH] * 24
frames = []
for i, point in enumerate(points):
    tangent = (points[min(i + 1, len(points) - 1)] - points[max(0, i - 1)]).normalized()
    lateral = Vector((0, 0, 1))
    lateral = (lateral - tangent * lateral.dot(tangent)).normalized()
    normal = lateral.cross(tangent).normalized()
    frames.append((tangent, lateral, normal))


def blender_point(p):
    # Blender Z-up -> glTF Y-up, matching +X forward and the game's lane Z.
    return (p[0], -p[2], p[1])


def material(name, color, roughness, metallic=0):
    def linear(n):
        n /= 255
        return n / 12.92 if n <= 0.04045 else ((n + 0.055) / 1.055) ** 2.4
    rgb = [linear(int(color[i:i + 2], 16)) for i in (0, 2, 4)]
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*rgb, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return result


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
dirt = material('Loop_Dirt', 'a66437', 0.9)
steel = material('Loop_Steel', '35443d', 0.65, 0.25)
trim = material('Loop_Edge', 'e5c898', 0.85)
paint = material('Loop_Marks', '83a175', 0.9)
root = bpy.data.objects.new('Loop_Prototype', None)
bpy.context.collection.objects.link(root)
root['visual_only'] = False
root['entry_lane'] = 4
root['exit_lanes'] = [1, 2]
root['exit_center_lane'] = 1.5
root['geometry_version'] = 2


def mesh(name, vertices, faces, mat, smooth_faces=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([blender_point(p) for p in vertices], [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    for polygon in data.polygons:
        polygon.use_smooth = smooth_faces
    return obj


surface_vertices = []
shell_vertices = []
for p, (_, lateral, normal), width in zip(points, frames, widths):
    left, right = p - lateral * width / 2, p + lateral * width / 2
    surface_vertices.extend((left, right))
    shell_vertices.extend((left, right, right - normal * THICKNESS, left - normal * THICKNESS))
surface_faces = []
shell_faces = []
for i in range(len(points) - 1):
    a, b = 2 * i, 2 * (i + 1)
    surface_faces.append((a, a + 1, b + 1, b))
    a, b = 4 * i, 4 * (i + 1)
    shell_faces.extend(((a + 3, b + 3, b + 2, a + 2),
                        (a, b, b + 3, a + 3),
                        (a + 1, a + 2, b + 2, b + 1)))
shell_faces.extend(((0, 3, 2, 1),
                    tuple(4 * (len(points) - 1) + j for j in (0, 1, 2, 3))))
surface = mesh('Loop_RidingSurface', surface_vertices, surface_faces, dirt, True)
arc = [0.0]
for i in range(1, len(points)):
    arc.append(arc[-1] + (points[i] - points[i - 1]).length)
uv = surface.data.uv_layers.new(name='RoadUV')
for polygon in surface.data.polygons:
    for loop_index in polygon.loop_indices:
        index = surface.data.loops[loop_index].vertex_index
        uv.data[loop_index].uv = (arc[index // 2], (index % 2) * widths[index // 2])
mesh('Loop_Underside', shell_vertices, shell_faces, steel, True)


for side in (-1, 1):
    vertices, faces = [], []
    for p, (_, lateral, normal), width in zip(points, frames, widths):
        center = p + lateral * side * (width / 2 - 0.045) + normal * 0.003
        vertices.extend((center - lateral * 0.013, center + lateral * 0.013))
    for i in range(len(points) - 1):
        a, b = 2 * i, 2 * (i + 1)
        faces.append((a, a + 1, b + 1, b))
    mesh(f'Loop_Edge_{side}', vertices, faces, trim, True)

for i in (12, 64, 116, 180, 240, 292):
    t, lateral, normal = frames[i]
    p = points[i] + normal * 0.009
    vertices = (p + t * 0.15, p - t * 0.08 + lateral * 0.12,
                p - t * 0.03, p - t * 0.08 - lateral * 0.12)
    mesh(f'Loop_Mark_{i}', vertices, ((0, 2, 1), (0, 3, 2)), paint)


beams = []
def beam(name, a, b, radius=0.045):
    a, b = Vector(a), Vector(b)
    beams.append({'name': name, 'a': list(a), 'b': list(b), 'radius': radius})
    axis = (b - a).normalized()
    reference = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(reference).normalized()
    v = axis.cross(u).normalized()
    vertices = [end + radius * (u * math.cos(i * math.pi / 2) + v * math.sin(i * math.pi / 2))
                for end in (a, b) for i in range(4)]
    faces = [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
    faces += [(3, 2, 1, 0), (4, 5, 6, 7)]
    mesh(name, vertices, faces, steel)


# Two small exterior towers. No support footprint is on any riding lane.
for label, theta, outer_z in [('Front', math.pi * 0.42, 3.2), ('Back', math.pi * 1.5, -3.2)]:
    contact = loop_point(theta)
    tower_top = Vector((contact.x, contact.y - 0.22, outer_z))
    for x_offset in (-0.3, 0.3):
        foot = Vector((contact.x + x_offset, 0, outer_z))
        top = Vector((contact.x + x_offset, tower_top.y, outer_z))
        beam(f'Loop_{label}_Post_{x_offset}', foot, top, 0.065)
        beam(f'Loop_{label}_Cantilever_{x_offset}', top, contact - Vector((0, 0.12, 0)), 0.055)
    beam(f'Loop_{label}_Brace', (contact.x - 0.3, 0, outer_z),
         (contact.x + 0.3, tower_top.y, outer_z), 0.035)


# Verify the geometry itself, rather than relying on perspective to infer lanes.
low_vertices = [p for p in surface_vertices + shell_vertices
                if -2 * WIDTH + 1e-6 < p.z < WIDTH - 1e-6]
clearance = min(p.y for p in low_vertices)
assert clearance > 2.35, f'Roadway intrudes into the ground bypass: {clearance}'
assert abs(points[0].z - ENTRY_Z) < 1e-6
assert abs(points[-1].z - EXIT_Z) < 1e-6
assert frames[0][0].x > 0.999 and frames[-1][0].x > 0.999
assert abs(frames[24 + 128][2].y + 1) < 1e-6, 'Apex must face down'
assert widths[0] == WIDTH and widths[-1] == 2 * WIDTH
assert widths[24 + 128] == 2 * WIDTH
assert all(WIDTH <= w <= 2 * WIDTH for w in widths)

bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'loop-prototype.blend'))
bpy.ops.export_scene.gltf(filepath=str(SOURCE / 'loop-prototype.glb'), export_format='GLB',
                          export_yup=True, export_extras=True, export_animations=False,
                          export_cameras=False, export_lights=False)
for obj in bpy.data.objects:
    if obj.type == 'MESH':
        obj.data.calc_loop_triangles()
triangles = sum(len(obj.data.loop_triangles) for obj in bpy.data.objects if obj.type == 'MESH')
manifest = {
    'visualOnly': False,
    'geometryVersion': 2,
    'worldScale': SCALE,
    'width': WIDTH,
    'maximumWidth': max(widths),
    'thickness': THICKNESS,
    'radius': RADIUS,
    'height': max(p.y for p in surface_vertices + shell_vertices),
    'exitHeight': EXIT_HEIGHT + 0.012,
    'entryLane': 4,
    'exitLanes': [1, 2],
    'exitCenterLane': 1.5,
    'entry': list(points[0]),
    'exit': list(points[-1]),
    'entryTangent': list(frames[0][0]),
    'exitTangent': list(frames[-1][0]),
    'minimumBypassClearance': clearance,
    'triangles': triangles,
    'beams': beams,
    'samples': [{'position': list(p), 'tangent': list(t), 'lateral': list(b), 'normal': list(n), 'width': w}
                for p, (t, b, n), w in zip(points, frames, widths)],
}
(SOURCE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({key: value for key, value in manifest.items() if key != 'samples'}))
