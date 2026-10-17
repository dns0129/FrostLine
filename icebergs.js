import * as THREE from './vendor/three.module.js';
import { SUN_DIRECTION } from './atmosphere.js';
import { glacierFrame, icebergFrame, icebergHeight, icebergRadius, islandHeight, noise2 } from './world-math.js';

const SEABED = -32;
const TAU = Math.PI * 2;
const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
const unit = (a, b) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };

// Tiers only change how finely the same metre-based surfaces are sampled.
// Top rings are listed for slabs, rounded bergs and pinnacles respectively;
// skirt fractions place cliff rows between the lip and the waterline.
const DENSITY = {
  low: { edge: 34, minSegments: 8, maxSegments: 48, topRings: [2, 3, 4], skirt: [.12, .3, .48, .75], glacierRows: 36, glacierColumns: 44 },
  high: { edge: 21, minSegments: 12, maxSegments: 96, topRings: [3, 6, 8], skirt: [.06, .16, .28, .4, .52, .64, .75], glacierRows: 56, glacierColumns: 90 },
  ultra: { edge: 13, minSegments: 16, maxSegments: 128, topRings: [4, 8, 11], skirt: [.04, .1, .18, .27, .36, .45, .54, .64, .75], glacierRows: 80, glacierColumns: 124 },
};
export function iceDensity(quality) { return DENSITY[quality] ?? DENSITY.high; }

