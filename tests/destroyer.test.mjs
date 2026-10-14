import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DESTROYER } from '../simulation.js';
import { terrainHeight } from '../world-math.js';
import * as THREE from '../vendor/three.module.js';

const DT = 1 / 60;
const forward = (heading, pitch = 0) => new THREE.Vector3(
  -Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch),
);
function ship(mode = 'training', difficulty = 'normal') {
  const sim = new Simulation(7331);
  sim.start(mode, difficulty, 'destroyer');
  return sim;
}
function run(sim, seconds, input = {}) {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) sim.update(DT, input);
}
function stationaryTargets(sim, positions) {
  sim.enemies = sim.enemies.slice(0, positions.length);
  sim.enemies.forEach((e, i) => { e.pos.copy(positions[i]); e.vel.set(0, 0, 0); e.speed = 0; });
  // Hold the test aircraft in a chosen geometry while exercising the real radar and weapons.
  sim._updateEnemies = () => {};
  return sim.enemies;
}
function assertHullInWater(player) {
  for (let z = -DESTROYER.halfLength; z <= DESTROYER.halfLength; z += DESTROYER.halfLength / 4) {
    for (const x of [-DESTROYER.halfWidth, 0, DESTROYER.halfWidth]) {
      const c = Math.cos(player.heading), s = Math.sin(player.heading);
      assert.ok(terrainHeight(player.pos.x + x * c + z * s, player.pos.z - x * s + z * c) <= -3,
        'every sampled part of the hull retains enough water depth');
    }
  }
}

test('a destroyer starts afloat, stopped, supplied and facing the existing -Z convention', () => {
  const sim = ship();
  assert.equal(sim.vehicle, 'destroyer');
  assert.equal(sim.player.kind, 'destroyer');
  assert.equal(sim.player.pos.y, DESTROYER.waterline);
  assert.equal(sim.player.speed, 0);
  assert.equal(sim.player.throttle, 0);
  assert.equal(sim.player.health, DESTROYER.maxHealth);
  assert.equal(sim.player.maxHealth, DESTROYER.maxHealth);
  assert.equal(sim.player.missiles, DESTROYER.maxMissiles);
  assert.equal(sim.player.turretPitch, 0.3);
  assert.equal(sim.player.turretHeading, sim.player.heading);
  assert.ok(sim.enemies.every(e => e.pos.y >= 600));
  assertHullInWater(sim.player);
});

test('throttle accelerates with inertia; ship pitch and boost never lift the hull', () => {
  const sim = ship();
  const origin = sim.player.pos.clone();
  sim.update(DT, { throttleDelta: 1, pitch: 1, boost: true });
  assert.equal(sim.player.throttle, 1, 'the mobile full-speed button sets the engine telegraph to full');
  assert.ok(sim.player.speed > 0 && sim.player.speed < 0.1, 'speed cannot jump to its target');
  run(sim, 12, { throttleDelta: 1, pitch: 1, boost: true });
  assert.ok(sim.player.pos.z < origin.z - 90);
  assert.ok(sim.player.speed > 15 && sim.player.speed <= DESTROYER.maxSpeed);
  assert.equal(sim.player.pos.y, DESTROYER.waterline);
  assert.equal(sim.player.vel.y, 0);
  assert.equal(sim.player.pitch, 0);
  assert.equal(sim.player.boost, false);
  assert.equal(sim.player.turretPitch, 1.35);
});

test('zero throttle coasts before stopping and the brake shortens the coast', () => {
  const coast = ship(), brake = ship();
  for (const sim of [coast, brake]) {
    sim.player.speed = 18;
    sim.player.vel.set(0, 0, -18);
    sim.player.throttle = 0;
  }
  const before = coast.player.pos.z;
  run(coast, 1); run(brake, 1, { airbrake: true });
  assert.ok(coast.player.speed > 12, 'the hull retains momentum after throttle is cut');
  assert.ok(brake.player.speed < coast.player.speed - 3);
  assert.ok(coast.player.pos.z < before - 12);
  run(coast, 30);
  assert.equal(coast.player.speed, 0);
  assert.equal(coast.player.vel.length(), 0);
  const stopped = coast.player.pos.clone();
  run(coast, 2);
  assert.deepEqual(coast.player.pos, stopped);
});

test('both roll and yaw operate an inertial rudder and positive steering turns left', () => {
  for (const input of [{ roll: 1 }, { yaw: 1 }]) {
    const sim = ship();
    sim.player.speed = 18; sim.player.throttle = 1; sim.player.vel.set(0, 0, -18);
    sim.update(DT, input);
    assert.ok(sim.player.rudder > 0 && sim.player.rudder < 0.1);
    run(sim, 5, input);
    assert.ok(sim.player.heading > 0.45);
    assert.ok(sim.player.pos.x < -10);
    assert.equal(sim.player.pos.y, DESTROYER.waterline);
  }
});

