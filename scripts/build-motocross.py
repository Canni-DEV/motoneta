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
        surface=('SlotSurfaceWheel' if slot_id=='wheels' else
                 'SlotSurfaceCloth' if slot_id in ('torso','gloves','pants') else
                 'SlotSurfaceHard')
        names=[surface] if slot else list(dict.fromkeys(self.materials))
        for n in names: mesh.materials.append(MATS[n])
        for face,n in zip(mesh.polygons,self.materials):
            face.material_index=0 if slot else names.index(n)
            face.use_smooth=len(face.vertices)==4
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
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(mesh);bm.free();mesh.validate();mesh.update()
        return obj

def empty(name,p=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=v(p);o.parent=parent
    o.empty_display_size=.045
    return o

VARIANTS=('core','sprint','trail')
SLOTS=('fairing','fender','seat','exhaust','plate','wheels','helmet','visor','torso','gloves','pants','boots')

def emit_variants(slot, base, pivot=(0,0,0), parent=None, skin=None, component=''):
    """Bake interchangeable forms at identical anchors; no runtime geometry generation."""
    result=[]
    for variant in VARIANTS:
        b=Builder()
        b.verts=list(base.verts)
        b.faces=list(base.faces)
        b.materials=list(base.materials)
        b.weights=[dict(w) for w in base.weights]
        if variant!='core':
            # A shared fluid silhouette, with restrained changes at the extremities.
            for i,(x,y,z) in enumerate(b.verts):
                if slot == 'wheels': continue
                distance=abs(z)
                if slot in ('fairing','fender','plate','helmet','visor'):
                    width=1.08 if variant=='trail' else .91
                    length=1.04 if variant=='sprint' else .97
                    b.verts[i]=(pivot[0]+(x-pivot[0])*length,y,z*width)
                elif slot in ('seat','torso','pants'):
                    b.verts[i]=(x,y+(0.012 if variant=='trail' else -.006),z*(1.05 if variant=='trail' else .94))
                elif slot in ('exhaust','gloves','boots'):
                    b.verts[i]=(x,y,z*(1.06 if variant=='trail' else .94))
            # Each option has a visible, separate accent treatment; all bevels share
            # the Builder's 23% chamfer rule and PBR materials.
            if slot=='fairing':
                for s in (-1,1):
                    b.panel([(.04,.742),(.27,.762),(.3,.742),(.07,.718)],s*.153,s*.158,'TeamAccent')
            elif slot=='seat':
                for x in (-.29,-.19,-.09):
                    b.block((x,.835,0),(.012,.007,.1),'TeamAccent')
            elif slot=='plate':
                b.block((.412,.805,0),(.012,.03,.125),'TeamAccent')
            elif slot=='helmet':
                for s in (-1,1):
                    b.panel([(.033,1.376),(.112,1.449),(.17,1.444),(.068,1.344)],s*.13,s*.135,'TeamAccent','Head')
            elif slot=='torso':
                for s in (-1,1):
                    b.panel([(-.07,1.08),(-.03,1.1),(-.1,.994),(-.12,1.014)],s*.13,s*.133,'TeamAccent','Spine')
        name=f'Slot_{slot}_{variant}{component}'
        obj=b.build(name,pivot,parent,skin)
        if parent:
            obj.location=(0,0,0)
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
    # Shared frame ends here. Every replaceable assembly is authored separately.
    fairing=Builder();fenders=Builder();front=Builder();seat=Builder();exhaust=Builder();plate=Builder()
    fender(fenders,[(-.76,.744,.065),(-.65,.773,.112),(-.48,.79,.125),(-.28,.786,.11)],'TeamPaint')
    fender(front,[(.37,.714,.105),(.47,.725,.116),(.65,.696,.105),(.81,.63,.064)],'TeamPaint')
    fenders.block((-.56,.785,0),(.14,.008,.025),'TeamAccent')
    front.block((.64,.702,0),(.14,.008,.026),'TeamAccent')
    front_anchor=empty('FrontFender',(.324,.89,0))
    seat.tube([(-.47,.802,0),(-.34,.816,0),(-.13,.825,0),(.09,.83,0),(.2,.825,0)],[.043,.05,.05,.047,.025],'Seat',seg=8,oval=2.1)
    seat.block((-.16,.856,0),(.22,.009,.037),'TeamAccent')
    fairing.ellipsoid((.19,.758,0),(.15,.096,.108),'Graphite')
    fairing.rod((.218,.837,0),(.218,.856,0),.033,'Graphite',seg=10)
    for s in [-1,1]:
        z=s*.122
        fairing.panel([(-.48,.765),(-.2,.78),(-.1,.7),(-.29,.558),(-.53,.65)],z,z+s*.018,'TeamAccent')
        fairing.panel([(-.49,.744),(-.25,.752),(-.33,.696),(-.53,.668)],z+s*.02,z+s*.023,'TeamPaint')
        fairing.panel([(.015,.8),(.32,.8),(.353,.721),(.15,.55),(-.006,.64)],z,z+s*.023,'TeamPaint')
        fairing.panel([(.093,.776),(.317,.77),(.296,.729),(.075,.7)],z+s*.025,z+s*.029,'TeamAccent')
        fairing.panel([(.05,.681),(.203,.64),(.147,.58),(.013,.639)],z+s*.025,z+s*.029,'Graphite')
        fairing.block((.245,.664,s*.094),(.10,.18,.058),'Engine',angle=-.16)
        for j in range(5): fairing.block((.282,.602+j*.028,s*.12),(.009,.012,.006),'Alloy')
        b.rod((-.07,.367,s*.10),(-.07,.367,s*.25),.013,'Graphite',seg=6)
        for j in range(4): b.block((-.10+j*.02,.377,s*.217),(.009,.011,.061),'Alloy')
    # Header, heat guard, upswept rear silencer.
    exhaust.tube([(.18,.575,-.1),(.275,.53,-.12),(.276,.417,-.17),(.18,.37,-.186),(-.07,.415,-.185),(-.36,.65,-.18)],[.029,.03,.031,.028,.026,.03],'Exhaust',seg=8)
    exhaust.tube([(-.26,.613,-.174),(-.52,.697,-.174),(-.62,.721,-.174)],[.047,.05,.041],'Alloy')
    exhaust.rod((-.626,.723,-.174),(-.649,.731,-.174),.03,'Graphite',seg=8)
    exhaust.block((-.27,.503,-.203),(.21,.053,.012),'TeamAccent',angle=.8)
    handlebar=Builder()
    handlebar.tube([(.35,.91,-.245),(.32,.919,-.15),(.315,.947,-.09),(.315,.947,.09),(.32,.919,.15),(.35,.91,.245)],[.012]*6,'Alloy',seg=8)
    for s in [-1,1]:
        handlebar.rod((.35,.91,s*.19),(.35,.91,s*.26),.019,'Rubber',seg=8)
        handlebar.rod((.377,.901,s*.17),(.393,.897,s*.249),.006,'Alloy',seg=6)
    handlebar.build('Handlebar',(.324,.89,0))
    plate_profile=[(-.092,.922),(.092,.922),(.111,.905),(.083,.76),(.06,.741),(-.06,.741),(-.083,.76),(-.111,.905)]
    vs=[(.354+(.922-y)*.29+offset,y,z) for offset in [-.026,0] for z,y in plate_profile]
    fs=[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
    plate.add(vs,fs,'TeamAccent')
    stripe=[(-.082,.901),(.082,.901),(.075,.877),(-.065,.869)]
    plate.add([(.355+(.922-y)*.29,y,z) for z,y in stripe],[(0,1,2,3)],'TeamPaint')
    plate.block((.324,.875,0),(.07,.031,.213),'Alloy')
    plate.block((.358,.773,0),(.067,.027,.213),'Alloy')
    b.tube([(.37,.89,.14),(.4,.79,.144),(.449,.665,.133),(.513,.485,.107)],[.006]*4,'Rubber',seg=5)
    # Compact enduro lamps follow the suspended chassis in both exported variants.
    plate.block((.405,.823,0),(.055,.103,.153),'Graphite')
    plate.block((.437,.823,0),(.012,.075,.127),'LampFront')
    b.block((-.726,.773,0),(.045,.06,.115),'Graphite')
    b.block((-.753,.773,0),(.012,.036,.094),'LampRear')
    chassis=b.build('Chassis')
    emit_variants('fairing',fairing)
    emit_variants('seat',seat)
    emit_variants('exhaust',exhaust)
    emit_variants('plate',plate)
    emit_variants('fender',fenders,component='_Rear')
    emit_variants('fender',front,pivot=(.324,.89,0),parent=front_anchor,component='_Front')
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
    torso=Builder();gloves=Builder();pants=Builder();boots=Builder();helmet=Builder();visor=Builder()
    b=torso
    # Shaped torso: waist, abdomen, ribcage, broad shoulders and a narrow neck.
    sections=[(-.196,.842,.08,.104),(-.168,.902,.082,.111),(-.115,.99,.084,.127),(-.052,1.083,.084,.151),(.004,1.15,.071,.144),(.025,1.18,.048,.09)]
    vs=[];ws=[]
    for j,(x,y,depth,width) in enumerate(sections):
        for i in range(SEG):
            a=2*math.pi*i/SEG
            vs.append((x+depth*math.cos(a),y,width*math.sin(a)))
            t=min(1,j/2);ws.append({'Pelvis':1-t,'Spine':t})
    fs=[]
    for j in range(len(sections)-1):
        for i in range(SEG): fs.append((j*SEG+i,j*SEG+(i+1)%SEG,(j+1)*SEG+(i+1)%SEG,(j+1)*SEG+i))
    fs.extend([tuple(reversed(range(SEG))),tuple((len(sections)-1)*SEG+i for i in range(SEG))])
    b.add(vs,fs,'TeamCloth',weights=ws)
    pants.ellipsoid((-.19,.841,0),(.10,.086,.109),'Textile','Pelvis')
    b.tube([(.016,1.151,0),(.076,1.24,0)],[.057,.051],'Textile','Spine',oval=1.1)
    b.tube([(.022,1.183,0),(.04,1.207,0)],[.064,.058],'Graphite','Spine',oval=1.17)
    # Protective chest/back panels and white jersey shoulder yoke.
    b.panel([(-.076,1.137),(.048,1.151),(.021,1.072),(-.10,.98),(-.135,1.031)],-.088,.088,'Textile','Spine')
    for s in [-1,1]:
        b.ellipsoid((-.017,1.141,s*.12),(.07,.038,.065),'Ceramic','Spine',seg=SEG,rings=6)
        b.panel([(-.064,1.11),(-.04,1.09),(-.121,.987),(-.144,1.01)],s*.113,s*.119,'Ceramic','Spine')
    for s,suffix in [(-1,'R'),(1,'L')]:
        ua,fa,hand='UpperArm'+suffix,'Forearm'+suffix,'Hand'+suffix
        a,e,w=SHOULDER[s],ELBOW[s],HAND[s]
        pts=[a,mix(a,e,.35),mix(a,e,.83),e,mix(e,w,.2),mix(e,w,.75),w]
        weights=[{ua:1},{ua:1},{ua:.9,fa:.1},{ua:.5,fa:.5},{ua:.12,fa:.88},{fa:1},{fa:1}]
        b.tube(pts,[.068,.064,.047,.045,.049,.037,.031],'TeamCloth',seg=SEG,weights=weights)
        b.ellipsoid((e[0],e[1],e[2]+s*.014),(.047,.049,.053),'Textile',fa,seg=SEG,rings=6)
        b.tube([mix(e,w,.43),mix(e,w,.55)],[.047,.043],'Ceramic',fa,seg=SEG)
        gloves.ellipsoid((w[0]+.001,w[1]-.007,w[2]),(.044,.034,.035),'TeamCloth',hand)
        gloves.ellipsoid((w[0]-.01,w[1]+.021,w[2]),(.027,.011,.028),'TeamAccent',hand,seg=8,rings=4)
        th,sh,foot='Thigh'+suffix,'Shin'+suffix,'Foot'+suffix
        a,k,f=LEG_HIP[s],KNEE[s],ANKLE[s]
        pts=[a,mix(a,k,.3),mix(a,k,.8),k,mix(k,f,.25),mix(k,f,.6),f]
        weights=[{th:1},{th:1},{th:.9,sh:.1},{th:.5,sh:.5},{sh:1},{sh:1},{sh:1}]
        first_face=len(pants.faces)
        pants.tube(pts,[.084,.079,.059,.056,.057,.046,.037],'Textile',seg=SEG,weights=weights)
        # Cloth color is assigned on the continuous leg, avoiding coplanar overlays.
        for j in [0,1]:
            for i in range(SEG):
                face=first_face+1+j*SEG+i
                if abs(sum(pants.verts[n][2] for n in pants.faces[face])/len(pants.faces[face]))>.10:
                    pants.materials[face]='TeamCloth'
        pants.ellipsoid((k[0]+.026,k[1]+.006,k[2]),(.047,.061,.058),'TeamAccent',sh)
        # High MX boot follows the shin; flexible ankle and a separate sole follow foot.
        boots.tube([mix(k,f,.3),mix(k,f,.48),mix(k,f,.88),f],[.06,.057,.043,.04],'Boot',sh,seg=SEG)
        boots.ellipsoid((f[0]+.052,f[1]-.011,f[2]),(.102,.046,.052),'Boot',foot,seg=SEG,rings=6)
        boots.block((f[0]+.046,f[1]-.045,f[2]),(.194,.026,.109),'Rubber',foot)
        boots.ellipsoid((f[0]+.119,f[1]-.012,f[2]),(.038,.034,.052),'TeamAccent',foot,seg=8,rings=4)
        for t in [.38,.57,.76]:
            p=mix(k,f,t)
            boots.block((p[0]+.003,p[1],p[2]+s*.051),(.068,.016,.012),'TeamAccent',sh,angle=.58)
            boots.block((p[0]+.024,p[1]-.009,p[2]+s*.059),(.018,.018,.008),'Alloy',sh)
    # Helmet with a cut-out eye port, rather than a visor sphere on a head sphere.
    cx,cy=.115,1.352
    seg=24 if HIGH else 16;rings=14 if HIGH else 9
    vs=[]
    for j in range(rings+1):
        lat=math.pi*j/rings
        for i in range(seg):
            a=2*math.pi*i/seg
            vs.append((cx+.146*math.sin(lat)*math.cos(a),cy+.163*math.cos(lat),.132*math.sin(lat)*math.sin(a)))
    fs=[]
    for j in range(rings):
        for i in range(seg):
            f=(j*seg+i,j*seg+(i+1)%seg,(j+1)*seg+(i+1)%seg,(j+1)*seg+i)
            mid=tuple(sum(vs[n][k] for n in f)/4 for k in range(3))
            if mid[0]>.19 and 1.307<mid[1]<1.401: continue
            fs.append(f)
    helmet.add(vs,fs,'TeamPaint','Head')
    helmet.ellipsoid((.136,1.349,0),(.115,.135,.107),'Textile','Head',seg=SEG,rings=RINGS)
    # Chin guard has an angular side profile and a dark ventilation inset.
    for s in [-1,1]:
        helmet.panel([(.087,1.262),(.151,1.233),(.296,1.258),(.297,1.295),(.207,1.314)],s*.092,s*.117,'TeamPaint','Head')
        helmet.panel([(.112,1.275),(.164,1.253),(.25,1.269),(.227,1.286)],s*.12,s*.122,'TeamAccent','Head')
        helmet.panel([(.122,1.399),(.15,1.431),(.056,1.449),(-.006,1.364),(.014,1.306),(.046,1.33)],s*.116,s*.127,'TeamAccent','Head')
        helmet.tube([(-.018,1.348,s*.07),(.066,1.348,s*.131),(.2,1.348,s*.108)],[.018,.018,.018],'Textile','Head',seg=6)
    helmet.block((.291,1.276,0),(.024,.038,.174),'Graphite','Head',angle=-.16)
    for z in [-.05,0,.05]: helmet.block((.306,1.276,z),(.006,.025,.018),'Rubber','Head',angle=-.16)
    # Sculpted goggle gasket and smoked single lens.
    visor.ellipsoid((.237,1.351,0),(.037,.057,.113),'Rubber','Head',seg=SEG,rings=8)
    visor.ellipsoid((.257,1.353,0),(.025,.042,.099),'Lens','Head',seg=SEG,rings=8)
    # Long peaked visor, curved across its width.
    fender(visor,[(.057,1.465,.107),(.172,1.469,.14),(.317,1.435,.143),(.367,1.407,.112)],'TeamPaint')
    visor.weights=[{'Head':1} for _ in visor.verts]
    visor.ellipsoid((.108,1.508,0),(.044,.006,.018),'TeamAccent','Head',seg=10,rings=4)
    # Adult proportions: helmet remains readable without an oversized toy head.
    for part in (helmet,visor):
        for i,weights in enumerate(part.weights):
            if weights.get('Head') == 1:
                part.verts[i]=tuple(HEAD[k]+(part.verts[i][k]-HEAD[k])*.88 for k in range(3))
    empty('Rider',(0,0,0),arm)
    for slot,part in [('torso',torso),('gloves',gloves),('pants',pants),('boots',boots),('helmet',helmet),('visor',visor)]:
        emit_variants(slot,part,skin=arm)
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

def studio(render=False):
    scene=bpy.context.scene
    # Preview the same vertex palette in the authored .blend. Add this node only
    # after GLB export: the runtime GLBs use the lean single-material palette.
    for name in ('SlotSurfaceHard','SlotSurfaceCloth','SlotSurfaceWheel'):
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
    for name,loc in [('side',(0,-5,1.2)),('front',(5,-.001,1.1)),('three-quarter',(3,-5,2.5))]:
        cam.location=loc;cam.rotation_euler=(Vector((0,0,.76))-cam.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(ROOT/'docs'/'media'/'redesign'/f'studio-{name}.png')
        if render: bpy.ops.render.render(write_still=True)
    if render:
        # Full-preset reviews expose every option once at the same close camera.
        for variant in ('sprint','trail'):
            for obj in bpy.data.objects:
                if obj.type=='MESH' and obj.name.startswith('Slot_'):
                    obj.hide_render=f'_{variant}' not in obj.name
            scene.render.filepath=str(ROOT/'docs'/'media'/'redesign'/f'studio-{variant}.png')
            bpy.ops.render.render(write_still=True)
        for obj in bpy.data.objects:
            if obj.type=='MESH' and obj.name.startswith('Slot_'):
                obj.hide_render='_core' not in obj.name
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
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
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
    make_bike();specs=make_rider();position_studio_rig()
    quality='high' if HIGH else 'low'
    # Low detail uses planar decimation, keeping silhouettes, skin weights and material borders.
    if not HIGH:
        for o in bpy.context.scene.objects:
            if o.type!='MESH': continue
            modifier=o.modifiers.new('Mobile simplification','DECIMATE');modifier.ratio=.68
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
    limit=24000 if HIGH else 8000
    assert triangles<=limit,(quality,triangles,limit)
    filepath=OUT/f'motocross-{quality}.glb'
    bpy.ops.export_scene.gltf(filepath=str(filepath),export_format='GLB',export_yup=True,export_skins=True,export_animations=False,export_extras=True,export_materials='EXPORT',export_vertex_color='ACTIVE')
    report[quality]={'trianglesSelected':triangles,'trianglesCatalog':all_triangles,'bytes':filepath.stat().st_size,'textures':0,'bones':len(specs),'parts':parts}
    if HIGH:
        (SOURCE/'rig.json').write_text(json.dumps({name:{'head':a,'tail':b,'parent':parent} for name,a,b,parent in specs},indent=2)+'\n')
        for o in bpy.context.scene.objects:
            if o.name.startswith('Slot_') and '_core' not in o.name:
                o.hide_set(True);o.hide_render=True
        studio('--render' in __import__('sys').argv)
        bpy.context.preferences.filepaths.save_version=0
        bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'motocross.blend'))
(SOURCE/'manifest.json').write_text(json.dumps({'generator':'scripts/build-motocross.py','blender':bpy.app.version_string,'coordinateSystem':'+X forward, +Y up, +Z left in game/glTF','slots':SLOTS,'variants':VARIANTS,'assets':report},indent=2)+'\n')
print('MOTOCROSS_ASSETS',json.dumps(report))
