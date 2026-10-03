"""Check actual runtime-skinned review meshes with Blender's triangle BVH.

blender --background --python-exit-code 1 --python scripts/check-rider-clearance.py
Export poses first with review-model-quality.mjs ergonomia --neutral --poses-json.
"""
import json
import gzip
import sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = Path(__file__).resolve().parents[1]
stage = next((argument.split('=',1)[1] for argument in sys.argv if argument.startswith('--stage=')), 'ergonomia')
directory = root / 'assets/motocross/review' / stage
samples = json.loads(gzip.decompress((directory / 'posed-geometry.json.gz').read_bytes()))
report = []
def contained(tree, point):
    # Odd/even ray crossings work for the concave saddle, unlike a nearest-normal sign alone.
    direction = Vector((1, .237, .173)).normalized()
    origin = point.copy()
    hits = 0
    for _ in range(64):
        location, normal, index, distance = tree.ray_cast(origin, direction)
        if location is None: return hits % 2 == 1
        hits += 1
        origin = location + direction * .000001
    raise AssertionError('Containment ray did not leave mesh')

for sample in samples:
    meshes = {}
    for mesh in sample['meshes']:
        vertices = [Vector(point) for point in mesh['vertices']]
        indices = mesh['indices']
        faces = [tuple(indices[i:i+3]) for i in range(0, len(indices), 3)]
        meshes[mesh['name']] = (BVHTree.FromPolygons(vertices, faces, all_triangles=True), vertices, faces, mesh['supportVertices'])
    pairs = []
    self_intersections = []
    for name, (tree, vertices, faces, support) in meshes.items():
        if not name.startswith('Slot_pants_'): continue
        # glTF duplicates vertices at paint/normal boundaries. Compare welded
        # positions so adjacent triangles are not mistaken for cloth crossings.
        keys = [tuple(round(value, 5) for value in point) for point in vertices]
        face_points = [set(keys[index] for index in face) for face in faces]
        crossings = [(a,b) for a,b in tree.overlap(tree) if a<b and not face_points[a]&face_points[b]]
        self_intersections.append({'mesh':name, 'crossings':len(crossings)})
    for rider in ('pants', 'torso', 'boots'):
        for bike in ('seat', 'fairing'):
            for rider_name, first in meshes.items():
                if not rider_name.startswith(f'Slot_{rider}_'): continue
                for bike_name, second in meshes.items():
                    if not bike_name.startswith(f'Slot_{bike}_'): continue
                    overlaps = first[0].overlap(second[0])
                    nearest = [(point, second[0].find_nearest(point)) for point in first[1]]
                    inside = [(list(point), hit[3]) for point,hit in nearest
                        if hit[0] is not None and (point-hit[0]).dot(hit[1]) < -1e-5 and contained(second[0], point)]
                    pair = {'rider': rider_name, 'bike': bike_name, 'crossings': len(overlaps), 'containedVertices': len(inside)}
                    if rider=='pants' and bike=='seat' and sample['pose'] in ('ground','steering','wheelie','landing'):
                        assert first[3], 'Missing anatomical support samples'
                        pair['supportGap'] = min(second[0].find_nearest(Vector(point))[3] for point in first[3])
                    if overlaps or inside:
                        pair['insideVertices'] = sorted(inside, key=lambda item: -item[1])[:8]
                        pair['locations'] = [list(sum((first[1][i] for i in first[2][a]), Vector())/3) for a,b in overlaps[:8]]
                    pairs.append(pair)
    report.append({key:sample[key] for key in ('quality','variant','pose')} | {'pairs': pairs, 'selfIntersections':self_intersections})
(directory/'clearance.json').write_text(json.dumps(report, indent=2)+'\n')
failures = [(row['quality'], row['pose'], pair['rider'], pair['bike'], pair['crossings'])
    for row in report for pair in row['pairs'] if pair['crossings'] or pair['containedVertices'] or pair.get('supportGap',0)>.014]
failures += [(row['quality'], row['pose'], part['mesh'], 'self', part['crossings'])
    for row in report for part in row['selfIntersections'] if part['crossings']]
print('RIDER_BIKE_CLEARANCE', {'samples':len(report), 'pairs':sum(len(row['pairs']) for row in report), 'failures':failures})
assert not failures, 'Posed rider intersects the motorcycle; see clearance.json'
