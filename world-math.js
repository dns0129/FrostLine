import { getMap } from './maps.js';

// Metres in a right-handed world; aircraft fly towards -Z at heading zero.
// Keep this array identity stable for existing renderer and simulation imports.
let activeMap = getMap();
export const ISLANDS = [...activeMap.islands];
export function getActiveMap() { return activeMap; }
export function setActiveMap(id) {
  activeMap = getMap(id);
  ISLANDS.splice(0, ISLANDS.length, ...activeMap.islands);
  indexStructures(activeMap.structures);
  indexIcebergs(activeMap.icebergs);
  return activeMap;
}
function hash(x, z) { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }
function smooth(t) { return t * t * (3 - 2 * t); }
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
const SEABED = -32;
const SHORE_LIMIT = 1.025;
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothRange = (a, b, value) => smooth(clamp01((value - a) / (b - a)));

// Island orientation and tributary geometry are computed once. The broad ridge
// and 200–600 m spurs survive the mobile mesh; metre-scale rock lives in shading.
const shapes = new WeakMap();
function shapeFor(island) {
  if (shapes.has(island)) return shapes.get(island);
  const angle = island.rotation ?? island.seed * 1.73 + .35;
  const shape = {
    cos: Math.cos(angle), sin: Math.sin(angle),
    bend: .085 + noise2(island.seed, 41) * .045,
    spurs: [-1, 1].flatMap(side => [-.46, -.04, .38].map((anchor, index) => ({
      side, anchor: anchor + (noise2(island.seed + index, side * 7) - .5) * .13,
      sweep: -.48 + noise2(index + 19, island.seed + side) * .96,
      reach: .46 + noise2(island.seed + 11, index + side) * .21,
      weight: .58 + noise2(index + island.seed, side + 29) * .14,
    }))),
  };
  shapes.set(island, shape); return shape;
}
for (const island of ISLANDS) shapeFor(island);

function channelDistance(points, u, v) {
  let distance = Infinity;
  for (let index = 1; index < points.length; index++) {
    const [ax, az] = points[index - 1], [bx, bz] = points[index];
    const dx = bx - ax, dz = bz - az;
    const t = clamp01(((u - ax) * dx + (v - az) * dz) / Math.max(.000001, dx * dx + dz * dz));
    distance = Math.min(distance, Math.hypot(u - ax - dx * t, v - az - dz * t));
  }
  return distance;
}

// Low ice shelves, urban bedrock and a branching alluvial delta use the same
// bounded, continuous field as collision. There are no visual-only icebergs
// or painted river ribbons hiding solid ground under the ocean.
function lowlandHeight(island, dx, dz, shape) {
  const u = (dx * shape.cos + dz * shape.sin) / (island.scaleX || 1);
  const v = (-dx * shape.sin + dz * shape.cos) / (island.scaleZ || 1);
  const ellipse = Math.hypot(u, v);
  const shoreline = .865 + noise2(u * 3.2 + island.seed, v * 3.2 - 19) * .085
    + noise2(u * 7.7 + 34, v * 7.7 + island.seed) * .018;
  const edge = shoreline - ellipse;
  if (edge <= 0) return SEABED;
  const plateau = island.plateauHeight ?? island.height;
  if (island.shape === 'ice-shelf') {
    const coast = smoothRange(0, .048, edge);
    const pressure = 1 - Math.abs(noise2(u * 5.3 + island.seed, v * 4.8 + 17) * 2 - 1);
    const ridge = pressure * pressure * smoothRange(.055, .31, edge);
    const relief = Math.max(0, island.height - plateau) * ridge;
    return SEABED + coast * (32 + plateau) + relief;
  }
  const coast = smoothRange(0, .13, edge);
  if (island.shape === 'plateau') return SEABED + coast * (32 + plateau);
  const alluvium = plateau * (.82 + noise2(u * 3.1 + 12, v * 2.8 + island.seed) * .18);
  let height = SEABED + coast * (32 + alluvium);
  for (const channel of island.channels || []) {
    const distance = channelDistance(channel.points, u, v) * island.radius;
    const bank = smoothRange(channel.width, channel.width + channel.bank, distance);
    const bed = -channel.depth;
    height = Math.min(height, bed + (height - bed) * bank);
  }
  return Math.max(SEABED, height);
}

