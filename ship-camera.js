import * as THREE from './vendor/three.module.js';
import { DESTROYER_MODEL } from './destroyer.js';
import { terrainHeight } from './world-math.js';

const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const defaultPitch = Math.PI / 9, minPitch = Math.PI / 15, maxPitch = Math.PI * 5 / 12;
const viewElevationOffset = Math.PI / 12;
const wrapAngle = value => THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;

// Keep the user's world-space orbit while following vessel translation exactly.
// Neither steering nor the cannon can take control of the external view.
export class ShipCamera {
  constructor() {
    this.offset = new THREE.Vector3(); this.aim = new THREE.Vector3();
    this.previousOffset = new THREE.Vector3(); this.previousAim = new THREE.Vector3();
    this.desired = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.direction = new THREE.Vector3(); this.anchor = new THREE.Vector3();
    this.travel = new THREE.Vector3(); this.q = new THREE.Quaternion();
    this.hullQ = new THREE.Quaternion(); this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.zoom = 1; this.fov = 57;
    this.yaw = 0; this.pitch = defaultPitch;
    this.viewYaw = 0; this.viewPitch = defaultPitch; this.initialized = false;
  }
  orbit(deltaYaw, deltaPitch) {
    this.yaw = wrapAngle(this.yaw + finite(deltaYaw));
    this.pitch = clamp(this.pitch + finite(deltaPitch), minPitch, maxPitch);
    this.initialized = true;
  }
  recenter(heading = 0) {
    this.yaw = wrapAngle(finite(heading)); this.pitch = defaultPitch;
    this.initialized = true;
  }
  follow(value, previous, target, rate, dt) {
    const decay = Math.exp(-rate * dt), weight = -Math.expm1(-rate * dt) / (rate * dt);
    this.travel.copy(target).sub(previous);
    value.sub(previous).multiplyScalar(decay).add(target).addScaledVector(this.travel, -weight);
  }
  update(camera, target, player, dt, { reset = false, cockpit = false, zoom = 1 } = {}) {
    const step = clamp(finite(dt), 0, .1);
    if (step <= 0 && !reset) return;
    const heading = finite(player.heading);
    if (!this.initialized) this.recenter(heading);
    const aimHeading = finite(player.turretHeading, heading), pitch = clamp(finite(player.turretPitch, .3), -.08, 1.4);
    const zoomTarget = clamp(finite(zoom, 1), .78, 1.4);
    this.zoom = reset ? zoomTarget : this.zoom + (zoomTarget - this.zoom) * -Math.expm1(-7 * step);
    if (cockpit) {
      this.hullQ.setFromEuler(this.euler.set(0, heading, 0));
      this.desired.fromArray(DESTROYER_MODEL.bridgeEye).applyQuaternion(this.hullQ);
      this.q.setFromEuler(this.euler.set(pitch, aimHeading, 0));
      this.look.set(0, 0, -500).applyQuaternion(this.q).add(this.desired);
    } else {
      // Interpolate angles on the orbit, rather than cutting through the hull
      // when the user moves rapidly between opposing viewpoints.
      if (reset) { this.viewYaw = this.yaw; this.viewPitch = this.pitch; }
      else {
        const weight = -Math.expm1(-10 * step);
        this.viewYaw = wrapAngle(this.viewYaw + wrapAngle(this.yaw - this.viewYaw) * weight);
        this.viewPitch += (this.pitch - this.viewPitch) * weight;
      }
      const portrait = Math.max(1, .86 / Math.max(.15, camera.aspect));
      const radius = 200 * this.zoom * portrait, horizontal = Math.cos(this.viewPitch) * radius;
      this.desired.set(Math.sin(this.viewYaw) * horizontal, 18 + Math.sin(this.viewPitch) * radius,
        Math.cos(this.viewYaw) * horizontal);
      // Put the vessel below the aiming line while retaining the same safe
      // orbit. At the default 20° orbit, the view points 5° down towards sea
      // targets about 800 m ahead instead of looking at the vessel itself.
      this.q.setFromEuler(this.euler.set(viewElevationOffset - this.viewPitch, this.viewYaw, 0));
      this.direction.set(0, 0, -1).applyQuaternion(this.q);
      this.look.copy(this.desired).addScaledVector(this.direction, 1000);
    }
    if (reset || !cockpit) { this.offset.copy(this.desired); this.aim.copy(this.look); }
    else {
      this.follow(this.offset, this.previousOffset, this.desired, cockpit ? 26 : 5.5, step);
      this.follow(this.aim, this.previousAim, this.look, cockpit ? 30 : 8, step);
    }
    this.previousOffset.copy(this.desired); this.previousAim.copy(this.look);
    camera.position.copy(player.pos).add(this.offset);
    target.copy(player.pos).add(this.aim); camera.up.set(0, 1, 0);
    if (!cockpit) {
      camera.position.y = Math.max(camera.position.y, terrainHeight(camera.position.x, camera.position.z) + 8, 8);
      // Raise the orbit if the shore lies between vessel and camera, so a
      // safe endpoint cannot still leave the view buried behind a ridge.
      this.anchor.copy(player.pos); this.anchor.y += 18;
      const dx = camera.position.x - this.anchor.x, dz = camera.position.z - this.anchor.z;
      const samples = Math.min(72, Math.max(1, Math.ceil(Math.hypot(dx, dz) / 12)));
      for (let i = 1; i < samples; i++) {
        const fraction = i / samples;
        const ground = terrainHeight(this.anchor.x + dx * fraction, this.anchor.z + dz * fraction) + 8;
        camera.position.y = Math.max(camera.position.y, this.anchor.y + (ground - this.anchor.y) / fraction);
      }
      // Raising the camera must also raise its look point. Preserve the
      // selected world-space aiming direction instead of tilting at a shore.
      target.copy(camera.position).addScaledVector(this.direction, 1000);
    }
    this.fov = cockpit ? 76 : 82; camera.fov = this.fov;
  }
}
