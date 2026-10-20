import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { AIRCRAFT, STORES, LOADOUT_PRESETS, presetLoadout, validateLoadout, normalizeLoadout, normalizeWorkshop,
  effectiveAircraft, loadoutSummary, purchaseUpgrade, upgradeAvailability, sortieReward } from '../aircraft-systems.js';

const profile = preset => { const p = normalizeWorkshop(null); if (preset) p.loadouts.fa18c = presetLoadout(preset); return p; };
const run = (sim, seconds, controls = {}) => { for (let i = 0; i < seconds * 60; i++) sim.update(1 / 60, controls); };
function fixedAirTarget(sim, range = 1000) {
  const target = sim.enemies[0]; sim.enemies = [target]; target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, 0, -range));
  target.vel.set(0, 0, 0); target.passive = true; sim.targetId = target.id;
  sim._updateEnemies = () => {}; sim._updatePlayer = () => {};
  return target;
}

test('C Hornet has nine stations and every preset fits the compatible stores and weight limits', () => {
  assert.equal(AIRCRAFT.fa18c.stations.length, 9);
  for (const name of Object.keys(LOADOUT_PRESETS)) {
    const slots = presetLoadout(name), summary = loadoutSummary(slots);
    assert.equal(validateLoadout(slots).valid, true, name);
    assert.ok(summary.payloadKg <= 6215); assert.ok(summary.takeoffKg <= 23537); assert.ok(Math.abs(summary.moment) < 1e-7);
  }
  assert.equal(loadoutSummary(presetLoadout('air')).air, 12);
  assert.equal(loadoutSummary(presetLoadout('sea')).sea, 4);
  assert.equal(loadoutSummary(presetLoadout()).air, 6); assert.equal(loadoutSummary(presetLoadout()).sea, 2);
});

test('rejects incompatible wingtip, fuselage and centreline stores and illegal racks or counts', () => {
  for (const [station, store, count] of [[1,'harpoon',1],[4,'harpoon',1],[5,'aim120',1],[2,'aim120',3],[3,'harpoon',2],[2,'tank',1],[3,'aim120',-1],[3,'aim120',1.5],[1,'toString',1],[1,'__proto__',1]]) {
    const slots = presetLoadout(); Object.assign(slots[station - 1], {store,count});
    assert.equal(validateLoadout(slots).valid, false, `${station} ${store} ${count}`);
  }
});

test('duplicate/missing stations and corrupt saves safely fall back without mutating input', () => {
  const duplicate = presetLoadout(); duplicate[2].station = 2;
  for (const value of [duplicate, [], null, {}, [null], presetLoadout().slice(0,8)]) {
    assert.equal(validateLoadout(value).valid, false); assert.deepEqual(normalizeLoadout(value), presetLoadout());
  }
  const p = normalizeWorkshop({credits:-1,xp:Infinity,levels:{engine:100,firepower:-2,defense:NaN,maneuver:1.8},loadouts:{fa18c:duplicate}});
  assert.deepEqual(p.levels,{engine:5,firepower:0,defense:0,maneuver:1}); assert.equal(p.credits,0); assert.equal(p.xp,0);
  assert.equal(normalizeWorkshop(null).credits,1200);
});

test('heavy stores and unbalanced stores reduce maneuver authority while tanks add real usable game fuel', () => {
  const clean = effectiveAircraft('fa18c', profile('clean')), sea = effectiveAircraft('fa18c', profile('sea'));
  assert.ok(clean.rollRate > sea.rollRate); assert.ok(clean.thrust > sea.thrust); assert.ok(clean.dragCoefficient < sea.dragCoefficient);
  assert.equal(sea.fuelCapacity - clean.fuelCapacity,1000);
  const p = profile('clean'); p.loadouts.fa18c[2] = {station:3,store:'tank',count:1};
  assert.ok(loadoutSummary(p.loadouts.fa18c).warning); assert.ok(effectiveAircraft('fa18c',p).rollRate < clean.rollRate);
});