// Tidewater glaciers flow along local +u and end in a calving cliff. Their
// lateral and upstream margins sink under the flanking massifs, which win in
// terrainHeight's maximum and read as valley walls and nunataks.
const glaciers = new WeakMap();
export function glacierFrame(island) {
  if (glaciers.has(island)) return glaciers.get(island);
  const width = island.width ?? .4, widen = island.widen ?? .45;
  const front = island.front ?? .8, head = island.head ?? -.9;
  const frame = {
    front, head, width, skirt: island.skirt ?? 7,
    halfWidth: u => width * (1 + widen * clamp01((front - u) / (front - head))),
    // The fast centre bulges seaward; calving bays break the line at two scales.
    frontAt: v => {
      const across = v / width;
      return front + .045 * (1 - Math.min(1, across * across))
        + (noise2(v * 7.3 + island.seed, island.seed * .37) - .5) * .028
        + (noise2(v * 19.3 + 13, island.seed) - .5) * .018;
    },
  };
  glaciers.set(island, frame); return frame;
}
function glacierSurface(island, frame, u, v) {
  const a = clamp01((frame.frontAt(v) - u) / (frame.front - frame.head));
  const across = v / frame.halfWidth(u);
  // A convex, roughly parabolic long profile; pressure ogives fade upstream.
  const crest = island.plateauHeight + (island.height - island.plateauHeight) * Math.pow(a, .58);
  const ogives = 2.4 * Math.sin(a * 74 + across * across * 2.6 + island.seed) * (1 - a) * (1 - a);
  // Broad serac ridges where fast ice nears the front; finer crevasses are shading.
  const seracs = (ridged(u * 17 + island.seed, v * 23 - island.seed) - .5) * 9 * (1 - smoothRange(.02, .3, a));
  const margins = smoothRange(1.08, .9, Math.abs(across)) * smoothRange(frame.head - .06, frame.head + .14, u)
    * (u < 0 ? smoothRange(1, .88, Math.hypot(u, v)) : 1);
  return SEABED + (crest * (1 - .07 * across * across) + ogives + seracs - SEABED) * margins;
}
function glacierHeight(island, dx, dz, shape) {
  const frame = glacierFrame(island);
  const u = dx * shape.cos + dz * shape.sin, v = -dx * shape.sin + dz * shape.cos;
  const front = frame.frontAt(v);
  if (u <= front) return glacierSurface(island, frame, u, v);
  // The ice cliff is a metres-wide skirt of the same field, so its rendered
  // face, the shore wash and ship grounding all use one surface.
  const beyond = (u - front) * island.radius;
  if (beyond >= frame.skirt) return SEABED;
  const lip = glacierSurface(island, frame, front, v);
  return lip - (lip - SEABED) * smoothRange(0, frame.skirt, beyond);
}

/** Height of one island, including its continuous -32 m seabed skirt.
 * Mesh generation can call this directly; terrainHeight remains the collision
 * source of truth and takes the maximum when island bounding areas overlap.
 */
