import * as THREE from './vendor/three.module.js';
import { DESTROYER, effectiveShip, isShipVehicle } from './ship-systems.js';
export { DESTROYER } from './ship-systems.js';
import { terrainHeight, setActiveMap } from './world-math.js';
import { createDefaultFleet, updateDefaultFleet } from './ambient-fleet.js';
import { CAMPAIGN_LEVELS, campaignLevel } from './campaign.js';
import { aircraftById, STORES, normalizeWorkshop, effectiveAircraft, primaryAirWeapon, airWeaponsFor, antiShipWeaponFor } from './aircraft-systems.js';
import { AMMO_GRADES, ownsWeapon, GUN_MAGAZINE, PLAYER_DAMAGE_SCALE } from './combat-economy.js';
import { aiProfile, airSpawnPosition, flightPlan } from './enemy-ai.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const MAX_TRACERS = 140;
const MAX_PARTICLES = 220;
const MAX_MISSILES = 24;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const smooth = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const surfaceHeight = (x, z) => Math.max(0, terrainHeight(x, z));

export const HOSTILE_SHIPS = Object.freeze({
  patrol: Object.freeze({ halfLength: 22.5, halfWidth: 5.5, collisionTop: 10, waterline: 0.5,
    turretY: 4, turretZ: -12, aimHeight: 4, maxSpeed: 14, maxHealth: 280 }),
  frigate: Object.freeze({ halfLength: 42.5, halfWidth: 8.5, collisionTop: 17, waterline: 0.5,
    turretY: 6, turretZ: -24, aimHeight: 6, maxSpeed: 11, maxHealth: 480 }),
  destroyer: Object.freeze({ halfLength: 55, halfWidth: 10, collisionTop: 21, waterline: 0.5,
    turretY: 8, turretZ: -32, aimHeight: 8, maxSpeed: 18, maxHealth: 600 }),
});
const isNavalMode = mode => mode === 'naval' || mode === 'naval-training';

// Local metre boxes follow buildEnemyShipAssets in destroyer.js. Only the low
// hull spans the vessel; bridges and gunhouses occupy their actual deck stations.
const HOSTILE_SHIP_HIT_ZONES = Object.freeze({
  destroyer: [
    { min: [-10, -3, -55], max: [10, 5, 55] },
    { min: [-7, 5, -20], max: [7, 16, 28] },
    { min: [-2, 16, -4], max: [2, 21, 4] },
    { min: [-3, 5, -3], max: [3, 10, 3], gunhouse: true },
  ],
  patrol: [
    { min: [-5.5, -2.15, -22.5], max: [5.5, 2.735, 22.5] },
    { min: [-3.1, 3.6, -0.5], max: [3.1, 7.6, 8.5] },
    { min: [-1.45, 1.75, -1.45], max: [1.45, 3.65, 1.45], gunhouse: true },
    { min: [-1.6, 2.58, 12.95], max: [1.6, 2.98, 17.05] },
    { min: [-0.3, 7.9, 3.7], max: [0.3, 10, 4.3] },
  ],
  frigate: [
    { min: [-8.5, -2.15, -42.5], max: [8.5, 3.935, 42.5] },
    { min: [-6.25, 3.75, -13.5], max: [6.25, 10.25, 13.5] },
    { min: [-4.9, 9.6, -12.75], max: [4.9, 14.8, -3.25] },
    { min: [-5.35, 4.5, 17.5], max: [5.35, 9.1, 30.5] },
    { min: [-2.35, 9.9, 2.7], max: [2.35, 13.5, 7.3] },
    { min: [-2.2, 9.1, 16.9], max: [2.2, 12.6, 21.1] },
    { min: [-2.05, 3.75, -2.05], max: [2.05, 5.9, 2.05], gunhouse: true },
    { min: [-0.3, 14.8, -7.8], max: [0.3, 17, -7.2] },
  ],
});

function forward(heading, pitch, out = new THREE.Vector3()) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(heading) * c, Math.sin(pitch), -Math.cos(heading) * c);
}

function angles(direction) {
  return { heading: Math.atan2(-direction.x, -direction.z), pitch: Math.asin(clamp(direction.y, -1, 1)) };
}

function segmentDistanceSq(point, a, b) {
  const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
  const lengthSq = x * x + y * y + z * z;
  const t = lengthSq ? clamp(((point.x - a.x) * x + (point.y - a.y) * y + (point.z - a.z) * z) / lengthSq, 0, 1) : 0;
  return (point.x - a.x - x * t) ** 2 + (point.y - a.y - y * t) ** 2 + (point.z - a.z - z * t) ** 2;
}

// Slab intersection in ship coordinates includes the long hull and raised bridge.
// A sphere around the waterline would miss hits near the bow and on the superstructure.
function segmentShipEntry(player, a, b, padding = 0) {
  const halfWidth = player.halfWidth ?? DESTROYER.halfWidth;
  const halfLength = player.halfLength ?? DESTROYER.halfLength;
  const top = player.collisionTop ?? DESTROYER.collisionTop;
  const c = Math.cos(player.heading), s = Math.sin(player.heading);
  const local = point => {
    const x = point.x - player.pos.x, z = point.z - player.pos.z;
    return [x * c - z * s, point.y - player.pos.y, x * s + z * c];
  };
  const from = local(a), to = local(b);
  if (player.kind === 'ship') {
    let firstHit = null;
    for (const zone of HOSTILE_SHIP_HIT_ZONES[player.shipType] || []) {
      let start = from, end = to;
      if (zone.gunhouse) {
        const relative = (player.turretHeading ?? player.heading) - player.heading;
        const cos = Math.cos(relative), sin = Math.sin(relative);
        const rotate = point => {
          const z = point[2] - player.turretZ;
          return [point[0] * cos - z * sin, point[1], point[0] * sin + z * cos];
        };
        start = rotate(from); end = rotate(to);
      }
      const minimum = zone.min.map(value => value - padding), maximum = zone.max.map(value => value + padding);
      const hit = segmentBoxEntry(start, end, minimum, maximum);
      if (hit !== null && (firstHit === null || hit < firstHit)) firstHit = hit;
    }
    return firstHit;
  }
  const minimum = [-halfWidth - padding, -3 - padding, -halfLength - padding];
  const maximum = [halfWidth + padding, top + padding, halfLength + padding];
  return segmentBoxEntry(from, to, minimum, maximum);
}

function segmentBoxEntry(from, to, minimum, maximum) {
  let entry = 0, exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-8) {
      if (from[axis] < minimum[axis] || from[axis] > maximum[axis]) return null;
    } else {
      const first = (minimum[axis] - from[axis]) / delta, second = (maximum[axis] - from[axis]) / delta;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
      if (entry > exit) return null;
    }
  }
  return entry;
}

const segmentHitsShip = (ship, a, b, padding = 0) => segmentShipEntry(ship, a, b, padding) !== null;

function shipHasClearWater(position, heading, body = DESTROYER) {
  const halfLength = body.halfLength ?? DESTROYER.halfLength, halfWidth = body.halfWidth ?? DESTROYER.halfWidth;
  const c = Math.cos(heading), s = Math.sin(heading);
  for (let z = -halfLength; z <= halfLength; z += halfLength / 4) {
    for (const x of [-halfWidth, 0, halfWidth]) {
      if (terrainHeight(position.x + x * c + z * s, position.z - x * s + z * c) > -3) return false;
    }
  }
  return true;
}

export function shipGunOrigin(player) {
  const turretZ = player.turretZ ?? DESTROYER.turretZ;
  return player.pos.clone().add(new THREE.Vector3(
    Math.sin(player.heading) * turretZ,
    player.turretY ?? DESTROYER.turretY,
    Math.cos(player.heading) * turretZ,
  )).addScaledVector(forward(player.turretHeading??player.heading,0),player.shipSystems?.turretForwardOffset||0);
}

function shipsOverlap(a, b, padding = 3) {
  const delta = b.pos.clone().sub(a.pos);
  const axes = entity => [new THREE.Vector3(Math.cos(entity.heading), 0, -Math.sin(entity.heading)), forward(entity.heading, 0)];
  const [ar, af] = axes(a), [br, bf] = axes(b);
  const aw = (a.halfWidth ?? DESTROYER.halfWidth) + padding, al = (a.halfLength ?? DESTROYER.halfLength) + padding;
  const bw = (b.halfWidth ?? DESTROYER.halfWidth) + padding, bl = (b.halfLength ?? DESTROYER.halfLength) + padding;
  if (delta.lengthSq() > (Math.hypot(aw, al) + Math.hypot(bw, bl)) ** 2) return false;
  for (const axis of [ar, af, br, bf]) {
    const reach = aw * Math.abs(ar.dot(axis)) + al * Math.abs(af.dot(axis))
      + bw * Math.abs(br.dot(axis)) + bl * Math.abs(bf.dot(axis));
    if (Math.abs(delta.dot(axis)) >= reach) return false;
  }
  return true;
}

function segmentTerrainEntry(a, b) {
  const length = a.distanceTo(b), steps = Math.max(1, Math.ceil(length / 8));
  const sample = new THREE.Vector3();
  let previous = 0;
  if (a.y < surfaceHeight(a.x, a.z)) return 0;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    sample.copy(a).lerp(b, fraction);
    if (sample.y < surfaceHeight(sample.x, sample.z)) {
      let lo = previous, hi = fraction;
      for (let iteration = 0; iteration < 7; iteration++) {
        const mid = (lo + hi) / 2;
        sample.copy(a).lerp(b, mid);
        if (sample.y < surfaceHeight(sample.x, sample.z)) hi = mid; else lo = mid;
      }
      return hi;
    }
    previous = fraction;
  }
  return null;
}

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

/** Resolve the visible centre ray, independently of radar selection or missile lock.
 * Sea points inside the own hull's 80 m safety radius are moved out along the
 * same horizontal sight bearing, so a steep follow camera cannot aim at its deck.
 */
export function shipCameraAimPoint(player, enemies, origin, direction, maxRange = 5500) {
  const range = Number.isFinite(maxRange) && maxRange > 0 ? Math.min(maxRange, 20000) : 5500;
  const start = finitePoint(origin) ? new THREE.Vector3(origin.x, origin.y, origin.z)
    : finitePoint(player?.pos) ? new THREE.Vector3(player.pos.x, player.pos.y + 18, player.pos.z) : new THREE.Vector3(0, 18, 0);
  const ray = finitePoint(direction) ? new THREE.Vector3(direction.x, direction.y, direction.z) : new THREE.Vector3();
  if (ray.lengthSq() < 1e-12) forward(Number.isFinite(player?.heading) ? player.heading : 0, 0, ray);
  ray.normalize();
  const end = start.clone().addScaledVector(ray, range);
  let fraction = segmentTerrainEntry(start, end);
  let kind = fraction === null ? 'sky' : 'terrain', targetId = null;
  let nearest = fraction ?? Infinity;
  for (const ship of enemies || []) {
    if (ship === player || (player?.id && ship.id === player.id) || ship.kind !== 'ship' || !(ship.health > 0)
      || !finitePoint(ship.pos) || !Number.isFinite(ship.heading)) continue;
    const entry = segmentShipEntry(ship, start, end);
    if (entry !== null && entry < nearest) {
      nearest = entry; fraction = entry; kind = 'ship'; targetId = ship.id ?? null;
    }
  }
  const point = start.clone().lerp(end, fraction ?? 1);
  if (kind === 'terrain') {
    const ground = terrainHeight(point.x, point.z);
    kind = ground > 0.1 ? 'terrain' : 'sea';
    point.y = Math.max(0, ground);
    if (kind === 'sea' && finitePoint(player?.pos)) {
      const horizontal = point.clone().sub(player.pos); horizontal.y = 0;
      if (horizontal.lengthSq() < 80 * 80) {
        horizontal.set(ray.x, 0, ray.z);
        if (horizontal.lengthSq() < 1e-12) forward(Number.isFinite(player.heading) ? player.heading : 0, 0, horizontal);
        point.copy(player.pos).addScaledVector(horizontal.normalize(), 80); point.y = 0;
        const safeGround = terrainHeight(point.x, point.z);
        if (safeGround > 0) { point.y = safeGround; kind = 'terrain'; }
      }
    }
  }
  return { point, kind, targetId, distance: start.distanceTo(point) };
}

function shipAimSolution(player, point) {
  const offset = new THREE.Vector3(point.x, point.y, point.z).sub(shipGunOrigin(player));
  // A shell begins 14 m along the actual barrel and inherits the hull velocity.
  // Solve the short flight-time root; fixed-point iterations converge rapidly at
  // the game's 930 m/s muzzle speed and 18 m/s maximum hull speed.
  let time = Math.max(0, (offset.length() - 14) / 930);
  const compensated = new THREE.Vector3();
  for (let iteration = 0; iteration < 6; iteration++) {
    compensated.copy(offset).addScaledVector(player.vel, -time);
    compensated.y += 1.6 * time * time;
    time = Math.max(0, (compensated.length() - 14) / 930);
  }
  compensated.copy(offset).addScaledVector(player.vel, -time);
  compensated.y += 1.6 * time * time;
  if (compensated.lengthSq() < 1e-12) forward(player.turretHeading, player.turretPitch, compensated);
  compensated.normalize();
  return { ...angles(compensated), direction: compensated, time, distance: offset.length() };
}

