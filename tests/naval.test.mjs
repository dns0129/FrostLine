import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DESTROYER, HOSTILE_SHIPS } from '../simulation.js';
import { terrainHeight } from '../world-math.js';
import { makeEnemyShip } from '../destroyer.js';
import * as THREE from '../vendor/three.module.js';

const DT = 1 / 60;
function naval(mode = 'naval', difficulty = 'normal') {
  const sim = new Simulation(7331);
  sim.start(mode, difficulty, 'destroyer');
  return sim;
}
function run(sim, seconds, input = {}) {
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) sim.update(DT, input);
}
function assertSafeHull(entity) {
  assert.equal(entity.pos.y, entity.waterline);
  assert.equal(entity.vel.y, 0);
  const c = Math.cos(entity.heading), s = Math.sin(entity.heading);
  for (let z = -entity.halfLength; z <= entity.halfLength; z += entity.halfLength / 4) {
    for (const x of [-entity.halfWidth, 0, entity.halfWidth]) {
      const height = terrainHeight(entity.pos.x + x * c + z * s, entity.pos.z - x * s + z * c);
      assert.ok(height <= -3, 'the complete footprint retains at least three metres of water depth');
    }
  }
  assert.ok(Number.isFinite(entity.pos.length() + entity.vel.length() + entity.heading + entity.speed));
}
function aimAt(sim, target) {
  const p = sim.player;
  const origin = p.pos.clone().add(new THREE.Vector3(Math.sin(p.heading) * p.turretZ, p.turretY, Math.cos(p.heading) * p.turretZ));
  const delta = target.pos.clone().add(new THREE.Vector3(0, target.aimHeight, 0)).sub(origin);
  p.turretHeading = Math.atan2(-delta.x, -delta.z);
  p.turretPitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
}
function manualShell(sim, from, to, enemy = false, damage = 45) {
  const velocity = to.clone().sub(from).multiplyScalar(1 / DT);
  sim.tracers.push({ pos: from.clone(), prev: from.clone(), vel: velocity, enemy, damage, life: 4.2, maxLife: 4.2 });
}
function shipLocalPoint(entity, x, y, z) {
  return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.heading).add(entity.pos);
}
function modelSegmentHits(entity, from, to) {
  const model = makeEnemyShip(entity.shipType);
  model.position.copy(entity.pos); model.rotation.y = entity.heading;
  model.userData.update(0, entity); model.updateMatrixWorld(true);
  const length = from.distanceTo(to);
  const ray = new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, length);
  const hits = ray.intersectObject(model, true).length;
  model.userData.dispose();
  return hits;
}

test('destroyer sea missions expose both genuine ship types in safe water', () => {
  for (const mode of ['naval', 'naval-training']) {
    const sim = naval(mode);
    assert.equal(sim.mode, mode);
    assert.equal(sim.vehicle, 'destroyer');
    assert.equal(sim.player.kind, 'destroyer');
    assert.equal(sim.player.turretPitch, 0.006);
    assert.equal(sim.enemies.length, 2);
    assertSafeHull(sim.player);
    assert.deepEqual(sim.enemies.map(e => e.shipType), ['patrol', 'frigate']);
    for (const e of sim.enemies) {
      assert.equal(e.kind, 'ship');
      assert.match(e.id, /^hostile-ship-\d+$/);
      assert.ok(e.maxHealth >= 100);
      assert.ok(Number.isFinite(e.turretHeading + e.turretPitch + e.aimHeight));
      assert.equal(e.halfLength, HOSTILE_SHIPS[e.shipType].halfLength);
      assert.equal(e.halfWidth, HOSTILE_SHIPS[e.shipType].halfWidth);
      assertSafeHull(e);
    }
  }
});

