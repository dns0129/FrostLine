import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightInput } from '../input.js';

class Classes {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force = !this.values.has(name)) {
    if (force) this.add(name); else this.remove(name);
    return force;
  }
}

class Element extends EventTarget {
  constructor(id, tagName = 'DIV') {
    super();
    this.id = id;
    this.tagName = tagName;
    this.classList = new Classes();
    this.style = {};
    this.value = '';
    this.captures = new Set();
  }
  getBoundingClientRect() { return this.bounds || { left: 20, top: 30, width: 200, height: 200 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { if(this.captures.delete(id))dispatch(this,'lostpointercapture',{pointerId:id}); }
}

function dispatch(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

function fixture(t, { width = 1280, coarse = false, touchPoints = 0, invert = () => false, vehicle = () => 'aircraft', orbitEnabled = () => false } = {}) {
  const ids = ['world', 'joystick', 'stick', 'touchFire', 'touchBoost', 'touchMissile', 'touchFlare', 'touchCamera', 'throttle', 'aimJoystick', 'aimStick', 'touchTarget', 'touchAntiShip', 'touchRecenter'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const win = new Element('window', 'BODY');
  const body = new Element('body', 'BODY');
  const replacements = {
    window: win,
    document: { body, getElementById: id => elements[id], querySelectorAll: () => Object.values(elements).filter(e => e.classList.contains('held')) },
    navigator: { maxTouchPoints: touchPoints },
    innerWidth: width,
    matchMedia: () => ({ matches: coarse }),
  };
  const descriptors = new Map();
  for (const [key, value] of Object.entries(replacements)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const actions = [], throttle = [], orbits = [], zoom = [];
  const input = new FlightInput({ onAction: action => actions.push(action), onThrottle: value => throttle.push(value), onOrbit: (yaw,pitch) => orbits.push([yaw,pitch]), onZoom: step => zoom.push(step), invert, vehicle, orbitEnabled });
  input.active = true;
  const pointer = (id, type, pointerId, extras = {}) => dispatch(elements[id], type, { pointerId, pointerType: 'touch', clientX: 84, clientY: 166, ...extras });
  const key = (type, code, extras = {}) => dispatch(win, type, { code, repeat: false, ...extras });
  return { input, elements, win, body, actions, throttle, orbits, zoom, pointer, key };
}

const neutral = { roll: 0, pitch: 0, yaw: 0, throttleDelta: 0, fire: false, boost: false, airbrake: false };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, received ${actual}`);

test('two fingers can steer and hold fire independently, with fire release preserving the stick', t => {
  const { input, pointer } = fixture(t);
  pointer('joystick', 'pointerdown', 1);
  near(input.read().roll, 0.5);
  near(input.read().pitch, 0.5);
  assert.equal(input.read().fire, false);

  pointer('touchFire', 'pointerdown', 2);
  assert.equal(input.read().fire, true);
  near(input.read().roll, 0.5);
  near(input.read().pitch, 0.5);

  pointer('joystick', 'pointermove', 1, { clientX: 66, clientY: 148 });
  near(input.read().roll, 0.75);
  near(input.read().pitch, 0.25);
  assert.equal(input.read().fire, true, 'moving the original finger preserves continuous fire');

  pointer('touchFire', 'pointerup', 2);
  assert.equal(input.read().fire, false);
  near(input.read().roll, 0.75);
  near(input.read().pitch, 0.25);
  pointer('joystick', 'pointerup', 1);
  assert.deepEqual(input.read(), neutral);
});

for (const cancelEvent of ['pointercancel', 'lostpointercapture']) {
  test(`${cancelEvent} clears only the released control and permits a fresh gesture`, t => {
    const { input, pointer } = fixture(t);
    pointer('joystick', 'pointerdown', 11);
    pointer('touchFire', 'pointerdown', 12);
    pointer('touchBoost', 'pointerdown', 13);
    pointer('joystick', cancelEvent, 99);
    near(input.read().roll, 0.5);
    pointer('joystick', cancelEvent, 11);
    assert.equal(input.read().roll, 0);
    assert.equal(input.read().pitch, 0);
    assert.equal(input.read().fire, true);
    assert.equal(input.read().boost, true);
    pointer('touchFire', cancelEvent, 12);
    assert.equal(input.read().fire, false);
    assert.equal(input.read().boost, true);
    pointer('touchBoost', cancelEvent, 13);
    assert.deepEqual(input.read(), neutral);

    pointer('joystick', 'pointerdown', 21, { clientX: 156, clientY: 94 });
    near(input.read().roll, -0.5);
    near(input.read().pitch, -0.5);
    pointer('joystick', 'pointerup', 21);
    assert.deepEqual(input.read(), neutral);
  });
}

test('blur clears keyboard, mouse and touch holds and requests a single pause', t => {
  const { input, pointer, key, win, actions } = fixture(t);
  for (const code of ['KeyA', 'KeyS', 'KeyQ', 'Equal', 'Space', 'ShiftLeft', 'ControlLeft']) key('keydown', code);
  pointer('joystick', 'pointerdown', 1);
  pointer('touchFire', 'pointerdown', 2);
  pointer('touchBoost', 'pointerdown', 3);
  pointer('world', 'pointerdown', 4, { pointerType: 'mouse', button: 0 });
  assert.equal(input.read().fire, true);
  assert.equal(input.read().boost, true);
  assert.equal(input.read().airbrake, true);
  assert.equal(input.read().roll, 1);
  dispatch(win, 'blur');
  assert.deepEqual(input.read(), neutral);
  assert.deepEqual(actions, ['pause']);

  // Late capture-loss / keyup events after focus loss must not resurrect a held input.
  pointer('joystick', 'lostpointercapture', 1);
  pointer('touchFire', 'pointerup', 2);
  key('keyup', 'Space');
  assert.deepEqual(input.read(), neutral);
  pointer('joystick', 'pointerdown', 5);
  near(input.read().roll, 0.5);
  pointer('joystick', 'pointerup', 5);
  assert.deepEqual(input.read(), neutral);
});

test('keyup releases every keyboard flight axis and continuous weapon control', t => {
  const { input, key } = fixture(t);
  const held = ['ArrowLeft', 'ArrowUp', 'KeyE', 'Minus', 'Space', 'ShiftRight', 'ControlRight'];
  for (const code of held) {
    const event = key('keydown', code);
    if (['ArrowLeft', 'ArrowUp', 'Space', 'ControlRight'].includes(code)) assert.equal(event.defaultPrevented, true);
  }
  assert.deepEqual(input.read(), { roll: 1, pitch: -1, yaw: -1, throttleDelta: -0.3, fire: true, boost: true, airbrake: true });
  key('keyup', 'Space');
  assert.equal(input.read().fire, false);
  assert.equal(input.read().roll, 1, 'releasing a weapon does not release the steering key');
  for (const code of held.filter(code => code !== 'Space')) key('keyup', code);
  assert.deepEqual(input.read(), neutral);
});

test('discrete actions fire once per key press and touch actions reach their public callback', t => {
  const { input, key, elements, actions, throttle } = fixture(t);
  for (const code of ['KeyF', 'KeyX', 'Tab', 'KeyC', 'Escape']) {
    key('keydown', code);
    key('keydown', code, { repeat: true });
    key('keyup', code);
  }
  assert.deepEqual(actions, ['missile', 'flare', 'target', 'camera', 'pause']);
  for (const id of ['touchMissile', 'touchFlare', 'touchCamera']) dispatch(elements[id], 'click');
  assert.deepEqual(actions.slice(5), ['missile', 'flare', 'camera']);
  elements.throttle.value = '64';
  dispatch(elements.throttle, 'input');
  assert.deepEqual(throttle, [0.64]);
  input.active = false;
  key('keydown', 'KeyF');
  dispatch(elements.touchMissile, 'click');
  assert.equal(actions.length, 8);
});

test('mouse cancellation stops fire while inverted touch input reverses only pitch', t => {
  const { input, pointer } = fixture(t, { invert: () => true });
  pointer('joystick', 'pointerdown', 1);
  near(input.read().roll, 0.5);
  near(input.read().pitch, -0.5);
  pointer('world', 'pointerdown', 2, { pointerType: 'mouse', button: 0 });
  assert.equal(input.read().fire, true);
  pointer('world', 'pointercancel', 2, { pointerType: 'mouse' });
  assert.equal(input.read().fire, false);
  near(input.read().roll, 0.5);
  near(input.read().pitch, -0.5);
});

test('small-screen resize exposes touch controls and widening restores the desktop layout', t => {
  const { body, win } = fixture(t, { width: 1280 });
  assert.equal(body.classList.contains('touch-ui'), false);
  globalThis.innerWidth = 820;
  dispatch(win, 'resize');
  assert.equal(body.classList.contains('touch-ui'), true);
  globalThis.innerWidth = 1280;
  dispatch(win, 'resize');
  assert.equal(body.classList.contains('touch-ui'), false);
});


test('destroyer keyboard separates rudder, horizontal turret and elevation', t => {
  const {input,key}=fixture(t,{vehicle:()=> 'destroyer'});
  key('keydown','KeyA');key('keydown','KeyJ');key('keydown','KeyW');
  assert.equal(input.read().roll,1);assert.equal(input.read().aimYaw,1);assert.equal(input.read().pitch,1);
  key('keyup','KeyJ');assert.equal(input.read().aimYaw,0);assert.equal(input.read().roll,1);
  key('keyup','KeyA');key('keyup','KeyW');assert.equal(input.read().pitch,0);
});

test('destroyer three-finger steering, aiming and fire cancel independently', t => {
  const {input,pointer,win,elements,actions}=fixture(t,{vehicle:()=> 'destroyer'});
  pointer('joystick','pointerdown',1);pointer('aimJoystick','pointerdown',2);pointer('touchFire','pointerdown',3);
  near(input.read().roll,.5);assert.equal(input.read().pitch,-.5);near(input.read().aimYaw,.5);assert.equal(input.read().fire,true);
  pointer('aimJoystick','pointercancel',2);assert.equal(input.read().aimYaw,0);assert.equal(input.read().pitch,0);near(input.read().roll,.5);assert.equal(input.read().fire,true);
  pointer('aimJoystick','pointerdown',4);dispatch(win,'blur');
  assert.equal(input.read().aimYaw,0);assert.equal(input.read().pitch,0);assert.equal(input.read().roll,0);assert.equal(input.read().fire,false);
  assert.deepEqual(actions,['pause']);dispatch(elements.touchTarget,'click');assert.equal(actions.at(-1),'target');
});

test('keyboard helm and weapons still work after focusing the throttle slider', t => {
  const {input,key,elements}=fixture(t,{vehicle:()=> 'destroyer'});
  elements.throttle.tagName='INPUT';
  key('keydown','KeyA',{target:elements.throttle});key('keydown','KeyF',{target:elements.throttle});
  assert.equal(input.read().roll,1);
  const arrow=key('keydown','ArrowRight',{target:elements.throttle});
  assert.equal(arrow.defaultPrevented,false,'focused slider arrow keys retain their accessible range action');
});


test('R and the anti-ship touch button are discrete actions for both vehicle types independent of F', t => {
  let vehicle='destroyer';
  const {input,key,elements,actions}=fixture(t,{vehicle:()=>vehicle});
  key('keydown','KeyR');key('keydown','KeyR',{repeat:true});key('keyup','KeyR');key('keydown','KeyF');key('keyup','KeyF');
  dispatch(elements.touchAntiShip,'click');
  assert.deepEqual(actions,['antiShip','missile','antiShip']);
  vehicle='aircraft';key('keydown','KeyR');dispatch(elements.touchAntiShip,'click');assert.deepEqual(actions.slice(3),['antiShip','antiShip']);
  vehicle='destroyer';input.active=false;key('keydown','KeyR');dispatch(elements.touchAntiShip,'click');assert.equal(actions.length,5);
});

test('right mouse drag orbits in viewport units without firing or changing the rudder', t => {
  const {input,pointer,key,elements,orbits}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  key('keydown','KeyA');
  pointer('world','pointerdown',1,{pointerType:'mouse',button:2,clientX:50,clientY:60});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:2,clientX:70,clientY:70});
  near(orbits[0][0],-Math.PI*.2);near(orbits[0][1],-Math.PI*.05);
  assert.equal(input.read().roll,1);assert.equal(input.read().fire,false);
  elements.world.bounds={left:0,top:0,width:1000,height:600};
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:2,clientX:170,clientY:120});
  near(orbits[1][0],orbits[0][0]);near(orbits[1][1],orbits[0][1]);
  pointer('world','pointerup',1,{pointerType:'mouse',button:2,buttons:0});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:2,clientX:200,clientY:160});
  assert.equal(orbits.length,2,'an unregistered right-button move does not begin another orbit');
});

test('right-button release preserves a held left mouse button and the right-first mouse chord can fire', t => {
  const {input,pointer,orbits}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  pointer('world','pointerdown',1,{pointerType:'mouse',button:0});
  pointer('world','pointerdown',1,{pointerType:'mouse',button:2});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:3,clientX:104});
  assert.equal(orbits.length,1);assert.equal(input.read().fire,true);
  pointer('world','pointerup',1,{pointerType:'mouse',button:2,buttons:1});
  assert.equal(input.read().fire,true);assert.equal(input.mouseOrbit,null);
  pointer('world','pointerup',1,{pointerType:'mouse',button:0,buttons:0});
  assert.equal(input.read().fire,false);
  pointer('world','pointerdown',2,{pointerType:'mouse',button:2});
  pointer('world','pointermove',2,{pointerType:'mouse',buttons:3,clientX:104});
  assert.equal(input.read().fire,true,'pressing left after right reaches the continuous fire channel');
  pointer('world','pointermove',2,{pointerType:'mouse',buttons:2,clientX:124});
  assert.equal(input.read().fire,false,'releasing only left retains right orbit');
  assert.equal(input.mouseOrbit.id,2);
});

test('a right-button chord begun during left capture starts from its current position', t => {
  const {input,pointer,orbits}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  pointer('world','pointerdown',1,{pointerType:'mouse',button:0});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:3,clientX:120,clientY:140});
  assert.equal(orbits.length,0,'the first right-held move establishes an anchor');
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:3,clientX:140,clientY:150});
  near(orbits[0][0],-Math.PI*.2);assert.equal(input.read().fire,true);
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:1,clientX:160,clientY:160});
  assert.equal(input.mouseOrbit,null);assert.equal(input.read().fire,true);
});

test('native capture loss after either mouse-button release preserves the other held control', t => {
  const {input,pointer,win,orbits,elements}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  pointer('world','pointerdown',1,{pointerType:'mouse',button:0,buttons:1});
  pointer('world','pointermove',1,{pointerType:'mouse',button:2,buttons:3,clientX:104});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:3,clientX:124});
  pointer('world','pointermove',1,{pointerType:'mouse',button:2,buttons:1,clientX:124});
  pointer('world','lostpointercapture',1,{pointerType:'mouse',button:-1,buttons:1});
  pointer('world','pointermove',1,{pointerType:'mouse',buttons:1,clientX:144});
  assert.equal(input.read().fire,true);assert.equal(input.mouseFireId,1);assert.equal(input.mouseOrbit,null);assert.equal(elements.world.hasPointerCapture(1),true);
  dispatch(win,'pointerup',{pointerId:1,pointerType:'mouse',button:0,buttons:0});
  assert.equal(input.read().fire,false,'release outside the canvas also stops the remaining left hold');
  pointer('world','pointerdown',2,{pointerType:'mouse',button:2,buttons:2});
  pointer('world','pointermove',2,{pointerType:'mouse',button:0,buttons:3,clientX:104});
  pointer('world','pointermove',2,{pointerType:'mouse',button:0,buttons:2,clientX:124});
  pointer('world','lostpointercapture',2,{pointerType:'mouse',button:-1,buttons:2});
  const before=orbits.length;pointer('world','pointermove',2,{pointerType:'mouse',buttons:2,clientX:144});
  assert.equal(input.read().fire,false);assert.equal(input.mouseOrbit.id,2);assert.equal(orbits.length,before+1);
  dispatch(win,'pointerup',{pointerId:2,pointerType:'mouse',button:2,buttons:0});assert.equal(input.mouseOrbit,null);
  pointer('world','pointerdown',3,{pointerType:'mouse',button:2,buttons:2});input.cancelOrbit();
  pointer('world','lostpointercapture',3,{pointerType:'mouse',button:-1,buttons:2});
  pointer('world','pointermove',3,{pointerType:'mouse',buttons:2,clientX:104});assert.equal(input.mouseOrbit,null,'deliberate camera cancellation is not resurrected by held buttons');
});

test('canvas orbit gestures require an active destroyer exterior camera', t => {
  let vehicle='aircraft',exterior=true;
  const {input,pointer,orbits,zoom}=fixture(t,{vehicle:()=>vehicle,orbitEnabled:()=>exterior});
  const drag=(id,type='mouse')=>{pointer('world','pointerdown',id,{pointerType:type,button:2});pointer('world','pointermove',id,{pointerType:type,buttons:2,clientX:104});};
  drag(1);drag(2,'touch');assert.equal(orbits.length,0);assert.equal(input.cameraPointers.size,0);
  vehicle='destroyer';exterior=false;drag(3);drag(4,'touch');assert.equal(orbits.length,0);
  exterior=true;input.active=false;drag(5);drag(6,'touch');assert.equal(orbits.length,0);
  input.active=true;drag(7,'touch');assert.equal(orbits.length,1);
  exterior=false;pointer('world','pointermove',7,{clientX:124});assert.equal(input.cameraPointers.size,0);assert.equal(orbits.length,1);
  dispatch(input.canvas,'wheel',{deltaY:-20});assert.deepEqual(zoom,[-5],'existing zoom callbacks remain available to the app camera guard');
});

for(const cancelEvent of ['pointerup','pointercancel','lostpointercapture']){
  test(`${cancelEvent} on a camera finger preserves both joysticks and held fire`, t => {
    const {input,pointer,orbits}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
    pointer('joystick','pointerdown',1);pointer('aimJoystick','pointerdown',2);pointer('touchFire','pointerdown',3);
    pointer('world','pointerdown',4,{clientX:300,clientY:200});
    pointer('world','pointermove',4,{clientX:320,clientY:210});assert.equal(orbits.length,1);
    pointer('world',cancelEvent,99);assert.equal(input.cameraPointers.size,1);
    pointer('world',cancelEvent,4);assert.equal(input.cameraPointers.size,0);
    near(input.read().roll,.5);near(input.read().aimYaw,.5);near(input.read().pitch,-.5);assert.equal(input.read().fire,true);
    pointer('world','pointermove',4,{clientX:340,clientY:220});assert.equal(orbits.length,1);
  });
}

test('two canvas fingers pinch independently of control fingers and the third canvas finger is ignored', t => {
  const {input,pointer,orbits,zoom}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  pointer('joystick','pointerdown',1);pointer('touchFire','pointerdown',2);
  pointer('world','pointerdown',3,{clientX:100,clientY:200});pointer('world','pointerdown',4,{clientX:200,clientY:200});
  pointer('world','pointerdown',5,{clientX:300,clientY:300});assert.equal(input.cameraPointers.size,2);
  pointer('world','pointermove',3,{clientX:80,clientY:200});pointer('world','pointermove',4,{clientX:220,clientY:200});
  assert.equal(orbits.length,0);assert.ok(zoom.every(step=>Number.isInteger(step)&&step<0));
  assert.ok(Math.abs(zoom.reduce((a,b)=>a+b,0)+100*Math.log(1.4))<1);
  const previous=zoom.length;pointer('world','pointermove',5,{clientX:340,clientY:340});assert.equal(zoom.length,previous);
  pointer('world','pointerup',3);pointer('world','pointermove',4,{clientX:240,clientY:210});
  assert.equal(orbits.length,1);near(orbits[0][0],-Math.PI*.2);near(orbits[0][1],-Math.PI*.05);
  assert.equal(input.read().fire,true);near(input.read().roll,.5);
  pointer('world','pointerdown',6,{clientX:300,clientY:210});pointer('world','pointermove',6,{clientX:280,clientY:210});
  assert.ok(zoom.at(-1)>0,'closing two canvas fingers pushes the camera farther away');
});

test('cancelOrbit releases camera captures while preserving keyboard, joysticks and fire', t => {
  const {input,pointer,key,orbits,elements}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  key('keydown','KeyA');pointer('joystick','pointerdown',1);pointer('aimJoystick','pointerdown',2);pointer('touchFire','pointerdown',3);
  pointer('world','pointerdown',4);pointer('world','pointerdown',5);input.cancelOrbit();
  assert.equal(input.cameraPointers.size,0);assert.equal(elements.world.hasPointerCapture(4),false);assert.equal(elements.world.hasPointerCapture(5),false);
  assert.equal(input.read().roll,1);assert.equal(input.read().fire,true);near(input.read().aimYaw,.5);
  pointer('world','pointerdown',6,{pointerType:'mouse',button:0});pointer('world','pointerdown',6,{pointerType:'mouse',button:2});input.cancelOrbit();
  assert.equal(input.read().fire,true);assert.equal(input.mouseFire,true);assert.equal(elements.world.hasPointerCapture(6),true,'left fire retains its shared mouse capture');
  pointer('world','pointermove',6,{pointerType:'mouse',buttons:3,clientX:150});pointer('world','pointermove',6,{pointerType:'mouse',buttons:3,clientX:170});
  assert.equal(orbits.length,0,'a canceled right drag remains canceled until right release');
  pointer('world','pointermove',6,{pointerType:'mouse',buttons:1,clientX:170});pointer('world','pointermove',6,{pointerType:'mouse',buttons:3,clientX:180});pointer('world','pointermove',6,{pointerType:'mouse',buttons:3,clientX:200});
  assert.equal(orbits.length,1,'a fresh right-button press can orbit while left remains held');
});

test('blur and reset clear camera gestures and ignore late captured moves', t => {
  const {input,pointer,win,orbits,actions}=fixture(t,{vehicle:()=> 'destroyer',orbitEnabled:()=>true});
  pointer('world','pointerdown',1);pointer('world','pointerdown',2);dispatch(win,'blur');
  assert.equal(input.cameraPointers.size,0);assert.equal(input.pinchDistance,null);assert.deepEqual(actions,['pause']);
  pointer('world','pointermove',1,{clientX:104});pointer('world','pointermove',2,{clientX:64});assert.equal(orbits.length,0);
  pointer('world','pointerdown',3,{pointerType:'mouse',button:2});input.reset();
  pointer('world','pointermove',3,{pointerType:'mouse',buttons:2,clientX:104});pointer('world','pointermove',3,{pointerType:'mouse',buttons:2,clientX:124});
  assert.equal(input.mouseOrbit,null);assert.equal(orbits.length,0);assert.equal(input.mouseFire,false);
  pointer('world','pointerdown',4,{pointerType:'mouse',button:2});pointer('world','pointermove',4,{pointerType:'mouse',buttons:2,clientX:104});assert.equal(orbits.length,1);
});

test('V and the recenter touch button are discrete destroyer actions independent of aircraft weapons', t => {
  let vehicle='destroyer';const {input,key,elements,actions}=fixture(t,{vehicle:()=>vehicle});
  key('keydown','KeyV');key('keydown','KeyV',{repeat:true});key('keyup','KeyV');dispatch(elements.touchRecenter,'click');
  assert.deepEqual(actions,['recenter','recenter']);vehicle='aircraft';key('keydown','KeyV');dispatch(elements.touchRecenter,'click');assert.equal(actions.length,2);
  vehicle='destroyer';input.active=false;key('keydown','KeyV');dispatch(elements.touchRecenter,'click');assert.equal(actions.length,2);
});
