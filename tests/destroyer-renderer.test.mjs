import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeDestroyer, makeDestroyerWake, DESTROYER_MODEL } from '../destroyer.js';
import { ShipCamera } from '../ship-camera.js';
import { WorldRenderer } from '../renderer.js';
import { Simulation } from '../simulation.js';

const vectorClose = (actual, expected, tolerance = 1e-8) => assert.ok(actual.distanceTo(expected) < tolerance,
  `${actual.toArray()} differs from ${expected.toArray()}`);
const direction = (heading, pitch = 0) => new THREE.Vector3(0, 0, -1)
  .applyEuler(new THREE.Euler(pitch, heading, 0, 'YXZ'));
function player(overrides = {}) {
  return { kind: 'destroyer', pos: new THREE.Vector3(0, .5, 3000), heading: 0,
    turretHeading: 0, turretPitch: .3, speed: 18, throttle: 1, health: 300, maxHealth: 300, ...overrides };
}
function cameraFixture(aspect = 16 / 9, overrides = {}) {
  const rig = new ShipCamera(), camera = new THREE.PerspectiveCamera(57, aspect, .5, 90000), target = new THREE.Vector3();
  const p = player(overrides);
  const update = (dt, options = {}) => {
    rig.update(camera, target, p, dt, options); camera.lookAt(target);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  update(0, { reset: true }); return { rig, camera, target, p, update };
}

test('original ship builds without DOM, preserves the 110 m hull and costs ten draw batches', () => {
  const ship = makeDestroyer(); let meshes = 0, triangles = 0;
  ship.traverse(object => {
    if (!object.isMesh) return; meshes++;
    const geometry = object.geometry;
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    assert.ok(Number.isFinite(geometry.boundingSphere?.radius ?? new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).length()));
    triangles += geometry.attributes.position.count / 3;
  });
  assert.equal(meshes, 10); assert.ok(triangles < 3000, `ship has ${triangles} triangles`);
  const hull = ship.getObjectByName('destroyer-hull').geometry.boundingBox;
  assert.equal(hull.min.z, -55); assert.equal(hull.max.z, 55);
  assert.equal(hull.max.x - hull.min.x, 20);
  assert.ok(ship.getObjectByName('destroyer-windows'));
  assert.ok(ship.userData.radar.position.y > 25);
  // The weather deck must face the camera from above, not expose an inverted hull.
  const deck = ship.getObjectByName('destroyer-deck').geometry.attributes;
  let upwardTriangles = 0;
  for (let i = 0; i < deck.position.count; i += 3) {
    if (deck.normal.getY(i) > .9 && deck.position.getY(i) > 4.72) upwardTriangles++;
  }
  assert.ok(upwardTriangles >= 12);
  ship.userData.dispose();
});

test('gun barrel uses the same absolute heading and elevation as simulated shots', () => {
  const ship = makeDestroyer();
  for (const heading of [-Math.PI, -.6, .8, 3.2]) for (const turretHeading of [-1.1, 0, 2.4]) {
    const pitch = .72;
    ship.rotation.y = heading;
    ship.userData.update(1 / 60, { heading, turretHeading, turretPitch: pitch, time: 2 });
    ship.updateMatrixWorld(true);
    const q = ship.userData.gun.getWorldQuaternion(new THREE.Quaternion());
    vectorClose(new THREE.Vector3(0, 0, -1).applyQuaternion(q), direction(turretHeading, pitch));
    const expectedPivot = new THREE.Vector3(...DESTROYER_MODEL.gunPivot).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    vectorClose(ship.userData.gun.getWorldPosition(new THREE.Vector3()), expectedPivot);
  }
  ship.userData.dispose();
});

test('paused ship updates freeze the turret, radar and wave motion despite new telemetry', () => {
  const ship = makeDestroyer(); ship.userData.update(1 / 60, { heading: .4, turretHeading: .8, turretPitch: .6, time: 23 });
  const snapshot = () => JSON.stringify({ turret: ship.userData.turret.rotation, gun: ship.userData.gun.rotation,
    radar: ship.userData.radar.rotation, height: ship.userData.waveHeight, pitch: ship.userData.wavePitch, roll: ship.userData.waveRoll });
  const before = snapshot();
  for (let i = 0; i < 30; i++) ship.userData.update(0, { heading: 2, turretHeading: -2, turretPitch: 1, time: 999 });
  assert.equal(snapshot(), before);
  ship.userData.update(1 / 60, { heading: .4, turretHeading: .8, turretPitch: .6, time: 23 + 1 / 60 });
  assert.notEqual(snapshot(), before);
  ship.userData.dispose();
});

test('ship owns its resources and disposes each geometry and shared material once', () => {
  const ship = makeDestroyer(); const resources = new Set(); let disposals = 0;
  ship.traverse(object => { if (object.geometry) resources.add(object.geometry); if (object.material) resources.add(object.material); });
  resources.forEach(resource => resource.addEventListener('dispose', () => disposals++));
  ship.userData.dispose(); ship.userData.dispose(); assert.equal(disposals, resources.size);
});

