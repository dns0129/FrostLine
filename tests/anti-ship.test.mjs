import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DESTROYER } from '../simulation.js';
import { makeDestroyer } from '../destroyer.js';
import * as THREE from '../vendor/three.module.js';

const DT = 1 / 60;
function naval(mode = 'naval-training', difficulty = 'normal') {
  const sim = new Simulation(7331); sim.start(mode, difficulty);
  return sim;
}
function run(sim, seconds, input = {}) {
  for (let frame = 0; frame < Math.ceil(seconds / DT); frame++) sim.update(DT, input);
}
function holdShips(sim, targets = sim.enemies) {
  sim.enemies = targets;
  sim._updateEnemies = dt => { for (const e of sim.enemies) if (e.health > 0) e.pos.addScaledVector(e.vel, dt); };
}
function lock(sim) { run(sim, 1.6); assert.equal(sim.antiShipLockProgress, 1); }

test('destroyers carry six surface missiles and the standard multirole aircraft carries two', () => {
  for (const mode of ['naval', 'naval-training', 'intercept', 'training', 'free']) {
    const sim = new Simulation(); sim.start(mode, 'normal', 'destroyer');
    assert.equal(sim.player.antiShipMissiles, 6); assert.equal(DESTROYER.maxAntiShipMissiles, 6);
    assert.equal(sim.antiShipLockProgress, 0); assert.equal(sim.antiShipLockTarget, null); assert.equal(sim.antiShipTargetId, null);
    assert.equal(sim.antiShipCooldown, 0); assert.equal(sim.missileCooldown, 0);
  }
  const aircraft = new Simulation(); aircraft.start('training');
  assert.equal(aircraft.player.antiShipMissiles, 2);
  assert.equal(aircraft.launchAntiShipMissile(), false);
  assert.equal(aircraft.missiles.length, 0);
});

test('surface radar needs 1.5 continuous seconds and a launch consumes only surface stock', () => {
  const sim = naval();
  assert.equal(sim.launchAntiShipMissile(), false);
  run(sim, 0.7);
  assert.ok(sim.antiShipLockProgress > 0.45 && sim.antiShipLockProgress < 0.48);
  assert.equal(sim.antiShipLockTarget, sim.enemies[0]);
  assert.equal(sim.antiShipTargetId, sim.targetId);
  assert.equal(sim.launchAntiShipMissile(), false);
  run(sim, 0.9);
  assert.equal(sim.antiShipLockProgress, 1);
  assert.equal(sim.lockProgress, 0); assert.equal(sim.lockTarget, null);
  assert.equal(sim.launchAntiShipMissile(), true);
  assert.equal(sim.player.antiShipMissiles, 5); assert.equal(sim.player.missiles, 12); assert.equal(sim.player.ammo, 240);
  assert.equal(sim.antiShipCooldown, 1.4); assert.equal(sim.missileCooldown, 0);
  assert.equal(sim.launchAntiShipMissile(), false);
  const m = sim.missiles[0];
  assert.equal(m.kind, 'anti-ship'); assert.equal(m.weapon, 'anti-ship'); assert.equal(m.enemy, false);
  assert.equal(m.targetId, sim.targetId); assert.equal(m.dir.y, 1); assert.equal(m.pitch, Math.PI / 2);
  assert.equal(m.maxLife, 30); assert.equal(m.damage, 238);
  assert.ok(sim.drainEvents().some(event => event.type === 'missile' && event.weapon === 'anti-ship'));
});

test('ASm launch follows the rotated forward VLS hatch and clears the real ship superstructure', () => {
  for (const heading of [-1.8, 0, 1.1]) {
    const sim = naval(); sim.player.heading = heading;
    sim._addAntiShipMissile(sim.enemies[0]); const m = sim.missiles[0];
    const [x, y, z] = DESTROYER.antiShipLaunch;
    const expected = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(sim.player.pos);
    assert.ok(m.pos.distanceTo(expected) < 1e-10);
    assert.ok(y > 5.23, 'the warhead starts above the VLS hatch lid');
    const model = makeDestroyer(); model.position.copy(sim.player.pos); model.rotation.y = heading;
    model.userData.update(0, sim.player); model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(m.pos, new THREE.Vector3(0, 1, 0), 0, 60);
    assert.equal(ray.intersectObject(model, true).length, 0, 'vertical departure never passes through the bridge roof');
    model.userData.dispose();
  }
});

