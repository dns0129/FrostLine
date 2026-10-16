import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../simulation.js';
import { CAMPAIGN_LEVELS, normalizeCampaignProgress, campaignUnlocked, recordCampaignWin, campaignObjectiveText } from '../campaign.js';

function clearBatch(sim) { for (const e of sim.enemies) e.health = 0; sim.update(1 / 60); }
function waitForBatch(sim) { for (let i = 0; i < 300 && !sim.enemies.length && sim.state === 'playing'; i++) sim.update(1 / 60); }
function guardFixture() { const sim = new Simulation(); sim.startCampaign('shield', 'easy'); sim.player.pos.copy(sim.campaignState.objectivePos); sim.player.pos.y = 1250; return sim; }

test('all three campaign chapters have distinct goals, original story and aircraft-only sorties with six sailing ships', () => {
  assert.equal(CAMPAIGN_LEVELS.length, 3);
  for (const level of CAMPAIGN_LEVELS) {
    const sim = new Simulation(); sim.start('campaign', 'easy', 'destroyer', level.id);
    assert.equal(sim.mode, 'campaign'); assert.equal(sim.vehicle, 'aircraft'); assert.equal(sim.campaignId, level.id);
    assert.equal(sim.ambientShips.length, 6); assert.equal(sim.enemies.length, 2);
    assert.ok(level.story.length > 40 && level.ending.length > 30 && level.objectives.length === 2);
    assert.ok(campaignObjectiveText(sim).length > 0);
  }
  const sim = new Simulation(); assert.throws(() => sim.startCampaign('unknown'), RangeError);
});

test('chapter one completes only after both batches are defeated and resupplies between batches', () => {
  const sim = new Simulation(); sim.startCampaign('dawn');
  assert.ok(sim.enemies.every(e => e.missileTimer > 1e8));
  sim.player.missiles = 0; for(const slot of sim.player.stores)if(['aim9','aim7','aim120'].includes(slot.store))slot.count=0; sim.player.ammo = 20; sim.player.health = 55;
  clearBatch(sim); assert.equal(sim.state, 'playing'); assert.equal(sim.wave, 1);
  assert.equal(sim.player.missiles, 3); assert.equal(sim.player.ammo, 340); assert.equal(sim.player.health, 80);
  waitForBatch(sim); assert.equal(sim.wave, 2); assert.equal(sim.enemies.length, 2);
  clearBatch(sim); assert.equal(sim.state, 'won'); assert.equal(sim.kills, 4);
});

test('chapter two requires 90 actual seconds in the moving defence zone AND six kills', () => {
  const sim = guardFixture(); sim.campaignState.guardElapsed = 90; sim.time = 91; sim.kills = 5;
  sim._updateCampaignMission(1 / 60); assert.equal(sim.state, 'playing');
  sim.kills = 6; sim.campaignState.guardElapsed = 89; sim._updateCampaignMission(1 / 60); assert.equal(sim.state, 'playing');
  sim.campaignState.guardElapsed = 90; sim._updateCampaignMission(1 / 60); assert.equal(sim.state, 'won');
});

test('leaving the defence zone stops guard credit, returning clears consecutive warning, and ten seconds outside loses', () => {
  const sim = guardFixture(); sim.campaignState.guardElapsed = 30; sim.player.pos.x += 5000;
  for (let i = 0; i < 300; i++) sim._updateCampaignMission(1 / 60);
  assert.equal(sim.campaignState.guardElapsed, 30); assert.ok(sim.campaignState.outsideFor > 4.9); assert.equal(sim.state, 'playing');
  sim.player.pos.copy(sim.campaignState.objectivePos); sim._updateCampaignMission(1 / 60); assert.equal(sim.campaignState.outsideFor, 0);
  assert.ok(sim.campaignState.guardElapsed > 30); sim.player.pos.x += 5000;
  for (let i = 0; i < 610 && sim.state === 'playing'; i++) sim._updateCampaignMission(1 / 60);
  assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'airspace');
});

