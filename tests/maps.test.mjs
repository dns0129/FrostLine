import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, DEFAULT_MAP_ID, getMap } from '../maps.js';
import { ISLANDS, getActiveMap, setActiveMap, islandHeight, icebergHeight, terrainGroundHeight, terrainHeight, structureHeight } from '../world-math.js';
import { createDefaultFleet, updateDefaultFleet } from '../ambient-fleet.js';
import { NAVAL_MODELS } from '../naval-models.js';

test.afterEach(() => setActiveMap(DEFAULT_MAP_ID));

test('ten immutable map definitions retain metre scale and stable legacy island imports', () => {
  assert.deepEqual(MAPS.map(map => map.id), ['north-atlantic', 'ice-ocean', 'city-bay', 'nile-red-sea', 'glacial-sea', 'storm-strait', 'island-chain', 'dusk-gulf', 'volcanic-front', 'polar-night']);
  const reference = ISLANDS;
  for (const map of MAPS) {
    assert.ok(Object.isFrozen(map) && Object.isFrozen(map.islands));
    assert.ok(map.name && map.englishName && map.description);
    assert.equal(setActiveMap(map.id), map);
    assert.equal(getActiveMap(), map);
    assert.equal(ISLANDS, reference);
    assert.deepEqual(ISLANDS, map.islands);
    for (const island of map.islands) {
      assert.ok(island.radius >= 500 && island.radius <= 5000, 'coasts keep kilometre scale beside 110 m destroyers');
      assert.ok([island.x, island.z, island.radius, island.height, island.seed].every(Number.isFinite));
    }
  }
  assert.equal(getMap('missing-map'), MAPS[0]);
  assert.equal(setActiveMap('missing-map'), MAPS[0]);
  assert.deepEqual(ISLANDS[0], { x: -4800, z: -3700, radius: 2950, height: 1880, seed: 1.8 });
});

test('each map has distinct real terrain and collision uses the same ground field as rendering', () => {
  const signatures = new Set();
  for (const map of MAPS) {
    setActiveMap(map.id);
    const signature = [];
    for (let index = 0; index < 600; index++) {
      const x = Math.sin(index * 27.31) * 18000, z = Math.cos(index * 91.17) * 28000;
      const ground = Math.max(-32, ...map.islands.map(island => islandHeight(island, x, z)));
      const collision = Math.max(ground, ...map.structures.map(structure => structureHeight(structure, x, z)),
        ...(map.icebergs ?? []).map(berg => icebergHeight(berg, x, z)));
      assert.equal(terrainGroundHeight(x, z), ground);
      assert.equal(terrainHeight(x, z), collision);
      assert.ok(Number.isFinite(collision));
      assert.equal(terrainHeight(x, z), terrainHeight(x, z));
      signature.push(ground.toFixed(2));
    }
    signatures.add(signature.join(','));
  }
  assert.equal(signatures.size, MAPS.length, 'map selection changes geography as well as lighting');
});

test('new coastlines stay continuous and meet the seabed inside their render bounds', () => {
  for (const map of MAPS.slice(1)) for (const island of map.islands) {
    let land = 0;
    for (let index = 0; index < 100; index++) {
      const x = island.x + Math.sin(index * 9.73) * island.radius;
      const z = island.z + Math.cos(index * 4.71) * island.radius;
      const centre = islandHeight(island, x, z);
      if (centre > 0) land++;
      for (const [dx, dz] of [[.01, 0], [-.01, 0], [0, .01], [0, -.01]]) {
        assert.ok(Math.abs(centre - islandHeight(island, x + dx, z + dz)) < .3, `${map.id} has continuous ground`);
      }
    }
    assert.ok(land > 5, `${map.id} landmass ${island.seed} must be physical`);
    for (let bearing = 0; bearing < 32; bearing++) {
      const angle = bearing / 32 * Math.PI * 2;
      assert.equal(islandHeight(island, island.x + Math.cos(angle) * island.radius * 1.025,
        island.z + Math.sin(angle) * island.radius * 1.025), -32);
    }
  }
});

