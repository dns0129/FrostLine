import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { WaterReflection, reflectCamera, reflectionTextureMatrix, projectionNeedsRefresh } from '../water-reflection.js';
import { getQualityPreset } from '../quality.js';

const near = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, received ${actual}`);
};
const vectorNear = (a, b) => {
  near(a.x, b.x); near(a.y, b.y); near(a.z, b.z);
};
const reflected = v => new THREE.Vector3(v.x, -v.y, v.z);
const worldUp = camera => new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

function flightCamera(roll = 0) {
  const camera = new THREE.PerspectiveCamera(65, 16 / 9, .5, 90000);
  camera.position.set(420, 1170, 3400);
  camera.lookAt(-800, 20, -4900);
  camera.rotateZ(roll);
  camera.updateMatrixWorld(true);
  return camera;
}

test('mirrored position, view direction and up retain banking and inverted flight', () => {
  for (const roll of [0, .63, -1.7, Math.PI]) {
    const main = flightCamera(roll);
    const mirror = reflectCamera(main);
    vectorNear(mirror.position, reflected(main.position));
    vectorNear(mirror.getWorldDirection(new THREE.Vector3()), reflected(main.getWorldDirection(new THREE.Vector3())));
    vectorNear(worldUp(mirror), reflected(worldUp(main)));
    near(mirror.matrixWorld.determinant(), 1);
  }
});

test('double reflection returns the camera to its original world pose', () => {
  const main = flightCamera(2.4);
  const roundTrip = reflectCamera(reflectCamera(main));
  vectorNear(roundTrip.position, main.position);
  near(Math.abs(roundTrip.quaternion.dot(main.quaternion)), 1);
});

test('a parent rotation and translation are reflected in world space', () => {
  const parent = new THREE.Group();
  parent.position.set(-1200, 300, 1800);
  parent.rotation.set(.1, .75, -.3);
  const main = flightCamera(.9);
  parent.add(main);
  parent.updateMatrixWorld(true);
  const mirror = reflectCamera(main);
  vectorNear(mirror.position, reflected(main.getWorldPosition(new THREE.Vector3())));
  vectorNear(mirror.getWorldDirection(new THREE.Vector3()), reflected(main.getWorldDirection(new THREE.Vector3())));
  vectorNear(worldUp(mirror), reflected(worldUp(main)));
});

test('water-plane projection respects reflected handedness at every aircraft roll', () => {
  for (const roll of [0, .9, -1.3, Math.PI]) {
    const main = flightCamera(roll);
    const mirror = reflectCamera(main);
    for (const point of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-900, 0, -4300), new THREE.Vector3(1700, 0, -2100)]) {
      const regular = point.clone().project(main);
      const water = point.clone().project(mirror);
      // Reflection is not a rotation: a right-handed camera reverses screen X.
      // Projective sampling on the ocean reverses it back at the same point.
      near(water.x, -regular.x);
      near(water.y, regular.y);
      near(water.z, regular.z);
    }
  }
});

test('an above-water object and its virtual underwater image land on the same reflection ray', () => {
  const main = flightCamera(.7);
  const mirror = reflectCamera(main);
  const worldPoint = new THREE.Vector3(-400, 700, -2800);
  const virtualImage = reflected(worldPoint).project(main);
  const capturedImage = worldPoint.clone().project(mirror);
  near(capturedImage.x, -virtualImage.x);
  near(capturedImage.y, virtualImage.y);
  near(capturedImage.z, virtualImage.z);

  // The ray to the virtual image crosses y = 0 at the physical reflection.
  const virtualWorld = reflected(worldPoint);
  const fraction = main.position.y / (main.position.y - virtualWorld.y);
  const waterPoint = main.position.clone().lerp(virtualWorld, fraction);
  near(waterPoint.y, 0);
  const textureMatrix = reflectionTextureMatrix(mirror);
  const waterUV = waterPoint.clone().applyMatrix4(textureMatrix);
  const objectUV = worldPoint.clone().applyMatrix4(textureMatrix);
  near(waterUV.x, objectUV.x);
  near(waterUV.y, objectUV.y);
});

test('texture projection equals the rendered camera NDC mapped to the unit square', () => {
  const mirror = reflectCamera(flightCamera(-.4));
  const textureMatrix = reflectionTextureMatrix(mirror);
  for (const point of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1200, 850, -5500)]) {
    const ndc = point.clone().project(mirror);
    const uv = point.clone().applyMatrix4(textureMatrix);
    near(uv.x, (ndc.x + 1) / 2);
    near(uv.y, (ndc.y + 1) / 2);
    near(uv.z, (ndc.z + 1) / 2);
  }
});

test('portrait aspect, zoom and clipping distances are copied without mutating the main camera', () => {
  const main = flightCamera(1.6);
  main.aspect = 9 / 19;
  main.zoom = 1.3;
  main.filmOffset = .8;
  main.updateProjectionMatrix();
  const before = main.matrixWorld.clone();
  const projection = main.projectionMatrix.clone();
  const mirror = reflectCamera(main);
  assert.deepEqual(mirror.projectionMatrix.elements, projection.elements);
  assert.deepEqual(main.matrixWorld.elements, before.elements);
  assert.equal(mirror.near, .5);
  assert.equal(mirror.far, 90000);
  assert.equal(mirror.aspect, 9 / 19);
});

test('continuous small speed-driven FOV changes retain the scheduled capture cadence', () => {
  const camera = flightCamera();
  const baseFov = camera.fov;
  const captured = camera.projectionMatrix.clone();
  const originalCapture = captured.clone();
  for (let frame = 1; frame <= 12; frame++) {
    camera.fov = baseFov + frame * .002;
    camera.updateProjectionMatrix();
    assert.equal(camera.projectionMatrix.equals(captured), false, 'the camera projection actually changed');
    assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), false, `frame ${frame} must not force a capture`);
  }
  assert.deepEqual(captured.elements, originalCapture.elements, 'comparison must not advance the captured matrix without a new image');
});

test('large or accumulated FOV changes still request an immediate capture', () => {
  const camera = flightCamera();
  const captured = camera.projectionMatrix.clone();
  camera.fov += .2;
  camera.updateProjectionMatrix();
  assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), true);
  captured.copy(camera.projectionMatrix);
  assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), false);

  for (let frame = 0; frame < 100; frame++) camera.fov += .002;
  camera.updateProjectionMatrix();
  assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), true, 'compare with the last capture, not only the previous frame');
});

test('small aspect changes and portrait rotation refresh immediately despite the FOV tolerance', () => {
  const camera = flightCamera();
  const captured = camera.projectionMatrix.clone();
  camera.aspect += .0001;
  camera.updateProjectionMatrix();
  assert.ok(camera.projectionMatrix.elements.every((value, i) => Math.abs(value - captured.elements[i]) < .002));
  assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), true, 'subpixel target-size rounding cannot suppress an aspect update');
  camera.aspect = 9 / 19;
  camera.updateProjectionMatrix();
  assert.equal(projectionNeedsRefresh(camera.projectionMatrix, captured), true);
});

function reflectionFixture(quality = 'high', hdr = true) {
  const scene = new THREE.Scene();
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: {
    reflectionMap: { value: null }, reflectionMatrix: { value: new THREE.Matrix4() }, reflectionStrength: { value: 0 },
  } }));
  const skipped = new THREE.Object3D(); skipped.userData.skipWaterReflection = true;
  scene.add(ocean, skipped);
  const originalTarget = {}, clippingPlanes = [new THREE.Plane()];
  const renderer = {
    extensions: { has: () => hdr }, xr: { enabled: true }, shadowMap: { autoUpdate: true },
    toneMapping: THREE.ACESFilmicToneMapping, clippingPlanes, captures: 0,
    target: originalTarget, face: 2, mip: 1, scissorTest: true,
    viewport: new THREE.Vector4(10, 20, 800, 500), scissor: new THREE.Vector4(30, 40, 700, 400),
    getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); }, getScissor(out) { return out.copy(this.scissor); }, getScissorTest() { return this.scissorTest; },
    setRenderTarget(target, face = 0, mip = 0) { this.target = target; this.face = face; this.mip = mip; },
    setViewport(value) { this.viewport.copy(value); }, setScissor(value) { this.scissor.copy(value); }, setScissorTest(value) { this.scissorTest = value; },
    clear() {}, render() {
      assert.equal(ocean.visible, false); assert.equal(skipped.visible, false);
      assert.equal(this.toneMapping, THREE.NoToneMapping);
      assert.equal(this.clippingPlanes.length, clippingPlanes.length + 1);
      this.captures++;
      if (this.failCapture) throw new Error('capture failed');
    },
  };
  return { scene, ocean, skipped, renderer, originalTarget, clippingPlanes, reflection: new WaterReflection(renderer, scene, ocean, { quality }), camera: flightCamera() };
}

test('each visual tier bounds both reflection dimensions and maintains its scheduled capture cadence', () => {
  for (const quality of ['low', 'high', 'ultra']) {
    const { reflection, camera, renderer, ocean } = reflectionFixture(quality);
    const profile = getQualityPreset(quality);
    try {
      for (const aspect of [16 / 9, 9 / 19, 1]) {
        camera.aspect = aspect; camera.updateProjectionMatrix(); reflection.resize(camera);
        assert.equal(Math.max(reflection.target.width, reflection.target.height), profile.reflectionResolution);
        assert.ok(Math.abs(reflection.target.width / reflection.target.height - aspect) < .01);
      }
      assert.equal(reflection.target.texture.type, profile.reflectionHDR ? THREE.HalfFloatType : THREE.UnsignedByteType);
      assert.equal(reflection.update(camera, 0), true);
      const matrix = reflection.reflectionMatrix.clone();
      assert.equal(reflection.update(camera, .5 / profile.reflectionHz), false);
      assert.equal(reflection.reflectionMatrix.equals(matrix), true, 'skipped capture must keep image/projector paired');
      assert.equal(reflection.update(camera, 1 / profile.reflectionHz), true);
      assert.equal(renderer.captures, 2);
      assert.equal(ocean.material.uniforms.reflectionStrength.value, 1);
    } finally { reflection.dispose(); ocean.geometry.dispose(); ocean.material.dispose(); }
  }
});

test('reflection restores renderer and object state even when capture fails, and retries cleanly', () => {
  const { reflection, camera, renderer, ocean, skipped, originalTarget, clippingPlanes } = reflectionFixture();
  try {
    renderer.failCapture = true;
    assert.throws(() => reflection.update(camera, 0), /capture failed/);
    assert.equal(ocean.visible, true); assert.equal(skipped.visible, true);
    assert.equal(renderer.target, originalTarget); assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1);
    assert.equal(renderer.clippingPlanes, clippingPlanes);
    assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(renderer.xr.enabled, true); assert.equal(renderer.shadowMap.autoUpdate, true);
    assert.deepEqual(renderer.viewport.toArray(), [10, 20, 800, 500]);
    assert.deepEqual(renderer.scissor.toArray(), [30, 40, 700, 400]);
    assert.equal(renderer.scissorTest, true);
    assert.equal(reflection._capturing, false); assert.equal(reflection._hidden.length, 0);
    renderer.failCapture = false;
    assert.equal(reflection.update(camera, 1), true);
    const scratch = [reflection._saved, reflection._hidden, reflection._captureClipPlanes];
    for (let frame = 1; frame <= 120; frame++) reflection.update(camera, 1 + frame / 60);
    assert.deepEqual([reflection._saved, reflection._hidden, reflection._captureClipPlanes], scratch);
    assert.equal(reflection._hidden.length, 0);
    assert.equal(reflection._captureClipPlanes.length, clippingPlanes.length + 1, 'the clipping buffer must not accumulate planes');
  } finally { reflection.dispose(); ocean.geometry.dispose(); ocean.material.dispose(); }
});

test('quality changes release reflection targets once and unsupported HDR keeps a valid byte target', () => {
  const { reflection, camera, ocean } = reflectionFixture('high', false);
  try {
    assert.equal(reflection.target.texture.type, THREE.UnsignedByteType);
    let disposed = 0;
    reflection.target.addEventListener('dispose', () => disposed++);
    reflection.setQuality('ultra'); reflection.resize(camera);
    assert.equal(disposed, 1);
    assert.equal(reflection.quality, 'ultra');
    assert.equal(reflection.target.width, 768);
    assert.equal(reflection.target.texture.type, THREE.UnsignedByteType);
    assert.equal(ocean.material.uniforms.reflectionStrength.value, 0);
    const target = reflection.target;
    reflection.setQuality('ultra');
    assert.equal(reflection.target, target, 'reapplying a quality must not recreate a target');
    target.addEventListener('dispose', () => disposed++);
    reflection.dispose(); reflection.dispose(); reflection.setQuality('low');
    assert.equal(disposed, 2);
    assert.equal(reflection.target, target);
  } finally { reflection.dispose(); ocean.geometry.dispose(); ocean.material.dispose(); }
});
