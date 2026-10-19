const COLLECTIONS = ['enemies', 'allies', 'missiles', 'tracers', 'particles'];
const VECTORS = ['pos', 'position', 'prev', 'vel'];
const ANGLES = ['heading', 'pitch', 'bank', 'turretHeading'];
const SCALARS = [...ANGLES, 'turretPitch', 'rudder', 'speed', 'time'];
const ENTITY_FIELDS = new Set(['player', ...COLLECTIONS]);
const TAU = Math.PI * 2;
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;

// Display values own their mutable data. In particular, copy() and lerpVectors()
// must never write through a Vector3 borrowed from authoritative physics state.
function copyValue(source, previous) {
  if (source?.isVector3) return previous?.isVector3 ? previous.copy(source) : source.clone();
  if (Array.isArray(source)) {
    const target = Array.isArray(previous) ? previous : [];
    for (let i = 0; i < source.length; i++) target[i] = copyValue(source[i], target[i]);
    target.length = source.length;
    return target;
  }
  if (source && typeof source === 'object') {
    const target = previous && typeof previous === 'object' && !previous.isVector3 && !Array.isArray(previous) ? previous : {};
    for (const key in target) if (!Object.hasOwn(source, key)) delete target[key];
    for (const key of Object.keys(source)) target[key] = copyValue(source[key], target[key]);
    return target;
  }
  return source;
}

/**
 * A render-only view of the two most recent fixed physics states.
 * Call capture(sim) immediately BEFORE EACH sim.update(), then sample(sim,
 * accumulator / fixedStep) once per display frame. All physics/combat code
 * continues to use sim. Returned views are reused and valid until the next sample.
 */
export class FlightPresentation {
  constructor() {
    this._sim = null;
  }

  reset(sim) {
    this._sim = sim;
    this._player = sim.player;
    this._records = new WeakMap();
    this._view = {player: {}, enemies: [], allies: [], missiles: [], tracers: [], particles: []};
    this._step = 0;
    this._capture(sim);
  }

  capture(sim) {
    this._ensure(sim);
    this._step++;
    this._capture(sim);
  }

  sample(sim, alpha) {
    this._ensure(sim);
    alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    const view = this._view;
    for (const key in view) {
      if (!ENTITY_FIELDS.has(key) && !Object.hasOwn(sim, key)) delete view[key];
    }
    // Keep mission state, health, ammunition and target selection current. No
    // simulation methods or private mutable queues are exposed to the renderer.
    for (const key of Object.keys(sim)) {
      if (!key.startsWith('_') && !ENTITY_FIELDS.has(key) && typeof sim[key] !== 'function') {
        view[key] = copyValue(sim[key], view[key]);
      }
    }
    view.time = Number.isFinite(this._time) && Number.isFinite(sim.time)
      ? this._time + (sim.time - this._time) * alpha : sim.time;
    view.player = this._sampleEntity(sim.player, alpha);
    for (const key of COLLECTIONS) {
      const entities = sim[key] || [], list = view[key];
      for (let i = 0; i < entities.length; i++) list[i] = this._sampleEntity(entities[i], alpha);
      list.length = entities.length;
    }
    return view;
  }

  _ensure(sim) {
    // Restarts replace player identity and reset the clock. Guard those here as
    // well as providing explicit reset() for lifecycle boundaries such as resume.
    if (this._sim !== sim || this._player !== sim.player || sim.time < this._time) this.reset(sim);
  }

  _record(entity) {
    let record = this._records.get(entity);
    if (!record) {
      record = {previous: {}, view: {}, step: -1};
      this._records.set(entity, record);
    }
    return record;
  }

  _capture(sim) {
    this._time = sim.time;
    this._captureEntity(sim.player);
    for (const key of COLLECTIONS) for (const entity of sim[key] || []) this._captureEntity(entity);
  }

  _captureEntity(entity) {
    const record = this._record(entity), previous = record.previous;
    record.step = this._step;
    for (const key of VECTORS) {
      if (entity[key]?.isVector3) previous[key] = copyValue(entity[key], previous[key]);
      else delete previous[key];
    }
    for (const key of SCALARS) {
      if (Number.isFinite(entity[key])) previous[key] = entity[key];
      else delete previous[key];
    }
  }

  _sampleEntity(entity, alpha) {
    const record = this._record(entity), previous = record.previous;
    const view = copyValue(entity, record.view);
    // New objects have no previous pose, even if an old entity used the same id.
    if (record.step !== this._step) return view;
    const positionKey = entity.pos?.isVector3 ? 'pos' : 'position';
    if (previous[positionKey] && entity[positionKey]?.distanceToSquared(previous[positionKey]) > 1000000) return view;
    for (const key of VECTORS) {
      if (previous[key] && entity[key]?.isVector3) view[key].lerpVectors(previous[key], entity[key], alpha);
    }
    for (const key of SCALARS) {
      if (Number.isFinite(previous[key]) && Number.isFinite(entity[key])) {
        const difference = entity[key] - previous[key];
        view[key] = previous[key] + (ANGLES.includes(key) ? wrap(difference) : difference) * alpha;
      }
    }
    return view;
  }
}