test('gun traverse and elevation are separate from helm, with a stabilized absolute bearing', () => {
  const sim = ship();
  run(sim, 1, { aimYaw: -1, pitch: 1 });
  assert.ok(sim.player.turretHeading < -0.7);
  assert.ok(sim.player.turretPitch > 0.8);
  assert.equal(sim.player.heading, 0);
  const aim = sim.player.turretHeading;
  run(sim, 2, { yaw: 1 });
  assert.ok(sim.player.heading > 0.02);
  assert.equal(sim.player.turretHeading, aim, 'turning the ship preserves the selected world bearing');
  run(sim, 5, { pitch: -1 });
  assert.equal(sim.player.turretPitch, -0.04);
});

test('shells leave the model turret mount along turret bearing, not ship bearing', () => {
  const sim = ship();
  sim.enemies.forEach(e => { e.pos.x += 5000; });
  const p = sim.player;
  p.heading = 0.4; p.turretHeading = -1.1; p.turretPitch = 0.7;
  const direction = forward(p.turretHeading, p.turretPitch);
  const mount = p.pos.clone().add(new THREE.Vector3(
    Math.sin(p.heading) * DESTROYER.turretZ, DESTROYER.turretY, Math.cos(p.heading) * DESTROYER.turretZ,
  ));
  sim._fireGun();
  const tracer = sim.tracers[0];
  assert.ok(tracer.vel.clone().normalize().dot(direction) > 0.999995);
  assert.ok(tracer.pos.distanceTo(mount.clone().addScaledVector(direction, 14)) < 0.03);
  assert.equal(p.ammo, DESTROYER.maxAmmo - 1);
  assert.ok(sim.drainEvents().some(event => event.type === 'fire' && event.kind === 'destroyer'));
});

test('gun lead helps a near reticle target but never bends a shell by more than about five degrees', () => {
  const sim = ship();
  const p = sim.player, direction = forward(p.turretHeading, p.turretPitch);
  const mount = p.pos.clone().add(new THREE.Vector3(0, DESTROYER.turretY, DESTROYER.turretZ));
  const [target] = stationaryTargets(sim, [mount.clone().addScaledVector(direction, 1000)]);
  target.vel.set(300, 0, 0);
  sim._fireGun();
  const firing = sim.tracers[0].vel.clone().normalize();
  const correction = Math.acos(Math.max(-1, Math.min(1, direction.dot(firing))));
  assert.ok(firing.x > 0.06, 'the correction leads a crossing aircraft');
  assert.ok(correction < 0.094, 'lead remains bounded and cannot replace manual aiming');
});

test('a properly aimed shell can damage and destroy an airborne target', () => {
  const sim = ship();
  const p = sim.player;
  const mount = p.pos.clone().add(new THREE.Vector3(0, DESTROYER.turretY, DESTROYER.turretZ));
  const [target] = stationaryTargets(sim, [mount.addScaledVector(forward(p.turretHeading, p.turretPitch), 800)]);
  target.health = target.maxHealth = 100;
  run(sim, 2, { fire: true });
  assert.equal(sim.kills, 1);
  assert.equal(sim.hits, 3);
  assert.equal(sim.state, 'won');
  assert.equal(sim.player.pos.y, DESTROYER.waterline);
});

test('omnidirectional radar locks a target behind the ship and VLS intercepts it', () => {
  const sim = ship();
  const [target] = stationaryTargets(sim, [sim.player.pos.clone().add(new THREE.Vector3(0, 500, 1800))]);
  const inventory = sim.player.missiles;
  assert.equal(sim.launchMissile(), false);
  run(sim, 1.3);
  assert.equal(sim.lockProgress, 1);
  assert.equal(sim.lockTarget, target);
  assert.equal(sim.launchMissile(), true);
  const missile = sim.missiles[0];
  assert.equal(missile.dir.y, 1);
  assert.equal(missile.pitch, Math.PI / 2);
  assert.ok(missile.pos.y > 7);
  assert.equal(sim.player.missiles, inventory - 1);
  assert.equal(sim.launchMissile(), false, 'VLS has a launch cooldown');
  const height = missile.pos.y;
  run(sim, 0.2);
  assert.ok(missile.pos.y > height + 15);
  assert.equal(missile.dir.y, 1, 'the initial launch safely clears the deck before guidance');
  run(sim, 8);
  assert.equal(sim.kills, 1);
  assert.equal(sim.state, 'won');
  assert.ok(sim.drainEvents().some(e => e.type === 'hit' && e.missile));
});

