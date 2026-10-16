import * as THREE from './vendor/three.module.js';
import { islandHeight, noise2 } from './world-math.js';

const DEFAULT_COLOURS = { building: '#9caeb1', warehouse: '#b6b1a1', quay: '#a1a59d' };

// Window bays are measured in metres, independently of the instance's scale.
// Derivative filtering turns distant windows into their average facade colour
// instead of a shimmering grid. All quality levels share the same buildings.
function makeFacadeMaterial(quality) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .77, metalness: .08, envMapIntensity: .32 });
  material.name = `Harbour masonry and filtered glazing / ${quality}`;
  material.customProgramCacheKey = () => `frostline-map-facade-${quality}-v1`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = `
      attribute vec4 sceneryDimensions;
      varying vec3 vFacadePoint;
      varying vec3 vFacadeNormal;
      varying vec4 vFacadeDimensions;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vFacadePoint = position * sceneryDimensions.xyz;
      vFacadeNormal = normal;
      vFacadeDimensions = sceneryDimensions;
    `);
    shader.fragmentShader = `
      varying vec3 vFacadePoint;
      varying vec3 vFacadeNormal;
      varying vec4 vFacadeDimensions;
      float facadePane(vec2 point, vec2 pitch, vec2 opening) {
        vec2 cell = abs(fract(point / pitch) - .5) * pitch;
        vec2 filterWidth = max(fwidth(point), vec2(.025));
        vec2 edges = 1. - smoothstep(opening * .5 - filterWidth, opening * .5 + filterWidth, cell);
        float resolved = 1. - smoothstep(.45, 2.5, max(filterWidth.x, filterWidth.y));
        return mix(opening.x * opening.y / (pitch.x * pitch.y), edges.x * edges.y, resolved);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float facadeWall = 1. - abs(vFacadeNormal.y);
      float facadeHeight = vFacadePoint.y + vFacadeDimensions.y * .5;
      vec2 facadePoint = vec2(abs(vFacadeNormal.z) > .5 ? vFacadePoint.x : vFacadePoint.z, facadeHeight);
      float isBuilding = 1. - step(.5, vFacadeDimensions.w);
      float isWarehouse = step(.5, vFacadeDimensions.w) * (1. - step(1.5, vFacadeDimensions.w));
      float facadeWindows = facadePane(facadePoint, vec2(4.2, 3.6), vec2(2.65, 2.15));
      float baseStorey = smoothstep(3.2, 4.1, facadeHeight);
      float roofStorey = 1. - smoothstep(vFacadeDimensions.y - 2.2, vFacadeDimensions.y - .5, facadeHeight);
      float facadeGlazing = facadeWindows * facadeWall * isBuilding * baseStorey * roofStorey;
      vec3 glassTint = vec3(.16, .27, .32);
      ${quality !== 'low' ? `
        float facadeBay = floor(facadePoint.x / 4.2);
        float facadeFloor = floor(facadePoint.y / 3.6);
        float paneVariation = fract(sin(facadeBay * 17.17 + facadeFloor * 41.73) * 437.13);
        glassTint *= .83 + paneVariation * .32;
      ` : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, glassTint, facadeGlazing * .78);
      float warehousePanel = facadePane(facadePoint, vec2(7.8, 5.), vec2(7.52, 4.78));
      diffuseColor.rgb *= 1. - isWarehouse * facadeWall * (1. - warehousePanel) * .21;
      // A dark recessed plinth and roof surface give even the lowest tier
      // readable massing without adding per-building draw calls.
      float facadePlinth = (1. - smoothstep(.25, 1.15, facadeHeight)) * facadeWall;
      diffuseColor.rgb *= 1. - facadePlinth * .22;
      diffuseColor.rgb *= mix(1., .76, step(.5, vFacadeNormal.y));
      ${quality === 'ultra' ? `
        float sill = facadePane(facadePoint + vec2(0., .15), vec2(4.2, 3.6), vec2(2.85, 2.36));
        diffuseColor.rgb *= 1. - max(0., sill - facadeWindows) * facadeWall * isBuilding * .13;
      ` : ''}
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, ${quality === 'low' ? '.48' : '.32'}, facadeGlazing);
    `);
  };
  return material;
}