export function islandHeight(island, x, z) {
  const dx = (x - island.x) / island.radius, dz = (z - island.z) / island.radius;
  // Do not evaluate noise for open ocean, projectiles, or distant islands.
  if (Math.abs(dx) >= SHORE_LIMIT || Math.abs(dz) >= SHORE_LIMIT || dx * dx + dz * dz >= SHORE_LIMIT * SHORE_LIMIT) return SEABED;
  const shape = shapeFor(island);
  if (island.shape === 'glacier') return glacierHeight(island, dx, dz, shape);
  if (island.shape) return lowlandHeight(island, dx, dz, shape);
  const u = dx * shape.cos + dz * shape.sin, v = -dx * shape.sin + dz * shape.cos;
  const ellipse = Math.hypot(u, v * 1.13);
  // Two broad, smoothly varying coast scales produce bays and headlands; their
  // bounded amplitude guarantees that land never reaches the early-out border.
  const shoreline = .775 + noise2(u * 2.35 + island.seed, v * 2.35 - island.seed) * .205
    + noise2(u * 5.3 + 34, v * 5.3 + island.seed) * .041;
  const edge = shoreline - ellipse;
  if (edge <= 0) return SEABED;

  // A warped watershed gives the massif direction. Along its length, unequal
  // summits and saddles break the silhouette instead of forming one smooth tent.
  const fault = (noise2(u * 4.6 + 13, v * 4.2 + island.seed) - .5) * .14;
  const spine = Math.sin(u * 3.8 + island.seed) * shape.bend + Math.sin(u * 7.1 - island.seed) * .025 + fault;
  const across = v - spine, distance = Math.abs(across);
  const crest = Math.pow(clamp01(1 - distance / (.52 + fault)), 1.42);
  const summitNoise = noise2(u * 5.9 + island.seed, v * 1.3 + island.seed + 9);
  const summit = .44 + (1 - Math.abs(summitNoise * 2 - 1)) * .61;
  let relief = crest * summit;
  for (const spur of shape.spurs) {
    const reach = across * spur.side;
    if (reach <= 0 || reach >= spur.reach) continue;
    const line = spur.anchor + reach * spur.sweep + reach * reach * .27;
    const width = .075 + reach * .13;
    const crossSection = Math.pow(clamp01(1 - Math.abs(u - line) / width), 1.35);
    const downslope = Math.pow(1 - reach / spur.reach, .85);
    relief = Math.max(relief, crossSection * downslope * spur.weight);
  }
  // Valleys broaden toward the coast. Attenuation at the watershed preserves
  // continuous ridge crests; this subtractive detail never turns into bumps.
  const drainage = noise2(u * 6.2 + distance * 2.7 + island.seed, distance * 2.0 + 27);
  const erosion = Math.pow(drainage, 3) * .19 * smoothRange(.04, .28, distance);
  relief = Math.max(.035, relief - erosion);
  const inland = smoothRange(.005, .29, edge) * (.52 + .48 * smoothRange(.22, .68, edge));
  const mountain = inland * island.height * (.075 + relief * .925);

  // Alternating low shores and rock scarps use the same continuous heightfield.
  // No step or vertical wall is inserted at sea level, even on the steep shore.
  const cliffField = noise2(u * 2.3 + 57, v * 2.3 + island.seed);
  const cliff = smoothRange(.55, .80, cliffField);
  const shelf = smoothRange(0, .075, edge) * (27 + cliff * 155);
  const exposed = inland * smoothRange(.05, .46, relief);
  if (exposed === 0) return SEABED + shelf + mountain;
  // Nested sharp ridges produce exposed facets at hundreds, then tens, of
  // metres. They are strongest on the massif, not uniformly across low ground.
  // The absolute-value creases are continuous; smooth noise alone looked soft.
  const rockU = u + fault * .42, rockV = v + fault * .28;
  const largeRidge = 1 - Math.abs(noise2(rockU * 8.3 + 8, rockV * 7.1 + island.seed) * 2 - 1);
  const smallRidge = 1 - Math.abs(noise2(rockU * 19.7 + island.seed, rockV * 16.1 + 43) * 2 - 1);
  const broken = (largeRidge - .49) * island.height * .24
    + (smallRidge - .51) * island.height * .095;
  // Long, uneven downslope cuts separate buttresses and expose their faces.
  // Their cross-slope frequency is much higher than their downslope frequency,
  // so they read as gullies instead of a carpet of little round hills.
  const grooveNoise = noise2(u * 24.7 + fault * 4.1 + distance * 3.7 + island.seed, distance * 2.8 + 76);
  const grooves = Math.pow(clamp01(1 - Math.abs(grooveNoise * 2 - 1)), 5)
    * Math.min(140, island.height * .065) * smoothRange(.025, .17, distance);
  const rock = (broken - grooves) * exposed;
  return Math.max(SEABED, SEABED + shelf + mountain + rock);
}

