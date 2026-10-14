// Optional real-WebGL regression. Start server.py on BASE_URL before running.
// UI selections and trusted keyboard/touch events drive the real simulation.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'verification/destroyer');
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath = process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8771';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const source = await readFile(resolve(root, 'app.js'), 'utf8');
await mkdir(out, { recursive: true });
const errors = [];
const results = { baseURL, checks: [], desktop: {}, mobile: {}, errors };
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

const tick = (page, frames = 1) => page.evaluate(frames => {
  for (let i = 0; i < frames; i++) { window.__now += 1000 / 60; window.__flight.frame(window.__now); }
}, frames);

async function metrics(page) {
  return page.evaluate(() => {
    const { sim, world, input } = window.__flight;
    const p = sim.player;
    const model = p.kind === 'destroyer' ? (world.playerShip || world.playerDestroyer || world.destroyer) : world.playerJet;
    return {
      state: sim.state, vehicle: sim.vehicle, kind: p.kind, time: sim.time,
      speed: p.speed, throttle: p.throttle, health: p.health, heading: p.heading,
      turretHeading: p.turretHeading, turretPitch: p.turretPitch, rudder: p.rudder,
      pos: p.pos.toArray(), ammo: p.ammo, missiles: p.missiles, shots: sim.shots,
      liveMissiles: sim.missiles.length, tracers: sim.tracers.length, lockProgress: sim.lockProgress,
      targetId: sim.targetId, enemies: sim.enemies.length, input: input.read(),
      modelVisible: model?.visible, modelName: model?.name,
      camera: { position: world.camera.position.toArray(), fov: world.camera.fov, aspect: world.camera.aspect, distance: world.camera.position.distanceTo(p.pos) },
      renderSize: { width: world.width, height: world.height, canvasWidth: world.canvas.width, canvasHeight: world.canvas.height },
      quality: world.effectiveQuality, draws: world.renderer.info.render.calls,
      triangles: world.renderer.info.render.triangles, glError: world.renderer.getContext().getError(),
      hud: { speed: document.getElementById('speedValue').textContent, elevation: document.getElementById('altValue').textContent, health: document.getElementById('healthValue').textContent, missiles: document.getElementById('missileValue').textContent },
    };
  });
}

async function screenshot(page, name) {
  await page.screenshot({ path: resolve(out, name + '.png') });
}

async function startShip(page) {
  await page.locator('[data-vehicle="destroyer"]').click();
  assert.equal(await page.locator('[data-vehicle="destroyer"]').getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#startBtn').textContent(), /开始航行/);
  await page.locator('[data-mode="training"]').click();
  assert.match(await page.locator('#trainingName').textContent(), /初次出航/);
  await page.locator('#startBtn').click();
  await tick(page, 2);
  const state = await metrics(page);
  assert.equal(state.kind, 'destroyer');
  assert.equal(state.state, 'playing');
  assert.equal(state.speed, 0);
  assert.equal(state.throttle, 0);
  assert.equal(state.health, 300);
  assert.equal(state.ammo, 240);
  assert.equal(state.missiles, 12);
  assert.equal(state.enemies, 3);
  assert.equal(state.glError, 0);
  return state;
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
    return { state: sim.state, time: sim.time, renderTime: world.elapsed, pos: sim.player.pos.toArray(), turretHeading: sim.player.turretHeading, turretPitch: sim.player.turretPitch, camera: world.camera.matrixWorld.elements.slice(), model: transforms };
  });
}

