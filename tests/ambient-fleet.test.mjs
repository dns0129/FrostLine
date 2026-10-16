import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { terrainHeight } from '../world-math.js';
import { NAVAL_MODELS, makeNavalShip } from '../naval-models.js';
import { AmbientFleet, createDefaultFleet, updateDefaultFleet, sampleFleetRoute, FLEET_ROUTES } from '../ambient-fleet.js';
import { navalAssets as imported, loadNavalFixture } from './naval-fixture.mjs';

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
  const sim = new Simulation(), scene = new THREE.Scene(), fleet = new AmbientFleet(scene, { imported });
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

const tris = o => (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
const meshesOf = object => { const list = []; object.traverse(o => { if (o.isMesh) list.push(o); }); return list; };

test('every fleet class is an imported Blender model matching its published size, bow -Z and waterline 0', () => {
  assert.deepEqual(Object.keys(NAVAL_MODELS), ['enterprise', 'fujian', 'burke', 'type052d']);
  for (const [type, def] of Object.entries(NAVAL_MODELS)) {
    const prepared = imported[def.asset], meta = prepared.metadata;
    assert.equal(meta.units, 'metres'); assert.equal(meta.glb_axes, '+Y up, bow -Z');
    assert.ok(Math.abs(meta.length_overall - def.length) < .6, `${type} length ${meta.length_overall}`);
    assert.ok(Math.abs(meta.waterline_beam - def.hullBeam) < .1, `${type} waterline beam`);
    if (def.kind === 'carrier') {
      assert.ok(Math.abs(meta.flight_deck_width - def.beam) < .1); assert.equal(meta.flight_deck_height, def.deckY);
    } else {
      assert.ok(Math.abs(meta.beam_overall - def.beam) < .1);
      assert.ok(def.deckY > meta.deck_height_stern && def.deckY < meta.deck_height_bow);
    }
    const ship = makeNavalShip(imported, type), [near, far] = ship.userData.lod.levels.map(l => meshesOf(l.object));
    for (const mesh of near) {
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite)); assert.ok(mesh.geometry.boundingSphere.radius > 0);
    }
    const nearTris = near.reduce((n, m) => n + tris(m), 0), farTris = far.reduce((n, m) => n + tris(m), 0);
    assert.ok(near.length <= 15, `${type} draws ${near.length}`); assert.ok(far.length <= 5);
    assert.ok(nearTris <= meta.triangles && nearTris > meta.triangles * .9); assert.ok(farTris < nearTris * .33, `${type} far ${farTris}`);
    const box = new THREE.Box3(); near.forEach(m => box.union(m.geometry.boundingBox));
    assert.ok(Math.abs(box.max.z - box.min.z - def.length) < .6); assert.ok(Math.abs(box.min.z + box.max.z) < 2);
    assert.ok(near.find(m => m.material.name === 'Antifouling red').geometry.boundingBox.max.y < .5, `${type} below waterline`);
    if (def.kind === 'carrier') {
      const island = near.find(m => /island grey/.test(m.material.name)).geometry.boundingBox;
      assert.ok(island.min.x > 15, `${type} island to starboard`); assert.ok(near.some(m => m.material.map));
    } else {
      const numbers = near.filter(m => m.name.includes('Hull number white'));
      assert.equal(numbers.length, 1); assert.ok(numbers[0].geometry.boundingBox.max.z < -def.length / 4, `${type} number on the bow`);
    }
  }
  assert.throws(() => makeNavalShip({}, 'burke'), /not loaded/); assert.throws(() => makeNavalShip(imported, 'forrestal'), /Unknown/);
});

test('one GLB per class serves every hull number in the fleet and shares its geometry', () => {
  const expected = { enterprise: ['65'], fujian: ['18'], burke: ['51', '52'], type052d: ['172', '173'] };
  for (const [type, numbers] of Object.entries(expected)) assert.deepEqual(imported[NAVAL_MODELS[type].asset].numbers, numbers);
  for (const [type, a, b] of [['burke', '51', '52'], ['type052d', '172', '173']]) {
    const first = makeNavalShip(imported, type, a), second = makeNavalShip(imported, type, b);
    const names = ship => meshesOf(ship).filter(m => /Hull number/.test(m.name)).map(m => m.name);
    assert.ok(names(first).every(n => n.endsWith(a))); assert.ok(names(second).every(n => n.endsWith(b)));
    assert.equal(names(first).length, 2);
    const hull = ship => meshesOf(ship).find(m => m.name === `naval-${type}-Antifouling red`).geometry;
    assert.equal(hull(first), hull(second));
  }
  const fleet = new AmbientFleet(new THREE.Scene(), { imported });
  for (const { id, model } of fleet.ships) {
    const shown = meshesOf(model.userData.lod.levels[0].object).filter(m => /Hull number white/.test(m.name)).map(m => m.name.split(' ').pop());
    assert.deepEqual(shown, [id.split('-').pop()], id);
  }
  assert.deepEqual(fleet.ships.map(s => s.model.userData.modelType), ['enterprise', 'burke', 'burke', 'fujian', 'type052d', 'type052d']);
  fleet.dispose();
});

test('campaign chapter 2 protects the Enterprise group that is actually in the fleet', () => {
  const sim = new Simulation(); sim.startCampaign('shield');
  const carrier = sim.ambientShips.find(s => s.id === sim.campaignState.protectedFleetId);
  assert.equal(carrier?.type, 'enterprise');
  sim.update(1 / 60); assert.ok(Math.hypot(sim.campaignState.objectivePos.x - carrier.pos.x, sim.campaignState.objectivePos.z - carrier.pos.z) < 1);
});

test('fleet disposal releases its own resources exactly once and never the renderer-owned models', () => {
  const scene = new THREE.Scene(), fleet = new AmbientFleet(scene, { imported }), resources = new Set(), external = new Set();
  for (const prepared of Object.values(imported)) for (const level of prepared.levels) for (const { geometry, material } of level) external.add(geometry).add(material);
  fleet.group.traverse(o => { for (const r of [o.geometry, o.material]) if (r && !external.has(r)) resources.add(r); });
  Object.values(fleet.wakeAssets).forEach(a => resources.add(a.geometry).add(a.material)); resources.add(fleet.map);
  const disposed = new Map(); [...resources, ...external].forEach(r => r.addEventListener('dispose', () => disposed.set(r, (disposed.get(r) || 0) + 1)));
  fleet.setQuality('low'); assert.ok(fleet.ships.every(s => s.model.userData.lod.levels[1].distance === 1800));
  fleet.setQuality('high'); assert.ok(fleet.ships.every(s => s.model.userData.lod.levels[1].distance === 2600));
  fleet.dispose(); fleet.dispose();
  resources.forEach(r => assert.equal(disposed.get(r), 1));
  external.forEach(r => assert.equal(disposed.get(r), undefined, 'imported models stay owned by the renderer'));
});

test('a prepared ship asset releases every geometry, material and texture exactly once', async () => {
  const prepared = await loadNavalFixture('enterprise'), counts = new Map(), add = r => r.addEventListener('dispose', () => counts.set(r, (counts.get(r) || 0) + 1));
  const owned = new Set();
  for (const level of prepared.levels) for (const { geometry, material } of level) {
    owned.add(geometry).add(material); for (const v of Object.values(material)) if (v?.isTexture) owned.add(v);
  }
  owned.forEach(add); prepared.dispose(); prepared.dispose();
  owned.forEach(r => assert.equal(counts.get(r), 1));
});
