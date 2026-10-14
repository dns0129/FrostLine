import * as THREE from './vendor/three.module.js';

// Original, game-scale interpretations of publicly photographed silhouettes.
// Metres, +Y up, -Z bow. Painted steel is deliberately rough, not bare chrome.
export const NAVAL_MODELS = Object.freeze({
  forrestal: Object.freeze({ name: '弗莱斯特级航空母舰', country: 'US', kind: 'carrier', length: 316, beam: 76, hullBeam: 40, deckY: 18, number: '59' }),
  fujian: Object.freeze({ name: '福建舰', country: 'CN', kind: 'carrier', length: 316, beam: 76, hullBeam: 41, deckY: 19, number: '18' }),
  burke: Object.freeze({ name: '阿利·伯克级驱逐舰', country: 'US', kind: 'destroyer', length: 154, beam: 20, hullBeam: 20, deckY: 6.2, number: '51' }),
  type052d: Object.freeze({ name: '052D 型驱逐舰', country: 'CN', kind: 'destroyer', length: 157, beam: 18, hullBeam: 18, deckY: 6.8, number: '172' }),
});

function box(w, h, d, x, y, z, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(ry); g.rotateZ(rz); return g.translate(x, y, z);
}
function cylinder(r, h, x, y, z, segments = 10, rx = 0, top = r) {
  const g = new THREE.CylinderGeometry(top, r, h, segments);
  g.rotateX(rx); return g.translate(x, y, z);
}
function slab(points, y, thickness = .25) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2); return g.translate(0, y - thickness, 0);
}
function loft(stations, topY, bottomY, lowerScale = .84) {
  const p = [], ring = ([z, w, rise = 0]) => [[-w, topY + rise, z], [w, topY + rise, z],
    [w * lowerScale, bottomY, z], [-w * lowerScale, bottomY, z]];
  const tri = (a, b, c) => p.push(...a, ...c, ...b);
  for (let i = 1; i < stations.length; i++) {
    const a = ring(stations[i - 1]), b = ring(stations[i]);
    for (let j = 0; j < 4; j++) { const k = (j + 1) % 4; tri(a[j], a[k], b[j]); tri(a[k], b[k], b[j]); }
  }
  const a = ring(stations[0]), b = ring(stations.at(-1));
  tri(a[0], a[2], a[1]); tri(a[0], a[3], a[2]); tri(b[0], b[1], b[2]); tri(b[0], b[2], b[3]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
}
function house(w, h, d, topScale, x, y, z) {
  const outline = (width, depth, height) => {
    const a = width / 2, b = depth / 2, cut = Math.min(.65, width * .08, depth * .08);
    return [[-a + cut, height, -b], [a - cut, height, -b], [a, height, -b + cut], [a, height, b - cut],
      [a - cut, height, b], [-a + cut, height, b], [-a, height, b - cut], [-a, height, -b + cut]];
  };
  const top = outline(w * topScale, d * .94, h / 2), bottom = outline(w, d, -h / 2), p = [];
  const tri = (a, b, c) => p.push(...a, ...b, ...c);
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    tri(top[i], top[next], bottom[i]); tri(top[next], bottom[next], bottom[i]);
    tri([0, h / 2, 0], top[next], top[i]); tri([0, -h / 2, 0], bottom[i], bottom[next]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals();
  return g.translate(x, y, z);
}
function line(a, b, y, width = .2, height = .055) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  return box(width, height, Math.hypot(dx, dz), (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, Math.atan2(dx, dz));
}
function merge(parts, tile = 12) {
  const p = [], n = [], uv = [];
  for (const source of parts) {
    const g = source.index ? source.toNonIndexed() : source;
    const pos = g.attributes.position, normal = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
      p.push(x, y, z); n.push(nx, ny, nz);
      // Metre UVs retain the same plate/grain scale on hulls and small fittings.
      if (Math.abs(ny) > .7) uv.push(x / tile, z / tile);
      else if (Math.abs(nx) > Math.abs(nz)) uv.push(z / tile, y / tile);
      else uv.push(x / tile, y / tile);
    }
    if (g !== source) g.dispose(); source.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}

function surfaceMaps(deck = false) {
  const size = 256, color = new Uint8Array(size * size * 4), rough = color.slice(), height = color.slice();
  let seed = deck ? 92117 : 37843;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const plates = Array.from({ length: 16 }, () => (random() - .5) * 6);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, grain = random(), plate = plates[Math.floor(y / 32) * 2 + Math.floor(x / 128)];
    const seam = x % 128 === 0 || y % 32 === 0;
    const rivet = !deck && x % 128 === 3 && y % 8 < 2;
    const streak = !deck && x % 128 < 5 ? Math.max(0, 1 - (y % 32) / 28) * (7 + grain * 11) : 0;
    const value = Math.round((deck ? 194 : 223) + plate + (grain - .5) * (deck ? 33 : 12) - (seam ? 14 : 0) - streak);
    color.set([value + (streak > 4 ? 4 : 0), value, value - (streak > 4 ? 3 : 0), 255], i);
    const r = Math.round((deck ? 235 : 208) + (grain - .5) * 21 + (seam ? 9 : 0));
    rough.set([r, r, r, 255], i);
    const h = Math.round(128 + (grain - .5) * (deck ? 77 : 20) - (seam ? 42 : 0) + (rivet ? 48 : 0));
    height.set([h, h, h, 255], i);
  }
  const make = (data, srgb = false) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
  };
  return { map: make(color, true), roughnessMap: make(rough), bumpMap: make(height) };
}