function segmentSphereEntry(point, a, b, radius) {
  const delta = b.clone().sub(a), offset = a.clone().sub(point);
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const magnitude = delta.lengthSq(), projection = offset.dot(delta);
  const discriminant = projection * projection - magnitude * c;
  if (!magnitude || discriminant < 0) return null;
  const entry = (-projection - Math.sqrt(discriminant)) / magnitude;
  return entry >= 0 && entry <= 1 ? entry : null;
}

const DIFFICULTY = {
  easy: { damage: 0.48, aim: 27, enemyTurn: 0.23, enemyHealth: 170, missileEvery: 25 },
  normal: { damage: 0.72, aim: 21, enemyTurn: 0.29, enemyHealth: 200, missileEvery: 19 },
  hard: { damage: 1, aim: 16, enemyTurn: 0.35, enemyHealth: 220, missileEvery: 14 },
};

/** Metres / seconds / radians. Rendering and audio consume this state; nothing here needs a DOM. */
export class Simulation {
  get missileCooldown() { return Math.max(0, this._missileTimer); }
  get antiShipCooldown() { return Math.max(0, this._antiShipMissileTimer); }
  get gunReloadCooldown() { return Math.max(0, this._gunReloadTimer); }

  constructor(seed = 7331) {
    this.seed = seed >>> 0;
    this.state = 'menu';
    this.mode = 'intercept';
    this.difficulty = 'normal';
    this.settings = DIFFICULTY.normal;
    this.workshop = normalizeWorkshop(null);
    this.aircraftId = 'fa18c';
    this.shipId = 'destroyer'; this.shipReadiness = 'balanced';
    this._reset();
  }

  configureAircraft(profile, aircraftId = 'fa18c') {
    this.workshop = normalizeWorkshop(profile);
    this.aircraftId = aircraftById(aircraftId).id;
  }

  configureShip(id='destroyer', readiness='balanced') {
    const config=effectiveShip(id,readiness);this.shipId=config.id;this.shipReadiness=config.readiness;
  }

  get shipSystems() { return effectiveShip(this.shipId,this.shipReadiness); }

  get airWeapon() { return STORES[this.player.selectedAirWeapon] || STORES.aim9; }

  hasWeapon(kind) { return kind === 'anti-air' || kind === 'anti-ship'; }

  setAmmoGrade(kind, tier) {
    if (!ownsWeapon(this.workshop, kind, tier)) return false;
    this.ammoTiers[kind] = tier; this.workshop.ammoTiers[kind] = tier;
    return true;
  }

  _weaponRound(kind) {
    const tier = ownsWeapon(this.workshop, kind, this.ammoTiers[kind]) ? this.ammoTiers[kind] : 'basic';
    return { tier, grade: AMMO_GRADES[kind][tier] };
  }

  cycleAirWeapon() {
    if (this.vehicle === 'destroyer') return false;
    const types = airWeaponsFor(this.aircraftId);
    this.player.selectedAirWeapon = types[(types.indexOf(this.player.selectedAirWeapon) + 1) % types.length];
    this.lockProgress = 0; this.lockTarget = null; this._lockAnnounced = false;
    return true;
  }

  _refreshAircraftStores() {
    // Kept as a migration boundary for old simulation snapshots. Hardpoint
    // counts and loadouts no longer affect weapons, weight or performance.
    this.player.stores = []; this.player.configuredStores = [];
    this.player.systems = effectiveAircraft(this.aircraftId, this.workshop);
  }

  _consumeAircraftStore(kind) {
    return { store: kind === 'anti-air' ? this.player.selectedAirWeapon : antiShipWeaponFor(this.aircraftId) };
  }

  _refillAircraftStores() { this._refillWeapons(); }

  _refillWeapons() {
    this.player.ammo = this.player.maxGunMagazine;
    this.player.missiles = this.player.antiShipMissiles = 1;
    this._gunReloadTimer = this._gunTimer = this._missileTimer = this._antiShipMissileTimer = 0;
  }

  _beginGunReload() {
    if (this._gunReloadTimer > 0) return;
    this._gunReloadTimer = this._gunReloadTotal = this._weaponRound('gun').grade.reload;
    this._emit('toast', { text: `${this.vehicle === 'destroyer' ? '舰炮' : '机炮'}正在补充 · ${this._gunReloadTimer} 秒后自动就绪` });
  }

  _reset(vehicle = 'aircraft') {
    this.wallet = { silver: this.workshop.silver, gold: this.workshop.gold };
    this.ammoTiers = { ...this.workshop.ammoTiers };
    this.campaignId = null;
    this.campaignState = null;
    this.vehicle = vehicle;
    this._rng = this.seed || 7331;
    this._nextId = 1;
    this.player = {
      kind: 'aircraft', maxHealth: 100,
      pos: new THREE.Vector3(0, 1100, 4000),
      vel: new THREE.Vector3(0, 0, -185),
      heading: 0, pitch: 0, bank: 0, speed: 185,
      health: 100, throttle: 0.8, g: 1, ammo: 900, missiles: 6, flares: 6, heat: 0,
      rollRate: 0, pitchRate: 0, stall: 0, altitude: 1100, warning: '',
      overheated: false, flareTime: 0, damageFlash: 0, boost: false,
    };
    if (vehicle === 'destroyer') Object.assign(this.player, {
      kind: 'destroyer', pos: new THREE.Vector3(0, DESTROYER.waterline, 4000),
      vel: new THREE.Vector3(), speed: 0, throttle: 0, health: DESTROYER.maxHealth,
      maxHealth: DESTROYER.maxHealth, ammo: DESTROYER.maxAmmo, missiles: DESTROYER.maxMissiles,
      antiShipMissiles: DESTROYER.maxAntiShipMissiles,
      altitude: DESTROYER.waterline, turretHeading: 0, turretPitch: 0.3, rudder: 0,
      gunAimActive: false, gunAimDistance: 0, gunAimError: 0, gunAimLimited: false, gunAimFlightTime: 0,
      halfLength: DESTROYER.halfLength, halfWidth: DESTROYER.halfWidth, collisionTop: DESTROYER.collisionTop,
      waterline: DESTROYER.waterline, turretY: DESTROYER.turretY, turretZ: DESTROYER.turretZ,
    });
    if (vehicle === 'destroyer') {
      const config=this.shipSystems;
      Object.assign(this.player,{shipId:config.id,shipSystems:config,health:config.maxHealth,maxHealth:config.maxHealth,
        ammo:config.maxAmmo,missiles:config.maxMissiles,antiShipMissiles:config.maxAntiShipMissiles,flares:config.maxFlares,
        halfLength:config.halfLength,halfWidth:config.halfWidth,collisionTop:config.collisionTop,turretY:config.turretY,turretZ:config.turretZ,
        modules:config.modules?{...config.modules}:null,ciwsHeat:0,ciwsCooldown:0,ciwsOverheated:false,interceptions:0});
      this._shipDamageIndex=0;
    }
    else {
      const stores = [];
      const stats = effectiveAircraft(this.aircraftId, this.workshop, stores);
      Object.assign(this.player, { aircraftId: this.aircraftId, systems: stats, stores,
        configuredStores: [], selectedAirWeapon: primaryAirWeapon(this.aircraftId),
        maxHealth: stats.maxHealth, health: stats.maxHealth, ammo: stats.maxAmmo,
        missiles: stats.air, antiShipMissiles: stats.sea, flares: stats.maxFlares, fuelKg: stats.fuelCapacity });
    }
    this.player.maxGunMagazine = GUN_MAGAZINE[this.vehicle];
    this.player.ammo = this.player.maxGunMagazine; this.player.missiles = this.player.antiShipMissiles = 1;
    this._lastShipWater = { pos: this.player.pos.clone(), heading: 0 };
    this.enemies = [];
    this.allies = [];
    this.carrier = null;
    this.ambientShips = createDefaultFleet();
    this.tracers = [];
    this.missiles = [];
    this.particles = [];
    this._events = [];
    this.time = 0;
    this.score = 0;
    this.kills = 0;
    this.wave = 0;
    this.targetId = null;
    this.lockProgress = 0;
    this.lockTarget = null;
    this.antiShipTargetId = null;
    this.antiShipLockTarget = null;
    this.antiShipLockProgress = 0;
    this._antiShipLockAnnounced = false;
    this.threat = 0;
    this.incoming = 0;
    this.shots = 0;
    this.hits = 0;
    this._gunTimer = this._gunReloadTimer = this._gunReloadTotal = 0;
    this._gunAimFlightTime = 0;
    this._missileTimer = 0;
    this._antiShipMissileTimer = 0;
    this._flareTimer = 0;
    this._groundGrace = 0;
    this._targetManualTime = 0;
    this._waveDelay = -1;
    this._lockAnnounced = false;
    this._lowAmmoAnnounced = false;
    this._boundaryCooldown = 0;
    this._warningTimer = 0;
    this._lastWarning = '';
    this._spawnIncomplete = false;
    this.endReason = '';
  }

  startCampaign(id, difficulty = 'normal') {
    if (!campaignLevel(id)) throw new RangeError('Unknown campaign chapter');
    this.start('campaign', difficulty, 'aircraft', id);
  }

  start(mode = 'intercept', difficulty = 'normal', vehicle = isNavalMode(mode) ? 'destroyer' : 'aircraft', chapter = 'dawn') {
    const level = mode === 'campaign' ? campaignLevel(chapter) : null;
    if (mode === 'campaign' && !level) throw new RangeError('Unknown campaign chapter');
    if(isShipVehicle(vehicle)&&vehicle!=='destroyer')this.configureShip(vehicle,this.shipReadiness);
    this._reset(level ? 'aircraft' : isShipVehicle(vehicle) ? 'destroyer' : 'aircraft');
    this.mode = ['intercept', 'free', 'training', 'naval', 'naval-training', 'campaign'].includes(mode) ? mode : 'intercept';
    this.difficulty = Object.hasOwn(DIFFICULTY, difficulty) ? difficulty : 'normal';
    this.settings = DIFFICULTY[this.difficulty];
    this.state = 'playing';
    if (level) {
      setActiveMap(level.mapId);
      this.campaignId = level.id;
      this.settings = { ...this.settings, damage: this.settings.damage * level.damageScale, missileEvery: level.missileEvery };
      this.campaignState = { outsideFor: 0, retreatElapsed: 0, radioIndex: 0, airKills: 0, shipKills: 0,
        protectedFleetId: 'US-CVN-65', objectivePos: new THREE.Vector3(-980, 18, 1900), commanderDown: false };
      this.player.pos.set(...level.spawn);
      this.player.altitude = this.player.pos.y;
      for (let i = 0; i < level.wingmen; i++) {
        const pos = this.player.pos.clone().add(new THREE.Vector3((i % 2 ? 1 : -1) * (110 + i * 65), 35 + i * 25, 120 + i * 85));
        this.allies.push({ id: `wingman-${i + 2}`, name: `苍隼${['二', '三', '四'][i]}号`, kind: 'aircraft', allied: true,
          pos, vel: this.player.vel.clone(), heading: 0, pitch: 0, bank: 0, speed: 185, health: 270, maxHealth: 270,
          fireTimer: i * .2, missileTimer: 9 + i * 3, seaMissiles: 1, hitFlash: 0 });
      }
      if (level.escortDuration) {
        this.carrier = this.ambientShips.find(ship => ship.id === this.campaignState.protectedFleetId);
        Object.assign(this.carrier, { health: level.carrierHealth, maxHealth: level.carrierHealth,
          halfLength: 171, halfWidth: 39, collisionTop: 44, vel: new THREE.Vector3(), retreatStart: this.carrier.pos.clone() });
        this._updateCampaignFleet();
      }
    }
    if (isNavalMode(this.mode) && this.vehicle === 'destroyer') this.player.turretPitch = 0.006;
    if (isNavalMode(this.mode) && this.vehicle === 'aircraft') { this.player.pos.y = 450; this.player.altitude = 450; }
    if (this.difficulty === 'easy') this.player.flares += 2;
    this._spawnWave();
    this._emit('toast', { text: level ? `${level.number} / ${CAMPAIGN_LEVELS.length} · ${level.title}` : isNavalMode(this.mode)
      ? this.vehicle === 'aircraft' ? `${aircraftById(this.aircraftId).shortName}对海出击 · 机头指向敌舰，R 反舰导弹，Tab 换目标`
        : this.mode === 'naval-training' ? '转动视角瞄准 · 开火舰炮 · R 反舰导弹'
        : '敌舰来袭 · 舰炮与反舰导弹协同作战'
      : this.vehicle === 'destroyer'
      ? '驱逐舰已出港 · 推油门航行，操纵舰炮，雷达锁定后发射防空导弹。'
      : this.mode === 'training' ? '训练空域：追踪 3 架靶机，练习机炮与导弹锁定。' : '敌机在前方。保持准星对准目标，持续锁定后发射导弹。' });
  }

