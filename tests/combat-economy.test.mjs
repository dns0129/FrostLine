import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation, DESTROYER } from '../simulation.js';
import { AIRCRAFT, normalizeWorkshop, effectiveAircraft, purchaseUpgrade, upgradeAvailability, sortieReward, STORES } from '../aircraft-systems.js';
import { SHIPS } from '../ship-systems.js';
import { PILOT_XP, pilotLevel, pilotProgress, spendAmmunition, PLAYER_DAMAGE_SCALE, AMMO_GRADES, ammoGrade } from '../combat-economy.js';

const DT = 1 / 60;
function combat(vehicle = 'aircraft', wallet = { silver: 1200, gold: 25 }) {
  const sim = new Simulation(7331);
  sim.configureAircraft(normalizeWorkshop({ version: 2, ...wallet }), vehicle === 'j16' ? 'j16' : 'fa18c');
  sim.start('intercept', 'normal', vehicle);
  const target = sim.enemies[0]; sim.enemies = [target];
  target.pos.copy(sim.player.pos).add(new THREE.Vector3(0, vehicle === 'aircraft' || vehicle === 'j16' ? 0 : 500, -1000));
  target.vel.set(0, 0, 0); target.health = target.maxHealth = 1000;
  sim.targetId = target.id; sim._updateLock(2);
  return { sim, target };
}

test('legacy migration retains upgrades, XP and loadouts, converts points once and sanitizes corrupt currencies', () => {
  const legacy = { version: 1, credits: 3141, xp: 2500, levels: { engine: 2, defense: 1 } };
  const p = normalizeWorkshop(legacy), saved = structuredClone(p);
  assert.equal(p.version, 2); assert.equal(p.silver, 3141); assert.equal(p.credits, p.silver); assert.equal(p.gold, 25);
  assert.equal(p.xp, legacy.xp); assert.equal(p.levels.engine, 2); assert.equal(p.levels.defense, 1);
  assert.deepEqual(normalizeWorkshop(p), saved);
  const broken = normalizeWorkshop({ version: 2, silver: -7, gold: Infinity, ammoTiers: { gun: '__proto__', missile: 'toString' } });
  assert.equal(broken.silver, 0); assert.equal(broken.gold, 0); assert.deepEqual(broken.ammoTiers, { missile: 'basic', gun: 'basic' });
  assert.equal(normalizeWorkshop({ version: 2, silver: 100, credits: 999 }).silver, 100);
  assert.equal(legacy.version, 1); assert.equal(legacy.gold, undefined);
});

test('thirty levels have continuous per-level progress and technology unlocks at levels 1, 3, 5, 8, 12', () => {
  assert.equal(PILOT_XP.length, 30); assert.equal(pilotLevel(399), 1); assert.equal(pilotLevel(400), 2);
  for (let index = 1; index < PILOT_XP.length; index++) {
    assert.equal(pilotLevel(PILOT_XP[index] - 1), index);
    assert.equal(pilotLevel(PILOT_XP[index]), index + 1);
    const p = pilotProgress(PILOT_XP[index]); assert.equal(p.current, 0); assert.ok(p.fraction >= 0 && p.fraction <= 1);
  }
  assert.equal(pilotProgress(1e8).level, 30); assert.equal(pilotProgress(1e8).fraction, 1);
  for (const track of ['engine', 'firepower', 'defense', 'maneuver']) {
    let p = normalizeWorkshop({ version: 2, silver: 20000, gold: 19 });
    for (const [tier, level] of [1, 3, 5, 8, 12].entries()) {
      p.levels[track] = tier;
      if (level > 1) { p.xp = PILOT_XP[level - 1] - 1; assert.equal(upgradeAvailability(p, track).allowed, false); }
      p.xp = PILOT_XP[level - 1]; const before = structuredClone(p), result = purchaseUpgrade(p, track);
      assert.equal(result.ok, true); assert.equal(result.profile.levels[track], tier + 1);
      assert.equal(result.profile.gold, 19); assert.ok(result.profile.silver < p.silver); assert.deepEqual(p, before);
      p = result.profile;
    }
    assert.equal(purchaseUpgrade(p, track).ok, false);
  }
});

test('basic, silver and gold ammunition spend only their currency and an insufficient balance falls back without debt', () => {
  for (const kind of ['gun', 'missile']) {
    const wallet = { silver: 30, gold: 4 };
    assert.deepEqual(spendAmmunition(wallet, kind, 'basic').wallet, wallet);
    for (const tier of ['silver', 'gold']) {
      const grade = AMMO_GRADES[kind][tier], paid = spendAmmunition(wallet, kind, tier);
      assert.equal(paid.wallet[tier], wallet[tier] - grade.cost); assert.equal(paid.wallet[tier === 'silver' ? 'gold' : 'silver'], wallet[tier === 'silver' ? 'gold' : 'silver']);
      const fallback = spendAmmunition({ silver: 0, gold: 0 }, kind, tier);
      assert.equal(fallback.tier, 'basic'); assert.equal(fallback.fallback, true); assert.deepEqual(fallback.wallet, { silver: 0, gold: 0 });
      const training = spendAmmunition(wallet, kind, tier, true); assert.equal(training.tier, 'basic'); assert.deepEqual(training.wallet, wallet);
    }
    assert.equal(ammoGrade(kind, '__proto__'), AMMO_GRADES[kind].basic); assert.deepEqual(wallet, { silver: 30, gold: 4 });
  }
});

