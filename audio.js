export class FlightAudio {
  constructor(){this.enabled=true;this.ctx=null;this.lastGun=0;this.lastLock=0;}
  init(){
    if(!this.enabled)return;
    if(!this.ctx){try{
      const A=window.AudioContext||window.webkitAudioContext;this.ctx=new A();const c=this.ctx;
      this.master=c.createGain();this.master.gain.value=.38;this.master.connect(c.destination);
      const length=c.sampleRate*2,buffer=c.createBuffer(1,length,c.sampleRate),d=buffer.getChannelData(0);let b=0;for(let i=0;i<length;i++){b=(b+.02*(Math.random()*2-1))/1.02;d[i]=b*4;}
      this.noiseBuffer=buffer;this.engine=c.createBufferSource();this.engine.buffer=buffer;this.engine.loop=true;this.engineFilter=c.createBiquadFilter();this.engineFilter.type='lowpass';this.engineFilter.frequency.value=300;this.engineGain=c.createGain();this.engineGain.gain.value=0;this.engine.connect(this.engineFilter).connect(this.engineGain).connect(this.master);this.engine.start();
      this.turbine=c.createOscillator();this.turbine.type='sine';this.turbine.frequency.value=75;this.turbineGain=c.createGain();this.turbineGain.gain.value=0;this.turbine.connect(this.turbineGain).connect(this.master);this.turbine.start();
    }catch(e){this.enabled=false;return;}}
    if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});
  }
  setEnabled(enabled){this.enabled=enabled;if(!enabled)this.silence();else this.init();}
  silence(){if(this.ctx){this.engineGain.gain.setTargetAtTime(0,this.ctx.currentTime,.1);this.turbineGain.gain.setTargetAtTime(0,this.ctx.currentTime,.1);}}
  update(sim){if(!this.ctx||!this.enabled)return;const c=this.ctx,t=c.currentTime,ship=sim.player.kind==='destroyer',lock=Math.max(sim.lockProgress||0,sim.antiShipLockProgress||0),seaLock=(sim.antiShipLockProgress||0)>0;if(sim.state!=='playing'){this.silence();return;}this.engineGain.gain.setTargetAtTime(.12+sim.player.throttle*.3+(sim.player.boost?.16:0),t,.15);this.engineFilter.frequency.setTargetAtTime(ship?95+sim.player.speed*6:180+sim.player.speed*1.8+(sim.player.boost?340:0),t,.2);this.turbine.frequency.setTargetAtTime(ship?30+sim.player.speed*.9:48+sim.player.speed*.32+(sim.player.boost?18:0),t,.15);this.turbineGain.gain.setTargetAtTime(.035,t,.2);if(lock>0 && t-this.lastLock>(lock>=1?.14:.55)){this.lastLock=t;this.beep(lock>=1?(seaLock?940:1100):(seaLock?620:760),.055,.045);}if(sim.incoming>0 && t-(this.lastWarning||0)>.7){this.lastWarning=t;this.beep(460,.2,.14);}}
  beep(f=700,d=.1,g=.1){if(!this.ctx||!this.enabled)return;const c=this.ctx,o=c.createOscillator(),v=c.createGain();o.frequency.value=f;v.gain.setValueAtTime(g,c.currentTime);v.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);o.connect(v).connect(this.master);o.start();o.stop(c.currentTime+d);}
  burst(duration=.12,gain=.2,frequency=1000){if(!this.ctx||!this.enabled)return;const c=this.ctx,s=c.createBufferSource(),f=c.createBiquadFilter(),v=c.createGain();s.buffer=this.noiseBuffer;f.type='lowpass';f.frequency.value=frequency;v.gain.setValueAtTime(gain,c.currentTime);v.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);s.connect(f).connect(v).connect(this.master);s.start();s.stop(c.currentTime+duration);}
  event(e){if(e.type==='fire'){if(this.ctx && this.ctx.currentTime-this.lastGun>.07){this.lastGun=this.ctx.currentTime;this.burst(e.kind==='ship'||e.kind==='destroyer'?.22:.085,.65,e.kind==='ship'||e.kind==='destroyer'?750:1600);}}else if(e.type==='missile')this.burst(e.weapon==='anti-ship'?.75:.55,.8,e.weapon==='anti-ship'?1400:2800);else if(e.type==='kill')this.burst(.9,1.1,450);else if(e.type==='damage')this.burst(.25,.55,800);else if(e.type==='hit')this.beep(1250,.05,.05);else if(e.type==='flare')this.burst(.3,.32,4200);else if(e.type==='wave')this.beep(700,.3,.11);}
}
