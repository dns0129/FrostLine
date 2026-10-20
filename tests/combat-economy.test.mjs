import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { AIRCRAFT, normalizeWorkshop, effectiveAircraft, purchaseUpgrade, upgradeAvailability, sortieReward, STORES, presetLoadout } from '../aircraft-systems.js';
import { PILOT_XP, pilotLevel, pilotProgress, PLAYER_DAMAGE_SCALE, AMMO_GRADES, AMMO_ORDER, ammoGrade, ownsWeapon, purchaseWeapon, equipWeapon } from '../combat-economy.js';
const DT = 1 / 60;
const allOwned = () => normalizeWorkshop({version:3,silver:10000,gold:1000,ownedWeapons:{missile:AMMO_ORDER,gun:AMMO_ORDER}});
function combat(vehicle = 'aircraft') {
  const sim = new Simulation(7331); sim.configureAircraft(allOwned(), vehicle === 'j16' ? 'j16' : 'fa18c');
  sim.start('intercept', 'normal', vehicle); const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, sim.vehicle === 'aircraft' ? 0 : 500, -1000));
  target.vel.set(0,0,0); target.health = target.maxHealth = 1000;
  sim.targetId = target.id; sim._updateLock(2); sim._updatePlayer = sim._updateEnemies = () => {};
  return {sim,target};
}
const run = (sim,seconds) => {for(let i=0;i<Math.ceil(seconds/DT);i++)sim.update(DT);};

test('migration preserves money, XP and upgrades, owns the old selected weapon once, and prevents forged or repeated unlocks', () => {
  const old = {version:2,silver:3141,gold:42,xp:2500,levels:{engine:2},ammoTiers:{gun:'gold',missile:'silver'}};
  const p = normalizeWorkshop(old); assert.equal(p.version,3); assert.equal(p.silver,3141); assert.equal(p.gold,42);
  assert.equal(p.xp,2500); assert.equal(p.levels.engine,2); assert.deepEqual(p.ownedWeapons,{missile:['basic','silver'],gun:['basic','gold']});
  assert.deepEqual(normalizeWorkshop(p),p); assert.equal(old.version,2);
  const forged=normalizeWorkshop({version:3,silver:-1,gold:Infinity,ammoTiers:{gun:'gold',missile:'__proto__'},ownedWeapons:{gun:['toString'],missile:['__proto__']}});
  assert.deepEqual(forged.ownedWeapons,{missile:['basic'],gun:['basic']}); assert.deepEqual(forged.ammoTiers,{missile:'basic',gun:'basic'});assert.equal(forged.silver+forged.gold,0);
  const legacy=normalizeWorkshop({version:1,credits:1357});assert.equal(legacy.silver,1357);assert.equal(legacy.gold,25);assert.equal(normalizeWorkshop(legacy).gold,25);
});

test('weapon purchases are permanent, charge exactly once, preserve technical progress and equip without any later fee', () => {
  for(const kind of ['gun','missile'])for(const tier of ['silver','gold']){
    const p=normalizeWorkshop({...allOwned(),ownedWeapons:{gun:['basic'],missile:['basic']},xp:2000,levels:{engine:1}}),before=structuredClone(p),grade=ammoGrade(kind,tier);
    assert.equal(equipWeapon(p,kind,tier).ok,false);assert.equal(ownsWeapon(p,kind,tier),false);
    const result=purchaseWeapon(p,kind,tier);assert.equal(result.ok,true);assert.equal(result.profile[grade.currency],p[grade.currency]-grade.cost);
    assert.equal(result.profile.levels.engine,1);assert.equal(result.profile.xp,2000);assert.equal(result.profile.ammoTiers[kind],tier);assert.equal(ownsWeapon(result.profile,kind,tier),true);assert.deepEqual(p,before);
    const repeat=purchaseWeapon(result.profile,kind,tier);assert.equal(repeat.ok,false);assert.deepEqual(repeat.profile,result.profile);
    const basic=equipWeapon(result.profile,kind,'basic');assert.equal(basic.ok,true);const equipped=equipWeapon(basic.profile,kind,tier);assert.equal(equipped.ok,true);assert.deepEqual(equipped.profile,result.profile);
    const poor=normalizeWorkshop({version:3,silver:0,gold:0});assert.equal(purchaseWeapon(poor,kind,tier).ok,false);assert.equal(ownsWeapon(poor,kind,tier),false);
  }
  assert.equal(purchaseWeapon(allOwned(),'toString','gold').ok,false);assert.equal(purchaseWeapon(allOwned(),'gun','__proto__').ok,false);
});

