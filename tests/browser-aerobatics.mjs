import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: 'aircraft', quality: 'low', sound: false }));
  });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__aeroQA={sim,world,start,input};' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8780');
  await page.waitForFunction(() => !!window.__aeroQA, null, { timeout: 60000, polling: 100 });
  for (const [pitchKey, rollKey] of [['s', 'a'], ['w', 'd']]) {
    await page.evaluate(() => { const { start, sim } = window.__aeroQA; start('training'); sim.player.pos.set(0, 3200, 0); });
    await page.keyboard.down(pitchKey); await page.keyboard.down('Shift');
    const loop = await page.evaluate(() => {
      const { sim, world, input } = window.__aeroQA;
      let travel = 0, previous = sim.player.pitch;
      for (let frame = 0; frame < 1800 && Math.abs(travel) < Math.PI * 2; frame++) {
        sim._updatePlayer(1 / 60, input.read());
        travel += Math.atan2(Math.sin(sim.player.pitch - previous), Math.cos(sim.player.pitch - previous)); previous = sim.player.pitch;
        if (frame % 60 === 0) world.render(sim, 1 / 60, { cockpit: frame % 120 === 0 });
      }
      return { travel, gl: world.renderer.getContext().getError() };
    });
    assert.ok(Math.abs(loop.travel) >= Math.PI * 2); assert.equal(loop.gl, 0);
    await page.keyboard.down(rollKey);
    const roll = await page.evaluate(() => {
      const { sim, world, input } = window.__aeroQA;
      let travel = 0, previous = sim.player.bank;
      for (let frame = 0; frame < 720; frame++) {
        sim._updatePlayer(1 / 60, input.read());
        travel += Math.atan2(Math.sin(sim.player.bank - previous), Math.cos(sim.player.bank - previous)); previous = sim.player.bank;
        if (frame % 60 === 0) world.render(sim, 1 / 60);
      }
      return { travel, gl: world.renderer.getContext().getError() };
    });
    assert.ok(Math.abs(roll.travel) > Math.PI * 2); assert.equal(roll.gl, 0);
    await page.keyboard.up(rollKey); await page.keyboard.up(pitchKey); await page.keyboard.up('Shift');
  }
  assert.deepEqual(errors, []);
  console.log('PASS keyboard pull-up/push-over loops, combined rolls, chase/cockpit rendering and WebGL');
} finally { await browser.close(); }
