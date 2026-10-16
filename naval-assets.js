import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { NAVAL_MODELS } from './naval-models.js';

// Hull numbers are separate objects named "Hull number <n> (...)" so one GLB can
// carry every number its class uses in the fleet (51 / 52, 172 / 173).
const HULL_NUMBER = /^Hull_number_(\d+)/;
const tag = (o, read) => read(o) ?? (o.parent && !o.parent.isScene ? read(o.parent) : undefined);

// Bake node transforms and merge by material (and by painted number): one draw
// object per material, the { key, geometry, material, number } layout used by
// makeNavalShip.
function mergeByMaterial(meshes) {
  const groups = new Map();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.index) geometry.setIndex([...Array(geometry.attributes.position.count).keys()]);
    const number = tag(mesh, o => o.name.match(HULL_NUMBER)?.[1]) || '';
    const id = `${number}|${mesh.material.uuid}`;
    if (!groups.has(id)) groups.set(id, { material: mesh.material, number, list: [] });
    groups.get(id).list.push(geometry);
  }
  return [...groups.values()].map(({ material, number, list }) => {
    if (list.some(g => !g.attributes.uv)) list.forEach(g => g.deleteAttribute('uv'));
    const geometry = mergeGeometries(list); list.forEach(g => g.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { key: material.name, geometry, material, number: number || null };
  });
}

// Pure preparation shared by the browser loader and the Node fixture.
export function prepareNavalAssets(gltfScene, metadata, type) {
  const def = NAVAL_MODELS[type];
  if (!def?.asset) throw new Error(`Unknown naval model: ${type}`);
  if (metadata.units !== 'metres' || metadata.glb_axes !== '+Y up, bow -Z') {
    throw new Error(`${def.name} asset has incompatible coordinate metadata`);
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
  const distant = o => !tag(o, p => p.name.match(HULL_NUMBER)?.[1])
    && (tag(o, p => p.userData.silhouette || undefined) || def.silhouette?.test(o.name));
  const levels = [mergeByMaterial(meshes), mergeByMaterial(meshes.filter(distant))];
  meshes.forEach(o => o.geometry.dispose());
  let disposed = false;
  return { levels, metadata, numbers: [...new Set(levels[0].map(l => l.number).filter(Boolean))].sort(),
    dispose() {
      if (disposed) return; disposed = true;
      for (const level of levels) for (const { geometry } of level) geometry.dispose();
      for (const m of materials) { for (const v of Object.values(m)) if (v?.isTexture) { v.dispose(); v.source?.data?.close?.(); } m.dispose(); }
    } };
}

export async function loadNavalAsset(type) {
  const { asset } = NAVAL_MODELS[type];
  const url = new URL(`./assets/models/${asset}.glb`, import.meta.url);
  const metadataURL = new URL(`./assets/models/${asset}.metadata.json`, import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`${asset} metadata: ${response.status}`);
  return prepareNavalAssets(gltf.scene, await response.json(), type);
}

// Every fleet class, keyed by asset id; on any failure the loaded ones are released.
export async function loadNavalAssets() {
  const types = Object.keys(NAVAL_MODELS);
  const results = await Promise.allSettled(types.map(loadNavalAsset));
  const failed = results.find(r => r.status === 'rejected');
  if (failed) { results.forEach(r => r.value?.dispose()); throw failed.reason; }
  return { assets: Object.fromEntries(types.map((type, i) => [NAVAL_MODELS[type].asset, results[i].value])),
    dispose() { results.forEach(r => r.value.dispose()); } };
}