  _random() {
    let t = this._rng += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  _emit(type, detail = {}) {
    this._events.push({ type, ...detail });
    if (this._events.length > 100) this._events.shift();
  }

  drainEvents() {
    return this._events.splice(0);
  }

  _spawnWave() {
    this.wave += 1;
    this._waveDelay = -1;
    if (isNavalMode(this.mode)) {
      this._spawnNavalWave();
      return;
    }
    if (this.mode === 'free') {
      // Ramp enemy capabilities from easy to hard over ten waves.
      // Keep the selected player aim assistance independent of enemy progression.
      const progress = Math.min(1, (this.wave - 1) / 9);
      this.settings = { ...DIFFICULTY[this.difficulty] };
      for (const key of ['damage', 'enemyTurn', 'enemyHealth', 'missileEvery']) {
        this.settings[key] = DIFFICULTY.easy[key] + (DIFFICULTY.hard[key] - DIFFICULTY.easy[key]) * progress;
      }
    }
    const level = campaignLevel(this.campaignId);
    const count = level ? level.waves[this.wave - 1] : this.mode === 'training' ? 3 : this.mode === 'free' ? this.wave + 1 : Math.min(6, this.wave + 1);
    const p = this.player;
    for (let i = 0; i < count; i++) {
      const pos = airSpawnPosition(p, i, this.wave, () => this._random(), terrainHeight);
      const heading = Math.atan2(-(p.pos.x - pos.x), -(p.pos.z - pos.z));
      this.enemies.push({
        id: `bandit-${this._nextId++}`, kind: 'aircraft', pos,
        heading, pitch: 0, bank: 0, speed: 150 + i * 5,
        vel: forward(heading, 0).multiplyScalar(150 + i * 5),
        health: this.mode === 'training' ? 130 : this.settings.enemyHealth,
        maxHealth: this.mode === 'training' ? 130 : this.settings.enemyHealth,
        role: i % 3, arrivalGrace: 4, aiMode: 'ingress', decisionTimer: 0, breakCooldown: 0,
        flares: aiProfile(this.difficulty, this.mode === 'free' ? this.wave : null).flares, flareCooldown: 0,
        phase: this._random() * TAU, age: 0, extendTime: 0,
        fireTimer: 2 + i * 1.3, missileTimer: (this.mode === 'free' ? this.settings.missileEvery : 14) + i * 5 + this._random() * 5,
        burst: 0, burstCooldown: 1 + i * 0.5, hitFlash: 0,
        passive: this.mode === 'training',
      });
      if (level) {
        const enemy = this.enemies.at(-1), commander = this.wave === level.commanderWave && i === 0;
        enemy.commander = commander;
        enemy.name = commander ? (level.id === 'finale' ? '暗潮核心指挥机' : '暗潮指挥机') : level.id === 'dawn' ? '不明敌机' : '暗潮无人机';
        enemy.health = enemy.maxHealth = this.settings.enemyHealth * level.healthScale * (commander ? level.commanderHealthScale : 1);
        enemy.turnScale = level.turnScale * (commander ? 1.25 : 1);
        enemy.missileTimer = level.enemyMissiles ? commander ? 8 : level.missileEvery + i * 2 : 1e9;
        enemy.attackCarrier = !!level.escortDuration && i % (level.number >= 7 ? 2 : 3) === 0;
        const targetIndex = i % (this.allies.length + 1);
        enemy.targetId = enemy.attackCarrier ? this.carrier.id : targetIndex === 0 ? 'player' : this.allies[targetIndex - 1]?.id || 'player';
      }
    }
    if (level) this._spawnCampaignShips(level);
    this.targetId = this.enemies[0]?.id || null;
    this.lockProgress = 0;
    this.lockTarget = null;
    this._lockAnnounced = false;
    this._resetAntiShipLock();
    this._emit('wave', { wave: this.wave, count, text: level
      ? this.wave === level.commanderWave ? '塔台：暗潮指挥机现身。强化装甲，注意导弹威胁！' : `${level.title} · 第 ${this.wave}/5 波，${count} 架敌机${level.shipWaves[this.wave - 1] ? `、${level.shipWaves[this.wave - 1]} 艘驱逐舰` : ''}`
      : this.mode === 'training' ? '训练开始 · 3 架靶机' : `第 ${this.wave} 波 · ${count} 架敌机` });
  }

  _spawnCampaignShips(level) {
    const body = HOSTILE_SHIPS.destroyer, count = level.shipWaves[this.wave - 1];
    for (let i = 0; i < count; i++) {
      const anchor = this.carrier || this.player, heading = Math.PI;
      const desired = anchor.pos.clone().add(new THREE.Vector3((i ? 1 : -1) * 650, 0, -1500 - i * 400)).setY(body.waterline);
      const pos = this._shipSpawnPosition(desired, heading, body);
      if (!pos) { this._spawnIncomplete = true; this.state = 'paused'; this._emit('toast', { text: '无法找到安全出舰海域，请返回基地重新出击。' }); return; }
      const health = Math.round(body.maxHealth * level.healthScale * this.settings.enemyHealth / 200);
      this.enemies.push({ ...body, id: `hostile-ship-${this._nextId++}`, kind: 'ship', shipType: 'destroyer', name: '暗潮驱逐舰',
        pos, vel: new THREE.Vector3(), heading, pitch: 0, bank: 0, speed: 0, health, maxHealth: health,
        turretHeading: heading, turretPitch: 0, age: 0, hitFlash: 0, rudder: 0, phase: this._random() * TAU,
        fireTimer: 5 + i, missileTimer: 12 + i * 4, ammo: 180, shots: 0,
        attackCarrier: !!this.carrier, targetId: this.carrier?.id || 'player', _lastWater: { pos: pos.clone(), heading } });
    }
  }

  _friendlyTarget(id = 'player') {
    if (id === 'player') return this.player.health > 0 ? this.player : null;
    if (this.carrier?.id === id) return this.carrier.health > 0 ? this.carrier : null;
    return this.allies.find(ally => ally.id === id && ally.health > 0) || null;
  }

  _enemyTarget(enemy) {
    return this._friendlyTarget(enemy.targetId || 'player') || this.player;
  }

  _damageFriendly(target, damage) {
    if (target === this.player) this._damagePlayer(damage);
    else { target.health = Math.max(0, target.health - damage); target.hitFlash = 1; }
  }

  _updateCampaignFleet() {
    const level = campaignLevel(this.campaignId), carrier = this.carrier;
    if (!carrier || !level) return;
    const elapsed = Math.min(level.escortDuration, this.time), distance = level.retreatDistance * elapsed / level.escortDuration;
    this.campaignState.retreatElapsed = elapsed;
    carrier.pos.copy(carrier.retreatStart); carrier.pos.z += distance;
    carrier.heading = Math.PI; carrier.speed = elapsed < level.escortDuration ? level.retreatDistance / level.escortDuration : 0;
    carrier.vel.set(0, 0, carrier.speed);
    for (const ship of this.ambientShips.filter(ship => ship.country === carrier.country && ship !== carrier)) {
      ship.pos.set(carrier.pos.x - ship.right, carrier.pos.y, carrier.pos.z - ship.aft); ship.heading = carrier.heading; ship.speed = carrier.speed;
    }
    this.campaignState.objectivePos.copy(carrier.pos).setY(18);
  }

  _updateAllies(dt) {
    for (const [i, ally] of this.allies.entries()) {
      if (ally.health <= 0) continue;
      ally.fireTimer -= dt; ally.missileTimer -= dt; ally.hitFlash = Math.max(0, ally.hitFlash - dt * 4);
      const air = this.enemies.filter(e => e.health > 0 && e.kind !== 'ship');
      const targets = air.length ? air : this.enemies.filter(e => e.health > 0);
      const target = targets[i % targets.length];
      const point = target ? target.pos.clone().addScaledVector(target.vel, .8) : this.player.pos.clone().add(new THREE.Vector3((i % 2 ? 1 : -1) * 180, 60, 220));
      point.y = Math.max(point.y, terrainHeight(point.x, point.z) + 400, 450);
      const delta = point.sub(ally.pos), desired = angles(delta.clone().normalize());
      const turn = clamp(wrap(desired.heading - ally.heading), -.46 * dt, .46 * dt);
      ally.heading = wrap(ally.heading + turn); ally.pitch = smooth(ally.pitch, clamp(desired.pitch, -.4, .4), 1.4, dt);
      ally.bank = smooth(ally.bank, clamp(turn / dt * ally.speed / 9.81, -1, 1), 2.3, dt);
      ally.speed = smooth(ally.speed, delta.length() > 1400 ? 225 : 170, .8, dt);
      const ahead = forward(ally.heading, ally.pitch); ally.vel.copy(ahead).multiplyScalar(ally.speed); ally.pos.addScaledVector(ally.vel, dt);
      ally.pos.y = Math.max(ally.pos.y, terrainHeight(ally.pos.x, ally.pos.z) + 220);
      if (ally.pos.distanceTo(this.player.pos) > 6500) ally.pos.copy(this.player.pos).add(new THREE.Vector3(180 + i * 100, 80, 240));
      if (!target) continue;
      const aimPoint = target.pos.clone(); if (target.kind === 'ship') aimPoint.y += target.aimHeight;
      const distance = ally.pos.distanceTo(aimPoint), aligned = ahead.dot(aimPoint.clone().sub(ally.pos).normalize());
      if (segmentTerrainEntry(ally.pos, aimPoint) !== null) continue;
      if (distance < 1200 && aligned > .96 && ally.fireTimer <= 0) {
        this._addTracer(ally.pos, aimPoint.sub(ally.pos).normalize(), ally.vel, false);
        Object.assign(this.tracers.at(-1), { allied: true, sourceId: ally.id, damage: 12 }); ally.fireTimer = .3;
      }
      if (distance > 400 && distance < 3200 && aligned > .8 && ally.missileTimer <= 0) {
        if (target.kind === 'ship' && ally.seaMissiles > 0) {
          const pos = ally.pos.clone();
          if (this.missiles.length >= MAX_MISSILES) this.missiles.shift();
          this.missiles.push({ id: `wingman-missile-${this._nextId++}`, weapon: 'anti-ship', enemy: false, allied: true,
            targetId: target.id, pos, prev: pos.clone(), dir: ahead.clone(), heading: ally.heading, pitch: ally.pitch,
            speed: ally.speed, maxSpeed: 320, life: 35, maxLife: 35, cruiseHeight: 15, damage: 190,
            verticalLaunch: 0, smokeTimer: 0 }); ally.seaMissiles--;
        } else if (target.kind !== 'ship') {
          this._addMissile(ally, false, target.id); Object.assign(this.missiles.at(-1), { allied: true, damage: 65 });
        }
        ally.missileTimer = 16;
      }
    }
    this.allies = this.allies.filter(ally => {
      if (ally.health > 0) return true;
      this._explosion(ally.pos, 18); this._emit('toast', { text: `${ally.name}失去联系。本关补给不会复活僚机。` }); return false;
    });
  }

  _shipSpawnPosition(preferred, heading, body, others = this.enemies) {
    const valid = position => Math.hypot(position.x, position.z) < 10300
      && shipHasClearWater(position, heading, body)
      && !(this.carrier && shipsOverlap({ ...body, pos: position, heading }, this.carrier, 80))
      && !others.some(other => other.kind === 'ship' && other.health > 0
        && shipsOverlap({ ...body, pos: position, heading }, other, 45))
      && !shipsOverlap({ ...body, pos: position, heading }, this.player, 80);
    if (valid(preferred)) return preferred.clone();
    // Search from the intended station first, then the open-water ring around the player.
    for (let ring = 1; ring <= 10; ring++) {
      for (let index = 0; index < 20; index++) {
        const angle = this.player.heading + index * TAU / 20;
        const candidate = preferred.clone().addScaledVector(forward(angle, 0), ring * 100);
        if (valid(candidate)) return candidate;
      }
    }
    for (const radius of [900, 1400, 2000, 2800]) {
      for (let index = 0; index < 36; index++) {
        const candidate = this.player.pos.clone().addScaledVector(forward(this.player.heading + index * TAU / 36, 0), radius);
        if (valid(candidate)) return candidate;
      }
    }
    // The central channel is guaranteed open by world-math; this handles externally moved state.
    for (const x of [0, -900, 900, -1500, 1500]) {
      for (let z = 8500; z >= -9800; z -= 200) {
        const candidate = new THREE.Vector3(x, body.waterline, z);
        if (valid(candidate)) return candidate;
      }
    }
    return null;
  }

  _spawnNavalWave() {
    const passive = this.mode === 'naval-training', count = passive ? 2 : Math.min(4, this.wave + 1);
    const p = this.player, ahead = forward(p.heading, 0), right = new THREE.Vector3().crossVectors(ahead, UP).normalize();
    for (let index = 0; index < count; index++) {
      const shipType = index % 2 ? 'frigate' : 'patrol', body = HOSTILE_SHIPS[shipType];
      const distance = 760 + index * 340, lateral = index === 0 ? 0 : (index % 2 ? 1 : -1) * (180 + index * 70);
      const heading = passive ? p.heading : wrap(p.heading + Math.PI + (index % 2 ? -0.2 : 0.2));
      const desired = p.pos.clone().addScaledVector(ahead, distance).addScaledVector(right, lateral);
      desired.y = body.waterline;
      const pos = this._shipSpawnPosition(desired, heading, body);
      if (!pos) {
        // Failed placement must never count as an empty, completed wave.
        this._spawnIncomplete = true; this.state = 'paused';
        this._emit('toast', { text: '暂时无法找到安全出舰海域 · 请返回基地重新开始' });
        break;
      }
      const health = passive ? (shipType === 'patrol' ? 240 : 360)
        : Math.round(body.maxHealth * this.settings.enemyHealth / 200);
      this.enemies.push({
        ...body, id: `hostile-ship-${this._nextId++}`, kind: 'ship', shipType, pos,
        heading, pitch: 0, bank: 0, speed: passive ? 0 : body.maxSpeed * 0.55,
        vel: passive ? new THREE.Vector3() : forward(heading, 0).multiplyScalar(body.maxSpeed * 0.55),
        health, maxHealth: health, turretHeading: Math.atan2(-(p.pos.x - pos.x), -(p.pos.z - pos.z)), turretPitch: 0.004,
        passive, age: 0, hitFlash: 0, rudder: 0, phase: this._random() * TAU,
        fireTimer: 2.2 + index * 0.85, ammo: 180, shots: 0,
        _lastWater: { pos: pos.clone(), heading },
      });
    }
    this.targetId = this.enemies[0]?.id || null;
    this.lockProgress = 0; this.lockTarget = null; this._lockAnnounced = false;
    this._resetAntiShipLock();
    const actualCount = this.enemies.filter(e => e.kind === 'ship').length;
    this._emit('wave', { wave: this.wave, count: actualCount, kind: 'ship',
      text: passive ? `舰炮训练 · ${actualCount} 艘靶舰` : `海峡歼敌 · 第 ${this.wave} 波 · ${actualCount} 艘敌舰` });
  }

  /** Large wall-clock jumps are intentionally discarded; the application supplies fixed steps. */
  update(dt, input = {}) {
    if (this.state !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    updateDefaultFleet(this.ambientShips, this.time);
    this._updateCampaignFleet();
    this._gunTimer -= dt;
    this._missileTimer = Math.max(0, this._missileTimer - dt);
    this._antiShipMissileTimer = Math.max(0, this._antiShipMissileTimer - dt);
    this.player.missiles = this._missileTimer > 0 ? 0 : 1;
    this.player.antiShipMissiles = this._antiShipMissileTimer > 0 ? 0 : 1;
    if (this.player.ammo <= 0 && this._gunReloadTimer <= 0) this._beginGunReload();
    if (this._gunReloadTimer > 0) {
      this._gunReloadTimer = Math.max(0, this._gunReloadTimer - dt);
      if (this._gunReloadTimer === 0) { this.player.ammo = this.player.maxGunMagazine; this._emit('toast', { text: '武器补充完成 · 可以继续开火' }); }
    }
    this._flareTimer = Math.max(0, this._flareTimer - dt);
    this._groundGrace = Math.max(0, this._groundGrace - dt);
    this._targetManualTime = Math.max(0, this._targetManualTime - dt);
    this._boundaryCooldown = Math.max(0, this._boundaryCooldown - dt);
    this._warningTimer = Math.max(0, this._warningTimer - dt);
    this._updatePlayer(dt, input);
    if (this.state !== 'playing') return;
    this._updateEnemies(dt);
    this._updateAllies(dt);
    this._updateLock(dt);
    this._updateAntiShipLock(dt);
    if (input.fire) this._fireGun();
    this._updateShipDefense(dt);
    this._updateTracers(dt);
    this._updateMissiles(dt);
    this._updateParticles(dt);
    this._removeDestroyed();
    this._updateThreat();
    this._updateMission(dt);
    // Configured launchers have unlimited free reserve ammunition. Heat,
    // guidance, cooldowns and ship fire-control channels still limit firing.
    if (this.player.health <= 0 && this.state === 'playing') this._finish(false);
  }

  _updatePlayer(dt, input) {
    if (this.vehicle === 'destroyer') {
      this._updateDestroyer(dt, input);
      return;
    }
    const p = this.player;
    const axis = key => Number.isFinite(input[key]) ? clamp(input[key], -1, 1) : 0;
    const systems = p.systems;
    p.boost = !!input.boost && p.fuelKg > 0;
    const roll = axis('roll'), pitch = axis('pitch'), yaw = axis('yaw');
    p.throttle = clamp(p.throttle + axis('throttleDelta') * dt, 0.12, 1);
    p.rollRate = smooth(p.rollRate, roll * systems.rollRate - (Math.abs(roll) < 0.03 ? Math.sin(p.bank) * 0.19 : 0), 5.5 * systems.response, dt);
    p.bank = wrap(p.bank + p.rollRate * dt);
    const authority = clamp((p.speed - 48) / 95, 0.12, 1);
    const bankCos = Math.cos(p.bank), bankSin = Math.sin(p.bank);
    // Elevator rotates about the aircraft's own wing axis. Its world-space pitch
    // component reverses when inverted; its horizontal component tightens a banked turn.
    // Project the small stability correction too, so it never commands an inverted climb.
    p.pitchRate = smooth(p.pitchRate, pitch * systems.pitchRate * authority - p.pitch * 0.075 * bankCos, 3.9 * systems.response, dt);
    p.pitch = clamp(p.pitch + p.pitchRate * bankCos * dt, -1.36, 1.36);
    const turnLoad = clamp(1 / Math.max(0.22, Math.abs(Math.cos(p.bank))), 1, 4.2);
    const turnRate = 9.81 * turnLoad * bankSin / Math.max(95, p.speed);
    const elevatorTurn = p.pitchRate * bankSin * 0.55;
    p.heading = wrap(p.heading + (turnRate * authority + elevatorTurn + yaw * 0.12 * authority) * dt);
    const thrust = p.fuelKg > 0 ? p.throttle * systems.thrust + (p.boost ? systems.boostThrust : 0) : 0;
    const drag = p.speed * p.speed * systems.dragCoefficient + Math.sin(p.bank) ** 2 * 6 + (input.airbrake ? 42 : 0);
    p.speed = clamp(p.speed + (thrust - drag - Math.sin(p.pitch) * 12) * dt, 48, p.boost ? systems.boostSpeed : systems.maxSpeed);
    p.fuelKg = Math.max(0, p.fuelKg - (p.throttle * 1.4 + (p.boost ? 3.5 : 0)) * systems.fuelRate * dt);
    p.stall = clamp((systems.stallSpeed - p.speed) / 40, 0, 1);
    p.g = smooth(p.g, clamp(turnLoad + p.pitchRate * p.speed / 9.81, -2.5, 9), 5, dt);
    const velocity = forward(p.heading, p.pitch).multiplyScalar(p.speed);
    velocity.y -= p.stall * 72 + Math.max(0, -Math.cos(p.bank)) * 35;
    p.vel.lerp(velocity, 1 - Math.exp(-3.2 * dt));
    p.pos.addScaledVector(p.vel, dt);
    p.heat = Math.max(0, p.heat - (input.fire ? 0.075 : 0.29) * systems.cooling * dt);
    if (p.overheated && p.heat < 0.32) p.overheated = false;
    p.flareTime = Math.max(0, p.flareTime - dt);
    p.damageFlash = Math.max(0, p.damageFlash - dt * 2);
    const ground = surfaceHeight(p.pos.x, p.pos.z);
    p.altitude = p.pos.y - ground;
    p.warning = '';
    if (p.fuelKg < 300) p.warning = p.fuelKg === 0 ? '燃油耗尽 · 引擎停止推力' : '燃油不足 · 减少加力';
    if (p.stall > 0.15) p.warning = '失速警告 · 推油门并压低机头';
    if (p.altitude < 180) p.warning = '地形警告 · 拉起';
    if (p.altitude < 13 && this._groundGrace === 0) {
      this._damagePlayer(35, '撞击地形，飞机受损。拉起并增加推力！');
      p.pos.y = ground + 40;
      p.pitch = Math.max(0.24, p.pitch);
      p.vel.y = Math.max(30, Math.abs(p.vel.y) * 0.4);
      p.speed = Math.max(100, p.speed * 0.72);
      this._groundGrace = 2.4;
      p.altitude = 40;
    } else if (p.altitude < 13 && this._groundGrace > 0) {
      // Recovery grace prevents a single swept terrain contact from charging damage every frame.
      p.pos.y = ground + 15;
      p.vel.y = Math.max(10, p.vel.y);
      p.pitch = Math.max(0.12, p.pitch);
    }
    if (p.pos.y > 6500) {
      p.warning = '接近升限 · 降低高度';
      p.pitch = Math.min(p.pitch, -0.08);
    }
    const radius = Math.hypot(p.pos.x, p.pos.z);
    if (radius > 8500) p.warning = '接近空域边界 · 转向返航';
    if (radius > 11000 && this._boundaryCooldown === 0) {
      p.pos.x *= 0.7;
      p.pos.z *= 0.7;
      p.heading = Math.atan2(p.pos.x, p.pos.z);
      p.bank = 0;
      p.vel.copy(forward(p.heading, p.pitch)).multiplyScalar(p.speed);
      this._boundaryCooldown = 10;
      this._emit('toast', { text: '已引导返回作战空域。敌机方位见雷达。' });
    }
    if (p.warning && (p.warning !== this._lastWarning || this._warningTimer === 0)) {
      this._emit('toast', { text: p.warning });
      this._warningTimer = 8;
    }
    this._lastWarning = p.warning;
  }

  _updateDestroyer(dt, input) {
    const p = this.player, config=this.shipSystems;
    const engineFactor=p.modules&&p.modules.engine<config.modules.engine*.5?.65:1;
    const axis = key => Number.isFinite(input[key]) ? clamp(input[key], -1, 1) : 0;
    const previous = p.pos.clone(), previousHeading = p.heading;
    p.throttle = input.boost ? 1 : clamp(p.throttle + axis('throttleDelta') * dt, 0, 1);
    p.rudder = smooth(p.rudder, clamp(axis('roll') + axis('yaw'), -1, 1), 2.4, dt);
    // A small low-speed turning allowance lets a stopped vessel leave a headland.
    p.heading = wrap(p.heading + p.rudder * config.turnRate * (0.24 + 0.76 * p.speed / (config.maxSpeed*engineFactor)) * dt);
    const cameraAim = finitePoint(input.aimPoint);
    p.gunAimActive = !!cameraAim;
    if (!cameraAim) {
      p.turretHeading = wrap(p.turretHeading + axis('aimYaw') * 0.72 * dt);
      p.turretPitch = clamp(p.turretPitch + axis('pitch') * 0.52 * dt, -0.04, 1.35);
      p.gunAimDistance = p.gunAimError = p.gunAimFlightTime = this._gunAimFlightTime = 0;
      p.gunAimLimited = false;
    }
    p.speed = clamp(smooth(p.speed, input.airbrake ? 0 : p.throttle * (config.maxSpeed*engineFactor),
      input.airbrake ? 0.75 : p.throttle ? 0.2 : 0.27, dt), 0, (config.maxSpeed*engineFactor));
    if (p.throttle === 0 && p.speed < 0.04) p.speed = 0;
    const desiredVelocity = forward(p.heading, 0).multiplyScalar(p.speed);
    p.vel.lerp(desiredVelocity, 1 - Math.exp(-0.8 * dt));
    p.vel.y = 0;
    if (p.speed === 0 && p.vel.lengthSq() < 0.01) p.vel.set(0, 0, 0);
    p.pos.addScaledVector(p.vel, dt);
    p.pos.y = config.waterline;
    p.pitch = p.pitchRate = p.rollRate = p.stall = 0;
    p.bank = p.rudder * 0.018 * p.speed / (config.maxSpeed*engineFactor);
    p.g = 1;
    p.boost = false;
    p.altitude = config.waterline;
    p.heat = Math.max(0, p.heat - (input.fire ? 0.045 : 0.23) * dt);
    if (p.overheated && p.heat < 0.32) p.overheated = false;
    p.flareTime = Math.max(0, p.flareTime - dt);
    p.damageFlash = Math.max(0, p.damageFlash - dt * 2);
    p.warning = '';
    const radius = Math.hypot(p.pos.x, p.pos.z);
    if (radius > 10300) p.warning = '接近海域边界 · 转舵返航';
    if (radius > 10900) {
      p.pos.x *= 10880 / radius;
      p.pos.z *= 10880 / radius;
      p.heading = Math.atan2(p.pos.x, p.pos.z);
      p.vel.copy(forward(p.heading, 0)).multiplyScalar(p.speed);
      if (this._boundaryCooldown === 0) {
        this._emit('toast', { text: '已引导驱逐舰返回作战海域。' });
        this._boundaryCooldown = 8;
      }
    }
    if (!shipHasClearWater(p.pos, p.heading,p)) {
      p.warning = '近岸浅水 · 减速并转舵驶离';
      // Restore open water, rather than applying the aircraft's upward terrain recovery.
      const previousSafe = shipHasClearWater(previous, previousHeading,p);
      p.pos.copy(previousSafe ? previous : this._lastShipWater.pos);
      p.pos.y = config.waterline;
      p.heading = previousSafe ? previousHeading : this._lastShipWater.heading;
      const outward = new THREE.Vector3(
        terrainHeight(previous.x - 35, previous.z) - terrainHeight(previous.x + 35, previous.z),
        0,
        terrainHeight(previous.x, previous.z - 35) - terrainHeight(previous.x, previous.z + 35),
      );
      if (outward.lengthSq() < 1e-4) outward.copy(forward(p.heading, 0)).negate();
      const safeHeading = wrap(p.heading + clamp(wrap(Math.atan2(-outward.x, -outward.z) - p.heading), -dt * 0.7, dt * 0.7));
      if (shipHasClearWater(p.pos, safeHeading)) p.heading = safeHeading;
      if (this._groundGrace === 0 && p.speed > 1) {
        this._damagePlayer(Math.min(24, 8 + p.speed * 0.8), '舰体触礁 · 已减速，请转舵离岸');
        this._groundGrace = 3;
      }
      p.speed *= 0.2;
      p.vel.set(0, 0, 0);
    }
    if (this.enemies.some(e => e.kind === 'ship' && e.health > 0 && shipsOverlap(p, e))) {
      const safePrevious = this._shipCanOccupy(p, previous, previousHeading);
      p.pos.copy(safePrevious ? previous : this._lastShipWater.pos);
      p.heading = safePrevious ? previousHeading : this._lastShipWater.heading;
      p.speed *= 0.2; p.vel.set(0, 0, 0);
      p.warning = '舰艇距离过近 · 减速并转舵避让';
    }
    this._lastShipWater.pos.copy(p.pos);
    this._lastShipWater.heading = p.heading;
    if (cameraAim) {
      const solution = shipAimSolution(p, input.aimPoint);
      p.turretHeading = wrap(p.turretHeading + clamp(wrap(solution.heading - p.turretHeading), -0.72 * dt, 0.72 * dt));
      const pitch = clamp(solution.pitch, -0.04, 1.35);
      p.turretPitch = clamp(p.turretPitch + clamp(pitch - p.turretPitch, -0.52 * dt, 0.52 * dt), -0.04, 1.35);
      const barrel = forward(p.turretHeading, p.turretPitch);
      p.gunAimDistance = new THREE.Vector3(input.aimPoint.x, input.aimPoint.y, input.aimPoint.z)
        .distanceTo(shipGunOrigin(p).addScaledVector(barrel, 14));
      p.gunAimError = Math.acos(clamp(barrel.dot(solution.direction), -1, 1));
      p.gunAimLimited = Math.abs(pitch - solution.pitch) > 1e-7 || solution.distance < 14;
      p.gunAimFlightTime = this._gunAimFlightTime = solution.time;
    }
    if (p.warning && (p.warning !== this._lastWarning || this._warningTimer === 0)) {
      this._emit('toast', { text: p.warning });
      this._warningTimer = 8;
    }
    this._lastWarning = p.warning;
  }

  _shipCanOccupy(entity, position, heading, ignore = null) {
    if (Math.hypot(position.x, position.z) > 10880 || !shipHasClearWater(position, heading, entity)) return false;
    const moved = { ...entity, pos: position, heading };
    if (this.carrier && shipsOverlap(moved, this.carrier, 30)) return false;
    if (entity !== this.player && this.vehicle === 'destroyer' && shipsOverlap(moved, this.player)) return false;
    return !this.enemies.some(other => other !== entity && other !== ignore && other.kind === 'ship'
      && other.health > 0 && shipsOverlap(moved, other));
  }

  _updateEnemyShip(e, dt) {
    e.age += dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 4); e.fireTimer -= dt;
    e.pos.y = e.waterline;
    if (e.passive) { e.speed = 0; e.vel.set(0, 0, 0); e.pitch = e.bank = 0; return; }
    const p = this._enemyTarget(e), delta = p.pos.clone().sub(e.pos), distance = delta.length();
    if (e.shipType === 'destroyer') {
      e.missileTimer -= dt;
      const aim = p.pos.clone().add(new THREE.Vector3(0, p === this.carrier ? 18 : 0, 0));
      const origin = e.pos.clone().add(new THREE.Vector3(0, 14, 0));
      if (e.missileTimer <= 0 && distance < 4300 && segmentTerrainEntry(origin, aim) === null
        && this.missiles.filter(m => m.enemy && m.targetId === (p.id || 'player')).length < 2) {
        this._addMissile({ ...e, pos: origin, pitch: Math.PI / 2 }, true, p.id || 'player');
        Object.assign(this.missiles.at(-1), { dir: UP.clone(), verticalLaunch: .35, shipLaunched: true,
          life: 16, maxLife: 16, damage: p === this.carrier ? 60 : 30 });
        e.missileTimer = this.settings.missileEvery * 1.2;
        this._emit('missile', { enemy: true, kind: 'ship' });
      }
    }
    const toPlayer = Math.atan2(-delta.x, -delta.z);
    const side = Math.sin(e.phase) >= 0 ? 1 : -1;
    let desired = distance > 1700 ? toPlayer : distance < 550 ? toPlayer + Math.PI + side * 0.3 : toPlayer + side * 1.25;
    if (Math.hypot(e.pos.x, e.pos.z) > 10200) desired = Math.atan2(e.pos.x, e.pos.z);
    const previous = e.pos.clone(), previousHeading = e.heading;
    let course = null;
    // Test a short route corridor around the requested tactical course before turning.
    for (const offset of [0, side * 0.3, -side * 0.3, side * 0.7, -side * 0.7, side * 1.2, -side * 1.2, Math.PI]) {
      const heading = wrap(desired + offset), travel = forward(heading, 0);
      if (this._shipCanOccupy(e, e.pos, heading)
        && this._shipCanOccupy(e, e.pos.clone().addScaledVector(travel, 65), heading)
        && this._shipCanOccupy(e, e.pos.clone().addScaledVector(travel, 160), heading)) { course = heading; break; }
    }
    const targetHeading = course ?? wrap(e.heading + side * Math.PI / 2);
    const turn = clamp(wrap(targetHeading - e.heading) * 0.7, -0.13, 0.13);
    const nextHeading = wrap(e.heading + turn * dt);
    e.rudder = smooth(e.rudder, clamp(turn / 0.13, -1, 1), 2.5, dt);
    if (this._shipCanOccupy(e, e.pos, nextHeading)) e.heading = nextHeading;
    const ahead = forward(e.heading, 0);
    const routeClear = this._shipCanOccupy(e, e.pos.clone().addScaledVector(ahead, 45), e.heading);
    e.speed = smooth(e.speed, routeClear && course !== null ? e.maxSpeed * (distance < 600 ? 0.55 : 0.85) : 0, 0.55, dt);
    e.vel.lerp(ahead.multiplyScalar(e.speed), 1 - Math.exp(-1.1 * dt));
    e.vel.y = 0;
    const proposed = e.pos.clone().addScaledVector(e.vel, dt);
    if (this._shipCanOccupy(e, proposed, e.heading)) e.pos.copy(proposed);
    else { e.pos.copy(previous); e.heading = previousHeading; e.speed *= 0.2; e.vel.set(0, 0, 0); }
    // A player can outrun a small combat vessel. Re-enter only from safe water beyond 4 km.
    if (distance > 4200 && !e.attackCarrier) {
      const preferred = p.pos.clone().addScaledVector(forward(toPlayer + Math.PI, 0), 1800);
      preferred.y = e.waterline;
      const relocated = this._shipSpawnPosition(preferred, e.heading, e, this.enemies.filter(other => other !== e));
      if (relocated) { e.pos.copy(relocated); e.vel.set(0, 0, 0); e.speed = 0; }
    }
    e.pitch = e.bank = 0; e.pos.y = e.waterline;
    e._lastWater.pos.copy(e.pos); e._lastWater.heading = e.heading;
    const origin = shipGunOrigin(e);
    const aim = p.pos.clone().add(new THREE.Vector3(0, 8, 0));
    const flightTime = Math.min(3.6, origin.distanceTo(aim) / 930);
    aim.addScaledVector(p.vel, flightTime).addScaledVector(e.vel, -flightTime);
    aim.y += 1.6 * flightTime * flightTime;
    const desiredAim = angles(aim.clone().sub(origin).normalize());
    e.turretHeading = wrap(e.turretHeading + clamp(wrap(desiredAim.heading - e.turretHeading), -0.55 * dt, 0.55 * dt));
    e.turretPitch = smooth(e.turretPitch, clamp(desiredAim.pitch, -0.05, 0.25), 3.5, dt);
    const alignment = forward(e.turretHeading, e.turretPitch).dot(aim.clone().sub(origin).normalize());
    const terrain = segmentTerrainEntry(origin, p.pos.clone().add(new THREE.Vector3(0, 8, 0)));
    if ((this.vehicle === 'destroyer' || p === this.carrier) && distance < 3000 && distance > 100 && e.fireTimer <= 0
      && e.ammo > 0 && alignment > Math.cos(0.055) && terrain === null) {
      const dir = forward(e.turretHeading, e.turretPitch);
      const spread = this.difficulty === 'easy' ? 0.008 : this.difficulty === 'hard' ? 0.002 : 0.004;
      dir.x += (this._random() - 0.5) * spread;
      dir.y += (this._random() - 0.5) * spread * 0.3;
      this._addTracer(origin, dir.normalize(), e.vel, true);
      const shell = this.tracers[this.tracers.length - 1];
      shell.life = shell.maxLife = 4.2; shell.damage = e.shipType === 'frigate' ? 22 : 14;
      shell.kind = 'ship'; shell.sourceId = e.id;
      shell.targetId = p.id || 'player';
      e.ammo -= 1; e.shots += 1;
      e.fireTimer = (e.shipType === 'frigate' ? 1.8 : 2.3) * (this.difficulty === 'easy' ? 1.3 : this.difficulty === 'hard' ? 0.78 : 1);
      this._emit('fire', { enemy: true, kind: 'ship', shipType: e.shipType, id: e.id });
    }
  }

  _updateEnemies(dt) {
    const profile = aiProfile(this.difficulty, this.mode === 'free' ? this.wave : null);
    for (const e of this.enemies) {
      if (e.health <= 0) continue;
      if (e.kind === 'ship') { this._updateEnemyShip(e, dt); continue; }
      e.age += dt; e.hitFlash = Math.max(0, e.hitFlash - dt * 4);
      e.fireTimer -= dt; e.missileTimer -= dt; e.burstCooldown -= dt;
      e.extendTime = Math.max(0, e.extendTime - dt);
      e.breakCooldown = Math.max(0, (e.breakCooldown || 0) - dt);
      e.flareCooldown = Math.max(0, (e.flareCooldown || 0) - dt);
      e.decisionTimer = (e.decisionTimer || 0) - dt;
      e.targetChoiceTimer = (e.targetChoiceTimer || 0) - dt;
      if (!e.attackCarrier && profile === aiProfile('hard') && this.allies.length && e.targetChoiceTimer <= 0) {
        const targets = [this.player, ...this.allies].filter(target => target.health > 0);
        let best = null, score = Infinity;
        for (const target of targets) {
          const id = target.id || 'player', assigned = this.enemies.filter(other => other !== e && other.targetId === id).length;
          const value = e.pos.distanceTo(target.pos) * (.65 + target.health / target.maxHealth * .45) + assigned * 900;
          if (value < score) { best = target; score = value; }
        }
        if (best) e.targetId = best.id || 'player';
        e.targetChoiceTimer = 3;
      }
      const target = this._enemyTarget(e), toTarget = target.pos.clone().sub(e.pos), distance = toTarget.length();
      const incoming = profile.evadeRange ? this.missiles.find(m => !m.enemy && !m.decoy && m.life > 0
        && m.targetId === e.id && m.pos.distanceTo(e.pos) < profile.evadeRange) : null;
      if (!e.passive && distance < 330 && e.breakCooldown <= 0) { e.extendTime = 3.5; e.breakCooldown = 9; }
      if (!e.passive && incoming && e.flares > 0 && e.flareCooldown <= 0 && ['aim9', 'pl10'].includes(incoming.store)) {
        incoming.decoy = e.pos.clone().add(new THREE.Vector3(130, -90, 110)); incoming.decoyLife = 2.2; incoming.targetId = null;
        e.flares--; e.flareCooldown = 14;
        for (let i = 0; i < 3; i++) this._particle(e.pos, 'flare', 2.2, 2.5, new THREE.Vector3((i - 1) * 30, -20, 15));
      }
      if (e.decisionTimer <= 0 || !e.plan || incoming && e.aiMode !== 'evade') {
        e.plan = flightPlan(e, target, { profile, incoming, time: this.time, terrainHeight });
        e.decisionTimer = profile.thinkEvery;
      }
      let plan = e.plan;
      if (e.passive) plan = { mode: 'training', heading: Math.hypot(e.pos.x, e.pos.z) > 10100 ? Math.atan2(e.pos.x, e.pos.z)
        : e.heading + Math.sin(e.age * .13 + e.phase) * .04, pitch: Math.sin(e.age * .3 + e.phase) * .045, speed: 142, weaponsAllowed: false };
      e.aiMode = plan.mode;
      let headingError = wrap(plan.heading - e.heading);
      // Short-range separation keeps wingmen from collapsing onto one pursuit line.
      const neighbor = this.enemies.find(other => other !== e && other.kind !== 'ship' && other.health > 0 && other.pos.distanceTo(e.pos) < 140);
      if (neighbor) headingError += Math.sign(e.pos.x - neighbor.pos.x || Math.sin(e.phase)) * .3;
      const maxTurn = e.passive ? .09 : this.settings.enemyTurn * (e.turnScale || 1);
      const turn = clamp(headingError * 1.1, -maxTurn, maxTurn);
      e.heading = wrap(e.heading + turn * dt);
      e.pitch = smooth(e.pitch, plan.pitch, profile === aiProfile('hard') ? 1.6 : 1, dt);
      e.bank = smooth(e.bank, clamp(turn * e.speed / 9.81, -1.1, 1.1), 2.8, dt);
      e.speed = smooth(e.speed, plan.speed, .4, dt);
      e.vel.copy(forward(e.heading, e.pitch)).multiplyScalar(e.speed); e.pos.addScaledVector(e.vel, dt);
      const floor = Math.max(240, terrainHeight(e.pos.x, e.pos.z) + 200);
      if (e.pos.y < floor) { e.pos.y = floor; e.vel.y = Math.max(0, e.vel.y); e.pitch = Math.max(0, e.pitch); }
      if (e.passive || !plan.weaponsAllowed) { e.burst = 0; continue; }
      const aim = forward(e.heading, e.pitch).dot(toTarget.normalize()), surface = target.kind !== 'aircraft';
      const clear = distance < 4300 && segmentTerrainEntry(e.pos, target.pos.clone().add(new THREE.Vector3(0, surface ? 10 : 0, 0))) === null;
      if (clear && e.burstCooldown <= 0 && aim > (surface ? .93 : profile.aim) && distance < (surface ? 2100 : 1450) && distance > 160) {
        e.burst = profile.burst; e.burstCooldown = profile.burstEvery + this._random() * 1.2;
      }
      if (clear && e.burst > 0 && e.fireTimer <= 0) {
        e.burst--; e.fireTimer = .14;
        const lead = target.pos.clone().addScaledVector(target.vel, distance / 1020 * profile.lead).sub(e.pos).normalize();
        lead.x += (this._random() - .5) * profile.spread; lead.y += (this._random() - .5) * profile.spread;
        this._addTracer(e.pos, lead.normalize(), e.vel, true); this.tracers.at(-1).targetId = target.id || 'player';
      }
      if (clear && e.missileTimer <= 0 && aim > (surface ? .8 : .91) && distance > 650 && distance < (surface ? 3800 : 3000)
        && !target.flareTime && this.missiles.filter(m => m.enemy && !m.decoy && m.targetId === (target.id || 'player')).length < profile.missileLimit) {
        e.missileTimer = this.settings.missileEvery + this._random() * 8;
        this._addMissile(e, true, target.id || 'player');
        if (target === this.player) this._emit('toast', { text: '导弹来袭！释放热诱饵并转向规避。' });
        this._emit('missile', { enemy: true });
      }
    }
  }

  _updateLock(dt) {
    const p = this.player;
    const view = forward(p.heading, p.pitch);
    const alive = this.enemies.filter(e => e.health > 0);
    let selected = alive.find(e => e.id === this.targetId);
    if (selected?.kind === 'ship') {
      this.lockProgress = 0; this.lockTarget = null; this._lockAnnounced = false;
      return;
    }
    const alignment = e => view.dot(e.pos.clone().sub(p.pos).normalize());
    if (this.vehicle === 'destroyer') {
      // Shipboard radar is omnidirectional; switching targets still restarts its lock.
      if (!selected || (this._targetManualTime === 0 && selected.pos.distanceTo(p.pos) > this.shipSystems.radarRange)) {
        const reachable = alive.filter(e => e.pos.distanceTo(p.pos) <= this.shipSystems.radarRange);
        selected = reachable.reduce((best, e) => !best || e.pos.distanceToSquared(p.pos) < best.pos.distanceToSquared(p.pos) ? e : best, null);
        if (selected?.id !== this.targetId) { this.lockProgress = 0; this._lockAnnounced = false; }
        this.targetId = selected?.id || null;
      }
      const valid = selected && selected.kind !== 'ship' && selected.pos.distanceTo(p.pos) <= this.shipSystems.radarRange;
      this.lockTarget = valid ? selected : null;
      this.lockProgress = valid ? Math.min(1, this.lockProgress + dt / (this.shipSystems.lockSeconds*(p.modules&&p.modules.radar<this.shipSystems.modules.radar*.5?1.5:1))) : Math.max(0, this.lockProgress - dt * 2.3);
      if (this.lockProgress >= 1 && valid && !this._lockAnnounced) {
        this._lockAnnounced = true;
        this._emit('toast', { text: '雷达锁定 · 可以发射防空导弹', duration: 1.5 });
      }
      if (this.lockProgress < 0.75) this._lockAnnounced = false;
      return;
    }
    if (!selected || (this._targetManualTime === 0 && this.lockProgress === 0 && alignment(selected) < 0.94)) {
      let best = null, bestAlignment = -Infinity;
      for (const e of alive) {
        const value = alignment(e);
        if (value > bestAlignment) { best = e; bestAlignment = value; }
      }
      if (best?.id !== this.targetId) { this.lockProgress = 0; this._lockAnnounced = false; }
      selected = best;
      this.targetId = selected?.id || null;
    }
    const weapon = this.airWeapon;
    const valid = this.hasWeapon('anti-air') && selected && selected.kind !== 'ship' && selected.pos.distanceTo(p.pos) < weapon.range
      && alignment(selected) > Math.cos(weapon.cone * Math.PI / 180)
      && segmentTerrainEntry(p.pos, selected.pos) === null;
    this.lockTarget = valid ? selected : null;
    if (valid) this.lockProgress = Math.min(1, this.lockProgress + dt / (weapon.lockSeconds * p.systems.lockFactor));
    else this.lockProgress = Math.max(0, this.lockProgress - dt * 2.3);
    if (this.lockProgress >= 1 && valid && !this._lockAnnounced) {
      this._lockAnnounced = true;
      this._emit('toast', { text: '目标锁定 · 可以发射导弹', duration: 1.5 });
    }
    if (this.lockProgress < 0.75) this._lockAnnounced = false;
  }

  _resetAntiShipLock() {
    this.antiShipTargetId = null; this.antiShipLockTarget = null; this.antiShipLockProgress = 0;
    this._antiShipLockAnnounced = false;
  }

  _validAntiShipTarget(target) {
    const aircraft = this.vehicle !== 'destroyer';
    if ((aircraft && !this.hasWeapon('anti-ship')) || !target || target.kind !== 'ship' || target.health <= 0
      || !this.enemies.includes(target) || target.id !== this.targetId
      || !(target.pos.distanceTo(this.player.pos) <= (aircraft ? STORES[antiShipWeaponFor(this.aircraftId)].range : this.shipSystems.antiShipRadarRange))) return false;
    if (aircraft && forward(this.player.heading, this.player.pitch).dot(target.pos.clone().sub(this.player.pos).normalize()) < Math.cos(Math.PI / 4)) return false;
    const radar = this.player.pos.clone().add(new THREE.Vector3(0, aircraft ? 0 : 16, 0));
    const contact = target.pos.clone().add(new THREE.Vector3(0, Number.isFinite(target.aimHeight) ? target.aimHeight : 5, 0));
    return segmentTerrainEntry(radar, contact) === null;
  }

  _updateAntiShipLock(dt) {
    const target = this.enemies.find(e => e.id === this.targetId && e.health > 0 && e.kind === 'ship');
    if (!this._validAntiShipTarget(target)) { this._resetAntiShipLock(); return; }
    if (this.antiShipTargetId !== target.id || this.antiShipLockTarget !== target) this._resetAntiShipLock();
    this.antiShipTargetId = target.id; this.antiShipLockTarget = target;
    this.antiShipLockProgress = Math.min(1, this.antiShipLockProgress + dt / (1.5 * (this.player.systems?.lockFactor || 1)));
    if (this.antiShipLockProgress >= 1 && !this._antiShipLockAnnounced) {
      this._antiShipLockAnnounced = true;
      this._emit('toast', { text: '反舰目标锁定 · 可以发射反舰导弹', duration: 1.5 });
    }
  }

  cycleTarget() {
    if (this.state !== 'playing') return false;
    const alive = this.enemies.filter(e => e.health > 0);
    if (!alive.length) return false;
    const index = alive.findIndex(e => e.id === this.targetId);
    this.targetId = alive[(index + 1) % alive.length].id;
    this.lockProgress = 0;
    this.lockTarget = null;
    this._lockAnnounced = false;
    this._resetAntiShipLock();
    this._targetManualTime = 4;
    if (alive[(index + 1) % alive.length].kind === 'ship') this._emit('toast', { text: `已选择敌舰 · 可使用${this.vehicle === 'destroyer' ? '舰炮' : '机炮'}或锁定后发射反舰导弹` });
    return true;
  }

  _fireGun() {
    const p = this.player;
    const ship = this.vehicle === 'destroyer';
    if (this.state !== 'playing' || this._gunTimer > 0 || this._gunReloadTimer > 0 || p.overheated || (ship && !this._shipWeaponsReady())) return;
    if (p.ammo <= 0) { this._beginGunReload(); return; }
    const round = this._weaponRound('gun');
    this._gunTimer = ship ? this.shipSystems.gunInterval : p.systems.gunInterval;
    p.ammo = Math.max(0, p.ammo - 1);
    if (p.ammo === 0) this._beginGunReload();
    this.shots += 1;
    p.heat = Math.min(1, p.heat + (ship ? this.shipSystems.gunHeat : 0.043));
    if (p.heat >= 0.98) {
      p.overheated = true;
      this._emit('toast', { text: `${ship ? '舰炮' : '机炮'}过热 · 松开发射以快速冷却` });
    }
    const origin = ship ? shipGunOrigin(p) : p.pos;
    let direction = forward(ship ? p.turretHeading : p.heading, ship ? p.turretPitch : p.pitch);
    let nearest = null, nearestDot = Math.cos(ship ? 0.085 : 0.064);
    for (const e of p.gunAimActive && ship ? [] : this.enemies) {
      if (e.health <= 0) continue;
      const delta = e.pos.clone().add(new THREE.Vector3(0, e.kind === 'ship' ? e.aimHeight : 0, 0)).sub(origin);
      if (delta.length() > (ship ? e.kind === 'ship' ? 3100 : 2100 : 1650)) continue;
      const dot = direction.dot(delta.normalize());
      if (dot > nearestDot) { nearest = e; nearestDot = dot; }
    }
    if (nearest) {
      // Small lead assistance compensates for finger-sized controls, but still requires aiming.
      const seaTarget = nearest.kind === 'ship';
      const time = Math.min(ship ? seaTarget ? 3.5 : 1.5 : Infinity, nearest.pos.distanceTo(origin) / (930 + p.speed - nearest.speed));
      const lead = nearest.pos.clone().addScaledVector(nearest.vel, time);
      if (seaTarget) lead.y += nearest.aimHeight + 1.6 * time * time;
      lead.sub(origin).addScaledVector(p.vel, -time).normalize();
      if (ship) {
        const angle = Math.acos(clamp(direction.dot(lead), -1, 1));
        direction.lerp(lead, angle > 1e-5 ? Math.min(1, 0.09 / angle) : 1).normalize();
      } else direction = lead;
    }
    direction.x += (this._random() - 0.5) * 0.002;
    direction.y += (this._random() - 0.5) * 0.002;
    this._addTracer(origin, direction.normalize(), p.vel, false);
    if (!ship) this.tracers.at(-1).damage = p.systems.gunDamage * round.grade.multiplier;
    this.tracers.at(-1).ammoGrade = round.tier;
    if (ship) {
      const shell = this.tracers[this.tracers.length - 1];
      shell.damage = this.shipSystems.gunDamage * PLAYER_DAMAGE_SCALE * round.grade.multiplier;
      if (isNavalMode(this.mode) || nearest?.kind === 'ship' || p.gunAimActive) {
        shell.life = shell.maxLife = p.gunAimActive ? Math.max(4.2, Math.min(6.8, this._gunAimFlightTime + 0.35)) : 4.2;
        shell.kind = 'ship';
      }
    }
    this._emit('fire', { enemy: false, heat: p.heat, vehicle: this.vehicle, kind: p.kind });
  }

  _addTracer(origin, direction, velocity, enemy) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    const pos = origin.clone().addScaledVector(direction, 14);
    this.tracers.push({ pos, prev: pos.clone(), vel: direction.clone().multiplyScalar(930).add(velocity), enemy, life: 2.4, maxLife: 2.4 });
  }