test('default naval-training aim hits the forward target and awards one real sinking', () => {
  const sim = naval('naval-training');
  const first = sim.enemies[0];
  assert.deepEqual(first.pos.toArray(), [0, 0.5, 3240]);
  run(sim, 3, { fire: true });
  assert.equal(sim.kills, 1);
  assert.equal(sim.hits, 3);
  assert.equal(sim.enemies.length, 1);
  assert.equal(sim.enemies[0].shipType, 'frigate');
  assert.equal(sim.lockProgress, 0);
  assert.equal(sim.state, 'playing');
  assert.ok(sim.player.ammo < DESTROYER.maxAmmo);
  const events = sim.drainEvents();
  assert.ok(events.some(e => e.type === 'hit' && e.kind === 'ship' && e.damage === 45));
  assert.ok(events.some(e => e.type === 'kill' && e.kind === 'ship' && e.shipType === 'patrol'));
  assert.ok(events.some(e => e.type === 'toast' && /击沉敌舰/.test(e.text)));
  assert.ok(sim.particles.length > 0);
  const score = sim.score;
  run(sim, 1);
  assert.equal(sim.kills, 1);
  assert.equal(sim.score, score, 'a removed wreck cannot award a second sinking');
});

test('manually traversing the gun finishes both stationary training ships', () => {
  const sim = naval('naval-training');
  for (let frame = 0; frame < 30 * 60 && sim.state === 'playing'; frame++) {
    if (sim.enemies[0]) aimAt(sim, sim.enemies[0]);
    sim.update(DT, { fire: !sim.player.overheated });
  }
  assert.equal(sim.state, 'won');
  assert.equal(sim.kills, 2);
  assert.equal(sim.hits, 7);
  assert.equal(sim.player.health, DESTROYER.maxHealth);
  assert.equal(sim.player.missiles, DESTROYER.maxMissiles);
  assert.equal(sim.enemies.length, 0);
  assert.equal(sim.drainEvents().filter(e => e.type === 'result').length, 1);
});

test('stationary training vessels remain harmless over a full minute', () => {
  const sim = naval('naval-training');
  const positions = sim.enemies.map(e => e.pos.clone());
  run(sim, 60);
  sim.enemies.forEach((e, index) => {
    assert.deepEqual(e.pos, positions[index]);
    assert.equal(e.speed, 0); assert.equal(e.shots, 0); assert.equal(e.ammo, 180);
    assertSafeHull(e);
  });
  assert.equal(sim.player.health, DESTROYER.maxHealth);
  assert.equal(sim.tracers.length, 0); assert.equal(sim.missiles.length, 0);
  assert.equal(sim.threat, 0); assert.equal(sim.incoming, 0);
});

test('naval AI turns independently aimed guns and its real cannon shells damage the player', () => {
  const sim = naval();
  const positions = sim.enemies.map(e => e.pos.clone());
  run(sim, 10);
  assert.ok(sim.player.health < DESTROYER.maxHealth - 20);
  assert.equal(sim.state, 'playing');
  assert.ok(sim.enemies.every((e, index) => e.pos.distanceTo(positions[index]) > 20));
  assert.ok(sim.enemies.every(e => e.shots > 0 && e.ammo < 180));
  assert.ok(sim.enemies.some(e => Math.abs(e.turretHeading - e.heading) > 0.1));
  assert.ok(sim.drainEvents().some(e => e.type === 'fire' && e.enemy && e.kind === 'ship'));
  assert.ok(sim.threat > 0);
  assert.equal(sim.missiles.length, 0, 'enemy ships use their guns rather than the aircraft missile AI');
  sim.enemies.forEach(assertSafeHull);
});

test('SAM rejects all surface targets immediately and never consumes missiles', () => {
  for (const mode of ['naval', 'naval-training']) {
    const sim = naval(mode);
    run(sim, 2);
    assert.equal(sim.lockProgress, 0);
    assert.equal(sim.lockTarget, null);
    const inventory = sim.player.missiles;
    assert.equal(sim.launchMissile(), false);
    assert.equal(sim.player.missiles, inventory);
    assert.equal(sim.missiles.length, 0);
    assert.ok(sim.drainEvents().some(e => e.type === 'toast' && /防空只对空/.test(e.text)));
    assert.equal(sim.cycleTarget(), true);
    assert.equal(sim.targetId, sim.enemies[1].id);
    run(sim, 1.3);
    assert.equal(sim.lockProgress, 0); assert.equal(sim.lockTarget, null);
    sim.lockTarget = sim.enemies[1]; sim.lockProgress = 1;
    assert.equal(sim.launchMissile(), false, 'even a stale or forged lock cannot turn SAM into an anti-ship weapon');
    assert.equal(sim.lockProgress, 0);
  }
});

