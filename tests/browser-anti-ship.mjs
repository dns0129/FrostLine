// Optional real-WebGL regression. Start server.py on BASE_URL before running.
// UI selections and trusted keyboard/touch events drive the real simulation.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'verification/anti-ship');
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath = process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8773';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const source = await readFile(resolve(root, 'app.js'), 'utf8');
await mkdir(out, { recursive: true });
const errors = [];
const results = { baseURL, checks: [], desktop: {}, mobile: {}, errors, boundaries: ['Real keyboard R and trusted touch events launch anti-ship missiles; no gameplay state is directly changed.', 'One real naval wave and two-ship training are covered; the full three-wave victory is tested separately by simulation tests.', 'Phone checks use emulated viewport and trusted CDP touch contacts, not physical hardware.'] };
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', `--use-angle=${process.env.BROWSER_ANGLE || 'metal'}`, '--enable-unsafe-swiftshader'] });
let activePage;
let activeStep = 'load';

async function check(name, fn) {
  activeStep = name;
  await fn();
  results.checks.push(name);
  console.log(`PASS ${name}`);
}

async function contextFor(viewport, touch = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(({ touch }) => {
    window.__now = 0;
    window.requestAnimationFrame = () => 1;
    window.__hudTexts = [];
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'hudCanvas') window.__hudTexts.push(String(text));
      return nativeText.call(this, text, ...args);
    };
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: 'aircraft', quality: touch ? 'auto' : 'high', sound: false, invert: false, cameraZoom: 100 }));
  }, { touch });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__flight={sim,world,start,frame,action,input,presentation,selectVehicle};\n' }));
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', error => errors.push({ kind: 'pageerror', message: String(error) }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'resource', status: response.status(), url: response.url() }); });
  await page.goto(baseURL + '/?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__flight);
  await page.evaluate(() => window.__flight.world.sky.userData.ready);
  await page.evaluate(() => { const diagnostics = document.getElementById('renderDiagnostics'); if (diagnostics) diagnostics.style.display = 'none'; });
  return { context, page };
}

const tick = (page, frames = 1, frameStepMs = 1000 / 60) => page.evaluate(({ frames, frameStepMs }) => {
  for (let i = 0; i < frames; i++) { window.__now += frameStepMs; window.__hudTexts.length = 0; window.__flight.frame(window.__now); }
}, { frames, frameStepMs });

async function metrics(page) {
  return page.evaluate(() => {
    const { sim, world, input } = window.__flight;
    const p = sim.player;
    const model = p.kind === 'destroyer' ? (world.playerShip || world.playerDestroyer || world.destroyer) : world.playerJet;
    return {
      state: sim.state, endReason: sim.endReason, mode: sim.mode, vehicle: sim.vehicle, kind: p.kind, time: sim.time, wave: sim.wave, kills: sim.kills, hits: sim.hits, enemyTracers: sim.tracers.filter(t => t.enemy).length,
      speed: p.speed, throttle: p.throttle, health: p.health, heading: p.heading,
      turretHeading: p.turretHeading, turretPitch: p.turretPitch, rudder: p.rudder,
      pos: p.pos.toArray(), ammo: p.ammo, missiles: p.missiles, antiShipMissiles: p.antiShipMissiles, antiShipLockProgress: sim.antiShipLockProgress, antiShipTargetId: sim.antiShipTargetId, missileCooldown: sim.missileCooldown, antiShipCooldown: sim.antiShipCooldown, shots: sim.shots,
      liveMissiles: sim.missiles.length, tracers: sim.tracers.length, friendlyTracers: sim.tracers.filter(t => !t.enemy).length, particles: sim.particles.length, heat: p.heat, overheated: p.overheated, lockProgress: sim.lockProgress,
      targetId: sim.targetId, enemies: sim.enemies.length, input: input.read(),
      modelVisible: model?.visible, modelName: model?.name,
      missileDetails: sim.missiles.map((m, i) => ({id: m.id, weapon: m.weapon || m.kind || 'sam', kind: m.kind, targetId: m.targetId, pos: m.pos.toArray(), life: m.life, verticalLaunch: m.verticalLaunch, enemy: m.enemy, mesh: {visible: world.missileMeshes[i]?.visible, visualKind: world.missileMeshes[i]?.userData.visualKind}})),
      ships: sim.enemies.map(e => {
        const mesh = world.enemies.get(e.id), aim = e.pos.clone(); aim.y += e.aimHeight || 6;
        return { id: e.id, kind: e.kind, shipType: e.shipType, pos: e.pos.toArray(), vel: e.vel.toArray(), health: e.health, maxHealth: e.maxHealth, heading: e.heading, speed: e.speed, passive: e.passive, aimHeight: e.aimHeight, model: { visible: mesh?.visible, kind: mesh?.userData.kind, shipType: mesh?.userData.shipType, name: mesh?.name }, screen: world.project(aim) };
      }),
      hudTexts: window.__hudTexts.slice(),
      mission: { objective: document.getElementById('objective').textContent, wave: document.getElementById('waveInfo').textContent, killText: document.querySelector('.score-box small').textContent, kills: document.getElementById('killsValue').textContent, result: document.getElementById('resultPanel').textContent },
      camera: { position: world.camera.position.toArray(), fov: world.camera.fov, aspect: world.camera.aspect, distance: world.camera.position.distanceTo(p.pos) },
      renderSize: { width: world.width, height: world.height, canvasWidth: world.canvas.width, canvasHeight: world.canvas.height },
      quality: world.effectiveQuality, draws: world.renderer.info.render.calls,
      triangles: world.renderer.info.render.triangles, glError: world.renderer.getContext().getError(),
      hud: { antiShip: document.getElementById('antiShipValue')?.textContent, antiShipLock: document.getElementById('touchAntiShipLock')?.textContent, antiShipStatus: document.getElementById('antiShipStatus')?.textContent, samStatus: document.getElementById('samLockStatus')?.textContent, samLock: document.getElementById('touchLock')?.textContent, speed: document.getElementById('speedValue').textContent, elevation: document.getElementById('altValue').textContent, health: document.getElementById('healthValue').textContent, missiles: document.getElementById('missileValue').textContent },
    };
  });
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(out, name + '.png') });
}

