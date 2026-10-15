// End-to-end QA against the actual local game, including real WebGL and input.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.OUTPUT_DIR || resolve(root, 'verification/base')); await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs').href);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell', headless: true, args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8778';
const source = await readFile(resolve(root, 'app.js'), 'utf8');
const report = { baseURL, checks: [], errors: [], metrics: {}, boundary: 'Phone viewport and trusted touch events are emulated, not a physical-device frame-rate test.' };
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
async function open(viewport, touch = false, saved = 'aircraft') {
  const context = await browser.newContext({ viewport, hasTouch: touch, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.addInitScript(vehicle => !localStorage.getItem('frostline-settings') && localStorage.setItem('frostline-settings', JSON.stringify({ vehicle, sound: false, quality: 'auto' })), saved);
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__baseQA={baseScene,sim,world};' }));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__baseQA && !document.getElementById('menu').hidden);
  return { page, context };
}
async function snapshot(page) { return page.evaluate(() => {
  const { baseScene: b, sim, world } = window.__baseQA;
  return { vehicle: b.vehicle, yaw: b.yaw, pitch: b.pitch, zoom: b.zoom, sceneObjects: b.scene.children.length, state: sim.state, simVehicle: sim.vehicle, time: sim.time, ammo: sim.player.ammo, health: sim.player.health, missiles: sim.player.missiles, pos: sim.player.pos.toArray(), quality: world.effectiveQuality, glError: world.renderer.getContext().getError() };
}); }
async function bounds(page) { return page.evaluate(() => {
  const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  return { viewport: [innerWidth, innerHeight], menuWidth: document.getElementById('menu').scrollWidth, dossier: rect('.base-dossier'), briefing: rect('.briefing'), fleet: rect('.fleet-deck'), display: rect('#baseViewport') };
}); }
try {
  const { page, context } = await open({ width: 1440, height: 900 });
  await check('Desktop owned fleet and aircraft specifications match the loaded game', async () => {
    assert.equal(await page.locator('[data-vehicle]').count(), 3);
    assert.equal(await page.locator('#ownedVehicleName').innerText(), '大黄蜂');
    assert.ok((await page.locator('#ownedVehicleWeapons').innerText()).includes('M61A1 578 发'));
    const s = await snapshot(page); assert.equal(s.state, 'menu'); assert.equal(s.glError, 0);
  });
  await page.screenshot({ path: resolve(output, 'desktop-hangar.png') });
  await check('Drag, wheel, arrow-key and reset inspection preserve mission state', async () => {
    const before = await snapshot(page); const area = await page.locator('#baseViewport').boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2); await page.mouse.down(); await page.mouse.move(area.x + area.width / 2 + 90, area.y + area.height / 2 + 20, { steps: 6 }); await page.mouse.up();
    const moved = await snapshot(page); assert.notEqual(moved.yaw, before.yaw);
    await page.mouse.wheel(0, 160); assert.ok((await snapshot(page)).zoom > before.zoom);
    await page.locator('#baseViewport').press('ArrowRight'); assert.notEqual((await snapshot(page)).yaw, moved.yaw);
    await page.locator('#baseReset').click(); const after = await snapshot(page);
    assert.equal(after.zoom, 1); assert.equal(after.yaw, before.yaw);
    for (const key of ['ammo', 'health', 'missiles', 'time', 'state']) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(after.pos, before.pos);
  });
  await check('Naval base tabs, owned cards and real ship loadout stay in sync', async () => {
    await page.locator('[data-base="destroyer"]').click();
    assert.equal(await page.locator('#ownedVehicleName').innerText(), '霜卫');
    assert.equal(await page.locator('[data-vehicle="destroyer"]').getAttribute('aria-pressed'), 'true');
    assert.ok((await page.locator('#ownedVehicleWeapons').innerText()).includes('防空导弹 12 枚 · 反舰导弹 6 枚'));
    assert.equal((await snapshot(page)).vehicle, 'destroyer');
    const b = await bounds(page); assert.ok(b.briefing.bottom <= b.fleet.top, JSON.stringify(b)); assert.ok(b.dossier.bottom < b.fleet.top, JSON.stringify(b));
  });
  await page.screenshot({ path: resolve(output, 'desktop-naval.png') });
  await check('Ship selection persists across reload and does not consume equipment', async () => {
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__baseQA && !document.getElementById('menu').hidden);
    assert.equal(await page.locator('#ownedVehicleName').innerText(), '霜卫');
    assert.equal((await snapshot(page)).state, 'menu');
  });
  await check('Naval-training sortie starts with the selected ship and returns to the harbor', async () => {
    await page.locator('[data-mode="naval-training"]').click(); await page.locator('#startBtn').click();
    assert.equal(await page.locator('#menu').isVisible(), false);
    let s = await snapshot(page); assert.equal(s.simVehicle, 'destroyer'); assert.equal(s.state, 'playing'); assert.equal(s.ammo, 240);
    await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click();
    assert.equal(await page.locator('#menu').isVisible(), true); assert.equal((await snapshot(page)).vehicle, 'destroyer');
  });
  // Since 1.13 aircraft keep the sea missions (Harpoon / YJ-83K) and the Hornet carries 578 rounds.
  await check('Owned aircraft card keeps sea missions and launches real flight', async () => {
    await page.locator('[data-vehicle="aircraft"]').click();
    assert.equal(await page.locator('[data-mode="naval"]').isVisible(), true);
    assert.equal(await page.locator('[data-mode="naval-training"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-mode="training"]').click(); await page.locator('#startBtn').click();
    let s = await snapshot(page); assert.equal(s.simVehicle, 'aircraft'); assert.equal(s.ammo, 578);
    await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click();
  });
  await check('Repeated base switching retains a fixed scene and reports no WebGL errors', async () => {
    const before = await snapshot(page);
    for (let i = 0; i < 12; i++) await page.locator(`[data-base="${i % 2 ? 'aircraft' : 'destroyer'}"]`).click();
    const after = await snapshot(page); assert.equal(after.sceneObjects, before.sceneObjects); assert.equal(after.glError, 0);
    report.metrics.desktop = after;
  });
  await context.close();
  for (const size of [{ width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 360, height: 780 }]) {
    const { page, context } = await open(size, size.width < 900);
    for (const id of ['aircraft', 'destroyer']) {
      await check(`${size.width}×${size.height} ${id}: readable panels, no overflow and accessible fleet`, async () => {
        await page.locator(`[data-base="${id}"]`).click(); const b = await bounds(page);
        assert.equal(b.menuWidth, size.width); assert.ok(b.dossier.bottom < b.fleet.top, JSON.stringify(b)); assert.ok(b.briefing.bottom <= b.fleet.top, JSON.stringify(b));
        assert.ok(b.display.width > 250 || size.width === 844);
        await page.locator(`[data-vehicle="${id}"]`).scrollIntoViewIfNeeded();
        assert.equal(await page.locator(`[data-vehicle="${id}"]`).isVisible(), true);
        // Reset scroll through an actual UI element before taking the view.
        await page.locator('[data-base="aircraft"]').scrollIntoViewIfNeeded();
        report.metrics[`${size.width}x${size.height}-${id}`] = { ...(await snapshot(page)), layout: await bounds(page) };
      });
      await page.waitForFunction(() => {const b=window.__baseQA.baseScene,r=b.viewport.getBoundingClientRect();return Math.abs(b.camera.view.offsetY-(innerHeight/2-r.top-r.height/2))<1;});
      await page.screenshot({ path: resolve(output, `${size.width}x${size.height}-${id}.png`) });
    }
    if (size.width === 844) await check('Phone trusted touch drag and pinch orbit and zoom the harbor', async () => {
      const area = await page.locator('#baseViewport').boundingBox(); const before = await snapshot(page);
      const cdp = await context.newCDPSession(page);
      const x = area.x + area.width / 2, y = area.y + area.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 65, y, id: 1 }, { x: x + 65, y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok((await snapshot(page)).zoom < before.zoom);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 50, y: y + 15, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.notEqual((await snapshot(page)).yaw, before.yaw);
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error); throw error; }
finally { await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2)); await browser.close(); }
