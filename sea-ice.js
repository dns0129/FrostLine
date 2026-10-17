import { noise2 } from './world-math.js';

// Sea ice is thin, navigable surface ice drawn by the ocean shader. A small
// persistent field texture stores, per ~190 m texel, concentration (r), thin
// new ice such as nilas (g) and the share of large floes (b). Floe shapes are
// resolved per pixel, so detail costs no geometry, draw calls or collision.
export const SEA_ICE_SIZE = 256;

const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
function segmentDistance([ax, az], [bx, bz], x, z) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp01(((x - ax) * dx + (z - az) * dz) / Math.max(1e-6, dx * dx + dz * dz));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/** [concentration, thin ice, large-floe share] for a world point, each 0..1. */
export function seaIceField(seaIce, x, z) {
  if (!seaIce) return [0, 0, 0];
  const broad = noise2(x / 5200 + 3.1, z / 4700 - 1.7), middle = noise2(x / 1900 - 7.3, z / 2300 + 2.2);
  const fine = noise2(x / 760 + 1.1, z / 640 - 4.4);
  // Wind-driven bands and filaments of the marginal ice zone.
  const bands = 1 - Math.abs(noise2(x / 2600 + z / 5200 + 9.4, z / 1500 - 2.8) * 2 - 1);
  let concentration = (seaIce.background ?? .8) + ((broad * .55 + middle * .3 + fine * .15) - .5) * 2 * (seaIce.noise ?? .3) + (bands - .6) * .18;
  let thin = 0, small = 0;
  for (const lead of seaIce.leads ?? []) {
    const meander = (middle - .5) * lead.feather * .9 + (fine - .5) * lead.feather * .35;
    const open = smooth(lead.halfWidth, lead.halfWidth + lead.feather, segmentDistance(lead.from, lead.to, x, z) + meander);
    concentration = lead.floor + (concentration - lead.floor) * open;
    // Refreezing lead margins and broken floes along the open-water edge.
    thin = Math.max(thin, (1 - Math.abs(open * 2 - 1)) * .55 * smooth(.35, .7, fine));
    small = Math.max(small, 1 - open);
  }
  for (const patch of seaIce.patches ?? []) {
    const distance = Math.hypot(x - patch.x, z - patch.z) + (fine - .5) * patch.radius * .35;
    const weight = 1 - smooth(patch.radius * .5, patch.radius, distance);
    concentration += (patch.value - concentration) * weight;
    thin = Math.max(thin, (patch.thin ?? 0) * weight * (.6 + fine * .4));
    small += ((patch.small ?? small) - small) * weight;
  }
  concentration = clamp01(concentration);
  const large = clamp01(smooth(.42, .9, concentration) * (1 - small * .85));
  return [concentration, clamp01(thin * (1 - concentration * .6)), large];
}

/** Fill an RGBA8 field covering [-extent, extent] in x and z. */
export function fillSeaIceField(seaIce, data, size = SEA_ICE_SIZE) {
  const extent = seaIce?.extent ?? 24000;
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const x = ((column + .5) / size * 2 - 1) * extent, z = ((row + .5) / size * 2 - 1) * extent;
    const [concentration, thin, large] = seaIceField(seaIce, x, z), pixel = (row * size + column) * 4;
    data[pixel] = Math.round(concentration * 255);
    data[pixel + 1] = Math.round(thin * 255);
    data[pixel + 2] = Math.round(large * 255);
    data[pixel + 3] = 255;
  }
  return data;
}

