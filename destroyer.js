import * as THREE from './vendor/three.module.js';

// Original D-21 maritime escort. Metres, +Y up and -Z toward the bow; no
// textures, canvas or downloaded assets are needed to create the ship.
export const DESTROYER_MODEL = Object.freeze({
  length: 110, beam: 20,
  gunPivot: Object.freeze([0, 8, -32]),
  bridgeEye: Object.freeze([0, 17.8, -18.5]),
});
const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function meshGeometry(vertices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}
function loft(stations, topY, bottomY, lowerScale = .8, caps = true) {
  const vertices = [];
  const ring = ([z, width, rise = 0]) => [[-width, topY + rise, z], [width, topY + rise, z],
    [width * lowerScale, bottomY, z], [-width * lowerScale, bottomY, z]];
  const triangle = (a, b, c) => vertices.push(...a, ...c, ...b);
  for (let i = 1; i < stations.length; i++) {
    const a = ring(stations[i - 1]), b = ring(stations[i]);
    for (let side = 0; side < 4; side++) {
      const next = (side + 1) % 4;
      triangle(a[side], a[next], b[side]); triangle(a[next], b[next], b[side]);
    }
  }
  if (caps) for (const [index, reverse] of [[0, true], [stations.length - 1, false]]) {
    const r = ring(stations[index]);
    if (reverse) { triangle(r[0], r[2], r[1]); triangle(r[0], r[3], r[2]); }
    else { triangle(r[0], r[1], r[2]); triangle(r[0], r[2], r[3]); }
  }
  return meshGeometry(vertices);
}
function merge(parts) {
  const vertices = [], normals = [];
  for (const source of parts) {
    const geometry = source.index ? source.toNonIndexed() : source;
    vertices.push(...geometry.attributes.position.array);
    normals.push(...geometry.attributes.normal.array);
    if (geometry !== source) geometry.dispose();
    source.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
function box(width, height, depth, x, y, z, rx = 0, ry = 0, rz = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.rotateX(rx); geometry.rotateY(ry); geometry.rotateZ(rz);
  return geometry.translate(x, y, z);
}
function cylinder(radius, height, x, y, z, segments = 8, rx = 0) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments);
  geometry.rotateX(rx); return geometry.translate(x, y, z);
}
function taperedBox(width, depth, height, topScale, x, y, z) {
  const geometry = loft([[-depth / 2, width / 2], [depth / 2, width / 2]], 0, -height, 1 / topScale);
  geometry.scale(topScale, 1, 1); return geometry.translate(x, y + height / 2, z);
}
function deckLine(a, b, width = .14) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  return box(width, .045, Math.hypot(dx, dz), (a[0] + b[0]) / 2, 4.77, (a[1] + b[1]) / 2,
    0, Math.atan2(dx, dz));
}

