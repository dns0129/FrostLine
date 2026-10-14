import * as THREE from './vendor/three.module.js';
import { terrainHeight } from './world-math.js';

const clamp = THREE.MathUtils.clamp;
const damp = (from, to, rate, dt) => from + (to - from) * -Math.expm1(-rate * dt);

// Track translation exactly; damp the rig relative to the aircraft. Smoothing
// world positions adds speed / damping metres to the chase distance, so a fast
// aircraft becomes tiny even if the configured offset is close to the airframe.
export class ChaseCamera {
  constructor() {
    this.offset = new THREE.Vector3();
    this.previousOffset = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.previousAim = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.travel = new THREE.Vector3();
    this.afterburner = 0;
    this.bank = 0;
    this.zoom = 1;
    this.fov = 57;
  }

  follow(value, previous, target, rate, dt) {
    const decay = Math.exp(-rate * dt);
    const weight = -Math.expm1(-rate * dt) / (rate * dt);
    this.travel.copy(target).sub(previous);
    value.sub(previous).multiplyScalar(decay).add(target).addScaledVector(this.travel, -weight);
  }

  update(camera, target, player, dt, {reset = false, cockpit = false, zoom = 1, airframeScale = 1} = {}) {
    if (dt <= 0 && !reset) return;
    const boost = player.boost ? 1 : 0;
    const speed = clamp(((player.speed || 185) - 150) / 170, 0, 1);
    const zoomTarget = clamp(Number.isFinite(zoom) ? zoom : 1, .78, 1.4);
    const modelScale = clamp(Number.isFinite(airframeScale) ? airframeScale : 1, .5, 1.5);
    const bankTarget = Math.sin(player.bank || 0) * .24;
    if (reset) {
      this.afterburner = boost; this.bank = bankTarget; this.zoom = zoomTarget;
    } else {
      this.afterburner = damp(this.afterburner, boost, boost ? 4.8 : 3.2, dt);
      this.bank = damp(this.bank, bankTarget, 5, dt);
      this.zoom = damp(this.zoom, zoomTarget, 7, dt);
    }
    this.q.setFromEuler(this.euler.set(player.pitch || 0, player.heading || 0, cockpit ? player.bank || 0 : 0));
    if (cockpit) {
      this.desired.set(0, 1.55 * modelScale, -5.7 * modelScale).applyQuaternion(this.q);
      this.look.set(0, 1.55, -350).applyQuaternion(this.q);
      camera.up.set(0, 1, 0).applyQuaternion(this.q);
    } else {
      // The airframe fills the lower middle, leaving a clear forward sightline.
      // Portrait screens pull back only as much as needed to retain both wings.
      const portrait = Math.max(1, .95 / camera.aspect);
      const requestedDistance = (26 + speed * 1.4 + this.afterburner * 2.6) * modelScale * this.zoom * portrait;
      const wingClearance = camera.aspect < 1 ? (7 + 9.7 / (Math.tan(57 * Math.PI / 360) * camera.aspect)) * modelScale : 0;
      const distance = Math.max(requestedDistance, wingClearance);
      this.desired.set(-Math.sin(player.bank || 0) * 1.2 * modelScale, (6.5 + (this.zoom - 1) * 3) * modelScale, distance).applyQuaternion(this.q);
      this.look.set(0, 2.2, -125).applyQuaternion(this.q);
      camera.up.set(-Math.sin(this.bank), Math.cos(this.bank), 0).applyQuaternion(this.q);
    }
    if (reset) {
      this.offset.copy(this.desired); this.aim.copy(this.look);
    } else {
      this.follow(this.offset, this.previousOffset, this.desired, cockpit ? 30 : 8.5, dt);
      this.follow(this.aim, this.previousAim, this.look, cockpit ? 35 : 11, dt);
    }
    this.previousOffset.copy(this.desired); this.previousAim.copy(this.look);
    camera.position.copy(player.pos).add(this.offset);
    if (!cockpit) camera.position.y = Math.max(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + 3.5);
    target.copy(player.pos).add(this.aim);
    const fovTarget = (cockpit ? 77 : 57) + speed * 2 + this.afterburner * (cockpit ? 8 : 10);
    this.fov = reset ? fovTarget : damp(this.fov, fovTarget, 5.5, dt);
    camera.fov = this.fov;
  }
}
