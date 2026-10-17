import * as THREE from './vendor/three.module.js';
import { islandHeight, noise2 } from './world-math.js';
import { getMap } from './maps.js';
import { getQualityPreset } from './quality.js';
import { makeMapScenery } from './map-scenery.js';
import { makeGlacierGeometry, makeIceMaterial } from './icebergs.js';

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ROCK = new THREE.Color('#a6a59c');
const CLIFF = new THREE.Color('#919b99');
const TALUS = new THREE.Color('#aaa696');
const MINERAL = new THREE.Color('#c6c9bd');
const WET_ROCK = new THREE.Color('#536568');
const SNOW = new THREE.Color('#c3cbc8');
const DEFAULT_PALETTE = { rock: ROCK, cliff: CLIFF, talus: TALUS, mineral: MINERAL, wet: WET_ROCK, snow: SNOW };
const DELTA_GREEN = new THREE.Color('#73885c');
const DELTA_SILT = new THREE.Color('#9a9973');
const BAY_GRASS = new THREE.Color('#798775');

function paletteFor(map) {
  const palette = {};
  for (const key of Object.keys(DEFAULT_PALETTE)) palette[key] = new THREE.Color(map.palette?.[key === 'wet' ? 'wetRock' : key] ?? DEFAULT_PALETTE[key]);
  return palette;
}

