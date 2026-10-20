import { ammoGrade, normalizeEconomy, PLAYER_DAMAGE_SCALE, GUN_MAGAZINE } from './combat-economy.js';
import {SHIPS,effectiveShip} from './ship-systems.js';
import { Simulation, DESTROYER } from './simulation.js';
import { AIRCRAFT, effectiveAircraft, normalizeWorkshop } from './aircraft-systems.js';

// The player vehicles available in this single-player game. Hostile patrol
// boats, frigates and carriers are not owned. The two existing destroyer models are now playable.
const aircraft = new Simulation().player, j16 = effectiveAircraft('j16', normalizeWorkshop(null));
const knots = speed => Math.round(speed * 1.94384);
export const OWNED_VEHICLES = Object.freeze([
  Object.freeze({
    id: 'aircraft', aircraftId: 'fa18c', code: 'F/A-18C', name: '大黄蜂', english: 'HORNET', base: '机库',
    type: '标准多用途战斗机', role: '制空拦截 / 对海打击', location: '北境航空站 · 01 号机库',
    description: '经典双发多用途战斗机。武器在机库永久购买，空空与反舰导弹无限补充，不使用外挂架。',
    stats: Object.freeze([
      ['初始空速', String(knots(aircraft.speed)), 'KTS'],
      ['机体强度', String(aircraft.maxHealth), 'HP'],
      ['机炮弹药', String(aircraft.ammo), '发'],
      ['空空导弹', String(aircraft.missiles).padStart(2, '0'), '枚'],
    ]),
    weapons: `机炮 ${aircraft.ammo} 发 · 空空导弹 ${aircraft.missiles} 枚 · 热焰弹 ${aircraft.flares} 组`,
    cardDetail: '双发 / 空空导弹 / 热焰弹',
  }),
  Object.freeze({
    id: 'j16', aircraftId: 'j16', code: 'J-16', name: '歼-16', english: 'TWIN-SEAT', base: '机库',
    type: '重型多用途战斗机', role: '远程制空 / 对海打击', location: '北境航空站 · 01 号机库',
    description: '双座双发重型多用途战斗机。使用霹雳-15、霹雳-10 与鹰击-83K，武器无限补充，空空与反舰分别冷却。',
    stats: Object.freeze([
      ['机体强度', String(j16.maxHealth), 'HP'],
      ['机炮弹药', String(GUN_MAGAZINE.aircraft), '发'],
      ['空空导弹', String(j16.air).padStart(2, '0'), '枚'],
      ['反舰导弹', String(j16.sea).padStart(2, '0'), '枚'],
    ]),
    weapons: `${AIRCRAFT.j16.gun} ${j16.maxAmmo} 发 · 空空 ${j16.air} 枚 · 反舰 ${j16.sea} 枚 · 诱饵 ${j16.maxFlares} 组`,
    cardDetail: '双座 / 霹雳-15 / 鹰击-83K',
  }),
  Object.freeze({
    id: 'destroyer', code: 'D-21', name: '霜卫', english: 'FROSTGUARD', base: '海军基地',
    type: '防空驱逐舰', role: '海域防空 / 对舰打击', location: '北境海军基地 · 02 号泊位',
    description: '守望海峡的钢铁防线。独立舰炮、垂直发射系统与全向雷达协同作战。',
    stats: Object.freeze([
      ['最高航速', String(knots(DESTROYER.maxSpeed)), 'KTS'],
      ['舰体强度', String(DESTROYER.maxHealth), 'HP'],
      ['舰炮弹药', String(DESTROYER.maxAmmo), '发'],
      ['对舰雷达', (DESTROYER.antiShipRadarRange / 1000).toFixed(1), 'KM'],
    ]),
    weapons: `舰炮 ${DESTROYER.maxAmmo} 发 · 防空导弹 ${DESTROYER.maxMissiles} 枚 · 反舰导弹 ${DESTROYER.maxAntiShipMissiles} 枚`,
    cardDetail: '舰炮 / 防空导弹 / 反舰导弹',
  }),
  ...['burke','type052d'].map(id=>{
    const s=SHIPS[id];return Object.freeze({id,code:s.code,name:s.name,english:s.english,base:'海军基地',
      type:'多用途驱逐舰',role:s.role,location:'北境海军基地 · '+(id==='burke'?'03':'04')+' 号泊位',description:s.description,
      stats:[['舰体强度',String(s.maxHealth),'HP'],['装甲减伤',String(Math.round(s.armor*100)),'%'],['防空通道',String(s.samChannels),'个'],['反舰伤害',String(s.antiShipDamage),'HP']],
      weapons:`${s.gunName} · ${s.samName} · ${s.antiShipName} · 自动近防炮`,cardDetail:s.role});
  }),
]);
// Aircraft show the saved loadout and upgrades; vehicles without one are static.
export function vehicleById(id, profile, readiness) {
  const vehicle = OWNED_VEHICLES.find(vehicle => vehicle.id === id) || OWNED_VEHICLES[0];
  const p = normalizeWorkshop(profile), missile = ammoGrade('missile', p.ammoTiers.missile), gun = ammoGrade('gun', p.ammoTiers.gun);
  if (!vehicle.aircraftId) {
    const ship = effectiveShip(vehicle.id, readiness?.[vehicle.id]);
    return {...vehicle, stats: [['舰体强度', String(ship.maxHealth), 'HP'], ['机炮弹匣', `${GUN_MAGAZINE.destroyer} / ∞`, '发'],
      ['防空 / 反舰补充', `${+(missile.reload * ship.airReloadFactor).toFixed(2)} / ${+(missile.reload * 1.5 * ship.seaReloadFactor).toFixed(2)}`, '秒'], ['机炮补充', String(gun.reload), '秒']],
      weapons: `${gun.name} · ${missile.name} · 弹药无限，自动补充 · 诱饵 ${ship.maxFlares} 组`};
  }
  const stats = effectiveAircraft(vehicle.aircraftId, p);
  return { ...vehicle, stats: [
    ['机体强度', String(stats.maxHealth), 'HP'], ['机炮弹匣', `${GUN_MAGAZINE.aircraft} / ∞`, '发'],
    ['空空 / 反舰补充', `${missile.reload} / ${missile.reload * 1.5}`, '秒'], ['滚转响应', String(Math.round(stats.rollRate * 180 / Math.PI)), '°/S'],
  ], weapons: `${gun.name} · ${missile.name} · 局内无限 · 机炮补充 ${gun.reload} 秒 · 诱饵 ${stats.maxFlares} 组` };
}
export const aircraftIdFor = id => OWNED_VEHICLES.find(vehicle => vehicle.id === id)?.aircraftId || null;
