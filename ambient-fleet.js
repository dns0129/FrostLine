import * as THREE from './vendor/three.module.js';
import { NAVAL_MODELS, makeNavalAssets, makeNavalShip } from './naval-models.js';
import { getQualityPreset } from './quality.js';

// Scene-only fleets. These IDs never enter combat targeting, scoring or waves.
export const DEFAULT_FLEET = Object.freeze([
  Object.freeze({ id: 'US-CV-59', type: 'forrestal', country: 'US', number: '59', right: 0, aft: 0 }),
  Object.freeze({ id: 'US-DDG-51', type: 'burke', country: 'US', number: '51', right: -300, aft: -320 }),
  Object.freeze({ id: 'US-DDG-52', type: 'burke', country: 'US', number: '52', right: 300, aft: 350 }),
  Object.freeze({ id: 'CN-CV-18', type: 'fujian', country: 'CN', number: '18', right: 0, aft: 0 }),
  Object.freeze({ id: 'CN-DDG-172', type: 'type052d', country: 'CN', number: '172', right: -300, aft: -320 }),
  Object.freeze({ id: 'CN-DDG-173', type: 'type052d', country: 'CN', number: '173', right: 300, aft: 350 }),
]);
export const FLEET_ROUTES = Object.freeze({
  US: Object.freeze({ x: -1300, z: 1900, radius: 320, straight: 1600, speed: 10, offset: 800 }),
  CN: Object.freeze({ x: 1400, z: 350, radius: 320, straight: 1600, speed: 10.5, offset: 2400 + Math.PI * 320 }),
});

// A capsule racetrack has continuous position/tangent and constant leader speed.
// No wrap teleport: the closing arc joins the first straight at the same tangent.
export function sampleFleetRoute(country, time) {
  const r = FLEET_ROUTES[country];
  if (!r) throw new Error(`Unknown fleet: ${country}`);
  const s = r.straight, a = Math.PI * r.radius, perimeter = s * 2 + a * 2;
  let distance = ((Math.max(0, Number.isFinite(time) ? time : 0) * r.speed + r.offset) % perimeter + perimeter) % perimeter;
  let x, z, heading, turnRate = 0;
  if (distance < s) { x = r.radius; z = s / 2 - distance; heading = 0; }
  else if ((distance -= s) < a) {
    const theta = distance / r.radius;
    x = r.radius * Math.cos(theta); z = -s / 2 - r.radius * Math.sin(theta); heading = theta; turnRate = r.speed / r.radius;
  } else if ((distance -= a) < s) { x = -r.radius; z = -s / 2 + distance; heading = Math.PI; }
  else {
    const theta = (distance - s) / r.radius;
    x = -r.radius * Math.cos(theta); z = s / 2 + r.radius * Math.sin(theta); heading = Math.PI + theta; turnRate = r.speed / r.radius;
  }
  return { x: r.x + x, z: r.z + z, heading, speed: r.speed, turnRate };
}

export function createDefaultFleet() {
  const fleet = DEFAULT_FLEET.map(def => ({ ...def, kind: 'ambient-ship', pos: new THREE.Vector3(), heading: 0, speed: 0 }));
  updateDefaultFleet(fleet, 0); return fleet;
}
export function updateDefaultFleet(fleet, time) {
  const leaders = { US: sampleFleetRoute('US', time), CN: sampleFleetRoute('CN', time) };
  for (const ship of fleet) {
    const route = leaders[ship.country], c = Math.cos(route.heading), s = Math.sin(route.heading);
    ship.pos.set(route.x + ship.right * c + ship.aft * s, .15, route.z - ship.right * s + ship.aft * c);
    // Offset escort velocities follow the curved formation instead of sliding sideways.
    const localX = ship.aft * route.turnRate, localZ = -route.speed - ship.right * route.turnRate;
    ship.heading = route.heading + Math.atan2(-localX, -localZ);
    ship.speed = Math.hypot(localX, localZ);
  }
  return fleet;
}

