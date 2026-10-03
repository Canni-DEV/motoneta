import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const root='assets/motoneta/review/essential';
const baseline=`${root}/baseline`;
await mkdir(baseline,{recursive:true});
const commit=execFileSync('git',['rev-parse',process.argv[2]??'HEAD'],{encoding:'utf8',windowsHide:true}).trim();
for(const name of ['bike-model.ts','renderer.ts']) {
  let content=execFileSync('git',['show',`${commit}:src/${name}`],{encoding:'utf8',windowsHide:true});
  content=content.replaceAll("from './", "from '/src/");
  if(name==='renderer.ts') content=content.replace("from '/src/bike-model'", "from './bike-model'");
  if(name==='bike-model.ts') content=content.replace('models/motocross-${quality}.glb', `${baseline}/motocross-\${quality}.glb`);
  await writeFile(`${baseline}/${name}`,content);
}
for(const quality of ['low','high']) await writeFile(`${baseline}/motocross-${quality}.glb`,execFileSync('git',['show',`${commit}:public/models/motocross-${quality}.glb`],{windowsHide:true,maxBuffer:10*1024*1024}));
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const origin=process.env.REVIEW_ORIGIN??'http://127.0.0.1:5173';
const runs=[];
for(const kind of ['baseline','candidate']) for(let run=1;run<=3;run++) {
  const rows=[];
  for(const viewport of [{width:1440,height:900},{width:844,height:390}]) {
    const page=await browser.newPage({viewport});
    await page.route(`${origin}/`,route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>'}));
    await page.goto(origin);
    const row=await page.evaluate(async({kind,baseline})=>{
      const source=path=>import(/* @vite-ignore */ path);
      const [{World},models,{loadCrowdAssets},{defaultSettings},{createRace},{makeBots},{BUILTINS},{defaultAppearance}]=await Promise.all([
        source(kind==='baseline'?`/${baseline}/renderer.ts`:'/src/renderer.ts'),
        source(kind==='baseline'?`/${baseline}/bike-model.ts`:'/src/bike-model.ts'),source('/src/crowd-assets.ts'),source('/src/core/types.ts'),source('/src/core/racing.ts'),source('/src/core/game.ts'),source('/src/core/maps.ts'),source('/src/appearance.ts'),
      ]);
      const assets=kind==='baseline'?await models.loadBikeAssets():await models.loadVehicleAssets();
      const world=new World(document.querySelector('canvas'),{...defaultSettings,quality:'low',vfx:{race:false,tracks:false,ambient:false,intensity:'balanced'}},assets,await loadCrowdAssets());
      const appearance=defaultAppearance();appearance.vehicle=kind==='baseline'?'motocross':'motoneta';
      const race=createRace({...BUILTINS[0],mode:'quick',player:{id:'one',name:'Piloto',color:'#e05a3b',appearance},bots:makeBots(5),difficulty:'hard',seed:1984});
      race.riders.forEach((r,i)=>{r.x=800+i*12;r.lane=i%4;r.speed=3;});
      race.riders.push(...race.riders.slice(1).map(r=>({...structuredClone(r)})));
      world.appearances=Array.from({length:11},()=>structuredClone(appearance));
      world.ensureBikes(11);world.setTrack(race.track);world.mode='race';world.ghostStart=6;
      let clock=0;
      const render=()=>{world.render(clock+=1/60,race,false);world.renderer.getContext().finish();};
      const values=[];
      for(const quality of ['low','high']) {
        world.settings.quality=quality;world.applySettings();
        for(let i=0;i<40;i++)render();
        const samples=[];
        for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const start=performance.now();render();samples.push(performance.now()-start);}
        samples.sort((a,b)=>a-b);
        values.push({quality,scenario:'six-riders-five-ghosts',p95Ms:samples[18],medianMs:samples[10],drawCalls:world.renderer.info.render.calls});
      }
      // Track resets also reset camera focus. Warm the newly visible stadium geometry first.
      for(let i=0;i<3;i++){world.setTrack(structuredClone(race.track));render();}
      const memory={...world.renderer.info.memory};
      for(let i=0;i<20;i++){world.setTrack(structuredClone(race.track));render();}
      const after={...world.renderer.info.memory};
      const result={values,memory,after,renderer:world.renderer.getContext().getParameter(world.renderer.getContext().RENDERER)};
      world.dispose();return result;
    },{kind,baseline});
    rows.push({viewport,...row});await page.close();
  }
  const directory=`${root}/performance/${kind}`;await mkdir(directory,{recursive:true});await writeFile(`${directory}/run-${run}.json`,JSON.stringify(rows,null,2)+'\n');
  runs.push({kind,run,rows});console.log(`${kind}: run ${run}/3`);
}
await browser.close();
const median=numbers=>numbers.toSorted((a,b)=>a-b)[1];
const samples=[];
for(let v=0;v<2;v++)for(const quality of ['low','high']) {
  const values=kind=>runs.filter(r=>r.kind===kind).map(r=>r.rows[v].values.find(s=>s.quality===quality).p95Ms);
  const before=values('baseline'),after=values('candidate');
  const baselineP95Ms=median(before),candidateP95Ms=median(after),changePercent=(candidateP95Ms/baselineP95Ms-1)*100,limitPercent=quality==='low'?10:20;
  samples.push({viewport:runs[0].rows[v].viewport,quality,baselineP95Ms,candidateP95Ms,baselineRunsP95Ms:before,candidateRunsP95Ms:after,changePercent,limitPercent,passes:changePercent<=limitPercent});
}
const stableResources=runs.every(r=>r.rows.every(row=>JSON.stringify(row.memory)===JSON.stringify(row.after)));
const report={reviewStage:'classic-approved-variants',baselineCommit:commit,method:'Same Chromium/SwiftShader software renderer; old visual runtime and GLBs from baseline commit, candidate uses the approved scooter with its full catalog. Six riders and five ghosts, desktop and mobile landscape viewports; three sequential runs per version, 40 warm frames and 20 gl.finish samples per quality; median of run p95 values. Resource counts are compared over 20 track resets after 3 warm resets settle camera visibility. Mobile is emulated. This is not a physical-device GPU benchmark.',stableResources,samples};
await writeFile('assets/motoneta/performance-comparison.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stableResources,samples},null,2));
if(!stableResources||samples.some(s=>!s.passes))process.exitCode=1;
