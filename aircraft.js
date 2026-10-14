import * as THREE from './vendor/three.module.js';

// K-7 Peregrine: an original twin-engine interceptor. All dimensions are metres;
// flight points down -Z and Y is up. Static parts share eight draw calls.
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;

function random(seed = 47) {
  return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
}

function texture(size, draw, color = true) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const result = new THREE.CanvasTexture(canvas);
  if (color) result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

function skinTextures() {
  const paint = texture(1024, (ctx, size) => {
    const rng = random(804);
    ctx.fillStyle = '#bac4c9'; ctx.fillRect(0, 0, size, size);
    // Different batches of flat grey paint, with hairline panel joints and
    // recessed fasteners. No bright outline or glossy noise on the airframe.
    for (let row = 0; row < 8; row++) {
      const offset = row % 2 ? -90 : 0;
      for (let col = -1; col < 7; col++) {
        const x = offset + col * 190, y = row * 128;
        const value = 176 + Math.floor(rng() * 19);
        ctx.fillStyle = `rgb(${value},${value + 10},${value + 15})`;
        ctx.fillRect(x + 2, y + 2, 187, 124);
        ctx.strokeStyle = 'rgba(35,48,56,.30)'; ctx.lineWidth = 1.25;
        ctx.strokeRect(x + .5, y + .5, 189, 127);
        ctx.strokeStyle = 'rgba(231,237,237,.21)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 2, y + 2, 186, 124);
        ctx.fillStyle = 'rgba(39,53,61,.30)';
        for (let j = 13; j < 183; j += 19) {
          ctx.beginPath(); ctx.arc(x + j, y + 7, .95, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(x + j, y + 121, .95, 0, TAU); ctx.fill();
        }
        if (rng() > .4) {
          ctx.strokeStyle = 'rgba(36,49,59,.28)';
          ctx.strokeRect(x + 32, y + 28, 40 + rng() * 40, 42);
          ctx.fillStyle = 'rgba(48,61,68,.38)';
          ctx.fillRect(x + 43, y + 46, 18, 2);
        }
      }
    }
    for (let i = 0; i < 19000; i++) {
      const shade = rng() > .55 ? '245,244,230' : '27,43,52';
      ctx.fillStyle = `rgba(${shade},${.018 + rng() * .045})`;
      ctx.fillRect(rng() * size, rng() * size, .6 + rng() * 1.4, 1 + rng() * 4);
    }
    for (let i = 0; i < 90; i++) {
      const x = rng() * size, y = rng() * size, length = 15 + rng() * 90;
      const gradient = ctx.createLinearGradient(x, y, x, y + length);
      gradient.addColorStop(0, 'rgba(37,48,55,.08)'); gradient.addColorStop(1, 'rgba(37,48,55,0)');
      ctx.fillStyle = gradient; ctx.fillRect(x, y, 1 + rng() * 4, length);
    }
  });
  const roughness = texture(512, (ctx, size) => {
    const rng = random(83); ctx.fillStyle = '#e6e6e6'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6000; i++) {
      const value = 198 + Math.floor(rng() * 54); ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 8, 2 + rng() * 11);
    }
    ctx.strokeStyle = '#b8b8b8'; ctx.lineWidth = 1;
    for (let y = 0; y < size; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
  }, false);
  const bump = texture(512, (ctx, size) => {
    const rng = random(76); ctx.fillStyle = '#a0a0a0'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#777'; ctx.lineWidth = .7;
    for (let row = 0; row < 8; row++) for (let col = -1; col < 7; col++) {
      const x = col * 95 + (row % 2 ? -45 : 0), y = row * 64;
      ctx.strokeRect(x, y, 95, 64);
      ctx.fillStyle = '#898989';
      for (let j = 7; j < 94; j += 10) ctx.fillRect(x + j, y + 3, .7, .7);
    }
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = rng() > .5 ? '#a3a3a3' : '#9d9d9d';
      ctx.fillRect(rng() * size, rng() * size, 1, 1);
    }
  }, false);
  for (const map of [paint, roughness, bump]) map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { paint, roughness, bump };
}

function move(geometry, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  return geometry;
}

function tint(geometry, value = 1) {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const bottom = geometry.attributes.normal?.getY(i) < -.35 ? .90 : 1;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = value * bottom;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return geometry;
}

function paint(geometry, color) {
  const rgb = new THREE.Color(color), count = geometry.attributes.position.count;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { values[i * 3] = rgb.r; values[i * 3 + 1] = rgb.g; values[i * 3 + 2] = rgb.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(values, 3)); return geometry;
}

