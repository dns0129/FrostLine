import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import { STORES } from '../aircraft-systems.js';

test('endless grows beyond six enemies and ramps enemy capabilities from easy to hard', () => {
  const sim = new Simulation();
  sim.start('free', 'hard');
  assert.equal(sim.settings.enemyHealth, 170);
  assert.equal(sim.enemies.length, 2);
  let lastHealth = 0, lastTurn = 0, lastInterval = Infinity;
  for (let wave = 1; wave <= 12; wave++) {
    assert.equal(sim.wave, wave);
    assert.equal(sim.enemies.length, wave + 1);
    assert.ok(sim.settings.enemyHealth >= lastHealth);
    assert.ok(sim.settings.enemyTurn >= lastTurn);
    assert.ok(sim.settings.missileEvery <= lastInterval);
    lastHealth = sim.settings.enemyHealth; lastTurn = sim.settings.enemyTurn; lastInterval = sim.settings.missileEvery;
    sim.enemies = [];
    sim._updateMission(4.5);
    assert.equal(sim.state, 'playing');
  }
  assert.equal(lastHealth, 220);
  assert.equal(lastTurn, 0.35);
  assert.equal(lastInterval, 14);
});

for (const vehicle of ['aircraft', 'destroyer']) for (const difficulty of ['easy', 'normal', 'hard']) {
  test(`endless fully replenishes ${vehicle} on ${difficulty} once per cleared wave`, () => {
    const sim = new Simulation();
    sim.start('free', difficulty, vehicle);
    const p = sim.player;
    const initial = { health: p.health, ammo: p.ammo, missiles: p.missiles, flares: p.flares, sea: p.antiShipMissiles };
    p.health = 1; p.ammo = p.missiles = p.flares = p.antiShipMissiles = 0;
    if (p.stores) p.stores.forEach(s => { if (['anti-air', 'anti-ship'].includes(STORES[s.store]?.kind)) s.count = 0; });
    sim._updateMission(1 / 60);
    assert.equal(p.health, 1, 'remaining enemies prevent resupply');
    sim.enemies = [];
    sim._updateMission(1 / 60);
    assert.equal(p.health, initial.health);
    assert.equal(p.ammo, initial.ammo);
    assert.equal(p.missiles, initial.missiles);
    assert.equal(p.antiShipMissiles, initial.sea);
    assert.equal(p.flares, initial.flares);
    if (p.stores) assert.deepEqual(p.stores, p.configuredStores);
    assert.equal(sim.wave, 1);
    p.flares--;
    sim._updateMission(1);
    assert.equal(p.flares, initial.flares - 1, 'resupply is not repeated during the countdown');
    sim._updateMission(3.5);
    assert.equal(sim.wave, 2);
    assert.equal(sim.enemies.length, 3);
  });
}
