import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

// Above-waterline masses that read at range; everything else is near detail only.
const SILHOUETTE = /^(Hull_[12]|Flight_deck_slab_[12]|Gallery_deck_band|Weapon_sponsons|Island_(podium|main_block|SX-band_arrays.*)|Integrated_mast|Exhaust_uptake_housing|Bridge_wing|Aft_flight-control_platform)$/;

// Bake node transforms and merge by material: one draw object per material,
// the same layout as the procedural fleet classes ({ key, geometry, material }).
function mergeByMaterial(meshes) {
  const groups = new Map();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
    if (!groups.has(mesh.material)) groups.set(mesh.material, []);
    groups.get(mesh.material).push(geometry);
  }
  return [...groups].map(([material, list]) => {
    if (list.some(g => !g.attributes.uv)) list.forEach(g => g.deleteAttribute('uv'));
    const geometry = mergeGeometries(list); list.forEach(g => g.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { key: material.name, geometry, material };
  });
}

export function prepareFujianAssets(gltfScene, metadata) {
  if (metadata.units !== 'metres' || metadata.glb_axes !== '+Y up, bow -Z') {
    throw new Error('Fujian asset has incompatible coordinate metadata');
  }
  gltfScene.updateMatrixWorld(true);
  const meshes = [];
  gltfScene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const materials = new Set(meshes.map(o => o.material));
  for (const m of materials) {
    m.envMapIntensity = m.transparent ? .7 : .48;
    if (m.transparent) m.depthWrite = false;
    for (const v of Object.values(m)) if (v?.isTexture) v.anisotropy = 4;
  }
  const levels = [mergeByMaterial(meshes), mergeByMaterial(meshes.filter(o => SILHOUETTE.test(o.name)))];
  meshes.forEach(o => o.geometry.dispose());
  let disposed = false;
  return { levels, metadata,
    dispose() {
      if (disposed) return; disposed = true;
      for (const level of levels) for (const { geometry } of level) geometry.dispose();
      for (const m of materials) { for (const v of Object.values(m)) if (v?.isTexture) { v.dispose(); v.source?.data?.close?.(); } m.dispose(); }
    } };
}

export async function loadFujianAssets() {
  const url = new URL('./assets/models/fujian.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/fujian.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`Fujian metadata: ${response.status}`);
  return prepareFujianAssets(gltf.scene, await response.json());
}