  _updateTracers(dt) {
    for (const t of this.tracers) {
      t.prev.copy(t.pos);
      t.vel.y -= 3.2 * dt;
      t.pos.addScaledVector(t.vel, dt);
      t.life -= dt;
      const terrain = segmentTerrainEntry(t.prev, t.pos);
      if(t.ciwsTarget){
        const missile=this.missiles.find(m=>m.id===t.ciwsTarget&&m.enemy&&m.life>0);
        if(missile&&segmentDistanceSq(missile.pos,t.prev,t.pos)<22**2){
          t.life=0;missile.interceptHealth=(missile.interceptHealth??24)-t.damage;
          if(missile.interceptHealth<=0){missile.life=0;this.player.interceptions++;this._explosion(missile.pos,5);this._emit('toast',{text:'近防炮拦截成功'});}
        }
      } else if (t.enemy) {
        const target = this._friendlyTarget(t.targetId || 'player');
        const hit = !target ? null : target.kind !== 'aircraft' ? segmentShipEntry(target, t.prev, t.pos, 2)
          : segmentSphereEntry(target.pos, t.prev, t.pos, 15);
        if (hit !== null && (terrain === null || hit < terrain)) {
          t.life = 0;
          this._damageFriendly(target, (t.damage || 6.5) * this.settings.damage);
        }
      } else {
        let target = null, firstHit = terrain ?? Infinity;
        for (const e of this.enemies) {
          if (e.health <= 0) continue;
          const hit = e.kind === 'ship' ? segmentShipEntry(e, t.prev, t.pos, 1)
            : segmentSphereEntry(e.pos, t.prev, t.pos, this.settings.aim);
          if (hit !== null && hit < firstHit) { target = e; firstHit = hit; }
        }
        if (target) {
          const damage = t.damage || 24;
          target.health -= damage; target.hitFlash = 1; if (!t.allied) this.hits += 1;
          const impact = t.prev.clone().lerp(t.pos, firstHit);
          this._emit('hit', { id: target.id, pos: impact, damage, kind: target.kind, shipType: target.shipType });
          this._spark(impact, target.kind === 'ship' ? 7 : 3);
          t.life = 0;
        }
      }
      if (terrain !== null) t.life = 0;
    }
    this.tracers = this.tracers.filter(t => t.life > 0);
  }

