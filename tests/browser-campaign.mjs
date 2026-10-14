import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'verification/campaign');
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL('/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs').href);
const browser = await chromium.launch({ executablePath: '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell', headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const source = await readFile(resolve(root, 'app.js'), 'utf8'), baseURL = process.env.BASE_URL || 'http://127.0.0.1:8778';
const report = { baseURL, checks: [], errors: [], metrics: {}, boundary: 'One kill uses a real locked missile and keyboard F. Later mission transitions use explicit simulation fixtures; they do not prove full human-played victories. Mobile sizes are emulated.' };
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
async function open(viewport, ship = false) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, serviceWorkers: 'block' });
  await context.addInitScript(ship => localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: ship ? 'destroyer' : 'aircraft', quality: 'auto', sound: false, difficulty: 'easy' })), ship);
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__campaignQA={sim,world,result};' }));
  const page = await context.newPage(); page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__campaignQA);
  return { page, context };
}
async function snapshot(page) { return page.evaluate(() => {
  const { sim, world } = window.__campaignQA;
  return { state: sim.state, mode: sim.mode, chapter: sim.campaignId, vehicle: sim.vehicle, time: sim.time, kills: sim.kills, wave: sim.wave,
    campaign: JSON.parse(JSON.stringify(sim.campaignState)), targets: sim.enemies.map(e => ({ name: e.name, commander: e.commander, health: e.health })), fleet: sim.ambientShips.length,
    progress: JSON.parse(localStorage.getItem('frostline-campaign-v1') || 'null'), glError: world.renderer.getContext().getError() };
}); }
async function fixtureClear(page) { await page.evaluate(() => {
  const { sim, result } = window.__campaignQA;
  for (let wave = 0; wave < 4 && sim.state === 'playing'; wave++) {
    sim.enemies.forEach(e => e.health = 0); sim.update(1 / 60);
    for (let step = 0; step < 300 && !sim.enemies.length && sim.state === 'playing'; step++) sim.update(1 / 60);
  }
  if (sim.state !== 'won') throw Error('Fixture did not satisfy the mission victory conditions'); result();
}); }
try {
  const { page, context } = await open({ width: 1440, height: 900 }, true);
  await check('Campaign mode opens from naval base, selects aircraft, displays three chapters and ordered locks', async () => {
    await page.locator('#quickBriefing [data-play-mode="campaign"]').click();
    assert.equal(await page.locator('#campaignPanel').isVisible(), true); assert.equal(await page.locator('[data-vehicle="aircraft"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-campaign]').count(), 3); assert.equal(await page.locator('#campaignProgress').innerText(), '战役进度 0 / 3');
    assert.equal(await page.locator('#campaignStartBtn').isEnabled(), true);
  }); await page.screenshot({ path: resolve(out, 'desktop-campaign-overview.png') });
  await check('Locked chapters have readable story and briefing while sortie remains disabled', async () => {
    await page.locator('[data-campaign="finale"]').click(); assert.equal(await page.locator('#campaignTitle').innerText(), '灰潮终局');
    assert.equal(await page.locator('#campaignStartBtn').isEnabled(), false); await page.locator('#campaignBriefingBtn').click();
    assert.ok((await page.locator('#chapterBriefingRules').innerText()).includes('210 秒')); assert.equal(await page.locator('#chapterBriefingStart').isEnabled(), false);
    await page.screenshot({ path: resolve(out, 'desktop-final-briefing.png') }); await page.locator('#campaignBriefingPanel .close-panel').click();
  });
  await check('Chapter-one briefing launches its actual two-target mission and keeps six sailing ships', async () => {
    await page.locator('[data-campaign="dawn"]').click(); await page.locator('#campaignBriefingBtn').click(); await page.locator('#chapterBriefingStart').click();
    await page.waitForFunction(() => window.__campaignQA.sim.time > .1); const s = await snapshot(page);
    assert.equal(s.chapter, 'dawn'); assert.equal(s.targets.length, 2); assert.equal(s.vehicle, 'aircraft'); assert.equal(s.fleet, 6); assert.equal(s.glError, 0);
    await page.screenshot({ path: resolve(out, 'desktop-chapter-one-flight.png') });
  });
  await check('A real F missile lock, launch and hit defeats the first scout and records a kill', async () => {
    await page.waitForFunction(() => window.__campaignQA.sim.lockProgress >= 1, { timeout: 15000 });
    await page.keyboard.press('f'); await page.waitForFunction(() => window.__campaignQA.sim.kills >= 1, { timeout: 20000 });
    const s = await snapshot(page); assert.equal(s.chapter, 'dawn'); assert.ok(s.kills >= 1); report.metrics.realMissileKill = s;
  });
  await check('Pause freezes mission clock, campaign credit and radio state', async () => {
    await page.locator('#pauseBtn').click(); const before = await snapshot(page);
    await page.evaluate(() => new Promise(resolve => { let n = 0; function frame() { if (++n > 8) resolve(); else requestAnimationFrame(frame); } requestAnimationFrame(frame); }));
    const after = await snapshot(page); assert.equal(after.time, before.time); assert.deepEqual(after.campaign, before.campaign);
    await page.locator('#resumeBtn').click();
  });
  await check('Victory fixture unlocks chapter two, saves stars and follows the next-chapter button', async () => {
    await fixtureClear(page); const s = await snapshot(page); assert.equal(s.state, 'won'); assert.ok(s.progress.completed.dawn);
    await page.screenshot({ path: resolve(out, 'desktop-chapter-one-fixture-result.png') }); await page.locator('#campaignNextBtn').click();
    assert.equal((await snapshot(page)).chapter, 'shield'); assert.ok((await page.locator('#objective').innerText()).includes('坚守'));
    await page.screenshot({ path: resolve(out, 'desktop-chapter-two-flight.png') });
  });
  await check('Defence failure fixture does not unlock chapter three and retry resets the mission', async () => {
    await page.evaluate(() => { const { sim, result } = window.__campaignQA; sim.player.pos.x += 7000; sim.campaignState.outsideFor = 9.99; sim.update(1 / 60); if (sim.state !== 'lost' || sim.endReason !== 'airspace') throw Error('Airspace failure not enforced'); result(); });
    assert.equal((await snapshot(page)).progress.completed.shield, undefined); assert.equal(await page.locator('#campaignNextBtn').isVisible(), false);
    await page.locator('#againBtn').click(); const s = await snapshot(page); assert.equal(s.chapter, 'shield'); assert.equal(s.state, 'playing'); assert.ok(s.campaign.guardElapsed < 1); assert.equal(s.campaign.outsideFor, 0);
  });
  await check('Defence victory fixture unlocks chapter three with independent objectives', async () => {
    await page.evaluate(() => { const { sim, result } = window.__campaignQA; sim.campaignState.guardElapsed = 90; sim.kills = 6; sim.player.pos.copy(sim.campaignState.objectivePos); sim.player.pos.y = 1250; sim.update(1 / 60); if (sim.state !== 'won') throw Error('Defence objectives unmet'); result(); });
    assert.ok((await snapshot(page)).progress.completed.shield); await page.locator('#campaignNextBtn').click();
    assert.equal((await snapshot(page)).chapter, 'finale'); assert.equal(await page.locator('#modeLabel').innerText(), 'CAMPAIGN');
  });
  await check('Final commander renders larger with distinct identity; its death alone is insufficient and escorts complete the campaign', async () => {
    await page.evaluate(() => { const { sim } = window.__campaignQA; for(let wave=0;wave<2;wave++){sim.enemies.forEach(e=>e.health=0);sim.update(1/60);for(let step=0;step<300&&!sim.enemies.length;step++)sim.update(1/60);} });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const boss = await page.evaluate(() => { const { sim, world } = window.__campaignQA; const b=sim.enemies.find(e=>e.commander);return { name:b?.name,health:b?.health,scale:world.enemies.get(b?.id)?.scale.x }; });
    assert.equal(boss.name, '灰潮指挥机'); assert.equal(boss.scale, 1.3); assert.ok(boss.health > 100);
    await page.screenshot({ path: resolve(out, 'desktop-chapter-three-commander.png') });
    await page.evaluate(() => {const {sim}=window.__campaignQA;sim.enemies.find(e=>e.commander).health=0;sim.update(1/60);}); assert.equal((await snapshot(page)).state, 'playing');
    await fixtureClear(page); assert.equal(await page.locator('#resultTitle').innerText(), '北境航线 · 战役完成'); assert.equal(await page.locator('#campaignNextBtn').isVisible(), false);
    await page.screenshot({ path: resolve(out, 'desktop-campaign-fixture-complete.png') });
  });
  await check('Reload restores all unlocked chapters and replay keeps best stars and scores', async () => {
    await page.locator('#resultExitBtn').click(); assert.equal(await page.locator('#campaignProgress').innerText(), '战役进度 3 / 3');
    const before = (await snapshot(page)).progress; await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#quickBriefing [data-play-mode="campaign"]').click();
    assert.equal(await page.locator('#campaignProgress').innerText(), '战役进度 3 / 3'); assert.deepEqual((await snapshot(page)).progress, before);
    await page.locator('[data-campaign="dawn"]').click(); assert.ok((await page.locator('#campaignStartBtn').innerText()).includes('重玩'));
  });
  await check('Choosing a ship returns to quick missions with naval training available', async () => {
    await page.locator('[data-vehicle="destroyer"]').click(); assert.equal(await page.locator('#quickBriefing').isVisible(), true); assert.equal(await page.locator('#campaignPanel').isVisible(), false);
    await page.locator('[data-mode="naval-training"]').click(); await page.locator('#startBtn').click(); const s = await snapshot(page);
    assert.equal(s.chapter, null); assert.equal(s.mode, 'naval-training'); assert.equal(s.targets.length, 2); assert.equal(s.glError, 0);
  }); await context.close();
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const { page, context } = await open(viewport);
    await check(`${viewport.width}x${viewport.height}: readable campaign, three selectable stories and reachable launch`, async () => {
      await page.locator('#quickBriefing [data-play-mode="campaign"]').click();
      for (const id of ['dawn', 'shield', 'finale']) { await page.locator(`[data-campaign="${id}"]`).scrollIntoViewIfNeeded(); await page.locator(`[data-campaign="${id}"]`).click(); assert.equal(await page.locator('#campaignStartBtn').isEnabled(), id === 'dawn'); }
      await page.locator('[data-campaign="dawn"]').click(); await page.locator('#campaignStartBtn').scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => { const p = document.getElementById('campaignPanel').getBoundingClientRect(), f = document.querySelector('.fleet-deck').getBoundingClientRect(); return { width: innerWidth, menuWidth: document.getElementById('menu').scrollWidth, panelLeft: p.left, panelRight: p.right, panelBottom: p.bottom, fleetTop: f.top }; });
      assert.ok(layout.menuWidth <= viewport.width); assert.ok(layout.panelLeft >= 0 && layout.panelRight <= viewport.width); assert.ok(layout.panelBottom <= layout.fleetTop + 1);
      report.metrics[`${viewport.width}x${viewport.height}`] = layout;
      await page.screenshot({ path: resolve(out, `campaign-${viewport.width}x${viewport.height}.png`) });
      await page.locator('#campaignStartBtn').click(); await page.waitForFunction(() => window.__campaignQA.sim.time > .1); const s = await snapshot(page);
      assert.equal(s.chapter, 'dawn'); assert.equal(s.glError, 0); assert.equal(s.fleet, 6);
    }); await context.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true; console.log(`PASS ${report.checks.length} campaign browser checks`);
} catch (error) { report.passed = false; report.failure = String(error); throw error;
} finally { await writeFile(resolve(out, 'metrics.json'), JSON.stringify(report, null, 2)); await browser.close(); }
