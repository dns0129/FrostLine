import * as THREE from './vendor/three.module.js';
import { makeFA18 } from './fa18.js';
import { makeDestroyer } from './destroyer.js';

const clamp = THREE.MathUtils.clamp;
export function baseCameraPose(vehicle, yaw, pitch, zoom, aspect = 1.7) {
  const ship = vehicle === 'destroyer';
  const radius = (ship ? 195 : 30) * clamp(zoom, .7, 1.65) * Math.max(1, 1.35 / aspect);
  const angle = clamp(pitch, .09, .75);
  return {
    position: [Math.sin(yaw) * radius * Math.cos(angle), Math.sin(angle) * radius + (ship ? 7 : 1.8), Math.cos(yaw) * radius * Math.cos(angle)],
    target: [0, ship ? 7 : 1.8, 0],
  };
}

function surfaceTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#818889'; ctx.fillRect(0, 0, 256, 256);
  let seed = 91;
  for (let i = 0; i < 9000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 256; seed = (seed * 1664525 + 1013904223) >>> 0;
    ctx.fillStyle = i % 2 ? '#ffffff10' : '#00000012'; ctx.fillRect(x, seed % 256, 1, 1);
  }
  ctx.strokeStyle = '#323c4052'; ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, 255, 255);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(16, 16);
  texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function labelTexture(text) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#253138'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d0c6a6'; ctx.font = 'bold 64px monospace'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 87);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

