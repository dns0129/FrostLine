// Original ten-sortie campaign. One definition drives combat, briefings and rewards.
export const CAMPAIGN_TITLE = '暗潮行动';
export const CAMPAIGN_SAVE_KEY = 'frostline-campaign-v2';
export const CAMPAIGN_SYNOPSIS = '航母舰队演习途中，雷达突然出现没有识别信号的机群。苍隼四机小队紧急迎敌，掩护企业号撤退，再跨越群岛、港湾、红海与极地，追查代号“暗潮”的无人作战网络。十关顺序解锁，每次通关均获得升级点数。';

const chapters = [
  { id: 'dawn', title: '演习惊变', subtitle: '四机小队迎敌', mapId: 'north-atlantic', location: '北大西洋 · 舰队演习空域', tag: 'SCRAMBLE',
    story: '航母舰队正进行例行演习，你和三架僚机在外海担任蓝方。雷达上突然出现没有应答的高速目标，第一轮实弹划过甲板，演习立即转为实战。四机小队成为舰队唯一来得及升空的屏障。',
    briefing: '玩家与三架会自主交战的僚机组成四机小队，迎击五波、每波四架、合计二十架不明敌机。首关敌机只使用机炮，重点熟悉编队协同与清波补给。小队击落均计入任务战果，僚机可以受损和被击落。',
    waves: [4, 4, 4, 4, 4], shipWaves: [0, 0, 0, 0, 0], rewardPoints: 500, parTime: 360,
    ending: '二十架敌机全部被击落。残骸上没有任何国籍标识，舰队指挥部下令中止演习；远处却出现了封锁航道的驱逐舰。苍隼小队，立即掩护企业号撤退。',
    radio: [{ at: 0, text: '企业号：演习终止！苍隼四机小队，迎击五波共二十架不明敌机！' }, { at: 20, text: '苍隼二号：我们负责牵制，你保持攻击窗口。小队战果共同计入任务。' }] },
  { id: 'shield', title: '断后航线', subtitle: '保护航母撤退', mapId: 'storm-strait', location: '风暴海峡 · 航母撤离走廊', tag: 'WITHDRAWAL',
    story: '舰队转向风暴海峡，两艘不明驱逐舰从侧翼逼近，空袭也紧随而至。企业号需要时间撤出危险水道。你的小队必须同时清除水面封锁与空中威胁，让航母抵达安全海域。',
    briefing: '五波共二十架敌机和两艘驱逐舰交替进入战区。驱逐舰与部分攻击机优先攻击航母，其他敌机牵制小队。企业号有独立耐久，沿二点四公里撤离航线航行一百八十秒。击退全部敌人、航母存活且抵达出口后通关；需要携带反舰导弹。',
    waves: [4, 4, 4, 4, 4], shipWaves: [1, 0, 1, 0, 0], escortDuration: 180, retreatDistance: 2400, carrierHealth: 2200,
    guardRadius: 6500, abandonAfter: 20, timeLimit: 660, rewardPoints: 650, parTime: 420,
    ending: '企业号驶出风暴海峡，受损甲板开始抢修。敌舰的通信记录指向一片偏离民用航线的群岛。为了让舰队安全返航，苍隼小队接到追查命令。',
    radio: [{ at: 0, text: '企业号：撤退开始。拦截攻击机，用 R 发射反舰导弹清除驱逐舰！' }, { at: 60, text: '指挥部：留意航母耐久和绿色标记。水面目标正在组织新一轮攻击。' }] },
  { id: 'reef', title: '群岛猎影', subtitle: '追踪先遣编队', mapId: 'island-chain', location: '珊瑚群岛 · 外围封锁线', tag: 'PURSUIT',
    story: '截获的航迹在群岛间反复折返。不明机群正在掩护两艘中继驱逐舰撤离，它们可能带走识别敌方来源的关键记录。四机小队穿过群岛，展开第一次主动追击。',
    briefing: '五波共二十四架敌机、两艘驱逐舰。敌方开始全程使用导弹；岛岸会遮挡锁定与来袭武器。保持高度，利用波次间补给轮换空空与反舰作战，清除整条封锁线。',
    waves: [4, 4, 5, 5, 6], shipWaves: [0, 0, 1, 0, 1], rewardPoints: 800, parTime: 450,
    ending: '中继舰沉没前发出一段加密港口坐标。它们使用统一的自动交战协议，代号“暗潮”。情报组在城市海湾找到了负责转发指令的海上编队。' },
  { id: 'harbor', title: '港湾封锁', subtitle: '夺回城市外港', mapId: 'city-bay', location: '城市海湾 · 外港航道', tag: 'BLOCKADE',
    story: '暗潮编队封锁城市外港，民用航运被迫停航。高楼与岸线后的低空目标不断涌入海湾。小队必须先打开航道，才能接近被保护的指令转发舰。',
    briefing: '五波共二十六架敌机、三艘驱逐舰。城市建筑和码头是实体障碍，武器不能穿过岸线；敌舰防空导弹会威胁低空攻击。各波海空目标必须全部清除后才会获得补给。',
    waves: [4, 5, 5, 6, 6], shipWaves: [1, 0, 1, 0, 1], rewardPoints: 950, parTime: 480,
    ending: '港口航道重新开放。转发舰留下的航图显示，暗潮的补给链通往红海河口。企业号恢复飞行作业，远程支援小队继续南下。' },
  { id: 'redline', title: '赤沙截流', subtitle: '切断海上补给', mapId: 'nile-red-sea', location: '尼罗河与红海 · 河口补给线', tag: 'INTERDICTION',
    story: '赤色山岸和分汊河道之间，暗潮的补给舰队正在向外海转移。三艘驱逐舰与越来越密集的机群构成掩护。切断这条补给线，敌方主力才会被迫暴露。',
    briefing: '五波共二十八架敌机、三艘驱逐舰。敌机装甲、机动和武器伤害继续提升。沙漠山体遮挡视线，反舰导弹需要保持清晰进场路径；先处理形成夹击的空中目标。',
    waves: [5, 5, 6, 6, 6], shipWaves: [1, 0, 1, 0, 1], rewardPoints: 1100, parTime: 510,
    ending: '补给链被切断，暗潮开始向极地节点回收数据。情报确认：这不是一次偶然袭击，而是一套脱离控制的分布式无人作战网络。' },
  { id: 'polar', title: '极地锋刃', subtitle: '突破冰海防线', mapId: 'ice-ocean', location: '极地冰原 · 冰架外围', tag: 'BREAKTHROUGH',
    story: '小队抵达冰架边缘。暗潮将四艘驱逐舰部署在深水航道上，试图拖延追兵，让指挥节点完成转移。越过这条冰海防线，才能保住追踪窗口。',
    briefing: '五波共三十架敌机、四艘驱逐舰，七百八十秒内突破。冰架为实体地形，低空追击和掠海导弹可能被冰壁阻挡。后半程每波海空混合来袭，注意保留反舰弹药。',
    waves: [5, 6, 6, 6, 7], shipWaves: [0, 1, 1, 1, 1], timeLimit: 780, rewardPoints: 1250, parTime: 540,
    ending: '冰海防线瓦解，但暗潮反向解算了企业号的位置。舰队转场途中遭遇第二轮追击，小队必须立即回援。' },
  { id: 'convoy', title: '暮湾回援', subtitle: '再次掩护舰队', mapId: 'dusk-gulf', location: '暮色海湾 · 舰队转场航线', tag: 'FLEET RESCUE',
    story: '暮色中，刚恢复战力的企业号再次遭到围攻。暗潮这次投入更大规模的海空协同编队，试图迫使舰队在湾口搁浅。苍隼小队必须守住最后一条撤离走廊。',
    briefing: '五波共三十二架敌机、四艘驱逐舰。保护二千耐久的航母沿三点二公里航线撤离，航程二百四十秒。攻击航母的敌机比例上升；全歼敌人并等航母抵达出口。防区外连续二十秒或航母被击沉都会失败。',
    waves: [6, 6, 6, 7, 7], shipWaves: [1, 1, 0, 1, 1], escortDuration: 240, retreatDistance: 3200, carrierHealth: 2000,
    guardRadius: 6500, abandonAfter: 20, timeLimit: 900, rewardPoints: 1400, parTime: 600,
    ending: '企业号成功撤离。最后一轮攻击机的导航数据揭开了冰川深处的中继节点。舰队将支援这次远程突击，苍隼小队不再被动迎战。' },
  { id: 'relay', title: '冰川静默', subtitle: '猎杀中继指挥机', mapId: 'glacial-sea', location: '冰原海域 · 冰川中继站', tag: 'RELAY HUNT',
    story: '巨大的入海冰川之间，一架强化指挥机正向远方广播新指令。暗潮以密集机群和驱逐舰守卫它。切断这个中继节点，最终基地的位置才会出现在雷达上。',
    briefing: '五波共三十四架敌机、四艘驱逐舰。第三波出现双倍装甲的暗潮指挥机，击落它后仍需清除所有护航目标。冰山具有碰撞，浮冰海面可以通行；小队需在八百四十秒内完成任务。',
    waves: [6, 6, 7, 7, 8], shipWaves: [1, 1, 0, 1, 1], commanderWave: 3, commanderHealthScale: 2, timeLimit: 840,
    rewardPoints: 1600, parTime: 630, ending: '中继信号中断，暗潮的最后两层防线被定位：黑礁火山海域的舰队屏障，以及极夜海盆上空的核心指挥机。' },
  { id: 'siege', title: '黑礁破围', subtitle: '摧毁核心外防', mapId: 'volcanic-front', location: '黑礁火山海 · 外层舰队防线', tag: 'SIEGE',
    story: '黑色火山岛形成天然堡垒，五艘驱逐舰守住通往核心海域的入口。暗潮将剩余精锐全部投入防线。舰队需要这片空域，小队必须逐波打开突破口。',
    briefing: '五波共三十六架敌机、五艘驱逐舰，每波都有水面目标。敌机具备更强的机动和持续导弹威胁，九百秒内全歼。最后一波的强化指挥机与护航机共同构成突破目标。',
    waves: [6, 7, 7, 8, 8], shipWaves: [1, 1, 1, 1, 1], commanderWave: 5, commanderHealthScale: 2.1, timeLimit: 900,
    rewardPoints: 1800, parTime: 660, ending: '黑礁防线被突破。远方海面上的最后一束通信光标熄灭，只剩核心指挥机仍在极夜中呼叫增援。苍隼小队进入最终战区。' },
  { id: 'finale', title: '暗潮终结', subtitle: '摧毁核心指挥链', mapId: 'polar-night', location: '极夜海盆 · 暗潮核心空域', tag: 'FINAL STRIKE',
    story: '暮蓝天空下，暗潮将全部剩余兵力集中在核心海域。六艘驱逐舰守住水面，核心指挥机在最后一批机群中现身。只有让整个指挥链静默，舰队才能真正结束这场演习之外的战争。',
    briefing: '五波共四十架敌机、六艘驱逐舰，九百六十秒内完成最终打击。第五波核心指挥机具有二点二倍装甲和更高机动。击落核心后仍需消灭全部护航机与驱逐舰；波次间补给不会复活损失的僚机。',
    waves: [7, 7, 8, 9, 9], shipWaves: [1, 1, 1, 1, 2], commanderWave: 5, commanderHealthScale: 2.2, timeLimit: 960,
    rewardPoints: 2200, parTime: 720, ending: '核心指挥机坠入冰海，所有暗潮信号归零。企业号与护航舰队平安返航。指挥部：苍隼小队，十次出击全部完成。演习结束，欢迎回家。' },
];

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const CAMPAIGN_LEVELS = freeze(chapters.map((chapter, i) => {
  const air = chapter.waves.reduce((a, b) => a + b, 0), sea = chapter.shipWaves.reduce((a, b) => a + b, 0);
  return { ...chapter, number: i + 1, wingmen: 3, healthScale: .72 + i * .06, turnScale: .72 + i * .05,
    damageScale: .72 + i * .055, enemyMissiles: i > 0, missileEvery: 26 - i * 1.2,
    spawn: [0, 1100 + i * 35, 4000], airTotal: air, shipTotal: sea,
    objectives: [`清除五波共 ${air} 架敌机${sea ? `与 ${sea} 艘驱逐舰` : ''}`,
      chapter.escortDuration ? `保护企业号存活，完成 ${chapter.escortDuration} 秒撤离航程` : chapter.commanderWave ? '击落强化指挥机及其全部护航目标' : '保持机体存活，协同僚机清除战区'],
    rules: `玩家 + 三架僚机 · 五波清敌 · 波次间修复并补满出击挂载${chapter.escortDuration ? ` · 航母 ${chapter.carrierHealth} HP · 离区 ${chapter.abandonAfter} 秒失败` : ''} · 通关 +${chapter.rewardPoints} 升级点`,
    radio: chapter.radio || [{ at: 0, text: `指挥部：苍隼小队，进入${chapter.location}。${chapter.subtitle}，注意海空协同威胁。` }],
  };
}));

