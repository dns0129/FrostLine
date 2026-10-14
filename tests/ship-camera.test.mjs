import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { ShipCamera } from '../ship-camera.js';
import { terrainHeight } from '../world-math.js';

const tau = Math.PI * 2;
const angularDistance = (a, b) => THREE.MathUtils.euclideanModulo(a - b + Math.PI, tau) - Math.PI;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance,
  `${actual} differs from ${expected}`);
const vectorClose = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-8,
  `${actual.toArray()} differs from ${expected.toArray()}`);
const direction = (heading, pitch) => new THREE.Vector3(0, 0, -1)
  .applyEuler(new THREE.Euler(pitch, heading, 0, 'YXZ'));
const shipFocus = player => player.pos.clone().add(new THREE.Vector3(0, 18, 0));
function fixture({ aspect = 16 / 9, heading = 0, pos = new THREE.Vector3(0, .5, 3000) } = {}) {
  const rig = new ShipCamera(), camera = new THREE.PerspectiveCamera(57, aspect, .5, 90000);
  const target = new THREE.Vector3(), player = { pos, heading, turretHeading: 1.9, turretPitch: 1.1 };
  const update = (dt = 1 / 60, options = {}) => {
    rig.update(camera, target, player, dt, options);
    camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  };
  update(0, { reset: true }); return { rig, camera, target, player, update };
}

test('first external view starts behind the current hull, independent of cannon direction', () => {
  for (const heading of [-2.8, -.7, 0, 2.4]) {
    const { rig, camera, player, target } = fixture({ heading });
    close(angularDistance(rig.yaw, heading), 0); close(rig.pitch, Math.PI / 9);
    const expected = new THREE.Vector3(Math.sin(heading) * Math.cos(Math.PI / 9) * 200,
      18 + Math.sin(Math.PI / 9) * 200, Math.cos(heading) * Math.cos(Math.PI / 9) * 200);
    vectorClose(camera.position.clone().sub(player.pos), expected);
    vectorClose(target.clone().sub(camera.position).normalize(), direction(heading, -Math.PI / 36));
    close(camera.position.distanceTo(shipFocus(player)), 200);
  }
});

test('default center ray aims at sea 700–900 m ahead while the vessel stays below the reticle', () => {
  for (const heading of [-2.1, 0, 1.3]) {
    const { camera, player } = fixture({ heading });
    const ray = camera.getWorldDirection(new THREE.Vector3());
    const hit = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y);
    const range = hit.clone().sub(player.pos).dot(direction(heading, 0));
    assert.ok(range > 700 && range < 900, `default sea aim is ${range} m ahead`);
    close(hit.y, 0);
    const vessel = player.pos.clone().project(camera);
    assert.ok(vessel.y < -.35 && vessel.y > -.8, `vessel should sit below reticle: ${vessel.toArray()}`);
  }
});

test('user orbit keeps its world bearing while vessel steering and turret aim change', () => {
  const { rig, camera, target, player, update } = fixture();
  rig.orbit(.92, .17); update(0, { reset: true });
  const offset = camera.position.clone().sub(player.pos), focus = target.clone().sub(player.pos);
  for (let frame = 0; frame < 180; frame++) {
    player.heading += .012; player.turretHeading -= .018; player.turretPitch = frame % 2 ? 1.35 : -.04;
    player.pos.x += .27; player.pos.z -= .12; update();
    vectorClose(camera.position.clone().sub(player.pos), offset);
    vectorClose(target.clone().sub(player.pos), focus);
    close(rig.yaw, .92); close(rig.pitch, Math.PI / 9 + .17);
  }
});

test('continuous horizontal dragging completes a full orbit without a jump at the angle boundary', () => {
  const { rig, update } = fixture(); let travelled = 0, previous = rig.viewYaw;
  for (let segment = 0; segment < 24; segment++) {
    rig.orbit(tau / 24, 0);
    for (let frame = 0; frame < 20; frame++) {
      update(); const change = angularDistance(rig.viewYaw, previous);
      assert.ok(change > 0 && change < .08, `discontinuous orbit increment ${change}`);
      travelled += change; previous = rig.viewYaw;
    }
  }
  for (let frame = 0; frame < 120; frame++) update();
  assert.ok(travelled > tau - .012 && travelled < tau);
  close(angularDistance(rig.viewYaw, 0), 0, 1e-8);
});

test('orbit elevation clamps at 12 and 75 degrees and rejects non-finite deltas', () => {
  const { rig, update } = fixture();
  rig.orbit(0, -100); close(rig.pitch, Math.PI / 15); update(0, { reset: true });
  rig.orbit(0, 100); close(rig.pitch, Math.PI * 5 / 12); update(0, { reset: true });
  const yaw = rig.yaw, pitch = rig.pitch;
  rig.orbit(NaN, Infinity); close(rig.yaw, yaw); close(rig.pitch, pitch);
});

