import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation, DESTROYER, HOSTILE_SHIPS, shipCameraAimPoint } from '../simulation.js';
import { terrainHeight } from '../world-math.js';

const DT = 1 / 60;
const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const forward = (heading, pitch = 0) => vector(-Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch));
const angularDistance = (a, b) => THREE.MathUtils.euclideanModulo(a - b + Math.PI, Math.PI * 2) - Math.PI;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function run(sim, seconds, input = {}) {
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) sim.update(DT, typeof input === 'function' ? input() : input);
}
function target(id, pos, shipType = 'patrol', heading = 0) {
  const body = HOSTILE_SHIPS[shipType];
  return { ...body, id, pos, shipType, heading, turretHeading: heading, turretPitch: 0, kind: 'ship', health: 300,
    maxHealth: 300, passive: true, age: 0, hitFlash: 0, fireTimer: 100, speed: 0, vel: vector(0, 0, 0), ammo: 180 };
}
function fixture() {
  const sim = new Simulation(7331); sim.start('naval-training', 'normal');
  sim.enemies = [target('sight-target', vector(0, .5, 2800))];
  sim.targetId = sim.enemies[0].id;
  return sim;
}
function origin(player) {
  return player.pos.clone().add(vector(Math.sin(player.heading) * DESTROYER.turretZ, DESTROYER.turretY,
    Math.cos(player.heading) * DESTROYER.turretZ));
}

test('a visible centre ray resolves the closest live physical hull, regardless of enemy order or selected identity', () => {
  const sim = fixture(), near = target('near', vector(0, .5, 3300)), far = target('far', vector(0, .5, 2300));
  const dead = target('dead', vector(0, .5, 3700)); dead.health = 0;
  sim.enemies = [far, dead, near]; sim.targetId = far.id;
  const camera = vector(0, 2.5, 4100), ray = vector(0, 0, -4);
  const before = JSON.stringify({ player: sim.player, enemies: sim.enemies, camera, ray });
  const hit = shipCameraAimPoint(sim.player, sim.enemies, camera, ray);
  assert.equal(hit.kind, 'ship'); assert.equal(hit.targetId, near.id);
  close(hit.point.z, near.pos.z + HOSTILE_SHIPS.patrol.halfLength);
  close(hit.distance, camera.distanceTo(hit.point));
  assert.equal(JSON.stringify({ player: sim.player, enemies: sim.enemies, camera, ray }), before, 'resolution is read-only');
});

test('rotated hit zones accept the real bridge while air above a forward bow has no target snap', () => {
  const sim = fixture();
  for (const heading of [-.9, .7]) {
    const ship = target('rotated', vector(0, .5, 2800), 'frigate', heading);
    const c = Math.cos(heading), s = Math.sin(heading);
    const world = (x, y, z) => ship.pos.clone().add(vector(x * c + z * s, y, -x * s + z * c));
    const crossing = vector(c, 0, -s);
    assert.equal(shipCameraAimPoint(sim.player, [ship], world(-30, 12, -8), crossing, 80).targetId, ship.id);
    const bowMiss = shipCameraAimPoint(sim.player, [ship], world(-30, 12, -36), crossing, 80);
    assert.equal(bowMiss.kind, 'sky'); assert.equal(bowMiss.targetId, null);
  }
});

test('terrain hides a vessel beyond an island, and a nearer visible hull wins before terrain', () => {
  const player = { pos: vector(-2400, .5, -3700), heading: Math.PI / 2 };
  const camera = vector(-2400, 3, -3700), ray = vector(-1, 0, 0);
  const hidden = target('hidden', vector(-8200, .5, -3700));
  const blocked = shipCameraAimPoint(player, [hidden], camera, ray, 7000);
  assert.equal(blocked.kind, 'terrain'); assert.equal(blocked.targetId, null);
  assert.ok(terrainHeight(blocked.point.x, blocked.point.z) > 0);
  assert.ok(blocked.distance < 200);
  const near = target('near-shore', vector(-2440, .5, -3700));
  const visible = shipCameraAimPoint(player, [hidden, near], camera, ray, 7000);
  assert.equal(visible.kind, 'ship'); assert.equal(visible.targetId, near.id);
  assert.ok(visible.distance < blocked.distance);
});

test('sea intersection and finite sky fallback never use an off-ray radar-selected ship', () => {
  const sim = fixture();
  const camera = vector(0, 90, 4200), ray = vector(0, -1, -1);
  const sea = shipCameraAimPoint(sim.player, sim.enemies, camera, ray);
  assert.equal(sea.kind, 'sea'); assert.equal(sea.targetId, null); close(sea.point.y, 0);
  const sky = shipCameraAimPoint(sim.player, sim.enemies, camera, vector(.4, .2, -1), 2100);
  assert.equal(sky.kind, 'sky'); assert.equal(sky.targetId, null); close(sky.distance, 2100);
  assert.ok(sky.point.toArray().every(Number.isFinite));
});