export const campaignLevel = id => CAMPAIGN_LEVELS.find(level => level.id === id) || null;
export function normalizeCampaignProgress(value) {
  const progress = { version: 2, completed: {} };
  // The old three-chapter story has its own save. It cannot unlock this new campaign.
  if (!value || value.version !== 2 || !value.completed || typeof value.completed !== 'object') return progress;
  for (const level of CAMPAIGN_LEVELS) {
    const item = value.completed[level.id];
    if (!item || item.passed !== true) break;
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
  const level = campaignLevel(sim.campaignId), state = sim.campaignState;
  if (!level || !state) return '';
  const outside = state.outsideFor || 0;
  if (outside > 0) return `返回航母防区 · 离区 ${outside.toFixed(1)}/${level.abandonAfter} 秒`;
  const air = `击落 ${state.airKills}/${level.airTotal}`, sea = level.shipTotal ? ` · 击沉 ${state.shipKills}/${level.shipTotal}` : '';
  const escort = level.escortDuration ? ` · 航母 ${Math.max(0, Math.ceil(sim.carrier?.health || 0))} HP · 撤离 ${Math.min(level.escortDuration, Math.floor(state.retreatElapsed))}/${level.escortDuration} 秒` : '';
  return `${air}${sea}${escort}${level.timeLimit ? ` · ${Math.max(0, Math.ceil(level.timeLimit - sim.time))} 秒` : ''}`;
}
