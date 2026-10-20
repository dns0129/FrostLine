import {SHIPS,SHIP_READINESS,normalizeReadiness,effectiveShip} from './ship-systems.js';
import {normalizeEconomy,ammoGrade,PLAYER_DAMAGE_SCALE,GUN_MAGAZINE} from './combat-economy.js';
const $=id=>document.getElementById(id);
export class NavalWorkshop {
  constructor(profile,onChange){this.profile=normalizeReadiness(profile);this.onChange=onChange;this.shipId='destroyer';
    $('navalPresets').addEventListener('click',e=>{const id=e.target.closest('[data-readiness]')?.dataset.readiness;if(!id||this.shipId==='destroyer')return;this.profile={...this.profile,[this.shipId]:id};this.saved=this.onChange(this.profile)!==false;this.render();$('navalPresets').querySelector(`[data-readiness="${id}"]`)?.focus();});
    $('navalWorkshopPanel').addEventListener('keydown',e=>{if(e.key!=='Tab')return;const buttons=[...$('navalWorkshopPanel').querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
  }
  setShip(id){this.shipId=Object.hasOwn(SHIPS,id)?id:'destroyer';}
  setWeaponProfile(profile){this.weapons=normalizeEconomy(profile);}
  render(){
    const s=effectiveShip(this.shipId,this.profile[this.shipId]),preset=SHIP_READINESS[s.readiness],weapons=this.weapons||normalizeEconomy(null),gun=ammoGrade('gun',weapons.ammoTiers.gun),missile=ammoGrade('missile',weapons.ammoTiers.missile),damage=(base,grade)=>Math.round(base*PLAYER_DAMAGE_SCALE*grade.multiplier*100)/100;
    $('navalWorkshopName').textContent=`${s.code} ${s.name}`;
    $('navalWorkshopSummary').textContent=`${s.maxHealth} HP · 护甲减伤 ${Math.round(s.armor*100)}% · ${s.id==='destroyer'?'原有操作与平衡':s.role}`;
    $('navalPresets').innerHTML=Object.entries(SHIP_READINESS).map(([id,copy])=>`<button class="workshop-preset" data-readiness="${id}" aria-pressed="${s.readiness===id}" ${s.id==='destroyer'&&id!=='balanced'?'disabled':''}>${copy.name}</button>`).join('');
    $('navalReadinessNote').textContent=s.id==='destroyer'?'D-21 保留原有标准配置。':preset.note;
    const row=(title,inventory,metrics)=>`<article class="naval-weapon"><div><h3>${title}</h3><strong>${inventory}</strong></div><p>${metrics}</p></article>`;
    $('navalWeapons').innerHTML=[row(s.gunName||'127 mm 舰炮',`${GUN_MAGAZINE.destroyer} 发 / ∞`,`单发 ${damage(s.gunDamage,gun)} 伤害 · 打空后 ${gun.reload} 秒补满 · 射击间隔 ${s.gunInterval} 秒 · 空格 / 左键开火`),
      row(s.samName||'防空导弹',`无限补充`,`单发 ${damage(s.samDamage,missile)} 伤害 · 补充 ${+(missile.reload*s.airReloadFactor).toFixed(2)} 秒 · ${s.id==='destroyer'?'标准':s.samChannels+' 个并行'}交战通道 · F 发射`),
      row(s.antiShipName||'反舰导弹',`无限补充`,`单发 ${damage(s.antiShipDamage,missile)} 伤害 · 补充 ${+(missile.reload*1.5*s.seaReloadFactor).toFixed(2)} 秒 · 持续锁定敌舰后按 R 发射`),
      ...(s.ciwsRange?[row(s.ciwsName,'自动拦截',`对来袭导弹 ${s.ciwsDamage} 伤害/发 · 范围 ${s.ciwsRange} 游戏米 · 独立热量，过热停火`)]:[]),
      row('诱饵与损伤控制',`${s.maxFlares} 组诱饵`,`X 释放诱饵 · 装甲减伤 ${Math.round(s.armor*100)}% · 波次补给恢复受损模块`),
    ].join('');
    $('navalModuleStats').textContent=s.modules?`独立模块：推进 ${s.modules.engine} HP / 雷达 ${s.modules.radar} HP / 武器 ${s.modules.weapons} HP。推进与雷达低于 50% 降效，武器低于 30% 停用。`:'D-21 使用原有整体船体损伤规则。';
    $('navalWorkshopStatus').textContent=this.saved===false?'本页配置有效，浏览器存储不可用。':'已保存 · 下次出港生效，不改变进行中的战斗';
  }
}