export function makeDestroyer() {
  const ship = new THREE.Group(); ship.name = 'D-21 Frostguard destroyer';
  const parts = { hull: [], deck: [], structure: [], dark: [], windows: [], markings: [], underwater: [] };
  const stations = [[-55, .12, .85], [-44, 4.7, .35], [-28, 9, 0], [-10, 10, 0], [24, 10, 0], [49, 8.1, 0], [55, 7.8, 0]];
  parts.hull.push(loft(stations, 4.7, -.65, .86));
  parts.underwater.push(loft(stations.map(([z, w]) => [z, w * .86]), -.66, -3.5, .62));
  // A narrow weather deck avoids coplanar hull-top surfaces.
  parts.deck.push(loft(stations.map(([z, w, rise]) => [z, w * .985, rise]), 4.75, 4.71, 1));
  parts.dark.push(loft(stations.map(([z, w]) => [z, w * .875]), -.28, -.69, .98));
  // Long sloped deckhouse, raised faceted bridge, hangar and two exhausts.
  parts.structure.push(taperedBox(14, 36, 7.5, .84, 0, 8.5, 1),
    taperedBox(12.4, 12, 5.5, .82, 0, 14.35, -11.5),
    taperedBox(10.7, 15, 7, .9, 0, 8.25, 25),
    taperedBox(6.5, 6.7, 4.8, .86, 0, 14.7, 5),
    taperedBox(6.4, 5.5, 4.7, .87, 0, 14.4, 15));
  parts.dark.push(box(5, .2, 5, 0, 17.15, 5), box(4.9, .2, 4, 0, 16.85, 15),
    box(8.3, 4.6, .12, 0, 7.85, 32.55));
  // Separate window panes and slim grey mullions give the bridge a readable
  // scale, including from the chase view; opaque glazing costs one draw batch.
  for (let i = -2; i <= 2; i++) parts.windows.push(box(1.8, 1.25, .08, i * 2.03, 15.8, -17.56));
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    parts.windows.push(box(.08, 1.2, 1.6, side * 5.83, 15.5, -14.6 + i * 2));
  }
  // Thirty-two physically separate VLS hatch caps on the forward deck.
  parts.dark.push(box(8.7, .24, 9.7, 0, 4.95, -22));
  for (let row = 0; row < 8; row++) for (let col = 0; col < 4; col++) {
    parts.structure.push(box(1.82, .16, .95, -3.15 + col * 2.1, 5.15, -26.1 + row * 1.18));
  }
  // Compact secondary defence station, deck fittings and rescue boats.
  parts.structure.push(cylinder(1.6, 1.6, 0, 13.2, 27, 8), cylinder(.8, 2.3, 0, 14.8, 27, 8),
    cylinder(.75, 3, 0, 19.4, -2, 8), cylinder(.33, 8.7, 0, 24.1, -2, 6));
  parts.dark.push(box(.7, .55, 3, 0, 14.6, 24.5));
  for (const side of [-1, 1]) {
    parts.dark.push(taperedBox(2.2, 8.6, 1, .8, side * 7.8, 6.35, 10));
    parts.structure.push(box(2.7, .3, 8.8, side * 7.8, 5.65, 10));
    for (const z of [-42, -16, 22, 47]) parts.dark.push(cylinder(.28, .6, side * (Math.abs(z) > 40 ? 5.5 : 8.8), 5.06, z));
    // Railings use merged low-sided geometry instead of independent objects.
    for (let z = -16; z <= 49; z += 5) {
      const x = side * (z > 24 ? 9.7 - (z - 24) * .064 : 9.7);
      parts.structure.push(box(.07, 1.06, .07, x, 5.29, z));
    }
    parts.structure.push(box(.07, .07, 40, side * 9.7, 5.83, 4),
      box(.07, .07, 25, side * 8.9, 5.83, 36.5, 0, side * -.064));
    // Original 21 stencil made from geometry, visible on the hull flanks.
    const x = side * 9.42;
    for (const [dy, dz, h, d] of [[.9, -30, .16, 1.2], [0, -30, .16, 1.2], [-.9, -30, .16, 1.2],
      [.45, -29.4, .9, .14], [-.45, -30.6, .9, .14], [0, -27.3, 1.8, .16], [-.9, -27.3, .16, 1.0]]) {
      parts.markings.push(box(.06, h, d, x, 2.35 + dy, dz + 24));
    }
  }
  // Aft helicopter circle, landing stripes and a directional arrow.
  const ring = new THREE.TorusGeometry(6.1, .09, 3, 32); ring.rotateX(Math.PI / 2); ring.translate(0, 4.8, 43);
  parts.markings.push(ring, deckLine([-2.8, 40.1], [-2.8, 45.9]), deckLine([2.8, 40.1], [2.8, 45.9]),
    deckLine([-2.8, 43], [2.8, 43]), deckLine([0, 48], [0, 52]),
    deckLine([-1, 50.8], [0, 49.8]), deckLine([1, 50.8], [0, 49.8]));

  const materials = {
    hull: new THREE.MeshStandardMaterial({ color: '#87959f', roughness: .81, metalness: .2 }),
    deck: new THREE.MeshStandardMaterial({ color: '#59656b', roughness: .97, metalness: .08 }),
    structure: new THREE.MeshStandardMaterial({ color: '#bbc6ce', roughness: .79, metalness: .14 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2b3338', roughness: .9, metalness: .2 }),
    windows: new THREE.MeshStandardMaterial({ color: '#233e4c', roughness: .22, metalness: .38 }),
    markings: new THREE.MeshStandardMaterial({ color: '#ced8d6', roughness: .95, metalness: 0 }),
    underwater: new THREE.MeshStandardMaterial({ color: '#564444', roughness: .94, metalness: .1 }),
  };
  for (const [name, geometries] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(merge(geometries), materials[name]); mesh.name = `destroyer-${name}`;
    mesh.castShadow = name !== 'underwater'; mesh.receiveShadow = true; ship.add(mesh);
  }
  // The yaw pivot is below the firing origin; pitch rotates around the exact
  // y=8 m simulation origin, so the visible barrel follows the real shot vector.
  const turret = new THREE.Group(); turret.name = 'destroyer-forward-turret'; turret.position.set(0, 6.6, -32); ship.add(turret);
  const turretShell = new THREE.Mesh(merge([taperedBox(5.4, 5.5, 2.65, .68, 0, .05, 0), cylinder(2.75, .5, 0, -1.45, 0, 12)]), materials.structure);
  turretShell.name = 'destroyer-gunhouse'; turretShell.castShadow = true; turretShell.receiveShadow = true; turret.add(turretShell);
  const gun = new THREE.Group(); gun.name = 'destroyer-barrel-pitch'; gun.position.y = 1.4; turret.add(gun);
  const barrel = new THREE.Mesh(merge([cylinder(.3, 3.2, 0, 0, -2.2, 10, Math.PI / 2),
    cylinder(.155, 6.4, 0, 0, -6.8, 8, Math.PI / 2), cylinder(.25, .55, 0, 0, -9.75, 8, Math.PI / 2)]), materials.dark);
  barrel.name = 'destroyer-127mm-gun'; barrel.castShadow = true; gun.add(barrel);
  const radar = new THREE.Group(); radar.name = 'destroyer-search-radar'; radar.position.set(0, 28.2, -2); ship.add(radar);
  const radarMesh = new THREE.Mesh(merge([box(7.2, 1.85, .3, 0, 0, 0), box(.35, 2.2, 1.2, 0, -1.1, 0)]), materials.dark);
  radarMesh.name = 'destroyer-radar-array'; radar.add(radarMesh);
  ship.userData.turret = turret; ship.userData.gun = gun; ship.userData.radar = radar;
  ship.userData.waveHeight = 0; ship.userData.wavePitch = 0; ship.userData.waveRoll = 0;
  let elapsed = 0, initialized = false, disposed = false;
  ship.userData.reset = () => { initialized = false; };
  ship.userData.update = (dt, state = {}) => {
    const step = clamp(finite(dt), 0, .1);
    if (step <= 0 && initialized) return;
    elapsed = Number.isFinite(state.time) ? state.time : elapsed + step;
    turret.rotation.y = finite(state.turretHeading, finite(state.heading)) - finite(state.heading);
    gun.rotation.x = clamp(finite(state.turretPitch, .3), -.08, 1.4);
    radar.rotation.y = elapsed * .75;
    ship.userData.waveHeight = Math.sin(elapsed * 1.15) * .13;
    ship.userData.wavePitch = Math.sin(elapsed * .72) * .0018;
    ship.userData.waveRoll = Math.sin(elapsed * .94 + .3) * .003;
    initialized = true;
  };
  ship.userData.dispose = () => {
    if (disposed) return; disposed = true;
    ship.traverse(object => object.geometry?.dispose());
    Object.values(materials).forEach(material => material.dispose());
  };
  return ship;
}

// Two stern ribbons share one mesh and one tiny generated texture. They hug
// the actual sea plane instead of following the hull's cosmetic wave motion.
export function makeDestroyerWake() {
  const vertices = [], uv = [];
  for (const side of [-1, 1]) {
    const a = [side * 3.3, 0, 52], b = [side * 7, 0, 52];
    const c = [side * 20, 0, 190], d = [side * 27, 0, 190];
    vertices.push(...a, ...c, ...b, ...b, ...c, ...d);
    uv.push(0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1);
  }
  const geometry = meshGeometry(vertices);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), index = (y * size + x) * 4;
    const edge = Math.sin(Math.PI * u) ** .7, fade = (1 - v) ** 1.35;
    const flecks = .48 + .52 * Math.sin(x * .87 + y * 2.4) ** 2;
    pixels.set([218, 237, 231, Math.round(edge * fade * flecks * 210)], index);
  }
  const map = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const wake = new THREE.Mesh(geometry, material); wake.name = 'destroyer-stern-wake';
  wake.position.y = .065; wake.visible = false; wake.userData.skipWaterReflection = true;
  let disposed = false;
  wake.userData.dispose = () => { if (disposed) return; disposed = true; geometry.dispose(); map.dispose(); material.dispose(); };
  return wake;
}

