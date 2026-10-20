import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import { normalizeWorkshop, presetLoadout } from '../aircraft-systems.js';
import * as THREE from '../vendor/three.module.js';

const DT = 1 / 60;
function run(sim, seconds, input = {}) {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) sim.update(DT, input);
}
function sightTarget(sim, range = 850) {
  const target = sim.enemies[0];
  sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -range));
  target.heading = sim.player.heading = 0;
  target.pitch = sim.player.pitch = 0;
  target.phase = 0;
  target.passive = true;
  target.health = target.maxHealth = 100;
  target.vel.set(0, 0, -target.speed);
  return target;
}

test('a fresh intercept exposes usable state and reachable targets', () => {
  const sim = new Simulation();
  assert.equal(sim.state, 'menu');
  sim.start();
  assert.equal(sim.state, 'playing');
  assert.equal(sim.wave, 1);
  assert.equal(sim.enemies.length, 2);
  assert.equal(sim.player.health, 200);
  assert.ok(sim.enemies.every(e => e.pos.distanceTo(sim.player.pos) >= 3800 && e.pos.distanceTo(sim.player.pos) < 5500));
  assert.ok(sim.drainEvents().some(e => e.type === 'wave'));
  assert.equal(sim.drainEvents().length, 0);
});

test('controls have inertia, bank induces a left turn, pitch produces a climb', () => {
  const sim = new Simulation();
  sim.start('training');
  const initial = sim.player.pos.clone();
  run(sim, 1.2, { roll: 0.6, pitch: 0.3, throttleDelta: 0.4 });
  assert.ok(sim.player.pos.z < initial.z - 150);
  assert.ok(sim.player.pos.y > initial.y + 6);
  assert.ok(sim.player.bank > 0.5);
  assert.ok(sim.player.heading > 0.015);
  assert.ok(sim.player.g > 1.5);
  assert.ok(sim.player.throttle > 0.99);
  const rate = sim.player.rollRate;
  sim.update(DT, { roll: -1 });
  assert.ok(sim.player.rollRate > 0, 'reversing stick does not instantly reverse roll velocity');
  assert.ok(sim.player.rollRate < rate);
});

test('pulling the stick pitches up upright and towards the ground when inverted', () => {
  const upright = new Simulation(), inverted = new Simulation();
  const clean=normalizeWorkshop(null);clean.loadouts.fa18c=presetLoadout('clean');upright.configureAircraft(clean);inverted.configureAircraft(clean);
  upright.start('training'); inverted.start('training');
  inverted.player.bank = Math.PI;
  run(upright, 1.2, { pitch: 0.65 });
  run(inverted, 1.2, { pitch: 0.65 });
  assert.ok(upright.player.pitch > 0.3);
  assert.ok(inverted.player.pitch < -0.3);
  assert.ok(upright.player.pos.y > 1120);
  assert.ok(inverted.player.pos.y < 1080);
  assert.ok(Math.abs(inverted.player.heading) < 0.005, 'inverted pull is primarily pitch, not an arbitrary turn');
});

test('pulling with a bank tightens the turn towards the lower wing', () => {
  for (const sign of [-1, 1]) {
    const neutral = new Simulation(), pulling = new Simulation();
    neutral.start('training'); pulling.start('training');
    neutral.player.bank = pulling.player.bank = sign * Math.PI / 3;
    run(neutral, 1.2);
    run(pulling, 1.2, { pitch: 0.65 });
    assert.ok(sign * pulling.player.heading > sign * neutral.player.heading + 0.12,
      'banked pull adds turn rate in the bank direction');
    assert.ok(pulling.player.pitch > 0.1 && pulling.player.pitch < 0.28,
      'a banked elevator input splits between climb and turn');
    assert.ok(pulling.player.g > neutral.player.g, 'tightening the turn increases felt normal load');
  }
});

test('airbrake bleeds energy; low speed warns and descends instead of hovering', () => {
  const sim = new Simulation();
  sim.start('training');
  const initial = sim.player.speed;
  run(sim, 2, { airbrake: true, throttleDelta: -0.5 });
  assert.ok(sim.player.speed < initial - 30);
  sim.player.speed = 65;
  sim.player.throttle = 0.12;
  const altitude = sim.player.pos.y;
  run(sim, 1, { airbrake: true });
  assert.ok(sim.player.stall > 0.5);
  assert.ok(sim.player.pos.y < altitude - 20);
  assert.match(sim.player.warning, /失速/);
});