test('thirty-level progression and five technical tier gates remain intact after shop migration',()=>{
  assert.equal(PILOT_XP.length,30);assert.equal(pilotLevel(399),1);assert.equal(pilotLevel(400),2);
  for(let i=1;i<PILOT_XP.length;i++){assert.equal(pilotLevel(PILOT_XP[i]-1),i);assert.equal(pilotProgress(PILOT_XP[i]).current,0);}
  assert.equal(pilotProgress(1e8).level,30);
  for(const track of ['engine','firepower','defense','maneuver']){let p=allOwned();p.silver=20000;
    for(const [tier,level]of [1,3,5,8,12].entries()){
      p.levels[track]=tier;if(level>1){p.xp=PILOT_XP[level-1]-1;assert.equal(upgradeAvailability(p,track).allowed,false);}
      p.xp=PILOT_XP[level-1];const result=purchaseUpgrade(p,track);assert.equal(result.ok,true);assert.deepEqual(result.profile.ownedWeapons,p.ownedWeapons);p=result.profile;
    }
    assert.equal(purchaseUpgrade(p,track).ok,false);
  }
});

test('legacy hardpoints no longer affect clean-airframe performance, fuel, weapon availability or inventories',()=>{
  for(const id of ['fa18c','j16']){
    const a=normalizeWorkshop(null),b=normalizeWorkshop(null);a.loadouts[id]=presetLoadout('sea',id);b.loadouts[id]=presetLoadout('clean',id);
    assert.deepEqual(effectiveAircraft(id,a),effectiveAircraft(id,b));assert.equal(effectiveAircraft(id,a).payloadKg,0);assert.equal(effectiveAircraft(id,a).fuelCapacity,AIRCRAFT[id].real.internalFuelKg);
    const sim=new Simulation();sim.configureAircraft(b,id);sim.start('naval','normal',id==='j16'?'j16':'aircraft');
    assert.deepEqual(sim.player.stores,[]);assert.deepEqual(sim.player.configuredStores,[]);assert.equal(sim.hasWeapon('anti-ship'),true);assert.equal(sim.player.ammo,60);
  }
});

for(const vehicle of ['aircraft','j16','destroyer','burke','type052d'])test(`${vehicle}: owned missile grades cause real different hits with infinite reserve and no per-shot currency charge`,()=>{
  const damages=[];
  for(const tier of AMMO_ORDER){const {sim,target}=combat(vehicle),before={...sim.wallet};assert.equal(sim.setAmmoGrade('missile',tier),true);
    sim.lockProgress=0;assert.equal(sim.launchMissile(),false);sim._updateLock(2);assert.equal(sim.launchMissile(),true);
    const m=sim.missiles[0];assert.equal(m.ammoGrade,tier);assert.equal(sim.missileCooldown,AMMO_GRADES.missile[tier].reload);assert.equal(sim.launchMissile(),false);assert.deepEqual(sim.wallet,before);
    for(let i=0;i<12*60&&target.health===1000;i++)sim._updateMissiles(DT);
    assert.equal(target.health,1000-m.damage);const base=sim.vehicle==='destroyer'?sim.shipSystems.samDamage:STORES[m.store].damage;
    assert.ok(Math.abs(m.damage-base*PLAYER_DAMAGE_SCALE*AMMO_GRADES.missile[tier].multiplier)<1e-8);damages.push(m.damage);
    run(sim,sim.missileCooldown+.1);sim._updateLock(2);assert.equal(sim.launchMissile(),true);assert.deepEqual(sim.wallet,before);
  }
  assert.ok(damages[0]<damages[1]&&damages[1]<damages[2]);
});

test('cannon magazines refill automatically after their cooldown, stay empty until ready and freeze when paused',()=>{
  for(const vehicle of ['aircraft','j16','destroyer','burke','type052d'])for(const tier of AMMO_ORDER){const {sim}=combat(vehicle);sim.setAmmoGrade('gun',tier);sim.player.ammo=1;
    const before={...sim.wallet};sim._fireGun();const base=sim.vehicle==='destroyer'?sim.shipSystems.gunDamage:AIRCRAFT[sim.aircraftId].base.gunDamage;assert.equal(sim.tracers[0].damage,base*PLAYER_DAMAGE_SCALE*AMMO_GRADES.gun[tier].multiplier);assert.equal(sim.player.ammo,0);assert.equal(sim.gunReloadCooldown,AMMO_GRADES.gun[tier].reload);assert.deepEqual(sim.wallet,before);
    const count=sim.tracers.length;sim._gunTimer=0;sim._fireGun();assert.equal(sim.tracers.length,count);
    sim.state='paused';const paused=sim.gunReloadCooldown;run(sim,2);assert.equal(sim.gunReloadCooldown,paused);sim.state='playing';
    run(sim,paused-.1);assert.equal(sim.player.ammo,0);run(sim,.2);assert.equal(sim.player.ammo,sim.player.maxGunMagazine);assert.equal(sim.gunReloadCooldown,0);
    const shots=sim.shots;sim._fireGun();assert.equal(sim.shots,shots+1);assert.deepEqual(sim.wallet,before);
  }
});