export const ENEMY_SHIP_MODELS = Object.freeze({
  patrol: Object.freeze({ name: 'R-4 Rustfin patrol boat', length: 45, beam: 11, collisionTop: 10,
    gunPivot: Object.freeze([0, 4, -12]), targetAimHeight: 4 }),
  frigate: Object.freeze({ name: 'F-9 Ironwake frigate', length: 85, beam: 17, collisionTop: 17,
    gunPivot: Object.freeze([0, 6, -24]), targetAimHeight: 6 }),
});
const enemyShipAssets = new Map();

function buildEnemyShipAssets(type) {
  const definition = ENEMY_SHIP_MODELS[type], patrol = type === 'patrol';
  const halfLength = definition.length / 2, halfWidth = definition.beam / 2, deckY = patrol ? 2.45 : 3.65;
  const stations = [[-halfLength, .12, .25], [-halfLength * .76, halfWidth * .55, .1],
    [-halfLength * .42, halfWidth, 0], [halfLength * .54, halfWidth, 0], [halfLength, halfWidth * .8, 0]];
  const parts = { hull: [loft(stations, deckY, -.6, .83)], deck: [], structure: [], dark: [], markings: [] };
  parts.deck.push(loft(stations.map(([z, w, rise]) => [z, w * .985, rise]), deckY + .035, deckY + .015, 1));
  parts.dark.push(loft(stations.map(([z, w]) => [z, w * .83]), -.61, -2.15, .65));
  if (patrol) {
    // A short aft bridge, low tripod-style mast and open rear working deck.
    parts.structure.push(taperedBox(6.2, 9, 4, .82, 0, 5.6, 4),
      cylinder(.21, 2.1, 0, 8.95, 4, 6), box(3.7, .18, .25, 0, 9.82, 4),
      box(3.2, .4, 4.1, 0, 2.78, 15));
    for (const x of [-1.85, 0, 1.85]) parts.dark.push(box(1.45, 1.15, .07, x, 6.57, -.54));
    for (const side of [-1, 1]) {
      parts.dark.push(box(.07, 1.1, 2.1, side * 2.8, 6.5, 2.5),
        taperedBox(1.3, 4.9, .75, .7, side * 4.15, 3.3, 10));
      parts.structure.push(cylinder(.28, 2.1, side * 2.3, 3.48, 17, 6));
    }
  } else {
    // A taller forward bridge, stepped aft deckhouse, twin funnels and angled
    // anti-ship racks give the frigate a silhouette distinct from the D-21.
    parts.structure.push(taperedBox(12.5, 27, 6.5, .83, 0, 7, 0),
      taperedBox(9.8, 9.5, 5.2, .8, 0, 12.2, -8),
      taperedBox(10.7, 13, 4.6, .86, 0, 6.8, 24),
      taperedBox(4.7, 4.6, 3.6, .86, 0, 11.7, 5),
      taperedBox(4.4, 4.2, 3.5, .86, 0, 10.85, 19),
      cylinder(.27, 2.2, 0, 15.9, -7.5, 6), box(5.7, .45, .4, 0, 16.65, -7.5));
    parts.dark.push(box(3.4, .15, 3.3, 0, 13.55, 5), box(3.3, .15, 3.1, 0, 12.65, 19));
    for (const x of [-2.7, -.9, .9, 2.7]) parts.dark.push(box(1.5, 1.25, .07, x, 13.45, -12.79));
    for (const side of [-1, 1]) {
      parts.dark.push(box(.07, 1.2, 3.5, side * 4.36, 13.4, -7.9));
      for (let i = 0; i < 3; i++) parts.dark.push(cylinder(.32, 4.8, side * (3.5 + i * .62), 9.2, 24, 6, Math.PI / 3));
      parts.structure.push(box(2.8, .35, 6.3, side * 5, 7.2, 24));
    }
  }
  // Merged bollards and rails retain deck scale with five static draw batches.
  for (const side of [-1, 1]) {
    for (let z = -halfLength * .3; z < halfLength * .82; z += patrol ? 4 : 7) {
      parts.structure.push(box(.065, .78, .065, side * halfWidth * .96, deckY + .42, z));
    }
    parts.structure.push(box(.065, .065, halfLength * 1.15, side * halfWidth * .96, deckY + .81, halfLength * .26));
    for (const z of [-halfLength * .68, halfLength * .72]) {
      parts.dark.push(cylinder(.22, .45, side * halfWidth * .68, deckY + .27, z, 6));
    }
    const sideWidth = halfWidth * (.83 + .17 * (1.4 + .6) / (deckY + .6));
    parts.markings.push(box(.055, .75, patrol ? 8 : 13, side * (sideWidth + .025), 1.4, halfLength * .1,
      0, 0, -side * Math.atan(halfWidth * .17 / (deckY + .6))));
  }
  parts.markings.push(box(definition.beam * .74, .04, .65, 0, deckY + .075, halfLength * .68));
  const materials = {
    hull: new THREE.MeshStandardMaterial({ color: patrol ? '#877266' : '#53626a', roughness: .88, metalness: .14 }),
    deck: new THREE.MeshStandardMaterial({ color: '#394348', roughness: .96, metalness: .08 }),
    structure: new THREE.MeshStandardMaterial({ color: patrol ? '#a58a77' : '#77858b', roughness: .84, metalness: .14 }),
    dark: new THREE.MeshStandardMaterial({ color: '#243036', roughness: .79, metalness: .24 }),
    markings: new THREE.MeshStandardMaterial({ color: '#ad5946', roughness: .94, metalness: .04 }),
  };
  const geometries = Object.fromEntries(Object.entries(parts).map(([name, pieces]) => [name, merge(pieces)]));
  const gunLength = patrol ? 4.8 : 7;
  geometries.gunhouse = merge([taperedBox(patrol ? 2.5 : 4, patrol ? 2.7 : 4.1, patrol ? 1.6 : 2.1,
    .72, 0, -.15, 0), cylinder(patrol ? 1.45 : 2.05, .4, 0, -1.05, 0, 10)]);
  geometries.barrel = merge([cylinder(patrol ? .18 : .23, gunLength, 0, 0, -gunLength / 2, 8, Math.PI / 2),
    cylinder(patrol ? .26 : .31, .4, 0, 0, -gunLength + .2, 8, Math.PI / 2)]);
  return { geometries, materials, refs: 0 };
}