test('own hull is ignored and sea aim points inside it move to the 80 m horizontal safety radius', () => {
  const sim = fixture(), player = sim.player;
  const ownHull = { ...target('own', player.pos.clone(), 'frigate'), id: 'own' }; player.id = 'own';
  const hit = shipCameraAimPoint(player, [ownHull, ...sim.enemies], player.pos.clone().add(vector(0, 90, 0)), vector(0, -1, 0));
  assert.equal(hit.kind, 'sea'); assert.equal(hit.targetId, null); close(hit.point.y, 0);
  close(Math.hypot(hit.point.x - player.pos.x, hit.point.z - player.pos.z), 80);
  assert.ok(hit.point.z < player.pos.z, 'a vertical camera uses the hull forward bearing for the safe sea point');
});

test('a safety-adjusted sea aim beside a coast resolves onto land rather than underneath it', () => {
  const player = { pos: vector(-2400, .5, -3700), heading: Math.PI / 2 };
  const hit = shipCameraAimPoint(player, [], player.pos.clone().add(vector(0, 90, 0)), vector(-.1, -1, 0));
  assert.equal(hit.kind, 'terrain'); assert.equal(hit.targetId, null); close(hit.point.x, -2480);
  close(hit.point.y, terrainHeight(hit.point.x, hit.point.z)); assert.ok(hit.point.y > 0);
});

test('maximum range clips distant hulls and invalid rays fall back to a finite forward direction', () => {
  const sim = fixture(), camera = vector(0, 2, 4100);
  const beyond = target('beyond', vector(0, .5, -1500));
  const hit = shipCameraAimPoint(sim.player, [beyond], camera, vector(0, 0, -1));
  assert.equal(hit.kind, 'sky'); close(hit.distance, 5500);
  for (const invalid of [vector(0, 0, 0), { x: NaN, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 }]) {
    const fallback = shipCameraAimPoint(sim.player, [], camera, invalid, NaN);
    assert.equal(fallback.kind, 'sky'); assert.ok(fallback.point.toArray().every(Number.isFinite)); close(fallback.distance, 5500);
  }
});

test('camera world point commands a limited-rate traverse and elevation independent of rudder or legacy aim axes', () => {
  const sim = fixture(), p = sim.player;
  p.turretHeading = 0; p.turretPitch = 0;
  const point = origin(p).addScaledVector(forward(1.7, .8), 2000);
  sim.update(DT, { aimPoint: point, aimYaw: -1, pitch: -1, yaw: -1 });
  close(p.turretHeading, .72 * DT); close(p.turretPitch, .52 * DT);
  assert.ok(p.heading < 0 && p.gunAimActive); assert.ok(p.gunAimError > 1.6); assert.equal(p.gunAimLimited, false);
  run(sim, 4, { aimPoint: point });
  assert.ok(p.gunAimError < 1e-6); close(p.gunAimDistance, 1986, .2); assert.ok(p.gunAimFlightTime > 2);
});

test('absolute turret bearing takes the short wrapped route across plus/minus pi without a snap', () => {
  const sim = fixture(), p = sim.player;
  p.turretHeading = Math.PI - .005;
  const point = origin(p).addScaledVector(forward(-Math.PI + .15, .05), 1200);
  const old = p.turretHeading; sim.update(DT, { aimPoint: point });
  close(angularDistance(p.turretHeading, old), .72 * DT);
  assert.ok(p.turretHeading < -3, 'the scalar wraps while the physical bearing stays continuous');
  run(sim, 1, { aimPoint: point }); close(angularDistance(p.turretHeading, -Math.PI + .15), 0);
});

test('unreachable camera elevations preserve mechanical limits and report the remaining angular error', () => {
  const sim = fixture(), p = sim.player;
  for (const pitch of [-.8, 1.5]) {
    p.turretHeading = 0; p.turretPitch = 0;
    const point = origin(p).addScaledVector(forward(0, pitch), 1000);
    run(sim, 4, { aimPoint: point });
    close(p.turretPitch, pitch < 0 ? -.04 : 1.35);
    assert.equal(p.gunAimLimited, true); assert.ok(p.gunAimError > .1);
  }
});

