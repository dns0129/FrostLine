import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { WorldRenderer, makeMissileAssets, missileVisualKind } from '../renderer.js';
import { ShipCamera } from '../ship-camera.js';

const missile = (weapon = 'anti-ship', overrides = {}) => ({ kind: weapon, weapon,
  pos: new THREE.Vector3(0, 15, 3500), heading: 0, pitch: 0, enemy: false, ...overrides });
function fixture() {
  const world = Object.create(WorldRenderer.prototype), scene = new THREE.Scene();
  const sky = new THREE.Group(), ocean = new THREE.Group();
  sky.material = new THREE.ShaderMaterial({ uniforms: { skyPanorama: { value: new THREE.Texture() } } });
  ocean.material = new THREE.ShaderMaterial({ uniforms: { waveNormalMap: { value: new THREE.Texture() } } });
  let rendererDisposals = 0;
  Object.assign(world, { scene, missileMeshes: [], enemies: new Map(), enemyWakes: new Map(), fireMap: new THREE.Texture(),
    playerJet: new THREE.Group(), jetAssets: { geometries: {}, materials: {}, textures: {},
      exhaustGeometry: new THREE.BufferGeometry(), exhaustCoreGeometry: new THREE.BufferGeometry() },
    sky, ocean, terrain: { userData: { dispose() {} } }, sun: new THREE.DirectionalLight(),
    speedEffects: { dispose() {} }, reflection: { dispose() {} }, renderer: { dispose() { rendererDisposals++; } },
    camera: new THREE.PerspectiveCamera(82, 16 / 9, .5, 90000), width: 1280, height: 720,
  });
  scene.add(sky, ocean);
  const sim = { state: 'playing', missiles: [] };
  return { world, sim, update: (menu = false) => { world._updateMissileMeshes(sim, menu); scene.updateMatrixWorld(true); }, rendererDisposals: () => rendererDisposals };
}

test('anti-ship geometry has a visibly wider winged body and keeps both missile types finite and inexpensive', () => {
  const assets = makeMissileAssets();
  const sam = assets.geometries.sam, cruise = assets.geometries['anti-ship'];
  assert.ok(cruise.boundingBox.max.x - cruise.boundingBox.min.x > 1.8);
  assert.ok(sam.boundingBox.max.x - sam.boundingBox.min.x < .4);
  assert.ok(cruise.boundingBox.max.z - cruise.boundingBox.min.z > 5.7);
  assert.ok(sam.boundingBox.max.z - sam.boundingBox.min.z < 3);
  for (const geometry of Object.values(assets.geometries)) {
    assert.ok(geometry.attributes.position.count / 3 < 150);
    assert.ok(Number.isFinite(geometry.boundingSphere.radius));
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
  }
  assert.notEqual(assets.materials.antiShipFlame.color.getHex(), assets.materials.samFlame.color.getHex());
  Object.values(assets.geometries).forEach(geometry => geometry.dispose()); Object.values(assets.materials).forEach(material => material.dispose());
});

test('only exact anti-ship weapon tags select the cruise missile silhouette', () => {
  assert.equal(missileVisualKind({ weapon: 'anti-ship' }), 'anti-ship');
  assert.equal(missileVisualKind({ kind: 'anti-ship' }), 'anti-ship');
  for (const state of [{ kind: 'ship' }, { weapon: 'sam' }, { kind: 'aircraft' }, { enemy: true }, {}]) {
    assert.equal(missileVisualKind(state), 'sam');
  }
});

test('the same pool slot changes between ASm, SAM and enemy SAM without leaving old groups or disposing shared assets', () => {
  const { world, sim, update } = fixture(); sim.missiles = [missile()]; update();
  const asm = world.missileMeshes[0], assets = world.missileAssets; let earlyDisposals = 0;
  for (const resource of [...Object.values(assets.geometries), ...Object.values(assets.materials)]) resource.addEventListener('dispose', () => earlyDisposals++);
  assert.equal(asm.userData.visualKind, 'anti-ship'); assert.equal(asm.userData.exhaust.material, assets.materials.antiShipFlame);
  sim.missiles = [missile('sam')]; update(); const sam = world.missileMeshes[0];
  assert.notEqual(sam, asm); assert.equal(asm.parent, null); assert.equal(asm.children.length, 0);
  assert.equal(sam.children[0].geometry, assets.geometries.sam); assert.equal(sam.userData.exhaust.material, assets.materials.samFlame);
  sim.missiles[0].enemy = true; update(); assert.equal(world.missileMeshes[0], sam);
  assert.equal(sam.userData.enemy, true); assert.equal(sam.userData.exhaust.material, assets.materials.enemyFlame);
  sim.missiles = [missile()]; update(); assert.equal(sam.parent, null);
  assert.equal(world.missileMeshes[0].children[0].geometry, assets.geometries['anti-ship']);
  assert.equal(earlyDisposals, 0); assert.equal(world.scene.children.filter(child => child.userData.visualKind).length, 1);
  world.dispose();
});