test('pause freezes physics, AI, weapons and mission clock', () => {
  const sim = new Simulation();
  sim.start();
  run(sim, 0.2, { fire: true });
  sim.state = 'paused';
  const before = JSON.stringify({ player: sim.player, enemies: sim.enemies, tracers: sim.tracers, time: sim.time });
  run(sim, 5, { fire: true, boost: true, pitch: 1 });
  assert.equal(sim.launchMissile(), false);
  assert.equal(sim.deployFlare(), false);
  assert.equal(JSON.stringify({ player: sim.player, enemies: sim.enemies, tracers: sim.tracers, time: sim.time }), before);
  sim.state = 'playing';
  sim.update(DT);
  assert.ok(sim.time > 0.2);
});

test('a missile requires continuous lock, consumes inventory and intercepts its target', () => {
  const sim = new Simulation();
  sim.start('training');
  const target = sightTarget(sim);
  const inventory = sim.player.missiles;
  assert.equal(sim.launchMissile(), false);
  assert.equal(sim.player.missiles, inventory);
  run(sim, 0.6);
  assert.ok(sim.lockProgress > 0.4 && sim.lockProgress < 0.6);
  assert.equal(sim.launchMissile(), false);
  run(sim, 0.7);
  assert.equal(sim.lockProgress, 1);
  assert.equal(sim.lockTarget, target);
  assert.equal(sim.launchMissile(), true);
  assert.equal(sim.player.missiles, inventory - 1);
  assert.equal(sim.launchMissile(), false, 'launch cooldown prevents repeated tap spam');
  run(sim, 4);
  assert.equal(sim.kills, 1);
  assert.equal(sim.state, 'won');
  assert.ok(sim.drainEvents().some(e => e.type === 'hit' && e.missile));
});

test('losing line of sight decays the lock and blocks a stale lock launch', () => {
  const sim = new Simulation();
  sim.start('training');
  sightTarget(sim);
  run(sim, 1.4);
  assert.equal(sim.lockProgress, 1);
  sim.player.heading = 1;
  assert.equal(sim.launchMissile(), false, 'alignment is checked at launch, not only last frame');
  run(sim, 0.5);
  assert.equal(sim.lockProgress, 0);
  assert.equal(sim.lockTarget, null);
});

test('swept cannon impacts damage a moving aircraft and award one kill', () => {
  const sim = new Simulation();
  sim.start('training');
  sightTarget(sim, 450);
  run(sim, 2.5, { fire: true });
  assert.equal(sim.kills, 1);
  assert.ok(sim.hits >= 5);
  assert.ok(sim.shots >= sim.hits);
  const points = sim.score;
  run(sim, 3, { fire: true });
  assert.equal(sim.kills, 1);
  assert.equal(sim.score, points);
});

test('sustained cannon fire overheats, releasing fire cools and permits shooting again', () => {
  const sim = new Simulation();
  sim.start('free');
  for (const e of sim.enemies) e.pos.x += 2000;
  run(sim, 3, { fire: true });
  assert.equal(sim.player.overheated, true);
  const shots = sim.shots;
  run(sim, 3);
  assert.equal(sim.player.overheated, false);
  assert.ok(sim.player.heat < 0.32);
  run(sim, 0.15, { fire: true });
  assert.ok(sim.shots > shots);
});

test('AI incoming missile is telegraphed and one flare burst breaks its homing', () => {
  const sim = new Simulation();
  sim.start('intercept');
  const enemy = sim.enemies[0];
  sim.enemies = [enemy];
  enemy.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, 1000));
  enemy.heading = 0;
  enemy.pitch = 0;
  enemy.age = 10;
  enemy.missileTimer = 0;
  enemy.burstCooldown = 100;
  sim.update(DT);
  assert.equal(sim.incoming, 1);
  assert.equal(sim.threat, 1);
  assert.ok(sim.drainEvents().some(e => e.type === 'missile' && e.enemy));
  const inventory = sim.player.flares;
  assert.equal(sim.deployFlare(), true);
  assert.equal(sim.player.flares, inventory - 1);
  assert.equal(sim.incoming, 0);
  assert.ok(sim.missiles[0].decoy);
  assert.equal(sim.deployFlare(), false);
  run(sim, 3.2);
  assert.equal(sim.player.health, 200);
  assert.ok(sim.missiles.every(m => !m.enemy));
});

