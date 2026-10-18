import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import * as THREE from '../vendor/three.module.js';
import { ChaseCamera } from '../chase-camera.js';

const dt = 1 / 60;
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

for (const direction of [-1, 1]) {
  test(`continuous ${direction > 0 ? 'pull-up' : 'push-over'} completes two full loops without a vertical stop`, () => {
    const sim = new Simulation();
    sim.start('training');
    sim.player.pos.set(0, 3200, 0);
    let travel = 0, previous = 0, lastDirection = new THREE.Vector3(0, 0, -1);
    const rig = new ChaseCamera(), camera = new THREE.PerspectiveCamera(57, 16 / 9, .5, 90000), target = new THREE.Vector3();
    rig.update(camera, target, sim.player, 0, { reset: true });
    for (let frame = 0; frame < 60 * 60 && Math.abs(travel) < Math.PI * 4; frame++) {
      sim._updatePlayer(dt, { pitch: direction, boost: true });
      const p = sim.player;
      travel += delta(p.pitch, previous); previous = p.pitch;
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(p.pitch, p.heading, p.bank, 'YXZ'));
      assert.ok(forward.angleTo(lastDirection) < .03, 'nose direction remains continuous through vertical and angle wrapping');
      lastDirection.copy(forward);
      assert.ok(p.pos.y > 500 && p.pos.y < 6500, 'loop stays clear of ground and ceiling recovery');
      rig.update(camera, target, p, dt);
      camera.lookAt(target);
      assert.ok([...camera.position, ...camera.quaternion].every(Number.isFinite));
    }
    assert.ok(travel * direction >= Math.PI * 4, `completed pitch rotation: ${travel}`);
  });

  test(`combined pitch and ${direction > 0 ? 'right' : 'left'} roll remains controllable through multiple rolls`, () => {
    const sim = new Simulation();
    sim.start('training'); sim.player.pos.set(0, 3200, 0);
    let travel = 0, previous = 0;
    for (let frame = 0; frame < 60 * 12; frame++) {
      sim._updatePlayer(dt, { roll: direction, pitch: .5, boost: true });
      travel += delta(sim.player.bank, previous); previous = sim.player.bank;
      assert.ok([sim.player.pitch, sim.player.heading, sim.player.bank, ...sim.player.vel].every(Number.isFinite));
    }
    assert.ok(travel * direction > Math.PI * 4);
  });
}