// A separate display scene shares the existing WebGL renderer. Selecting or
// inspecting a vehicle never changes mission, health, ammunition or simulation.
export class BaseScene {
  constructor(world, viewport) {
    this.world = world; this.viewport = viewport; this.vehicle = 'aircraft';
    this.zoom = 1; this.yaw = -.82; this.pitch = .23; this.dirty = true; this.lastFrame = -Infinity;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#74818a');
    this.scene.fog = new THREE.Fog('#74818a', 180, 1300);
    this.camera = new THREE.PerspectiveCamera(43, 1, .15, 2400);
    this.scene.add(new THREE.HemisphereLight('#dae8f1', '#4c4c40', 2));
    this.sun = new THREE.DirectionalLight('#ffdfb0', 3.1); this.sun.position.set(-70, 120, -35);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .07; this.scene.add(this.sun);
    this.air = new THREE.Group(); this.air.name = 'Northern air station hangar';
    this.naval = new THREE.Group(); this.naval.name = 'Northern naval base';
    this.scene.add(this.air, this.naval);
    this.materials = {
      concrete: new THREE.MeshStandardMaterial({ map: surfaceTexture(), color: '#8c9392', roughness: .98 }),
      steel: new THREE.MeshStandardMaterial({ color: '#55646b', roughness: .83, metalness: .35 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2a363b', roughness: .92 }),
      yellow: new THREE.MeshStandardMaterial({ color: '#c0a46a', roughness: .86 }),
      white: new THREE.MeshStandardMaterial({ color: '#aab5b0', roughness: .88 }),
      light: new THREE.MeshBasicMaterial({ color: '#ffdfab' }),
      crate: new THREE.MeshStandardMaterial({ color: '#5c695c', roughness: .93 }),
    };
    this._buildHangar(); this._buildHarbor();
    this.setVehicle('aircraft'); this._bind();
  }
  box(group, dimensions, position, material = 'steel') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), this.materials[material] || material);
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  }
  _buildHangar() {
    const g = this.air;
    this.hangarBack = new THREE.Group(); this.hangarSides = [-1, 1].map(() => new THREE.Group());
    g.add(this.hangarBack, ...this.hangarSides);
    this.box(g, [260, .3, 260], [0, -.22, 0], 'concrete');
    // Open-front maintenance shelter, rear ribs and warm service lights.
    this.box(this.hangarBack, [57, 15, .6], [0, 7.5, 24], 'steel');
    for (const [index, x] of [-28, 28].entries()) {
      this.box(this.hangarSides[index], [.6, 15, 40], [x, 7.5, 4], 'steel');
      for (let z = -15; z <= 23; z += 6) this.box(this.hangarSides[index], [.7, 15.2, .35], [x * .98, 7.6, z], 'dark');
    }
    for (let x = -27; x <= 27; x += 4.5) this.box(this.hangarBack, [.14, 14.6, .1], [x, 7.4, 23.65], 'dark');
    this.hangarRoof = this.box(g, [57, .6, 40], [0, 15.2, 4], 'dark');
    for (let x = -18; x <= 18; x += 18) {
      this.box(g, [8, .13, .5], [x, 14.7, -6], 'light');
      const light = new THREE.PointLight('#ffd8a0', 55, 27, 2); light.position.set(x, 10, 7); g.add(light);
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), new THREE.MeshBasicMaterial({ map: labelTexture('HANGAR 01') }));
    sign.position.set(0, 12, 23.6); sign.rotation.y = Math.PI; this.hangarBack.add(sign);
    for (const x of [-12, 12]) this.box(g, [.12, .025, 36], [x, -.05, -5], 'yellow');
    for (let z = -63; z <= -23; z += 9) this.box(g, [.3, .025, 4.5], [0, -.04, z], 'yellow');
    this.box(g, [24, .025, .13], [0, -.04, -20], 'yellow');
    for (let i = 0; i < 5; i++) {
      this.box(g, [2.2, 1.6, 2], [-22 + i * 2.4, .7, 19], 'crate');
      this.box(g, [1.8, 2, 1.6], [24, .9, 15 - i * 2], i % 2 ? 'dark' : 'steel');
    }
    this.jet = makeFA18(this.world.fa18Assets,this.world.jetAssets,{parked:true});
    this.jet.position.y = this.jet.userData.groundOffset;
    this.jet.userData.exhaust.visible = false; this.jet.userData.exhaustCore.visible = false;
    this.jet.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    g.add(this.jet);
    // The parked model uses its imported gear instead of synthetic K-7 wheels.
    // Distant runway and utility buildings retain the sense of a working base.
    this.box(g, [220, .08, 20], [0, -.1, -98], 'dark');
    for (let x = -105; x <= 105; x += 15) this.box(g, [6, .025, .25], [x, -.04, -98], 'white');
    for (let i = 0; i < 4; i++) this.box(g, [25, 9 + i, 18], [-70 + i * 43, 4.3, -130], 'steel');
  }
  _buildHarbor() {
    const g = this.naval;
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec3 vPos; void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform float time; varying vec3 vPos;
        void main(){float wave=sin(vPos.x*.32+vPos.y*.19+time*.6)*sin(vPos.y*.52-time*.36);
          float fleck=pow(max(0.,sin(vPos.x*.57+vPos.y*.24+time*.4)),22.);
          vec3 color=mix(vec3(.095,.17,.19),vec3(.20,.31,.34),wave*.24+.5)+fleck*.035;
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -.1; g.add(this.water);
    this.box(g, [38, 4, 190], [-37, .7, 8], 'concrete');
    this.box(g, [135, 4, 40], [-77, .7, 107], 'concrete');
    for (let z = -80; z <= 85; z += 12) {
      this.box(g, [.4, .04, 7], [-19, 2.74, z], 'yellow');
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, .65, 10), this.materials.dark);
      bollard.position.set(-19, 3.1, z); g.add(bollard);
      this.box(g, [1.5, 1.9, 1.5], [-18, .5, z], 'dark');
    }
    for (const z of [-53, 53]) {
      this.box(g, [2, 43, 2], [-39, 24, z], 'yellow');
      this.box(g, [45, 1.6, 1.5], [-27, 44.5, z], 'yellow');
      this.box(g, [.25, 22, .25], [-5, 33, z], 'dark');
      const beam = this.box(g, [29, .6, .7], [-29, 38, z], 'yellow'); beam.rotation.z = .45;
      this.box(g, [5, 3.5, 4], [-38, 34, z], 'steel');
    }
    for (let z = -50; z <= 85; z += 27) {
      this.box(g, [5.5, 4.4, 12], [-49, 4.9, z], 'crate');
      this.box(g, [5.5, 4.4, 12], [-49, 9.3, z + 1], 'steel');
    }
    for (let x = -100; x < 60; x += 45) this.box(g, [35, 18, 27], [x, 10, 126], 'steel');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 4.5), new THREE.MeshBasicMaterial({ map: labelTexture('BERTH 02') }));
    sign.position.set(-37, 7, 98); sign.rotation.y = Math.PI; g.add(sign);
    this.ship = makeDestroyer(); g.add(this.ship);
    this.ship.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    // Low islands beyond the harbor; no mission collision geometry is changed.
    const land = new THREE.MeshStandardMaterial({ color: '#414e50', roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(90 + i * 6, 60 + i * 8, 7), land);
      hill.position.set(-700 + i * 175, 8, -540 - (i % 3) * 90); g.add(hill);
    }
  }
  setVehicle(vehicle) {
    const next = vehicle === 'destroyer' ? 'destroyer' : 'aircraft';
    if (next !== this.vehicle || !this.initialized) {
      this.vehicle = next; this.initialized = true; this.reset();
      this.air.visible = next === 'aircraft'; this.naval.visible = next === 'destroyer';
      const extent = next === 'destroyer' ? 100 : 36;
      Object.assign(this.sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 450 });
      this.sun.shadow.camera.updateProjectionMatrix(); this.dirty = true;
    }
  }
  reset() { this.yaw = this.vehicle === 'destroyer' ? .82 : -2.36; this.pitch = this.vehicle === 'destroyer' ? .28 : .23; this.zoom = 1; this.dirty = true; }
  orbit(yaw, pitch = 0) { this.yaw += yaw; this.pitch = clamp(this.pitch + pitch, .09, .75); this.dirty = true; }
  resize() { this.dirty = true; }
  cancelPointers() { this.points.clear(); this.viewport.classList.remove('dragging'); }
  _bind() {
    const el = this.viewport; this.points = new Map();
    const gap = () => { const [a, b] = [...this.points.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !document.getElementById('modalBackdrop').hidden) return;
      this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      el.setPointerCapture(event.pointerId); el.classList.add('dragging');
    });
    el.addEventListener('pointermove', event => {
      const previous = this.points.get(event.pointerId); if (!previous) return;
      const oldGap = this.points.size === 2 ? gap() : 0;
      this.points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.points.size === 2) { this.zoom = clamp(this.zoom * oldGap / Math.max(1, gap()), .7, 1.65); this.dirty = true; }
      else this.orbit(-(event.clientX - previous.x) * .008, (event.clientY - previous.y) * .004);
    });
    const end = event => { this.points.delete(event.pointerId); if (!this.points.size) el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    el.addEventListener('wheel', event => { event.preventDefault(); this.zoom = clamp(this.zoom + event.deltaY * .001, .7, 1.65); this.dirty = true; }, { passive: false });
    el.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') this.reset();
      else if (event.key === '+' || event.key === '=') this.zoom = clamp(this.zoom - .1, .7, 1.65);
      else if (event.key === '-') this.zoom = clamp(this.zoom + .1, .7, 1.65);
      else this.orbit(event.key === 'ArrowLeft' ? -.15 : event.key === 'ArrowRight' ? .15 : 0, event.key === 'ArrowUp' ? .05 : event.key === 'ArrowDown' ? -.05 : 0);
      this.dirty = true;
    });
  }
  render(now) {
    if (document.hidden || (now - this.lastFrame < 1000 / 30 && !this.dirty)) return;
    this.lastFrame = now; this.dirty = false;
    const { renderer, width, height } = this.world;
    this.camera.aspect = width / height;
    const pose = baseCameraPose(this.vehicle, this.yaw, this.pitch, this.zoom, this.camera.aspect);
    this.camera.position.set(...pose.position); this.camera.lookAt(...pose.target);
    // Cut away only the shelter faces between the camera and the aircraft so
    // an inspection orbit cannot bury the vehicle behind a solid hangar wall.
    this.hangarBack.visible = this.camera.position.z < 23;
    this.hangarSides[0].visible = this.camera.position.x > -27;
    this.hangarSides[1].visible = this.camera.position.x < 27;
    this.hangarRoof.visible = this.camera.position.y < 15;
    // Keep the vehicle centered in the clear area between the side panels and
    // above the fleet cards, even on portrait and short landscape screens.
    const rect = this.viewport.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2, centerY = rect.top + rect.height / 2;
    this.camera.setViewOffset(width, height, width / 2 - centerX, height / 2 - centerY, width, height);
    this.camera.updateProjectionMatrix();
    this.water.material.uniforms.time.value = now / 1000;
    if (this.vehicle === 'destroyer') { this.ship.position.y = .5 + Math.sin(now * .00115) * .1; this.ship.rotation.z = Math.sin(now * .00094) * .002; }
    renderer.info.reset(); renderer.render(this.scene, this.camera);
  }
}
