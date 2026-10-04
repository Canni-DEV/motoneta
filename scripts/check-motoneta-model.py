"""Inspect the editable scooter source with Blender; runtime pose checks live in Vitest."""
import bpy
import bmesh
import json
import sys
from pathlib import Path
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[1]
vehicle = 'tanque' if '--vehicle=tanque' in sys.argv else 'motoneta'
directory = root / 'assets' / vehicle
rig = json.loads((root / 'src' / f'{vehicle}-rig.json').read_text())
arm = bpy.data.objects['RiderRig']
assert set(rig) == {bone.name for bone in arm.data.bones}
report = {'rigBones': len(rig), 'rigMatchesDefinition': True, 'surfaces': {}, 'slotMeshes': 0, 'weightedVertices': 0}

def game(point): return [point.x, point.z, -point.y]

for name, definition in rig.items():
    bone = arm.data.bones[name]
    assert (bone.parent.name if bone.parent else None) == definition['parent']
    for point, expected in ((game(bone.head_local), definition['head']), (game(bone.tail_local), definition['tail'])):
        assert max(abs(a-b) for a,b in zip(point,expected)) < .000001, (name,point,expected)
    assert list(bone['restHead']) == definition['head']
    assert list(bone['restTail']) == definition['tail']

for obj in bpy.data.objects:
    if obj.type != 'MESH' or not obj.name.startswith('Slot_'): continue
    report['slotMeshes'] += 1
    assert len(obj.data.materials) == 1, obj.name
    assert obj.data.color_attributes.get('Palette'), obj.name
    if any(mod.type == 'ARMATURE' for mod in obj.modifiers):
        for vertex in obj.data.vertices:
            assert abs(sum(group.weight for group in vertex.groups)-1) < .00001, (obj.name,vertex.index)
            report['weightedVertices'] += 1
    if not obj.name.startswith(('Slot_torso_', 'Slot_pants_', 'Slot_helmet_')): continue
    mesh = bmesh.new(); mesh.from_mesh(obj.data)
    unseen = set(mesh.verts); components = 0
    while unseen:
        pending = [unseen.pop()]; components += 1
        while pending:
            vertex = pending.pop()
            adjacent = {edge.other_vert(vertex) for edge in vertex.link_edges} & unseen
            unseen.difference_update(adjacent); pending.extend(adjacent)
    nonmanifold = sum(not edge.is_manifold for edge in mesh.edges)
    assert components == 1 and nonmanifold == 0, (obj.name,components,nonmanifold)
    mesh.free()
    obj.data.calc_loop_triangles()
    faces = [tuple(triangle.vertices) for triangle in obj.data.loop_triangles]
    tree = BVHTree.FromPolygons([vertex.co for vertex in obj.data.vertices],faces,all_triangles=True)
    crossings = [(a,b) for a,b in tree.overlap(tree) if a < b and not set(faces[a]) & set(faces[b])]
    assert not crossings, (obj.name,crossings[:5])
    report['surfaces'][obj.name] = {'components': components, 'nonManifoldEdges': nonmanifold, 'selfIntersections': 0}

manifest = json.loads((directory / 'manifest.json').read_text())
report['trianglesSelectedMax'] = {quality: data['trianglesSelectedMax'] for quality,data in manifest['assets'].items()}
assert report['trianglesSelectedMax']['low'] <= 8000
assert report['trianglesSelectedMax']['high'] <= (24000 if vehicle == 'tanque' else 30000)
if vehicle == 'tanque':
    bike = [obj for obj in bpy.data.objects if obj.name.startswith('Slot_') and obj.name.split('_')[1] in manifest['slots'][:6]]
    assert all('_core' in obj.name for obj in bike)
    report['fixedBikeMeshes'] = len(bike)
(directory / 'model-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(f'{vehicle.upper()}_SOURCE_VALIDATION',json.dumps(report))