async function baseMenu(page, mode) {
  await page.locator('#startBtn').scrollIntoViewIfNeeded();
  const state = await page.evaluate(() => {
    const selectors = ['[data-vehicle="aircraft"]', '[data-vehicle="destroyer"]', '[data-mode="intercept"]', '[data-mode="free"]', '[data-mode="training"]', '[data-mode="naval"]', '[data-mode="naval-training"]', '#startBtn', '#guideBtn'];
    const controls = selectors.map(selector => {
      const element = document.querySelector(selector), r = element.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2, front = document.elementFromPoint(x, y);
      return { selector, text: element.textContent.trim(), box: {x: r.x, y: r.y, width: r.width, height: r.height}, centerInViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight, unobstructed: front === element || element.contains(front) };
    });
    return { controls, viewport: {width: innerWidth, height: innerHeight} };
  });
  const start = state.controls.find(e => e.selector === '#startBtn');
  assert.equal(start.centerInViewport, true);
  assert.equal(start.unobstructed, true, 'start button must not be covered by the footer');
  for (const entry of state.controls) if (entry.centerInViewport) assert.equal(entry.unobstructed, true, `${entry.selector} must be clickable without overlay obstruction`);
  const viewport = page.viewportSize();
  const prefix = viewport.width < 1000 ? (viewport.height > viewport.width ? 'mobile-portrait' : 'mobile-landscape') : 'desktop';
  await page.screenshot({ path: resolve(out, `${prefix}-base-${mode}.png`), fullPage: true });
  return state;
}

async function startMission(page, vehicle = 'destroyer', mode = 'naval-training') {
  await page.locator(`[data-vehicle="${vehicle}"]`).click();
  await page.locator(`[data-mode="${mode}"]`).click();
  assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
  const menu = vehicle === 'destroyer' ? await baseMenu(page, mode) : null;
  await page.locator('#startBtn').click();
  await tick(page, 8);
  const state = await metrics(page);
  assert.equal(state.kind, vehicle);
  assert.equal(state.mode, mode);
  assert.equal(state.state, 'playing');
  assert.equal(state.enemies, mode === 'naval' || mode === 'naval-training' ? 2 : 3);
  assert.equal(state.glError, 0);
  return { ...state, menu };
}