test('stern foam uses one four-triangle mesh and lies just above the ocean', () => {
  const wake = makeDestroyerWake();
  assert.equal(wake.geometry.attributes.position.count / 3, 4);
  for (let i = 0; i < wake.geometry.attributes.position.count; i++) assert.equal(wake.geometry.attributes.position.getY(i), 0);
  assert.ok(wake.position.y > 0 && wake.position.y < .1);
  assert.equal(wake.material.map.image.width, 64);
  assert.equal(wake.userData.skipWaterReflection, true);
  assert.equal(wake.visible, false);
  wake.geometry.dispose(); wake.material.map.dispose(); wake.material.dispose();
});

test('ship orbit follows translation exactly and starts 200 m behind its elevated focus at 20 degrees', () => {
  const moving = cameraFixture(), stationary = cameraFixture();
  vectorClose(moving.camera.position.clone().sub(moving.p.pos), new THREE.Vector3(0, 18 + Math.sin(Math.PI / 9) * 200, Math.cos(Math.PI / 9) * 200));
  for (let frame = 0; frame < 360; frame++) {
    moving.p.pos.z -= 18 / 60; moving.update(1 / 60); stationary.update(1 / 60);
    vectorClose(moving.camera.position.clone().sub(moving.p.pos), stationary.camera.position.clone().sub(stationary.p.pos));
  }
});

test('all hull extremities stay visible at every zoom in landscape and portrait, including side-on orbit', () => {
  for (const aspect of [16 / 9, 4 / 3, 390 / 844, 320 / 932, 3 / 4]) {
    for (const yaw of [0, .45, Math.PI / 2, Math.PI]) for (const zoom of [.78, 1, 1.4]) {
      const { rig, camera, p, update } = cameraFixture(aspect); rig.orbit(yaw, 0); update(0, { reset: true, zoom });
      for (const x of [-10, 10]) for (const z of [-55, 55]) for (const y of [0, 29.2]) {
        const point = new THREE.Vector3(x, y, z).add(p.pos).project(camera);
        assert.ok(Math.abs(point.x) < .985 && Math.abs(point.y) < .985 && point.z > -1 && point.z < 1,
          `ship clips at aspect ${aspect}, yaw ${yaw}, zoom ${zoom}: ${point.toArray()}`);
      }
      const forward = p.pos.clone().addScaledVector(direction(yaw), 1600).project(camera);
      assert.ok(Math.abs(forward.x) < .2 && Math.abs(forward.y) < .8, 'retain the forward sea horizon');
    }
  }
});

test('free follow view ignores cannon elevation and sees initial sea targets', () => {
  const sim = new Simulation(7331); sim.start('naval-training', 'normal', 'destroyer');
  for (const aspect of [16 / 9, 390 / 844]) for (const zoom of [.78, 1, 1.4]) {
    for (const pitch of [.3, .8, 1.3]) {
      const { camera, p, update } = cameraFixture(aspect, { ...sim.player, turretPitch: pitch });
      update(0, { reset: true, zoom });
      vectorClose(camera.getWorldDirection(new THREE.Vector3()), direction(p.heading, -Math.PI / 36));
      for (const enemy of sim.enemies) {
        const projected = enemy.pos.clone().project(camera);
        assert.ok(Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95 && projected.z > -1 && projected.z < 1,
          `initial enemy invisible at aspect ${aspect}: ${projected.toArray()}`);
      }
    }
  }
});

test('default follow reticle lies on the first 760 m training target instead of the player vessel', () => {
  const sim = new Simulation(7331); sim.start('naval-training', 'normal', 'destroyer');
  const { camera, p } = cameraFixture(16 / 9, sim.player);
  const target = sim.enemies[0], aim = target.pos.clone(); aim.y += target.aimHeight;
  const targetDirection = aim.clone().sub(camera.position).normalize();
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).angleTo(targetDirection) < THREE.MathUtils.degToRad(.1));
  const projected = aim.project(camera);
  assert.ok(Math.abs(projected.x) < .01 && Math.abs(projected.y) < .01);
  assert.ok(p.pos.clone().project(camera).y < -.35);
});

test('bridge view stays on the bridge while looking along the actual turret bearing and elevation', () => {
  for (const heading of [-1, 0, 2]) for (const pitch of [0, .3, 1.35]) {
    const { camera, p, update } = cameraFixture(16 / 9, { heading, turretHeading: heading + .6, turretPitch: pitch });
    update(0, { reset: true, cockpit: true });
    const expected = new THREE.Vector3(...DESTROYER_MODEL.bridgeEye).applyAxisAngle(new THREE.Vector3(0, 1, 0), heading).add(p.pos);
    vectorClose(camera.position, expected);
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), direction(p.turretHeading, pitch));
    assert.equal(camera.fov, 76);
  }
});

test('zero dt freezes ship camera motion, FOV and zoom, while a view reset remains immediate', () => {
  const { rig, camera, target, p, update } = cameraFixture();
  const snapshot = () => JSON.stringify({ rig, camera: camera.matrixWorld.elements, fov: camera.fov, target });
  const before = snapshot(); p.turretHeading = 1; p.turretPitch = 1; p.pos.addScalar(30);
  for (let frame = 0; frame < 20; frame++) update(0, { zoom: 1.4 });
  assert.equal(snapshot(), before);
  update(0, { reset: true, cockpit: true }); assert.notEqual(snapshot(), before);
});

