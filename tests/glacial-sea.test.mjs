import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { DEFAULT_MAP_ID, getMap, MAPS } from '../maps.js';
import {
  setActiveMap, terrainHeight, terrainGroundHeight, islandHeight, icebergFrame, icebergHeight,
  icebergRadius, icebergSurfaceHeight, glacierFrame,
} from '../world-math.js';
import { makeTerrain } from '../terrain.js';
import { makeOcean } from '../atmosphere.js';
import { SEA_ICE_SIZE, seaIceField } from '../sea-ice.js';
import { tacticalChart } from '../sortie-flow.js';
import { missionBriefing } from '../mission-briefing.js';

const MAP_ID = 'glacial-sea';
const map = getMap(MAP_ID);
test.afterEach(() => setActiveMap(DEFAULT_MAP_ID));

test('the glacial sea catalog is deterministic, frozen and varied', async () => {
  assert.equal(map.id, MAP_ID);
  assert.ok(Object.isFrozen(map.icebergs) && map.icebergs.every(Object.isFrozen));
  assert.ok(map.icebergs.length >= 100, 'calved debris fills the sea around the landmark bergs');
  assert.equal(new Set(map.icebergs.map(berg => berg.id)).size, map.icebergs.length);
  for (const type of ['tabular', 'blocky', 'dome', 'pinnacle', 'wedge', 'drydock']) {
    assert.ok(map.icebergs.some(berg => berg.type === type), `${type} bergs are present`);
  }
  for (const berg of map.icebergs) {
    assert.ok([berg.x, berg.z, berg.radius, berg.height, berg.stretch, berg.rotation, berg.seed].every(Number.isFinite));
    assert.ok(berg.radius >= 8 && berg.radius <= 1200 && berg.height >= 2.5 && berg.height <= 120);
  }
  // A fresh module instance rebuilds the identical catalog: no Math.random.
  const fresh = await import(`../maps.js?fresh=${Date.now()}`);
  assert.deepEqual(fresh.getMap(MAP_ID).icebergs, map.icebergs);
  assert.ok(map.islands.some(island => island.shape === 'glacier'));
  assert.ok(MAPS[4] === map, 'glacial sea retains its original catalog position');
});

test('icebergs are solid, separate bodies floating in deep water', () => {
  setActiveMap(MAP_ID);
  for (const berg of map.icebergs) {
    const frame = icebergFrame(berg), top = icebergHeight(berg, berg.x, berg.z);
    assert.ok(top > 1, `${berg.id} rises above the sea`);
    assert.equal(terrainHeight(berg.x, berg.z), top, `${berg.id} collides at its visible top`);
    assert.ok(terrainGroundHeight(berg.x, berg.z) <= -20, `${berg.id} floats over open sea`);
    for (let bearing = 0; bearing < 24; bearing++) {
      const angle = bearing / 24 * Math.PI * 2;
      const x = berg.x + Math.cos(angle) * frame.bound, z = berg.z + Math.sin(angle) * frame.bound;
      assert.equal(icebergHeight(berg, x, z), -32, `${berg.id} meets the seabed inside its bound`);
    }
  }
  for (let i = 0; i < map.icebergs.length; i++) for (let j = i + 1; j < map.icebergs.length; j++) {
    const a = map.icebergs[i], b = map.icebergs[j];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > icebergFrame(a).bound + icebergFrame(b).bound,
      `${a.id} and ${b.id} must not overlap`);
  }
});

