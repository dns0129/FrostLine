import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { CAMPAIGN_LEVELS, CAMPAIGN_SAVE_KEY } from '../campaign.js';
import { getMap } from '../maps.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = new URL('../verification/campaign-v2/', import.meta.url);
await mkdir(out, { recursive: true });
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], errors = [], metrics = {};
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function open(viewport, vehicle = 'aircraft') {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, serviceWorkers: 'block' });
  await context.addInitScript(vehicle => {
    window.__now = 0; window.requestAnimationFrame = () => 0;
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    if (!localStorage.getItem('frostline-settings')) localStorage.setItem('frostline-settings', JSON.stringify({ vehicle, quality: 'low', sound: false, difficulty: 'easy', map: 'city-bay' }));
  }, vehicle);
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript',
    body: source + '\nwindow.__campaignQA={sim,world,sortie,result,frame,readouts,input};' }));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8778');
  await page.waitForFunction(() => !!window.__campaignQA, null, { timeout: 60000, polling: 100 });
  return { page, context };
}
const next = page => page.locator('[data-flow-action="next"]').click();
async function draw(page) { await page.evaluate(() => { window.__now += 200; window.__campaignQA.frame(window.__now); }); }
async function layout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#sortieFlow').evaluate(e => e.scrollWidth > e.clientWidth), false);
  const r = await page.locator('.sortie-footer [data-flow-action="next"]').boundingBox(), v = page.viewportSize();
  assert.ok(r.x >= 0 && r.x + r.width <= v.width + 1 && r.y + r.height <= v.height + 1);
}
const snapshot = page => page.evaluate(() => {
  const { sim, world } = window.__campaignQA;
  return { state: sim.state, chapter: sim.campaignId, time: sim.time, wave: sim.wave, map: world.mapId,
    allies: sim.allies.length, enemies: sim.enemies.length, carrier: sim.carrier?.health,
    airKills: sim.campaignState?.airKills, shipKills: sim.campaignState?.shipKills,
    credits: JSON.parse(localStorage.getItem('frostline-workshop-v1'))?.credits ?? 1200,
    progress: JSON.parse(localStorage.getItem('frostline-campaign-v2') || 'null'), gl: world.renderer.getContext().getError() };
});
async function clearFixture(page) {
  await page.evaluate(() => {
    const { sim, result } = window.__campaignQA;
    for (let wave = 0; wave < 5 && sim.state === 'playing'; wave++) {
      sim.enemies.forEach(e => e.health = 0); sim.update(1 / 60);
      for (let step = 0; step < 300 && !sim.enemies.length && sim.wave < 5 && sim.state === 'playing'; step++) sim.update(1 / 60);
    }
    if (sim.carrier && sim.state === 'playing') {
      sim.time = sim.campaignId === 'shield' ? 180 : 240; sim._updateCampaignFleet();
      sim.player.pos.copy(sim.campaignState.objectivePos).setY(1250); sim.update(1 / 60);
    }
    if (sim.state !== 'won') throw Error('Clear fixture failed: ' + sim.campaignId + ' / ' + sim.endReason);
    result();
  });
}
try {
  const { page, context } = await open({ width: 1440, height: 900 });
  await check('Campaign selection shows ten route nodes, distinct map names, rewards and readable locked briefings', async () => {
    await page.click('#startBtn'); await page.click('[data-category="campaign"]'); await next(page);
    assert.equal(await page.locator('[data-mission]').count(), 10); assert.equal(await page.locator('.campaign-chart-node').count(), 10);
    for (const level of CAMPAIGN_LEVELS) {
      await page.locator(`[data-mission="${level.id}"]`).click(); await next(page);
      for (let i = 0; i < 4; i++) { await page.click(`[data-brief-page="${i}"]`); await layout(page); }
      assert.ok((await page.locator('.sortie-confirmation').innerText()).includes(getMap(level.mapId).name));
      assert.ok((await page.locator('.sortie-confirmation').innerText()).includes(`+${level.rewardPoints}`));
      assert.equal(await page.locator('[data-flow-action="next"]').isEnabled(), level.number === 1);
      await page.locator('.sortie-header .flow-back').click();
    }
    await page.click('[data-mission="dawn"]'); await page.screenshot({ path: new URL('01-ten-chapters.png', out).pathname });
  });
  await next(page);
  for (const level of CAMPAIGN_LEVELS) {
    await check(`Chapter ${level.number}: confirms ${getMap(level.mapId).name}, launches actual air/sea wave and four-plane squad`, async () => {
      await page.click('[data-brief-page="3"]'); await next(page); await draw(page);
      const s = await snapshot(page); assert.equal(s.state, 'playing'); assert.equal(s.chapter, level.id); assert.equal(s.map, level.mapId);
      assert.equal(s.allies, 3); assert.equal(s.gl, 0);
      assert.equal(await page.evaluate(() => window.__campaignQA.world.enemies.size), level.waves[0] + level.shipWaves[0] + 3);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('frostline-settings')).map), 'city-bay');
    });
    if (level.number === 1) {
      await check('Real keyboard F launches a locked missile; physical flight/hit records the first kill', async () => {
        await page.evaluate(() => {
          const { sim } = window.__campaignQA;
          sim.allies.forEach(a => { a.fireTimer = a.missileTimer = 100000; });
          sim.enemies.forEach(e => e.passive = true);
          const e = sim.enemies[0]; e.pos.copy(sim.player.pos); e.pos.z -= 1000; e.health = 60;
          for (let step = 0; step < 100; step++) sim.update(1 / 60);
          if (sim.lockProgress < 1) throw Error('No physical radar lock');
        });
        const before = await page.evaluate(() => window.__campaignQA.sim.player.missiles);
        await page.keyboard.press('f');
        assert.equal(await page.evaluate(() => window.__campaignQA.sim.player.missiles), before - 1);
        await page.evaluate(() => { const { sim } = window.__campaignQA; for (let step = 0; step < 300 && !sim.kills; step++) sim.update(1 / 60); });
        assert.ok((await snapshot(page)).airKills >= 1);
        await draw(page); await page.screenshot({ path: new URL('02-four-plane-flight.png', out).pathname });
      });
    }
    if (level.number === 2) {
      await check('Carrier destruction fails without unlocking chapter three or paying a completion bonus; retry restores it', async () => {
        await page.evaluate(() => { const { sim, result } = window.__campaignQA; sim.carrier.health = 0; sim.update(1 / 60); result(); });
        assert.equal((await snapshot(page)).state, 'lost');
        assert.ok((await page.locator('#resultDescription').innerText()).includes('企业号被击沉'));
        assert.equal((await snapshot(page)).progress.completed.shield, undefined);
        await page.click('#againBtn'); await draw(page); assert.equal((await snapshot(page)).carrier, 2200);
        await page.screenshot({ path: new URL('03-carrier-retreat.png', out).pathname });
      });
      await check('Pause freezes carrier movement, wingmen and mission time', async () => {
        await page.click('#pauseBtn'); const before = await snapshot(page);
        await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__campaignQA.sim.update(1 / 60); });
        assert.deepEqual(await snapshot(page), before); await page.click('#resumeBtn');
      });
    }
    if (level.number === 10) {
      await check('Final core commander renders distinctly; destroying only the commander leaves escorts active', async () => {
        await page.evaluate(() => { const { sim } = window.__campaignQA;
          for (let wave = 1; wave < 5; wave++) { sim.enemies.forEach(e => e.health = 0); sim.update(1 / 60);
            for (let i = 0; i < 300 && !sim.enemies.length; i++) sim.update(1 / 60); }
        }); await draw(page);
        assert.equal(await page.evaluate(() => { const { sim, world } = window.__campaignQA; return world.enemies.get(sim.enemies.find(e => e.commander).id).scale.x; }), 1.3);
        await page.screenshot({ path: new URL('04-final-core.png', out).pathname });
        await page.evaluate(() => { const { sim } = window.__campaignQA; sim.enemies.find(e => e.commander).health = 0; sim.update(1 / 60); });
        assert.equal((await snapshot(page)).state, 'playing');
      });
    }
    await check(`Chapter ${level.number}: clear fixture saves ordered progress, pays +${level.rewardPoints} points exactly once and opens next briefing`, async () => {
      const before = (await snapshot(page)).credits;
      await clearFixture(page); const after = await snapshot(page);
      assert.equal(after.airKills, level.airTotal); assert.equal(after.shipKills, level.shipTotal);
      assert.ok(after.progress.completed[level.id]); assert.ok(after.credits >= before + level.rewardPoints);
      assert.match(await page.locator('#resultDescription').innerText(), new RegExp(`通关奖励 ${level.rewardPoints} 点`));
      await page.evaluate(() => window.__campaignQA.result()); assert.equal((await snapshot(page)).credits, after.credits);
      metrics[level.id] = after;
      if (level.number < 10) { await page.click('#campaignNextBtn'); assert.equal((await snapshot(page)).state, 'menu');
        assert.equal(await page.locator('#sortieTitle').innerText(), CAMPAIGN_LEVELS[level.number].title);
      } else { assert.equal(await page.locator('#resultTitle').innerText(), '暗潮行动 · 战役完成'); assert.equal(await page.locator('#campaignNextBtn').isVisible(), false); }
    });
  }
  await page.screenshot({ path: new URL('05-campaign-complete.png', out).pathname });
  await check('Earned points purchase a persistent engine upgrade and all ten chapter records survive reload', async () => {
    await page.click('#resultExitBtn'); await page.click('#workshopBtn');
    const before = (await snapshot(page)).credits;
    await page.click('[data-upgrade="engine"]');
    assert.equal((await snapshot(page)).credits, before - 300);
    await page.reload(); await page.waitForFunction(() => !!window.__campaignQA, null, { polling: 100 });
    const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('frostline-workshop-v1')));
    assert.equal(profile.levels.engine, 1); assert.equal(profile.credits, before - 300);
    assert.equal(Object.keys((await snapshot(page)).progress.completed).length, 10);
    assert.equal((await snapshot(page)).progress.version, 2);
  });
  await context.close();
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const { page, context } = await open(viewport, 'j16');
    await check(`${viewport.width}x${viewport.height}: ten selectable chapters, four briefing pages, reachable launch and J-16 squad sortie`, async () => {
      await page.click('#startBtn'); await page.click('[data-category="campaign"]'); await next(page);
      await layout(page); await page.click('[data-mission="finale"]'); await next(page);
      for (let i = 0; i < 4; i++) { await page.click(`[data-brief-page="${i}"]`); await layout(page); }
      assert.equal(await page.locator('[data-flow-action="next"]').isDisabled(), true);
      await page.locator('.sortie-header .flow-back').click(); await page.click('[data-mission="dawn"]'); await next(page);
      await page.screenshot({ path: new URL(`briefing-${viewport.width}x${viewport.height}.png`, out).pathname });
      await page.click('[data-brief-page="3"]'); await next(page); await draw(page);
      const s = await snapshot(page); assert.equal(s.state, 'playing'); assert.equal(s.allies, 3); assert.equal(s.gl, 0);
      assert.equal(await page.evaluate(() => window.__campaignQA.sim.player.aircraftId), 'j16');
    }); await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL('metrics.json', out), JSON.stringify({ checks, errors, metrics,
    boundary: 'One real locked missile uses keyboard F and physical combat. Remaining wins use explicit clear fixtures; mobile viewports are emulated, not device FPS measurements.' }, null, 2));
  await browser.close();
}
console.log(`PASS ${checks.length} campaign browser checks`);
