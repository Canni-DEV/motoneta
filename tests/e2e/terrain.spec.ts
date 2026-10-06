import { expect, test, type Page } from '@playwright/test';
import { nav, ready } from './ui-helpers';

async function legacySave(page: Page) {
  await page.goto('/loop-prototype.html');
  return page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ localProfile }, { emptyDesign, placedPiece }, { defaultAppearance }] = await Promise.all([source('/src/core/game.ts'),source('/src/core/maps.ts'),source('/src/appearance.ts')]);
    const profile=localProfile({id:'preserved',name:'Piloto guardado',color:'#358aad',appearance:defaultAppearance('#358aad'),unlockedMotoneta:true,unlockedTanque:true});
    const design={...emptyDesign(),version:3,id:'legacy-map',name:'Mapa conservado',items:[placedPiece('K',400),placedPiece('P',600)]};
    design.items.forEach((s:any)=>delete s.terrainShape);
    const state={game:'motoneta',version:3,profiles:[profile],activeProfile:profile.id,maps:[design],draft:structuredClone(design),
      records:[{key:'old'}],sessions:{tournament:{id:'old'}},motonetaSessions:{preserved:{id:'old'}},tanqueSessions:{preserved:{id:'old'}}};
    const settings=JSON.stringify({quality:'low',volume:0.2,weather:'rain'});
    localStorage.setItem('motoneta.settings.v3',settings);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('motoneta-game',4);
      request.onupgradeneeded=()=>{request.result.createObjectStore('data');request.result.createObjectStore('replays');};
      request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);
    });
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['data','replays'],'readwrite');tx.objectStore('data').put(state,'state');
      tx.objectStore('replays').put({game:'motoneta',version:3,ruleset:'motoneta-3'},'old-replay');
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });db.close();
    return {state,settings};
  });
}
test('format-3 migration is atomic, retains progression/maps/settings and is idempotent',async({page})=>{
  const original=await legacySave(page);
  const result=await page.evaluate(async()=>{
    const source=(p:string)=>import(/* @vite-ignore */ p);
    const {GameStore}=await source('/src/persistence.ts');
    const clear=IDBObjectStore.prototype.clear;let failed=false;
    IDBObjectStore.prototype.clear=function(){if(this.name==='replays')throw new DOMException('Injected failure','QuotaExceededError');return clear.call(this);};
    try{await new GameStore().open();}catch{failed=true;}finally{IDBObjectStore.prototype.clear=clear;}
    const raw=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open('motoneta-game',4);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    const versionAfterFailure=raw.version;
    const transaction=raw.transaction(['data','replays']);
    const read=(request:IDBRequest)=>new Promise<any>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const [rollbackState,rollbackReplay]=await Promise.all([read(transaction.objectStore('data').get('state')),read(transaction.objectStore('replays').get('old-replay'))]);
    raw.close();
    const store=new GameStore();await store.open();const migrated=await store.backup();
    const before=JSON.stringify(migrated);await store.open();const unchanged=JSON.stringify(await store.backup())===before;
    const notices=[await store.consumeTerrainNotice(),await store.consumeTerrainNotice()];
    await store.open();notices.push(await store.consumeTerrainNotice());
    return {failed,versionAfterFailure,rollbackState,rollbackReplay,migrated,unchanged,notices,settings:localStorage.getItem('motoneta.settings.v3')};
  });
  expect(result.failed).toBe(true);expect(result.versionAfterFailure).toBe(4);
  expect(result.rollbackState).toEqual(original.state);expect(result.rollbackReplay.ruleset).toBe('motoneta-3');
  expect(result.migrated.state.profiles).toEqual(original.state.profiles);
  expect(result.migrated.state.activeProfile).toBe('preserved');expect(result.settings).toBe(original.settings);
  expect(result.migrated.state.maps[0]).toMatchObject({...original.state.maps[0],version:4,revision:expect.any(String)});
  expect(result.migrated.state.draft.items.every((s:any)=>s.terrainShape?.version===1)).toBe(true);
  expect(result.migrated.state.records).toEqual([]);expect(result.migrated.replays).toEqual({});
  for(const key of ['sessions','motonetaSessions','tanqueSessions'] as const)expect(result.migrated.state[key]).toEqual({});
  expect(result.unchanged).toBe(true);expect(result.notices).toEqual([true,false,false]);
});
test('migration announcement appears once in the menu and leaves saved maps available',async({page})=>{
  await legacySave(page);await page.goto('/');await expect(page.locator('#model-status')).toBeHidden();
  await expect(page.locator('#modal h2')).toHaveText('Nueva etapa de marcas');
  await page.locator('#modal [data-action="close-modal"]').click();
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();await expect(page.locator('#modal')).not.toBeVisible();
  await nav(page,'editor');expect(await page.evaluate(()=>(window as any).__motoneta.design.name)).toBe('Mapa conservado');
});
test('terrain variants undo/redo, duplicate and survive reload and export',async({page},info)=>{
  await ready(page);await nav(page,'editor');
  await page.locator('[data-action="piece"][data-value="U"]').click();await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('.editor-sidebar h2')).toHaveText('Arena');
  const original=await page.evaluate(()=>(window as any).__motoneta.design);
  await page.locator('[data-action="terrain-variant"]').click();
  const changed=await page.evaluate(()=>(window as any).__motoneta.design);
  expect(changed.items[0].terrainShape).not.toEqual(original.items[0].terrainShape);
  expect(changed.revision).not.toBe(original.revision);
  await page.locator('[data-action="undo"]').click();
  expect(await page.evaluate(()=>(window as any).__motoneta.design.items[0].terrainShape)).toEqual(original.items[0].terrainShape);
  await page.locator('[data-action="redo"]').click();await page.locator('.placed').first().click();
  await page.locator('[data-action="duplicate-piece"]').click();
  let duplicated=await page.evaluate(()=>(window as any).__motoneta.design);
  expect(duplicated.items[1].terrainShape).toEqual(changed.items[0].terrainShape);
  await page.locator('[data-action="move-right"]').click();
  await page.locator('#piece-length').fill('96');await page.locator('#piece-length').blur();
  duplicated=await page.evaluate(()=>(window as any).__motoneta.design);
  expect(duplicated.items[1].terrainShape).toEqual(changed.items[0].terrainShape);
  await expect(page.locator('#draft-status')).toContainText('Borrador guardado');
  await page.screenshot({path:info.outputPath('terrain-editor-desktop.png')});
  await page.setViewportSize({width:844,height:390});
  await page.screenshot({path:info.outputPath('terrain-editor-mobile.png')});
  await page.reload();await expect(page.locator('#model-status')).toBeHidden();await nav(page,'editor');
  expect(await page.evaluate(()=>(window as any).__motoneta.design)).toEqual(duplicated);
  const download=page.waitForEvent('download');
  await page.locator('[data-action="editor-file"]').click();await page.getByRole('button',{name:'Exportar',exact:true}).click();
  const file=await download;
  const {readFile}=await import('node:fs/promises');
  expect(JSON.parse(await readFile((await file.path())!,'utf8'))).toEqual(duplicated);
});
test('generator exposes all new weights and applies difficulty defaults',async({page})=>{
  await ready(page);await nav(page,'quick');await page.locator('[data-action="generator"]').click();
  for(const difficulty of ['easy','normal','hard']) {
    await page.locator('#gen-difficulty').selectOption(difficulty);
    for(const key of ['grass','sand','gravel'])await expect(page.locator('[data-generator="'+key+'"]')).toHaveValue(difficulty==='easy'?'5':difficulty==='normal'?'10':'15');
  }
  for(const key of ['ramps','mud','cool','grass','sand','gravel','loops']) {
    await page.locator('[data-generator="'+key+'"]').fill(key==='gravel'?'100':'0');
    await page.locator('[data-generator="'+key+'"]').blur();
  }
  await page.locator('[data-action="generate"]').click();await page.locator('[data-action="edit-generated"]').click();
  const design=await page.evaluate(()=>(window as any).__motoneta.design);
  expect(design.items.length).toBeGreaterThan(0);expect(design.items.every((s:any)=>s.surface==='gravel')).toBe(true);
});

test('drag preview uses the same contour that is placed in the editor',async({page})=>{
  await ready(page);await nav(page,'editor');
  const palette=page.locator('[data-action="piece"][data-value="U"]');await palette.scrollIntoViewIfNeeded();
  const source=(await palette.boundingBox())!,lane=(await page.locator('.lane[data-lane="0"]').boundingBox())!;
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
  await page.mouse.move(lane.x+150,lane.y+lane.height/2,{steps:8});
  await expect(page.locator('.placement-ghost .terrain-outline')).toBeVisible();
  const preview=await page.locator('.placement-ghost polygon').getAttribute('points');
  await page.mouse.up();await expect(page.locator('.editor-sidebar h2')).toHaveText('Arena');
  expect(await page.locator('.editor-panel-content .terrain-outline polygon').getAttribute('points')).toBe(preview);
});