  launchMissile() {
    if (this.state !== 'playing' || this._missileTimer > 0) return false;
    if (this.enemies.find(e => e.id === this.targetId)?.kind === 'ship' || this.lockTarget?.kind === 'ship') {
      this.lockProgress = 0; this.lockTarget = null;
      this._emit('toast', { text: '防空只对空 · 对舰用反舰导弹或舰炮' });
      return false;
    }
    const ship = this.vehicle === 'destroyer';
    if(ship&&!this._shipWeaponsReady())return false;
    if(ship&&this.missiles.filter(m=>!m.enemy&&m.shipLaunched&&m.weapon==='anti-air'&&m.life>0).length>=this.shipSystems.samChannels){this._emit('toast',{text:'防空交战通道已占满 · 等待在途拦截完成'});return false;}
    const weapon = this.airWeapon;
    const target = this.enemies.find(e => e === this.lockTarget && e.id === this.targetId && e.health > 0 && e.kind !== 'ship');
    const alignment = target ? forward(this.player.heading, this.player.pitch).dot(target.pos.clone().sub(this.player.pos).normalize()) : -1;
    if (this.lockProgress < 1 || !target || (!ship && alignment < Math.cos(weapon.cone * Math.PI / 180))
      || target.pos.distanceTo(this.player.pos) > (ship ? this.shipSystems.radarRange : weapon.range)
      || (!ship && segmentTerrainEntry(this.player.pos, target.pos) !== null)) {
      this._emit('toast', { text: ship ? '尚未锁定 · 目标需在雷达 5 公里内持续锁定 1.2 秒' : '尚未锁定 · 保持目标在准星附近 1.2 秒' });
      return false;
    }
    const slot = ship ? null : this._consumeAircraftStore('anti-air');
    if (!ship && !slot) return false;
    const round = this._weaponRound('missile');
    this.player.missiles = 0;
    this._missileTimer = Math.max(ship ? this.shipSystems.samInterval : .75, round.grade.reload * (ship ? this.shipSystems.airReloadFactor : 1));
    this._addMissile(this.player, false, target.id, slot);
    Object.assign(this.missiles.at(-1), { damage: (this.missiles.at(-1).damage || 125) * (ship ? PLAYER_DAMAGE_SCALE : 1) * round.grade.multiplier, ammoGrade: round.tier });
    this._emit('missile', { enemy: false, id: target.id, vehicle: this.vehicle, kind: this.player.kind, weapon: 'anti-air' });
    return true;
  }

