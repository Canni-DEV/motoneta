import { expect, test, type Page } from '@playwright/test';
import { nav, ready, runtimeModuleUrl } from './ui-helpers';
import { mkdir } from 'node:fs/promises';

async function setupStore(page: Page) {
  return runtimeModuleUrl(page, '/src/persistence.ts');
}
test('preset entry, resumable progress, profile isolation and replacing an attempt', async ({page}) => {
  await ready(page);
  await page.locator('.home-modes [data-value="tournament"]').click();
  await expect(page.getByRole('button',{name:'Torneo personalizado',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Torneo Motoneta',exact:true}).click();
  await expect(page.locator('.preset-calendar li')).toHaveCount(5);
  await expect(page.locator('.preset-calendar')).toContainText('Noche · Lluvia');
  await page.getByRole('button',{name:'Comenzar torneo',exact:true}).click();
  await expect(page.locator('.session-page')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Torneo Motoneta',exact:true})).toBeVisible();
  const first = await page.evaluate(() => (window as any).__motoneta.session);
  expect(first).toMatchObject({presetId:'motoneta',difficulty:'hard',seed:1984,phase:'ready'});
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button',{name:/Continuar Torneo Motoneta/}).click();
  expect(await page.evaluate(() => (window as any).__motoneta.session.id)).toBe(first.id);
  await page.locator('.topbar [data-action="home"]').click();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();
  await page.getByRole('button',{name:'Añadir perfil',exact:true}).click();
  await page.getByRole('button',{name:'Usar perfil',exact:true}).click();
  await page.getByRole('button',{name:'Listo',exact:true}).click();
  await expect(page.getByRole('button',{name:/Continuar Torneo Motoneta/})).toHaveCount(0);
  await page.locator('.home-modes [data-value="tournament"]').click();
  await page.getByRole('button',{name:'Torneo Motoneta',exact:true}).click();
  await page.getByRole('button',{name:'Comenzar torneo',exact:true}).click();
  await expect(page.locator('.session-page')).toBeVisible();
  const second = await page.evaluate(() => (window as any).__motoneta.session);
  expect(second.players[0].id).not.toBe(first.players[0].id);
  await page.locator('.topbar [data-action="home"]').click();
  await page.locator('.home-modes [data-value="tournament"]').click();
  await page.getByRole('button',{name:'Torneo Motoneta',exact:true}).click();
  await page.getByRole('button',{name:'Empezar nuevo',exact:true}).click();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continuar Torneo Motoneta',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Empezar nuevo',exact:true}).click();
  await page.getByRole('button',{name:'Reemplazar intento',exact:true}).click();
  await expect(page.locator('.session-page')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.session.id)).not.toBe(second.id);
});

test('fifth result and reward commit atomically, tied wins and duplicates survive reload', async ({page}) => {
  await ready(page);
  const module = await setupStore(page);
  const result = await page.evaluate(async (module) => {
    const source = (p:string) => import(/* @vite-ignore */ p);
    const [{GameStore},{motonetaTournament},{sessionConfig,advanceSession},{newRecording},{localProfile},{defaultAppearance}] = await Promise.all([
      source(module),source('/src/core/motoneta-tournament.ts'),source('/src/core/competition.ts'),source('/src/core/recording.ts'),source('/src/core/game.ts'),source('/src/appearance.ts'),
    ]);
    const store = new GameStore(); await store.open();
    const owner = store.state.profiles[0];
    await store.update((s:any) => { s.profiles.push(localProfile({id:'other',name:'Otro',color:'#123abc',appearance:defaultAppearance()})); s.activeProfile='other'; s.motonetaSessions[owner.id]=motonetaTournament(owner); });
    const run = (session:any,tie=true) => {
      const c=sessionConfig(session),r=newRecording(c);
      r.result={config:c,limitTicks:10000,finishes:[c.player,...c.bots].map((p:any,i:number)=>({id:p.id,ticks:i===1&&tie?100:100+i*100,laps:[50+i*50,100+i*100],crashes:0}))};
      return r;
    };
    for(let i=0;i<4;i++) { const s=store.state.motonetaSessions[owner.id]; await store.commit(run(s),s); await store.update((state:any)=>{state.motonetaSessions[owner.id]=advanceSession(state.motonetaSessions[owner.id]);}); }
    const last=store.state.motonetaSessions[owner.id],recording=run(last);
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:any[]){if(this.name==='replays')throw new DOMException('Full','QuotaExceededError');return put.apply(this,args as any);};
    let rejected=false; try{await store.commit(recording,last);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
    const disk=new GameStore();await disk.open();
    const rollback=!store.state.profiles[0].unlockedMotoneta&&!disk.state.profiles[0].unlockedMotoneta&&disk.state.motonetaSessions[owner.id].results.length===4;
    await store.commit(recording,last);
    const snapshot=JSON.stringify(await store.backup());
    await store.commit({...recording,result:{...recording.result,finishes:[]}},last);
    const duplicate=JSON.stringify(await store.backup())===snapshot;
    await disk.open();
    const won=disk.state.motonetaSessions[owner.id];
    const player=disk.state.profiles[0];
    const other=disk.state.profiles[1];
    await disk.update((s:any)=>{s.activeProfile=owner.id;});
    return {rejected,rollback,duplicate,phase:won.phase,reward:won.reward,count:won.results.length,unlocked:player.unlockedMotoneta,vehicle:player.garage.vehicle,otherUnlocked:other.unlockedMotoneta};
  }, module);
  expect(result).toEqual({rejected:true,rollback:true,duplicate:true,phase:'complete',reward:'unlocked',count:5,unlocked:true,vehicle:'motocross',otherUnlocked:false});
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();
  await page.locator('[data-action="garage-open"]').click();
  await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await expect(page.locator('[data-action="garage-save"]')).toBeEnabled();
});

test('only the preset grants the reward, losses and replacement preserve it, and deleting a profile removes its attempt', async ({page}) => {
  await ready(page);
  const module=await setupStore(page);
  const outcomes=await page.evaluate(async(module) => {
    const source=(p:string) => import(/* @vite-ignore */ p);
    const [{GameStore},{motonetaTournament},{advanceSession,sessionConfig},{newRecording},{localProfile},{defaultAppearance}]=await Promise.all([
      source(module),source('/src/core/motoneta-tournament.ts'),source('/src/core/competition.ts'),source('/src/core/recording.ts'),source('/src/core/game.ts'),source('/src/appearance.ts'),
    ]);
    const store=new GameStore();await store.open();const owner=store.state.profiles[0];
    const recording=(session:any,won:boolean,abandoned=false) => {
      const config=sessionConfig(session),r=newRecording(config);
      r.result={config,limitTicks:10000,finishes:[config.player,...config.bots].map((p:any,i:number) => ({id:p.id,ticks:i===0&&abandoned?null:i===0&&!won?500:100+i*100,laps:i===0&&abandoned?[]:[50+i*50,100+i*100],crashes:0}))};return r;
    };
    const play=async(preset:boolean,won:boolean,abandoned=false) => {
      const fresh=motonetaTournament(owner);if(!preset)delete fresh.presetId;
      await store.update((s:any) => {if(preset)s.motonetaSessions[owner.id]=fresh;else s.sessions.tournament=fresh;});
      for(let i=0;i<5;i++) {
        const session=preset?store.state.motonetaSessions[owner.id]:store.state.sessions.tournament;
        await store.commit(recording(session,won,abandoned),session);
        await store.update((s:any) => {if(preset)s.motonetaSessions[owner.id]=advanceSession(s.motonetaSessions[owner.id]);else s.sessions.tournament=advanceSession(s.sessions.tournament);});
      }
      return {reward:store.state.motonetaSessions[owner.id]?.reward,unlocked:store.state.profiles[0].unlockedMotoneta};
    };
    const imported=recording(motonetaTournament(owner),true);
    await store.commit(imported);const replayUnlock=store.state.profiles[0].unlockedMotoneta;
    const custom=await play(false,true);
    const abandoned=await play(true,false,true);
    const won=await play(true,true);
    const repeated=await play(true,true);
    const lost=await play(true,false);
    await store.update((s:any) => {s.motonetaSessions[owner.id]=motonetaTournament(s.profiles[0]);s.profiles.push(localProfile({id:'retained',name:'Conservar',color:'#123abc',appearance:defaultAppearance()}));});
    const replacement=store.state.profiles[0].unlockedMotoneta;
    return {replayUnlock,custom:custom.unlocked,abandoned,won,repeated,lost,replacement};
  },module);
  expect(outcomes).toEqual({replayUnlock:false,custom:false,abandoned:{reward:'not-earned',unlocked:false},won:{reward:'unlocked',unlocked:true},repeated:{reward:'already-unlocked',unlocked:true},lost:{reward:'not-earned',unlocked:true},replacement:true});
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();
  await page.locator('[data-action="garage-open"]').click();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();
  await page.locator('[data-action="delete-profile"]').click();
  await page.getByRole('button',{name:'Eliminar',exact:true}).click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__motoneta.profiles.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__motoneta.profiles[0].id)).toBe('retained');
  const remaining=await page.evaluate(async(module)=>{const {GameStore}=await import(/* @vite-ignore */ module);const store=new GameStore();await store.open();return store.state.motonetaSessions;},module);
  expect(remaining).toEqual({});
  await page.getByRole('button',{name:'Listo',exact:true}).click();
  await expect(page.locator('.home-modes')).toBeVisible();
});

