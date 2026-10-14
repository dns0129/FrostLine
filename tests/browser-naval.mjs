// Optional real-WebGL regression. Start server.py on BASE_URL before running.
// UI selections and trusted keyboard/touch events drive the real simulation.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.env.OUTPUT_DIR || 'verification/naval');
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath = process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8772';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const source = await readFile(resolve(root, 'app.js'), 'utf8');
await mkdir(out, { recursive: true });
const errors = [];
const results = { baseURL, checks: [], desktop: {}, mobile: {}, errors, boundaries: ['Browser training victory uses real keyboard gunfire against both ships.', 'The three-wave naval victory is covered separately by simulation tests.', 'Phone checks use emulated viewport and trusted CDP touch contacts, not physical hardware.'] };
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
      pos: p.pos.toArray(), ammo: p.ammo, missiles: p.missiles, antiShipMissiles: p.antiShipMissiles, antiShipLockProgress: sim.antiShipLockProgress, missileCooldown: sim.missileCooldown, antiShipCooldown: sim.antiShipCooldown, shots: sim.shots,
      liveMissiles: sim.missiles.length, tracers: sim.tracers.length, friendlyTracers: sim.tracers.filter(t => !t.enemy).length, particles: sim.particles.length, heat: p.heat, overheated: p.overheated, lockProgress: sim.lockProgress,
      targetId: sim.targetId, enemies: sim.enemies.length, input: input.read(),
      modelVisible: model?.visible, modelName: model?.name,
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
      hud: { speed: document.getElementById('speedValue').textContent, elevation: document.getElementById('altValue').textContent, health: document.getElementById('healthValue').textContent, missiles: document.getElementById('missileValue').textContent },
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

