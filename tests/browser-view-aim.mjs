// Optional real-WebGL QA. Every gameplay change uses trusted keyboard, mouse,
// or CDP touch events. The injected hook only reads state and drives native RAF.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.env.OUTPUT_DIR || 'verification/view-aim');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:8775';
const playwrightPath = process.env.PLAYWRIGHT_PATH || '/Users/yuanzichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const executablePath = process.env.CHROMIUM_PATH || '/Users/yuanzichen/Library/Caches/ms-playwright/chromium_headless_shell-1193/chrome-mac/headless_shell';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const source = await readFile(resolve(root, 'app.js'), 'utf8');
const verifiedFiles = ['app.js', 'input.js', 'ship-camera.js', 'renderer.js', 'simulation.js', 'index.html', 'style.css'];
const checksums = async () => Object.fromEntries(await Promise.all(verifiedFiles.map(async name => [name, createHash('sha256').update(await readFile(resolve(root, name))).digest('hex')])));
await mkdir(out, { recursive: true });
const errors = [], results = { baseURL, checks: [], desktop: {}, mobile: {}, errors, boundaries: ['Only real UI, keyboard, mouse, and trusted CDP touch input changes gameplay.', 'State hooks are read-only; no pose, ammunition, ship health, or enemies are edited.', 'Manual RAF runs the real frame and fixed-step simulation.', 'Mobile checks emulate viewports and multi-touch contacts, not physical phone hardware.'], sourceChecksums: await checksums() };
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=angle', `--use-angle=${process.env.BROWSER_ANGLE || 'metal'}`, '--enable-unsafe-swiftshader'] });
let activePage, activeStep = 'load';
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const close = (a, b, tolerance = 1e-7, name = 'values') => assert.ok(Math.abs(a - b) <= tolerance, `${name}: ${a} vs ${b}`);
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
async function check(name, fn) { activeStep = name; await fn(); results.checks.push(name); console.log(`PASS ${name}`); }
async function contextFor(viewport, touch = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, serviceWorkers: 'block' });
  await context.addInitScript(({ touch }) => {
    window.__now = 0; window.requestAnimationFrame = () => 1; window.__hudTexts = [];
    const nativeText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { if (this.canvas.id === 'hudCanvas') window.__hudTexts.push({ text: String(text), x: args[0], y: args[1] }); return nativeText.call(this, text, ...args); };
    Object.defineProperty(performance, 'now', { value: () => window.__now });
    localStorage.setItem('frostline-settings', JSON.stringify({ vehicle: 'aircraft', quality: touch ? 'auto' : 'high', sound: false, invert: false, cameraZoom: 100 }));
  }, { touch });
  await context.route('**/app.js', route => route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.__flight={sim,world,frame,input,presentation,THREE,settings,get cockpit(){return cockpit},get cannonAim(){return cannonAim}};\n' }));
  const page = await context.newPage(); activePage = page;
  page.on('pageerror', e => errors.push({ kind: 'pageerror', message: String(e) }));
  page.on('console', e => { if (e.type() === 'error') errors.push({ kind: 'console', message: e.text() }); });
  page.on('response', e => { if (e.status() >= 400) errors.push({ kind: 'resource', status: e.status(), url: e.url() }); });
  await page.goto(baseURL + '/?debug', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__flight);
  await page.evaluate(() => window.__flight.world.sky.userData.ready);
  await page.evaluate(() => { const e = document.getElementById('renderDiagnostics'); if (e) e.style.display = 'none'; });
  return { page, context };
}
const tick = (page, frames = 1) => page.evaluate(frames => { for (let n = 0; n < frames; n++) { window.__now += 1000 / 60; window.__hudTexts.length = 0; window.__flight.frame(window.__now); } }, frames);
async function metrics(page) {
  return page.evaluate(() => {
    const { sim, world, input, THREE, cockpit, settings, cannonAim } = window.__flight, p = sim.player, rig = world.shipChase;
    const model = p.kind === 'destroyer' ? world.playerShip : world.playerJet;
    const screen = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minDepth: Infinity, maxDepth: -Infinity, vertices: 0 };
    model?.traverse(o => {
      for (let a = o; a; a = a.parent) if (!a.visible) return;
      const positions = o.geometry?.attributes?.position; if (!positions) return;
      for (let n = 0; n < positions.count; n++) {
        const q = new THREE.Vector3().fromBufferAttribute(positions, n).applyMatrix4(o.matrixWorld).project(world.camera), x = (q.x + 1) * innerWidth / 2, y = (1 - q.y) * innerHeight / 2;
        screen.minX = Math.min(screen.minX, x); screen.maxX = Math.max(screen.maxX, x); screen.minY = Math.min(screen.minY, y); screen.maxY = Math.max(screen.maxY, y); screen.minDepth = Math.min(screen.minDepth, q.z); screen.maxDepth = Math.max(screen.maxDepth, q.z); screen.vertices++;
      }
    });
    const direction = world.camera.getWorldDirection(new THREE.Vector3());
    const aimPoint = cannonAim?.point?.clone ? cannonAim.point.clone() : cannonAim?.point ? new THREE.Vector3().fromArray(cannonAim.point) : null;
    return { state: sim.state, mode: sim.mode, kind: p.kind, cockpit, time: sim.time, heading: p.heading, turretHeading: p.turretHeading, turretPitch: p.turretPitch, speed: p.speed, pos: p.pos.toArray(), shots: sim.shots, hits: sim.hits, kills: sim.kills, ammo: p.ammo, health: p.health, missiles: p.missiles, antiShipMissiles: p.antiShipMissiles, targetId: sim.targetId, lockProgress: sim.lockProgress, antiShipLockProgress: sim.antiShipLockProgress, input: input.read(), hudTexts: window.__hudTexts.slice(), orbit: { yaw: rig.yaw, pitch: rig.pitch, viewYaw: rig.viewYaw, viewPitch: rig.viewPitch }, gunAimDistance: p.gunAimDistance, gunAimError: p.gunAimError, gunAimLimited: p.gunAimLimited, cannonAim: cannonAim ? { kind: cannonAim.kind, targetId: cannonAim.targetId, distance: cannonAim.distance, point: aimPoint?.toArray(), screen: aimPoint ? world.project(aimPoint) : null } : null, camera: { position: world.camera.position.toArray(), target: world.cameraTarget.toArray(), offset: world.camera.position.clone().sub(p.pos).toArray(), quaternion: world.camera.quaternion.toArray(), direction: direction.toArray(), yaw: Math.atan2(-direction.x, -direction.z), elevation: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), distance: world.camera.position.distanceTo(p.pos), zoom: world.cameraZoom }, viewport: { width: innerWidth, height: innerHeight }, screen, pointerState: { camera: input.cameraPointers.size, mouseOrbit: !!input.mouseOrbit, joystick: input.joystickId, aim: input.aimJoystickId }, ships: sim.enemies.map(e => { const target = e.pos.clone(); target.y += e.aimHeight || 6; return { id: e.id, kind: e.kind, health: e.health, maxHealth: e.maxHealth, shipType: e.shipType, pos: e.pos.toArray(), aim: target.toArray(), screen: world.project(target) }; }), glError: world.renderer.getContext().getError(), zoomSetting: settings.cameraZoom };
  });
}
async function screenshot(page, name) { await page.screenshot({ path: resolve(out, name + '.png') }); }
function wholeShip(s) {
  assert.ok(s.screen.vertices > 100); assert.ok(s.screen.minDepth > -1 && s.screen.maxDepth < 1);
  assert.ok(s.screen.minX >= -.5 && s.screen.maxX <= s.viewport.width + .5, `hull horizontal ${JSON.stringify(s.screen)}`);
  assert.ok(s.screen.minY >= -.5 && s.screen.maxY <= s.viewport.height + .5, `hull vertical ${JSON.stringify(s.screen)}`); assert.equal(s.glError, 0);
}
async function startMission(page, vehicle = 'destroyer', mode = 'naval-training') {
  await page.locator(`[data-vehicle="${vehicle}"]`).click(); await page.locator(`[data-mode="${mode}"]`).click(); await page.locator('#startBtn').click(); await tick(page, 100);
  const s = await metrics(page); assert.equal(s.kind, vehicle); assert.equal(s.state, 'playing'); assert.equal(s.glError, 0); return s;
}
async function restart(page) { const s = await metrics(page); if (['won', 'lost'].includes(s.state)) await page.locator('#againBtn').click(); else { if (s.state !== 'paused') await page.locator('#pauseBtn').click(); await page.locator('#restartBtn').click(); } await tick(page, 100); return metrics(page); }
async function returnToBase(page) { const s = await metrics(page); if (['won', 'lost'].includes(s.state)) await page.locator('#resultExitBtn').click(); else { if (s.state !== 'paused') await page.locator('#pauseBtn').click(); await page.locator('#exitBtn').click(); } }
async function canvasPoint(page) { return page.evaluate(() => { for (const y of [.38, .45, .28, .54]) for (const x of [.5, .38, .6]) { const p = { x: innerWidth * x, y: innerHeight * y }; if (document.elementFromPoint(p.x, p.y)?.id === 'world') return p; } throw Error('No unobstructed canvas point'); }); }
async function mouseDrag(page, dx, dy, settle = 75, origin = null) { const p = origin || await canvasPoint(page); await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(p.x + dx, p.y + dy, { steps: 8 }); await page.mouse.up({ button: 'right' }); await tick(page, settle); return metrics(page); }
async function holdKeys(page, keys, frames) { for (const k of keys) await page.keyboard.down(k); await tick(page, frames); for (const k of keys.slice().reverse()) await page.keyboard.up(k); return metrics(page); }
const point = (id, x, y) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 });
const boxPoint = (id, b, dx = 0, dy = 0) => point(id, b.x + b.width * (.5 + dx), b.y + b.height * (.5 + dy));
async function touchDrag(page, context, dx, dy, settle = 75) { const cdp = await context.newCDPSession(page), p = await canvasPoint(page), a = point(1, p.x, p.y); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x + dx, y: a.y + dy }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tick(page, settle); await cdp.detach(); return metrics(page); }
async function aimAtShip(page, id, context = null) {
  const trace = [];
  for (let n = 0; n < 7; n++) {
    const s = await metrics(page), e = s.ships.find(e => e.id === id); if (!e) return trace;
    const delta = e.aim.map((v, i) => v - s.camera.position[i]);
    const yaw = Math.atan2(-delta[0], -delta[2]), elevation = Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
    const yawDelta = angleDelta(yaw, s.camera.yaw), elevationDelta = elevation - s.camera.elevation;
    trace.push({ n, yawDelta, elevationDelta, screen: e.screen, cannonAim: s.cannonAim, gunAimError: s.gunAimError });
    if (Math.abs(yawDelta) < .0005 && Math.abs(elevationDelta) < .0005) break;
    const dx = Math.max(-s.viewport.width * .22, Math.min(s.viewport.width * .22, -yawDelta * s.viewport.width / (Math.PI * 2))), dy = Math.max(-s.viewport.height * .16, Math.min(s.viewport.height * .16, elevationDelta * s.viewport.width / Math.PI));
    if (context) await touchDrag(page, context, dx, dy, 90); else await mouseDrag(page, dx, dy, 90);
  }
  await tick(page, 90); const s = await metrics(page), e = s.ships.find(e => e.id === id); if (e) { assert.ok(e.screen.visible); assert.ok(Math.hypot(e.screen.x - s.viewport.width / 2, e.screen.y - s.viewport.height / 2) < 2.5, `trusted drag centers target: ${JSON.stringify(trace)}`); assert.equal(s.cannonAim?.kind, 'ship'); assert.equal(s.cannonAim?.targetId, id); assert.ok(s.gunAimError < .01, `turret settled error ${s.gunAimError}`); }
  return trace;
}
async function fireTouch(page, context, frames = 40) { const cdp = await context.newCDPSession(page), b = await page.locator('#touchFire').boundingBox(), a = boxPoint(2, b); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await tick(page, frames); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tick(page, 45); await cdp.detach(); return metrics(page); }
async function sinkShip(page, id, label, context = null) {
  const trace = []; let hit = false;
  for (let n = 0; n < 8; n++) {
    const before = await metrics(page), e = before.ships.find(e => e.id === id); if (!e) break;
    const gestures = await aimAtShip(page, id, context); await screenshot(page, `${label}-aimed-${n}`);
    if (context) await fireTouch(page, context, 40); else { await holdKeys(page, ['Space'], 40); await tick(page, 45); }
    const after = await metrics(page), live = after.ships.find(e => e.id === id);
    trace.push({ n, gestures, shots: after.shots, hits: after.hits, ammo: after.ammo, healthBefore: e.health, healthAfter: live?.health || 0, cannonAim: after.cannonAim, state: after.state });
    if (!live || live.health < e.health) { hit = true; await screenshot(page, label + '-hit'); }
    if (!live) break;
  }
  const s = await metrics(page); assert.ok(hit, 'real view-directed cannon fire must damage a ship'); assert.equal(s.ships.some(e => e.id === id), false, `ship ${id} must sink by genuine cannon shots`); await screenshot(page, label + '-sunk'); return { trace, after: s };
}
async function layout(page) {
  const controls = ['touchRecenter', 'touchAntiShip', 'joystick', 'touchFire', 'touchMissile', 'touchFlare', 'touchBoost', 'touchTarget', 'touchCamera', 'pauseBtn', 'throttle'], boxes = {}, violations = [], v = page.viewportSize();
  assert.equal(await page.locator('#aimJoystick').isVisible(), false, 'external view does not offer independent cannon aim joystick');
  for (const id of controls) { assert.equal(await page.locator('#' + id).isVisible(), true); const b = await page.locator('#' + id).boundingBox(); boxes[id] = b; if (b.x < -.5 || b.y < -.5 || b.x + b.width > v.width + .5 || b.y + b.height > v.height + .5) violations.push(`${id} beyond viewport`); }
  const entries = Object.entries(boxes); for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) { const [a, x] = entries[i], [b, y] = entries[j]; if (Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > .5 && Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > .5) violations.push(`${a} overlaps ${b}`); }
  for (const selectors of [['.airframe', '.flight-readout.left'], ['.score-box', '.flight-readout.right']]) { const [x, y] = await Promise.all(selectors.map(s => page.locator(s).boundingBox())); if (Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x) > .5 && Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y) > .5) violations.push(`HUD ${selectors.join(' overlaps ')}`); }
  const occlusion = await page.evaluate(controls => { const { world, THREE } = window.__flight, counts = {}, nodes = controls.map(id => document.getElementById(id)); world.playerShip.traverse(o => { for (let a = o; a; a = a.parent) if (!a.visible) return; const p = o.geometry?.attributes?.position; if (!p) return; for (let n = 0; n < p.count; n++) { const q = new THREE.Vector3().fromBufferAttribute(p, n).applyMatrix4(o.matrixWorld).project(world.camera), x = (q.x + 1) * innerWidth / 2, y = (1 - q.y) * innerHeight / 2, front = document.elementFromPoint(x, y), node = nodes.find(a => a === front || a.contains(front)); if (node) counts[node.id] = (counts[node.id] || 0) + 1; } }); return counts; }, controls);
  for (const [id, count] of Object.entries(occlusion)) violations.push(`${id} covers ${count} hull vertices`);
  return { viewport: v, controls: controls.length, boxes, occlusion, violations };
}
async function threeFinger(page, context, boxes) {
  const cdp = await context.newCDPSession(page), send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints }), p = await canvasPoint(page), helm = boxPoint(1, boxes.joystick, -.2), fire = boxPoint(2, boxes.touchFire), view = point(3, p.x, p.y), moved = { ...view, x: view.x + page.viewportSize().width * .04, y: view.y - page.viewportSize().width * .018 }, states = {};
  const before = await metrics(page);
  await send('touchStart', [helm]); await send('touchStart', [helm, view]); await send('touchStart', [helm, view, fire]); await send('touchMove', [helm, moved, fire]); await tick(page, 45); states.all = await metrics(page); assert.ok(states.all.input.roll > .3); assert.equal(states.all.input.fire, true); assert.equal(states.all.pointerState.camera, 1); assert.ok(states.all.shots > before.shots); assert.ok(Math.abs(angleDelta(states.all.orbit.yaw, before.orbit.yaw)) > .1); assert.ok(Math.abs(angleDelta(states.all.turretHeading, before.turretHeading)) > .05);
  await send('touchEnd', [fire]); await tick(page, 2); states.fireReleased = await metrics(page); assert.equal(states.fireReleased.input.fire, false); assert.equal(states.fireReleased.pointerState.camera, 1); assert.ok(states.fireReleased.input.roll > .3);
  const movedAgain = { ...moved, x: moved.x + page.viewportSize().width * .025 }; await send('touchMove', [helm, movedAgain]); await tick(page, 2); states.viewAfterFire = await metrics(page); assert.ok(Math.abs(angleDelta(states.viewAfterFire.orbit.yaw, states.fireReleased.orbit.yaw)) > .1);
  await send('touchStart', [helm, movedAgain, fire]); await send('touchEnd', [movedAgain]); await tick(page, 2); states.viewReleased = await metrics(page); assert.equal(states.viewReleased.pointerState.camera, 0); assert.equal(states.viewReleased.input.fire, true); assert.ok(states.viewReleased.input.roll > .3);
  await send('touchEnd', [helm]); await tick(page, 2); states.helmReleased = await metrics(page); assert.equal(states.helmReleased.input.roll, 0); assert.equal(states.helmReleased.input.fire, true);
  await send('touchEnd', []); await tick(page, 2); states.released = await metrics(page); assert.equal(states.released.input.roll, 0); assert.equal(states.released.input.fire, false); assert.equal(states.released.pointerState.camera, 0); assert.equal(states.released.pointerState.aim, null); assert.equal(states.released.glError, 0); await cdp.detach(); return states;
}
async function pinchZoom(page, context) {
  const cdp = await context.newCDPSession(page), send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints }), center = await canvasPoint(page), width = page.viewportSize().width, a = point(30, center.x - width * .055, center.y), b = point(31, center.x + width * .055, center.y), before = await metrics(page);
  await send('touchStart', [a]); await send('touchStart', [a, b]); await send('touchMove', [{ ...a, x: a.x - width * .035 }, { ...b, x: b.x + width * .035 }]); await tick(page, 100); const spread = await metrics(page); assert.ok(spread.camera.zoom < before.camera.zoom); assert.ok(spread.camera.distance < before.camera.distance); close(spread.orbit.yaw, before.orbit.yaw); close(spread.orbit.pitch, before.orbit.pitch);
  await send('touchMove', [a, b]); await tick(page, 100); const returned = await metrics(page); assert.ok(returned.camera.zoom > spread.camera.zoom); close(returned.orbit.yaw, before.orbit.yaw); close(returned.orbit.pitch, before.orbit.pitch); await send('touchEnd', []); await tick(page, 2); const released = await metrics(page); assert.equal(released.pointerState.camera, 0); assert.equal(released.input.fire, false); assert.equal(released.shots, before.shots); await cdp.detach(); return { before, spread, returned, released };
}
async function frozen(page) { return page.evaluate(() => { const { sim, world } = window.__flight; return { state: sim.state, time: sim.time, pos: sim.player.pos.toArray(), heading: sim.player.heading, turretHeading: sim.player.turretHeading, turretPitch: sim.player.turretPitch, ammo: sim.player.ammo, camera: world.camera.matrixWorld.elements.slice(), yaw: world.shipChase.yaw, pitch: world.shipChase.pitch }; }); }

