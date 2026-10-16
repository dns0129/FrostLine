// Visual budgets only. Simulation, collisions and world scale do not depend on
// these profiles; every tier shares the same 60 Hz simulation step.
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', label: '标清', pixelRatioCap: 1.15,
    shadows: false, shadowMapSize: 512,
    reflectionResolution: 256, reflectionHz: 15, reflectionHDR: false,
    cloudOctaves: 3, oceanDetail: 0, fleetLodDistance: 1800,
    textureAnisotropy: 2, terrainSegments: 72, distantTerrainSegments: 28,
    maxPebbles: 128, rockTextureSamples: 4,
  }),
  high: Object.freeze({
    id: 'high', label: '高清', pixelRatioCap: 1.5,
    shadows: true, shadowMapSize: 1024,
    reflectionResolution: 512, reflectionHz: 30, reflectionHDR: true,
    cloudOctaves: 5, oceanDetail: 1, fleetLodDistance: 2600,
    textureAnisotropy: 4, terrainSegments: 118, distantTerrainSegments: 42,
    maxPebbles: 288, rockTextureSamples: 7,
  }),
  ultra: Object.freeze({
    id: 'ultra', label: '超清', pixelRatioCap: 2,
    shadows: true, shadowMapSize: 2048,
    reflectionResolution: 768, reflectionHz: 30, reflectionHDR: true,
    cloudOctaves: 6, oceanDetail: 2, fleetLodDistance: 3600,
    textureAnisotropy: 8, terrainSegments: 152, distantTerrainSegments: 56,
    maxPebbles: 448, rockTextureSamples: 10,
  }),
});

export function normalizeQuality(requested = 'auto') {
  return Object.hasOwn(QUALITY_PRESETS, requested) ? requested : 'auto';
}

// Keep the existing positional API so saved low/high settings remain valid.
// Ultra is an explicit choice: auto never silently increases desktop cost.
export function resolveQuality(requested, width, cores = 8, coarse = false) {
  requested = normalizeQuality(requested);
  if (requested !== 'auto') return requested;
  return coarse || width < 850 || cores <= 4 ? 'low' : 'high';
}

export function getQualityPreset(quality = 'high') {
  return QUALITY_PRESETS[normalizeQuality(quality)] || QUALITY_PRESETS.high;
}
