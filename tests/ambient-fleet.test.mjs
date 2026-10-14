import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { terrainHeight } from '../world-math.js';
import { NAVAL_MODELS, makeNavalAssets, makeNavalShip } from '../naval-models.js';
import { AmbientFleet, createDefaultFleet, updateDefaultFleet, sampleFleetRoute, FLEET_ROUTES } from '../ambient-fleet.js';

test('every mission and vehicle starts exactly two scene-only carrier groups without changing combat targets', () => {
  const sim = new Simulation();
  for (const vehicle of ['aircraft', 'destroyer']) for (const mode of ['intercept', 'free', 'training', 'naval', 'naval-training']) {
    sim.start(mode, 'easy', vehicle);
    assert.equal(sim.ambientShips.length, 6);
    assert.equal(new Set(sim.ambientShips.map(s => s.id)).size, 6);
    for (const country of ['US', 'CN']) {
      const group = sim.ambientShips.filter(s => s.country === country);
      assert.equal(group.filter(s => NAVAL_MODELS[s.type].kind === 'carrier').length, 1);
      assert.equal(group.filter(s => NAVAL_MODELS[s.type].kind === 'destroyer').length, 2);
    }
    assert.ok(sim.ambientShips.every(s => s.speed > 0 && s.kind === 'ambient-ship'));
    assert.ok(sim.enemies.every(e => !sim.ambientShips.some(s => s.id === e.id)));
    if (mode === 'naval-training') assert.equal(sim.enemies.length, 2);
    if (mode === 'training') assert.equal(sim.enemies.length, 3);
    assert.equal(sim.score, 0); assert.equal(sim.kills, 0);
  }
});

test('both complete patrol loops keep entire ship footprints in deep water and formations separated', () => {
  const fleet = createDefaultFleet(); let minimum = Infinity;
  for (let time = 0; time <= 1100; time += 2) {
    updateDefaultFleet(fleet, time);
    for (const ship of fleet) {
      const d = NAVAL_MODELS[ship.type], c = Math.cos(ship.heading), s = Math.sin(ship.heading);
      for (const x of [-d.beam / 2, 0, d.beam / 2]) for (const z of [-d.length / 2, 0, d.length / 2]) {
        assert.ok(terrainHeight(ship.pos.x + x * c + z * s, ship.pos.z - x * s + z * c) <= -10, `${ship.id} at ${time}`);
      }
      assert.ok(Number.isFinite(ship.heading) && ship.speed > 0);
    }
    for (let i = 0; i < fleet.length; i++) for (let j = i + 1; j < fleet.length; j++) minimum = Math.min(minimum, fleet[i].pos.distanceTo(fleet[j].pos));
  }
  assert.ok(minimum > 430, `centre separation ${minimum}`);
});

test('leader route is continuous at all joins including loop closure and follows its actual heading', () => {
  for (const country of ['US', 'CN']) {
    const r = FLEET_ROUTES[country], s = r.straight, a = Math.PI * r.radius, period = (2 * s + 2 * a) / r.speed;
    for (const distance of [0, s, s + a, 2 * s + a, 2 * s + 2 * a]) {
      const t = (distance - r.offset) / r.speed + period, epsilon = .001;
      const before = sampleFleetRoute(country, t - epsilon), after = sampleFleetRoute(country, t + epsilon), centre = sampleFleetRoute(country, t);
      assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < .025);
      const angle = Math.atan2(-(after.x - before.x), -(after.z - before.z));
      assert.ok(Math.abs(Math.atan2(Math.sin(angle - centre.heading), Math.cos(angle - centre.heading))) < .001);
    }
  }
});

