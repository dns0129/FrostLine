import { CAMPAIGN_LEVELS, CAMPAIGN_TITLE, CAMPAIGN_SYNOPSIS, campaignUnlocked, recommendedCampaignLevel } from './campaign.js';
import { MAPS, DEFAULT_MAP_ID, getMap } from './maps.js';
import { BRIEFING_PAGES, SORTIE_MODES, missionChoices, missionBriefing } from './mission-briefing.js';
import { icebergFrame, icebergRadius } from './world-math.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = value => String(value).padStart(2, '0');
const plane = 'm0-18 4 13 14 7v4l-14-4-2 12h-4l-2-12-14 4v-4l14-7Z';
const ship = 'm-17-5 34 0-6 13h-22Z M-8-5v-9h16v9 M0-14v-12m-7 5h14';
let chartId = 0;

// The chart uses the selected map's island coordinates. Hostile markers are
// schematic estimates, never a claim to reveal live enemy positions.
export function tacticalChart(briefing, route = false) {
  const id = `sortie-chart-${++chartId}`, area = briefing.map;
  const project = (x, z) => [500 + x * .042, 320 + z * .033];
  let land = '';
  for (const island of area.islands.filter(i => !i.distant)) {
    const [cx, cy] = project(island.x, island.z);
    for (const scale of [1, .8, .58, .36]) {
      const points = Array.from({ length: 65 }, (_, i) => {
        const a = i / 64 * Math.PI * 2, r = 1 + Math.sin(a * 3 + island.seed) * .13 + Math.cos(a * 5 - island.seed) * .08;
        return `${i ? 'L' : 'M'}${(cx + Math.cos(a) * island.radius * .042 * r * scale).toFixed(1)},${(cy + Math.sin(a) * island.radius * .033 * r * scale).toFixed(1)}`;
      }).join(' ');
      land += `<path d="${points}Z" class="${scale === 1 ? 'tactical-land' : 'tactical-contour'}"/>`;
    }
  }
  // Solid icebergs are navigation hazards; larger ones use their true outline.
  for (const berg of (area.icebergs ?? []).filter(b => b.radius >= 60)) {
    const frame = icebergFrame(berg);
    const points = Array.from({ length: 16 }, (_, i) => {
      const a = i / 16 * Math.PI * 2, r = icebergRadius(berg, a), u = Math.cos(a) * r * frame.stretch, v = Math.sin(a) * r;
      const [x, y] = project(berg.x + u * frame.cos - v * frame.sin, berg.z + u * frame.sin + v * frame.cos);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    land += `<path d="${points}Z" class="tactical-ice"/>`;
  }
  const marker = (x, y, type, label, className = 'allied', labelY = 39) => `<g class="tactical-marker ${className}" transform="translate(${x},${y})"><path d="${type === 'ship' ? ship : plane}"/><text y="${labelY}" text-anchor="middle">${escapeHTML(label)}</text></g>`;
  let markers;
  if (route) {
    markers = '<path class="campaign-chart-route" d="M130 210H870V390H130"/>';
    markers += CAMPAIGN_LEVELS.map((level, i) => {
      const x = 130 + (i < 5 ? i : 9 - i) * 185, y = i < 5 ? 210 : 390;
      return `<g class="campaign-chart-node ${briefing.chapter === level.id ? 'active' : ''}" transform="translate(${x},${y})"><circle r="13"/><circle r="5"/><text y="36" text-anchor="middle">${n(i + 1)} ${level.title}</text><text y="57" text-anchor="middle" class="campaign-chart-area">${getMap(level.mapId).name}</text></g>`;
    }).join('');
  } else {
    const [px, py] = project(briefing.spawn[0], briefing.spawn[2]);
    markers = marker(px, py, briefing.ship ? 'ship' : 'plane', '玩家起点');
    if (briefing.wingmen) markers += marker(px - 70, py + 12, 'plane', '三架僚机', 'allied', 46);
    if (briefing.mixed) markers += marker(px + 135, py - 125, 'ship', '驱逐舰（示意）', 'hostile');
    if (briefing.fleet) {
      const [fx, fy] = project(briefing.fleet.x, briefing.fleet.z);
      markers = `<ellipse cx="${fx}" cy="${fy}" rx="${briefing.radius * .042}" ry="${briefing.radius * .033}" class="tactical-zone"/><text x="${fx}" y="${fy - briefing.radius * .033 - 13}" text-anchor="middle" class="tactical-zone-label">防区 ${briefing.radius / 1000} km</text>` + markers;
      markers += marker(fx, fy, 'ship', '护航编队', 'allied', -30);
      markers += `<path class="tactical-estimate" d="M${fx},${fy - 220}L${fx},${fy - 175}" marker-end="url(#${id}-arrow)"/>`;
      markers += marker(fx, fy - 240, 'plane', '增援方向（示意）', 'hostile');
    } else {
      markers += marker(px + 38, py - 115, briefing.naval ? 'ship' : 'plane', `${briefing.training ? '训练靶标' : '首批目标'}（示意）`, 'hostile');
    }
  }
  return `<svg class="tactical-chart" viewBox="0 0 1000 650" role="img" aria-label="${escapeHTML(area.name)}${route ? '战役章节航线' : '部署示意图，含玩家起点、目标区域' + (briefing.fleet ? '和护航防区' : '')}"><defs><pattern id="${id}" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#849fa4" stroke-opacity=".14"/></pattern><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="m0 0 10 5-10 5Z" fill="#dd9871"/></marker></defs><rect width="1000" height="650" fill="#102630"/><rect width="1000" height="650" fill="url(#${id})"/>${land}${markers}<g class="tactical-compass" transform="translate(55,60)"><path d="M0-19V19M-19 0H19m-6-13-26 26m0-26 26 26"/><text y="-29" text-anchor="middle">N</text></g><text class="tactical-map-name" x="40" y="135">${escapeHTML(area.name)}</text><g class="tactical-scale" transform="translate(760,602)"><path d="M0-5V0H168V-5M84-5V0"/><text y="-13">0</text><text x="140" y="-13">4 km</text></g></svg>`;
}

export class SortieFlow {
  constructor(root, callbacks) {
    this.root = root; this.callbacks = callbacks; this.screen = 'mode'; this.category = 'quick'; this.page = 0; this.selection = 'intercept';
    root.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button || button.disabled) return;
      if (button.dataset.category) {
        this.category = button.dataset.category;
        const context = this.callbacks.context();
        this.selection = this.category === 'campaign' ? recommendedCampaignLevel(context.progress).id : missionChoices(this.category, context.vehicle.id)[0].id;
        this.choose(); this.render(`[data-category="${this.category}"]`);
      } else if (button.dataset.mission) {
        this.selection = button.dataset.mission; this.choose(); this.render(`[data-mission="${this.selection}"]`);
      } else if (button.dataset.briefPage !== undefined) { this.page = Number(button.dataset.briefPage); this.render('[aria-current="page"]'); }
      else if (button.dataset.sortieMap) { this.callbacks.onMap(button.dataset.sortieMap); this.render(`[data-sortie-map="${button.dataset.sortieMap}"]`); }
      else if (button.dataset.flowAction === 'back') this.back();
      else if (button.dataset.flowAction === 'base') this.close();
      else if (button.dataset.flowAction === 'workshop') this.callbacks.onWorkshop();
      else if (button.dataset.flowAction === 'next') this.next();
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.back(); }
      if (event.target.matches('[data-brief-page]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        this.page = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (this.page + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
        this.render('[aria-current="page"]');
      }
    });
  }
  get active() { return !this.root.hidden; }
  open({ chapter } = {}) {
    this.screen = chapter ? 'briefing' : 'mode'; this.page = 0;
    if (chapter) { this.category = 'campaign'; this.selection = chapter; }
    else if (this.callbacks.context().ship && this.category === 'campaign') { this.category = 'quick'; this.selection = 'intercept'; }
    this.choose(); this.root.hidden = false; this.callbacks.onOpen(); this.render();
  }
  hide() { this.root.hidden = true; }
  close() { this.hide(); this.callbacks.onClose(); }
  refresh() { if (this.active) this.render(); }
  choose() { this.callbacks.onChoose({ mode: this.category === 'campaign' ? 'campaign' : this.selection, chapter: this.category === 'campaign' ? this.selection : null }); }
  data() { const c = this.callbacks.context(); return missionBriefing({ ...c, vehicle: c.vehicle.id, chapter: this.selection, mode: this.category === 'campaign' ? 'campaign' : this.selection }); }
  back() {
    if (this.screen === 'mode') return this.close();
    if (this.screen === 'missions') this.screen = 'mode';
    else if (this.page > 0) this.page--;
    else this.screen = 'missions';
    this.render();
  }
  next() {
    if (this.screen === 'mode') this.screen = 'missions';
    else if (this.screen === 'missions') { this.screen = 'briefing'; this.page = 0; }
    else if (this.page < 3) this.page++;
    else { if (!this.data().canLaunch) return; this.callbacks.onLaunch(); return; }
    this.render();
  }
  render(focusSelector = '#sortieTitle') {
    const c = this.callbacks.context(), b = this.data();
    const section = this.screen === 'mode' ? 0 : this.screen === 'missions' ? 1 : 2;
    const backLabel = this.screen === 'mode' ? '返回基地' : this.screen === 'missions' ? '返回模式' : '返回剧本';
    const header = `<header class="sortie-header"><button data-flow-action="${this.screen === 'briefing' ? 'selection' : 'back'}" class="flow-back">← <span>${backLabel}</span></button><a href="#" class="sortie-brand" aria-label="Frost Line 基地" data-flow-home>FROSTLINE<small>AIR & SEA COMBAT</small></a>${this.screen === 'briefing' ? `<nav class="briefing-pagination" aria-label="作战简报分页">${BRIEFING_PAGES.map((title, i) => `<button data-brief-page="${i}" ${i === this.page ? 'aria-current="page"' : ''}><span>${n(i + 1)}</span> ${title}</button>`).join('')}</nav>` : `<ol class="sortie-breadcrumb">${['模式', '剧本', '作战简报'].map((title, i) => `<li ${i === section ? 'aria-current="step"' : ''}><span>${n(i + 1)}</span> ${title}</li>`).join('')}</ol>`}<div class="sortie-context">${this.screen === 'briefing' ? (this.category === 'campaign' ? `${CAMPAIGN_TITLE}<small>${b.title}</small>` : `${escapeHTML(b.title)}<small>${escapeHTML(b.map.name)}</small>`) : escapeHTML(c.vehicle.code + ' ' + c.vehicle.name)}</div></header>`;
    let content, title, eyebrow;
    if (this.screen === 'mode') {
      title = '选择游戏模式'; eyebrow = 'YOUR NEXT SORTIE';
      content = `<div class="mode-cards">${SORTIE_MODES.map((mode, i) => `<button class="mode-card mode-art-${mode.id}" data-category="${mode.id}" aria-pressed="${this.category === mode.id}" ${mode.id === 'campaign' && c.ship ? 'disabled' : ''}><span class="mode-number">${n(i + 1)}</span><span class="mode-card-copy"><small>${mode.english}</small><strong>${mode.title}</strong><span>${mode.id === 'campaign' && c.ship ? '战机专属 · 请在机库选择战机' : mode.description}</span></span><span class="mode-selected" aria-hidden="true">↗</span></button>`).join('')}</div>${c.ship ? '<p class="flow-caption">海军基地可选择快速任务或训练。暗潮行动战役使用机库中的战机。</p>' : '<p class="flow-caption">选择出击方式，下一步查看剧本。当前载具与挂载将用于本次任务。</p>'}`;
    } else if (this.screen === 'missions') {
      title = this.category === 'campaign' ? '选择剧本与章节' : this.category === 'training' ? '选择训练任务' : '选择作战任务'; eyebrow = SORTIE_MODES.find(mode => mode.id === this.category).english;
      const choices = missionChoices(this.category, c.vehicle.id);
      const cards = `<div class="sortie-mission-list" role="group" aria-label="选择剧本">${choices.map((choice, i) => {
        const completed = c.progress?.completed?.[choice.id], locked = this.category === 'campaign' && !campaignUnlocked(c.progress, choice.id);
        return `<button data-mission="${choice.id}" aria-pressed="${choice.id === this.selection}" class="sortie-mission ${locked ? 'locked' : ''}"><span>${n(i + 1)}</span><span><strong>${choice.title}</strong><small>${choice.subtitle}</small></span><em>${completed ? '已完成' : locked ? '未解锁' : '可出击'}</em></button>`;
      }).join('')}</div>`;
      content = `<div class="mission-selection ${this.category === 'campaign' ? 'campaign-selection' : ''}"><div class="selection-map">${tacticalChart(b, this.category === 'campaign')}<div class="selection-map-copy"><span>${this.category === 'campaign' ? 'STORY CAMPAIGN / 10' : 'THEATRE OF OPERATIONS'}</span><h3>${this.category === 'campaign' ? CAMPAIGN_TITLE : b.map.name}</h3><p>${this.category === 'campaign' ? CAMPAIGN_SYNOPSIS : b.map.description}</p></div></div><aside class="selection-sidebar">${cards}<div class="selection-description"><h3>${b.title}</h3><p>${b.location}</p><p>${b.subtitle}</p><span class="selection-status">${escapeHTML(b.blocked || (this.category === 'campaign' ? `战役进度 ${Object.keys(c.progress.completed).length} / ${CAMPAIGN_LEVELS.length}` : '准备就绪 · 可查看任务简报'))}</span></div></aside></div>${this.category !== 'campaign' ? `<fieldset class="sortie-map-options"><legend>作战区域</legend>${MAPS.map(area => `<button data-sortie-map="${area.id}" aria-pressed="${area.id === c.map}">${area.name}</button>`).join('')}</fieldset>` : '<p class="flow-caption">十关使用十张指定地图，难度逐关提升。未解锁章节可阅读简报；每次通关均发银币，整备后继续下一关。</p>'}`;
    } else {
      title = this.page === 0 ? b.title : this.page === 1 ? '剧本细节' : this.page === 2 ? '部署情况' : '确认作战目标'; eyebrow = this.page === 0 ? b.code : `${b.title} / ${BRIEFING_PAGES[this.page]}`;
      if (this.page === 0) content = `<div class="briefing-hero ${b.ship ? 'naval-hero' : ''}"><div class="briefing-hero-copy"><p class="hero-location">${escapeHTML(b.location)}</p><p class="hero-story">${escapeHTML(b.story)}</p><dl class="briefing-metrics"><div><dt>任务类型</dt><dd>${escapeHTML(b.subtitle)}</dd></div><div><dt>任务时限</dt><dd>${b.time}</dd></div><div><dt>推荐载具</dt><dd>${b.recommended}</dd></div>${b.rewardPoints ? `<div><dt>通关银币</dt><dd>+${b.rewardPoints} 点</dd></div>` : ''}</dl>${b.radio ? `<blockquote>${escapeHTML(b.radio)}</blockquote>` : ''}</div><div class="hero-art" aria-hidden="true"></div></div>`;
      if (this.page === 1) content = `<div class="briefing-details"><section class="briefing-timeline"><h3>作战进程</h3><ol>${b.steps.map(([heading, text], i) => `<li><span>${n(i + 1)}</span><div><h4>${escapeHTML(heading)}</h4><p>${escapeHTML(text)}</p></div></li>`).join('')}</ol></section><aside class="briefing-rule-column"><section class="briefing-rule"><span>SUPPLY & RULES</span><h3>补给与规则</h3><p>${escapeHTML(b.rules)}</p></section><section class="briefing-rule"><span>THREAT INTELLIGENCE</span><h3>威胁情报</h3><p>${escapeHTML(b.enemy)}</p><p>${escapeHTML(b.threats)}</p></section></aside><p class="briefing-description">${escapeHTML(b.description)}</p></div>`;
      if (this.page === 2) content = `<div class="deployment-layout"><div class="deployment-chart">${tacticalChart(b)}<div class="chart-legend"><span class="allied">▲ 我方</span><span class="hostile">◇ ${b.training ? '靶标' : '敌方'}</span><span>虚线 / 方向示意</span></div></div><aside class="deployment-sidebar"><h3>部署概览</h3><section><small>我方 / PLAYER</small><h4>${escapeHTML(c.vehicle.code + ' ' + c.vehicle.name)}</h4><p>玩家起点 · ${b.ship ? '海面出发' : `高度 ${b.spawn[1]} m`}${b.wingmen ? ' · 三架僚机协同' : ''}</p></section>${b.fleet ? `<section><small>护航编队 / ESCORT</small><h4>防区半径 ${b.radius / 1000} km</h4><p>企业号有独立耐久；护航标记跟随撤退航线移动。</p></section>` : ''}<section class="hostile"><small>${b.training ? '靶标' : '敌方'} / CONTACTS</small><h4>${escapeHTML(b.enemy)}</h4><p>${escapeHTML(b.threats)}</p></section><p class="deployment-note">${b.fleet ? '企业号参与受击与撤离判定，被击沉即任务失败。' : '背景舰队仅作场景参照。'}${b.wingmen ? '绿色三角为友机，僚机可受损和被击落。' : ''}目标位置与来袭方向为示意，实际以战场雷达为准。</p></aside></div>`;
      if (this.page === 3) content = `<div class="objectives-layout"><section class="objectives-column"><ul class="sortie-objectives">${b.objectives.map((text, i) => `<li><span aria-hidden="true">□</span><small>${n(i + 1)}</small><strong>${escapeHTML(text)}</strong></li>`).join('')}</ul><div class="mission-failure"><h3>△ 失败条件</h3><p>${escapeHTML(b.failures.join('；') + '。')}</p></div></section><aside class="sortie-confirmation"><span class="eyebrow">SORTIE CONFIRMATION</span><h3>出击确认</h3><div class="confirmation-vehicle"><svg viewBox="-40 -32 80 64" aria-hidden="true"><path d="${c.ship ? ship : plane}"/></svg><span>${escapeHTML(c.vehicle.code)}<strong>${escapeHTML(c.vehicle.name)}</strong></span></div><dl><div><dt>模式</dt><dd>${SORTIE_MODES.find(m => m.id === this.category).title}</dd></div><div><dt>剧本</dt><dd>${b.title}</dd></div><div><dt>区域</dt><dd>${b.map.name}</dd></div><div><dt>难度</dt><dd>${({ easy: '轻松', normal: '标准', hard: '王牌' })[c.difficulty] || '标准'}</dd></div>${b.rewardPoints ? `<div><dt>通关奖励</dt><dd>+${b.rewardPoints} 银币</dd></div>` : ''}<div><dt>状态</dt><dd class="${b.canLaunch ? 'ready' : 'blocked'}">${b.canLaunch ? '已准备' : '暂不可出击'}</dd></div></dl><p class="confirmation-loadout">${escapeHTML(c.vehicle.weapons)}</p><button data-flow-action="workshop" class="flow-secondary">↗ 返回${c.ship ? '海军基地' : '机库'}整备</button></aside></div>${b.blocked ? `<p class="sortie-blocked" role="status">${escapeHTML(b.blocked)}</p>` : ''}`;
    }
    const next = this.screen === 'mode' ? '下一步' : this.screen === 'missions' ? '查看作战简报' : this.page === 3 ? '确认出击' : '下一步';
    this.root.innerHTML = `${header}<div class="sortie-scroll"><main class="sortie-main screen-${this.screen} ${this.screen === 'briefing' ? `briefing-page-${this.page}` : ''}"><div class="sortie-heading"><span class="eyebrow">${escapeHTML(eyebrow)}</span><h2 id="sortieTitle" tabindex="-1">${escapeHTML(title)}</h2>${this.screen === 'mode' ? '<p>从这里选择你的出击方式。</p>' : ''}</div>${content}</main></div><footer class="sortie-footer"><button data-flow-action="back" class="flow-secondary">← 上一步</button><span>${this.screen === 'briefing' ? `${n(this.page + 1)} <i>/ 04</i>` : `${n(section + 1)} <i>/ 03</i>`}</span><button data-flow-action="next" class="flow-primary" ${this.screen === 'briefing' && this.page === 3 && !b.canLaunch ? 'disabled' : ''}>${next} <span>→</span></button></footer>`;
    this.root.querySelector('[data-flow-action="selection"]')?.addEventListener('click', () => { this.screen = 'missions'; this.render(); });
    this.root.querySelector('[data-flow-home]').addEventListener('click', event => { event.preventDefault(); this.close(); });
    this.root.querySelector(focusSelector)?.focus({ preventScroll: true });
    this.root.querySelector('.sortie-scroll').scrollTop = 0;
  }
}