// A small spatial index avoids scanning every city block for every projectile
// and AI clearance sample. This index depends on map geometry, never quality.
const structureCells = new Map();
const structureBounds = new WeakMap();
const CELL_SIZE = 500;
function boundsFor(structure) {
  if (!structureBounds.has(structure)) {
    const cos = Math.cos(structure.rotation || 0), sin = Math.sin(structure.rotation || 0);
    structureBounds.set(structure, { cos, sin,
      x: Math.abs(cos) * structure.width / 2 + Math.abs(sin) * structure.depth / 2,
      z: Math.abs(sin) * structure.width / 2 + Math.abs(cos) * structure.depth / 2 });
  }
  return structureBounds.get(structure);
}
function indexStructures(structures = []) {
  structureCells.clear();
  for (const structure of structures) {
    const bounds = boundsFor(structure);
    for (let ix = Math.floor((structure.x - bounds.x) / CELL_SIZE); ix <= Math.floor((structure.x + bounds.x) / CELL_SIZE); ix++) {
      for (let iz = Math.floor((structure.z - bounds.z) / CELL_SIZE); iz <= Math.floor((structure.z + bounds.z) / CELL_SIZE); iz++) {
        const key = `${ix},${iz}`;
        if (!structureCells.has(key)) structureCells.set(key, []);
        structureCells.get(key).push(structure);
      }
    }
  }
}
indexStructures(activeMap.structures);

export function structureHeight(structure, x, z) {
  const bounds = boundsFor(structure), dx = x - structure.x, dz = z - structure.z;
  if (Math.abs(dx) > bounds.x || Math.abs(dz) > bounds.z) return SEABED;
  const localX = dx * bounds.cos - dz * bounds.sin;
  const localZ = dx * bounds.sin + dz * bounds.cos;
  return Math.abs(localX) <= structure.width / 2 && Math.abs(localZ) <= structure.depth / 2
    ? (structure.y || 0) + structure.height : SEABED;
}

// Floating ice. Each iceberg is a solid collision body with a polar outline:
// its rendered cliff is a steep, metres-wide skirt of this same field, so the
// visible ice face, aircraft impacts and ship grounding coincide. The skirt
// stands in for the submerged ice foot; no hidden underwater ram is modelled.
const TAU = Math.PI * 2;
const ICE_CELL = 400;
const icebergCells = new Map();
const icebergShapes = new WeakMap();
const ridged = (x, z) => 1 - Math.abs(noise2(x, z) * 2 - 1);
const iceKey = (ix, iz) => (ix + 4096) * 8192 + iz + 4096;

function polygonRadius(corners, phi) {
  let index = corners.length - 1;
  for (let i = 0; i < corners.length; i++) if (corners[i][0] <= phi) index = i;
  const [a0, r0] = corners[index], [a1, r1] = corners[(index + 1) % corners.length];
  const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
  const ex = Math.cos(a1) * r1 - x0, ez = Math.sin(a1) * r1 - z0;
  return (x0 * ez - z0 * ex) / (Math.cos(phi) * ez - Math.sin(phi) * ex);
}
function outlineFactor(shape, phi) {
  phi = (phi % TAU + TAU) % TAU;
  let radius = shape.corners ? polygonRadius(shape.corners, phi) : 1;
  for (const [k, amplitude, phase] of shape.harmonics) radius += amplitude * Math.cos(k * phi + phase);
  for (const bite of shape.bites) {
    const offset = Math.abs((phi - bite.angle + TAU * 1.5) % TAU - Math.PI);
    if (offset < bite.width) radius -= bite.depth * (.5 + .5 * Math.cos(offset / bite.width * Math.PI));
  }
  return radius;
}

