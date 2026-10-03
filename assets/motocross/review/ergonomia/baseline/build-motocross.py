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
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'models'
SOURCE = ROOT / 'assets' / 'motocross'
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
    # A flatter saddle has a defined top and rounded corners instead of a tubular silhouette.
    n=12 if HIGH else 8
    loops=[]
    for x,y,width,height in [(-.49,.806,.077,.019),(-.39,.814,.093,.025),(-.23,.817,.099,.027),(-.07,.819,.091,.026),(.085,.822,.075,.024),(.18,.816,.042,.018)]:
        points=[]
        for i in range(n):
            a=2*math.pi*i/n
            points.append((x,y+height*max(-.8,min(.8,math.cos(a))),width*math.sin(a)*(1+.05*style)))
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
    for j in [-1,1]:
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

HIP=(-.19,.863,0)
CHEST=(.00,1.16,0)
HEAD=(.10,1.255,0)
SHOULDER={s:(.00,1.132,s*.154) for s in [-1,1]}
ELBOW={s:(.143,1.014,s*.255) for s in [-1,1]}
HAND={s:(.35,.91,s*.222) for s in [-1,1]}
LEG_HIP={s:(-.19,.862,s*.089) for s in [-1,1]}
KNEE={s:(.064,.641,s*.186) for s in [-1,1]}
ANKLE={s:(-.102,.418,s*.21) for s in [-1,1]}

