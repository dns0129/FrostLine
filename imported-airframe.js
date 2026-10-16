import * as THREE from './vendor/three.module.js';
import { makeJet } from './aircraft.js';
import { attachAircraftStores } from './aircraft-stores.js';

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
  for (const root of roots) root.traverse(o => {
    if (o.geometry) geometry.add(o.geometry);
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  geometry.forEach(v => v.dispose()); materials.forEach(v => v.dispose());
  textures.forEach(v => { v.dispose(); v.source?.data?.close?.(); });
}

// Share the imported airframe/materials between the parked and airborne model.
// Keep instance-owned plume geometry/materials out of the shared asset disposal.
export function makeImportedJet(assets, jetAssets, { parked = false, aircraftId, modelId = aircraftId, name, modelName = name } = {}) {
  const jet = makeJet(jetAssets);
  for (const child of [...jet.children]) {
    if (child !== jet.userData.exhaust && child !== jet.userData.exhaustCore) jet.remove(child);
  }
  jet.name = name;
  const model = assets.scene.clone(true); model.name = modelName; jet.add(model);
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
  const stores = attachAircraftStores(jet, aircraftId, { templates: assets.templates, overrides: assets.storeOverrides });
  jet.userData.setLoadout = stores.setLoadout;
  jet.userData.stores = stores.group;
  const update = jet.userData.update;
  jet.userData.update = (dt, state = {}) => {
    update(dt, state);
    if (!parked && state.stores) stores.setLoadout(state.stores);
    if (parked) { jet.userData.exhaust.visible = false; jet.userData.exhaustCore.visible = false; }
  };
  const dispose = jet.userData.dispose; let disposed = false;
  jet.userData.dispose = () => {
    if (disposed) return; disposed = true;
    dispose(); ownedGeometry.forEach(g => g.dispose()); stores.dispose();
  };
  return jet;
}
