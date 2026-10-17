import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { STORES } from '../aircraft-systems.js';
import { MISSILE_MODEL_IDS, MISSILE_VISUALS, missileModelId, prepareMissileModels, storeTemplates } from '../missile-models.js';
import { WorldRenderer } from '../renderer.js';
import { makeFA18 } from '../fa18.js';
import { makeJetAssets } from '../aircraft.js';
import { loadMissileFixture } from './missile-fixture.mjs';
import { fa18Assets } from './fa18-fixture.mjs';

const models = await loadMissileFixture();
// Published length / body diameter of the non-store models (stores use STORES.visual).
const SHIP_MODELS = { sm2: [4.72, .343], rgm84: [4.63, .343], hq10: [2, .127], yj83: [6.38, .36] };
const sizeOf = id => STORES[id] ? [STORES[id].visual.length, STORES[id].visual.radius * 2] : SHIP_MODELS[id];
const radial = (mesh, cb) => {
  const p = mesh.geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix); cb(Math.hypot(v.x, v.y), v); }
};

test('every runtime missile keeps its published length and body diameter, nose -Z, centred on the body axis', () => {
  assert.deepEqual(Object.keys(models.templates).sort(), [...MISSILE_MODEL_IDS].sort());
  for (const id of MISSILE_MODEL_IDS) {
    const template = models.templates[id], info = models.metadata.stores[id], [length, diameter] = sizeOf(id);
    assert.ok(Math.abs(info.length_m - length) < 1e-3 && Math.abs(info.diameter_m - diameter) < 2e-3, `${id} matches the published size`);
    assert.equal(template.position.y, -(STORES[id]?.visual.hang || 0));
    const box = new THREE.Box3(); template.children.forEach(m => box.expandByObject(m));
    assert.ok(Math.abs(box.max.z - box.min.z - length) < .002, `${id} length`);
    assert.ok(Math.abs(box.max.z + box.min.z) < .002 && Math.abs(box.max.x + box.min.x) < .002, `${id} centred`);
    const body = template.children.find(m => m.name === `${id}_body`), seeker = template.children.find(m => m.name === `${id}_seeker`);
    let onSkin = 0; radial(body, r => { if (Math.abs(r - diameter / 2) < 1e-3) onSkin++; });
    assert.ok(onSkin > 8, `${id} body skin sits at the published radius`);
    const nose = new THREE.Box3().setFromObject(seeker).getCenter(new THREE.Vector3());
    assert.ok(nose.z < -.3 * length, `${id} seeker is at the -Z nose`);
  }
});

