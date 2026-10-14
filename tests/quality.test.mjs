import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuality } from '../renderer.js';

test('wide landscape phones retain the mobile budget when auto quality is selected', () => {
  for (const width of [390, 844, 932, 1024, 1366]) assert.equal(resolveQuality('auto', width, 8, true), 'low');
});
test('desktop auto quality responds to viewport and limited CPU while explicit choices win', () => {
  assert.equal(resolveQuality('auto', 1280, 8, false), 'high');
  assert.equal(resolveQuality('auto', 844, 8, false), 'low');
  assert.equal(resolveQuality('auto', 1280, 4, false), 'low');
  assert.equal(resolveQuality('high', 390, 4, true), 'high');
  assert.equal(resolveQuality('low', 1920, 16, false), 'low');
});