function merge(parts) {
  const positions = [], normals = [], uvs = [], colors = [];
  for (const part of parts) {
    const geometry = part.index ? part.toNonIndexed() : part;
    const { position, normal, uv, color } = geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal?.getX(i) ?? 0, normal?.getY(i) ?? 1, normal?.getZ(i) ?? 0);
      uvs.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
      colors.push(color?.getX(i) ?? 1, color?.getY(i) ?? 1, color?.getZ(i) ?? 1);
    }
    if (geometry !== part) geometry.dispose(); part.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

function meshGeometry(vertices, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

// Cross sections are [z, half width, half height, vertical centre]. A smooth,
// closed loft avoids the disconnected cylinders of the original model.
function loft(rings, segments = 36, exponent = 1, capFront = true) {
  const vertices = [], uvs = [], indices = [];
  for (const [z, width, height, center] of rings) {
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * TAU;
      const cx = Math.cos(angle), sy = Math.sin(angle);
      vertices.push(Math.sign(cx) * Math.pow(Math.abs(cx), exponent) * width,
        Math.sign(sy) * Math.pow(Math.abs(sy), exponent) * height + center, z);
      uvs.push(i / segments, (z + 13.8) / 23.5);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // Caps point outward in Z; their normals are subsequently separated by merge.
  const first = vertices.length / 3; vertices.push(0, rings[0][3], rings[0][0]); uvs.push(.5, 0);
  const last = vertices.length / 3; const end = rings[rings.length - 1]; vertices.push(0, end[3], end[0]); uvs.push(.5, 1);
  for (let i = 0; i < segments; i++) {
    if (capFront) indices.push(first, i + 1, i);
    const a = (rings.length - 1) * (segments + 1) + i; indices.push(last, a, a + 1);
  }
  return meshGeometry(vertices, uvs, indices);
}

// Span stations are [x, y, leading edge Z, trailing edge Z, thickness].
// Both sides use an actual airfoil: rounded nose, broad root, thin trailing edge.
function airfoil(stations, side = 1, camber = .025) {
  const chord = [0, .018, .045, .095, .17, .28, .42, .60, .78, .91, 1];
  const vertices = [], uvs = [], indices = [], columns = chord.length;
  for (const upper of [1, -1]) for (const [x, y, leading, trailing, thickness] of stations) {
    for (const t of chord) {
      const section = 5 * (.2969 * Math.sqrt(t) - .1260 * t - .3516 * t * t + .2843 * t ** 3 - .1036 * t ** 4);
      const z = THREE.MathUtils.lerp(leading, trailing, t);
      vertices.push(x * side, y + Math.sin(t * Math.PI) * camber + upper * (section * thickness + .008), z);
      uvs.push(x * side * .055 + .5, (z + 13) * .047);
    }
  }
  const layer = stations.length * columns;
  const triangle = (a, b, c, reverse) => reverse ? indices.push(a, c, b) : indices.push(a, b, c);
  for (let upper = 0; upper < 2; upper++) for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < columns - 1; j++) {
    const a = upper * layer + i * columns + j, b = a + columns;
    triangle(a, a + 1, b, (side < 0) !== (upper > 0));
    triangle(a + 1, b + 1, b, (side < 0) !== (upper > 0));
  }
  // Close tip, root, leading and trailing edges, preserving solid silhouettes.
  const quad = (a, b, c, d) => { triangle(a, b, c, side < 0); triangle(a, c, d, side < 0); };
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * columns, b = a + columns;
    quad(a, b, b + layer, a + layer);
    const c = a + columns - 1, d = b + columns - 1; quad(c, c + layer, d + layer, d);
  }
  for (let j = 0; j < columns - 1; j++) {
    quad(j, j + layer, j + 1 + layer, j + 1);
    const a = (stations.length - 1) * columns + j; quad(a, a + 1, a + 1 + layer, a + layer);
  }
  return meshGeometry(vertices, uvs, indices);
}

function tube(points, radius = .045, segments = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 4), radius, segments, false);
}