function meshForBoxes(entries, material, name, facade = false) {
  if (!entries.length) return null;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  if (facade) geometry.setAttribute('sceneryDimensions', new THREE.InstancedBufferAttribute(new Float32Array(entries.flatMap(e => [e.width, e.height, e.depth, e.kind === 'quay' ? 2 : e.kind === 'warehouse' ? 1 : 0])), 4));
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  mesh.name = name;
  mesh.userData.structureIds = entries.map(e => e.id);
  const dummy = new THREE.Object3D(), colour = new THREE.Color();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    dummy.position.set(e.x, e.y + e.height * .5, e.z);
    dummy.rotation.set(0, e.rotation, 0);
    dummy.scale.set(e.width, e.height, e.depth);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    colour.set(e.color ?? DEFAULT_COLOURS[e.kind] ?? DEFAULT_COLOURS.building);
    mesh.setColorAt(i, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

function addArchitecture(group, map, quality) {
  const structures = (map.structures ?? []).filter(s => [s.x, s.y, s.z, s.width, s.height, s.depth, s.rotation ?? 0].every(Number.isFinite) && s.width > 0 && s.height > 0 && s.depth > 0);
  if (!structures.length) return 0;
  const bodies = [], roofParts = [];
  const roofColour = new THREE.Color();
  for (let i = 0; i < structures.length; i++) {
    const s = structures[i], rotation = s.rotation ?? 0, id = s.id ?? i;
    const roofHeight = s.kind === 'quay' ? 0 : Math.min(.85, s.height * .12);
    bodies.push({ ...s, id, rotation, height: s.height - roofHeight });
    if (!roofHeight) continue;
    roofColour.set(s.color ?? DEFAULT_COLOURS[s.kind] ?? DEFAULT_COLOURS.building).multiplyScalar(.78);
    const color = roofColour.getHex(), thickness = Math.min(.58, s.width * .08, s.depth * .08);
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const part = (x, z, width, depth, height = roofHeight, base = s.height - roofHeight) => roofParts.push({
      id, kind: s.kind, color, rotation,
      x: s.x + cos * x + sin * z, z: s.z - sin * x + cos * z,
      y: s.y + base, width, depth, height,
    });
    // Parapets finish exactly at the catalog's roof and footprint. Their roof
    // recess and equipment remain inside the same collision envelope.
    part(0, -(s.depth - thickness) * .5, s.width, thickness);
    part(0, (s.depth - thickness) * .5, s.width, thickness);
    part(-(s.width - thickness) * .5, 0, thickness, s.depth - thickness * 2);
    part((s.width - thickness) * .5, 0, thickness, s.depth - thickness * 2);
    if (s.kind !== 'warehouse' && s.height >= 32) {
      part(s.width * .12, -s.depth * .1, s.width * .27, s.depth * .25);
    }
  }
  group.add(meshForBoxes(bodies, makeFacadeMaterial(quality), 'Catalog harbour buildings and quay foundations', true));
  if (roofParts.length) {
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .86, metalness: .04, envMapIntensity: .16 });
    material.name = 'Recessed harbour roofs and stone parapets';
    group.add(meshForBoxes(roofParts, material, 'Layered parapets and rooftop plant'));
  }
  group.userData.structureIds = structures.map((s, i) => s.id ?? i);
  return structures.length;
}

