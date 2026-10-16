import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { NAVAL_MODELS } from '../naval-models.js';
import { prepareNavalAssets } from '../naval-assets.js';

// Parse every shipped fleet GLB through the same preparation as the browser
// loader. Node skips only raster decoding; textures are decoded in browser QA.
export async function loadNavalFixture(type) {
  const { asset } = NAVAL_MODELS[type];
  const bytes = await readFile(new URL(`../assets/models/${asset}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'QA_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const metadata = JSON.parse(await readFile(new URL(`../assets/models/${asset}.metadata.json`, import.meta.url), 'utf8'));
  return prepareNavalAssets(gltf.scene, metadata, type);
}
export const navalAssets = Object.fromEntries(await Promise.all(Object.entries(NAVAL_MODELS)
  .map(async ([type, def]) => [def.asset, await loadNavalFixture(type)])));
