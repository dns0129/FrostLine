import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { Simulation } from '../simulation.js';
import { CAMPAIGN_LEVELS, normalizeCampaignProgress, campaignUnlocked, recordCampaignWin, campaignObjectiveText } from '../campaign.js';
import { normalizeWorkshop, sortieReward, purchaseUpgrade } from '../aircraft-systems.js';
import { getActiveMap, terrainHeight, setActiveMap } from '../world-math.js';

function clearBatch(sim) { for (const e of sim.enemies) e.health = 0; sim.update(1 / 60); }
function nextBatch(sim) { for (let i = 0; i < 300 && !sim.enemies.length && sim.wave < 5 && sim.state === 'playing'; i++) sim.update(1 / 60); }
function finishWaves(sim) {
  for (let wave = 0; wave < 5 && sim.state === 'playing'; wave++) { clearBatch(sim); nextBatch(sim); }
}
const win = { won: true, health: 100, time: 300, score: 2500 };
test.afterEach(() => setActiveMap('north-atlantic'));

test('ten ordered sorties use ten distinct collision maps, progressive threats and four real friendly aircraft', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 10);
  assert.equal(new Set(CAMPAIGN_LEVELS.map(l => l.mapId)).size, 10);
  for (const [i, level] of CAMPAIGN_LEVELS.entries()) {
    const sim = new Simulation(); sim.start('campaign', 'easy', 'destroyer', level.id);
    assert.equal(sim.vehicle, 'aircraft'); assert.equal(getActiveMap().id, level.mapId);
    assert.equal(sim.allies.length, 3); assert.equal(sim.ambientShips.length, 6);
    assert.equal(sim.enemies.filter(e => e.kind === 'aircraft').length, level.waves[0]);
    assert.equal(sim.enemies.filter(e => e.kind === 'ship').length, level.shipWaves[0]);
    for (const entity of [sim.player, ...sim.allies, ...sim.enemies]) assert.ok(entity.pos.y > terrainHeight(entity.pos.x, entity.pos.z));
    assert.ok(campaignObjectiveText(sim)); assert.ok(Object.isFrozen(level.waves));
    if (i) {
      const previous = CAMPAIGN_LEVELS[i - 1];
      assert.ok(level.healthScale > previous.healthScale && level.turnScale > previous.turnScale && level.damageScale > previous.damageScale);
      assert.ok(level.airTotal >= previous.airTotal && level.shipTotal >= previous.shipTotal && level.rewardPoints > previous.rewardPoints);
    }
  }
  assert.throws(() => new Simulation().startCampaign('unknown'), RangeError);
});

test('first sortie requires exactly five waves totaling twenty aircraft and refills only configured stores', () => {
  const sim = new Simulation(); sim.startCampaign('dawn');
  assert.ok(sim.enemies.every(e => e.missileTimer > 1e8));
  for (const slot of sim.player.stores) if (slot.store !== 'tank') slot.count = 0;
  sim.player.ammo = 20; sim.player.health = 55;
  clearBatch(sim); assert.equal(sim.state, 'playing'); assert.equal(sim.wave, 1);
  assert.equal(sim.player.health, 80); assert.equal(sim.player.ammo, 340);
  assert.deepEqual(sim.player.stores, sim.player.configuredStores);
  for (let wave = 2; wave <= 5; wave++) {
    nextBatch(sim); assert.equal(sim.wave, wave); assert.equal(sim.enemies.length, 4);
    clearBatch(sim); assert.equal(sim.state, wave === 5 ? 'won' : 'playing');
  }
  assert.equal(sim.kills, 20); assert.equal(sim.campaignState.airKills, 20);
});

test('mixed waves wait for air and sea clearance and all ten finales enforce their actual totals', () => {
  for (const level of CAMPAIGN_LEVELS) {
    const sim = new Simulation(); sim.startCampaign(level.id);
    if (level.shipWaves[0]) {
      sim.enemies.filter(e => e.kind !== 'ship').forEach(e => e.health = 0); sim.update(1 / 60);
      assert.equal(sim.wave, 1); assert.equal(sim._waveDelay, -1); assert.equal(sim.state, 'playing');
    }
    finishWaves(sim);
    assert.equal(sim.campaignState.airKills, level.airTotal, level.id);
    assert.equal(sim.campaignState.shipKills, level.shipTotal, level.id);
    if (level.escortDuration) {
      assert.equal(sim.state, 'playing', 'clearing enemies alone cannot finish a retreat');
      sim.time = level.escortDuration; sim._updateCampaignFleet();
      sim.player.pos.copy(sim.campaignState.objectivePos).setY(1200); sim._updateCampaignMission(1 / 60);
    }
    assert.equal(sim.state, 'won', level.id);
    if (level.commanderWave) assert.equal(sim.campaignState.commanderDown, true);
  }
});

