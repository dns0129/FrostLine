// All distances are metres. Map changes replace geography and lighting only;
// aircraft, the 110 m player destroyer and the fleet keep their physical scale.
export const DEFAULT_MAP_ID = 'north-atlantic';

const northIslands = [
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

const city = { originX: -4300, originZ: -2800, blockWidth: 96, blockDepth: 100, columns: 9, rows: 10 };
const cityStructures = [];
for (let row = 0; row < city.rows; row++) for (let column = 0; column < city.columns; column++) {
  const index = row * city.columns + column;
  const downtown = column >= 5 && row >= 2 && row <= 7;
  cityStructures.push({
    id: `bay-block-${index}`, kind: 'building',
    x: city.originX + column * city.blockWidth, z: city.originZ + row * city.blockDepth,
    y: 32, width: 28 + index * 13 % 33, depth: 30 + index * 17 % 33,
    height: downtown ? 78 + index * 23 % 101 : 22 + index * 19 % 57,
    rotation: 0, color: ['#a4b1b7', '#b7bdba', '#81969e', '#c8c4b8', '#99aaa9'][index % 5],
  });
}
for (let index = 0; index < 8; index++) cityStructures.push({
  id: `bay-warehouse-${index}`, kind: 'warehouse', x: -4520 + index % 4 * 175, z: -1490 + Math.floor(index / 4) * 150,
  y: 32, width: 104, depth: 78, height: 14 + index % 3 * 3, rotation: 0,
  color: index % 2 ? '#a2aba6' : '#879d9b',
});
// Solid seawalls extend from the seabed. Their western ends merge into the
// descending shore; no decorative surface floats above an uncollidable ocean.
for (let index = 0; index < 4; index++) cityStructures.push({
  id: `bay-quay-${index}`, kind: 'quay', x: -2500, z: -2840 + index * 330,
  y: -32, width: 220, depth: 190, height: 37, rotation: 0, color: '#87928c',
});

const palette = {
  rock: '#a6a59c', cliff: '#919b99', talus: '#aaa696', mineral: '#c6c9bd', wetRock: '#536568',
  snow: '#c3cbc8', shore: '#c5d5cf', deepWater: '#102e3b', shallowWater: '#3d676d',
};
const theme = {
  skyZenith: '#355981', skyHorizon: '#afc2ca', skyBelowHorizon: '#8299a2', sunTint: '#ffe9c2',
  waterDeep: '#102e3b', waterShallow: '#3d676d', cloudTint: '#d7e2e5', cloudCoverage: .35,
  haze: 1, panoramaMix: 1, fogColor: '#97abb7', fogDensity: .000026,
  sunColor: '#fff0db', sunIntensity: 2.5, exposure: .91, snowLine: 1020, snowStrength: .62,
};

// Glacial Sea. Dark basalt massifs hold two tidewater glaciers; tabular and
// weathered icebergs, calved debris and drifting pack ice fill both flanks of
// the open lead that keeps the mission approach and fleet routes navigable.
const glacialIslands = [
  { x: -7000, z: -4700, radius: 3300, height: 1720, seed: 51.3 },
  { x: -7400, z: 3400, radius: 3000, height: 1260, seed: 52.9 },
  { x: 7300, z: -5100, radius: 3400, height: 1940, seed: 53.6 },
  { x: 7100, z: 3100, radius: 2700, height: 880, seed: 54.2 },
  // Glacier rotation points downstream; front/width are fractions of radius.
  { x: -7000, z: -700, radius: 3200, height: 640, plateauHeight: 60, seed: 55.7, shape: 'glacier', rotation: 0, front: .8, width: .42, widen: .5 },
  { x: 7300, z: -1200, radius: 3000, height: 560, plateauHeight: 54, seed: 56.4, shape: 'glacier', rotation: Math.PI, front: .8, width: .42, widen: .45 },
  // Ice-capped ranges: the glacier heads rise into the two outer massifs.
  { x: -11600, z: -700, radius: 3300, height: 1950, seed: 57.9, distant: true },
  { x: 11700, z: -1300, radius: 3100, height: 1760, seed: 58.3, distant: true },
  { x: -8600, z: -19200, radius: 4800, height: 2650, seed: 57.1, distant: true },
  { x: 2600, z: -22800, radius: 5000, height: 3020, seed: 58.8, distant: true },
  { x: 12800, z: -17200, radius: 4500, height: 2380, seed: 59.3, distant: true },
  { x: -17200, z: -8800, radius: 4300, height: 2200, seed: 60.6, distant: true },
];
// Radius is the footprint in metres and height the freeboard above the sea.
// Calved tabular bergs keep 35–50 m cliffs; weathered bergs vary widely.
const glacialLandmarks = [
  ['ice-island', 'tabular', 600, -13400, 1080, 47, 1.75, .1],
  ['tabular-west', 'tabular', -3700, -9300, 640, 44, 1.45, .55],
  ['tabular-east', 'tabular', 4300, -10200, 600, 41, 1.3, -.4],
  ['tabular-south', 'tabular', -900, 11400, 700, 39, 1.4, .25],
  ['tabular-southeast', 'tabular', 4100, 7700, 540, 37, 1.25, 1.1],
  ['tabular-southwest', 'tabular', -5300, 10100, 760, 43, 1.35, -.7],
  ['block-west', 'blocky', -3800, 2900, 380, 34, 1.2, .3],
  ['pinnacle-cape', 'pinnacle', -3000, -6400, 110, 86, 1.15, .7],
  ['dome-west', 'dome', -3400, -3900, 160, 48, 1.2, 1.9],
  ['drydock-front', 'drydock', -3100, -1000, 140, 64, 1.25, .2],
  ['wedge-west', 'wedge', -3500, 700, 170, 56, 1.3, 2.6],
  ['pinnacle-west', 'pinnacle', -2900, 5200, 95, 74, 1.1, .4],
  ['block-southwest', 'blocky', -3300, 7300, 150, 31, 1.3, 1.2],
  ['dome-east', 'dome', 2900, -7700, 135, 52, 1.15, .9],
  ['pinnacle-sentinel', 'pinnacle', 3300, -4700, 125, 98, 1.1, .4],
  ['block-east', 'blocky', 2800, -2700, 115, 33, 1.25, 2.2],
  ['drydock-east', 'drydock', 3600, -600, 150, 68, 1.2, 1.4],
  ['wedge-east', 'wedge', 2900, 2100, 125, 45, 1.3, 3.8],
  ['dome-southeast', 'dome', 3400, 4700, 175, 42, 1.2, .5],
  ['dome-gap', 'dome', 5600, 1400, 150, 40, 1.15, 2.4],
  ['pinnacle-north', 'pinnacle', -2700, -12100, 150, 112, 1.1, 1.1],
  ['wedge-north', 'wedge', 3800, -12900, 190, 58, 1.35, .3],
  ['dome-north', 'dome', -5400, -11800, 165, 50, 1.2, 2.9],
  ['drydock-north', 'drydock', -1200, -16200, 170, 70, 1.2, .8],
  ['pinnacle-south', 'pinnacle', 1700, 9600, 120, 82, 1.1, 2.1],
  ['dome-south', 'dome', 3300, 10900, 150, 46, 1.2, 1.6],
  ['wedge-south', 'wedge', -3600, 8900, 130, 52, 1.3, .9],
  ['block-far-southeast', 'blocky', 6000, 9800, 200, 35, 1.3, .6],
].map(([id, type, x, z, radius, height, stretch, rotation], index) => ({ id, type, x, z, radius, height, stretch, rotation, seed: 61.3 + index * 1.37 }));

// Conservative footprint bound used only for catalog placement; world-math
// computes the exact outline. Organic bergs reach about 1.3 radii.
const bergBound = berg => berg.radius * (berg.type === 'tabular' || berg.type === 'blocky' ? 1.05 : 1.34) * berg.stretch + 9;
function glacierLocal(island, x, z) {
  const c = Math.cos(island.rotation), s = Math.sin(island.rotation);
  const dx = (x - island.x) / island.radius, dz = (z - island.z) / island.radius;
  return [dx * c + dz * s, -dx * s + dz * c];
}
function bergIsClear(berg, bergs) {
  const bound = bergBound(berg);
  // The approach lead remains deep water for the full mission corridor.
  if (berg.z + bound > -11050 && berg.z - bound < 8750 && Math.abs(berg.x) - bound < 2260) return false;
  if (Math.hypot(berg.x, berg.z) + bound > 17500) return false;
  for (const island of glacialIslands) {
    if (island.distant && Math.hypot(berg.x - island.x, berg.z - island.z) < island.radius * 1.03 + bound) return false;
    if (island.distant) continue;
    if (island.shape === 'glacier') {
      const [u, v] = glacierLocal(island, berg.x, berg.z), b = bound / island.radius;
      if (u - b < island.front + .09 && Math.abs(v) - b < island.width * (1 + island.widen) * 1.2 && u + b > -1.05) return false;
    } else if (Math.hypot(berg.x - island.x, berg.z - island.z) < island.radius * 1.03 + bound) return false;
  }
  return bergs.every(other => Math.hypot(berg.x - other.x, berg.z - other.z) > bound + bergBound(other) + 14);
}
function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 0x6D2B79F5 >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Calved debris: bergy bits and growlers gather at the glacier fronts and
// around large bergs. A fixed seed keeps the same catalog for every player.
function glacialIcebergs() {
  const bergs = glacialLandmarks.filter(berg => bergIsClear(berg, []));
  const random = mulberry(20261017);
  const fronts = glacialIslands.filter(island => island.shape === 'glacier');
  const parents = [...bergs];
  for (let attempt = 0, made = 0; attempt < 5000 && made < 112; attempt++) {
    const pick = random();
    let x, z;
    if (pick < .34) {
      const glacier = fronts[Math.floor(random() * fronts.length)];
      const along = glacier.front + .07 + random() * .5, across = (random() * 2 - 1) * glacier.width * 1.3;
      const c = Math.cos(glacier.rotation), s = Math.sin(glacier.rotation);
      x = glacier.x + (along * c - across * s) * glacier.radius; z = glacier.z + (along * s + across * c) * glacier.radius;
    } else if (pick < .8) {
      const parent = parents[Math.floor(random() * parents.length)], angle = random() * Math.PI * 2;
      const distance = bergBound(parent) * 1.15 + 40 + random() * 650;
      x = parent.x + Math.cos(angle) * distance; z = parent.z + Math.sin(angle) * distance;
    } else {
      const side = random() < .5 ? -1 : 1;
      x = side * (2500 + random() * 8500); z = -12500 + random() * 25000;
    }
    const size = random(), types = size < .35 ? ['dome', 'dome', 'wedge', 'blocky'] : ['dome', 'blocky', 'pinnacle', 'wedge', 'drydock', 'pinnacle'];
    const radius = Math.round(8 + size * size * 46), type = types[Math.floor(random() * types.length)];
    const berg = {
      id: `bergy-bit-${made}`, type, x: Math.round(x), z: Math.round(z), radius,
      height: Math.round(Math.min(18, Math.max(2.6, radius * (.16 + random() * .3) * (type === 'pinnacle' ? 1.6 : 1))) * 10) / 10,
      stretch: Math.round((1 + random() * .55) * 100) / 100, rotation: Math.round(random() * 628) / 100, seed: 120 + made * 1.91,
    };
    if (!bergIsClear(berg, bergs)) continue;
    bergs.push(berg); made++;
  }
  return bergs;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

export const MAPS = freeze([
  {
    id: DEFAULT_MAP_ID, name: '北大西洋', englishName: 'NORTH ATLANTIC', subtitle: '峡湾 · 山脊 · 开阔航道',
    description: '保留原有北境航线与舰队尺度，升级岩壁、碎石滩和远山层次。', biome: 'north-atlantic',
    islands: northIslands, structures: [], features: [], palette, theme,
  },
  {
    id: 'ice-ocean', name: '极地冰原', englishName: 'POLAR FRONT', subtitle: '浮冰边缘 · 冰架 · 冰海作战',
    description: '穿过冰架与冰山之间的深水航道，低矮海冰衬托远处陡峭的冰川山脊。', biome: 'arctic',
    islands: [
      { x: -6000, z: -3300, radius: 3500, height: 180, plateauHeight: 64, seed: 12.2, shape: 'ice-shelf', rotation: .18, scaleX: .88, scaleZ: 1 },
      { x: 6100, z: -6200, radius: 3500, height: 205, plateauHeight: 82, seed: 13.7, shape: 'ice-shelf', rotation: -.25, scaleX: .88, scaleZ: 1 },
      { x: -4900, z: 5700, radius: 2000, height: 112, plateauHeight: 35, seed: 14.4, shape: 'ice-shelf', rotation: -.4, scaleX: 1, scaleZ: .82 },
      { x: 5500, z: 4400, radius: 2250, height: 144, plateauHeight: 48, seed: 15.8, shape: 'ice-shelf', rotation: .45, scaleX: .88, scaleZ: 1 },
      { x: -3400, z: 1300, radius: 560, height: 94, plateauHeight: 21, seed: 16.9, shape: 'ice-shelf', rotation: .3, scaleX: .86, scaleZ: 1 },
      { x: 3450, z: -700, radius: 610, height: 112, plateauHeight: 28, seed: 17.3, shape: 'ice-shelf', rotation: -.4, scaleX: 1, scaleZ: .78 },
      { x: -4200, z: -11100, radius: 1150, height: 174, plateauHeight: 48, seed: 18.6, shape: 'ice-shelf', rotation: .4, scaleX: .8, scaleZ: 1 },
      { x: -6900, z: -17500, radius: 4500, height: 2260, seed: 19.2, distant: true },
      { x: 6200, z: -19500, radius: 4600, height: 2450, seed: 20.7, distant: true },
    ],
    structures: [], features: [{ kind: 'ice-field', x: -6000, z: -3300, radius: 3500 }],
    palette: { ...palette, rock: '#b5d2d9', cliff: '#8cbbc8', talus: '#c2dce0', mineral: '#e1eff0', wetRock: '#5b91a2', snow: '#edf4f2', shore: '#cde8e8', deepWater: '#082c3b', shallowWater: '#397280' },
    theme: { ...theme, skyZenith: '#426889', skyHorizon: '#c2d8df', skyBelowHorizon: '#8cacb9', sunTint: '#e3eff0', waterDeep: '#06232e', waterShallow: '#225964', cloudTint: '#e6eff2', cloudCoverage: .48, haze: .76, panoramaMix: .30, fogColor: '#b1cbd4', fogDensity: .000023, sunColor: '#e3efff', sunIntensity: 2.35, exposure: .94, snowLine: -55, snowStrength: .94 },
  },
  {
    id: 'city-bay', name: '城市海湾', englishName: 'HARBOR REACH', subtitle: '滨海天际线 · 港区 · 海湾航道',
    description: '沿城市海岸与外湾山体作战，真实尺度的城区、港区和防波岸构成清晰的近岸参照。', biome: 'bay',
    islands: [
      { x: -5000, z: -2300, radius: 3000, height: 32, plateauHeight: 32, seed: 24.2, shape: 'plateau', rotation: 0, scaleX: 1, scaleZ: 1 },
      { x: 6000, z: -7000, radius: 3450, height: 1520, seed: 25.6 },
      { x: -6300, z: 5400, radius: 2700, height: 690, seed: 26.3 },
      { x: 6400, z: 4300, radius: 2400, height: 780, seed: 27.7 },
      { x: -7100, z: -13100, radius: 3400, height: 1360, seed: 28.4, distant: true },
      { x: 1600, z: -17800, radius: 4300, height: 1940, seed: 29.8, distant: true },
      { x: 11400, z: -17100, radius: 3900, height: 1680, seed: 30.1, distant: true },
    ],
    city, structures: cityStructures,
    features: [{ kind: 'harbor', x: -2500, z: -2345, radius: 850 }, { kind: 'city', x: -3916, z: -2350, radius: 850 }],
    palette: { ...palette, rock: '#8e9d91', cliff: '#84948d', talus: '#a9b29b', mineral: '#bdc5b1', wetRock: '#455f61', snow: '#c4d1ca', shore: '#cbdacf', deepWater: '#0a3540', shallowWater: '#367d7f' },
    theme: { ...theme, skyZenith: '#3f7194', skyHorizon: '#c3d0cc', skyBelowHorizon: '#869fa6', sunTint: '#ffebcb', waterDeep: '#0b3543', waterShallow: '#367d83', cloudCoverage: .26, haze: .95, panoramaMix: .68, fogColor: '#acbec0', fogDensity: .000025, sunColor: '#fff2d6', sunIntensity: 2.65, exposure: .93, snowLine: 2200, snowStrength: .22 },
  },
  {
    id: 'nile-red-sea', name: '尼罗河与红海', englishName: 'NILE · RED SEA', subtitle: '分汊河口 · 绿洲 · 红海山岸',
    description: '西岸的低平尼罗河三角洲被真实河道分开，东岸的红海山脉陡升；中央航道连通河口与外海。', biome: 'desert',
    islands: [
      { x: -6900, z: -4100, radius: 4350, height: 32, plateauHeight: 24, seed: 34.2, shape: 'delta', rotation: 0, scaleX: .94, scaleZ: 1,
        // Coordinates are fractions of this landmass radius; width is HALF
        // the channel width in metres. Every branch reaches the open sea.
        channels: [
          { points: [[-.12, .99], [-.08, .48], [.04, .10], [.08, -.43], [.02, -.99]], width: 180, bank: 115, depth: 26 },
          { points: [[.04, .10], [.34, -.12], [.51, -.42], [.91, -.69]], width: 150, bank: 95, depth: 22 },
          { points: [[-.08, .48], [-.36, .15], [-.54, -.17], [-.91, -.42]], width: 135, bank: 100, depth: 20 },
        ] },
      { x: -6100, z: 5600, radius: 2900, height: 210, seed: 35.8 },
      { x: 6750, z: -5500, radius: 3900, height: 1860, seed: 36.3 },
      { x: 6600, z: 4700, radius: 2800, height: 1240, seed: 37.6 },
      { x: -7700, z: -15300, radius: 4100, height: 560, seed: 38.1, distant: true },
      { x: 5800, z: -17000, radius: 4550, height: 2380, seed: 39.5, distant: true },
      { x: -1800, z: -24800, radius: 4700, height: 1170, seed: 40.7, distant: true },
    ],
    structures: [], features: [{ kind: 'delta', x: -6900, z: -4100, radius: 4350 }, { kind: 'mountain-coast', x: 6750, z: -5500, radius: 3900 }],
    palette: { ...palette, rock: '#c09d71', cliff: '#a77c57', talus: '#d3b487', mineral: '#e4c79c', wetRock: '#69756b', snow: '#ded4bc', shore: '#d6d1b2', deepWater: '#063f49', shallowWater: '#3c9290' },
    theme: { ...theme, skyZenith: '#427f9e', skyHorizon: '#d9ceaf', skyBelowHorizon: '#a3b1a9', sunTint: '#ffe6b9', waterDeep: '#073e4a', waterShallow: '#32928e', cloudTint: '#ede4d1', cloudCoverage: .12, haze: 1.17, panoramaMix: .24, fogColor: '#c8c6ae', fogDensity: .000022, sunColor: '#ffe6bd', sunIntensity: 2.85, exposure: .94, snowLine: 4000, snowStrength: 0 },
  },
  {
    id: 'glacial-sea', name: '冰原海域', englishName: 'GLACIAL SEA', subtitle: '入海冰川 · 冰山群 · 浮冰航道',
    description: '两条入海冰川从玄武岩雪山间崩解入海；平顶冰山、尖顶冰山与浮冰群夹着一条开阔水道，冰山均为实体障碍。', biome: 'glacial',
    islands: glacialIslands, structures: [], icebergs: glacialIcebergs(),
    features: [
      { kind: 'tidewater-glacier', x: -4300, z: -700, radius: 1400 }, { kind: 'tidewater-glacier', x: 4760, z: -1200, radius: 1200 },
      { kind: 'ice-island', x: 600, z: -13400, radius: 1900 },
    ],
    // Sea ice is thin, navigable surface ice drawn by the ocean shader. Its
    // concentration field never adds collision; solid ice is the icebergs.
    seaIce: {
      extent: 24000, background: .8, noise: .34,
      leads: [{ from: [0, 13000], to: [0, -12000], halfWidth: 1500, feather: 1500, floor: .08 }],
      patches: [
        { x: -3300, z: -700, radius: 1900, value: .94, small: 1 },
        { x: 3900, z: -1200, radius: 1700, value: .9, small: 1 },
        { x: -1500, z: -5200, radius: 900, value: 0, thin: .85 },
        { x: 1300, z: 6400, radius: 1200, value: 0, thin: .7 },
        { x: 600, z: -13400, radius: 3600, value: .92, small: .3 },
      ],
    },
    palette: { ...palette, rock: '#5b5f63', cliff: '#40454a', talus: '#73766f', mineral: '#8a8981', wetRock: '#2b3236', snow: '#eef4f6', shore: '#d4e8ee', deepWater: '#05202b', shallowWater: '#1c5868' },
    theme: { ...theme, skyZenith: '#2f5f8e', skyHorizon: '#d4dfe4', skyBelowHorizon: '#7f9fae', sunTint: '#ffe2c2', waterDeep: '#041c26', waterShallow: '#15495a', coastShallow: '#2c9eb2', waterFoam: '#e6f3f6', cloudTint: '#eef2f5', cloudCoverage: .3, haze: .64, panoramaMix: .4, fogColor: '#b9ccd6', fogDensity: .0000175, sunColor: '#ffe7cc', sunIntensity: 2.7, exposure: .93, snowLine: 420, snowStrength: .45 },
  },
]);

export function getMap(id = DEFAULT_MAP_ID) {
  return MAPS.find(map => map.id === id) || MAPS[0];
}