for (const track of ['engine','firepower','defense','maneuver']) test(`${track}: tier gates, exact costs, five-level cap and no free duplicate upgrade`, () => {
  let p = profile(); const original = structuredClone(p);
  const first = purchaseUpgrade(p,track); assert.equal(first.ok,true); assert.equal(first.profile.credits,900); assert.equal(first.profile.levels[track],1);
  assert.deepEqual(p,original); assert.equal(upgradeAvailability(first.profile,track).allowed,false);
  p = {...first.profile,xp:30000,silver:20000};
  for (let i=2;i<=5;i++) { const result=purchaseUpgrade(p,track); assert.equal(result.ok,true);p=result.profile;assert.equal(p.levels[track],i); }
  const atCap = structuredClone(p); assert.equal(purchaseUpgrade(p,track).ok,false); assert.deepEqual(p,atCap);
  p = {...profile(),silver:0}; assert.equal(purchaseUpgrade(p,track).ok,false); assert.equal(purchaseUpgrade(p,'unknown').ok,false);
});

test('universal upgrades preserve each aircraft base values and do not expand its certified game loadout', () => {
  const p = profile(), upgraded = {...p,levels:{engine:5,firepower:5,defense:5,maneuver:5}};
  const base = effectiveAircraft('fa18c',p), advanced = effectiveAircraft('fa18c',upgraded);
  assert.equal(advanced.maxHealth,280); assert.ok(advanced.thrust > base.thrust); assert.ok(advanced.rollRate > base.rollRate);
  assert.ok(advanced.gunDamage > base.gunDamage); assert.ok(advanced.lockFactor < base.lockFactor); assert.equal(advanced.maxAmmo,578);
  assert.equal(advanced.air,base.air); assert.equal(advanced.sea,base.sea); assert.equal(advanced.payloadKg,base.payloadKg);
  const differentBase = {...AIRCRAFT.fa18c,base:{...AIRCRAFT.fa18c.base,health:80,thrust:30,rollRate:1}};
  const other = effectiveAircraft('fa18c',upgraded,p.loadouts.fa18c,differentBase);
  assert.equal(other.maxHealth,112); assert.ok(other.thrust < advanced.thrust); assert.ok(other.rollRate < advanced.rollRate);
});

test('engine and maneuver upgrades affect actual acceleration, roll and fuel consumption', () => {
  const base = new Simulation(), upgraded = new Simulation(), p = profile('clean');
  base.configureAircraft(p); p.levels.engine=5;p.levels.maneuver=5;upgraded.configureAircraft(p);
  base.start('training'); upgraded.start('training');
  run(base,1,{boost:true,roll:.5});run(upgraded,1,{boost:true,roll:.5});
  assert.ok(upgraded.player.speed > base.player.speed); assert.ok(upgraded.player.rollRate > base.player.rollRate);
  assert.ok(upgraded.player.fuelKg > base.player.fuelKg);
  upgraded.start('training'); assert.equal(upgraded.player.maxHealth,200);assert.equal(upgraded.player.systems.thrust,effectiveAircraft('fa18c',p).thrust);
});

test('defense and firepower change real damage, HP, flares and cannon damage', () => {
  const p=profile();p.levels.defense=5;p.levels.firepower=5;
  const sim=new Simulation();sim.configureAircraft(p);sim.start('training');
  assert.equal(sim.player.health,280);assert.equal(sim.player.flares,8);sim._damagePlayer(40);assert.equal(sim.player.health,245);
  sim._fireGun();assert.ok(sim.tracers[0].damage>24);sim.deployFlare();assert.ok(sim.player.flareTime>2.6);
  sim.start('training');assert.equal(sim.player.health,280);
  sim.start('training','normal','destroyer');assert.equal(sim.player.maxHealth,600);assert.equal(sim.player.systems,undefined);
});

test('mixed air weapon selection enables medium/long range while near-range stores cannot lock the same target', () => {
  const sim=new Simulation();sim.start('training');fixedAirTarget(sim,5000);
  run(sim,1.5);assert.equal(sim.lockProgress,0);assert.equal(sim.launchMissile(),false);
  assert.equal(sim.cycleAirWeapon(),true);assert.equal(sim.player.selectedAirWeapon,'aim120');run(sim,1.2);assert.equal(sim.lockProgress,1);
  const inventory=sim.player.missiles, surface=sim.player.antiShipMissiles;assert.equal(sim.launchMissile(),true);
  const missile=sim.missiles[0];assert.equal(missile.store,'aim120');assert.ok([2,4,6,8].includes(missile.station));
  assert.equal(sim.player.missiles,inventory-1);assert.equal(sim.player.antiShipMissiles,surface);assert.equal(sim.antiShipCooldown,0);
  assert.equal(sim.launchMissile(),false);assert.ok(missile.life>STORES.aim9.life);
});

