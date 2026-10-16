import { AIRCRAFT, STORES, presetsFor, UPGRADE_TRACKS, PILOT_XP, presetLoadout, loadoutSummary, validateLoadout,
  normalizeWorkshop, pilotLevel, effectiveAircraft, upgradeAvailability, purchaseUpgrade } from './aircraft-systems.js';

const $ = id => document.getElementById(id);
const element = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
// Header copy per airframe; the source note distinguishes published figures from estimates.
const WORKSHOP_COPY = {
  fa18c: { eyebrow: 'HORNET / AIRCRAFT WORKSHOP', source: '兼容性与公开重量参考现实 F/A-18C；单挂点重量上限、飞行响应、升级增益和射程采用游戏参数。' },
  j16: { eyebrow: 'J-16 / AIRCRAFT WORKSHOP', source: '歼-16 无官方公开参数，重量与挂点为公开估计值及模型挂架；单挂点上限、飞行响应、升级增益和射程采用游戏参数。' },
};
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
  commitLoadout(loadout) {
    const check = validateLoadout(loadout, this.aircraftId);
    if (!check.valid) { $('workshopStatus').textContent = check.errors.join(' '); return; }
    this.commit({ ...this.profile, loadouts: { ...this.profile.loadouts, [this.aircraftId]: loadout } }, '挂载已更新');
  }
  render() {
    const p = this.profile, aircraft = AIRCRAFT[this.aircraftId], slots = p.loadouts[this.aircraftId];
    const stats = effectiveAircraft(this.aircraftId, p), summary = loadoutSummary(slots, this.aircraftId), level = pilotLevel(p.xp);
    const copy = WORKSHOP_COPY[this.aircraftId];
    $('workshopEyebrow').textContent = copy.eyebrow; $('workshopSourceNote').textContent = copy.source;
    $('workshopAircraft').textContent = `${aircraft.name} · ${aircraft.role}`;
    $('workshopStationCount').textContent = `${aircraft.stations.length} 个挂点`; $('loadoutNote').textContent = aircraft.workshopNote;
    // SVG elements have no `hidden` property; toggle the attribute itself.
    document.querySelectorAll('.hardpoint-map').forEach(map => map.toggleAttribute('hidden', map.dataset.aircraft !== this.aircraftId));
    // Rebuild preset buttons only when the airframe changes, so a click keeps focus.
    if (this.presetAircraft !== this.aircraftId) $('loadoutPresets').replaceChildren(...Object.entries(presetsFor(this.aircraftId)).map(([id, preset]) => {
      const button = element('button', 'workshop-preset', preset.name); button.dataset.preset = id;
      button.addEventListener('click', () => this.commitLoadout(presetLoadout(id, this.aircraftId)));
      return button;
    }));
    this.presetAircraft = this.aircraftId;
    $('workshopRank').textContent = `指挥官 ${level} 级`;
    $('workshopCredits').textContent = `${p.credits.toLocaleString()} 改装点`;
    const nextXp = PILOT_XP[level];
    $('workshopXp').textContent = nextXp ? `${p.xp} / ${nextXp} XP · 下一级解锁更高阶改装` : `${p.xp} XP · 全部阶级已开放`;
    $('workshopXpBar').value = nextXp ? (p.xp - PILOT_XP[level - 1]) / (nextXp - PILOT_XP[level - 1]) : 1;
    const focused = document.activeElement?.dataset?.station;
    $('hardpointGrid').replaceChildren(...aircraft.stations.map(station => {
      const item = slots.find(s => s.station === station.id), row = element('div', 'hardpoint-row');
      const label = element('label', 'hardpoint-label'); label.htmlFor = `station-${station.id}`;
      label.append(element('b', '', String(station.id).padStart(2, '0')), document.createTextNode(station.name));
      const select = element('select', 'hardpoint-select'); select.id = label.htmlFor; select.dataset.station = station.id;
      select.add(new Option('空挂', 'empty'));
      for (const [id, max] of Object.entries(station.allowed)) for (let count = 1; count <= max; count++) {
        select.add(new Option(`${STORES[id].short} × ${count}${count === 2 ? ' · 双联挂架' : ''}`, `${id}:${count}`));
      }
      select.value = item.store ? `${item.store}:${item.count}` : 'empty';
      select.addEventListener('change', () => {
        const [store, quantity] = select.value.split(':');
        const updated = slots.map(s => s.station === station.id ? { station: s.station, store: store === 'empty' ? null : store, count: store === 'empty' ? 0 : Number(quantity) } : { ...s });
        this.commitLoadout(updated);
      });
      const hint = item.store ? STORES[item.store].guidance : Object.keys(station.allowed).map(id => STORES[id].short).join(' / ');
      row.append(label, select, element('small', '', hint)); return row;
    }));
    if (focused) $(`station-${focused}`)?.focus();
    $('loadoutMass').textContent = `${Math.round(summary.payloadKg).toLocaleString()} / ${aircraft.real.maxPayloadKg.toLocaleString()} kg`;
    $('loadoutTakeoff').textContent = `${Math.round(summary.takeoffKg).toLocaleString()} / ${aircraft.real.maxTakeoffKg.toLocaleString()} kg`;
    $('loadoutInventory').textContent = `空空 ${summary.air} · 反舰 ${summary.sea} · ${aircraft.gun} ${stats.maxAmmo} 发`;
    $('loadoutWarning').textContent = summary.warning || '挂点与起飞重量检查通过';
    $('loadoutWarning').classList.toggle('unbalanced', !!summary.warning);
    $('upgradeTracks').replaceChildren(...Object.entries(UPGRADE_TRACKS).map(([id, track]) => {
      const current = p.levels[id], check = upgradeAvailability(p, id), next = effectiveAircraft(this.aircraftId, { ...p, levels: { ...p.levels, [id]: Math.min(5, current + 1) } });
      const row = element('article', 'upgrade-track');
      const head = element('div', 'upgrade-head'); head.append(element('h3', '', track.name), element('span', '', `${current} / 5`));
      const tiers = element('div', 'upgrade-tiers'); tiers.setAttribute('aria-label', `${track.name} ${current} 级`);
      for (let i = 1; i <= 5; i++) tiers.append(element('i', i <= current ? 'active' : ''));
      const metric = s => id === 'engine' ? `推力指数 ${(s.thrust + s.boostThrust).toFixed(1)}` : id === 'firepower' ? `伤害 ${Math.round(s.damageMultiplier * 100)}%`
        : id === 'defense' ? `机体 ${s.maxHealth} HP` : `滚转 ${Math.round(s.rollRate * 180 / Math.PI)}°/s`;
      const button = element('button', 'upgrade-buy', check.allowed ? `升级 · ${check.cost} 点` : check.reason);
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