function shrubGeometry(quality) {
  // A single vertex-coloured mesh supplies a short woody stem and three soft
  // crown lobes. The entire mature shrub fits below the terrain safety margin.
  const positions = [], normals = [], colours = [];
  const append = (source, colour) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    const tint = new THREE.Color(colour);
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      colours.push(tint.r, tint.g, tint.b);
    }
    if (geometry !== source) geometry.dispose();
    source.dispose();
  };
  const stem = new THREE.CylinderGeometry(.075, .12, .85, 5);
  stem.translate(0, .425, 0); append(stem, '#6e7050');
  for (const [x, y, z, radius, color] of [[-.27, .91, .05, .61, '#657d43'], [.29, 1.07, -.06, .69, '#799152'], [.01, 1.44, .03, .54, '#899b5a']]) {
    const crown = new THREE.IcosahedronGeometry(radius, quality === 'low' ? 0 : 1);
    crown.scale(1.05, .84, .9); crown.translate(x, y, z); append(crown, color);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function addDeltaVegetation(group, map, quality) {
  const islands = (map.islands ?? []).filter(island => island.shape === 'delta');
  if (!islands.length) return 0;
  const candidates = [];
  for (const island of islands) {
    // Deterministic stratified sites avoid both clustering and a visible grid.
    // The same sites and physical size are retained for every quality tier.
    const count = 20, step = island.radius * 1.7 / count;
    for (let ix = 0; ix < count; ix++) for (let iz = 0; iz < count; iz++) {
      const seed = noise2(ix * 7.31 + island.seed, iz * 9.17 + 5);
      const x = island.x + (ix - count * .5 + .2 + seed * .6) * step;
      const z = island.z + (iz - count * .5 + .2 + noise2(iz * 4.31, ix * 3.17 + island.seed) * .6) * step;
      const y = islandHeight(island, x, z);
      if (!Number.isFinite(y) || y < 1.4 || y > 28) continue;
      const h = [[-3, 0], [3, 0], [0, -3], [0, 3]].map(([dx, dz]) => islandHeight(island, x + dx, z + dz));
      if (h.some(value => !Number.isFinite(value) || value < 1) || Math.max(...h, y) - Math.min(...h, y) > .8) continue;
      // In overlapping land, use the highest true collision-field surface.
      const ground = Math.max(y, ...(map.islands ?? []).map(other => islandHeight(other, x, z)));
      if (!Number.isFinite(ground) || Math.abs(ground - y) > .2) continue;
      candidates.push({ x, y: Math.min(y, ...h) - .09, z, seed });
    }
  }
  candidates.sort((a, b) => a.seed - b.seed);
  const sites = candidates.slice(0, 120);
  if (!sites.length) return 0;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: .96, metalness: 0, envMapIntensity: .08 });
  material.name = 'Nile delta tamarisk and low riparian scrub';
  const mesh = new THREE.InstancedMesh(shrubGeometry(quality), material, sites.length);
  mesh.name = 'Grounded Nile delta riparian shrubs';
  mesh.userData.sites = sites.map(site => ({ x: site.x, y: site.y, z: site.z }));
  const dummy = new THREE.Object3D(), colour = new THREE.Color();
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i], size = .9 + site.seed * .82;
    dummy.position.set(site.x, site.y, site.z);
    dummy.rotation.set(0, site.seed * Math.PI * 2, 0);
    dummy.scale.set(size, size, size);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    colour.setRGB(.85 + site.seed * .15, .9 + site.seed * .1, .82 + site.seed * .14);
    mesh.setColorAt(i, colour);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox(); mesh.computeBoundingSphere();
  group.add(mesh);
  return sites.length;
}

/** Static, deterministic scenery. Terrain owns disposal of the returned tree. */
export function makeMapScenery(map, quality = 'high') {
  quality = quality === 'low' || quality === 'ultra' ? quality : 'high';
  const group = new THREE.Group();
  group.name = `${map.id ?? 'Frostline'} architecture and grounded vegetation`;
  const structureCount = addArchitecture(group, map, quality);
  const vegetationCount = addDeltaVegetation(group, map, quality);
  const stats = { triangles: 0, drawCalls: 0, instanceCount: 0, structureCount, vegetationCount };
  group.traverse(object => {
    if (!object.isMesh) return;
    const count = object.isInstancedMesh ? object.count : 1;
    const indices = object.geometry.index?.count ?? object.geometry.attributes.position.count;
    stats.triangles += indices / 3 * count;
    stats.drawCalls += count > 0 ? 1 : 0;
    stats.instanceCount += count;
  });
  group.userData.stats = stats;
  group.userData.quality = quality;
  return group;
}