function materialsFor(paint, deck) {
  const coated = (color, roughness = .92) => new THREE.MeshStandardMaterial({ color, ...paint,
    roughness, metalness: .18, bumpScale: .025, envMapIntensity: .48 });
  return {
    hull: coated('#929ca3'), structure: coated('#aeb7bb'),
    deck: new THREE.MeshStandardMaterial({ color: '#687276', ...deck, roughness: 1, metalness: .04, bumpScale: .05, envMapIntensity: .22 }),
    dark: coated('#222b30', .96), underwater: coated('#59423b', .98),
    steel: new THREE.MeshStandardMaterial({ color: '#777d7c', ...paint, roughness: .56, metalness: .76, bumpScale: .014, envMapIntensity: .65 }),
    glass: new THREE.MeshStandardMaterial({ color: '#273f47', roughness: .25, metalness: .3, envMapIntensity: .7 }),
    white: new THREE.MeshStandardMaterial({ color: '#d3d8d2', roughness: .98, metalness: 0 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#c4a858', roughness: .98, metalness: 0 }),
    rust: new THREE.MeshStandardMaterial({ color: '#71564a', roughness: 1, metalness: .05 }),
  };
}
const emptyParts = () => Object.fromEntries(['hull', 'structure', 'deck', 'dark', 'underwater', 'steel', 'glass', 'white', 'yellow', 'rust'].map(k => [k, []]));
function hull(parts, def) {
  const l = def.length / 2, w = def.hullBeam / 2, y = def.deckY;
  const stations = [[-l, .16, 1.2], [-l * .94, w * .26, .75], [-l * .82, w * .61, .35],
    [-l * .63, w * .88], [-l * .38, w], [l * .35, w], [l * .70, w * .93], [l * .91, w * .8], [l, w * .73]];
  parts.hull.push(loft(stations, y - .35, -.4, .85));
  parts.dark.push(loft(stations.map(([z, width]) => [z, width * .852]), -.4, -.95, .96));
  parts.underwater.push(loft(stations.map(([z, width]) => [z, width * .82]), -.96, def.kind === 'carrier' ? -9 : -5, .46));
  if (def.kind !== 'carrier') parts.deck.push(loft(stations.map(([z, width, rise]) => [z, width * .985, rise]), y, y - .15, 1));
  // Anchor hawse plates, bollards and intermittent oxidised scuppers.
  for (const side of [-1, 1]) {
    parts.dark.push(box(.14, .8, 1.8, side * w * .55, y - 2, -l * .82));
    for (let z = -l * .5; z <= l * .8; z += 14) {
      parts.dark.push(box(.12, .3, .75, side * w * .91, y - 1.2, z));
      if (Math.round(z) % 3 === 0) parts.rust.push(box(.13, 1.1, .22, side * w * .915, y - 1.7, z));
    }
    for (const z of [-l * .68, -l * .46, l * .78, l * .93]) {
      parts.steel.push(cylinder(.22, .65, side * w * .63, y + .26, z), box(1.15, .17, .8, side * w * .63, y + .05, z));
    }
  }
  return stations;
}
function rail(parts, a, b, y, safety = false) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  parts.steel.push(line(a, b, y + 1.1, .065, .065), line(a, b, y + .55, .045, .045));
  for (let s = 0; s <= length; s += 4) {
    const t = s / length;
    parts.steel.push(box(.09, 1.16, .09, a[0] + (b[0] - a[0]) * t, y + .58, a[1] + (b[1] - a[1]) * t));
  }
  if (safety) parts.dark.push(line(a, b, y + .1, 1.1, .12));
}
function windows(parts, x, y, z, width, sideDepth = 10) {
  const count = Math.floor(width / 1.45);
  for (let i = 0; i < count; i++) parts.glass.push(box(1.05, 1, .09, x - width / 2 + .8 + i * 1.45, y, z));
  for (const side of [-1, 1]) for (let i = 0; i < sideDepth / 1.7; i++) {
    parts.glass.push(box(.09, 1, 1.18, x + side * width / 2, y, z + 1 + i * 1.7));
  }
}
function vls(parts, x, z, y, rows, columns) {
  const width = columns * 1.35, depth = rows * 1.4;
  parts.dark.push(box(width + .8, .22, depth + .8, x, y + .12, z));
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const cx = x + (c - (columns - 1) / 2) * 1.35, cz = z + (r - (rows - 1) / 2) * 1.4;
    parts.structure.push(box(1.14, .13, 1.17, cx, y + .3, cz));
    parts.steel.push(box(.62, .07, .12, cx, y + .39, cz - .46));
  }
}
function ciws(parts, x, y, z, chinese = false) {
  parts.structure.push(cylinder(1.4, 1.5, x, y + .7, z), house(2, 1.9, 2.4, .85, x, y + 2, z));
  parts.structure.push(cylinder(.72, 1.3, x, y + 3.4, z));
  parts.dark.push(box(chinese ? .65 : .4, .4, 2.8, x, y + 2, z - 1.8));
}
function sphere(r, x, y, z) { const g = new THREE.SphereGeometry(r, 12, 8); return g.translate(x, y, z); }
function islandDetails(parts, ix, iz, y, cn) {
  // Overhanging bridge wings, inset doors, roof galleries, radar domes and lattice.
  parts.structure.push(box(16.5, .5, 24, ix, y + 15.7, iz - 8), box(16, .55, 23, ix, y + 19.1, iz - 9));
  parts.dark.push(box(8.8, .18, 14, ix, y + 19.47, iz - 9));
  for (const side of [-1, 1]) {
    rail(parts, [ix + side * 7.8, iz - 20], [ix + side * 7.8, iz + 1], y + 19.4);
    parts.dark.push(box(.13, 2.3, .95, ix + side * 6.5, y + 4.5, iz - 7));
    for (const z of [iz - 15, iz + 2, iz + 17]) parts.structure.push(box(.22, 5, .5, ix + side * 6.6, y + 4, z));
    parts.structure.push(sphere(1.3, ix + side * 5, y + 21.3, iz - 16));
    // Stacks carry narrow exhaust-grille fins instead of an unbroken black cap.
    for (let i = 0; i < 6; i++) parts.steel.push(box(.16, 2.7, .22, ix + side * 5.1, y + 18.3, iz + 7 + i));
  }
  const height = cn ? 34 : 37;
  parts.structure.push(cylinder(.55, height - 19, ix, y + (height + 19) / 2, iz - 4, 8));
  for (const side of [-1, 1]) {
    parts.structure.push(box(.18, 8, .18, ix + side * 1.5, y + 27, iz - 4, 0, side * -.2));
    for (const h of [24, 27, 30]) parts.structure.push(box(4, .16, .3, ix, y + h, iz - 4));
    parts.structure.push(cylinder(.12, 7, ix + side * 5.3, y + 27, iz - 4, 5));
  }
  const ry = cn ? y + 34 : y + 38;
  parts.structure.push(box(9, 3.7, .26, ix, ry, iz - 4));
  parts.dark.push(box(8.4, 3.1, .15, ix, ry, iz - 4.22));
  for (let h = -1.5; h <= 1.5; h += .6) parts.structure.push(box(8.5, .08, .16, ix, ry + h, iz - 4.32));
  for (let x = -4; x <= 4; x += 1) parts.structure.push(box(.07, 3.2, .16, ix + x, ry, iz - 4.32));
  parts.structure.push(sphere(1.7, ix, y + 22, iz + 19));
}
function parkedJet(parts, x, y, z, chinese, heading = 0) {
  const geometries = { structure: [], dark: [], glass: [] };
  const profile = [[-8.8, .06, .1], [-5.6, .7, .3], [-1.5, 1.05, .35], [4.7, 1, .2], [7.4, .72, 0]];
  geometries.structure.push(loft(profile, .65, -.5, .8),
    slab([[-.8, -2], [-6.6, 3.7], [-6.1, 6], [-1, 4.8], [1, 4.8], [6.1, 6], [6.6, 3.7], [.8, -2]], .12, .2),
    slab([[-.5, 4], [-3.8, 6.4], [-3.4, 7.3], [3.4, 7.3], [3.8, 6.4], [.5, 4]], .4, .18));
  for (const side of [-1, 1]) {
    geometries.structure.push(box(.14, 2.6, 2.9, side * (chinese ? 1.2 : 1.55), 1.5, 5.4, 0, side * .16));
    geometries.dark.push(cylinder(.43, .25, side * .6, .15, 7.3, 8, Math.PI / 2));
    geometries.dark.push(box(.3, .8, .6, side * 1.2, -.6, 2));
  }
  const canopy = new THREE.SphereGeometry(.9, 10, 6); canopy.scale(.64, .55, 2.1); canopy.translate(0, .95, -3.4);
  geometries.glass.push(canopy); geometries.dark.push(box(.3, .8, .65, 0, -.6, -4.6));
  for (const [key, list] of Object.entries(geometries)) for (const g of list) { g.rotateY(heading); g.translate(x, y + 1.2, z); parts[key].push(g); }
}
function carrier(parts, type, detailed) {
  const cn = type === 'fujian', d = NAVAL_MODELS[type], y = d.deckY;
  hull(parts, d);
  const outline = cn
    ? [[-24, -158], [23, -158], [31, -135], [32, -75], [38, -51], [38, 125], [29, 158], [-27, 158], [-37, 130], [-38, 48], [-29, 13], [-29, -130]]
    : [[-21, -158], [20, -158], [27, -132], [29, -65], [38, -42], [36, 120], [25, 158], [-25, 158], [-36, 136], [-38, 52], [-30, 8], [-29, -119]];
  parts.hull.push(slab(outline, y - .23, 1.15)); parts.deck.push(slab(outline.map(([x, z]) => [x * .994, z * .998]), y, .23));
  // Starboard island: Forrestal's taller conventional stack; Fujian's compact faceted tower.
  const ix = cn ? 25 : 24, iz = cn ? 29 : -13;
  parts.structure.push(house(13, 8.5, cn ? 42 : 49, .9, ix, y + 4.3, iz),
    house(14, 7, 23, .86, ix, y + 11.8, iz - 8), house(13, 3.5, 18, .88, ix, y + 17, iz - 11));
  parts.structure.push(house(cn ? 10 : 12, cn ? 10 : 13, 12, .85, ix, y + 17, iz + 10));
  parts.dark.push(box(8.6, .35, 9, ix, y + (cn ? 22.15 : 23.65), iz + 10));
  windows(parts, ix, y + 17.4, iz - 20.1, 11.8, 14);
  parts.steel.push(cylinder(.42, cn ? 16 : 20, ix, y + 29, iz - 4, 8),
    box(16, .27, .4, ix, y + 30, iz - 4), box(10, .3, .4, ix, y + 35, iz - 4));
  if (cn) for (const s of [-1, 1]) parts.dark.push(box(.2, 3.9, 4, ix + s * 6.4, y + 12, iz - 9));
  else parts.dark.push(box(8, 3.8, .25, ix, y + 38, iz - 4));
  if (!detailed) {
    parts.white.push(line([-22, 141], [0, -92], y + .065, .75), line([-5, 141], [17, -92], y + .065, .75));
    return;
  }
  islandDetails(parts, ix, iz, y, cn);
  // Angled recovery lane, broken centreline, threshold bars, four arresting wires.
  const recovery = z => -13 + (141 - z) * .1;
  for (const offset of [-9, 9]) parts.white.push(line([recovery(143) + offset, 143], [recovery(-86) + offset, -86], y + .065, .46));
  for (let z = -82; z < 140; z += 12) parts.white.push(line([recovery(z), z], [recovery(z + 5), z + 5], y + .07, .34));
  for (const z of [78, 89, 100, 111]) parts.steel.push(line([recovery(z) - 10, z], [recovery(z) + 10, z], y + .12, .16));
  for (let x = -21; x <= -6; x += 2) parts.white.push(box(.7, .07, 6, x, y + .07, 140));
  // Two bow catapults and one/two waist catapults distinguish the deck plans.
  const cats = [[[-12, -146], [-12, -49]], [[10, -145], [10, -45]], [[-24, 12], [-14, -75]]];
  if (!cn) cats.push([[-11, 25], [1, -71]]);
  for (const [a, b] of cats) {
    parts.dark.push(line(a, b, y + .06, .95)); parts.steel.push(line(a, b, y + .105, .26));
    parts.yellow.push(line([a[0] - 2, a[1]], [b[0] - 2, b[1]], y + .07, .18));
    const blast = box(7, .2, 3.4, b[0], y + .18, b[1] + 4); parts.steel.push(blast);
  }
  // Recessed deck-edge elevator panels with inset borders and underside supports.
  const elevators = cn ? [[29, -74], [30, 80]] : [[29, -81], [29, 57], [-28, -18], [29, 117]];
  for (const [x, z] of elevators) {
    parts.dark.push(box(14.5, .07, 19.5, x, y + .05, z)); parts.deck.push(box(13.8, .06, 18.8, x, y + .12, z));
    parts.yellow.push(line([x - 6.8, z - 9.3], [x + 6.8, z - 9.3], y + .18, .18));
    parts.hull.push(box(9, 4, 13, x * .92, y - 3.8, z));
  }
  for (const side of [-1, 1]) {
    // Catwalks and dark hangar openings keep the deck from looking like a solid toy block.
    parts.structure.push(box(4.5, .8, 83, side * 23, y - 5, 61), box(5, .8, 68, side * 22, y - 4.9, -69));
    for (const z of [-55, 26, 94]) {
      parts.dark.push(box(.18, 5.2, 15, side * 19.3, y - 6.6, z));
      parts.steel.push(box(.2, .45, 16, side * 19.5, y - 3.8, z));
    }
    rail(parts, [side * 25, -102], [side * 25, -37], y - 4.6);
    rail(parts, [side * 25.2, 23], [side * 25.2, 96], y - 4.6);
    ciws(parts, side * 28, y - 3.8, side < 0 ? 117 : -115, cn);
    // Thin flight-deck safety net supports along stern/perimeter.
    for (let z = 45; z <= 130; z += 10) parts.steel.push(box(2.4, .12, 5.5, side * 36, y - .5, z, 0, side * .12));
  }
  for (const z of [-104, -76, 70, 98, 126]) {
    const x = z < 0 ? 19 : 24;
    parkedJet(parts, x, y, z, cn, z < 0 ? -.18 : .18);
    parts.yellow.push(line([x - 6, z - 10], [x + 6, z - 10], y + .08, .16));
  }
  parkedJet(parts, -24, y, 111, cn, .28);
  // Tie-down grid is merged geometry, no separate object per fixture.
  for (let z = -120; z < 139; z += 10) for (let x = -19; x < 24; x += 8) {
    parts.steel.push(box(.28, .06, .28, x, y + .05, z));
  }
  for (let z = -125; z < 138; z += 11) parts.white.push(box(.35, .06, 3.7, -27, y + .08, z));
}