function canopy() {
  const sections = [[-7.65, .08, .03], [-7.30, .32, .25], [-6.70, .56, .69], [-5.75, .69, .96],
    [-4.70, .72, 1.01], [-3.60, .64, .73], [-2.85, .46, .34], [-2.48, .12, .02]];
  const vertices = [], uvs = [], indices = [], segments = 20;
  for (const [z, width, height] of sections) for (let i = 0; i <= segments; i++) {
    const a = i / segments * Math.PI;
    vertices.push(Math.cos(a) * width, .77 + Math.sin(a) * height, z); uvs.push(i / segments, (z + 7.65) / 5.17);
  }
  for (let r = 0; r < sections.length - 1; r++) for (let i = 0; i < segments; i++) {
    const a = r * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  return meshGeometry(vertices, uvs, indices);
}

function intake(side, body, dark, metal) {
  // A separate splitter and recessed duct make the inlet readable in silhouette.
  const frontZ = -3.42, rearZ = -1.37;
  const mouth = [[.92, -.19], [1.70, -.30], [1.88, -.96], [1.06, -1.08]];
  const outer = [[.81, -.07], [1.83, -.17], [2.02, -1.08], [.96, -1.21]];
  const vertices = [], uv = [], index = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ring = [outer[i], outer[j], mouth[j], mouth[i]];
    const offset = vertices.length / 3;
    ring.forEach(([x, y]) => { vertices.push(x * side, y, frontZ); uv.push(x * .14, y * .14); });
    // Front lip faces -Z on either side.
    if (side > 0) index.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    else index.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  body.push(tint(meshGeometry(vertices, uv, index), .83));
  const duct = [], ductUV = [], ductIndex = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, offset = duct.length / 3;
    const a = mouth[i], b = mouth[j];
    for (const [p, depth] of [[a, 0], [b, 0], [b, 1], [a, 1]]) {
      duct.push(side * (p[0] - depth * .12), p[1] + depth * .03, THREE.MathUtils.lerp(frontZ, rearZ, depth)); ductUV.push(depth, i / 4);
    }
    if (side > 0) ductIndex.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    else ductIndex.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }
  dark.push(meshGeometry(duct, ductUV, ductIndex));
  dark.push(move(new THREE.PlaneGeometry(.82, .84), side * 1.31, -.61, rearZ, 0, Math.PI));
  // Shoulder fairing encloses the intake while leaving its front aperture open.
  body.push(tint(move(loft([[-3.34, .58, .52, -.62], [-2.65, .64, .57, -.53], [-.3, .64, .54, -.31], [3.5, .45, .43, -.23]], 20, .68, false), side * 1.36, 0, 0), .88));
  // The fairing is open at its front; the black end wall is two metres inside.
  metal.push(tint(move(new THREE.BoxGeometry(.045, .80, .40), side * .91, -.63, -3.38), .76));
}

function nozzle(side, metal, dark, ember) {
  const x = side * .97, y = -.24;
  // The recessed turbine, inner liner, outer petals and actuator ring all have
  // real depth. They remain in the existing merged material batches.
  metal.push(tint(move(new THREE.TorusGeometry(.79, .046, 5, 36), x, y, 8.67), .58));
  for (let petal = 0; petal < 18; petal++) {
    const a = petal / 18 * TAU + .013, b = (petal + 1) / 18 * TAU - .013;
    const vertices = [], uv = [], index = [];
    for (const [angle, radius, z] of [[a, .81, 8.64], [b, .81, 8.64], [b, .63, 9.68], [a, .63, 9.68]]) {
      vertices.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z); uv.push(angle / TAU, (z - 8.64) / 1.04);
    }
    index.push(0, 1, 2, 0, 2, 3);
    metal.push(tint(meshGeometry(vertices, uv, index), .68 + (petal % 3) * .12));
    const mid = (a + b) * .5;
    metal.push(paint(tube([[x + Math.cos(mid) * .794, y + Math.sin(mid) * .794, 8.76],
      [x + Math.cos(mid) * .712, y + Math.sin(mid) * .712, 9.19]], .021, 4), '#b3a18b'));
    // A corrugated inner liner is visible around the hot turbine core.
    metal.push(tint(tube([[x + Math.cos(mid) * .59, y + Math.sin(mid) * .59, 9.57],
      [x + Math.cos(mid) * .49, y + Math.sin(mid) * .49, 8.94]], .012, 4), .48));
  }
  metal.push(move(new THREE.TorusGeometry(.64, .035, 5, 36), x, y, 9.67));
  metal.push(paint(move(new THREE.TorusGeometry(.605, .023, 4, 36), x, y, 9.62), '#b69a77'));
  dark.push(move(new THREE.CylinderGeometry(.57, .48, .84, 32, 1, true), x, y, 9.21, Math.PI / 2));
  dark.push(move(new THREE.CircleGeometry(.565, 32), x, y, 8.77));
  ember.push(move(new THREE.CircleGeometry(.41, 24), x, y, 8.79));
  ember.push(move(new THREE.TorusGeometry(.44, .018, 4, 32), x, y, 8.84));
  dark.push(move(new THREE.ConeGeometry(.115, .16, 12), x, y, 8.94, Math.PI / 2));
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * TAU;
    dark.push(tube([[x + Math.cos(angle) * .20, y + Math.sin(angle) * .20, 8.84],
      [x + Math.cos(angle) * .52, y + Math.sin(angle) * .52, 8.84]], .027, 4));
  }
}

