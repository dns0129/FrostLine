import { GLTFLoader } from './vendor/GLTFLoader.js';
import { prepareAirframeMaterials, disposeAirframeObjects, makeImportedJet } from './imported-airframe.js';

export async function loadFA18Assets() {
  const url = new URL('./assets/models/fa18c.glb', import.meta.url);
  const metadataURL = new URL('./assets/models/fa18c.metadata.json', import.meta.url);
  const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(url.href), fetch(metadataURL)]);
  if (!response.ok) throw new Error(`F/A-18 metadata: ${response.status}`);
  const metadata = await response.json();
  if (metadata.forward !== '-Z' || metadata.up !== '+Y' || !metadata.nozzles?.length) {
    throw new Error('F/A-18 asset has incompatible coordinate metadata');
  }
  prepareAirframeMaterials(gltf.scene);
  let disposed = false;
  return {
    scene: gltf.scene, metadata,
    dispose() { if (disposed) return; disposed = true; disposeAirframeObjects(gltf.scene); },
  };
}

export function makeFA18(assets, jetAssets, { parked = false } = {}) {
  return makeImportedJet(assets, jetAssets, { parked, aircraftId: 'fa18c', modelId: 'fa18c',
    name: 'F/A-18C Hornet', modelName: 'F/A-18C Blender airframe' });
}
