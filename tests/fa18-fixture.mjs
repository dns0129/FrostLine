import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

// Parse the shipped GLB's actual geometry/material definitions. Node tests skip
// only raster decoding; the real embedded JPEGs are decoded in browser QA.
const bytes = await readFile(new URL('../assets/models/fa18c.glb', import.meta.url));
const loader = new GLTFLoader();
loader.register(() => ({ name: 'QA_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const metadata = JSON.parse(await readFile(new URL('../assets/models/fa18c.metadata.json', import.meta.url), 'utf8'));
export const fa18Assets = { scene: gltf.scene, metadata };