async function layout(page) {
  const controls = ['joystick', 'aimJoystick', 'touchFire', 'touchMissile', 'touchFlare', 'touchBoost', 'touchTarget', 'touchCamera', 'pauseBtn', 'throttle'];
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

try {
  const desktop = await contextFor({ width: 1440, height: 900 });
  const page = desktop.page;
  await check('desktop: select destroyer and enter training', async () => {
    results.desktop.started = await startShip(page);
    await screenshot(page, 'desktop-start');
  });
  await check('desktop: stopped hull stays at sea level', async () => {
    await tick(page, 60);
    results.desktop.idle = await metrics(page);
    assert.equal(results.desktop.idle.speed, 0);
    assert.deepEqual(results.desktop.idle.pos, results.desktop.started.pos);
    assert.equal(results.desktop.idle.pos[1], .5);
  });
  await check('desktop: throttle starts voyage and A turns helm', async () => {
    await setThrottle(page, true);
    await tick(page, 240);
    results.desktop.cruise = await metrics(page);
    assert.ok(results.desktop.cruise.speed > 8);
    assert.ok(results.desktop.cruise.pos[2] < results.desktop.idle.pos[2] - 10);
    results.desktop.helm = await holdKeys(page, ['a'], 90);
    assert.ok(results.desktop.helm.heading > results.desktop.cruise.heading + .03);
    assert.equal(results.desktop.helm.pos[1], .5);
    await screenshot(page, 'desktop-voyage');
  });
  await check('desktop: J/L independently slew turret, W raises it', async () => {
    const before = await metrics(page);
    results.desktop.turretLeft = await holdKeys(page, ['j'], 24);
    assert.ok(results.desktop.turretLeft.turretHeading > before.turretHeading + .1);
    results.desktop.turretRight = await holdKeys(page, ['l'], 24);
    assert.ok(results.desktop.turretRight.turretHeading < results.desktop.turretLeft.turretHeading - .1);
    results.desktop.turretUp = await holdKeys(page, ['w'], 24);
    assert.ok(results.desktop.turretUp.turretPitch > results.desktop.turretRight.turretPitch + .1);
    assert.ok(Math.abs(results.desktop.turretUp.heading - before.heading) < .05, 'turret keys must not steer the hull');
  });
  await check('desktop: cannon fires and F launches inventory-backed SAM', async () => {
    const before = await metrics(page);
    results.desktop.gun = await holdKeys(page, ['Space'], 36);
    assert.ok(results.desktop.gun.shots > before.shots);
    assert.ok(results.desktop.gun.ammo < before.ammo);
    assert.ok(results.desktop.gun.tracers > 0);
    if (results.desktop.gun.lockProgress < 1) await tick(page, 100);
    results.desktop.locked = await metrics(page);
    assert.equal(results.desktop.locked.lockProgress, 1, 'training target must acquire via real radar');
    await page.keyboard.press('f');
    await tick(page, 2);
    results.desktop.sam = await metrics(page);
    assert.equal(results.desktop.sam.missiles, results.desktop.locked.missiles - 1);
    assert.ok(results.desktop.sam.liveMissiles > 0);
    await screenshot(page, 'desktop-weapons');
  });
  await check('desktop: Ctrl emergency braking slows ship', async () => {
    const before = await metrics(page);
    results.desktop.braked = await holdKeys(page, ['Control'], 120);
    assert.ok(results.desktop.braked.speed < before.speed * .4);
  });
  await check('desktop: C switches bridge and external cameras', async () => {
    await tick(page, 20);
    const before = await metrics(page);
    await page.keyboard.press('c');
    await tick(page, 20);
    results.desktop.bridge = await metrics(page);
    assert.match(await page.locator('#toast').textContent(), /舰桥视角/);
    assert.ok(results.desktop.bridge.camera.distance < before.camera.distance * .65);
    assert.equal(results.desktop.bridge.glError, 0);
    await screenshot(page, 'desktop-bridge');
    await page.keyboard.press('c');
    await tick(page, 20);
    results.desktop.external = await metrics(page);
    assert.match(await page.locator('#toast').textContent(), /舰外视角/);
    assert.ok(results.desktop.external.camera.distance > results.desktop.bridge.camera.distance * 1.5);
  });
  await check('desktop: pause freezes mission, camera, hull and turret', async () => {
    await page.locator('#pauseBtn').click();
    await tick(page, 1);
    const before = await frozenState(page);
    assert.equal(before.state, 'paused');
    assert.ok(before.model.length > 0, 'ship render model must be exposed for freeze verification');
    await tick(page, 45);
    const after = await frozenState(page);
    assert.deepEqual(after, before);
    results.desktop.pause = { frozen: true, modelObjects: before.model.length, time: before.time };
    await screenshot(page, 'desktop-paused');
    await page.locator('#resumeBtn').click();
    await tick(page, 4);
    assert.equal((await metrics(page)).state, 'playing');
  });
  await check('desktop: return to base and retain aircraft training controls', async () => {
    await page.locator('#pauseBtn').click();
    await page.locator('#exitBtn').click();
    await page.locator('[data-vehicle="aircraft"]').click();
    await page.locator('[data-mode="training"]').click();
    await page.locator('#startBtn').click();
    await tick(page, 60);
    results.desktop.aircraft = await metrics(page);
    assert.equal(results.desktop.aircraft.kind, 'aircraft');
    assert.ok(results.desktop.aircraft.speed > 100);
    assert.ok(results.desktop.aircraft.pos[1] > 100);
    assert.equal(results.desktop.aircraft.ammo, 900);
    assert.equal(results.desktop.aircraft.missiles, 6);
    const bank = await page.evaluate(() => window.__flight.sim.player.bank);
    await holdKeys(page, ['a'], 24);
    assert.ok(Math.abs(await page.evaluate(() => window.__flight.sim.player.bank)) > Math.abs(bank) + .05);
    await page.keyboard.press('c');
    await tick(page, 10);
    assert.equal(await page.evaluate(() => window.__flight.world.playerJet.visible), false);
    await page.keyboard.press('c');
    await tick(page, 10);
    assert.equal(await page.evaluate(() => window.__flight.world.playerJet.visible), true);
    assert.equal((await metrics(page)).glError, 0);
    await screenshot(page, 'aircraft-regression');
  });
  await desktop.context.close();
  activePage = null;

  const mobile = await contextFor({ width: 844, height: 390 }, true);
  const phone = mobile.page;
  await check('mobile landscape: enter destroyer training from base', async () => {
    results.mobile.started = await startShip(phone);
    assert.equal(results.mobile.started.quality, 'low');
    await setThrottle(phone, true);
    await tick(phone, 30);
  });
  await check('mobile landscape: control hit areas fit and do not overlap', async () => {
    results.mobile.landscapeLayout = await layout(phone);
    assert.deepEqual(results.mobile.landscapeLayout.violations, []);
    await screenshot(phone, 'mobile-landscape');
  });
  await check('mobile landscape: three fingers steer, aim and fire independently', async () => {
    results.mobile.landscapeTouches = await multitouch(phone, mobile.context, results.mobile.landscapeLayout.boxes);
    await screenshot(phone, 'mobile-landscape-after-touch');
  });
  await check('mobile portrait: control hit areas fit and do not overlap', async () => {
    await phone.setViewportSize({ width: 390, height: 844 });
    // Native resize delivery may lag setViewportSize(). With RAF stubbed, a
    // late renderer.setSize() clears the canvas after our manual frames.
    await phone.waitForFunction(() => Math.abs(window.__flight.world.camera.aspect - innerWidth / innerHeight) < 1e-6, null, { polling: 50 });
    await tick(phone, 20);
    results.mobile.portrait = await metrics(phone);
    assert.equal(results.mobile.portrait.quality, 'low');
    assert.equal(results.mobile.portrait.glError, 0);
    results.mobile.portraitLayout = await layout(phone);
    assert.deepEqual(results.mobile.portraitLayout.violations, []);
    await screenshot(phone, 'mobile-portrait');
  });
  await check('mobile portrait: three-finger releases preserve other controls', async () => {
    results.mobile.portraitTouches = await multitouch(phone, mobile.context, results.mobile.portraitLayout.boxes);
    await screenshot(phone, 'mobile-portrait-after-touch');
  });
  await check('browser: no JavaScript, shader or missing-resource errors', async () => {
    assert.deepEqual(errors, []);
  });
  await mobile.context.close();
  activePage = null;
  results.passed = true;
  await rm(resolve(out, 'failure.png'), { force: true });
} catch (error) {
  results.passed = false;
  results.failedStep = activeStep;
  results.failure = String(error.stack || error);
  if (activePage && !activePage.isClosed()) {
    try { results.failureState = await metrics(activePage); await screenshot(activePage, 'failure'); } catch (captureError) { results.captureError = String(captureError); }
  }
  console.error(results.failure);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(out, 'metrics.json'), JSON.stringify(results, null, 2) + '\n');
  await browser.close();
}
