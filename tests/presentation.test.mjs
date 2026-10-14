import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { FlightPresentation } from '../flight-presentation.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const vector = (actual, expected) => actual.toArray().forEach((v, i) => close(v, expected[i]));
function fixture() {
  const sim = new Simulation();
  sim.start('training');
  return sim;
}

test('sample interpolates the last physics step while combat state stays current', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  presentation.reset(sim);
  sim.player.pos.set(0, 1000, 0);
  sim.player.vel.set(0, 0, -100);
  sim.player.speed = 100;
  presentation.capture(sim);
  sim.player.pos.set(10, 1020, -30);
  sim.player.vel.set(20, 0, -120);
  sim.player.speed = 120;
  sim.player.health = 80;
  sim.player.ammo = 899;
  sim.targetId = sim.enemies[1].id;
  sim.time = 1 / 60;
  const view = presentation.sample(sim, .25);
  vector(view.player.pos, [2.5, 1005, -7.5]);
  vector(view.player.vel, [5, 0, -105]);
  close(view.player.speed, 105);
  close(view.time, 1 / 240);
  assert.equal(view.player.health, 80);
  assert.equal(view.player.ammo, 899);
  assert.equal(view.targetId, sim.enemies[1].id);
});

test('heading, pitch and bank take the shortest arc across pi', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  for (const key of ['heading', 'pitch', 'bank']) sim.player[key] = Math.PI - .1;
  presentation.capture(sim);
  for (const key of ['heading', 'pitch', 'bank']) sim.player[key] = -Math.PI + .1;
  const view = presentation.sample(sim, .5);
  for (const key of ['heading', 'pitch', 'bank']) close(Math.abs(view.player[key]), Math.PI);
});

test('all moving entity types interpolate independent positions, tracer tails and velocities', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  for (const key of ['enemies', 'missiles', 'tracers', 'particles']) {
    sim[key] = [{pos: new THREE.Vector3(0, 100, 0), prev: new THREE.Vector3(-2, 100, 0), vel: new THREE.Vector3(10, 0, 0), heading: 0, speed: 10}];
  }
  presentation.capture(sim);
  for (const key of ['enemies', 'missiles', 'tracers', 'particles']) {
    sim[key][0].pos.x = 10;
    sim[key][0].prev.x = 8;
    sim[key][0].vel.x = 20;
    sim[key][0].heading = .2;
    sim[key][0].speed = 20;
  }
  const view = presentation.sample(sim, .5);
  for (const key of ['enemies', 'missiles', 'tracers', 'particles']) {
    vector(view[key][0].pos, [5, 100, 0]);
    vector(view[key][0].prev, [3, 100, 0]);
    vector(view[key][0].vel, [15, 0, 0]);
    close(view[key][0].heading, .1);
    close(view[key][0].speed, 15);
  }
});

test('new entities snap, removed entities disappear, and reused ids never inherit old positions', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  const removed = sim.enemies[0];
  presentation.capture(sim);
  const added = {...removed, pos: new THREE.Vector3(500, 1000, 500)};
  sim.enemies = [added];
  sim.particles.push({pos: new THREE.Vector3(10, 100, 0), vel: new THREE.Vector3()});
  const view = presentation.sample(sim, .1);
  assert.equal(view.enemies.length, 1);
  vector(view.enemies[0].pos, added.pos.toArray());
  vector(view.particles[0].pos, [10, 100, 0]);
  sim.enemies.length = 0;
  sim.particles.length = 0;
  presentation.capture(sim);
  sim.enemies.push(removed);
  removed.pos.x = 20;
  vector(presentation.sample(sim, .1).enemies[0].pos, removed.pos.toArray());
});

test('several physics steps before a frame use only the most recent interval', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  sim.player.pos.set(0, 1000, 0);
  for (let step = 1; step <= 3; step++) {
    presentation.capture(sim);
    sim.player.pos.x = step * 10;
    sim.time = step / 60;
  }
  const view = presentation.sample(sim, .5);
  vector(view.player.pos, [25, 1000, 0]);
  close(view.time, 2.5 / 60);
});

test('reset and replaced player state discard previous mission snapshots', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  presentation.capture(sim);
  sim.player.pos.x += 100;
  presentation.reset(sim);
  vector(presentation.sample(sim, 0).player.pos, sim.player.pos.toArray());
  sim.start('training');
  vector(presentation.sample(sim, 0).player.pos, sim.player.pos.toArray());
  assert.equal(presentation.sample(sim, 0).time, 0);
});

test('teleports beyond 1000 metres snap the complete pose instead of streaking across the world', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  presentation.capture(sim);
  sim.player.pos.x += 1001;
  sim.player.heading = 1;
  sim.player.vel.x = 100;
  const view = presentation.sample(sim, .1);
  vector(view.player.pos, sim.player.pos.toArray());
  vector(view.player.vel, sim.player.vel.toArray());
  assert.equal(view.player.heading, 1);
});

test('sampling preserves authoritative simulation state and owns mutable display values', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  sim._addMissile(sim.player, false, sim.enemies[0].id);
  presentation.capture(sim);
  sim.update(1 / 60);
  const before = JSON.stringify(sim);
  const view = presentation.sample(sim, .5);
  assert.equal(JSON.stringify(sim), before);
  assert.notEqual(view.player, sim.player);
  assert.notEqual(view.enemies, sim.enemies);
  assert.notEqual(view.enemies[0], sim.enemies[0]);
  view.player.pos.set(999, 999, 999);
  view.player.vel.set(999, 999, 999);
  view.enemies[0].pos.set(999, 999, 999);
  view.settings.damage = 999;
  if (view.missiles.length) view.missiles[0].dir.x = 999;
  assert.equal(JSON.stringify(sim), before);
  assert.equal(presentation.sample(sim, .75), view, 'top-level display state is reused between frames');
});

test('sampling clamps alpha to the captured interval and removes deleted optional fields', () => {
  const sim = fixture(), presentation = new FlightPresentation();
  sim.player.pos.set(0, 1000, 0);
  sim.player.prev = sim.player.pos.clone();
  presentation.capture(sim);
  sim.player.pos.x = 10;
  vector(presentation.sample(sim, -1).player.pos, [0, 1000, 0]);
  vector(presentation.sample(sim, 2).player.pos, [10, 1000, 0]);
  delete sim.player.prev;
  assert.equal(Object.hasOwn(presentation.sample(sim, .5).player, 'prev'), false);
});


test('destroyer turret interpolation crosses north smoothly and reset discards it', () => {
  const sim=new Simulation();sim.start('training','easy','destroyer');
  const presentation=new FlightPresentation();sim.player.turretHeading=Math.PI-.1;sim.player.turretPitch=.2;sim.player.rudder=0;
  presentation.capture(sim);sim.player.turretHeading=-Math.PI+.1;sim.player.turretPitch=.4;sim.player.rudder=1;
  const view=presentation.sample(sim,.5);assert.ok(Math.abs(view.player.turretHeading-Math.PI)<1e-9);assert.ok(Math.abs(view.player.turretPitch-.3)<1e-9);assert.equal(view.player.rudder,.5);
  sim.start('training');assert.equal(presentation.sample(sim,.5).player.kind,'aircraft');assert.equal(presentation.sample(sim,.5).player.turretHeading,undefined);
});
