import * as THREE from './vendor/three.module.js';

const clamp = THREE.MathUtils.clamp;
const smoothstep = (lo, hi, value) => {
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};
const CAPACITY = 96;
const hash = value => {
  const n = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
};

// Normal flight has only a trace of airflow. Afterburner makes it legible even
// before the aircraft reaches maximum speed, without flashing on at key-down.
export function speedEffectTarget(speed, boostAmount = 0) {
  const velocity = Math.max(0, Number.isFinite(speed) ? speed : 0);
  const boost = clamp(Number.isFinite(boostAmount) ? boostAmount : 0, 0, 1);
  return smoothstep(70, 155, velocity) * (
    smoothstep(195, 300, velocity) * .07 + boost * .78
  );
}

/** One draw call of world-space airflow; no framebuffer or camera shake. */
export class SpeedEffects {
  constructor(scene, { quality = 'high' } = {}) {
    this.scene = scene;
    this.intensity = 0;
    this.initialized = false;
    this.disposed = false;
    this.positions = new Float32Array(CAPACITY * 6);
    this.particles = Array.from({ length: CAPACITY }, () => new THREE.Vector3());
    this.cycles = new Uint32Array(CAPACITY);
    this.lastCameraPosition = new THREE.Vector3();
    this.viewPosition = new THREE.Vector3();
    this.velocityDirection = new THREE.Vector3();
    this.inverseCamera = new THREE.Quaternion();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    const alpha = new Float32Array(CAPACITY * 2);
    for (let i = 0; i < CAPACITY; i++) { alpha[i * 2] = .06; alpha[i * 2 + 1] = 1; }
    this.geometry.setAttribute('streakAlpha', new THREE.BufferAttribute(alpha, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { strength: { value: 0 } },
      vertexShader: `
        attribute float streakAlpha;
        varying float vAlpha;
        varying float vDepth;
        varying vec4 vClip;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vClip = projectionMatrix * view;
          vDepth = -view.z;
          vAlpha = streakAlpha;
          gl_Position = vClip;
        }
      `,
      fragmentShader: `
        uniform float strength;
        varying float vAlpha;
        varying float vDepth;
        varying vec4 vClip;
        void main() {
          vec2 screen = abs(vClip.xy / max(vClip.w, .001));
          float edge = max(screen.x, screen.y);
          // Keep the aircraft, reticle, and forward target area completely clear.
          float peripheral = smoothstep(.48, .76, edge) * (1.0 - smoothstep(.92, 1.12, edge));
          float depthFade = smoothstep(4.0, 20.0, vDepth) * (1.0 - smoothstep(125.0, 175.0, vDepth));
          float opacity = vAlpha * peripheral * depthFade * strength * .53;
          gl_FragColor = vec4(.69, .84, .91, opacity);
        }
      `,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.name = 'afterburner-airflow';
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.userData.skipWaterReflection = true;
    scene.add(this.lines);
    this.setQuality(quality);
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'high';
    this.count = this.quality === 'low' ? 40 : CAPACITY;
    this.geometry.setDrawRange(0, this.count * 2);
    this.initialized = false;
  }

  _spawn(index, camera, initial) {
    // Each recycle has a repeatable lane. Particles stay fixed in world space
    // between recycles, so camera motion produces genuine perspective and turns.
    const seed = index + this.cycles[index]++ * CAPACITY;
    const angle = seed * 2.3999632297;
    const x = Math.cos(angle), y = Math.sin(angle);
    const radius = .54 + hash(seed + 5) * .43;
    const edgeScale = radius / Math.max(Math.abs(x), Math.abs(y));
    const depth = initial ? 24 + hash(seed + 31) * 132 : 130 + hash(seed + 31) * 30;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) * depth;
    this.particles[index].set(
      x * edgeScale * halfHeight * camera.aspect,
      y * edgeScale * halfHeight,
      -depth,
    ).applyQuaternion(camera.quaternion).add(camera.position);
  }

  update(camera, player, dt, time, { active = true, cockpit = false, boostAmount = 0 } = {}) {
    if (this.disposed) return;
    if (!active) {
      this.lines.visible = false;
      this.intensity = 0;
      this.initialized = false;
      return;
    }
    // Neither external simulation time nor a camera refresh advances a pause.
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, .1);
    const target = speedEffectTarget(player.speed, boostAmount);
    const rate = target > this.intensity ? 4.5 : 3.1;
    this.intensity += (target - this.intensity) * -Math.expm1(-rate * dt);
    this.lines.visible = this.intensity > .002;
    this.material.uniforms.strength.value = this.intensity * (cockpit ? .72 : 1);
    if (!this.lines.visible) { this.initialized = false; return; }

    this.inverseCamera.copy(camera.quaternion).invert();
    const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * .5));
    const teleport = this.lastCameraPosition.distanceToSquared(camera.position) > 40000;
    const initialize = !this.initialized || teleport;
    const velocity = player.vel;
    if (velocity && Number.isFinite(velocity.x + velocity.y + velocity.z)) {
      this.velocityDirection.set(velocity.x, velocity.y, velocity.z);
    } else {
      const pitch = player.pitch || 0, heading = player.heading || 0;
      this.velocityDirection.set(-Math.sin(heading) * Math.cos(pitch), Math.sin(pitch), -Math.cos(heading) * Math.cos(pitch));
    }
    if (this.velocityDirection.lengthSq() < .001) camera.getWorldDirection(this.velocityDirection);
    this.velocityDirection.normalize();
    const length = (2 + Math.max(0, player.speed || 0) * .029) * (.28 + this.intensity * 1.15);
    for (let i = 0; i < this.count; i++) {
      const particle = this.particles[i];
      if (initialize) this._spawn(i, camera, true);
      else {
        this.viewPosition.copy(particle).sub(camera.position).applyQuaternion(this.inverseCamera);
        const depth = -this.viewPosition.z;
        const horizontal = Math.abs(this.viewPosition.x) / Math.max(.01, depth * halfFov * camera.aspect);
        const vertical = Math.abs(this.viewPosition.y) / Math.max(.01, depth * halfFov);
        if (depth < 5 || depth > 180 || Math.max(horizontal, vertical) > 1.22) this._spawn(i, camera, false);
      }
      const offset = i * 6;
      const streakLength = length * (.7 + hash(i + 91) * .6);
      // The dim end points upstream; the bright end passes the viewer first.
      this.positions[offset] = particle.x + this.velocityDirection.x * streakLength;
      this.positions[offset + 1] = particle.y + this.velocityDirection.y * streakLength;
      this.positions[offset + 2] = particle.z + this.velocityDirection.z * streakLength;
      this.positions[offset + 3] = particle.x;
      this.positions[offset + 4] = particle.y;
      this.positions[offset + 5] = particle.z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.lastCameraPosition.copy(camera.position);
    this.initialized = true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.lines);
    this.geometry.dispose();
    this.material.dispose();
  }
}
