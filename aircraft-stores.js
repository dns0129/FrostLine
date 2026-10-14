import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { aircraftById, STORES, presetLoadout } from './aircraft-systems.js';

// Fixed-size reusable slots avoid allocations during launch, replenishment or
// menu changes. Every instance owns and disposes only its stores resources.
export function attachAircraftStores(jet, aircraftId = 'fa18c') {
  const group = new THREE.Group(); group.name = 'Custom external stores'; jet.add(group);
  const bodies = {}, geometry = new Set(), material = new Set();
  for (const id of Object.keys(STORES)) {
    const tank = id === 'tank', large = id === 'harpoon', length = tank ? 4.1 : large ? 3.8 : id === 'aim7' ? 3.66 : id === 'aim120' ? 3.65 : 2.87;
    const radius = tank ? .4 : large ? .17 : id === 'aim9' ? .063 : .105;
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
    const paint = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7});
    geometry.add(merged); material.add(paint);
    bodies[id] = { geometry:merged, paint };
  }
  const slots = aircraftById(aircraftId).stations.map(station => {
    const root = new THREE.Group(); root.position.set(...station.position); group.add(root);
    const types = {};
    for (const id of Object.keys(station.allowed)) {
      const asset = bodies[id], instances = [];
      for (let n = 0; n < station.allowed[id]; n++) {
        const store = new THREE.Group(); store.userData.store = id; store.userData.station = station.id;
        const mesh = new THREE.Mesh(asset.geometry,asset.paint); mesh.castShadow = true; store.add(mesh);
        root.add(store); instances.push(store);
      }
      types[id] = instances;
    }
    return { station: station.id, root, types };
  });
  let key = '';
  const setLoadout = (value = presetLoadout()) => {
    const nextKey = value.map(s => `${s.station}:${s.store}:${s.count}`).join('|');
    if (nextKey === key) return; key = nextKey;
    for (const slot of slots) {
      const item = value.find(s => s.station === slot.station);
      for (const [id, instances] of Object.entries(slot.types)) instances.forEach((mesh, n) => {
        mesh.visible = item?.store === id && n < item.count;
        mesh.position.x = item?.count === 2 ? (n ? .18 : -.18) : 0;
      });
    }
  };
  setLoadout();
  let disposed = false;
  return { group, setLoadout, dispose() { if (disposed) return; disposed = true; geometry.forEach(g => g.dispose()); material.forEach(m => m.dispose()); jet.remove(group); } };
}