async function setThrottle(page, high) {
  // End/Home operate the real range input, including its native input event.
  await page.locator('#throttle').focus();
  await page.keyboard.press(high ? 'End' : 'Home');
  assert.equal(await page.locator('#throttle').inputValue(), high ? '100' : '0');
  // A released click in the scene transfers keyboard focus away from the slider.
  await page.locator('#world').click({ position: { x: 10, y: 10 } });
}

async function holdKeys(page, keys, frames) {
  for (const key of keys) await page.keyboard.down(key);
  await tick(page, frames);
  for (const key of keys.slice().reverse()) await page.keyboard.up(key);
  return metrics(page);
}

async function frozenState(page) {
  return page.evaluate(() => {
    const { sim, world } = window.__flight;
    const model = world.playerShip || world.playerDestroyer || world.destroyer;
    const transforms = [];
    model?.traverse(object => transforms.push({ name: object.name, visible: object.visible, position: object.position.toArray(), rotation: object.rotation.toArray(), matrix: object.matrixWorld.elements.slice() }));
    const enemies = [...world.enemies.entries()].map(([id, mesh]) => {
      const parts = []; mesh.traverse(o => parts.push({name: o.name, position: o.position.toArray(), rotation: o.rotation.toArray(), matrix: o.matrixWorld.elements.slice()}));
      return {id, visible: mesh.visible, parts};
    });
    return { missiles: sim.missiles.map(m => ({ id: m.id, pos: m.pos.toArray(), dir: m.dir.toArray(), life: m.life, verticalLaunch: m.verticalLaunch })), enemies, state: sim.state, time: sim.time, renderTime: world.elapsed, pos: sim.player.pos.toArray(), turretHeading: sim.player.turretHeading, turretPitch: sim.player.turretPitch, camera: world.camera.matrixWorld.elements.slice(), model: transforms };
  });
}

async function layout(page) {
  const controls = ['touchAntiShip', 'joystick', 'aimJoystick', 'touchFire', 'touchMissile', 'touchFlare', 'touchBoost', 'touchTarget', 'touchCamera', 'pauseBtn', 'throttle'];
  const boxes = {};
  const viewport = page.viewportSize();
  for (const id of controls) {
    assert.equal(await page.locator('#' + id).isVisible(), true, `${id} must be visible`);
    const box = await page.locator('#' + id).boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, `${id} must have an active hit area`);
    boxes[id] = box;
  }
  const violations = [];
  for (const [id, box] of Object.entries(boxes)) {
    if (box.x < -.5 || box.y < -.5 || box.x + box.width > viewport.width + .5 || box.y + box.height > viewport.height + .5) violations.push(`${id} extends outside ${viewport.width}x${viewport.height}`);
  }
  const entries = Object.entries(boxes);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [a, x] = entries[i], [b, y] = entries[j];
    const overlapX = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
    const overlapY = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
    if (overlapX > .5 && overlapY > .5) violations.push(`${a} overlaps ${b} (${overlapX.toFixed(1)}x${overlapY.toFixed(1)}px)`);
  }
  const hudBoxes = {};
  for (const [name, selector] of Object.entries({ hull: '.airframe', score: '.score-box', speed: '.flight-readout.left', bearing: '.flight-readout.right' })) hudBoxes[name] = await page.locator(selector).boundingBox();
  for (const [a, b] of [['hull', 'speed'], ['score', 'bearing']]) {
    const x = hudBoxes[a], y = hudBoxes[b];
    const overlapX = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
    const overlapY = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
    if (overlapX > .5 && overlapY > .5) violations.push(`HUD ${a} overlaps ${b} (${overlapX.toFixed(1)}x${overlapY.toFixed(1)}px)`);
  }
  return { viewport, boxes, hudBoxes, violations };
}