test('surface-target missile rejection also holds in legacy aircraft and mixed combat states', () => {
  for (const vehicle of ['aircraft', 'destroyer']) {
    const source = naval('naval-training'), target = source.enemies[0];
    const sim = new Simulation(); sim.start('training', 'normal', vehicle);
    target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -700));
    sim.enemies = [target]; sim.targetId = target.id;
    sim._updateLock(2);
    assert.equal(sim.lockProgress, 0);
    sim.lockTarget = target; sim.lockProgress = 1;
    assert.equal(sim.launchMissile(), false);
    assert.equal(sim.missiles.length, 0);
    sim._addMissile(sim.player, false, target.id);
    sim.missiles[0].pos.copy(target.pos); sim.missiles[0].prev.copy(target.pos);
    const health = target.health;
    sim._updateMissiles(DT);
    assert.equal(target.health, health, 'guidance and detonation also exclude ship targets');
  }
});

test('high shells above the bow miss both rendered ship types at positive and negative headings', () => {
  for (const shipType of ['patrol', 'frigate']) for (const heading of [-2.4, -0.7, 0, 0.9, 2.6]) {
    const sim = naval('naval-training');
    const e = sim.enemies.find(target => target.shipType === shipType); sim.enemies = [e];
    e.heading = heading; e.turretHeading = heading;
    const height = shipType === 'patrol' ? 9 : 12, bow = shipType === 'patrol' ? -20 : -38;
    const from = shipLocalPoint(e, -40, height, bow), to = shipLocalPoint(e, 40, height, bow);
    assert.equal(modelSegmentHits(e, from, to), 0, 'the rendered bow has no high superstructure on this path');
    manualShell(sim, from, to);
    const health = e.health;
    sim._updateTracers(DT);
    assert.equal(e.health, health, 'the full-length avoidance OBB must not become a tall damage volume');
    assert.equal(sim.hits, 0);
    const missFrom = shipLocalPoint(e, 50, 12, -100), missTo = shipLocalPoint(e, 50, 12, 100);
    manualShell(sim, missFrom, missTo); sim._updateTracers(DT);
    assert.equal(e.health, health, 'an off-beam parallel pass also misses');
  }
});

test('low hull, bridge and rotated forward gunhouse strikes hit real model surfaces', () => {
  for (const shipType of ['patrol', 'frigate']) for (const heading of [-1.7, 0, 1.2]) {
    const regions = shipType === 'patrol'
      ? [{ y: 1, z: -15 }, { y: 5.6, z: 4 }, { y: 2.8, z: -12 }]
      : [{ y: 1.5, z: -32 }, { y: 12.2, z: -8 }, { y: 4.7, z: -24 }];
    for (const region of regions) {
      const sim = naval('naval-training');
      const e = sim.enemies.find(target => target.shipType === shipType); sim.enemies = [e];
      e.heading = heading; e.turretHeading = heading + 0.8;
      const from = shipLocalPoint(e, -30, region.y, region.z), to = shipLocalPoint(e, 30, region.y, region.z);
      assert.ok(modelSegmentHits(e, from, to) > 0, 'the chosen strike crosses actual ship mesh geometry');
      manualShell(sim, from, to); sim._updateTracers(DT);
      assert.equal(e.health, e.maxHealth - 45);
      assert.equal(sim.hits, 1);
    }
  }
});

test('naval gravity compensation and shell lifetime allow a real three-kilometre hit', () => {
  const sim = naval('naval-training');
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -3000));
  aimAt(sim, target);
  sim.update(DT, { fire: true });
  assert.equal(sim.tracers[0].maxLife, 4.2);
  run(sim, 3.5);
  assert.equal(target.health, target.maxHealth - 45);
  assert.equal(sim.hits, 1);
});