test('AIM-7 requires maintained radar tracking while AIM-120 keeps its launched target', () => {
  const p=profile('clean');p.loadouts.fa18c[3]={station:4,store:'aim7',count:1};
  const sim=new Simulation();sim.configureAircraft(p);sim.start('training');const target=fixedAirTarget(sim);
  sim.cycleAirWeapon();run(sim,1.6);assert.equal(sim.launchMissile(),true);sim.targetId=null;
  const missile=sim.missiles[0], heading=missile.dir.clone();target.pos.x+=300;
  sim._updateMissiles(1/60);assert.ok(missile.dir.distanceTo(heading)<1e-9);assert.ok(missile.life>0);
  sim.targetId=target.id;sim._updateMissiles(1/60);assert.ok(missile.dir.distanceTo(heading)>0);
});

test('aircraft Harpoon locks a sea target, launches without VLS, and scores a real sinking', () => {
  const sim=new Simulation();sim.configureAircraft(profile('sea'));sim.start('naval-training','normal','aircraft');
  assert.equal(sim.vehicle,'aircraft');assert.equal(sim.player.antiShipMissiles,4);
  sim._updatePlayer=()=>{};sim._updateEnemies=()=>{};run(sim,1.6);assert.equal(sim.antiShipLockProgress,1);
  const air=sim.player.missiles;assert.equal(sim.launchMissile(),false);assert.equal(sim.launchAntiShipMissile(),true);
  assert.equal(sim.player.antiShipMissiles,3);assert.equal(sim.player.missiles,air);assert.equal(sim.missileCooldown,0);
  assert.equal(sim.missiles[0].shipLaunched,false);assert.equal(sim.missiles[0].verticalLaunch,0);assert.ok([2,3,7,8].includes(sim.missiles[0].station));
  run(sim,12);assert.equal(sim.kills,0);assert.equal(sim.launchAntiShipMissile(),true);run(sim,12);assert.ok(sim.kills>=1);assert.ok(sim.drainEvents().some(e=>e.type==='hit'&&e.weapon==='anti-ship'));
});

test('wave supply respects selected stores and capacities and never creates unconfigured Harpoons', () => {
  const sim=new Simulation();sim.configureAircraft(profile('air'));sim.start('intercept');
  for(const slot of sim.player.stores)slot.count=0;sim._refreshAircraftStores();assert.equal(sim.player.missiles,0);
  sim.enemies.forEach(e=>e.health=0);sim.update(1/60);assert.equal(sim.player.missiles,3);assert.equal(sim.player.antiShipMissiles,0);
  for(let n=0;n<8;n++)sim._refillAircraftStores();assert.equal(sim.player.missiles,12);
  for(const slot of sim.player.stores)assert.ok(slot.count<=sim.player.configuredStores.find(s=>s.station===slot.station).count);
  sim.configureAircraft(profile('clean'));sim.startCampaign('dawn');assert.equal(sim.player.missiles,2);assert.equal(sim.player.antiShipMissiles,0);
});

test('reward accounting pays real air and naval combat while rejecting training and no-kill failures', () => {
  const p=profile();
  for(const sortie of [{mode:'training',won:true,kills:3},{mode:'naval-training',won:true,kills:2},{mode:'intercept',won:false,kills:0}]) {
    const reward=sortieReward(p,sortie);assert.equal(reward.credits,0);assert.equal(reward.xp,0);assert.deepEqual(reward.profile,p);
  }
  const win=sortieReward(p,{vehicle:'aircraft',mode:'intercept',won:true,kills:9,score:3000});
  assert.equal(win.xp,1300);assert.equal(win.credits,1090);assert.equal(win.profile.credits,2290);assert.deepEqual(p,profile());
  assert.ok(sortieReward(p,{mode:'naval',vehicle:'aircraft',won:false,kills:1}).silver>0);assert.ok(sortieReward(p,{mode:'naval',vehicle:'destroyer',won:true,kills:9}).gold>0);
});