test('every map keeps the mission approach and complete fleet hull footprints in deep water', () => {
  const fleet = createDefaultFleet();
  for (const map of MAPS) {
    setActiveMap(map.id);
    for (let z = 8500; z >= -10800; z -= 200) for (let x = -2200; x <= 2200; x += 200) {
      assert.ok(terrainHeight(x, z) <= -10, `${map.id} approach at ${x}, ${z}`);
    }
    for (let time = 0; time <= 1100; time += 5) {
      updateDefaultFleet(fleet, time);
      for (const ship of fleet) {
        const definition = NAVAL_MODELS[ship.type], c = Math.cos(ship.heading), s = Math.sin(ship.heading);
        for (const x of [-definition.beam / 2, 0, definition.beam / 2]) {
          for (const z of [-definition.length / 2, 0, definition.length / 2]) {
            assert.ok(terrainHeight(ship.pos.x + x * c + z * s, ship.pos.z - x * s + z * c) <= -10,
              `${map.id} ${ship.id} full hull at ${time}`);
          }
        }
      }
    }
  }
});

test('the Nile delta has multiple navigable river branches beside low banks and a separate mountain coast', () => {
  const map = setActiveMap('nile-red-sea'), delta = map.islands.find(island => island.shape === 'delta');
  assert.ok(delta.channels.length >= 3);
  for (const channel of delta.channels) {
    const point = channel.points[1];
    const x = delta.x + point[0] * delta.radius * delta.scaleX;
    const z = delta.z + point[1] * delta.radius * delta.scaleZ;
    assert.ok(islandHeight(delta, x, z) <= -18, 'river is carved into collision terrain');
    assert.equal(terrainHeight(x, z), islandHeight(delta, x, z));
  }
  const bank = islandHeight(delta, delta.x + .25 * delta.radius * delta.scaleX, delta.z - .43 * delta.radius);
  assert.ok(bank > 5 && bank < 35, 'alluvial banks remain low above the river');
  const coast = map.islands.find(island => island.x > 0 && !island.distant);
  let peak = 0;
  for (let x = -.6; x <= .6; x += .1) for (let z = -.6; z <= .6; z += .1) {
    peak = Math.max(peak, islandHeight(coast, coast.x + x * coast.radius, coast.z + z * coast.radius));
  }
  assert.ok(peak > 900, 'Red Sea mountains are separate from the flat river delta');
});

test('city buildings have grounded metre scale footprints and collide at their visible rooftops', () => {
  const map = setActiveMap('city-bay');
  assert.ok(map.structures.filter(structure => structure.kind === 'building').length >= 90);
  for (const structure of map.structures) {
    const roof = structure.y + structure.height;
    assert.equal(terrainHeight(structure.x, structure.z), Math.max(roof, terrainGroundHeight(structure.x, structure.z)));
    assert.equal(structureHeight(structure, structure.x, structure.z), roof);
    if (structure.kind === 'quay') continue;
    for (const dx of [-structure.width / 2, structure.width / 2]) for (const dz of [-structure.depth / 2, structure.depth / 2]) {
      assert.equal(terrainGroundHeight(structure.x + dx, structure.z + dz), structure.y);
    }
    assert.ok(structure.height <= 180 && structure.width <= 110 && structure.depth <= 80);
  }
  const rotated = { x: 10, z: 20, y: 5, width: 20, depth: 80, height: 40, rotation: Math.PI / 2 };
  assert.equal(structureHeight(rotated, 45, 20), 45);
  assert.equal(structureHeight(rotated, 10, 35), -32);
  setActiveMap('ice-ocean');
  const building = map.structures[0];
  assert.notEqual(terrainHeight(building.x, building.z), building.y + building.height, 'switching maps clears the city collision index');
});