def rider_parts(variant='core'):
    """Connected garments and a fitted helmet family. Rest bones and sockets stay fixed."""
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
        points=[(.025,1.121,side*.186),mix(a,e,.48),mix(a,e,.78),e,mix(e,w,.2),mix(e,w,.52),mix(e,w,.77),w]
        directions=[tuple(Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])) for j in range(len(points))]
        directions[0]=(0,0,side)
        directions[1]=tuple(Vector((0,0,side))*.65+(Vector(e)-Vector(a)).normalized()*.35)
        weights=[{'Spine':.35,upper:.65},{upper:1},{upper:.85,fore:.15},{upper:.5,fore:.5},
                 {upper:.15,fore:.85},{fore:1},{fore:1},{fore:.6,hand:.4}]
        radii=[(.043,.06),(.064,.066),(.048,.051),(.048,.05),(.046,.048),(.039,.041),(.033,.035),(.029,.031)]
        radii=[(rx*(1+.05*style),ry*(1+.05*style)) if j<3 else (rx,ry) for j,(rx,ry) in enumerate(radii)]
        torso.loft(points,radii,weights,'TeamCloth',start=boundary,tangents=directions,
                   paint=lambda j,i,p:'Textile' if j in (3,4) and torso.verts[-len(boundary)+i][2]*side>p[2]*side+.008 else 'TeamAccent' if j==6 else 'TeamCloth')
    # A single pelvis surface forks into two leg loops along a shared crotch seam.
    hip_rings=[]
    for y,depth,width in [(.862,.083,.118),(.832,.096,.126),(.798,.095,.13)]:
        hip_rings.append(pants.ring([(-.191+depth*math.cos(2*math.pi*i/n),y,width*math.sin(2*math.pi*i/n)) for i in range(n)],{'Pelvis':1}))
    for j in range(2):
        for i in range(n): pants.face((hip_rings[j][i],hip_rings[j][(i+1)%n],hip_rings[j+1][(i+1)%n],hip_rings[j+1][i]),'Textile' if j==0 else 'TeamCloth')
    pants.face(reversed(hip_rings[0]),'Textile')
    crotch=pants.ring([(-.191,.783,0)],{'Pelvis':1})[0]
    for side,suffix in [(-1,'R'),(1,'L')]:
        boundary=([hip_rings[-1][i] for i in range(n//2+1)] if side==1 else [hip_rings[-1][i%n] for i in range(n//2,n+1)])+[crotch]
        a,k,f=LEG_HIP[side],KNEE[side],ANKLE[side]
        thigh,shin,foot='Thigh'+suffix,'Shin'+suffix,'Foot'+suffix
        # The cuff ends inside the boot shaft, before differing ankle weights could expose an inner layer.
        points=[mix(a,k,.42),mix(a,k,.67),mix(a,k,.82),k,mix(k,f,.18),mix(k,f,.46)]
        directions=[tuple(Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])) for j in range(len(points))]
        directions[0]=(0,-1,0)
        weights=[{'Pelvis':.3,thigh:.7},{thigh:1},{thigh:.85,shin:.15},{thigh:.5,shin:.5},
                 {thigh:.15,shin:.85},{shin:1}]
        leg_radii=[(.08,.083),(.073,.077),(.06,.062),(.057,.061),(.052,.057),(.043,.047)]
        leg_radii=[(rx*(1+.04*style),ry*(1+.04*style)) if j<2 else (rx,ry) for j,(rx,ry) in enumerate(leg_radii)]
        pants.loft(points,leg_radii,weights,'TeamCloth',start=boundary,tangents=directions,
                   paint=lambda j,i,p:'TeamAccent' if (j in (3,4) and pants.verts[-len(boundary)+i][0]>p[0]+.036) or (style<0 and j in (1,2) and pants.verts[-len(boundary)+i][2]*side>p[2]*side+.025) else 'Textile' if j in (3,4,5) or (style>0 and j==1 and i<3) else 'TeamCloth')
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
        part.verts=[tuple(HEAD[k]+(point[k]-HEAD[k])*.94 for k in range(3)) for point in part.verts]
    return parts

def make_rider():
    data=bpy.data.armatures.new('RiderSkeleton')
    arm=bpy.data.objects.new('RiderRig',data);bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active=arm;arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    specs=[('Pelvis',HIP,(-.19,.95,0),None),('Spine',HIP,CHEST,'Pelvis'),('Head',HEAD,(.13,1.43,0),'Spine')]
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
    return specs

def position_studio_rig():
    def segment(name,a,b):
        o=bpy.data.objects[name];o.location=v(a)
        direction=v(b)-v(a)
        o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(direction.normalized())
        o.scale=(1,1,direction.length)
    for s,suffix in [(-1,'R'),(1,'L')]:
        a=(.57,.29,s*.089);top=(.324,.89,s*.089);join=mix(a,top,.47)
        segment('ForkLower'+suffix,a,join);segment('ForkUpper'+suffix,join,top)
        bpy.data.objects['ForkGuard'+suffix].location=v((.559,.322,s*.089))
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
    render_directory=SOURCE/'review'/'catalogo'/'blender'
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
    make_bike();specs=make_rider();position_studio_rig()
    quality='high' if HIGH else 'low'
    # Low detail uses planar decimation, keeping silhouettes, skin weights and material borders.
    if not HIGH:
        for o in bpy.context.scene.objects:
            if o.type!='MESH': continue
            if o.get('designRevision'): continue
            # Spend the mobile budget on garment joints; dense wheel detail can tolerate more reduction.
            modifier=o.modifiers.new('Mobile simplification','DECIMATE');modifier.ratio=.62 if o.name.startswith('Slot_wheels_') else .68
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
    filepath=OUT/f'motocross-{quality}.glb'
    bpy.ops.export_scene.gltf(filepath=str(filepath),export_format='GLB',export_yup=True,export_skins=True,export_animations=False,export_extras=True,export_materials='EXPORT',export_vertex_color='ACTIVE')
    report[quality]={'trianglesSelected':triangles,'trianglesSelectedMax':maximum,'trianglesCatalog':all_triangles,'bytes':filepath.stat().st_size,'textures':0,'bones':len(specs),'parts':parts}
    if not HIGH and '--render' in __import__('sys').argv:
        for o in bpy.context.scene.objects:
            if o.name.startswith('Slot_') and '_core' not in o.name: o.hide_render=True
        studio(True,'low')
    if HIGH:
        (SOURCE/'rig.json').write_text(json.dumps({name:{'head':a,'tail':b,'parent':parent} for name,a,b,parent in specs},indent=2)+'\n')
        for o in bpy.context.scene.objects:
            if o.name.startswith('Slot_') and '_core' not in o.name:
                o.hide_set(True);o.hide_render=True
        studio('--render' in __import__('sys').argv)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'motocross.blend'))
(SOURCE/'manifest.json').write_text(json.dumps({'generator':'scripts/build-motocross.py','blender':bpy.app.version_string,'coordinateSystem':'+X forward, +Y up, +Z left in game/glTF','reviewStage':'connected-families-v2; incorporates Esencial review feedback','slots':SLOTS,'variants':VARIANTS,'assets':report},indent=2)+'\n')
print('MOTOCROSS_ASSETS',json.dumps({quality:{key:value for key,value in stats.items() if key!='parts'} for quality,stats in report.items()}))
