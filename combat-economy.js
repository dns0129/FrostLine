// Fictional ammunition grades and browser-local earned currencies; no payments.
export const PLAYER_DAMAGE_SCALE = .85;
export const CURRENCY_LIMIT = 100000000;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const AMMO_GRADES = freeze({
  missile: {
    basic: { name: '基础导弹 M-I', short: 'M-I', multiplier: 1, currency: null, cost: 0, reload: 5 },
    silver: { name: '强化导弹 M-II', short: 'M-II', multiplier: 1.4, currency: 'silver', cost: 900, reload: 7 },
    gold: { name: '精锐导弹 M-III', short: 'M-III', multiplier: 2, currency: 'gold', cost: 120, reload: 9 },
  },
  gun: {
    basic: { name: '标准机炮', short: '标准炮', multiplier: 1, currency: null, cost: 0, reload: 3 },
    silver: { name: '穿甲机炮', short: '穿甲炮', multiplier: 1.4, currency: 'silver', cost: 600, reload: 3.5 },
    gold: { name: '高爆机炮', short: '高爆炮', multiplier: 2.2, currency: 'gold', cost: 80, reload: 4 },
  },
});
export const AMMO_ORDER = Object.freeze(['basic', 'silver', 'gold']);
export const GUN_MAGAZINE = Object.freeze({ aircraft: 60, destroyer: 12 });
export const boundedCurrency = value => Number.isFinite(value) ? Math.max(0, Math.min(CURRENCY_LIMIT, Math.floor(value))) : 0;
export const ammoGrade = (kind, id) => Object.hasOwn(AMMO_GRADES, kind) ? Object.hasOwn(AMMO_GRADES[kind], id) ? AMMO_GRADES[kind][id] : AMMO_GRADES[kind].basic : null;
export function normalizeEconomy(value) {
  const ownedWeapons = {}, ammoTiers = {};
  for (const kind of ['missile', 'gun']) {
    // Prior versions sold ammunition per shot. Preserve the selected weapon as
    // an owned unlock once when migrating; v3 accepts only explicit ownership.
    const selected = Object.hasOwn(AMMO_GRADES[kind], value?.ammoTiers?.[kind]) ? value.ammoTiers[kind] : 'basic';
    const saved = Array.isArray(value?.ownedWeapons?.[kind]) ? value.ownedWeapons[kind] : [];
    ownedWeapons[kind] = AMMO_ORDER.filter(tier => tier === 'basic' || (value?.version >= 3 ? saved.includes(tier) : selected === tier));
    ammoTiers[kind] = ownedWeapons[kind].includes(selected) ? selected : 'basic';
  }
  return { silver: value ? boundedCurrency(value.silver ?? value.credits) : 1200,
    gold: value?.version >= 2 ? boundedCurrency(value.gold) : value?.gold === undefined ? 25 : boundedCurrency(value.gold), ownedWeapons, ammoTiers };
}
export const ammoPrice = (kind, id) => {
  const grade = ammoGrade(kind, id);
  return grade?.cost ? `${grade.cost} ${grade.currency === 'silver' ? '银币' : '金币'} · 永久解锁` : '免费拥有';
};
export function ownsWeapon(profile, kind, tier) {
  return Object.hasOwn(AMMO_GRADES, kind) && Object.hasOwn(AMMO_GRADES[kind], tier)
    && normalizeEconomy(profile).ownedWeapons[kind].includes(tier);
}
export function purchaseWeapon(profile, kind, tier) {
  const economy = normalizeEconomy(profile), next = { ...profile, ...economy, version: 3, credits: economy.silver };
  if (!Object.hasOwn(AMMO_GRADES, kind) || !Object.hasOwn(AMMO_GRADES[kind], tier)) return { ok: false, profile: next, reason: '未知武器' };
  if (economy.ownedWeapons[kind].includes(tier)) return { ok: false, profile: next, reason: '已永久拥有，无需重复购买' };
  const weapon = ammoGrade(kind, tier);
  if (economy[weapon.currency] < weapon.cost) return { ok: false, profile: next, reason: `${weapon.currency === 'silver' ? '银币' : '金币'}不足` };
  next[weapon.currency] -= weapon.cost; next.credits = next.silver;
  next.ownedWeapons[kind] = AMMO_ORDER.filter(id => id === tier || economy.ownedWeapons[kind].includes(id));
  next.ammoTiers[kind] = tier;
  return { ok: true, profile: next, reason: '' };
}
export function equipWeapon(profile, kind, tier) {
  const economy = normalizeEconomy(profile);
  if (!Object.hasOwn(AMMO_GRADES, kind) || !economy.ownedWeapons[kind]?.includes(tier)) return { ok: false, profile, reason: '请先在机库购买此武器' };
  return { ok: true, profile: { ...profile, ...economy, version: 3, credits: economy.silver, ammoTiers: { ...economy.ammoTiers, [kind]: tier } } };
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
