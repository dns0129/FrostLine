import * as THREE from './vendor/three.module.js';

// Scene-fleet classes. Every class is an imported Blender model (naval-assets.js):
// metres, +Y up, bow -Z, waterline at y = 0. The dimensions here are the
// published figures the models were built to; they size wakes and inspection.
// `silhouette` names the distant-LOD meshes of a model exported without
// per-object silhouette flags (the Fujian).
export const NAVAL_MODELS = Object.freeze({
  enterprise: Object.freeze({ name: '企业级航空母舰', country: 'US', kind: 'carrier', length: 342, beam: 78.3, hullBeam: 40.5, deckY: 18.6, number: '65', asset: 'enterprise' }),
  fujian: Object.freeze({ name: '福建舰', country: 'CN', kind: 'carrier', length: 315.5, beam: 76.47, hullBeam: 40, deckY: 17.5, number: '18', asset: 'fujian',
    silhouette: /^(Hull_[12]|Flight_deck_slab_[12]|Gallery_deck_band|Weapon_sponsons|Island_(podium|main_block|SX-band_arrays.*)|Integrated_mast|Exhaust_uptake_housing|Bridge_wing|Aft_flight-control_platform)$/ }),
  burke: Object.freeze({ name: '阿利·伯克级驱逐舰', country: 'US', kind: 'destroyer', length: 153.8, beam: 20.3, hullBeam: 18, deckY: 7.1, number: '51', asset: 'burke' }),
  type052d: Object.freeze({ name: '052D 型驱逐舰', country: 'CN', kind: 'destroyer', length: 157, beam: 17.5, hullBeam: 16.2, deckY: 7.5, number: '172', asset: 'type052d' }),
});

// One ship instance from caller-owned prepared assets ({ [asset]: prepared }).
// Geometry and materials are shared between instances; a model's hull-number
// meshes are kept per number and only the instance's own number is added.
export function makeNavalShip(imported, type, number = NAVAL_MODELS[type]?.number, options = {}) {
  const def = NAVAL_MODELS[type], source = def && imported[def.asset];
  if (!source) throw new Error(def ? `Naval model not loaded: ${type}` : `Unknown naval model: ${type}`);
  const root = new THREE.Group(), lod = new THREE.LOD();
  root.name = `${def.name} ${number}`; root.userData = { modelType: type, country: def.country, kind: def.kind, number, definition: def, lod };
  (options.playable&&source.playableLevels?source.playableLevels:source.levels).forEach((list, index) => {
    const group = new THREE.Group(); group.name = index ? 'distant-silhouette' : 'detailed-ship';
    for (const { key, geometry, material, number: painted } of list) {
      if (painted && painted !== number) continue;
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `naval-${type}-${key}${painted ? ` ${painted}` : ''}`;
      mesh.castShadow = index === 0 && !material.transparent; mesh.receiveShadow = true; group.add(mesh);
    }
    lod.addLevel(group, index ? 2600 : 0);
  });
  root.add(lod); return root;
}
