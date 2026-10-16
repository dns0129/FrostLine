import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../verification/sortie-flow/', import.meta.url);
await mkdir(out, { recursive: true });
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], errors = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function open(viewport, { vehicle = 'aircraft', touch = false } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(vehicle => {
    window.__now = 0; window.requestAnimationFrame = () => 0;
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    if (!localStorage.getItem('frostline-settings')) localStorage.setItem('frostline-settings', JSON.stringify({ vehicle, quality: 'low', sound: false, map: 'city-bay' }));
  }, vehicle);
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
    body: source + '\nwindow.__sortieQA={sim,world,baseScene,frame,sortie,result,input,readouts};' }));
  const p = await context.newPage();
  p.on('pageerror', error => errors.push(String(error)));
  p.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await p.goto(process.env.BASE_URL || 'http://127.0.0.1:8778');
  await p.waitForFunction(() => !!window.__sortieQA, null, { timeout: 60000, polling: 100 });
  return { p, context };
}
const next = p => p.locator('[data-flow-action="next"]').click();
async function draw(p) { await p.evaluate(() => { window.__now += 200; window.__sortieQA.frame(window.__now); }); }
const snapshot = p => p.evaluate(() => {
  const { sim, world, sortie, input } = window.__sortieQA;
  return { state: sim.state, time: sim.time, mode: sim.mode, chapter: sim.campaignId, input: input.active,
    page: sortie.page, screen: sortie.screen, map: world.mapId, ship: sim.player.shipId,
    aircraft: sim.player.aircraftId, enemies: sim.enemies.length, gl: world.renderer.getContext().getError() };
});
async function shot(p, name) { await p.screenshot({ path: new URL(name + '.png', out).pathname }); }
async function assertLayout(p) {
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await p.locator('#sortieFlow').evaluate(root => root.scrollWidth > root.clientWidth), false);
  const r = await p.locator('.sortie-footer [data-flow-action="next"]').boundingBox();
  const viewport = p.viewportSize(); assert.ok(r.x >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1);
}
try {
  const { p, context } = await open({ width: 1440, height: 1000 });
  await check('Home remains the original hangar and naval base; start opens modes without starting a battle', async () => {
    await draw(p); assert.equal(await p.locator('[data-base]').count(), 2); assert.equal(await p.locator('[data-vehicle]').count(), 5);
    assert.match(await p.locator('#startBtn').innerText(), /开始游戏/); await shot(p, '01-original-base');
    await p.click('#startBtn'); assert.equal(await p.locator('[data-category]').count(), 3);
    const s = await snapshot(p); assert.equal(s.state, 'menu'); assert.equal(s.time, 0); assert.equal(s.input, false);
    await shot(p, '02-mode-selection');
  });
  await check('Locked chapters allow all four briefing pages but cannot launch or mutate the campaign', async () => {
    await p.click('[data-category="campaign"]'); await next(p);
    assert.equal(await p.locator('[data-mission]').count(), 3); await p.click('[data-mission="finale"]'); await next(p);
    for (let page = 0; page < 4; page++) { await p.click(`[data-brief-page="${page}"]`); assert.equal((await snapshot(p)).state, 'menu'); }
    assert.equal(await p.locator('[data-flow-action="next"]').isDisabled(), true);
    assert.match(await p.locator('.sortie-blocked').innerText(), /解锁/);
    assert.equal(await p.evaluate(() => localStorage.getItem('frostline-campaign-v1')), null);
    await p.locator('.sortie-header .flow-back').click(); await p.click('[data-mission="dawn"]'); await shot(p, '03-campaign-selection');
  });
  await check('The four-step briefing launches the actual first chapter only after final confirmation', async () => {
    await next(p); assert.equal(await p.locator('#sortieTitle').innerText(), '晨雾警报');
    for (let page = 0; page < 3; page++) { assert.equal((await snapshot(p)).page, page); await next(p); }
    assert.equal((await snapshot(p)).state, 'menu'); await next(p);
    const s = await snapshot(p); assert.equal(s.state, 'playing'); assert.equal(s.chapter, 'dawn'); assert.equal(s.enemies, 2);
    assert.equal(s.map, 'north-atlantic'); assert.equal(s.input, true); assert.equal(await p.locator('#sortieFlow').isVisible(), false); assert.equal(s.gl, 0);
  });
  await check('A completed chapter opens next-chapter briefing and its real defense rules before launching', async () => {
    await p.evaluate(() => {
      const { sim, result } = window.__sortieQA;
      for (let wave = 0; wave < 3 && sim.state === 'playing'; wave++) {
        sim.enemies.forEach(e => e.health = 0); sim.update(1 / 60);
        for (let step = 0; step < 300 && !sim.enemies.length && sim.state === 'playing'; step++) sim.update(1 / 60);
      }
      if (sim.state !== 'won') throw Error('Victory fixture did not complete chapter'); result();
    });
    await p.click('#campaignNextBtn'); assert.equal((await snapshot(p)).state, 'menu'); assert.equal((await snapshot(p)).screen, 'briefing');
    assert.equal(await p.locator('#sortieTitle').innerText(), '舰队上空'); await shot(p, '04-briefing-overview');
    await next(p); assert.match(await p.locator('.briefing-details').innerText(), /22 秒/); await shot(p, '05-scenario-details');
    await next(p); assert.match(await p.locator('.deployment-chart').innerText(), /4.5 km/); await shot(p, '06-deployment');
    await next(p); assert.match(await p.locator('.mission-failure').innerText(), /10 秒.*150 秒/); await shot(p, '07-objectives');
  });
  await check('Readiness changes return to the same final briefing; keyboard page navigation and confirmation preserve chapter', async () => {
    await p.click('[data-flow-action="workshop"]'); assert.equal(await p.locator('#workshopPanel').isVisible(), true);
    await p.locator('#workshopPanel .close-panel').first().click(); assert.equal((await snapshot(p)).page, 3);
    assert.equal(await p.locator('#sortieFlow').isVisible(), true);
    await p.locator('[data-brief-page="3"]').focus(); await p.keyboard.press('ArrowLeft'); assert.equal((await snapshot(p)).page, 2);
    await p.keyboard.press('End'); assert.equal((await snapshot(p)).page, 3);
    await next(p); assert.equal((await snapshot(p)).chapter, 'shield');
    await p.click('#pauseBtn'); await p.click('#exitBtn'); assert.equal(await p.locator('#menu').isVisible(), true);
  });
  await check('Quick-map selection persists and leaves the fixed campaign geography unchanged', async () => {
    await p.click('#startBtn'); await p.click('[data-category="quick"]'); await next(p); await p.click('[data-sortie-map="ice-ocean"]');
    await p.click('[data-mission="intercept"]'); await next(p); await p.click('[data-brief-page="3"]'); await next(p);
    assert.equal((await snapshot(p)).map, 'ice-ocean');
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('frostline-settings')).map), 'ice-ocean');
    await p.click('#pauseBtn'); await p.click('#exitBtn'); await p.reload();
    await p.waitForFunction(() => !!window.__sortieQA, null, { timeout: 60000, polling: 100 });
    await p.click('#startBtn'); await next(p);
    assert.equal(await p.locator('[data-sortie-map="ice-ocean"]').getAttribute('aria-pressed'), 'true');
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  });
  await check('Both new ships retain separate saved readiness and launch through training with original controls', async () => {
    for (const ship of ['burke', 'type052d']) {
      await p.click(`[data-vehicle="${ship}"]`); await draw(p); await p.click('#startBtn');
      assert.equal(await p.locator('[data-category="campaign"]').isDisabled(), true);
      await p.click('[data-category="training"]'); await next(p); await p.click('[data-mission="naval-training"]'); await next(p);
      await p.click('[data-brief-page="3"]'); await next(p); const s = await snapshot(p);
      assert.equal(s.ship, ship); assert.equal(s.mode, 'naval-training'); assert.equal(s.enemies, 2);
      await p.evaluate(() => { for(let step=0;step<150;step++)window.__sortieQA.sim.update(1/60); });
      await p.keyboard.press('r'); assert.equal(await p.evaluate(() => window.__sortieQA.sim.missiles.some(m => m.weapon === 'anti-ship')), true);
      await p.click('#pauseBtn'); await p.click('#exitBtn');
    }
    await shot(p, '08-original-naval-base');
  });
  await check('Missing anti-ship stores block sortie; real workshop presets restore readiness without losing the task', async () => {
    await p.click('[data-vehicle="aircraft"]'); await p.click('#workshopBtn'); await p.click('[data-preset="clean"]');
    await p.locator('#workshopPanel .close-panel').first().click(); await p.click('#startBtn');
    await p.click('[data-category="quick"]'); await next(p); await p.click('[data-mission="naval"]'); await next(p); await p.click('[data-brief-page="3"]');
    assert.equal(await p.locator('[data-flow-action="next"]').isDisabled(),true); assert.match(await p.locator('.sortie-blocked').innerText(),/反舰导弹/);
    await p.click('[data-flow-action="workshop"]'); await p.click('[data-preset="multirole"]'); await p.locator('#workshopPanel .close-panel').first().click();
    assert.equal((await snapshot(p)).page,3); assert.equal(await p.locator('[data-flow-action="next"]').isEnabled(),true);
    assert.equal(await p.locator('#sortieTitle').innerText(),'确认作战目标');
    await next(p); assert.equal((await snapshot(p)).mode,'naval'); assert.equal((await snapshot(p)).aircraft,'fa18c');
  });
  await context.close();
  for (const [viewport, name] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 844, height: 390 }, 'landscape']]) {
    const mobile = await open(viewport, { vehicle: 'j16', touch: true }), mp = mobile.p;
    await check(`${name} can complete modes, task selection and all full-screen briefing pages without horizontal overflow`, async () => {
      await mp.click('#startBtn'); await assertLayout(mp); await shot(mp, `09-${name}-modes`);
      await mp.click('[data-category="quick"]'); await next(mp); await assertLayout(mp);
      await next(mp);
      for (let page = 0; page < 4; page++) { await mp.click(`[data-brief-page="${page}"]`); await assertLayout(mp); }
      await shot(mp, `10-${name}-objectives`); await next(mp); assert.equal((await snapshot(mp)).aircraft, 'j16');
      await mp.click('#pauseBtn'); await mp.click('#exitBtn');
    });
    await mobile.context.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ checks: checks.length, errors }));
} finally {
  await writeFile(new URL('browser-report.json', out), JSON.stringify({ checks, errors, boundary: 'Real WebGL browser; mobile viewport and touch are emulated. A fixture completes chapter one to check transition; it is not a human-played victory.' }, null, 2));
  await browser.close();
}
