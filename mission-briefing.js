import { CAMPAIGN_TITLE, CAMPAIGN_LEVELS, campaignLevel, campaignUnlocked } from './campaign.js';
import { DEFAULT_MAP_ID, getMap } from './maps.js';
import { isShipVehicle } from './ship-systems.js';
import { sampleFleetRoute } from './ambient-fleet.js';

export const BRIEFING_PAGES = Object.freeze(['战斗简介', '剧本细节', '部署情况', '任务目标']);
export const SORTIE_MODES = Object.freeze([
  { id: 'quick', title: '快速任务', english: 'QUICK SORTIE', description: '独立任务 · 自由选择战场' },
  { id: 'campaign', title: '战役模式', english: 'STORY CAMPAIGN', description: `${CAMPAIGN_TITLE} · 十关海空战役` },
  { id: 'training', title: '训练模式', english: 'TRAINING', description: '飞行训练 · 海上射击' },
]);

export function missionChoices(category, vehicle = 'aircraft') {
  const ship = isShipVehicle(vehicle);
  if (category === 'campaign') return CAMPAIGN_LEVELS.map(level => ({ id: level.id, title: level.title,
    subtitle: `${getMap(level.mapId).name} · ${level.subtitle} · +${level.rewardPoints} 点` }));
  if (category === 'training') return [
    { id: 'training', title: ship ? '初次出航' : '初次升空', subtitle: ship ? '航行与对空训练' : '飞行与空空训练' },
    { id: 'naval-training', title: ship ? '舰炮训练' : '反舰训练', subtitle: '两艘静止靶舰 · 熟悉对海操作' },
  ];
  return [
    { id: 'intercept', title: '破晓拦截', subtitle: ship ? '三波敌机 · 舰队防空' : '三波敌机 · 守住空域' },
    { id: 'free', title: '无尽巡猎', subtitle: '逐波增敌 · 清波全量补给' },
    { id: 'naval', title: '海峡歼敌', subtitle: ship ? '三波敌舰 · 炮击与机动' : '三波敌舰 · 空中对海打击' },
  ];
}