function wakeAssets(def, map) {
  const p = [], uv = [], stern = def.length / 2 - 5, reach = def.length * 1.4 + 130, beam = def.hullBeam;
  const quad = (a, b, c, d) => {
    p.push(...a, ...c, ...b, ...b, ...c, ...d); uv.push(0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1);
  };
  quad([-beam * .25, 0, stern], [beam * .25, 0, stern], [-beam * .7, 0, stern + reach], [beam * .7, 0, stern + reach]);
  for (const side of [-1, 1]) {
    quad([side * beam * .34, 0, stern], [side * beam * .51, 0, stern],
      [side * (beam * .6 + reach * .17), 0, stern + reach], [side * (beam * .75 + reach * .2), 0, stern + reach]);
    quad([side * beam * .12, 0, -def.length * .46], [side * beam * .16, 0, -def.length * .46],
      [side * beam * .57, 0, stern], [side * beam * .69, 0, stern]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const time = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: .46, depthWrite: false, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.fleetTime = time;
    shader.fragmentShader = 'uniform float fleetTime;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n diffuseColor.a *= .74 + .26 * sin(vMapUv.y * 75.0 - fleetTime * 3.0 + vMapUv.x * 8.0);');
  };
  material.customProgramCacheKey = () => 'fleet-foam-v1';
  return { geometry, material, time };
}
function foamMap() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), fleck = .45 + .55 * Math.sin(x * 1.2 + y * .9) ** 2;
    pixels.set([206, 224, 220, Math.round(Math.sin(Math.PI * u) ** .8 * (1 - v) ** 1.6 * fleck * 210)], (y * size + x) * 4);
  }
  const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat); map.magFilter = map.minFilter = THREE.LinearFilter; map.needsUpdate = true; return map;
}

export class AmbientFleet {
  constructor(scene) {
    this.scene = scene; this.assets = makeNavalAssets(); this.group = new THREE.Group(); this.group.name = 'US and Chinese underway fleets';
    this.map = foamMap(); this.wakeAssets = Object.fromEntries(Object.entries(NAVAL_MODELS).map(([key, d]) => [key, wakeAssets(d, this.map)]));
    this._wakeResources = Object.values(this.wakeAssets);
    this.ships = DEFAULT_FLEET.map(def => {
      const model = makeNavalShip(this.assets, def.type, def.number); model.userData.fleetId = def.id;
      const a = this.wakeAssets[def.type], wake = new THREE.Mesh(a.geometry, a.material);
      wake.name = `${def.id}-underway-wake`; wake.userData.skipWaterReflection = true;
      this.group.add(model, wake); return { id: def.id, model, wake };
    });
    scene.add(this.group); this.setQuality('high'); this.update(createDefaultFleet(), 0);
  }
  setQuality(quality) {
    const profile = getQualityPreset(quality);
    this.quality = profile.id;
    for (const { model } of this.ships) model.userData.lod.levels[1].distance = profile.fleetLodDistance;
    for (const maps of Object.values(this.assets.textures)) for (const texture of Object.values(maps)) {
      if (texture.anisotropy !== profile.textureAnisotropy) {
        texture.anisotropy = profile.textureAnisotropy;
        texture.needsUpdate = true;
      }
    }
  }
  update(fleet, time) {
    if (this.disposed || !fleet) return;
    time = Number.isFinite(time) ? time : 0;
    for (let i = 0; i < this.ships.length; i++) {
      const { model, wake } = this.ships[i], ship = fleet[i]; if (!ship || ship.id !== this.ships[i].id) continue;
      const carrier = model.userData.kind === 'carrier', phase = time * .45 + i * .91;
      model.position.copy(ship.pos); model.position.y += Math.sin(phase) * (carrier ? .12 : .2);
      model.rotation.set(Math.sin(phase * .9) * .0018, ship.heading, Math.sin(phase * 1.1) * .0025, 'YXZ');
      wake.position.copy(ship.pos); wake.position.y = .09; wake.rotation.y = ship.heading; wake.visible = ship.speed > .5;
    }
    for (const a of this._wakeResources) a.time.value = time;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.scene.remove(this.group); this.assets.dispose(); this.map.dispose();
    for (const a of this._wakeResources) { a.geometry.dispose(); a.material.dispose(); }
  }
}
