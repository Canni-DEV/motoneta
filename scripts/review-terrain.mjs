import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { terrainFixture } from './terrain-fixture.mjs';
const output='tmp/terrain/review', errors=[], rows=[];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11']});
try {
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await terrainFixture(page,'http://127.0.0.1:5173');
  for(const size of ['desktop','mobile']) for(const quality of ['high','low'])
    for(const timeOfDay of ['morning','afternoon','night']) for(const weather of ['clear','rain','snow']) {
      await page.setViewportSize(size==='desktop'?{width:1440,height:900}:{width:844,height:390});
      const snapshot=await page.evaluate(scenario=>{
        const f=window.surfaceFixture;f.reset(scenario);for(let i=0;i<80;i++)f.tick();
        return {...f.snapshot(),resources:f.resources(),contours:f.contours()};
      },{quality,timeOfDay,weather});
      const id=[size,quality,timeOfDay,weather].join('-');
      await page.screenshot({path:output+'/'+id+'.png'});
      if(id==='desktop-high-morning-clear')await page.screenshot({path:output+'/terrain-modifiers.png',clip:{x:0,y:350,width:1440,height:300}});
      rows.push({id,...snapshot});console.log(id);
    }
  const detail=await page.evaluate(()=>{
    const f=window.surfaceFixture, hashes=[];
    for(const surfaceDetail of ['detailed','light','detailed']) {
      f.world.settings.surfaceDetail=surfaceDetail;f.world.applySettings();f.tick();hashes.push(f.contours());
    }
    return {stable:hashes.every(h=>h===hashes[0])};
  });
  for(const quality of ['high','low'])for(const weather of ['clear','snow']) {
    await page.setViewportSize({width:1440,height:900});
    const snapshot=await page.evaluate(scenario=> {
      const f=window.surfaceFixture;f.world.settings.vfx={race:false,tracks:false,ambient:false,intensity:'balanced'};
      f.reset(scenario);for(let i=0;i<80;i++)f.tick();return {...f.snapshot(),resources:f.resources(),contours:f.contours()};
    },{quality,weather,timeOfDay:'morning'});
    const id='effects-off-'+quality+'-'+weather;await page.screenshot({path:output+'/'+id+'.png'});rows.push({id,...snapshot});
  }
  await page.evaluate(async()=>{const f=window.surfaceFixture;f.reset({quality:'high',weather:'clear',timeOfDay:'morning'});f.world.settings.vfx={race:true,tracks:true,ambient:true,intensity:'balanced'};f.world.applySettings();await f.beginDrive();});
  const drive=[];
  for(const material of ['grass','mud','cool','sand','gravel']) {
    const state=await page.evaluate(async material=> {
      const f=window.surfaceFixture;
      for(let i=0;i<1000;i++) {
        const state=f.drive();if(state.surface===material)return state;
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      throw new Error('Drive did not reach '+material);
    },material);
    const id='drive-'+material;await page.screenshot({path:output+'/'+id+'.png'});rows.push({id,...state});drive.push(state);
  }
  if(drive.some(s=>s.crashes)||drive.find(s=>s.surface==='cool').heat!==0)throw new Error(JSON.stringify(drive));
  await writeFile(output+'/review.json',JSON.stringify({errors,detail,drive,rows},null,2)+'\n');
  await writeFile(output+'/index.html','<!doctype html><meta charset="utf-8"><title>Revisión de terrenos</title><style>body{background:#17231d;color:#ebe9d8;font:16px system-ui;margin:24px}img{width:100%;max-width:1440px}figure{margin:24px 0}figcaption{margin:8px 0}</style><h1>Barro, césped, aspersores, arena y grava</h1>'+rows.map(r=>'<figure><figcaption>'+r.id+'</figcaption><img loading="lazy" src="'+r.id+'.png"></figure>').join(''));
  if(errors.length||!detail.stable)throw new Error(JSON.stringify({errors,detail}));
} finally {await browser.close();}