test('combat aircraft, ships, wingmen, retreat carriers and training targets have doubled base hull strength', () => {
  assert.equal(effectiveAircraft('fa18c', null).maxHealth, 200); assert.equal(effectiveAircraft('j16', null).maxHealth, 250);
  assert.equal(DESTROYER.maxHealth, 600); assert.equal(SHIPS.burke.maxHealth, 840); assert.equal(SHIPS.type052d.maxHealth, 780);
  const sim = new Simulation(); sim.startCampaign('shield');
  assert.equal(sim.carrier.maxHealth, 4400); assert.ok(sim.allies.every(a => a.maxHealth === 270));
  assert.equal(sim.enemies.find(e => e.kind === 'aircraft').maxHealth, 200 * 0.78);
  assert.equal(sim.enemies.find(e => e.kind === 'ship').maxHealth, Math.round(600 * .78));
  sim.start('training'); assert.ok(sim.enemies.every(e => e.maxHealth === 130));
  sim.start('naval-training'); assert.deepEqual(sim.enemies.map(e => e.maxHealth), [240, 360]);
});

for (const vehicle of ['aircraft', 'j16', 'destroyer', 'burke', 'type052d']) test(`${vehicle}: ammunition grades change actual missile hits and deduct exactly once on a valid launch`, () => {
  const damages = [];
  for (const tier of ['basic', 'silver', 'gold']) {
    const { sim, target } = combat(vehicle), before = { ...sim.wallet };
    sim.setAmmoGrade('missile', tier); sim.lockProgress = 0;
    assert.equal(sim.launchMissile(), false); assert.deepEqual(sim.wallet, before);
    sim._updateLock(2); assert.equal(sim.launchMissile(), true);
    const missile = sim.missiles[0], balance = { ...sim.wallet }, grade = AMMO_GRADES.missile[tier];
    assert.equal(missile.ammoGrade, tier); assert.equal(sim.wallet.silver, before.silver - (tier === 'silver' ? 30 : 0));
    assert.equal(sim.wallet.gold, before.gold - (tier === 'gold' ? 4 : 0));
    assert.equal(sim.launchMissile(), false); assert.deepEqual(sim.wallet, balance);
    for (let i = 0; i < 12 * 60 && !sim.hits && target.health === 1000; i++) sim._updateMissiles(DT);
    assert.equal(target.health, 1000 - missile.damage);
    const base = sim.vehicle === 'destroyer' ? sim.shipSystems.samDamage : STORES[missile.store].damage;
    assert.ok(Math.abs(missile.damage - base * PLAYER_DAMAGE_SCALE * grade.multiplier) < 1e-8);
    damages.push(missile.damage);
  }
  assert.ok(damages[0] < damages[1] && damages[1] < damages[2]);
});

test('cannon charge follows successful rounds and rejects cooldown, heat, pause and damaged ship weapons without charge', () => {
  for (const vehicle of ['aircraft', 'j16', 'destroyer', 'burke', 'type052d']) for (const tier of ['basic', 'silver', 'gold']) {
    const { sim } = combat(vehicle), before = { ...sim.wallet }; sim.setAmmoGrade('gun', tier);
    sim.state = 'paused'; sim._fireGun(); assert.deepEqual(sim.wallet, before);
    sim.state = 'playing'; sim.player.overheated = true; sim._fireGun(); assert.deepEqual(sim.wallet, before);
    sim.player.overheated = false; sim._fireGun();
    const round = sim.tracers.at(-1), grade = AMMO_GRADES.gun[tier];
    const base = sim.vehicle === 'destroyer' ? sim.shipSystems.gunDamage : AIRCRAFT[sim.aircraftId].base.gunDamage;
    assert.equal(round.damage, base * PLAYER_DAMAGE_SCALE * grade.multiplier);
    assert.equal(sim.wallet.silver, before.silver - (tier === 'silver' ? 1 : 0)); assert.equal(sim.wallet.gold, before.gold - (tier === 'gold' ? 1 : 0));
    const balance = { ...sim.wallet }; sim._fireGun(); assert.deepEqual(sim.wallet, balance); assert.equal(sim.tracers.length, 1);
    if (sim.player.modules) { sim._gunTimer = 0; sim.player.modules.weapons = 0; sim._fireGun(); assert.deepEqual(sim.wallet, balance); }
  }
});