test('bounded naval lead intercepts a small vessel crossing at 2.7 kilometres', () => {
  const sim = naval('naval-training');
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -2700));
  target.heading = -Math.PI / 2; target.speed = 14; target.vel.set(14, 0, 0);
  sim._updateEnemies = dt => { target.pos.addScaledVector(target.vel, dt); };
  aimAt(sim, target);
  sim.update(DT, { fire: true });
  const start = target.pos.clone();
  run(sim, 3.2);
  assert.ok(target.pos.x > start.x + 40, 'the target actually crosses the firing line while the shell travels');
  assert.equal(target.health, target.maxHealth - 45);
  assert.equal(sim.hits, 1);
  assertSafeHull(target);
});

test('a mountain terminates a swept projectile before the hidden sea target can take damage', () => {
  const sim = naval('naval-training');
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.set(-8000, target.waterline, -3700); target.heading = Math.PI / 2;
  assertSafeHull(target);
  const from = new THREE.Vector3(-1500, 5, -3700), to = new THREE.Vector3(-8000, 5, -3700);
  assert.ok(terrainHeight(-4800, -3700) > 100);
  manualShell(sim, from, to);
  const health = target.health;
  sim._updateTracers(DT);
  assert.equal(target.health, health);
  assert.equal(sim.tracers.length, 0);
  assert.equal(sim.hits, 0);
});

test('terrain also blocks enemy cannon damage and does not erase a nearer hull hit', () => {
  const sim = naval('naval-training');
  sim.player.pos.set(-8000, 0.5, -3700); sim.player.heading = Math.PI / 2;
  manualShell(sim, new THREE.Vector3(-1500, 5, -3700), new THREE.Vector3(-8000, 5, -3700), true, 22);
  sim._updateTracers(DT);
  assert.equal(sim.player.health, DESTROYER.maxHealth);
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.set(-1900, 0.5, -3700); target.heading = Math.PI / 2;
  manualShell(sim, new THREE.Vector3(-1500, 5, -3700), new THREE.Vector3(-8000, 5, -3700));
  sim._updateTracers(DT);
  assert.equal(target.health, target.maxHealth - 45, 'impact ordering awards a hull hit before the mountain');
});

test('driving into a stationary target cannot pass the player hull through it', () => {
  const sim = naval('naval-training');
  const target = sim.enemies[0]; target.pos.set(0, 0.5, 3800);
  sim.enemies = [target];
  sim.player.speed = 18; sim.player.throttle = 1; sim.player.vel.set(0, 0, -18);
  run(sim, 15);
  const separation = sim.player.pos.z - target.pos.z;
  assert.ok(separation >= sim.player.halfLength + target.halfLength + 5);
  assert.equal(target.pos.z, 3800);
  assert.ok(sim.player.speed < 1);
  assertSafeHull(sim.player); assertSafeHull(target);
});

test('AI ships avoid the player hull when an initial course heads directly at it', () => {
  const sim = naval();
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -200));
  target.heading = Math.PI; target.speed = 14; target.vel.set(0, 0, 14); target.ammo = 0;
  for (let frame = 0; frame < 30 * 60; frame++) {
    sim.update(DT);
    assert.ok(!sim._shipCanOccupy(target, sim.player.pos, target.heading), 'both hulls reserve their current footprint');
    assert.ok(target.pos.distanceTo(sim.player.pos) > 60, 'the vessel cannot pass through the centre of the destroyer');
    assertSafeHull(target);
  }
  assert.equal(sim.player.health, DESTROYER.maxHealth);
});

