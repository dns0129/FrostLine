import test from 'node:test';
import assert from 'node:assert/strict';
import { ISLANDS, terrainHeight, islandHeight, noise2 } from '../world-math.js';

test('terrain samples are finite, deterministic, and share the rendering heightfield', () => {
  for (let index = 0; index < 1800; index++) {
    const x = Math.sin(index * 27.31) * 22000, z = Math.cos(index * 91.17) * 31000;
    const first = terrainHeight(x, z);
    assert.ok(Number.isFinite(first));
    assert.equal(first, terrainHeight(x, z));
    assert.equal(first, Math.max(-32, ...ISLANDS.map(island => islandHeight(island, x, z))));
    const noise = noise2(x * .01, z * .01);
    assert.ok(noise >= 0 && noise <= 1);
  }
});

test('each island contains land, sea, and continuous sea-level crossings', () => {
  for (const island of ISLANDS) {
    let land = 0, sea = 0, crossings = 0, peak = -Infinity;
    for (let bearing = 0; bearing < 32; bearing++) {
      const angle = bearing / 32 * Math.PI * 2;
      let last = islandHeight(island, island.x, island.z), previousRadius = 0;
      for (let step = 1; step <= 60; step++) {
        const radius = step / 60 * island.radius * 1.04;
        const sample = distance => islandHeight(island, island.x + Math.cos(angle) * distance, island.z + Math.sin(angle) * distance);
        const value = sample(radius);
        assert.ok(Number.isFinite(value)); peak = Math.max(peak, value);
        if (value > 0) land++; else sea++;
        if ((last > 0) !== (value > 0)) {
          let a = previousRadius, b = radius;
          for (let iteration = 0; iteration < 24; iteration++) {
            const mid = (a + b) / 2;
            if ((sample(a) > 0) === (sample(mid) > 0)) a = mid; else b = mid;
          }
          assert.ok(Math.abs(sample((a + b) / 2)) < .01, 'shoreline must cross zero without a height step');
          crossings++;
        }
        last = value; previousRadius = radius;
      }
    }
    assert.ok(land > 0 && sea > 0 && crossings >= 16, `island ${island.seed} must have a complete coastline`);
    assert.ok(peak > island.height * .25, `island ${island.seed} must retain a substantial mountain`);
  }
});

test('island height joins the surrounding seabed continuously before its bounds', () => {
  for (const island of ISLANDS) for (let bearing = 0; bearing < 64; bearing++) {
    const angle = bearing / 64 * Math.PI * 2;
    for (const radius of [1.024999, 1.025, 1.025001, 1.04]) {
      const value = islandHeight(island, island.x + Math.cos(angle) * island.radius * radius, island.z + Math.sin(angle) * island.radius * radius);
      assert.equal(value, -32);
    }
  }
});

test('the initial approach corridor stays clear of terrain on both flanks', () => {
  // Initial flight travels from z=4000 toward -Z between the two near massifs.
  // This is intentionally a corridor check, not a promise that the whole world
  // or the northern island chain can be flown through at sea level.
  for (let z = 4200; z >= -10800; z -= 150) for (let x = -900; x <= 900; x += 150) {
    assert.ok(terrainHeight(x, z) <= 0, `approach obstructed at ${x}, ${z}`);
  }
});

test('small movements do not encounter a discontinuous terrain step', () => {
  for (const island of ISLANDS) for (let index = 0; index < 140; index++) {
    const x = island.x + Math.sin(index * 9.73) * island.radius;
    const z = island.z + Math.cos(index * 4.71) * island.radius;
    const centre = islandHeight(island, x, z), epsilon = .01;
    for (const [dx, dz] of [[epsilon, 0], [-epsilon, 0], [0, epsilon], [0, -epsilon]]) {
      assert.ok(Math.abs(centre - islandHeight(island, x + dx, z + dz)) < .25,
        'centimetre movement must not encounter an abrupt height jump');
    }
  }
});