// Each surface patch (berg top, cliff band, glacier sheet) owns its vertices so
// the lip between a snow-covered top and its cliff stays a crisp edge.
class IceBuffer {
  constructor() { Object.assign(this, { position: [], normal: [], color: [], surface: [], flow: [], index: [] }); }
  get vertexCount() { return this.position.length / 3; }
  // rows: arrays of vertices { p:[x,y,z], c:[r,g,b], s:[4], f:[2] }. A
  // single-vertex first row forms a fan. closed joins the last column.
  patch(rows, closed, facing) {
    const base = this.vertexCount, offsets = [], faces = [];
    for (const row of rows) {
      offsets.push(this.vertexCount);
      for (const vertex of row) {
        this.position.push(...vertex.p); this.normal.push(0, 0, 0);
        this.color.push(...vertex.c); this.surface.push(...vertex.s); this.flow.push(...(vertex.f ?? [0, 0, 0, 0]));
      }
    }
    for (let r = 1; r < rows.length; r++) {
      const previous = rows[r - 1].length, count = rows[r].length, span = closed ? count : count - 1;
      for (let i = 0; i < span; i++) {
        const j = (i + 1) % count;
        if (previous === 1) faces.push([offsets[r - 1], offsets[r] + i, offsets[r] + j]);
        else {
          const a = offsets[r - 1] + i, b = offsets[r - 1] + j, c = offsets[r] + i, d = offsets[r] + j;
          faces.push([a, c, b], [b, c, d]);
        }
      }
    }
    const p = this.position, n = this.normal, e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), cross = new THREE.Vector3();
    let flip = 0;
    for (const [a, b, c] of faces) {
      e1.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
      e2.set(p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]);
      cross.crossVectors(e1, e2);
      flip += facing(cross, a);
    }
    for (const face of faces) {
      if (flip < 0) [face[1], face[2]] = [face[2], face[1]];
      const [a, b, c] = face;
      e1.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
      e2.set(p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]);
      cross.crossVectors(e1, e2);
      for (const v of face) { n[v * 3] += cross.x; n[v * 3 + 1] += cross.y; n[v * 3 + 2] += cross.z; }
      this.index.push(a, b, c);
    }
    for (let v = base; v < this.vertexCount; v++) {
      const length = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
      if (length > 1e-12) { n[v * 3] /= length; n[v * 3 + 1] /= length; n[v * 3 + 2] /= length; }
      else { n[v * 3] = 0; n[v * 3 + 1] = 1; n[v * 3 + 2] = 0; }
    }
  }
  geometry(name) {
    const geometry = new THREE.BufferGeometry();
    geometry.name = name;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    geometry.setAttribute('iceSurface', new THREE.Float32BufferAttribute(this.surface, 4));
    geometry.setAttribute('iceFlow', new THREE.Float32BufferAttribute(this.flow, 4));
    geometry.setIndex(this.index);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

// iceSurface x: cliff ice (1) or snow top (0), y: height above the sea relative
// to the body, z: crevasse strength, w: per-body variation seed.
// iceFlow (glaciers only) xy: downstream direction, z: across-flow position
// in half-widths, w: distance from the front towards the head (0..1).
function bergColours(berg) {
  const age = unit(berg.seed, 4.2), clear = berg.radius < 22 && unit(berg.seed, 8.9) > .45;
  const snow = clear ? [.70, .86, .93] : [.95 - age * .06, .97 - age * .03, .98];
  return { snow, topWall: clear ? .65 : 0, seed: unit(berg.seed, 2.7) };
}

function bergPoint(berg, frame, phi, distance) {
  const u = Math.cos(phi) * distance * frame.stretch, v = Math.sin(phi) * distance;
  const x = berg.x + u * frame.cos - v * frame.sin, z = berg.z + u * frame.sin + v * frame.cos;
  return [x, icebergHeight(berg, x, z), z];
}
const inverseSmooth = s => .5 - Math.sin(Math.asin(Math.max(-1, Math.min(1, 1 - 2 * s))) / 3);

/** Merged meshes for every iceberg of a map: one lit ice draw, one wash draw.
 * Every vertex of the top and cliff lies on icebergHeight. */
export function makeIcebergGeometry(bergs, quality) {
  const density = iceDensity(quality), ice = new IceBuffer();
  const halo = { position: [], uv: [], index: [] };
  for (const berg of bergs) {
    const frame = icebergFrame(berg), colours = bergColours(berg), small = berg.radius < 45;
    const perimeter = TAU * berg.radius * (1 + frame.stretch) * .55;
    const segments = Math.round(Math.min(density.maxSegments, Math.max(density.minSegments, perimeter / density.edge)));
    const category = berg.type === 'tabular' || berg.type === 'blocky' ? 0 : berg.type === 'pinnacle' ? 2 : 1;
    let rings = density.topRings[category];
    if (small) rings = Math.max(1, Math.ceil(rings / 2));
    const power = category === 2 ? 1 : .8;
    const tList = Array.from({ length: rings - 1 }, (_, i) => .93 * ((i + 1) / rings) ** power);
    if (rings >= 3) tList.push(.965);
    tList.push(1);
    const skirt = small ? density.skirt.filter((_, i, list) => i % 2 === 1 || i === list.length - 1) : density.skirt;
    const angles = Array.from({ length: segments }, (_, j) => j / segments * TAU);
    const radii = angles.map(phi => icebergRadius(berg, phi));
    const metric = angles.map(phi => Math.hypot(Math.cos(phi) * frame.stretch, Math.sin(phi)));
    const freeboard = Math.max(1, berg.height);
    const vertex = (p, wall) => ({
      p, c: wall ? [.9, .95, .98] : colours.snow,
      s: [wall ? 1 : colours.topWall, Math.max(0, p[1]) / freeboard, 0, colours.seed],
    });
    const centre = [berg.x, icebergHeight(berg, berg.x, berg.z), berg.z];
    const top = [[vertex(centre, false)], ...tList.map(t => angles.map((phi, j) => vertex(bergPoint(berg, frame, phi, radii[j] * t), false)))];
    ice.patch(top, true, cross => Math.sign(cross.y));
    const lip = top.at(-1).map(v => vertex(v.p, true));
    const wall = [lip, ...skirt.map(f => angles.map((phi, j) => vertex(bergPoint(berg, frame, phi, radii[j] + f * frame.skirt / metric[j]), true)))];
    ice.patch(wall, true, (cross, a) => Math.sign(cross.x * (ice.position[a * 3] - berg.x) + cross.z * (ice.position[a * 3 + 2] - berg.z)));
    // Turquoise submerged ice foot, starting at the actual waterline crossing.
    const width = Math.min(45, Math.max(5, berg.radius * .2)), start = halo.position.length / 3;
    angles.forEach((phi, j) => {
      const lipHeight = lip[j].p[1];
      const waterline = inverseSmooth(lipHeight / (lipHeight - SEABED)) * frame.skirt;
      for (const [distance, edge] of [[waterline, 0], [waterline + width, 1]]) {
        const [x, , z] = bergPoint(berg, frame, phi, radii[j] + distance / metric[j]);
        halo.position.push(x, .06, z); halo.uv.push(j / segments, edge);
      }
    });
    for (let j = 0; j < segments; j++) {
      const a = start + j * 2, b = start + (j + 1) % segments * 2;
      halo.index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.name = 'Iceberg submerged ice foot';
  haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute(halo.position, 3));
  haloGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(halo.position.map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  haloGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(halo.uv, 2));
  haloGeometry.setIndex(halo.index);
  haloGeometry.computeBoundingSphere();
  return { geometry: ice.geometry('Merged iceberg tops and cliffs'), halo: haloGeometry };
}

/** Curvilinear sheet aligned with the glacier: rows follow the calving front,
 * so its cliff is crisp without any extra collision-free geometry. */
export function makeGlacierGeometry(island, quality) {
  const density = iceDensity(quality), frame = glacierFrame(island), ice = new IceBuffer();
  const angle = island.rotation ?? island.seed * 1.73 + .35, c = Math.cos(angle), s = Math.sin(angle);
  const R = island.radius, tail = frame.head - .08;
  const world = (u, v) => {
    const x = island.x + (u * c - v * s) * R, z = island.z + (u * s + v * c) * R;
    return [x, islandHeight(island, x, z), z];
  };
  const columns = Array.from({ length: density.glacierColumns }, (_, j) => -1.2 + 2.4 * j / (density.glacierColumns - 1));
  const vertex = (u, v, across, wall) => {
    const p = world(u, v), a = Math.max(0, Math.min(1, (frame.frontAt(v) - u) / (frame.front - frame.head)));
    // Bare, blue-grey ablation ice near the front; white firn upstream.
    const firn = smooth(.14, .5, a), patch = noise2(u * 23 + island.seed, v * 31) * .06;
    const colour = [.66 + firn * .29 - patch, .79 + firn * .18 - patch * .6, .87 + firn * .11 - patch * .3];
    const crevasses = Math.max(1 - smooth(0, .34, a), smooth(.6, .95, Math.abs(across))) * .9 + .1;
    return { p, c: colour, s: [wall ? 1 : 0, Math.max(0, p[1]) / island.plateauHeight, wall ? 0 : crevasses, unit(island.seed, 5.1)], f: [c, s, across, a] };
  };
  // A sea-floor row at a fixed distance keeps the mesh extents identical at
  // every tier; its triangles lie below the sea and are trimmed by the terrain.
  const rows = [columns.map(across => vertex(frame.front + .07 + frame.skirt / R, across * frame.halfWidth(frame.front), across, true))];
  for (const f of [...density.skirt].reverse()) rows.push(columns.map(across => {
    const v = across * frame.halfWidth(frame.front), u = frame.frontAt(v) + f * frame.skirt / R;
    return vertex(u, v, across, true);
  }));
  const lip = columns.map(across => { const v = across * frame.halfWidth(frame.front); return [frame.frontAt(v), v, across]; });
  rows.push(lip.map(([u, v, across]) => vertex(u, v, across, true)));
  ice.patch(rows, false, (cross, a) => Math.sign(cross.x * c + cross.z * s));
  const sheet = [lip.map(([u, v, across]) => vertex(u, v, across, false))];
  for (let k = 1; k <= density.glacierRows; k++) {
    const fraction = (k / density.glacierRows) ** 1.5;
    sheet.push(lip.map(([front, , across]) => {
      const u = front - fraction * (front - tail);
      return vertex(u, across * frame.halfWidth(u), across, false);
    }));
  }
  ice.patch(sheet, false, cross => Math.sign(cross.y));
  return ice.geometry(`Tidewater glacier ${island.seed}`);
}

// One shared physically based ice: wind-packed snow on top, layered white to
// blue glacier ice on cliffs, a narrow wave-washed band at the waterline, and
// crevasses and moraines on glacier sheets. All relief is filtered by pixel
// footprint so distant cliffs never sparkle.
export function makeIceMaterial(quality, detail) {
  const high = quality !== 'low', ultra = quality === 'ultra';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: .7, metalness: 0, envMapIntensity: .5 });
  material.name = `Glacier ice, firn and wind-packed snow / ${quality}`;
  material.customProgramCacheKey = () => `frostline-ice-${quality}-v2`;
  material.onBeforeCompile = shader => {
    shader.uniforms.iceStructure = { value: detail };
    shader.uniforms.iceSunDirection = { value: SUN_DIRECTION };
    shader.vertexShader = `
      attribute vec4 iceSurface;
      attribute vec4 iceFlow;
      varying vec3 vIceWorld;
      varying vec3 vIceNormal;
      varying vec4 vIceSurface;
      varying vec4 vIceFlow;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vIceWorld = (modelMatrix * vec4(position, 1.)).xyz;
      vIceNormal = normalize(mat3(modelMatrix) * normal);
      vIceSurface = iceSurface;
      vIceFlow = iceFlow;
    `);
    shader.fragmentShader = `
      uniform sampler2D iceStructure;
      uniform vec3 iceSunDirection;
      varying vec3 vIceWorld;
      varying vec3 vIceNormal;
      varying vec4 vIceSurface;
      varying vec4 vIceFlow;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 iceN = normalize(vIceNormal);
      float iceDistance = length(vIceWorld - cameraPosition);
      // Steep faces shed their snow and expose the ice beneath.
      float iceWall = clamp(max(vIceSurface.x, smoothstep(.8, .45, iceN.y)), 0., 1.);
      vec2 iceWeights = abs(iceN.xz) + .001; iceWeights /= iceWeights.x + iceWeights.y;
      float iceAlong = vIceWorld.z * iceWeights.x + vIceWorld.x * iceWeights.y;
      float iceFootprint = max(fwidth(iceAlong), fwidth(vIceWorld.y));
      float iceResolve = 1. - smoothstep(.5, 2.4, iceFootprint);
      vec3 iceNoiseA = texture2D(iceStructure, vec2(iceAlong * .0047, vIceWorld.y * .0031 + vIceSurface.w)).rgb;
      float iceWarp = (iceNoiseA.g - .5) * 5.;
      float iceLayer = vIceWorld.y * .41 + iceWarp + vIceSurface.w * 31.;
      float iceBands = smoothstep(.72, .99, sin(iceLayer)) * .6 + smoothstep(.9, 1., sin(iceLayer * 2.37 + 1.7)) * .4;
      float iceHeight = clamp(vIceSurface.y, 0., 1.);
      // Firn-white upper cliffs deepen to blue glacier ice towards the sea.
      vec3 iceCliff = mix(vec3(.56, .77, .87), vec3(.86, .93, .96), smoothstep(.05, .85, iceHeight) * .78 + iceNoiseA.r * .22);
      iceCliff = mix(iceCliff, vec3(.33, .6, .75), iceBands * .32 + step(.78, vIceSurface.w) * .3);
      float iceDirt = step(.86, fract(vIceSurface.w * 7.31)) * smoothstep(.8, .98, sin(vIceWorld.y * .09 + iceWarp * .3));
      iceCliff = mix(iceCliff, vec3(.36, .35, .33), iceDirt * .5);
      float iceWash = 1. - smoothstep(.2, 2.2, vIceWorld.y);
      iceCliff = mix(iceCliff, vec3(.12, .42, .5), iceWash * .62);
      ${high ? `
        float iceFlute = texture2D(iceStructure, vec2(iceAlong * .0105, vIceWorld.y * .0011 + vIceSurface.w * .3)).b;
        iceCliff *= mix(1., .93 + iceFlute * .1, iceResolve);
      ` : 'float iceFlute = .5;'}
      vec2 iceSnowPoint = vec2(vIceWorld.x * .021 + vIceWorld.z * .008, vIceWorld.z * .052 - vIceWorld.x * .011);
      float iceSastrugi = texture2D(iceStructure, iceSnowPoint).g;
      vec3 iceSnow = diffuseColor.rgb * (.94 + iceSastrugi * .08);
      diffuseColor.rgb = mix(iceSnow, iceCliff * mix(vec3(1.), diffuseColor.rgb, .3), iceWall);
      float iceCrevasse = 0.;
      if (vIceSurface.z > .01) {
        // Medial and lateral moraines: debris bands carried along the flow.
        // Two medial moraines merge towards the front and meander with the flow.
        float meander = (texture2D(iceStructure, vec2(vIceFlow.w * 1.3 + vIceSurface.w, .37)).r - .5) * .16;
        float across = vIceFlow.z + meander;
        float merge = smoothstep(.05, .7, vIceFlow.w);
        float moraineWidth = .016 + .02 * texture2D(iceStructure, vec2(vIceFlow.w * 3.1, vIceSurface.w + .2)).g;
        float moraine = 1. - smoothstep(moraineWidth, moraineWidth * 2.4, abs(across + .1 + .22 * merge));
        moraine = max(moraine, (1. - smoothstep(moraineWidth * .6, moraineWidth * 1.6, abs(across - .05 - .3 * merge))) * .75);
        moraine = max(moraine, (1. - smoothstep(.04, .13, abs(abs(across) - .95))) * .8);
        moraine *= smoothstep(.3, .62, texture2D(iceStructure, vIceWorld.xz * .0037).b + .22) * (1. - smoothstep(.7, 1., vIceFlow.w) * .8);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.3, .29, .28) * (.85 + iceSastrugi * .3), moraine * .7 * (1. - iceWall * .6));
        // Transverse crevasses, averaged into a darker texture once unresolved.
        vec2 flow = normalize(vIceFlow.xy + vec2(.00001));
        float along = dot(vIceWorld.xz, flow), side = dot(vIceWorld.xz, vec2(-flow.y, flow.x));
        float bend = (texture2D(iceStructure, vIceWorld.xz * .0021).r - .5) * 70. + sin(side * .0041) * 26. + vIceFlow.z * vIceFlow.z * 90.;
        float line = abs(fract((along + bend) / 29.) - .5) * 29.;
        float width = 1.2 + 2.8 * texture2D(iceStructure, vIceWorld.xz * .0107).g;
        float aa = max(fwidth(along) * 1.5, .3);
        float gate = smoothstep(.34, .56, texture2D(iceStructure, vec2(side * .0057, along * .019)).b);
        float resolved = 1. - smoothstep(2.5, 9., aa);
        float strength = vIceSurface.z * gate * (1. - iceWall) * (1. - moraine);
        iceCrevasse = (1. - smoothstep(width * .5 - aa, width * .5 + aa, line)) * strength * resolved;
        diffuseColor.rgb *= 1. - strength * (1. - resolved) * (width / 29. * .9 + .08);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05, .21, .31), iceCrevasse * .9);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(.86, .36, iceWall);
      roughnessFactor = mix(roughnessFactor, .16, iceWash * iceWall);
      roughnessFactor = mix(roughnessFactor, .6, iceCrevasse);
    `);
    if (high) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Melt flutes, layering and sastrugi as derivative relief only.
      vec3 iceDx = dFdx(-vViewPosition), iceDy = dFdy(-vViewPosition);
      vec3 iceR1 = cross(iceDy, normal), iceR2 = cross(normal, iceDx);
      float iceDet = dot(iceDx, iceR1);
      float iceRelief = mix(iceSastrugi * .1, iceFlute * .5 + iceBands * .16, iceWall) - iceCrevasse * .45;
      vec3 iceGradient = sign(iceDet) * (dFdx(iceRelief) * iceR1 + dFdy(iceRelief) * iceR2);
      normal = normalize(max(abs(iceDet), .000001) * normal - iceGradient * ${ultra ? '3.2' : '2.4'} * iceResolve);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // Light scattered inside thick ice keeps shaded cliffs faintly blue.
      float iceShade = 1. - max(dot(iceN, iceSunDirection), 0.);
      totalEmissiveRadiance += vec3(.006, .032, .048) * iceWall * iceShade * (1. - iceWash * .6);
    `);
  };
  return material;
}

/** Transparent wash ring: turquoise submerged ice with broken foam at the cliff. */
export function makeIceHaloMaterial(detail, theme = {}) {
  const material = new THREE.ShaderMaterial({
    name: 'Submerged ice foot and broken wash',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      washMap: { value: null }, time: { value: 0 },
      haloColour: { value: new THREE.Color(theme.coastShallow ?? theme.waterShallow ?? '#2c9eb2') },
      foamColour: { value: new THREE.Color(theme.waterFoam ?? '#e6f3f6') },
    }]),
    transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -1,
    vertexShader: /* glsl */`
      varying vec3 vHaloWorld;
      varying float vHaloDistance;
      #include <fog_pars_vertex>
      void main() {
        vHaloWorld = position;
        vHaloDistance = uv.y;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D washMap;
      uniform float time;
      uniform vec3 haloColour;
      uniform vec3 foamColour;
      varying vec3 vHaloWorld;
      varying float vHaloDistance;
      #include <fog_pars_fragment>
      void main() {
        vec3 wash = texture2D(washMap, vHaloWorld.xz * .019 + vec2(time * .0042, -time * .0031)).rgb;
        float glow = 1. - smoothstep(0., 1., vHaloDistance + (wash.r - .5) * .3);
        float foamEdge = .07 + wash.b * .1 + sin(time * .9 + wash.g * 6.28) * .02;
        float foam = (1. - smoothstep(foamEdge * .4, foamEdge, vHaloDistance)) * smoothstep(.4, .62, wash.r);
        float alpha = glow * glow * (.38 + wash.g * .2) + foam * .55;
        if (alpha < .006) discard;
        gl_FragColor = vec4(mix(haloColour, foamColour, foam), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  // UniformsUtils clones textures; keep the terrain-owned instance instead.
  material.uniforms.washMap.value = detail;
  return material;
}
