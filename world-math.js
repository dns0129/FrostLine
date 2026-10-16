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

/** Height of one island, including its continuous -32 m seabed skirt.
 * Mesh generation can call this directly; terrainHeight remains the collision
 * source of truth and takes the maximum when island bounding areas overlap.
 */
export function islandHeight(island, x, z) {
  const dx = (x - island.x) / island.radius, dz = (z - island.z) / island.radius;
  // Do not evaluate noise for open ocean, projectiles, or distant islands.
  if (Math.abs(dx) >= SHORE_LIMIT || Math.abs(dz) >= SHORE_LIMIT || dx * dx + dz * dz >= SHORE_LIMIT * SHORE_LIMIT) return SEABED;
  const shape = shapeFor(island);
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
  if (structureCells.size === 0) return height;
  const structures = structureCells.get(`${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`);
  if (structures) for (const structure of structures) height = Math.max(height, structureHeight(structure, x, z));
  return height;
}
