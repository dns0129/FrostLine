import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { prepareAirframeMaterials, disposeAirframeObjects, makeImportedJet } from './imported-airframe.js';
import { FA18_HARDPOINTS, makeFA18ArmamentAssets } from './fa18-armament.js';
import { storeTemplates } from './missile-models.js';

// The workshop remains the source of inventory. These shared templates improve
// only the stores whose actual pylon / rail fit has been measured on this GLB.
const STATION_IDS = { innerL: 3, innerR: 7, outerL: 2, outerR: 8, tipL: 1, tipR: 9 };
function prepareStoreOverrides(armament) {
  const templates = {
    medium: new THREE.Mesh(armament.geometries.medium, armament.material),
    short: new THREE.Mesh(armament.geometries.short, armament.material),
  };
  const overrides = {}, contact = new THREE.Vector3(), adapter = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  for (const point of FA18_HARDPOINTS) {
    const angles = [point.pitch, 0, point.roll];
    rotation.setFromEuler(new THREE.Euler(...angles));
    adapter.fromArray(armament.geometries[point.type].userData.adapterContact).applyQuaternion(rotation);
    contact.fromArray(point.contact).sub(adapter);
    overrides[STATION_IDS[point.id]] = {
      [point.type === 'medium' ? 'aim120' : 'aim9']: {
        template: templates[point.type], position: contact.toArray(), rotation: angles,
        hardpoint: point.id,
      },
    };
  }
  return overrides;
}

// `missiles` (optional, owned by the caller) supplies real-scale AIM-7M, AGM-84D and
// AIM-120C / AIM-9M templates. The measured wing/tip fits above still take
// precedence at their stations; the templates replace the generated cylinders
// elsewhere (AIM-7M, Harpoon, fuselage AIM-120C). The fuel tank stays generated.
export async function loadFA18Assets(missiles = null) {
  const url = new URL('./assets/models/fa18c.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/fa18c.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`F/A-18 metadata: ${response.status}`);
  const metadata = await response.json();
  if (metadata.forward !== '-Z' || metadata.up !== '+Y' || !metadata.nozzles?.length) {
    throw new Error('F/A-18 asset has incompatible coordinate metadata');
  }
  prepareAirframeMaterials(gltf.scene);
  const armament = makeFA18ArmamentAssets(), storeOverrides = prepareStoreOverrides(armament);
  let disposed = false;
  return {
    scene: gltf.scene, metadata: { ...metadata, storeModels: missiles ? 'real-scale' : 'generated' }, armament, storeOverrides,
    templates: storeTemplates(missiles, ['aim9', 'aim120', 'aim7', 'harpoon']),
    dispose() {
      if (disposed) return; disposed = true;
      disposeAirframeObjects(gltf.scene); armament.dispose();
    },
  };
}

export function makeFA18(assets, jetAssets, { parked = false } = {}) {
  // Node fixtures and older callers may provide only the imported airframe.
  // Cache the shared templates on that asset owner, never on aircraft instances.
  assets.armament ??= makeFA18ArmamentAssets();
  assets.storeOverrides ??= prepareStoreOverrides(assets.armament);
  return makeImportedJet(assets, jetAssets, { parked, aircraftId: 'fa18c', modelId: 'fa18c',
    name: 'F/A-18C Hornet', modelName: 'F/A-18C Blender airframe' });
}
