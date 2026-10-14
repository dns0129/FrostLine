import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { FlightPresentation } from '../flight-presentation.js';
import { WorldRenderer } from '../renderer.js';

// Execute the production RAF callback, simulation, jet transforms and camera.
// Only GPU submission, audio, DOM HUD and combat effects are replaced.
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const frameSource = appSource.slice(appSource.indexOf('function frame(now)'), appSource.indexOf('\nselectVehicle(selectedVehicle);'));
function replay(hz) {
  const sim = new Simulation(7331); sim.start('training'); sim.enemies = []; sim._updateMission = () => {};
  const world = Object.create(WorldRenderer.prototype);
  Object.assign(world, {
    camera: new THREE.PerspectiveCamera(65, 16/9, .5, 90000),
    playerJet: new THREE.Group(), sky: new THREE.Group(), ocean: new THREE.Group(),
    terrain: {userData:{update(){}}},
    sun: new THREE.DirectionalLight(), enemies: new Map(), missileMeshes: [],
    cameraTarget: new THREE.Vector3(), lastPos: new THREE.Vector3(), trail: [], elapsed: 0,
    width: 1280, height: 720, renderer: {info:{reset(){}}, render(){}},
    reflection: {update(){}}, _updateEffects(){},
  });
  world.playerJet.userData.update = () => {};
  world.sky.material = {uniforms:{time:{value:0}}};
  world.ocean.material = {uniforms:{time:{value:0},cameraPositionWorld:{value:new THREE.Vector3()}}};
  const presentation=new FlightPresentation();presentation.reset(sim);
  const context = vm.createContext({sim,world,presentation,frameTime:0,accumulator:0,lastUi:0,cockpit:false,isShip:()=>false,cannonAim:null,
    input:{read:()=>({})},sound:{event(){},update(){}},toast(){},result(){},endingShown:false,
    drawHud(){},readouts(){},diagnostics:null,requestAnimationFrame(){}});
  vm.runInContext(`${frameSource};this.tick=frame`, context);
  const samples=[];
  const coast=new THREE.Vector3(-2400,1,-3700);
  let now=0;
  for(let n=1;now<4000;n++){
    now+=typeof hz==='number'?1000/hz:hz[(n-1)%hz.length];
    context.tick(now);
    assert.equal(sim.state, 'playing');
    if(now>2000){
      const wing=new THREE.Vector3(8,0,3).applyQuaternion(world.playerJet.quaternion).add(world.playerJet.position);
      samples.push({time:now,wing:world.project(wing),coast:world.project(coast)});
    }
  }
  const stats={};
  for(const key of ['wing','coast']){
    let maxSecondDifference=0;
    for(let i=2;i<samples.length;i++){
      const a=samples[i-2][key],b=samples[i-1][key],c=samples[i][key];
      const d1=samples[i-1].time-samples[i-2].time,d2=samples[i].time-samples[i-1].time;
      maxSecondDifference=Math.max(maxSecondDifference,Math.hypot((c.x-b.x)/d2-(b.x-a.x)/d1,(c.y-b.y)/d2-(b.y-a.y)/d1)*Math.min(d1,d2));
    }
    stats[key]=maxSecondDifference;
  }
  const frozenCamera=world.camera.matrixWorld.clone(),frozenOcean=world.ocean.material.uniforms.time.value;
  const frozenAircraft=world.playerJet.position.clone(),frozenElapsed=world.elapsed;
  sim.state='paused';
  for(let n=1;n<=10;n++)context.tick(now+n*1000/60);
  assert.deepEqual(world.camera.matrixWorld.elements,frozenCamera.elements,'pause must freeze the camera');
  assert.deepEqual(world.playerJet.position,frozenAircraft,'pause must freeze the interpolated aircraft');
  assert.equal(world.ocean.material.uniforms.time.value,frozenOcean,'pause must freeze wave time');
  assert.equal(world.elapsed,frozenElapsed,'zero render dt must not become a default animation step');
  return stats;
}
for(const hz of [60,120,144,[8,19,11,24,7,16]])test(`${typeof hz==='number'?`${hz} Hz`:'uneven frame intervals'} straight flight has no alternating aircraft or coastline jumps`,()=>{
  const result=replay(hz);
  console.log(`${hz} Hz max screen acceleration (px/frame²): ${JSON.stringify(result)}`);
  assert.ok(result.wing<.15,`aircraft twitches by ${result.wing.toFixed(4)} px/frame²`);
  assert.ok(result.coast<.015,`coastline twitches by ${result.coast.toFixed(4)} px/frame²`);
});
