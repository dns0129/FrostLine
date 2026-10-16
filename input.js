export class FlightInput {
  constructor({onAction,onThrottle,onZoom=()=>{},onOrbit=()=>{},orbitEnabled=()=>false,invert=()=>false,vehicle=()=> 'aircraft'}) {
    this.keys=new Set();this.roll=0;this.pitch=0;this.fire=false;this.boost=false;this.mouseFire=false;this.joystickId=null;this.onAction=onAction;this.invert=invert;this.active=false;
    this.vehicle=vehicle;this.aimYaw=0;this.aimPitch=0;this.aimJoystickId=null;
    this.mouseFireId=null;this.mouseOrbit=null;this.cameraBlockedMouseId=null;this.cameraPointers=new Map();this.pinchDistance=null;this.pinchZoom=0;
    this.touch=matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints>0 && innerWidth<1100) || innerWidth<=900;
    document.body.classList.toggle('touch-ui',this.touch);
    window.addEventListener('resize',()=>{this.touch=matchMedia('(pointer: coarse)').matches || innerWidth<=900;document.body.classList.toggle('touch-ui',this.touch);});
    window.addEventListener('keydown',e=>{
      const editing=/INPUT|SELECT/.test(e.target.tagName);
      const throttleKey=e.target.id==='throttle'&&!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(e.code);
      if(!this.active || (editing&&!throttleKey))return;
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
      this.keys.add(e.code);
      if(!e.repeat){const a={KeyF:'missile',KeyB:'airWeapon',KeyR:'antiShip',KeyV:'recenter',KeyX:'flare',Tab:'target',KeyC:'camera',Escape:'pause'}[e.code];if(a&&(a!=='recenter'||this.vehicle()==='destroyer'))onAction(a);}
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>{this.reset();if(this.active)onAction('pause');});
    const canvas=document.getElementById('world');this.canvas=canvas;
    const canOrbit=()=>this.active&&this.vehicle()==='destroyer'&&orbitEnabled();
    const orbit=(dx,dy)=>{const width=Math.max(1,canvas.getBoundingClientRect().width||innerWidth);onOrbit(-dx/width*Math.PI*2,-dy/width*Math.PI);};
    const setPinch=()=>{const points=[...this.cameraPointers.values()];this.pinchDistance=points.length===2?Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)):null;this.pinchZoom=0;};
    canvas.addEventListener('wheel',e=>{if(this.active&&e.deltaY){e.preventDefault();onZoom(Math.sign(e.deltaY)*5);}},{passive:false});
    canvas.addEventListener('pointerdown',e=>{
      if(!this.active)return;
      if(e.pointerType==='mouse'){
        if(e.button===0){this.mouseFire=true;this.mouseFireId=e.pointerId;canvas.setPointerCapture(e.pointerId);}
        if(e.button===2&&canOrbit()){e.preventDefault();this.cameraBlockedMouseId=null;this.mouseOrbit={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}
      }else if(e.pointerType==='touch'&&canOrbit()&&this.cameraPointers.size<2){
        e.preventDefault();this.cameraPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});setPinch();canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove',e=>{
      if(e.pointerType==='mouse'){
        // Mouse chords share a pointer ID: releasing the right button must retain a held left button.
        if(this.active&&typeof e.buttons==='number'&&(this.mouseFireId===e.pointerId||this.mouseOrbit?.id===e.pointerId)){this.mouseFire=Boolean(e.buttons&1);if(this.mouseFire)this.mouseFireId=e.pointerId;}
        if(!canOrbit()){this.mouseOrbit=null;return;}
        if(typeof e.buttons==='number'){
          if(!(e.buttons&2)){this.mouseOrbit=null;if(this.cameraBlockedMouseId===e.pointerId)this.cameraBlockedMouseId=null;return;}
          if(this.cameraBlockedMouseId===e.pointerId)return;
          if(!this.mouseOrbit){if(this.mouseFireId===e.pointerId)this.mouseOrbit={id:e.pointerId,x:e.clientX,y:e.clientY};return;}
        }
        const previous=this.mouseOrbit;if(!previous||previous.id!==e.pointerId)return;
        e.preventDefault();orbit(e.clientX-previous.x,e.clientY-previous.y);previous.x=e.clientX;previous.y=e.clientY;
      }else if(this.cameraPointers.has(e.pointerId)){
        if(!canOrbit()){this.cameraPointers.clear();setPinch();return;}
        e.preventDefault();const previous=this.cameraPointers.get(e.pointerId);this.cameraPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(this.cameraPointers.size===1)orbit(e.clientX-previous.x,e.clientY-previous.y);
        else{
          const points=[...this.cameraPointers.values()],distance=Math.max(1,Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y));
          if(this.pinchDistance!==null){this.pinchZoom-=100*Math.log(distance/this.pinchDistance);const step=Math.trunc(this.pinchZoom);if(step){onZoom(step);this.pinchZoom-=step;}}
          this.pinchDistance=distance;
        }
      }
    });
    const releaseCamera=(e,releaseMouse=true)=>{if(releaseMouse&&this.mouseOrbit?.id===e.pointerId)this.mouseOrbit=null;if(releaseMouse&&this.cameraBlockedMouseId===e.pointerId)this.cameraBlockedMouseId=null;if(this.cameraPointers.delete(e.pointerId))setPinch();};
    const releasePointer=e=>{
      if(this.mouseFireId===e.pointerId&&(e.button===0||e.buttons===0)){this.mouseFire=false;this.mouseFireId=null;}
      releaseCamera(e,e.pointerType!=='mouse'||e.button===2||e.buttons===0);
    };
    const cancelPointer=e=>{if(this.mouseFireId===e.pointerId){this.mouseFire=false;this.mouseFireId=null;}releaseCamera(e);};
    canvas.addEventListener('pointerup',releasePointer);
    canvas.addEventListener('pointercancel',cancelPointer);
    // Chromium can lose capture when one mouse button is released while the other stays held.
    canvas.addEventListener('lostpointercapture',e=>{
      if(e.pointerType==='mouse'&&this.active&&typeof e.buttons==='number'&&(e.buttons&3)){
        if(this.mouseFireId===e.pointerId){this.mouseFire=Boolean(e.buttons&1);if(!this.mouseFire)this.mouseFireId=null;}
        if(!(e.buttons&2)||!canOrbit())releaseCamera(e);
        if(this.mouseFireId===e.pointerId||this.mouseOrbit?.id===e.pointerId){try{canvas.setPointerCapture(e.pointerId);}catch{/* Window release handlers also stop a hold if capture cannot be restored. */}}
      }else cancelPointer(e);
    });
    window.addEventListener('pointerup',releasePointer);
    window.addEventListener('pointercancel',cancelPointer);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    const joy=document.getElementById('joystick'),stick=document.getElementById('stick');
    const move=e=>{
      const r=joy.getBoundingClientRect(),radius=r.width*.36;
      let x=(e.clientX-r.left-r.width/2)/radius,y=(e.clientY-r.top-r.height/2)/radius;
      const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}
      this.roll=-x;this.pitch=this.vehicle()==='destroyer'?0:y*(this.invert()?-1:1);
      stick.style.transform=`translate(${x*radius}px,${y*radius}px)`;
    };
    joy.addEventListener('pointerdown',e=>{if(!this.active || this.joystickId!==null)return;e.preventDefault();this.joystickId=e.pointerId;joy.setPointerCapture(e.pointerId);move(e);});
    joy.addEventListener('pointermove',e=>{if(e.pointerId===this.joystickId){e.preventDefault();move(e);}});
    const release=e=>{if(e.pointerId===this.joystickId){this.joystickId=null;this.roll=this.pitch=0;stick.style.transform='';}};
    ['pointerup','pointercancel','lostpointercapture'].forEach(n=>joy.addEventListener(n,release));
    const aimJoy=document.getElementById('aimJoystick'),aimStick=document.getElementById('aimStick');
    if(aimJoy&&aimStick){
      const aimMove=e=>{const r=aimJoy.getBoundingClientRect(),radius=r.width*.36;let x=(e.clientX-r.left-r.width/2)/radius,y=(e.clientY-r.top-r.height/2)/radius;const len=Math.hypot(x,y);if(len>1){x/=len;y/=len;}this.aimYaw=-x;this.aimPitch=-y;aimStick.style.transform=`translate(${x*radius}px,${y*radius}px)`;};
      aimJoy.addEventListener('pointerdown',e=>{if(!this.active||this.vehicle()!=='destroyer'||this.aimJoystickId!==null)return;e.preventDefault();this.aimJoystickId=e.pointerId;aimJoy.setPointerCapture(e.pointerId);aimMove(e);});
      aimJoy.addEventListener('pointermove',e=>{if(e.pointerId===this.aimJoystickId){e.preventDefault();aimMove(e);}});
      for(const n of ['pointerup','pointercancel','lostpointercapture'])aimJoy.addEventListener(n,e=>{if(e.pointerId===this.aimJoystickId){this.aimJoystickId=null;this.aimYaw=this.aimPitch=0;aimStick.style.transform='';}});
    }
    const hold=(id,prop)=>{const b=document.getElementById(id);b.addEventListener('pointerdown',e=>{if(!this.active)return;e.preventDefault();b.setPointerCapture(e.pointerId);this[prop]=true;b.classList.add('held');});for(const n of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(n,()=>{this[prop]=false;b.classList.remove('held');});};
    hold('touchFire','fire');hold('touchBoost','boost');
    for(const [id,action] of [['touchMissile','missile'],['touchFlare','flare'],['touchCamera','camera']])document.getElementById(id).addEventListener('click',()=>{if(this.active)onAction(action);});
    document.getElementById('touchTarget')?.addEventListener('click',()=>{if(this.active)onAction('target');});
    document.getElementById('touchAntiShip')?.addEventListener('click',()=>{if(this.active)onAction('antiShip');});
    document.getElementById('touchRecenter')?.addEventListener('click',()=>{if(this.active&&this.vehicle()==='destroyer')onAction('recenter');});
    document.getElementById('throttle').addEventListener('input',e=>onThrottle(Number(e.target.value)/100));
  }
  read(){const k=this.keys,limit=v=>Math.max(-1,Math.min(1,v));const controls={roll:limit(this.roll+(k.has('KeyA')||k.has('ArrowLeft')?1:0)-(k.has('KeyD')||k.has('ArrowRight')?1:0)),pitch:limit(this.pitch+(k.has('KeyS')||k.has('ArrowDown')?1:0)-(k.has('KeyW')||k.has('ArrowUp')?1:0)),yaw:(k.has('KeyQ')?1:0)-(k.has('KeyE')?1:0),throttleDelta:(k.has('Equal')||k.has('NumpadAdd')?.3:0)-(k.has('Minus')||k.has('NumpadSubtract')?.3:0),fire:this.fire||this.mouseFire||k.has('Space'),boost:this.boost||k.has('ShiftLeft')||k.has('ShiftRight'),airbrake:k.has('ControlLeft')||k.has('ControlRight')};if(this.vehicle()==='destroyer'){controls.aimYaw=limit(this.aimYaw+(k.has('KeyJ')?1:0)-(k.has('KeyL')?1:0));controls.pitch=limit(this.aimPitch+(k.has('KeyW')||k.has('ArrowUp')?1:0)-(k.has('KeyS')||k.has('ArrowDown')?1:0));}return controls;}
  cancelOrbit(){const ids=[...this.cameraPointers.keys()];if(this.mouseOrbit){this.cameraBlockedMouseId=this.mouseOrbit.id;if(!this.mouseFire||this.mouseFireId!==this.mouseOrbit.id)ids.push(this.mouseOrbit.id);}this.mouseOrbit=null;this.cameraPointers.clear();this.pinchDistance=null;this.pinchZoom=0;for(const id of ids){try{if(this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture?.(id);}catch{/* The browser may already have released a canceled pointer. */}}}
  reset(){this.keys.clear();this.roll=this.pitch=this.aimYaw=this.aimPitch=0;this.fire=this.boost=this.mouseFire=false;this.joystickId=this.aimJoystickId=this.mouseFireId=null;this.cancelOrbit();document.getElementById('stick').style.transform='';const a=document.getElementById('aimStick');if(a)a.style.transform='';document.querySelectorAll('.held').forEach(e=>e.classList.remove('held'));}
}