// Briefings read campaign rules directly; reading them never starts a simulation.
export function missionBriefing({ mode = 'intercept', chapter = 'dawn', vehicle = 'aircraft', map = DEFAULT_MAP_ID, progress, hasAntiShip = true } = {}) {
  const ship = isShipVehicle(vehicle), level = mode === 'campaign' ? campaignLevel(chapter) : null;
  const naval = mode === 'naval' || mode === 'naval-training';
  const training = mode === 'training' || mode === 'naval-training';
  const area = getMap(level ? level.mapId : map);
  let blocked = level && !campaignUnlocked(progress, level.id) ? '完成前一章后解锁出击，可先阅读全部简报。' : '';
  if (mode === 'campaign' && ship) blocked = `${CAMPAIGN_TITLE}是战机战役，请返回机库选择战机。`;
  if ((naval || level?.shipTotal) && !ship && !hasAntiShip) blocked = '本关有水面目标，需要反舰导弹，请返回机库整备。';
  const common = { mode, chapter: level?.id, map: area, ship, naval, training, blocked, canLaunch: !blocked,
    location: level?.location || area.subtitle, recommended: level ? '战斗机' : ship ? '驱逐舰' : '战斗机',
    spawn: level?.spawn || [0, ship ? 18 : naval ? 450 : 1100, 4000],
    fleet: level?.escortDuration ? sampleFleetRoute('US', 0) : null,
    radius: level?.guardRadius || null,
  };
  if (level) {
    return { ...common, mixed: level.shipTotal > 0, wingmen: level.wingmen, rewardPoints: level.rewardPoints, escortDuration: level.escortDuration,
      title: level.title, subtitle: level.subtitle, code: `CHAPTER ${String(level.number).padStart(2, '0')} / ${CAMPAIGN_LEVELS.length} · ${level.tag}`,
      story: level.story, description: level.briefing, time: level.timeLimit ? `${level.timeLimit} 秒` : '不限时',
      objectives: [...level.objectives, ...(level.objectives.some(s => s.includes('存活')) ? [] : ['保持机体存活'])],
      failures: ['机体被击毁', ...(level.escortDuration ? ['企业号被击沉', `连续离开防区 ${level.abandonAfter} 秒`] : []), ...(level.timeLimit ? [`${level.timeLimit} 秒内未完成全部目标`] : [])],
      rules: level.rules, enemy: `${level.airTotal} 架敌机${level.shipTotal ? `与 ${level.shipTotal} 艘驱逐舰` : ''}${level.commanderWave ? '（含强化指挥机）' : ''}`,
      threats: level.shipTotal ? '敌机机炮与导弹、驱逐舰防空导弹' : level.enemyMissiles ? '敌机使用机炮与导弹' : '敌机仅使用机炮',
      steps: [
        ['四机小队出击', `${level.location}，玩家与三架自主交战僚机协同。`],
        ['五波海空交战', `每波敌机 ${level.waves.join(' / ')} 架；驱逐舰 ${level.shipWaves.join(' / ')} 艘。清空整波后修复并补满出击挂载。`],
        [level.escortDuration ? '保护航母撤退' : level.commanderWave ? '切断指挥节点' : '肃清目标', level.escortDuration
          ? `航母 ${level.carrierHealth} HP；撤离 ${level.retreatDistance / 1000} km / ${level.escortDuration} 秒，防区 ${level.guardRadius / 1000} km。全歼敌人且航母存活并抵达出口后通关。`
          : level.commanderWave ? `第 ${level.commanderWave} 波击落强化指挥机后，仍需清除全部护航目标。` : '清除全部目标，并保持玩家机体存活。'],
        ['领取通关奖励', `每次通关 +${level.rewardPoints} 升级点，另计战斗改装点与 XP；在机库升级引擎、火力、防御与机动。`],
      ], radio: level.radio[0]?.text,
    };
  }
  const choice = [...missionChoices('quick', vehicle), ...missionChoices('training', vehicle)].find(c => c.id === mode) || missionChoices('quick', vehicle)[0];
  const endless = mode === 'free', target = naval ? '敌舰' : training ? '靶机' : '敌机';
  const total = naval ? training ? 2 : 9 : training ? 3 : 9;
  const objectives = endless ? [`持续击落来袭敌机，刷新生存纪录`, `保持${ship ? '舰体' : '机体'}存活`] : [`${naval ? '击沉' : '击落'}${training ? '' : '三波共'} ${total} ${naval ? '艘' : '架'}${target}`, `保持${ship ? '舰体' : '机体'}存活`];
  return { ...common, title: choice.title, subtitle: choice.subtitle, code: training ? 'TRAINING / 自由训练' : endless ? 'ENDLESS / 生存挑战' : naval ? 'NAVAL / 对海作战' : 'INTERCEPT / 区域防空',
    story: training ? `在${area.name}熟悉${naval ? '对海射击与目标锁定' : ship ? '航行、转舵与对空防御' : '飞行、机炮与导弹锁定'}。靶标不会主动攻击，完成全部目标后结束训练。`
      : endless ? `来袭机群将持续进入${area.name}。在连续交战中保存战力，挑战自己的任务纪录。`
      : `前往${area.name}，${naval ? '清除阻断航道的敌方舰艇' : ship ? '以舰艇防空火力击退来袭机群' : '拦截进入空域的敌方机群'}。清除当前波次后获得补给，完成三波交战。`,
    description: training ? '训练无任务倒计时；完成全部靶标后结束。敌方靶标不主动攻击，训练不发放改装奖励。' : endless ? '首波 2 架，每波增加 1 架；敌方装甲、转向和火力从简单逐步提升，第 10 波达到困难。清空整波后全量补给，4.5 秒后下一波进入，无波数与时间限制。' : '三波交战，敌方数量依次为 2、3、4。清除每波后等待补给与下一波到达。',
    time: '不限时', objectives,
    failures: [`${ship ? '舰体' : '机体'}被击毁`, ...(naval ? ['对舰弹药耗尽，且在途弹药结算后仍有敌舰存活'] : [])],
    rules: training ? '静止靶舰 / 被动靶机 · 不发改装奖励' : endless ? '清波后机体完全修复，导弹按出击挂载补满，热诱弹、机炮弹药与燃油补满 · 生存计分' : '三波交战 · 波次间补给',
    enemy: endless ? '持续增援的敌机' : `${total} ${naval ? '艘' : '架'}${target}`,
    threats: training ? '训练目标不会主动攻击' : naval ? '敌舰舰炮威胁' : '敌机机炮与导弹威胁',
    steps: [['进入任务区域', `${area.name} · ${area.subtitle}`], [training ? '熟悉操作' : '分批交战', naval ? ship ? '舰炮射击，或锁定后发射反舰导弹。' : '保持对海锁定，使用反舰导弹。' : ship ? '转舵航行，雷达锁定后发射防空导弹。' : '追踪目标，使用机炮与空空导弹。'], [endless ? '挑战纪录' : '完成任务', endless ? '持续迎敌，取得更高生存分数。' : `清除全部${target}，保持${ship ? '舰体' : '机体'}存活。`]],
  };
}
