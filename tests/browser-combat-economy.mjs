import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../verification/combat-economy/', import.meta.url);
await mkdir(out, { recursive: true });
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], errors = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
const next = page => page.locator('[data-flow-action="next"]').click();
const wallet = page => page.evaluate(() => JSON.parse(localStorage.getItem('frostline-workshop-v1')));
async function draw(page) { await page.evaluate(() => { window.__now += 100; window.__combatQA.frame(window.__now); }); }
async function shot(page, name) { await page.screenshot({ path: new URL(name + '.png', out).pathname }); }
async function open(viewport, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__now = 0; window.requestAnimationFrame = () => 0;
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    if (!localStorage.getItem('frostline-settings')) localStorage.setItem('frostline-settings', JSON.stringify({ quality: 'low', sound: false, map: 'city-bay', difficulty: 'normal' }));
    if (!localStorage.getItem('frostline-workshop-v1')) localStorage.setItem('frostline-workshop-v1', JSON.stringify({ version: 1, credits: 1200, xp: 399, levels: { engine: 1 } }));
  });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
    body: source + '\nwindow.__combatQA={sim,world,start,base,result,frame,readouts,sortie,input};' }));
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8778');
  await page.waitForFunction(() => !!window.__combatQA, null, { timeout: 60000, polling: 100 });
  return { context, page };
}
async function layout(page, selectors) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const viewport = page.viewportSize();
  for (const selector of selectors) {
    const box = await page.locator(selector).boundingBox(); assert.ok(box, selector + ' visible');
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1 && box.y >= 0 && box.y + box.height <= viewport.height + 1, selector + ' within viewport');
    const hits = await page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); });
    assert.equal(hits, true, selector + ' is reachable');
  }
}
try {
  const { page, context } = await open({ width: 1440, height: 900 });
  await check('Old points migrate once to silver; XP, upgrades and the starter gold survive reload', async () => {
    let p = await wallet(page); assert.equal(p.version, 2); assert.equal(p.silver, 1200); assert.equal(p.gold, 25); assert.equal(p.levels.engine, 1); assert.equal(p.xp, 399);
    await layout(page, ['#arsenalBtn', '#workshopBtn', '#settingsBtn']); await shot(page, '01-base-wallet');
    await page.reload(); await page.waitForFunction(() => !!window.__combatQA, null, { polling: 100 });
    assert.deepEqual(await wallet(page), p);
  });
  await check('Six ammunition cards expose damage, silver/gold cost and selection without charging the wallet', async () => {
    await page.click('#arsenalBtn'); assert.equal(await page.locator('[data-ammo-grade]').count(), 6);
    assert.match(await page.locator('#arsenalChoices').innerText(), /30 银币/); assert.match(await page.locator('#arsenalChoices').innerText(), /4 金币/);
    await page.click('[data-ammo-kind="missile"][data-ammo-grade="silver"]'); await page.click('[data-ammo-kind="gun"][data-ammo-grade="gold"]');
    const p = await wallet(page); assert.equal(p.silver, 1200); assert.equal(p.gold, 25); assert.deepEqual(p.ammoTiers, { missile: 'silver', gun: 'gold' });
    await shot(page, '02-ammo-tiers'); await page.locator('#arsenalPanel .panel-top .close-panel').click();
    await page.click('#workshopBtn'); assert.match(await page.locator('#workshopXp').innerText(), /399 \/ 400 XP.*1 XP/);
    await page.locator('#workshopPanel .panel-top .close-panel').click();
  });
  await check('The real sortie flow launches distant opponents, doubled HP and selected ammunition', async () => {
    await page.click('#startBtn'); await page.click('[data-category="quick"]'); await next(page);
    await page.click('[data-mission="intercept"]'); await next(page); await page.click('[data-brief-page="3"]'); await next(page);
    const state = await page.evaluate(() => { const { sim } = window.__combatQA; return { state: sim.state, hp: sim.player.health, ranges: sim.enemies.map(e => e.pos.distanceTo(sim.player.pos)), tiers: sim.ammoTiers }; });
    assert.equal(state.state, 'playing'); assert.equal(state.hp, 200); assert.ok(state.ranges.every(n => n >= 3799));
    assert.deepEqual(state.tiers, { missile: 'silver', gun: 'gold' }); await draw(page);
    await layout(page, ['#gunGradeBtn', '#missileGradeBtn', '#pauseBtn']); await shot(page, '03-combat-wallet');
  });
  await check('Keyboard missile launch charges only after lock and leaves silver unchanged during cooldown', async () => {
    await page.keyboard.press('f'); assert.equal((await wallet(page)).silver, 1200);
    await page.evaluate(() => { const { sim } = window.__combatQA, e = sim.enemies[0]; sim.enemies = [e];
      sim._updateEnemies = () => {}; sim._updatePlayer = () => {}; e.pos.copy(sim.player.pos); e.pos.z -= 1000; e.vel.set(0, 0, 0); e.health = 1000;
      sim.targetId = e.id; sim._updateLock(2); });
    await page.keyboard.press('f'); assert.equal((await wallet(page)).silver, 1170);
    await page.keyboard.press('f'); assert.equal((await wallet(page)).silver, 1170);
    assert.equal(await page.evaluate(() => window.__combatQA.sim.missiles[0].ammoGrade), 'silver');
  });
  await check('A real cannon key press spends gold per shot and pause preserves balance and time', async () => {
    const shots = await page.evaluate(() => window.__combatQA.sim.shots);
    await page.keyboard.down('Space'); await draw(page); await page.keyboard.up('Space');
    const fired = await page.evaluate(before => window.__combatQA.sim.shots - before, shots); assert.ok(fired >= 1);
    assert.equal((await wallet(page)).gold, 25 - fired);
    await page.click('#pauseBtn'); const before = await wallet(page), time = await page.evaluate(() => window.__combatQA.sim.time);
    await page.keyboard.press('f'); await draw(page); assert.deepEqual(await wallet(page), before);
    assert.equal(await page.evaluate(() => window.__combatQA.sim.time), time); await page.click('#resumeBtn');
  });
  await check('Restart and browser reload retain ammo spending and preferences without refunding starter funds', async () => {
    const before = await wallet(page);
    await page.evaluate(() => window.__combatQA.start('intercept')); assert.equal((await wallet(page)).silver, before.silver); assert.equal((await wallet(page)).gold, before.gold);
    await page.reload(); await page.waitForFunction(() => !!window.__combatQA, null, { polling: 100 });
    assert.equal((await wallet(page)).silver, before.silver); assert.equal((await wallet(page)).gold, before.gold);
  });
  await check('Low funds fall back to unlimited basic rounds, update the HUD and save the new selection', async () => {
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('frostline-workshop-v1')); p.silver = 0; p.gold = 0; localStorage.setItem('frostline-workshop-v1', JSON.stringify(p)); });
    await page.reload(); await page.waitForFunction(() => !!window.__combatQA, null, { polling: 100 });
    await page.evaluate(() => { const { start, sim } = window.__combatQA; start('intercept');
      const e = sim.enemies[0]; sim.enemies = [e]; sim._updateEnemies = () => {}; sim._updatePlayer = () => {};
      e.pos.copy(sim.player.pos); e.pos.z -= 1000; e.health = 1000; e.vel.set(0, 0, 0);
      sim.player.stores.forEach(s => s.count = 0); sim._refreshAircraftStores(); sim.player.ammo = 0; sim.targetId = e.id; sim._updateLock(2); });
    await page.keyboard.press('f'); await page.keyboard.down('Space'); await draw(page); await page.keyboard.up('Space');
    const p = await wallet(page); assert.equal(p.silver, 0); assert.equal(p.gold, 0); assert.deepEqual(p.ammoTiers, { missile: 'basic', gun: 'basic' });
    assert.match(await page.locator('#missileGradeBtn').innerText(), /免费/); assert.equal(await page.locator('#ammoValue').innerText(), '∞');
    assert.equal(await page.evaluate(() => window.__combatQA.sim.player.ammo), 0);
  });
  await check('Win settlement grants currency and XP once, shows the new level, and keeps earned funds on the next sortie', async () => {
    await page.evaluate(() => { const { sim, result } = window.__combatQA; sim.kills = 9; sim.score = 3000; sim.state = 'won'; result(); });
    const win = await wallet(page); assert.equal(win.silver, 1090); assert.equal(win.gold, 8); assert.equal(win.xp, 1699);
    assert.match(await page.locator('#resultDescription').innerText(), /1090 银币.*8 金币.*1300 XP.*升至 3 级/);
    await page.evaluate(() => window.__combatQA.result()); assert.deepEqual(await wallet(page), win);
    await page.click('#againBtn'); assert.equal((await wallet(page)).silver, win.silver); assert.equal((await wallet(page)).gold, win.gold);
    await page.evaluate(() => window.__combatQA.base()); await page.click('#workshopBtn');
    assert.match(await page.locator('#workshopRank').innerText(), /3 级/); assert.match(await page.locator('#workshopXp').innerText(), /699 \/ 800 XP/);
    await shot(page, '04-level-progress'); await page.locator('#workshopPanel .panel-top .close-panel').click();
  });
  await check('Training uses free basic ammunition without changing saved premium preferences or balances', async () => {
    await page.click('#arsenalBtn'); await page.click('[data-ammo-kind="gun"][data-ammo-grade="gold"]'); await page.locator('#arsenalPanel .panel-top .close-panel').click();
    const before = await wallet(page); await page.evaluate(() => window.__combatQA.start('training'));
    await page.keyboard.down('Space'); await draw(page); await page.keyboard.up('Space');
    assert.equal((await wallet(page)).gold, before.gold); assert.equal((await wallet(page)).ammoTiers.gun, 'gold');
    assert.match(await page.locator('#gunGradeBtn').innerText(), /训练免费/); assert.equal(await page.locator('#gunGradeBtn').isDisabled(), true);
  });
  await context.close();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { page, context } = await open(viewport, true);
    await check(`${viewport.width}×${viewport.height}: wallet and grade buttons remain accessible on touch screens`, async () => {
      await layout(page, ['#arsenalBtn', '#workshopBtn', '#settingsBtn', '[data-base="aircraft"]', '[data-base="destroyer"]']); await shot(page, `05-base-${viewport.width}`);
      await page.click('#arsenalBtn'); assert.equal(await page.locator('[data-ammo-grade]').count(), 6);
      assert.equal(await page.locator('#arsenalPanel').evaluate(e => e.scrollWidth > e.clientWidth), false);
      await page.locator('[data-ammo-kind="gun"][data-ammo-grade="silver"]').scrollIntoViewIfNeeded(); await page.click('[data-ammo-kind="gun"][data-ammo-grade="silver"]');
      assert.equal((await wallet(page)).ammoTiers.gun, 'silver'); await shot(page, `06-arsenal-${viewport.width}`);
      await page.locator('#arsenalPanel .panel-top .close-panel').click();
      await page.evaluate(() => window.__combatQA.start('intercept')); await draw(page);
      await layout(page, ['#gunGradeBtn', '#missileGradeBtn', '#pauseBtn']); await shot(page, `07-hud-${viewport.width}`);
    });
    await context.close();
  }
  assert.deepEqual(errors, []); console.log(`PASS ${checks.length} browser checks; no page/resource errors`);
  await writeFile(new URL('results.json', out), JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