function destroyer(parts, type, detailed) {
  const cn = type === 'type052d', d = NAVAL_MODELS[type], y = d.deckY;
  hull(parts, d);
  parts.structure.push(house(cn ? 13.7 : 15.1, 8.5, 32, cn ? .75 : .88, 0, y + 4.2, -10),
    house(cn ? 12.5 : 14, 5.3, 13, .82, 0, y + 11, -18),
    house(cn ? 12.5 : 14.5, 7.5, 22, .88, 0, y + 3.75, 36));
  parts.dark.push(box(cn ? 10 : 12, 5.4, .2, 0, y + 2.8, 47.1));
  windows(parts, 0, y + 12.2, -24.6, cn ? 10.3 : 11.7, 10);
  // Faceted radar arrays on four bridge faces; both classes have different mast profiles.
  for (const side of [-1, 1]) {
    parts.dark.push(box(.14, cn ? 4.5 : 3.5, 4.5, side * (cn ? 6 : 6.7), y + 7.7, -13, 0, side * -.12));
    parts.hull.push(box(.17, cn ? 4.1 : 3.1, 4.1, side * (cn ? 6.08 : 6.78), y + 7.7, -13, 0, side * -.12));
    parts.dark.push(box(4, cn ? 4.3 : 3.5, .14, side * 3.3, y + 7.5, -26.1, side * .13));
    parts.hull.push(box(3.65, cn ? 3.95 : 3.15, .17, side * 3.3, y + 7.5, -26.19, side * .13));
  }
  parts.structure.push(house(6.1, 7, 8, .8, 0, y + 9.3, 6), house(5.5, 6.5, 7, .85, 0, y + 8.8, 25));
  parts.dark.push(box(4.6, .3, 6.3, 0, y + 12.9, 6), box(4.4, .3, 5.2, 0, y + 12.2, 25));
  if (cn) parts.structure.push(house(3.8, 11, 4, .38, 0, y + 18.1, -13));
  else {
    for (const side of [-1, 1]) parts.steel.push(line([side * 2.6, -10], [side * .6, -11.4], y + 19, .27, 7));
    parts.steel.push(cylinder(.25, 12, 0, y + 22, -11, 6));
  }
  parts.steel.push(box(10.3, .22, .3, 0, y + 23, -11));
  parts.dark.push(box(cn ? 5.5 : 4.8, 1.7, .2, 0, y + 26.5, -11));
  // Low bow gun and barrel; the 052D's gunhouse is a larger, angular shape.
  parts.structure.push(cylinder(2.25, 1.4, 0, y + .7, -54), house(cn ? 5.2 : 4.5, 3.4, 5.5, .7, 0, y + 2.5, -54));
  parts.steel.push(cylinder(.19, cn ? 8.3 : 7.2, 0, y + 3.1, -60, 8, Math.PI / 2));
  if (!detailed) return;
  parts.structure.push(box(cn ? 14 : 15.5, .45, 13.5, 0, y + 13.85, -18));
  for (const side of [-1, 1]) {
    rail(parts, [side * (cn ? 6.9 : 7.5), -24], [side * (cn ? 6.9 : 7.5), -12], y + 14.1);
    parts.structure.push(sphere(.95, side * 4.9, y + 15.5, -16));
    // Visible bridge service ladders and exhaust louvers, all batched.
    for (let h = 0; h < 7; h++) parts.steel.push(box(.65, .09, .13, side * 6.5, y + 1 + h * .45, -6));
    for (let z = 3.5; z <= 8.5; z += .65) parts.dark.push(box(.16, 2, .19, side * 2.8, y + 9.8, z));
  }
  rail(parts, [-6, 47], [6, 47], y + 7.5);
  vls(parts, 0, -38, y, cn ? 8 : 8, 4);
  vls(parts, 0, 18, y, cn ? 8 : 8, cn ? 4 : 8);
  ciws(parts, 0, y + 7.6, cn ? -27 : -7, cn); ciws(parts, 0, y + 7.7, 39, cn);
  for (const side of [-1, 1]) {
    parts.dark.push(house(2.7, 1.5, 7.3, .55, side * 7, y + 1.4, 1));
    parts.structure.push(box(2.9, .45, 8, side * 7, y + .6, 1));
    rail(parts, [side * 8.7, -28], [side * 8.7, 49], y);
    rail(parts, [side * 8.5, 50], [side * 7.1, 76], y);
    for (const z of [-14, 4, 29]) parts.structure.push(box(.2, 2.3, 1, side * 6.8, y + 2.4, z));
    parts.steel.push(box(.3, 3.8, .3, side * 6, y + 2.2, 9));
  }
  const ring = new THREE.TorusGeometry(6, .12, 3, 40); ring.rotateX(Math.PI / 2); ring.translate(0, y + .08, 63);
  parts.white.push(ring, line([-2.4, 59], [-2.4, 67], y + .08, .32), line([2.4, 59], [2.4, 67], y + .08, .32),
    line([-2.4, 63], [2.4, 63], y + .08, .32), line([0, 70], [0, 77], y + .08, .24));
  parts.yellow.push(line([-6.7, 51], [6.7, 51], y + .08, .22));
  for (const x of [-4, 4]) for (let z = 57; z < 74; z += 4) parts.steel.push(box(.23, .06, .23, x, y + .08, z));
  if (cn) parts.dark.push(box(5, 2.1, .15, 0, y + 16, 21));
}