test('twenty-four missiles share two geometries and the pool ignores excess entries instead of growing unbounded', () => {
  const { world, sim, update } = fixture();
  sim.missiles = Array.from({ length: 40 }, (_, i) => missile(i % 2 ? 'sam' : 'anti-ship', { enemy: i % 3 === 0 })); update();
  assert.equal(world.missileMeshes.length, 24); assert.equal(world.scene.children.filter(child => child.userData.visualKind).length, 24);
  const geometries = new Set(world.missileMeshes.map(group => group.children[0].geometry)); assert.equal(geometries.size, 2);
  sim.missiles = []; update(); assert.ok(world.missileMeshes.every(group => group.visible === false));
  const pool = world.missileMeshes.slice(); sim.missiles = Array.from({ length: 24 }, (_, i) => missile(i % 2 ? 'sam' : 'anti-ship')); update();
  assert.deepEqual(world.missileMeshes, pool); world.dispose();
});

test('many alternating missile volleys retain bounded scene objects and shared GPU resources', () => {
  const { world, sim, update } = fixture();
  sim.missiles = [missile()]; update(); const assets = world.missileAssets;
  for (let volley = 0; volley < 80; volley++) {
    sim.missiles = Array.from({ length: 24 }, () => missile(volley % 2 ? 'sam' : 'anti-ship')); update();
    assert.equal(world.missileAssets, assets); assert.equal(world.missileMeshes.length, 24);
    assert.equal(world.scene.children.filter(child => child.userData.visualKind).length, 24);
    assert.ok(world.missileMeshes.every(group => group.children.length === 2));
    sim.missiles = []; update();
  }
  world.dispose();
});

test('sea-skimming cruise missiles remain above water and visible from external and bridge cameras', () => {
  const { world, sim, update } = fixture();
  const player = { pos: new THREE.Vector3(0, .5, 4000), heading: 0, turretHeading: 0, turretPitch: .006 };
  const target = new THREE.Vector3(), rig = new ShipCamera();
  for (const height of [12, 15, 18]) for (const cockpit of [false, true]) {
    sim.missiles = [missile('anti-ship', { pos: new THREE.Vector3(0, height, 3500) })]; update();
    const mesh = world.missileMeshes[0]; assert.equal(mesh.visible, true); assert.equal(mesh.position.y, height);
    assert.equal(mesh.userData.skipWaterReflection, undefined);
    rig.update(world.camera, target, player, 0, { reset: true, cockpit }); world.camera.lookAt(target);
    world.camera.updateProjectionMatrix(); world.camera.updateMatrixWorld();
    assert.equal(world.project(mesh.position).visible, true);
    const bodyBounds = new THREE.Box3().setFromObject(mesh.children[0]); assert.ok(bodyBounds.min.y > 10);
  }
  world.dispose();
});

test('pause reuses existing instances and the missile points along the real heading and pitch', () => {
  const { world, sim, update } = fixture();
  sim.missiles = [missile('anti-ship', { heading: .6, pitch: .2 }), missile('sam', { pitch: Math.PI / 2 })]; update();
  const groups = world.missileMeshes.slice(), assets = world.missileAssets;
  const snapshot = () => JSON.stringify(world.missileMeshes.map(group => ({ uuid: group.uuid, position: group.position,
    rotation: group.rotation, matrix: group.matrixWorld.elements, material: group.userData.exhaust.material.uuid })));
  const before = snapshot(); sim.state = 'paused'; for (let frame = 0; frame < 80; frame++) update();
  assert.equal(snapshot(), before); assert.deepEqual(world.missileMeshes, groups); assert.equal(world.missileAssets, assets);
  const expected = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(.2, .6, 0, 'YXZ'));
  const actual = new THREE.Vector3(0, 0, -1).applyQuaternion(groups[0].getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actual.distanceTo(expected) < 1e-8);
  update(true); assert.ok(groups.every(group => !group.visible)); update(); assert.ok(groups.every(group => group.visible));
  world.dispose();
});

test('renderer disposal releases both used and retired missile resources exactly once, including the shared fire texture', () => {
  const { world, sim, update, rendererDisposals } = fixture();
  sim.missiles = [missile('sam')]; update(); const assets = world.missileAssets;
  sim.missiles = [missile('anti-ship')]; update();
  const resources = [...Object.values(assets.geometries), ...Object.values(assets.materials), world.fireMap];
  let disposals = 0; resources.forEach(resource => resource.addEventListener('dispose', () => disposals++));
  world.dispose(); world.dispose(); assert.equal(disposals, resources.length); assert.equal(rendererDisposals(), 1);
});

test('an empty paused missile pool does not allocate unused model assets', () => {
  const { world, sim, update } = fixture(); sim.state = 'paused'; for (let frame = 0; frame < 80; frame++) update();
  assert.equal(world.missileAssets, undefined); assert.equal(world.missileMeshes.length, 0); world.dispose();
});
