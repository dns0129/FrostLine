import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { SpeedEffects, speedEffectTarget } from '../speed-effects.js';

function setup(quality = 'high') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(61, 16 / 9, .5, 90000);
  camera.position.set(0, 1100, 4000);
  const player = { speed: 245, vel: new THREE.Vector3(0, 0, -245), heading: 0, pitch: 0 };
  return { scene, camera, player, effect: new SpeedEffects(scene, { quality }) };
}

test('airflow follows afterburner gradually and freezes completely during a pause', () => {
  const { effect, camera, player } = setup();
  const target = speedEffectTarget(player.speed, 1);
  effect.update(camera, player, 1 / 60, 0, { boostAmount: 1 });
  assert.ok(effect.intensity > 0 && effect.intensity < target * .2);
  for (let i = 0; i < 40; i++) effect.update(camera, player, 1 / 60, i / 60, { boostAmount: 1 });
  const boosted = effect.intensity;
  const positions = effect.positions.slice();
  const cycles = effect.cycles.slice();
  effect.update(camera, player, 0, 99999, { boostAmount: 0 });
  assert.equal(effect.intensity, boosted);
  assert.deepEqual(effect.positions, positions);
  assert.deepEqual(effect.cycles, cycles);
  effect.update(camera, player, 1 / 60, 1, { boostAmount: 0 });
  assert.ok(effect.intensity < boosted && effect.intensity > boosted * .9);
  effect.dispose();
});

test('airflow particles retain their world position while the camera passes them', () => {
  const { effect, camera, player } = setup();
  effect.update(camera, player, .1, .1, { boostAmount: 1 });
  const worldPositions = effect.particles.map(point => point.clone());
  camera.position.z -= 1;
  effect.update(camera, player, .1, .2, { boostAmount: 1 });
  const retained = worldPositions.filter((point, index) => point.equals(effect.particles[index])).length;
  assert.ok(retained > effect.count * .8, 'airflow must have world parallax rather than move with the screen');
  player.vel.set(-175, 45, -100);
  effect.update(camera, player, .1, .3, { boostAmount: 1 });
  const upstream = new THREE.Vector3().fromArray(effect.positions).sub(new THREE.Vector3().fromArray(effect.positions, 3)).normalize();
  assert.ok(upstream.dot(player.vel.clone().normalize()) > .99999, 'streaks align with the actual velocity during turns');
  effect.dispose();
});

test('quality, inactivity, and disposal bound the effect cost and lifecycle', () => {
  const { scene, effect, camera, player } = setup('low');
  assert.equal(scene.children.length, 1);
  assert.ok(effect.count <= 40);
  assert.equal(effect.lines.userData.skipWaterReflection, true);
  const lowCount = effect.geometry.drawRange.count;
  effect.setQuality('high');
  assert.ok(effect.geometry.drawRange.count > lowCount);
  assert.ok(effect.geometry.drawRange.count <= 192);
  effect.update(camera, player, .1, .1, { boostAmount: 1 });
  effect.update(camera, player, .1, .2, { active: false });
  assert.equal(effect.lines.visible, false);
  assert.equal(effect.intensity, 0);
  let geometryDisposed = 0, materialDisposed = 0;
  effect.geometry.addEventListener('dispose', () => geometryDisposed++);
  effect.material.addEventListener('dispose', () => materialDisposed++);
  effect.dispose();
  effect.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(geometryDisposed, 1);
  assert.equal(materialDisposed, 1);
});
