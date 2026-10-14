import * as THREE from './vendor/three.module.js';

// One morning sun drives the sky, aircraft lighting and the reflection trail.
export const SUN_DIRECTION = new THREE.Vector3(-.40, .26, -.88).normalize();

const atmosphereGLSL = /* glsl */`
  float atmosphereHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float atmosphereNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * f * (f * (f * 6. - 15.) + 10.);
    return mix(mix(atmosphereHash(i), atmosphereHash(i + vec2(1., 0.)), f.x),
      mix(atmosphereHash(i + vec2(0., 1.)), atmosphereHash(i + vec2(1.)), f.x), f.y);
  }
  // Octave rotation prevents the axis-aligned streaks of the previous sky.
  float cloudFbm(vec2 p, float quality) {
    float sum = 0., amplitude = .52;
    mat2 rotation = mat2(.80, -.60, .60, .80);
    for (int i = 0; i < 5; i++) {
      if (i > 2 && quality < .5) break;
      sum += amplitude * atmosphereNoise(p);
      p = rotation * p * 2.07 + vec2(13.41, 7.23);
      amplitude *= .49;
    }
    return sum * mix(1.105, 1.005, quality);
  }
  // All colours are scene-linear. Output conversion happens once, at the end.
  vec3 clearAtmosphere(vec3 direction, vec3 sunDirection) {
    float elevation = max(direction.y, 0.);
    float towardsSun = max(dot(direction, sunDirection), 0.);
    vec3 zenith = vec3(.035, .100, .195);
    vec3 horizon = vec3(.435, .537, .594);
    vec3 sky = mix(horizon, zenith, pow(elevation, .42));
    float morningHaze = exp(-elevation * 9.) * pow(towardsSun, 5.);
    sky += vec3(.255, .165, .071) * morningHaze;
    sky += vec3(.28, .204, .112) * pow(towardsSun, 24.);
    sky += vec3(.33, .263, .178) * pow(towardsSun, 190.);
    sky += vec3(4.8, 4.15, 3.12) * smoothstep(.999975, .999990, towardsSun);
    vec3 belowHorizon = vec3(.225, .305, .355);
    return mix(belowHorizon, sky, smoothstep(-.16, .012, direction.y));
  }
`;

export function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      sunDirection: { value: SUN_DIRECTION.clone() },
      highQuality: { value: 1 },
      skyPanorama: { value: null },
      panoramaReady: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDirection;
      uniform vec3 sunDirection;
      uniform float time;
      uniform sampler2D skyPanorama;
      uniform float panoramaReady;
      ${atmosphereGLSL}
      void main() {
        vec3 d = normalize(vDirection);
        vec3 col = clearAtmosphere(d, sunDirection);
        if (panoramaReady > .5) {
          // Original photographic panorama; one world-space orientation is shared
          // by the visible sky, planar reflection and the aircraft environment.
          vec2 uv = vec2(fract(atan(d.x, -d.z) / 6.2831853 + .5 + time * .000002),
            asin(clamp(d.y, -1., 1.)) / 3.14159265 + .5);
          vec3 photo = texture2D(skyPanorama, uv).rgb;
          float seamDistance = min(uv.x, 1. - uv.x);
          vec3 seam = .5 * (texture2D(skyPanorama, vec2(.018, uv.y)).rgb
            + texture2D(skyPanorama, vec2(.982, uv.y)).rgb);
          photo = mix(seam, photo, smoothstep(0., .018, seamDistance));
          vec3 zenith = texture2D(skyPanorama, vec2(.5, .985)).rgb;
          photo = mix(photo, zenith, smoothstep(.91, .99, uv.y));
          float towardsSun = max(dot(d, sunDirection), 0.);
          col = photo * .92;
          col += vec3(.08, .062, .034) * pow(towardsSun, 70.);
          col += vec3(4.8, 4.15, 3.12) * smoothstep(.999975, .999990, towardsSun);
        }
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 40, 28), material);
  sky.name = 'Original maritime morning panorama';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  sky.userData.ready = new Promise(resolve => {
    const texture = new THREE.TextureLoader().load('./assets/sky-panorama.jpg', () => {
      material.uniforms.panoramaReady.value = 1;
      resolve(true);
    }, undefined, () => resolve(false));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    material.uniforms.skyPanorama.value = texture;
  });
  return sky;
}

