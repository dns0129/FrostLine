import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.js';
import { MAPS, DEFAULT_MAP_ID, getMap } from '../maps.js';
import { getActiveMap, setActiveMap, terrainHeight } from '../world-math.js';
import { makeTerrain } from '../terrain.js';
import { makeSky, makeOcean } from '../atmosphere.js';
import { WorldRenderer } from '../renderer.js';
import { Simulation } from '../simulation.js';
import { campaignLevel, campaignUnlocked, normalizeCampaignProgress } from '../campaign.js';

function resourcesIn(group) {
  const resources = new Set(), materials = new Set();
  const texture = value => { if (value?.isTexture) resources.add(value); };
  group.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.isInstancedMesh) resources.add(object);
    if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  for (const material of materials) {
    resources.add(material);
    Object.values(material).forEach(texture);
    for (const uniform of Object.values(material.uniforms ?? {})) texture(uniform.value);
    if (material.isMeshStandardMaterial) {
      const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      material.onBeforeCompile(shader);
      for (const uniform of Object.values(shader.uniforms)) texture(uniform.value);
    }
  }
  return resources;
}

function watchDisposal(resources) {
  const counts = new Map([...resources].map(resource => [resource, 0]));
  for (const resource of resources) resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  return counts;
}

function sceneInventory(scene) {
  let objects = 0, meshes = 0, instances = 0;
  const geometry = new Set(), materials = new Set();
  scene.traverse(object => {
    objects++;
    if (!object.isMesh) return;
    meshes++;
    if (object.isInstancedMesh) instances += object.count;
    geometry.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  return { objects, meshes, instances, geometries: geometry.size, materials: materials.size };
}

function fixture(quality = 'low') {
  const world = Object.create(WorldRenderer.prototype);
  const map = setActiveMap(DEFAULT_MAP_ID), scene = new THREE.Scene();
  scene.background = new THREE.Color(); scene.fog = new THREE.FogExp2();
  Object.assign(world, {
    scene, map, mapId: map.id, effectiveQuality: quality,
    sky: makeSky(), ocean: makeOcean(), terrain: makeTerrain(quality, map.id),
    sun: new THREE.DirectionalLight(), hemisphere: new THREE.HemisphereLight(),
    renderer: { extensions: { has: () => false }, toneMappingExposure: 1 },
    cameraReady: true, trail: [new THREE.Vector3(1, 2, 3)], refreshReflection: false,
  });
  const vehicle = new THREE.Group(); vehicle.name = 'persistent vehicle scene';
  scene.add(world.sky, world.ocean, world.terrain, world.sun, world.sun.target, world.hemisphere, vehicle);
  world._applyMapTheme();
  return {
    world,
    dispose() {
      world.terrain.userData.dispose();
      for (const mesh of [world.sky, world.ocean]) for (const resource of resourcesIn(mesh)) resource.dispose();
      world.sun.shadow.dispose(); scene.clear();
    },
  };
}

function assertTheme(world, map) {
  const theme = map.theme;
  const color = (actual, expected) => assert.ok(actual.equals(new THREE.Color(expected)));
  color(world.scene.background, theme.fogColor);
  color(world.scene.fog.color, theme.fogColor);
  assert.equal(world.scene.fog.density, theme.fogDensity);
  color(world.sun.color, theme.sunColor); assert.equal(world.sun.intensity, theme.sunIntensity);
  color(world.hemisphere.color, theme.skyHorizon);
  assert.equal(world.renderer.toneMappingExposure, theme.exposure);
  for (const name of ['skyZenith', 'skyHorizon', 'skyBelowHorizon', 'sunTint']) {
    color(world.sky.material.uniforms[name].value, theme[name]);
    color(world.ocean.material.uniforms[name].value, theme[name]);
  }
  color(world.ocean.material.uniforms.waterDeep.value, theme.waterDeep);
  color(world.ocean.material.uniforms.waterShallow.value, theme.waterShallow);
  assert.equal(world.sky.material.uniforms.cloudCoverage.value, theme.cloudCoverage);
  assert.equal(world.sky.material.uniforms.panoramaMix.value, theme.panoramaMix);
  assert.equal(world.ocean.material.uniforms.haze.value, theme.haze);
}

for (const quality of ['low', 'high', 'ultra']) {
  test(`${quality}: real renderer map switches replace and release terrain while retaining a bounded scene`, async () => {
    const previousMap = getActiveMap(), setup = fixture(quality), { world } = setup;
    const retired = [], inventories = new Map();
    const persistent = world.scene.children.filter(object => object !== world.terrain);
    const persistentResources = watchDisposal(new Set([...resourcesIn(world.sky), ...resourcesIn(world.ocean)]));
    try {
      await world.sky.userData.ready; await world.terrain.userData.ready;
      inventories.set(world.mapId, sceneInventory(world.scene));
      // Two complete tours revisit every map, including the original. Each
      // visit must have the same scene/resource counts as the first visit.
      for (let tour = 0; tour < 2; tour++) for (const map of [...MAPS.slice(1), MAPS[0]]) {
        const oldTerrain = world.terrain, oldResources = resourcesIn(oldTerrain);
        const released = watchDisposal(oldResources); retired.push(released);
        world.cameraReady = true; world.trail.push(new THREE.Vector3()); world.refreshReflection = false;
        assert.equal(world.setMap(map.id), map);
        await world.terrain.userData.ready;
        assert.equal(world.mapId, map.id); assert.equal(world.map, map); assert.equal(getActiveMap(), map);
        assert.equal(world.terrain.userData.mapId, map.id);
        assert.equal(world.terrain.userData.stats.quality, quality);
        assert.equal(world.effectiveQuality, quality);
        assert.notEqual(world.terrain, oldTerrain); assert.equal(oldTerrain.parent, null);
        assert.equal(world.terrain.parent, world.scene);
        assert.equal(world.cameraReady, false); assert.equal(world.trail.length, 0); assert.equal(world.refreshReflection, true);
        assertTheme(world, map);
        for (const count of released.values()) assert.equal(count, 1, 'retired geometry, material, texture and instance buffers release once');
        oldTerrain.userData.dispose();
        for (const count of released.values()) assert.equal(count, 1, 'retired terrain disposal remains idempotent');
        const current = resourcesIn(world.terrain);
        for (const resource of current) assert.ok(!oldResources.has(resource), 'current terrain must not retain retired resources');
        assert.deepEqual(world.scene.children.filter(object => object !== world.terrain), persistent);
        assert.equal(world.scene.children.filter(object => object.userData.mapId).length, 1, 'only the current terrain stays attached');
        const counts = sceneInventory(world.scene);
        if (inventories.has(map.id)) assert.deepEqual(counts, inventories.get(map.id), 'revisiting a map cannot grow scene objects or resources');
        else inventories.set(map.id, counts);
        for (const counts of retired) for (const count of counts.values()) assert.equal(count, 1);
        for (const count of persistentResources.values()) assert.equal(count, 0, 'sky and ocean resources survive map changes');
        const island = map.islands[0];
        assert.ok(Number.isFinite(terrainHeight(island.x, island.z)));
        if (map.structures.length) {
          const building = map.structures.find(structure => structure.kind === 'building');
          assert.equal(terrainHeight(building.x, building.z), building.y + building.height);
        }
      }
    } finally { setup.dispose(); setActiveMap(previousMap.id); }
  });
}

test('reapplying the selected map reasserts collision state without allocating or resetting the scene', () => {
  const previousMap = getActiveMap(), setup = fixture(), { world } = setup;
  try {
    const terrain = world.terrain, children = [...world.scene.children];
    const resources = resourcesIn(terrain), releases = watchDisposal(resources), sceneCounts = sceneInventory(world.scene);
    const trail = [...world.trail];
    setActiveMap('city-bay');
    for (let repeat = 0; repeat < 10; repeat++) assert.equal(world.setMap(DEFAULT_MAP_ID), getMap(DEFAULT_MAP_ID));
    assert.equal(getActiveMap().id, DEFAULT_MAP_ID);
    assert.equal(world.terrain, terrain); assert.deepEqual(world.scene.children, children);
    assert.deepEqual(resourcesIn(terrain), resources); assert.deepEqual(sceneInventory(world.scene), sceneCounts);
    assert.equal(world.cameraReady, true); assert.deepEqual(world.trail, trail); assert.equal(world.refreshReflection, false);
    for (const count of releases.values()) assert.equal(count, 0);
  } finally { setup.dispose(); setActiveMap(previousMap.id); }
});

test('an invalid map selection returns to the original rendered geography, collisions and theme', () => {
  const previousMap = getActiveMap(), setup = fixture(), { world } = setup;
  try {
    world.setMap('city-bay');
    const city = getMap('city-bay'), building = city.structures[0];
    assert.equal(terrainHeight(building.x, building.z), building.y + building.height);
    const retired = watchDisposal(resourcesIn(world.terrain));
    const fallback = world.setMap('unknown-or-obsolete-map');
    assert.equal(fallback, getMap(DEFAULT_MAP_ID));
    assert.equal(world.mapId, DEFAULT_MAP_ID); assert.equal(world.terrain.userData.mapId, DEFAULT_MAP_ID);
    assert.equal(getActiveMap(), fallback); assertTheme(world, fallback);
    assert.notEqual(terrainHeight(building.x, building.z), building.y + building.height,
      'returning to the original map must clear the city structure collision index');
    for (const count of retired.values()) assert.equal(count, 1);
    const terrain = world.terrain;
    world.setMap(null); assert.equal(world.terrain, terrain, 'invalid ids share the existing fallback map without rebuilding');
  } finally { setup.dispose(); setActiveMap(previousMap.id); }
});

test('app mission transitions preserve the saved quick map while campaigns use the original geography', () => {
  const previousMap = getActiveMap(), setup = fixture(), { world } = setup;
  try {
    // Execute production transition functions. Replace only DOM, input and
    // audio boundaries; Simulation and the renderer map lifecycle remain real.
    const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
    const functionSource = name => {
      const start = source.indexOf(`function ${name}(`);
      assert.ok(start >= 0, `${name} transition must exist`);
      const end = source.indexOf('\nfunction ', start + 1);
      return source.slice(start, end < 0 ? source.length : end);
    };
    const fields = new Map(), writes = [];
    const field = id => {
      if (!fields.has(id)) fields.set(id, { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
      return fields.get(id);
    };
    const buttons = MAPS.map(map => ({ ...field(`button-${map.id}`), dataset: { map: map.id } }));
    world.shipChase = { recenter() {} }; world.render = () => {};
    const sim = new Simulation();
    const context = vm.createContext({
      sim, world, getMap, DEFAULT_MAP_ID, campaignLevel, campaignUnlocked,
      settings: { map: DEFAULT_MAP_ID, difficulty: 'normal' },
      campaignProgress: normalizeCampaignProgress(null), selectedCampaignId: 'dawn',
      selectedMode: 'training', selectedVehicle: 'aircraft', playMode: 'quick',
      endingShown: false, cockpit: false, accumulator: 0, frameTime: 0, cannonAim: null,
      modeCodes: { training: 'TRAINING', campaign: 'CAMPAIGN' },
      $: field, document: { body: { classList: { toggle() {} } }, querySelectorAll: () => buttons, documentElement: {} },
      performance, matchMedia: () => ({ matches: false }),
      save(key, value) { writes.push({ key, value: JSON.parse(JSON.stringify(value)) }); },
      input: { reset() {}, active: false }, sound: { init() {}, silence() {} },
      baseScene: { cancelPointers() {}, dirty: false },
      presentation: { reset() {}, sample: () => sim },
      toast() {}, closePanels() {}, syncCameraControls() {}, readouts() {},
      selectMode(mode) { context.selectedMode = mode; },
      selectVehicle(vehicle) { context.selectedVehicle = vehicle; },
      isShip: () => context.selectedVehicle === 'destroyer',
      isNaval: mode => mode === 'naval' || mode === 'naval-training',
    });
    vm.runInContext(['syncMapSelection', 'selectMap', 'start', 'base'].map(functionSource).join('\n'), context);
    context.selectMap('city-bay');
    assert.equal(context.settings.map, 'city-bay');
    assert.equal(writes.length, 1); assert.equal(writes[0].key, 'frostline-settings');
    assert.equal(writes[0].value.map, 'city-bay');
    context.start('training');
    assert.equal(world.mapId, 'city-bay'); assert.equal(getActiveMap().id, 'city-bay');
    assert.equal(sim.state, 'playing'); assert.equal(sim.mode, 'training');
    assert.equal(field('flightMapName').textContent, getMap('city-bay').name);
    context.selectMap('ice-ocean');
    assert.equal(context.settings.map, 'city-bay', 'playing must not change the saved or active map');
    assert.equal(writes.length, 1);
    context.base(); context.playMode = 'campaign'; context.syncMapSelection();
    assert.equal(field('mapSelectBtn').disabled, true);
    assert.ok(buttons.every(button => button.disabled));
    context.selectMap('ice-ocean');
    assert.equal(context.settings.map, 'city-bay', 'campaign selection must preserve the quick-map preference');
    context.start('campaign');
    assert.equal(sim.mode, 'campaign'); assert.equal(world.mapId, DEFAULT_MAP_ID);
    assert.equal(getActiveMap().id, DEFAULT_MAP_ID); assert.equal(context.settings.map, 'city-bay');
    assert.equal(field('flightMapName').textContent, getMap(DEFAULT_MAP_ID).name);
    context.base(); context.playMode = 'quick'; context.syncMapSelection();
    assert.equal(field('mapSelectBtn').disabled, false); assert.ok(buttons.every(button => !button.disabled));
    context.start('training');
    assert.equal(world.mapId, 'city-bay'); assert.equal(getActiveMap().id, 'city-bay');
    assert.equal(sim.mode, 'training'); assert.equal(writes.length, 1);
  } finally { setup.dispose(); setActiveMap(previousMap.id); }
});