async function multitouch(page, context, boxes) {
  const cdp = await context.newCDPSession(page);
  const point = (id, box, dx = 0, dy = 0) => ({ id, x: box.x + box.width * (.5 + dx), y: box.y + box.height * (.5 + dy), radiusX: 2, radiusY: 2, force: 1 });
  const helm = point(1, boxes.joystick, -.2, 0);
  const aim = point(2, boxes.aimJoystick, -.18, -.14);
  const fire = point(3, boxes.touchFire);
  const dispatch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const states = {};
  await dispatch('touchStart', [helm]);
  await dispatch('touchStart', [helm, aim]);
  await dispatch('touchStart', [helm, aim, fire]);
  await tick(page, 20);
  states.all = await metrics(page);
  assert.ok(states.all.input.roll > .3, 'left stick turns the ship');
  assert.ok(states.all.input.aimYaw > .3, 'right stick independently slews the turret');
  assert.ok(states.all.input.pitch > .25, 'right stick raises the barrel');
  assert.equal(states.all.input.fire, true);
  assert.ok(states.all.shots > 0);
  // Chromium ends the listed contact IDs here; unlisted contacts stay down.
  await dispatch('touchEnd', [fire]);
  await tick(page, 2);
  states.fireReleased = await metrics(page);
  assert.equal(states.fireReleased.input.fire, false);
  assert.ok(states.fireReleased.input.roll > .3);
  assert.ok(states.fireReleased.input.aimYaw > .3);
  await dispatch('touchEnd', [helm]);
  await tick(page, 2);
  states.helmReleased = await metrics(page);
  assert.equal(states.helmReleased.input.roll, 0);
  assert.ok(states.helmReleased.input.aimYaw > .3);
  assert.ok(states.helmReleased.input.pitch > .25);
  await dispatch('touchStart', [helm, aim, fire]);
  await tick(page, 2);
  await dispatch('touchEnd', [aim]);
  await tick(page, 2);
  states.aimReleased = await metrics(page);
  assert.equal(states.aimReleased.input.aimYaw, 0);
  assert.equal(states.aimReleased.input.pitch, 0);
  assert.ok(states.aimReleased.input.roll > .3);
  assert.equal(states.aimReleased.input.fire, true);
  await dispatch('touchEnd', []);
  await tick(page, 2);
  states.allReleased = await metrics(page);
  assert.equal(states.allReleased.input.roll, 0);
  assert.equal(states.allReleased.input.aimYaw, 0);
  assert.equal(states.allReleased.input.pitch, 0);
  assert.equal(states.allReleased.input.fire, false);
  assert.equal(states.allReleased.glError, 0);
  await cdp.detach();
  return states;
}

async function returnToBase(page) {
  const state = (await metrics(page)).state;
  if (state === 'won' || state === 'lost') await page.locator('#resultExitBtn').click();
  else { if (state !== 'paused') await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); }
  assert.equal(await page.locator('#menu').isVisible(), true);
}

const asm = state => state.missileDetails.filter(m => !m.enemy && m.weapon === 'anti-ship');

async function checkIndependentCooldown(page, weapon) {
  // Called two 60 Hz frames after a real launch; another ten frames place the
  // HUD about 0.2 s after launch without extending the existing journey.
  await tick(page, 10);
  const antiShip = weapon === 'anti-ship';
  const ownStatus = antiShip ? '#antiShipStatus' : '#samLockStatus';
  const otherStatus = antiShip ? '#samLockStatus' : '#antiShipStatus';
  const ownTouch = antiShip ? '#touchAntiShipLock' : '#touchLock';
  const otherTouch = antiShip ? '#touchLock' : '#touchAntiShipLock';
  const ownButton = antiShip ? '#touchAntiShip' : '#touchMissile';
  assert.match(await page.locator(ownStatus).textContent(), /冷却/);
  assert.match(await page.locator(ownTouch).textContent(), /冷却/);
  assert.doesNotMatch(await page.locator(otherStatus).textContent(), /冷却/);
  assert.doesNotMatch(await page.locator(otherTouch).textContent(), /冷却/);
  assert.equal(await page.locator(ownButton).evaluate(e => e.classList.contains('ready')), false);
  const cooling = await metrics(page);
  assert.ok((antiShip ? cooling.antiShipCooldown : cooling.missileCooldown) > 0);
  assert.equal(antiShip ? cooling.missileCooldown : cooling.antiShipCooldown, 0);
  return cooling;
}

async function waitAntiShipLock(page) {
  for (let i = 0; i < 45 && (await metrics(page)).antiShipLockProgress < 1; i++) await tick(page, 6);
  const locked = await metrics(page);
  assert.equal(locked.antiShipLockProgress, 1, 'the selected ship must lock through real mission time');
  assert.equal(locked.lockProgress, 0, 'SAM lock must stay separate from the surface lock');
  assert.match(locked.hud.antiShipStatus, /锁定/);
  return locked;
}

