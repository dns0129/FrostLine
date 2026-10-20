import { AIRCRAFT, UPGRADE_TRACKS,
  normalizeWorkshop, pilotLevel, effectiveAircraft, upgradeAvailability, purchaseUpgrade } from './aircraft-systems.js';

import { pilotProgress, AMMO_ORDER, ammoGrade, ammoPrice, ownsWeapon, purchaseWeapon, equipWeapon, PLAYER_DAMAGE_SCALE } from './combat-economy.js';
import { SHIPS } from './ship-systems.js';

const $ = id => document.getElementById(id);
const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
// The same shop appears inside the hangar and at the naval base.
export function renderWeaponShop(root, profile, { aircraftId = 'fa18c', shipId = null, onChange = () => {} } = {}) {
  const stats = effectiveAircraft(aircraftId, profile), ship = SHIPS[shipId];
  root.replaceChildren(...['missile', 'gun'].map(kind => {
    const section = element('section', 'weapon-shop-section');
    section.append(element('h3', '', kind === 'missile' ? '导弹系统 · 空空 / 防空 / 反舰' : '机炮系统 · 机炮 / 舰炮'));
    const grid = element('div', 'ammo-grade-grid');
    for (const tier of AMMO_ORDER) {
      const grade = ammoGrade(kind, tier), owned = ownsWeapon(profile, kind, tier), selected = profile.ammoTiers[kind] === tier;
      const card = element('article', 'weapon-shop-card' + (selected ? ' equipped' : ''));
      const base = kind === 'gun' ? ship ? ship.gunDamage * PLAYER_DAMAGE_SCALE : stats.gunDamage
        : (ship ? ship.samDamage : 125) * (ship ? PLAYER_DAMAGE_SCALE : stats.damageMultiplier);
      card.dataset.weaponKind = kind; card.dataset.weaponTier = tier;
      card.append(element('strong', '', grade.name), element('span', '', `伤害 ×${grade.multiplier} · ${Math.round(base * grade.multiplier * 10) / 10}`),
        element('span', '', kind === 'gun' ? `弹匣打空后 ${grade.reload} 秒补满 · 局内无限` : `基础补充：空空 ${grade.reload} 秒 / 反舰 ${grade.reload * 1.5} 秒`),
        element('small', '', owned ? '已永久拥有 · 开火不扣币' : ammoPrice(kind, tier)));
      const affordable = !grade.cost || profile[grade.currency] >= grade.cost;
      const button = element('button', 'weapon-shop-action', selected ? '已装备' : owned ? '装备' : affordable ? `购买 · ${grade.cost} ${grade.currency === 'silver' ? '银币' : '金币'}` : `${grade.currency === 'silver' ? '银币' : '金币'}不足 · ${grade.cost}`);
      button.dataset.weaponAction = owned ? 'equip' : 'purchase'; button.dataset.weaponKind = kind; button.dataset.weaponTier = tier;
      button.disabled = selected || !owned && !affordable; button.setAttribute('aria-pressed', String(selected));
      button.addEventListener('click', () => onChange(kind, tier, owned ? 'equip' : 'purchase'));
      card.append(button); grid.append(card);
    }
    section.append(grid); return section;
  }));
}
export class HangarWorkshop {
  constructor(profile, onChange) {
    this.profile = normalizeWorkshop(profile); this.onChange = onChange;
    this.aircraftId = 'fa18c'; this.saved = true;
    $('workshopPanel').addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const items = [...$('workshopPanel').querySelectorAll('button:not(:disabled),select:not(:disabled),a[href]')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  setProfile(profile) { this.profile = normalizeWorkshop(profile); this.render(); }
  setAircraft(aircraftId) { this.aircraftId = Object.hasOwn(AIRCRAFT, aircraftId) ? aircraftId : 'fa18c'; }
  commit(profile, message) {
    this.profile = normalizeWorkshop(profile);
    this.saved = this.onChange(this.profile) !== false;
    this.render();
    $('workshopStatus').textContent = this.saved ? message + ' · 已保存' : message + ' · 浏览器存储不可用，关闭页面后将丢失';
  }
  render() {
    const p = this.profile, aircraft = AIRCRAFT[this.aircraftId], stats = effectiveAircraft(this.aircraftId, p), level = pilotLevel(p.xp);
    $('workshopEyebrow').textContent = 'HANGAR / WEAPONS & TECHNOLOGY';
    $('workshopSourceNote').textContent = '武器伤害、无限补充与冷却均为游戏参数，飞机外形和重量参考公开资料。';
    $('workshopAircraft').textContent = `${aircraft.name} · ${aircraft.role}`;
    renderWeaponShop($('hangarWeaponShop'), p, { aircraftId: this.aircraftId, onChange: (kind, tier, action) => {
      const result = action === 'purchase' ? purchaseWeapon(this.profile, kind, tier) : equipWeapon(this.profile, kind, tier);
      if (result.ok) this.commit(result.profile, `${ammoGrade(kind, tier).name}${action === 'purchase' ? '已永久购买并装备' : '已装备'}`);
      else $('workshopStatus').textContent = result.reason;
    } });
    $('workshopRank').textContent = `指挥官 ${level} 级`;
    $('workshopCredits').textContent = `${p.silver.toLocaleString()} 银币 · ${p.gold.toLocaleString()} 金币`;
    const xp = pilotProgress(p.xp);
    $('workshopXp').textContent = xp.needed ? `本级 ${xp.current} / ${xp.needed} XP · 距下一级 ${xp.remaining} XP` : `${p.xp} XP · 指挥官已满 30 级`;
    $('workshopXpBar').value = xp.fraction;
    $('upgradeTracks').replaceChildren(...Object.entries(UPGRADE_TRACKS).map(([id, track]) => {
      const current = p.levels[id], check = upgradeAvailability(p, id), next = effectiveAircraft(this.aircraftId, { ...p, levels: { ...p.levels, [id]: Math.min(5, current + 1) } });
      const row = element('article', 'upgrade-track');
      const head = element('div', 'upgrade-head'); head.append(element('h3', '', track.name), element('span', '', `${current} / 5`));
      const tiers = element('div', 'upgrade-tiers'); tiers.setAttribute('aria-label', `${track.name} ${current} 级`);
      for (let i = 1; i <= 5; i++) tiers.append(element('i', i <= current ? 'active' : ''));
      const metric = s => id === 'engine' ? `推力指数 ${(s.thrust + s.boostThrust).toFixed(1)}` : id === 'firepower' ? `伤害 ${Math.round(s.damageMultiplier * 100)}%`
        : id === 'defense' ? `机体 ${s.maxHealth} HP` : `滚转 ${Math.round(s.rollRate * 180 / Math.PI)}°/s`;
      const button = element('button', 'upgrade-buy', check.allowed ? `升级 · ${check.cost} 银币` : check.reason);
      button.dataset.upgrade = id; button.disabled = !check.allowed;
      button.addEventListener('click', () => {
        const purchase = purchaseUpgrade(this.profile, id);
        if (purchase.ok) this.commit(purchase.profile, `${track.name}已升至 ${current + 1} 级`);
      });
      row.append(head, tiers, element('p', '', track.detail), element('div', 'upgrade-preview', current < 5 ? `${metric(stats)} → ${metric(next)}` : metric(stats)), button);
      return row;
    }));
    $('workshopStatus').textContent = this.saved ? '配置自动保存 · 下次出击生效' : '浏览器存储不可用 · 本次页面内有效';
  }
}