/** Cached outline, spires and bounds of one iceberg. Geometry depends only on
 * the catalog entry, never on the visual quality tier. */
export function icebergFrame(berg) {
  let shape = icebergShapes.get(berg);
  if (shape) return shape;
  const seed = berg.seed, rotation = berg.rotation ?? 0;
  shape = {
    cos: Math.cos(rotation), sin: Math.sin(rotation), stretch: berg.stretch ?? 1,
    skirt: berg.skirt ?? Math.min(7, Math.max(2.5, berg.radius * .03)),
    corners: null, harmonics: [], bites: [], spires: [],
  };
  if (berg.type === 'tabular' || berg.type === 'blocky') {
    // Calved slabs keep straight fracture faces between irregular corners.
    const count = (berg.type === 'tabular' ? 6 : 5) + Math.floor(hash(seed, 3.7) * 3);
    shape.corners = Array.from({ length: count }, (_, i) => [
      ((i + (hash(seed + i, 1.3) - .5) * .5) / count * TAU + TAU) % TAU, .84 + hash(i * 2.3, seed + 9) * .16,
    ]).sort((a, b) => a[0] - b[0]);
    shape.harmonics.push([9, .009, hash(seed, 5) * TAU], [13, .006, hash(seed, 6) * TAU]);
    const bites = berg.type === 'tabular' ? 1 + Math.floor(hash(seed, 8) * 2) : 0;
    for (let i = 0; i < bites; i++) shape.bites.push({
      angle: hash(seed + i, 11) * TAU, width: .16 + hash(seed, 12 + i) * .2, depth: .07 + hash(seed + i, 13) * .08,
    });
  } else {
    for (let k = 2; k <= 6; k++) shape.harmonics.push([k, (.03 + hash(seed, k) * .085) / k ** .7, hash(k, seed) * TAU]);
    shape.harmonics.push([9, .016, hash(seed, 19) * TAU], [12, .01, hash(seed, 21) * TAU]);
  }
  if (berg.type === 'pinnacle') {
    const count = 1 + Math.floor(hash(seed, 31) * 3);
    for (let i = 0; i < count; i++) {
      const angle = hash(seed + i, 33) * TAU, distance = i ? .18 + hash(seed, 34 + i) * .2 : hash(seed, 35) * .12;
      shape.spires.push({ u: Math.cos(angle) * distance, v: Math.sin(angle) * distance,
        r: .42 + hash(seed + i, 37) * .22, h: i ? .55 + hash(seed, 38 + i) * .3 : 1 });
    }
  }
  let extent = 0;
  for (let i = 0; i < 360; i++) extent = Math.max(extent, outlineFactor(shape, i / 360 * TAU));
  shape.bound = berg.radius * extent * 1.03 * Math.max(1, shape.stretch) + shape.skirt + 1;
  icebergShapes.set(berg, shape);
  return shape;
}

/** Outline distance in metres along a local bearing, before the u stretch. */
export function icebergRadius(berg, phi) {
  return berg.radius * outlineFactor(icebergFrame(berg), phi);
}