test('deleting the owner closes the active preset instead of leaving an orphaned attempt on screen',async({page})=>{
  await ready(page);const module=await setupStore(page);
  await page.evaluate(async(module)=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const [{GameStore},{motonetaTournament},{localProfile},{defaultAppearance}]=await Promise.all([source(module),source('/src/core/motoneta-tournament.ts'),source('/src/core/game.ts'),source('/src/appearance.ts')]);
    const store=new GameStore();await store.open();await store.update((s:any)=>{s.profiles.push(localProfile({id:'retained',name:'Conservar',color:'#123abc',appearance:defaultAppearance()}));s.motonetaSessions[s.activeProfile]=motonetaTournament(s.profiles[0]);});
  },module);
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  await page.locator('[data-action="resume-session"][data-value="motoneta"]').click();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();await page.locator('[data-action="delete-profile"]').click();await page.getByRole('button',{name:'Eliminar',exact:true}).click();
  await page.getByRole('button',{name:'Listo',exact:true}).click();await expect(page.locator('.home-modes')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__motoneta.session)).toBeNull();
});

test('reads older format-3 profile data without losing customization, maps, sessions, records or replay inputs', async({page}) => {
  await ready(page);const module=await setupStore(page);
  const result=await page.evaluate(async(module)=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const [{GameStore},{motonetaTournament},{emptyDesign,mapCourse},{raceProfile},{createRace,stepRace,raceResult},{newRecording,appendInput}]=await Promise.all([
      source(module),source('/src/core/motoneta-tournament.ts'),source('/src/core/maps.ts'),source('/src/core/game.ts'),source('/src/core/racing.ts'),source('/src/core/recording.ts'),
    ]);
    const store=new GameStore();await store.open();const owner=store.state.profiles[0];
    const map={...emptyDesign(),name:'Anterior',length:640,laps:1};
    const config={...mapCourse(map),mode:'quick',player:raceProfile(owner),bots:[],difficulty:'normal',seed:1984};
    const race=createRace(config),replay=newRecording(config);
    while(race.phase!=='finished'){stepRace(race,1);appendInput(replay,1);}replay.result=raceResult(race);
    await store.commit(replay);
    const legacy=structuredClone(store.state);legacy.maps=[map];legacy.profiles[0].appearance.parts.fairing='trail';
    delete legacy.profiles[0].garage;delete legacy.profiles[0].unlockedMotoneta;delete legacy.profiles[0].unlockedTanque;delete legacy.profiles[0].appearance.vehicle;delete legacy.motonetaSessions;delete legacy.tanqueSessions;
    const session=motonetaTournament(owner);delete session.presetId;legacy.sessions.tournament=session;
    const records=JSON.stringify(legacy.records),sessions=JSON.stringify(legacy.sessions),maps=JSON.stringify(legacy.maps);
    const replayId=legacy.records[0].replayId;
    delete replay.config.player.appearance.vehicle;delete replay.result.config.player.appearance.vehicle;
    const {DATABASE_NAME}=await source('/src/identity.ts');
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(DATABASE_NAME,4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['data','replays'],'readwrite');tx.objectStore('data').put(legacy,'state');tx.objectStore('replays').put(replay,replayId);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
    await store.open();const loaded=await store.replay(replayId);const backup=await store.backup();
    return {parts:store.state.profiles[0].garage.bikes.motocross.parts.fairing,vehicle:store.state.profiles[0].garage.vehicle,unlocked:store.state.profiles[0].unlockedMotoneta,sessions:JSON.stringify(store.state.sessions)===sessions,records:JSON.stringify(store.state.records)===records,maps:JSON.stringify(store.state.maps)===maps,inputs:JSON.stringify(loaded.inputs)===JSON.stringify(replay.inputs),replayVehicle:loaded.config.player.appearance.vehicle,backupNewData:!!backup.state.profiles[0].garage&&!!backup.state.motonetaSessions&&!!backup.state.tanqueSessions};
  },module);
  expect(result).toEqual({parts:'trail',vehicle:'motocross',unlocked:false,sessions:true,records:true,maps:true,inputs:true,replayVehicle:'motocross',backupNewData:true});
});

