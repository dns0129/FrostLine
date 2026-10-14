import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeTerrain } from '../terrain.js';

const TRIANGLE_BUDGET = { low: 75000, high: 184000 };
const DRAW_BUDGET = 12;

function renderInventory(group) {
  const meshes = [], geometries = new Set(), materials = new Set(), instances = [];
  let triangles = 0, drawCalls = 0, instanceCount = 0, objects = 0;
  group.traverse(object => {
    objects++;
    if (!object.isMesh) return;
    meshes.push(object);
    const geometry = object.geometry;
    geometries.add(geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach(material => materials.add(material));
    const multiplier = object.isInstancedMesh ? object.count : 1;
    if (object.isInstancedMesh) {
      instances.push(object);
      instanceCount += object.count;
    }
    const elementCount = geometry.index?.count ?? geometry.attributes.position.count;
    const commands = Array.isArray(object.material)
      ? geometry.groups.map(command => ({ ...command, material: object.material[command.materialIndex] }))
      : [{ start: 0, count: elementCount, material: object.material }];
    for (const command of commands) {
      if (!object.visible || !command.material?.visible || multiplier === 0) continue;
      const start = Math.max(command.start, geometry.drawRange.start);
      const end = Math.min(elementCount, command.start + command.count,
        geometry.drawRange.start + geometry.drawRange.count);
      const count = Math.max(0, end - start);
      assert.equal(count % 3, 0, `${object.name}: draw command must contain complete triangles`);
      if (count > 0) {
        drawCalls++;
        triangles += count / 3 * multiplier;
      }
    }
  });
  return { meshes, geometries, materials, instances, triangles, drawCalls, instanceCount, objects };
}

function resourceTextures(materials) {
  const textures = new Set();
  const collect = value => {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  for (const material of materials) {
    Object.values(material).forEach(collect);
    for (const uniform of Object.values(material.uniforms ?? {})) collect(uniform.value);
    // Custom standard-material shader hooks carry texture uniforms outside
    // material.map. Exercise that public hook without requiring a GPU/DOM.
    if (material.isMeshStandardMaterial) {
      const shader = {
        uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      };
      material.onBeforeCompile(shader);
      for (const uniform of Object.values(shader.uniforms)) collect(uniform.value);
    }
  }
  return textures;
}

for (const quality of ['low', 'high']) {
  test(`${quality} terrain stays inside its triangle and draw budgets without a browser`, async () => {
    const group = makeTerrain(quality);
    try {
      assert.equal(await group.userData.ready, false, 'Node must use the local texture fallback without loading images');
      const inventory = renderInventory(group), stats = group.userData.stats;
      assert.equal(stats.quality, quality);
      assert.ok(inventory.triangles > 0);
      assert.ok(inventory.triangles <= TRIANGLE_BUDGET[quality],
        `${quality}: ${inventory.triangles} triangles exceeds ${TRIANGLE_BUDGET[quality]}`);
      assert.ok(inventory.drawCalls > 0 && inventory.drawCalls <= DRAW_BUDGET,
        `${quality}: ${inventory.drawCalls} draw calls exceeds ${DRAW_BUDGET}`);
      assert.equal(stats.triangles, inventory.triangles, 'reported budget must match actual submitted geometry, including instances');
      assert.equal(stats.drawCalls, inventory.drawCalls, 'reported draws must match actual mesh commands');
      assert.equal(stats.rockInstances, inventory.instanceCount);
      assert.ok(Number.isSafeInteger(stats.maxPebbles) && stats.maxPebbles >= 0);
      assert.ok(inventory.instanceCount <= stats.maxPebbles, 'shore detail must have a finite instance quota');
    } finally {
      group.userData.dispose();
    }
  });

  test(`${quality} terrain has finite geometry, normals and instance transforms with valid indices`, () => {
    const group = makeTerrain(quality);
    try {
      const inventory = renderInventory(group);
      for (const mesh of inventory.meshes) {
        const geometry = mesh.geometry, position = geometry.attributes.position;
        assert.ok(position && position.itemSize === 3 && position.count > 0, `${mesh.name}: missing vertices`);
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
          assert.equal(attribute.count, position.count, `${mesh.name}: ${name} must cover the same vertices`);
          assert.ok(attribute.array.every(Number.isFinite), `${mesh.name}: ${name} contains non-finite values`);
        }
        const materialList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (materialList.some(material => material.isMeshStandardMaterial)) {
          const normal = geometry.attributes.normal;
          assert.ok(normal && normal.itemSize === 3, `${mesh.name}: lit geometry needs normals`);
          for (let index = 0; index < normal.count; index++) {
            assert.ok(Math.hypot(normal.getX(index), normal.getY(index), normal.getZ(index)) > 1e-6,
              `${mesh.name}: normal ${index} must not be zero`);
          }
        }
        if (geometry.index) {
          assert.equal(geometry.index.count % 3, 0);
          for (const index of geometry.index.array) {
            assert.ok(Number.isInteger(index) && index >= 0 && index < position.count,
              `${mesh.name}: vertex index ${index} is outside 0..${position.count - 1}`);
          }
        }
        geometry.computeBoundingSphere();
        assert.ok(Number.isFinite(geometry.boundingSphere.radius) && geometry.boundingSphere.radius > 0);
        assert.ok(geometry.boundingSphere.center.toArray().every(Number.isFinite));
      }
      for (const mesh of inventory.instances) {
        assert.ok(Number.isSafeInteger(mesh.count) && mesh.count >= 0);
        assert.ok(mesh.count <= mesh.instanceMatrix.count);
        assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
        if (mesh.instanceColor) assert.ok(mesh.instanceColor.array.every(Number.isFinite));
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix);
          assert.ok(Math.abs(matrix.determinant()) > 1e-9, 'instance scale cannot collapse a normal transform');
        }
      }
    } finally {
      group.userData.dispose();
    }
  });

  test(`${quality} coast animation does not grow the island graph, resources or instances`, () => {
    const group = makeTerrain(quality);
    try {
      const before = renderInventory(group);
      const texturesBefore = resourceTextures(before.materials);
      for (let frame = 0; frame < 360; frame++) group.userData.update(frame / 60);
      group.userData.update(60 * 60 * 24);
      const after = renderInventory(group);
      assert.deepEqual(after.meshes, before.meshes);
      assert.equal(after.objects, before.objects);
      assert.deepEqual(after.geometries, before.geometries);
      assert.deepEqual(after.materials, before.materials);
      assert.deepEqual(resourceTextures(after.materials), texturesBefore);
      assert.equal(after.instanceCount, before.instanceCount);
      assert.equal(after.triangles, before.triangles);
      assert.equal(after.drawCalls, before.drawCalls);
    } finally {
      group.userData.dispose();
    }
  });

  test(`${quality} disposal releases every owned resource and the instance buffers exactly once`, async () => {
    const group = makeTerrain(quality);
    await group.userData.ready;
    const inventory = renderInventory(group), textures = resourceTextures(inventory.materials);
    assert.ok(textures.size > 0, 'the Node path must retain an owned fallback texture');
    assert.ok(inventory.instances.length > 0, 'exercise the instanced GPU buffer release path');
    const resources = new Set([...inventory.geometries, ...inventory.materials, ...textures, ...inventory.instances]);
    const disposeCounts = new Map([...resources].map(resource => [resource, 0]));
    for (const resource of resources) resource.addEventListener('dispose', () => {
      disposeCounts.set(resource, disposeCounts.get(resource) + 1);
    });
    try {
      group.userData.dispose();
      for (const resource of resources) assert.equal(disposeCounts.get(resource), 1,
        `${resource.type ?? resource.constructor.name} ${resource.name}: missing disposal`);
      group.userData.dispose();
      group.userData.dispose();
      for (const resource of resources) assert.equal(disposeCounts.get(resource), 1,
        `${resource.type ?? resource.constructor.name} ${resource.name}: disposal is not idempotent`);
    } finally {
      group.userData.dispose();
    }
  });
}