test('pause freezes fleet telemetry and waves; restarting restores the initial six ships without duplication', () => {
  const sim = new Simulation(), scene = new THREE.Scene(), fleet = new AmbientFleet(scene);
  sim.start('naval-training'); const initial = JSON.stringify(sim.ambientShips);
  for (let i = 0; i < 120; i++) sim.update(1 / 60);
  assert.notEqual(JSON.stringify(sim.ambientShips), initial);
  fleet.update(sim.ambientShips, sim.time); sim.state = 'paused';
  const telemetry = JSON.stringify(sim.ambientShips), transforms = () => fleet.ships.map(s => [s.model.position.toArray(), s.model.rotation.toArray(), s.wake.position.toArray()]);
  const before = transforms();
  for (let i = 0; i < 60; i++) { sim.update(1 / 60); fleet.update(sim.ambientShips, sim.time); }
  assert.equal(JSON.stringify(sim.ambientShips), telemetry); assert.deepEqual(transforms(), before);
  for (let i = 0; i < 12; i++) { sim.start(i % 2 ? 'training' : 'naval-training'); fleet.update(sim.ambientShips, sim.time); }
  assert.equal(JSON.stringify(sim.ambientShips), initial); assert.equal(fleet.group.children.length, 12);
  fleet.dispose(); fleet.dispose(); assert.equal(scene.children.length, 0);
});

test('four distinct textured ship classes have finite outward geometry, appropriate scale and cheaper distant silhouettes', () => {
  const assets = makeNavalAssets();
  for (const [type, def] of Object.entries(NAVAL_MODELS)) {
    const ship = makeNavalShip(assets, type), counts = [];
    for (const level of ship.userData.lod.levels) {
      let triangles = 0, meshes = 0;
      level.object.traverse(o => {
        if (!o.isMesh) return; meshes++;
        for (const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
        assert.ok(o.geometry.boundingSphere.radius > 0); triangles += o.geometry.attributes.position.count / 3;
      });
      assert.ok(meshes <= 11); counts.push(triangles);
    }
    assert.ok(counts[0] < 11000 && counts[1] < counts[0] * .36);
    const hull = ship.getObjectByName(`naval-${type}-hull`).geometry.boundingBox;
    assert.equal(hull.max.z - hull.min.z, def.length);
    const deck = ship.getObjectByName(`naval-${type}-deck`).geometry;
    let upward = 0; for (let i = 0; i < deck.attributes.normal.count; i++) if (deck.attributes.normal.getY(i) > .9) upward++;
    assert.ok(upward > 5);
    const material = ship.getObjectByName(`naval-${type}-hull`).material;
    assert.ok(material.map && material.roughnessMap && material.bumpMap);
    assert.ok(material.roughness > .85 && material.metalness < .3);
    assert.ok(assets.materials.deck.roughness === 1 && assets.materials.steel.metalness > .7);
  }
  const first = makeNavalShip(assets, 'burke', '51'), second = makeNavalShip(assets, 'burke', '52');
  assert.equal(first.getObjectByName('naval-burke-hull').geometry, second.getObjectByName('naval-burke-hull').geometry);
  assert.notEqual(first.getObjectByName('hull-and-deck-number').geometry, second.getObjectByName('hull-and-deck-number').geometry);
  assets.dispose();
});

test('fleet disposal releases shared GPU resources exactly once and mobile quality shortens detail distance', () => {
  const scene = new THREE.Scene(), fleet = new AmbientFleet(scene), resources = new Set();
  fleet.group.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); });
  for (const maps of Object.values(fleet.assets.textures)) Object.values(maps).forEach(t => resources.add(t));
  Object.values(fleet.assets.classes).forEach(c => c.levels.flat().forEach(a => resources.add(a.geometry)));
  resources.add(fleet.map);
  const disposed = new Map(); resources.forEach(r => r.addEventListener('dispose', () => disposed.set(r, (disposed.get(r) || 0) + 1)));
  fleet.setQuality('low'); assert.ok(fleet.ships.every(s => s.model.userData.lod.levels[1].distance === 1800));
  fleet.setQuality('high'); assert.ok(fleet.ships.every(s => s.model.userData.lod.levels[1].distance === 2600));
  fleet.dispose(); fleet.dispose();
  resources.forEach(r => assert.equal(disposed.get(r), 1));
});
