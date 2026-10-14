import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { makeFA18 } from '../fa18.js';
import { makeJetAssets } from '../aircraft.js';
import { fa18Assets } from './fa18-fixture.mjs';

const context = new Proxy({}, { get: (t,k) => /create.*Gradient/.test(k) ? () => ({addColorStop(){}}) : () => {} });
const prior = globalThis.document;
globalThis.document = { createElement: () => ({getContext:()=>context}) };
const jetAssets = makeJetAssets();
if (prior === undefined) delete globalThis.document; else globalThis.document = prior;

test('shipped Blender asset is Y-up, retains NASA span/length and contains embedded textured geometry', () => {
  const bounds = new THREE.Box3().setFromObject(fa18Assets.scene), size = bounds.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x-12.29)<.002); assert.ok(Math.abs(size.z-17.06)<.002);
  assert.ok(size.y>4 && size.y<5);
  let triangles=0, textured=0, gear=0;
  fa18Assets.scene.traverse(o=>{
    if(o.userData.role==='gear')gear++;
    if(!o.isMesh)return;
    for(const a of Object.values(o.geometry.attributes)) assert.ok(a.array.every(Number.isFinite));
    assert.ok(o.geometry.attributes.uv);
    triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
    if(o.material.map)textured++;
  });
  assert.equal(gear,1); assert.ok(textured>=3); assert.ok(triangles<70000);
});

test('parked and airborne F/A-18 share source resources and have independent gear and boost state',()=>{
  const parked=makeFA18(fa18Assets,jetAssets,{parked:true}),flight=makeFA18(fa18Assets,jetAssets);
  assert.equal(parked.userData.modelId,'fa18c'); assert.ok(parked.userData.gear.every(o=>o.visible));
  assert.ok(flight.userData.gear.every(o=>!o.visible));
  const firstMesh=jet=>{let result;jet.getObjectByName('F/A-18C Blender airframe').traverse(o=>{if(o.isMesh&&!result)result=o;});return result;};
  assert.ok(firstMesh(parked)?.geometry);
  assert.equal(firstMesh(parked).geometry,firstMesh(flight).geometry);
  assert.equal(firstMesh(parked).material,firstMesh(flight).material);
  for(let i=0;i<60;i++){parked.userData.update(1/60,{boost:true,throttle:1});flight.userData.update(1/60,{boost:true,throttle:1});}
  assert.equal(parked.userData.exhaust.visible,false);assert.equal(parked.userData.exhaustCore.visible,false);
  assert.equal(flight.userData.exhaustCore.visible,true);
  assert.ok(flight.userData.airframeScale>.7&&flight.userData.airframeScale<.73);
  for(const tip of flight.userData.wingtips)assert.ok(Math.abs(tip.x)>5.8&&Math.abs(tip.x)<6.2);
  for(const plume of [flight.userData.exhaust,flight.userData.exhaustCore]){
    assert.ok(Math.abs(plume.position.z-7.388)<.01);
    assert.ok(Math.abs(plume.position.y-.064)<.01);
  }
});

test('disposing an F/A-18 instance retains the other aircraft and all shared source resources',()=>{
  const first=makeFA18(fa18Assets,jetAssets),second=makeFA18(fa18Assets,jetAssets,{parked:true});
  let shared=0,owned=0;
  fa18Assets.scene.traverse(o=>{if(o.geometry)o.geometry.addEventListener('dispose',()=>shared++);if(o.material)o.material.addEventListener('dispose',()=>shared++);});
  for(const p of [first.userData.exhaust,first.userData.exhaustCore]){
    p.geometry.addEventListener('dispose',()=>owned++);p.material.addEventListener('dispose',()=>owned++);
  }
  first.userData.dispose();first.userData.dispose();assert.equal(owned,4);assert.equal(shared,0);
  assert.ok(second.userData.gear.every(o=>o.visible));
});

test('custom stores use one draw per visible weapon and dispose their owned resources exactly once',()=>{
  const jet=makeFA18(fa18Assets,jetAssets),geometries=new Set(),materials=new Set();
  jet.userData.stores.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  assert.equal(geometries.size,5);assert.equal(materials.size,5);
  let visible=0;jet.userData.stores.traverse(o=>{if(o.userData.store&&o.visible){visible++;assert.equal(o.children.length,1);}});assert.equal(visible,9);
  jet.userData.setLoadout(Array.from({length:9},(_,i)=>({station:i+1,store:null,count:0})));
  jet.userData.stores.traverse(o=>{if(o.userData.store)assert.equal(o.visible,false);});
  let disposed=0;for(const resource of [...geometries,...materials])resource.addEventListener('dispose',()=>disposed++);
  jet.userData.dispose();jet.userData.dispose();assert.equal(disposed,10);
});
