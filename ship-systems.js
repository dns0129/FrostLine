// All performance and armament below are fictional FrostLine balance values.
// Model dimensions are shared with the existing public-reference GLB assets.
export const DESTROYER = Object.freeze({
  waterline:.5,maxSpeed:18,maxHealth:300,maxAmmo:240,maxMissiles:12,maxAntiShipMissiles:6,
  halfLength:55,halfWidth:10,collisionTop:21,turretY:8,turretZ:-32,
  radarRange:5000,antiShipRadarRange:5500,antiShipLaunch:Object.freeze([1.05,6.2,-22.56]),
});
export const SHIP_READINESS = Object.freeze({
  balanced:Object.freeze({name:'均衡战备',note:'兼顾防空、反舰与诱饵储备。'}),
  airDefense:Object.freeze({name:'防空战备',note:'增加防空导弹，以部分反舰装载换取持续拦截。'}),
  strike:Object.freeze({name:'反舰战备',note:'增加反舰导弹，需要节约防空弹药并及时使用诱饵。'}),
});
const ship=(id,copy,stats)=>Object.freeze({id,...DESTROYER,gunDamage:45,gunInterval:.28,gunHeat:.075,
  samDamage:125,samInterval:.75,samChannels:24,lockSeconds:1.2,antiShipDamage:280,antiShipInterval:1.4,
  armor:0,turnRate:.105,maxFlares:6,ciwsRange:0,ciwsInterval:.1,ciwsDamage:12,ciwsCooling:.4,ciwsHeat:.09,
  modules:null,...copy,...stats});
export const SHIPS=Object.freeze({
  destroyer:ship('destroyer',{code:'D-21',name:'霜卫',english:'FROSTGUARD',role:'海域防空 / 对舰打击',description:'原有 D-21 防空驱逐舰，熟悉的舰炮与双导弹操作。'},{}),
  burke:ship('burke',{code:'DDG-51',name:'阿利·伯克级',english:'ARLEIGH BURKE',model:'burke',role:'区域防空 / 持续作战',
    description:'复用现有伯克级三维模型。较高船体耐久、3 个防空交战通道与较远雷达覆盖；转向和末端防御较慢。',
    gunName:'Mk 45 · 127 mm 舰炮',samName:'标准系列防空导弹',antiShipName:'舰载反舰导弹',ciwsName:'密集阵近防炮'},
    {maxHealth:420,maxSpeed:17,maxAmmo:220,maxMissiles:18,maxAntiShipMissiles:8,maxFlares:8,
      halfLength:76.9,halfWidth:10.15,collisionTop:28,turretY:10.2,turretZ:-50,turretForwardOffset:1.6,antiShipLaunch:[0,8,-38],
      radarRange:5800,antiShipRadarRange:6000,gunDamage:52,gunInterval:.42,gunHeat:.09,
      samDamage:145,samInterval:1.1,samChannels:3,antiShipDamage:320,antiShipInterval:2.4,
      armor:.1,turnRate:.088,ciwsRange:700,ciwsInterval:.085,ciwsDamage:8,
      modules:Object.freeze({engine:160,radar:140,weapons:180})}),
  type052d:ship('type052d',{code:'DDG-172',name:'052D 型',english:'TYPE 052D',model:'type052d',role:'机动防空 / 末端拦截',
    description:'复用现有 052D 三维模型。更灵活的转舵、更强近防火力与较高反舰单发伤害；船体耐久和防空通道较少。',
    gunName:'H/PJ-45 · 130 mm 舰炮',samName:'海红旗系列防空导弹',antiShipName:'鹰击系列反舰导弹',ciwsName:'近防炮系统'},
    {maxHealth:390,maxSpeed:18.5,maxAmmo:200,maxMissiles:14,maxAntiShipMissiles:8,maxFlares:10,
      halfLength:78.5,halfWidth:8.75,collisionTop:28,turretY:10.48,turretZ:-52,turretForwardOffset:2.4,antiShipLaunch:[0,8,-40],
      radarRange:5400,antiShipRadarRange:6200,gunDamage:60,gunInterval:.5,gunHeat:.1,
      samDamage:135,samInterval:1.2,samChannels:2,antiShipDamage:360,antiShipInterval:3,
      armor:.06,turnRate:.115,ciwsRange:850,ciwsInterval:.065,ciwsDamage:10,ciwsCooling:.5,ciwsHeat:.075,
      modules:Object.freeze({engine:150,radar:130,weapons:170})}),
});
export const isShipVehicle=id=>Object.hasOwn(SHIPS,id);
export function normalizeReadiness(value){return Object.fromEntries(Object.keys(SHIPS).map(id=>[id,Object.hasOwn(SHIP_READINESS,value?.[id])?value[id]:'balanced']));}
export function effectiveShip(id='destroyer',readiness='balanced'){
  const base=SHIPS[id]||SHIPS.destroyer,preset=Object.hasOwn(SHIP_READINESS,readiness)?readiness:'balanced';
  if(base.id==='destroyer')return {...base,readiness:'balanced'};
  const changes=preset==='airDefense'?{maxMissiles:base.maxMissiles+6,maxAntiShipMissiles:4,maxFlares:base.maxFlares-2}
    :preset==='strike'?{maxMissiles:base.maxMissiles-6,maxAntiShipMissiles:12}:{};
  return {...base,...changes,readiness:preset};
}
