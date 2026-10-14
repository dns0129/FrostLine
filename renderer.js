import * as THREE from './vendor/three.module.js';
import { makeTerrain } from './terrain.js';
import { makeJetAssets, makeJet } from './aircraft.js';
import { loadFA18Assets, makeFA18 } from './fa18.js';
import { makeDestroyer, makeDestroyerWake, makeEnemyShip, ENEMY_SHIP_MODELS } from './destroyer.js';
import { makeSky, makeOcean, SUN_DIRECTION } from './atmosphere.js';
import { WaterReflection } from './water-reflection.js';
import { ChaseCamera } from './chase-camera.js';
import { ShipCamera } from './ship-camera.js';
import { SpeedEffects } from './speed-effects.js';
import { AmbientFleet } from './ambient-fleet.js';
export { terrainHeight } from './world-math.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const tmp = new THREE.Vector3();

export function isDestroyer(sim) { return sim.vehicle === 'destroyer' || sim.player?.kind === 'destroyer'; }

// Missile weapon tags are deliberately exact: cannon rounds use kind='ship'
// and must never be interpreted as anti-ship cruise missiles.
export function missileVisualKind(missile) {
  return missile.weapon === 'anti-ship' || missile.kind === 'anti-ship' ? 'anti-ship' : 'sam';
}
function mergeMissileGeometry(parts) {
  const data = { position: [], normal: [], uv: [] };
  for (const source of parts) {
    const geometry = source.index ? source.toNonIndexed() : source;
    for (const name of Object.keys(data)) data[name].push(...geometry.attributes[name].array);
    if (geometry !== source) geometry.dispose(); source.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(data)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, name === 'uv' ? 2 : 3));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}
export function makeMissileAssets(fireMap = null) {
  const sam = new THREE.CylinderGeometry(.16, .16, 2.9, 6); sam.rotateX(Math.PI / 2);
  const body = new THREE.CylinderGeometry(.28, .28, 4.7, 8); body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(.28, 1.1, 8); nose.rotateX(-Math.PI / 2); nose.translate(0, 0, -2.9);
  const wings = new THREE.BoxGeometry(1.85, .075, 1.3); wings.translate(0, 0, .4);
  const tail = new THREE.BoxGeometry(.075, 1.15, .85); tail.translate(0, .1, 1.85);
  const stabilizer = new THREE.BoxGeometry(1.15, .065, .85); stabilizer.translate(0, 0, 1.85);
  const geometries = { sam: mergeMissileGeometry([sam]), 'anti-ship': mergeMissileGeometry([body, nose, wings, tail, stabilizer]) };
  const flame = color => new THREE.SpriteMaterial({ map: fireMap, color, blending: THREE.AdditiveBlending, depthWrite: false });
  return { geometries, materials: {
    sam: new THREE.MeshStandardMaterial({ color: '#b4b9b2', roughness: .95 }),
    'anti-ship': new THREE.MeshStandardMaterial({ color: '#98a38f', roughness: .87, metalness: .16 }),
    samFlame: flame('#ffcc80'), antiShipFlame: flame('#c7e8b4'), enemyFlame: flame('#f6a774'),
  } };
}
function makeMissileMesh(assets, kind) {
  const group = new THREE.Group(); group.name = kind === 'anti-ship' ? 'Anti-ship cruise missile' : 'SAM interceptor';
  const body = new THREE.Mesh(assets.geometries[kind], assets.materials[kind]); body.name = `${kind}-missile-body`; group.add(body);
  const fire = new THREE.Sprite(kind === 'anti-ship' ? assets.materials.antiShipFlame : assets.materials.samFlame);
  fire.name = `${kind}-missile-exhaust`; fire.position.z = kind === 'anti-ship' ? 3.15 : 2.6;
  fire.scale.setScalar(kind === 'anti-ship' ? 5 : 4); group.add(fire);
  group.userData.visualKind = kind; group.userData.kind = kind; group.userData.weapon = kind;
  group.userData.exhaust = fire; return group;
}