test('switching missile type or purchased grade cannot reset active refill timers; locked weapons remain unavailable',()=>{
  const {sim}=combat();sim.setAmmoGrade('missile','gold');assert.equal(sim.launchMissile(),true);const timer=sim.missileCooldown;
  sim.cycleAirWeapon();sim.setAmmoGrade('missile','basic');sim._updateLock(2);assert.equal(sim.launchMissile(),false);assert.equal(sim.missileCooldown,timer);
  sim.player.ammo=1;sim.setAmmoGrade('gun','gold');sim._fireGun();const reload=sim.gunReloadCooldown;sim.setAmmoGrade('gun','basic');assert.equal(sim.gunReloadCooldown,reload);
  const fresh=new Simulation();fresh.start();assert.equal(fresh.setAmmoGrade('missile','gold'),false);assert.equal(fresh.setAmmoGrade('gun','silver'),false);
  const before={...sim.wallet};sim.start('intercept');assert.equal(sim.gunReloadCooldown+sim.missileCooldown+sim.antiShipCooldown,0);assert.equal(sim.player.ammo,60);assert.deepEqual(sim.wallet,before);
});

test('anti-ship weapons use an independent refill cooldown and hit real hulls without currency consumption',()=>{
  for(const vehicle of ['aircraft','j16','destroyer','burke','type052d'])for(const tier of AMMO_ORDER){const sim=new Simulation();sim.configureAircraft(allOwned(),vehicle==='j16'?'j16':'fa18c');sim.start('naval','normal',vehicle);
    const target=sim.enemies[0];sim.enemies=[target];target.health=target.maxHealth=1000;target.vel.set(0,0,0);sim.setAmmoGrade('missile',tier);
    const before={...sim.wallet};sim._updateAntiShipLock(2);assert.equal(sim.launchAntiShipMissile(),true);const m=sim.missiles[0];assert.equal(sim.antiShipCooldown,AMMO_GRADES.missile[tier].reload*1.5);assert.equal(sim.missileCooldown,0);
    assert.equal(sim.launchAntiShipMissile(),false);assert.deepEqual(sim.wallet,before);
    for(let i=0;i<30*60&&target.health===1000;i++)sim._updateMissiles(DT);assert.equal(target.health,1000-m.damage);
  }
});

test('an owned premium weapon stays usable with zero coins, including training and repeated refills',()=>{
  const p=allOwned();p.silver=p.gold=p.credits=0;p.ammoTiers={missile:'gold',gun:'gold'};const sim=new Simulation();sim.configureAircraft(p);sim.start('training');
  const e=sim.enemies[0];sim.enemies=[e];e.pos.copy(sim.player.pos).add(new THREE.Vector3(0,0,-1000));e.vel.set(0,0,0);e.health=1000;sim.targetId=e.id;sim._updateLock(2);
  assert.equal(sim.launchMissile(),true);sim._fireGun();assert.equal(sim.missiles[0].ammoGrade,'gold');assert.equal(sim.tracers[0].ammoGrade,'gold');assert.deepEqual(sim.wallet,{silver:0,gold:0});assert.equal(sim.ammoTiers.missile,'gold');
});

test('wave resupply resets pending refills without granting extra purchases or money, and reward accounting keeps ownership',()=>{
  const {sim}=combat();sim.player.ammo=1;sim._fireGun();sim.launchMissile();sim.enemies=[];const owned=structuredClone(sim.workshop.ownedWeapons),money={...sim.wallet};sim._updateMission(DT);
  assert.equal(sim.player.ammo,60);assert.equal(sim.gunReloadCooldown+sim.missileCooldown+sim.antiShipCooldown,0);assert.deepEqual(sim.workshop.ownedWeapons,owned);assert.deepEqual(sim.wallet,money);
  const p=allOwned(),win=sortieReward(p,{vehicle:'aircraft',mode:'intercept',won:true,kills:9,score:3000});assert.equal(win.silver,1090);assert.equal(win.gold,8);assert.equal(win.xp,1300);assert.deepEqual(win.profile.ownedWeapons,p.ownedWeapons);
});

test('naval readiness changes automatic refill times while retaining infinite reserves',()=>{
  for(const id of ['burke','type052d'])for(const readiness of ['balanced','airDefense','strike']){
    const sim=new Simulation();sim.configureShip(id,readiness);sim.start('training','normal',id);const e=sim.enemies[0];e.pos.copy(sim.player.pos).add(new THREE.Vector3(0,500,-1000));sim.targetId=e.id;sim._updateLock(2);assert.equal(sim.launchMissile(),true);
    assert.equal(sim.missileCooldown,5*(readiness==='airDefense'?.8:readiness==='strike'?1.2:1));
    sim.start('naval-training','normal',id);sim._updateAntiShipLock(2);assert.equal(sim.launchAntiShipMissile(),true);assert.equal(sim.antiShipCooldown,7.5*(readiness==='strike'?.8:readiness==='airDefense'?1.2:1));
  }
});