test('manual cycling resets both lock channels and the new vessel starts its own timer', () => {
  const sim = naval(); lock(sim);
  const first = sim.antiShipTargetId;
  assert.equal(sim.cycleTarget(), true);
  assert.notEqual(sim.targetId, first); assert.equal(sim.antiShipLockProgress, 0);
  assert.equal(sim.antiShipLockTarget, null); assert.equal(sim.antiShipTargetId, null);
  assert.equal(sim.lockProgress, 0); assert.equal(sim.launchAntiShipMissile(), false);
  run(sim, 0.8);
  assert.ok(sim.antiShipLockProgress > 0.5 && sim.antiShipLockProgress < 0.55);
  assert.equal(sim.launchAntiShipMissile(), false);
  run(sim, 0.8);
  assert.equal(sim.launchAntiShipMissile(), true);
  assert.equal(sim.missiles[0].targetId, sim.enemies[1].id);
});

test('SAM and ASm type selection, inventory and cooldowns remain independent', () => {
  const surface = naval(), air = new Simulation(); air.start('training');
  const plane = air.enemies[0]; plane.id = 'mixed-aircraft'; plane.pos.set(0, 600, 2800); plane.vel.set(0, 0, 0);
  const boat = surface.enemies[0]; holdShips(surface, [boat, plane]);
  surface.targetId = plane.id; surface._updateLock(1.3); surface._updateAntiShipLock(1.6);
  assert.equal(surface.lockProgress, 1); assert.equal(surface.antiShipLockProgress, 0);
  assert.equal(surface.launchAntiShipMissile(), false); assert.equal(surface.player.antiShipMissiles, 6);
  assert.ok(surface.drainEvents().some(event => event.type === 'toast' && /反舰只对海/.test(event.text)));
  assert.equal(surface.launchMissile(), true);
  assert.equal(surface.missileCooldown, 0.75); assert.equal(surface.player.missiles, 11);
  surface.cycleTarget(); surface._updateLock(1.6); surface._updateAntiShipLock(1.6);
  assert.equal(surface.antiShipLockProgress, 1); assert.equal(surface.lockProgress, 0);
  assert.equal(surface.launchAntiShipMissile(), true, 'SAM cooldown does not delay the separate surface launcher');
  assert.equal(surface.player.antiShipMissiles, 5); assert.equal(surface.missileCooldown, 0.75);
  assert.equal(surface.launchMissile(), false);
  surface._missileTimer = 0; surface.targetId = plane.id;
  surface._updateLock(1.3); surface._updateAntiShipLock(1.6);
  assert.equal(surface.launchMissile(), true, 'ASm cooldown does not delay the separate air launcher');
  assert.equal(surface.antiShipCooldown, 1.4);
});

test('cooldown getters freeze while paused, decay independently and reset on restart', () => {
  const sim = naval(); lock(sim); assert.equal(sim.launchAntiShipMissile(), true);
  sim._missileTimer = 0.75;
  sim.state = 'paused'; run(sim, 5);
  assert.equal(sim.antiShipCooldown, 1.4); assert.equal(sim.missileCooldown, 0.75);
  assert.equal(sim.launchAntiShipMissile(), false);
  sim.state = 'playing'; run(sim, 0.5);
  assert.ok(sim.antiShipCooldown > 0.88 && sim.antiShipCooldown < 0.92);
  assert.ok(sim.missileCooldown > 0.23 && sim.missileCooldown < 0.27);
  sim.start('naval-training');
  assert.equal(sim.antiShipCooldown, 0); assert.equal(sim.missileCooldown, 0);
  assert.equal(sim.player.antiShipMissiles, 6); assert.equal(sim.antiShipLockProgress, 0);
});

