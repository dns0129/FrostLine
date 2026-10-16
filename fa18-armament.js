import * as THREE from './vendor/three.module.js';

// Metres in the shipped airframe's coordinate system: forward -Z, up +Y.
// Mounting planes are measured from existing pylon feet / tip-rail support pads.
const WING_PITCH = -.01755;
const WING_ADAPTER_TOP = .14 + .089 + .004;
const TIP_ADAPTER_FACE = .0635 + .035;
const freezeStation = station => Object.freeze({ ...station, contact: Object.freeze(station.contact) });
export const FA18_HARDPOINTS = Object.freeze([
  freezeStation({ id: 'innerL', type: 'medium', index: 0, instanceIndex: 0, side: -1, contact: [-2.375465, -.332473, 1.364940], pitch: 0, roll: 0 }),
  freezeStation({ id: 'innerR', type: 'medium', index: 1, instanceIndex: 1, side: 1, contact: [2.366733, -.332473, 1.375061], pitch: 0, roll: 0 }),
  freezeStation({ id: 'outerL', type: 'medium', index: 2, instanceIndex: 2, side: -1, contact: [-3.747473, -.472512, 1.604909], pitch: WING_PITCH, roll: 0 }),
  freezeStation({ id: 'outerR', type: 'medium', index: 3, instanceIndex: 3, side: 1, contact: [3.737704, -.472512, 1.597636], pitch: WING_PITCH, roll: 0 }),
  freezeStation({ id: 'tipL', type: 'short', index: 4, instanceIndex: 0, side: -1, contact: [-6.137849, .057898, 2.468791], pitch: 0, roll: Math.PI }),
  // The right rail's fore/aft mounting pads sit about 3 mm inboard of its
  // extreme nose corner. Seat against those pads across the open middle bay.
  freezeStation({ id: 'tipR', type: 'short', index: 5, instanceIndex: 1, side: 1, contact: [6.149150, .057898, 2.495602], pitch: 0, roll: 0 }),
]);

const COLORS = Object.freeze({
  medium: '#c6ccc8', short: '#d8d9cf', radome: '#b7beb6', seeker: '#263d44',
  metal: '#67716d', exhaust: '#172021', yellow: '#bc9b3a', brown: '#826044',
  panel: '#909b96', adapter: '#939f9c', fin: '#b7c0ba',
});

function tint(geometry, color) {
  const c = new THREE.Color(color), count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function revolve(points, color, segments = 32) {
  const geometry = new THREE.LatheGeometry(points.map(([radius, z]) => new THREE.Vector2(radius, z)), segments);
  geometry.rotateX(Math.PI / 2);
  return tint(geometry, color);
}

function ring(radius, z, width, color) {
  return revolve([[radius, z - width / 2], [radius, z + width / 2]], color);
}

function box(width, height, length, x, y, z, color) {
  return tint(new THREE.BoxGeometry(width, height, length).translate(x, y, z), color);
}

// A thin, closed double-wedge fin has sharp edges and a shallow central ridge.
// Unlike scaled boxes its leading edge remains thin at close viewing distances.
function fin(outline, angle, color, thickness = .008) {
  const positions = [], uvs = [];
  let centerR = 0, centerZ = 0;
  for (const [r, z] of outline) { centerR += r / outline.length; centerZ += z / outline.length; }
  const emit = (a, b, c) => {
    for (const p of [a, b, c]) { positions.push(p[0], p[1], p[2]); uvs.push(p[0] * 2, p[2] * .25 + .5); }
  };
  const upper = [centerR, thickness / 2, centerZ], lower = [centerR, -thickness / 2, centerZ];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    emit(upper, [b[0], 0, b[1]], [a[0], 0, a[1]]);
    emit(lower, [a[0], 0, a[1]], [b[0], 0, b[1]]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals(); geometry.rotateZ(angle);
  return tint(geometry, color);
}

function merge(parts, type, dimensions) {
  const sources = parts.map(g => g.index ? g.toNonIndexed() : g);
  // Lathe poles contain one zero-area triangle per radial segment. Drop those
  // once at build time instead of submitting collapsed faces on every aircraft.
  const triangles = sources.map(source => {
    const p = source.attributes.position, offsets = [];
    for (let i = 0; i < p.count; i += 3) {
      const ux = p.getX(i + 1) - p.getX(i), uy = p.getY(i + 1) - p.getY(i), uz = p.getZ(i + 1) - p.getZ(i);
      const vx = p.getX(i + 2) - p.getX(i), vy = p.getY(i + 2) - p.getY(i), vz = p.getZ(i + 2) - p.getZ(i);
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz > 1e-20) offsets.push(i);
    }
    return offsets;
  });
  const count = triangles.reduce((sum, offsets) => sum + offsets.length * 3, 0);
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
    const values = new Float32Array(count * size); let offset = 0;
    for (let i = 0; i < sources.length; i++) for (const start of triangles[i]) {
      values.set(sources[i].attributes[name].array.subarray(start * size, (start + 3) * size), offset); offset += 3 * size;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  for (let i = 0; i < parts.length; i++) { if (parts[i] !== sources[i]) sources[i].dispose(); parts[i].dispose(); }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = `F/A-18 ${type} store and launcher adapter`;
  geometry.userData = { type, ...dimensions };
  return geometry;
}

function makeMissileGeometry(type) {
  const medium = type === 'medium', length = medium ? 3.66 : 2.87, radius = medium ? .089 : .0635;
  const front = -length / 2, rear = length / 2, noseLength = medium ? .66 : .19;
  const parts = [], nose = [];
  // An elliptical ogive is continuous at the shoulder and rounded at the tip.
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    nose.push([radius * Math.sqrt(Math.max(0, 1 - (1 - t) ** 2)), front + noseLength * t]);
  }
  parts.push(revolve(nose, medium ? COLORS.radome : COLORS.seeker));
  parts.push(revolve([[radius, front + noseLength], [radius, rear - .095]], COLORS[type]));
  // A real recessed motor bore: lip, inner wall and a dark disk behind the lip.
  parts.push(revolve([
    [radius, rear - .095], [radius * .96, rear - .014], [radius * .90, rear],
    [radius * .69, rear], [radius * .64, rear - .15],
  ], COLORS.metal));
  const bore = new THREE.CircleGeometry(radius * .645, 32); bore.translate(0, 0, rear - .15);
  parts.push(tint(bore, COLORS.exhaust));
  const bands = medium ? [[-.73, .026, COLORS.yellow], [.57, .025, COLORS.brown]] : [[-.97, .024, COLORS.yellow], [.54, .024, COLORS.brown]];
  for (const [z, width, color] of bands) parts.push(ring(radius + .00035, z, width, color));
  for (const z of medium ? [-1.14, -.12, .91, 1.69] : [-1.23, -.54, .82, 1.31]) parts.push(ring(radius + .0002, z, .008, COLORS.panel));
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    if (medium) {
      parts.push(fin([[.080, -.11], [.231, .18], [.231, .60], [.080, .77]], angle, COLORS.fin));
      parts.push(fin([[.078, .99], [.265, 1.20], [.265, 1.63], [.078, 1.77]], angle, COLORS.fin));
    } else {
      // Compact canards clear the long tip rail. Full-span tail fins start only
      // after that rail's aft end, including its source model's small asymmetry.
      parts.push(fin([[.058, -.99], [.102, -.87], [.102, -.68], [.058, -.62]], angle, COLORS.fin, .006));
      parts.push(fin([[.055, 1.00], [.300, 1.08], [.300, 1.36], [.055, 1.41]], angle, COLORS.fin, .007));
    }
  }
  if (medium) {
    parts.push(box(.09, .14, .95, 0, radius + .004 + .07, 0, COLORS.adapter));
    // Two saddles bridge the 4 mm paint/separation allowance above the tube.
    for (const z of [-.33, .33]) parts.push(box(.068, .022, .075, 0, .088, z, COLORS.metal));
  } else {
    // Canonical right-side adapter points along -X, toward the original rail.
    // The left instance is rolled by PI, preserving a positive determinant.
    parts.push(box(.0395, .045, .95, -TIP_ADAPTER_FACE + .0395 / 2, 0, -.2, COLORS.adapter));
    for (const z of [-.53, .13]) parts.push(box(.023, .058, .065, -.056, 0, z, COLORS.metal));
  }
  return merge(parts, type, {
    length, bodyRadius: radius, finRadius: medium ? .265 : .300,
    adapterContact: medium ? [0, WING_ADAPTER_TOP, 0] : [-TIP_ADAPTER_FACE, 0, -.2],
  });
}

