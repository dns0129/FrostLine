import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { prepareJ16Assets } from '../j16.js';
import { loadMissileFixture } from './missile-fixture.mjs';

// Parse the shipped GLB through the same preparation as the browser loader.
// Node skips only raster decoding; the embedded PNG is decoded in browser QA.
const bytes = await readFile(new URL('../assets/models/j16.glb', import.meta.url));
const loader = new GLTFLoader();
loader.register(() => ({ name: 'QA_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const metadata = JSON.parse(await readFile(new URL('../assets/models/j16.metadata.json', import.meta.url), 'utf8'));
// Like the browser loader, the airframe owns the real-scale store models.
export const j16Assets = prepareJ16Assets(gltf.scene, metadata, await loadMissileFixture());