test('templates stay light enough for full loadouts and 24 launches, and share their common materials', () => {
  let total = 0; const materials = new Map();
  for (const id of MISSILE_MODEL_IDS) {
    let triangles = 0;
    models.templates[id].traverse(o => {
      if (!o.isMesh) return;
      for (const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      const role = o.name.split('_')[1]; if (!materials.has(role)) materials.set(role, new Set()); materials.get(role).add(o.material);
    });
    assert.ok(triangles < 900, `${id} has ${triangles} triangles`); total += triangles;
  }
  assert.ok(total < 7500);
  assert.equal(materials.get('dark').size, 1); assert.equal(materials.get('fittings').size, 1);
});

test('disposing the missile asset releases every geometry and material exactly once', async () => {
  const owner = await loadMissileFixture(); let geometries = 0, materials = 0; const seen = new Set();
  for (const template of Object.values(owner.templates)) template.traverse(o => {
    if (!o.isMesh) return;
    if (!seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.addEventListener('dispose', () => geometries++); }
    if (!seen.has(o.material)) { seen.add(o.material); o.material.addEventListener('dispose', () => materials++); }
  });
  owner.dispose(); owner.dispose();
  const meshes = Object.values(owner.metadata.stores).reduce((n, s) => n + s.meshes.length, 0);
  assert.equal(geometries, meshes); assert.ok(materials >= 6 && materials <= 9);
  assert.throws(() => prepareMissileModels(new THREE.Group(), { ...owner.metadata, glb_axes: '+Z up' }), /incompatible/);
});

test('each live missile maps to its store, its ship class or the enemy model', () => {
  assert.equal(missileModelId({ store: 'aim120', weapon: 'anti-air' }), 'aim120');
  assert.equal(missileModelId({ store: 'yj83k', weapon: 'anti-ship' }), 'yj83k');
  assert.equal(missileModelId({ enemy: true, weapon: 'anti-air' }), MISSILE_VISUALS.enemy);
  for (const [shipId, sam, asm] of [['burke', 'sm2', 'rgm84'], ['type052d', 'hq10', 'yj83'], ['destroyer', 'hq10', 'yj83'], [undefined, 'hq10', 'yj83']]) {
    assert.equal(missileModelId({ shipLaunched: true, weapon: 'anti-air' }, { shipId }), sam);
    assert.equal(missileModelId({ shipLaunched: true, weapon: 'anti-ship', kind: 'anti-ship' }, { shipId }), asm);
  }
  assert.equal(missileModelId({ weapon: 'anti-air' }), null, 'unknown sources keep the generic shapes');
  for (const id of [MISSILE_VISUALS.enemy, ...Object.values(MISSILE_VISUALS.ships).flatMap(Object.values)]) assert.ok(models.templates[id]);
});

test('the Hornet keeps its measured wing/tip fits and carries real-scale AIM-7M, Harpoon and fuselage AIM-120C', () => {
  const ctx = new Proxy({}, { get: (t, k) => /create.*Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {} });
  const prior = globalThis.document; globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  const jetAssets = makeJetAssets();
  if (prior === undefined) delete globalThis.document; else globalThis.document = prior;
  const assets = { ...fa18Assets, templates: storeTemplates(models, ['aim9', 'aim120', 'aim7', 'harpoon']) };
  const jet = makeFA18(assets, jetAssets), geometryOf = new Map();
  for (const [id, template] of Object.entries(assets.templates)) template.traverse(o => { if (o.geometry) geometryOf.set(o.geometry, id); });
  const kinds = {};
  jet.userData.stores.traverse(o => {
    if (!o.userData.store) return;
    const key = `${o.userData.station}:${o.userData.store}`; let source = 'generated';
    o.traverse(m => { if (m.isMesh) source = geometryOf.has(m.geometry) ? 'model' : m.geometry === assets.armament.geometries.medium || m.geometry === assets.armament.geometries.short ? 'fitted' : source; });
    kinds[key] = source;
  });
  for (const station of [2, 3, 7, 8]) { assert.equal(kinds[`${station}:aim7`], 'model'); assert.equal(kinds[`${station}:harpoon`], 'model'); assert.equal(kinds[`${station}:aim120`], 'fitted'); }
  for (const station of [4, 6]) { assert.equal(kinds[`${station}:aim120`], 'model'); assert.equal(kinds[`${station}:aim7`], 'model'); }
  for (const station of [1, 9]) assert.equal(kinds[`${station}:aim9`], 'fitted');
  assert.equal(kinds['5:tank'], 'generated');
  jet.userData.dispose(); assets.armament.dispose();
  Object.values(jetAssets.geometries).forEach(g => g.dispose()); Object.values(jetAssets.materials).forEach(m => m.dispose());
});

function rendererFixture(storeTemplates, shipId) {
  const world = Object.create(WorldRenderer.prototype), scene = new THREE.Scene();
  Object.assign(world, { scene, missileMeshes: [], fireMap: new THREE.Texture(), storeTemplates });
  const sim = { missiles: [], shipId };
  return { world, sim, update: () => { world._updateMissileMeshes(sim, false); scene.updateMatrixWorld(true); } };
}
const launch = (store, weapon, overrides = {}) => ({ store, weapon, kind: weapon, enemy: false, pos: new THREE.Vector3(0, 900, 0), heading: 0, pitch: 0, ...overrides });
const sharesTemplate = (mesh, id) => mesh.children[0].children.every((m, i) => m.geometry === models.templates[id].children[i].geometry);

test('launched stores, ship missiles and enemy missiles fly as their real-scale models with the exhaust at the tail', () => {
  const { world, sim, update } = rendererFixture(models.templates, 'burke');
  sim.missiles = [launch('pl15', 'anti-air'), launch('aim120', 'anti-air'), launch('harpoon', 'anti-ship'), launch('yj83k', 'anti-ship'),
    launch(undefined, 'anti-air', { enemy: true }), launch(undefined, 'anti-air', { shipLaunched: true }),
    launch(undefined, 'anti-ship', { shipLaunched: true })]; update();
  const expected = ['pl15', 'aim120', 'harpoon', 'yj83k', 'aim7', 'sm2', 'rgm84'];
  world.missileMeshes.slice(0, 7).forEach((mesh, i) => {
    const id = expected[i];
    assert.equal(mesh.userData.visual, `store:${id}`); assert.equal(mesh.children.length, 2, 'model and exhaust');
    assert.deepEqual(mesh.children[0].position.toArray(), [0, 0, 0], 'no pylon hang in flight');
    assert.ok(sharesTemplate(mesh, id), `${id} shares the template geometry`);
    assert.ok(Math.abs(mesh.userData.exhaust.position.z - (models.templates[id].userData.length / 2 + .35)) < 1e-6);
  });
  assert.equal(world.missileMeshes[2].userData.visualKind, 'anti-ship'); assert.equal(world.missileMeshes[4].userData.visualKind, 'sam');
  // A pool slot swaps models without disposing the shared templates.
  let disposed = 0; Object.values(models.templates).forEach(t => t.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++)));
  sim.shipId = 'type052d'; sim.missiles = world.missileMeshes.slice(0, 7).map((_, i) => i === 5 ? launch(undefined, 'anti-air', { shipLaunched: true }) : launch('pl10', 'anti-air'));
  update();
  assert.equal(world.missileMeshes[5].userData.visual, 'store:hq10'); assert.equal(world.missileMeshes[0].userData.visual, 'store:pl10');
  assert.equal(disposed, 0);
});

test('without loaded missile models every launch falls back to the generic missile meshes', () => {
  const { world, sim, update } = rendererFixture(undefined, 'burke');
  sim.missiles = [launch('pl15', 'anti-air'), launch('yj83k', 'anti-ship'), launch(undefined, 'anti-air', { enemy: true }), launch(undefined, 'anti-air', { shipLaunched: true })]; update();
  assert.deepEqual(world.missileMeshes.map(m => m.userData.visual), ['sam', 'anti-ship', 'sam', 'sam']);
});
