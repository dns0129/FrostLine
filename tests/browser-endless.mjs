import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: 'aircraft', quality: 'low', sound: false }));
  });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__endlessQA={sim};' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8778');
  await page.waitForFunction(() => !!window.__endlessQA, null, { timeout: 60000 });
  await page.click('#startBtn');
  await page.click('[data-category="quick"]');
  await page.click('[data-flow-action="next"]');
  await page.click('[data-mission="free"]');
  await page.click('[data-flow-action="next"]');
  await page.click('[data-brief-page="1"]');
  assert.match(await page.locator('#sortieFlow').innerText(), /热诱弹/);
  await page.click('[data-brief-page="3"]');
  await page.click('[data-flow-action="next"]');
  const result = await page.evaluate(() => {
    const { sim } = window.__endlessQA, p = sim.player;
    const initial = { missiles: p.missiles, flares: p.flares };
    p.health = 1; p.flares = 0; p.stores.forEach(s => { if (s.store !== 'tank') s.count = 0; });
    sim.enemies = []; sim._updateMission(1 / 60);
    const supply = { health: p.health, maxHealth: p.maxHealth, missiles: p.missiles, flares: p.flares };
    sim._updateMission(4.5);
    return { mode: sim.mode, wave: sim.wave, count: sim.enemies.length, initial, supply };
  });
  assert.equal(result.mode, 'free'); assert.equal(result.wave, 2); assert.equal(result.count, 3);
  assert.equal(result.supply.health, result.supply.maxHealth);
  assert.equal(result.supply.missiles, result.initial.missiles); assert.equal(result.supply.flares, result.initial.flares);
  assert.deepEqual(errors, []);
  console.log('PASS endless briefing, launch, full resupply and next wave in Chromium');
} finally { await browser.close(); }
