// Real WebGL and real UI controls for the J-16 and the imported Fujian.
// Weapon locks are advanced with explicit sim steps (labelled below) so the check
// does not depend on the frame rate of a software-rendered CI browser.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = process.env.PLAYWRIGHT_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_PATH).href) : await import('playwright-core');
const output = resolve(process.env.OUTPUT_DIR || 'verification/j16-fujian'); await mkdir(output, { recursive: true });
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8766';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const report = { checks: [], errors: [], baseURL, boundary: 'Phone viewports and touch are browser emulation; weapon locks use explicit simulation steps; no physical-device performance claim.' };
async function check(name, fn) { await fn(); report.checks.push(name); console.log('PASS ' + name); }
async function open(viewport, touch = false) {
  const context = await browser.newContext({ viewport, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(() => { if (!localStorage.getItem('frostline-settings')) localStorage.setItem('frostline-settings', JSON.stringify({ sound: false, quality: 'low' })); });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__qa={sim,world,workshop,baseScene};' }));
  const page = await context.newPage(); page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(baseURL, { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__qa && !document.getElementById('menu').hidden, null, { timeout: 90000 });
  return { page, context };
}
const frames = (page, n = 2) => page.evaluate(n => new Promise(done => { const f = () => (--n ? requestAnimationFrame(f) : done()); requestAnimationFrame(f); }), n);
const state = page => page.evaluate(() => {
  const { sim, world, baseScene } = window.__qa, visible = [];
  world.playerJet.userData.stores?.traverse(o => { if (o.userData.store && o.visible) visible.push(o.userData.store); });
  return { aircraftId: sim.player.aircraftId, jet: world.playerJet.userData.aircraftId, jetVisible: world.playerJet.visible,
    others: Object.values(world.playerJets).filter(j => j !== world.playerJet).map(j => j.visible), base: baseScene.jet.userData.aircraftId,
    ammo: sim.player.ammo, air: sim.player.missiles, sea: sim.player.antiShipMissiles, kills: sim.kills, state: sim.state, stores: visible,
    gear: world.playerJet.userData.gear.some(g => g.visible), glError: world.renderer.getContext().getError() };
});
// Explicit simulation steps: hold the player on a fixed target until a lock completes.
const stepLock = (page, kind) => page.evaluate(kind => {
  const { sim } = window.__qa, target = sim.enemies.find(e => kind === 'sea' ? e.kind === 'ship' : e.kind !== 'ship');
  sim.targetId = target.id; target.vel?.set(0, 0, 0);
  const ahead = kind === 'sea' ? 2500 : 1800, p = sim.player;
  target.pos.set(p.pos.x - Math.sin(p.heading) * ahead, kind === 'sea' ? target.pos.y : p.pos.y, p.pos.z - Math.cos(p.heading) * ahead);
  if (kind === 'sea') { p.pitch = Math.atan2(-(p.pos.y - target.pos.y), ahead); }
  const hold = { update: sim._updatePlayer, enemies: sim._updateEnemies }; sim._updatePlayer = () => {}; sim._updateEnemies = () => {};
  for (let i = 0; i < 150 && (kind === 'sea' ? sim.antiShipLockProgress : sim.lockProgress) < 1; i++) sim.update(1 / 60, {});
  Object.assign(window.__qa, { hold });
  return kind === 'sea' ? sim.antiShipLockProgress : sim.lockProgress;
}, kind);
try {
  const { page, context } = await open({ width: 1440, height: 900 });
  await check('desktop fleet lists three owned vehicles and the J-16 card selects the parked J-16 hangar model', async () => {
    assert.equal(await page.locator('[data-vehicle]').count(), 3);
    await page.locator('[data-vehicle="j16"]').click(); await frames(page);
    assert.equal(await page.locator('#ownedVehicleName').innerText(), '歼-16');
    assert.match(await page.locator('#ownedVehicleWeapons').innerText(), /GSh-30-1 150 发 · 空空 6 枚 · 反舰 2 枚/);
    assert.equal(await page.locator('[data-base="aircraft"]').getAttribute('aria-pressed'), 'true');
    const s = await state(page); assert.equal(s.base, 'j16');
    assert.equal(await page.evaluate(() => window.__qa.baseScene.jets.aircraft.visible), false);
    await page.screenshot({ path: resolve(output, 'desktop-hangar-j16.png') });
    await page.locator('[data-base="destroyer"]').click(); await page.locator('[data-base="aircraft"]').click();
    assert.equal((await state(page)).base, 'j16', 'the hangar tab returns to the last chosen jet');
  });
  await check('J-16 workshop shows its eight stations, own presets, map, gun and keeps the save after reload', async () => {
    await page.locator('#workshopBtn').click();
    assert.equal(await page.locator('#hardpointGrid select').count(), 8); assert.equal(await page.locator('[data-preset]').count(), 4);
    assert.equal(await page.locator('.hardpoint-map[data-aircraft="j16"]').isVisible(), true);
    assert.equal(await page.locator('.hardpoint-map[data-aircraft="fa18c"]').isVisible(), false);
    assert.match(await page.locator('#workshopAircraft').innerText(), /歼-16/); assert.match(await page.locator('#loadoutInventory').innerText(), /GSh-30-1 150 发/);
    assert.deepEqual(await page.locator('#station-1 option').allInnerTexts(), ['空挂', 'PL-10 × 1']);
    await page.locator('[data-preset="air"]').click(); await frames(page);
    assert.match(await page.locator('#loadoutInventory').innerText(), /空空 8 · 反舰 0/);
    await page.screenshot({ path: resolve(output, 'desktop-workshop-j16.png') });
    await page.locator('#station-2').selectOption('yj83k:1'); await page.locator('#station-7').selectOption('yj83k:1');
    await page.locator('.workshop-done').click(); await frames(page);
    assert.deepEqual((await page.evaluate(() => { const v = []; window.__qa.baseScene.jet.userData.stores.traverse(o => { if (o.userData.store && o.visible) v.push(o.userData.store); }); return v; })).sort(),
      ['pl10', 'pl10', 'pl15', 'pl15', 'pl15', 'pl15', 'yj83k', 'yj83k']);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.__qa && !document.getElementById('menu').hidden, null, { timeout: 90000 });
    assert.equal(await page.locator('[data-vehicle="j16"]').getAttribute('aria-pressed'), 'true');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('frostline-workshop-v1')).loadouts);
    assert.equal(saved.j16[1].store, 'yj83k'); assert.equal(saved.fa18c.length, 9, 'Hornet loadout is untouched');
  });
  await check('J-16 intercept sortie flies the J-16 airframe and launches a PL-15 from a real station with the F key', async () => {
    await page.locator('[data-mode="intercept"]').click(); await page.locator('#startBtn').click(); await frames(page, 3);
    let s = await state(page);
    assert.equal(s.aircraftId, 'j16'); assert.equal(s.jet, 'j16'); assert.equal(s.jetVisible, true); assert.deepEqual(s.others, [false]);
    assert.equal(s.gear, false); assert.equal(s.ammo, 150); assert.equal(s.glError, 0);
    await page.screenshot({ path: resolve(output, 'desktop-flight-j16.png') });
    await page.keyboard.press('KeyB'); assert.equal(await page.evaluate(() => window.__qa.sim.player.selectedAirWeapon), 'pl15');
    assert.equal(await stepLock(page, 'air'), 1);
    const before = await state(page); await page.keyboard.press('KeyF');
    await page.waitForFunction(n => window.__qa.sim.player.missiles === n - 1, before.air);
    const missile = await page.evaluate(() => window.__qa.sim.missiles.find(m => !m.enemy && m.store));
    assert.equal(missile.store, 'pl15'); await frames(page);
    assert.equal((await state(page)).stores.length, before.stores.length - 1, '3D inventory hides the launched PL-15');
    await page.evaluate(() => Object.assign(window.__qa.sim, { _updatePlayer: window.__qa.hold.update, _updateEnemies: window.__qa.hold.enemies }));
    await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click();
  });
  await check('J-16 sea training locks and launches a YJ-83K with the R key and sinks a target', async () => {
    await page.locator('[data-mode="naval-training"]').click(); assert.equal(await page.locator('#startBtn').isDisabled(), false);
    await page.locator('#startBtn').click(); await frames(page);
    assert.equal(await stepLock(page, 'sea'), 1); await page.keyboard.press('KeyR');
    await page.waitForFunction(() => window.__qa.sim.player.antiShipMissiles === 1);
    assert.equal(await page.evaluate(() => window.__qa.sim.missiles.find(m => m.weapon === 'anti-ship').store), 'yj83k');
    // Explicit steps to the impact instead of waiting minutes of software-rendered frames.
    await page.evaluate(() => { const { sim } = window.__qa; for (let i = 0; i < 60 * 30 && !sim.kills; i++) sim.update(1 / 60, {}); });
    await frames(page); assert.ok((await state(page)).kills >= 1);
    await page.screenshot({ path: resolve(output, 'desktop-sea-training-j16.png') });
    await page.evaluate(() => Object.assign(window.__qa.sim, { _updatePlayer: window.__qa.hold.update, _updateEnemies: window.__qa.hold.enemies }));
    if (await page.locator('#resultPanel').isVisible()) await page.locator('#resultExitBtn').click();
    else { await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); }
  });
  await check('switching back to the F/A-18 restores the Hornet hangar, workshop and airframe', async () => {
    await page.locator('[data-vehicle="aircraft"]').click(); assert.equal((await state(page)).base, 'fa18c');
    await page.locator('[data-mode="training"]').click(); await page.locator('#startBtn').click(); await frames(page, 3);
    const s = await state(page); assert.equal(s.aircraftId, 'fa18c'); assert.equal(s.jet, 'fa18c'); assert.deepEqual(s.others, [false]); assert.equal(s.ammo, 578);
    await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click();
    await page.locator('#workshopBtn').click(); assert.equal(await page.locator('#hardpointGrid select').count(), 9); await page.keyboard.press('Escape');
  });
  await check('the CN-CV-18 in the fleet is the imported Fujian model and renders close and distant without WebGL errors', async () => {
    await page.locator('[data-mode="training"]').click(); await page.locator('#startBtn').click(); await frames(page);
    const info = await page.evaluate(() => {
      const { sim, world } = window.__qa; sim.state = 'paused'; world._savedCamera = world._updateCamera; world._updateCamera = () => {};
      document.getElementById('flightUI').hidden = true;
      const style = document.createElement('style'); style.id = 'qa-hide'; style.textContent = '#hudCanvas,#toast{display:none!important}'; document.head.append(style);
      const ship = world.ambientFleet.ships.find(s => s.id === 'CN-CV-18').model, near = ship.userData.lod.levels[0].object;
      return { type: ship.userData.modelType, meshes: near.children.map(m => m.name), far: ship.userData.lod.levels[1].object.children.length };
    });
    assert.equal(info.type, 'fujian'); assert.equal(info.meshes.length, 15); assert.ok(info.meshes.includes('naval-fujian-Flight deck non-skid')); assert.equal(info.far, 5);
    for (const [name, distance, height] of [['close', .55, .35], ['distant', 9.5, 2.2]]) {
      await page.evaluate(([distance, height]) => {
        const { world } = window.__qa, model = world.ambientFleet.ships.find(s => s.id === 'CN-CV-18').model;
        world.camera.position.copy(model.position).add({ x: 315 * distance, y: 315 * height, z: -315 * distance * .9 });
        world.camera.lookAt(model.position.clone().add({ x: 0, y: 18, z: 0 })); world.camera.fov = 39; world.camera.updateProjectionMatrix(); world.refreshReflection = true;
      }, [distance, height]);
      await frames(page, 3); assert.equal((await state(page)).glError, 0);
      await page.screenshot({ path: resolve(output, `fujian-${name}.png`) });
    }
    report.fujianDraws = await page.evaluate(() => window.__qa.world.renderer.info.render.calls);
    await page.evaluate(() => { const { sim, world } = window.__qa; world._updateCamera = world._savedCamera; world.cameraReady = false; sim.state = 'playing'; document.getElementById('flightUI').hidden = false; document.getElementById('qa-hide').remove(); });
    await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click();
  });
  await context.close();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 360, height: 780 }]) {
    const { page, context } = await open(viewport, true);
    await check(`${viewport.width}x${viewport.height} touch: three vehicle cards fit, J-16 selects and starts a sortie`, async () => {
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
        cards: [...document.querySelectorAll('[data-vehicle]')].map(c => { const r = c.getBoundingClientRect(); return [r.left, r.right, r.width]; }) }));
      assert.ok(layout.overflow <= 0, `horizontal overflow ${layout.overflow}`);
      for (const [left, right, width] of layout.cards) assert.ok(left >= 0 && right <= viewport.width && width > 100, JSON.stringify(layout.cards));
      await page.locator('[data-vehicle="j16"]').scrollIntoViewIfNeeded(); await page.locator('[data-vehicle="j16"]').tap();
      assert.equal(await page.locator('#ownedVehicleName').innerText(), '歼-16');
      await page.locator('[data-vehicle="j16"]').screenshot({ path: resolve(output, `${viewport.width}x${viewport.height}-card.png`) });
      await page.screenshot({ path: resolve(output, `${viewport.width}x${viewport.height}-base.png`), fullPage: true });
      await page.locator('[data-mode="training"]').scrollIntoViewIfNeeded(); await page.locator('[data-mode="training"]').tap();
      await page.locator('#startBtn').scrollIntoViewIfNeeded(); await page.locator('#startBtn').tap(); await frames(page, 3);
      const s = await state(page); assert.equal(s.jet, 'j16'); assert.equal(s.glError, 0);
      await page.screenshot({ path: resolve(output, `${viewport.width}x${viewport.height}-flight.png`) });
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await check(`${report.checks.length} browser checks, no page errors or failed requests`, async () => {});
} finally {
  await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n'); await browser.close();
}