test('radar reaches close to five kilometres and a launched interceptor has enough range', () => {
  const sim = ship();
  stationaryTargets(sim, [sim.player.pos.clone().add(new THREE.Vector3(4900, 400, 0))]);
  run(sim, 1.3);
  assert.equal(sim.lockProgress, 1);
  assert.equal(sim.launchMissile(), true);
  run(sim, 12);
  assert.equal(sim.kills, 1);
});

test('missile launch rechecks range, live membership and selected identity at the moment of launch', () => {
  for (const invalidate of [
    (sim, target) => { target.pos.x += 6000; },
    (sim, target) => { target.health = 0; },
    sim => { sim.enemies = []; },
    sim => { sim.targetId = 'another-target'; },
  ]) {
    const sim = ship();
    const [target] = stationaryTargets(sim, [sim.player.pos.clone().add(new THREE.Vector3(0, 400, 1500))]);
    run(sim, 1.3);
    assert.equal(sim.lockProgress, 1);
    const inventory = sim.player.missiles;
    invalidate(sim, target);
    assert.equal(sim.launchMissile(), false);
    assert.equal(sim.player.missiles, inventory);
    assert.equal(sim.missiles.length, 0);
  }
});

test('manual target cycling resets radar lock and preserves the selected rear target', () => {
  const sim = ship();
  const [first, second] = stationaryTargets(sim, [
    sim.player.pos.clone().add(new THREE.Vector3(0, 500, -800)),
    sim.player.pos.clone().add(new THREE.Vector3(0, 600, 1800)),
  ]);
  run(sim, 1.3);
  assert.equal(sim.lockTarget, first);
  assert.equal(sim.cycleTarget(), true);
  assert.equal(sim.targetId, second.id);
  assert.equal(sim.lockProgress, 0);
  assert.equal(sim.launchMissile(), false);
  run(sim, 1.3);
  assert.equal(sim.lockTarget, second);
  assert.equal(sim.lockProgress, 1);
});

test('enemy tracer sweeps hit the bow and bridge; a distant parallel pass misses the hull', () => {
  const sim = ship();
  const p = sim.player;
  const bow = p.pos.clone().add(new THREE.Vector3(-30, 14, -50));
  sim._addTracer(bow, new THREE.Vector3(1, 0, 0), new THREE.Vector3(2600, 0, 0), true);
  const health = p.health;
  sim._updateTracers(DT);
  assert.ok(p.health < health, 'raised superstructure at the bow is within the damage volume');
  const after = p.health;
  sim._addTracer(p.pos.clone().add(new THREE.Vector3(50, 14, -100)), new THREE.Vector3(0, 0, 1), new THREE.Vector3(), true);
  sim._updateTracers(DT);
  assert.equal(p.health, after, 'a side pass outside the beam is not treated as a spherical hull hit');
});

test('an incoming missile can strike the hull away from its centre and flares can divert another', () => {
  const sim = ship();
  const enemy = sim.enemies[0];
  sim._addMissile(enemy, true, 'player');
  const m = sim.missiles[0];
  m.pos.copy(sim.player.pos).add(new THREE.Vector3(-23, 14, -48));
  m.dir.set(1, 0, 0); m.speed = 510;
  const health = sim.player.health;
  sim._updateMissiles(DT);
  assert.ok(sim.player.health < health);
  assert.equal(sim.missiles.length, 0);
  sim._addMissile(enemy, true, 'player');
  sim.missiles[0].pos.copy(sim.player.pos).add(new THREE.Vector3(0, 400, 800));
  sim._updateThreat();
  assert.equal(sim.incoming, 1);
  assert.equal(sim.deployFlare(), true);
  assert.equal(sim.incoming, 0);
  assert.ok(sim.missiles[0].decoy);
  const flares = sim.particles.filter(particle => particle.kind === 'flare');
  assert.equal(flares.length, 7);
  assert.ok(flares.every(particle => particle.pos.y >= DESTROYER.waterline + 8 && particle.vel.y > 0));
});

test('coast collision stops the whole hull in water without aircraft-style upward recovery', () => {
  const sim = ship();
  const p = sim.player;
  p.pos.set(-2350, DESTROYER.waterline, -3700);
  p.heading = Math.PI / 2; p.speed = 18; p.throttle = 1; p.vel.set(-18, 0, 0);
  assertHullInWater(p);
  const health = p.health;
  run(sim, 10);
  assert.ok(p.health < health);
  assert.ok(p.pos.x > -2475, 'the vessel cannot cross the island shoreline');
  assert.equal(p.pos.y, DESTROYER.waterline);
  assert.equal(p.vel.y, 0);
  assertHullInWater(p);
  run(sim, 15, { yaw: 1, throttleDelta: 1 });
  assertHullInWater(p);
  assert.equal(p.pos.y, DESTROYER.waterline);
  assert.ok(p.pos.distanceTo(new THREE.Vector3(-2350, DESTROYER.waterline, -3700)) > 30,
    'the ship remains steerable after contact');
});

