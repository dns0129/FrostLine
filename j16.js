import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { prepareAirframeMaterials, disposeAirframeObjects, makeImportedJet } from './imported-airframe.js';
import { storeTemplates } from './missile-models.js';

// j16.glb is exported with its wheels on y = 0. The game airframe origin is the
// nozzle axis (measured from the GLB; tests/j16.test.mjs re-derives it), so the
// flight model, chase camera and store stations share one reference point.
export const J16_ORIGIN_Y = 2;
export const J16_NOZZLES = Object.freeze([Object.freeze([-1.254, 0, 8.08]), Object.freeze([1.254, 0, 8.08])]);
const BAKED_STORE = /^PL-1[05]_.+_(body|fins|seeker)$/;
// The baked missiles fix the station positions (AIRCRAFT.j16) and are the
// fallback templates; pylons and launch rails stay on the airframe. When the
// real-scale models (missile-models.js) are available, their PL-15 / PL-10 /
// YJ-83K templates replace the baked ones on the pylons.
const TEMPLATE_SOURCE = { pl15: 'PL-15_tunnel_front', pl10: 'PL-10_outer_wing_port' };

// Pure scene preparation, shared by the browser loader and the Node fixture.
// `missiles` is an optional prepareMissileModels() result owned by the caller.
export function prepareJ16Assets(gltfScene, sourceMetadata, missiles = null) {
  if (sourceMetadata.units !== 'metres' || sourceMetadata.glb_axes !== '+Y up, nose -Z') {
    throw new Error('J-16 asset has incompatible coordinate metadata');
  }
  const scene = new THREE.Group(); scene.name = 'J-16 airframe';
  gltfScene.position.y -= J16_ORIGIN_Y; scene.add(gltfScene); scene.updateMatrixWorld(true);
  const baked = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (o.name.startsWith('UC_')) o.userData.role = 'gear';
    if (BAKED_STORE.test(o.name)) baked.push(o);
  });
  const bakedTemplates = {}, center = new THREE.Vector3();
  for (const [store, prefix] of Object.entries(TEMPLATE_SOURCE)) {
    const parts = baked.filter(o => o.name.startsWith(prefix + '_'));
    if (parts.length !== 3) throw new Error(`J-16 asset is missing the ${prefix} store meshes`);
    const bounds = new THREE.Box3(); parts.forEach(o => bounds.expandByObject(o)); bounds.getCenter(center);
    const template = new THREE.Group(); template.name = `${store} template`;
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geometry, part.material); mesh.name = part.name.replace(prefix, store);
      part.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale); mesh.position.sub(center);
      template.add(mesh);
    }
    bakedTemplates[store] = template;
  }
  for (const o of baked) o.removeFromParent();
  const box = new THREE.Box3().setFromObject(scene), pods = [];
  scene.traverse(o => { if (o.isMesh && /^Wingtip_ECM_pod_.+_body$/.test(o.name)) pods.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); });
  pods.sort((a, b) => a.x - b.x);
  prepareAirframeMaterials(scene); Object.values(bakedTemplates).forEach(prepareAirframeMaterials);
  const templates = { ...bakedTemplates, ...storeTemplates(missiles, ['pl15', 'pl10', 'yj83k']) };
  const metadata = { ...sourceMetadata, forward: '-Z', up: '+Y', span: box.max.x - box.min.x, length: box.max.z - box.min.z,
    parkedGroundOffset: J16_ORIGIN_Y + .02, wingtips: pods.map(p => p.toArray()), nozzles: J16_NOZZLES.map(p => [...p]),
    storeModels: missiles ? 'real-scale' : 'baked' };
  let disposed = false;
  return { scene, metadata, templates,
    dispose() { if (disposed) return; disposed = true; disposeAirframeObjects(scene, ...Object.values(bakedTemplates)); } };
}

export async function loadJ16Assets(missiles = null) {
  const url = new URL('./assets/models/j16.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/j16.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`J-16 metadata: ${response.status}`);
  return prepareJ16Assets(gltf.scene, await response.json(), missiles);
}

export function makeJ16(assets, jetAssets, { parked = false } = {}) {
  return makeImportedJet(assets, jetAssets, { parked, aircraftId: 'j16', modelId: 'j16',
    name: 'J-16', modelName: 'J-16 Blender airframe' });
}