export function makeOcean() {
  // Original, seamless wave material generated once on the CPU. Mipmaps average
  // unresolved slopes instead of producing regular interference bands at sea.
  const normalSize = 256;
  const heights = new Float32Array(normalSize * normalSize);
  const wavePixels = new Uint8Array(normalSize * normalSize * 4);
  const hash = (x, y, seed) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + seed * 1013;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const periodicNoise = (x, y, cells, seed) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash(ix % cells, iy % cells, seed);
    const b = hash((ix + 1) % cells, iy % cells, seed);
    const c = hash(ix % cells, (iy + 1) % cells, seed);
    const d = hash((ix + 1) % cells, (iy + 1) % cells, seed);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sy);
  };
  const frequencies = [6, 13, 29, 61];
  const amplitudes = [.63, .27, .12, .044];
  for (let y = 0; y < normalSize; y++) for (let x = 0; x < normalSize; x++) {
    let height = 0;
    for (let i = 0; i < frequencies.length; i++) {
      const cells = frequencies[i];
      height += periodicNoise(x / normalSize * cells, y / normalSize * cells, cells, 117 + i * 37) * amplitudes[i];
    }
    heights[y * normalSize + x] = height;
  }
  const wrap = value => (value + normalSize) % normalSize;
  for (let y = 0; y < normalSize; y++) for (let x = 0; x < normalSize; x++) {
    const pixel = (y * normalSize + x) * 4;
    const dx = (heights[y * normalSize + wrap(x + 1)] - heights[y * normalSize + wrap(x - 1)]) * 8;
    const dy = (heights[wrap(y + 1) * normalSize + x] - heights[wrap(y - 1) * normalSize + x]) * 8;
    wavePixels[pixel] = Math.round((THREE.MathUtils.clamp(dx, -1, 1) * .5 + .5) * 255);
    wavePixels[pixel + 1] = Math.round((THREE.MathUtils.clamp(dy, -1, 1) * .5 + .5) * 255);
    wavePixels[pixel + 2] = Math.round(THREE.MathUtils.clamp(heights[y * normalSize + x], 0, 1) * 255);
    wavePixels[pixel + 3] = 255;
  }
  const waveNormalMap = new THREE.DataTexture(wavePixels, normalSize, normalSize, THREE.RGBAFormat);
  waveNormalMap.name = 'Original multiscale sea slopes';
  waveNormalMap.wrapS = waveNormalMap.wrapT = THREE.RepeatWrapping;
  waveNormalMap.minFilter = THREE.LinearMipmapLinearFilter;
  waveNormalMap.magFilter = THREE.LinearFilter;
  waveNormalMap.generateMipmaps = true;
  waveNormalMap.anisotropy = 4;
  waveNormalMap.needsUpdate = true;
  const geometry = new THREE.PlaneGeometry(150000, 150000, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      cameraPositionWorld: { value: new THREE.Vector3() },
      sunDirection: { value: SUN_DIRECTION.clone() },
      reflectionMap: { value: null },
      reflectionMatrix: { value: new THREE.Matrix4() },
      reflectionStrength: { value: 0 },
      highQuality: { value: 1 },
      waveNormalMap: { value: waveNormalMap },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec4 vReflection;
      uniform mat4 reflectionMatrix;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.);
        vWorld = world.xyz;
        vReflection = reflectionMatrix * world;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vWorld;
      varying vec4 vReflection;
      uniform float time;
      uniform vec3 cameraPositionWorld;
      uniform vec3 sunDirection;
      uniform sampler2D reflectionMap;
      uniform sampler2D waveNormalMap;
      uniform float reflectionStrength;
      uniform float highQuality;
      ${atmosphereGLSL}

      // Slopes, not displaced vertices: collision height remains exactly sea level.
      // Analytic derivatives also avoid four expensive repeated height evaluations.
      vec2 swell(vec2 p, vec2 direction, float frequency, float speed,
          float slope, float phase, float footprint) {
        float waveFilter = 1. - smoothstep(.55, 2.1, frequency * footprint);
        return direction * cos(dot(p, direction) * frequency + time * speed + phase) * slope * waveFilter;
      }
      float ggxDistribution(float nDotH, float alpha) {
        float a2 = alpha * alpha;
        float denominator = nDotH * nDotH * (a2 - 1.) + 1.;
        return a2 / max(.000025, 3.14159265 * denominator * denominator);
      }
      float smithVisibility(float nDotV, float nDotL, float alpha) {
        float a2 = alpha * alpha;
        float gV = nDotL * sqrt(nDotV * nDotV * (1. - a2) + a2);
        float gL = nDotV * sqrt(nDotL * nDotL * (1. - a2) + a2);
        return .5 / max(.002, gV + gL);
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 toCamera = cameraPositionWorld - vWorld;
        float distanceToCamera = length(toCamera);
        vec3 viewDirection = toCamera / max(distanceToCamera, .001);
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        vec2 broadDrift = vec2(time * -.0019, time * .0006);
        vec2 warp = texture2D(waveNormalMap, p * .00031 + broadDrift * .18).rg * 2. - 1.;
        vec2 waterPoint = p + warp * 95.;
        mat2 directionA = mat2(.819, -.574, .574, .819);
        mat2 directionB = mat2(-.358, -.934, .934, -.358);
        vec3 broadWaves = texture2D(waveNormalMap, waterPoint * .00173 + broadDrift).rgb;
        vec2 mediumWaves = texture2D(waveNormalMap, directionA * waterPoint * .00491 + vec2(time * .0031, time * -.0014)).rg;
        vec2 fineWaves = texture2D(waveNormalMap, directionB * waterPoint * .0113 + vec2(time * -.0037, time * -.0021)).rg;
        vec2 slopes = (broadWaves.rg * 2. - 1.) * .185
          + directionA * (mediumWaves * 2. - 1.) * .115
          + directionB * (fineWaves * 2. - 1.) * .064;
        float phase = warp.x * 7. + warp.y * 3.;
        slopes += swell(p, vec2(.934, .357), .0083, -.31, .010, phase, footprint);
        slopes += swell(p, vec2(-.587, .810), .0131, -.42, .008, phase * 1.37, footprint);
        if (highQuality > .5) {
          vec2 capillaryWaves = texture2D(waveNormalMap, directionA * p * .0317 + vec2(time * .0071, time * .0034)).rg;
          slopes += directionA * (capillaryWaves * 2. - 1.) * .035;
        }
        vec3 normal = normalize(vec3(-slopes.x, 1., -slopes.y));
        float nDotV = max(.001, dot(normal, viewDirection));
        float grazing = 1. - nDotV;
        float fresnel = .0204 + .9796 * pow(grazing, 5.);
        vec3 reflectedDirection = reflect(-viewDirection, normal);
        reflectedDirection.y = max(.018, reflectedDirection.y);
        // Low-quality mode and screen edges still receive the same sky illumination.
        vec3 reflectionColour = clearAtmosphere(normalize(reflectedDirection), sunDirection);

        if (reflectionStrength > .001 && vReflection.w > .0) {
          vec2 uv = vReflection.xy / vReflection.w;
          vec2 distortion = normal.xz * mix(.048, .068, grazing);
          vec2 distortedUV = uv + distortion;
          if (all(greaterThan(distortedUV, vec2(.002))) && all(lessThan(distortedUV, vec2(.998)))) {
            vec3 sceneReflection = texture2D(reflectionMap, distortedUV).rgb;
            // Two-to-four texel blur breaks mirror-sharp mountain edges while
            // retaining recognizable silhouettes in both quality settings.
            vec2 blur = vec2(.0040, .0018) * (1. - grazing * .35);
            sceneReflection = sceneReflection * .46
              + texture2D(reflectionMap, clamp(distortedUV + blur, .001, .999)).rgb * .27
              + texture2D(reflectionMap, clamp(distortedUV - blur, .001, .999)).rgb * .27;
            float border = min(min(distortedUV.x, 1. - distortedUV.x), min(distortedUV.y, 1. - distortedUV.y));
            reflectionColour = mix(reflectionColour, sceneReflection, clamp(reflectionStrength, 0., 1.) * smoothstep(.002, .035, border));
          }
        }

        // Subsurface colour carries broad irregular changes, not periodic bands.
        float waterBody = atmosphereNoise(p * .00047 + vec2(5.3, 9.2));
        vec3 deepWater = mix(vec3(.005, .020, .030), vec3(.012, .047, .056), waterBody);
        vec3 col = deepWater * (1. - fresnel) + reflectionColour * fresnel;

        vec3 halfway = normalize(viewDirection + sunDirection);
        float nDotH = max(0., dot(normal, halfway));
        float nDotL = max(.001, dot(normal, sunDirection));
        float vDotH = max(0., dot(viewDirection, halfway));
        float sunFresnel = .0204 + .9796 * pow(1. - vDotH, 5.);
        // Unresolved waves become roughness rather than distant flashing pixels.
        float unresolved = smoothstep(4., 85., footprint);
        float roughness = mix(.18, .265, unresolved);
        float sunLobe = ggxDistribution(nDotH, roughness)
          * smithVisibility(nDotV, nDotL, roughness) * sunFresnel * nDotL;
        col += vec3(1.04, .86, .61) * min(sunLobe * .52, .72);

        float closeDetail = (1. - smoothstep(1100., 5500., distanceToCamera))
          * (1. - smoothstep(4., 15., footprint));
        if (closeDetail > .001) {
          float foamNoise = atmosphereNoise(p * .047 + vec2(time * .055, time * -.031));
          float foam = smoothstep(.79, .96, foamNoise) * smoothstep(.135, .22, length(slopes));
          col = mix(col, vec3(.47, .56, .58), foam * closeDetail * .21);
        }
        float haze = 1. - exp(-distanceToCamera * .000019);
        vec3 hazeColour = clearAtmosphere(normalize(vec3(-viewDirection.x, .008, -viewDirection.z)), sunDirection);
        col = mix(col, hazeColour * .73, haze * .58);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const ocean = new THREE.Mesh(geometry, material);
  ocean.name = 'Reflecting open sea';
  ocean.frustumCulled = false;
  return ocean;
}
