import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { ChaseCamera } from '../chase-camera.js';
import { terrainHeight } from '../world-math.js';

function fixture(aspect = 16 / 9, overrides = {}) {
  const rig = new ChaseCamera();
  const camera = new THREE.PerspectiveCamera(65, aspect, .5, 90000);
  const target = new THREE.Vector3();
  const player = {pos: new THREE.Vector3(0, 3000, 0), speed: 185, heading: 0, pitch: 0, bank: 0, boost: false, ...overrides};
  const update = (dt, options = {}) => {
    rig.update(camera, target, player, dt, options);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  update(0, {reset: true});
  return {rig, camera, target, player, update};
}

test('fast translation cannot add world-position damping distance to the close chase view', () => {
  for (const speed of [150, 185, 320, 650]) {
    const moving = fixture(16 / 9, {speed, boost: speed >= 320});
    const stationary = fixture(16 / 9, {speed, boost: speed >= 320});
    const initialDistance = moving.camera.position.distanceTo(moving.player.pos);
    assert.ok(initialDistance > 25 && initialDistance < 32, `close chase distance at ${speed} m/s: ${initialDistance}`);
    for (let frame = 0; frame < 360; frame++) {
      moving.player.pos.z -= speed / 60;
      moving.update(1 / 60);
      stationary.update(1 / 60);
      const movingOffset = moving.camera.position.clone().sub(moving.player.pos);
      const stationaryOffset = stationary.camera.position.clone().sub(stationary.player.pos);
      assert.ok(movingOffset.distanceTo(stationaryOffset) < 1e-9, 'camera translation must track the aircraft exactly');
      assert.ok(Math.abs(moving.camera.position.distanceTo(moving.player.pos) - initialDistance) < 1e-9);
    }
  }
});

test('afterburner widens the view smoothly and release restores the cruising composition', () => {
  const {camera, player, update} = fixture();
  const cruiseFov = camera.fov, cruisePosition = camera.position.clone();
  player.boost = true;
  update(1 / 60);
  assert.ok(camera.fov > cruiseFov && camera.fov < cruiseFov + .2, 'first boost frame must not snap to the wide FOV');
  let previousFov = camera.fov;
  for (let frame = 1; frame < 180; frame++) {
    update(1 / 60);
    assert.ok(camera.fov >= previousFov, 'boost FOV should approach its target without oscillation');
    previousFov = camera.fov;
  }
  assert.ok(camera.fov > cruiseFov + 9.9 && camera.fov < cruiseFov + 10.01);
  assert.ok(camera.position.distanceTo(cruisePosition) > 2 && camera.position.distanceTo(cruisePosition) < 3.1);
  player.boost = false;
  update(1 / 60);
  assert.ok(camera.fov < previousFov && camera.fov > previousFov - .2, 'release must ease back rather than snap');
  for (let frame = 1; frame < 240; frame++) update(1 / 60);
  assert.ok(Math.abs(camera.fov - cruiseFov) < .001);
  assert.ok(camera.position.distanceTo(cruisePosition) < .001);
});

test('zero dt freezes the entire camera rig even when player input or zoom changes', () => {
  const {rig, camera, target, player, update} = fixture();
  player.boost = true; player.heading = .6; player.bank = .8;
  for (let frame = 0; frame < 12; frame++) update(1 / 60);
  const snapshot = () => JSON.stringify({rig, position: camera.position, up: camera.up, fov: camera.fov, target, matrix: camera.matrixWorld.elements});
  const before = snapshot();
  player.boost = false; player.heading = 1.2; player.pitch = -.7; player.pos.addScalar(100);
  for (let frame = 0; frame < 20; frame++) update(0, {zoom: 1.4});
  assert.equal(snapshot(), before);
});

function turnAtFrameRate(hz) {
  const state = fixture();
  for (let frame = 1; frame <= hz * 4; frame++) {
    const time = frame / hz;
    state.player.heading = .45 * time;
    state.player.pitch = .13 * Math.sin(time * 1.3);
    state.player.bank = .8 * Math.sin(time * .9);
    state.player.pos.set(185 * time, 3000 + time * 20, -185 * time);
    state.update(1 / hz);
  }
  return state;
}

test('turn anticipation and bank response remain comparable at 30, 60, 120 and 144 Hz', () => {
  const reference = turnAtFrameRate(144);
  for (const hz of [30, 60, 120]) {
    const sample = turnAtFrameRate(hz);
    assert.ok(sample.camera.position.distanceTo(reference.camera.position) < .06, `${hz} Hz chase position differs materially`);
    assert.ok(sample.target.distanceTo(reference.target) < .15, `${hz} Hz look target differs materially`);
    assert.ok(sample.camera.up.distanceTo(reference.camera.up) < .006, `${hz} Hz horizon tilt differs materially`);
  }
});

test('portrait framing keeps both complete wing tips inside the image at every supported zoom', () => {
  for (const aspect of [390 / 844, 320 / 932, 3 / 4]) for (const zoom of [.78, 1, 1.4]) {
    const {camera, player, update} = fixture(aspect);
    update(0, {reset: true, zoom});
    // Current K-7 outer wing / wingtip rail envelope, expressed in aircraft metres.
    for (const x of [-8.6, 8.6]) for (const z of [4.72, 6.9]) {
      const projected = new THREE.Vector3(x, -.23, z).add(player.pos).project(camera);
      assert.ok(Math.abs(projected.x) < .98 && Math.abs(projected.y) < .98 && projected.z > -1 && projected.z < 1,
        `wing clipped at aspect ${aspect}, zoom ${zoom}: ${projected.toArray()}`);
    }
  }
});

test('vertical flight and full rolls keep a finite camera above the sampled terrain', () => {
  for (const [x, z] of [[0, 0], [-4800, -3700], [5100, -7300]]) {
    const {camera, target, player, update} = fixture();
    player.pos.set(x, terrainHeight(x, z) + 7, z);
    for (let frame = 0; frame < 480; frame++) {
      player.pitch = Math.PI / 2 * Math.sin(frame / 480 * Math.PI * 4);
      player.heading = frame / 480 * Math.PI * 2;
      player.bank = frame / 480 * Math.PI * 8;
      update(1 / 60, {reset: frame === 0});
      assert.ok([...camera.position.toArray(), ...target.toArray(), ...camera.matrixWorld.elements, camera.fov].every(Number.isFinite));
      assert.ok(camera.position.y >= terrainHeight(camera.position.x, camera.position.z) + 3.5 - 1e-9, 'camera penetrated the terrain');
      assert.ok(camera.position.distanceTo(player.pos) < 100, 'camera escaped its follow envelope');
    }
  }
});
