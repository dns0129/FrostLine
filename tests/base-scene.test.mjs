import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { BaseScene, baseCameraPose } from '../base-scene.js';
import { makeJetAssets, makeJet } from '../aircraft.js';
import { OWNED_VEHICLES, vehicleById, aircraftIdFor } from '../vehicle-catalog.js';
import { normalizeWorkshop, effectiveAircraft } from '../aircraft-systems.js';
import { Simulation, DESTROYER } from '../simulation.js';
import { fa18Assets } from './fa18-fixture.mjs';
import { j16Assets } from './j16-fixture.mjs';

test('owned inventory contains only playable vehicles and takes loadouts from simulation', () => {
  assert.deepEqual(OWNED_VEHICLES.map(v => v.id), ['aircraft', 'j16', 'destroyer']);
  assert.deepEqual(OWNED_VEHICLES.map(v => aircraftIdFor(v.id)), ['fa18c', 'j16', null]);
  assert.equal(OWNED_VEHICLES[0].code,'F/A-18C'); assert.equal(OWNED_VEHICLES[1].code,'J-16');
  const player = new Simulation().player;
  assert.equal(Number(OWNED_VEHICLES[0].stats[2][1]), player.ammo);
  assert.equal(Number(OWNED_VEHICLES[0].stats[3][1]), player.missiles);
  const sim = new Simulation(); sim.configureAircraft(null, 'j16'); sim.start('intercept', 'normal', 'j16');
  assert.equal(Number(OWNED_VEHICLES[1].stats[1][1]), sim.player.ammo);
  assert.equal(Number(OWNED_VEHICLES[1].stats[2][1]), sim.player.missiles);
  assert.equal(Number(OWNED_VEHICLES[2].stats[2][1]), DESTROYER.maxAmmo);
  assert.ok(OWNED_VEHICLES[2].weapons.includes(`反舰导弹 ${DESTROYER.maxAntiShipMissiles} 枚`));
  const profile = normalizeWorkshop(null), j16 = vehicleById('j16', profile), stats = effectiveAircraft('j16', profile);
  assert.ok(j16.weapons.startsWith(`GSh-30-1 ${stats.maxAmmo} 发`)); assert.equal(j16.stats[2][1], `${stats.air} / ${stats.sea}`);
});

test('display camera scales for portrait and keeps the entire vehicle above the ground', () => {
  for (const id of ['aircraft', 'j16', 'destroyer']) {
    for (const yaw of [-10, -2.36, 0, .82, 10]) {
      for (const aspect of [.45, 1, 1.78, 2.2]) {
        for (const zoom of [.2, 1, 10]) {
          const pose = baseCameraPose(id, yaw, .24, zoom, aspect);
          assert.ok([...pose.position, ...pose.target].every(Number.isFinite));
          assert.ok(pose.position[1] > pose.target[1]);
        }
      }
    }
    const portrait = baseCameraPose(id, .82, .24, 1, .45);
    const wide = baseCameraPose(id, .82, .24, 1, 1.78);
    assert.ok(new THREE.Vector3(...portrait.position).length() > new THREE.Vector3(...wide.position).length() * 2.5);
  }
});

test('base switching and inspection keep simulation and shared aircraft materials unchanged', () => {
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : /create.*Gradient/.test(key) ? () => gradient : () => {} });
  const prior = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const assets = makeJetAssets(), jet = makeJet(assets);
    const simulation = new Simulation(); const before = JSON.stringify(simulation);
    const viewport = { addEventListener() {}, getBoundingClientRect: () => ({ left: 285, top: 100, width: 670, height: 378 }) };
    const base = new BaseScene({ jetAssets: assets, fa18Assets, j16Assets, width: 1280, height: 720, renderer: { info: { reset() {} }, render() {} } }, viewport);
    assert.notEqual(base.jet, jet);
    assert.notEqual(base.jet.userData.exhaust.material, jet.userData.exhaust.material);
    assert.equal(base.jet.userData.exhaust.visible, false);
    assert.equal(jet.userData.exhaust.visible, true);
    const count = base.scene.children.length;
    for (let i = 0; i < 100; i++) { base.setVehicle(i % 2 ? 'aircraft' : 'destroyer'); base.orbit(.1, .03); }
    assert.equal(base.scene.children.length, count);
    assert.equal(JSON.stringify(simulation), before);
    base.setVehicle('aircraft'); base.orbit(.75); base.render(100); assert.equal(base.hangarSides[0].visible, false, 'near-side shelter wall is cut away during orbit');
    base.orbit(1.61); base.render(200); assert.equal(base.hangarBack.visible, false, 'rear shelter wall cannot block inspection');
    base.setVehicle('j16'); assert.equal(base.air.visible, true); assert.equal(base.jet.userData.aircraftId, 'j16');
    assert.equal(base.jets.aircraft.visible, false); assert.equal(base.jet.visible, true); assert.ok(base.jet.userData.gear.every(g => g.visible));
    assert.ok(baseCameraPose('j16', .82, .24, 1).position[0] > baseCameraPose('aircraft', .82, .24, 1).position[0]);
    base.setVehicle('aircraft'); assert.equal(base.jets.j16.visible, false); assert.equal(base.jet.userData.aircraftId, 'fa18c');
    base.setVehicle('destroyer'); assert.equal(base.air.visible, false); assert.equal(base.naval.visible, true);
    base.orbit(10, 10); base.reset(); assert.equal(base.pitch, .28); assert.equal(base.zoom, 1);
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});
