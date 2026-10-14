import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { makeJet } from './aircraft.js';

export async function loadFA18Assets() {
  const url = new URL('./assets/models/fa18c.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/fa18c.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`F/A-18 metadata: ${response.status}`);
  const metadata = await response.json();
  if (metadata.forward !== '-Z' || metadata.up !== '+Y' || !metadata.nozzles?.length) {
    throw new Error('F/A-18 asset has incompatible coordinate metadata');
  }
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = !o.material.transparent; o.receiveShadow = true;
    o.material.envMapIntensity = .65;
    if (o.material.transparent) o.material.depthWrite = false;
    for (const v of Object.values(o.material)) if (v?.isTexture) v.anisotropy = 4;
  });
  let disposed = false;
  return {
    scene: gltf.scene, metadata,
    dispose() {
      if (disposed) return; disposed = true;
      const geometry = new Set(), materials = new Set(), textures = new Set();
      gltf.scene.traverse(o => {
        if (o.geometry) geometry.add(o.geometry);
        if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
        }
      });
      geometry.forEach(v => v.dispose()); materials.forEach(v => v.dispose());
      textures.forEach(v => { v.dispose(); v.source?.data?.close?.(); });
    },
  };
}

// Share the imported airframe/materials between the parked and airborne model.
// Keep instance-owned plume geometry/materials out of the shared asset disposal.
export function makeFA18(assets, jetAssets, { parked = false } = {}) {
  const jet = makeJet(jetAssets);
  for (const child of [...jet.children]) {
    if (child !== jet.userData.exhaust && child !== jet.userData.exhaustCore) jet.remove(child);
  }
  jet.name = 'F/A-18C Hornet';
  const model = assets.scene.clone(true); model.name = 'F/A-18C Blender airframe'; jet.add(model);
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
  jet.userData.modelId = 'fa18c'; jet.userData.gear = gear;
  jet.userData.airframeScale = assets.metadata.span / 17.1;
  jet.userData.wingtips = assets.metadata.wingtips.map(p => new THREE.Vector3(...p));
  jet.userData.groundOffset = assets.metadata.parkedGroundOffset;
  const update = jet.userData.update;
  jet.userData.update = (dt, state = {}) => {
    update(dt, state);
    if (parked) { jet.userData.exhaust.visible = false; jet.userData.exhaustCore.visible = false; }
  };
  const dispose = jet.userData.dispose; let disposed = false;
  jet.userData.dispose = () => {
    if (disposed) return; disposed = true;
    dispose(); ownedGeometry.forEach(g => g.dispose());
  };
  return jet;
}
