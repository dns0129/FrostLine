import * as THREE from './vendor/three.module.js';
import { makeJet } from './aircraft.js';

// Shared rules for every imported (Blender/GLB) airframe: metres, nose -Z, +Y up,
// gear meshes tagged userData.role = 'gear', and metadata giving span, wingtips,
// nozzle exits and the parked ground offset in the airframe's own coordinates.
export function prepareAirframeMaterials(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = !o.material.transparent; o.receiveShadow = true;
    o.material.envMapIntensity = .65;
    if (o.material.transparent) o.material.depthWrite = false;
    for (const v of Object.values(o.material)) if (v?.isTexture) v.anisotropy = 4;
  });
}

export function disposeAirframeObjects(...roots) {
  const geometry = new Set(), materials = new Set(), textures = new Set();
  for (const root of roots.filter(Boolean)) root.traverse(o => {
    if (o.geometry) geometry.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  geometry.forEach(v => v.dispose()); materials.forEach(v => v.dispose());
  textures.forEach(v => { v.dispose(); v.source?.data?.close?.(); });
}

// The source GLBs remain intact for attribution and model-reference tests.
// Cache a clean shared scene, removing only identified rack/rail assemblies.
// Four J-16 wing pylons are separate connected components of the wing mesh.
function removeIntegratedPylons(mesh) {
  const source = mesh.geometry, pos = source.attributes.position, index = source.index;
  const parents = [], canonical = [], points = [], keys = new Map();
  const find = id => parents[id] === id ? id : (parents[id] = find(parents[id]));
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[b] = a; };
  const point = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const key = point.toArray().map(value => Math.round(value * 1e4)).join(',');
    let id = keys.get(key);
    if (id === undefined) { id = parents.length; keys.set(key, id); parents.push(id); points.push(point.clone()); }
    canonical.push(id);
  }
  const count = index?.count ?? pos.count;
  for (let i = 0; i < count; i += 3) {
    const a = canonical[index ? index.getX(i) : i];
    union(a, canonical[index ? index.getX(i + 1) : i + 1]); union(a, canonical[index ? index.getX(i + 2) : i + 2]);
  }
  const bounds = new Map();
  for (let i = 0; i < points.length; i++) { const id = find(i); if (!bounds.has(id)) bounds.set(id, new THREE.Box3()); bounds.get(id).expandByPoint(points[i]); }
  const removed = new Set();
  for (const [id, box] of bounds) {
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()), x = Math.abs(center.x);
    if ((x > 4.7 && x < 5 || x > 6.3 && x < 6.6) && size.x < .2 && size.y < .6 && size.z > 1.5 && size.z < 2.6) removed.add(id);
  }
  if (!removed.size) return null;
  const kept = [];
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    if (!removed.has(find(canonical[a]))) for (let j = 0; j < 3; j++) kept.push(index ? index.getX(i + j) : i + j);
  }
  const geometry = source.clone(); geometry.setIndex(kept); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { ...source.userData, removedPylons: removed.size }; mesh.geometry = geometry;
  return geometry;
}

function cleanAirframe(assets, aircraftId) {
  if (assets.cleanScene) return assets.cleanScene;
  const clean = assets.scene.clone(true), hardware = [];
  clean.updateMatrixWorld(true);
  clean.traverse(object => {
    if (aircraftId === 'fa18c' && object.name === 'FA18_airframe_material_batch_13'
      || aircraftId === 'j16' && /^(?:PL-1[05]_).*(?:pylon|launch_rail)$/.test(object.name)) hardware.push(object);
    if (aircraftId === 'j16' && object.isMesh && object.name === 'J16_fuselage,_wings_&_tail') removeIntegratedPylons(object);
  });
  hardware.forEach(object => object.removeFromParent());
  assets.cleanScene = clean;
  return clean;
}

// Share the imported airframe/materials between the parked and airborne model.
// Keep instance-owned plume geometry/materials out of the shared asset disposal.
export function makeImportedJet(assets, jetAssets, { parked = false, aircraftId, modelId = aircraftId, name, modelName = name } = {}) {
  const jet = makeJet(jetAssets);
  for (const child of [...jet.children]) {
    if (child !== jet.userData.exhaust && child !== jet.userData.exhaustCore) jet.remove(child);
  }
  jet.name = name;
  const model = cleanAirframe(assets, aircraftId).clone(true); model.name = modelName; jet.add(model);
  const gear = [];
  model.traverse(o => { if (o.userData.role === 'gear') { o.visible = parked; gear.push(o); } });
  const nozzles = [...assets.metadata.nozzles].sort((a, b) => a[0] - b[0]);
  const ownedGeometry = [];
  for (const plume of [jet.userData.exhaust, jet.userData.exhaustCore]) {
    const geometry = plume.geometry.clone(), position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const oldX = position.getX(i), side = oldX < 0 ? -1 : 1;
      const anchor = nozzles[side < 0 ? 0 : 1];
      position.setX(i, anchor[0] + (oldX - side * .97));
    }
    position.needsUpdate = true; geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    plume.geometry = geometry; ownedGeometry.push(geometry);
    plume.position.set(0, (nozzles[0][1] + nozzles[1][1]) / 2,
      (nozzles[0][2] + nozzles[1][2]) / 2 + .015);
    plume.visible = !parked && plume === jet.userData.exhaust;
  }
  jet.userData.modelId = modelId; jet.userData.aircraftId = aircraftId; jet.userData.gear = gear;
  jet.userData.airframeScale = assets.metadata.span / 17.1;
  jet.userData.wingtips = assets.metadata.wingtips.map(p => new THREE.Vector3(...p));
  jet.userData.groundOffset = assets.metadata.parkedGroundOffset;
  // Empty compatibility group for old scene snapshots; no weapon racks,
  // missile stores or fuel tanks are created by gameplay models.
  const stores = new THREE.Group(); stores.name = 'Internal weapon system'; jet.add(stores);
  jet.userData.setLoadout = () => {};
  jet.userData.stores = stores;
  const update = jet.userData.update;
  jet.userData.update = (dt, state = {}) => {
    update(dt, state);
    if (parked) { jet.userData.exhaust.visible = false; jet.userData.exhaustCore.visible = false; }
  };
  const dispose = jet.userData.dispose; let disposed = false;
  jet.userData.dispose = () => {
    if (disposed) return; disposed = true;
    dispose(); ownedGeometry.forEach(g => g.dispose()); jet.remove(stores);
  };
  return jet;
}
