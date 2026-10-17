import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { STORES } from './aircraft-systems.js';
import { prepareAirframeMaterials, disposeAirframeObjects } from './imported-airframe.js';

// Real-scale missile templates (assets/models/missiles/missiles-game.glb, built by
// scripts/build-missiles.py). Lengths, body diameters and spans are published
// figures; fin chords/stations are photo estimates (assets/MISSILES-ART.md).
// Each template is centred on the missile's mid-length body axis, nose -Z; a
// store that is fatter than its pylon's calibration missile keeps
// STORES[id].visual.hang as the template offset.
export const MISSILE_MODEL_IDS = Object.freeze(['pl15', 'pl10', 'yj83k', 'aim9', 'aim120', 'aim7', 'harpoon',
  'sm2', 'rgm84', 'hq10', 'yj83']);
const AXES = '+Y up, nose -Z, origin at mid-length on the body axis';

// Launch visuals for missiles that are not aircraft stores. Ship classes follow
// their real-world counterparts (Burke: Standard SM-2 / ship-launched Harpoon;
// 052D: HHQ-10 / YJ-83). The fictional D-21 and the fictional enemy jets have
// no real armament, so these are game choices: D-21 uses the 052D pair and
// enemy fighters show the medium-range, semi-active AIM-7M.
export const MISSILE_VISUALS = Object.freeze({
  ships: Object.freeze({
    destroyer: Object.freeze({ 'anti-air': 'hq10', 'anti-ship': 'yj83' }),
    type052d: Object.freeze({ 'anti-air': 'hq10', 'anti-ship': 'yj83' }),
    burke: Object.freeze({ 'anti-air': 'sm2', 'anti-ship': 'rgm84' }),
  }),
  enemy: 'aim7',
});

// Which template a live missile shows: its store, its ship class, or the enemy model.
export function missileModelId(missile, sim = {}) {
  if (missile.enemy) return MISSILE_VISUALS.enemy;
  if (missile.store) return missile.store;
  if (!missile.shipLaunched) return null;
  const ship = MISSILE_VISUALS.ships[sim.shipId] || MISSILE_VISUALS.ships.destroyer;
  return ship[missile.weapon === 'anti-ship' || missile.kind === 'anti-ship' ? 'anti-ship' : 'anti-air'];
}

// Pick the templates an airframe's stations can carry (shared, never copied).
export function storeTemplates(models, ids) {
  return models ? Object.fromEntries(ids.filter(id => models.templates[id]).map(id => [id, models.templates[id]])) : {};
}

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
    template.position.y = -(STORES[id]?.visual?.hang || 0);
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
