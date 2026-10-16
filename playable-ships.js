import * as THREE from './vendor/three.module.js';
import {makeNavalShip,NAVAL_MODELS} from './naval-models.js';

// Same GLB hulls as the scene fleet; only the existing main gun is split into
// a yawing gunhouse and an elevating barrel, sharing the original materials.
export function makePlayableShip(imported,type){
  const source=imported[NAVAL_MODELS[type].asset],root=makeNavalShip(imported,type,undefined,{playable:true}),parts=source.gunParts;
  if(!parts)throw new Error(`Missing controllable main gun: ${type}`);
  const turret=new THREE.Group(),gun=new THREE.Group();turret.name='player-main-turret';gun.name='player-barrel-pitch';
  turret.position.set(0,parts.base,parts.z);gun.position.set(0,parts.offset,-parts.front);
  const house=new THREE.Mesh(parts.house,parts.material),barrel=new THREE.Mesh(parts.barrel,parts.material);
  house.castShadow=barrel.castShadow=true;house.receiveShadow=barrel.receiveShadow=true;turret.add(house,gun);gun.add(barrel);root.add(turret);
  let initialized=false;
  root.name=`Playable ${NAVAL_MODELS[type].name}`;
  Object.assign(root.userData,{kind:'destroyer',shipId:type,turret,gun,waveHeight:0,wavePitch:0,waveRoll:0,
    reset(){initialized=false;root.userData.waveHeight=root.userData.wavePitch=root.userData.waveRoll=0;},
    update(dt,p){if(dt<=0&&initialized)return;initialized=true;turret.rotation.y=(p.turretHeading||0)-(p.heading||0);gun.rotation.x=p.turretPitch||0;const t=p.time||0;root.userData.waveHeight=Math.sin(t*.93)*.09;root.userData.wavePitch=Math.sin(t*.72)*.0018;root.userData.waveRoll=Math.sin(t*.94+.3)*.003;},
    dispose(){} });
  return root;
}