test('fuel exhaustion stops engine thrust and boost while pause freezes fuel and inventories', () => {
  const sim=new Simulation();sim.start('training');sim.player.fuelKg=0;const speed=sim.player.speed;
  sim.update(1/60,{boost:true});assert.equal(sim.player.boost,false);assert.ok(sim.player.speed<speed);
  sim.state='paused';const snapshot=JSON.stringify(sim.player);run(sim,2,{boost:true,fire:true});assert.equal(JSON.stringify(sim.player),snapshot);
});

const j16Profile = preset => { const p = normalizeWorkshop(null); if (preset) p.loadouts.j16 = presetLoadout(preset, 'j16'); return p; };
const j16Sim = (preset, mode = 'training') => { const sim = new Simulation(); sim.configureAircraft(j16Profile(preset), 'j16'); sim.start(mode, 'normal', 'j16'); return sim; };

test('J-16 registers its own base values, real references and eight symmetric stations', () => {
  const j16 = AIRCRAFT.j16;
  assert.deepEqual(j16.real, { emptyKg: 17700, internalFuelKg: 9400, maxTakeoffKg: 35000, maxPayloadKg: 8000, cannonRounds: 150, engineThrustKN: 270 });
  assert.equal(j16.stations.length, 8); assert.deepEqual(Object.keys(j16.presets), Object.keys(LOADOUT_PRESETS));
  for (const s of j16.stations) {
    const mirror = j16.stations.find(o => o.id === 9 - s.id);
    assert.ok(mirror.x === -s.x); assert.deepEqual(mirror.allowed, s.allowed); assert.equal(mirror.limitKg, s.limitKg);
    for (const [store, count] of Object.entries(s.allowed)) { assert.equal(count, 1); assert.ok(STORES[store].massKg <= s.limitKg); }
  }
  for (const name of Object.keys(j16.presets)) {
    const slots = presetLoadout(name, 'j16'), summary = loadoutSummary(slots, 'j16');
    assert.equal(validateLoadout(slots, 'j16').valid, true, name);
    assert.ok(summary.takeoffKg <= 35000); assert.ok(Math.abs(summary.moment) < 1e-7);
  }
  assert.deepEqual([presetLoadout('multirole', 'j16'), presetLoadout('air', 'j16'), presetLoadout('sea', 'j16')].map(s => {
    const x = loadoutSummary(s, 'j16'); return [x.air, x.sea]; }), [[6, 2], [8, 0], [4, 2]]);
  // Hornet stores never fit the J-16 and vice versa.
  for (const [station, store] of [[1, 'aim9'], [2, 'harpoon'], [3, 'yj83k'], [4, 'tank'], [1, 'pl15'], [8, 'yj83k']]) {
    const slots = presetLoadout('multirole', 'j16'); Object.assign(slots[station - 1], { store, count: 1 });
    assert.equal(validateLoadout(slots, 'j16').valid, false, `${station} ${store}`);
  }
  const hornet = presetLoadout(); hornet[0] = { station: 1, store: 'pl10', count: 1 }; assert.equal(validateLoadout(hornet).valid, false);
  assert.deepEqual(normalizeWorkshop(null).loadouts.j16, presetLoadout('multirole', 'j16'));
  assert.deepEqual(normalizeWorkshop({ loadouts: { j16: presetLoadout() } }).loadouts.j16, presetLoadout('multirole', 'j16'));
});

test('shared technology levels apply to the J-16 base values without changing its loadout or gun', () => {
  const p = j16Profile(), upgraded = { ...p, levels: { engine: 5, firepower: 5, defense: 5, maneuver: 5 } };
  const base = effectiveAircraft('j16', p), advanced = effectiveAircraft('j16', upgraded), hornet = effectiveAircraft('fa18c', p);
  assert.equal(base.maxHealth, 250); assert.equal(advanced.maxHealth, 350); assert.equal(base.maxAmmo, 150); assert.equal(advanced.maxAmmo, 150);
  assert.equal(base.maxFlares, 8); assert.ok(base.gunDamage > hornet.gunDamage); assert.ok(base.rollRate < hornet.rollRate);
  assert.equal(base.fuelCapacity, 9400); assert.ok(advanced.thrust > base.thrust);
  assert.equal(advanced.air, base.air); assert.equal(advanced.sea, base.sea); assert.equal(advanced.payloadKg, base.payloadKg);
});

