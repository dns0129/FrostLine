import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeFA18 } from '../fa18.js';
import { makeJetAssets } from '../aircraft.js';
import { FA18_HARDPOINTS, makeFA18ArmamentAssets } from '../fa18-armament.js';
import { Simulation } from '../simulation.js';
import { fa18Assets } from './fa18-fixture.mjs';

const canvasContext = new Proxy({}, { get: (_target, key) => /create.*Gradient/.test(key)
  ? () => ({ addColorStop() {} }) : () => {} });
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
Object.defineProperty(globalThis, 'document', { configurable: true,
  value: { createElement: () => ({ getContext: () => canvasContext }) } });
const jetAssets = makeJetAssets();
if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
else delete globalThis.document;
const armamentAssets = makeFA18ArmamentAssets();
const assets = { ...fa18Assets, armament: armamentAssets };

function triangles(geometry, transform) {
  const position = geometry.attributes.position, indices = geometry.index;
  const output = [];
  for (let index = 0; index < (indices?.count ?? position.count); index += 3) {
    const vertices = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(position,
      indices ? indices.getX(index + offset) : index + offset).applyMatrix4(transform).toArray());
    output.push({ vertices, min: [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis]))),
      max: [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis]))) });
  }
  return output;
}

function airframeTriangles() {
  const output = [];
  assets.scene.updateMatrixWorld(true);
  assets.scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (let parent = mesh; parent; parent = parent.parent) if (parent.userData.role === 'gear') return;
    output.push(...triangles(mesh.geometry, mesh.matrixWorld));
  });
  return output;
}

const sourceTriangles = airframeTriangles();

// Project actual triangles onto a plane perpendicular to the contact normal.
// Interpolating the triangle plane gives exact surface intersections for every
// slice; material-batch names and manually estimated pylon boxes are unused.
function projectTriangles(input, axis) {
  const first = (axis + 1) % 3, second = (axis + 2) % 3;
  return input.flatMap(triangle => {
    const [a, b, c] = triangle.vertices;
    const bx = b[first] - a[first], by = b[second] - a[second];
    const cx = c[first] - a[first], cy = c[second] - a[second];
    const denominator = bx * cy - by * cx;
    if (Math.abs(denominator) < 1e-12) return [];
    return [{ a: a[first], b: a[second], value: a[axis], bx, by, cx, cy, denominator,
      heightB: b[axis] - a[axis], heightC: c[axis] - a[axis],
      minA: triangle.min[first], maxA: triangle.max[first], minB: triangle.min[second], maxB: triangle.max[second] }];
  });
}

function surfaceRange(projected, first, second) {
  let minimum = Infinity, maximum = -Infinity;
  for (const triangle of projected) {
    if (first < triangle.minA - 1e-7 || first > triangle.maxA + 1e-7
      || second < triangle.minB - 1e-7 || second > triangle.maxB + 1e-7) continue;
    const x = first - triangle.a, y = second - triangle.b;
    const u = (x * triangle.cy - y * triangle.cx) / triangle.denominator;
    const v = (triangle.bx * y - triangle.by * x) / triangle.denominator;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const value = triangle.value + u * triangle.heightB + v * triangle.heightC;
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  return [minimum, maximum];
}

function storeTransform(plane, station) {
  plane.updateMatrixWorld(true);
  const mesh = plane.userData.armament.userData[station.type], instance = new THREE.Matrix4();
  mesh.getMatrixAt(station.instanceIndex, instance);
  return new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, instance);
}

function storeTriangles(plane, station) {
  return triangles(plane.userData.armament.userData[station.type].geometry, storeTransform(plane, station));
}

function inventory(group) {
  const objects = [], geometries = new Set(), materials = new Set(), instances = [];
  group.traverse(object => {
    objects.push(object);
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    if (object.isInstancedMesh) instances.push(object);
  });
  return { objects, geometries, materials, instances };
}

const countStores = plane => plane.userData.armament.userData.medium.count + plane.userData.armament.userData.short.count;

