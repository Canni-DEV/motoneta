"""Run with Blender --background assets/motocross/motocross.blend --python this file.

Verify connected authoring surfaces before glTF splits vertices at color/normal boundaries.
"""
import bpy
import bmesh
import json
import sys
from pathlib import Path
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
report={}
def check_intersections(mesh,name):
    mesh.calc_loop_triangles()
    triangles=[tuple(tri.vertices) for tri in mesh.loop_triangles]
    tree=BVHTree.FromPolygons([vert.co for vert in mesh.vertices],triangles,all_triangles=True)
    pairs=[(a,b) for a,b in tree.overlap(tree) if a<b and not set(triangles[a])&set(triangles[b])]
    assert not pairs,(name,'self-intersecting surface',pairs[:10])
    return len(pairs)

for name in [f'Slot_{slot}_{variant}' for variant in ('core','sprint','trail') for slot in ('torso','pants','helmet')]:
    obj=bpy.data.objects[name]
    mesh=bmesh.new();mesh.from_mesh(obj.data)
    unseen=set(mesh.verts);components=[]
    while unseen:
        pending=[unseen.pop()];size=0
        while pending:
            vert=pending.pop();size+=1
            neighbors={edge.other_vert(vert) for edge in vert.link_edges}&unseen
            unseen.difference_update(neighbors);pending.extend(neighbors)
        components.append(size)
    boundary=sum(edge.is_boundary for edge in mesh.edges)
    nonmanifold=sum(not edge.is_manifold for edge in mesh.edges)
    loose=sum(not vert.link_faces for vert in mesh.verts)
    assert len(components)==1,(name,'disconnected surfaces',components)
    assert nonmanifold==0,(name,'non-manifold edges',nonmanifold)
    assert loose==0,(name,'loose vertices',loose)
    report[name]={'components':len(components),'boundaryEdges':boundary,'nonManifoldEdges':nonmanifold,'looseVertices':loose,'vertices':len(mesh.verts),'selfIntersections':check_intersections(obj.data,name)}
    mesh.free()
for obj in bpy.data.objects:
    if obj.type!='MESH' or not obj.name.startswith('Slot_'): continue
    assert len(obj.data.materials)==1,(obj.name,'material count')
    if not any(mod.type=='ARMATURE' for mod in obj.modifiers): continue
    for vert in obj.data.vertices:
        total=sum(group.weight for group in vert.groups)
        assert abs(total-1)<.00001,(obj.name,vert.index,total)
rig={bone.name:{'head':list(bone['restHead']),'tail':list(bone['restTail']),'parent':bone.parent.name if bone.parent else None} for bone in bpy.data.objects['RiderRig'].data.bones}
assert rig==json.loads((root/'src'/'bike-rig.json').read_text()),'Rest skeleton changed'

def game_point(vert): return (vert.co.x,vert.co.z,-vert.co.y)
def plane_signature(obj,center,direction=(0,1,0),radius=1):
    groups={group.index:group.name for group in obj.vertex_groups}
    points={}
    for vert in obj.data.vertices:
        point=game_point(vert);delta=[point[i]-center[i] for i in range(3)]
        if abs(sum(delta[i]*direction[i] for i in range(3)))>.000001 or sum(value*value for value in delta)>radius*radius: continue
        points[tuple(round(value,6) for value in point)]=tuple(sorted((groups[group.group],round(group.weight,6)) for group in vert.groups if group.weight>.000001))
    assert len(points)>=8,(obj.name,'missing interface',center)
    return points

# Inspect actual mesh coordinates and skin weights, rather than trusting design parameters.
interfaces=[('torso','waist',(-.214,.943,0),(0,1,0),1),('torso','neck',(.062,1.331,0),(0,1,0),1),
            ('pants','waist',(-.211,.967,0),(0,1,0),1)]
for side in (-1,1):
    suffix='L' if side==1 else 'R'
    knee=rig['Shin'+suffix]['head'];ankle=rig['Shin'+suffix]['tail']
    direction=tuple(ankle[i]-knee[i] for i in range(3))
    for slot,t in [('boots',.32),('pants',.46)]:
        center=tuple(knee[i]*(1-t)+ankle[i]*t for i in range(3))
        interfaces.append((slot,f'cuff-{side}',center,direction,.08))
    hand=rig['Forearm'+suffix]['tail'];elbow=rig['Forearm'+suffix]['head']
    interfaces.append(('torso',f'wrist-{side}',hand,tuple(hand[i]-elbow[i] for i in range(3)),.05))
    interfaces.append(('gloves',f'wrist-{side}',(hand[0]-.023,hand[1]+.014,hand[2]),(.023,-.01,0),.04))
for y in (1.318,1.357,1.395):
    interfaces.append(('helmet',f'eye-port-{y}',(0,rig['Head']['head'][1]+(y-1.255)*.94,0),(0,1,0),1))
interfaces.append(('visor','peak-root',(rig['Head']['head'][0]+(.045-.1)*.94,0,0),(1,0,0),2))
interface_report={}
for slot,name,center,direction,radius in interfaces:
    signatures=[plane_signature(bpy.data.objects[f'Slot_{slot}_{variant}'],center,direction,radius) for variant in ('core','sprint','trail')]
    assert signatures[0]==signatures[1]==signatures[2],(slot,name,'variant interface changed')
    interface_report[f'{slot}/{name}']={'matchingVariants':3,'vertices':len(signatures[0]),'identicalWeights':True}

# Low is exported separately. Weld glTF's normal/color splits before inspecting its surfaces.
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(root/'public'/'models'/'motocross-low.glb'))
for obj in set(bpy.data.objects)-before:
    if obj.type!='MESH' or obj.get('slot') not in ('torso','pants','helmet'): continue
    mesh=bmesh.new();mesh.from_mesh(obj.data)
    bmesh.ops.remove_doubles(mesh,verts=list(mesh.verts),dist=.000001)
    unseen=set(mesh.verts);count=0
    while unseen:
        pending=[unseen.pop()];count+=1
        while pending:
            vert=pending.pop();neighbors={edge.other_vert(vert) for edge in vert.link_edges}&unseen
            unseen.difference_update(neighbors);pending.extend(neighbors)
    assert count==1 and all(edge.is_manifold for edge in mesh.edges),(obj.name,'Low surface disconnected or open')
    assert all(vert.link_faces for vert in mesh.verts),(obj.name,'Low loose vertex')
    welded=bpy.data.meshes.new('Low topology check');mesh.to_mesh(welded)
    intersections=check_intersections(welded,obj.name)
    report[f'low/{obj["slot"]}/{obj["variant"]}']={'components':count,'boundaryEdges':0,'nonManifoldEdges':0,'looseVertices':0,'vertices':len(mesh.verts),'selfIntersections':intersections}
    bpy.data.meshes.remove(welded)
    mesh.free()
stage=next((argument.split('=',1)[1] for argument in sys.argv if argument.startswith('--stage=')),'ergonomia')
directory=root/'assets'/'motocross'/'review'/stage;directory.mkdir(parents=True,exist_ok=True)
(directory/'topology.json').write_text(json.dumps({'rigMatchesRuntime':True,'normalizedWeights':True,'interfaces':interface_report,'parts':report},indent=2)+'\n')
print(json.dumps(report))