test('iceberg cliffs are steep but continuous, so impacts and grounding never step', () => {
  for (const berg of map.icebergs.filter((_, index) => index % 3 === 0)) {
    const frame = icebergFrame(berg);
    for (let bearing = 0; bearing < 16; bearing++) {
      const phi = bearing / 16 * Math.PI * 2, outline = icebergRadius(berg, phi);
      const metric = Math.hypot(Math.cos(phi) * frame.stretch, Math.sin(phi));
      const point = distance => {
        const u = Math.cos(phi) * distance * frame.stretch, v = Math.sin(phi) * distance;
        return [berg.x + u * frame.cos - v * frame.sin, berg.z + u * frame.sin + v * frame.cos];
      };
      const lip = icebergHeight(berg, ...point(outline * .999));
      const sea = icebergHeight(berg, ...point(outline + frame.skirt * .9 / metric));
      assert.ok(lip > 1 && sea < -10, `${berg.id} drops from its lip to deep water within metres`);
      for (let step = 0; step <= 40; step++) {
        const [x, z] = point(outline + (step / 40 - .1) * frame.skirt / metric);
        const centre = icebergHeight(berg, x, z);
        for (const [dx, dz] of [[.01, 0], [-.01, 0], [0, .01], [0, -.01]]) {
          assert.ok(Math.abs(centre - icebergHeight(berg, x + dx, z + dz)) < .6, `${berg.id} cliff is continuous`);
        }
      }
    }
  }
});

test('every rendered iceberg and glacier vertex lies on the collision surface at all tiers', () => {
  setActiveMap(MAP_ID);
  for (const quality of ['low', 'high', 'ultra']) {
    const group = makeTerrain(quality, MAP_ID);
    try {
      let bergMeshes = 0, glaciers = 0;
      group.traverse(mesh => {
        if (!mesh.isMesh) return;
        const position = mesh.geometry.attributes.position;
        if (mesh.userData.icebergs) {
          bergMeshes++;
          assert.ok(mesh.geometry.attributes.iceSurface && mesh.geometry.attributes.iceFlow);
          for (let index = 0; index < position.count; index++) {
            const expected = icebergSurfaceHeight(position.getX(index), position.getZ(index));
            assert.ok(Math.abs(position.getY(index) - expected) < .05, `${quality} berg vertex ${index} differs from collision`);
          }
        }
        if (mesh.userData.island?.shape === 'glacier') {
          glaciers++;
          for (let index = 0; index < position.count; index++) {
            const expected = islandHeight(mesh.userData.island, position.getX(index), position.getZ(index));
            assert.ok(Math.abs(position.getY(index) - expected) < .05, `${quality} glacier vertex ${index} differs from collision`);
          }
        }
      });
      assert.equal(bergMeshes, 1, 'all bergs share one lit draw');
      assert.equal(glaciers, 2);
      assert.equal(group.userData.stats.icebergCount, map.icebergs.length);
    } finally { group.userData.dispose(); }
  }
});

test('tidewater glaciers end in a calving cliff and sink under their flanking massifs', () => {
  setActiveMap(MAP_ID);
  for (const glacier of map.islands.filter(island => island.shape === 'glacier')) {
    const frame = glacierFrame(glacier), c = Math.cos(glacier.rotation), s = Math.sin(glacier.rotation);
    const at = (u, v = 0) => {
      const x = glacier.x + (u * c - v * s) * glacier.radius, z = glacier.z + (u * s + v * c) * glacier.radius;
      return islandHeight(glacier, x, z);
    };
    const front = frame.frontAt(0);
    assert.ok(at(front - 1 / glacier.radius) > glacier.plateauHeight * .8, 'cliff top keeps its freeboard');
    assert.ok(at(front + frame.skirt * .95 / glacier.radius) < -20, 'deep water within metres of the ice front');
    assert.ok(at(front - .5) > at(front - .1) && at(-.4) > at(front - .5), 'the ice surface rises towards the head');
    assert.ok(at(-.4) > 300 && at(-.4) < glacier.height);
    for (const v of [-.2, 0, .2]) assert.ok(at(front - .2, v * frame.halfWidth(front - .2)) > 0);
    assert.equal(at(.2, 1.12 * frame.halfWidth(.2)), -32, 'lateral margins leave room for the valley walls');
  }
});

