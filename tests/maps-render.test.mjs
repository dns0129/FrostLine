import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { MAPS, getMap } from '../maps.js';
import { makeTerrain } from '../terrain.js';
import { getActiveMap, setActiveMap, terrainHeight, terrainGroundHeight, islandHeight } from '../world-math.js';

const MAP_LIST = Object.values(MAPS);
const TIERS = ['low', 'high', 'ultra'];
const TRIANGLE_BUDGET = { low: 75000, high: 184000, ultra: 330000 };

// Count submitted commands, including instance multiplicity, rather than the
// source grid size or a self-reported statistic. This needs no WebGL context.
function inventory(group) {
  const meshes = [], instances = [], geometries = new Set(), materials = new Set();
  let objects = 0, triangles = 0, drawCalls = 0, instanceCount = 0;
  group.traverse(object => {
    objects++;
    if (!object.isMesh) return;
    meshes.push(object);
    geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    list.forEach(material => materials.add(material));
    const multiplier = object.isInstancedMesh ? object.count : 1;
    if (object.isInstancedMesh) { instances.push(object); instanceCount += object.count; }
    const geometry = object.geometry;
    const elements = geometry.index?.count ?? geometry.attributes.position.count;
    const commands = Array.isArray(object.material)
      ? geometry.groups.map(command => ({ ...command, material: object.material[command.materialIndex] }))
      : [{ start: 0, count: elements, material: object.material }];
    let visible = true;
    for (let parent = object; parent; parent = parent.parent) visible &&= parent.visible;
    for (const command of commands) {
      if (!visible || !command.material?.visible || !multiplier) continue;
      const start = Math.max(command.start, geometry.drawRange.start);
      const end = Math.min(elements, command.start + command.count,
        geometry.drawRange.start + geometry.drawRange.count);
      const count = Math.max(0, end - start);
      assert.equal(count % 3, 0, `${object.name}: partial triangle in draw command`);
      if (count) { drawCalls++; triangles += count / 3 * multiplier; }
    }
  });
  return { meshes, instances, geometries, materials, objects, triangles, drawCalls, instanceCount };
}

function texturesIn(materials) {
  const textures = new Set();
  const collect = value => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  for (const material of materials) {
    Object.values(material).forEach(collect);
    for (const uniform of Object.values(material.uniforms ?? {})) collect(uniform.value);
    if (material.isMeshStandardMaterial) {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader);
      for (const uniform of Object.values(shader.uniforms)) collect(uniform.value);
    }
  }
  return textures;
}

function assertFiniteGeometry(mesh) {
  const geometry = mesh.geometry, position = geometry.attributes.position;
  assert.ok(position && position.itemSize === 3, `${mesh.name}: missing positions`);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (attribute.isInstancedBufferAttribute) assert.ok(attribute.count >= mesh.count, `${mesh.name}: incomplete instance ${name}`);
    else assert.equal(attribute.count, position.count, `${mesh.name}: incomplete ${name}`);
    assert.ok(attribute.array.every(Number.isFinite), `${mesh.name}: non-finite ${name}`);
  }
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (position.count && list.some(material => material.isMeshStandardMaterial)) {
    const normal = geometry.attributes.normal;
    assert.ok(normal && normal.itemSize === 3, `${mesh.name}: missing lit normals`);
    for (let index = 0; index < normal.count; index++) {
      const length = Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index));
      assert.ok(length > .99 && length < 1.01, `${mesh.name}: invalid normal ${index}`);
    }
  }
  if (geometry.index) {
    assert.equal(geometry.index.count % 3, 0);
    for (const index of geometry.index.array) assert.ok(Number.isInteger(index) && index >= 0 && index < position.count,
      `${mesh.name}: out-of-range vertex index ${index}`);
  }
  if (position.count) {
    geometry.computeBoundingSphere();
    assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0,
      `${mesh.name}: invalid bounds`);
    assert.ok(geometry.boundingSphere.center.toArray().every(Number.isFinite));
  }
  assert.ok(mesh.matrixWorld.elements.every(Number.isFinite));
  if (mesh.isInstancedMesh) {
    assert.ok(Number.isSafeInteger(mesh.count) && mesh.count >= 0 && mesh.count <= mesh.instanceMatrix.count);
    assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
    if (mesh.instanceColor) assert.ok(mesh.instanceColor.array.every(Number.isFinite));
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      assert.ok(Math.abs(matrix.determinant()) > 1e-9, `${mesh.name}: collapsed instance ${index}`);
    }
  }
}

