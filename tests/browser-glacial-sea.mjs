import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../verification/glacial-sea/', import.meta.url);
await mkdir(out, { recursive: true });
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', `--use-angle=${process.env.ANGLE_BACKEND || 'swiftshader'}`, '--enable-unsafe-swiftshader'] });
const checks = [], errors = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function open(viewport, { vehicle = 'aircraft', touch = false, quality = 'high' } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(([vehicle, quality]) => {
    window.__now = 0; window.requestAnimationFrame = () => 0;
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    if (!localStorage.getItem('frostline-settings')) localStorage.setItem('frostline-settings', JSON.stringify({ vehicle, quality, sound: false, map: 'north-atlantic' }));
  }, [vehicle, quality]);
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
    body: source + '\nwindow.__glacialQA={sim,world,frame,sortie};' }));
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(String(error)));
  p.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8778');
  await p.waitForFunction(() => !!window.__glacialQA, null, { timeout: 60000, polling: 100 });
  return { p, context };
}
const next = p => p.locator('[data-flow-action="next"]').click();
const draw = (p, frames = 1) => p.evaluate(frames => { for (let i = 0; i < frames; i++) { window.__now += 1000 / 60; window.__glacialQA.frame(window.__now); } }, frames);
const shot = (p, name) => p.screenshot({ path: new URL(name + '.png', out).pathname });
const state = p => p.evaluate(async () => {
  const { sim, world } = window.__glacialQA, math = await import('./world-math.js');
  const berg = world.map.icebergs?.find(b => b.id === 'tabular-west');
  return {
    state: sim.state, map: world.mapId, vehicle: sim.vehicle, enemies: sim.enemies.length, health: sim.player.health,
    seaIce: world.ocean.material.uniforms.seaIceStrength.value, bergs: world.terrain.userData.stats.icebergCount,
    draws: world.terrain.userData.stats.drawCalls, gl: world.renderer.getContext().getError(),
    bergTop: berg ? [math.terrainHeight(berg.x, berg.z), math.icebergHeight(berg, berg.x, berg.z)] : null,
  };
});
async function assertLayout(p) {
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await p.locator('#sortieFlow').evaluate(root => root.scrollWidth > root.clientWidth), false);
}
const metrics = {};
try {
  const { p, context } = await open({ width: 1280, height: 760 });
  await check('The glacial sea is offered as a fifth quick-mission area with icebergs on the deployment chart', async () => {
    await draw(p); await p.click('#startBtn'); await p.click('[data-category="quick"]'); await next(p);
    assert.equal(await p.locator('[data-sortie-map]').count(), 5);
    await p.click('[data-sortie-map="glacial-sea"]');
    assert.equal(await p.locator('[data-sortie-map="glacial-sea"]').getAttribute('aria-pressed'), 'true');
    assert.match(await p.locator('.selection-map-copy h3').innerText(), /冰原海域/);
    await p.click('[data-mission="intercept"]'); await next(p); await next(p); await next(p);
    assert.ok(await p.locator('.deployment-chart .tactical-ice').count() > 20);
    await shot(p, '01-deployment-chart');
  });
  await check('An aircraft sortie loads sea ice, solid icebergs and glaciers without WebGL errors', async () => {
    await next(p); await next(p);
    const s = await state(p);
    assert.equal(s.state, 'playing'); assert.equal(s.map, 'glacial-sea'); assert.equal(s.vehicle, 'aircraft');
    assert.equal(s.seaIce, 1); assert.ok(s.bergs >= 100); assert.ok(s.draws <= 30); assert.equal(s.gl, 0);
    assert.equal(s.bergTop[0], s.bergTop[1], 'the rendered tabular berg is a collision surface');
    await draw(p, 3); await shot(p, '02-aircraft-approach');
    await p.evaluate(() => { const { sim } = window.__glacialQA; for (let i = 0; i < 240; i++) sim.update(1 / 60, { throttleDelta: .1, roll: -.25, pitch: -.05 }); });
    await draw(p, 2); await shot(p, '03-aircraft-turn');
    const after = await state(p); assert.equal(after.state, 'playing'); assert.equal(after.gl, 0);
    metrics.aircraft = after;
    await p.click('#pauseBtn'); await p.click('#exitBtn');
  });
  await check('A destroyer gunnery sortie places targets in open water among the icebergs and keeps its hull clear', async () => {
    await p.click('[data-vehicle="destroyer"]'); await draw(p); await p.click('#startBtn');
    await p.click('[data-category="training"]'); await next(p); await p.click('[data-mission="naval-training"]');
    await next(p); await p.click('[data-brief-page="3"]'); await next(p);
    let s = await state(p);
    assert.equal(s.state, 'playing'); assert.equal(s.map, 'glacial-sea'); assert.equal(s.vehicle, 'destroyer'); assert.ok(s.enemies >= 2);
    const health = s.health;
    await p.evaluate(() => { const { sim } = window.__glacialQA; for (let i = 0; i < 600; i++) sim.update(1 / 60, { throttleDelta: .2, yaw: .05 }); });
    await draw(p, 3); await shot(p, '04-destroyer-lead');
    s = await state(p); assert.equal(s.gl, 0); assert.equal(s.health, health, 'passive targets and the open lead leave the destroyer undamaged');
    metrics.destroyer = s;
    await p.click('#pauseBtn'); await p.click('#exitBtn');
  });
  await context.close();
  for (const [viewport, name] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 844, height: 390 }, 'landscape']]) {
    const mobile = await open(viewport, { vehicle: 'j16', touch: true, quality: 'low' }), mp = mobile.p;
    await check(`${name} selects the glacial sea without overflow and launches on the low tier`, async () => {
      await mp.click('#startBtn'); await mp.click('[data-category="quick"]'); await next(mp);
      await mp.click('[data-sortie-map="glacial-sea"]'); await assertLayout(mp); await shot(mp, `05-${name}-map-options`);
      await next(mp); for (let page = 1; page < 4; page++) { await mp.click(`[data-brief-page="${page}"]`); await assertLayout(mp); }
      await next(mp); const s = await state(mp);
      assert.equal(s.map, 'glacial-sea'); assert.equal(s.state, 'playing'); assert.equal(s.gl, 0);
      await draw(mp, 2); await shot(mp, `06-${name}-flight`);
      await mp.click('#pauseBtn'); await mp.click('#exitBtn');
    });
    await mobile.context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(new URL('validation.json', out), JSON.stringify({ checks, errors, metrics }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors }));
} finally {
  await browser.close();
}
