import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeEnemyShip, makeDestroyer, makeDestroyerWake, ENEMY_SHIP_MODELS } from '../destroyer.js';
import { makeJetAssets } from '../aircraft.js';
import { WorldRenderer } from '../renderer.js';

// Aircraft is retained in the mixed enemy-map regression. Only its generated
// texture canvas needs a stub; enemy ships themselves have no DOM dependency.
const gradient = { addColorStop() {} }, context = new Proxy({}, { get: (target, key) => key in target ? target[key]
  : key === 'createLinearGradient' ? () => gradient : () => {} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({ getContext: () => context }) };
const jetAssets = makeJetAssets();
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;

const close = (a, b) => assert.ok(a.distanceTo(b) < 1e-8, `${a.toArray()} vs ${b.toArray()}`);
const forward = (heading, pitch) => new THREE.Vector3(0, 0, -1)
  .applyEuler(new THREE.Euler(pitch, heading, 0, 'YXZ'));
const enemy = (id, type = 'patrol', overrides = {}) => ({ id, kind: 'ship', shipType: type,
  pos: new THREE.Vector3(0, .5, 3240), heading: 0, speed: 8, health: 100, maxHealth: 100,
  turretHeading: .2, turretPitch: .03, aimHeight: ENEMY_SHIP_MODELS[type].targetAimHeight, ...overrides });
function fixture() {
  const world = Object.create(WorldRenderer.prototype), scene = new THREE.Scene();
  const playerJet = new THREE.Group(); playerJet.userData.update = () => {};
  const tracerGeometry = new THREE.BufferGeometry(), trailGeometry = new THREE.BufferGeometry();
  tracerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 6), 3));
  tracerGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(900 * 6), 3));
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 90 * 6), 3));
  const sky = new THREE.Group(), ocean = new THREE.Group();
  sky.material = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, skyPanorama: { value: new THREE.Texture() } } });
  ocean.material = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 }, cameraPositionWorld: { value: new THREE.Vector3() }, waveNormalMap: { value: new THREE.Texture() } } });
  Object.assign(world, { scene, playerJet, playerShip: makeDestroyer(), shipWake: makeDestroyerWake(),
    jetAssets, sun: new THREE.DirectionalLight(), enemies: new Map(), enemyWakes: new Map(), missileMeshes: [],
    camera: new THREE.PerspectiveCamera(57, 16 / 9, .5, 90000), cameraTarget: new THREE.Vector3(), lastPos: new THREE.Vector3(),
    sky, ocean, elapsed: 0, trail: [], cameraZoom: 1, width: 1280, height: 720, effectiveQuality: 'low',
    tracerGeometry, tracerPositions: tracerGeometry.attributes.position.array, tracerColors: tracerGeometry.attributes.color.array,
    trailGeometry, trailPositions: trailGeometry.attributes.position.array, trailLines: new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial()),
    particleSprites: [], fireMap: null, terrain: { userData: { update() {}, dispose() {} } },
    renderer: { info: { reset() {} }, render() {}, dispose() {} }, reflection: { update() {}, dispose() {} },
    speedEffects: { update() {}, dispose() {} },
  });
  scene.add(playerJet, world.playerShip, world.shipWake);
  const sim = { vehicle: 'destroyer', state: 'playing', mode: 'naval-training', time: 0,
    player: { kind: 'destroyer', pos: new THREE.Vector3(0, .5, 4000), heading: 0, speed: 0, health: 300,
      turretHeading: 0, turretPitch: .006 }, enemies: [], particles: [], tracers: [], missiles: [] };
  const render = (dt = 1 / 60, options = {}) => world.render(sim, dt, options);
  return { world, sim, render };
}

test('patrol and frigate have distinct bounded silhouettes matching collision dimensions and a seven-draw budget', () => {
  const ships = [makeEnemyShip('patrol'), makeEnemyShip('frigate')];
  for (const ship of ships) {
    const definition = ENEMY_SHIP_MODELS[ship.userData.shipType], bounds = new THREE.Box3().setFromObject(ship);
    assert.equal(bounds.max.x - bounds.min.x, definition.beam);
    assert.equal(bounds.max.z - bounds.min.z, definition.length);
    assert.ok(Math.abs(bounds.max.y - definition.collisionTop) < 1e-6);
    assert.equal(ship.userData.targetAimHeight, definition.targetAimHeight);
    let draws = 0, triangles = 0;
    ship.traverse(object => {
      if (!object.isMesh) return; draws++; triangles += object.geometry.attributes.position.count / 3;
      for (const attribute of Object.values(object.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
      assert.ok(Number.isFinite(object.geometry.boundingSphere.radius));
    });
    assert.equal(draws, 7); assert.ok(triangles < 1100);
  }
  assert.notEqual(ships[0].name, ships[1].name);
  assert.notEqual(ships[0].getObjectByName('enemy-patrol-hull').material.color.getHex(),
    ships[1].getObjectByName('enemy-frigate-hull').material.color.getHex());
  ships.forEach(ship => ship.userData.dispose());
});

test('enemy gun pivot and world direction track the same absolute bearing and elevation as the simulation', () => {
  for (const type of ['patrol', 'frigate']) {
    const ship = makeEnemyShip(type), definition = ENEMY_SHIP_MODELS[type];
    for (const heading of [-2, 0, 1.6]) for (const turretHeading of [-1, .3, 2.4]) {
      const turretPitch = .4; ship.rotation.y = heading;
      ship.userData.update(1 / 60, { heading, turretHeading, turretPitch, time: 2 }); ship.updateMatrixWorld(true);
      close(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.userData.gun.getWorldQuaternion(new THREE.Quaternion())), forward(turretHeading, turretPitch));
      close(ship.userData.gun.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(...definition.gunPivot)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), heading));
    }
    ship.userData.dispose();
  }
});