  _aircraftLaunchPosition() {
    // Arcade internal launch: no external rack or station inventory.
    return this.player.pos.clone().add(new THREE.Vector3(this._nextId % 2 ? 1.5 : -1.5, -1.3, -4)
      .applyEuler(new THREE.Euler(this.player.pitch, this.player.heading, this.player.bank, 'YXZ')));
  }

  _addMissile(source, enemy, targetId, slot = null) {
    if (this.missiles.length >= MAX_MISSILES) this.missiles.shift();
    const vls = !enemy && source.kind === 'destroyer';
    const dir = vls ? UP.clone() : forward(source.heading, source.pitch);
    const pos = slot ? this._aircraftLaunchPosition(slot) : vls ? source.pos.clone().add(new THREE.Vector3(0, 7, 0)) : source.pos.clone().addScaledVector(dir, 18);
    if (!vls && !slot) pos.y -= 2;
    this.missiles.push({
      id: `missile-${this._nextId++}`, pos, prev: pos.clone(), dir,
      heading: source.heading, pitch: vls ? Math.PI / 2 : source.pitch, speed: vls ? 95 : source.speed + 115,
      enemy, targetId, life: vls ? 14 : 9, maxLife: vls ? 14 : 9, smokeTimer: 0,
      verticalLaunch: vls ? 0.35 : 0, shipLaunched: vls,
      decoy: null, decoyLife: 0,
      weapon: 'anti-air', damage:vls?this.shipSystems.samDamage:undefined,
    });
    if (slot) Object.assign(this.missiles[this.missiles.length - 1], { store: slot.store, station: slot.station,
      life: STORES[slot.store].life, maxLife: STORES[slot.store].life, maxSpeed: STORES[slot.store].speed,
      damage: STORES[slot.store].damage * source.systems.damageMultiplier });
  }