function cockpit(body, dark, metal, navigation) {
  dark.push(move(new THREE.BoxGeometry(1.21, .065, 3.60), 0, .79, -5.10));
  // Ejection seat, headrest and side consoles retain a readable silhouette
  // through the tinted canopy, even in the close rear-quarter chase view.
  dark.push(move(new THREE.BoxGeometry(.64, .62, .24), 0, 1.07, -4.24, -.16));
  dark.push(move(new THREE.BoxGeometry(.37, .24, .20), 0, 1.46, -4.25, -.16));
  for (const side of [-1, 1]) {
    metal.push(tint(move(new THREE.CylinderGeometry(.023, .023, .71, 5), side * .29, 1.08, -4.19, -.16), .75));
    dark.push(move(new THREE.BoxGeometry(.13, .16, 1.33), side * .43, .87, -5.22));
    body.push(paint(move(new THREE.SphereGeometry(.16, 10, 7), side * .19, 1.09, -4.77, 0, 0, side * -.27, .8, 1.70, .9), '#697d73'));
    body.push(paint(tube([[side * .12, 1.29, -4.60], [side * .15, 1.16, -4.94], [side * .17, .98, -4.89]], .025, 4), '#b5ad86'));
  }
  body.push(paint(move(new THREE.SphereGeometry(.24, 12, 8), 0, 1.08, -4.66, 0, 0, 0, 1.04, 1.06, .85), '#62766c'));
  body.push(tint(move(new THREE.SphereGeometry(.22, 16, 10), 0, 1.44, -4.77, 0, 0, 0, 1, 1.12, 1.03), .88));
  dark.push(move(new THREE.SphereGeometry(.208, 16, 8, Math.PI, Math.PI, .36, 1.14), 0, 1.47, -4.80, 0, 0, 0, 1, .89, 1.08));
  dark.push(move(new THREE.SphereGeometry(.093, 8, 6), 0, 1.33, -4.96, 0, 0, 0, 1, .8, .8));
  dark.push(tube([[.065, 1.32, -4.96], [.22, 1.20, -4.93], [.26, .94, -4.65]], .027, 5));
  dark.push(move(new THREE.BoxGeometry(.76, .22, .48), 0, .94, -6.18, -.13));
  for (const x of [-.22, .22]) {
    navigation.push(paint(move(new THREE.PlaneGeometry(.19, .12), x, 1.00, -5.927, -.13), '#2f877b'));
    dark.push(move(new THREE.BoxGeometry(.05, .15, .13), x * 1.55, .96, -5.88));
  }
  // The HUD combiner is a thin frame; its subdued glass is part of the cockpit.
  metal.push(tint(tube([[-.22, 1.03, -6.24], [-.22, 1.28, -6.28], [.22, 1.28, -6.28], [.22, 1.03, -6.24]], .013, 4), .65));
}

function decal(points, uv = [0, 0, 1, 1]) {
  return meshGeometry(points.flat(), [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], [0, 1, 2, 0, 2, 3]);
}

function skinHeight(stations, x, z, upper = 1, camber = .025) {
  const index = Math.min(stations.length - 2, Math.max(0, stations.findIndex((station, i) => i < stations.length - 1 && x >= station[0] && x <= stations[i + 1][0])));
  const a = stations[index], b = stations[index + 1], span = clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
  const section = a.map((value, i) => THREE.MathUtils.lerp(value, b[i], span));
  const t = clamp((z - section[2]) / (section[3] - section[2]), 0, 1);
  const profile = 5 * (.2969 * Math.sqrt(t) - .1260 * t - .3516 * t * t + .2843 * t ** 3 - .1036 * t ** 4);
  return section[1] + Math.sin(t * Math.PI) * camber + upper * (profile * section[4] + .008);
}