test('out-of-range and stale surface contacts lose all lock immediately', () => {
  for (const invalidate of [
    (sim, target) => { target.pos.z = sim.player.pos.z + 5501; },
    (sim, target) => { target.health = 0; },
    (sim, target) => { target.kind = 'aircraft'; },
    sim => { sim.targetId = sim.enemies[1].id; },
    (sim, target) => { sim.enemies = sim.enemies.filter(e => e !== target); },
    (sim, target) => { sim.enemies = sim.enemies.map(e => e === target ? { ...target } : e); },
  ]) {
    const sim = naval(); lock(sim); const target = sim.antiShipLockTarget;
    invalidate(sim, target); sim._updateAntiShipLock(DT);
    if (sim.antiShipLockTarget) assert.ok(sim.antiShipLockProgress <= DT / 1.5 + 1e-12);
    else assert.equal(sim.antiShipLockProgress, 0);
    assert.notEqual(sim.antiShipLockTarget, target);
    assert.equal(sim.launchAntiShipMissile(), false); assert.equal(sim.player.antiShipMissiles, 6);
  }
});

test('launch revalidates identity, kind, distance, live membership and progress before using stock', () => {
  for (const invalidate of [
    (sim, target) => { target.pos.z = sim.player.pos.z + 5501; },
    (sim, target) => { target.health = 0; },
    (sim, target) => { target.kind = 'aircraft'; },
    sim => { sim.targetId = sim.enemies[1].id; },
    (sim, target) => { target.id = 'changed-id'; },
    sim => { sim.enemies = []; },
    sim => { sim.antiShipTargetId = 'different-lock'; },
    sim => { sim.antiShipLockProgress = 0.99; },
  ]) {
    const sim = naval(); lock(sim);
    invalidate(sim, sim.antiShipLockTarget);
    assert.equal(sim.launchAntiShipMissile(), false);
    assert.equal(sim.player.antiShipMissiles, 6); assert.equal(sim.missiles.length, 0);
  }
});

test('an island blocks acquisition and a newly blocked full lock cannot launch', () => {
  const sim = naval(); const target = sim.enemies[0]; holdShips(sim, [target]);
  sim.player.pos.set(-2350, 0.5, -3700); sim._lastShipWater.pos.copy(sim.player.pos);
  target.pos.set(-7400, 0.5, -3700);
  assert.ok(target.pos.distanceTo(sim.player.pos) < 5500);
  run(sim, 2);
  assert.equal(sim.antiShipLockProgress, 0); assert.equal(sim.antiShipLockTarget, null);
  assert.equal(sim.launchAntiShipMissile(), false);
  target.pos.set(-2000, 0.5, -3700); lock(sim);
  target.pos.set(-7400, 0.5, -3700);
  assert.equal(sim.launchAntiShipMissile(), false, 'LOS is tested at launch rather than trusting the preceding frame');
  assert.equal(sim.antiShipLockProgress, 0); assert.equal(sim.player.antiShipMissiles, 6);
});

test('physical sea-skimming guidance cannot fly through an island after launch', () => {
  const sim = naval(); const target = sim.enemies[0]; holdShips(sim, [target]);
  target.pos.set(-7400, 0.5, -3700);
  sim._addAntiShipMissile(target);
  const m = sim.missiles[0]; m.pos.set(-2440, 15, -3700); m.dir.set(-1, 0, 0); m.speed = 280; m.verticalLaunch = 0;
  const health = target.health;
  run(sim, 0.6);
  assert.equal(sim.missiles.length, 0); assert.equal(target.health, health);
  assert.ok(sim.particles.length > 0);
  assert.ok(!sim.drainEvents().some(event => event.type === 'hit' && event.weapon === 'anti-ship'));
});

test('VLS turns smoothly into fifteen-metre cruise and reaches a rear target near maximum range', () => {
  const sim = naval(); const target = sim.enemies[0]; holdShips(sim, [target]);
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, 5400));
  lock(sim); assert.equal(sim.launchAntiShipMissile(), true);
  const m = sim.missiles[0]; run(sim, 0.1);
  assert.equal(m.dir.y, 1); assert.ok(m.pos.y > 12);
  let checkedCruise = false;
  for (let frame = 0; frame < 27 * 60 && sim.state === 'playing'; frame++) {
    const previous = m.pos.clone(); sim.update(DT);
    assert.ok(Number.isFinite(m.pos.length() + m.dir.length() + m.heading + m.pitch + m.speed));
    assert.ok(Math.abs(m.pos.y - previous.y) <= m.speed * DT + 1e-6, 'height changes arise from the flight vector rather than teleportation');
    assert.ok(Math.abs(m.dir.length() - 1) < 1e-8);
    if (frame === 5 * 60) { assert.ok(m.pos.y >= 12 && m.pos.y <= 18); checkedCruise = true; }
  }
  assert.ok(checkedCruise); assert.equal(target.health, target.maxHealth - 238);
  assert.equal(sim.launchAntiShipMissile(), true); run(sim, 28);
  assert.equal(sim.kills, 1); assert.equal(sim.state, 'won');
  assert.ok(sim.time < 60); assert.equal(sim.player.missiles, 12);
});