// Static resources are shared per enemy class. A wave can contain four ships
// without four copies of their meshes; the last removal releases the cache.
export function makeEnemyShip(requestedType = 'patrol') {
  const type = requestedType === 'frigate' ? 'frigate' : 'patrol', definition = ENEMY_SHIP_MODELS[type];
  let assets = enemyShipAssets.get(type);
  if (!assets) { assets = buildEnemyShipAssets(type); enemyShipAssets.set(type, assets); }
  assets.refs++;
  const ship = new THREE.Group(); ship.name = definition.name;
  for (const name of ['hull', 'deck', 'structure', 'dark', 'markings']) {
    const mesh = new THREE.Mesh(assets.geometries[name], assets.materials[name]);
    mesh.name = `enemy-${type}-${name}`; mesh.castShadow = true; mesh.receiveShadow = true; ship.add(mesh);
  }
  const turret = new THREE.Group(); turret.name = `enemy-${type}-turret`;
  turret.position.set(0, definition.gunPivot[1] - 1, definition.gunPivot[2]); ship.add(turret);
  const gunhouse = new THREE.Mesh(assets.geometries.gunhouse, assets.materials.structure);
  gunhouse.castShadow = true; gunhouse.receiveShadow = true; turret.add(gunhouse);
  const gun = new THREE.Group(); gun.name = `enemy-${type}-barrel-pitch`; gun.position.y = 1; turret.add(gun);
  const barrel = new THREE.Mesh(assets.geometries.barrel, assets.materials.dark); barrel.castShadow = true; gun.add(barrel);
  Object.assign(ship.userData, { kind: 'ship', shipType: type, turret, gun, targetAimHeight: definition.targetAimHeight,
    waveHeight: 0, wavePitch: 0, waveRoll: 0 });
  let elapsed = 0, initialized = false, disposed = false;
  ship.userData.update = (dt, state = {}) => {
    const step = clamp(finite(dt), 0, .1); if (step <= 0 && initialized) return;
    elapsed = Number.isFinite(state.time) ? state.time : elapsed + step;
    turret.rotation.y = finite(state.turretHeading, finite(state.heading)) - finite(state.heading);
    gun.rotation.x = clamp(finite(state.turretPitch), -.15, 1.4);
    ship.userData.targetAimHeight = finite(state.aimHeight, definition.targetAimHeight);
    ship.userData.waveHeight = Math.sin(elapsed * 1.17) * .05;
    ship.userData.wavePitch = Math.sin(elapsed * .82) * .0011;
    ship.userData.waveRoll = Math.sin(elapsed * 1.04) * .0015;
    initialized = true;
  };
  ship.userData.dispose = () => {
    if (disposed) return; disposed = true; assets.refs--;
    if (assets.refs === 0) {
      Object.values(assets.geometries).forEach(geometry => geometry.dispose());
      Object.values(assets.materials).forEach(material => material.dispose());
      enemyShipAssets.delete(type);
    }
  };
  return ship;
}