test('intercept has three waves, resupplies between them and ends after nine kills', () => {
  const sim = new Simulation();
  sim.start('intercept');
  sim.player.health = 40;
  sim.player.ammo = 100;
  sim.player.missiles = 0; for(const slot of sim.player.stores)if(['aim9','aim7','aim120'].includes(slot.store))slot.count=0;
  for (let wave = 1; wave <= 3; wave++) {
    assert.equal(sim.wave, wave);
    assert.equal(sim.enemies.length, wave + 1);
    for (const e of sim.enemies) e.health = 0;
    sim.update(DT);
    if (wave < 3) {
      assert.equal(sim.state, 'playing');
      if (wave === 1) {
        assert.equal(sim.player.health, 75);
        assert.equal(sim.player.ammo, 420);
        assert.equal(sim.player.missiles, 3);
      }
      run(sim, 4.7);
    }
  }
  assert.equal(sim.state, 'won');
  assert.equal(sim.kills, 9);
  assert.ok(sim.score > 1800);
  const results = sim.drainEvents().filter(e => e.type === 'result');
  assert.equal(results.length, 1);
  assert.equal(results[0].won, true);
});

test('terrain impact is recoverable; repeated damage eventually ends the sortie', () => {
  const sim = new Simulation();
  sim.start('training');
  sim.player.pos.set(0, 1, 0);
  sim.player.pitch = -0.8;
  sim.player.vel.set(0, -100, -150);
  sim.update(DT);
  assert.equal(sim.state, 'playing');
  assert.equal(sim.player.health, 165);
  assert.ok(sim.player.pos.y >= 30);
  sim.update(DT);
  assert.equal(sim.player.health, 165, 'one collision does not damage again on the next frame');
  for (let i = 0; i < 5; i++) {
    run(sim, 2.5);
    sim.player.pos.y = 1;
    sim.player.vel.y = -100;
    sim.update(DT);
  }
  assert.equal(sim.player.health, 0);
  assert.equal(sim.state, 'lost');
  assert.ok(sim.drainEvents().some(e => e.type === 'result' && !e.won));
});

test('restarting clears prior combat state and restores consumables', () => {
  const sim = new Simulation();
  sim.start();
  run(sim, 1, { fire: true });
  sim.deployFlare();
  sim.start('training', 'easy');
  assert.equal(sim.time, 0);
  assert.equal(sim.shots, 0);
  assert.equal(sim.kills, 0);
  assert.equal(sim.player.ammo, 578);
  assert.equal(sim.player.flares, 8);
  assert.equal(sim.tracers.length, 0);
  assert.equal(sim.particles.length, 0);
  assert.equal(sim.missiles.length, 0);
  assert.equal(sim.enemies.length, 3);
});

test('training targets remain harmless even with a direct firing solution', () => {
  const sim = new Simulation();
  sim.start('training');
  const target = sim.enemies[0];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, 500));
  target.heading = 0;
  target.missileTimer = 0;
  target.burstCooldown = 0;
  run(sim, 20);
  assert.equal(sim.player.health, 200);
  assert.equal(sim.incoming, 0);
  assert.equal(sim.threat, 0);
  assert.ok(sim.tracers.every(t => !t.enemy));
});

test('long sessions keep transient pools bounded and all flight values finite', () => {
  const sim = new Simulation(42);
  sim.start('free', 'easy');
  for (let i = 0; i < 120 * 60; i++) {
    sim.player.health = 100;
    sim.player.ammo = 900;
    if (i % 150 === 0) { sim.player.flares = 6; sim.deployFlare(); }
    if (i % 240 === 0 && sim.lockProgress === 1) sim.launchMissile();
    sim.update(DT, { fire: i % 160 < 80, roll: Math.sin(i / 140) * 0.3, pitch: Math.sin(i / 180) * 0.06, boost: i % 600 < 100 });
    assert.ok(sim.tracers.length <= 140);
    assert.ok(sim.particles.length <= 220);
    assert.ok(sim.missiles.length <= 24);
    assert.ok(sim.enemies.length <= 6);
    assert.ok(Number.isFinite(sim.player.pos.x + sim.player.pos.y + sim.player.pos.z + sim.player.speed + sim.player.g));
  }
  assert.equal(sim.state, 'playing');
  assert.ok(sim.drainEvents().length <= 100);
});

test('identical fixed steps and seed produce identical simulation results', () => {
  const a = new Simulation(35), b = new Simulation(35);
  a.start(); b.start();
  run(a, 8, { roll: 0.1, pitch: 0.04, fire: true });
  run(b, 8, { roll: 0.1, pitch: 0.04, fire: true });
  assert.deepEqual(a.player, b.player);
  assert.deepEqual(a.enemies, b.enemies);
  assert.equal(a.score, b.score);
});
