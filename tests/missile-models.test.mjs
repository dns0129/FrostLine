import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { STORES } from '../aircraft-systems.js';
import { MISSILE_MODEL_IDS, prepareMissileModels } from '../missile-models.js';
import { WorldRenderer } from '../renderer.js';
import { loadMissileFixture } from './missile-fixture.mjs';

const models = await loadMissileFixture();
const radial = (mesh, cb) => {
  const p = mesh.geometry.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrix); cb(Math.hypot(v.x, v.y + 0), v); }
};

test('runtime missile templates keep the published length and body diameter, nose -Z, centred on the body axis', () => {
  assert.deepEqual(Object.keys(models.templates).sort(), [...MISSILE_MODEL_IDS].sort());
  for (const id of MISSILE_MODEL_IDS) {
    const template = models.templates[id], info = models.metadata.stores[id], { length, radius, hang = 0 } = STORES[id].visual;
    assert.ok(Math.abs(info.length_m - length) < 1e-3 && Math.abs(info.diameter_m / 2 - radius) < 1e-3, `${id} visual matches the model`);
    assert.equal(template.position.y, -hang);
    const box = new THREE.Box3(); template.children.forEach(m => box.expandByObject(m));
    assert.ok(Math.abs(box.max.z - box.min.z - length) < .002, `${id} length`);
    assert.ok(Math.abs(box.max.z + box.min.z) < .002 && Math.abs(box.max.x + box.min.x) < .002, `${id} centred`);
    const body = template.children.find(m => m.name === `${id}_body`), seeker = template.children.find(m => m.name === `${id}_seeker`);
    let onSkin = 0; radial(body, r => { if (Math.abs(r - radius) < 1e-3) onSkin++; });
    assert.ok(onSkin > 8, `${id} body skin sits at the published radius`);
    let maxSeeker = 0; radial(seeker, r => { maxSeeker = Math.max(maxSeeker, r); });
    assert.ok(maxSeeker <= radius + 1e-3);
    const nose = new THREE.Box3().setFromObject(seeker).getCenter(new THREE.Vector3());
    assert.ok(nose.z < -.3 * length, `${id} seeker is at the -Z nose`);
  }
});

test('templates are light enough for eight stores and many launches, and share their common materials', () => {
  let total = 0; const materials = new Map();
  for (const id of MISSILE_MODEL_IDS) {
    let triangles = 0;
    models.templates[id].traverse(o => {
      if (!o.isMesh) return;
      for (const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
      const role = o.name.split('_')[1]; if (!materials.has(role)) materials.set(role, new Set()); materials.get(role).add(o.material);
    });
    assert.ok(triangles < 800, `${id} has ${triangles} triangles`); total += triangles;
  }
  assert.ok(total < 2000);
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
  assert.equal(geometries, 12); assert.ok(materials >= 6 && materials <= 8);
  assert.throws(() => prepareMissileModels(new THREE.Group(), { ...owner.metadata, glb_axes: '+Z up' }), /incompatible/);
});

function rendererFixture(storeTemplates) {
  const world = Object.create(WorldRenderer.prototype), scene = new THREE.Scene();
  Object.assign(world, { scene, missileMeshes: [], fireMap: new THREE.Texture(), storeTemplates });
  const sim = { missiles: [] };
  return { world, sim, update: () => { world._updateMissileMeshes(sim, false); scene.updateMatrixWorld(true); } };
}
const launch = (store, weapon, overrides = {}) => ({ store, weapon, kind: weapon, enemy: false, pos: new THREE.Vector3(0, 900, 0), heading: 0, pitch: 0, ...overrides });

test('a launched PL-15, PL-10 or YJ-83K flies as its real-scale model; enemy and ship missiles keep the generic shapes', () => {
  const { world, sim, update } = rendererFixture(models.templates);
  sim.missiles = [launch('pl15', 'anti-air'), launch('pl10', 'anti-air'), launch('yj83k', 'anti-ship'),
    launch('pl15', 'anti-air', { enemy: true }), launch(undefined, 'anti-ship')]; update();
  const [pl15, pl10, yj83k, enemy, ship] = world.missileMeshes;
  for (const [mesh, id, kind] of [[pl15, 'pl15', 'sam'], [pl10, 'pl10', 'sam'], [yj83k, 'yj83k', 'anti-ship']]) {
    assert.equal(mesh.userData.visual, `store:${id}`); assert.equal(mesh.userData.visualKind, kind);
    assert.equal(mesh.children.length, 2, 'model and exhaust');
    const model = mesh.children[0], template = models.templates[id];
    assert.deepEqual(model.position.toArray(), [0, 0, 0], 'no pylon hang in flight');
    model.children.forEach((m, i) => { assert.equal(m.geometry, template.children[i].geometry); assert.equal(m.material, template.children[i].material); });
    assert.ok(Math.abs(mesh.userData.exhaust.position.z - (STORES[id].visual.length / 2 + .35)) < 1e-6);
  }
  assert.equal(enemy.userData.visual, 'sam'); assert.equal(enemy.children[0].geometry, world.missileAssets.geometries.sam);
  assert.equal(ship.userData.visual, 'anti-ship');
  // The pool slot swaps between a store model and a generic missile without disposing shared templates.
  let disposed = 0; Object.values(models.templates).forEach(t => t.traverse(o => o.geometry?.addEventListener('dispose', () => disposed++)));
  sim.missiles = [launch(undefined, 'anti-air'), launch('pl10', 'anti-air')]; update();
  assert.equal(world.missileMeshes[0].userData.visual, 'sam'); assert.equal(pl15.parent, null); assert.equal(world.missileMeshes[1], pl10);
  sim.missiles = [launch('pl15', 'anti-air')]; update();
  assert.equal(world.missileMeshes[0].userData.visual, 'store:pl15'); assert.equal(disposed, 0);
});

test('without loaded store models every launch falls back to the generic missile meshes', () => {
  const { world, sim, update } = rendererFixture(undefined);
  sim.missiles = [launch('pl15', 'anti-air'), launch('yj83k', 'anti-ship')]; update();
  assert.deepEqual(world.missileMeshes.map(m => m.userData.visual), ['sam', 'anti-ship']);
});
