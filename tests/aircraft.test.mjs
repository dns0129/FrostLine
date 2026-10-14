import test from 'node:test';
import assert from 'node:assert/strict';
import { makeJetAssets, makeJet } from '../aircraft.js';

// These checks exercise real Three.js geometry and resources; a tiny canvas
// stub is sufficient because raster appearance is checked in the browser.
const gradient = { addColorStop() {} };
const context = new Proxy({}, { get: (target, key) => key in target ? target[key]
  : key === 'createLinearGradient' ? () => gradient : () => {} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const assets = makeJetAssets();
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
const settle = (jet, state, seconds = 1) => {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) jet.userData.update(1 / 60, state);
};

test('detailed jet keeps eight static draw batches and bounded finite geometry', () => {
  assert.equal(Object.keys(assets.geometries).length, 8);
  let triangles = 0;
  for (const geometry of [...Object.values(assets.geometries), assets.exhaustGeometry, assets.exhaustCoreGeometry]) {
    const { position, normal, uv } = geometry.attributes;
    assert.ok(position.count > 0);
    assert.equal(normal.count, position.count);
    assert.equal(uv.count, position.count);
    for (const attribute of Object.values(geometry.attributes)) {
      assert.ok(attribute.array.every(Number.isFinite), 'all vertex data must remain finite');
    }
    assert.ok(Number.isFinite(geometry.boundingSphere.radius));
    triangles += position.count / 3;
  }
  assert.ok(triangles < 25000, `triangle budget exceeded: ${triangles}`);
  const body = assets.geometries.body.boundingBox;
  assert.ok(body.min.x < -8.4 && body.max.x > 8.4, 'retain both full wings');
  assert.ok(body.max.y > 3.6, 'retain raised twin tails');
  assert.ok(assets.geometries.glass.boundingBox.max.y > 1.7, 'canopy encloses the pilot');
});

test('plume texture runs from a bright nozzle base to a faded downstream tip', () => {
  const { position, uv } = assets.exhaustGeometry.attributes;
  for (let i = 0; i < position.count; i++) {
    assert.ok(Math.abs(uv.getY(i) - position.getY(i) / 4.15) < 1e-6);
  }
});

test('per-aircraft boost varies materials without modifying shared geometry or another aircraft', () => {
  const player = makeJet(assets), enemy = makeJet(assets, true);
  const exhaust = player.userData.exhaust, other = enemy.userData.exhaust;
  assert.equal(exhaust.geometry, other.geometry);
  assert.equal(player.userData.exhaustCore.geometry, enemy.userData.exhaustCore.geometry);
  assert.notEqual(exhaust.material, other.material);
  settle(player, { throttle: 1, boost: false });
  settle(enemy, { throttle: 1, boost: false });
  const idleLength = exhaust.scale.y, idleOpacity = exhaust.material.opacity;
  const enemyLength = other.scale.y, enemyOpacity = other.material.opacity;
  settle(player, { throttle: 1, boost: true });
  assert.ok(exhaust.scale.y > idleLength * 1.8, 'afterburner visibly extends the plume');
  assert.ok(exhaust.material.opacity > idleOpacity * 1.8, 'afterburner brightens the plume');
  assert.equal(player.userData.exhaustCore.visible, true);
  assert.equal(enemy.userData.exhaustCore.visible, false);
  assert.equal(other.scale.y, enemyLength);
  assert.equal(other.material.opacity, enemyOpacity);
  assert.ok(exhaust.material.color.b > exhaust.material.color.r, 'boost shifts from amber toward blue-white');
});

test('afterburner fades smoothly, respects paused time and accepts a numeric intensity', () => {
  const jet = makeJet(assets);
  settle(jet, { throttle: .8, afterburner: 1 });
  const length = jet.userData.exhaust.scale.y;
  jet.userData.update(0, { throttle: .8, afterburner: 0 });
  assert.equal(jet.userData.exhaust.scale.y, length, 'paused time cannot advance boost fade or flutter');
  jet.userData.update(1 / 60, { throttle: .8, afterburner: 0 });
  assert.ok(jet.userData.exhaust.scale.y > length * .9, 'releasing boost cannot snap to idle');
  settle(jet, { throttle: .8, afterburner: 0 });
  assert.equal(jet.userData.exhaustCore.visible, false);
  const idle = jet.userData.exhaust.scale.y;
  settle(jet, { throttle: .8, afterburner: .5 });
  const half = jet.userData.exhaust.scale.y;
  settle(jet, { throttle: .8, afterburner: 1 });
  assert.ok(half > idle && half < jet.userData.exhaust.scale.y);
});

test('invalid optional telemetry cannot corrupt an aircraft transform or material', () => {
  const jet = makeJet(assets);
  for (const dt of [NaN, Infinity, -1, undefined]) {
    jet.userData.update(dt, { throttle: NaN, boost: Infinity });
    assert.ok(Number.isFinite(jet.userData.exhaust.scale.y));
    assert.ok(Number.isFinite(jet.userData.exhaust.material.opacity));
    assert.ok(Number.isFinite(jet.userData.exhaustCore.material.opacity));
  }
});

test('removing a jet disposes only its owned materials, once, and retains shared resources', () => {
  const jet = makeJet(assets, true);
  let materialDisposals = 0, sharedDisposals = 0;
  for (const material of [jet.userData.exhaust.material, jet.userData.exhaustCore.material]) {
    material.addEventListener('dispose', () => materialDisposals++);
  }
  for (const resource of [...Object.values(assets.geometries), ...Object.values(assets.materials),
    assets.exhaustGeometry, assets.exhaustCoreGeometry, ...Object.values(assets.textures)]) {
    resource.addEventListener('dispose', () => sharedDisposals++);
  }
  jet.userData.dispose(); jet.userData.dispose();
  assert.equal(materialDisposals, 2);
  assert.equal(sharedDisposals, 0);
});
