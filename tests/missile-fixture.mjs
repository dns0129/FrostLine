import { readFile } from 'node:fs/promises';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { prepareMissileModels } from '../missile-models.js';

// Parse the shipped runtime missile GLB through the same preparation as the
// browser loader. Each call returns a fresh asset owner.
export async function loadMissileFixture() {
  const bytes = await readFile(new URL('../assets/models/missiles/missiles-game.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const metadata = JSON.parse(await readFile(new URL('../assets/models/missiles/missiles-game.metadata.json', import.meta.url), 'utf8'));
  return prepareMissileModels(gltf.scene, metadata);
}
