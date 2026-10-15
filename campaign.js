// Original fictional campaign. Definitions drive briefings, mission rules and saves.
export const CAMPAIGN_TITLE = '北境航线';
export const CAMPAIGN_SYNOPSIS = '北境航线上，失联的“灰潮”无人机群突然袭扰联合护航编队。你驾驶机库中的战机（F/A-18C 大黄蜂或歼-16），呼号“苍隼”，从一次紧急拦截出发，逐步追踪并切断它们的空中指挥链。';
export const CAMPAIGN_LEVELS = Object.freeze([
  Object.freeze({
    id: 'dawn', number: 1, title: '晨雾警报', subtitle: '先遣拦截', location: '北境南部 · 外海警戒线', tag: 'INTERCEPT',
    story: '清晨的例行巡航被一段求救信号打断。四架无人机越过警戒线，正试探护航编队的防空反应。塔台命令你先拦下它们，再回收残骸中的航路信息。',
    briefing: '这是“苍隼”的第一次紧急出击。先遣无人机分成两批，机动和装甲较弱，只使用机炮。利用短暂的尾追窗口练习锁定和射击，清除第一批后会获得空中补给。残骸中的重复信号将指向更大的袭扰计划。',
    objectives: Object.freeze(['清除两批先遣无人机，共 4 架', '保持机体存活；波次之间获得补给']),
    rules: '两波空战 · 敌机仅使用机炮 · 无任务倒计时',
    ending: '残骸里没有飞行员。回收的数据指向同一条航线：无人机群的下一批目标，是正在通过海峡的护航编队。',
    waves: Object.freeze([2, 2]), healthScale: .72, turnScale: .75, enemyMissiles: false,
    spawn: Object.freeze([0, 1100, 4000]), parTime: 100,
    radio: Object.freeze([{ at: 0, text: '塔台：苍隼，先遣机群已越过警戒线。拦下两批目标。' }, { at: 12, text: '苍隼：没有座舱回应……它们是无人机。' }]),
  }),
  Object.freeze({
    id: 'shield', number: 2, title: '舰队上空', subtitle: '空域坚守', location: '中央海峡 · 航母编队上空', tag: 'DEFEND',
    story: '先遣机群的信号不是撤退指令，而是集结坐标。护航编队正在通过狭水道，暂时无法改变航向。你必须留在编队上空，挡住连续进入空域的无人机。',
    briefing: '绿色护航标记跟随航母移动。留在标记周围 4.5 公里内，坚守 90 秒并击落至少 6 架无人机。仅在防区内累计坚守时间；离开防区超过连续 10 秒会导致任务失败；150 秒内仍未完成全部目标也会失败。敌机每 22 秒进入一批，空中最多同时存在 6 架。本关争夺的是空域控制，舰船不参与攻击或受损。',
    objectives: Object.freeze(['在航母编队 4.5 公里内坚守 90 秒', '击落至少 6 架无人机，并保持机体存活']),
    rules: '离开防区 10 秒失败 · 最长 150 秒 · 绿色标记指向编队',
    ending: '最后一艘护航舰驶出狭水道。塔台截获了持续发出指令的空中节点：“灰潮”并非各自作战，指挥机仍在北侧盘旋。',
    waves: Object.freeze([2]), healthScale: .86, turnScale: 1, enemyMissiles: true,
    spawn: Object.freeze([-980, 1250, 3300]), guardDuration: 90, minimumKills: 6, guardRadius: 4500, abandonAfter: 10, timeLimit: 150, reinforcementEvery: 22, parTime: 110,
    radio: Object.freeze([{ at: 0, text: '指挥官：编队正在通过海峡。苍隼，守住绿色标记周围的空域。' }, { at: 22, text: '塔台：第二批无人机进入空域。不要追出防线。' }, { at: 55, text: '指挥官：航线正在恢复。保持警戒，坚守到 90 秒。' }]),
  }),
  Object.freeze({
    id: 'finale', number: 3, title: '灰潮终局', subtitle: '指挥节点猎杀', location: '北侧航道 · 指挥机活动区', tag: 'STRIKE',
    story: '护航编队已经脱离险境，但只要空中指挥链仍在，“灰潮”就会再次集结。循着截获的信号，你飞向北侧航道。最后一批护航机后面，一架大型指挥无人机现身。',
    briefing: '在 210 秒内清除三批目标，共 7 架，包括最后一批中的“灰潮指挥机”。指挥机拥有两倍于同批敌机的装甲、更快的转向和更早的导弹威胁；它会用不同的目标名称和更大的机体显示。清除前两批后均会得到补给。击落指挥机后仍须清除剩余护航机，航线才算安全。',
    objectives: Object.freeze(['在 210 秒内清除三批目标，共 7 架', '击落最后一批的灰潮指挥机及其护航机']),
    rules: '三波空战 · 指挥机强化装甲与机动 · 波次间补给',
    ending: '指挥机的信号消失了。剩余的灰潮节点退出航线，联合护航编队恢复正常航行。塔台：苍隼，航道已清。欢迎回家。',
    waves: Object.freeze([2, 2, 3]), healthScale: 1, turnScale: 1.08, enemyMissiles: true,
    spawn: Object.freeze([0, 1550, 1100]), timeLimit: 210, commanderWave: 3, commanderHealthScale: 2, parTime: 170,
    radio: Object.freeze([{ at: 0, text: '塔台：信号指向北侧航道。清除护航机，迫使指挥节点现身。' }, { at: 20, text: '苍隼：它们在保护同一个目标。继续向信号源推进。' }]),
  }),
]);