test('a camera ray at a real hull yields a compensated low arc and actual cannon damage', () => {
  const sim = fixture(), target = sim.enemies[0], camera = vector(0, 60, 4200);
  const sight = target.pos.clone().add(vector(0, 2, 0));
  const aim = shipCameraAimPoint(sim.player, sim.enemies, camera, sight.clone().sub(camera));
  assert.equal(aim.kind, 'ship');
  run(sim, 1, { aimPoint: aim.point }); assert.ok(sim.player.gunAimError < 1e-6);
  const stocks = [sim.player.ammo, sim.player.missiles, sim.player.antiShipMissiles];
  sim.update(DT, { aimPoint: aim.point, fire: true });
  assert.equal(sim.player.ammo, stocks[0] - 1); assert.equal(sim.player.missiles, stocks[1]); assert.equal(sim.player.antiShipMissiles, stocks[2]);
  run(sim, 2, { aimPoint: aim.point });
  assert.equal(sim.hits, 1); assert.equal(target.health, 261.75);
  assert.ok(sim.drainEvents().some(event => event.type === 'hit' && event.id === target.id));
});

test('low-arc compensation inherits sideways hull velocity and the real shell hits beyond the legacy lifetime', () => {
  const sim = fixture(), p = sim.player, target = sim.enemies[0];
  target.pos.set(0, .5, -1000); // About 5 km across the unobstructed central channel.
  p.heading = -Math.PI / 2; p.speed = 18; p.throttle = 1; p.vel.set(18, 0, 0);
  const point = target.pos.clone().add(vector(0, 2, 0));
  run(sim, 1, { aimPoint: point });
  assert.ok(p.gunAimFlightTime > 5 && p.gunAimFlightTime < 6.8);
  assert.ok(p.turretHeading > 0, 'barrel points against inherited +X velocity');
  assert.ok(p.turretPitch > .007, 'low arc raises the barrel enough to offset gravity');
  sim.update(DT, { aimPoint: point, fire: true });
  assert.ok(sim.tracers[0].maxLife > 5 && sim.tracers[0].maxLife <= 6.8);
  run(sim, 6, { aimPoint: point });
  assert.equal(sim.hits, 1); assert.equal(target.health, 261.75);
});

test('aligned camera fire leaves the actual muzzle and an off-ray selected hull cannot bend its shell', () => {
  const sim = fixture(), p = sim.player, selected = sim.enemies[0];
  selected.pos.set(75, .5, 2800);
  const point = vector(0, 2.5, 2800); // Selected vessel is within old aim-assist cone but outside this sightline.
  run(sim, 1, { aimPoint: point });
  const mount = origin(p), barrel = forward(p.turretHeading, p.turretPitch);
  sim._fireGun(); const shell = sim.tracers[0];
  assert.ok(shell.vel.clone().sub(p.vel).normalize().dot(barrel) > .999999);
  assert.ok(shell.pos.distanceTo(mount.clone().addScaledVector(barrel, 14)) < .025);
  run(sim, 2, { aimPoint: point });
  assert.equal(sim.hits, 0); assert.equal(selected.health, 300);
});

test('non-finite point input restores legacy axes and clears all camera follow status', () => {
  const sim = fixture(), p = sim.player;
  sim.update(DT, { aimPoint: { x: 500, y: 100, z: 2800 } }); assert.equal(p.gunAimActive, true);
  for (const invalid of [undefined, null, {}, { x: NaN, y: 5, z: 3000 }, { x: 0, y: Infinity, z: 3000 }]) {
    const before = p.turretHeading;
    sim.update(DT, { aimPoint: invalid, aimYaw: -1 });
    close(angularDistance(p.turretHeading, before), -.72 * DT);
    assert.equal(p.gunAimActive, false); assert.equal(p.gunAimDistance, 0); assert.equal(p.gunAimError, 0);
    assert.equal(p.gunAimLimited, false); assert.equal(p.gunAimFlightTime, 0);
  }
});

test('pause freezes a camera tracking solution, restart clears it and aircraft ignore aimPoint', () => {
  const sim = fixture(), point = vector(400, 20, 2600);
  sim.update(DT, { aimPoint: point });
  sim.state = 'paused'; const snapshot = JSON.stringify(sim.player);
  run(sim, 2, { aimPoint: vector(-2000, 1000, 3300), fire: true });
  assert.equal(JSON.stringify(sim.player), snapshot); assert.equal(sim.tracers.length, 0);
  sim.start('naval-training');
  assert.equal(sim.player.gunAimActive, false); assert.equal(sim.player.gunAimDistance, 0);
  assert.equal(sim.player.gunAimError, 0); assert.equal(sim.player.gunAimFlightTime, 0); assert.equal(sim.player.gunAimLimited, false);
  const aircraft = new Simulation(7331), control = new Simulation(7331);
  aircraft.start('training'); control.start('training');
  aircraft.update(DT, { aimPoint: point, fire: true }); control.update(DT, { fire: true });
  assert.deepEqual(aircraft.player, control.player); assert.deepEqual(aircraft.tracers, control.tracers);
  assert.equal(aircraft.player.gunAimActive, undefined);
});