test('carrier reaches a real exit, follows a straight route and never grants victory with live threats or a sunk hull', () => {
  const sim = new Simulation(); sim.startCampaign('shield');
  const start = sim.carrier.pos.clone(); sim.time = 90; sim._updateCampaignFleet();
  assert.equal(sim.carrier.pos.z, start.z + 1200); assert.equal(sim.carrier.pos.x, start.x);
  assert.equal(sim.campaignState.retreatElapsed, 90);
  sim.time = 180; sim._updateCampaignFleet();
  assert.equal(sim.carrier.pos.z, start.z + 2400); assert.equal(sim.carrier.speed, 0);
  sim.player.pos.copy(sim.campaignState.objectivePos).setY(1200); sim._updateCampaignMission(.01);
  assert.equal(sim.state, 'playing');
  sim.carrier.health = 0; sim._updateCampaignMission(.01);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'carrier');
});

test('actual enemy shell and guided missile hits damage the carrier independently of the player', () => {
  const sim = new Simulation(); sim.startCampaign('shield'); const playerHP = sim.player.health, carrierHP = sim.carrier.health;
  const pos = sim.carrier.pos.clone().add(new THREE.Vector3(0, 10, 190));
  sim.tracers.push({ pos, prev: pos.clone(), vel: new THREE.Vector3(0, 0, -930), enemy: true, targetId: sim.carrier.id, damage: 25, life: 1 });
  sim._updateTracers(1 / 30); assert.ok(sim.carrier.health < carrierHP); assert.equal(sim.player.health, playerHP);
  const afterShell = sim.carrier.health;
  const source = { pos: sim.carrier.pos.clone().add(new THREE.Vector3(0, 10, 190)), heading: 0, pitch: 0, speed: 400 };
  sim._addMissile(source, true, sim.carrier.id); sim._updateMissiles(1 / 30);
  assert.ok(sim.carrier.health < afterShell); assert.equal(sim.player.health, playerHP);
  const ship = sim.enemies.find(e => e.kind === 'ship'); ship.missileTimer = 0; sim._updateEnemyShip(ship, 1 / 60);
  assert.ok(sim.missiles.some(m => m.enemy && m.targetId === sim.carrier.id), 'destroyer attacks the protected hull');
});

test('a player aircraft can physically lock, launch and sink the new hostile destroyer', () => {
  const sim = new Simulation(); sim.startCampaign('shield', 'easy');
  sim.setAmmoGrade('missile', 'gold');
  const ship = sim.enemies.find(e => e.kind === 'ship');
  ship.pos.set(0, .5, 2500); ship.vel.set(0, 0, 0); ship.passive = true;
  sim.player.pos.set(0, 450, 4000); sim.player.heading = sim.player.pitch = 0; sim.targetId = ship.id;
  for (let step = 0; step < 120; step++) sim._updateAntiShipLock(1 / 60);
  assert.equal(sim.antiShipLockProgress, 1); assert.equal(sim.launchAntiShipMissile(), true);
  const missile = sim.missiles.find(m => m.weapon === 'anti-ship'), launch = missile.pos.clone();
  for (let step = 0; step < 900 && ship.health > 0; step++) sim._updateMissiles(1 / 60);
  assert.ok(missile.pos.distanceTo(launch) > 1000, 'hit must follow a real flight path');
  assert.ok(ship.health <= 0, 'warhead reaches the destroyer hull hit zones');
  sim._removeDestroyed(); assert.equal(sim.campaignState.shipKills, 1);
});

test('leaving carrier defence has a consecutive warning and return resets it; pause and restart reset all combat state', () => {
  const sim = new Simulation(); sim.startCampaign('shield'); sim.player.pos.x = 9000;
  sim._updateCampaignMission(5); assert.equal(sim.campaignState.outsideFor, 5);
  sim.player.pos.copy(sim.campaignState.objectivePos).setY(1200); sim._updateCampaignMission(.01); assert.equal(sim.campaignState.outsideFor, 0);
  sim.state = 'paused'; const before = JSON.stringify({ time: sim.time, mission: sim.campaignState, allies: sim.allies, carrier: sim.carrier });
  sim.update(1 / 60); assert.equal(JSON.stringify({ time: sim.time, mission: sim.campaignState, allies: sim.allies, carrier: sim.carrier }), before);
  sim.state = 'playing'; sim.player.pos.x = 9000; sim._updateCampaignMission(20);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'airspace');
  sim.startCampaign('shield'); assert.equal(sim.carrier.health, sim.carrier.maxHealth); assert.equal(sim.campaignState.outsideFor, 0);
  sim.start('training'); assert.equal(sim.carrier, null); assert.equal(sim.allies.length, 0); assert.equal(sim.campaignState, null);
});

