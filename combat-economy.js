// Fictional ammunition grades and browser-local earned currencies; no payments.
export const PLAYER_DAMAGE_SCALE = .85;
export const CURRENCY_LIMIT = 100000000;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const AMMO_GRADES = freeze({
  missile: {
    basic: { name: '基础导弹 M-I', short: 'M-I', multiplier: 1, currency: null, cost: 0 },
    silver: { name: '强化导弹 M-II', short: 'M-II', multiplier: 1.4, currency: 'silver', cost: 30 },
    gold: { name: '精锐导弹 M-III', short: 'M-III', multiplier: 2, currency: 'gold', cost: 4 },
  },
  gun: {
    basic: { name: '普通机炮弹', short: '普通弹', multiplier: 1, currency: null, cost: 0 },
    silver: { name: '穿甲机炮弹', short: '穿甲弹', multiplier: 1.4, currency: 'silver', cost: 1 },
    gold: { name: '高爆机炮弹', short: '高爆弹', multiplier: 2.2, currency: 'gold', cost: 1 },
  },
});
export const AMMO_ORDER = Object.freeze(['basic', 'silver', 'gold']);
export const boundedCurrency = value => Number.isFinite(value) ? Math.max(0, Math.min(CURRENCY_LIMIT, Math.floor(value))) : 0;
export const ammoGrade = (kind, id) => Object.hasOwn(AMMO_GRADES, kind) ? Object.hasOwn(AMMO_GRADES[kind], id) ? AMMO_GRADES[kind][id] : AMMO_GRADES[kind].basic : null;
export function normalizeEconomy(value) {
  const ammoTiers = Object.fromEntries(['missile', 'gun'].map(kind => [kind, Object.hasOwn(AMMO_GRADES[kind], value?.ammoTiers?.[kind]) ? value.ammoTiers[kind] : 'basic']));
  return { silver: value ? boundedCurrency(value.silver ?? value.credits) : 1200,
    gold: value?.version === 2 ? boundedCurrency(value.gold) : value?.gold === undefined ? 25 : boundedCurrency(value.gold), ammoTiers };
}
export const ammoPrice = (kind, id) => {
  const grade = ammoGrade(kind, id);
  return grade.cost ? `${grade.cost} ${grade.currency === 'silver' ? '银币' : '金币'} / ${kind === 'gun' ? '发' : '枚'}` : '免费 · 无限';
};
export function spendAmmunition(wallet, kind, tier, training = false) {
  if (!Object.hasOwn(AMMO_GRADES, kind)) throw new RangeError('Unknown ammunition kind');
  const selected = training ? 'basic' : Object.hasOwn(AMMO_GRADES[kind], tier) ? tier : 'basic';
  const grade = ammoGrade(kind, selected), next = { silver: boundedCurrency(wallet?.silver), gold: boundedCurrency(wallet?.gold) };
  const fallback = !!grade.cost && next[grade.currency] < grade.cost;
  if (grade.cost && !fallback) next[grade.currency] -= grade.cost;
  return { wallet: next, tier: fallback ? 'basic' : selected, grade: ammoGrade(kind, fallback ? 'basic' : selected), fallback };
}
// Thirty commander levels: each level needs 200 more XP than its predecessor.
export const PILOT_XP = Object.freeze(Array.from({ length: 30 }, (_, i) => i * 400 + i * (i - 1) * 100));
export const pilotLevel = xp => Math.max(1, PILOT_XP.filter(threshold => threshold <= boundedCurrency(xp)).length);
export function pilotProgress(xp) {
  const total = boundedCurrency(xp), level = pilotLevel(total), start = PILOT_XP[level - 1], next = PILOT_XP[level];
  return { level, total, current: total - start, needed: next ? next - start : 0, remaining: next ? next - total : 0,
    fraction: next ? (total - start) / (next - start) : 1 };
}
export const UPGRADE_PILOT_LEVELS = Object.freeze([1, 3, 5, 8, 12]);
