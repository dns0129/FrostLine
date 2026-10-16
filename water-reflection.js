import * as THREE from './vendor/three.module.js';
import { getQualityPreset } from './quality.js';

const textureBias = new THREE.Matrix4().set(
  .5, 0, 0, .5,
  0, .5, 0, .5,
  0, 0, .5, .5,
  0, 0, 0, 1,
);
const lookTarget = new THREE.Vector3();
const cameraFields = ['fov', 'aspect', 'near', 'far', 'zoom', 'focus', 'filmGauge', 'filmOffset', 'coordinateSystem'];

/** Reflect a perspective camera across the world sea plane y = 0.
 * The output camera must be unparented. Read the camera's actual world axes:
 * camera.up alone does not include the roll of an aircraft or its parent.
 */
export function reflectCamera(camera, out = new THREE.PerspectiveCamera()) {
  camera.updateWorldMatrix(true, false);
  const m = camera.matrixWorld.elements;
  out.position.set(m[12], -m[13], m[14]);
  out.up.set(m[4], -m[5], m[6]).normalize();
  lookTarget.set(-m[8], m[9], -m[10]).add(out.position);
  out.lookAt(lookTarget);

  for (const field of cameraFields) {
    out[field] = camera[field];
  }
  if (camera.view) Object.assign(out.view ||= {}, camera.view);
  else out.view = null;
  out.layers.mask = camera.layers.mask;
  out.updateProjectionMatrix();
  out.updateMatrixWorld(true);
  return out;
}

/** World position -> homogeneous reflection texture coordinates. */
export function reflectionTextureMatrix(camera, out = new THREE.Matrix4()) {
  return out.copy(textureBias).multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
}

/** Tiny speed-driven FOV changes should not bypass the capture rate limit. */
export function projectionNeedsRefresh(projection, captured) {
  const current = projection.elements, previous = captured.elements;
  // For a perspective projection m[5] / m[0] is the rendered aspect ratio;
  // FOV and zoom cancel. Even a small resize must refresh immediately, while
  // FOV drift can wait for the next scheduled capture. This also covers
  // portrait/landscape changes before render-target rounding changes its size.
  const aspect = current[5] / current[0];
  const previousAspect = previous[5] / previous[0];
  if (!Number.isFinite(aspect) || !Number.isFinite(previousAspect) || Math.abs(aspect - previousAspect) > 1e-6) return true;
  for (let i = 0; i < 16; i++) {
    if (!Number.isFinite(current[i]) || !Number.isFinite(previous[i]) || Math.abs(current[i] - previous[i]) > .002) return true;
  }
  return false;
}