test('all six stores contact actual imported racks or rails and clear the original airframe surfaces', () => {
  const plane = makeFA18(assets, jetAssets);
  try {
    assert.equal(FA18_HARDPOINTS.length, 6);
    assert.equal(FA18_HARDPOINTS.filter(station => station.type === 'medium').length, 4);
    assert.equal(FA18_HARDPOINTS.filter(station => station.type === 'short').length, 2);
    assert.ok(sourceTriangles.length > 30000, 'fit checks must use the shipped airframe geometry');
    for (const station of FA18_HARDPOINTS) {
      const store = storeTriangles(plane, station), axis = station.type === 'medium' ? 1 : 0;
      const first = (axis + 1) % 3, second = (axis + 2) % 3;
      const minimum = [0, 1, 2].map(component => Math.min(...store.map(triangle => triangle.min[component])));
      const maximum = [0, 1, 2].map(component => Math.max(...store.map(triangle => triangle.max[component])));
      const source = sourceTriangles.filter(triangle => triangle.min[first] <= maximum[first] && triangle.max[first] >= minimum[first]
        && triangle.min[second] <= maximum[second] && triangle.max[second] >= minimum[second]);
      const projectedSource = projectTriangles(source, axis), projectedStore = projectTriangles(store, axis);
      const inverse = storeTransform(plane, station).invert();
      const adapterContact = plane.userData.armament.userData[station.type].geometry.userData.adapterContact;
      let samples = 0, minimumGap = Infinity;
      const contacts = [], adapterGaps = [];
      // A 2 cm slice lattice covers the full store; all real vertices and face
      // centres additionally exercise narrow launcher pads and fin edges.
      const values = component => {
        const list = [station.contact[component]];
        for (let value = minimum[component] + .003; value < maximum[component]; value += .02) list.push(value);
        return list;
      };
      const pairs = new Map();
      const addPair = (a, b) => pairs.set(`${a.toFixed(9)},${b.toFixed(9)}`, [a, b]);
      for (const a of values(first)) for (const b of values(second)) addPair(a, b);
      for (const triangle of store) {
        triangle.vertices.forEach(vertex => addPair(vertex[first], vertex[second]));
        addPair(triangle.vertices.reduce((sum, vertex) => sum + vertex[first] / 3, 0),
          triangle.vertices.reduce((sum, vertex) => sum + vertex[second] / 3, 0));
      }
      for (const [a, b] of pairs.values()) {
        const sourceRange = surfaceRange(projectedSource, a, b), storeRange = surfaceRange(projectedStore, a, b);
        if (!Number.isFinite(sourceRange[0]) || !Number.isFinite(storeRange[0])) continue;
        const gap = axis === 1 ? sourceRange[0] - storeRange[1]
          : station.side > 0 ? storeRange[0] - sourceRange[1] : sourceRange[0] - storeRange[1];
        minimumGap = Math.min(minimumGap, gap); samples++;
        const point = [];
        point[first] = a; point[second] = b;
        point[axis] = axis === 1 || station.side < 0 ? storeRange[1] : storeRange[0];
        const local = new THREE.Vector3(...point).applyMatrix4(inverse).toArray();
        if (Math.abs(local[axis] - adapterContact[axis]) < .003) {
          adapterGaps.push(gap);
          if (Math.abs(gap) < .003) contacts.push(point);
        }
      }
      assert.ok(samples >= 10, `${station.id}: surface clearance must exercise a substantial overlap of cross sections`);
      assert.ok(minimumGap >= -.003, `${station.id}: store penetrates imported rack/airframe by ${(-minimumGap).toFixed(4)} m`);
      assert.ok(contacts.length >= 2, `${station.id}: adapter must contact the actual rack or rail, rather than float beside it`);
      if (station.type === 'medium') {
        // The nominal contact is midway between two hook feet, with an open
        // bay above it. Require separate real fore/aft foot contacts instead
        // of treating that deliberately empty middle as a solid pylon face.
        assert.ok(contacts.some(point => point[2] < station.contact[2] - .15)
          && contacts.some(point => point[2] > station.contact[2] + .15),
        `${station.id}: adapter must touch both actual hook feet`);
      } else {
        const contactSpan = Math.max(...contacts.map(point => point[2])) - Math.min(...contacts.map(point => point[2]));
        assert.ok(contactSpan > .25,
          `${station.id}: actual rail contact spans ${contactSpan.toFixed(4)} m; adapter gap range ${Math.min(...adapterGaps).toFixed(4)}..${Math.max(...adapterGaps).toFixed(4)} m`);
        assert.ok(contacts.some(point => point[2] < station.contact[2] - .15)
          && contacts.some(point => point[2] > station.contact[2] + .15),
        `${station.id}: adapter must seat on both actual fore and aft rail flanges`);
      }
    }
  } finally { plane.userData.dispose(); }
});

test('armament preserves metre scale, forward direction and positive transforms on the real airframe', () => {
  const plane = makeFA18(assets, jetAssets);
  try {
    plane.updateMatrixWorld(true);
    assert.deepEqual(plane.scale.toArray(), [1, 1, 1]);
    const model = plane.children.find(child => child !== plane.userData.armament && child.name === 'F/A-18C Blender airframe');
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - assets.metadata.span) < .002);
    assert.ok(Math.abs(size.z - assets.metadata.length) < .002);
    const overall = new THREE.Box3().setFromObject(plane.userData.armament).getSize(new THREE.Vector3());
    assert.ok(overall.x > assets.metadata.span && overall.x < 13.2, 'tip stores should add centimetres rather than rescale the aircraft');
    for (const station of FA18_HARDPOINTS) {
      const mesh = plane.userData.armament.userData[station.type], matrix = new THREE.Matrix4();
      mesh.getMatrixAt(station.instanceIndex, matrix);
      assert.ok(matrix.elements.every(Number.isFinite)); assert.ok(Math.abs(matrix.determinant() - 1) < 1e-5);
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(matrix);
      assert.ok(forward.z < -.99, `${station.id}: missile nose must point forward`);
      const localContact = mesh.geometry.userData.adapterContact;
      assert.ok(new THREE.Vector3(...localContact).applyMatrix4(matrix).distanceTo(new THREE.Vector3(...station.contact)) < 1e-5);
      const length = mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z;
      assert.ok(Math.abs(length - (station.type === 'medium' ? 3.66 : 2.87)) < .002);
      const normals = mesh.geometry.attributes.normal;
      for (let index = 0; index < normals.count; index++) {
        const normal = new THREE.Vector3().fromBufferAttribute(normals, index).transformDirection(matrix);
        assert.ok(normal.toArray().every(Number.isFinite)); assert.ok(Math.abs(normal.length() - 1) < 1e-5);
      }
    }
  } finally { plane.userData.dispose(); }
});