test('sea ice keeps the approach lead open while pack ice fills the flanks', () => {
  const seaIce = map.seaIce;
  let lead = 0, leads = 0, pack = 0, packs = 0;
  for (let z = -10000; z <= 8000; z += 500) for (const x of [-600, 0, 600]) { lead += seaIceField(seaIce, x, z)[0]; leads++; }
  for (let z = -9000; z <= 9000; z += 1000) for (const x of [-9000, -6500, 6500, 9000]) { pack += seaIceField(seaIce, x, z)[0]; packs++; }
  assert.ok(lead / leads < .25, `lead concentration ${lead / leads}`);
  assert.ok(pack / packs > .6, `pack concentration ${pack / packs}`);
  for (let index = 0; index < 400; index++) {
    const values = seaIceField(seaIce, Math.sin(index * 3.1) * 22000, Math.cos(index * 1.7) * 22000);
    assert.ok(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  assert.deepEqual(seaIceField(null, 0, 0), [0, 0, 0]);
});

test('the ocean keeps one sea-ice field texture and rewrites it in place per map', () => {
  const ocean = makeOcean(), uniforms = ocean.material.uniforms, texture = uniforms.seaIceMap.value;
  let uploads = 0;
  try {
    assert.equal(uniforms.seaIceStrength.value, 0, 'existing maps render open water by default');
    assert.equal(texture.image.width, SEA_ICE_SIZE);
    Object.defineProperty(texture, 'needsUpdate', { set: () => { uploads++; } });
    ocean.userData.setSeaIce(map.seaIce);
    assert.equal(uniforms.seaIceStrength.value, 1);
    assert.equal(uniforms.seaIceExtent.value, map.seaIce.extent);
    assert.equal(uniforms.seaIceMap.value, texture);
    const centre = (SEA_ICE_SIZE / 2 * SEA_ICE_SIZE + SEA_ICE_SIZE / 2) * 4;
    assert.ok(texture.image.data[centre] < 80, 'the lead at the origin stays mostly open');
    assert.ok(texture.image.data.some(value => value > 200), 'pack ice is stored');
    ocean.userData.setSeaIce(map.seaIce);
    assert.equal(uploads, 1, 'reapplying the same map does not refill the field');
    ocean.userData.setSeaIce(getMap(DEFAULT_MAP_ID).seaIce);
    assert.equal(uniforms.seaIceStrength.value, 0);
    assert.equal(uniforms.seaIceMap.value, texture);
    assert.match(ocean.material.fragmentShader, /seaIceSurface/);
  } finally {
    for (const uniform of Object.values(uniforms)) if (uniform.value?.isTexture) uniform.value.dispose();
    ocean.geometry.dispose(); ocean.material.dispose();
  }
});

test('the deployment chart marks the larger icebergs as navigation hazards', () => {
  const svg = tacticalChart(missionBriefing({ mode: 'naval', vehicle: 'destroyer', map: MAP_ID }));
  const expected = map.icebergs.filter(berg => berg.radius >= 60).length;
  assert.equal((svg.match(/class="tactical-ice"/g) ?? []).length, expected);
  assert.equal((tacticalChart(missionBriefing({ mode: 'naval', vehicle: 'destroyer', map: 'ice-ocean' })).match(/tactical-ice/g) ?? []).length, 0);
});

test('the ice material compiles its hooks without a browser and reuses the terrain texture', () => {
  const group = makeTerrain('high', MAP_ID);
  try {
    let ice = null;
    group.traverse(mesh => { if (mesh.userData.icebergs) ice = mesh.material; });
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    ice.onBeforeCompile(shader);
    for (const hook of ['iceCliff', 'iceCrevasse', 'totalEmissiveRadiance +=', 'roughnessFactor = mix']) assert.ok(shader.fragmentShader.includes(hook), hook);
    assert.ok(shader.uniforms.iceStructure.value.isDataTexture, 'ice detail reuses the owned terrain noise texture');
  } finally { group.userData.dispose(); }
});
