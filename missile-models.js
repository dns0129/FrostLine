import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { STORES } from './aircraft-systems.js';
import { prepareAirframeMaterials, disposeAirframeObjects } from './imported-airframe.js';

// Real-scale PL-15, PL-10 and YJ-83K store templates (assets/models/missiles/
// missiles-game.glb, built by scripts/build-missiles.py). Lengths and body
// diameters are the published figures; fin sizes are photo estimates
// (assets/MISSILES-ART.md). Each template is centred on the missile's mid-length
// body axis, nose -Z; a fatter store keeps STORES[id].visual.hang as the template
// offset so it still meets a pylon calibrated for a slimmer missile.
export const MISSILE_MODEL_IDS = Object.freeze(['pl15', 'pl10', 'yj83k']);
const AXES = '+Y up, nose -Z, origin at mid-length on the body axis';

// Pure scene preparation, shared by the browser loader and the Node fixture.
export function prepareMissileModels(gltfScene, metadata) {
  if (metadata.units !== 'metres' || metadata.glb_axes !== AXES) throw new Error('Missile models have incompatible coordinate metadata');
  gltfScene.updateMatrixWorld(true);
  const templates = {}, inverse = new THREE.Matrix4(), local = new THREE.Matrix4();
  for (const id of MISSILE_MODEL_IDS) {
    const root = gltfScene.getObjectByName(id), info = metadata.stores?.[id];
    if (!root || !info) throw new Error(`Missile models are missing ${id}`);
    inverse.copy(root.matrixWorld).invert();
    const template = new THREE.Group(); template.name = `${id} template`;
    root.traverse(o => {
      if (!o.isMesh) return;
      const mesh = new THREE.Mesh(o.geometry, o.material); mesh.name = o.name;
      local.multiplyMatrices(inverse, o.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
      template.add(mesh);
    });
    if (template.children.length !== info.meshes.length) throw new Error(`Missile model ${id} has unexpected meshes`);
    template.position.y = -(STORES[id].visual.hang || 0);
    // Not `store`: aircraft-stores.js marks its slot groups with userData.store.
    Object.assign(template.userData, { storeId: id, missile: info.missile, length: info.length_m, diameter: info.diameter_m });
    prepareAirframeMaterials(template);
    templates[id] = template;
  }
  let disposed = false;
  return { templates, metadata,
    dispose() { if (disposed) return; disposed = true; disposeAirframeObjects(gltfScene, ...Object.values(templates)); } };
}

export async function loadMissileModels() {
  const url = new URL('./assets/models/missiles/missiles-game.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/missiles/missiles-game.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`Missile model metadata: ${response.status}`);
  return prepareMissileModels(gltf.scene, await response.json());
}
