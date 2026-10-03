"""Reproducible modular motocross asset for Blender 5.2.2 LTS.

blender --background --factory-startup --python scripts/build-motocross.py
Coordinates below use the game convention: +X forward, +Y up, +Z rider left.
The source scene uses Blender Z-up; glTF's Y-up conversion restores game axes.
"""
import bpy
import bmesh
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
VEHICLE = 'motoneta' if '--vehicle=motoneta' in sys.argv else 'motocross'
SOURCE = ROOT / 'assets' / VEHICLE
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)

def v(p): return Vector((p[0], -p[2], p[1]))
def mix(a, b, t): return tuple(a[i] * (1-t) + b[i] * t for i in range(3))
def srgb(c): return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4

MATS = {}
def material(name, color, roughness, metallic=0):
    m = bpy.data.materials.new(name)
    rgb = [srgb(int(color[i:i+2], 16)/255) for i in (0,2,4)]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    MATS[name] = m
    return m

class Builder:
    """One mesh per moving assembly, grouped into material primitives on export."""
    def __init__(self):
        self.verts, self.faces, self.materials, self.weights = [], [], [], []
        self.authored_lod = False

    def add(self, verts, faces, mat, bone=None, weights=None):
        start = len(self.verts)
        self.verts.extend(verts)
        self.faces.extend(tuple(start+i for i in f) for f in faces)
        self.materials.extend([mat]*len(faces))
        self.weights.extend(weights if weights is not None else [{bone: 1} if bone else {} for _ in verts])

    def ellipsoid(self, c, r, mat, bone=None, seg=None, rings=None):
        seg, rings = seg or SEG, rings or RINGS
        vs = []
        for j in range(rings+1):
            lat = math.pi * j/rings
            for i in range(seg):
                a = 2*math.pi*i/seg
                vs.append((c[0]+r[0]*math.sin(lat)*math.cos(a), c[1]+r[1]*math.cos(lat), c[2]+r[2]*math.sin(lat)*math.sin(a)))
        fs = []
        for j in range(rings):
            for i in range(seg): fs.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
        self.add(vs, fs, mat, bone)

    def tube(self, points, radii, mat, bone=None, seg=None, weights=None, oval=1):
        seg = seg or SEG
        vs, ws = [], []
        for j,p in enumerate(points):
            tangent = Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
            tangent.normalize()
            ref = Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
            n = tangent.cross(ref).normalized()
            b = tangent.cross(n).normalized()
            for i in range(seg):
                a = 2*math.pi*i/seg
                vs.append(tuple(Vector(p)+radii[j]*(math.cos(a)*n+math.sin(a)*b*oval)))
                ws.append(weights[j] if weights else ({bone:1} if bone else {}))
        fs = [tuple(reversed(range(seg)))]
        for j in range(len(points)-1):
            for i in range(seg): fs.append((j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i))
        fs.append(tuple((len(points)-1)*seg+i for i in range(seg)))
        self.add(vs,fs,mat,weights=ws)

    def rod(self, a, b, radius, mat, bone=None, seg=None):
        self.tube([a,b],[radius,radius],mat,bone,seg)

    def block(self, c, size, mat, bone=None, angle=0):
        # Chamfered rectangular cross-section, avoiding razor-sharp primitive boxes.
        x,y,z = c; w,h,d = [n/2 for n in size]
        bevel = min(w,h)*.23
        profile=[(-w+bevel,-h),(w-bevel,-h),(w,-h+bevel),(w,h-bevel),(w-bevel,h),(-w+bevel,h),(-w,h-bevel),(-w,-h+bevel)]
        vs=[]
        for side in [-1,1]:
            for a,b in profile:
                vs.append((x+a*math.cos(angle)-b*math.sin(angle),y+a*math.sin(angle)+b*math.cos(angle),z+side*d))
        fs=[tuple(reversed(range(8))),tuple(range(8,16))]
        fs.extend((i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8))
        self.add(vs,fs,mat,bone)

    def panel(self, profile, z0, z1, mat, bone=None):
        n=len(profile)
        vs=[(x,y,z) for z in [z0,z1] for x,y in profile]
        fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        fs.extend((i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n))
        self.add(vs,fs,mat,bone)

    def torus(self, c, radius, tube, mat, bone=None, segments=None, sides=None, depth=1):
        segments, sides = segments or SEG*2, sides or (8 if HIGH else 5)
        vs=[]
        for i in range(segments):
            a=2*math.pi*i/segments
            for j in range(sides):
                b=2*math.pi*j/sides
                vs.append((c[0]+(radius+tube*math.cos(b))*math.cos(a),c[1]+(radius+tube*math.cos(b))*math.sin(a),c[2]+tube*math.sin(b)*depth))
        fs=[]
        for i in range(segments):
            for j in range(sides): fs.append((i*sides+j,((i+1)%segments)*sides+j,((i+1)%segments)*sides+(j+1)%sides,i*sides+(j+1)%sides))
        self.add(vs,fs,mat,bone)

    def face(self, indices, mat):
        self.faces.append(tuple(indices));self.materials.append(mat)

    def ring(self, points, weights):
        indices=list(range(len(self.verts),len(self.verts)+len(points)))
        self.verts.extend(points);self.weights.extend([dict(weights) for _ in points])
        return indices

    def loft(self, points, radii, weights, mat, start=None, seg=None, paint=None, tangents=None):
        """Stitch section rings; an existing start boundary makes branching garments one surface."""
        n=len(start) if start else (seg or (12 if HIGH else 8))
        previous=start;orientation=None;previous_normal=None
        for j,p in enumerate(points):
            tangent=Vector(tangents[j]).normalized() if tangents else (Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])).normalized()
            reference=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
            normal=(previous_normal-tangent*previous_normal.dot(tangent)).normalized() if previous_normal is not None else tangent.cross(reference).normalized()
            binormal=tangent.cross(normal).normalized();previous_normal=normal
            rx,ry=radii[j] if isinstance(radii[j],tuple) else (radii[j],radii[j])
            positions=[tuple(Vector(p)+rx*math.cos(2*math.pi*i/n)*normal+ry*math.sin(2*math.pi*i/n)*binormal) for i in range(n)]
            if orientation is None:
                if previous:
                    # Preserve the boundary winding and choose a cyclic alignment, avoiding twisted sleeves.
                    candidates=[(direction,offset) for direction in (-1,1) for offset in range(n)]
                    orientation=min(candidates,key=lambda key:sum((Vector(self.verts[previous[i]])-Vector(positions[(key[0]*i+key[1])%n])).length_squared for i in range(n)))
                else: orientation=(1,0)
            positions=[positions[(orientation[0]*i+orientation[1])%n] for i in range(n)]
            current=self.ring(positions,weights[j])
            if previous:
                for i in range(n): self.face((previous[i],previous[(i+1)%n],current[(i+1)%n],current[i]),paint(j,i,p) if paint else mat)
            else: self.face(reversed(current),mat)
            previous=current
        self.face(previous,mat)
        return previous

    def build(self,name,pivot=(0,0,0),parent=None,skin=None):
        mesh=bpy.data.meshes.new(name+'Mesh')
        mesh.from_pydata([v(tuple(p[i]-pivot[i] for i in range(3))) for p in self.verts],[],self.faces)
        mesh.update()
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        obj.location=v(pivot)
        if parent: obj.parent=parent
        slot=name.startswith('Slot_')
        slot_id=name.split('_')[1] if slot else ''
        surface=(f'SlotSurface_{slot_id}' if slot and self.authored_lod else
                 'SlotSurfaceWheel' if slot_id=='wheels' else
                 'SlotSurfaceCloth' if slot_id in ('torso','gloves','pants') else
                 'SlotSurfaceHard')
        names=[surface] if slot else list(dict.fromkeys(self.materials))
        for n in names: mesh.materials.append(MATS[n])
        for face,n in zip(mesh.polygons,self.materials):
            face.material_index=0 if slot else names.index(n)
            face.use_smooth=len(face.vertices)==4 or (self.authored_lod and bool(skin))
        if slot:
            # RGBA palette: alpha 0=primary, .5=accent, 1=neutral. The runtime
            # recolors private copies of this attribute, keeping one draw per part.
            colors=mesh.color_attributes.new(name='Palette',type='FLOAT_COLOR',domain='CORNER')
            primary={'TeamPaint','TeamCloth','Seat','Exhaust','Boot'}
            accent={'TeamAccent'}
            if slot_id=='torso': accent.add('Ceramic')
            for face,n in zip(mesh.polygons,self.materials):
                role=0 if n in primary else .5 if n in accent else 1
                rgb=MATS[n].diffuse_color[:3]
                for loop in face.loop_indices:
                    colors.data[loop].color=(*rgb,role)
        else:
            # Fixed mechanical pieces retain subtle wear and their PBR materials.
            colors=mesh.color_attributes.new(name='Wear',type='FLOAT_COLOR',domain='POINT')
            for i,p in enumerate(self.verts):
                n=(math.sin(i*17.13+p[0]*87)*43758.5453)%1
                dirty=max(0, min(1,(.46-p[1])/.3))*.12
                shade=1-dirty-.025*n
                colors.data[i].color=(shade,shade*(1-dirty*.08),shade*(1-dirty*.22),1)
        mesh.color_attributes.active_color=colors
        if skin:
            for bone in skin.data.bones: obj.vertex_groups.new(name=bone.name)
            for i,weights in enumerate(self.weights):
                for bone,w in weights.items(): obj.vertex_groups[bone].add([i],w,'REPLACE')
            mod=obj.modifiers.new('Rider skeleton','ARMATURE');mod.object=skin
            obj.parent=skin
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
        bmesh.ops.delete(bm,geom=[vert for vert in bm.verts if not vert.link_faces],context='VERTS')
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(mesh);bm.free();mesh.validate();mesh.update()
        if self.authored_lod: obj['designRevision']='connected-families-v2'
        return obj

