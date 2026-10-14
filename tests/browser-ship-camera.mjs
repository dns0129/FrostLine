// Optional real-WebGL regression. Start server.py on BASE_URL before running.
// Trusted keyboard, mouse and CDP touch contacts drive the real game; the hook
// only exposes state and advances the existing requestAnimationFrame callback.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.env.OUTPUT_DIR || 'verification/ship-camera');
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath = process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8774';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const source = await readFile(resolve(root, 'app.js'), 'utf8');
await mkdir(out, { recursive: true });
const errors = [];
const results = { baseURL, checks: [], desktop: {}, mobile: {}, errors, boundaries: ['Only real UI selections, mouse, keyboard and trusted CDP touch events change gameplay.', 'Camera and hull projection checks use the real WebGL renderer.', 'Phone checks emulate viewports and multiple touch contacts, not physical phone hardware.'] };
const verifiedFiles = ['app.js', 'input.js', 'ship-camera.js', 'renderer.js', 'index.html', 'style.css'];
const sourceChecksums = async () => Object.fromEntries(await Promise.all(verifiedFiles.map(async name => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')])));
results.sourceChecksums = await sourceChecksums();
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', `--use-angle=${process.env.BROWSER_ANGLE || 'metal'}`, '--enable-unsafe-swiftshader'] });
let activePage, activeStep = 'load';
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const close = (a, b, tolerance = 1e-8, label = 'values') => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

async function check(name, fn) { activeStep = name; await fn(); results.checks.push(name); console.log(`PASS ${name}`); }
async function contextFor(viewport, touch = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(({ touch }) => {
    window.__now = 0;
    window.requestAnimationFrame = () => 1;
    window.__hudTexts = [];
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.id === 'hudCanvas') window.__hudTexts.push(String(text));
      if (this.canvas.id === 'hudCanvas' && String(text).startsWith('炮向 ')) {
        const [x, y] = args, m = this.measureText(String(text));
        window.__gunLabel = { text: String(text), x: x - m.width / 2, y: y - m.actualBoundingBoxAscent, width: m.width, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
      }
      return nativeText.call(this, text, ...args);
    };
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: 'aircraft', quality: touch ? 'auto' : 'high', sound: false, invert: false, cameraZoom: 100 }));
  }, { touch });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__flight={sim,world,start,frame,action,input,presentation,selectVehicle,THREE,settings,get cockpit(){return cockpit}};\n' }));
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', error => errors.push({ kind: 'pageerror', message: String(error) }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'resource', status: response.status(), url: response.url() }); });
  await page.goto(baseURL + '/?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__flight);
  await page.evaluate(() => window.__flight.world.sky.userData.ready);
  await page.evaluate(() => { const diagnostics = document.getElementById('renderDiagnostics'); if (diagnostics) diagnostics.style.display = 'none'; });
  await page.evaluate(() => {
    window.__pointerEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.getElementById('world').addEventListener(type, e => window.__pointerEvents.push({ type, button: e.button, buttons: e.buttons, id: e.pointerId, pointerType: e.pointerType }), true);
  });
  return { context, page };
}
const tick = (page, frames = 1) => page.evaluate(frames => { for (let i = 0; i < frames; i++) { window.__now += 1000 / 60; window.__hudTexts.length = 0; window.__gunLabel = null; window.__flight.frame(window.__now); } }, frames);
async function metrics(page) {
  return page.evaluate(() => {
    const { sim, world, input, THREE, cockpit, settings } = window.__flight, p = sim.player, rig = world.shipChase;
    const model = p.kind === 'destroyer' ? world.playerShip : world.playerJet;
    const screen = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minDepth: Infinity, maxDepth: -Infinity, vertices: 0 };
    model?.traverse(object => {
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
      const positions = object.geometry?.attributes?.position; if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        const q = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(world.camera);
        const x = (q.x + 1) * innerWidth / 2, y = (1 - q.y) * innerHeight / 2;
        screen.minX = Math.min(screen.minX, x); screen.maxX = Math.max(screen.maxX, x);
        screen.minY = Math.min(screen.minY, y); screen.maxY = Math.max(screen.maxY, y);
        screen.minDepth = Math.min(screen.minDepth, q.z); screen.maxDepth = Math.max(screen.maxDepth, q.z); screen.vertices++;
      }
    });
    return { state: sim.state, kind: p.kind, time: sim.time, heading: p.heading, turretHeading: p.turretHeading, turretPitch: p.turretPitch, speed: p.speed, pos: p.pos.toArray(), shots: sim.shots, ammo: p.ammo, input: input.read(), cockpit, zoomSetting: settings.cameraZoom, cameraZoom: world.cameraZoom, hudTexts: window.__hudTexts.slice(), orbit: rig ? { yaw: rig.yaw, pitch: rig.pitch, viewYaw: rig.viewYaw, viewPitch: rig.viewPitch, zoom: rig.zoom } : null, camera: { position: world.camera.position.toArray(), target: world.cameraTarget.toArray(), offset: world.camera.position.clone().sub(p.pos).toArray(), quaternion: world.camera.quaternion.toArray(), distance: world.camera.position.distanceTo(p.pos), fov: world.camera.fov }, modelVisible: model?.visible, screen, pointerState: { camera: input.cameraPointers?.size ?? 0, mouseOrbit: !!input.mouseOrbit, mouseFireId: input.mouseFireId, joystick: input.joystickId, aim: input.aimJoystickId }, glError: world.renderer.getContext().getError(), viewport: { width: innerWidth, height: innerHeight } };
  });
}
function wholeShip(state) {
  assert.ok(state.screen.vertices > 100, 'the visible hull geometry must be measured');
  assert.ok(state.screen.minDepth > -1 && state.screen.maxDepth < 1, 'the entire vessel must remain in front of the camera');
  assert.ok(state.screen.minX >= 0 && state.screen.maxX <= state.viewport.width, `ship must fit horizontally: ${JSON.stringify(state.screen)}`);
  assert.ok(state.screen.minY >= 0 && state.screen.maxY <= state.viewport.height, `ship must fit vertically: ${JSON.stringify(state.screen)}`);
  assert.equal(state.glError, 0);
}
async function screenshot(page, name) { await page.screenshot({ path: resolve(out, name + '.png') }); }
async function startMission(page, vehicle = 'destroyer', mode = 'naval-training') {
  await page.locator(`[data-vehicle="${vehicle}"]`).click();
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.locator('#startBtn').click(); await tick(page, 8);
  const state = await metrics(page); assert.equal(state.kind, vehicle); assert.equal(state.state, 'playing'); assert.equal(state.glError, 0); return state;
}
async function returnToBase(page) {
  const state = (await metrics(page)).state;
  if (state === 'won' || state === 'lost') await page.locator('#resultExitBtn').click();
  else { if (state !== 'paused') await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); }
}
async function dragMouse(page, dx, dy, { button = 'right', x = 560, y = 330 } = {}) {
  await page.mouse.move(x, y); await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up({ button }); await tick(page, 75);
  return metrics(page);
}
async function holdKeys(page, keys, frames) {
  for (const key of keys) await page.keyboard.down(key); await tick(page, frames);
  for (const key of keys.slice().reverse()) await page.keyboard.up(key); return metrics(page);
}
async function frozenState(page) {
  return page.evaluate(() => {
    const { sim, world } = window.__flight;
    const model = []; world.playerShip.traverse(o => model.push({ name: o.name, visible: o.visible, position: o.position.toArray(), rotation: o.rotation.toArray(), matrix: o.matrixWorld.elements.slice() }));
    return { state: sim.state, time: sim.time, renderTime: world.elapsed, pos: sim.player.pos.toArray(), heading: sim.player.heading, turretHeading: sim.player.turretHeading, turretPitch: sim.player.turretPitch, camera: world.camera.matrixWorld.elements.slice(), orbit: { yaw: world.shipChase.yaw, pitch: world.shipChase.pitch }, model };
  });
}
async function layout(page) {
  const controls = ['touchRecenter', 'touchAntiShip', 'joystick', 'aimJoystick', 'touchFire', 'touchMissile', 'touchFlare', 'touchBoost', 'touchTarget', 'touchCamera', 'pauseBtn', 'throttle'];
  const boxes = {}, viewport = page.viewportSize(), violations = [];
  for (const id of controls) { assert.equal(await page.locator('#' + id).isVisible(), true); const box = await page.locator('#' + id).boundingBox(); assert.ok(box && box.width > 0 && box.height > 0); boxes[id] = box; }
  for (const [id, b] of Object.entries(boxes)) if (b.x < -.5 || b.y < -.5 || b.x + b.width > viewport.width + .5 || b.y + b.height > viewport.height + .5) violations.push(`${id} extends beyond viewport`);
  const entries = Object.entries(boxes);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [a, x] = entries[i], [b, y] = entries[j], ox = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x), oy = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
    if (ox > .5 && oy > .5) violations.push(`${a} overlaps ${b} (${ox.toFixed(1)} × ${oy.toFixed(1)})`);
  }
  for (const selectors of [['.airframe', '.flight-readout.left'], ['.score-box', '.flight-readout.right']]) {
    const [x, y] = await Promise.all(selectors.map(s => page.locator(s).boundingBox()));
    const ox = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x), oy = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
    if (ox > .5 && oy > .5) violations.push(`HUD ${selectors.join(' overlaps ')}`);
  }
  const vesselOcclusion = await page.evaluate(controls => {
    const { world, THREE } = window.__flight, hitCounts = {}, samples = [], nodes = controls.map(id => document.getElementById(id));
    world.playerShip.traverse(object => {
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
      const positions = object.geometry?.attributes?.position; if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        const q = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(world.camera), x = (q.x + 1) * innerWidth / 2, y = (1 - q.y) * innerHeight / 2;
        const front = document.elementFromPoint(x, y), control = nodes.find(node => node === front || node.contains(front));
        if (!control) continue;
        hitCounts[control.id] = (hitCounts[control.id] || 0) + 1;
        if (samples.length < 8) samples.push({ control: control.id, x, y, object: object.name });
      }
    });
    return { hitCounts, samples };
  }, controls);
  for (const [id, count] of Object.entries(vesselOcclusion.hitCounts)) if (count) violations.push(`${id} covers ${count} actual projected ship vertices`);
  const gunLabel = await page.evaluate(() => window.__gunLabel);
  // The portrait controls are higher in the scene; keep the bearing readable.
  if (viewport.height > viewport.width && gunLabel) for (const [id, b] of Object.entries(boxes)) {
    const ox = Math.min(gunLabel.x + gunLabel.width, b.x + b.width) - Math.max(gunLabel.x, b.x), oy = Math.min(gunLabel.y + gunLabel.height, b.y + b.height) - Math.max(gunLabel.y, b.y);
    if (ox > .5 && oy > .5) violations.push(`cannon bearing label overlaps ${id}`);
  }
  return { viewport, boxes, vesselOcclusion, gunLabel, violations };
}
const point = (id, x, y) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 });
const boxPoint = (id, box, dx = 0, dy = 0) => point(id, box.x + box.width * (.5 + dx), box.y + box.height * (.5 + dy));
async function canvasPoints(page) {
  // Resolve points against the actual hit-test tree so no gesture starts on a HUD control.
  return page.evaluate(() => {
    const yCandidates = [.46, .52, .60, .29, .38], xs = [.43, .57];
    for (const yf of yCandidates) {
      const pts = xs.map(xf => ({ x: innerWidth * xf, y: innerHeight * yf }));
      if (pts.every(p => document.elementFromPoint(p.x, p.y)?.id === 'world')) return pts;
    }
    throw new Error('Two unobstructed canvas touch points were not found');
  });
}
async function touchOrbitAndPinch(page, context) {
  const cdp = await context.newCDPSession(page), dispatch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const pts = await canvasPoints(page), before = await metrics(page), a = point(10, pts[0].x, pts[0].y), b = point(11, pts[1].x, pts[1].y);
  await dispatch('touchStart', [a]);
  const moved = { ...a, x: a.x + page.viewportSize().width * .08, y: a.y - page.viewportSize().width * .035 };
  await dispatch('touchMove', [moved]); await tick(page, 75);
  const dragged = await metrics(page); assert.ok(Math.abs(angleDelta(dragged.orbit.yaw, before.orbit.yaw)) > .25); assert.ok(dragged.orbit.pitch > before.orbit.pitch + .05); close(dragged.turretHeading, before.turretHeading); close(dragged.turretPitch, before.turretPitch); assert.equal(dragged.shots, before.shots);
  await dispatch('touchEnd', []); await tick(page, 1);
  const pinchStart = await metrics(page);
  await dispatch('touchStart', [a]); await dispatch('touchStart', [a, b]);
  const spreadA = { ...a, x: a.x - page.viewportSize().width * .04 }, spreadB = { ...b, x: b.x + page.viewportSize().width * .04 };
  await dispatch('touchMove', [spreadA, spreadB]); await tick(page, 75);
  const pinched = await metrics(page); assert.ok(pinched.cameraZoom < pinchStart.cameraZoom); assert.ok(pinched.camera.distance < pinchStart.camera.distance * .98); close(angleDelta(pinched.orbit.yaw, pinchStart.orbit.yaw), 0); close(pinched.orbit.pitch, pinchStart.orbit.pitch);
  await dispatch('touchMove', [a, b]); await tick(page, 75);
  const unpinched = await metrics(page); assert.ok(unpinched.cameraZoom > pinched.cameraZoom); close(angleDelta(unpinched.orbit.yaw, pinchStart.orbit.yaw), 0); close(unpinched.orbit.pitch, pinchStart.orbit.pitch);
  await dispatch('touchEnd', []); await tick(page, 2); const released = await metrics(page); assert.equal(released.pointerState.camera, 0); assert.equal(released.input.fire, false); assert.equal(released.glError, 0); wholeShip(released);
  await cdp.detach(); return { before, dragged, pinchStart, pinched, unpinched, released };
}
async function fourFinger(page, context, boxes) {
  const cdp = await context.newCDPSession(page), dispatch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const before = await metrics(page), pts = await canvasPoints(page), helm = boxPoint(1, boxes.joystick, -.2, 0), aim = boxPoint(2, boxes.aimJoystick, -.18, -.14), fire = boxPoint(3, boxes.touchFire), camera = point(4, pts[0].x, pts[0].y), states = {};
  await dispatch('touchStart', [helm]); await dispatch('touchStart', [helm, aim]); await dispatch('touchStart', [helm, aim, fire]); await dispatch('touchStart', [helm, aim, fire, camera]);
  const moved = { ...camera, x: camera.x + page.viewportSize().width * .04, y: camera.y - page.viewportSize().width * .018 };
  await dispatch('touchMove', [helm, aim, fire, moved]); await tick(page, 20); states.all = await metrics(page);
  assert.ok(states.all.input.roll > .3); assert.ok(states.all.input.aimYaw > .3); assert.ok(states.all.input.pitch > .25); assert.equal(states.all.input.fire, true); assert.ok(states.all.shots > before.shots); assert.ok(Math.abs(angleDelta(states.all.orbit.yaw, before.orbit.yaw)) > .1); assert.equal(states.all.pointerState.camera, 1);
  // Releasing an action must not cancel the independently captured canvas finger.
  await dispatch('touchEnd', [fire]); await tick(page, 2); states.fireReleasedWithCamera = await metrics(page);
  assert.equal(states.fireReleasedWithCamera.input.fire, false); assert.equal(states.fireReleasedWithCamera.pointerState.camera, 1); assert.ok(states.fireReleasedWithCamera.input.roll > .3); assert.ok(states.fireReleasedWithCamera.input.aimYaw > .3);
  const movedAgain = { ...moved, x: moved.x + page.viewportSize().width * .025 };
  await dispatch('touchMove', [helm, aim, movedAgain]); await tick(page, 2); states.cameraAfterFireRelease = await metrics(page);
  assert.ok(Math.abs(angleDelta(states.cameraAfterFireRelease.orbit.yaw, states.fireReleasedWithCamera.orbit.yaw)) > .1);
  await dispatch('touchStart', [helm, aim, movedAgain, fire]); await tick(page, 2);
  await dispatch('touchEnd', [movedAgain]); await tick(page, 2); states.cameraReleased = await metrics(page);
  assert.equal(states.cameraReleased.pointerState.camera, 0); assert.ok(states.cameraReleased.input.roll > .3); assert.ok(states.cameraReleased.input.aimYaw > .3); assert.equal(states.cameraReleased.input.fire, true);
  await dispatch('touchEnd', [fire]); await tick(page, 2); states.fireReleased = await metrics(page);
  assert.equal(states.fireReleased.input.fire, false); assert.ok(states.fireReleased.input.roll > .3); assert.ok(states.fireReleased.input.aimYaw > .3);
  await dispatch('touchEnd', [helm]); await tick(page, 2); states.helmReleased = await metrics(page);
  assert.equal(states.helmReleased.input.roll, 0); assert.ok(states.helmReleased.input.aimYaw > .3);
  await dispatch('touchEnd', []); await tick(page, 2); states.allReleased = await metrics(page);
  assert.equal(states.allReleased.input.roll, 0); assert.equal(states.allReleased.input.aimYaw, 0); assert.equal(states.allReleased.input.pitch, 0); assert.equal(states.allReleased.input.fire, false); assert.equal(states.allReleased.pointerState.camera, 0); assert.equal(states.allReleased.glError, 0);
  await cdp.detach(); return states;
}