// Integrate exponential following over a linearly moving target. Treating the
// whole frame's target movement as an instantaneous jump makes chase distance
// oscillate whenever RAF intervals alternate, even with interpolated aircraft.
function followMovingTarget(position, previous, target, rate, dt) {
  if (dt <= 0) return;
  const decay = Math.exp(-rate * dt);
  const travelWeight = -Math.expm1(-rate * dt) / (rate * dt);
  tmp.copy(target).sub(previous);
  position.sub(previous).multiplyScalar(decay).add(target).addScaledVector(tmp, -travelWeight);
}

// A wide phone in landscape should retain its mobile budget. Explicit quality
// choices still take precedence, including on touch-capable tablets.
export function resolveQuality(requested, width, cores = 8, coarse = false) {
  if(requested==='high'||requested==='low')return requested;
  return coarse||width<850||cores<=4?'low':'high';
}
function deviceQuality(requested,width){return resolveQuality(requested,width,navigator.hardwareConcurrency||8,matchMedia('(pointer: coarse)').matches);}

function canvasTexture(width, draw) {
  const c = document.createElement('canvas'); c.width = c.height = width;
  draw(c.getContext('2d'), width);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function particleTexture() {
  return canvasTexture(128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);g.addColorStop(0, 'rgba(255,244,213,1)');g.addColorStop(.18, 'rgba(248,212,145,.95)');g.addColorStop(.4, 'rgba(205,119,54,.45)');g.addColorStop(1, 'rgba(140,87,45,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  });
}

export class WorldRenderer {
  constructor(canvas, { quality = 'auto' } = {}) {
    this.canvas = canvas; this.quality = quality; this.effectiveQuality = deviceQuality(quality,innerWidth);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.effectiveQuality !== 'low', alpha: false, powerPreference: 'high-performance' });
    this.renderer.info.autoReset=false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .91;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#97abb7'); this.scene.fog = new THREE.FogExp2('#97abb7', .000026);
    this.camera = new THREE.PerspectiveCamera(65, 1, .5, 90000); this.camera.position.set(0, 1115, 4050);
    this.scene.add(new THREE.HemisphereLight('#c5d6e1', '#39444a', 1.35));
    const sun = new THREE.DirectionalLight('#fff0db', 2.5);sun.position.copy(SUN_DIRECTION).multiplyScalar(15000);this.scene.add(sun);this.scene.add(sun.target);this.sun=sun;
    sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-22,right:22,top:22,bottom:-22,near:1,far:180});sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.sky = makeSky(); this.scene.add(this.sky); this.ocean = makeOcean(); this.scene.add(this.ocean); this.terrain = makeTerrain(this.effectiveQuality);this.scene.add(this.terrain);
    this.sky.userData.ready.then(()=>{if(!this.disposed){this._createEnvironment();this.refreshReflection=true;}});
    this.jetAssets = makeJetAssets(); this.playerJet = new THREE.Group(); this.scene.add(this.playerJet);
    this.modelReady = loadFA18Assets().then(assets => {
      if (this.disposed) { assets.dispose(); return; }
      this.fa18Assets = assets; this.scene.remove(this.playerJet);
      this.playerJet = makeFA18(assets, this.jetAssets); this.scene.add(this.playerJet);
      return assets;
    });
    this.playerShip = makeDestroyer(); this.playerShip.visible = false; this.scene.add(this.playerShip);
    this.shipWake = makeDestroyerWake(); this.scene.add(this.shipWake);
    this.ambientFleet = new AmbientFleet(this.scene);
    this.playerJet.traverse(o=>{if(o.isMesh&&!o.material.transparent){o.castShadow=true;o.receiveShadow=true;}});
    this.enemies = new Map(); this.enemyWakes = new Map(); this.missileMeshes = [];
    this.reflection = new WaterReflection(this.renderer, this.scene, this.ocean, { quality: this.effectiveQuality });
    this.tracerGeometry = new THREE.BufferGeometry();this.tracerPositions = new Float32Array(900 * 6);this.tracerColors = new Float32Array(900 * 6);
    this.tracerGeometry.setAttribute('position',new THREE.BufferAttribute(this.tracerPositions,3).setUsage(THREE.DynamicDrawUsage));this.tracerGeometry.setAttribute('color',new THREE.BufferAttribute(this.tracerColors,3).setUsage(THREE.DynamicDrawUsage));this.tracerGeometry.setDrawRange(0,0);
    this.tracerLines = new THREE.LineSegments(this.tracerGeometry,new THREE.LineBasicMaterial({ vertexColors:true,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false }));this.tracerLines.frustumCulled=false;this.tracerLines.userData.skipWaterReflection=true;this.scene.add(this.tracerLines);
    this.trailGeometry=new THREE.BufferGeometry();this.trailPositions=new Float32Array(2*90*6);this.trailGeometry.setAttribute('position',new THREE.BufferAttribute(this.trailPositions,3).setUsage(THREE.DynamicDrawUsage));this.trailGeometry.setDrawRange(0,0);
    this.trailLines=new THREE.LineSegments(this.trailGeometry,new THREE.LineBasicMaterial({color:'#dae6df',transparent:true,opacity:.19,depthWrite:false}));this.trailLines.frustumCulled=false;this.trailLines.userData.skipWaterReflection=true;this.scene.add(this.trailLines);this.trail=[];
    this.fireMap=particleTexture();this.particleSprites=[];
    this.cameraTarget=new THREE.Vector3();this.cameraReady=false;this.previousMode=null;this.lastPos=new THREE.Vector3();this.elapsed=0;
    this.chase=new ChaseCamera();this.shipChase=new ShipCamera();this.cameraZoom=1;
    this.speedEffects=new SpeedEffects(this.scene,{quality:this.effectiveQuality});
    this.resize();
  }
  setQuality(quality) {
    this.quality=quality;this.resize();
  }
  resize() {
    const bounds=this.canvas.getBoundingClientRect();this.width=Math.max(1,bounds.width||innerWidth);this.height=Math.max(1,bounds.height||innerHeight);
    const nextQuality=deviceQuality(this.quality,this.width);
    if(nextQuality!==this.effectiveQuality){
      const oldTerrain=this.terrain;
      this.terrain=makeTerrain(nextQuality);this.scene.add(this.terrain);this.scene.remove(oldTerrain);
      oldTerrain.userData.dispose();this.effectiveQuality=nextQuality;this.refreshReflection=true;
    }
    this.reflection?.setQuality(this.effectiveQuality);
    this.speedEffects?.setQuality(this.effectiveQuality);
    this.ambientFleet?.setQuality(this.effectiveQuality);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,this.effectiveQuality==='low'?1.15:1.5));this.renderer.setSize(this.width,this.height,false);this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();
    this.sky.material.uniforms.highQuality.value=this.effectiveQuality==='high'?1:0;
    this.ocean.material.uniforms.highQuality.value=this.effectiveQuality==='high'?1:0;
    this.reflection?.resize(this.camera);
    this.renderer.shadowMap.enabled=this.effectiveQuality==='high';this.sun.castShadow=this.effectiveQuality==='high';
  }
  _createEnvironment() {
    // PMREM itself uses half-float attachments. Keep direct/hemisphere lighting
    // on devices that cannot render them, instead of creating an invalid target.
    if(!this.renderer.extensions.has('EXT_color_buffer_float')&&!this.renderer.extensions.has('EXT_color_buffer_half_float'))return;
    // Capture once: rough painted metal receives the same sky light as the world.
    const skyScene=new THREE.Scene(),sky=this.sky.clone();sky.position.set(0,0,0);skyScene.add(sky);
    const cube=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType,colorSpace:THREE.LinearSRGBColorSpace});
    const camera=new THREE.CubeCamera(1,90000,cube),tone=this.renderer.toneMapping;
    const generator=new THREE.PMREMGenerator(this.renderer);
    try {
      this.renderer.toneMapping=THREE.NoToneMapping;camera.update(this.renderer,skyScene);
      this.environmentTarget?.dispose();this.environmentTarget=generator.fromCubemap(cube.texture);
      this.scene.environment=this.environmentTarget.texture;this.scene.environmentIntensity=.65;
    } finally {this.renderer.toneMapping=tone;cube.dispose();generator.dispose();}
  }
  _updateJets(sim, dt, menu) {
    const p=sim.player, destroyer=isDestroyer(sim);
    this.sun.position.copy(p.pos).addScaledVector(SUN_DIRECTION,destroyer?230:70);this.sun.target.position.copy(p.pos);this.sun.target.updateMatrixWorld();
    if(this.shadowVehicle!==destroyer){
      const camera=this.sun.shadow.camera, extent=destroyer?76:22;
      Object.assign(camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:1,far:destroyer?460:180});camera.updateProjectionMatrix();
      this.shadowVehicle=destroyer;
    }
    if(destroyer){
      if(!this.playerShip){this.playerShip=makeDestroyer();this.scene.add(this.playerShip);}
      if(this.activeVehicle!=='destroyer')this.playerShip.userData.reset();
      this.playerShip.userData.update(dt,{...p,time:sim.time});
      this.playerShip.position.copy(p.pos);this.playerShip.position.y+=this.playerShip.userData.waveHeight;
      this.playerShip.rotation.set(this.playerShip.userData.wavePitch,p.heading||0,this.playerShip.userData.waveRoll,'YXZ');
      this.playerShip.visible=sim.state!=='lost'||p.health>0;
    }else {
      this.playerJet.position.copy(p.pos);this.playerJet.rotation.set(p.pitch||0,p.heading||0,p.bank||0,'YXZ');
      if(menu){this.playerJet.rotation.set(.035+Math.sin(this.elapsed*.35)*.01,-.16,-.07);this.playerJet.position.y+=Math.sin(this.elapsed*.7)*.8;}
      if(this.playerJet.userData.update)this.playerJet.userData.update(dt,p);
      else {const glow=this.playerJet.userData.exhaust;glow.scale.y=.45+(p.throttle||.6)*.9;glow.material.opacity=.13+(p.throttle||.6)*.18;}
      if(this.playerShip)this.playerShip.visible=false;
    }
    this.activeVehicle=destroyer?'destroyer':'aircraft';
    const active=new Set();this.enemyWakes??=new Map();
    for(const e of (sim.enemies||[])){
      if(e.health<=0)continue;active.add(e.id);let model=this.enemies.get(e.id);
      const ship=e.kind==='ship', type=e.shipType==='frigate'?'frigate':'patrol';
      if(model&&(ship!==(model.userData.kind==='ship')||(ship&&model.userData.shipType!==type))){this._removeEnemy(e.id,model);model=null;}
      if(!model){model=ship?makeEnemyShip(type):makeJet(this.jetAssets,true);this.enemies.set(e.id,model);this.scene.add(model);}
      model.position.copy(e.pos);model.visible=!menu;
      if(ship){
        model.userData.update(dt,{...e,time:sim.time});model.position.y+=model.userData.waveHeight;
        model.rotation.set(model.userData.wavePitch,e.heading||0,model.userData.waveRoll,'YXZ');
        this._updateEnemyWake(e,type,menu);
      }else {model.scale.setScalar(e.commander?1.3:1);model.rotation.set(e.pitch||0,e.heading||0,e.bank||0,'YXZ');model.userData.update?.(dt,{...e,throttle:.67});}
    }
    for(const[id,model]of this.enemies)if(!active.has(id))this._removeEnemy(id,model);
    this._updateMissileMeshes(sim,menu);
    this.playerJet.visible=!destroyer&&(sim.state!=='lost'||p.health>0);
  }
  _updateMissileMeshes(sim,menu) {
    const missiles=sim.missiles||[], count=Math.min(24,missiles.length);
    if(count)this.missileAssets??=makeMissileAssets(this.fireMap);
    for(let i=0;i<Math.max(count,this.missileMeshes.length);i++){
      const missile=i<count?missiles[i]:null;let mesh=this.missileMeshes[i];
      if(missile){
        const kind=missileVisualKind(missile);
        if(mesh&&mesh.userData.visualKind!==kind){
          // The retired group owns no GPU resources: both weapon types reuse
          // this renderer's geometry/materials until the renderer is disposed.
          this.scene.remove(mesh);mesh.clear();mesh=null;
        }
        if(!mesh){mesh=makeMissileMesh(this.missileAssets,kind);this.missileMeshes[i]=mesh;this.scene.add(mesh);}
        mesh.position.copy(missile.pos);mesh.rotation.set(missile.pitch||0,missile.heading||0,0,'YXZ');
        mesh.userData.enemy=!!missile.enemy;
        mesh.userData.exhaust.material=missile.enemy?this.missileAssets.materials.enemyFlame
          :kind==='anti-ship'?this.missileAssets.materials.antiShipFlame:this.missileAssets.materials.samFlame;
      }
      if(mesh)mesh.visible=!!missile&&!menu;
    }
  }
  _updateEnemyWake(enemy,type,menu) {
    let wake=this.enemyWakes.get(enemy.id);
    if(!wake){wake=makeDestroyerWake();wake.name=`enemy-${type}-wake`;this.enemyWakes.set(enemy.id,wake);this.scene.add(wake);}
    const definition=ENEMY_SHIP_MODELS[type], speed=Number.isFinite(enemy.speed)?Math.abs(enemy.speed):0;
    wake.visible=!menu&&speed>.65;
    if(wake.visible){
      const factor=definition.length/110, stretch=.7+clamp(speed/18,0,1)*.3;
      wake.scale.set(definition.beam/20,1,factor*stretch);wake.rotation.y=enemy.heading||0;
      // Keep the front of the wake at the stern even as its length changes.
      const local=definition.length*.47-52*wake.scale.z;
      wake.position.set(enemy.pos.x+Math.sin(wake.rotation.y)*local,.065,enemy.pos.z+Math.cos(wake.rotation.y)*local);
      wake.material.opacity=clamp(speed/14,0,1)*.48;
    }
  }
  _removeEnemy(id,model) {
    this.scene.remove(model);model.userData.dispose?.();this.enemies.delete(id);
    const wake=this.enemyWakes?.get(id);
    if(wake){this.scene.remove(wake);wake.userData.dispose();this.enemyWakes.delete(id);}
  }
  _updateCamera(sim, dt, menu, cockpit) {
    const p=sim.player, destroyer=isDestroyer(sim), pos=destroyer?this.playerShip.position:this.playerJet.position;
    const mode=`${destroyer?'destroyer':'aircraft'}-${menu}-${cockpit}`;
    const reset=!this.cameraReady||mode!==this.previousMode||this.lastPos.distanceToSquared(pos)>1000000;
    this.chase??=new ChaseCamera();
    if(menu){
      const a=.11*Math.sin(this.elapsed*.08),desired=(destroyer?new THREE.Vector3(132+Math.sin(a)*30,57,-125+Math.cos(a)*8):new THREE.Vector3(33+Math.sin(a)*14,10.8,-34+Math.cos(a)*3)).add(pos),target=pos.clone().add(destroyer?new THREE.Vector3(0,8,0):new THREE.Vector3(-5,.1,0));
      this.camera.up.copy(UP);this.camera.fov=47;
      if(reset){this.camera.position.copy(desired);this.cameraTarget.copy(target);}
      else{followMovingTarget(this.camera.position,this.previousCameraDesired,desired,2,dt);followMovingTarget(this.cameraTarget,this.previousCameraLookTarget,target,9,dt);}
      (this.previousCameraDesired??=new THREE.Vector3()).copy(desired);
      (this.previousCameraLookTarget??=new THREE.Vector3()).copy(target);
    }else if(destroyer){
      this.shipChase??=new ShipCamera();this.shipChase.update(this.camera,this.cameraTarget,p,dt,{reset,cockpit,zoom:this.cameraZoom??1});
    }else {
      this.chase.update(this.camera,this.cameraTarget,p,dt,{reset,cockpit,zoom:this.cameraZoom??1,airframeScale:this.playerJet.userData.airframeScale??1});
    }
    if(reset){this.cameraReady=true;this.trail.length=0;}
    this.previousMode=mode;this.lastPos.copy(pos);this.camera.lookAt(this.cameraTarget);this.camera.updateProjectionMatrix();
    if(cockpit&&!menu)this.playerJet.visible=false;
    this.sky.position.copy(this.camera.position);this.ocean.position.x=this.camera.position.x;this.ocean.position.z=this.camera.position.z;
  }
  _updateEffects(sim, dt, menu) {
    const destroyer=isDestroyer(sim);
    let count=0;
    for(const t of sim.tracers||[]){if(count>=900)break;const a=t.prev||t.pos,b=t.pos;const i=count*6;this.tracerPositions.set([a.x,a.y,a.z,b.x,b.y,b.z],i);const c=t.enemy?[1,.29,.10,1,.62,.24]:[1,.67,.25,1,.9,.61];this.tracerColors.set(c,i);count++;}
    this.tracerGeometry.setDrawRange(0,menu?0:count*2);this.tracerGeometry.attributes.position.needsUpdate=true;this.tracerGeometry.attributes.color.needsUpdate=true;
    const list=sim.particles||[], limit=this.effectiveQuality==='low'?45:90;
    for(let i=0;i<Math.max(Math.min(list.length,limit),this.particleSprites.length);i++){
      const p=list[i];let sprite=this.particleSprites[i];
      if(!sprite&&p&&i<limit){sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.fireMap,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));sprite.userData.skipWaterReflection=true;this.scene.add(sprite);this.particleSprites.push(sprite);}
      if(!sprite)continue;sprite.visible=!!p&&i<limit&&!menu;
      if(sprite.visible){const ratio=clamp(p.life/(p.maxLife||p.life||1),0,1),smoke=p.kind==='smoke';sprite.position.copy(p.pos);sprite.material.color.set(smoke?'#535b59':p.kind==='flare'?'#ffedbb':'#ffc582');sprite.material.blending=smoke?THREE.NormalBlending:THREE.AdditiveBlending;sprite.material.opacity=(smoke?.34:.95)*Math.min(1,ratio*3);const size=(p.size||12)*(smoke?1.8:2)*(1+(1-ratio)*1.4);sprite.scale.set(size,size,1);sprite.material.rotation=i*2.399+(1-ratio)*.7;}
    }
    if(destroyer)this.trail.length=0;
    if(!destroyer&&!menu&&sim.state==='playing'&&dt>0){
      const q=this.playerJet.quaternion,pos=this.playerJet.position;
      const tips=this.playerJet.userData.wingtips??[new THREE.Vector3(-8.4,-.1,5.7),new THREE.Vector3(8.4,-.1,5.7)];
      this.trail.push(tips.map(t=>t.clone().applyQuaternion(q).add(pos)));if(this.trail.length>65)this.trail.shift();
    }
    let trailCount=0;
    for(let i=1;i<this.trail.length;i++)for(let side=0;side<2;side++){const a=this.trail[i-1][side],b=this.trail[i][side];this.trailPositions.set([a.x,a.y,a.z,b.x,b.y,b.z],trailCount*6);trailCount++;}
    this.trailGeometry.setDrawRange(0,menu?0:trailCount*2);this.trailGeometry.attributes.position.needsUpdate=true;this.trailLines.material.opacity=.10+Math.min(.12,Math.abs(sim.player.bank||0)*.1);
    if(destroyer&&!this.shipWake){this.shipWake=makeDestroyerWake();this.scene.add(this.shipWake);}
    if(this.shipWake){
      const speed=Number.isFinite(sim.player.speed)?Math.abs(sim.player.speed):0;
      this.shipWake.visible=destroyer&&!menu&&(sim.state==='playing'||sim.state==='paused')&&speed>.65;
      if(this.shipWake.visible){this.shipWake.position.set(sim.player.pos.x,.065,sim.player.pos.z);this.shipWake.rotation.y=sim.player.heading||0;this.shipWake.material.opacity=clamp(speed/18,0,1)*.58;this.shipWake.scale.z=.55+clamp(speed/18,0,1)*.45;}
    }
  }
  render(sim, dt, { menu = false, cockpit = false } = {}) {
    dt=clamp(Number.isFinite(dt)?dt:.016,0,.1);this.elapsed+=dt;this.renderer.info.reset();this._updateJets(sim,dt,menu);this._updateCamera(sim,dt,menu,cockpit);this._updateEffects(sim,dt,menu);
    this.ambientFleet?.update(sim.ambientShips, sim.time);
    this.ocean.material.uniforms.time.value=sim.time??this.elapsed;this.ocean.material.uniforms.cameraPositionWorld.value.copy(this.camera.position);
    this.sky.material.uniforms.time.value=sim.time??this.elapsed;
    this.terrain?.userData.update(sim.time??this.elapsed,this.camera.position);
    this.camera.updateMatrixWorld();
    this.speedEffects?.update(this.camera,sim.player,dt,this.elapsed,{active:!isDestroyer(sim)&&!menu&&(sim.state==='playing'||sim.state==='paused'),cockpit,boostAmount:isDestroyer(sim)?0:this.chase.afterburner});
    this.reflection.update(this.camera,this.elapsed,{force:this.refreshReflection});this.refreshReflection=false;
    this.renderer.render(this.scene,this.camera);
  }
  project(vector) {
    tmp.copy(vector).project(this.camera);return { x:(tmp.x*.5+.5)*this.width,y:(-.5*tmp.y+.5)*this.height,visible:tmp.z>-1&&tmp.z<1&&Math.abs(tmp.x)<1.1&&Math.abs(tmp.y)<1.1 };
  }
  dispose() {
    if(this.disposed)return;
    this.speedEffects?.dispose();
    this.ambientFleet?.dispose();
    this.disposed=true;this.terrain.userData.dispose();this.scene.remove(this.terrain);
    this.playerJet.userData.dispose?.();
    this.scene.remove(this.playerJet);this.fa18Assets?.dispose();
    // Enemy class caches own shared resources. Release their instances before
    // traversing other scene resources, avoiding double disposal or stale refs.
    for(const[id,model]of this.enemies)if(model.userData.kind==='ship')this._removeEnemy(id,model);
    const geometries=new Set(),materials=new Set(),textures=new Set();
    Object.values(this.jetAssets.geometries).forEach(g=>geometries.add(g));
    geometries.add(this.jetAssets.exhaustGeometry);geometries.add(this.jetAssets.exhaustCoreGeometry);
    Object.values(this.jetAssets.materials).forEach(m=>materials.add(m));
    Object.values(this.jetAssets.textures).forEach(t=>textures.add(t));
    this.scene.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material){for(const m of Array.isArray(obj.material)?obj.material:[obj.material]){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}}});
    if(this.missileAssets){Object.values(this.missileAssets.geometries).forEach(g=>geometries.add(g));Object.values(this.missileAssets.materials).forEach(m=>materials.add(m));}
    if(this.fireMap)textures.add(this.fireMap);
    textures.add(this.sky.material.uniforms.skyPanorama.value);textures.add(this.ocean.material.uniforms.waveNormalMap.value);
    this.reflection.dispose();this.environmentTarget?.dispose();this.sun.shadow.dispose();
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());this.renderer.dispose();
  }
}