function sceneryFootprints(group) {
  const structures = new Map(), placements = [];
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  group.traverse(mesh => {
    if (!mesh.isInstancedMesh) return;
    if (mesh.userData.sites) placements.push({ sites: mesh.userData.sites,
      transforms: Array.from(mesh.instanceMatrix.array) });
    const ids = mesh.userData.structureIds;
    if (!ids) return;
    assert.equal(ids.length, mesh.count, 'every architecture instance must identify its collision structure');
    mesh.geometry.computeBoundingBox();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, instance); world.multiplyMatrices(mesh.matrixWorld, instance);
      const bounds = mesh.geometry.boundingBox.clone().applyMatrix4(world);
      if (structures.has(ids[index])) structures.get(ids[index]).union(bounds);
      else structures.set(ids[index], bounds);
    }
  });
  return { structures, placements };
}

for (const map of MAP_LIST) for (const quality of TIERS) {
  test(`${map.id}/${quality}: finite geometry and actual rendering fit the tier budget`, async () => {
    const previous = getActiveMap();
    const group = makeTerrain(quality, map.id);
    try {
      assert.equal(getActiveMap(), previous, 'rendering a map must not mutate the collision map');
      assert.equal(await group.userData.ready, false, 'Node must use the local texture fallback');
      group.updateMatrixWorld(true);
      const state = inventory(group), stats = group.userData.stats;
      assert.equal(group.userData.mapId, map.id);
      assert.equal(stats.mapId, map.id);
      assert.equal(stats.quality, quality);
      assert.ok(state.triangles > 0 && state.triangles <= TRIANGLE_BUDGET[quality],
        `${state.triangles} submitted triangles exceeds ${TRIANGLE_BUDGET[quality]}`);
      const maxDraws = map.id === 'north-atlantic' ? 12 : 30;
      assert.ok(state.drawCalls > 0 && state.drawCalls <= maxDraws,
        `${state.drawCalls} submitted draws exceeds ${maxDraws}`);
      assert.equal(stats.triangles, state.triangles, 'triangles include every instance');
      assert.equal(stats.drawCalls, state.drawCalls);
      assert.equal(stats.rockInstances + stats.sceneryInstances, state.instanceCount);
      assert.ok(stats.rockInstances <= stats.maxPebbles);
      for (const mesh of state.meshes) assertFiniteGeometry(mesh);
      const islands = state.meshes.filter(mesh => mesh.userData.island);
      assert.equal(islands.length, getMap(map.id).islands.length);
      for (const mesh of islands) {
        const position = mesh.geometry.attributes.position;
        // Every visible tier samples exactly the same metre-based heightfield.
        // Float32 storage can move a steep slope by a few millimetres.
        for (let index = 0; index < position.count; index += Math.max(1, Math.floor(position.count / 120))) {
          const expected = islandHeight(mesh.userData.island, position.getX(index), position.getZ(index));
          assert.ok(Math.abs(position.getY(index) - expected) < .05,
            `${mesh.name}: rendered height differs from collision source`);
        }
      }
    } finally { group.userData.dispose(); setActiveMap(previous.id ?? previous); }
  });

  test(`${map.id}/${quality}: animation retains fixed resources and disposal releases all instance buffers once`, async () => {
    const group = makeTerrain(quality, map.id);
    try {
      await group.userData.ready;
      const before = inventory(group), textures = texturesIn(before.materials);
      assert.ok(textures.size > 0, 'owned fallback detail texture must be exercised');
      for (let frame = 0; frame < 120; frame++) group.userData.update(frame / 60);
      group.userData.update(86400);
      const after = inventory(group);
      assert.deepEqual(after, before, 'animation must retain the same graph and geometry budget');
      assert.deepEqual(texturesIn(after.materials), textures, 'animation must retain the same texture set');
      const resources = new Set([...before.geometries, ...before.materials, ...textures, ...before.instances]);
      const releases = new Map([...resources].map(resource => [resource, 0]));
      for (const resource of resources) resource.addEventListener('dispose', () => releases.set(resource, releases.get(resource) + 1));
      group.userData.dispose(); group.userData.dispose();
      for (const [resource, count] of releases) assert.equal(count, 1,
        `${resource.type ?? resource.constructor.name} ${resource.name}: disposal must happen exactly once`);
    } finally { group.userData.dispose(); }
  });
}