test('parked and flight stores follow real missile launch, pause and wave resupply without growing resources', () => {
  const parked = makeFA18(assets, jetAssets, { parked: true }), flight = makeFA18(assets, jetAssets);
  try {
    const before = inventory(flight.userData.armament), matrices = before.instances.map(mesh => Array.from(mesh.instanceMatrix.array));
    assert.equal(countStores(parked), 6); assert.equal(countStores(flight), 6);
    const sim = new Simulation(7331); sim.start('intercept', 'easy');
    for (let frame = 0; frame < 90; frame++) sim.update(1 / 60);
    assert.equal(sim.lockProgress, 1); assert.ok(sim.lockTarget?.health > 0);
    assert.equal(sim.launchMissile(), true); assert.equal(sim.player.missiles, 5);
    flight.userData.update(1 / 60, sim.player); parked.userData.update(1 / 60, sim.player);
    assert.equal(countStores(flight), 5); assert.equal(countStores(parked), 6);
    sim.state = 'paused';
    for (let frame = 0; frame < 180; frame++) { sim.update(1 / 60); flight.userData.update(0, sim.player); }
    assert.equal(sim.player.missiles, 5); assert.equal(countStores(flight), 5);
    sim.state = 'playing'; sim.enemies.forEach(enemy => { enemy.health = 0; }); sim.update(1 / 60);
    assert.equal(sim.player.missiles, 6, 'wave completion must use the real ammunition resupply path');
    flight.userData.update(1 / 60, sim.player); assert.equal(countStores(flight), 6);
    for (let frame = 0; frame < 600; frame++) flight.userData.update(1 / 60, sim.player);
    const after = inventory(flight.userData.armament);
    assert.deepEqual(after, before, 'updates must retain the same scene and shared resources');
    assert.deepEqual(after.instances.map(mesh => Array.from(mesh.instanceMatrix.array)), matrices);
  } finally { parked.userData.dispose(); flight.userData.dispose(); }
});

test('disposing one aircraft releases only its two store instance buffers and preserves the other aircraft and shared assets', () => {
  const first = makeFA18(assets, jetAssets), second = makeFA18(assets, jetAssets, { parked: true });
  try {
    const shared = new Set([...inventory(assets.scene).geometries, ...inventory(assets.scene).materials,
      ...Object.values(armamentAssets.geometries), armamentAssets.material]);
    const sharedReleases = new Map([...shared].map(resource => [resource, 0]));
    for (const resource of shared) resource.addEventListener('dispose', () => sharedReleases.set(resource, sharedReleases.get(resource) + 1));
    const firstBuffers = inventory(first.userData.armament).instances, secondBuffers = inventory(second.userData.armament).instances;
    assert.equal(firstBuffers.length, 2); assert.equal(secondBuffers.length, 2);
    const releases = new Map([...firstBuffers, ...secondBuffers].map(mesh => [mesh, 0]));
    for (const mesh of releases.keys()) mesh.addEventListener('dispose', () => releases.set(mesh, releases.get(mesh) + 1));
    first.userData.dispose(); first.userData.dispose();
    for (const mesh of firstBuffers) assert.equal(releases.get(mesh), 1);
    for (const mesh of secondBuffers) assert.equal(releases.get(mesh), 0);
    for (const count of sharedReleases.values()) assert.equal(count, 0, 'one aircraft cannot dispose loader-owned geometry or paint');
    second.userData.update(1 / 60, { missiles: 0, throttle: 1, boost: true });
    assert.equal(countStores(second), 6); assert.ok(second.userData.gear.every(gear => gear.visible));
    assert.ok(secondBuffers.every(mesh => mesh.geometry.attributes.position.array.every(Number.isFinite)));
    second.userData.dispose(); second.userData.dispose();
    for (const count of releases.values()) assert.equal(count, 1);
    for (const count of sharedReleases.values()) assert.equal(count, 0);
  } finally { first.userData.dispose(); second.userData.dispose(); }
});

test.after(() => {
  armamentAssets.dispose();
  const resources = new Set([...Object.values(jetAssets.geometries), ...Object.values(jetAssets.materials),
    ...Object.values(jetAssets.textures), jetAssets.exhaustGeometry, jetAssets.exhaustCoreGeometry]);
  resources.forEach(resource => resource.dispose());
});