// A deterministic, mipmapped data texture replaces per-pixel fractal noise.
// It doubles as a safe local fallback while the original photographed-style
// rock asset loads, and as the patch mask for interrupted coastal wash.
function makeDetailTexture(quality) {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  const periodicNoise = (u, v, scale) => {
    // Blended opposite edges make the resulting texture repeat without seams.
    const a = noise2(u * scale + 7.3, v * scale + 11.7);
    const b = noise2((u - 1) * scale + 7.3, v * scale + 11.7);
    const c = noise2(u * scale + 7.3, (v - 1) * scale + 11.7);
    const d = noise2((u - 1) * scale + 7.3, (v - 1) * scale + 11.7);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, smooth(0, 1, u)), THREE.MathUtils.lerp(c, d, smooth(0, 1, u)), smooth(0, 1, v));
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, p = (y * size + x) * 4;
    const broad = periodicNoise(u, v, 9);
    const mid = periodicNoise(u, v, 23);
    const fine = periodicNoise(u, v, 57);
    pixels[p] = Math.round((broad * .55 + mid * .31 + fine * .14) * 255);
    pixels[p + 1] = Math.round((mid * .7 + fine * .3) * 255);
    pixels[p + 2] = Math.round((broad * .65 + fine * .35) * 255);
    pixels[p + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = 'Original seamless rock and coastal wash mask';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = getQualityPreset(quality).textureAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function makeRockMaterial(detail, quality, shared, map) {
  const high = quality !== 'low', ultra = quality === 'ultra';
  const ice = map.biome === 'arctic', desert = map.biome === 'desert', glacial = map.biome === 'glacial';
  const city = map.city;
  const delta = map.islands.find(island => island.shape === 'delta');
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .98, metalness: 0,
    envMapIntensity: ice ? .16 : .065, color: '#ffffff',
  });
  material.name = `${ice ? 'Layered blue ice and wind-packed snow' : desert ? 'Bedded sandstone and fine alluvial sand' : glacial ? 'Basalt under wind-packed snow' : 'Weathered coastal stone'} / ${quality}`;
  material.customProgramCacheKey = () => `frostline-terrain-${map.id}-${quality}-v6`;
  material.onBeforeCompile = shader => {
    shader.uniforms.rockAlbedo = shared.rockAlbedo;
    shader.uniforms.rockAssetReady = shared.rockAssetReady;
    shader.uniforms.rockStructure = { value: detail };
    shader.vertexShader = 'varying vec3 vRockWorld;\nvarying vec3 vRockWorldNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 rockPosition = vec4(position, 1.);
      vec3 rockObjectNormal = normal;
      #ifdef USE_INSTANCING
        rockPosition = instanceMatrix * rockPosition;
        // Correct the diagonal nonuniform scale before rotating shore scree.
        mat3 rockInstance = mat3(instanceMatrix);
        rockObjectNormal /= vec3(dot(rockInstance[0], rockInstance[0]), dot(rockInstance[1], rockInstance[1]), dot(rockInstance[2], rockInstance[2]));
        rockObjectNormal = rockInstance * rockObjectNormal;
      #endif
      vRockWorld = (modelMatrix * rockPosition).xyz;
      vRockWorldNormal = normalize(mat3(modelMatrix) * rockObjectNormal);
    `);
    shader.fragmentShader = `
      varying vec3 vRockWorld;
      varying vec3 vRockWorldNormal;
      uniform sampler2D rockAlbedo;
      uniform sampler2D rockStructure;
      uniform float rockAssetReady;
      vec3 terrainRockSample(vec3 point, vec3 weights, float scale) {
        return texture2D(rockAlbedo, point.zy * scale).rgb * weights.x
          + texture2D(rockAlbedo, point.xz * scale).rgb * weights.y
          + texture2D(rockAlbedo, point.xy * scale).rgb * weights.z;
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 rockWeights = pow(abs(normalize(vRockWorldNormal)), vec3(4.));
      rockWeights /= max(dot(rockWeights, vec3(1.)), .0001);
      // Broad outcrops must survive a 3–8 km approach. The original image's
      // fractures span tens of metres at this scale instead of vanishing into
      // the mip chain like microscopic grain. High quality adds a subtle close
      // layer without suppressing the primary fractured faces.
      vec3 rockSample = terrainRockSample(vRockWorld, rockWeights, .00088);
      ${high ? 'rockSample = mix(rockSample, terrainRockSample(vRockWorld + vec3(61., 37., 83.), rockWeights, .0049), .14);' : ''}
      ${ultra ? 'rockSample = mix(rockSample, terrainRockSample(vRockWorld + vec3(-127., 81., 31.), rockWeights, .018), .065);' : ''}
      float rockLuma = dot(rockSample, vec3(.2126, .7152, .0722));
      vec3 rockTint = mix(vec3(1.), clamp(rockSample / max(rockLuma, .025), .70, 1.23), rockAssetReady * .32);
      float rockShade = clamp(.98 + (rockLuma - .19) * 2.30, .53, 1.48);
      vec2 structureUV = vec2(vRockWorld.x * .00051 + vRockWorld.y * .00140, vRockWorld.z * .00059 - vRockWorld.y * .00031);
      vec3 structure = texture2D(rockStructure, structureUV).rgb;
      float mineral = smoothstep(.49, .69, structure.r);
      float fractureShade = smoothstep(.18, .38, structure.g);
      ${ice ? `
        float snowFacing = smoothstep(.28, .86, vRockWorldNormal.y);
        float iceLayer = .5 + .5 * sin(vRockWorld.y * .11 + structure.b * 4.);
        float iceFissure = 1. - smoothstep(.019, .070, abs(structure.r - .46));
        diffuseColor.rgb *= mix(.83, 1.10, mineral) * mix(.91, 1.03, rockLuma);
        diffuseColor.rgb *= mix(.81, 1., iceLayer * .6 + snowFacing * .4);
        diffuseColor.rgb *= 1. - iceFissure * (1. - snowFacing) * .19;
      ` : desert ? `
        float sandFacing = smoothstep(.55, .94, vRockWorldNormal.y);
        float strata = .92 + .08 * sin(vRockWorld.y * .085 + structure.r * 4.);
        diffuseColor.rgb *= mix(rockShade * .76 + .26, .94 + structure.r * .15, sandFacing);
        diffuseColor.rgb *= mix(strata, 1., sandFacing) * mix(.93, 1.06, mineral);
      ` : 'diffuseColor.rgb *= rockTint * rockShade * mix(.84, 1.16, mineral) * mix(.84, 1., fractureShade);'}
      float glacialSnow = 0.;
      ${glacial ? `
        // Snow holds on ledges and gentle slopes and is resolved per pixel from
        // the world normal, so dark basalt buttresses keep crisp snow edges.
        float snowBreak = (structure.b - .5) * .22 + (rockLuma - .19) * 1.4;
        float snowSlope = smoothstep(.6, .67, vRockWorldNormal.y + snowBreak);
        glacialSnow = snowSlope * smoothstep(1.5, 6., vRockWorld.y + (structure.g - .5) * 14.);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.89, .93, .96) * (.93 + structure.g * .09), glacialSnow);
      ` : ''}
      ${city ? `
        // The 96 x 100 metre street network is aligned to the catalog lots.
        // All road colour stays in the terrain material, with no hovering
        // overlay, extra draw, or collision displacement.
        vec2 cityCell = (vRockWorld.xz - vec2(${Number(city.originX).toFixed(3)}, ${Number(city.originZ).toFixed(3)})) / vec2(${Number(city.blockWidth).toFixed(3)}, ${Number(city.blockDepth).toFixed(3)});
        vec2 cityEdge = abs(fract(cityCell + .5) - .5);
        float cityBounds = step(-.48, cityCell.x) * step(cityCell.x, ${Number(city.columns - .52).toFixed(3)}) * step(-.48, cityCell.y) * step(cityCell.y, ${Number(city.rows - .52).toFixed(3)});
        float streetAA = max(fwidth(cityEdge.x), fwidth(cityEdge.y));
        float street = smoothstep(.35 - streetAA, .38 + streetAA, max(cityEdge.x, cityEdge.y)) * cityBounds * smoothstep(.93, .99, vRockWorldNormal.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.115, .132, .137), street * .84);
      ` : ''}
      ${delta ? `
        // Irrigated strips are measured in metres and fade on channel banks.
        // They add a readable delta mosaic without geometry or texture loads.
        vec2 deltaPoint = (vRockWorld.xz - vec2(${Number(delta.x).toFixed(3)}, ${Number(delta.z).toFixed(3)})) / ${Number(delta.radius).toFixed(3)};
        float deltaMask = (1. - smoothstep(.62, .93, length(deltaPoint))) * smoothstep(2., 12., vRockWorld.y) * (1. - smoothstep(45., 95., vRockWorld.y)) * smoothstep(.91, .995, vRockWorldNormal.y);
        vec2 fieldPoint = vRockWorld.xz / vec2(165., 235.);
        vec2 fieldCell = floor(fieldPoint);
        float fieldPatch = fract(sin(dot(fieldCell, vec2(127.1, 311.7))) * 43758.5453);
        vec2 fieldEdge = abs(fract(fieldPoint) - .5);
        float fieldAA = max(fwidth(fieldPoint.x), fwidth(fieldPoint.y));
        float fieldBoundary = smoothstep(.452 - fieldAA, .487 + fieldAA, max(fieldEdge.x, fieldEdge.y));
        vec3 fieldColour = mix(vec3(.148, .202, .095), vec3(.267, .289, .132), fieldPatch);
        fieldColour = mix(fieldColour, vec3(.307, .280, .158), fieldBoundary * .64);
        diffuseColor.rgb = mix(diffuseColor.rgb, fieldColour, deltaMask * .54);
      ` : ''}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Derivatives reuse the albedo samples. This supplies diffuse micro-relief
      // with no extra texture taps or silhouette/collision displacement.
      vec3 rockDx = dFdx(-vViewPosition);
      vec3 rockDy = dFdy(-vViewPosition);
      vec3 rockR1 = cross(rockDy, normal);
      vec3 rockR2 = cross(normal, rockDx);
      float rockDet = dot(rockDx, rockR1);
      // Albedo contains fine mineral grain. It only contributes about one
      // metre of virtual relief, while the low-frequency structure carries
      // the broad weathered faces. Amplifying both equally produces a harsh
      // foil-like surface when the aircraft passes close to the rock.
      float rockHeight = rockLuma * .05 + structure.b * .34;
      vec3 rockGradient = sign(rockDet) * (dFdx(rockHeight) * rockR1 + dFdy(rockHeight) * rockR2);
      float reliefFade = 1. - smoothstep(4500., 12000., length(vViewPosition));
      normal = normalize(max(abs(rockDet), .000001) * normal - rockGradient * ${ice ? '5.' : desert ? (high ? '11.' : '8.') : (ultra ? '25.' : high ? '23.' : '17.')} * reliefFade * (1. - glacialSnow * .75));
    `);
    if (ice) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(.39, .94, smoothstep(.28, .86, vRockWorldNormal.y));
    `);
    if (glacial) shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(.9, .78, glacialSnow);
    `);
  };
  return material;
}

function makeCoastMaterial(detail, map) {
  return new THREE.ShaderMaterial({
    name: 'Depth-coloured shallows and broken surf',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      washMap: { value: detail }, time: { value: 0 },
      shallowColour: { value: new THREE.Color(map.theme?.coastShallow ?? map.theme?.waterShallow ?? '#668b83') },
      foamColour: { value: new THREE.Color(map.theme?.waterFoam ?? map.palette?.shore ?? '#c5d3cb') },
    }]),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    fog: true, polygonOffset: true, polygonOffsetFactor: -1,
    vertexShader: /* glsl */`
      varying vec3 vShoreWorld;
      varying float vShoreDistance;
      #include <fog_pars_vertex>
      void main() {
        vShoreWorld = position;
        vShoreDistance = uv.y;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D washMap;
      uniform float time;
      uniform vec3 shallowColour;
      uniform vec3 foamColour;
      varying vec3 vShoreWorld;
      varying float vShoreDistance;
      #include <fog_pars_fragment>
      void main() {
        vec3 wash = texture2D(washMap, vShoreWorld.xz * .0067 + vec2(time * .0021, -time * .0013)).rgb;
        float distanceToShore = vShoreDistance;
        float waterFade = 1. - smoothstep(.08, .98, max(0., distanceToShore));
        float landFade = smoothstep(-.2, -.018, distanceToShore);
        float depth = waterFade * landFade;
        float irregularity = smoothstep(.45, .70, wash.r);
        // Broken pockets only: there is deliberately no continuous white line.
        float front = .09 + (wash.b - .5) * .13 + sin(time * .68 + wash.g * 6.28) * .025;
        float washBand = 1. - smoothstep(.025, .16, abs(distanceToShore - front));
        float foam = irregularity * washBand * landFade;
        vec3 colour = mix(shallowColour, foamColour, foam);
        float alpha = depth * (.15 + wash.b * .13) + foam * .46;
        if (alpha < .008) discard;
        gl_FragColor = vec4(colour, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

// Find the actual collision-field coastline inside the coarse triangle edge.
// Bisection keeps coves tied to terrainHeight instead of drawing island circles.
function coastIntersection(island, a, b) {
  let lo = a, hi = b;
  if (lo[1] > 0) [lo, hi] = [hi, lo];
  let lx = lo[0], lz = lo[2], hx = hi[0], hz = hi[2];
  for (let i = 0; i < 8; i++) {
    const x = (lx + hx) * .5, z = (lz + hz) * .5;
    if (islandHeight(island, x, z) > 0) { hx = x; hz = z; } else { lx = x; lz = z; }
  }
  return [(lx + hx) * .5, (lz + hz) * .5];
}

function addShoreSegment(island, a, b, positions, uvs, stoneCandidates) {
  const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
  if (length < .05) return;
  let nx = -dz / length, nz = dx / length;
  const cx = (a[0] + b[0]) * .5, cz = (a[1] + b[1]) * .5;
  if (islandHeight(island, cx + nx * 22, cz + nz * 22) > islandHeight(island, cx - nx * 22, cz - nz * 22)) { nx = -nx; nz = -nz; }
  const patch = noise2(cx * .0031 + 7, cz * .0031 - 4);
  const width = 26 + patch * 37, inland = width * .16;
  const point = (p, distance) => [p[0] + nx * distance, .42, p[1] + nz * distance];
  const ai = point(a, -inland), ao = point(a, width), bi = point(b, -inland), bo = point(b, width);
  positions.push(...ai, ...ao, ...bi, ...bi, ...ao, ...bo);
  uvs.push(0, -.16, 0, 1, 1, -.16, 1, -.16, 0, 1, 1, 1);
  // Candidates are on existing land, never standalone collidable-looking reefs.
  if (stoneCandidates && patch > .46 && length > 10) stoneCandidates.push({ x: cx - nx * (10 + patch * 22), z: cz - nz * (10 + patch * 22), island, patch });
}

function makePebbles(candidates, quality, material, palette) {
  const limit = getQualityPreset(quality).maxPebbles, positions = [];
  // Sorting spreads the capped sample across all islands instead of filling the
  // entire quota from whichever island happened to be built first.
  candidates.sort((a, b) => noise2(a.x * .013 + 31, a.z * .013) - noise2(b.x * .013 + 31, b.z * .013));
  for (const c of candidates) {
    if (positions.length >= limit) break;
    const height = islandHeight(c.island, c.x, c.z);
    if (height < 1 || height > 38) continue;
    const size = 1.3 + c.patch * 2.0;
    const h1 = islandHeight(c.island, c.x - size * 2, c.z), h2 = islandHeight(c.island, c.x + size * 2, c.z);
    const h3 = islandHeight(c.island, c.x, c.z - size * 2), h4 = islandHeight(c.island, c.x, c.z + size * 2);
    // Big boulders on a steep shelf would float. Restrict these tiny embedded
    // stones to the existing gravel apron and leave steep shores as bare rock.
    if (Math.max(h1, h2, h3, h4) - Math.min(h1, h2, h3, h4) > 4.3) continue;
    positions.push({ ...c, y: height, size });
  }
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const attribute = geometry.attributes.position;
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i), y = attribute.getY(i), z = attribute.getZ(i);
    const amount = .80 + noise2(x * 12.7 + z * 7, y * 9.7 + 13) * .36;
    attribute.setXYZ(i, x * amount, y * amount, z * amount);
  }
  const colors = new Float32Array(attribute.count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.name = 'Small embedded shore scree';
  const dummy = new THREE.Object3D(), colour = new THREE.Color();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    // Exposed height is below 1.4 m and smaller than the aircraft's existing
    // terrain safety margin; the terrain remains the only collision surface.
    dummy.position.set(p.x, p.y - .32, p.z);
    dummy.rotation.set((p.patch - .5) * .3, noise2(p.x, p.z) * Math.PI * 2, (p.patch - .5) * .26);
    dummy.scale.set(p.size * 1.1, .62 + p.patch * .3, p.size * .68);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    colour.copy(palette.wet).lerp(palette.talus, .23 + p.patch * .23);
    mesh.setColorAt(i, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// The default heightfield grid with baked rock, snow and occlusion colours.
function makeIslandGeometry(island, preset, map, palette) {
  const segments = island.distant ? preset.distantTerrainSegments : preset.terrainSegments;
  const extent = island.radius * 2.12 * Math.max(1, island.scaleX ?? 1, island.scaleZ ?? 1);
  const geometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i) + island.x, z = points.getZ(i) + island.z;
    points.setXYZ(i, x, islandHeight(island, x, z), z);
  }
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal, colours = new Float32Array(points.count * 3);
  const colour = new THREE.Color(), row = segments + 1;
  for (let i = 0; i < points.count; i++) {
    const x = points.getX(i), y = points.getY(i), z = points.getZ(i);
    const steepness = 1 - Math.max(0, normals.getY(i));
    const patch = noise2(x / 390 + island.seed, z / 430 - 4);
    const grain = noise2(x / 99 - 12, z / 122 + island.seed);
    colour.copy(palette.rock).lerp(palette.cliff, smooth(.08, .48, steepness) * .83);
    colour.lerp(palette.talus, (1 - smooth(.05, .24, steepness)) * (.12 + patch * .24));
    const mineral = smooth(.57, .77, noise2(x / 490 + y / 225, z / 430 + island.seed));
    colour.lerp(palette.mineral, mineral * .29);
    if (island.shape === 'delta') {
      const lowland = 1 - smooth(24, 100, y);
      colour.lerp(DELTA_SILT, lowland * .55);
      const green = smooth(.26, .64, noise2(x / 420 + 13, z / 310 - 9));
      colour.lerp(DELTA_GREEN, green * lowland * (1 - smooth(.10, .32, steepness)) * .85);
    } else if (map.biome === 'bay' && y > 3 && y < 420) {
      const grass = (1 - smooth(.04, .28, steepness)) * (1 - smooth(240, 420, y));
      colour.lerp(BAY_GRASS, grass * (.22 + patch * .36));
    }
    // Occlusion is baked from neighbouring relief at build time: shaded
    // erosion gullies read clearly without an extra mobile shadow pass.
    let higher = 0, samples = 0;
    for (const offset of [-row - 1, -row, -row + 1, -1, 1, row - 1, row, row + 1]) {
      const j = i + offset;
      if (j >= 0 && j < points.count && Math.abs(j % row - i % row) <= 1) { higher += points.getY(j); samples++; }
    }
    const curvature = samples ? Math.max(0, higher / samples - y) : 0;
    const occlusion = 1 - clamp(curvature / (extent / segments * .5) * .23, 0, .25);
    colour.multiplyScalar((.84 + patch * .17 + grain * .10) * occlusion);
    const wet = 1 - smooth(2 + patch * 2, 12 + patch * 8, y);
    colour.lerp(palette.wet, wet * (map.biome === 'arctic' ? .40 : .70));
    const snowLine = map.theme?.snowLine ?? 1020, snowStrength = map.theme?.snowStrength ?? .62;
    const snow = smooth(snowLine + patch * 120, snowLine + 340 + patch * 210, y) * (1 - smooth(.19, .45, steepness));
    colour.lerp(palette.snow, snow * snowStrength);
    // The low ice shelves retain a white snow cap at sea level, with blue
    // compression layers visible only along their steep, shared shoreline.
    if (map.biome === 'arctic') colour.lerp(palette.snow, (1 - smooth(.07, .30, steepness)) * smooth(-3, 18, y) * .77);
    colours[i * 3] = colour.r; colours[i * 3 + 1] = colour.g; colours[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

export function makeTerrain(quality = 'high', mapId = 'north-atlantic') {
  const preset = getQualityPreset(quality); quality = preset.id;
  const map = getMap(mapId), islands = map.islands, palette = paletteFor(map);
  const group = new THREE.Group(); group.name = `Frostline ${map.englishName ?? map.id} terrain`;
  group.userData.mapId = map.id;
  let disposed = false;
  const detail = makeDetailTexture(quality);
  const shared = { rockAlbedo: { value: detail }, rockAssetReady: { value: 0 } };
  const material = makeRockMaterial(detail, quality, shared, map);
  const coastPositions = [], coastUVs = [], stoneCandidates = [];
  let terrainTriangles = 0, visibleTriangles = 0, terrainDraws = 0;
  // Glaciers and icebergs share one ice material; the rock material is untouched.
  const iceMaterial = map.icebergs?.length || islands.some(island => island.shape === 'glacier') ? makeIceMaterial(quality, detail) : null;
  for (const island of islands) {
    const glacier = island.shape === 'glacier';
    const geometry = glacier ? makeGlacierGeometry(island, quality) : makeIslandGeometry(island, preset, map, palette);
    const points = geometry.attributes.position;
    // Fully submerged triangles can never be seen through the opaque ocean.
    // Remove them now to save mobile vertex work and reflection capture work.
    const source = geometry.index.array, indices = [];
    for (let t = 0; t < source.length; t += 3) {
      const ids = [source[t], source[t + 1], source[t + 2]];
      const heights = ids.map(i => points.getY(i));
      if (Math.max(...heights) > -2) { indices.push(...ids); visibleTriangles++; }
      if (island.distant || Math.max(...heights) <= 0 || Math.min(...heights) > 0) continue;
      const edge = [];
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3];
        if ((points.getY(a) <= 0) !== (points.getY(b) <= 0)) {
          edge.push(coastIntersection(island, [points.getX(a), points.getY(a), points.getZ(a)], [points.getX(b), points.getY(b), points.getZ(b)]));
        }
      }
      if (edge.length === 2) addShoreSegment(island, edge[0], edge[1], coastPositions, coastUVs, glacier ? null : stoneCandidates);
    }
    terrainTriangles += source.length / 3;
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, glacier ? iceMaterial : material);
    mesh.name = `${island.shape ?? 'Coastal massif'} ${island.seed}`;
    mesh.userData.island = island;
    mesh.userData.mapId = map.id;
    group.add(mesh);
    if (indices.length) terrainDraws++;
  }
  const coastGeometry = new THREE.BufferGeometry();
  coastGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coastPositions, 3));
  coastGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(coastUVs, 2));
  coastGeometry.computeBoundingSphere();
  const coastMaterial = makeCoastMaterial(detail, map);
  // UniformsUtils clones Texture objects; use the owned texture directly so
  // the disposal path is exact and no accidental duplicate is left resident.
  coastMaterial.uniforms.washMap.value = detail;
  const shore = new THREE.Mesh(coastGeometry, coastMaterial);
  shore.name = 'Interrupted wash at the true zero contour';
  shore.userData.skipWaterReflection = true;
  shore.renderOrder = 2; group.add(shore);
  const stones = makePebbles(stoneCandidates, quality, material, palette); group.add(stones);
  const scenery = makeMapScenery(map, quality, { iceMaterial, detail }); group.add(scenery);
  const sceneryStats = scenery.userData.stats;
  const pebbleTriangles = stones.count * stones.geometry.attributes.position.count / 3;
  group.userData.stats = {
    quality, mapId: map.id, fullGridTriangles: terrainTriangles, terrainTriangles: visibleTriangles,
    coastTriangles: coastPositions.length / 9, pebbleCount: stones.count,
    pebbleTriangles, maxPebbles: preset.maxPebbles,
    drawCalls: terrainDraws + (coastPositions.length ? 1 : 0) + (stones.count ? 1 : 0) + sceneryStats.drawCalls,
    triangles: visibleTriangles + coastPositions.length / 9 + pebbleTriangles + sceneryStats.triangles,
    rockInstances: stones.count, sceneryInstances: sceneryStats.instanceCount,
    instanceCount: stones.count + sceneryStats.instanceCount,
    structureCount: sceneryStats.structureCount, vegetationCount: sceneryStats.vegetationCount, icebergCount: sceneryStats.icebergCount,
    sceneryTriangles: sceneryStats.triangles, sceneryDrawCalls: sceneryStats.drawCalls,
    rockTextureSamples: preset.rockTextureSamples,
  };
  group.userData.update = time => {
    coastMaterial.uniforms.time.value = time;
    for (const animated of scenery.userData.animated) animated.uniforms.time.value = time;
  };
  group.userData.ready = typeof document === 'undefined' ? Promise.resolve(false) : new Promise(resolve => {
    new THREE.TextureLoader().load('./assets/rock-albedo.jpg', texture => {
      if (disposed) { texture.dispose(); resolve(false); return; }
      texture.name = 'Original northern slate albedo';
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = preset.textureAnisotropy;
      shared.rockAlbedo.value = texture; shared.rockAssetReady.value = 1;
      resolve(true);
    }, undefined, () => resolve(false));
  });
  group.userData.dispose = () => {
    if (disposed) return; disposed = true;
    const geometries = new Set(), materials = new Set(), instances = [];
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const owned of Array.isArray(object.material) ? object.material : [object.material]) materials.add(owned);
      if (object.isInstancedMesh) instances.push(object);
    });
    geometries.forEach(geometry => geometry.dispose());
    // InstancedMesh owns GPU instance-matrix/colour buffers independently of
    // its geometry. Its dispose event releases those on quality changes.
    instances.forEach(mesh => mesh.dispose());
    materials.forEach(owned => owned.dispose());
    detail.dispose();
    if (shared.rockAlbedo.value !== detail) shared.rockAlbedo.value.dispose();
  };
  return group;
}
