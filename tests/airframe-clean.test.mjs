import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {makeFA18} from '../fa18.js';
import {makeJ16} from '../j16.js';
import {makeJetAssets} from '../aircraft.js';
import {Simulation} from '../simulation.js';
import {presetLoadout} from '../aircraft-systems.js';
import {fa18Assets} from './fa18-fixture.mjs';
import {j16Assets} from './j16-fixture.mjs';
const prior=globalThis.document,ctx=new Proxy({},{get:(_,k)=>/create.*Gradient/.test(k)?()=>({addColorStop(){}}):()=>{}});
globalThis.document={createElement:()=>({getContext:()=>ctx})};const jetAssets=makeJetAssets();if(prior===undefined)delete globalThis.document;else globalThis.document=prior;
const resources=root=>{const values=new Set();root.traverse(o=>{if(o.geometry)values.add(o.geometry);if(o.material)values.add(o.material);});return values;};
const triangles=mesh=>(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
for(const [id,assets,make]of [['fa18c',fa18Assets,makeFA18],['j16',j16Assets,makeJ16]]){
 test(`${id}: parked and flying models remove weapon racks, rails, missiles and tanks while preserving the source asset`,()=>{
  const parked=make(assets,jetAssets,{parked:true}),flight=make(assets,jetAssets);let sourceHardware=0;
  assets.scene.traverse(o=>{if(o.name==='FA18_airframe_material_batch_13'||/pylon|launch_rail/.test(o.name))sourceHardware++;});assert.ok(sourceHardware>0);
  for(const jet of [parked,flight]){
   let hardware=0;jet.traverse(o=>{if(o.userData.store||o.name==='FA18_airframe_material_batch_13'||/pylon|launch_rail/.test(o.name))hardware++;});assert.equal(hardware,0);assert.equal(jet.userData.stores.children.length,0);
   jet.userData.setLoadout(presetLoadout('sea',id));assert.equal(jet.userData.stores.children.length,0);
   const size=new THREE.Box3().setFromObject(jet).getSize(new THREE.Vector3());assert.ok(size.z>=assets.metadata.length*.9);assert.ok(size.x<=assets.metadata.span+.05);
  }
  assert.ok(parked.userData.gear.every(o=>o.visible));assert.ok(flight.userData.gear.every(o=>!o.visible));parked.userData.dispose();flight.userData.dispose();
 });
 test(`${id}: launch, automatic refill, pause and repeated updates keep the clean model resource counts stable`,()=>{
  const flight=make(assets,jetAssets),before=resources(flight),sim=new Simulation();sim.configureAircraft(null,id);sim.start('training','normal',id==='j16'?'j16':'aircraft');
  const e=sim.enemies[0];e.pos.copy(sim.player.pos).add(new THREE.Vector3(0,0,-1000));e.vel.set(0,0,0);e.health=10000;sim.enemies=[e];sim.targetId=e.id;sim._updateEnemies=sim._updatePlayer=()=>{};sim._updateLock(2);assert.equal(sim.launchMissile(),true);
  for(let i=0;i<600;i++){sim.update(1/60);flight.userData.update(1/60,sim.player);}assert.equal(sim.player.missiles,1);assert.equal(flight.userData.stores.children.length,0);
  sim.state='paused';const time=sim.time;for(let i=0;i<120;i++){sim.update(1/60);flight.userData.update(0,sim.player);}assert.equal(sim.time,time);assert.deepEqual(resources(flight),before);flight.userData.dispose();
 });
 test(`${id}: disposing one clean instance preserves other instances and their shared airframe geometry`,()=>{
  const first=make(assets,jetAssets),second=make(assets,jetAssets,{parked:true}),shared=resources(assets.cleanScene);let sharedReleased=0,ownedReleased=0;
  for(const value of shared)value.addEventListener('dispose',()=>sharedReleased++);
  for(const plume of [first.userData.exhaust,first.userData.exhaustCore])for(const value of [plume.geometry,plume.material])value.addEventListener('dispose',()=>ownedReleased++);
  first.userData.dispose();first.userData.dispose();assert.equal(ownedReleased,4);assert.equal(sharedReleased,0);assert.ok(second.userData.gear.every(o=>o.visible));assert.equal(second.userData.stores.children.length,0);second.userData.dispose();
 });
}
test('the J-16 removes exactly four isolated integrated pylons without clipping its wing or fuselage triangles',()=>{
 const jet=makeJ16(j16Assets,jetAssets),source=j16Assets.scene.getObjectByName('J16_fuselage,_wings_&_tail'),clean=jet.getObjectByName('J16_fuselage,_wings_&_tail');
 assert.notEqual(source.geometry,clean.geometry);assert.equal(clean.geometry.userData.removedPylons,4);assert.equal(triangles(source)-triangles(clean),4*58);assert.equal(source.geometry.userData.removedPylons,undefined);jet.userData.dispose();
});
