import { Simulation, DESTROYER } from './simulation.js';

// These are the two player vehicles already available in this single-player
// game. Hostile patrol boats and frigates are never part of the owned fleet.
const aircraft = new Simulation().player;
const knots = speed => Math.round(speed * 1.94384);
export const OWNED_VEHICLES = Object.freeze([
  Object.freeze({
    id: 'aircraft', code: 'F/A-18C', name: '大黄蜂', english: 'HORNET', base: '机库',
    type: '多用途战斗机', role: '空中格斗 / 领空拦截', location: '北境航空站 · 01 号机库',
    description: '经典双发多用途战斗机。驾驶大黄蜂升空，执行拦截、训练与战役任务。',
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
export const vehicleById = id => OWNED_VEHICLES.find(vehicle => vehicle.id === id) || OWNED_VEHICLES[0];