test('cancel discards edits and restoring the visible vehicle preserves the other configuration and unlock', async({page})=>{
  await ready(page);const module=await setupStore(page);
  await page.evaluate(async(module)=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const [{GameStore},{garageAppearance}]=await Promise.all([source(module),source('/src/appearance.ts')]);
    const store=new GameStore();await store.open();await store.update((s:any)=>{
      const p=s.profiles[0];p.unlockedMotoneta=true;p.garage.bikes.motocross.parts.fairing='sprint';p.garage.bikes.motocross.paints.fairing.primary='#12abcd';p.garage.bikes.motoneta.parts.fairing='trail';p.garage.rider.parts.helmet='trail';p.appearance=garageAppearance(p.garage);
    });
  },module);
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  const before=await page.evaluate(()=>JSON.stringify((window as any).__motoneta.profiles[0]));
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();await page.locator('[data-action="garage-open"]').click();
  await page.locator('[data-garage-color="primary"]').fill('#ff0000');
  await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await page.locator('[data-action="garage-reset-all"]').click();await page.locator('[data-action="garage-cancel"]').click();
  await expect(page.locator('#garage-stage')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify((window as any).__motoneta.profiles[0]))).toBe(before);
  await page.locator('[data-action="garage-open"]').click();await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await page.locator('[data-action="garage-reset-all"]').click();await page.locator('[data-action="garage-save"]').click();
  await expect(page.locator('#garage-stage')).toHaveCount(0);
  const after=await page.evaluate(()=>(window as any).__motoneta.profiles[0]);
  expect(after.unlockedMotoneta).toBe(true);expect(after.garage.vehicle).toBe('motoneta');expect(after.garage.bikes.motocross.parts.fairing).toBe('sprint');expect(after.garage.bikes.motocross.paints.fairing.primary).toBe('#12abcd');expect(after.garage.bikes.motoneta.parts.fairing).toBe('core');expect(after.garage.rider.parts.helmet).toBe('core');
});