test('anti-ship grades on both aircraft and ships charge only valid launches and alter real hull impacts', () => {
  for (const vehicle of ['aircraft', 'j16', 'destroyer', 'burke', 'type052d']) for (const tier of ['basic', 'silver', 'gold']) {
    const sim = new Simulation(7331); sim.configureAircraft(normalizeWorkshop(null), vehicle === 'j16' ? 'j16' : 'fa18c');
    sim.start('naval', 'normal', vehicle); const target = sim.enemies[0]; sim.enemies = [target];
    target.health = target.maxHealth = 1000; target.vel.set(0, 0, 0); sim.setAmmoGrade('missile', tier);
    const before = { ...sim.wallet }; assert.equal(sim.launchAntiShipMissile(), false); assert.deepEqual(sim.wallet, before);
    sim._updateAntiShipLock(2); assert.equal(sim.launchAntiShipMissile(), true);
    const m = sim.missiles[0], grade = AMMO_GRADES.missile[tier], balance = { ...sim.wallet };
    assert.equal(m.ammoGrade, tier); assert.equal(sim.wallet.silver, before.silver - (tier === 'silver' ? 30 : 0));
    assert.equal(sim.wallet.gold, before.gold - (tier === 'gold' ? 4 : 0));
    assert.equal(sim.launchAntiShipMissile(), false); assert.deepEqual(sim.wallet, balance);
    const base = sim.vehicle === 'destroyer' ? sim.shipSystems.antiShipDamage : STORES[m.store].damage;
    assert.ok(Math.abs(m.damage - base * PLAYER_DAMAGE_SCALE * grade.multiplier) < 1e-8);
    for (let i = 0; i < 30 * 60 && target.health === 1000; i++) sim._updateMissiles(DT);
    assert.equal(target.health, 1000 - m.damage);
  }
});

test('free reserve weapons work with empty mounted stock, keep certified configurations and never create negative counts', () => {
  for (const vehicle of ['aircraft', 'j16', 'destroyer']) {
    const { sim } = combat(vehicle, { silver: 0, gold: 0 }), configured = structuredClone(sim.player.configuredStores);
    if (sim.player.stores) { sim.player.stores.forEach(s => s.count = 0); sim._refreshAircraftStores(); }
    sim.player.ammo = sim.player.missiles = 0; sim.setAmmoGrade('missile', 'gold');
    assert.equal(sim.launchMissile(), true); assert.equal(sim.missiles[0].ammoGrade, 'basic');
    assert.equal(sim.ammoTiers.missile, 'basic'); assert.equal(sim.player.missiles, 0);
    sim.setAmmoGrade('gun', 'silver'); sim._fireGun(); assert.equal(sim.tracers.at(-1).ammoGrade, 'basic');
    assert.equal(sim.player.ammo, 0); assert.deepEqual(sim.wallet, { silver: 0, gold: 0 });
    if (configured) assert.deepEqual(sim.player.configuredStores, configured);
    const paid = { ...sim.wallet }; sim.start('intercept', 'normal', vehicle); assert.deepEqual(sim.wallet, paid, 'restarting must not refund ammo');
  }
});

test('rewards pay both services, preserve all upgrades and grant chapter gold or endless milestones without training income', () => {
  const p = normalizeWorkshop({ version: 2, silver: 0, gold: 0, levels: { engine: 3 } });
  for (const vehicle of ['aircraft', 'destroyer']) {
    const win = sortieReward(p, { vehicle, mode: 'intercept', won: true, kills: 9, score: 3000 });
    assert.equal(win.silver, 1090); assert.equal(win.gold, 8); assert.equal(win.xp, 1300);
    assert.equal(win.profile.silver, 1090); assert.equal(win.profile.levels.engine, 3); assert.ok(win.levelAfter > win.levelBefore);
    const chapter = sortieReward(p, { vehicle, mode: 'campaign', chapter: 'dawn', won: true, kills: 20 });
    assert.equal(chapter.completionCredits, 500); assert.equal(chapter.gold, 12);
    const loss = sortieReward(p, { vehicle, mode: 'campaign', chapter: 'dawn', won: false, kills: 5 });
    assert.equal(loss.completionCredits, 0); assert.equal(loss.gold, 0); assert.equal(loss.xp, 500);
    const endless = sortieReward(p, { vehicle, mode: 'free', won: false, kills: 25, wavesCleared: 6 }); assert.equal(endless.gold, 4);
    for (const mode of ['training', 'naval-training']) {
      const training = sortieReward(p, { vehicle, mode, won: true, kills: 100 });
      assert.deepEqual(training.profile, p); assert.equal(training.silver + training.gold + training.xp, 0);
    }
  }
});