test('a configured J-16 sortie flies its own airframe, PL-15 range and station launch points', () => {
  const sim = j16Sim('air'); assert.equal(sim.vehicle, 'aircraft'); assert.equal(sim.player.aircraftId, 'j16');
  assert.equal(sim.player.ammo, 150); assert.equal(sim.player.health, 250); assert.equal(sim.player.missiles, 8);
  assert.equal(sim.player.selectedAirWeapon, 'pl10');
  fixedAirTarget(sim, 7000); run(sim, 1.5); assert.equal(sim.lockProgress, 0);
  assert.equal(sim.cycleAirWeapon(), true); assert.equal(sim.player.selectedAirWeapon, 'pl15'); run(sim, 1.3); assert.equal(sim.lockProgress, 1);
  assert.equal(sim.launchMissile(), true); const missile = sim.missiles[0];
  assert.equal(missile.store, 'pl15'); assert.equal(missile.maxSpeed, STORES.pl15.speed); assert.ok([2, 3, 4, 5, 6, 7].includes(missile.station));
  const station = AIRCRAFT.j16.stations.find(s => s.id === missile.station);
  assert.ok(missile.pos.distanceTo(sim.player.pos.clone().add(new THREE.Vector3(...station.position))) < 1e-6);
  sim._fireGun(); assert.equal(sim.tracers.at(-1).damage, 34); assert.equal(sim.player.ammo, 149);
});

test('J-16 YJ-83K uses its own range, speed and damage and sinks a real target', () => {
  const sim = j16Sim('sea', 'naval-training'); assert.equal(sim.player.antiShipMissiles, 2);
  assert.ok(sim.drainEvents().some(e => e.text?.includes('歼-16对海出击')));
  sim._updatePlayer = () => {}; sim._updateEnemies = () => {};
  const target = sim.enemies.find(e => e.id === sim.targetId) || sim.enemies[0]; sim.targetId = target.id;
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, -sim.player.pos.y + .5, -7300));
  run(sim, 1.6); assert.equal(sim.antiShipLockProgress, 1, 'YJ-83K locks beyond the 7 km Harpoon range');
  assert.equal(sim.launchAntiShipMissile(), true); const missile = sim.missiles[0];
  assert.equal(missile.store, 'yj83k'); assert.equal(missile.maxSpeed, 290); assert.equal(missile.damage, 212.5); assert.ok([2, 7].includes(missile.station));
  run(sim, 40); assert.equal(sim.kills, 0); assert.equal(sim.launchAntiShipMissile(), true); run(sim, 40); assert.ok(sim.kills >= 1); assert.equal(sim.player.antiShipMissiles, 0);
});

test('J-16 wave supply only restores configured stores and its own cannon capacity', () => {
  const sim = j16Sim('multirole', 'intercept');
  for (const slot of sim.player.stores) slot.count = 0; sim._refreshAircraftStores(); sim.player.ammo = 0;
  sim.enemies.forEach(e => e.health = 0); sim.update(1 / 60);
  assert.equal(sim.player.missiles, 3); assert.equal(sim.player.antiShipMissiles, 2); assert.equal(sim.player.ammo, 150);
  for (const slot of sim.player.stores) assert.ok(slot.count <= sim.player.configuredStores.find(s => s.station === slot.station).count);
});

test('campaign chapters fly whichever aircraft the player configured', () => {
  const sim = new Simulation(); sim.configureAircraft(j16Profile('clean'), 'j16'); sim.startCampaign('dawn');
  assert.equal(sim.player.aircraftId, 'j16'); assert.equal(sim.player.missiles, 2); assert.equal(sim.player.ammo, 150);
  sim.configureAircraft(profile('clean')); sim.startCampaign('dawn'); assert.equal(sim.player.aircraftId, 'fa18c'); assert.equal(sim.player.ammo, 578);
});

test('an empty J-16 air-to-air inventory still reports a J-16 weapon, not the Hornet AIM-9M', () => {
  const sim = j16Sim('air'); for (const slot of sim.player.stores) if (STORES[slot.store]?.kind === 'anti-air') slot.count = 0;
  sim._refreshAircraftStores(); assert.equal(sim.player.missiles, 0); assert.equal(sim.player.selectedAirWeapon, 'pl10');
  const hornet = new Simulation(); hornet.configureAircraft(profile('clean')); hornet.start('training');
  for (const slot of hornet.player.stores) slot.count = 0; hornet._refreshAircraftStores(); assert.equal(hornet.player.selectedAirWeapon, 'aim9');
});