  launchAntiShipMissile() {
    if (this.state !== 'playing' || this._antiShipMissileTimer > 0 || (this.vehicle==='destroyer'&&!this._shipWeaponsReady())) return false;
    if (!this.hasWeapon('anti-ship')) {
      this._emit('toast', { text: '未配置反舰挂载，请返回机库整备。' });
      return false;
    }
    const target = this.enemies.find(e => e === this.antiShipLockTarget && e.id === this.antiShipTargetId && e.id === this.targetId);
    if (!this._validAntiShipTarget(target)) {
      this._resetAntiShipLock();
      const selected = this.enemies.find(e => e.id === this.targetId);
      this._emit('toast', { text: selected && selected.kind !== 'ship'
        ? '反舰只对海 · 对空请用防空导弹' : '反舰尚未锁定 · 敌舰须在 5.5 公里内且无遮挡' });
      return false;
    }
    if (this.antiShipLockProgress < 1) {
      this._emit('toast', { text: '反舰目标尚未锁定 · 连续追踪敌舰 1.5 秒' });
      return false;
    }
    const slot = this.vehicle === 'destroyer' ? null : this._consumeAircraftStore('anti-ship');
    if (this.vehicle !== 'destroyer' && !slot) return false;
    const round = this._weaponRound('missile');
    this.player.antiShipMissiles = 0;
    this._antiShipMissileTimer = Math.max(this.vehicle === 'destroyer' ? this.shipSystems.antiShipInterval : 1.4, round.grade.reload * 1.5 * (this.vehicle === 'destroyer' ? this.shipSystems.seaReloadFactor : 1));
    this._addAntiShipMissile(target, slot);
    Object.assign(this.missiles.at(-1), { damage: this.missiles.at(-1).damage * (slot ? 1 : PLAYER_DAMAGE_SCALE) * round.grade.multiplier, ammoGrade: round.tier });
    this._emit('missile', { enemy: false, id: target.id, vehicle: this.vehicle, kind: 'anti-ship', weapon: 'anti-ship' });
    return true;
  }

  _addAntiShipMissile(target, slot = null) {
    if (this.missiles.length >= MAX_MISSILES) this.missiles.shift();
    const [x, y, z] = this.shipSystems.antiShipLaunch;
    const c = Math.cos(this.player.heading), s = Math.sin(this.player.heading);
    const pos = slot ? this._aircraftLaunchPosition(slot) : this.player.pos.clone().add(new THREE.Vector3(x * c + z * s, y, -x * s + z * c));
    this.missiles.push({
      id: `anti-ship-${this._nextId++}`, kind: 'anti-ship', weapon: 'anti-ship', enemy: false,
      targetId: target.id, pos, prev: pos.clone(), dir: UP.clone(), heading: this.player.heading, pitch: Math.PI / 2,
      speed: 55, life: 30, maxLife: 30, smokeTimer: 0, verticalLaunch: 0.22, shipLaunched: true,
      cruiseHeight: 15, damage: this.shipSystems.antiShipDamage, decoy: null, decoyLife: 0,
    });
    if (slot) Object.assign(this.missiles[this.missiles.length - 1], { store: slot.store, station: slot.station,
      dir: forward(this.player.heading, this.player.pitch), pitch: this.player.pitch, speed: this.player.speed,
      verticalLaunch: 0, shipLaunched: false, life: STORES[slot.store].life, maxLife: STORES[slot.store].life,
      maxSpeed: STORES[slot.store].speed, damage: STORES[slot.store].damage * this.player.systems.damageMultiplier });
  }

  _updateAntiShipMissile(m, dt) {
    const target = this.enemies.find(e => e.id === m.targetId && e.health > 0 && e.kind === 'ship');
    if (!target || m.life <= 0) { m.life = 0; return; }
    if (m.verticalLaunch > 0) m.verticalLaunch = Math.max(0, m.verticalLaunch - dt);
    else {
      const range = Math.hypot(target.pos.x - m.pos.x, target.pos.z - m.pos.z);
      const prediction = clamp(range / Math.max(200, m.speed), 0, 2) * 0.8;
      const intercept = target.pos.clone().addScaledVector(target.vel, prediction);
      const terminal = clamp(1 - range / 420, 0, 1);
      const height = m.cruiseHeight + (target.pos.y + target.aimHeight - m.cruiseHeight) * terminal;
      const heading = Math.atan2(-(intercept.x - m.pos.x), -(intercept.z - m.pos.z));
      const pitch = clamp(Math.atan2(height - m.pos.y, clamp(range * 0.25, 25, 160)), m.shipLaunched ? -0.5 : -0.95, 0.4);
      const desired = forward(heading, pitch);
      // Quaternion rotation handles an exactly opposite heading without zero-length lerps.
      const rotation = new THREE.Quaternion().setFromUnitVectors(m.dir, desired);
      const turn = new THREE.Quaternion().rotateTowards(rotation, 2.4 * dt);
      m.dir.applyQuaternion(turn).normalize();
    }
    m.speed = Math.min(m.maxSpeed || 280, m.speed + 100 * dt);
    m.pos.addScaledVector(m.dir, m.speed * dt);
    const attitude = angles(m.dir); m.heading = attitude.heading; m.pitch = attitude.pitch;
    if (m.smokeTimer <= 0) {
      m.smokeTimer = 0.1;
      this._particle(m.pos, 'smoke', 1.5, 4, new THREE.Vector3(0, 2, 0));
    }
    const terrain = segmentTerrainEntry(m.prev, m.pos);
    let contact = null, hit = terrain ?? Infinity;
    for (const ship of this.enemies) {
      if (ship.kind !== 'ship' || ship.health <= 0) continue;
      const entry = segmentShipEntry(ship, m.prev, m.pos, 1);
      if (entry !== null && entry < hit) { contact = ship; hit = entry; }
    }
    if (contact) {
      m.life = 0;
      const impact = m.prev.clone().lerp(m.pos, hit);
      contact.health -= m.damage; contact.hitFlash = 1;
      this._explosion(impact, 20);
      this._emit('hit', { id: contact.id, pos: impact, damage: m.damage, missile: true, kind: 'ship', shipType: contact.shipType, weapon: 'anti-ship' });
    } else if (terrain !== null) {
      m.life = 0;
      this._explosion(m.prev.clone().lerp(m.pos, terrain), 6);
    }
  }

  deployFlare() {
    if (this.state !== 'playing' || this._flareTimer > 0 || this.player.flares <= 0) return false;
    const p = this.player;
    p.flares -= 1;
    p.flareTime = p.systems?.flareDuration || 2.6;
    this._flareTimer = 1.25;
    const backwards = forward(p.heading, p.pitch).multiplyScalar(-1);
    const ship = this.vehicle === 'destroyer';
    const origin = ship ? p.pos.clone().add(new THREE.Vector3(0, 8, 0)) : p.pos;
    for (let i = 0; i < 7; i++) {
      const vel = backwards.clone().multiplyScalar(35 + this._random() * 35).addScaledVector(p.vel, 0.25);
      vel.x += (i - 3) * 20;
      if (ship) vel.y += 22 + this._random() * 20;
      else vel.y -= 15 + this._random() * 35;
      this._particle(origin, 'flare', 2.8, 3, vel);
    }
    let diverted = 0;
    for (const m of this.missiles) {
      if (!m.enemy || (m.targetId && m.targetId !== 'player') || m.decoy || m.pos.distanceTo(p.pos) > 3000) continue;
      m.decoy = p.pos.clone().addScaledVector(backwards, 150).add(new THREE.Vector3(100, ship ? 12 : -95, 0));
      m.decoyLife = 2.8;
      m.targetId = null;
      diverted += 1;
    }
    this._updateThreat();
    this._emit('flare', { diverted });
    this._emit('toast', { text: diverted ? `热诱饵已干扰 ${diverted} 枚导弹 · 继续转弯` : '热诱饵已释放' });
    return true;
  }