const DIGITS = ['abcedf', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgecd', 'abc', 'abcdefg', 'abfgcd'];
function digits(text, size, x, y, z, hullSide = 0) {
  const parts = [], segments = {
    a: [0, -.9, 1, .16], g: [0, 0, 1, .16], d: [0, .9, 1, .16],
    f: [-.46, -.45, .16, .85], b: [.46, -.45, .16, .85], e: [-.46, .45, .16, .85], c: [.46, .45, .16, .85],
  };
  for (let i = 0; i < text.length; i++) for (const key of DIGITS[Number(text[i])]) {
    const [sx, sz, w, d] = segments[key], cx = (i - (text.length - 1) / 2) * 1.45 + sx;
    if (hullSide) parts.push(box(.06, d * size, w * size, x, y - sz * size, z - hullSide * cx * size));
    else parts.push(box(w * size, .065, d * size, x + cx * size, y, z + sz * size));
  }
  return merge(parts);
}

function buildClass(type, materials) {
  const def = NAVAL_MODELS[type], levels = [];
  for (const detailed of [true, false]) {
    const parts = emptyParts();
    if (def.kind === 'carrier') carrier(parts, type, detailed); else destroyer(parts, type, detailed);
    levels.push(Object.entries(parts).filter(([, list]) => list.length).map(([key, list]) => ({ key, geometry: merge(list, key === 'deck' ? 6 : 12), material: materials[key] })));
  }
  return { def, levels };
}

export function makeNavalAssets() {
  const paint = surfaceMaps(), deck = surfaceMaps(true), materials = materialsFor(paint, deck);
  const classes = Object.fromEntries(Object.keys(NAVAL_MODELS).map(type => [type, buildClass(type, materials)]));
  const owned = new Set(); let disposed = false;
  return { classes, materials, textures: { paint, deck }, owned,
    dispose() {
      if (disposed) return; disposed = true;
      for (const { levels } of Object.values(classes)) for (const level of levels) for (const { geometry } of level) geometry.dispose();
      for (const g of owned) g.dispose(); owned.clear();
      Object.values(materials).forEach(m => m.dispose());
      for (const maps of [paint, deck]) Object.values(maps).forEach(t => t.dispose());
    } };
}

export function makeNavalShip(assets, type, number = NAVAL_MODELS[type]?.number) {
  if (!assets.classes[type]) throw new Error(`Unknown naval model: ${type}`);
  const { def, levels } = assets.classes[type], root = new THREE.Group(), lod = new THREE.LOD();
  root.name = `${def.name} ${number}`; root.userData = { modelType: type, country: def.country, kind: def.kind, number, definition: def, lod };
  levels.forEach((list, index) => {
    const group = new THREE.Group(); group.name = index ? 'distant-silhouette' : 'detailed-ship';
    for (const { key, geometry, material } of list) {
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `naval-${type}-${key}`;
      mesh.castShadow = index === 0 && key !== 'glass'; mesh.receiveShadow = true; group.add(mesh);
    }
    lod.addLevel(group, index ? 2600 : 0);
  });
  const y = def.deckY;
  const stencilParts = [];
  if (def.kind === 'carrier') stencilParts.push(digits(number, 6.5, 1, y + .14, -127));
  for (const side of [-1, 1]) stencilParts.push(digits(number, def.kind === 'carrier' ? 2.2 : 1.8,
    side * def.hullBeam * (def.kind === 'carrier' ? .49 : .476), y - 2.6, -def.length * .19, side));
  const stencil = merge(stencilParts); assets.owned.add(stencil);
  const mesh = new THREE.Mesh(stencil, assets.materials.white); mesh.name = 'hull-and-deck-number'; lod.levels[0].object.add(mesh);
  root.add(lod); return root;
}