def empty(name,p=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=v(p);o.parent=parent
    o.empty_display_size=.045
    return o

VARIANTS=('core','sprint','trail')
SLOTS=('fairing','fender','seat','exhaust','plate','wheels','helmet','visor','torso','gloves','pants','boots')

def emit_variants(slot, designs, pivot=(0,0,0), parent=None, skin=None, component=''):
    """Build locally designed options; every interface uses the same rest coordinates."""
    result=[]
    for variant in VARIANTS:
        obj=designs[variant].build(f'Slot_{slot}_{variant}{component}',pivot,parent,skin)
        if parent: obj.location=(0,0,0)
        obj['slot']=slot;obj['variant']=variant
        result.append(obj)
    return result


def fender(b, sections, mat):
    # Each section is (x, y, width). Curved crown and downturned sides.
    vs=[]
    for x,y,w in sections:
        for z,k in [(-1,-.022),(-.8,0),(0,.019),(.8,0),(1,-.022)]: vs.append((x,y+k,w*z))
    fs=[]
    for j in range(len(sections)-1):
        for i in range(4): fs.append((j*5+i,j*5+i+1,(j+1)*5+i+1,(j+1)*5+i))
    start=len(vs);vs += [(x,y-.012,z) for x,y,z in vs]
    fs += [tuple(start+i for i in reversed(f)) for f in list(fs)]
    for j in range(len(sections)-1):
        for i in [0,4]: fs.append((j*5+i,(j+1)*5+i,(j+1)*5+i+start,j*5+i+start))
    for j in [0,len(sections)-1]:
        for i in range(4): fs.append((j*5+i,j*5+i+start,j*5+i+1+start,j*5+i+1))
    b.add(vs,fs,mat)

def bike_parts(variant='core'):
    """Fit revised plastics to the original seat, fork, wheel and lighting anchors."""
    parts={slot:Builder() for slot in ('fairing','seat','exhaust','plate','rear','front')}
    style={'core':0,'sprint':-1,'trail':1}[variant]
    for part in parts.values(): part.authored_lod=True
    fairing,seat,exhaust,plate,rear,front=[parts[slot] for slot in parts]
    def body_panel(profile,side,base=.121,thickness=.019):
        profile=[(x,y+(.026 if style<0 else -.012 if style>0 else 0)) if index in (4,5,6) else (x,y) for index,(x,y) in enumerate(profile)]
        thickness*=1+.18*style
        cx=sum(p[0] for p in profile)/len(profile);cy=sum(p[1] for p in profile)/len(profile)
        def taper(y): return .85+.15*max(0,min(1,(y-.59)/.21))
        loops=[]
        for inset,z in [(0,base),(0,base+thickness*.45),(.07,base+thickness)]:
            loops.append(fairing.ring([(cx+(x-cx)*(1-inset),cy+(y-cy)*(1-inset),side*z*taper(y)) for x,y in profile],{}))
        size=len(profile)
        for j in range(2):
            for i in range(size): fairing.face((loops[j][i],loops[j][(i+1)%size],loops[j+1][(i+1)%size],loops[j+1][i]),'TeamPaint')
        center=fairing.ring([(cx,cy,side*(base+thickness)*taper(cy))],{})[0]
        for i in range(size):
            accent=(0,1) if style==0 else (0,2) if style<0 else (1,2,3)
            color='TeamAccent' if i in accent else 'Graphite' if profile[0][0]>-.1 and i in (4,5) else 'TeamPaint'
            fairing.face((loops[-1][i],loops[-1][(i+1)%size],center),color)
        fairing.face(reversed(loops[0]),'TeamPaint')
    for side in [-1,1]:
        body_panel([(-.5,.784),(-.37,.795),(-.2,.79),(-.12,.724),(-.18,.67),(-.3,.591),(-.46,.648),(-.53,.717)],side)
        body_panel([(-.05,.797),(.096,.816),(.287,.798),(.341,.76),(.316,.712),(.146,.59),(.034,.632),(-.017,.717)],side)
    fairing.ellipsoid((.18,.755,0),(.14,.079,.112),'Graphite')
    fairing.rod((.216,.832,0),(.216,.85,0),.03,'Graphite',seg=10 if HIGH else 8)
    # Moderately padded enduro saddle: crowned foam, rolled shoulders and a narrow nose.
    # All families share the load-bearing surface so a cosmetic swap cannot move the rider.
    n=12 if HIGH else 8
    loops=[]
    for x,y,width,height in [(-.49,.818,.073,.025),(-.39,.829,.099,.038),(-.23,.827,.105,.038),(-.07,.827,.091,.037),(.085,.827,.063,.03),(.18,.82,.037,.019)]:
        points=[]
        for i in range(n):
            a=2*math.pi*i/n
            crown=math.cos(a)
            points.append((x,y+height*(crown if crown>=0 else .78*crown),width*math.sin(a)))
        loops.append(seat.ring(points,{}))
    for j in range(len(loops)-1):
        for i in range(n):
            color='Textile' if math.cos((i+.5)*2*math.pi/n)>.0 else 'TeamAccent' if j==0 else 'Seat'
            seat.face((loops[j][i],loops[j][(i+1)%n],loops[j+1][(i+1)%n],loops[j+1][i]),color)
    seat.face(reversed(loops[0]),'Seat');seat.face(loops[-1],'Seat')
    fender(rear,[(-.76,.746,.064),(-.715,.761,.083),(-.64,.777,.111),(-.54,.79,.122),(-.43,.794,.122),(-.32,.79,.115),(-.27,.782,.101)],'TeamPaint')
    fender(front,[(.37,.702,.101),(.425,.722,.111),(.495,.722,.116),(.58,.714,.112),(.666,.691,.102),(.746,.661,.083),(.81,.633,.063)],'TeamPaint')
    for part in (front,rear):
        root_x=.37 if part is front else -.27
        free_x=.81 if part is front else -.76
        for index,(x,y,z) in enumerate(part.verts):
            weight=min(1,abs(x-root_x)/abs(free_x-root_x))
            part.verts[index]=(x,y+style*.008*weight,z*(1+.1*style*weight))
        for i,face in enumerate(part.faces):
            average=sum(part.verts[k][0] for k in face)/len(face)
            if (.55<average<.59 if part is front else -.58<average<-.53): part.materials[i]='TeamAccent'
    exhaust.tube([(.18,.575,-.1),(.264,.536,-.123),(.282,.468,-.156),(.258,.404,-.18),(.18,.375,-.187),(.015,.402,-.185),(-.18,.508,-.18),(-.36,.651,-.174)],
                 [.027,.028,.029,.029,.027,.026,.026,.028],'Exhaust',seg=10 if HIGH else 6)
    exhaust.tube([(-.274,.621,-.174),(-.33,.644,-.174),(-.5,.701,-.174),(-.602,.724,-.174),(-.625,.73,-.174)],
                 [.035,.047*(1+.1*style),.048*(1+.1*style),.041,.029],'Alloy',seg=12 if HIGH else 8)
    exhaust.rod((-.625,.73,-.174),(-.646,.736,-.174),.025,'Graphite',seg=8)
    exhaust.block((-.255,.508,-.203),(.182,.027,.008),'TeamAccent',angle=.8)
    # Front board with a continuous chamfered perimeter. Lighting positions remain unchanged.
    outline=[(-.09,.925),(.09,.925),(.108,.907),(.091,.82),(.075,.755),(.055,.742),(-.055,.742),(-.075,.755),(-.091,.82),(-.108,.907)]
    outline=[(z*(1+.075*style*(.925-y)/.183),y) for z,y in outline]
    loops=[]
    for inset,offset in [(0,-.022),(0,-.006),(.06,0)]:
        loops.append(plate.ring([(.354+(.922-y)*.29+offset,.834+(y-.834)*(1-inset),z*(1-inset)) for z,y in outline],{}))
    n=len(outline)
    for j in range(2):
        for i in range(n): plate.face((loops[j][i],loops[j][(i+1)%n],loops[j+1][(i+1)%n],loops[j+1][i]),'TeamAccent')
    center=plate.ring([(.38,.834,0)],{})[0]
    for i in range(n): plate.face((loops[-1][i],loops[-1][(i+1)%n],center),'TeamPaint' if i==0 else 'TeamAccent')
    plate.face(reversed(loops[0]),'TeamAccent')
    plate.block((.406,.823,0),(.053,.09,.151),'Graphite')
    plate.block((.436,.823,0),(.01,.066,.126),'LampFront')
    return parts

def make_wheel(name,x,variant):
    b=Builder();c=(x,.29,0)
    b.torus(c,.245,.047,'Rubber',depth=1.22)
    b.torus(c,.193,.012,'Alloy')
    b.torus(c,.204,.009,'Graphite')
    b.torus((x,.29,-.078),.185,.006,'TeamPaint',segments=SEG*2,sides=4)
    b.torus((x,.29,.078),.185,.006,'TeamAccent',segments=SEG*2,sides=4)
    # Fine tire bead relief is omitted in Low to reserve geometry for anatomy.
    for j in ([-1,1] if HIGH else []):
        b.torus((x,.29,j*.047),.254,.005,'Rubber',segments=SEG*2,sides=4)
    count=(22 if HIGH else 14) if variant!='trail' else (26 if HIGH else 16)
    for i in range(count):
        a=i*2*math.pi/count
        for z in [-.037,.037]:
            b.block((x+math.cos(a)*.293,.29+math.sin(a)*.293,z),(.042,.018,.048),'Rubber',angle=a+math.pi/2)
    b.rod((x,.29,-.069),(x,.29,.069),.037,'Alloy')
    spokes=(18 if HIGH else 10) if variant=='core' else ((12 if HIGH else 8) if variant=='sprint' else (20 if HIGH else 12))
    for i in range(spokes):
        a=2*math.pi*i/spokes
        b.rod((x+math.cos(a+.24)*.033,.29+math.sin(a+.24)*.033,(-1 if i%2 else 1)*.041),(x+math.cos(a)*.19,.29+math.sin(a)*.19,0),.0035,'Alloy',seg=4)
    b.torus((x,.29,.066),.103,.013,'Alloy',segments=SEG*2,sides=4)
    for i in range(6):
        a=i*math.pi/3
        b.rod((x+math.cos(a)*.04,.29+math.sin(a)*.04,.066),(x+math.cos(a+.15)*.097,.29+math.sin(a+.15)*.097,.066),.009,'Alloy',seg=4)
    if x<0:
        b.torus((x,.29,-.079),.115,.012,'Alloy',segments=SEG*2,sides=4)
    if variant=='sprint':
        b.torus((x,.29,-.083),.137,.009,'TeamAccent',segments=SEG*2,sides=4)
    elif variant=='trail':
        b.torus((x,.29,-.083),.151,.008,'TeamAccent',segments=SEG*2,sides=4)
    # Tire silhouette (including diagonal corners of tread) stays inside contact radius.
    for i,p in enumerate(b.verts):
        dx,dy=p[0]-x,p[1]-.29;r=math.hypot(dx,dy)
        if r>.305: b.verts[i]=(x+dx*.305/r,.29+dy*.305/r,p[2])
    anchor=bpy.data.objects[name]
    obj=b.build(f'Slot_wheels_{variant}_{name}',c,anchor)
    obj.location=(0,0,0)
    return obj

def make_bike():
    empty('RearWheel',(-.53,.29,0));empty('FrontWheel',(.57,.29,0))
    for variant in VARIANTS:
        make_wheel('RearWheel',-.53,variant);make_wheel('FrontWheel',.57,variant)
    b=Builder()
    for z in [-.096,.096]:
        b.tube([(-.4,.7,z),(-.19,.48,z),(.0,.325,z),(.24,.38,z),(.34,.78,z)],[.019,.024,.026,.026,.023],'Alloy',seg=8)
        b.rod((-.36,.7,z),(.34,.78,z),.021,'Graphite',seg=8)
        b.rod((-.31,.73,z),(-.48,.61,z),.014,'Graphite',seg=6)
    b.ellipsoid((.06,.43,0),(.142,.117,.096),'Engine')
    b.rod((.05,.43,-.108),(.05,.43,.108),.085,'Alloy')
    b.rod((.055,.535,0),(.14,.66,0),.069,'Engine')
    for i in range(5 if HIGH else 3):
        b.block((.079+i*.008,.552+i*.018,0),(.157,.012,.155),'Alloy',angle=-.42)
    for z in [-.108,.108]:
        for i in range(6):
            a=i*math.pi/3
            b.ellipsoid((.05+.067*math.cos(a),.43+.067*math.sin(a),z),(.009,.009,.005),'Graphite',seg=6,rings=4)
    # Fixed mechanics and contacts are shared by all cosmetic families.
    front_anchor=empty('FrontFender',(.324,.89,0))
    for s in [-1,1]:
        b.rod((-.07,.367,s*.10),(-.07,.367,s*.25),.013,'Graphite',seg=6)
        for j in range(4): b.block((-.10+j*.02,.377,s*.217),(.009,.011,.061),'Alloy')
    handlebar=Builder()
    handlebar.tube([(.35,.91,-.245),(.32,.919,-.15),(.315,.947,-.09),(.315,.947,.09),(.32,.919,.15),(.35,.91,.245)],[.012]*6,'Alloy',seg=8)
    for s in [-1,1]:
        handlebar.rod((.35,.91,s*.19),(.35,.91,s*.26),.019,'Rubber',seg=8)
        handlebar.rod((.377,.901,s*.17),(.393,.897,s*.249),.006,'Alloy',seg=6)
    handlebar.build('Handlebar',(.324,.89,0))
    b.tube([(.37,.89,.14),(.4,.79,.144),(.449,.665,.133),(.513,.485,.107)],[.006]*4,'Rubber',seg=5)
    # Compact enduro lamps follow the suspended chassis in both exported variants.
    b.block((-.726,.773,0),(.045,.06,.115),'Graphite')
    b.block((-.753,.773,0),(.012,.036,.094),'LampRear')
    chassis=b.build('Chassis')
    designs={variant:bike_parts(variant) for variant in VARIANTS}
    for slot in ('fairing','seat','exhaust','plate'):
        emit_variants(slot,{variant:parts[slot] for variant,parts in designs.items()})
    emit_variants('fender',{variant:parts['rear'] for variant,parts in designs.items()},component='_Rear')
    emit_variants('fender',{variant:parts['front'] for variant,parts in designs.items()},pivot=(.324,.89,0),parent=front_anchor,component='_Front')
    empty('HeadlightAnchor',(.448,.823,0),chassis)
    empty('HeadlightTarget',(4.448,.123,0),chassis)
    empty('TaillightAnchor',(-.764,.773,0),chassis)
    swing=Builder()
    for s in [-1,1]:
        swing.tube([(-.53,.29,s*.098),(-.35,.327,s*.097),(-.10,.407,s*.075)],[.026,.031,.029],'Alloy',seg=4)
        swing.block((-.5,.291,s*.106),(.087,.047,.015),'Graphite')
    swing.tube([(-.54,.411,-.094),(-.09,.479,-.094),(-.033,.414,-.094),(-.5,.173,-.094),(-.64,.243,-.094),(-.54,.411,-.094)],[.006]*6,'Engine',seg=4)
    swing.build('Swingarm',(-.1,.407,0))
    for s,suffix in [(-1,'R'),(1,'L')]:
        b=Builder();b.rod((0,0,0),(0,1,0),.023,'Alloy',seg=10 if HIGH else 6);b.build('ForkLower'+suffix)
        b=Builder();b.rod((0,0,0),(0,1,0),.031,'ForkCoating',seg=10 if HIGH else 6);b.build('ForkUpper'+suffix)
        b=Builder();b.block((0,.06,0),(.067,.12,.064),'Ceramic');b.build('ForkGuard'+suffix)
    b=Builder();b.rod((0,0,0),(0,1,0),.022,'Alloy',seg=8);b.build('Shock')
    b=Builder()
    pts=[(.039*math.cos(i*.65),i/64,.039*math.sin(i*.65)) for i in range(65 if HIGH else 33)]
    if not HIGH: pts=[(.039*math.cos(i*1.3),i/32,.039*math.sin(i*1.3)) for i in range(33)]
    b.tube(pts,[.008]*len(pts),'TeamPaint',seg=5);b.build('Spring')

HIP=(-.21,.968,0)
CHEST=(-.015,1.23,0)
HEAD=(.085,1.325,0)
SHOULDER={s:(-.015,1.202,s*.154) for s in [-1,1]}
ELBOW={s:(.13,1.049,s*.255) for s in [-1,1]}
HAND={s:(.35,.91,s*.222) for s in [-1,1]}
LEG_HIP={s:(-.21,.949,s*.115) for s in [-1,1]}
KNEE={s:(.045,.661,s*.235) for s in [-1,1]}
ANKLE={s:(-.102,.418,s*.21) for s in [-1,1]}

PANTS_SURFACES={}
def anatomical_pants(style):
    """Sculpt one continuous garment, then skin it; never flatten the hip branch.

    Overlapping construction volumes are fused before export. The saddle cavity is
    confined to the medial underside, leaving the glute and quadriceps contours full.
    Waist and boot cuts are shared by every family, independently of surface LoD.
    """
    if HIGH not in PANTS_SURFACES:
        source=Builder()
        # One garment envelope across the hips. Separate glute ellipsoids made
        # two protruding lobes instead of the quiet seated contour in the reference.
        source.loft([(-.211,y,0) for y in (.985,.967,.942,.916,.894,.875,.858,.850)],
                    [(.089,.119),(.093,.128),(.101,.137),(.110,.150),(.108,.151),(.094,.135),(.065,.095),(.03,.05)],
                    [{}]*8,'TeamCloth',seg=32,tangents=[(0,-1,0)]*8)
        for side in (-1,1):
            k,f=KNEE[side],ANKLE[side]
            points=[(-.222,.923,side*.055),(-.188,.903,side*.105),(-.151,.867,side*.165),
                    (-.090,.818,side*.200),(-.034,.748,side*.229),k,mix(k,f,.18),mix(k,f,.46),mix(k,f,.62)]
            source.loft(points,[(.053,.054),(.079,.074),(.090,.079),(.086,.078),(.074,.068),(.060,.061),(.053,.057),(.043,.047),(.04,.044)],
                        [{}]*len(points),'TeamCloth',seg=24)
        mesh=bpy.data.meshes.new('Anatomical construction')
        mesh.from_pydata([v(p) for p in source.verts],[],source.faces)
        bm=bmesh.new();bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
        obj=bpy.data.objects.new('Anatomical construction',mesh);bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        remesh=obj.modifiers.new('Fuse pelvis and thighs','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.006
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        smooth=obj.modifiers.new('Anatomical transitions','SMOOTH');smooth.factor=1.2;smooth.iterations=18
        bpy.ops.object.modifier_apply(modifier=smooth.name)
        # A rounded saddle recess. It follows the foam only below the body;
        # the visible lateral buttocks and thighs retain their original section.
        for vert in obj.data.vertices:
            x,y,z=vert.co.x,vert.co.z,-vert.co.y
            # Bring the iliac crest back into the shirt's waist opening. The
            # transition is gradual; the seated glute volume remains below it.
            hip_sections=[(.850,.26,.32),(.875,.18,.25),(.900,.116,.182),(.925,.106,.146),(.943,.090,.119),(.967,.088,.116)]
            if y>=hip_sections[0][0]:
                lower,upper=hip_sections[-2:]
                for first,second in zip(hip_sections,hip_sections[1:]):
                    if first[0]<=y<=second[0]: lower,upper=first,second;break
                t=max(0,min(1,(y-lower[0])/(upper[0]-lower[0])))
                depth=lower[1]*(1-t)+upper[1]*t;width=lower[2]*(1-t)+upper[2]*t
                radius=math.sqrt(((x+.211)/depth)**2+(z/width)**2)
                if radius>1: x=-.211+(x+.211)/radius;z/=radius
            if y<.905 and -.38<x<.16 and abs(z)<.163:
                medial=max(0,1-(abs(z)/.163)**4)
                floor=.869-.018*(abs(z)/.163)**2
                if y<floor: y+= (floor-y)*medial
            vert.co=v((x,y,z))
        decimate=obj.modifiers.new('Anatomy silhouette LoD','DECIMATE')
        obj.data.calc_loop_triangles()
        decimate.ratio=(1900 if HIGH else 650)/len(obj.data.loop_triangles)
        bpy.ops.object.modifier_apply(modifier=decimate.name)
        bm=bmesh.new();bm.from_mesh(obj.data)
        # Clip at identical attachment planes, preserving closed, welded surfaces.
        cuts=[(v((-.211,.967,0)),v((0,1,0)),0)]
        for side in (-1,1):
            k,f=KNEE[side],ANKLE[side]
            cuts.append((v(mix(k,f,.46)),v(tuple(Vector(f)-Vector(k))).normalized(),side))
        for center,normal,side in cuts:
            verts=[p for p in bm.verts if not side or -p.co.y*side>0]
            selected=set(verts)
            edges=[e for e in bm.edges if all(p in selected for p in e.verts)]
            faces=[f for f in bm.faces if all(p in selected for p in f.verts)]
            result=bmesh.ops.bisect_plane(bm,geom=verts+edges+faces,dist=.0000001,
                plane_co=center,plane_no=normal,clear_outer=True,clear_inner=False)
            boundary=[edge for edge in result['geom_cut'] if isinstance(edge,bmesh.types.BMEdge) and edge.is_boundary]
            if boundary: bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
        # Insert genuine paint boundaries so decimated triangles do not create
        # sawtooth edges between the trouser cloth and the knee protection.
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
            dist=.0000001,plane_co=v((0,.719,0)),plane_no=v((0,1,0)))
        for x in (.072,):
            # Cut both sides of the knee boundary. Cutting only the lower faces
            # leaves collinear points that glTF triangulates as deforming T-junctions.
            geom=list(bm.verts)+list(bm.edges)+list(bm.faces)
            bmesh.ops.bisect_plane(bm,geom=geom,dist=.0000001,plane_co=v((x,0,0)),plane_no=v((1,0,0)))
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.verts.ensure_lookup_table();bm.verts.index_update()
        vertices=[(p.co.x,p.co.z,-p.co.y) for p in bm.verts]
        faces=[tuple(p.index for p in face.verts) for face in bm.faces]
        bm.free();bpy.data.objects.remove(obj,do_unlink=True)
        PANTS_SURFACES[HIGH]=(vertices,faces)
    vertices,faces=PANTS_SURFACES[HIGH]
    pants=Builder();pants.authored_lod=True
    pants.verts=list(vertices);pants.faces=list(faces)
    for x,y,z in vertices:
        side=1 if z>=0 else -1;suffix='L' if side==1 else 'R'
        # Keep the seated contact entirely on the pelvis; fade along the thigh,
        # then share the knee bend over a broad band instead of a hard hinge.
        t=max(0,min(1,(.94-y)/.10));t=t*t*(3-2*t)
        lateral=max(0,min(1,(abs(z)-.055)/.07))
        lower=max(0,min(1,(.84-y)/.1))
        t*=max(lateral*lateral*(3-2*lateral),lower*lower*(3-2*lower))
        knee=max(0,min(1,(.745-y)/.15));knee=knee*knee*(3-2*knee)
        pants.weights.append({'Pelvis':1-t,'Thigh'+suffix:t*(1-knee),'Shin'+suffix:t*knee})
    for face in faces:
        x,y,z=[sum(vertices[i][axis] for i in face)/len(face) for axis in range(3)]
        mat='Textile' if y<.719 else 'TeamCloth'
        if y<.719 and x>.072: mat='TeamAccent'
        if style<0 and .755<y<.83 and abs(z)>.29: mat='TeamAccent'
        if style>0 and .755<y<.81 and x<-.12: mat='Textile'
        pants.materials.append(mat)
    return pants

def rider_parts(variant='core'):
    """Connected garments with a shared seated rig and fixed hand/foot contacts."""
    parts={slot:Builder() for slot in ('torso','pants','gloves','boots','helmet','visor')}
    style={'core':0,'sprint':-1,'trail':1}[variant]
    for part in parts.values(): part.authored_lod=True
    torso,pants,gloves,boots,helmet,visor=[parts[slot] for slot in parts]
    # Keep symmetric shoulder openings and the crotch seam in both qualities.
    # Low saves detail in wheels, helmet, gloves and boots instead of these joints.
    n=16
    sections=[(-.194,.838,.1,.132),(-.176,.903,.087,.127),(-.133,.968,.088,.14),
              (-.09,1.023,.09,.153),(-.05,1.076,.088,.159),(0,1.13,.076,.162),
              (.012,1.165,.06,.14),(.028,1.197,.048,.079),(.043,1.212,.046,.067),
              (.061,1.24,.043,.054),(.077,1.261,.04,.048)]
    sections=[(x-.015-.005*max(0,min(1,(1.13-y)/.292)),
               y+.07+.035*max(0,min(1,(1.13-y)/.292)),depth,width) for x,y,depth,width in sections]
    rings=[]
    for j,(x,y,depth,width) in enumerate(sections):
        if 2<=j<=6: depth*=1+.04*style;width*=1+.045*style
        t=min(1,j/2)
        weights={'Pelvis':1-t,'Spine':t} if j<8 else {'Spine':1-max(0,(j-8)*.25),'Head':max(0,(j-8)*.25)}
        rings.append(torso.ring([(x+depth*math.cos(2*math.pi*i/n),y,width*math.sin(2*math.pi*i/n)) for i in range(n)],weights))
    span=n//4
    starts={1:n//4-span//2,-1:3*n//4-span//2}
    for j in range(len(rings)-1):
        for i in range(n):
            if j in (4,5) and any(start<=i<start+span for start in starts.values()): continue
            material_name='Textile' if j>=8 else 'TeamCloth'
            # Color blocks belong to the garment surface rather than floating shoulder pads.
            if j==7: material_name='Graphite'
            elif j in (5,6) and math.cos((i+.5)*2*math.pi/n)<-.3: material_name='TeamAccent'
            elif j in (2,3) and abs(math.sin((i+.5)*2*math.pi/n))>.94: material_name='Textile'
            if style<0 and j in (2,3,4) and .35<math.sin((i+.5)*2*math.pi/n)<.95: material_name='TeamAccent'
            if style>0 and j in (3,4,5) and abs(math.cos((i+.5)*2*math.pi/n))>.75: material_name='Textile'
            torso.face((rings[j][i],rings[j][(i+1)%n],rings[j+1][(i+1)%n],rings[j+1][i]),material_name)
    torso.face(reversed(rings[0]),'TeamCloth');torso.face(rings[-1],'Textile')
    for side,suffix in [(-1,'R'),(1,'L')]:
        start=starts[side];end=start+span
        boundary=[rings[4][i%n] for i in range(start,end+1)]
        boundary += [rings[j][end%n] for j in (5,6)]
        boundary += [rings[6][i%n] for i in range(end-1,start-1,-1)]
        boundary += [rings[5][start%n]]
        a,e,w=SHOULDER[side],ELBOW[side],HAND[side]
        upper,fore,hand='UpperArm'+suffix,'Forearm'+suffix,'Hand'+suffix
        points=[(.01,1.192,side*.186),mix(a,e,.48),mix(a,e,.78),e,mix(e,w,.2),mix(e,w,.52),mix(e,w,.77),w]
        directions=[tuple(Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])) for j in range(len(points))]
        directions[0]=(0,0,side)
        directions[1]=tuple(Vector((0,0,side))*.65+(Vector(e)-Vector(a)).normalized()*.35)
        weights=[{'Spine':.35,upper:.65},{upper:1},{upper:.85,fore:.15},{upper:.5,fore:.5},
                 {upper:.15,fore:.85},{fore:1},{fore:1},{fore:.6,hand:.4}]
        radii=[(.043,.06),(.064,.066),(.048,.051),(.048,.05),(.046,.048),(.039,.041),(.033,.035),(.029,.031)]
        radii=[(rx*(1+.05*style),ry*(1+.05*style)) if j<3 else (rx,ry) for j,(rx,ry) in enumerate(radii)]
        torso.loft(points,radii,weights,'TeamCloth',start=boundary,tangents=directions,
                   paint=lambda j,i,p:'Textile' if j in (3,4) and torso.verts[-len(boundary)+i][2]*side>p[2]*side+.008 else 'TeamAccent' if j==6 else 'TeamCloth')
    parts['pants']=anatomical_pants(style)
    for side,suffix in [(-1,'R'),(1,'L')]:
        a,k,f=LEG_HIP[side],KNEE[side],ANKLE[side]
        thigh,shin,foot='Thigh'+suffix,'Shin'+suffix,'Foot'+suffix
        # One shaped boot shaft flows around the ankle into the toe. The outsole and buckles are fitted details.
        points=[mix(k,f,.32),mix(k,f,.5),mix(k,f,.79),f,(f[0]+.028,f[1]-.017,f[2]),(f[0]+.076,f[1]-.022,f[2]),(f[0]+.124,f[1]-.025,f[2]),(f[0]+.145,f[1]-.027,f[2])]
        weights=[{shin:1},{shin:1},{shin:.9,foot:.1},{shin:.35,foot:.65},{foot:1},{foot:1},{foot:1},{foot:1}]
        first_boot_face=len(boots.faces)
        boot_radii=[(.056,.061),(.052*(1+.06*style),.058*(1+.06*style)),(.039,.047),(.033,.042),(.037,.052),(.037,.051),(.028,.043),(.012,.026)]
        boots.loft(points,boot_radii,weights,'Boot',seg=12 if HIGH else 8,
                   paint=lambda j,i,p:'Textile' if j==1 else 'TeamAccent' if j==7 else 'Boot')
        boots.materials[first_boot_face]='Textile';boots.materials[-1]='TeamAccent'
        boots.block((f[0]+.048,f[1]-.048,f[2]),(.193,.021,.109),'Rubber',foot)
        for t in ([.42,.7] if style<0 else [.36,.5,.65,.79] if style>0 else [.4,.59,.77]):
            p=mix(k,f,t)
            boots.block((p[0]+.002,p[1],p[2]+side*.052),(.054,.012,.007),'TeamAccent',shin,angle=.59)
        # A cupped palm and curled grouped fingers surround the grip, rather than a ball at the wrist.
        w=HAND[side];hand='Hand'+suffix
        gloves.loft([(w[0]-.023,w[1]+.014,w[2]),(w[0],w[1]+.004,w[2]),(w[0]+.025,w[1]-.01,w[2]),(w[0]+.03,w[1]-.029,w[2]),(w[0]+.014,w[1]-.036,w[2])],
                    [(.023,.029),(.028*(1+.07*style),.034),(.022,.034),(.015,.031),(.009,.025)],[{hand:1}]*5,'TeamCloth',seg=12 if HIGH else 8,
                    paint=lambda j,i,p:'TeamAccent' if j==1 and i in ((1,2,3) if style<0 else (1,2)) else 'Rubber' if j>=3 or (style>0 and j==2) else 'TeamCloth')
        gloves.tube([(w[0]-.005,w[1]+.005,w[2]-side*.02),(w[0]+.013,w[1]-.009,w[2]-side*.035),(w[0]+.012,w[1]-.025,w[2]-side*.022)],[.013,.012,.009],'Rubber',hand,seg=6)
        # Fingers form a single curled section; the separate thumb fits inside the palm.
        # Avoid overlapping finger tubes, whose coincident faces flickered at the knuckles.
    # A continuous outer shell and inner lining share explicitly modelled eye-port rims.
    n=24 if HIGH else 12
    profiles=[(1.248,-.012,.235,.092),(1.267,-.027,.293,.115),(1.297,-.034,.295,.125),
              (1.318,-.035,.269,.13),(1.357,-.033,.262,.132),(1.395,-.025,.246,.128),
              (1.425,-.009,.222,.116),(1.453,.02,.19,.09),(1.47,.062,.15,.052),(1.478,.095,.119,.012)]
    shell=[];lining=[]
    for index,(y,back,front,width) in enumerate(profiles):
        if index in (1,2): width*=1+.04*style;front+=.006*style
        if index>=7: width*=1+.06*style;front+=.006*style
        mid=(front+back)/2;depth=(front-back)/2
        shell.append(helmet.ring([(mid+depth*math.cos(2*math.pi*i/n),y,width*math.sin(2*math.pi*i/n)) for i in range(n)],{'Head':1}))
        lining.append(helmet.ring([(mid+(depth-.006)*math.cos(2*math.pi*i/n),y+.003 if y<1.3 else y-.003,(width-.006)*math.sin(2*math.pi*i/n)) for i in range(n)],{'Head':1}))
    removed={(j,i) for j in (3,4) for i in range(n) if i<n//6 or i>=n-n//6}
    edge_counts={}
    for j in range(len(shell)-1):
        for i in range(n):
            if (j,i) in removed: continue
            face=(shell[j][i],shell[j][(i+1)%n],shell[j+1][(i+1)%n],shell[j+1][i])
            a=(i+.5)*2*math.pi/n
            color='TeamAccent' if (5<=j<=7 and math.cos(a)<(-.25 if style==0 else .1 if style<0 else -.65)) else 'TeamPaint'
            if j==1 and math.cos(a)>.87: color='Graphite'
            helmet.face(face,color)
            helmet.face((lining[j][i],lining[j+1][i],lining[j+1][(i+1)%n],lining[j][(i+1)%n]),'Textile')
            for a,b in zip(face,face[1:]+face[:1]):
                key=tuple(sorted((a,b)));edge_counts[key]=edge_counts.get(key,0)+1
    outer_to_inner={a:b for outer,inner in zip(shell,lining) for a,b in zip(outer,inner)}
    for (a,b),count in edge_counts.items():
        if count==1 and not (a in shell[-1] and b in shell[-1]): helmet.face((a,b,outer_to_inner[b],outer_to_inner[a]),'Graphite')
    helmet.face(shell[-1],'TeamPaint');helmet.face(reversed(lining[-1]),'Textile')
    # Rounded-rectangle goggles wrap the eye port; center and corners follow the helmet's curvature.
    def contour(width,height,corner):
        points=[]
        for cy,cz,start in [(height-corner,width-corner,0),(-height+corner,width-corner,math.pi/2),(-height+corner,-width+corner,math.pi),(height-corner,-width+corner,3*math.pi/2)]:
            for j in range(4 if HIGH else 3):
                angle=start+j*math.pi/2/(3 if HIGH else 2)
                points.append((cy+corner*math.cos(angle),cz+corner*math.sin(angle)))
        return points
    goggle_rings=[]
    for width,height,corner,offset in [(.116,.05,.019,-.013),(.117,.05,.019,0),(.106,.04,.015,.007),(.10,.035,.014,.01)]:
        points=[(.276-.052*(abs(z)/.117)**1.65+offset,1.356+y,z) for y,z in contour(width,height,corner)]
        goggle_rings.append(visor.ring(points,{'Head':1}))
    size=len(goggle_rings[0])
    for j in range(3):
        for i in range(size): visor.face((goggle_rings[j][i],goggle_rings[j][(i+1)%size],goggle_rings[j+1][(i+1)%size],goggle_rings[j+1][i]),'Rubber' if j<2 else 'Lens')
    center=visor.ring([(.288,1.356,0)],{'Head':1})[0]
    for i in range(size): visor.face((goggle_rings[-1][i],goggle_rings[-1][(i+1)%size],center),'Lens')
    visor.face(reversed(goggle_rings[0]),'Rubber')
    angles=[math.pi/3+i*(4*math.pi/3)/(16 if HIGH else 10) for i in range((16 if HIGH else 10)+1)]
    strap=[]
    for angle in angles:
        strap.append(visor.ring([(.114+.15*math.cos(angle),1.356+dy,.135*math.sin(angle)) for dy in (-.009,.009)],{'Head':1}))
    for j in range(len(strap)-1): visor.face((strap[j][0],strap[j][1],strap[j+1][1],strap[j+1][0]),'Rubber')
    # The peak remains in the existing visor category, preserving customization semantics.
    first=len(visor.verts)
    tip=.32+(.019 if style>0 else -.022 if style<0 else 0)
    fender(visor,[(.045,1.444,.101),(.11,1.459,.118),(.173,1.454,.13),(.235,1.439,.13),(.286,1.418,.12), (tip,1.404,.101+.005*style)],'TeamPaint')
    visor.weights[first:]=[{'Head':1} for _ in visor.verts[first:]]
    # An accent stripe is painted on the peak's own surface.
    for i,face in enumerate(visor.faces):
        if min(face)>=first and sum(visor.verts[k][0] for k in face)/len(face)<.09: visor.materials[i]='TeamAccent'
    for part in (helmet,visor):
        part.verts=[tuple(HEAD[k]+(point[k]-(.10,1.255,0)[k])*.94 for k in range(3)) for point in part.verts]
    return parts

def make_scooter():
    """Approved classic scooter base with independent racing and touring slot families."""
    make_bike()
    def replace(name,builder,pivot=(0,0,0)):
        old=bpy.data.objects.get(name)
        parent=old.parent if old else None
        children=list(old.children) if old else []
        if old: bpy.data.objects.remove(old,do_unlink=True)
        obj=builder.build(name,pivot,parent)
        if parent: obj.location=(0,0,0)
        for child in children: child.parent=obj
        return obj
    for name,x in [('RearWheel',-.53),('FrontWheel',.57)]:
        bpy.data.objects[name].location=v((x,.22,0))
        for variant in VARIANTS:
            wheel=Builder();c=(x,.22,0)
            wheel.torus(c,.174,.044,'Rubber',depth=1.25)
            wheel.torus((x,.22,-.055),.139,.012,'TeamPaint',sides=4)
            wheel.torus((x,.22,.055),.139,.012,'TeamAccent',sides=4)
            wheel.rod((x,.22,-.048),(x,.22,.048),.052,'Alloy',seg=10 if HIGH else 6)
            spokes=6 if variant=='core' else 5 if variant=='sprint' else 8
            for i in range(spokes):
                a=i*2*math.pi/spokes
                if variant=='sprint':
                    wheel.tube([(x+math.cos(a)*.041,.22+math.sin(a)*.041,0),
                                (x+math.cos(a+.22)*.097,.22+math.sin(a+.22)*.097,0),
                                (x+math.cos(a+.30)*.14,.22+math.sin(a+.30)*.14,0)],
                               [.019,.017,.012],'TeamPaint',seg=6)
                else:
                    wheel.rod((x+math.cos(a)*.04,.22+math.sin(a)*.04,0),(x+math.cos(a)*.13,.22+math.sin(a)*.13,0),
                              .013 if variant=='core' else .010,'Alloy',seg=5)
            if variant=='trail':
                blocks=28 if HIGH else 16
                for i in range(blocks):
                    a=i*2*math.pi/blocks
                    wheel.block((x+math.cos(a)*.216,.22+math.sin(a)*.216,0),(.031,.006,.10),'Rubber',angle=a+math.pi/2)
            if variant=='sprint':
                wheel.torus((x,.22,.064),.124,.006,'TeamAccent',segments=SEG*2,sides=4)
            replace(f'Slot_wheels_{variant}_{name}',wheel,c)
    chassis=Builder()
    chassis.ellipsoid((-.42,.385,0),(.20,.12,.14),'Engine')
    # Compact engine cover beside the rear wheel, rather than an exposed dirt-bike engine.
    chassis.block((-.49,.325,.095),(.32,.145,.065),'Alloy',angle=-.08)
    for y in (.302,.331,.36):
        chassis.block((-.51,y,.130),(.13,.010,.006),'Graphite',angle=-.08)
    chassis.tube([(-.50,.46,0),(-.24,.35,0),(.12,.29,0),(.31,.45,0),(.32,.9,0)],[.022]*5,'Graphite',seg=6)
    chassis.block((-.75,.656,0),(.055,.045,.12),'Graphite')
    chassis.block((-.78,.656,0),(.014,.031,.098),'LampRear')
    chassis.panel([(-.765,.63),(-.81,.50),(-.705,.50),(-.685,.60)],-.061,.061,'Graphite')
    chassis.tube([(-.72,.66,-.12),(-.65,.717,-.165),(-.42,.73,-.177),(-.42,.73,.177),(-.65,.717,.165),(-.72,.66,.12)],
                 [.012]*6,'Alloy',seg=6)
    replace('Chassis',chassis)
    bpy.data.objects['HeadlightAnchor'].location=v((.479,.973,0))
    bpy.data.objects['HeadlightTarget'].location=v((4.479,.273,0))
    bpy.data.objects['TaillightAnchor'].location=v((-.796,.656,0))
    bar=Builder()
    bar.authored_lod=True
    # The headlamp and steering shell form a single broad, rounded scooter handlebar.
    bar.loft([(.348,.965,z) for z in (-.209,-.174,-.105,0,.105,.174,.209)],
             [(.023,.030),(.043,.072),(.055,.099),(.060,.108),(.055,.099),(.043,.072),(.023,.030)],
             [{}]*7,'TeamPaint',seg=12 if HIGH else 8,tangents=[(0,0,1)]*7)
    for side in (-1,1):
        bar.rod((.32,.965,side*.192),(.32,.965,side*.272),.021,'Rubber',seg=8)
        bar.rod((.371,.950,side*.179),(.375,.950,side*.268),.005,'Alloy',seg=5)
        bar.block((.420,.968,side*.138),(.009,.020,.056),'Ceramic')
        bar.tube([(.315,1.008,side*.173),(.310,1.062,side*.205),(.327,1.104,side*.236)],
                 [.009,.009,.008],'Graphite',seg=6)
        bar.ellipsoid((.330,1.137,side*.247),(.025,.046,.039),'Graphite',seg=8,rings=4)
        bar.ellipsoid((.306,1.139,side*.247),(.003,.034,.027),'Alloy',seg=8,rings=4)
    bar.rod((.449,.973,0),(.472,.973,0),.061,'Graphite',seg=16 if HIGH else 10)
    bar.rod((.473,.973,0),(.481,.973,0),.050,'LampFront',seg=20 if HIGH else 12)
    replace('Handlebar',bar,(.324,.94,0))
    bpy.data.objects['FrontFender'].location=v((.324,.94,0))
    # Scooter suspension retains the rig nodes, with mechanics concealed by the leg shield.
    swing=Builder()
    for side in (-1,1):
        swing.tube([(-.53,.22,side*.084),(-.42,.285,side*.084),(-.26,.35,side*.084)],
                   [.022,.029,.026],'Graphite',seg=6)
    replace('Swingarm',swing,(-.26,.35,0))
    for suffix in ('R','L'):
        lower=Builder();lower.rod((0,0,0),(0,1,0),.021,'Alloy',seg=10 if HIGH else 6)
        replace('ForkLower'+suffix,lower)
        upper=Builder();upper.rod((0,0,0),(0,1,0),.025,'Graphite',seg=10 if HIGH else 6)
        replace('ForkUpper'+suffix,upper)
    for variant in VARIANTS:
        fairing=Builder();fairing.authored_lod=True
        # An elongated side cowl supports the saddle; its underside clears the rear tire.
        sections=[(-.755,.50,.065,.078),(-.68,.515,.143,.177),(-.53,.550,.183,.211),
                  (-.34,.547,.191,.218),(-.18,.509,.166,.183),(-.075,.442,.088,.102)]
        count=16 if HIGH else 12;previous=None
        for section,(x,y,height,width) in enumerate(sections):
            if variant=='sprint': width-=.011 if 0<section<5 else 0
            elif variant=='trail': width+=.014 if 0<section<5 else 0
            points=[]
            for i in range(count):
                angle=2*math.pi*i/count;py=y+height*math.cos(angle);z=width*math.sin(angle)
                if abs(x+.53)<.228 and abs(z)<.082:
                    py=max(py,.22+math.sqrt(.228**2-(x+.53)**2))
                points.append((x,py,z))
            current=fairing.ring(points,{})
            if previous:
                for i in range(count):
                    band=variant=='sprint' and i in (count//8,count-count//8-1) and 1<section<5
                    fairing.face((previous[i],previous[(i+1)%count],current[(i+1)%count],current[i]),'TeamAccent' if band else 'TeamPaint')
            else: fairing.face(reversed(current),'TeamPaint')
            previous=current
        fairing.face(previous,'TeamPaint')
        # A thick wraparound leg shield conceals the fork, with a quiet bevel around its front.
        previous=None
        shield_sections=[(.315,.275,.070,.235),(.383,.355,.089,.248),(.430,.49,.105,.242),
                         (.412,.64,.088,.224),(.347,.778,.077,.198),(.318,.863,.065,.155),
                         (.318,.92,.065,.143),(.318,.945,.051,.128)]
        for x,y,depth,width in shield_sections:
            outline=[(1,0),(.95,.70),(.55,.94),(.10,1),(-.45,.95),(-.60,.70),
                     (-.60,0),(-.60,-.70),(-.45,-.95),(.10,-1),(.55,-.94),(.95,-.70)]
            current=fairing.ring([(x+dx*depth,y,dz*width) for dx,dz in outline],{})
            if previous:
                for i in range(12): fairing.face((previous[i],previous[(i+1)%12],current[(i+1)%12],current[i]),'TeamPaint')
            else: fairing.face(reversed(current),'TeamPaint')
            previous=current
        fairing.face(previous,'TeamPaint')
        fairing.block((-.005,.264,0),(.73,.04,.50),'TeamPaint')
        fairing.loft([(-.30,.285,0),(-.32,.35,0),(-.33,.42,0),(-.32,.49,0)],
                     [(.065,.23),(.070,.22),(.082,.21),(.09,.20)],[{}]*4,'TeamPaint',seg=12 if HIGH else 8,
                     tangents=[(0,1,0)]*4)
        for side in (-1,1):
            fairing.block((-.013,.288,side*.165),(.54,.014,.166),'Textile')
            fairing.tube([(-.68,.59,side*.160),(-.51,.706,side*.195),(-.29,.703,side*.193)],
                         [.007]*3,'TeamAccent',seg=5)
            if variant=='sprint':
                fairing.tube([(-.28,.268,side*.255),(.035,.268,side*.255),(.34,.29,side*.236)],
                             [.007]*3,'TeamAccent',seg=5)
                for x,y,z in [(-.48,.52,.205),(-.44,.52,.207),(-.40,.52,.209)]:
                    fairing.block((x,y,side*z),(.019,.065,.009),'Graphite',angle=-.3)
            elif variant=='trail':
                fairing.tube([(-.71,.53,side*.195),(-.57,.415,side*.230),(-.31,.397,side*.232),(-.15,.472,side*.177)],
                             [.012]*4,'TeamAccent',seg=6)
                fairing.tube([(.317,.294,side*.251),(.397,.40,side*.253),(.438,.545,side*.244),(.379,.731,side*.212)],
                             [.011]*4,'TeamAccent',seg=6)
        replace(f'Slot_fairing_{variant}',fairing)
        seat=Builder();seat.authored_lod=True
        seat_points=[(-.57,.758,0),(-.48,.780,0),(-.28,.788,0),(-.12,.784,0),(-.04,.768,0)]
        seat_radii=[(.035,.075),(.05,.145),(.05,.147),(.039,.12),(.02,.06)]
        if variant=='sprint':
            seat_points[0]=(-.53,.770,0);seat_radii[1]=(.047,.134);seat_radii[2]=(.05,.138)
        elif variant=='trail':
            seat_points[0]=(-.64,.763,0);seat_points[1]=(-.51,.782,0)
            seat_radii[0]=(.043,.09);seat_radii[1]=(.05,.158);seat_radii[2]=(.05,.155)
        seat.loft(seat_points,seat_radii,[{}]*5,'Seat',seg=16 if HIGH else 10,
                  tangents=[(1,0,0)]*5)
        seat.tube([(-.55,.773,-.10),(-.38,.81,-.147),(-.17,.796,-.12)],[.007]*3,'TeamAccent',seg=5)
        if variant=='sprint':
            seat.block((-.46,.832,0),(.045,.010,.14),'TeamAccent')
        elif variant=='trail':
            for x in (-.55,-.49): seat.block((x,.829,0),(.013,.009,.20),'TeamAccent')
            seat.tube([(-.615,.778,.11),(-.39,.816,.158),(-.17,.796,.12)],[.007]*3,'TeamAccent',seg=5)
        replace(f'Slot_seat_{variant}',seat)
        exhaust=Builder();exhaust.authored_lod=True
        if variant=='sprint':
            exhaust.tube([(-.35,.37,-.16),(-.44,.325,-.19),(-.68,.325,-.19),(-.72,.33,-.19)],
                         [.022,.037,.037,.023],'Exhaust',seg=12 if HIGH else 8)
            for x in (-.47,-.65): exhaust.rod((x-.012,.325,-.19),(x+.012,.325,-.19),.040,'TeamAccent',seg=10 if HIGH else 6)
        else:
            exhaust.tube([(-.35,.37,-.16),(-.49,.33,-.19),(-.63,.31,-.19),(-.72,.33,-.19)],[.027,.044,.044,.028],'Exhaust',seg=10 if HIGH else 6)
            if variant=='trail':
                exhaust.panel([(-.40,.35),(-.45,.387),(-.66,.37),(-.70,.338),(-.66,.296),(-.44,.307)],-.244,-.233,'TeamAccent')
                for x in (-.47,-.53,-.59): exhaust.block((x,.338,-.250),(.027,.020,.008),'Graphite')
        exhaust.rod((-.72,.33,-.19),(-.745,.33,-.19),.022,'Graphite',seg=8)
        exhaust.block((-.53,.355,-.233),(.13,.016,.009),'TeamAccent')
        replace(f'Slot_exhaust_{variant}',exhaust)
        plate=Builder();plate.authored_lod=True
        for side in (-1,1):
            if variant=='sprint':
                plate.loft([(.519,.536,side*.178),(.498,.618,side*.165),(.459,.723,side*.139)],
                           [(.006,.024),(.006,.021),(.006,.009)],[{}]*3,'TeamAccent',seg=8,tangents=[(0,1,0)]*3)
                plate.block((.455,.727,side*.127),(.013,.020,.038),'Graphite',angle=-.4)
            else:
                plate.loft([(.518,.53,side*.176),(.512,.565,side*.173),(.476,.68,side*.155)],
                           [(.006,.016),(.006,.016),(.006,.012)],[{}]*3,'TeamAccent',seg=8,tangents=[(0,1,0)]*3)
        if variant=='trail':
            plate.loft([(.446,1.035,0),(.424,1.087,0),(.407,1.135,0)],
                       [(.011,.15),(.010,.139),(.007,.115)],[{}]*3,'Graphite',seg=12 if HIGH else 8,tangents=[(0,1,0)]*3)
            for side in (-1,1):
                plate.tube([(.44,1.029,side*.148),(.42,1.092,side*.137),(.405,1.13,side*.112)],
                           [.008]*3,'TeamPaint',seg=6)
            plate.rod((.407,1.138,-.113),(.407,1.138,.113),.006,'TeamAccent',seg=6)
        plate.block((.414,.794,0),(.009,.043,.060),'TeamPaint')
        replace(f'Slot_plate_{variant}',plate)
        for component,x in [('Rear',-.53),('Front',.57)]:
            guard=Builder();guard.authored_lod=True
            if variant=='sprint':
                fender(guard,[(x-.181,.415,.087),(x-.11,.455,.111),(x,.477,.115),(x+.115,.454,.113),(x+.181,.415,.078)],'TeamPaint')
                for side in (-1,1): guard.tube([(x-.10,.465,side*.040),(x,.489,side*.040),(x+.12,.463,side*.040)],[.008]*3,'TeamAccent',seg=5)
            elif variant=='trail':
                fender(guard,[(x-.249,.343,.096),(x-.165,.428,.126),(x,.477,.132),(x+.165,.43,.126),(x+.249,.349,.096)],'TeamPaint')
                guard.block((x-.248,.320,0),(.018,.067,.144),'Graphite',angle=-.28)
                for side in (-1,1): guard.tube([(x-.20,.402,side*.104),(x,.486,side*.121),(x+.20,.400,side*.104)],[.007]*3,'TeamAccent',seg=5)
            else:
                fender(guard,[(x-.215,.384,.091),(x-.14,.45,.118),(x,.477,.124),(x+.14,.447,.119),(x+.215,.380,.095)],'TeamPaint')
            guard.block((x,.483,0),(.09,.009,.055),'TeamAccent')
            replace(f'Slot_fender_{variant}_{component}',guard,(.324,.94,0) if component=='Front' else (0,0,0))

def retarget_scooter_rider(specs):
    """Rebind the approved garments to the scooter's seated visual skeleton."""
    arm=bpy.data.objects['RiderRig']
    old_matrices={bone.name:bone.matrix_local.copy() for bone in arm.data.bones}
    old_lengths={bone.name:bone.length for bone in arm.data.bones}
    targets={'Pelvis':((-.24,.94,0),(-.24,1.027,0)),
             'Spine':((-.24,.94,0),(-.13,1.202,0)),
             'Head':((-.03,1.297,0),(0,1.472,0))}
    for side,suffix in [(-1,'R'),(1,'L')]:
        shoulder=(-.13,1.174,side*.154);elbow=(.08,1.051,side*.245);hand=(.32,.965,side*.222)
        hip=(-.24,.921,side*.115);knee=(.095,.644,side*.205);ankle=(.15,.348,side*.19)
        targets.update({f'UpperArm{suffix}':(shoulder,elbow),f'Forearm{suffix}':(elbow,hand),f'Hand{suffix}':(hand,(.36,.955,side*.222)),
                        f'Thigh{suffix}':(hip,knee),f'Shin{suffix}':(knee,ankle),f'Foot{suffix}':(ankle,(.259,.330,side*.19))})
    bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,(head,tail) in targets.items():
        arm.data.edit_bones[name].head=v(head);arm.data.edit_bones[name].tail=v(tail)
    bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
    for name,(head,tail) in targets.items():
        arm.data.bones[name]['restHead']=list(head);arm.data.bones[name]['restTail']=list(tail)
    matrices={bone.name:bone.matrix_local @ Matrix.Diagonal((1,bone.length/old_lengths[bone.name],1,1)) @ old_matrices[bone.name].inverted() for bone in arm.data.bones}
    for obj in list(arm.children):
        if obj.type!='MESH': continue
        for vert in obj.data.vertices:
            original=vert.co.copy();result=Vector((0,0,0));total=0
            for group in vert.groups:
                name=obj.vertex_groups[group.group].name
                result+=group.weight*(matrices[name] @ original);total+=group.weight
            if total: vert.co=result/total
        obj.data.update()
    return [(name,*targets[name],parent) for name,a,b,parent in specs]

def make_rider():
    data=bpy.data.armatures.new('RiderSkeleton')
    arm=bpy.data.objects.new('RiderRig',data);bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active=arm;arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    specs=[('Pelvis',HIP,(-.21,1.055,0),None),('Spine',HIP,CHEST,'Pelvis'),('Head',HEAD,(.115,1.5,0),'Spine')]
    for s,suffix in [(-1,'R'),(1,'L')]:
        specs.extend([(f'UpperArm{suffix}',SHOULDER[s],ELBOW[s],'Spine'),(f'Forearm{suffix}',ELBOW[s],HAND[s],f'UpperArm{suffix}'),(f'Hand{suffix}',HAND[s],(.39,.90,s*.222),f'Forearm{suffix}'),(f'Thigh{suffix}',LEG_HIP[s],KNEE[s],'Pelvis'),(f'Shin{suffix}',KNEE[s],ANKLE[s],f'Thigh{suffix}'),(f'Foot{suffix}',ANKLE[s],(.007,.40,s*.21),f'Shin{suffix}')])
    for name,a,b,parent in specs:
        bone=data.edit_bones.new(name);bone.head=v(a);bone.tail=v(b)
        if parent: bone.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT');arm.select_set(False)
    empty('Rider',(0,0,0),arm)
    designs={variant:rider_parts(variant) for variant in VARIANTS}
    for slot in ('torso','gloves','pants','boots','helmet','visor'):
        emit_variants(slot,{variant:parts[slot] for variant,parts in designs.items()},skin=arm)
    # Saved references drive a rig in the exported coordinate system without guessed axes.
    for name,a,tail,parent in specs:
        bone=arm.pose.bones[name]
        bone.bone['restHead']=list(a);bone.bone['restTail']=list(tail)
    return retarget_scooter_rider(specs) if VEHICLE=='motoneta' else specs

def position_studio_rig():
    def segment(name,a,b):
        o=bpy.data.objects[name];o.location=v(a)
        direction=v(b)-v(a)
        o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction.normalized())
        o.scale=(1,1,direction.length)
    for s,suffix in [(-1,'R'),(1,'L')]:
        a=(.57,.22 if VEHICLE=='motoneta' else .29,s*.089);top=(.324,.94 if VEHICLE=='motoneta' else .89,s*.089);join=mix(a,top,.47)
        segment('ForkLower'+suffix,a,join);segment('ForkUpper'+suffix,join,top)
        bpy.data.objects['ForkGuard'+suffix].location=v((.559,.252 if VEHICLE=='motoneta' else .322,s*.089))
    if VEHICLE=='motoneta':
        segment('Shock',(-.51,.27,0),(-.40,.61,0));segment('Spring',(-.482,.355,0),(-.42,.548,0))
    else:
        segment('Shock',(-.32,.342,0),(-.245,.699,0));segment('Spring',(-.30,.432,0),(-.256,.639,0))

def studio(render=False,quality='high'):
    scene=bpy.context.scene
    # Preview the same vertex palette in the authored .blend. Add this node only
    # after GLB export: the runtime GLBs use the lean single-material palette.
    for name in [name for name in MATS if name.startswith('SlotSurface')]:
        m=MATS[name]
        palette=m.node_tree.nodes.new('ShaderNodeVertexColor')
        palette.layer_name='Palette'
        m.node_tree.links.new(palette.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    model_collection=bpy.context.collection
    model_collection.name='Motocross - export'
    studio_collection=bpy.data.collections.new('Studio - do not export')
    scene.collection.children.link(studio_collection)
    def in_studio(obj):
        for collection in list(obj.users_collection): collection.objects.unlink(obj)
        studio_collection.objects.link(obj)
    scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.world.color=(.15,.15,.15)
    scene.view_settings.view_transform='AgX'
    for name,loc,power,size in [('Key',(2,-4,6),500,5),('Fill',(-2,2,4),350,4),('Rim',(-3,-1,4),450,3)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        o=bpy.data.objects.new(name,data);studio_collection.objects.link(o);o.location=loc
        o.rotation_euler=(Vector((0,0,.75))-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.016))
    floor=bpy.context.object;floor.name='StudioFloor'
    in_studio(floor)
    m=bpy.data.materials.new('Studio');m.diffuse_color=(.065,.078,.086,1)
    m.use_nodes=True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.065,.078,.086,1)
    m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9
    floor.data.materials.append(m)
    data=bpy.data.cameras.new('StudioCamera');cam=bpy.data.objects.new('StudioCamera',data);studio_collection.objects.link(cam)
    scene.camera=cam;data.type='ORTHO';data.ortho_scale=2.25
    render_directory=SOURCE/'review'/('essential' if VEHICLE=='motoneta' else 'cadera-natural')/'blender'
    if render: render_directory.mkdir(parents=True,exist_ok=True)
    presets=VARIANTS if '--render-all' in __import__('sys').argv else ('core',)
    for variant in presets:
        for obj in bpy.data.objects:
            if obj.type=='MESH' and obj.name.startswith('Slot_'):
                obj.hide_render=f'_{variant}' not in obj.name
                obj.hide_set(obj.hide_render)
        for name,loc in [('side',(0,-5,1.2)),('front',(5,-.001,1.1)),('rear',(-5,-.001,1.1)),('three-quarter',(3,-5,2.5)),('helmet',(2,-4,2.2))]:
            target=(.13,0,1.35) if name=='helmet' else (0,0,.76)
            data.ortho_scale=.57 if name=='helmet' else 2.25
            cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
            scene.render.filepath=str(render_directory/f'{quality}-{variant}-{name}.png')
            if render: bpy.ops.render.render(write_still=True)
    for obj in bpy.data.objects:
        if obj.type=='MESH' and obj.name.startswith('Slot_'):
            obj.hide_render='_core' not in obj.name
            obj.hide_set(obj.hide_render)
    data.ortho_scale=2.25;cam.location=(3,-5,2.5)
    cam.rotation_euler=(Vector((0,0,.76))-cam.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.select_all(action='DESELECT')
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_location=Vector((0,0,.76))
                area.spaces.active.region_3d.view_distance=2.7
                area.spaces.active.region_3d.view_rotation=cam.rotation_euler.to_quaternion()
                area.spaces.active.shading.type='MATERIAL'
                area.spaces.active.overlay.show_floor=False

report={}
for HIGH in [False,True]:
    # Studio previews hide unused slots; reveal them before rebuilding the other quality.
    for obj in bpy.context.scene.objects: obj.hide_set(False)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name.startswith('Studio - do not export'): bpy.data.collections.remove(collection)
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)
    SEG,RINGS=(12,8) if HIGH else (8,5)
    material('TeamPaint','c91c32',.34)
    material('TeamCloth','c91c32',.83)
    material('TeamAccent','eff0ec',.41)
    material('Ceramic','eff0ec',.38)
    material('Graphite','24282d',.51,.12)
    material('Textile','22252a',.92)
    material('Seat','1c2023',.96)
    material('Boot','bcbdb8',.74)
    material('Rubber','15191c',.94)
    material('Alloy','a6afb5',.32,.78)
    material('Engine','626b71',.58,.65)
    material('Exhaust','a39b85',.43,.73)
    material('ForkCoating','b9a374',.3,.75)
    material('Lens','152d37',.13,.48)
    material('LampFront','f4f5ed',.2)
    material('LampRear','ed283f',.25)
    material('SlotSurfaceHard','ffffff',.59,.12)
    material('SlotSurfaceCloth','ffffff',.82)
    material('SlotSurfaceWheel','ffffff',.83,.08)
    for slot,roughness,metallic in [('fairing',.4,.08),('seat',.87,0),('exhaust',.42,.68),('plate',.45,.04),('fender',.4,.08),
                                     ('helmet',.36,.06),('visor',.22,.18),('torso',.86,0),('pants',.88,0),('gloves',.78,0),('boots',.7,0)]:
        material(f'SlotSurface_{slot}','ffffff',roughness,metallic)
    (make_scooter if VEHICLE=='motoneta' else make_bike)();specs=make_rider();position_studio_rig()
    quality='high' if HIGH else 'low'
    # Low detail uses planar decimation, keeping silhouettes, skin weights and material borders.
    if not HIGH:
        for o in bpy.context.scene.objects:
            if o.type!='MESH': continue
            if o.get('designRevision'): continue
            # Spend the mobile budget on garment joints; dense wheel detail can tolerate more reduction.
            modifier=o.modifiers.new('Mobile simplification','DECIMATE');modifier.ratio=.58 if o.name.startswith('Slot_wheels_') else .68
            bpy.context.view_layer.objects.active=o
            if len(o.modifiers)>1: bpy.ops.object.modifier_move_up(modifier=modifier.name)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            o.data.validate();o.data.update()
    bpy.context.view_layer.update()
    triangles=0;all_triangles=0;parts=[]
    for o in bpy.context.scene.objects:
        if o.type=='MESH':
            o.data.calc_loop_triangles()
            count=len(o.data.loop_triangles)
            all_triangles+=count
            if not o.name.startswith('Slot_') or '_core' in o.name: triangles+=count
            bounds=[tuple(min(v.co[k] for v in o.data.vertices) for k in range(3)),tuple(max(v.co[k] for v in o.data.vertices) for k in range(3))]
            pivot=o.matrix_world.translation
            parts.append({'id':o.name,'parent':o.parent.name if o.parent else None,
                          'pivotGame':[pivot.x,pivot.z,-pivot.y],
                          'size':[bounds[1][k]-bounds[0][k] for k in range(3)],
                          'triangles':count,'boundsBlender':bounds,
                          'materials':[m.name for m in o.data.materials]})
    fixed=sum(part['triangles'] for part in parts if not part['id'].startswith('Slot_'))
    maximum=fixed+sum(max(sum(part['triangles'] for part in parts if part['id'].startswith(f'Slot_{slot}_{variant}') ) for variant in VARIANTS) for slot in SLOTS)
    limit=30000 if HIGH else 8000
    assert maximum<=limit,(quality,maximum,limit)
    filepath=OUT/f'{VEHICLE}-{quality}.glb'
    bpy.ops.export_scene.gltf(filepath=str(filepath),export_format='GLB',export_yup=True,export_skins=True,export_animations=False,export_extras=True,export_materials='EXPORT',export_vertex_color='ACTIVE')
    report[quality]={'trianglesSelected':triangles,'trianglesSelectedMax':maximum,'trianglesCatalog':all_triangles,'bytes':filepath.stat().st_size,'textures':0,'bones':len(specs),'parts':parts}
    if not HIGH and '--render' in __import__('sys').argv:
        for o in bpy.context.scene.objects:
            if o.name.startswith('Slot_') and '_core' not in o.name: o.hide_render=True
        studio(True,'low')
    if HIGH:
        rig_json=json.dumps({name:{'head':a,'tail':b,'parent':parent} for name,a,b,parent in specs},indent=2)+'\n'
        (SOURCE/'rig.json').write_text(rig_json)
        (ROOT/'src'/('motoneta-rig.json' if VEHICLE=='motoneta' else 'bike-rig.json')).write_text(rig_json)
        for o in bpy.context.scene.objects:
            if o.name.startswith('Slot_') and '_core' not in o.name:
                o.hide_set(True);o.hide_render=True
        studio('--render' in __import__('sys').argv)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'{VEHICLE}.blend'))
(SOURCE/'manifest.json').write_text(json.dumps({'generator':'scripts/build-motocross.py','blender':bpy.app.version_string,'coordinateSystem':'+X forward, +Y up, +Z left in game/glTF','reviewStage':'classic-reference-v2; Essential approved; independent racing and touring families' if VEHICLE=='motoneta' else 'natural-hip-v6; single seated hip envelope without separate glute lobes; balanced thigh taper; approved rig and seat preserved','slots':SLOTS,'variants':VARIANTS,'assets':report},indent=2)+'\n')
print(f'{VEHICLE.upper()}_ASSETS',json.dumps({quality:{key:value for key,value in stats.items() if key!='parts'} for quality,stats in report.items()}))