  _updateMissiles(dt) {
    for (const m of this.missiles) {
      m.life -= dt;
      if (m.life <= 0) { m.life = 0; continue; }
      m.smokeTimer -= dt;
      m.prev.copy(m.pos);
      if (m.weapon === 'anti-ship') { this._updateAntiShipMissile(m, dt); continue; }
      let target = m.enemy ? this._friendlyTarget(m.targetId || 'player') : this.enemies.find(e => e.id === m.targetId && e.health > 0 && e.kind !== 'ship');
      if (m.store === 'aim7' && target) {
        const radarAligned = forward(this.player.heading, this.player.pitch).dot(target.pos.clone().sub(this.player.pos).normalize()) > Math.cos(STORES.aim7.cone * Math.PI / 180);
        if (this.targetId !== target.id || !radarAligned || target.pos.distanceTo(this.player.pos) > STORES.aim7.range
          || segmentTerrainEntry(this.player.pos, target.pos) !== null) target = null;
      }
      let targetPosition = null;
      if (m.decoy) {
        m.decoyLife -= dt;
        targetPosition = m.decoy;
        target = null;
        if (m.decoyLife <= 0 || m.pos.distanceTo(m.decoy) < 30) m.life = 0;
      } else if (target) {
        const prediction = clamp(m.pos.distanceTo(target.pos) / Math.max(400, m.speed), 0, 1.4) * 0.72;
        targetPosition = target.pos.clone().addScaledVector(target.vel, prediction);
      }
      if (m.verticalLaunch > 0) m.verticalLaunch = Math.max(0, m.verticalLaunch - dt);
      else if (targetPosition) {
        const desired = targetPosition.clone().sub(m.pos).normalize();
        const angle = Math.acos(clamp(m.dir.dot(desired), -1, 1));
        const maxTurn = (m.enemy ? 0.83 : m.shipLaunched ? 1.9 : 1.45) * dt;
        if (angle > 1e-5) m.dir.lerp(desired, Math.min(1, maxTurn / angle)).normalize();
      }
      m.speed = Math.min(m.enemy ? 510 : m.maxSpeed || (m.shipLaunched ? 720 : 610), m.speed + (m.shipLaunched ? 240 : 170) * dt);
      m.pos.addScaledVector(m.dir, m.speed * dt);
      const attitude = angles(m.dir);
      m.heading = attitude.heading;
      m.pitch = attitude.pitch;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.065;
        this._particle(m.pos, 'smoke', 1.5, 4, new THREE.Vector3(0, 2, 0));
      }
      if (target && (m.enemy && target.kind !== 'aircraft' ? segmentHitsShip(target, m.prev, m.pos, 8)
        : segmentDistanceSq(target.pos, m.prev, m.pos) < (m.enemy ? 24 : 30) ** 2)) {
        m.life = 0;
        this._explosion(m.pos, m.enemy ? 10 : 14);
        if (m.enemy) this._damageFriendly(target, (m.damage || 33) * this.settings.damage);
        else {
          const damage = m.damage || 125;
          target.health -= damage;
          target.hitFlash = 1;
          this._emit('hit', { id: target.id, pos: target.pos.clone(), damage, missile: true });
        }
      }
      if (m.pos.y < surfaceHeight(m.pos.x, m.pos.z)) {
        m.life = 0;
        this._explosion(m.pos, 6);
      }
    }
    this.missiles = this.missiles.filter(m => m.life > 0);
  }

  _shipWeaponsReady() {
    return !this.player.modules||this.player.modules.weapons>=this.shipSystems.modules.weapons*.3;
  }

  _updateShipDefense(dt) {
    const p=this.player,c=this.shipSystems;
    if(this.vehicle!=='destroyer'||!c.ciwsRange)return;
    p.ciwsCooldown=Math.max(0,p.ciwsCooldown-dt);p.ciwsHeat=Math.max(0,p.ciwsHeat-c.ciwsCooling*dt);
    if(p.ciwsHeat<.3)p.ciwsOverheated=false;
    if(p.ciwsCooldown>0||p.ciwsOverheated||!this._shipWeaponsReady())return;
    const origin=p.pos.clone().add(new THREE.Vector3(0,12,0));
    const target=this.missiles.filter(m=>m.enemy&&!m.decoy&&m.life>0&&m.pos.distanceTo(origin)<c.ciwsRange)
      .sort((a,b)=>a.pos.distanceToSquared(origin)-b.pos.distanceToSquared(origin))[0];
    if(!target||segmentTerrainEntry(origin,target.pos)!==null)return;
    const lead=target.pos.clone().addScaledVector(target.dir,target.speed*target.pos.distanceTo(origin)/2200);
    const direction=lead.sub(origin).normalize();this._addTracer(origin,direction,p.vel,false);
    const tracer=this.tracers.at(-1);Object.assign(tracer,{ciwsTarget:target.id,damage:c.ciwsDamage,life:.65,maxLife:.65});tracer.vel.copy(direction).multiplyScalar(2200).add(p.vel);
    p.ciwsCooldown=c.ciwsInterval;p.ciwsHeat=Math.min(1,p.ciwsHeat+c.ciwsHeat);if(p.ciwsHeat>=.98)p.ciwsOverheated=true;
  }

  _damagePlayer(amount, text) {
    if (this.state !== 'playing') return;
    amount *= this.player.systems?.damageTaken || 1;
    if(this.vehicle==='destroyer'&&this.shipId!=='destroyer'){
      amount=Math.round(amount*(1-this.shipSystems.armor)*100)/100;
      const id=['engine','radar','weapons'][this._shipDamageIndex++%3];
      this.player.modules[id]=Math.max(0,this.player.modules[id]-amount*.65);
    }
    this.player.health = Math.max(0, this.player.health - amount);
    this.player.damageFlash = Math.min(1, this.player.damageFlash + 0.5);
    this._emit('damage', { amount, health: this.player.health });
    if (text) this._emit('toast', { text });
    if (this.player.health <= 0) this._finish(false);
  }

  _particle(pos, kind, life, size, vel = new THREE.Vector3()) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ pos: pos.clone(), vel, life, maxLife: life, size, kind });
  }

  _spark(pos, count) {
    for (let i = 0; i < count; i++) {
      const vel = new THREE.Vector3(this._random() - 0.5, this._random() - 0.3, this._random() - 0.5).multiplyScalar(65);
      this._particle(pos, 'explosion', 0.3 + this._random() * 0.2, 2 + this._random() * 3, vel);
    }
  }

  _explosion(pos, count = 22) {
    for (let i = 0; i < count; i++) {
      const vel = new THREE.Vector3(this._random() - 0.5, this._random() - 0.3, this._random() - 0.5).multiplyScalar(75);
      this._particle(pos, i % 3 ? 'explosion' : 'smoke', 0.65 + this._random() * 1.2, 7 + this._random() * 15, vel);
    }
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * 0.6));
      p.vel.y += (p.kind === 'flare' ? -15 : 7) * dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  _removeDestroyed() {
    for (const e of this.enemies) {
      if (e.health > 0) continue;
      this.kills += 1;
      const seaTarget = e.kind === 'ship';
      if (this.campaignState) this.campaignState[seaTarget ? 'shipKills' : 'airKills']++;
      const points = this.mode === 'training' || this.mode === 'naval-training' ? 100
        : seaTarget ? (e.shipType === 'destroyer' ? 340 : e.shipType === 'frigate' ? 260 : 180) + this.wave * 25 : 150 + this.wave * 25;
      this.score += points;
      this._explosion(e.pos.clone().add(new THREE.Vector3(0, seaTarget ? e.aimHeight : 0, 0)), seaTarget ? 30 : 22);
      this._emit('kill', { id: e.id, pos: e.pos.clone(), points, kills: this.kills, kind: e.kind, shipType: e.shipType });
      if (e.commander && this.campaignState) this.campaignState.commanderDown = true;
      this._emit('toast', { text: `${seaTarget ? '击沉敌舰' : '击落敌机'}  +${points}` });
      if (this.targetId === e.id) {
        this.targetId = null;
        this.lockTarget = null;
        this.lockProgress = 0;
        this._lockAnnounced = false;
      }
      if (this.antiShipTargetId === e.id) this._resetAntiShipLock();
    }
    this.enemies = this.enemies.filter(e => e.health > 0);
  }

  _updateThreat() {
    this.incoming = this.missiles.filter(m => m.enemy && (!m.targetId || m.targetId === 'player') && !m.decoy && m.life > 0).length;
    let threat = 0;
    for (const e of this.enemies) {
      if (e.passive) continue;
      const toPlayer = this.player.pos.clone().sub(e.pos);
      const distance = toPlayer.length();
      const dot = forward(e.kind === 'ship' ? e.turretHeading : e.heading, e.kind === 'ship' ? e.turretPitch : e.pitch).dot(toPlayer.normalize());
      if (e.kind === 'ship' && segmentTerrainEntry(shipGunOrigin(e), this.player.pos.clone().add(new THREE.Vector3(0, 8, 0))) !== null) continue;
      threat = Math.max(threat, Math.max(0, dot) * clamp(1 - distance / (e.kind === 'ship' ? 3500 : 2000), 0, 1));
    }
    this.threat = this.incoming ? 1 : clamp(threat, 0, 0.9);
  }

  _updateMission(dt) {
    if (this.mode === 'campaign') { this._updateCampaignMission(dt); return; }
    if (this.state !== 'playing' || this.enemies.length || this._spawnIncomplete) return;
    if (this.mode === 'training' || this.mode === 'naval-training'
      || ((this.mode === 'intercept' || this.mode === 'naval') && this.wave >= 3)) {
      this._finish(true);
      return;
    }
    if (this._waveDelay < 0) {
      this._waveDelay = 4.5;
      const p = this.player;
      const ship = this.vehicle === 'destroyer';
      const full = this.mode === 'free';
      p.health = full ? p.maxHealth : Math.min(p.maxHealth, p.health + (ship ? 105 : 35));
      if(ship&&p.modules)p.modules={...this.shipSystems.modules};
      if (!ship) p.fuelKg = full ? p.systems.fuelCapacity : Math.min(p.systems.fuelCapacity, p.fuelKg + 700);
      p.flares = Math.min((ship?this.shipSystems.maxFlares:p.systems?.maxFlares || 6) + (this.difficulty === 'easy' ? 2 : 0), p.flares + (full ? Infinity : 3));
      if (full) {
        // End the cleared wave's weapon effects before delivering fresh supplies.
        this.missiles = [];
        this.tracers = [];
        this.incoming = this.threat = 0;
        this._missileTimer = this._antiShipMissileTimer = this._flareTimer = this._gunTimer = 0;
      }
      this._refillWeapons();
      p.heat = 0;
      p.overheated = false;
      this._lowAmmoAnnounced = false;
      this._emit('toast', { text: `本波${isNavalMode(this.mode) ? '海域' : '空域'}已清除 · ${ship ? '舰体' : '机体'}修复与弹药补给完成` });
    }
    this._waveDelay -= dt;
    if (this._waveDelay <= 0) this._spawnWave();
  }

  _updateCampaignMission(dt) {
    if (this.state !== 'playing') return;
    const level = campaignLevel(this.campaignId), state = this.campaignState;
    if (!level || !state) return;
    if (this.player.health <= 0) { this._finish(false, 'health'); return; }
    if (this.carrier && this.carrier.health <= 0) { this._finish(false, 'carrier'); return; }
    while (state.radioIndex < level.radio.length && this.time >= level.radio[state.radioIndex].at) {
      this._emit('toast', { text: level.radio[state.radioIndex++].text });
    }
    if (this.carrier) {
      state.objectivePos.copy(this.carrier.pos).setY(18);
      const distance = Math.hypot(this.player.pos.x - state.objectivePos.x, this.player.pos.z - state.objectivePos.z);
      const outside = distance > level.guardRadius;
      if (outside && state.outsideFor === 0) this._emit('toast', { text: `塔台：你已离开护航空域。${level.abandonAfter} 秒内返回绿色标记！` });
      state.outsideFor = outside ? state.outsideFor + dt : 0;
      if (state.outsideFor >= level.abandonAfter) { this._finish(false, 'airspace'); return; }
    }
    // A valid final kill on the time boundary takes precedence over timeout.
    if (!this._spawnIncomplete && !this.enemies.length && this.wave >= level.waves.length
      && state.airKills >= level.airTotal && state.shipKills >= level.shipTotal
      && (!level.commanderWave || state.commanderDown)
      && (!this.carrier || state.retreatElapsed >= level.escortDuration && state.outsideFor === 0)) { this._finish(true); return; }
    if (level.timeLimit && this.time >= level.timeLimit) { this._finish(false, 'time'); return; }
    if (!this.enemies.length && this.wave < level.waves.length && !this._spawnIncomplete) {
      if (this._waveDelay < 0) {
        this._waveDelay = 4.5;
        const p = this.player;
        p.health = Math.min(p.maxHealth, p.health + 25);
        this._refillWeapons(); p.fuelKg = Math.min(p.systems.fuelCapacity, p.fuelKg + 1000);
        p.flares = Math.min(p.systems.maxFlares + (this.difficulty === 'easy' ? 2 : 0), p.flares + 3);
        this._refillWeapons(); p.heat = 0; p.overheated = false; this._lowAmmoAnnounced = false;
        for (const ally of this.allies) { ally.health = Math.min(ally.maxHealth, ally.health + 25); ally.seaMissiles = 1; }
        this._emit('toast', { text: '塔台：本批目标已清除。修复与补给完成，准备迎击下一批。' });
      }
      this._waveDelay -= dt;
      if (this._waveDelay <= 0) this._spawnWave();
    }
  }

  _finish(won, reason = '') {
    if (this.state !== 'playing') return;
    this.state = won ? 'won' : 'lost';
    this.endReason = won ? '' : reason || 'health';
    if (won) this.score += Math.round(this.player.health * 5);
    else if (reason === 'carrier') this._explosion(this.carrier.pos, 35);
    else if (this.player.health <= 0) this._explosion(this.player.pos, 25);
    this._emit('result', { won, reason: this.endReason, score: this.score, kills: this.kills, time: this.time, accuracy: this.shots ? this.hits / this.shots : 0 });
  }
}