function surfacePanel(stations, corners, side) {
  const vertices = [], uv = [], indices = [], steps = 6;
  // Sample the airfoil instead of laying a flat decal through its curved skin.
  for (let row = 0; row <= steps; row++) for (let col = 0; col <= steps; col++) {
    const u = col / steps, v = row / steps;
    const x = THREE.MathUtils.lerp(corners[0][0], corners[1][0], u);
    const z = THREE.MathUtils.lerp(THREE.MathUtils.lerp(corners[0][1], corners[1][1], u),
      THREE.MathUtils.lerp(corners[3][1], corners[2][1], u), v);
    vertices.push(side * x, skinHeight(stations, x, z) + .012, z);
    uv.push(side * x * .055 + .5, (z + 13) * .047);
    if (row < steps && col < steps) {
      const a = row * (steps + 1) + col, b = a + steps + 1;
      if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return meshGeometry(vertices, uv, indices);
}

function exhaustShape(rings, side, length) {
  const geometry = loft(rings.map(([z, radius]) => [z, radius, radius, 0]), 16, 1, false);
  const { position, uv } = geometry.attributes;
  // CanvasTexture's UV 0 samples the lower (bright) edge of the canvas; the
  // plume must fade away from the nozzle rather than glow at its distant tip.
  for (let i = 0; i < position.count; i++) uv.setY(i, position.getZ(i) / length);
  return move(geometry, side * .97, 0, 0, -Math.PI / 2);
}

function exhaustMaterial(parameters) {
  const material = new THREE.MeshBasicMaterial(parameters);
  const plumeTime = { value: 0 };
  material.userData.plumeTime = plumeTime;
  // A volume-like fade removes the hard silhouette of a transparent cone.
  // MeshBasicMaterial keeps normal texture/color/disposal handling, while the
  // alpha falls smoothly to zero as its surface turns tangent to the viewer.
  material.onBeforeCompile = shader => {
    shader.uniforms.plumeTime = plumeTime;
    const varyings = 'varying vec3 vPlumeNormal; varying vec3 vPlumeView; varying float vPlumeDistance;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vPlumeNormal = normalMatrix * normal;
      vPlumeView = -mvPosition.xyz;
      vPlumeDistance = position.y;
    `);
    shader.fragmentShader = varyings + 'uniform float plumeTime;\n' + shader.fragmentShader.replace('#include <alphamap_fragment>', `
      #include <alphamap_fragment>
      float facing = abs(dot(normalize(vPlumeNormal), normalize(vPlumeView)));
      float softEdge = pow(smoothstep(0.015, 0.52, facing), 1.45);
      float trailingFade = 1.0 - smoothstep(0.25, 4.05, vPlumeDistance);
      float flutter = 0.91 + 0.09 * sin(vPlumeDistance * 17.0 - plumeTime * 24.0);
      diffuseColor.a *= softEdge * trailingFade * flutter;
    `);
  };
  material.customProgramCacheKey = () => 'k7-soft-exhaust-v1';
  return material;
}

export function makeJetAssets() {
  const body = [], radome = [], dark = [], metal = [], glass = [], mark = [], ember = [], navigation = [];
  const wingStations = [[.82, -.05, -5.80, 5.0, .52], [1.48, -.04, -3.62, 5.45, .64],
    [2.60, -.06, -1.58, 5.72, .57], [4.90, -.13, .68, 6.10, .29], [7.75, -.24, 3.78, 6.57, .15],
    [8.55, -.27, 5.37, 6.71, .075]];
  const tailStations = [[.72, -.11, 5.47, 9.1, .35], [1.50, -.08, 5.91, 9.63, .30],
    [3.30, .02, 7.00, 10.41, .18], [5.10, .07, 8.82, 10.54, .065]];
  const finStations = [[0, 0, 4.50, 8.85, .34], [1.1, 0, 5.15, 9.11, .24],
    [3.45, 0, 6.86, 9.0, .12], [3.73, 0, 7.38, 8.96, .05]];
  body.push(tint(loft([[-8.95, .54, .39, .10], [-7.7, .74, .54, .08], [-6.2, .91, .70, .07],
    [-4.6, 1.09, .78, .04], [-2.8, 1.28, .82, -.01], [-.7, 1.45, .80, -.03], [1.4, 1.60, .72, -.08],
    [3.7, 1.43, .63, -.09], [6.0, 1.10, .53, -.12], [8.0, .74, .38, -.16], [8.8, .24, .19, -.16]], 40, .94)));
  radome.push(loft([[-13.15, .013, .018, .055], [-12.66, .091, .076, .068], [-11.85, .21, .17, .085],
    [-10.9, .35, .265, .105], [-9.95, .47, .34, .11], [-8.95, .543, .395, .10]], 36));
  metal.push(move(new THREE.CylinderGeometry(.017, .035, .85, 6), 0, .055, -13.54, Math.PI / 2));

  for (const side of [-1, 1]) {
    // Broad root strakes blend into the body, then become a thin swept wing.
    body.push(tint(airfoil(wingStations, side)));
    body.push(tint(airfoil(tailStations, side), .91));
    // Cant both vertical fins outward by exactly the same angle.
    const fin = airfoil(finStations, 1, 0);
    body.push(tint(move(fin, side * 1.14, .30, 0, 0, 0, side > 0 ? 1.29 : Math.PI - 1.29), .94));
    body.push(tint(move(loft([[-1.6, .38, .43, -.18], [.4, .70, .60, -.21], [3.4, .85, .69, -.24],
      [6.9, .86, .70, -.24], [8.7, .81, .64, -.24]], 28), side * .97, 0, 0), .91));
    intake(side, body, dark, metal); nozzle(side, metal, dark, ember);
    // Wingtip rails and two compact, finned stores on recessed hardpoints.
    body.push(tint(move(loft([[4.72, .035, .035, 0], [5.00, .09, .09, 0], [6.66, .085, .085, 0], [6.9, .018, .018, 0]], 10), side * 8.47, -.23, 0), .77));
    for (const wingX of [3.58, 5.60]) {
      body.push(tint(move(new THREE.BoxGeometry(.14, .62, 1.06), side * wingX, -.54, 3.91), .80));
      body.push(tint(move(loft([[1.87, .013, .013, 0], [2.24, .115, .115, 0], [4.86, .115, .115, 0], [5.08, .082, .082, 0]], 12), side * wingX, -.88, 0), .93));
      for (let i = 0; i < 4; i++) {
        body.push(tint(move(airfoil([[.09, 0, 4.27, 4.93, .028], [.37, 0, 4.64, 5.01, .012]]), side * wingX, -.88, 0, 0, 0, i * Math.PI / 2), .90));
      }
    }
    // Distinct trailing-edge panels, hinge housings and spoiler access lines
    // sit on the actual skin. No extra per-aircraft draw calls are needed.
    for (const corners of [
      [[2.83, 4.53], [5.05, 5.19], [5.05, 6.05], [2.83, 5.72]],
      [[5.19, 5.23], [7.77, 6.13], [7.77, 6.52], [5.19, 6.11]],
    ]) {
      body.push(tint(surfacePanel(wingStations, corners, side), .81));
      const border = [...corners, corners[0]].map(([x, z]) => [side * x, skinHeight(wingStations, x, z) + .025, z]);
      dark.push(tube(border, .012, 4));
    }
    for (const [x, z] of [[3.32, 4.68], [4.64, 5.09], [5.65, 5.39], [7.25, 5.94]]) {
      body.push(tint(move(new THREE.BoxGeometry(.105, .065, .27), side * x, skinHeight(wingStations, x, z) + .018, z, 0, side * -.22), .68));
    }
    dark.push(tube([[1.50, 8.93], [3.40, 9.81], [4.66, 10.10]].map(([x, z]) => [side * x, skinHeight(tailStations, x, z) + .024, z]), .012, 4));
    const finHinge = [[.45, 8.33], [1.45, 8.52], [2.80, 8.64], [3.42, 8.66]];
    dark.push(move(tube(finHinge.map(([x, z]) => [x, skinHeight(finStations, x, z, -side, 0) - side * .018, z]), .013, 4),
      side * 1.14, .30, 0, 0, 0, side > 0 ? 1.29 : Math.PI - 1.29));
    // Broad maintenance panels give the engine shoulders legible scale.
    for (const z of [3.7, 5.2, 6.7]) {
      dark.push(tube([[side * .45, .40, z], [side * .97, .475, z], [side * 1.48, .40, z]], .010, 4));
    }
    for (const z of [-1.48, -1.28, -1.08, -.88, -.68]) {
      dark.push(move(new THREE.BoxGeometry(.40, .019, .065), side * .94, .665, z, 0, side * -.15));
    }
    // Canopy perimeter is an actual narrow frame, not a bar through the glass.
    body.push(tint(tube([[side * .09, .78, -7.62], [side * .37, .79, -7.22], [side * .65, .80, -6.14],
      [side * .735, .80, -4.76], [side * .60, .80, -3.33], [side * .10, .78, -2.46]], .05, 8), .79));
  }
  glass.push(canopy());
  for (const [z, width, height] of [[-6.7, .56, .69], [-2.94, .49, .39]]) {
    const points = [];
    for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI; points.push([Math.cos(a) * width, .79 + Math.sin(a) * height, z]); }
    body.push(tint(tube(points, .034, 6), .72));
  }
  cockpit(body, dark, metal, navigation);
  // The equipment spine, dorsal antenna, cannon aperture and airbrake seams.
  body.push(tint(loft([[-2.43, .17, .20, .72], [-1.20, .31, .21, .68], [1.53, .28, .17, .63], [3.17, .12, .08, .58]], 20), .91));
  dark.push(move(airfoil([[0, 0, .72, 1.34, .10], [.44, 0, .96, 1.28, .025]]), 0, .82, 0, 0, 0, Math.PI / 2));
  metal.push(move(new THREE.CylinderGeometry(.07, .075, .38, 10, 1, true), -.64, .22, -7.46, Math.PI / 2));
  dark.push(move(new THREE.CircleGeometry(.058, 10), -.64, .22, -7.65, 0, Math.PI));
  for (const side of [-1, 1]) dark.push(tube([[side * .39, .77, -.62], [side * .44, .76, .9], [side * .34, .70, 2.32]], .012, 4));

  const decalMap = texture(512, (ctx) => {
    ctx.fillStyle = '#a6afb1'; ctx.strokeStyle = '#a6afb1'; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(128, 128, 63, 0, TAU); ctx.stroke();
    ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(82, 164); ctx.lineTo(128, 85); ctx.lineTo(174, 164); ctx.moveTo(99, 141); ctx.lineTo(157, 141); ctx.stroke();
    ctx.font = 'bold 118px monospace'; ctx.textAlign = 'center'; ctx.fillText('07', 381, 158);
    ctx.font = '18px monospace'; ctx.fillText('FROSTLINE', 381, 197);
    ctx.font = '13px monospace'; ctx.fillText('RESCUE', 130, 328); ctx.fillRect(69, 338, 117, 4);
  });
  for (const side of [-1, 1]) {
    const wingMark = [[4.25, 2.77], [5.3, 3.29], [5.3, 4.43], [4.25, 3.91]];
    mark.push(decal(wingMark.map(([x, z]) => [side * x, skinHeight(wingStations, x, z) + .018, z]), [0, .5, .5, 1]));
    // Paint is on the outer face of each fin, with its offset along the normal.
    const angle = side > 0 ? 1.29 : Math.PI - 1.29;
    const tailMark = [[2.02, 7.15], [2.92, 7.15], [2.92, 8.31], [2.02, 8.31]];
    const number = decal(tailMark.map(([x, z]) => [x, skinHeight(finStations, x, z, -side, 0) - .015 * side, z]), [.5, .5, 1, 1]);
    mark.push(move(number, side * 1.14, .30, 0, 0, 0, angle));
    const light = move(new THREE.SphereGeometry(.075, 8, 5), side * 8.53, -.20, 6.25);
    const color = new THREE.Color(side < 0 ? '#f4543e' : '#8fba91');
    const values = new Float32Array(light.attributes.position.count * 3);
    for (let i = 0; i < values.length; i += 3) { values[i] = color.r; values[i + 1] = color.g; values[i + 2] = color.b; }
    light.setAttribute('color', new THREE.BufferAttribute(values, 3)); navigation.push(light);
  }

  const maps = skinTextures();
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: '#bac4c9', map: maps.paint, roughnessMap: maps.roughness,
      bumpMap: maps.bump, bumpScale: .024, roughness: .86, metalness: .10, vertexColors: true, envMapIntensity: .43 }),
    radome: new THREE.MeshStandardMaterial({ color: '#626e76', roughness: .89, metalness: .025, envMapIntensity: .16 }),
    dark: new THREE.MeshStandardMaterial({ color: '#151d22', roughness: .88, metalness: .12, side: THREE.DoubleSide, envMapIntensity: .20 }),
    metal: new THREE.MeshStandardMaterial({ color: '#7b7873', roughness: .53, metalness: .78, vertexColors: true, side: THREE.DoubleSide, envMapIntensity: .72 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#849898', roughness: .14, metalness: 0, transparent: true, opacity: .43,
      clearcoat: .6, clearcoatRoughness: .13, envMapIntensity: .82, depthWrite: false }),
    mark: new THREE.MeshStandardMaterial({ map: decalMap, color: '#a2acaf', roughness: .93, metalness: 0, transparent: true,
      opacity: .60, alphaTest: .025, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }),
    ember: new THREE.MeshStandardMaterial({ color: '#30211c', emissive: '#a33b17', emissiveIntensity: .42, roughness: 1, metalness: 0 }),
    navigation: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
  const geometries = {};
  for (const [name, parts] of Object.entries({ body, radome, dark, metal, glass, mark, ember, navigation })) geometries[name] = merge(parts);
  const plumeMap = texture(128, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, 'rgba(85,128,255,0)'); gradient.addColorStop(.21, 'rgba(112,147,255,.08)');
    gradient.addColorStop(.54, 'rgba(133,164,255,.23)'); gradient.addColorStop(.81, 'rgba(221,218,255,.48)');
    gradient.addColorStop(1, 'rgba(255,229,183,.75)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, size, size);
  });
  const plumes = [], cores = [];
  for (const side of [-1, 1]) {
    plumes.push(exhaustShape([[0, .46], [.35, .49], [1.0, .43], [2.05, .32], [3.0, .19], [4.15, .005]], side, 4.15));
    // Shock diamonds are actual three-dimensional lobes, so they remain visible
    // from both the rear chase view and the lateral inspection angle.
    cores.push(paint(exhaustShape([[0, .255], [.48, .13], [.82, .006]], side, 4.15), '#fff2d4'));
    for (const [start, radius, size] of [[.72, .19, .77], [1.49, .14, .71], [2.19, .09, .58]]) {
      cores.push(paint(exhaustShape([[start, .008], [start + size * .44, radius], [start + size, .008]], side, 4.15), '#b8d7ff'));
    }
  }
  return { geometries, materials, tex: maps.paint, textures: { ...maps, decalMap, plumeMap },
    exhaustGeometry: merge(plumes), exhaustCoreGeometry: merge(cores) };
}

export function makeJet(assets, enemy = false) {
  const group = new THREE.Group(); group.name = enemy ? 'K-7 adversary' : 'K-7 Peregrine';
  for (const [name, geometry] of Object.entries(assets.geometries)) {
    if (enemy && name === 'mark') continue;
    const mesh = new THREE.Mesh(geometry, assets.materials[name]); mesh.name = `aircraft-${name}`;
    mesh.frustumCulled = true; group.add(mesh);
  }
  // Geometry is shared across all aircraft. The two materials alone are owned
  // by this jet. +Y remains the plume-length axis for the renderer API.
  const glow = new THREE.Mesh(assets.exhaustGeometry, exhaustMaterial({ map: assets.textures.plumeMap,
    color: '#f4b57d', transparent: true, opacity: .26, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false }));
  glow.name = 'twin-engine-exhaust'; glow.rotation.x = Math.PI / 2; glow.position.set(0, -.24, 9.69);
  group.add(glow); group.userData.exhaust = glow;
  const core = new THREE.Mesh(assets.exhaustCoreGeometry, exhaustMaterial({ map: assets.textures.plumeMap, color: '#d1e6ff', vertexColors: true,
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  core.name = 'afterburner-shock-diamonds'; core.rotation.copy(glow.rotation); core.position.copy(glow.position);
  core.visible = false; group.add(core); group.userData.exhaustCore = core;
  const warm = new THREE.Color('#f4b57d'), hot = new THREE.Color('#b9ceff');
  let elapsed = 0, afterburner = 0, disposed = false;
  group.userData.update = (dt, state = {}) => {
    const step = Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
    elapsed += step;
    const throttle = Number.isFinite(state.throttle) ? clamp(state.throttle, 0, 1) : .65;
    const command = state.afterburner ?? state.boost ?? 0;
    const target = Number.isFinite(Number(command)) ? clamp(Number(command), 0, 1) : 0;
    afterburner += (target - afterburner) * (1 - Math.exp(-8 * step));
    const pulse = Math.sin(elapsed * 43) * .018 + Math.sin(elapsed * 71) * .009;
    glow.scale.y = .36 + throttle * .57 + afterburner * 1.03 + pulse;
    glow.material.opacity = .18 + throttle * .19 + afterburner * .36;
    glow.material.color.lerpColors(warm, hot, afterburner);
    glow.material.userData.plumeTime.value = core.material.userData.plumeTime.value = elapsed;
    core.scale.y = glow.scale.y * (.80 + afterburner * .20);
    core.material.opacity = afterburner * (.40 + pulse * 2);
    core.visible = afterburner > .02;
  };
  group.userData.dispose = () => {
    if (disposed) return;
    disposed = true; glow.material.dispose(); core.material.dispose();
  };
  return group;
}