test('four enemy ships share class geometry/materials and keep all instance gun transforms independent', () => {
  const ships = [makeEnemyShip('patrol'), makeEnemyShip('patrol'), makeEnemyShip('frigate'), makeEnemyShip('frigate')];
  const geometries = new Set(), materials = new Set(); let draws = 0;
  ships.forEach(ship => ship.traverse(object => { if (object.isMesh) { draws++; geometries.add(object.geometry); materials.add(object.material); } }));
  assert.equal(draws, 28); assert.equal(geometries.size, 14); assert.equal(materials.size, 10);
  ships[0].userData.update(1 / 60, { turretHeading: 1.2, turretPitch: .6 });
  ships[1].userData.update(1 / 60, { turretHeading: -.4, turretPitch: .03 });
  assert.notEqual(ships[0].userData.turret.rotation.y, ships[1].userData.turret.rotation.y);
  assert.notEqual(ships[0].userData.gun.rotation.x, ships[1].userData.gun.rotation.x);
  ships.forEach(ship => ship.userData.dispose());
});

test('removing one ship retains shared resources; the last instance releases the cache exactly once', () => {
  const a = makeEnemyShip('patrol'), b = makeEnemyShip('patrol'), resources = new Set(); let disposals = 0;
  a.traverse(object => { if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); });
  resources.forEach(resource => resource.addEventListener('dispose', () => disposals++));
  const oldHull = a.getObjectByName('enemy-patrol-hull').geometry;
  a.userData.dispose(); a.userData.dispose(); assert.equal(disposals, 0);
  b.userData.update(1 / 60, { turretHeading: .2 }); assert.equal(b.userData.turret.rotation.y, .2);
  b.userData.dispose(); b.userData.dispose(); assert.equal(disposals, resources.size);
  const next = makeEnemyShip('patrol'); assert.notEqual(next.getObjectByName('enemy-patrol-hull').geometry, oldHull); next.userData.dispose();
});

test('paused enemy telemetry leaves turret and wave offsets unchanged and invalid values remain finite', () => {
  const ship = makeEnemyShip('frigate'); ship.userData.update(1 / 60, { heading: .2, turretHeading: .4, turretPitch: .1, time: 4 });
  const snapshot = () => JSON.stringify({ turret: ship.userData.turret.rotation, gun: ship.userData.gun.rotation,
    y: ship.userData.waveHeight, pitch: ship.userData.wavePitch, roll: ship.userData.waveRoll });
  const before = snapshot(); ship.userData.update(0, { heading: 2, turretHeading: -2, turretPitch: 1, time: 500 }); assert.equal(snapshot(), before);
  ship.userData.update(NaN, { heading: NaN, turretHeading: Infinity, turretPitch: NaN, time: NaN });
  assert.ok([ship.userData.turret.rotation.y, ship.userData.gun.rotation.x, ship.userData.waveHeight].every(Number.isFinite));
  ship.userData.dispose();
});

test('renderer mixes aircraft and ships in one map and removes killed hulls plus owned wakes', () => {
  const { world, sim, render } = fixture();
  sim.enemies = [enemy('hostile-ship-1'), enemy('hostile-ship-2', 'frigate', { pos: new THREE.Vector3(250, .5, 2900) }),
    { id: 'bandit-1', pos: new THREE.Vector3(400, 600, 2400), health: 100, heading: 0, pitch: 0, bank: 0 }];
  render(); assert.equal(world.enemies.size, 3); assert.equal(world.enemyWakes.size, 2);
  const patrol = world.enemies.get('hostile-ship-1'), frigate = world.enemies.get('hostile-ship-2'), plane = world.enemies.get('bandit-1');
  assert.equal(patrol.userData.kind, 'ship'); assert.equal(frigate.userData.shipType, 'frigate');
  assert.equal(patrol.userData.exhaust, undefined); assert.equal(frigate.userData.exhaust, undefined);
  assert.ok(plane.userData.exhaust); assert.equal(world.enemyWakes.get('hostile-ship-1').visible, true);
  assert.equal(world.enemyWakes.get('hostile-ship-1').position.y, .065);
  const wake = world.enemyWakes.get('hostile-ship-1'); let wakeDisposed = 0;
  for (const resource of [wake.geometry, wake.material, wake.material.map]) resource.addEventListener('dispose', () => wakeDisposed++);
  sim.enemies[0].health = 0; render(); assert.equal(world.enemies.has('hostile-ship-1'), false);
  assert.equal(world.enemyWakes.has('hostile-ship-1'), false); assert.equal(wakeDisposed, 3); assert.equal(patrol.parent, null);
  sim.enemies = []; render(); assert.equal(world.enemies.size, 0); assert.equal(world.enemyWakes.size, 0);
});

