// Optional real-WebGL regression. Start server.py on BASE_URL before running.
// BASELINE=1 routes the preserved pre-fix app/renderer from verification/debug.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const playwrightPath=process.env.PLAYWRIGHT_PATH||'/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath=process.env.CHROMIUM_PATH||'/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const baseURL=process.env.BASE_URL||'http://127.0.0.1:8767';
const baseline=process.env.BASELINE==='1';
const label=baseline?'before':'after';
const outputDir=resolve(root,'verification/jitter');
await mkdir(outputDir,{recursive:true});
const appSource=await readFile(resolve(root,baseline?'verification/debug/app.js':'app.js'),'utf8');
const rendererSource=await readFile(resolve(root,baseline?'verification/debug/renderer.js':'renderer.js'),'utf8');
const angle=process.env.BROWSER_ANGLE||'metal';
const browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle',`--use-angle=${angle}`,'--enable-unsafe-swiftshader']});
const errors=[],results=[];
try{
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,serviceWorkers:'block'});
  await context.addInitScript(()=>{
    window.__jitterNow=0;
    window.__jitterRAF=[];
    Object.defineProperty(performance,'now',{value:()=>window.__jitterNow});
    window.requestAnimationFrame=callback=>{window.__jitterRAF.push(callback);return window.__jitterRAF.length;};
    window.cancelAnimationFrame=()=>{};
    localStorage.setItem('frostline-settings',JSON.stringify({quality:'high',sound:false}));
  });
  await context.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:appSource+'\nwindow.__jitter={sim,world,start,frame,action};\n'}));
  await context.route('**/renderer.js',route=>route.fulfill({contentType:'text/javascript',body:rendererSource}));
  for(const cadence of ['120Hz','144Hz','uneven']){
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(baseURL+'/?debug',{waitUntil:'networkidle'});
    console.log(`Loaded ${label} ${cadence}`);
    await page.waitForFunction(()=>!!window.__jitter);
    await page.evaluate(()=>window.__jitter.world.sky.userData.ready);
    await page.locator('[data-mode="training"]').dispatchEvent('click');
    await page.locator('#startBtn').dispatchEvent('click');
    const result=await page.evaluate(({cadence})=>{
      const {sim,world,frame}=window.__jitter;
      function tick(dt){window.__jitterNow+=dt*1000;window.__jitterRAF.length=0;frame(window.__jitterNow);}
      for(let i=0;i<120;i++)tick(1/60);
      const shore=world.terrain.children.find(object=>/wash at the true zero contour/.test(object.name))||world.terrain.children.find(object=>object.isMesh&&object.material.transparent&&!object.isInstancedMesh);
      if(!shore)throw new Error('No coastline mesh');
      const coastPositions=shore.geometry.attributes.position;
      let coast=null,best=Infinity;
      for(let i=0;i<coastPositions.count;i++){
        const point=sim.player.pos.clone().set(coastPositions.getX(i),coastPositions.getY(i),coastPositions.getZ(i));
        const screen=world.project(point);
        if(!screen.visible)continue;
        const score=Math.abs(screen.x-320)+Math.abs(screen.y-440);
        if(score<best){best=score;coast=point;}
      }
      if(!coast)throw new Error('No visible actual shoreline vertex');
      const samples=[];
      for(let i=0;i<120;i++){
        const dt=cadence==='120Hz'?1/120:cadence==='144Hz'?1/144:[1/144,1/100,1/120,1/90,1/165][i%5];
        tick(dt);
        const wing=sim.player.pos.clone().set(8,0,3).applyQuaternion(world.playerJet.quaternion).add(world.playerJet.position);
        samples.push({dt,wing:world.project(wing),coast:world.project(coast)});
      }
      const stats={};
      for(const key of ['wing','coast']){
        let secondDifference=0,normalizedAcceleration=0;
        for(let i=2;i<samples.length;i++){
          const a=samples[i-2][key],b=samples[i-1][key],c=samples[i][key],dt0=samples[i-1].dt,dt1=samples[i].dt;
          secondDifference=Math.max(secondDifference,Math.hypot(c.x-2*b.x+a.x,c.y-2*b.y+a.y));
          const vx0=(b.x-a.x)/dt0,vy0=(b.y-a.y)/dt0,vx1=(c.x-b.x)/dt1,vy1=(c.y-b.y)/dt1;
          normalizedAcceleration=Math.max(normalizedAcceleration,Math.hypot(vx1-vx0,vy1-vy0)/((dt0+dt1)/2)/14400);
        }
        stats[key]={secondDifference,normalizedAcceleration};
      }
      return {cadence,...stats,coastWorld:coast.toArray(),state:sim.state,enemies:sim.enemies.length,
        webglError:world.renderer.getContext().getError(),drawCalls:world.renderer.info.render.calls,
        quality:world.effectiveQuality,reflectionSize:[world.reflection.target.width,world.reflection.target.height]};
    },{cadence});
    results.push(result);
    console.log(JSON.stringify(result));
    assert.equal(result.state,'playing');assert.equal(result.enemies,3);assert.equal(result.webglError,0);
    if(cadence==='120Hz'){
      await page.screenshot({path:resolve(outputDir,`${label}-desktop.png`)});
      await page.keyboard.press('c');
      await page.evaluate(()=>{window.__jitterNow+=1000/120;window.__jitter.frame(window.__jitterNow);});
      const cockpit=await page.evaluate(()=>({playerVisible:window.__jitter.world.playerJet.visible,error:window.__jitter.world.renderer.getContext().getError()}));
      assert.equal(cockpit.playerVisible,false);assert.equal(cockpit.error,0);
      await page.screenshot({path:resolve(outputDir,`${label}-cockpit.png`)});
      await page.keyboard.press('c');
      await page.setViewportSize({width:844,height:390});
      await page.evaluate(()=>{window.__jitter.world.setQuality('low');for(let i=0;i<12;i++){window.__jitterNow+=1000/120;window.__jitter.frame(window.__jitterNow);}});
      const mobile=await page.evaluate(()=>({quality:window.__jitter.world.effectiveQuality,error:window.__jitter.world.renderer.getContext().getError(),reflection:[window.__jitter.world.reflection.target.width,window.__jitter.world.reflection.target.height]}));
      assert.equal(mobile.quality,'low');assert.equal(mobile.error,0);
      await page.screenshot({path:resolve(outputDir,`${label}-mobile.png`)});
      result.flows={cockpit,mobile};
    }
    await page.close();
  }
  await writeFile(resolve(outputDir,`${label}-metrics.json`),JSON.stringify({baseline,baseURL,results,errors},null,2)+'\n');
  assert.deepEqual(errors,[],'browser JS, WebGL, shader and resource console errors');
  let failures=0;
  for(const result of results){
    const wing=result.wing.normalizedAcceleration,coast=result.coast.normalizedAcceleration;
    const pass=wing<.15&&coast<.015;
    console.log(`${pass?'PASS':'FAIL'} ${result.cadence}: wing=${wing.toFixed(6)}, shoreline=${coast.toFixed(6)} px per 120Hz-frame squared`);
    if(!pass)failures++;
  }
  assert.equal(failures,0,'actual WebGL flight still has alternating aircraft or shoreline position jumps');
}finally{await browser.close();}