test('an enemy ship approaching an island manoeuvres back into open water at sea level', () => {
  const sim = naval();
  const e = sim.enemies[0]; sim.enemies = [e];
  sim.player.pos.set(-2000, 0.5, -4500); sim._lastShipWater.pos.copy(sim.player.pos);
  e.pos.set(-2350, 0.5, -3700); e.heading = Math.PI / 2; e.speed = 14; e.vel.set(-14, 0, 0); e.ammo = 0;
  const initial = e.pos.clone();
  for (let frame = 0; frame < 30 * 60; frame++) { sim.update(DT); assertSafeHull(e); }
  assert.ok(e.pos.distanceTo(initial) > 80, 'route avoidance does not leave the ship stuck against the coast');
  assert.equal(e.pitch, 0); assert.equal(e.bank, 0);
  assert.equal(e.pos.y, e.waterline);
});

test('coast and boundary positions still create all four safe third-wave vessels', () => {
  for (const [x, z, heading] of [[-2350, -3700, Math.PI / 2], [0, 10870, Math.PI], [6600, 1200, 0], [3000, -9000, 0]]) {
    const sim = naval(); sim.enemies = [];
    sim.player.pos.set(x, 0.5, z); sim.player.heading = heading; sim.wave = 2;
    sim._spawnWave();
    assert.equal(sim.wave, 3); assert.equal(sim.enemies.length, 4); assert.equal(sim.state, 'playing');
    sim.enemies.forEach(e => { assertSafeHull(e); assert.ok(sim._shipCanOccupy(e, e.pos, e.heading)); });
    const event = sim.drainEvents().filter(e => e.type === 'wave').at(-1);
    assert.equal(event.count, 4); assert.match(event.text, /4 艘/);
  }
});

test('a completely failed placement cannot silently create an empty winning wave', () => {
  const sim = naval(); sim.enemies = []; sim.wave = 2;
  sim._shipSpawnPosition = () => null;
  sim._spawnWave();
  assert.equal(sim.state, 'paused'); assert.equal(sim._spawnIncomplete, true);
  const health = sim.player.health;
  sim.state = 'playing'; sim._updateMission(10);
  assert.equal(sim.state, 'playing'); assert.equal(sim.player.health, health);
  assert.equal(sim._waveDelay, -1);
  assert.ok(!sim.drainEvents().some(e => e.type === 'result'));
});

test('all three naval waves resupply the correct ship inventory and end after nine sinkings', () => {
  const sim = naval(); sim.player.health = 100; sim.player.ammo = 20; sim.player.missiles = 1;
  for (let wave = 1; wave <= 3; wave++) {
    assert.equal(sim.wave, wave); assert.equal(sim.enemies.length, wave + 1);
    for (const e of sim.enemies) e.health = 0;
    sim.update(DT);
    if (wave < 3) {
      assert.equal(sim.state, 'playing');
      assert.equal(sim.player.health, wave === 1 ? 205 : 300);
      assert.equal(sim.player.ammo, wave === 1 ? 120 : 220);
      assert.equal(sim.player.missiles, wave === 1 ? 7 : 12);
      run(sim, 4.7);
      sim.enemies.forEach(assertSafeHull);
    }
  }
  assert.equal(sim.state, 'won'); assert.equal(sim.kills, 9);
  assert.ok(sim.score > 3000);
  assert.equal(sim.drainEvents().filter(e => e.type === 'result').length, 1);
});

test('nine active moving warships can actually be sunk by aimed cannon fire across the campaign', () => {
  const sim = naval('naval', 'easy');
  for (let frame = 0; frame < 90 * 60 && sim.state === 'playing'; frame++) {
    if (sim.enemies[0]) aimAt(sim, sim.enemies[0]);
    sim.update(DT, { fire: !!sim.enemies.length && !sim.player.overheated });
  }
  assert.equal(sim.state, 'won'); assert.equal(sim.wave, 3); assert.equal(sim.kills, 9);
  assert.ok(sim.hits >= 35); assert.ok(sim.player.health > 0);
  assert.ok(sim.player.ammo > 0);
  assert.equal(sim.player.pos.y, 0.5);
});