function icebergTop(berg, shape, u, v, t) {
  const H = berg.height, nu = u / berg.radius, nv = v / berg.radius, seed = berg.seed;
  const facet = ridged(nu * 3.4 + seed, nv * 3.4 - seed) - .5;
  let height;
  if (berg.type === 'tabular') height = H * (.955 + .045 * (1 - t * t)) + H * .03 * (noise2(u / 60 + seed, v / 60 - seed) - .5);
  else if (berg.type === 'blocky') height = H * (.84 + .16 * clamp01(.5 + nu * .6)) + H * .05 * facet;
  else if (berg.type === 'dome') height = H * (.3 + .7 * (1 - Math.pow(t, 2.2))) + H * .08 * facet * t;
  else if (berg.type === 'wedge') height = H * (.2 + .8 * smoothRange(-.95, .9, nu)) + H * .05 * facet;
  else if (berg.type === 'drydock') {
    // Two weathered towers either side of an eroded slot that nearly reaches the sea.
    height = H * (.34 + .66 * (1 - t * t * t)) * (1 - .78 * Math.exp(-nv * nv / .034)) + H * .05 * facet;
  } else {
    // An uneven plinth below jagged spires; facets grow on the upper faces.
    const bearing = Math.atan2(nv, nu);
    height = H * (.1 + .12 * noise2(Math.cos(bearing) * 1.7 + seed, Math.sin(bearing) * 1.7 - seed) + .1 * (1 - t * t));
    for (const spire of shape.spires) {
      const d = Math.hypot(nu - spire.u, nv - spire.v) / spire.r;
      if (d < 1) height = Math.max(height, spire.h * H * Math.pow(1 - d, 1.1));
    }
    height += H * .14 * (ridged(nu * 5.1 - seed, nv * 5.1 + seed) - .5) * smoothRange(.18, .6, height / H);
  }
  // A rounded, wind-eroded lip; the cliff skirt continues from this height.
  const lip = smoothRange(.93, 1, t);
  return Math.max(1.2, height - lip * lip * Math.min(3.5, H * .07));
}

export function icebergHeight(berg, x, z) {
  const shape = icebergFrame(berg), dx = x - berg.x, dz = z - berg.z;
  if (Math.abs(dx) >= shape.bound || Math.abs(dz) >= shape.bound) return SEABED;
  const u = (dx * shape.cos + dz * shape.sin) / shape.stretch, v = -dx * shape.sin + dz * shape.cos;
  const distance = Math.hypot(u, v), phi = Math.atan2(v, u);
  const radius = berg.radius * outlineFactor(shape, phi);
  if (distance <= radius) return icebergTop(berg, shape, u, v, distance / radius);
  const beyond = (distance - radius) * Math.hypot(Math.cos(phi) * shape.stretch, Math.sin(phi));
  if (beyond >= shape.skirt) return SEABED;
  const edge = radius / distance, lip = icebergTop(berg, shape, u * edge, v * edge, 1);
  return lip - (lip - SEABED) * smoothRange(0, shape.skirt, beyond);
}

function indexIcebergs(icebergs = []) {
  icebergCells.clear();
  for (const berg of icebergs) {
    const bound = icebergFrame(berg).bound;
    for (let ix = Math.floor((berg.x - bound) / ICE_CELL); ix <= Math.floor((berg.x + bound) / ICE_CELL); ix++) {
      for (let iz = Math.floor((berg.z - bound) / ICE_CELL); iz <= Math.floor((berg.z + bound) / ICE_CELL); iz++) {
        const key = iceKey(ix, iz);
        if (!icebergCells.has(key)) icebergCells.set(key, []);
        icebergCells.get(key).push(berg);
      }
    }
  }
}
indexIcebergs(activeMap.icebergs);

/** Highest active-map iceberg surface at a point, or the seabed. */
export function icebergSurfaceHeight(x, z) {
  const bergs = icebergCells.size ? icebergCells.get(iceKey(Math.floor(x / ICE_CELL), Math.floor(z / ICE_CELL))) : null;
  let height = SEABED;
  if (bergs) for (const berg of bergs) height = Math.max(height, icebergHeight(berg, x, z));
  return height;
}

export function terrainGroundHeight(x, z) {
  let height = SEABED;
  for (const island of ISLANDS) {
    if (Math.abs(x - island.x) >= island.radius * SHORE_LIMIT || Math.abs(z - island.z) >= island.radius * SHORE_LIMIT) continue;
    height = Math.max(height, islandHeight(island, x, z));
  }
  return height;
}

export function terrainHeight(x, z) {
  let height = terrainGroundHeight(x, z);
  if (icebergCells.size) height = Math.max(height, icebergSurfaceHeight(x, z));
  if (structureCells.size === 0) return height;
  const structures = structureCells.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
  if (structures) for (const structure of structures) height = Math.max(height, structureHeight(structure, x, z));
  return height;
}
