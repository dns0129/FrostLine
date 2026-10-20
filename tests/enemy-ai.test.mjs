import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { AI_PROFILES, AIR_SPAWN_MIN, airSpawnPosition, aiProfile, flightPlan } from '../enemy-ai.js';
import { Simulation } from '../simulation.js';
import { MAPS } from '../maps.js';
import { getActiveMap, setActiveMap, terrainHeight } from '../world-math.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const target = { pos: vector(0, 1100, 0), vel: vector(120, 0, 0), kind: 'aircraft', heading: 0 };
const enemy = () => ({ pos: vector(0, 1100, 3000), vel: vector(0, 0, -180), kind: 'aircraft', heading: 0,
  role: 1, age: 15, arrivalGrace: 4, extendTime: 0, phase: 0 });

test('all maps, near-edge positions and later waves retain distant aircraft entry points above shared terrain', () => {
  const previous = getActiveMap().id;
  try {
    for (const map of MAPS) {
      setActiveMap(map.id);
      for (const [x, z] of [[0, 4000], [10800, 0], [-10800, 0], [0, -10800], [0, 10800]]) {
        const player = { pos: vector(x, 1100, z), heading: Math.atan2(x, z), kind: 'aircraft' };
        for (let index = 0; index < 32; index++) {
          const pos = airSpawnPosition(player, index, 10, () => .5, terrainHeight);
          assert.ok(Math.hypot(pos.x - x, pos.z - z) >= AIR_SPAWN_MIN - 1e-6);
          assert.ok(Math.hypot(pos.x, pos.z) <= 10200 + 1e-6);
          assert.ok(pos.y >= terrainHeight(pos.x, pos.z) + 500);
        }
      }
    }
  } finally { setActiveMap(previous); }
});

test('difficulty changes tactics from pursuit to flanking, prediction, evasion and finite IR countermeasures', () => {
  const plan = (difficulty, incoming = null) => flightPlan(enemy(), target, { profile: aiProfile(difficulty), incoming, terrainHeight: () => -30 });
  const easy = plan('easy'), hard = plan('hard'); assert.equal(easy.mode, 'intercept'); assert.equal(hard.mode, 'flank');
  assert.notEqual(easy.heading, hard.heading); assert.ok(hard.speed > easy.speed);
  const incoming = { dir: vector(0, 0, 1) };
  assert.notEqual(plan('easy', incoming).mode, 'evade'); assert.equal(plan('normal', incoming).mode, 'evade');
  assert.equal(plan('hard', incoming).weaponsAllowed, false);
  assert.ok(AI_PROFILES.hard.reaction < AI_PROFILES.easy.reaction); assert.ok(AI_PROFILES.hard.flares > AI_PROFILES.normal.flares);
  assert.equal(aiProfile('hard', 1), AI_PROFILES.easy); assert.equal(aiProfile('easy', 4), AI_PROFILES.normal); assert.equal(aiProfile('easy', 8), AI_PROFILES.hard);
  assert.equal(aiProfile('__proto__'), AI_PROFILES.normal);
});

test('arrival grace forbids attacks and breakaway, boundary return and forward terrain avoidance produce flight commands', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const e = enemy(), context = { profile: aiProfile(difficulty), terrainHeight: () => -30 };
    e.age = 3.9; assert.equal(flightPlan(e, target, context).weaponsAllowed, false);
    e.age = 10; assert.equal(flightPlan(e, target, context).weaponsAllowed, true);
    e.extendTime = 3; assert.equal(flightPlan(e, target, context).mode, 'extend'); assert.equal(flightPlan(e, target, context).weaponsAllowed, false);
    e.pos.x = 10200; assert.equal(flightPlan(e, target, context).mode, 'return');
    e.pos.x = 0; e.extendTime = 0;
    assert.ok(flightPlan(e, target, { ...context, terrainHeight: () => 1000 }).pitch >= .42);
  }
});

test('actual new waves remain distant and living aircraft turn back from the edge without horizontal teleports', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const sim = new Simulation(7331); sim.start('intercept', difficulty);
    assert.ok(sim.enemies.every(e => Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z) >= AIR_SPAWN_MIN - 1e-6));
    sim.enemies = []; sim.player.pos.set(10500, 2000, 0); sim._spawnWave();
    assert.ok(sim.enemies.every(e => Math.hypot(e.pos.x - sim.player.pos.x, e.pos.z - sim.player.pos.z) >= AIR_SPAWN_MIN - 1e-6));
    const e = sim.enemies[0]; sim.enemies = [e]; e.pos.set(10200, 2200, 0); e.heading = -Math.PI / 2;
    let returned = false;
    for (let step = 0; step < 30 * 60; step++) {
      const previous = e.pos.clone(); sim._updateEnemies(1 / 60);
      assert.ok(Math.hypot(e.pos.x - previous.x, e.pos.z - previous.z) <= e.speed / 60 + 1e-6);
      assert.ok(Number.isFinite(e.pos.length() + e.pitch + e.bank));
      if (Math.hypot(e.pos.x, e.pos.z) < 10000) returned = true;
    }
    assert.ok(returned); assert.ok(sim.tracers.length <= 140);
  }
});

test('hard pilots evade live IR missiles with a real decoy while easy pilots keep their pursuit', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const sim = new Simulation(7331); sim.start('intercept', difficulty);
    const e = sim.enemies[0]; sim.enemies = [e]; e.age = 20;
    sim._addMissile(sim.player, false, e.id, { station: 1, store: 'aim9' });
    const m = sim.missiles[0]; m.pos.copy(e.pos).add(vector(0, 0, 700));
    const flares = e.flares; sim._updateEnemies(1 / 60);
    if (difficulty === 'easy') { assert.equal(m.decoy, null); assert.equal(e.flares, 0); assert.notEqual(e.aiMode, 'evade'); }
    else { assert.ok(m.decoy); assert.equal(m.targetId, null); assert.equal(e.flares, flares - 1); assert.equal(e.aiMode, 'evade'); assert.ok(sim.particles.some(p => p.kind === 'flare')); }
  }
});