export const campaignLevel = id => CAMPAIGN_LEVELS.find(level => level.id === id) || null;
export function normalizeCampaignProgress(value) {
  const progress = { version: 1, completed: {} };
  if (!value || value.version !== 1 || !value.completed || typeof value.completed !== 'object') return progress;
  for (const level of CAMPAIGN_LEVELS) {
    const item = value.completed[level.id];
    if (!item || item.passed !== true) break; // A later chapter never unlocks over a missing predecessor.
    progress.completed[level.id] = { passed: true,
      stars: Math.min(3, Math.max(1, Number.isFinite(item.stars) ? Math.floor(item.stars) : 1)),
      bestScore: Number.isFinite(item.bestScore) ? Math.max(0, Math.floor(item.bestScore)) : 0 };
  }
  return progress;
}
export function campaignUnlocked(progress, id) {
  const index = CAMPAIGN_LEVELS.findIndex(level => level.id === id);
  return index >= 0 && (index === 0 || !!normalizeCampaignProgress(progress).completed[CAMPAIGN_LEVELS[index - 1].id]);
}
export function recordCampaignWin(progress, id, outcome) {
  const next = normalizeCampaignProgress(progress), level = campaignLevel(id);
  if (!level || !campaignUnlocked(next, id) || outcome?.won !== true) return next;
  const previous = next.completed[id];
  const stars = 1 + (outcome.health >= 60 ? 1 : 0) + (Number.isFinite(outcome.time) && outcome.time <= level.parTime ? 1 : 0);
  next.completed[id] = { passed: true, stars: Math.max(previous?.stars || 0, stars),
    bestScore: Math.max(previous?.bestScore || 0, Number.isFinite(outcome.score) ? Math.max(0, Math.floor(outcome.score)) : 0) };
  return next;
}
export const recommendedCampaignLevel = progress => CAMPAIGN_LEVELS.find(l => !normalizeCampaignProgress(progress).completed[l.id]) || CAMPAIGN_LEVELS.at(-1);
export function campaignObjectiveText(sim) {
  const level = campaignLevel(sim.campaignId); if (!level) return '';
  if (level.id === 'shield') {
    const outside = sim.campaignState?.outsideFor || 0;
    return outside > 0 ? `返回护航空域 · 离区 ${outside.toFixed(1)}/10 秒` : `坚守 ${Math.min(90, Math.floor(sim.campaignState?.guardElapsed || 0))}/90 秒 · 击落 ${Math.min(6, sim.kills)}/6`;
  }
  const total = level.waves.reduce((a, b) => a + b, 0);
  return `${level.title} · 击落 ${Math.min(total, sim.kills)}/${total}${level.timeLimit ? ` · 剩余 ${Math.max(0, Math.ceil(level.timeLimit - sim.time))} 秒` : ''}`;
}