try {
  const desktop = await contextFor({ width: 1440, height: 900 }), page = desktop.page;
  await check('desktop: default follow view frames the whole hull below the center aiming ray', async () => { results.desktop.started = await startMission(page); const s = results.desktop.started; wholeShip(s); assert.equal(s.cockpit, false); assert.ok(s.screen.minY > s.viewport.height * .5); assert.ok(s.cannonAim); close(s.cannonAim.screen.x, s.viewport.width / 2, .1); close(s.cannonAim.screen.y, s.viewport.height / 2, .1); assert.ok(s.hudTexts.some(e => /舰炮就绪|转炮中/.test(e.text))); await screenshot(page, 'desktop-default-view-aim'); });
  await check('desktop: a fast yaw and pitch drag starts limited-speed turret following and displays its actual status', async () => { const before = await metrics(page), fast = await mouseDrag(page, -160, -35, 4); assert.ok(Math.abs(angleDelta(fast.orbit.yaw, before.orbit.yaw)) > .5); assert.ok(fast.orbit.pitch > before.orbit.pitch + .05); assert.ok(Math.abs(angleDelta(fast.turretHeading, before.turretHeading)) < .06); assert.ok(fast.gunAimError > .025); assert.ok(fast.hudTexts.some(e => /转炮中|射界限制/.test(e.text))); await screenshot(page, 'desktop-turret-traversing'); await tick(page, 180); const settled = await metrics(page); assert.ok(Math.abs(angleDelta(settled.turretHeading, before.turretHeading)) > .3); assert.notEqual(settled.turretPitch, before.turretPitch); results.desktop.fastDrag = { before, fast, settled }; });
  await check('desktop: cannon follows the true off-target sea ray without snapping to the selected vessel', async () => { await page.keyboard.press('v'); await tick(page, 100); const selected = (await metrics(page)).targetId; const away = await mouseDrag(page, -220, 0, 160); assert.equal(away.targetId, selected); assert.equal(away.cannonAim.kind, 'sea'); assert.equal(away.cannonAim.targetId, null); assert.ok(away.gunAimError < .012); assert.ok(Math.abs(angleDelta(away.turretHeading, 0)) > .5); results.desktop.offTarget = away; await screenshot(page, 'desktop-off-target-sea'); });
  await check('desktop: keyboard fine adjustment changes the camera and indirectly aims the gun', async () => { await page.keyboard.press('v'); await tick(page, 100); const before = await metrics(page), after = await holdKeys(page, ['j', 'w'], 30); assert.ok(Math.abs(angleDelta(after.orbit.yaw, before.orbit.yaw)) > .1); assert.ok(Math.abs(after.orbit.pitch - before.orbit.pitch) > .05); await tick(page, 100); const settled = await metrics(page); assert.ok(Math.abs(angleDelta(settled.turretHeading, before.turretHeading)) > .1); results.desktop.fineKeys = { before, after, settled }; });
  await check('desktop: right-drag centers a patrol boat and real Space cannon shots sink it', async () => { await page.keyboard.press('v'); await tick(page, 100); await mouseDrag(page, 40, 7); const patrol = (await metrics(page)).ships.find(e => e.shipType === 'patrol'); results.desktop.patrol = await sinkShip(page, patrol.id, 'desktop-patrol'); assert.equal(results.desktop.patrol.after.missiles, 12); assert.equal(results.desktop.patrol.after.antiShipMissiles, 6); });
  await check('desktop: camera aiming and real gunfire sink the second ship and win naval training', async () => { const frigate = (await metrics(page)).ships.find(e => e.shipType === 'frigate'); results.desktop.frigate = await sinkShip(page, frigate.id, 'desktop-frigate'); assert.equal(results.desktop.frigate.after.state, 'won'); assert.equal(results.desktop.frigate.after.kills, 2); assert.ok(results.desktop.frigate.after.ammo < 240); assert.equal(results.desktop.frigate.after.antiShipMissiles, 6); await screenshot(page, 'desktop-view-aim-training-victory'); });
  await check('desktop: restart restores inventory, centered follow aim and released contacts', async () => { const s = await restart(page); assert.equal(s.ammo, 240); assert.equal(s.antiShipMissiles, 6); assert.equal(s.missiles, 12); assert.equal(s.cockpit, false); assert.equal(s.pointerState.camera, 0); assert.equal(s.pointerState.mouseOrbit, false); close(angleDelta(s.orbit.yaw, s.heading), 0); results.desktop.restarted = s; });
  await check('desktop: left-button firing and right-button camera aiming release independently', async () => { const p = await canvasPoint(page); await page.mouse.move(p.x, p.y); await page.mouse.down({ button: 'left' }); await page.mouse.down({ button: 'right' }); await page.mouse.move(p.x + 40, p.y - 8); await tick(page, 20); const both = await metrics(page); assert.equal(both.input.fire, true); assert.equal(both.pointerState.mouseOrbit, true); await page.mouse.up({ button: 'right' }); await page.mouse.move(p.x + 60, p.y - 8); await tick(page, 20); const rightReleased = await metrics(page); assert.equal(rightReleased.input.fire, true); assert.equal(rightReleased.pointerState.mouseOrbit, false); assert.ok(rightReleased.shots > both.shots); await page.mouse.up({ button: 'left' }); await tick(page, 2); const allReleased = await metrics(page); assert.equal(allReleased.input.fire, false); assert.equal(allReleased.pointerState.mouseOrbit, false); results.desktop.mouseChord = { both, rightReleased, allReleased }; });
  await check('desktop: bridge manual traverse remains available and external view preserves its own chosen angle', async () => { const before = await mouseDrag(page, 70, 15); await page.keyboard.press('c'); await tick(page, 20); const bridge = await metrics(page); assert.equal(bridge.cockpit, true); const manual = await holdKeys(page, ['j', 'w'], 30); assert.ok(manual.turretHeading > bridge.turretHeading + .2); assert.ok(manual.turretPitch > bridge.turretPitch + .1); close(manual.orbit.yaw, before.orbit.yaw); await page.keyboard.press('c'); await tick(page, 160); const external = await metrics(page); assert.equal(external.cockpit, false); close(external.orbit.yaw, before.orbit.yaw); assert.ok(external.gunAimError < .012); results.desktop.bridge = { before, bridge, manual, external }; });
  await check('desktop: pause freezes both camera and cannon and ignores drag, zoom and recenter', async () => { const gestureOrigin = await canvasPoint(page); await page.locator('#pauseBtn').click(); await tick(page, 1); const before = await frozen(page), zoom = (await metrics(page)).zoomSetting; await mouseDrag(page, 120, -50, 75, gestureOrigin); await page.mouse.wheel(0, -100); await page.keyboard.press('v'); await tick(page, 60); assert.deepEqual(await frozen(page), before); close((await metrics(page)).zoomSetting, zoom); await page.locator('#resumeBtn').click(); await tick(page, 1); results.desktop.pause = before; });
  await check('desktop: wheel zoom keeps the aiming angles and V returns to current heading', async () => { const before = await metrics(page); const p = await canvasPoint(page); await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, 600); await tick(page, 100); const zoomed = await metrics(page); assert.ok(zoomed.camera.distance > before.camera.distance); close(zoomed.orbit.yaw, before.orbit.yaw); close(zoomed.orbit.pitch, before.orbit.pitch); await page.keyboard.press('v'); await tick(page, 100); const s = await metrics(page); close(angleDelta(s.orbit.yaw, s.heading), 0); close(s.orbit.pitch, Math.PI / 9); results.desktop.zoom = { before, zoomed, recentered: s }; });
  await check('desktop: sailing and steering preserve the camera bearing while the gun follows its world aiming point', async () => { await restart(page); await mouseDrag(page, -90, 0); const before = await metrics(page); await page.locator('#throttle').focus(); await page.keyboard.press('End'); await page.locator('#world').click({ position: { x: 10, y: 10 } }); await tick(page, 240); const after = await holdKeys(page, ['a'], 150); assert.ok(after.speed > 8); assert.ok(distance(after.pos, before.pos) > 20); assert.ok(after.heading > before.heading + .1); close(after.orbit.yaw, before.orbit.yaw); close(after.orbit.pitch, before.orbit.pitch); assert.ok(after.gunAimError < .02); wholeShip(after); results.desktop.sailing = { before, after }; await screenshot(page, 'desktop-turning-view-aim'); });
  await check('desktop: F and R remain separate from camera cannon aiming', async () => { await restart(page); await tick(page, 100); const before = await metrics(page); assert.equal(before.antiShipLockProgress, 1); await page.keyboard.press('f'); await tick(page, 1); const rejected = await metrics(page); assert.equal(rejected.missiles, before.missiles); await page.keyboard.press('r'); await tick(page, 1); const fired = await metrics(page); assert.equal(fired.antiShipMissiles, before.antiShipMissiles - 1); assert.equal(fired.missiles, before.missiles); assert.equal(fired.ammo, before.ammo); results.desktop.missiles = { before, rejected, fired }; });
  await check('desktop: a real air-target lock permits SAM F while R preserves the anti-ship inventory', async () => { await returnToBase(page); await startMission(page, 'destroyer', 'training'); for (let n = 0; n < 40 && (await metrics(page)).lockProgress < 1; n++) await tick(page, 6); const before = await metrics(page); assert.equal(before.lockProgress, 1); await page.keyboard.press('r'); await tick(page, 2); const rejected = await metrics(page); assert.equal(rejected.antiShipMissiles, 6); await page.keyboard.press('f'); await tick(page, 2); const sam = await metrics(page); assert.equal(sam.missiles, 11); assert.equal(sam.antiShipMissiles, 6); assert.equal(sam.ammo, 240); results.desktop.sam = { before, rejected, sam }; });
  await check('desktop: aircraft camera and controls ignore ship orbit and view cannon aiming', async () => { await returnToBase(page); await startMission(page, 'aircraft', 'training'); const before = await metrics(page), after = await mouseDrag(page, 120, -50); assert.equal(after.kind, 'aircraft'); assert.deepEqual(after.orbit, before.orbit); assert.equal(after.pointerState.mouseOrbit, false); assert.equal(await page.locator('#touchRecenter').isVisible(), false); assert.equal(after.glError, 0); results.desktop.aircraft = { before, after }; await screenshot(page, 'aircraft-existing-controls'); });
  await desktop.context.close();
  for (const [name, viewport] of [['landscape', { width: 844, height: 390 }], ['portrait', { width: 390, height: 844 }]]) {
    const mobile = await contextFor(viewport, true), p = mobile.page; results.mobile[name] = {};
    await check(`mobile ${name}: eleven controls and the actual projected hull fit without overlap`, async () => { results.mobile[name].started = await startMission(p); wholeShip(results.mobile[name].started); results.mobile[name].layout = await layout(p); assert.deepEqual(results.mobile[name].layout.violations, []); await screenshot(p, `mobile-${name}-default-view-aim`); });
    await check(`mobile ${name}: two blank-canvas fingers zoom while preserving the viewing and aiming angles`, async () => { results.mobile[name].pinch = await pinchZoom(p, mobile.context); });
    await check(`mobile ${name}: blank-canvas touch rotation centers both ships and real fire-button shots win`, async () => { await touchDrag(p, mobile.context, viewport.width * .045, -viewport.width * .01); const ids = (await metrics(p)).ships.map(e => e.id); const combat = []; for (let i = 0; i < ids.length; i++) combat.push(await sinkShip(p, ids[i], `mobile-${name}-ship-${i + 1}`, mobile.context)); const s = await metrics(p); assert.equal(s.state, 'won'); assert.equal(s.kills, 2); assert.equal(s.antiShipMissiles, 6); assert.equal(s.missiles, 12); results.mobile[name].combat = combat; await screenshot(p, `mobile-${name}-view-aim-victory`); });
    await check(`mobile ${name}: helm, camera and fire contacts release independently`, async () => { await restart(p); const boxes = (await layout(p)).boxes; results.mobile[name].threeFinger = await threeFinger(p, mobile.context, boxes); await screenshot(p, `mobile-${name}-three-finger-controls`); });
    await check(`mobile ${name}: bridge restores manual aim joystick and recenter returns to camera-driven aiming`, async () => { await p.locator('#touchCamera').tap(); await tick(p, 20); assert.equal((await metrics(p)).cockpit, true); assert.equal(await p.locator('#aimJoystick').isVisible(), true); const cdp = await mobile.context.newCDPSession(p), b = await p.locator('#aimJoystick').boundingBox(), a = boxPoint(10, b, -.2, -.14), before = await metrics(p); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await tick(p, 30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); const manual = await metrics(p); assert.ok(manual.turretHeading > before.turretHeading + .1); assert.ok(manual.turretPitch > before.turretPitch + .08); await cdp.detach(); await p.locator('#touchRecenter').tap(); await tick(p, 130); const after = await metrics(p); assert.equal(after.cockpit, false); assert.equal(await p.locator('#aimJoystick').isVisible(), false); assert.equal(after.pointerState.aim, null); assert.ok(after.gunAimError < .012); results.mobile[name].bridge = { before, manual, after }; });
    await mobile.context.close();
  }
  assert.deepEqual(errors, []); results.passed = true; await rm(resolve(out, 'failure.png'), { force: true });
} catch (error) {
  results.passed = false; results.failure = { step: activeStep, message: String(error), stack: error.stack }; console.error(error); process.exitCode = 1;
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
} finally {
  results.sourceChecksumsAfter = await checksums(); results.sourceStable = verifiedFiles.every(name => results.sourceChecksums[name] === results.sourceChecksumsAfter[name]);
  await writeFile(resolve(out, 'metrics.json'), JSON.stringify(results, null, 2)); await browser.close();
}
