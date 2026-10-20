import * as THREE from './vendor/three.module.js';
const TAU = Math.PI * 2;
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const AIR_SPAWN_MIN = 3800;
export const AI_PROFILES = Object.freeze({
  easy: Object.freeze({ reaction: 1.5, thinkEvery: .7, lead: .35, flank: 0, evadeRange: 0, flares: 0, burst: 3, burstEvery: 3.8, aim: .985, spread: .027, missileLimit: 1, cruise: 166 }),
  normal: Object.freeze({ reaction: .8, thinkEvery: .35, lead: .72, flank: 650, evadeRange: 1700, flares: 1, burst: 4, burstEvery: 3, aim: .977, spread: .017, missileLimit: 2, cruise: 184 }),
  hard: Object.freeze({ reaction: .35, thinkEvery: .18, lead: 1.05, flank: 1150, evadeRange: 2600, flares: 3, burst: 6, burstEvery: 2.3, aim: .968, spread: .009, missileLimit: 2, cruise: 204 }),
});
export function aiProfile(difficulty, endlessWave = null) {
  if (endlessWave != null) return endlessWave < 4 ? AI_PROFILES.easy : endlessWave < 8 ? AI_PROFILES.normal : AI_PROFILES.hard;
  return Object.hasOwn(AI_PROFILES, difficulty) ? AI_PROFILES[difficulty] : AI_PROFILES.normal;
}
// Search all bearings near map edges; every result remains beyond the minimum
// horizontal range. Terrain is shared with collision, not a separate spawn map.
export function airSpawnPosition(player, index, wave, random, terrainHeight) {
  const radius = AIR_SPAWN_MIN + index % 8 * 170 + Math.floor(index / 8) % 10 * 75;
  const base = player.heading + (index % 2 ? 1 : -1) * (.12 + index % 5 * .1) + (wave - 1) % 3 * .13;
  let chosen = null;
  for (let attempt = 0; attempt < 48; attempt++) {
    const angle = base + attempt * TAU / 48;
    const candidate = player.pos.clone().add(new THREE.Vector3(-Math.sin(angle) * radius, 0, -Math.cos(angle) * radius));
    if (Math.hypot(candidate.x, candidate.z) <= 10200) { chosen = candidate; break; }
  }
  if (!chosen) throw new RangeError('No distant aircraft entry point within the combat area');
  chosen.y = Math.max(terrainHeight(chosen.x, chosen.z) + 500, player.kind === 'destroyer' ? 850 + index * 45 : Math.min(3300, player.pos.y + (random() - .5) * 220));
  return chosen;
}
export function flightPlan(enemy, target, { profile, incoming = null, time = 0, terrainHeight }) {
  const delta = target.pos.clone().sub(enemy.pos), distance = delta.length(), side = enemy.role % 2 ? 1 : -1;
  let mode = 'pursuit', point = target.pos.clone().addScaledVector(target.vel, Math.min(distance / 850, 1.4) * profile.lead);
  if (target.kind !== 'aircraft') point.y = Math.max(450, terrainHeight(point.x, point.z) + 450);
  if (distance > 2400) mode = 'intercept';
  if (enemy.extendTime > 0) { mode = 'extend'; point.copy(enemy.pos).add(new THREE.Vector3(-Math.sin(enemy.heading) * 1800, 200, -Math.cos(enemy.heading) * 1800)); }
  else if (incoming && profile.evadeRange) {
    mode = 'evade'; const bearing = Math.atan2(-incoming.dir.x, -incoming.dir.z) + side * Math.PI / 2;
    point.copy(enemy.pos).add(new THREE.Vector3(-Math.sin(bearing) * 1800, Math.sin(time * 1.8 + enemy.phase) * 450, -Math.cos(bearing) * 1800));
  } else if (profile.flank && enemy.role === 1 && distance > 1000 && distance < 4200) {
    mode = 'flank'; point.x += Math.cos(target.heading) * profile.flank * side; point.z -= Math.sin(target.heading) * profile.flank * side;
  }
  if (Math.hypot(enemy.pos.x, enemy.pos.z) > 10100) { mode = 'return'; point.set(0, Math.max(950, enemy.pos.y), 0); }
  const course = point.sub(enemy.pos);
  let pitch = Math.max(-.48, Math.min(.48, Math.atan2(course.y, Math.hypot(course.x, course.z))));
  const aheadGround = terrainHeight(enemy.pos.x + enemy.vel.x * 2, enemy.pos.z + enemy.vel.z * 2);
  if (enemy.pos.y - Math.max(terrainHeight(enemy.pos.x, enemy.pos.z), aheadGround) < 420) pitch = Math.max(.42, pitch);
  if (enemy.pos.y > 4300) pitch = Math.min(-.25, pitch);
  return { mode, heading: wrap(Math.atan2(-course.x, -course.z)), pitch,
    speed: distance > 7000 ? 255 : mode === 'extend' || mode === 'evade' ? profile.cruise + 35 : profile.cruise,
    weaponsAllowed: !['evade', 'extend', 'return'].includes(mode) && enemy.age >= (enemy.arrivalGrace ?? 4) + profile.reaction };
}