test('difficulty changes hostile hull strength, cannon damage and firing rate', () => {
  const easy = naval('naval', 'easy'), normal = naval(), hard = naval('naval', 'hard');
  assert.ok(easy.enemies[0].maxHealth < normal.enemies[0].maxHealth);
  assert.ok(hard.enemies[1].maxHealth > normal.enemies[1].maxHealth);
  for (const sim of [easy, normal, hard]) {
    const p = sim.player;
    manualShell(sim, p.pos.clone().add(new THREE.Vector3(-40, 8, 0)), p.pos.clone().add(new THREE.Vector3(40, 8, 0)), true, 14);
    sim._updateTracers(DT);
    assert.equal(p.health, DESTROYER.maxHealth - 14 * sim.settings.damage);
    sim.enemies[0].fireTimer = 0;
    sim.enemies[0].turretHeading = Math.PI;
    sim._updateEnemies(DT);
  }
  assert.ok(easy.player.health > normal.player.health && normal.player.health > hard.player.health);
  assert.ok(easy.enemies[0].fireTimer > normal.enemies[0].fireTimer);
  assert.ok(normal.enemies[0].fireTimer > hard.enemies[0].fireTimer);
});

test('long naval sessions preserve bounded effects, sea clearance and finite enemy ammunition', () => {
  const sim = naval('naval', 'hard');
  for (let frame = 0; frame < 90 * 60; frame++) {
    sim.player.health = DESTROYER.maxHealth;
    sim.update(DT);
    assert.ok(sim.tracers.length <= 140); assert.ok(sim.particles.length <= 220); assert.ok(sim.missiles.length <= 24);
    for (const e of sim.enemies) { assertSafeHull(e); assert.ok(e.ammo >= 0 && e.ammo <= 180); assert.equal(e.shots + e.ammo, 180); }
  }
  assert.equal(sim.state, 'playing'); assert.equal(sim.enemies.length, 2);
  assert.ok(sim.drainEvents().length <= 100);
});

test('a naval task with no shells or in-flight friendly fire ends clearly without exploding the player', () => {
  for (const mode of ['naval', 'naval-training']) {
    const sim = naval(mode); sim.player.ammo = 0; sim.player.antiShipMissiles = 0; sim.player.health = 230;
    sim.drainEvents(); sim.update(DT);
    assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'ammo');
    assert.equal(sim.player.health, 230);
    assert.equal(sim.particles.length, 0, 'running out of ammunition does not destroy a healthy vessel');
    assert.equal(sim.enemies.length, 2);
    const results = sim.drainEvents().filter(event => event.type === 'result');
    assert.equal(results.length, 1); assert.equal(results[0].reason, 'ammo');
  }
});

test('the last missed naval shot gets its full flight before ammunition failure', () => {
  const sim = naval('naval-training'); sim.player.ammo = 1; sim.player.antiShipMissiles = 0; sim.player.turretHeading = Math.PI;
  sim.drainEvents(); sim.update(DT, { fire: true });
  assert.equal(sim.player.ammo, 0); assert.equal(sim.state, 'playing');
  assert.ok(sim.tracers.some(shell => !shell.enemy && shell.life > 0));
  const toast = sim.drainEvents().find(event => event.type === 'toast' && /弹药耗尽/.test(event.text));
  assert.ok(toast && /等待在途武器命中/.test(toast.text));
  assert.ok(!/使用导弹/.test(toast.text));
  run(sim, 3);
  assert.equal(sim.state, 'playing', 'the mission waits for the final shell rather than ending when inventory reaches zero');
  run(sim, 1.3);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'ammo');
  assert.equal(sim.player.health, 300); assert.equal(sim.particles.length, 0);
});

test('the last naval-training shell can still sink the final target and win', () => {
  const sim = naval('naval-training'); sim.enemies = [sim.enemies[0]];
  sim.enemies[0].health = 45; sim.player.ammo = 1; sim.player.antiShipMissiles = 0;
  sim.update(DT, { fire: true });
  assert.equal(sim.state, 'playing'); assert.equal(sim.player.ammo, 0);
  run(sim, 2);
  assert.equal(sim.state, 'won'); assert.equal(sim.kills, 1); assert.equal(sim.enemies.length, 0);
  assert.equal(sim.endReason, ''); assert.equal(sim.player.health, 300);
  const result = sim.drainEvents().find(event => event.type === 'result');
  assert.equal(result.won, true); assert.notEqual(result.reason, 'ammo');
});