test('crossing the sea boundary returns a ship inward without trapping it on the rim', () => {
  const sim = ship();
  const p = sim.player;
  p.pos.set(0, DESTROYER.waterline, 10901);
  p.heading = Math.PI; p.speed = 18; p.throttle = 1; p.vel.set(0, 0, 18);
  sim.update(DT);
  assert.ok(Math.hypot(p.pos.x, p.pos.z) < 10900);
  assert.ok(p.vel.z < 0);
  const boundaryPosition = p.pos.z;
  run(sim, 2);
  assert.ok(p.pos.z < boundaryPosition - 25);
  assert.equal(p.pos.y, DESTROYER.waterline);
  assertHullInWater(p);
});

test('enemy pilots fire at a ship but retain their terrain clearance', () => {
  const sim = ship('intercept');
  const e = sim.enemies[0]; sim.enemies = [e];
  e.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 500, 1600));
  e.heading = 0; e.pitch = -0.15; e.age = 10;
  e.missileTimer = 0; e.burstCooldown = 0; e.fireTimer = 0;
  sim.update(DT);
  assert.ok(sim.drainEvents().some(event => event.type === 'missile' && event.enemy));
  assert.ok(sim.tracers.some(tracer => tracer.enemy));
  run(sim, 5);
  assert.ok(sim.player.health < DESTROYER.maxHealth - 20,
    'a real AI attack produces hull damage from both the gun burst and guided missile');
  for (let i = 0; i < 60 * 60; i++) {
    sim.player.health = DESTROYER.maxHealth;
    sim.update(DT);
    assert.equal(sim.player.pos.y, DESTROYER.waterline);
    assert.ok(e.pos.y >= Math.max(300, terrainHeight(e.pos.x, e.pos.z) + 300));
  }
});

test('a complete ship training sortie defeats all three real moving aircraft', () => {
  const sim = ship();
  for (let frame = 0; frame < 60 * 45 && sim.state === 'playing'; frame++) {
    sim.update(DT);
    if (sim.lockProgress === 1 && !sim.missiles.some(m => !m.enemy && m.targetId === sim.targetId)) sim.launchMissile();
  }
  assert.equal(sim.state, 'won');
  assert.equal(sim.kills, 3);
  assert.equal(sim.player.missiles, DESTROYER.maxMissiles - 3);
  assert.equal(sim.player.health, DESTROYER.maxHealth);
  assert.equal(sim.player.pos.y, DESTROYER.waterline);
});

test('all three intercept waves resupply the ship to its own caps and produce a victory', () => {
  const sim = ship('intercept');
  sim.player.health = 280; sim.player.ammo = 230; sim.player.missiles = 11;
  for (let wave = 1; wave <= 3; wave++) {
    assert.equal(sim.wave, wave);
    for (const e of sim.enemies) e.health = 0;
    sim.update(DT);
    if (wave < 3) {
      assert.equal(sim.player.health, DESTROYER.maxHealth);
      assert.equal(sim.player.ammo, DESTROYER.maxAmmo);
      assert.equal(sim.player.missiles, DESTROYER.maxMissiles);
      run(sim, 4.7);
    }
  }
  assert.equal(sim.kills, 9);
  assert.equal(sim.state, 'won');
  assert.equal(sim.player.pos.y, DESTROYER.waterline);
  assert.equal(sim.drainEvents().filter(event => event.type === 'result').length, 1);
});

test('ship destruction ends the mission and restart restores clean aircraft defaults', () => {
  const sim = ship('free', 'easy');
  sim._fireGun(); sim.deployFlare();
  sim._damagePlayer(DESTROYER.maxHealth);
  assert.equal(sim.state, 'lost');
  sim.start('training', 'normal');
  assert.equal(sim.vehicle, 'aircraft');
  assert.equal(sim.player.kind, 'aircraft');
  assert.equal(sim.player.maxHealth, 100);
  assert.equal(sim.player.health, 100);
  assert.equal(sim.player.ammo, 900);
  assert.equal(sim.player.missiles, 6);
  assert.equal(sim.player.pos.y, 1100);
  assert.equal(sim.player.speed, 185);
  assert.equal(sim.player.turretHeading, undefined);
  assert.equal(sim.tracers.length, 0);
  assert.equal(sim.particles.length, 0);
  assert.equal(sim.missiles.length, 0);
  run(sim, 1, { pitch: 0.5 });
  assert.ok(sim.player.pos.y > 1110);
  sim.start('training', 'easy', 'destroyer');
  assert.equal(sim.player.flares, 8);
  assert.equal(sim.player.speed, 0);
  sim.start('training', 'normal', 'invalid-vehicle');
  assert.equal(sim.vehicle, 'aircraft');
});
