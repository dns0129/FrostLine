import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeSky, makeOcean } from '../atmosphere.js';
import { getQualityPreset } from '../quality.js';

function dispose(mesh) {
  for (const uniform of Object.values(mesh.material.uniforms)) if (uniform.value?.isTexture) uniform.value.dispose();
  mesh.geometry.dispose(); mesh.material.dispose();
}

test('sky and ocean share map colors, reset themes, and preserve geometry across quality changes', async () => {
  const sky = makeSky(), ocean = makeOcean(), skyGeometry = sky.geometry, oceanGeometry = ocean.geometry;
  try {
    assert.equal(await sky.userData.ready, false, 'Node must retain a local sky fallback without loading an image');
    const initial = sky.material.uniforms.skyHorizon.value.clone();
    const theme = { skyHorizon: '#d8c4a0', skyZenith: '#537b98', sunTint: '#ffe8c3', waterDeep: '#063c4c', waterShallow: '#267a8a', cloudCoverage: .12, panoramaMix: .3, haze: .7 };
    sky.userData.setTheme(theme); ocean.userData.setTheme(theme);
    for (const key of ['skyHorizon', 'skyZenith', 'sunTint']) {
      assert.equal(sky.material.uniforms[key].value.equals(new THREE.Color(theme[key])), true);
      assert.equal(sky.material.uniforms[key].value.equals(ocean.material.uniforms[key].value), true);
    }
    assert.equal(ocean.material.uniforms.waterDeep.value.equals(new THREE.Color(theme.waterDeep)), true);
    assert.equal(sky.material.uniforms.cloudCoverage.value, .12);
    assert.equal(sky.material.uniforms.panoramaMix.value, .3);
    assert.equal(ocean.material.uniforms.haze.value, .7);
    for (const quality of ['ultra', 'low', 'high', 'ultra']) {
      sky.userData.setQuality(quality); ocean.userData.setQuality(quality);
      const profile = getQualityPreset(quality);
      assert.equal(sky.material.uniforms.cloudOctaves.value, profile.cloudOctaves);
      assert.equal(ocean.material.uniforms.highQuality.value, profile.oceanDetail);
      assert.equal(ocean.material.uniforms.waveNormalMap.value.anisotropy, profile.textureAnisotropy);
      assert.equal(sky.geometry, skyGeometry); assert.equal(ocean.geometry, oceanGeometry);
      assert.equal(sky.material.uniforms.skyHorizon.value.equals(new THREE.Color(theme.skyHorizon)), true, 'quality changes must retain map atmosphere');
    }
    sky.userData.setTheme({}); ocean.userData.setTheme({});
    assert.equal(sky.material.uniforms.skyHorizon.value.equals(initial), true);
    assert.equal(ocean.material.uniforms.skyHorizon.value.equals(initial), true);
    assert.equal(sky.material.uniforms.panoramaMix.value, 1);
    assert.equal(ocean.material.uniforms.haze.value, 1);
  } finally { dispose(sky); dispose(ocean); }
});

test('theme scalar settings remain finite and within the shader budgets', () => {
  const sky = makeSky(), ocean = makeOcean();
  try {
    sky.userData.setTheme({ cloudCoverage: 3, panoramaMix: -4 });
    ocean.userData.setTheme({ haze: Infinity });
    assert.equal(sky.material.uniforms.cloudCoverage.value, 1);
    assert.equal(sky.material.uniforms.panoramaMix.value, 0);
    assert.equal(ocean.material.uniforms.haze.value, 1);
    ocean.userData.setTheme({ haze: -1 });
    assert.equal(ocean.material.uniforms.haze.value, 0);
    assert.ok(ocean.geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(ocean.geometry.attributes.position.array.every((value, i) => i % 3 !== 1 || Math.abs(value) < 1e-8), 'quality never displaces the sea-level collision plane');
  } finally { dispose(sky); dispose(ocean); }
});