test('sideways moving and receding rear surface targets are intercepted from all-around radar contacts', () => {
  for (const [position, velocity, heading] of [
    [new THREE.Vector3(2500, 0, 0), new THREE.Vector3(-10, 0, 0), Math.PI / 2],
    [new THREE.Vector3(0, 0, 5300), new THREE.Vector3(0, 0, 12), Math.PI],
  ]) {
    const sim = naval(); const target = sim.enemies[1]; holdShips(sim, [target]);
    sim.targetId = target.id; target.pos.copy(sim.player.pos).add(position); target.vel.copy(velocity);
    target.speed = velocity.length(); target.heading = heading; target.turretHeading = heading;
    lock(sim); assert.equal(sim.launchAntiShipMissile(), true);
    run(sim, 1.6); assert.equal(sim.launchAntiShipMissile(), true); run(sim, 28);
    assert.equal(sim.kills, 1); assert.equal(sim.state, 'won');
    assert.ok(sim.drainEvents().some(event => event.type === 'hit' && event.damage === 238 && event.weapon === 'anti-ship'));
  }
});

test('the first maritime hull physically struck blocks an ASm without changing its guidance target', () => {
  const sim = naval(); const selected = sim.enemies[0], blocker = sim.enemies[1]; holdShips(sim);
  selected.pos.set(0, 0.5, 1000); blocker.pos.set(0, 0.5, 2400);
  lock(sim); assert.equal(sim.launchAntiShipMissile(), true); const m = sim.missiles[0];
  run(sim, 12);
  assert.equal(selected.health, selected.maxHealth); assert.equal(blocker.health, blocker.maxHealth - 238);
  assert.equal(m.targetId, selected.id, 'a physical collision does not silently switch the selected attack target');
  assert.equal(sim.kills, 0); assert.equal(sim.missiles.length, 0);
});

test('a vanished or dead target ends its missile and cannot redirect it to another vessel', () => {
  for (const remove of [
    (sim, target) => { target.health = 0; },
    (sim, target) => { sim.enemies = sim.enemies.filter(e => e !== target); },
    (sim, target) => { target.kind = 'aircraft'; },
  ]) {
    const sim = naval(); lock(sim); const target = sim.enemies[0], other = sim.enemies[1];
    assert.equal(sim.launchAntiShipMissile(), true); const m = sim.missiles[0];
    remove(sim, target); run(sim, 8);
    assert.equal(sim.missiles.length, 0); assert.equal(other.health, other.maxHealth);
    assert.equal(m.targetId, target.id);
    assert.ok(!sim.drainEvents().some(event => event.type === 'hit' && event.weapon === 'anti-ship'));
  }
});

test('free surface reserve remains usable after mounted stock reaches zero without spending SAM stock', () => {
  const sim = naval(); lock(sim); sim.player.antiShipMissiles = 0;
  const wallet = {...sim.wallet};
  assert.equal(sim.launchAntiShipMissile(), true); assert.equal(sim.player.missiles, 12);
  assert.equal(sim.player.antiShipMissiles, 0); assert.deepEqual(sim.wallet, wallet);
  assert.equal(sim.missiles.length, 1);
});

test('all three real naval waves can be completed with ASm and replenish three up to six', () => {
  const sim = naval('naval', 'easy');
  for (let frame = 0; frame < 90 * 60 && sim.state === 'playing'; frame++) {
    sim.update(DT);
    if (sim.antiShipLockProgress === 1 && !sim.missiles.some(m => m.weapon === 'anti-ship' && m.targetId === sim.targetId)) {
      if (sim.launchAntiShipMissile()) sim.cycleTarget();
    }
    assert.ok(sim.player.antiShipMissiles >= 0 && sim.player.antiShipMissiles <= 6);
  }
  assert.equal(sim.state, 'won'); assert.equal(sim.kills, 9); assert.equal(sim.wave, 3);
  assert.equal(sim.player.antiShipMissiles, 0); assert.equal(sim.player.missiles, 12); assert.equal(sim.player.ammo, 240);
  assert.ok(sim.player.health > 0); assert.ok(sim.score > 2000);
});

