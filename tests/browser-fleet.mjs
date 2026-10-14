// Real local WebGL, real sortie buttons. Inspection-camera shots are labelled separately.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'verification/fleet');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs').href);
const browser = await chromium.launch({ executablePath: '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell', headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const source = await readFile(resolve(root, 'app.js'), 'utf8'), baseURL = process.env.BASE_URL || 'http://127.0.0.1:8778';
const report = { baseURL, checks: [], errors: [], metrics: {}, boundary: 'Mobile viewport emulation, not physical-device performance. Model inspection screenshots use a QA camera; gameplay screenshots use the original camera.' };
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
async function open(viewport, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('frostline-settings', JSON.stringify({ sound: false, quality: 'auto' })));
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__fleetQA={sim,world};' }));
  const page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__fleetQA);
  return { page, context };
}
async function state(page) { return page.evaluate(() => {
  const { sim, world } = window.__fleetQA;
  return { state: sim.state, time: sim.time, fleet: sim.ambientShips.map(s => ({ id: s.id, type: s.type, country: s.country, pos: s.pos.toArray(), heading: s.heading, speed: s.speed })), models: world.ambientFleet.ships.length, objects: world.ambientFleet.group.children.length,
    wakes: world.ambientFleet.ships.map(s => s.wake.visible), quality: world.effectiveQuality, enemyCount: sim.enemies.length, glError: world.renderer.getContext().getError(), calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles,
    memory: { ...world.renderer.info.memory } };
}); }
async function start(page, vehicle, mode) {
  await page.locator(`[data-vehicle="${vehicle}"]`).click(); await page.locator(`[data-mode="${mode}"]`).click(); await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.__fleetQA.sim.time > .15);
}
async function leave(page) { await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); }
try {
  const { page, context } = await open({ width: 1440, height: 900 });
  for (const [vehicle, modes] of [['aircraft', ['intercept', 'free', 'training']], ['destroyer', ['intercept', 'free', 'training', 'naval', 'naval-training']]]) for (const mode of modes) {
    await check(`Desktop ${vehicle}/${mode}: exactly six moving ships and visible wakes`, async () => {
      await start(page, vehicle, mode); const before = await state(page);
      assert.equal(before.fleet.length, 6); assert.equal(before.models, 6); assert.equal(before.objects, 12); assert.ok(before.wakes.every(Boolean));
      await page.waitForFunction(t => window.__fleetQA.sim.time > t + .25, before.time);
      const after = await state(page); assert.ok(after.fleet.every((s, i) => s.pos.some((v, k) => k !== 1 && Math.abs(v - before.fleet[i].pos[k]) > .01))); assert.equal(after.glError, 0);
      if (mode === 'naval-training') assert.equal(after.enemyCount, 2);
      report.metrics[`${vehicle}-${mode}`] = after;
      await page.screenshot({ path: resolve(out, `desktop-gameplay-${vehicle}-${mode}.png`) });
      await leave(page);
    });
  }
  await check('Pause freezes fleet position and model transforms; restart retains six models', async () => {
    await start(page, 'destroyer', 'naval-training'); await page.locator('#pauseBtn').click(); const before = await state(page);
    await page.evaluate(() => new Promise(resolve => { let frames = 0; function next() { if (++frames > 12) resolve(); else requestAnimationFrame(next); } requestAnimationFrame(next); }));
    assert.deepEqual((await state(page)).fleet, before.fleet);
    await page.locator('#restartBtn').click(); await page.waitForFunction(() => window.__fleetQA.sim.time > .1); assert.equal((await state(page)).objects, 12);
  });
  await check('Four model inspection views compile textured shaders and reflection without WebGL errors', async () => {
    await page.evaluate(() => {
      const { sim, world } = window.__fleetQA; sim.state = 'paused'; world._savedCameraUpdate = world._updateCamera; world._updateCamera = () => {};
      document.getElementById('flightUI').hidden = true; document.getElementById('toast').hidden = true;
      for (const id of ['crosshair', 'radar', 'shipGunCue', 'shipAimStatus', 'targetLayer', 'shipGunReadout']) document.getElementById(id)?.setAttribute('data-qa-hide', 'true');
      const style = document.createElement('style'); style.id = 'qa-inspection-style'; style.textContent = '[data-qa-hide], #hudCanvas { display:none!important; }'; document.head.append(style);
    });
    for (const type of ['forrestal', 'fujian', 'burke', 'type052d']) {
      await page.evaluate(type => {
        const { world } = window.__fleetQA, model = world.ambientFleet.ships.find(s => s.model.userData.modelType === type).model, d = model.userData.definition;
        world.camera.position.copy(model.position).add({ x: d.length * .9, y: d.length * .65, z: -d.length * .86 });
        world.camera.lookAt(model.position.clone().add({ x: 0, y: d.deckY + 3, z: 0 })); world.camera.fov = 39; world.camera.updateProjectionMatrix(); world.refreshReflection = true;
      }, type);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal((await state(page)).glError, 0); await page.screenshot({ path: resolve(out, `model-${type}.png`) });
    }
    await page.evaluate(() => { const { sim, world } = window.__fleetQA; world._updateCamera = world._savedCameraUpdate; world.cameraReady = false; sim.state = 'playing'; document.getElementById('flightUI').hidden = false; document.getElementById('qa-inspection-style').remove(); });
    await leave(page);
  });
  await context.close();
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    const { page, context } = await open(viewport, true);
    await check(`Mobile ${viewport.width}×${viewport.height}: six ships, low detail budget and both vehicle sorties`, async () => {
      for (const vehicle of ['aircraft', 'destroyer']) {
        await start(page, vehicle, vehicle === 'destroyer' ? 'naval-training' : 'training'); const s = await state(page);
        assert.equal(s.fleet.length, 6); assert.equal(s.quality, 'low'); assert.equal(s.glError, 0); assert.ok(s.wakes.every(Boolean));
        report.metrics[`${viewport.width}x${viewport.height}-${vehicle}`] = s;
        await page.screenshot({ path: resolve(out, `mobile-${viewport.width}x${viewport.height}-${vehicle}.png`) }); await leave(page);
      }
    }); await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.checks.length} browser fleet checks`);
} finally {
  await writeFile(resolve(out, 'metrics.json'), JSON.stringify(report, null, 2)); await browser.close();
}