test('low terrain materially reduces submitted triangles while preserving bounded draw calls', () => {
  const low = makeTerrain('low'), high = makeTerrain('high');
  try {
    const lowInventory = renderInventory(low), highInventory = renderInventory(high);
    assert.ok(lowInventory.triangles < highInventory.triangles * .65,
      'mobile quality must save at least 35% of terrain triangles');
    assert.ok(lowInventory.instanceCount <= highInventory.instanceCount);
    assert.ok(lowInventory.drawCalls <= DRAW_BUDGET && highInventory.drawCalls <= DRAW_BUDGET);
  } finally {
    low.userData.dispose();
    high.userData.dispose();
  }
});

function deferredImageLoad() {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLoad = THREE.TextureLoader.prototype.load;
  const texture = new THREE.Texture();
  let complete;
  // Simulate only the public loader boundary: no DOM, image or network access.
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
  THREE.TextureLoader.prototype.load = (_url, onLoad) => {
    complete = () => onLoad(texture);
    return texture;
  };
  return {
    texture,
    complete: () => { assert.equal(typeof complete, 'function'); complete(); },
    restore: () => {
      THREE.TextureLoader.prototype.load = originalLoad;
      if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
      else delete globalThis.document;
    },
  };
}

test('a completed image texture is released once together with the fallback resources', async () => {
  const image = deferredImageLoad();
  let group;
  try {
    group = makeTerrain('low');
    image.complete();
    assert.equal(await group.userData.ready, true);
    const textures = resourceTextures(renderInventory(group).materials);
    assert.ok(textures.has(image.texture), 'loaded albedo must be the texture used by the shader');
    assert.ok(textures.size >= 2, 'fallback/detail and loaded albedo are distinct owned resources');
    const counts = new Map([...textures].map(texture => [texture, 0]));
    for (const texture of textures) texture.addEventListener('dispose', () => counts.set(texture, counts.get(texture) + 1));
    group.userData.dispose();
    group.userData.dispose();
    for (const count of counts.values()) assert.equal(count, 1);
  } finally {
    group?.userData.dispose();
    image.restore();
  }
});

test('an image completing after terrain disposal is immediately released without resurrecting resources', async () => {
  const image = deferredImageLoad();
  let group, disposals = 0;
  image.texture.addEventListener('dispose', () => { disposals++; });
  try {
    group = makeTerrain('low');
    group.userData.dispose();
    image.complete();
    assert.equal(await group.userData.ready, false);
    assert.equal(disposals, 1, 'late loader completion must release its unused GPU texture');
    assert.ok(!resourceTextures(renderInventory(group).materials).has(image.texture));
    group.userData.dispose();
    assert.equal(disposals, 1);
  } finally {
    group?.userData.dispose();
    image.restore();
  }
});
