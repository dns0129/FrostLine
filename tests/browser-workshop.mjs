import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import('playwright-core');
const output=resolve(process.env.OUTPUT_DIR||'verification/workshop');await mkdir(output,{recursive:true});
const baseURL=process.env.BASE_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const report={checks:[],errors:[],baseURL,boundary:'Phone viewports and touch are browser emulation; no physical device performance claim.'};
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
async function open(viewport,touch=false){
  const context=await browser.newContext({viewport,hasTouch:touch,serviceWorkers:'block'});
  await context.addInitScript(()=>{if(!localStorage.getItem('frostline-settings'))localStorage.setItem('frostline-settings',JSON.stringify({sound:false,quality:'low'}));});
  await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:source+'\nwindow.__workshopQA={sim,world,workshop,baseScene};'}));
  const page=await context.newPage();page.on('pageerror',error=>report.errors.push(String(error)));
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`${response.status()} ${response.url()}`);});
  await page.goto(baseURL,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__workshopQA&&!document.getElementById('menu').hidden,null,{timeout:60000});
  return {page,context};
}
const snap=page=>page.evaluate(()=>{
  const {sim,workshop,world}=window.__workshopQA;
  let visible=0;world.playerJet.userData.stores.traverse(o=>{if(o.userData.store&&o.visible)visible++;});
  return {profile:workshop.profile,vehicle:sim.vehicle,state:sim.state,health:sim.player.maxHealth,ammo:sim.player.ammo,air:sim.player.missiles,sea:sim.player.antiShipMissiles,
    lock:sim.lockProgress,seaLock:sim.antiShipLockProgress,airType:sim.player.selectedAirWeapon,visible,engine:sim.player.systems?.thrust,kills:sim.kills};
});
try{
  const {page,context}=await open({width:1440,height:900});
  await check('desktop workshop exposes all 9 compatible stations and 4 five-tier upgrade tracks',async()=>{
    await page.locator('#workshopBtn').click();assert.equal(await page.locator('#hardpointGrid select').count(),9);assert.equal(await page.locator('[data-upgrade]').count(),4);
    assert.equal(await page.locator('#station-1 option[value="harpoon:1"]').count(),0);assert.equal(await page.locator('#station-2 option[value="aim120:2"]').count(),1);
    assert.match(await page.locator('#loadoutInventory').innerText(),/空空 6 · 反舰 2/);assert.match(await page.locator('#workshopCredits').innerText(),/1,200/);
  });
  await page.screenshot({path:resolve(output,'desktop-workshop.png')});
  await check('custom asymmetric loadout, a real upgrade purchase and storage survive page reload',async()=>{
    await page.locator('#station-2').selectOption('harpoon:1');assert.match(await page.locator('#loadoutWarning').innerText(),/不平衡/);
    await page.locator('[data-upgrade="engine"]').click();assert.match(await page.locator('#workshopCredits').innerText(),/900/);
    assert.equal(await page.locator('[data-upgrade="engine"]').isDisabled(),true);
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__workshopQA&&!document.getElementById('menu').hidden);
    await page.locator('#workshopBtn').click();assert.equal(await page.locator('#station-2').inputValue(),'harpoon:1');
    assert.equal((await snap(page)).profile.levels.engine,1);assert.match(await page.locator('#workshopCredits').innerText(),/900/);
  });
  await check('preset, selected weapon and missile launch update actual physics and 3D inventory',async()=>{
    await page.locator('[data-preset="multirole"]').click();await page.locator('.workshop-done').click();
    await page.locator('[data-mode="training"]').click();await page.locator('#startBtn').click();
    let before=await snap(page);assert.equal(before.vehicle,'aircraft');assert.equal(before.ammo,578);assert.equal(before.sea,2);assert.ok(before.engine>0);
    await page.locator('#airWeaponBtn').click();assert.equal((await snap(page)).airType,'aim120');
    await page.evaluate(()=>{const s=window.__workshopQA.sim,t=s.enemies[0];s.enemies=[t];s._updatePlayer=()=>{};s._updateEnemies=()=>{};t.pos.copy(s.player.pos);t.pos.z-=1000;t.vel.set(0,0,0);s.targetId=t.id;});
    await page.waitForFunction(()=>window.__workshopQA.sim.lockProgress===1);before=await snap(page);await page.keyboard.press('KeyF');
    await page.waitForFunction(n=>window.__workshopQA.sim.player.missiles===n-1,before.air);
    assert.equal((await snap(page)).sea,before.sea);await page.waitForFunction(n=>{let count=0;window.__workshopQA.world.playerJet.userData.stores.traverse(o=>{if(o.userData.store&&o.visible)count++;});return count===n-1;},before.visible);
    await page.locator('#pauseBtn').click();await page.locator('#exitBtn').click();
  });
  // Restore the normal simulation methods after the fixed-target AA fixture.
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__workshopQA&&!document.getElementById('menu').hidden);
  await check('aircraft sea training launches a Harpoon through real keyboard controls and sinks a target',async()=>{
    await page.locator('#workshopBtn').click();await page.locator('[data-preset="sea"]').click();await page.locator('.workshop-done').click();
    await page.locator('[data-mode="naval-training"]').click();await page.locator('#startBtn').click();assert.equal((await snap(page)).vehicle,'aircraft');
    await page.waitForFunction(()=>window.__workshopQA.sim.antiShipLockProgress===1,null,{timeout:12000});
    await page.keyboard.press('KeyR');await page.waitForFunction(()=>window.__workshopQA.sim.player.antiShipMissiles===3);
    await page.waitForFunction(()=>window.__workshopQA.sim.kills>=1,null,{timeout:15000});
    await page.screenshot({path:resolve(output,'aircraft-sea-training.png')});
    await page.locator('#pauseBtn').click();await page.locator('#exitBtn').click();
  });
  await check('aircraft combat settles rewards exactly once and persists the updated balance',async()=>{
    const before=(await snap(page)).profile.credits;
    await page.locator('[data-mode="intercept"]').click();await page.locator('#startBtn').click();
    await page.evaluate(()=>{const s=window.__workshopQA.sim;const update=s._updateMission;s._updateMission=()=>{s._updateMission=update;s.kills=3;s.score=1000;s._finish(true);};});
    await page.locator('#resultPanel').waitFor({state:'visible'});assert.equal((await snap(page)).profile.credits,before+655);
    assert.match(await page.locator('#resultDescription').innerText(),/655 改装点与 600 XP/);
    await page.waitForTimeout(500);assert.equal((await snap(page)).profile.credits,before+655);
    await page.locator('#resultExitBtn').click();await page.locator('#workshopBtn').click();assert.equal(await page.locator('[data-upgrade="engine"]').isEnabled(),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#workshopPanel').isVisible(),false);
  });
  await check('ship selection retains its original inventory and omits aircraft upgrades',async()=>{
    await page.locator('[data-vehicle="destroyer"]').click();assert.equal(await page.locator('#workshopBtn').isVisible(),false);
    await page.locator('[data-mode="naval-training"]').click();await page.locator('#startBtn').click();const s=await snap(page);assert.equal(s.vehicle,'destroyer');assert.equal(s.ammo,240);assert.equal(s.sea,6);
    await page.locator('#pauseBtn').click();await page.locator('#exitBtn').click();
  });
  await context.close();
  for(const viewport of [{width:390,height:844},{width:844,height:390}]){
    const {page,context}=await open(viewport,true);
    await check(`${viewport.width}x${viewport.height} touch workshop scrolls, stays inside viewport and edits a hardpoint`,async()=>{
      await page.locator('#workshopBtn').tap();
      const bounds=await page.locator('#workshopPanel').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:e.scrollWidth,width:e.clientWidth};});
      assert.ok(bounds.left>=0&&bounds.right<=viewport.width);assert.ok(bounds.top>=0&&bounds.bottom<=viewport.height);assert.ok(bounds.scroll<=bounds.width);
      await page.locator('[data-preset="air"]').tap();assert.match(await page.locator('#loadoutInventory').innerText(),/空空 12 · 反舰 0/);
      await page.locator('#station-3').selectOption('aim120:1');assert.equal((await snap(page)).profile.loadouts.fa18c[2].count,1);
      await page.screenshot({path:resolve(output,`${viewport.width}x${viewport.height}-workshop.png`)});
      await page.locator('.workshop-done').tap();assert.equal(await page.locator('#menu').isVisible(),true);
    });await context.close();
  }
  assert.deepEqual(report.errors,[]);console.log(`PASS ${report.checks.length} browser checks, no page errors or failed requests`);
}finally{await writeFile(resolve(output,'validation.json'),JSON.stringify(report,null,2));await browser.close();}