test('same enemy id can change between patrol, aircraft and frigate without stale models or wake leaks', () => {
  const { world, sim, render } = fixture(); sim.enemies = [enemy('reused-id')]; render();
  const patrol = world.enemies.get('reused-id'), wake = world.enemyWakes.get('reused-id');
  sim.enemies = [{ id: 'reused-id', pos: new THREE.Vector3(0, 500, 3000), health: 100 }]; render();
  assert.ok(world.enemies.get('reused-id').userData.exhaust); assert.equal(world.enemyWakes.size, 0);
  assert.equal(patrol.parent, null); assert.equal(wake.parent, null);
  const plane = world.enemies.get('reused-id'); sim.enemies = [enemy('reused-id', 'frigate')]; render();
  assert.equal(world.enemies.get('reused-id').userData.shipType, 'frigate'); assert.equal(plane.parent, null);
  assert.equal(world.enemyWakes.size, 1); sim.enemies = []; render();
});

test('repeated waves release all ship resources and renderer disposal releases active caches once', () => {
  const { world, sim, render } = fixture();
  for (let wave = 0; wave < 4; wave++) {
    sim.enemies = [enemy('a'), enemy('b'), enemy('c', 'frigate'), enemy('d', 'frigate')]; render();
    const resources = new Set(); let disposed = 0;
    for (const model of world.enemies.values()) model.traverse(object => { if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); });
    for (const wake of world.enemyWakes.values()) { resources.add(wake.geometry); resources.add(wake.material); resources.add(wake.material.map); }
    resources.forEach(resource => resource.addEventListener('dispose', () => disposed++));
    if (wave === 3) world.dispose(); else { sim.enemies = []; render(); }
    assert.equal(disposed, resources.size); assert.equal(world.enemies.size, 0); assert.equal(world.enemyWakes.size, 0);
  }
});

test('sea combat camera retains own hull, level-fire aim and deck-height target markers at each supported zoom', () => {
  const { world, sim, render } = fixture();
  sim.enemies = [enemy('hostile-ship-1', 'patrol', { speed: 0 }), enemy('hostile-ship-2', 'frigate', { pos: new THREE.Vector3(250, .5, 2900), speed: 0 })];
  for (const aspect of [16 / 9, 390 / 844]) for (const zoom of [.78, 1, 1.4]) {
    world.camera.aspect = aspect; world.cameraZoom = zoom; world.cameraReady = false; render();
    const aim = sim.player.pos.clone().add(new THREE.Vector3(0, 8, -32)).addScaledVector(forward(0, .006), 1600);
    assert.equal(world.project(aim).visible, true);
    for (const target of sim.enemies) assert.equal(world.project(target.pos.clone().add(new THREE.Vector3(0, target.aimHeight, 0))).visible, true);
    for (const x of [-10, 10]) for (const z of [-55, 55]) {
      assert.equal(world.project(sim.player.pos.clone().add(new THREE.Vector3(x, 4, z))).visible, true);
    }
  }
  sim.enemies = []; render();
});

test('enemy model and wake freeze through paused renders, then menu hides both without reallocating assets', () => {
  const { world, sim, render } = fixture(); sim.time = 3; sim.enemies = [enemy('hostile-ship-1')]; render();
  const ship = world.enemies.get('hostile-ship-1'), wake = world.enemyWakes.get('hostile-ship-1');
  const snapshot = () => JSON.stringify({ position: ship.position, rotation: ship.rotation, gun: ship.userData.gun.rotation,
    turret: ship.userData.turret.rotation, wakePosition: wake.position, wakeScale: wake.scale });
  const before = snapshot(); sim.state = 'paused'; for (let frame = 0; frame < 20; frame++) render(0); assert.equal(snapshot(), before);
  render(0, { menu: true }); assert.equal(ship.visible, false); assert.equal(wake.visible, false);
  render(0); assert.equal(world.enemies.get('hostile-ship-1'), ship); assert.equal(ship.visible, true);
  sim.enemies = []; render();
});

test('ship sinking uses the existing explosion/smoke renderer after the enemy model has been removed', () => {
  const { world, sim, render } = fixture(); sim.enemies = [enemy('sunk-ship')]; render();
  sim.enemies[0].health = 0;
  sim.particles = [
    { kind: 'explosion', pos: new THREE.Vector3(0, 5, 3240), life: .4, maxLife: .5, size: 15 },
    { kind: 'smoke', pos: new THREE.Vector3(0, 8, 3240), life: 2, maxLife: 3, size: 13 },
  ]; render();
  assert.equal(world.enemies.size, 0); assert.equal(world.particleSprites.length, 2);
  assert.ok(world.particleSprites.every(sprite => sprite.visible));
  assert.equal(world.particleSprites[0].material.blending, THREE.AdditiveBlending);
  assert.equal(world.particleSprites[1].material.blending, THREE.NormalBlending);
});
