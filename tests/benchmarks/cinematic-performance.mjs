import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
// Run from the repository root while `npm run dev -- --port 5173` is running.
// The relevant initial sources are recovered from Git; shared core/assets are unchanged.
const baselineRef=process.env.CINEMATIC_BASELINE??'cdc2cfed2ab65a5f59d18eaf5bcab8fbcc6a8143';
await mkdir('tmp/cinematic-baseline',{recursive:true});
for(const name of ['renderer.ts','bike-model.ts','cinematic-camera.ts','stadium.ts']) {
  const source=execFileSync('git',['show',`${baselineRef}:src/${name}`],{encoding:'utf8'});
  await writeFile(`tmp/cinematic-baseline/${name}`,source.replaceAll("from './","from '../../src/"));
}
const browser = await chromium.launch({headless:true,args:['--enable-webgl','--enable-gpu','--use-angle=d3d11']});
const pages = {};
for (const version of ['baseline','candidate']) {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.route('http://127.0.0.1:5173/',route=>route.fulfill({contentType:'text/html',
    headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},
    body:'<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>'}));
  if(version==='baseline') for(const name of ['renderer.ts','bike-model.ts','cinematic-camera.ts','stadium.ts'])
    await page.route(`**/src/${name}*`, async route=>{
      const response=await route.fetch({url:`http://127.0.0.1:5173/tmp/cinematic-baseline/${name}`});
      await route.fulfill({response});
    });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async()=>{
    const source=p=>import(p);
    const [{World},{loadBikeAssets},{loadCrowdAssets},{defaultSettings,HZ},{testRace},{CinematicCamera},{heightAt}]=await Promise.all([
      source('/src/renderer.ts'),source('/src/bike-model.ts'),source('/src/crowd-assets.ts'),source('/src/core/types.ts'),source('/tests/race-fixture.ts'),source('/src/cinematic-camera.ts'),source('/src/core/tracks.ts')]);
    const race=testRace(undefined,5);race.phase='racing';race.countdown=0;race.frame=181;
    race.riders.forEach((p,i)=>Object.assign(p,{x:800+i*20,lane:i%4,speed:3,height:heightAt(race.track,800+i*20,i%4)}));
    const settings={...structuredClone(defaultSettings),quality:'low',bloom:false,cameraShake:false};
    const world=new World(document.querySelector('canvas'),settings,await loadBikeAssets(),await loadCrowdAssets());
    world.setTrack(race.track);world.mode='race';world.beginRace(race);
    let time=0;
    const gl=world.renderer.getContext(), debug=gl.getExtension('WEBGL_debug_renderer_info');
    const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const draw=()=>{
      if(world.cinematic && !world.cinematic.setMode) world.cinematic.cutAt=world.cinematic.elapsed;
      world.render(time+=1/60,race,false,1);
    };
    window.cameraBenchmark={
      measure(mode,quality,weather){
        settings.quality=quality;world.applySettings();world.setWeather(weather);world.setTimeOfDay(weather==='clear'?'morning':'night');
        world.cinematic=mode==='normal'?null:new CinematicCamera({events:[],moments:[],poses:[],lapEnds:[10000],lastFrame:10000,slowMotion:[]});
        if(world.cinematic){
          if(world.cinematic.setMode)world.cinematic.setMode(mode);
          else {
            world.cinematic.shot=mode==='firstPerson'?'helmet':mode;
            const ahead=800*.052+Math.max(8,Math.min(24,3*.052*HZ*1.8));
            world.cinematic.anchor.set(ahead,heightAt(race.track,ahead/.052,3)*.052+(mode==='tripod'?2.3:4.4),mode==='tripod'?4.9:8.5);
          }
        }
        for(let n=0;n<100;n++){draw();gl.finish();}
        const cpu=[],frames=[];
        for(let n=0;n<240;n++){const start=performance.now();draw();cpu.push(performance.now()-start);gl.finish();frames.push(performance.now()-start);}
        cpu.sort((a,b)=>a-b);frames.sort((a,b)=>a-b);
        const camera=world.cinematic?.camera??world.camera;
        return {mode,quality,weather,p95CpuMs:cpu[227],medianCpuMs:cpu[120],p95RenderMs:frames[227],calls:world.renderer.info.render.calls,
          shot:world.cinematic?.currentShot,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,
          memory:{...world.renderer.info.memory},renderer,isolated:crossOriginIsolated};
      },
      stable(){
        const samples=[];
        for(let round=0;round<10;round++){
          world.setTrack(race.track);
          for(const mode of ['firstPerson','chase','drone','tripod','crowd']){
            if(world.cinematic?.setMode)world.cinematic.setMode(mode);draw();gl.finish();
          }
          samples.push({...world.renderer.info.memory});
        }
        return samples;
      }
    };
  });
  pages[version]=page;
}
const samples=[];
for(let run=0;run<3;run++) for(const quality of ['low','high']) for(const weather of ['clear','rain'])
  for(const mode of ['normal','chase','front','ground','drone','mounted','tripod','crowd','firstPerson']) {
    for(const version of run%2?['candidate','baseline']:['baseline','candidate'])
      samples.push({run,version,...await pages[version].evaluate(args=>window.cameraBenchmark.measure(...args),[mode,quality,weather])});
    console.log(`run ${run+1}: ${quality} ${weather} ${mode}`);
  }
const median=values=>values.sort((a,b)=>a-b)[1];
const comparisons=[];
for(const candidate of samples.filter(s=>s.version==='candidate'&&s.run===0)){
  const group=version=>samples.filter(s=>s.version===version&&s.mode===candidate.mode&&s.quality===candidate.quality&&s.weather===candidate.weather);
  const baseline=median(group('baseline').map(s=>s.p95CpuMs)), current=median(group('candidate').map(s=>s.p95CpuMs));
  const baselineMedian=median(group('baseline').map(s=>s.medianCpuMs)), currentMedian=median(group('candidate').map(s=>s.medianCpuMs));
  comparisons.push({mode:candidate.mode,quality:candidate.quality,weather:candidate.weather,baselineP95CpuMs:baseline,candidateP95CpuMs:current,changePercent:100*(current/baseline-1),
    baselineMedianCpuMs:baselineMedian,candidateMedianCpuMs:currentMedian,medianChangePercent:100*(currentMedian/baselineMedian-1)});
}
const resources=await pages.candidate.evaluate(()=>window.cameraBenchmark.stable());
const report={baselineRef,measuredAt:new Date().toISOString(),method:'Same cross-origin-isolated Playwright Chromium pages (approximately 5 microsecond timer resolution), RTX 5070 Ti with ANGLE/D3D11, 1440x900, six riders, same frozen simulation state and assets; three runs alternating baseline/candidate order, 100 warm frames and 240 samples per view and quality/weather. Fixed anchors, camera poses and FOVs are aligned for existing views. CPU render submission and render+gl.finish are recorded separately. Comparisons use the median p95 of three runs. Baseline existing shots are held for comparable sampling; helmet is only the reference for the new first-person view, whose eye transform, body visibility and framing differ.',samples,comparisons,resources,stableResources:resources.slice(2).every(s=>JSON.stringify(s)===JSON.stringify(resources[1]))};
await mkdir('tests/benchmarks',{recursive:true});
await writeFile('tests/benchmarks/cinematic-performance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({stableResources:report.stableResources,worstExisting:Math.max(...comparisons.filter(s=>s.mode!=='firstPerson').map(s=>s.changePercent)),firstPerson:comparisons.filter(s=>s.mode==='firstPerson')}));
await browser.close();
