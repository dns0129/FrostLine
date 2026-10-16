import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN_LEVELS, normalizeCampaignProgress, recordCampaignWin } from '../campaign.js';
import { missionBriefing, missionChoices, BRIEFING_PAGES } from '../mission-briefing.js';
import { DEFAULT_MAP_ID } from '../maps.js';
import { sampleFleetRoute } from '../ambient-fleet.js';

test('each campaign briefing reflects its actual limits, objectives, waves and original geography', () => {
  let progress = normalizeCampaignProgress(null);
  for (const level of CAMPAIGN_LEVELS) {
    const b = missionBriefing({ mode: 'campaign', chapter: level.id, map: 'city-bay', progress });
    assert.equal(b.map.id, DEFAULT_MAP_ID);
    assert.deepEqual(b.spawn, level.spawn);
    assert.equal(b.description, level.briefing);
    assert.equal(b.time, level.timeLimit ? `${level.timeLimit} 秒` : '不限时');
    assert.equal(b.canLaunch, true);
    for (const objective of level.objectives) assert.ok(b.objectives.includes(objective));
    progress = recordCampaignWin(progress, level.id, { won: true, health: 100, time: 80, score: 100 });
  }
});

test('defense deployment shows the moving fleet initial location and exact failure thresholds', () => {
  const b = missionBriefing({ mode: 'campaign', chapter: 'shield' });
  assert.deepEqual(b.fleet, sampleFleetRoute('US', 0));
  assert.equal(b.radius, 4500);
  assert.ok(b.failures.includes('连续离开防区 10 秒'));
  assert.ok(b.failures.includes('150 秒内未完成全部目标'));
  assert.match(b.steps[1][1], /22 秒/);
  assert.match(b.steps[2][1], /90 秒.*6 架/);
});

test('locked chapters remain readable while launch authorization requires ordered progress and a plane', () => {
  const locked = missionBriefing({ mode: 'campaign', chapter: 'finale' });
  assert.equal(locked.canLaunch, false);
  assert.ok(locked.story.length > 20);
  const progress = recordCampaignWin(null, 'dawn', { won: true, health: 100, time: 60, score: 5 });
  assert.equal(missionBriefing({ mode: 'campaign', chapter: 'shield', progress }).canLaunch, true);
  assert.equal(missionBriefing({ mode: 'campaign', chapter: 'shield', progress, vehicle: 'burke' }).canLaunch, false);
});

test('quick and training tasks describe real target totals, saved maps and selected vehicle capabilities', () => {
  for (const vehicle of ['aircraft', 'j16', 'destroyer', 'burke', 'type052d']) {
    const ship = ['destroyer', 'burke', 'type052d'].includes(vehicle);
    for (const category of ['quick', 'training']) for (const choice of missionChoices(category, vehicle)) {
      const b = missionBriefing({ mode: choice.id, vehicle, map: 'nile-red-sea' });
      assert.equal(b.title, choice.title);
      assert.equal(b.map.id, 'nile-red-sea');
      assert.equal(b.ship, ship);
      assert.ok(b.objectives.length >= 2);
    }
  }
  assert.match(missionBriefing({ mode: 'naval' }).enemy, /9 艘/);
  assert.match(missionBriefing({ mode: 'training' }).enemy, /3 架/);
  assert.match(missionBriefing({ mode: 'naval-training' }).enemy, /2 艘/);
  assert.match(missionBriefing({ mode: 'free' }).enemy, /持续增援/);
  assert.equal(BRIEFING_PAGES.length, 4);
});

test('missing aircraft anti-ship stores block only sea tasks, without blocking a ship', () => {
  assert.equal(missionBriefing({ mode: 'naval', hasAntiShip: false }).canLaunch, false);
  assert.equal(missionBriefing({ mode: 'naval-training', vehicle: 'j16', hasAntiShip: false }).canLaunch, false);
  assert.equal(missionBriefing({ mode: 'intercept', hasAntiShip: false }).canLaunch, true);
  assert.equal(missionBriefing({ mode: 'naval', vehicle: 'type052d', hasAntiShip: false }).canLaunch, true);
});
