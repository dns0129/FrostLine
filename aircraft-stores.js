import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { aircraftById, STORES, presetLoadout } from './aircraft-systems.js';

// Fixed-size reusable slots avoid allocations during launch, replenishment or
// menu changes. Every instance owns and disposes only its stores resources.
// `templates` maps store ids to model-supplied meshes (centred on the store).
// Optional per-station `overrides` provide measured template transforms for a
// particular airframe. Both kinds share asset-owned GPU resources.
export function attachAircraftStores(jet, aircraftId = 'fa18c', { templates = {}, overrides = {} } = {}) {
  const group = new THREE.Group(); group.name = 'Custom external stores'; jet.add(group);
  const aircraft = aircraftById(aircraftId), bodies = {}, geometry = new Set(), material = new Set();
  const used = new Set(aircraft.stations.flatMap(station => Object.keys(station.allowed)));
  for (const id of used) {
    if (templates[id]) continue;
    const tank = id === 'tank', { length, radius, hang = 0 } = STORES[id].visual;
    const body = new THREE.CylinderGeometry(radius, radius, length * .8, 10);
    body.rotateX(Math.PI / 2);
    const nose = new THREE.ConeGeometry(radius, length * .2, 10); nose.rotateX(-Math.PI / 2); nose.translate(0, 0, -length * .5);
    const tail = new THREE.BoxGeometry(tank ? .1 : radius * 5, .025, .5); tail.translate(0, 0, length * .32);
    const cross = tail.clone(); cross.rotateZ(Math.PI / 2);
    for (const part of [body,nose,tail,cross]) {
      const tint = new THREE.Color(tank ? '#949ea7' : part === nose ? '#636b73' : '#c8cbd0');
      const colors = new Float32Array(part.attributes.position.count * 3);
      for(let i=0;i<colors.length;i+=3){colors[i]=tint.r;colors[i+1]=tint.g;colors[i+2]=tint.b;}
      part.setAttribute('color',new THREE.BufferAttribute(colors,3));
    }
    const merged = mergeGeometries([body,nose,tail,cross]);
    [body,nose,tail,cross].forEach(g=>g.dispose());
    if (hang) merged.translate(0, -hang, 0);
    const paint = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7});
    geometry.add(merged); material.add(paint);
    bodies[id] = { geometry:merged, paint };
  }
  const makeStore = (id, override) => {
    const template = override?.template || templates[id];
    if (template) {
      const model = template.clone(true);
      model.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
      return model;
    }
    const mesh = new THREE.Mesh(bodies[id].geometry, bodies[id].paint); mesh.castShadow = true; return mesh;
  };
  const slots = aircraft.stations.map(station => {
    const root = new THREE.Group(); root.position.set(...station.position); group.add(root);
    const types = {};
    for (const id of Object.keys(station.allowed)) {
      const instances = [];
      const override = overrides[station.id]?.[id];
      for (let n = 0; n < station.allowed[id]; n++) {
        const store = new THREE.Group(); store.userData.store = id; store.userData.station = station.id;
        if (override) {
          store.position.fromArray(override.position).sub(root.position);
          store.rotation.set(...override.rotation);
          store.userData.hardpoint = override.hardpoint;
        }
        store.userData.mountPosition = store.position.clone();
        store.add(makeStore(id, override));
        root.add(store); instances.push(store);
      }
      types[id] = instances;
    }
    return { station: station.id, root, types, entries: Object.entries(types), store: undefined, count: undefined };
  });
  const defaultLoadout = presetLoadout('multirole', aircraftId);
  let disposed = false;
  const setLoadout = (value = defaultLoadout) => {
    if (disposed || !Array.isArray(value)) return;
    for (const slot of slots) {
      let item;
      for (let i = 0; i < value.length; i++) if (value[i]?.station === slot.station) { item = value[i]; break; }
      const store = item?.store ?? null, count = Number.isFinite(item?.count) ? Math.max(0, Math.floor(item.count)) : 0;
      if (slot.store === store && slot.count === count) continue;
      slot.store = store; slot.count = count;
      for (const [id, instances] of slot.entries) for (let n = 0; n < instances.length; n++) {
        const mesh = instances[n];
        mesh.visible = store === id && n < count;
        mesh.position.x = mesh.userData.mountPosition.x + (count === 2 ? (n ? .18 : -.18) : 0);
      }
    }
  };
  setLoadout();
  const dispose = () => {
    if (disposed) return; disposed = true;
    geometry.forEach(g => g.dispose()); material.forEach(m => m.dispose()); jet.remove(group);
  };
  group.userData.slots = slots; group.userData.setLoadout = setLoadout; group.userData.dispose = dispose;
  return { group, slots, setLoadout, dispose };
}
