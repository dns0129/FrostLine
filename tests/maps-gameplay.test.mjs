import {isShipVehicle} from '../ship-systems.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { MAPS } from '../maps.js';
import { Simulation, DESTROYER, shipCameraAimPoint } from '../simulation.js';
import { getActiveMap, setActiveMap, terrainHeight } from '../world-math.js';
import { OWNED_VEHICLES } from '../vehicle-catalog.js';
import { NAVAL_MODELS } from '../naval-models.js';
import { loadoutSummary } from '../aircraft-systems.js';

const MODES = ['intercept', 'free', 'training', 'naval', 'naval-training'];
const DT = 1 / 60;

function assertFiniteEntity(entity, context) {
  assert.ok(entity.pos.toArray().every(Number.isFinite), `${context}: non-finite position`);
  if (entity.vel) assert.ok(entity.vel.toArray().every(Number.isFinite), `${context}: non-finite velocity`);
  for (const field of ['heading', 'pitch', 'bank', 'speed', 'health']) {
    if (field in entity) assert.ok(Number.isFinite(entity[field]), `${context}: non-finite ${field}`);
  }
}

function assertClearSurface(entity, context) {
  assertFiniteEntity(entity, context);
  if (entity.kind === 'aircraft') {
    assert.ok(entity.pos.y > Math.max(0, terrainHeight(entity.pos.x, entity.pos.z)) + 40,
      `${context}: aircraft has insufficient terrain clearance`);
    return;
  }
  if (!['destroyer', 'ship', 'ambient-ship'].includes(entity.kind)) return;
  const definition = entity.kind === 'ambient-ship' ? NAVAL_MODELS[entity.type] : null;
  const halfLength = definition ? definition.length / 2 : entity.halfLength ?? DESTROYER.halfLength;
  const halfWidth = definition ? definition.beam / 2 : entity.halfWidth ?? DESTROYER.halfWidth;
  const maximumGround = definition ? -10 : -3;
  const cos = Math.cos(entity.heading), sin = Math.sin(entity.heading);
  // Cover the full hull, including mid-edges: checking only the centre can
  // silently admit bows and sterns intersecting a riverbank or quay.
  for (let z = -halfLength; z <= halfLength; z += halfLength / 4) {
    for (const x of [-halfWidth, 0, halfWidth]) {
      const worldX = entity.pos.x + x * cos + z * sin;
      const worldZ = entity.pos.z - x * sin + z * cos;
      assert.ok(terrainHeight(worldX, worldZ) <= maximumGround, `${context}: hull intersects shallow land at ${worldX}, ${worldZ}`);
    }
  }
}

for (const map of MAPS) for (const requestedVehicle of OWNED_VEHICLES) for (const mode of MODES) {
  test(`${map.id}: ${requestedVehicle.id}/${mode} spawns safely and advances the simulation`, () => {
    const previous = getActiveMap();
    try {
      setActiveMap(map.id);
      const sim = new Simulation(7331);
      if (requestedVehicle.aircraftId) sim.configureAircraft(null, requestedVehicle.aircraftId);
      sim.start(mode, 'normal', requestedVehicle.id);
      const vehicle = isShipVehicle(requestedVehicle.id) ? 'destroyer' : 'aircraft';
      assert.equal(sim.vehicle, vehicle);
      if (requestedVehicle.aircraftId) {
        assert.equal(sim.player.aircraftId, requestedVehicle.aircraftId);
        const summary = loadoutSummary(sim.player.stores, requestedVehicle.aircraftId);
        assert.equal(sim.player.missiles, summary.air);
        assert.equal(sim.player.antiShipMissiles, summary.sea);
      }
      assert.equal(sim.state, 'playing');
      assert.equal(sim._spawnIncomplete, false);
      assert.equal(sim.enemies.length, mode === 'training' ? 3 : 2);
      assert.equal(sim.ambientShips.length, 6);
      assert.equal(getActiveMap().id, map.id, 'quick mission must retain the selected collision map');
      for (const entity of [sim.player, ...sim.enemies]) assertClearSurface(entity, `${map.id}/${mode}/${entity.id ?? 'player'}`);
      const health = sim.player.health;
      for (let frame = 0; frame < 120; frame++) {
        sim.update(DT, vehicle === 'destroyer'
          ? { throttleDelta: .2, yaw: .1 }
          : { throttleDelta: .15, roll: .08, pitch: .1 });
        for (const entity of [sim.player, ...sim.enemies]) assertClearSurface(entity, `${map.id}/${mode}/${entity.id ?? 'player'}`);
        for (const ship of sim.ambientShips) assertClearSurface(ship, `${map.id}/${ship.id}`);
      }
      assert.equal(sim.state, 'playing');
      assert.ok(Math.abs(sim.time - 2) < 1e-9, 'fixed simulation time must advance independently of map detail');
      assert.equal(sim.player.health, health, 'the initial route must not inflict terrain damage');
      assert.equal(getActiveMap().id, map.id);
    } finally { setActiveMap(previous.id); }
  });
}

test('city buildings stop the visible cannon sight ray at their actual roof and facade', () => {
  const previous = getActiveMap();
  try {
    const map = setActiveMap('city-bay');
    const building = map.structures.find(structure => structure.kind === 'building');
    const top = building.y + building.height;
    const player = { pos: new THREE.Vector3(0, .5, 4000), heading: 0 };
    const roof = shipCameraAimPoint(player, [], new THREE.Vector3(building.x, top + 100, building.z),
      new THREE.Vector3(0, -1, 0), 250);
    assert.equal(roof.kind, 'terrain');
    assert.ok(Math.abs(roof.point.y - top) < .1, 'roof sight line must hit the rendered collision envelope');
    const side = shipCameraAimPoint(player, [],
      new THREE.Vector3(building.x + building.width / 2 + 20, building.y + building.height / 2, building.z),
      new THREE.Vector3(-1, 0, 0), building.width + 40);
    assert.equal(side.kind, 'terrain');
    assert.ok(Math.abs(side.point.x - (building.x + building.width / 2)) < .15,
      'a facade must block sight at its metre-based footprint');
    assert.equal(side.targetId, null, 'static architecture is not a combat ship target');
  } finally { setActiveMap(previous.id); }
});