test('rapid orbit changes keep camera distance outside the hull throughout interpolation', () => {
  const { rig, camera, player, update } = fixture();
  rig.orbit(Math.PI, .75);
  for (let frame = 0; frame < 120; frame++) {
    update(); close(camera.position.distanceTo(shipFocus(player)), 200);
    assert.ok(camera.position.y >= 8);
  }
});

test('external orbit preserves all hull and mast extremities at elevation limits and portrait zoom', () => {
  for (const aspect of [16 / 9, 390 / 844, 320 / 932]) for (const zoom of [.78, 1.4]) {
    for (const yaw of [0, .7, Math.PI / 2, Math.PI]) for (const pitch of [Math.PI / 15, Math.PI / 9, Math.PI * 5 / 12]) {
      const { rig, camera, player, update } = fixture({ aspect });
      rig.orbit(yaw, pitch - rig.pitch); update(0, { reset: true, zoom });
      for (const x of [-10, 10]) for (const y of [0, 29.2]) for (const z of [-55, 55]) {
        const projected = new THREE.Vector3(x, y, z).add(player.pos).project(camera);
        assert.ok(Math.abs(projected.x) < .96 && Math.abs(projected.y) < .96 && projected.z > -1 && projected.z < 1,
          `hull clips at aspect=${aspect} zoom=${zoom} yaw=${yaw} pitch=${pitch}: ${projected.toArray()}`);
      }
    }
  }
});

test('bridge switch keeps the chosen external orbit and recenter uses the new hull bearing', () => {
  const { rig, camera, player, update } = fixture();
  rig.orbit(-1.2, .31); update(0, { reset: true });
  const external = camera.position.clone();
  update(0, { reset: true, cockpit: true });
  assert.ok(camera.position.distanceTo(external) > 100);
  close(rig.yaw, -1.2); close(rig.pitch, Math.PI / 9 + .31);
  update(0, { reset: true }); vectorClose(camera.position, external);
  player.heading = 2.6; rig.recenter(player.heading); update(0, { reset: true });
  close(rig.yaw, 2.6); close(rig.pitch, Math.PI / 9);
  close(angularDistance(Math.atan2(camera.position.x - player.pos.x, camera.position.z - player.pos.z), 2.6), 0);
});

test('pause freezes orbit transform and zoom until simulation time resumes', () => {
  const { rig, camera, target, player, update } = fixture();
  const before = { position: camera.position.clone(), target: target.clone(), fov: camera.fov, zoom: rig.zoom, yaw: rig.viewYaw };
  rig.orbit(.8, .3); player.pos.x += 50;
  for (let frame = 0; frame < 30; frame++) update(0, { zoom: 1.4 });
  vectorClose(camera.position, before.position); vectorClose(target, before.target);
  close(camera.fov, before.fov); close(rig.zoom, before.zoom); close(rig.viewYaw, before.yaw);
  update(); assert.ok(camera.position.distanceTo(before.position) > 10); assert.ok(rig.viewYaw > 0);
});

test('zoom retains the previous .78–1.4 limits and remains finite for invalid input', () => {
  const { rig, camera, player, update } = fixture();
  update(0, { reset: true, zoom: -100 }); close(rig.zoom, .78); close(camera.position.distanceTo(shipFocus(player)), 156);
  update(0, { reset: true, zoom: 100 }); close(rig.zoom, 1.4); close(camera.position.distanceTo(shipFocus(player)), 280);
  update(0, { reset: true, zoom: NaN }); close(rig.zoom, 1); close(camera.position.distanceTo(shipFocus(player)), 200);
});

test('shore-facing orbit clears terrain towards the vessel without changing the selected center-ray direction', () => {
  const { camera, target, player } = fixture({ heading: -Math.PI / 2, pos: new THREE.Vector3(-2450, .5, -3700) });
  const focus = shipFocus(player);
  assert.ok(terrainHeight(focus.x, focus.z) < 0, 'vessel fixture must be in navigable water');
  assert.ok(terrainHeight(camera.position.x, camera.position.z) > 90, 'orbit must extend across the shore');
  assert.ok(camera.position.y >= terrainHeight(camera.position.x, camera.position.z) + 8);
  for (let sample = 1; sample <= 160; sample++) {
    const point = focus.clone().lerp(camera.position, sample / 160);
    assert.ok(point.y >= terrainHeight(point.x, point.z) + 4, `terrain blocks sightline at ${point.toArray()}`);
  }
  vectorClose(target.clone().sub(camera.position).normalize(), direction(player.heading, -Math.PI / 36));
});