try {
  const desktop = await contextFor({ width: 1440, height: 900 }), page = desktop.page;
  await check('desktop: destroyer starts in follow view with the entire vessel visible', async () => {
    results.desktop.started = await startMission(page); assert.equal(results.desktop.started.cockpit, false); close(results.desktop.started.orbit.pitch, Math.PI / 9); close(angleDelta(results.desktop.started.orbit.yaw, results.desktop.started.heading), 0); wholeShip(results.desktop.started); await screenshot(page, 'desktop-default-follow');
  });
  await check('desktop: right-drag changes horizontal and vertical angles independently of the gun', async () => {
    const before = await metrics(page), after = await dragMouse(page, 210, -110); assert.ok(Math.abs(angleDelta(after.orbit.yaw, before.orbit.yaw)) > .7); assert.ok(after.orbit.pitch > before.orbit.pitch + .2); close(after.turretHeading, before.turretHeading); close(after.turretPitch, before.turretPitch); assert.equal(after.shots, before.shots); assert.equal(after.pointerState.mouseOrbit, false); wholeShip(after); results.desktop.dragged = after; await screenshot(page, 'desktop-side-follow');
  });
  await check('desktop: held left fire and right orbit release independently on the shared mouse pointer', async () => {
    await page.mouse.move(560, 330); await page.mouse.down({ button: 'left' }); await page.mouse.down({ button: 'right' }); await page.mouse.move(600, 310); await page.mouse.move(640, 300); await tick(page, 12); const both = await metrics(page); assert.equal(both.input.fire, true); assert.equal(both.pointerState.mouseOrbit, true); const shots = both.shots;
    await page.mouse.up({ button: 'right' }); await page.mouse.move(660, 300); await tick(page, 12); const rightReleased = await metrics(page); results.desktop.mouseChord = { both, rightReleased, events: await page.evaluate(() => window.__pointerEvents) }; assert.equal(rightReleased.input.fire, true); assert.equal(rightReleased.pointerState.mouseOrbit, false); assert.ok(rightReleased.shots > shots);
    const pauseBox = await page.locator('#pauseBtn').boundingBox(); await page.mouse.move(pauseBox.x + pauseBox.width / 2, pauseBox.y + pauseBox.height / 2); await page.mouse.up({ button: 'left' }); await tick(page, 1); const outsideReleased = await metrics(page); assert.equal(outsideReleased.input.fire, false); assert.equal(outsideReleased.state, 'playing'); await page.mouse.move(660, 300);
    await page.mouse.down({ button: 'right' }); await page.mouse.down({ button: 'left' }); await page.mouse.move(690, 310); await tick(page, 3); const bothAgain = await metrics(page); assert.equal(bothAgain.input.fire, true); assert.equal(bothAgain.pointerState.mouseOrbit, true);
    await page.mouse.up({ button: 'left' }); await page.mouse.move(720, 310); await tick(page, 3); const leftReleased = await metrics(page); assert.equal(leftReleased.input.fire, false); assert.equal(leftReleased.pointerState.mouseOrbit, true); assert.ok(Math.abs(angleDelta(leftReleased.orbit.yaw, bothAgain.orbit.yaw)) > .05);
    await page.mouse.up({ button: 'right' }); await tick(page, 75); const released = await metrics(page); assert.equal(released.input.fire, false); assert.equal(released.pointerState.mouseOrbit, false); results.desktop.mouseChord = { both, rightReleased, bothAgain, leftReleased, released };
  });
  await check('desktop: continuous dragging circles the vessel through more than 360 degrees', async () => {
    const samples = [await metrics(page)]; let accumulated = 0;
    for (let i = 0; i < 16; i++) { const state = await dragMouse(page, 100, 0); accumulated += angleDelta(state.orbit.yaw, samples.at(-1).orbit.yaw); samples.push(state); wholeShip(state); }
    assert.ok(Math.abs(accumulated) > Math.PI * 2); assert.ok(samples.some(s => s.orbit.yaw > 2)); assert.ok(samples.some(s => s.orbit.yaw < -2)); assert.ok(samples.some(s => s.hudTexts.includes('舰炮方向')), 'the real HUD must show an edge direction when the gun points outside the free camera view'); results.desktop.circle = { accumulatedRadians: accumulated, samples }; await screenshot(page, 'desktop-bow-follow');
  });
  await check('desktop: elevation clamps above the sea and preserves full-vessel framing', async () => {
    let low; for (let i = 0; i < 4; i++) low = await dragMouse(page, 0, 300, { y: 190 }); close(low.orbit.pitch, Math.PI / 15); wholeShip(low); await screenshot(page, 'desktop-low-angle');
    let high; for (let i = 0; i < 4; i++) high = await dragMouse(page, 0, -300, { y: 510 }); close(high.orbit.pitch, Math.PI * 5 / 12); wholeShip(high); await screenshot(page, 'desktop-high-angle'); results.desktop.elevation = { low, high };
  });
  await check('desktop: cannon traverse and elevation do not turn the follow camera', async () => {
    await page.keyboard.press('v'); await tick(page, 75); const before = await metrics(page), after = await holdKeys(page, ['j', 'w'], 40); assert.ok(after.turretHeading > before.turretHeading + .2); assert.ok(after.turretPitch > before.turretPitch + .2); close(after.orbit.yaw, before.orbit.yaw); close(after.orbit.pitch, before.orbit.pitch); assert.ok(distance(after.camera.position, before.camera.position) < .01); results.desktop.gunIndependence = { before, after };
  });
  await check('desktop: wheel zoom changes distance, keeps angles, and respects limits', async () => {
    const before = await metrics(page); await page.mouse.move(570, 400); await page.mouse.wheel(0, 1000); await tick(page, 100); const farther = await metrics(page); assert.ok(farther.cameraZoom > before.cameraZoom); assert.ok(farther.camera.distance > before.camera.distance); close(farther.orbit.yaw, before.orbit.yaw); close(farther.orbit.pitch, before.orbit.pitch);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -1000); await tick(page, 100); const near = await metrics(page); assert.equal(near.zoomSetting, 78); wholeShip(near);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 1000); await tick(page, 100); const far = await metrics(page); assert.equal(far.zoomSetting, 140); wholeShip(far); results.desktop.zoom = { before, farther, near, far };
  });
  await check('desktop: V recenters behind the current ship heading', async () => {
    await dragMouse(page, 180, -80); await page.keyboard.press('v'); await tick(page, 75); const state = await metrics(page); close(angleDelta(state.orbit.yaw, state.heading), 0); close(state.orbit.pitch, Math.PI / 9); wholeShip(state); results.desktop.recentered = state; await screenshot(page, 'desktop-recenter');
  });
  await check('desktop: bridge toggle preserves the selected external angle', async () => {
    const before = await dragMouse(page, -190, -80); await page.keyboard.press('c'); await tick(page, 20); const bridge = await metrics(page); assert.equal(bridge.cockpit, true); assert.ok(bridge.camera.distance < before.camera.distance * .6); close(bridge.orbit.yaw, before.orbit.yaw); close(bridge.orbit.pitch, before.orbit.pitch);
    await dragMouse(page, 150, -80); const ignored = await metrics(page); close(ignored.orbit.yaw, before.orbit.yaw); close(ignored.orbit.pitch, before.orbit.pitch);
    await page.keyboard.press('c'); await tick(page, 75); const external = await metrics(page); assert.equal(external.cockpit, false); close(external.orbit.yaw, before.orbit.yaw); close(external.orbit.pitch, before.orbit.pitch); wholeShip(external); results.desktop.bridge = { before, bridge, ignored, external }; await screenshot(page, 'desktop-angle-restored');
  });
  await check('desktop: pause freezes ship and camera and ignores drag, wheel and recenter', async () => {
    await page.locator('#pauseBtn').click(); await tick(page, 1); const before = await frozenState(page), zoomBefore = (await metrics(page)).cameraZoom;
    await dragMouse(page, 160, -80); await page.mouse.wheel(0, -200); await page.keyboard.press('v'); await tick(page, 45); const after = await frozenState(page); assert.deepEqual(after, before); close((await metrics(page)).cameraZoom, zoomBefore); results.desktop.pause = { before, after }; await page.locator('#resumeBtn').click(); await tick(page, 1);
  });
  await check('desktop: restart restores the default follow angle without stale contacts', async () => {
    await page.locator('#pauseBtn').click(); await page.locator('#restartBtn').click(); await tick(page, 8); const state = await metrics(page); close(angleDelta(state.orbit.yaw, state.heading), 0); close(state.orbit.pitch, Math.PI / 9); assert.equal(state.cockpit, false); assert.equal(state.pointerState.camera, 0); assert.equal(state.pointerState.mouseOrbit, false); wholeShip(state); results.desktop.restarted = state;
  });
  await check('desktop: camera follows a sailing and turning hull while retaining its chosen world angle', async () => {
    await dragMouse(page, 190, -70); const before = await metrics(page); await page.locator('#throttle').focus(); await page.keyboard.press('End'); await page.locator('#world').click({ position: { x: 10, y: 10 } }); await tick(page, 240); const after = await holdKeys(page, ['a'], 150); assert.ok(after.speed > 8); assert.ok(distance(after.pos, before.pos) > 20); assert.ok(after.heading > before.heading + .1); close(after.orbit.yaw, before.orbit.yaw); close(after.orbit.pitch, before.orbit.pitch); assert.ok(distance(after.camera.offset, before.camera.offset) < .5); wholeShip(after); results.desktop.sailing = { before, after }; await screenshot(page, 'desktop-sailing-independent-camera');
    const recenterHeading = after.heading; await page.keyboard.press('v'); await tick(page, 75); const recentered = await metrics(page); close(angleDelta(recentered.orbit.yaw, recenterHeading), 0); close(recentered.orbit.pitch, Math.PI / 9); results.desktop.sailing.recentered = recentered;
  });
  await check('desktop: aircraft retains its existing camera and ignores ship orbit controls', async () => {
    await returnToBase(page); await startMission(page, 'aircraft', 'training'); const before = await metrics(page), after = await dragMouse(page, 180, -70); assert.equal(after.kind, 'aircraft'); assert.deepEqual(after.orbit, before.orbit); assert.equal(after.pointerState.mouseOrbit, false); await page.keyboard.press('v'); await tick(page, 1); assert.deepEqual((await metrics(page)).orbit, before.orbit); assert.equal(await page.locator('#touchRecenter').isVisible(), false); assert.equal(after.glError, 0); results.desktop.aircraft = { before, after }; await screenshot(page, 'aircraft-existing-follow');
  });
  await desktop.context.close();
  for (const [name, viewport] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }]]) {
    const mobile = await contextFor(viewport, true), p = mobile.page; results.mobile[name] = {};
    await check(`mobile ${name}: twelve controls fit without overlap and the complete ship remains visible`, async () => {
      results.mobile[name].started = await startMission(p); wholeShip(results.mobile[name].started); results.mobile[name].layout = await layout(p); assert.deepEqual(results.mobile[name].layout.violations, []); await screenshot(p, `mobile-${name}-default-follow`);
    });
    await check(`mobile ${name}: a blank-canvas drag orbits and two canvas fingers pinch without moving the gun`, async () => { results.mobile[name].gestures = await touchOrbitAndPinch(p, mobile.context); await screenshot(p, `mobile-${name}-orbit-and-zoom`); });
    await check(`mobile ${name}: independent recenter button returns to the ship bearing`, async () => {
      await p.locator('#touchRecenter').tap(); await tick(p, 75); const state = await metrics(p); close(angleDelta(state.orbit.yaw, state.heading), 0); close(state.orbit.pitch, Math.PI / 9); wholeShip(state); results.mobile[name].recentered = state;
    });
    await check(`mobile ${name}: four-finger helm, gun, fire and camera contacts release independently`, async () => { results.mobile[name].fourFinger = await fourFinger(p, mobile.context, results.mobile[name].layout.boxes); await screenshot(p, `mobile-${name}-four-finger-controls`); });
    await check(`mobile ${name}: bridge toggling keeps the external orbit and disables canvas gestures inside the bridge`, async () => {
      const before = await metrics(p); await p.locator('#touchCamera').tap(); await tick(p, 20); const bridge = await metrics(p); assert.equal(bridge.cockpit, true);
      const cdp = await mobile.context.newCDPSession(p), pts = await canvasPoints(p), a = point(20, pts[0].x, pts[0].y); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x + 30, y: a.y - 20 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tick(p, 20); const ignored = await metrics(p); close(ignored.orbit.yaw, before.orbit.yaw); close(ignored.orbit.pitch, before.orbit.pitch); await cdp.detach();
      await p.locator('#touchCamera').tap(); await tick(p, 75); const after = await metrics(p); assert.equal(after.cockpit, false); close(after.orbit.yaw, before.orbit.yaw); close(after.orbit.pitch, before.orbit.pitch); wholeShip(after); results.mobile[name].bridge = { before, bridge, ignored, after };
    });
    await mobile.context.close();
  }
  assert.deepEqual(errors, []); results.passed = true; await rm(resolve(out, 'failure.png'), { force: true });
} catch (error) {
  results.passed = false; results.failure = { step: activeStep, message: String(error), stack: error.stack }; console.error(error);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  results.sourceChecksumsAfter = await sourceChecksums();
  results.sourceStable = verifiedFiles.every(name => results.sourceChecksums[name] === results.sourceChecksumsAfter[name]);
  await writeFile(resolve(out, 'metrics.json'), JSON.stringify(results, null, 2)); await browser.close();
}
