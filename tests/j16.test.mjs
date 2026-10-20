import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { makeJ16, J16_ORIGIN_Y, J16_NOZZLES } from '../j16.js';
import { makeJetAssets } from '../aircraft.js';
import { AIRCRAFT } from '../aircraft-systems.js';
import { j16Assets, missileModels } from './j16-fixture.mjs';

const context = new Proxy({}, { get: (t,k) => /create.*Gradient/.test(k) ? () => ({addColorStop(){}}) : () => {} });
const prior = globalThis.document;
globalThis.document = { createElement: () => ({getContext:()=>context}) };
const jetAssets = makeJetAssets();
if (prior === undefined) delete globalThis.document; else globalThis.document = prior;

// An untouched parse of the shipped GLB: the calibration constants and station
// table must stay derivable from the Blender export, not hand-tuned guesses.
const bytes = await readFile(new URL('../assets/models/j16.glb', import.meta.url));
const loader = new GLTFLoader();
loader.register(() => ({ name: 'QA_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const raw = (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
raw.updateMatrixWorld(true);

test('nozzle origin and exits are re-derived from the J-16 fuselage geometry', () => {
  const v = new THREE.Vector3(), rings = { [-1]: [], 1: [] };
  raw.traverse(o => {
    if (!o.isMesh || !o.name.startsWith('J16_fuselage')) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (Math.abs(v.x) > .5 && Math.abs(v.x) < 2.1 && v.y > 1.3 && v.y < 2.7 && v.z > 8.05) rings[Math.sign(v.x)].push(v.clone());
    }
  });
  for (const [side, expected] of [[-1, J16_NOZZLES[0]], [1, J16_NOZZLES[1]]]) {
    const ring = rings[side], box = new THREE.Box3().setFromPoints(ring), centre = box.getCenter(new THREE.Vector3());
    assert.ok(ring.length > 20);
    assert.ok(Math.abs(centre.x - expected[0]) < .01 && Math.abs(centre.y - J16_ORIGIN_Y) < .01 && Math.abs(box.max.z - expected[2]) < .01);
  }
});

test('J-16 stations sit on the baked missile positions of the Blender export', () => {
  const centres = {};
  raw.traverse(o => { const m = o.isMesh && o.name.match(/^(PL-1[05]_.+?)_(body|fins|seeker)$/); if (m) (centres[m[1]] ||= new THREE.Box3()).expandByObject(o); });
  const named = { '左外翼': 'PL-10_outer_wing_port', '左内翼': 'PL-15_inner_wing_port', '左进气道': 'PL-15_under-intake_port', '机腹前': 'PL-15_tunnel_front',
    '机腹后': 'PL-15_tunnel_rear', '右进气道': 'PL-15_under-intake_starboard', '右内翼': 'PL-15_inner_wing_starboard', '右外翼': 'PL-10_outer_wing_starboard' };
  assert.equal(AIRCRAFT.j16.stations.length, 8);
  for (const station of AIRCRAFT.j16.stations) {
    const c = centres[named[station.name]].getCenter(new THREE.Vector3()); c.y -= J16_ORIGIN_Y;
    assert.ok(c.distanceTo(new THREE.Vector3(...station.position)) < .02, `${station.name} ${c.toArray()}`);
    assert.equal(station.x, station.position[0]);
  }
});

test('prepared J-16 asset is metres, nose -Z, gear tagged, and baked missiles become store templates', () => {
  const size = new THREE.Box3().setFromObject(j16Assets.scene).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 21.9) < .01); assert.ok(Math.abs(size.x - 15.247) < .01);
  assert.equal(j16Assets.metadata.forward, '-Z'); assert.ok(Math.abs(j16Assets.metadata.parkedGroundOffset - J16_ORIGIN_Y - .02) < 1e-9);
  let gear = 0, baked = 0, pylons = 0, triangles = 0;
  j16Assets.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
    triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    if (o.userData.role === 'gear') gear++;
    if (/_(body|fins|seeker)$/.test(o.name) && o.name.startsWith('PL-1')) baked++;
    if (/pylon|launch_rail/.test(o.name)) pylons++;
  });
  assert.equal(gear, 18); assert.equal(baked, 0); assert.equal(pylons, 6, 'tunnel/intake pylons and outer rails; inner pylons are wing mesh'); assert.ok(triangles < 13000);
  // Pylons carry the real-scale models (published length), centred on the baked
  // station positions; the fatter YJ-83K keeps its pylon hang offset.
  assert.equal(j16Assets.metadata.storeModels, 'real-scale');
  for (const [store, length, hang] of [['pl15', 3.996, 0], ['pl10', 3, 0], ['yj83k', 5.2, .08]]) {
    const template = j16Assets.templates[store], box = new THREE.Box3().setFromObject(template);
    assert.equal(template, missileModels.templates[store]); assert.equal(template.children.length, 4);
    assert.ok(Math.abs(box.getSize(new THREE.Vector3()).z - length) < .002, `${store} length`);
    assert.ok(box.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, -hang, 0)) < 1e-3, `${store} centre`);
  }
  for (const tip of j16Assets.metadata.wingtips) assert.ok(Math.abs(Math.abs(tip[0]) - 7.495) < .01);
});