/** A single, bounded-resolution planar capture shared by the entire ocean. */
export class WaterReflection {
  constructor(renderer, scene, ocean, { quality = 'high', exclude = null } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.ocean = ocean;
    this.exclude = exclude;
    this.profile = getQualityPreset(quality);
    this.quality = this.profile.id;
    this.mirrorCamera = new THREE.PerspectiveCamera();
    this.reflectionMatrix = new THREE.Matrix4();
    this.target = this._createTarget();
    // Three.js retains the positive half-space, so this removes y < -0.6 m.
    // The small allowance avoids a bright seam along the terrain's shoreline.
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), .6);
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._lastPosition = new THREE.Vector3();
    this._lastQuaternion = new THREE.Quaternion();
    this._lastProjection = new THREE.Matrix4();
    this._lastCapture = -Infinity;
    this._valid = false;
    this._capturing = false;
    this._disposed = false;
    this._saved = { viewport: new THREE.Vector4(), scissor: new THREE.Vector4() };
    this._hidden = [];
    this._captureClipPlanes = [];
    this._hideObject = object => {
      if (object.visible && (object === this.ocean || object.userData.skipWaterReflection === true || this.exclude?.(object))) {
        this._hidden.push(object);
        object.visible = false;
      }
    };
    this._bindUniforms(0);
  }

  _createTarget() {
    // Keep HDR where renderable; the low preset uses less bandwidth on phones.
    const hdr = this.profile.reflectionHDR && (
      this.renderer.extensions.has('EXT_color_buffer_float') ||
      this.renderer.extensions.has('EXT_color_buffer_half_float')
    );
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    target.texture.name = 'FROSTLINE ocean reflection (linear)';
    return target;
  }

  _bindUniforms(strength) {
    const uniforms = this.ocean.material.uniforms;
    if (uniforms.reflectionMap) uniforms.reflectionMap.value = this.target.texture;
    if (uniforms.reflectionMatrix) uniforms.reflectionMatrix.value = this.reflectionMatrix;
    if (uniforms.reflectionStrength) uniforms.reflectionStrength.value = strength;
  }

  setQuality(quality) {
    const profile = getQualityPreset(quality);
    if (profile.id === this.quality || this._disposed) return;
    this.profile = profile;
    this.quality = profile.id;
    this.target.dispose();
    this.target = this._createTarget();
    this._valid = false;
    this._bindUniforms(0);
  }

  resize(camera) {
    if (this._disposed) return;
    const limit = this.profile.reflectionResolution;
    const aspect = Math.max(.1, camera.aspect);
    // Cap both dimensions, including portrait phones; preserve the view shape.
    const width = Math.max(1, Math.round(limit * Math.min(1, aspect)));
    const height = Math.max(1, Math.round(limit / Math.max(1, aspect)));
    if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
      this._valid = false;
      this._bindUniforms(0);
    }
  }

  update(camera, elapsed, { force = false } = {}) {
    if (this._disposed || this._capturing) return false;
    this.resize(camera);
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this._position);
    camera.getWorldQuaternion(this._quaternion);
    if (this._position.y <= .25) {
      this._valid = false;
      this._bindUniforms(0);
      return false;
    }

    const period = 1 / this.profile.reflectionHz;
    const moved = this._position.distanceToSquared(this._lastPosition) > 80 * 80;
    const turned = this._quaternion.angleTo(this._lastQuaternion) > .12;
    const projectionChanged = projectionNeedsRefresh(camera.projectionMatrix, this._lastProjection);
    const captureDue = elapsed < this._lastCapture || elapsed - this._lastCapture >= period - 1e-5;
    if (!force && this._valid && !moved && !turned && !projectionChanged && !captureDue) return false;

    reflectCamera(camera, this.mirrorCamera);
    const renderer = this.renderer;
    const saved = this._saved, hidden = this._hidden, clipping = this._captureClipPlanes;
    saved.target = renderer.getRenderTarget();
    saved.face = renderer.getActiveCubeFace();
    saved.mip = renderer.getActiveMipmapLevel();
    renderer.getViewport(saved.viewport);
    renderer.getScissor(saved.scissor);
    saved.scissorTest = renderer.getScissorTest();
    saved.toneMapping = renderer.toneMapping;
    saved.clippingPlanes = renderer.clippingPlanes;
    saved.xrEnabled = renderer.xr.enabled;
    saved.shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    hidden.length = 0;
    clipping.length = 0;
    if (saved.clippingPlanes) for (const plane of saved.clippingPlanes) clipping.push(plane);
    clipping.push(this.clipPlane);
    this._capturing = true;
    try {
      this.scene.traverse(this._hideObject);
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.clippingPlanes = clipping;
      // The ocean shader will be tone-mapped once in the main pass. Capturing
      // an already tone-mapped image here would darken and flatten reflections.
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(this.target);
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.render(this.scene, this.mirrorCamera);

      // Commit the projector only with its matching image. On skipped frames,
      // changing just the matrix would make coastlines slide across the water.
      reflectionTextureMatrix(this.mirrorCamera, this.reflectionMatrix);
      this._lastPosition.copy(this._position);
      this._lastQuaternion.copy(this._quaternion);
      this._lastProjection.copy(camera.projectionMatrix);
      this._lastCapture = elapsed;
      this._valid = true;
      this._bindUniforms(1);
      return true;
    } finally {
      for (const object of hidden) object.visible = true;
      hidden.length = 0;
      renderer.toneMapping = saved.toneMapping;
      renderer.clippingPlanes = saved.clippingPlanes;
      renderer.xr.enabled = saved.xrEnabled;
      renderer.shadowMap.autoUpdate = saved.shadowAutoUpdate;
      renderer.setRenderTarget(saved.target, saved.face, saved.mip);
      renderer.setViewport(saved.viewport);
      renderer.setScissor(saved.scissor);
      renderer.setScissorTest(saved.scissorTest);
      this._capturing = false;
    }
  }

  dispose() {
    if (this._disposed) return;
    this._bindUniforms(0);
    this.target.dispose();
    this._disposed = true;
  }
}
