// Public F/A-18C and J-16 compatibility and masses; game ranges/handling are scaled for
// the existing island arena. Sources and approximation boundaries: docs/aircraft-systems.md.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const boundedInt = (value, max) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
// `visual` sizes the generated store meshes (metres); `hang` lowers a fatter
// store so it still meets a pylon calibrated for a slimmer missile. Every
// missile here also has a real-scale model in missile-models.js; these visual
// sizes match those models (published length / body diameter; the YJ-83K
// length is the ship-launched 6.38 m less its booster, an estimate).
export const STORES = freeze({
  'aim9': { name: 'AIM-9M 响尾蛇', short: 'AIM-9M', kind: 'anti-air', massKg: 86, drag: .018, range: 2800, lockSeconds: 1.2, cone: 10, speed: 610, life: 9, damage: 125, guidance: '红外 / 近程', visual: { length: 2.87, radius: .0635 } },
  'aim7': { name: 'AIM-7M 麻雀', short: 'AIM-7M', kind: 'anti-air', massKg: 231, drag: .03, range: 4500, lockSeconds: 1.5, cone: 18, speed: 720, life: 13, damage: 145, guidance: '半主动雷达 / 中程', visual: { length: 3.66, radius: .1015 } },
  'aim120': { name: 'AIM-120C AMRAAM', short: 'AIM-120C', kind: 'anti-air', massKg: 162, drag: .024, range: 6500, lockSeconds: 1.1, cone: 25, speed: 820, life: 16, damage: 135, guidance: '主动雷达 / 中远程', visual: { length: 3.65, radius: .089 } },
  'harpoon': { name: 'AGM-84D 鱼叉', short: 'AGM-84D', kind: 'anti-ship', massKg: 540, drag: .065, range: 7000, lockSeconds: 1.5, cone: 45, speed: 280, life: 38, damage: 280, guidance: '主动雷达 / 反舰', visual: { length: 3.84, radius: .1715 } },
  'tank': { name: '330 加仑副油箱', short: '330 gal', kind: 'fuel', massKg: 1100, fuelKg: 1000, drag: .085, guidance: '增加燃油 / 单挂', visual: { length: 4.1, radius: .4 } },
  'pl10': { name: 'PL-10 霹雳-10', short: 'PL-10', kind: 'anti-air', massKg: 105, drag: .016, range: 3000, lockSeconds: 1, cone: 14, speed: 640, life: 9, damage: 125, guidance: '红外 / 近程大离轴', visual: { length: 3, radius: .08 } },
  'pl15': { name: 'PL-15 霹雳-15', short: 'PL-15', kind: 'anti-air', massKg: 210, drag: .026, range: 7500, lockSeconds: 1.2, cone: 25, speed: 860, life: 18, damage: 135, guidance: '主动雷达 / 远程', visual: { length: 3.996, radius: .1015 } },
  'yj83k': { name: 'YJ-83K 鹰击-83K', short: 'YJ-83K', kind: 'anti-ship', massKg: 600, drag: .07, range: 7500, lockSeconds: 1.5, cone: 45, speed: 290, life: 40, damage: 250, guidance: '主动雷达 / 反舰', visual: { length: 5.2, radius: .18, hang: .08 } },
});
const wing = { aim9: 1, aim7: 1, aim120: 2, harpoon: 1 };
// Presets list one store per station, in station order. `doubles` marks dual racks.
export const AIRCRAFT = freeze({
  fa18c: {
    id: 'fa18c', name: 'F/A-18C 大黄蜂', shortName: '大黄蜂', role: '标准多用途战斗机', gun: 'M61A1',
    real: { emptyKg: 10455, internalFuelKg: 4930, maxTakeoffKg: 23537, maxPayloadKg: 6215, cannonRounds: 578, engineThrustKN: 157.4 },
    base: { health: 100, flares: 6, thrust: 43, boostThrust: 31, maxSpeed: 300, boostSpeed: 320, rollRate: 1.8, pitchRate: .64, gunDamage: 24, gunInterval: .078 },
    // Station weight ceilings are deliberately conservative game envelopes,
    // not a claim to reproduce the aircraft's certified stores-clearance tables.
    stations: [
      { id: 1, name: '左翼尖', x: -5.95, position: [-5.95, -.12, 1.65], limitKg: 100, allowed: { aim9: 1 } },
      { id: 2, name: '左外翼', x: -3.95, position: [-3.95, -.7, 1.1], limitKg: 1100, allowed: { ...wing } },
      { id: 3, name: '左内翼', x: -2.45, position: [-2.45, -.95, .6], limitKg: 1400, allowed: { ...wing, tank: 1 } },
      { id: 4, name: '左机身', x: -.85, position: [-.85, -.8, -.6], limitKg: 250, allowed: { aim7: 1, aim120: 1 } },
      { id: 5, name: '中心线', x: 0, position: [0, -1.25, .2], limitKg: 1400, allowed: { tank: 1 } },
      { id: 6, name: '右机身', x: .85, position: [.85, -.8, -.6], limitKg: 250, allowed: { aim7: 1, aim120: 1 } },
      { id: 7, name: '右内翼', x: 2.45, position: [2.45, -.95, .6], limitKg: 1400, allowed: { ...wing, tank: 1 } },
      { id: 8, name: '右外翼', x: 3.95, position: [3.95, -.7, 1.1], limitKg: 1100, allowed: { ...wing } },
      { id: 9, name: '右翼尖', x: 5.95, position: [5.95, -.12, 1.65], limitKg: 100, allowed: { aim9: 1 } },
    ],
    presets: {
      multirole: { name: '标准多用途', stores: ['aim9', 'aim120', 'harpoon', 'aim120', 'tank', 'aim120', 'harpoon', 'aim120', 'aim9'] },
      air: { name: '制空拦截', stores: ['aim9', 'aim120', 'aim120', 'aim120', null, 'aim120', 'aim120', 'aim120', 'aim9'], doubles: [2, 3, 7, 8] },
      sea: { name: '对海打击', stores: ['aim9', 'harpoon', 'harpoon', 'aim120', 'tank', 'aim120', 'harpoon', 'harpoon', 'aim9'] },
      clean: { name: '轻载训练', stores: ['aim9', null, null, null, null, null, null, null, 'aim9'] },
    },
    workshopNote: '翼尖仅挂 AIM-9；AIM-120 可在翼下双联；鱼叉仅挂翼下，副油箱占用内翼或中心线。重载与不对称挂载会降低机动响应。',
  },
  // J-16 figures are public estimates (no official specification is published).
  // Stations follow the pylons modelled in assets/models/j16.glb; positions are
  // the baked missile centres, relative to the nozzle-axis origin used by j16.js.
  // The wingtip ECM pods are fixed airframe equipment, not configurable stations.
  j16: {
    id: 'j16', name: '歼-16', shortName: '歼-16', role: '重型多用途战斗机', gun: 'GSh-30-1',
    real: { emptyKg: 17700, internalFuelKg: 9400, maxTakeoffKg: 35000, maxPayloadKg: 8000, cannonRounds: 150, engineThrustKN: 270 },
    base: { health: 125, flares: 8, thrust: 42, boostThrust: 33, maxSpeed: 305, boostSpeed: 330, rollRate: 1.6, pitchRate: .6, gunDamage: 40, gunInterval: .11 },
    stations: [
      { id: 1, name: '左外翼', x: -6.43, position: [-6.43, .11, 4.6], limitKg: 150, allowed: { pl10: 1 } },
      { id: 2, name: '左内翼', x: -4.81, position: [-4.81, -.04, 3.68], limitKg: 1000, allowed: { pl10: 1, pl15: 1, yj83k: 1 } },
      { id: 3, name: '左进气道', x: -1.26, position: [-1.26, -.89, -1.63], limitKg: 400, allowed: { pl15: 1 } },
      { id: 4, name: '机腹前', x: 0, position: [0, -.05, -.49], limitKg: 400, allowed: { pl15: 1 } },
      { id: 5, name: '机腹后', x: 0, position: [0, -.14, 3.78], limitKg: 400, allowed: { pl15: 1 } },
      { id: 6, name: '右进气道', x: 1.26, position: [1.26, -.89, -1.63], limitKg: 400, allowed: { pl15: 1 } },
      { id: 7, name: '右内翼', x: 4.81, position: [4.81, -.04, 3.68], limitKg: 1000, allowed: { pl10: 1, pl15: 1, yj83k: 1 } },
      { id: 8, name: '右外翼', x: 6.43, position: [6.43, .11, 4.6], limitKg: 150, allowed: { pl10: 1 } },
    ],
    presets: {
      multirole: { name: '标准多用途', stores: ['pl10', 'yj83k', 'pl15', 'pl15', 'pl15', 'pl15', 'yj83k', 'pl10'] },
      air: { name: '制空拦截', stores: ['pl10', 'pl15', 'pl15', 'pl15', 'pl15', 'pl15', 'pl15', 'pl10'] },
      sea: { name: '对海打击', stores: ['pl10', 'yj83k', 'pl15', null, null, 'pl15', 'yj83k', 'pl10'] },
      clean: { name: '轻载训练', stores: ['pl10', null, null, null, null, null, null, 'pl10'] },
    },
    workshopNote: '外翼仅挂 PL-10；内翼可挂 PL-10、PL-15 或鹰击-83K；进气道与机腹串列挂点挂 PL-15。翼尖电子战吊舱为固定设备。',
  },
});
export const aircraftById = id => AIRCRAFT[id] || AIRCRAFT.fa18c;
export const DEFAULT_AIRCRAFT_ID = 'fa18c';
// The HUD weapon shown once no air-to-air store is left: the airframe's first compatible type.
export const primaryAirWeapon = aircraftId => aircraftById(aircraftId).stations.flatMap(s => Object.keys(s.allowed)).find(id => STORES[id].kind === 'anti-air');
// Kept for existing callers: the F/A-18C preset table. New code uses presetsFor().
export const LOADOUT_PRESETS = AIRCRAFT.fa18c.presets;
export const presetsFor = aircraftId => aircraftById(aircraftId).presets;
export function presetLoadout(name = 'multirole', aircraftId = DEFAULT_AIRCRAFT_ID) {
  const aircraft = aircraftById(aircraftId), preset = aircraft.presets[name] || aircraft.presets.multirole;
  return aircraft.stations.map((s, i) => ({ station: s.id, store: preset.stores[i] || null, count: preset.stores[i] ? preset.doubles?.includes(s.id) ? 2 : 1 : 0 }));
}
// The longest-range loaded store of a kind; launch and lock checks use it.
export function storeRange(stores, kind) {
  return Math.max(0, ...stores.filter(s => s.count > 0 && STORES[s.store]?.kind === kind).map(s => STORES[s.store].range));
}
export function validateLoadout(loadout, aircraftId = DEFAULT_AIRCRAFT_ID) {
  const aircraft = aircraftById(aircraftId), errors = [];
  if (!Array.isArray(loadout) || loadout.length !== aircraft.stations.length) return { valid: false, errors: ['挂载必须包含全部挂点。'] };
  const seen = new Set(); let payloadKg = 0;
  for (const item of loadout) {
    const station = aircraft.stations.find(s => s.id === item?.station);
    if (!station || seen.has(item.station)) { errors.push('挂点编号无效或重复。'); continue; }
    seen.add(item.station);
    if (item.store === null && item.count === 0) continue;
    const store = STORES[item.store], capacity = station.allowed[item.store];
    if (!Object.hasOwn(STORES, item.store) || !Object.hasOwn(station.allowed, item.store)
      || !store || !capacity || !Number.isInteger(item.count) || item.count < 1 || item.count > capacity) {
      errors.push(`${station.id} 号${station.name}不支持此武器或数量。`); continue;
    }
    // Dual launcher mass is included in weight and drag, never extra missiles.
    const mass = store.massKg * item.count + (item.count === 2 ? 45 : 0);
    if (mass > station.limitKg) errors.push(`${station.id} 号挂点超出载荷限制。`);
    payloadKg += mass;
  }
  if (payloadKg > aircraft.real.maxPayloadKg) errors.push('超出飞机外挂总重限制。');
  if (aircraft.real.emptyKg + aircraft.real.internalFuelKg + payloadKg > aircraft.real.maxTakeoffKg) errors.push('超出最大起飞重量。');
  return { valid: errors.length === 0, errors, payloadKg };
}
export function normalizeLoadout(value, aircraftId = DEFAULT_AIRCRAFT_ID) {
  return validateLoadout(value, aircraftId).valid ? value.map(s => ({ station: s.station, store: s.store, count: s.count })) : presetLoadout('multirole', aircraftId);
}
export function loadoutSummary(loadout, aircraftId = DEFAULT_AIRCRAFT_ID) {
  const aircraft = aircraftById(aircraftId), slots = normalizeLoadout(loadout, aircraftId);
  let payloadKg = 0, drag = 0, moment = 0, air = 0, sea = 0, fuelKg = 0;
  for (const item of slots) {
    if (!item.store) continue;
    const store = STORES[item.store], station = aircraft.stations.find(s => s.id === item.station);
    const mass = store.massKg * item.count + (item.count === 2 ? 45 : 0);
    payloadKg += mass; drag += store.drag * item.count + (item.count === 2 ? .015 : 0); moment += mass * station.x;
    if (store.kind === 'anti-air') air += item.count;
    if (store.kind === 'anti-ship') sea += item.count;
    fuelKg += (store.fuelKg || 0) * item.count;
  }
  return { payloadKg, takeoffKg: aircraft.real.emptyKg + aircraft.real.internalFuelKg + payloadKg, drag, moment, air, sea, fuelKg,
    warning: Math.abs(moment) > 450 ? '左右挂载不平衡：滚转响应下降，建议左右配对。' : '' };
}
export const UPGRADE_TRACKS = freeze({
  engine: { name: '引擎', detail: '增加推力与加力效率，降低耗油。' },
  firepower: { name: '火力', detail: '提高武器伤害、机炮散热和锁定效率。' },
  defense: { name: '防御', detail: '增加机体耐久、减伤和诱饵持续时间。' },
  maneuver: { name: '机动性能', detail: '提高滚转、俯仰响应和低速控制。' },
});
export const UPGRADE_COSTS = freeze([300, 600, 1000, 1600, 2400]);
export const PILOT_XP = freeze([0, 500, 1500, 3500, 7000]);
export const pilotLevel = xp => PILOT_XP.filter(threshold => threshold <= xp).length;
export function normalizeWorkshop(value) {
  const levels = Object.fromEntries(Object.keys(UPGRADE_TRACKS).map(id => [id, boundedInt(value?.levels?.[id], 5)]));
  const loadouts = Object.fromEntries(Object.keys(AIRCRAFT).map(id => [id, normalizeLoadout(value?.loadouts?.[id], id)]));
  return { version: 1, credits: value ? boundedInt(value.credits, 100000000) : 1200, xp: boundedInt(value?.xp, 100000000), levels, loadouts };
}
export function upgradeAvailability(profile, track) {
  const p = normalizeWorkshop(profile), level = p.levels[track];
  if (!Object.hasOwn(UPGRADE_TRACKS, track)) return { allowed: false, reason: '未知升级项目。' };
  if (level >= 5) return { allowed: false, reason: '已满级', cost: 0 };
  const cost = UPGRADE_COSTS[level];
  if (pilotLevel(p.xp) < level + 1) return { allowed: false, cost, reason: `需要指挥官 ${level + 1} 级` };
  if (p.credits < cost) return { allowed: false, cost, reason: '改装点不足' };
  return { allowed: true, cost, reason: '' };
}
export function purchaseUpgrade(profile, track) {
  const p = normalizeWorkshop(profile), check = upgradeAvailability(p, track);
  if (!check.allowed) return { ok: false, profile: p, reason: check.reason };
  p.credits -= check.cost; p.levels[track] += 1;
  return { ok: true, profile: p };
}
// All aircraft use their own base values, with the same technology multipliers.
// The definition parameter supports new airframes without adding aircraft-specific upgrade logic.
export function effectiveAircraft(aircraftId, profile, loadout, definition = aircraftById(aircraftId)) {
  const p = normalizeWorkshop(profile), b = definition.base, r = definition.real;
  const summary = loadoutSummary(loadout || p.loadouts[aircraftId], aircraftId), l = p.levels;
  const massFactor = 1 / (1 + summary.payloadKg / (r.emptyKg + r.internalFuelKg) * .65);
  const handling = massFactor / (1 + summary.drag * .2 + Math.abs(summary.moment) / 25000);
  return { ...summary, aircraftId,
    maxHealth: Math.round(b.health * (1 + l.defense * .08)), damageTaken: 1 - l.defense * .025,
    maxAmmo: r.cannonRounds, maxFlares: b.flares + Math.floor(l.defense / 2), flareDuration: 2.6 * (1 + l.defense * .07),
    thrust: b.thrust * (1 + l.engine * .06) * massFactor, boostThrust: b.boostThrust * (1 + l.engine * .075) * massFactor,
    dragCoefficient: .00088 * (1 + summary.drag), maxSpeed: b.maxSpeed * (1 + l.engine * .018), boostSpeed: b.boostSpeed * (1 + l.engine * .018),
    fuelCapacity: r.internalFuelKg + summary.fuelKg, fuelRate: 1 - l.engine * .025,
    rollRate: b.rollRate * (1 + l.maneuver * .055) * handling, pitchRate: b.pitchRate * (1 + l.maneuver * .05) * handling,
    stallSpeed: 94 * (1 - l.maneuver * .012) / Math.sqrt(massFactor), response: 1 + l.maneuver * .055,
    damageMultiplier: 1 + l.firepower * .055, gunDamage: b.gunDamage * (1 + l.firepower * .055),
    gunInterval: b.gunInterval / (1 + l.firepower * .025), cooling: 1 + l.firepower * .07, lockFactor: 1 / (1 + l.firepower * .06),
  };
}
export function sortieReward(profile, sortie) {
  const p = normalizeWorkshop(profile);
  if (sortie.vehicle === 'destroyer' || ['training', 'naval-training'].includes(sortie.mode) || (!sortie.won && !sortie.kills)) return { profile: p, credits: 0, xp: 0 };
  const kills = boundedInt(sortie.kills, 10000), score = boundedInt(sortie.score, 10000000);
  const xp = kills * 100 + (sortie.won ? 300 : 0), credits = 100 + kills * 60 + Math.min(500, Math.floor(score / 20)) + (sortie.won ? 300 : 0);
  p.credits = Math.min(100000000, p.credits + credits); p.xp = Math.min(100000000, p.xp + xp);
  return { profile: p, credits, xp };
}
