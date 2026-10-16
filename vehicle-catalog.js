import { Simulation, DESTROYER } from './simulation.js';
import { AIRCRAFT, effectiveAircraft, normalizeWorkshop } from './aircraft-systems.js';

// The player vehicles available in this single-player game. Hostile patrol
// boats, frigates and the scene-only fleets are never part of the owned list.
const aircraft = new Simulation().player, j16 = effectiveAircraft('j16', normalizeWorkshop(null));
const knots = speed => Math.round(speed * 1.94384);
export const OWNED_VEHICLES = Object.freeze([
  Object.freeze({
    id: 'aircraft', aircraftId: 'fa18c', code: 'F/A-18C', name: '大黄蜂', english: 'HORNET', base: '机库',
    type: '标准多用途战斗机', role: '制空拦截 / 对海打击', location: '北境航空站 · 01 号机库',
    description: '经典双发多用途战斗机。九个挂点自由配置空空与反舰武器，兼顾制空与对海打击。',
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
    description: '双座双发重型多用途战斗机。八个挂点配置霹雳-15、霹雳-10 与鹰击-83K，航程与载弹量更大。',
    stats: Object.freeze([
      ['机体强度', String(j16.maxHealth), 'HP'],
      ['机炮弹药', String(j16.maxAmmo), '发'],
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
]);
// Aircraft show the saved loadout and upgrades; vehicles without one are static.
export function vehicleById(id, profile) {
  const vehicle = OWNED_VEHICLES.find(vehicle => vehicle.id === id) || OWNED_VEHICLES[0];
  if (!vehicle.aircraftId) return vehicle;
  const stats = effectiveAircraft(vehicle.aircraftId, normalizeWorkshop(profile));
  return { ...vehicle, stats: [
    ['机体强度', String(stats.maxHealth), 'HP'], ['外挂总重', String(Math.round(stats.payloadKg)), 'KG'],
    ['空空 / 反舰', `${stats.air} / ${stats.sea}`, '枚'], ['滚转响应', String(Math.round(stats.rollRate * 180 / Math.PI)), '°/S'],
  ], weapons: `${AIRCRAFT[vehicle.aircraftId].gun} ${stats.maxAmmo} 发 · 空空 ${stats.air} 枚 · 反舰 ${stats.sea} 枚 · 诱饵 ${stats.maxFlares} 组` };
}
export const aircraftIdFor = id => OWNED_VEHICLES.find(vehicle => vehicle.id === id)?.aircraftId || null;