test('reinforcements respect six-enemy cap, follow the carrier and chapter two can time out without false victory', () => {
  const sim = guardFixture();
  for (let t = 22; t <= 88; t += 22) { sim.time = t; sim._updateCampaignMission(.01); }
  assert.equal(sim.enemies.length, 6); sim.ambientShips[0].pos.x += 300; sim._updateCampaignMission(.01);
  assert.equal(sim.campaignState.objectivePos.x, sim.ambientShips[0].pos.x);
  sim.time = 150; sim._updateCampaignMission(.01); assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'time');
});

test('final chapter introduces the larger tougher commander and requires its remaining escorts too', () => {
  const sim = new Simulation(); sim.startCampaign('finale', 'normal');
  for (let wave = 0; wave < 2; wave++) { clearBatch(sim); waitForBatch(sim); }
  assert.equal(sim.wave, 3); const boss = sim.enemies.find(e => e.commander), escort = sim.enemies.find(e => !e.commander);
  assert.ok(boss); assert.equal(boss.maxHealth, escort.maxHealth * 2); assert.ok(boss.turnScale > escort.turnScale);
  boss.health = 0; sim.update(1 / 60); assert.equal(sim.campaignState.commanderDown, true); assert.equal(sim.state, 'playing');
  clearBatch(sim); assert.equal(sim.state, 'won'); assert.equal(sim.kills, 7);
  sim.startCampaign('finale'); sim.time = 210; sim._updateCampaignMission(.01); assert.equal(sim.state, 'lost'); assert.equal(sim.endReason, 'time');
});

test('pause freezes defence credit and radio; restart and quick missions clear all campaign state', () => {
  const sim = guardFixture(); sim.update(1 / 60); sim.drainEvents(); sim.state = 'paused';
  const before = JSON.stringify({ time: sim.time, state: sim.campaignState });
  for (let i = 0; i < 120; i++) sim.update(1 / 60);
  assert.equal(JSON.stringify({ time: sim.time, state: sim.campaignState }), before); assert.deepEqual(sim.drainEvents(), []);
  sim.startCampaign('shield'); assert.equal(sim.campaignState.guardElapsed, 0); assert.equal(sim.campaignState.outsideFor, 0);
  sim.start('training'); assert.equal(sim.campaignId, null); assert.equal(sim.campaignState, null); assert.equal(sim.enemies.length, 3);
});

test('only valid ordered wins unlock chapters; failed retries and lower scores do not overwrite best records', () => {
  const empty = normalizeCampaignProgress(null), won = { won: true, health: 80, time: 70, score: 1200 };
  assert.equal(campaignUnlocked(empty, 'dawn'), true); assert.equal(campaignUnlocked(empty, 'shield'), false);
  assert.deepEqual(recordCampaignWin(empty, 'shield', won), empty);
  assert.deepEqual(recordCampaignWin(empty, 'dawn', { ...won, won: false }), empty);
  let progress = recordCampaignWin(empty, 'dawn', won); assert.equal(campaignUnlocked(progress, 'shield'), true);
  progress = recordCampaignWin(progress, 'dawn', { won: true, health: 10, time: 999, score: 200 });
  assert.equal(progress.completed.dawn.stars, 3); assert.equal(progress.completed.dawn.bestScore, 1200);
  progress = recordCampaignWin(progress, 'shield', won); assert.equal(campaignUnlocked(progress, 'finale'), true);
  progress = recordCampaignWin(progress, 'finale', won); assert.equal(Object.keys(progress.completed).length, 3);
  assert.equal(campaignUnlocked(progress, 'unknown'), false);
  assert.deepEqual(normalizeCampaignProgress({ version: 1, completed: { finale: { passed: true, stars: 3, bestScore: 100 } } }), empty);
  assert.deepEqual(normalizeCampaignProgress('invalid'), empty);
  assert.deepEqual(normalizeCampaignProgress({ version: 1, completed: { dawn: { passed: true, stars: 999, bestScore: -5 } } }).completed.dawn, { passed: true, stars: 3, bestScore: 0 });
});