test('surface resupply uses its own cap and restarting into aircraft restores its configured surface inventory', () => {
  const sim = naval('naval'); sim.player.antiShipMissiles = 1; sim.player.missiles = 0;
  sim.enemies.forEach(e => { e.health = 0; }); sim.update(DT);
  assert.equal(sim.player.antiShipMissiles, 4); assert.equal(sim.player.missiles, 6);
  run(sim, 4.7); sim.player.antiShipMissiles = 5; sim.enemies.forEach(e => { e.health = 0; }); sim.update(DT);
  assert.equal(sim.player.antiShipMissiles, 6);
  sim.start('training');
  assert.equal(sim.player.antiShipMissiles, 2); assert.equal(sim.antiShipLockProgress, 0);
  assert.equal(sim.antiShipLockTarget, null); assert.equal(sim.antiShipTargetId, null);
  assert.equal(sim.antiShipCooldown, 0); assert.equal(sim.launchAntiShipMissile(), false);
  assert.equal(sim.missiles.length, 0);
});

test('empty mounted inventories remain playable with the free reserve for each compatible weapon', () => {
  const sim = naval(); sim.player.ammo = 0;
  run(sim, 2); assert.equal(sim.state, 'playing');
  assert.equal(sim.player.antiShipMissiles, 6); assert.equal(sim.launchAntiShipMissile(), true);
  run(sim, 5); assert.equal(sim.kills, 0); assert.ok(sim.enemies[0].health < sim.enemies[0].maxHealth); assert.equal(sim.state, 'playing');
  sim.player.antiShipMissiles = 0; sim.update(DT);
  assert.equal(sim.state, 'playing'); assert.equal(sim.endReason, '');
  assert.equal(sim.launchAntiShipMissile(), true); sim._fireGun();
  assert.equal(sim.player.missiles, 12); assert.equal(sim.player.health, 600); assert.equal(sim.player.ammo, 0);
});

test('the final in-flight ASm postpones failure and can win or clear a wave for resupply', () => {
  for (const mode of ['naval-training', 'naval']) {
    const sim = naval(mode); const target = sim.enemies[0]; sim.enemies = [target];
    target.passive = true; target.speed = 0; target.vel.set(0, 0, 0); target.health = 238;
    sim.player.ammo = 0; sim.player.antiShipMissiles = 1;
    lock(sim); assert.equal(sim.launchAntiShipMissile(), true);
    assert.equal(sim.player.antiShipMissiles, 0);
    run(sim, 0.5); assert.equal(sim.state, 'playing');
    run(sim, 5); assert.equal(sim.kills, 1);
    if (mode === 'naval-training') assert.equal(sim.state, 'won');
    else { assert.equal(sim.state, 'playing'); assert.equal(sim.player.antiShipMissiles, 3); assert.equal(sim.player.ammo, 100); }
    assert.equal(sim.endReason, '');
  }
});

test('expired missiles of either class cannot inflict damage on their last frame', () => {
  const sim = naval(); const ship = sim.enemies[0];
  sim._addAntiShipMissile(ship); const asm = sim.missiles[0];
  asm.life = 0.001; asm.pos.copy(ship.pos).add(new THREE.Vector3(0, 4, 0));
  const health = ship.health; sim._updateMissiles(DT);
  assert.equal(ship.health, health); assert.equal(sim.missiles.length, 0);
  sim.start('training'); const plane = sim.enemies[0];
  sim._addMissile(sim.player, false, plane.id); const sam = sim.missiles[0];
  sam.life = 0.001; sam.pos.copy(plane.pos).add(new THREE.Vector3(0, 0, 32)); sam.dir.set(0, 0, -1); sam.speed = 500;
  const planeHealth = plane.health; sim._updateMissiles(DT);
  assert.equal(plane.health, planeHealth); assert.equal(sim.missiles.length, 0);
});