async function launchByKey(page) {
  const before = await waitAntiShipLock(page);
  await page.keyboard.press('r');
  await tick(page, 2);
  const fired = await metrics(page);
  assert.equal(fired.antiShipMissiles, before.antiShipMissiles - 1);
  assert.equal(fired.missiles, before.missiles);
  assert.equal(fired.ammo, before.ammo);
  assert.equal(asm(fired).length, 1);
  const missile = asm(fired)[0];
  assert.equal(missile.kind, 'anti-ship');
  assert.equal(missile.mesh.visible, true);
  assert.equal(missile.mesh.visualKind, 'anti-ship');
  assert.equal(missile.targetId, before.targetId);
  assert.ok(missile.verticalLaunch > 0, 'the first real render must show the short vertical launch');
  assert.ok(missile.pos[1] > fired.pos[1] + 3);
  return { before, fired, missile, cooling: await checkIndependentCooldown(page, 'anti-ship') };
}

async function waitImpact(page, launch) {
  const samples = [];
  for (let i = 0; i < 180; i++) {
    const state = await metrics(page);
    samples.push({ time: state.time, kills: state.kills, missiles: asm(state) });
    if (state.kills > launch.before.kills) break;
    assert.equal(state.state, 'playing');
    await tick(page, 6);
  }
  const after = await metrics(page);
  assert.ok(after.kills > launch.before.kills, 'a real anti-ship missile must hit and sink its target');
  assert.equal(after.ships.some(e => e.id === launch.missile.targetId), false);
  assert.ok(samples.some(s => s.missiles.some(m => m.verticalLaunch <= 0 && m.pos[1] >= 12 && m.pos[1] <= 18)), 'trajectory samples must include the 15 m sea-skimming cruise');
  return { samples, after };
}

async function tapAntiShip(page) {
  const before = await waitAntiShipLock(page);
  const button = await page.locator('#touchAntiShip').boundingBox();
  assert.ok(button);
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
  await tick(page, 2);
  const after = await metrics(page);
  assert.equal(after.antiShipMissiles, before.antiShipMissiles - 1);
  assert.equal(after.missiles, before.missiles);
  assert.equal(after.ammo, before.ammo);
  assert.equal(asm(after).length, 1);
  return { before, after, cooling: await checkIndependentCooldown(page, 'anti-ship') };
}

