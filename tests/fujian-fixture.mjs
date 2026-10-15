import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { prepareFujianAssets } from '../fujian.js';

// Parse the shipped GLB through the same preparation as the browser loader.
// Node skips only raster decoding; the embedded deck JPEG is decoded in browser QA.
const bytes = await readFile(new URL('../assets/models/fujian.glb', import.meta.url));
const loader = new GLTFLoader();
loader.register(() => ({ name: 'QA_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const metadata = JSON.parse(await readFile(new URL('../assets/models/fujian.metadata.json', import.meta.url), 'utf8'));
export const fujianAssets = prepareFujianAssets(gltf.scene, metadata);
