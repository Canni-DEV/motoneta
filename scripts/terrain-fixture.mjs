import { surfaceFixture } from './weather-surface-fixture.mjs';
export async function terrainFixture(page,base) {
  await surfaceFixture(page,base);
  await page.evaluate(async()=>{
    const tracks=await import('/src/core/tracks.ts');
    const f=window.surfaceFixture;
    const make=(piece,surface,x,length,lanes)=>({piece,surface,x,length,lanes,profile:[[0,0],[1,0]],boost:false,terrainShape:{version:1,variant:x*7}});
    const segments=[make('P','grass',260,160,3),make('K','mud',448,56,5),make('M','cool',520,40,4),
      make('U','sand',588,80,12),make('V','gravel',684,72,15)];
    f.race.track={...f.race.track,id:'terrain-review',name:'Terrenos',length:2048,segments:tracks.surfaceAt?segments:segments.slice(0,3)};
    f.race.config.track=f.race.track;
    f.tick=()=>{
      const i=f.frame++; const {world,race,HZ}=f;
      world.capture(race);race.frame=i+1;race.elapsed=i;race.events=[];
      race.riders.forEach((p,n)=>{
        p.x=(n===0?430:335+n*10)+Math.sin(i/80)*8;p.progress=p.x;p.lane=n===0?3:n%4;p.speed=3.25;p.tilt=0;
        p.grounded=true;p.height=0;p.recovery=0;p.turbo=n%2===0;p.previousA=true;p.motion={kind:'track'};
      });
      world.onSimulationStep(race);world.render((i+1)/HZ,race);
    };
    f.contours=()=> {
      const entries=[];
      f.world.course.traverse(object=>{
        if(object.userData.terrainPolygon) entries.push(object.userData.terrainPolygon);
      });
      return JSON.stringify(entries);
    };
    f.resources=()=> {
      const buffers=new Set(),textures=new Set();let bufferBytes=0,textureBytes=0;
      const buffer=attribute=> {
        const data=attribute?.array??attribute?.data?.array;
        if(data&&!buffers.has(data)){buffers.add(data);bufferBytes+=data.byteLength;}
      };
      const texture=map=> {
        if(!map?.isTexture||textures.has(map)||!f.world.renderer.properties.get(map).__webglTexture)return;
        textures.add(map);const data=map.image;
        if(data?.width&&data?.height)textureBytes+=data.width*data.height*4*(map.generateMipmaps?4/3:1);
      };
      f.world.scene.traverse(object=> {
        if(object.geometry) {
          Object.values(object.geometry.attributes).forEach(buffer);buffer(object.geometry.index);
          Object.values(object.geometry.morphAttributes).flat().forEach(buffer);
        }
        buffer(object.instanceMatrix);buffer(object.instanceColor);
        for(const material of Array.isArray(object.material)?object.material:[object.material])if(material) {
          Object.values(material).forEach(texture);
          Object.values(material.uniforms??{}).forEach(uniform=>texture(uniform.value));
        }
        texture(object.shadow?.map?.texture);
      });
      texture(f.world.surfaces.control);
      return {bufferBytes,textureBytes:Math.ceil(textureBytes),estimatedSceneBytes:Math.ceil(bufferBytes+textureBytes),
        note:'Unique scene attribute buffers and uploaded RGBA textures, including mipmaps; excludes composer targets and driver overhead.'};
    };
    f.beginDrive=async()=> {
      const {stepRace}=await import('/src/core/racing.ts'),{Input}=await import('/src/core/types.ts');
      f.race.riders.splice(1);f.race.config.bots=[];
      Object.assign(f.race.riders[0],{x:250,progress:250,lane:0,speed:3.25,heat:95});
      f.world.beginRace(f.race);
      f.drive=()=> {
        const {race,world,HZ}=f,p=race.riders[0];
        world.capture(race);stepRace(race,Input.B|(p.x>335&&p.lane<1.98?Input.DOWN:0));
        world.onSimulationStep(race);world.render(race.frame/HZ,race);
        return {surface:tracks.surfaceAt(race.track,p.x,p.lane)?.surface??'dirt',x:p.x,lane:p.lane,speed:p.speed,heat:p.heat,crashes:p.crashes};
      };
    };
  });
}
