import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY_PRESETS, getQualityPreset, normalizeQuality, resolveQuality } from '../quality.js';
import { resolveQuality as rendererQuality } from '../renderer.js';
import * as THREE from '../vendor/three.module.js';
import { AmbientFleet } from '../ambient-fleet.js';

test('wide landscape phones retain the mobile budget when auto quality is selected', () => {
  for (const width of [390, 844, 932, 1024, 1366]) assert.equal(resolveQuality('auto', width, 8, true), 'low');
});
test('desktop auto quality responds to viewport and limited CPU while explicit choices win', () => {
  assert.equal(resolveQuality('auto', 1280, 8, false), 'high');
  assert.equal(resolveQuality('auto', 844, 8, false), 'low');
  assert.equal(resolveQuality('auto', 1280, 4, false), 'low');
  assert.equal(resolveQuality('high', 390, 4, true), 'high');
  assert.equal(resolveQuality('low', 1920, 16, false), 'low');
  assert.equal(resolveQuality('ultra', 390, 4, true), 'ultra');
  assert.equal(resolveQuality('auto', 3840, 32, false), 'high', 'ultra remains an explicit choice');
});

test('three named quality profiles retain compatible settings and strictly bounded visual budgets', () => {
  assert.equal(rendererQuality, resolveQuality, 'the renderer must share the quality resolver used by scene budgets');
  assert.deepEqual(Object.keys(QUALITY_PRESETS), ['low', 'high', 'ultra']);
  assert.deepEqual(Object.values(QUALITY_PRESETS).map(p => p.label), ['标清', '高清', '超清']);
  const monotonic = ['pixelRatioCap', 'reflectionResolution', 'cloudOctaves', 'oceanDetail', 'fleetLodDistance', 'textureAnisotropy', 'terrainSegments', 'distantTerrainSegments', 'maxPebbles', 'rockTextureSamples'];
  for (const key of monotonic) {
    const values = Object.values(QUALITY_PRESETS).map(p => p[key]);
    assert.ok(values.every(Number.isFinite) && values[0] < values[1] && values[1] < values[2], `${key} needs three distinct finite budgets`);
  }
  for (const [key, preset] of Object.entries(QUALITY_PRESETS)) {
    assert.equal(getQualityPreset(key), preset);
    assert.equal(preset.id, key);
    assert.ok(Object.isFrozen(preset));
    assert.ok(preset.reflectionHz > 0 && preset.reflectionHz <= 30);
    assert.ok(preset.pixelRatioCap <= 2 && preset.reflectionResolution <= 768);
    assert.equal('simulationHz' in preset, false, 'visual quality must not change simulation time');
  }
  assert.equal(QUALITY_PRESETS.low.shadows, false);
  assert.equal(QUALITY_PRESETS.high.shadows, true);
  assert.equal(QUALITY_PRESETS.ultra.shadows, true);
  assert.equal(normalizeQuality('unknown'), 'auto');
  assert.equal(getQualityPreset('unknown'), QUALITY_PRESETS.high);
  assert.equal(getQualityPreset('auto'), QUALITY_PRESETS.high);
});

test('fleet tiers change detail distance and texture filtering while preserving ship count and dimensions', () => {
  const scene = new THREE.Scene(), fleet = new AmbientFleet(scene);
  try {
    const models = fleet.ships.map(s => s.model), transforms = models.map(model => model.matrix.clone());
    for (const quality of ['low', 'high', 'ultra', 'low']) {
      fleet.setQuality(quality);
      const preset = getQualityPreset(quality);
      assert.equal(fleet.group.children.length, 12);
      assert.deepEqual(fleet.ships.map(s => s.model), models);
      assert.ok(models.every((model, i) => model.matrix.equals(transforms[i]) && model.scale.equals(new THREE.Vector3(1, 1, 1))));
      assert.ok(models.every(model => model.userData.lod.levels[1].distance === preset.fleetLodDistance));
      for (const maps of Object.values(fleet.assets.textures)) for (const texture of Object.values(maps)) assert.equal(texture.anisotropy, preset.textureAnisotropy);
    }
  } finally { fleet.dispose(); }
});