test('the final shell can clear a campaign wave and receive ammunition before failure is checked', () => {
  const sim = naval(); const target = sim.enemies[0]; sim.enemies = [target];
  target.health = 45; target.passive = true; target.speed = 0; target.vel.set(0, 0, 0);
  sim.player.ammo = 1; sim.player.antiShipMissiles = 0; sim.player.health = 150;
  sim.update(DT, { fire: true }); run(sim, 2);
  assert.equal(sim.state, 'playing'); assert.equal(sim.endReason, ''); assert.equal(sim.kills, 1);
  assert.equal(sim.player.ammo, 100); assert.equal(sim.player.health, 255);
  assert.equal(sim.player.antiShipMissiles, 3);
  assert.ok(sim._waveDelay > 0); assert.equal(sim.enemies.length, 0);
  run(sim, 4.6);
  assert.equal(sim.state, 'playing'); assert.equal(sim.wave, 2); assert.equal(sim.enemies.length, 3);
  assert.ok(!sim.drainEvents().some(event => event.type === 'result'));
});

test('a final shell that hits but leaves an enemy alive reports ammunition defeat', () => {
  const sim = naval('naval-training'); sim.enemies = [sim.enemies[0]]; sim.player.ammo = 1; sim.player.antiShipMissiles = 0;
  sim.update(DT, { fire: true }); run(sim, 2);
  assert.equal(sim.hits, 1); assert.equal(sim.enemies[0].health, 75);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'ammo');
  assert.equal(sim.player.health, 300);
});

test('ammunition outcomes reset on restart and legacy aircraft ammunition rules stay compatible', () => {
  const sim = naval('naval-training'); sim.player.ammo = 0; sim.player.antiShipMissiles = 0; sim.update(DT);
  assert.equal(sim.endReason, 'ammo');
  for (const vehicle of ['aircraft', 'destroyer']) {
    sim.start('training', 'normal', vehicle); sim.player.ammo = 0;
    assert.equal(sim.endReason, '');
    run(sim, 2, { fire: true });
    assert.equal(sim.state, 'playing'); assert.equal(sim.player.missiles, vehicle === 'destroyer' ? 12 : 6);
  }
  sim.start('naval-training'); sim._damagePlayer(300);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'health');
  assert.ok(sim.particles.length > 0, 'physical hull destruction keeps its explosion');
});

test('naval defeat, pause and restart preserve original aircraft and destroyer modes', () => {
  const sim = naval('naval-training');
  sim.state = 'paused';
  const snapshot = JSON.stringify({ player: sim.player, enemies: sim.enemies, time: sim.time });
  run(sim, 5, { fire: true, boost: true });
  assert.equal(JSON.stringify({ player: sim.player, enemies: sim.enemies, time: sim.time }), snapshot);
  sim.state = 'playing'; sim._damagePlayer(DESTROYER.maxHealth);
  assert.equal(sim.state, 'lost'); assert.equal(sim.player.health, 0);
  for (const mode of ['intercept', 'free', 'training']) {
    sim.start(mode, 'normal', 'aircraft');
    assert.equal(sim.mode, mode); assert.equal(sim.vehicle, 'aircraft');
    assert.ok(sim.enemies.every(e => e.kind === 'aircraft' && e.pos.y > 400));
    assert.equal(sim.player.pos.y, 1100); assert.equal(sim.player.maxHealth, 100);
    assert.equal(sim.player.turretHeading, undefined); assert.equal(sim.kills, 0);
    assert.equal(sim.tracers.length, 0); assert.equal(sim.particles.length, 0);
    sim.start(mode, 'easy', 'destroyer');
    assert.equal(sim.player.turretPitch, 0.3);
    assert.ok(sim.enemies.every(e => e.kind === 'aircraft'));
    assert.equal(sim.player.health, 300);
  }
});
