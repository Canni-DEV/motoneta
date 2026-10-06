import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { terrainFixture } from './terrain-fixture.mjs';

const rows=[],output='tmp/terrain/resources',errors=[];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
try {
  for(const [label,base] of [['baseline','http://127.0.0.1:5175'],['candidate','http://127.0.0.1:5173']]) {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on('pageerror',error=>errors.push(label+': '+error.message));
    await terrainFixture(page,base);
    for(const quality of ['high','low'])for(const weather of ['clear','rain','snow']) {
      const snapshots=[];
      for(let repeat=0;repeat<3;repeat++)snapshots.push(await page.evaluate(scenario=> {
        const f=window.surfaceFixture;f.reset(scenario);for(let i=0;i<80;i++)f.tick();
        return {...f.snapshot(),resources:f.resources()};
      },{quality,weather,timeOfDay:'morning'}));
      rows.push({label,quality,weather,snapshots});
      await page.screenshot({path:output+'/'+label+'-'+quality+'-'+weather+'.png'});
    }
    await page.close();
  }
  const comparisons=rows.filter(r=>r.label==='candidate').map(candidate=> {
    const baseline=rows.find(r=>r.label==='baseline'&&r.quality===candidate.quality&&r.weather===candidate.weather);
    const stable=row=>row.snapshots.every(s=>JSON.stringify(s.memory)===JSON.stringify(row.snapshots[0].memory));
    const a=baseline.snapshots[0],b=candidate.snapshots[0];
    return {quality:candidate.quality,weather:candidate.weather,baselineBytes:a.resources.estimatedSceneBytes,candidateBytes:b.resources.estimatedSceneBytes,
      changePercent:(b.resources.estimatedSceneBytes/a.resources.estimatedSceneBytes-1)*100,
      baselineMemory:a.memory,candidateMemory:b.memory,baselineDraw:a.draw,candidateDraw:b.draw,
      stable:stable(baseline)&&stable(candidate)};
  });
  await writeFile(output+'/comparison.json',JSON.stringify({method:'Same staged scene; candidate adds sand/gravel. Attribute and uploaded texture byte estimates exclude unchanged composer targets and driver overhead.',errors,comparisons,rows},null,2)+'\n');
  console.log(JSON.stringify(comparisons,null,2));
  if(errors.length||comparisons.some(r=>!r.stable||r.changePercent>10))throw new Error('Resource check failed: '+errors.join('; '));
} finally {await browser.close();}
