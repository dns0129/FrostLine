import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {Simulation,shipGunOrigin} from '../simulation.js';
import {SHIPS,effectiveShip,normalizeReadiness} from '../ship-systems.js';
import {PLAYER_DAMAGE_SCALE} from '../combat-economy.js';
import {makePlayableShip} from '../playable-ships.js';
import {navalAssets} from './naval-fixture.mjs';

const step=(s,seconds,input={})=>{for(let i=0;i<seconds*60&&s.state==='playing';i++)s.update(1/60,input);};
const forward=(h,p)=>new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(p,h,0,'YXZ'));
test('new ship IDs start the original destroyer simulation with independent stats and default fleet',()=>{
  for(const id of ['burke','type052d']){const s=new Simulation();s.configureShip(id,'airDefense');s.start('naval-training','normal',id);const c=effectiveShip(id,'airDefense');assert.equal(s.vehicle,'destroyer');assert.equal(s.player.shipId,id);assert.equal(s.player.health,c.maxHealth);assert.equal(s.player.maxHealth,c.maxHealth);assert.equal(s.player.missiles,c.maxMissiles);assert.equal(s.player.antiShipMissiles,4);assert.equal(s.ambientShips.length,6);assert.equal(s.enemies.length,2);}
});
test('readiness changes inventory without stacking health or damage and preserves old D-21',()=>{
  for(const id of ['burke','type052d']){const a=effectiveShip(id,'strike'),b=effectiveShip(id,'airDefense');assert.equal(a.maxHealth,b.maxHealth);assert.equal(a.gunDamage,b.gunDamage);assert.equal(a.maxAntiShipMissiles,12);assert.ok(b.maxMissiles>a.maxMissiles);assert.deepEqual(effectiveShip(id,'strike'),a);}
  assert.equal(effectiveShip('destroyer','strike').maxHealth,600);assert.equal(effectiveShip('destroyer','airDefense').maxMissiles,12);assert.equal(normalizeReadiness({burke:'bad'}).burke,'balanced');
});
test('armor reduces actual incoming damage and independent modules, then wave supply restores modules',()=>{
  for(const id of ['burke','type052d']){const s=new Simulation();s.start('intercept','normal',id);const max=s.player.health;s._damagePlayer(100);assert.equal(max-s.player.health,id==='burke'?90:94);assert.ok(s.player.modules.engine<SHIPS[id].modules.engine);assert.equal(s.player.modules.weapons,SHIPS[id].modules.weapons);s.player.modules.weapons=0;assert.equal(s.launchMissile(),false);s._gunTimer=0;const ammo=s.player.ammo;s._fireGun();assert.equal(s.player.ammo,ammo);s.enemies=[];s._waveDelay=-1;step(s,.1);assert.equal(s.player.modules.weapons,SHIPS[id].modules.weapons);assert.equal(s.player.maxHealth,SHIPS[id].maxHealth);}
});
test('new hull cannon fires its configured damage and cooldown with the original controls',()=>{
  for(const id of ['burke','type052d']){const s=new Simulation();s.start('naval-training','normal',id);s._fireGun();assert.equal(s.tracers.at(-1).damage,SHIPS[id].gunDamage*PLAYER_DAMAGE_SCALE);assert.equal(s._gunTimer,SHIPS[id].gunInterval);const ammo=s.player.ammo;s._fireGun();assert.equal(s.player.ammo,ammo);}
});
test('radar SAM channels limit simultaneous launches without consuming blocked ammo',()=>{
  for(const id of ['burke','type052d']){const s=new Simulation();s.start('training','normal',id);const e=s.enemies[0];for(let i=0;i<SHIPS[id].samChannels;i++){s.targetId=e.id;s.lockTarget=e;s.lockProgress=1;s._missileTimer=0;assert.equal(s.launchMissile(),true);}s._missileTimer=0;s.lockProgress=1;s.lockTarget=e;const before=s.player.missiles;assert.equal(s.launchMissile(),false);assert.equal(s.player.missiles,before);assert.ok(s.missiles.every(m=>m.damage===SHIPS[id].samDamage*PLAYER_DAMAGE_SCALE));}
});
test('existing R anti-ship launch uses the chosen hull damage and independent cooldown',()=>{
  for(const id of ['burke','type052d']){const s=new Simulation();s.start('naval-training','normal',id);step(s,1.7);assert.equal(s.launchAntiShipMissile(),true);const m=s.missiles.at(-1);assert.equal(m.damage,SHIPS[id].antiShipDamage*PLAYER_DAMAGE_SCALE);assert.equal(s.antiShipCooldown,SHIPS[id].antiShipInterval);assert.equal(s.missileCooldown,0);assert.equal(s.player.antiShipMissiles,SHIPS[id].maxAntiShipMissiles-1);}
});
test('automatic CIWS launches actual tracers and destroys an incoming missile without using main ammo',()=>{
  const s=new Simulation();s.start('training','normal','type052d');const p=s.player;
  const pos=p.pos.clone().add(new THREE.Vector3(0,12,-450));s.missiles.push({id:'incoming',enemy:true,weapon:'anti-air',pos,prev:pos.clone(),dir:new THREE.Vector3(0,0,1),speed:300,life:10,maxLife:10,smokeTimer:1,targetId:'player',verticalLaunch:0,decoy:null});
  const ammo=p.ammo;let peak=0;for(let i=0;i<54;i++){s.update(1/60);peak=Math.max(peak,p.ciwsHeat);}assert.equal(p.interceptions,1);assert.equal(p.ammo,ammo);assert.ok(peak>0);assert.equal(p.health,p.maxHealth);assert.ok(!s.missiles.some(m=>m.id==='incoming'));
});
test('imported playable hulls preserve model dimensions and animate the original gun on both axes',()=>{
  for(const id of ['burke','type052d']){const model=makePlayableShip(navalAssets,id),c=SHIPS[id];assert.equal(model.userData.modelType,id);assert.ok(model.userData.lod.children[0].children.length>5);assert.ok(navalAssets[id].gunParts.barrel.attributes.position.count>0);for(const heading of [-1,.5]){model.rotation.y=heading;model.userData.update(1/60,{heading,turretHeading:1.1,turretPitch:.35,time:1});model.updateMatrixWorld(true);const direction=new THREE.Vector3(0,0,-1).applyQuaternion(model.userData.gun.getWorldQuaternion(new THREE.Quaternion()));assert.ok(direction.distanceTo(forward(1.1,.35))<1e-8);const pivot=model.userData.gun.getWorldPosition(new THREE.Vector3());assert.ok(pivot.distanceTo(shipGunOrigin({pos:new THREE.Vector3(),heading,turretHeading:1.1,turretY:c.turretY,turretZ:c.turretZ,shipSystems:c}))<.02);}}
});