async function startShip(page, mode = 'naval-training') {
  await page.locator('[data-vehicle="destroyer"]').click();
  assert.equal(await page.locator('[data-vehicle="destroyer"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator(`[data-mode="${mode}"]`).isVisible(), true);
  await page.locator(`[data-mode="${mode}"]`).click();
  assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
  const menu = await baseMenu(page, mode);
  await page.locator('#startBtn').click();
  await tick(page, 8);
  const state = await metrics(page);
  assert.equal(state.kind, 'destroyer');
  assert.equal(state.mode, mode);
  assert.equal(state.state, 'playing');
  assert.equal(state.enemies, 2);
  assert.equal(state.glError, 0);
  assert.ok(state.ships.every(e => e.kind === 'ship'));
  assert.match(state.mission.objective, /艘/);
  assert.match(state.mission.killText, /击沉/);
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
    return { enemies, state: sim.state, time: sim.time, renderTime: world.elapsed, pos: sim.player.pos.toArray(), turretHeading: sim.player.turretHeading, turretPitch: sim.player.turretPitch, camera: world.camera.matrixWorld.elements.slice(), model: transforms };
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

const wrap = angle => ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

async function aimByKeyboard(page, targetId) {
  const actions = [];
  for (let pass = 0; pass < 3; pass++) {
    const aim = await page.evaluate(id => {
      const { sim } = window.__flight, p = sim.player, e = sim.enemies.find(e => e.id === id);
      if (!e) return null;
      const origin = p.pos.clone();
      origin.x += Math.sin(p.heading) * -32; origin.y += 8; origin.z += Math.cos(p.heading) * -32;
      const target = e.pos.clone(); target.y += e.aimHeight || 6;
      const flightTime = target.distanceTo(origin) / 930;
      target.addScaledVector(e.vel, flightTime).addScaledVector(p.vel, -flightTime);
      const dx = target.x - origin.x, dz = target.z - origin.z, horizontal = Math.hypot(dx, dz);
      return { currentYaw: p.turretHeading, currentPitch: p.turretPitch, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(target.y - origin.y + 1.6 * flightTime * flightTime, horizontal) };
    }, targetId);
    if (!aim) return actions;
    const yawDelta = wrap(aim.yaw - aim.currentYaw);
    const yawFrames = Math.round(Math.abs(yawDelta) / .72 * 60);
    if (yawFrames) {
      const key = yawDelta > 0 ? 'j' : 'l';
      await holdKeys(page, [key], Math.min(yawFrames, 180));
      actions.push({ key, frames: Math.min(yawFrames, 180), aim });
    }
    const pitchDelta = aim.pitch - aim.currentPitch;
    const pitchFrames = Math.round(Math.abs(pitchDelta) / .52 * 60);
    if (pitchFrames) {
      const key = pitchDelta > 0 ? 'w' : 's';
      await holdKeys(page, [key], Math.min(pitchFrames, 100));
      actions.push({ key, frames: Math.min(pitchFrames, 100), aim });
    }
    if (Math.abs(yawDelta) < .012 && Math.abs(pitchDelta) < .009) break;
  }
  return actions;
}

async function sinkWithKeyboard(page, targetId, label) {
  const trace = [];
  (results.combatProgress ||= {})[label] = trace;
  let hitCaptured = false;
  for (let attempt = 0; attempt < 18; attempt++) {
    const before = await metrics(page);
    const target = before.ships.find(e => e.id === targetId);
    if (!target) break;
    const aiming = await aimByKeyboard(page, targetId);
    await holdKeys(page, ['Space'], 30);
    await tick(page, 30);
    const after = await metrics(page);
    const remaining = after.ships.find(e => e.id === targetId);
    trace.push({ attempt, aiming, ammo: after.ammo, shots: after.shots, hits: after.hits, healthBefore: target.health, healthAfter: remaining?.health || 0, state: after.state, kills: after.kills });
    if (!hitCaptured && (!remaining || remaining.health < target.health)) {
      hitCaptured = true;
      await screenshot(page, label + '-hit');
    }
    if (!remaining) break;
    assert.equal(after.state, 'playing', 'a live target should not silently end naval training');
  }
  const after = await metrics(page);
  assert.equal(after.ships.some(e => e.id === targetId), false, `real keyboard gunfire must sink ${targetId}`);
  assert.ok(hitCaptured, 'at least one real swept cannon hit must be observed');
  await screenshot(page, label + '-sunk');
  return { trace, after };
}

// All ammunition is consumed by a held, trusted Space key. Display frames
// advance by 100 ms, while app.frame still advances its fixed 1/60 s physics.
async function expendAmmoByKeyboard(page) {
  const trace = [];
  results.desktop.ammoProgress = trace;
  await page.keyboard.down('j');
  await tick(page, 44, 100);
  await page.keyboard.up('j');
  const aimedAway = await metrics(page);
  assert.ok(Math.cos(aimedAway.turretHeading - aimedAway.heading) < -.95, 'cannon must face away from both live targets');
  for (let cycle = 0; cycle < 30; cycle++) {
    await page.keyboard.down('Space');
    const fired = await page.evaluate(() => {
      const { sim, frame } = window.__flight;
      for (let i = 0; i < 90 && sim.state === 'playing' && sim.player.ammo > 0 && !sim.player.overheated; i++) {
        window.__now += 100; window.__hudTexts.length = 0; frame(window.__now);
      }
      return { state: sim.state, ammo: sim.player.ammo, heat: sim.player.heat, overheated: sim.player.overheated, shots: sim.shots, time: sim.time, health: sim.player.health, friendlyTracers: sim.tracers.filter(t => !t.enemy).length };
    });
    await page.keyboard.up('Space');
    trace.push({ cycle, phase: 'fire', ...fired });
    assert.equal(fired.health, 300);
    if (fired.ammo === 0) {
      assert.equal(fired.state, 'playing', 'remaining anti-ship missiles keep the task playable');
      assert.ok(fired.friendlyTracers > 0, 'the last real shot remains in flight when inventory reaches zero');
      results.desktop.zeroAmmoInFlight = fired;
      break;
    }
    assert.equal(fired.state, 'playing');
    const cooled = await page.evaluate(() => {
      const { sim, frame } = window.__flight;
      for (let i = 0; i < 90 && sim.state === 'playing' && sim.player.overheated; i++) {
        window.__now += 100; window.__hudTexts.length = 0; frame(window.__now);
      }
      return { ammo: sim.player.ammo, heat: sim.player.heat, overheated: sim.player.overheated, time: sim.time };
    });
    trace.push({ cycle, phase: 'release-and-cool', ...cooled });
    assert.equal(cooled.overheated, false, 'releasing the trigger must permit another firing burst');
  }
  assert.ok(results.desktop.zeroAmmoInFlight, 'all 240 rounds must be fired through real keyboard input');
  for (let i = 0; i < 60 && (await metrics(page)).state === 'playing'; i++) await tick(page, 1, 100);
  return { aimedAway, trace, after: await metrics(page) };
}

async function returnToBase(page) {
  const state = (await metrics(page)).state;
  if (state === 'won' || state === 'lost') await page.locator('#resultExitBtn').click();
  else { if (state !== 'paused') await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); }
  assert.equal(await page.locator('#menu').isVisible(), true);
}

try {
  const desktop = await contextFor({ width: 1440, height: 900 });
  const page = desktop.page;
  await check('desktop: naval missions are restricted to destroyer selection', async () => {
    for (const mode of ['naval', 'naval-training']) {
      const button = page.locator(`[data-mode="${mode}"]`);
      assert.ok(!(await button.isVisible()) || await button.isDisabled(), `${mode} must be unavailable to aircraft`);
    }
    results.desktop.started = await startShip(page);
  });
  await check('desktop: two surface ship types and HUD target marks render visibly', async () => {
    const state = await metrics(page);
    assert.deepEqual(state.ships.map(e => e.shipType).sort(), ['frigate', 'patrol']);
    for (const e of state.ships) {
      assert.equal(e.pos[1], .5);
      assert.equal(e.model.visible, true);
      assert.equal(e.model.kind, 'ship');
      assert.equal(e.model.shipType, e.shipType);
      assert.equal(e.screen.visible, true);
      assert.equal(e.passive, true);
    }
    assert.ok(state.hudTexts.some(text => /炮向/.test(text)));
    assert.ok(state.hudTexts.some(text => /TGT|巡逻艇|护卫舰|敌舰/.test(text)), 'actual canvas target labels must be drawn');
    results.desktop.surface = state;
    await screenshot(page, 'desktop-surface-targets');
  });
  await check('desktop: SAM refuses sea targets without consuming inventory', async () => {
    const before = await metrics(page);
    await page.keyboard.press('f');
    await tick(page, 10);
    const after = await metrics(page);
    assert.equal(after.missiles, before.missiles);
    assert.equal(after.liveMissiles, 0);
    assert.equal(after.lockProgress, 0);
    assert.match(await page.locator('#toast').textContent(), /防空|空中|海面|敌舰/);
    results.desktop.samRejected = after;
  });
  await check('desktop: real cannon keys damage and sink the patrol boat', async () => {
    const target = (await metrics(page)).ships.find(e => e.shipType === 'patrol');
    results.desktop.patrol = await sinkWithKeyboard(page, target.id, 'desktop-patrol');
    assert.equal(results.desktop.patrol.after.kills, 1);
    assert.match(results.desktop.patrol.after.mission.objective, /1\s*艘/);
    assert.equal(results.desktop.patrol.after.mission.kills, '1');
  });
  await check('desktop: pause freezes player, enemy ships, turrets and camera', async () => {
    await page.locator('#pauseBtn').click();
    await tick(page, 1);
    const before = await frozenState(page);
    await tick(page, 30);
    assert.deepEqual(await frozenState(page), before);
    assert.equal(before.enemies.length, 1);
    results.desktop.pause = { time: before.time, frozen: true, enemyModels: before.enemies.length };
    await screenshot(page, 'desktop-paused');
  });
  await check('desktop: restart restores naval targets and consumables', async () => {
    await page.locator('#restartBtn').click();
    await tick(page, 8);
    results.desktop.restarted = await metrics(page);
    assert.equal(results.desktop.restarted.mode, 'naval-training');
    assert.equal(results.desktop.restarted.kills, 0);
    assert.equal(results.desktop.restarted.ammo, 240);
    assert.equal(results.desktop.restarted.health, 300);
    assert.equal(results.desktop.restarted.enemies, 2);
  });
  await check('desktop: real keyboard cannon fire wins the two-ship training', async () => {
    const first = (await metrics(page)).ships.find(e => e.shipType === 'patrol');
    results.desktop.trainingPatrol = await sinkWithKeyboard(page, first.id, 'desktop-training-patrol');
    const second = (await metrics(page)).ships.find(e => e.shipType === 'frigate');
    results.desktop.trainingFrigate = await sinkWithKeyboard(page, second.id, 'desktop-training-frigate');
    const won = await metrics(page);
    assert.equal(won.state, 'won');
    assert.equal(won.kills, 2);
    assert.equal(won.enemies, 0);
    assert.equal(won.health, 300, 'training ships must never attack');
    assert.equal(await page.locator('#resultPanel').isVisible(), true);
    assert.match(won.mission.result, /击沉/);
    assert.match(await page.locator('#resultKills').textContent(), /^2\s*\//);
    results.desktop.victory = won;
    await screenshot(page, 'desktop-training-victory');
    await page.locator('#againBtn').click();
    await tick(page, 8);
    assert.equal((await metrics(page)).mode, 'naval-training');
    assert.equal((await metrics(page)).enemies, 2);
  });
  await check('desktop: cannon depletion keeps the task playable when anti-ship missiles remain', async () => {
    results.desktop.ammoExhaustion = await expendAmmoByKeyboard(page);
    const ended = results.desktop.ammoExhaustion.after;
    assert.equal(ended.state, 'playing');
    assert.equal(ended.endReason, '');
    assert.equal(ended.antiShipMissiles, 6);
    assert.equal(ended.ammo, 0);
    assert.equal(ended.shots, 240);
    assert.equal(ended.hits, 0);
    assert.equal(ended.kills, 0);
    assert.equal(ended.enemies, 2);
    assert.equal(ended.friendlyTracers, 0);
    assert.equal(ended.health, 300);
    assert.equal(ended.modelVisible, true);
    assert.equal(ended.particles, 0);
    assert.equal(await page.locator('#resultPanel').isVisible(), false);
    assert.equal(ended.glError, 0);
    await screenshot(page, 'gun-depleted-anti-ship-available');
  });
  await check('desktop: real anti-ship launch wins after cannon depletion and retry restores both weapons', async () => {
    const launches = [];
    while ((await metrics(page)).state === 'playing' && (await metrics(page)).enemies > 0) {
      for (let i = 0; i < 40 && (await metrics(page)).antiShipLockProgress < 1; i++) await tick(page, 6);
      const before = await metrics(page);
      assert.equal(before.antiShipLockProgress, 1);
      await page.keyboard.press('r');
      await tick(page, 2);
      const fired = await metrics(page);
      assert.equal(fired.antiShipMissiles, before.antiShipMissiles - 1);
      assert.equal(fired.missiles, 12);
      await tick(page, 10);
      assert.match(await page.locator('#antiShipStatus').textContent(), /冷却/);
      assert.match(await page.locator('#touchAntiShipLock').textContent(), /冷却/);
      assert.doesNotMatch(await page.locator('#samLockStatus').textContent(), /冷却/);
      assert.doesNotMatch(await page.locator('#touchLock').textContent(), /冷却/);
      assert.equal(await page.locator('#touchAntiShip').evaluate(e => e.classList.contains('ready')), false);
      const cooling = await metrics(page);
      assert.ok(cooling.antiShipCooldown > 0);
      assert.equal(cooling.missileCooldown, 0);
      for (let i = 0; i < 120 && (await metrics(page)).kills === before.kills; i++) await tick(page, 6);
      const after = await metrics(page);
      assert.ok(after.kills > before.kills);
      launches.push({ before, fired, cooling, after });
      assert.ok(launches.length <= 2);
    }
    const rescued = await metrics(page);
    assert.equal(rescued.state, 'won');
    assert.equal(rescued.kills, 2);
    assert.equal(rescued.ammo, 0);
    assert.equal(rescued.antiShipMissiles, 4);
    results.desktop.antiShipRescue = { launches, rescued };
    await screenshot(page, 'gun-empty-anti-ship-victory');
    await page.locator('#againBtn').click();
    await tick(page, 8);
    const restarted = await metrics(page);
    assert.equal(restarted.state, 'playing');
    assert.equal(restarted.mode, 'naval-training');
    assert.equal(restarted.endReason, '');
    assert.equal(restarted.health, 300);
    assert.equal(restarted.ammo, 240);
    assert.equal(restarted.antiShipMissiles, 6);
    assert.equal(restarted.enemies, 2);
    const fired = await holdKeys(page, ['Space'], 30);
    assert.ok(fired.shots > 0);
    assert.ok(fired.ammo < 240);
    results.desktop.ammoRetry = { restarted, fired };
  });
  await check('desktop: live sea battle ships fire back and damage the player', async () => {
    await returnToBase(page);
    results.desktop.battleStarted = await startShip(page, 'naval');
    assert.ok(results.desktop.battleStarted.ships.every(e => !e.passive));
    let state = results.desktop.battleStarted, peakEnemyTracers = 0;
    for (let second = 0; second < 24 && state.health === 300; second++) {
      await tick(page, 60);
      state = await metrics(page);
      peakEnemyTracers = Math.max(peakEnemyTracers, state.enemyTracers);
    }
    assert.ok(peakEnemyTracers > 0, 'active enemy naval cannon fire must be present');
    assert.ok(state.health < 300, 'enemy naval gunfire must damage the stationary player');
    assert.equal(state.mode, 'naval');
    assert.equal(state.wave, 1);
    assert.equal(state.kills, 0);
    results.desktop.retaliation = { peakEnemyTracers, after: state };
    await screenshot(page, 'desktop-enemy-retaliation');
  });
  await check('desktop: returning to aircraft restores safe flight mission selection', async () => {
    await returnToBase(page);
    await page.locator('[data-vehicle="aircraft"]').click();
    for (const mode of ['naval', 'naval-training']) {
      const button = page.locator(`[data-mode="${mode}"]`);
      assert.ok(!(await button.isVisible()) || await button.isDisabled());
    }
    await page.locator('[data-mode="training"]').click();
    await page.locator('#startBtn').click();
    await tick(page, 30);
    results.desktop.aircraft = await metrics(page);
    assert.equal(results.desktop.aircraft.kind, 'aircraft');
    assert.equal(results.desktop.aircraft.mode, 'training');
    assert.ok(results.desktop.aircraft.ships.every(e => e.kind !== 'ship'));
    assert.equal(results.desktop.aircraft.glError, 0);
    await screenshot(page, 'aircraft-regression');
  });
  await desktop.context.close(); activePage = null;

  const mobile = await contextFor({ width: 844, height: 390 }, true);
  const phone = mobile.page;
  await check('mobile landscape: real entry displays surface targets and valid HUD layout', async () => {
    results.mobile.started = await startShip(phone);
    assert.equal(results.mobile.started.quality, 'low');
    assert.ok(results.mobile.started.ships.every(e => e.model.visible && e.screen.visible));
    results.mobile.landscapeLayout = await layout(phone);
    assert.deepEqual(results.mobile.landscapeLayout.violations, []);
    await screenshot(phone, 'mobile-landscape');
  });
  await check('mobile landscape: three contacts independently steer, aim and fire', async () => {
    results.mobile.landscapeTouches = await multitouch(phone, mobile.context, results.mobile.landscapeLayout.boxes);
    await screenshot(phone, 'mobile-landscape-after-touch');
  });
  await check('mobile portrait: resize renders naval targets and controls without overlap', async () => {
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.waitForFunction(() => Math.abs(window.__flight.world.camera.aspect - innerWidth / innerHeight) < 1e-6, null, { polling: 50 });
    await tick(phone, 20);
    results.mobile.portrait = await metrics(phone);
    assert.equal(results.mobile.portrait.quality, 'low');
    assert.equal(results.mobile.portrait.glError, 0);
    assert.ok(results.mobile.portrait.ships.every(e => e.model.visible));
    results.mobile.portraitLayout = await layout(phone);
    assert.deepEqual(results.mobile.portraitLayout.violations, []);
    await screenshot(phone, 'mobile-portrait');
  });
  await check('mobile portrait: multi-touch releases preserve other naval controls', async () => {
    results.mobile.portraitTouches = await multitouch(phone, mobile.context, results.mobile.portraitLayout.boxes);
    await screenshot(phone, 'mobile-portrait-after-touch');
  });
  await check('mobile portrait: five-mission base menu keeps start button accessible', async () => {
    await returnToBase(phone);
    results.mobile.portraitMenu = await baseMenu(phone, 'naval-training');
    assert.equal(await phone.locator('[data-mode="naval"]').isVisible(), true);
    assert.equal(await phone.locator('[data-mode="naval-training"]').isVisible(), true);
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