test('uses the equipped vehicle in both tournaments, versus and editor while older replays keep theirs',async({page})=>{
  test.setTimeout(90000);await ready(page);const module=await setupStore(page);
  const originalReplay=await page.evaluate(async(module)=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const [{GameStore},{motonetaTournament},{localProfile,raceProfile},{defaultAppearance,garageAppearance},{newRecording},{sessionConfig,advanceSession},{emptyDesign,mapCourse}]=await Promise.all([
      source(module),source('/src/core/motoneta-tournament.ts'),source('/src/core/game.ts'),source('/src/appearance.ts'),source('/src/core/recording.ts'),source('/src/core/competition.ts'),source('/src/core/maps.ts'),
    ]);
    const store=new GameStore();await store.open();const owner=store.state.profiles[0];
    await store.update((s:any)=>{s.motonetaSessions[owner.id]=motonetaTournament(owner);});
    const preset=store.state.motonetaSessions[owner.id],config=sessionConfig(preset),replay=newRecording(config);
    replay.termination='abandoned';replay.result={config,limitTicks:10000,finishes:[config.player,...config.bots].map((p:any,i:number)=>({id:p.id,ticks:i?100+i*100:null,laps:i?[50,100+i*100]:[],crashes:0}))};
    await store.commit(replay,preset);
    const id=store.state.motonetaSessions[owner.id].results[0].replayId;
    await store.update((s:any)=>{
      s.motonetaSessions[owner.id]=advanceSession(s.motonetaSessions[owner.id]);
      const maps=[1,2,3].map(i=>mapCourse({...emptyDesign(),name:`Corto ${i}`,length:640,laps:1}));
      const custom=motonetaTournament(owner);delete custom.presetId;custom.courses=maps;custom.bots=[];s.sessions.tournament=custom;
      const second=localProfile({id:'second',name:'Segundo',color:'#123abc',appearance:defaultAppearance()});s.profiles.push(second);
      s.sessions.versus={...structuredClone(custom),id:'versus-fixture',mode:'versus',players:[raceProfile(owner),raceProfile(second)],courses:maps.slice(0,2)};
      s.profiles[0].unlockedMotoneta=true;s.profiles[0].garage.vehicle='motoneta';s.profiles[0].appearance=garageAppearance(s.profiles[0].garage);
    });return id;
  },module);
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  const leave=async()=>{
    await page.keyboard.press('Escape');await page.locator('[data-action="leave-race"]').click();await page.locator('[data-action="confirm-abandon"]').click();
    await expect(page.getByRole('heading',{name:'Resultado',exact:true})).toBeVisible();await page.locator('[data-action="leave-race"]').click();
    await page.locator('.topbar [data-action="home"]').click();
  };
  for(const mode of ['motoneta','tournament','versus']) {
    await page.locator(`[data-action="resume-session"][data-value="${mode}"]`).click();await page.locator('[data-action="begin-turn"]').click();
    await expect(page.locator('.race-identity')).toBeVisible();
    const state=await page.evaluate(()=>(window as any).__motoneta);
    expect(state.race.config.player.appearance.vehicle).toBe('motoneta');expect(state.vehicles[0]).toBe('motoneta');
    if(mode==='motoneta')expect(state.vehicles.slice(1,4)).toEqual(['motocross','motocross','motocross']);
    await leave();
  }
  const prior=await page.evaluate(async({module,id})=>{const {GameStore}=await import(/* @vite-ignore */ module);const store=new GameStore();await store.open();return (await store.replay(id)).config.player.appearance.vehicle;},{module,id:originalReplay});
  expect(prior).toBe('motocross');
  await nav(page,'editor');await page.getByRole('button',{name:'Probar pista',exact:true}).click();
  await expect(page.locator('.race-identity')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__motoneta.race.config.player.appearance.vehicle)).toBe('motoneta');
});