function worldFixture() {
  const world = Object.create(WorldRenderer.prototype), scene = new THREE.Scene();
  const playerJet = new THREE.Group(); let jetUpdates = 0;
  playerJet.userData.update = () => jetUpdates++;
  const uniforms = { time: { value: 0 }, cameraPositionWorld: { value: new THREE.Vector3() } };
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2 * 90 * 6), 3));
  const tracerGeometry = new THREE.BufferGeometry();
  tracerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900 * 6), 3));
  tracerGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(900 * 6), 3));
  const activeEffects = [];
  Object.assign(world, { scene, camera: new THREE.PerspectiveCamera(57, 16 / 9, .5, 90000),
    playerJet, playerShip: makeDestroyer(), shipWake: makeDestroyerWake(), sky: new THREE.Group(), ocean: new THREE.Group(),
    sun: new THREE.DirectionalLight(), enemies: new Map(), missileMeshes: [], cameraTarget: new THREE.Vector3(),
    lastPos: new THREE.Vector3(), trail: [], elapsed: 0, cameraZoom: 1, effectiveQuality: 'low',
    tracerGeometry, tracerPositions: tracerGeometry.attributes.position.array, tracerColors: tracerGeometry.attributes.color.array,
    trailGeometry, trailPositions: trailGeometry.attributes.position.array,
    trailLines: new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial()), particleSprites: [],
    terrain: { userData: { update() {} } }, renderer: { info: { reset() {} }, render() {} }, reflection: { update() {} },
    speedEffects: { update(camera, player, dt, elapsed, options) { activeEffects.push(options.active); } },
  });
  world.sky.material = { uniforms: { time: { value: 0 } } }; world.ocean.material = { uniforms };
  scene.add(playerJet, world.playerShip, world.shipWake);
  return { world, activeEffects, jetUpdates: () => jetUpdates };
}

test('renderer swaps ship and aircraft repeatedly, resets the camera, and keeps bridge model visible', () => {
  const { world } = worldFixture();
  const ship = { vehicle: 'destroyer', state: 'playing', player: player(), time: 0 };
  const plane = { state: 'playing', player: { ...player(), kind: 'aircraft', speed: 185, pos: new THREE.Vector3(0, 2200, 3000), pitch: 0, bank: 0 } };
  for (let cycle = 0; cycle < 3; cycle++) {
    world.render(ship, 1 / 60); assert.equal(world.playerShip.visible, true); assert.equal(world.playerJet.visible, false);
    assert.equal(world.sun.shadow.camera.right, 76);
    assert.ok(world.camera.position.distanceTo(ship.player.pos) > 180);
    world.render(ship, 0, { cockpit: true }); assert.equal(world.playerShip.visible, true);
    assert.ok(world.camera.position.distanceTo(ship.player.pos) < 30); assert.equal(world.camera.fov, 76);
    world.render(plane, 1 / 60); assert.equal(world.playerShip.visible, false); assert.equal(world.playerJet.visible, true);
    assert.equal(world.sun.shadow.camera.right, 22);
    assert.ok(world.camera.position.distanceTo(plane.player.pos) < 35); assert.equal(world.shipWake.visible, false);
  }
});

test('ship rendering disables jet exhaust updates, aircraft speed effects and wing trails; pause freezes waves', () => {
  const { world, activeEffects, jetUpdates } = worldFixture();
  const sim = { vehicle: 'destroyer', state: 'playing', player: player(), time: 7 };
  world.trail.push([new THREE.Vector3(), new THREE.Vector3()]); world.render(sim, 1 / 60);
  assert.equal(jetUpdates(), 0); assert.deepEqual(activeEffects, [false]); assert.equal(world.trail.length, 0);
  assert.equal(world.trailGeometry.drawRange.count, 0); assert.equal(world.shipWake.visible, true);
  assert.equal(world.shipWake.position.y, .065);
  const before = { matrix: world.camera.matrixWorld.elements.slice(), position: world.playerShip.position.clone(),
    radar: world.playerShip.userData.radar.rotation.y, gun: world.playerShip.userData.gun.rotation.x, time: world.ocean.material.uniforms.time.value, elapsed: world.elapsed };
  sim.state = 'paused';
  for (let frame = 0; frame < 30; frame++) world.render(sim, 0);
  assert.deepEqual(world.camera.matrixWorld.elements, before.matrix); assert.deepEqual(world.playerShip.position, before.position);
  assert.equal(world.playerShip.userData.radar.rotation.y, before.radar); assert.equal(world.playerShip.userData.gun.rotation.x, before.gun);
  assert.equal(world.ocean.material.uniforms.time.value, before.time); assert.equal(world.elapsed, before.elapsed);
  sim.player.speed = 0; world.render(sim, 0); assert.equal(world.shipWake.visible, false);
});