export function makeFA18ArmamentAssets() {
  const geometries = { medium: makeMissileGeometry('medium'), short: makeMissileGeometry('short') };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', roughness: .64, metalness: .13, envMapIntensity: .45 });
  material.name = 'Matte missile paint, colored bands and launcher hardware';
  let disposed = false;
  return { geometries, material, dispose() {
    if (disposed) return; disposed = true;
    geometries.medium.dispose(); geometries.short.dispose(); material.dispose();
  } };
}

function placementFor(station) {
  const [x, y, z] = station.contact;
  const position = station.type === 'medium'
    ? [x, y - WING_ADAPTER_TOP * Math.cos(station.pitch), z - WING_ADAPTER_TOP * Math.sin(station.pitch)]
    : [x + station.side * TIP_ADAPTER_FACE, y, z + .2];
  return Object.freeze({ ...station, position: Object.freeze(position), rotation: Object.freeze([station.pitch, 0, station.roll]) });
}

export function makeFA18Armament(assets, { parked = false } = {}) {
  const group = new THREE.Group(); group.name = 'F/A-18 six-store air-to-air loadout';
  const medium = new THREE.InstancedMesh(assets.geometries.medium, assets.material, 4);
  const short = new THREE.InstancedMesh(assets.geometries.short, assets.material, 2);
  medium.name = 'Four medium-range stores'; short.name = 'Two wingtip short-range stores';
  const placements = Object.freeze(FA18_HARDPOINTS.map(placementFor));
  const transform = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  for (const placement of placements) {
    position.fromArray(placement.position); rotation.setFromEuler(new THREE.Euler(...placement.rotation));
    transform.compose(position, rotation, scale);
    (placement.type === 'medium' ? medium : short).setMatrixAt(placement.instanceIndex, transform);
  }
  for (const mesh of [medium, short]) {
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
  }
  let disposed = false, remainingAmmo = 6;
  group.userData = {
    stations: FA18_HARDPOINTS, placements, medium, short, remainingAmmo,
    update(ammo) {
      if (disposed) return;
      if (parked) remainingAmmo = 6;
      else if (Number.isFinite(ammo)) remainingAmmo = Math.max(0, Math.min(6, Math.floor(ammo)));
      medium.count = Math.min(remainingAmmo, 4); short.count = Math.max(0, remainingAmmo - 4);
      group.userData.remainingAmmo = remainingAmmo;
    },
    dispose() {
      if (disposed) return; disposed = true;
      // Instance-owned GPU matrices only. The loader owns shared paint/geometry.
      medium.dispose(); short.dispose();
    },
  };
  return group;
}
