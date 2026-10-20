import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const out=new URL('../verification/weapon-shop/',import.meta.url);await mkdir(out,{recursive:true});
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const checks=[],errors=[];
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const saved=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('frostline-workshop-v1')));
const next=p=>p.locator('[data-flow-action="next"]').click();
const draw=p=>p.evaluate(()=>{window.__now+=100;window.__shopQA.frame(window.__now);});
const shot=(p,name)=>p.screenshot({path:new URL(name+'.png',out).pathname});
const button=(p,root,kind,tier)=>p.locator(`${root} button[data-weapon-kind="${kind}"][data-weapon-tier="${tier}"]`);
async function open(viewport,touch=false){
 const context=await browser.newContext({viewport,hasTouch:touch,serviceWorkers:'block'});
 await context.addInitScript(()=>{window.__now=0;window.requestAnimationFrame=()=>0;Object.defineProperty(performance,'now',{value:()=>window.__now});
  if(!localStorage.getItem('frostline-settings'))localStorage.setItem('frostline-settings',JSON.stringify({quality:'low',sound:false,map:'city-bay',difficulty:'normal'}));
  if(!localStorage.getItem('frostline-workshop-v1'))localStorage.setItem('frostline-workshop-v1',JSON.stringify({version:2,silver:1800,gold:200,xp:399,levels:{engine:1}}));});
 await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:source+'\nwindow.__shopQA={sim,world,baseScene,start,base,result,frame,readouts,sortie,input};'}));
 const p=await context.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await p.goto(process.env.BASE_URL||'http://127.0.0.1:8778');await p.waitForFunction(()=>!!window.__shopQA,null,{timeout:60000,polling:100});return{p,context};
}
async function layout(p,selectors){
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const viewport=p.viewportSize();
 for(const selector of selectors){const box=await p.locator(selector).boundingBox();assert.ok(box,selector);assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1,selector);
  assert.equal(await p.locator(selector).evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));}),true,selector+' reachable');}
}
async function holdTarget(p){await p.evaluate(()=>{const {sim}=window.__shopQA,e=sim.enemies[0];sim.enemies=[e];sim._updateEnemies=()=>{};sim._updatePlayer=()=>{};e.pos.copy(sim.player.pos);e.pos.z-=1000;e.health=10000;e.vel.set(0,0,0);sim.targetId=e.id;sim._updateLock(2);});}
async function step(p,seconds){await p.evaluate(seconds=>{for(let i=0;i<seconds*60;i++)window.__shopQA.sim.update(1/60);},seconds);await draw(p);}
try{
 const {p,context}=await open({width:1440,height:900});
 await check('Old money, XP and upgrades migrate once to v3 permanent ownership',async()=>{
  const profile=await saved(p);assert.equal(profile.version,3);assert.equal(profile.silver,1800);assert.equal(profile.gold,200);assert.equal(profile.xp,399);assert.equal(profile.levels.engine,1);assert.deepEqual(profile.ownedWeapons,{missile:['basic'],gun:['basic']});
  await draw(p);await layout(p,['#arsenalBtn','#workshopBtn','#settingsBtn']);await shot(p,'01-clean-hangar');
  const model=await p.evaluate(()=>{const {baseScene,world}=window.__shopQA;const bad=[];for(const jet of [...Object.values(baseScene.jets),...Object.values(world.playerJets)])jet.traverse(o=>{if(o.userData.store||/pylon|launch_rail/.test(o.name)||o.name==='FA18_airframe_material_batch_13')bad.push(o.name);});return{bad,removed:world.playerJets.j16.getObjectByName('J16_fuselage,_wings_&_tail').geometry.userData.removedPylons};});
  assert.deepEqual(model.bad,[]);assert.equal(model.removed,4);
 });
 await check('The hangar replaces hardpoints with six weapon offers and charges silver once per purchase',async()=>{
  await p.click('#workshopBtn');assert.equal(await p.locator('#hardpointGrid').count(),0);assert.equal(await p.locator('#hangarWeaponShop .weapon-shop-card').count(),6);
  await button(p,'#hangarWeaponShop','gun','silver').click();assert.equal((await saved(p)).silver,1200);
  await button(p,'#hangarWeaponShop','missile','silver').click();const profile=await saved(p);assert.equal(profile.silver,300);assert.equal(profile.ammoTiers.missile,'silver');assert.equal(profile.ammoTiers.gun,'silver');
  assert.equal(await button(p,'#hangarWeaponShop','missile','silver').isDisabled(),true);assert.match(await p.locator('#workshopStatus').innerText(),/永久购买/);await shot(p,'02-hangar-purchase');
  await p.locator('#workshopPanel .panel-top .close-panel').click();
 });
 await check('Gold purchases are permanent; owned weapons equip freely with zero gold',async()=>{
  await p.click('#arsenalBtn');await button(p,'#arsenalChoices','gun','gold').click();assert.equal((await saved(p)).gold,120);
  await button(p,'#arsenalChoices','missile','gold').click();assert.equal((await saved(p)).gold,0);
  await button(p,'#arsenalChoices','gun','basic').click();await button(p,'#arsenalChoices','missile','silver').click();
  const profile=await saved(p);assert.deepEqual(profile.ownedWeapons,{missile:['basic','silver','gold'],gun:['basic','silver','gold']});assert.equal(profile.silver,300);assert.equal(profile.gold,0);
  await shot(p,'03-owned-weapons');await p.locator('#arsenalPanel .panel-top .close-panel').click();
 });
 await check('The real sortie flow launches a clean aircraft with unlimited weapons and a finite cannon magazine',async()=>{
  await p.click('#startBtn');await p.click('[data-category="quick"]');await next(p);await p.click('[data-mission="intercept"]');await next(p);await p.click('[data-brief-page="3"]');await next(p);await draw(p);
  const state=await p.evaluate(()=>{const {sim,world}=window.__shopQA;return{state:sim.state,stores:sim.player.stores,clip:sim.player.ammo,modelStores:world.playerJet.userData.stores.children.length};});
  assert.equal(state.state,'playing');assert.deepEqual(state.stores,[]);assert.equal(state.clip,60);assert.equal(state.modelStores,0);await layout(p,['#gunGradeBtn','#missileGradeBtn','#pauseBtn']);await shot(p,'04-clean-flight');
 });
 await check('Keyboard missile fire consumes no currency and requires its full refill cooldown',async()=>{
  await holdTarget(p);const before=await saved(p);await p.keyboard.press('f');assert.equal(await p.evaluate(()=>window.__shopQA.sim.missiles.length),1);assert.deepEqual(await saved(p),before);
  const timer=await p.evaluate(()=>window.__shopQA.sim.missileCooldown);assert.equal(timer,7);await p.keyboard.press('f');assert.equal(await p.evaluate(()=>window.__shopQA.sim.missiles.length),1);
  await p.click('#missileGradeBtn');await p.keyboard.press('b');assert.equal(await p.evaluate(()=>window.__shopQA.sim.missileCooldown),timer);
  await step(p,7.1);await p.evaluate(()=>{const {sim}=window.__shopQA;sim.player.selectedAirWeapon='aim9';sim._updateLock(2);});await p.keyboard.press('f');
  assert.equal(await p.evaluate(()=>window.__shopQA.sim.missiles.at(-1).ammoGrade),'gold');assert.equal((await saved(p)).gold,0);
 });
 await check('Cannon empty-magazine reload shows a countdown, rejects early fire and resumes automatically',async()=>{
  await p.evaluate(()=>window.__shopQA.sim.player.ammo=1);await p.keyboard.down('Space');await draw(p);await p.keyboard.up('Space');
  assert.equal(await p.evaluate(()=>window.__shopQA.sim.player.ammo),0);assert.match(await p.locator('#gunGradeBtn').innerText(),/补充/);await shot(p,'05-refilling');
  const shots=await p.evaluate(()=>window.__shopQA.sim.shots);await p.keyboard.down('Space');await draw(p);await p.keyboard.up('Space');assert.equal(await p.evaluate(()=>window.__shopQA.sim.shots),shots);
  await step(p,3.1);assert.equal(await p.evaluate(()=>window.__shopQA.sim.player.ammo),60);await p.keyboard.down('Space');await draw(p);await p.keyboard.up('Space');assert.ok(await p.evaluate(before=>window.__shopQA.sim.shots>before,shots));
  assert.equal((await saved(p)).silver,300);assert.equal((await saved(p)).gold,0);
 });
 await check('Pause freezes every refill timer and restart restores magazines without refunding purchases',async()=>{
  await p.evaluate(()=>{const {sim}=window.__shopQA;sim.player.ammo=1;sim._gunTimer=0;sim._fireGun();});await p.click('#pauseBtn');
  const before=await p.evaluate(()=>{const {sim}=window.__shopQA;return[sim.time,sim.gunReloadCooldown,sim.missileCooldown,sim.antiShipCooldown];});await step(p,2);
  assert.deepEqual(await p.evaluate(()=>{const {sim}=window.__shopQA;return[sim.time,sim.gunReloadCooldown,sim.missileCooldown,sim.antiShipCooldown];}),before);
  await p.click('#restartBtn');assert.equal(await p.evaluate(()=>window.__shopQA.sim.player.ammo),60);assert.equal(await p.evaluate(()=>window.__shopQA.sim.gunReloadCooldown),0);assert.equal((await saved(p)).silver,300);
 });
 await check('Browser reload retains permanent ownership and no subsequent shot spends coins',async()=>{
  const before=await saved(p);await p.reload();await p.waitForFunction(()=>!!window.__shopQA,null,{polling:100});assert.deepEqual(await saved(p),before);
  await p.evaluate(()=>window.__shopQA.start('intercept'));await holdTarget(p);await p.keyboard.press('f');await p.keyboard.down('Space');await draw(p);await p.keyboard.up('Space');assert.deepEqual(await saved(p),before);
 });
 await check('Win rewards and technology purchases preserve all owned weapons and settle only once',async()=>{
  const before=await saved(p);await p.evaluate(()=>{const {sim,result}=window.__shopQA;sim.kills=9;sim.score=3000;sim.state='won';result();});
  const win=await saved(p);assert.equal(win.silver,before.silver+1090);assert.equal(win.gold,8);assert.equal(win.xp,1699);assert.deepEqual(win.ownedWeapons,before.ownedWeapons);await p.evaluate(()=>window.__shopQA.result());assert.deepEqual(await saved(p),win);
  await p.click('#resultExitBtn');await p.click('#workshopBtn');await p.click('[data-upgrade="engine"]');const upgrade=await saved(p);assert.equal(upgrade.levels.engine,2);assert.equal(upgrade.silver,win.silver-700);assert.deepEqual(upgrade.ownedWeapons,win.ownedWeapons);
  await p.locator('#workshopPanel .panel-top .close-panel').click();
 });
 await check('Naval readiness shows infinite weapons and applies the chosen refill modifier to actual launches',async()=>{
  await p.click('[data-vehicle="burke"]');await p.click('#navalWorkshopBtn');await p.click('[data-readiness="airDefense"]');
  assert.match(await p.locator('#navalReadinessNote').innerText(),/缩短 20%/);assert.match(await p.locator('#navalWeapons').innerText(),/无限补充/);
  await p.locator('#navalWorkshopPanel .close-panel').click();const before=await saved(p);
  await p.evaluate(()=>{const {start,sim}=window.__shopQA;start('naval-training');sim._updatePlayer=sim._updateEnemies=()=>{};sim._updateAntiShipLock(2);});
  await p.keyboard.press('r');assert.ok(Math.abs(await p.evaluate(()=>window.__shopQA.sim.antiShipCooldown)-16.2)<1e-8);assert.equal(await p.evaluate(()=>window.__shopQA.sim.player.maxGunMagazine),12);assert.deepEqual(await saved(p),before);
  await draw(p);await shot(p,'08-naval-refill');
 });
 await context.close();
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const {p,context}=await open(viewport,true);
  await check(`${viewport.width}×${viewport.height}: shop purchase, no-hardpoint upgrade panel and refill HUD remain reachable`,async()=>{
   await layout(p,['#arsenalBtn','#workshopBtn','#settingsBtn','[data-base="aircraft"]','[data-base="destroyer"]']);await p.click('#workshopBtn');
   assert.equal(await p.locator('#workshopPanel').evaluate(el=>el.scrollWidth>el.clientWidth),false);await button(p,'#hangarWeaponShop','gun','silver').scrollIntoViewIfNeeded();await button(p,'#hangarWeaponShop','gun','silver').click();assert.equal((await saved(p)).silver,1200);await shot(p,`06-shop-${viewport.width}`);
   await p.locator('#workshopPanel .panel-top .close-panel').click();await p.evaluate(()=>window.__shopQA.start('intercept'));await draw(p);await layout(p,['#gunGradeBtn','#missileGradeBtn','#pauseBtn']);
   await p.evaluate(()=>{const {sim}=window.__shopQA;sim.player.ammo=1;sim._fireGun();});await draw(p);assert.match(await p.locator('#gunGradeBtn').innerText(),/补充/);await shot(p,`07-refill-${viewport.width}`);
  });await context.close();
 }
 assert.deepEqual(errors,[]);console.log(`PASS ${checks.length} weapon-shop browser checks; no page/resource errors`);await writeFile(new URL('results.json',out),JSON.stringify({checks,errors},null,2));
}finally{await browser.close();}