test('wingmen launch physical weapons, share kills, can be shot down and do not count toward player accuracy', () => {
  const sim = new Simulation(); sim.startCampaign('dawn'); const ally = sim.allies[0], enemy = sim.enemies[0];
  assert.deepEqual(new Set(sim.enemies.map(e => e.targetId)), new Set(['player', ...sim.allies.map(a => a.id)]));
  ally.pos.copy(sim.player.pos); ally.heading = 0; ally.pitch = 0; ally.fireTimer = 0; ally.missileTimer = 0;
  enemy.pos.copy(ally.pos).add(new THREE.Vector3(0, 0, -800)); enemy.vel.set(0, 0, 0); enemy.health = 50; // Finish a damaged target with a real allied projectile.
  sim._updateAllies(1 / 60);
  assert.ok(sim.missiles.some(m => m.allied && m.targetId === enemy.id));
  assert.ok(sim.tracers.some(t => t.allied));
  const hits = sim.hits; for (let i = 0; i < 120; i++) { sim._updateMissiles(1 / 60); sim._updateTracers(1 / 60); }
  sim._removeDestroyed(); assert.ok(sim.kills >= 1); assert.equal(sim.hits, hits);
  const playerHP = sim.player.health; sim._damageFriendly(ally, 1000); sim._updateAllies(1 / 60);
  assert.equal(sim.allies.length, 2); assert.equal(sim.player.health, playerHP);
  assert.equal(sim.allies.some(a => sim.enemies.includes(a)), false);
  clearBatch(sim); nextBatch(sim); assert.equal(sim.allies.length, 2, 'resupply cannot revive a wingman');
});

test('commander death alone is insufficient and final timeout or player death cannot become a win', () => {
  const sim = new Simulation(); sim.startCampaign('finale');
  for (let wave = 1; wave < 5; wave++) { clearBatch(sim); nextBatch(sim); }
  const boss = sim.enemies.find(e => e.commander), escort = sim.enemies.find(e => e.kind !== 'ship' && !e.commander);
  assert.equal(boss.maxHealth, escort.maxHealth * 2.2); assert.ok(boss.turnScale > escort.turnScale);
  boss.health = 0; sim.update(1 / 60); assert.equal(sim.campaignState.commanderDown, true); assert.equal(sim.state, 'playing');
  sim.time = 960; sim._updateCampaignMission(.01); assert.equal(sim.endReason, 'time');
  sim.startCampaign('dawn'); finishWaves(sim); sim.startCampaign('dawn');
  sim.enemies.forEach(e => e.health = 0); sim.player.health = 0; sim.update(1 / 60); assert.equal(sim.state, 'lost');
});

test('new save version enforces all ten ordered wins, protects best records and leaves old story progress separate', () => {
  const empty = normalizeCampaignProgress(null);
  assert.deepEqual(normalizeCampaignProgress({ version: 1, completed: { dawn: { passed: true } } }), empty);
  assert.deepEqual(recordCampaignWin(empty, 'shield', win), empty);
  assert.deepEqual(recordCampaignWin(empty, 'dawn', { ...win, won: false }), empty);
  let progress = empty;
  for (const level of CAMPAIGN_LEVELS) {
    assert.equal(campaignUnlocked(progress, level.id), true);
    progress = recordCampaignWin(progress, level.id, win);
    progress = recordCampaignWin(progress, level.id, { won: true, health: 1, time: 9999, score: 1 });
    assert.equal(progress.completed[level.id].stars, 3); assert.equal(progress.completed[level.id].bestScore, 2500);
  }
  assert.equal(Object.keys(progress.completed).length, 10); assert.equal(campaignUnlocked(progress, 'unknown'), false);
  assert.deepEqual(normalizeCampaignProgress({ version: 2, completed: { finale: { passed: true } } }), empty);
});

test('every completed chapter awards spendable upgrade points, replay awards again and failure gets no completion bonus', () => {
  let profile = normalizeWorkshop({ credits: 0, xp: 0 });
  for (const level of CAMPAIGN_LEVELS) {
    const sortie = { vehicle: 'aircraft', mode: 'campaign', chapter: level.id, kills: level.airTotal + level.shipTotal, score: 5000, won: true };
    const reward = sortieReward(profile, sortie);
    assert.equal(reward.completionCredits, level.rewardPoints);
    assert.equal(reward.profile.credits, profile.credits + reward.credits);
    assert.equal(sortieReward(profile, { ...sortie, won: false }).completionCredits, 0);
    const replay = sortieReward(reward.profile, sortie); assert.equal(replay.profile.credits, reward.profile.credits + replay.credits);
    profile = normalizeWorkshop(JSON.parse(JSON.stringify(reward.profile)));
  }
  const upgrade = purchaseUpgrade(profile, 'engine'); assert.equal(upgrade.ok, true); assert.equal(upgrade.profile.levels.engine, 1);
});