test('all maps preserve world scale and collision samples across quality rebuilds and reduce work in standard definition', () => {
  const previous = getActiveMap();
  try {
    assert.equal(MAP_LIST.length, 4, 'original map and all three requested environments must be available');
    for (const map of MAP_LIST) {
      setActiveMap(map.id);
      const samples = map.islands.flatMap(island => [-.5, 0, .5].flatMap(x => [-.5, 0, .5].map(z => ({
        x: island.x + island.radius * x, z: island.z + island.radius * z,
      }))));
      const collision = samples.map(point => terrainHeight(point.x, point.z));
      const groups = TIERS.map(quality => makeTerrain(quality, map.id));
      try {
        const states = groups.map(inventory);
        assert.ok(states[0].triangles < states[1].triangles * .75, `${map.id}: low must meaningfully reduce geometry`);
        assert.ok(states[1].triangles < states[2].triangles, `${map.id}: ultra must add geometry detail`);
        const footprints = groups.map(group => {
          group.updateMatrixWorld(true);
          return inventory(group).meshes.filter(mesh => mesh.userData.island).map(mesh => {
            mesh.geometry.computeBoundingBox();
            const bounds = mesh.geometry.boundingBox;
            return [mesh.userData.island.seed, bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z,
              ...mesh.matrixWorld.elements];
          });
        });
        assert.deepEqual(footprints[0], footprints[1], `${map.id}: quality must preserve horizontal world extents`);
        assert.deepEqual(footprints[1], footprints[2]);
        const scenery = groups.map(sceneryFootprints);
        assert.deepEqual(scenery[0], scenery[1], `${map.id}: scenery must retain its physical scale and placement`);
        assert.deepEqual(scenery[1], scenery[2]);
        assert.equal(scenery[0].structures.size, map.structures.length);
        for (const structure of map.structures) {
          const transform = new THREE.Matrix4().compose(
            new THREE.Vector3(structure.x, structure.y + structure.height / 2, structure.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), structure.rotation ?? 0),
            new THREE.Vector3(structure.width, structure.height, structure.depth));
          const expected = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)).applyMatrix4(transform);
          const actual = scenery[0].structures.get(structure.id);
          assert.ok(actual, `${structure.id}: missing rendered structure`);
          assert.ok(actual.min.distanceTo(expected.min) < .003 && actual.max.distanceTo(expected.max) < .003,
            `${structure.id}: rendered metre bounds differ from the collision catalog`);
          const surface = Math.max(expected.max.y, terrainGroundHeight(structure.x, structure.z));
          assert.ok(Math.abs(terrainHeight(structure.x, structure.z) - surface) < .001,
            `${structure.id}: visible roof differs from the active collision field`);
        }
        assert.deepEqual(samples.map(point => terrainHeight(point.x, point.z)), collision,
          `${map.id}: quality rebuilding must preserve collisions`);
        assert.equal(getActiveMap().id, map.id);
      } finally { groups.forEach(group => group.userData.dispose()); }
    }
  } finally { setActiveMap(previous.id ?? previous); }
});