test('shares the personal record while a ghost and replay retain their original vehicle',async({page})=>{
  await ready(page);const module=await setupStore(page);
  await page.evaluate(async(module)=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const [{GameStore},{raceProfile},{garageAppearance},{emptyDesign,mapCourse,validateMap},{quickRaceConfig},{createRace,stepRace,raceResult},{newRecording,appendInput}]=await Promise.all([
      source(module),source('/src/core/game.ts'),source('/src/appearance.ts'),source('/src/core/maps.ts'),source('/src/core/personal-ghost.ts'),source('/src/core/racing.ts'),source('/src/core/recording.ts'),
    ]);
    const store=new GameStore();await store.open();const map=validateMap({...emptyDesign(),name:'Fantasma Moto',length:640,laps:1});
    await store.update((s:any)=>{s.maps=[map];});
    const config=quickRaceConfig(mapCourse(map),raceProfile(store.state.profiles[0]),0,'normal');
    const race=createRace(config),replay=newRecording(config);
    while(race.phase!=='finished'){stepRace(race,1);appendInput(replay,1);}replay.result=raceResult(race);await store.commit(replay);
    await store.update((s:any)=>{const owner=s.profiles[0];owner.unlockedMotoneta=true;owner.garage.vehicle='motoneta';owner.garage.rider.parts.helmet='trail';owner.appearance=garageAppearance(owner.garage);});
  },module);
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();await nav(page,'quick');
  await page.locator('.track-card',{hasText:'Fantasma Moto'}).click();
  await expect(page.locator('#quick-record')).toContainText('Tu récord:');
  await page.getByRole('checkbox',{name:'Correr contra mi fantasma'}).check();await page.locator('[data-action="start"]').click();
  await expect(page.locator('.race-identity')).toBeVisible();
  const state=await page.evaluate(()=>(window as any).__motoneta);
  expect(state.race.config.player.appearance.vehicle).toBe('motoneta');expect(state.vehicles.slice(0,2)).toEqual(['motoneta','motocross']);expect(state.ghosts[0].vehicle).toBe('motocross');
  await page.keyboard.press('Escape');await page.locator('[data-action="leave-race"]').click();await nav(page,'records');await page.locator('[data-action="record-watch"]').click();
  await expect(page.locator('.race-identity')).toBeVisible();
  const watched=await page.evaluate(()=>(window as any).__motoneta);
  expect(watched.race.config.player.appearance.vehicle).toBe('motocross');expect(watched.race.config.player.appearance.parts.helmet).toBe('core');expect(watched.vehicles[0]).toBe('motocross');
});