try {
  const desktop = await contextFor({ width: 1440, height: 900 });
  const page = desktop.page;
  await check('desktop: real naval training entry exposes separate SAM and anti-ship inventories', async () => {
    results.desktop.started = await startMission(page);
    assert.equal(results.desktop.started.antiShipMissiles, 6);
    assert.equal(results.desktop.started.missiles, 12);
    assert.equal(results.desktop.started.ammo, 240);
    assert.equal(await page.locator('#antiShipValue').isVisible(), true);
    assert.match(results.desktop.started.hud.antiShip, /0?6/);
    await screenshot(page, 'desktop-separated-weapons');
  });
  await check('desktop: sea target rejects F while anti-ship R waits for a fresh target lock', async () => {
    const locked = await waitAntiShipLock(page);
    await page.keyboard.press('f');
    await tick(page, 2);
    const rejected = await metrics(page);
    assert.equal(rejected.missiles, 12);
    assert.equal(rejected.antiShipMissiles, 6);
    assert.equal(rejected.missileDetails.length, 0);
    await page.keyboard.press('Tab');
    const changed = await metrics(page);
    assert.notEqual(changed.targetId, locked.targetId);
    assert.equal(changed.antiShipLockProgress, 0);
    await page.keyboard.press('r');
    await tick(page, 2);
    assert.equal((await metrics(page)).antiShipMissiles, 6);
    assert.equal(asm(await metrics(page)).length, 0);
    const secondLocked = await waitAntiShipLock(page);
    assert.equal(secondLocked.targetId, changed.targetId);
    await page.keyboard.press('Tab');
    assert.equal((await metrics(page)).targetId, locked.targetId);
    assert.equal((await metrics(page)).antiShipLockProgress, 0);
    results.desktop.targetSwitch = { locked, rejected, changed, secondLocked, relocked: await waitAntiShipLock(page) };
  });
  await check('desktop: R launches a distinct VLS anti-ship missile and spends only its six-round inventory', async () => {
    results.desktop.firstLaunch = await launchByKey(page);
    assert.equal(results.desktop.firstLaunch.fired.antiShipMissiles, 5);
    assert.equal(results.desktop.firstLaunch.fired.missiles, 12);
    await screenshot(page, 'desktop-anti-ship-launch');
  });
  await check('desktop: pause freezes the launched anti-ship missile, models and camera', async () => {
    await page.locator('#pauseBtn').click();
    await tick(page, 1);
    const before = await frozenState(page);
    assert.equal(before.missiles.length, 1);
    await tick(page, 30);
    assert.deepEqual(await frozenState(page), before);
    results.desktop.pause = { time: before.time, missileCount: before.missiles.length, frozen: true };
    await screenshot(page, 'desktop-paused-missile');
    await page.locator('#resumeBtn').click();
    await tick(page, 2);
  });
  await check('desktop: real sea-skimming missile strikes and sinks the first training ship', async () => {
    results.desktop.firstImpact = await waitImpact(page, results.desktop.firstLaunch);
    assert.equal(results.desktop.firstImpact.after.kills, 1);
    assert.equal(results.desktop.firstImpact.after.antiShipMissiles, 5);
    assert.equal(results.desktop.firstImpact.after.missiles, 12);
    await screenshot(page, 'desktop-first-ship-sunk');
  });
  await check('desktop: second real R strike wins the two-ship training', async () => {
    results.desktop.secondLaunch = await launchByKey(page);
    results.desktop.secondImpact = await waitImpact(page, results.desktop.secondLaunch);
    const won = results.desktop.secondImpact.after;
    assert.equal(won.state, 'won');
    assert.equal(won.kills, 2);
    assert.equal(won.antiShipMissiles, 4);
    assert.equal(won.missiles, 12);
    assert.equal(won.ammo, 240);
    assert.equal(won.health, 300);
    assert.equal(await page.locator('#resultPanel').isVisible(), true);
    assert.match(await page.locator('#resultKills').textContent(), /^2\s*\//);
    await screenshot(page, 'desktop-anti-ship-training-victory');
  });
  await check('desktop: retry and pause-restart reset both independent missile inventories', async () => {
    await page.locator('#againBtn').click();
    await tick(page, 8);
    const retried = await metrics(page);
    assert.equal(retried.mode, 'naval-training');
    assert.equal(retried.antiShipMissiles, 6);
    assert.equal(retried.missiles, 12);
    await launchByKey(page);
    await page.locator('#pauseBtn').click();
    await page.locator('#restartBtn').click();
    await tick(page, 8);
    results.desktop.restarted = await metrics(page);
    assert.equal(results.desktop.restarted.antiShipMissiles, 6);
    assert.equal(results.desktop.restarted.missiles, 12);
    assert.equal(results.desktop.restarted.missileDetails.length, 0);
    assert.equal(results.desktop.restarted.kills, 0);
  });
  await check('desktop: real anti-ship strikes clear naval wave one and continue into wave two', async () => {
    await returnToBase(page);
    const started = await startMission(page, 'destroyer', 'naval');
    assert.equal(started.wave, 1);
    assert.match(started.mission.wave, /01\s*\/\s*03/);
    const launches = [];
    for (let i = 0; i < 2; i++) {
      const launch = await launchByKey(page), impact = await waitImpact(page, launch);
      launches.push({ launch, impact });
    }
    for (let i = 0; i < 100 && (await metrics(page)).wave < 2; i++) await tick(page, 6);
    const nextWave = await metrics(page);
    assert.equal(nextWave.state, 'playing');
    assert.equal(nextWave.mode, 'naval');
    assert.equal(nextWave.wave, 2);
    assert.equal(nextWave.enemies, 3);
    assert.equal(nextWave.kills, 2);
    assert.ok(nextWave.antiShipMissiles >= launches[1].launch.fired.antiShipMissiles && nextWave.antiShipMissiles <= 6);
    assert.equal(nextWave.missiles, 12);
    results.desktop.navalWave = { started, launches, nextWave };
    await screenshot(page, 'desktop-naval-wave-two');
  });
  await check('desktop: air targets accept F SAM and reject R anti-ship without spending surface inventory', async () => {
    await returnToBase(page);
    results.desktop.airDefenseStarted = await startMission(page, 'destroyer', 'training');
    for (let i = 0; i < 40 && (await metrics(page)).lockProgress < 1; i++) await tick(page, 6);
    const locked = await metrics(page);
    assert.equal(locked.lockProgress, 1);
    assert.equal(locked.antiShipLockProgress, 0);
    await page.keyboard.press('r');
    await tick(page, 2);
    assert.equal((await metrics(page)).antiShipMissiles, 6);
    assert.equal(asm(await metrics(page)).length, 0);
    await page.keyboard.press('f');
    await tick(page, 2);
    const sam = await metrics(page);
    assert.equal(sam.missiles, 11);
    assert.equal(sam.antiShipMissiles, 6);
    const projectile = sam.missileDetails.find(m => !m.enemy && m.weapon !== 'anti-ship');
    assert.ok(projectile);
    assert.equal(projectile.mesh.visualKind, 'sam');
    results.desktop.airDefenseSam = sam;
    results.desktop.airDefenseCooldown = await checkIndependentCooldown(page, 'sam');
    await screenshot(page, 'desktop-separate-sam-launch');
  });
  await check('desktop: aircraft hide anti-ship controls and ignore R while preserving flight play', async () => {
    await returnToBase(page);
    const before = await startMission(page, 'aircraft', 'training');
    assert.equal(await page.locator('#antiShipValue').isVisible(), false);
    assert.equal(await page.locator('#touchAntiShip').isVisible(), false);
    await page.keyboard.press('r');
    await tick(page, 2);
    const after = await metrics(page);
    assert.equal(after.antiShipMissiles, before.antiShipMissiles);
    assert.equal(after.missiles, before.missiles);
    assert.equal(after.ammo, before.ammo);
    assert.equal(asm(after).length, 0);
    assert.equal(after.state, 'playing');
    results.desktop.aircraft = after;
    await screenshot(page, 'aircraft-no-anti-ship');
  });
  await desktop.context.close(); activePage = null;

  const mobile = await contextFor({ width: 844, height: 390 }, true);
  const phone = mobile.page;
  await check('mobile landscape: independent anti-ship hit area fits without control or HUD overlap', async () => {
    results.mobile.started = await startMission(phone);
    assert.equal(results.mobile.started.quality, 'low');
    results.mobile.landscapeLayout = await layout(phone);
    assert.deepEqual(results.mobile.landscapeLayout.violations, []);
    await screenshot(phone, 'mobile-landscape-weapons');
  });
  await check('mobile landscape: trusted touch fires only anti-ship inventory', async () => {
    results.mobile.landscapeLaunch = await tapAntiShip(phone);
    await screenshot(phone, 'mobile-landscape-anti-ship-launch');
  });
  await check('mobile landscape: anti-ship controls do not disrupt three-finger steering, turret and cannon', async () => {
    results.mobile.landscapeTouches = await multitouch(phone, mobile.context, results.mobile.landscapeLayout.boxes);
  });
  await check('mobile portrait: the additional missile button remains separate and visible', async () => {
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.waitForFunction(() => Math.abs(window.__flight.world.camera.aspect - innerWidth / innerHeight) < 1e-6, null, { polling: 50 });
    await tick(phone, 20);
    await phone.locator('#pauseBtn').click();
    await phone.locator('#restartBtn').click();
    await tick(phone, 8);
    results.mobile.portrait = await metrics(phone);
    assert.equal(results.mobile.portrait.quality, 'low');
    assert.equal(results.mobile.portrait.antiShipMissiles, 6);
    results.mobile.portraitLayout = await layout(phone);
    assert.deepEqual(results.mobile.portraitLayout.violations, []);
    await screenshot(phone, 'mobile-portrait-weapons');
  });
  await check('mobile portrait: touch launches anti-ship and multi-touch releases stay independent', async () => {
    results.mobile.portraitLaunch = await tapAntiShip(phone);
    results.mobile.portraitTouches = await multitouch(phone, mobile.context, results.mobile.portraitLayout.boxes);
    await screenshot(phone, 'mobile-portrait-anti-ship-launch');
  });
  await check('browser: no JavaScript, shader or missing-resource errors', async () => { assert.deepEqual(errors, []); });
  await mobile.context.close(); activePage = null;
  results.passed = true;
  await rm(resolve(out, 'failure.png'), { force: true });
} catch (error) {
  results.passed = false; results.failedStep = activeStep; results.failure = String(error.stack || error);
  if (activePage && !activePage.isClosed()) {
    try { results.failureState = await metrics(activePage); await screenshot(activePage, 'failure'); } catch (captureError) { results.captureError = String(captureError); }
  }
  console.error(results.failure); process.exitCode = 1;
} finally {
  await writeFile(resolve(out, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}