// Shader functions. They require the ocean's waveNormalMap, sunDirection and
// the atmosphere helpers to be declared before this chunk.
export const seaIceGLSL = /* glsl */`
  uniform sampler2D seaIceMap;
  uniform float seaIceStrength;
  uniform float seaIceExtent;
  const float GIANT_SIZE = 470.;
  const float FLOE_SIZE = 86.;
  const float BRASH_SIZE = 17.;
  vec2 floeHash(vec2 c) {
    vec3 q = fract(vec3(c.xyx) * vec3(.1031, .103, .0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }
  vec3 seaIceAt(vec2 p) { return texture2D(seaIceMap, p / (2. * seaIceExtent) + .5).rgb; }
  // Two nearest jittered sites around q (in cell units), relative to q.
  void floeSites(vec2 q, out vec2 r1, out vec2 r2, out vec2 id1, out vec2 id2) {
    vec2 cell = floor(q), f = fract(q);
    float d1 = 9., d2 = 9.;
    r1 = vec2(0.); r2 = vec2(0.); id1 = cell; id2 = cell;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + .08 + floeHash(cell + o) * .84 - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; r2 = r1; id2 = id1; d1 = d; r1 = r; id1 = cell + o; }
      else if (d < d2) { d2 = d; r2 = r; id2 = cell + o; }
    }
  }
  struct SeaIce { float cover; vec3 albedo; vec2 slope; float halo; float shadow; float thin; };
  SeaIce seaIceSurface(vec2 p, float footprint, float detail, vec3 field) {
    SeaIce ice;
    ice.cover = 0.; ice.albedo = vec3(.86, .9, .93); ice.slope = vec2(0.); ice.halo = 0.; ice.shadow = 0.; ice.thin = 0.;
    float concentration = field.r * seaIceStrength;
    if (concentration < .003 && field.g < .01) return ice;
    // Nilas: thin dark new ice that dulls the water and its reflections.
    float nilas = field.g * smoothstep(.25, .75, texture2D(waveNormalMap, p * .0047 + .61).b + .2);
    // Far away the per-floe pattern converges to its expected coverage; those
    // pixels (much of the view near the horizon) skip every cell search.
    float resolve = 1. - smoothstep(FLOE_SIZE * .07, FLOE_SIZE * .3, footprint);
    float expected = concentration * mix(.8, .97, concentration);
    float brashChance = concentration * mix(.82, .22, field.b) + field.g * .15;
    if (resolve <= 0.) {
      ice.cover = expected + brashChance * .3 * (1. - expected) * detail;
      ice.albedo = vec3(.84, .88, .91);
      ice.thin = nilas * (1. - ice.cover);
      return ice;
    }
    vec2 sunFlat = normalize(sunDirection.xz + vec2(.00001));
    float aa = max(footprint * .75, .2);
    // Floe edges are warped so cells read as broken floes, not polygons.
    vec2 warp = (texture2D(waveNormalMap, p * .0019).rg - .5) * 42. + (texture2D(waveNormalMap, p * .0089 + .37).rg - .5) * 10.;
    vec2 r1, r2, id1, id2;
    floeSites((p + warp) / FLOE_SIZE, r1, r2, id1, id2);
    vec2 outward = normalize(r2 - r1);
    float edge = dot(.5 * (r1 + r2), outward) * FLOE_SIZE;
    float c1 = seaIceAt((id1 + .5) * FLOE_SIZE).r * seaIceStrength;
    float c2 = seaIceAt((id2 + .5) * FLOE_SIZE).r * seaIceStrength;
    vec2 h1 = floeHash(id1 + 17.3), h2 = floeHash(id2 + 17.3);
    float gap1 = mix(6.5, 1.4, c1), gap2 = mix(6.5, 1.4, c2);
    // A cell narrower than its own margin holds no floe (and casts no halo).
    float span = length(r2 - r1) * .5 * FLOE_SIZE;
    float ice1 = step(h1.x, c1) * step(gap1 + 1.5, span), ice2 = step(h2.x, c2) * step(gap2 + 1.5, span);
    // Neighbouring cells fuse into larger floes. Of the joints that remain,
    // most are refrozen grey seams and only some stay open water.
    vec2 pair = floeHash(id1 + id2 + abs(id1 - id2) * 7.13);
    float joint = step(pair.x, mix(.72, .2, min(c1, c2)));
    float openCrack = joint * step(pair.y, .4) * mix(3.2, 1.1, min(c1, c2));
    float seam = joint * (1. - step(pair.y, .4)) * (1. - smoothstep(.6 - aa, 1.1 + aa, edge)) * ice1 * ice2;
    // Distance from the boundary at which this floe begins; fused joints have none.
    float start = ice2 > .5 ? (openCrack > 0. ? openCrack * .5 : -12.) : gap1;
    float giantLead = 0., nearGiant = 0., tone = h1.y;
    if (detail > .5 && footprint < 30.) {
      // A coarser network of leads splits the pack into kilometre-scale floes.
      vec2 g1, g2, k1, k2;
      floeSites((p + warp * 2.6) / GIANT_SIZE, g1, g2, k1, k2);
      vec2 giantOut = normalize(g2 - g1);
      float giantEdge = dot(.5 * (g1 + g2), giantOut) * GIANT_SIZE;
      vec2 giantPair = floeHash(k1 + k2 + abs(k1 - k2) * 3.1);
      tone = mix(floeHash(k1 + 5.9).y, h1.y, .25);
      float leadWidth = mix(34., 2.5, concentration) * (.35 + giantPair.y * 1.3) * step(giantPair.x, .78);
      if (ice1 > .5 && leadWidth > 0. && giantEdge - leadWidth * .5 < edge - start) {
        nearGiant = 1.; outward = giantOut; start = 0.; edge = giantEdge - leadWidth * .5;
      }
    }
    float cover = ice1 * smoothstep(start - aa, start + aa, edge);
    float exposed = max(max(1. - ice2, step(.01, openCrack)), nearGiant);
    // Raised, rounded floe edges only where the floe actually meets water.
    vec2 slope = outward * ice1 * exposed * (1. - smoothstep(0., 3.2, edge - start)) * .55;
    float toIce = ice1 > .5 ? max(0., start - edge) : (ice2 > .5 ? edge + gap2 : 1e4);
    vec2 iceSide = ice1 > .5 ? -outward : outward;
    vec2 floeSeed = vec2(ice1 > .5 ? h1.x : h2.x, tone);
    cover = mix(expected, cover, resolve);
    float haloWeight = resolve;
    if (detail > .5 && footprint >= 6.) cover += brashChance * .3 * (1. - cover);
    else if (detail > .5) {
      // Brash and small floes drift in the leads between large floes.
      vec2 s1, s2, b1, b2;
      floeSites((p + warp * .35) / BRASH_SIZE, s1, s2, b1, b2);
      vec2 brashOut = normalize(s2 - s1);
      float brashEdge = dot(.5 * (s1 + s2), brashOut) * BRASH_SIZE;
      vec2 brashSeed = floeHash(b1 + 41.7);
      float brashGap = mix(3.6, 1.2, brashChance);
      float present = step(brashSeed.x, brashChance) * step(brashGap + .6, length(s2 - s1) * .5 * BRASH_SIZE);
      float brashResolve = 1. - smoothstep(1.4, 6., footprint);
      float exact = present * smoothstep(brashGap - aa, brashGap + aa, brashEdge);
      float brash = mix(brashChance * .3, exact, brashResolve) * (1. - cover);
      if (present * brashResolve > .5) toIce = min(toIce, max(0., brashGap - brashEdge));
      haloWeight *= mix(1., brashResolve, step(.5, present));
      slope += brashOut * exact * brashResolve * (1. - smoothstep(0., 1.4, brashEdge - brashGap)) * .5;
      floeSeed = mix(floeSeed, brashSeed, exact * brashResolve * (1. - cover));
      cover += brash;
    }
    ice.cover = cover;
    ice.slope = slope * resolve;
    // Older floes carry whiter snow; young floes stay greyer.
    vec3 albedo = mix(vec3(.74, .81, .86), vec3(.9, .93, .95), floeSeed.y);
    albedo = mix(albedo, vec3(.5, .58, .63), smoothstep(.45, .1, concentration) * .55);
    float snow = texture2D(waveNormalMap, p * .021 + floeSeed * 3.).b;
    albedo *= .95 + snow * .08;
    if (detail > .5) {
      // Pressure ridges: bright crests with a shadowed lee side.
      mat2 turn = mat2(cos(floeSeed.x * 6.28), -sin(floeSeed.x * 6.28), sin(floeSeed.x * 6.28), cos(floeSeed.x * 6.28));
      vec2 rp = turn * p * vec2(.0061, .0021);
      float ridge = pow(1. - abs(texture2D(waveNormalMap, rp).b * 2. - 1.), 16.);
      float lee = pow(1. - abs(texture2D(waveNormalMap, rp + turn * sunFlat * vec2(.0061, .0021) * 3.).b * 2. - 1.), 16.);
      float ridgeResolve = (1. - smoothstep(1.5, 7., footprint)) * step(.35, floeSeed.x);
      albedo *= 1. + (ridge - lee * .7) * .1 * ridgeResolve;
      ice.slope += (turn * vec2(0., 1.)) * (ridge - lee) * .12 * ridgeResolve;
    }
    albedo = mix(albedo, vec3(.42, .5, .55), seam * .75 * resolve);
    ice.albedo = mix(vec3(.84, .88, .91), albedo, resolve);
    // Turquoise submerged ice beside floes, and a thin shadow on their lee.
    ice.halo = (1. - smoothstep(0., 3.5, toIce)) * (1. - ice.cover) * haloWeight;
    ice.shadow = (1. - smoothstep(0., 2.2, toIce)) * step(0., dot(iceSide, sunFlat)) * (1. - ice.cover) * haloWeight;
    ice.thin = nilas * (1. - ice.cover);
    return ice;
  }
`;
