// Metres in a right-handed world; aircraft fly towards -Z at heading zero.
// The central approach remains open water, while ridged coastal massifs sit on both flanks.
export const ISLANDS = [
  { x: -4800, z: -3700, radius: 2950, height: 1880, seed: 1.8 },
  { x: 5100, z: -7300, radius: 3100, height: 2090, seed: 4.1 },
  { x: -6900, z: 4800, radius: 2850, height: 1440, seed: 7.6 },
  { x: 6700, z: 3600, radius: 2200, height: 1290, seed: 3.4 },
  { x: 2800, z: -15500, radius: 4000, height: 2490, seed: 5.9 },
  { x: -9300, z: -17500, radius: 3800, height: 2420, seed: 8.6, distant: true },
  { x: 10400, z: -22400, radius: 4900, height: 2580, seed: 3.7, distant: true },
  { x: -2900, z: -26400, radius: 4400, height: 2780, seed: 6.4, distant: true },
  { x: -15100, z: -6700, radius: 3600, height: 2060, seed: 2.3, distant: true },
];
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
  const angle = island.seed * 1.73 + .35;
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

/** Height of one island, including its continuous -32 m seabed skirt.
 * Mesh generation can call this directly; terrainHeight remains the collision
 * source of truth and takes the maximum when island bounding areas overlap.
 */
export function islandHeight(island, x, z) {
  const dx = (x - island.x) / island.radius, dz = (z - island.z) / island.radius;
  // Do not evaluate noise for open ocean, projectiles, or distant islands.
  if (Math.abs(dx) >= SHORE_LIMIT || Math.abs(dz) >= SHORE_LIMIT || dx * dx + dz * dz >= SHORE_LIMIT * SHORE_LIMIT) return SEABED;
  const shape = shapeFor(island);
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

export function terrainHeight(x, z) {
  let height = SEABED;
  for (const island of ISLANDS) {
    if (Math.abs(x - island.x) >= island.radius * SHORE_LIMIT || Math.abs(z - island.z) >= island.radius * SHORE_LIMIT) continue;
    height = Math.max(height, islandHeight(island, x, z));
  }
  return height;
}