for (const viewport of [{width:1440,height:900},{width:844,height:390}]) test(`locked preview and independent configurations at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);await ready(page);
  const module=await setupStore(page);
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();await page.locator('[data-action="garage-open"]').click();
  await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await expect(page.getByText('Ganá el Torneo Motoneta para equiparla y personalizarla.')).toBeVisible();
  await expect(page.locator('[data-action="garage-save"]')).toBeDisabled();
  await expect(page.locator('[data-garage-color="primary"]')).toBeDisabled();
  await expect(page.locator('#garage-stage canvas')).toBeVisible();
  await mkdir('assets/motoneta/review/ui',{recursive:true});
  await page.screenshot({path:`assets/motoneta/review/ui/garage-locked-${viewport.width}.png`});
  await page.locator('[data-action="garage-cancel"]').click();
  await page.evaluate(async(module)=>{const {GameStore}=await import(/* @vite-ignore */ module);const store=new GameStore();await store.open();await store.update((s:any)=>{s.profiles[0].unlockedMotoneta=true;});},module);
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button',{name:'Perfiles',exact:true}).click();await page.locator('[data-action="garage-open"]').click();
  await page.locator('[data-garage-color="primary"]').fill('#12abcd');
  await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await page.locator('[data-garage-color="primary"]').fill('#abcd12');
  await page.locator('[data-action="garage-slot"][data-value="helmet"]').click();
  await page.locator('[data-action="garage-variant"][data-value="trail"]').click();
  await page.screenshot({path:`assets/motoneta/review/ui/garage-unlocked-${viewport.width}.png`});
  await page.locator('[data-action="garage-save"]').click();
  await expect(page.locator('#garage-stage')).toHaveCount(0);
  const state=await page.evaluate(()=>(window as any).__motoneta.profiles[0]);
  expect(state.garage.vehicle).toBe('motoneta');expect(state.appearance.vehicle).toBe('motoneta');
  expect(state.garage.bikes.motocross.paints.fairing.primary).toBe('#12abcd');expect(state.garage.bikes.motoneta.paints.fairing.primary).toBe('#abcd12');expect(state.garage.rider.parts.helmet).toBe('trail');
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();
  await page.locator('.home-modes [data-value="quick"]').click();await page.locator('[data-action="start"]').click();
  await expect(page.locator('.race-identity')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).__motoneta.race.config.player.appearance.vehicle)).toBe('motoneta');
  await page.screenshot({path:`assets/motoneta/review/ui/quick-race-${viewport.width}.png`});
});