test('parked and airborne J-16 share resources, hide gear in flight and place plumes on the nozzles', () => {
  const parked = makeJ16(j16Assets, jetAssets, { parked: true }), flight = makeJ16(j16Assets, jetAssets);
  assert.equal(flight.userData.aircraftId, 'j16'); assert.equal(flight.userData.modelId, 'j16');
  assert.ok(parked.userData.gear.every(o => o.visible)); assert.ok(flight.userData.gear.every(o => !o.visible));
  const fuselage = jet => jet.getObjectByName('J16_fuselage,_wings_&_tail');
  assert.equal(fuselage(parked).geometry, fuselage(flight).geometry);
  assert.ok(flight.userData.airframeScale > .88 && flight.userData.airframeScale < .9);
  for (const plume of [flight.userData.exhaust, flight.userData.exhaustCore]) {
    assert.ok(Math.abs(plume.position.z - 8.095) < .01); assert.ok(Math.abs(plume.position.y) < 1e-9);
  }
  for (let i = 0; i < 30; i++) parked.userData.update(1 / 60, { boost: true, throttle: 1 });
  assert.equal(parked.userData.exhaust.visible, false);
  const visible = []; flight.userData.stores.traverse(o => { if (o.userData.store && o.visible) visible.push(`${o.userData.station}:${o.userData.store}`); });
  assert.deepEqual(visible, []); assert.equal(fuselage(flight).geometry.userData.removedPylons,4); let hardware=0; flight.traverse(o=>{if(/pylon|launch_rail/.test(o.name))hardware++;}); assert.equal(hardware,0);
});

test('J-16 keeps launched-missile templates shared without attaching them to a player aircraft', () => {
  const jet = makeJ16(j16Assets, jetAssets), shared = new Set();
  for (const template of Object.values(j16Assets.templates)) template.traverse(o => { if (o.geometry) shared.add(o.geometry).add(o.material); });
  const used = new Set(); let sharedDisposed = 0, meshes = 0;
  jet.userData.stores.traverse(o => {
    if (!o.isMesh) return;
    meshes++; assert.ok(shared.has(o.geometry) && shared.has(o.material), `${o.name} is shared`); used.add(o.geometry);
  });
  assert.equal(meshes,0); assert.ok(j16Assets.templates.pl15&&j16Assets.templates.pl10&&j16Assets.templates.yj83k);
  used.forEach(g => g.addEventListener('dispose', () => sharedDisposed++));
  jet.userData.dispose(); jet.userData.dispose();
  assert.equal(sharedDisposed, 0, 'an aircraft instance never disposes the shared store templates');
});
