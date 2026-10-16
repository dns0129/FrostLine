import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { FA18_HARDPOINTS, makeFA18ArmamentAssets, makeFA18Armament } from '../fa18-armament.js';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);

test('six measured hardpoints preserve metre-scale missile dimensions within two shared draw batches', () => {
  const assets = makeFA18ArmamentAssets(), stores = makeFA18Armament(assets);
  try {
    assert.deepEqual(FA18_HARDPOINTS.map(s => s.id), ['innerL', 'innerR', 'outerL', 'outerR', 'tipL', 'tipR']);
    assert.equal(stores.children.length, 2);
    assert.equal(stores.userData.medium.geometry, assets.geometries.medium);
    assert.equal(stores.userData.short.geometry, assets.geometries.short);
    assert.ok(stores.children.every(mesh => mesh.isInstancedMesh && mesh.material === assets.material && mesh.castShadow && mesh.receiveShadow));
    assert.equal(assets.material.vertexColors, true);
    let triangles = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const [type, geometry] of Object.entries(assets.geometries)) {
      const position = geometry.attributes.position, normals = geometry.attributes.normal;
      const expected = type === 'medium' ? [3.66, .089, .265] : [2.87, .0635, .3];
      near(geometry.boundingBox.max.z - geometry.boundingBox.min.z, expected[0]);
      assert.equal(geometry.userData.bodyRadius, expected[1]);
      assert.equal(geometry.userData.finRadius, expected[2]);
      assert.equal(position.count % 3, 0);
      for (const attribute of Object.values(geometry.attributes)) {
        assert.equal(attribute.count, position.count);
        assert.ok(attribute.array.every(Number.isFinite));
      }
      for (let i = 0; i < position.count; i++) near(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), 1);
      for (let i = 0; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
        b.sub(a); c.sub(a); b.cross(c);
        assert.ok(b.lengthSq() > 1e-20, 'the merged mesh must not contain collapsed lathe-pole triangles');
        assert.ok(b.dot(a.fromBufferAttribute(normals, i)) > 0, 'face winding must agree with its normal');
      }
      triangles += position.count / 3 * (type === 'medium' ? 4 : 2);
    }
    assert.ok(triangles < 10000, `six stores submit ${triangles} triangles`);
  } finally { stores.userData.dispose(); assets.dispose(); }
});

test('launcher contact faces meet all six measured supports without mirrored transforms', () => {
  const assets = makeFA18ArmamentAssets(), stores = makeFA18Armament(assets), matrix = new THREE.Matrix4();
  try {
    for (const station of stores.userData.stations) {
      const mesh = stores.userData[station.type];
      mesh.getMatrixAt(station.instanceIndex, matrix);
      near(matrix.determinant(), 1);
      const contact = new THREE.Vector3(...mesh.geometry.userData.adapterContact).applyMatrix4(matrix);
      for (const [i, key] of ['x', 'y', 'z'].entries()) near(contact[key], station.contact[i]);
      const placement = stores.userData.placements[station.index];
      assert.equal(placement.id, station.id);
      if (station.type === 'short') assert.ok((placement.position[0] - station.contact[0]) * station.side > 0, 'wingtip tubes must be outboard of the original rails');
    }
  } finally { stores.userData.dispose(); assets.dispose(); }
});

test('ammunition updates select existing instances without touching shared geometry or instance matrices', () => {
  const assets = makeFA18ArmamentAssets(), stores = makeFA18Armament(assets);
  try {
    const { medium, short } = stores.userData;
    const matrices = [medium.instanceMatrix.array.slice(), short.instanceMatrix.array.slice()];
    const versions = [medium.instanceMatrix.version, short.instanceMatrix.version];
    for (const [ammo, expected] of [[6, [4, 2]], [5, [4, 1]], [4, [4, 0]], [3.9, [3, 0]], [-10, [0, 0]], [99, [4, 2]], [2, [2, 0]]]) {
      stores.userData.update(ammo);
      assert.deepEqual([medium.count, short.count], expected);
    }
    for (const invalid of [undefined, NaN, Infinity, -Infinity, null, '6']) {
      stores.userData.update(invalid);
      assert.deepEqual([medium.count, short.count], [2, 0]);
    }
    for (let frame = 0; frame < 1000; frame++) stores.userData.update(frame % 7);
    assert.equal(medium.geometry, assets.geometries.medium); assert.equal(short.geometry, assets.geometries.short);
    assert.deepEqual(medium.instanceMatrix.array, matrices[0]); assert.deepEqual(short.instanceMatrix.array, matrices[1]);
    assert.deepEqual([medium.instanceMatrix.version, short.instanceMatrix.version], versions);
    assert.equal(stores.children.length, 2);
  } finally { stores.userData.dispose(); assets.dispose(); }
});

test('parked and airborne instance counts and disposal remain independent while assets are shared', () => {
  const assets = makeFA18ArmamentAssets(), airborne = makeFA18Armament(assets), parked = makeFA18Armament(assets, { parked: true });
  const events = { geometry: 0, material: 0, airborne: 0, parked: 0 };
  for (const geometry of Object.values(assets.geometries)) geometry.addEventListener('dispose', () => events.geometry++);
  assets.material.addEventListener('dispose', () => events.material++);
  for (const mesh of airborne.children) mesh.addEventListener('dispose', () => events.airborne++);
  for (const mesh of parked.children) mesh.addEventListener('dispose', () => events.parked++);
  airborne.userData.update(0); parked.userData.update(0);
  assert.deepEqual([airborne.userData.medium.count, airborne.userData.short.count], [0, 0]);
  assert.deepEqual([parked.userData.medium.count, parked.userData.short.count], [4, 2]);
  airborne.userData.dispose(); airborne.userData.dispose(); airborne.userData.update(6);
  assert.deepEqual(events, { geometry: 0, material: 0, airborne: 2, parked: 0 });
  assert.equal(airborne.userData.medium.count, 0);
  assert.equal(parked.userData.medium.geometry, assets.geometries.medium);
  parked.userData.dispose(); parked.userData.dispose(); assets.dispose(); assets.dispose();
  assert.deepEqual(events, { geometry: 2, material: 1, airborne: 2, parked: 2 });
});
