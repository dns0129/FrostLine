import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const root=process.cwd(),out=resolve(root,'verification/camera-upgrade');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell',headless:true,args:['--use-gl=angle','--use-angle=metal','--enable-unsafe-swiftshader']});
const errors=[],results={};
const source=await readFile('app.js','utf8');
try{
 for(const baseline of [true,false]){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  await context.addInitScript(()=>{window.__now=0;window.requestAnimationFrame=()=>1;Object.defineProperty(performance,'now',{value:()=>window.__now});localStorage.setItem('frostline-settings',JSON.stringify({quality:'high',sound:false}));});
  await context.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:source+'\nwindow.__flight={sim,world,start,frame,action,input,presentation};'}));
  if(baseline)for(const file of ['renderer.js','aircraft.js']){const body=await readFile(`verification/camera-upgrade/baseline/${file}`,'utf8');await context.route(`**/${file}`,r=>r.fulfill({contentType:'text/javascript',body}));}
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:8770/?debug',{waitUntil:'networkidle'});
  await page.evaluate(()=>window.__flight.world.sky.userData.ready);
  await page.evaluate(()=>document.getElementById('renderDiagnostics').style.display='none');
  await page.locator('[data-mode="training"]').click();await page.locator('#startBtn').click();
  const tick=async n=>page.evaluate(n=>{for(let i=0;i<n;i++){window.__now+=1000/60;window.__flight.frame(window.__now);}},n);
  const metrics=async()=>page.evaluate(()=>{const {world,sim}=window.__flight;const points=[-8.4,8.4].map(x=>world.project(sim.player.pos.clone().set(x,0,4).applyQuaternion(world.playerJet.quaternion).add(world.playerJet.position)));return {fov:world.camera.fov,distance:world.camera.position.distanceTo(world.playerJet.position),width:Math.abs(points[1].x-points[0].x)/innerWidth,boost:sim.player.boost,speed:sim.player.speed,quality:world.effectiveQuality,calls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles,airflow:world.speedEffects?.intensity,glError:world.renderer.getContext().getError()};});
  await tick(120);const cruise=await metrics();results[baseline?'before':'after']={cruise};
  await page.screenshot({path:resolve(out,baseline?'before.png':'cruise.png')});
  console.log(baseline?'before':'after',JSON.stringify(cruise));
  if(baseline){await context.close();continue;}
  assert.ok(cruise.width>results.before.cruise.width*1.6,'close camera must visibly enlarge the aircraft');
  await page.keyboard.down('Shift');await tick(90);const boost=await metrics();results.after.boost=boost;
  assert.equal(boost.boost,true);assert.ok(boost.fov>cruise.fov+8);assert.ok(boost.airflow>.5);assert.equal(boost.glError,0);
  await page.screenshot({path:resolve(out,'afterburner.png')});
  await page.keyboard.down('a');await page.keyboard.down('s');await tick(35);await page.screenshot({path:resolve(out,'bank.png')});await page.keyboard.up('a');await page.keyboard.up('s');await page.keyboard.up('Shift');
  await tick(120);results.after.released=await metrics();assert.equal(results.after.released.boost,false);assert.ok(results.after.released.fov<boost.fov-5);
  await page.keyboard.press('Escape');
  const frozen=await page.evaluate(()=>({matrix:window.__flight.world.camera.matrixWorld.elements.slice(),intensity:window.__flight.world.speedEffects.intensity,time:window.__flight.world.elapsed}));
  await tick(30);assert.deepEqual(await page.evaluate(()=>({matrix:window.__flight.world.camera.matrixWorld.elements.slice(),intensity:window.__flight.world.speedEffects.intensity,time:window.__flight.world.elapsed})),frozen);
  await page.locator('#resumeBtn').click();await page.keyboard.press('c');await tick(10);assert.equal(await page.evaluate(()=>window.__flight.world.playerJet.visible),false);await page.screenshot({path:resolve(out,'cockpit.png')});await page.keyboard.press('c');
  await page.evaluate(()=>window.__flight.start('training'));await tick(60);
  await page.mouse.move(720,460);await page.mouse.wheel(0,-600);await tick(60);const near=await metrics();await page.mouse.wheel(0,600);await tick(60);const far=await metrics();assert.ok(near.width>far.width);results.after.zoom={near:near.width,far:far.width};
  await page.setViewportSize({width:844,height:390});await page.evaluate(()=>window.__flight.world.setQuality('low'));await tick(30);
  const cdp=await context.newCDPSession(page);const boostBounds=await page.locator('#touchBoost').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:boostBounds.x+boostBounds.width/2,y:boostBounds.y+boostBounds.height/2}]});await tick(60);const mobile=await metrics();assert.equal(mobile.boost,true);assert.equal(mobile.quality,'low');assert.equal(mobile.glError,0);results.after.mobile=mobile;await page.screenshot({path:resolve(out,'mobile.png')});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await tick(20);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await tick(60);results.after.portrait=await metrics();console.log('portrait',JSON.stringify(results.after.portrait));assert.ok(results.after.portrait.width<.9);await page.screenshot({path:resolve(out,'portrait.png')});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'metrics.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}
