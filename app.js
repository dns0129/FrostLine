import { SortieFlow } from './sortie-flow.js';
import {SHIPS,isShipVehicle,normalizeReadiness} from './ship-systems.js';
import {NavalWorkshop} from './naval-workshop.js';
import * as THREE from './vendor/three.module.js';
import { Simulation, DESTROYER, shipGunOrigin, shipCameraAimPoint } from './simulation.js';
import { FlightPresentation } from './flight-presentation.js';
import { WorldRenderer } from './renderer.js';
import { FlightInput } from './input.js';
import { FlightAudio } from './audio.js';
import { BaseScene } from './base-scene.js';
import { OWNED_VEHICLES, vehicleById, aircraftIdFor } from './vehicle-catalog.js';
import { STORES, normalizeWorkshop, sortieReward } from './aircraft-systems.js';
import { HangarWorkshop } from './hangar-workshop.js';
import { CAMPAIGN_LEVELS, campaignLevel, normalizeCampaignProgress, campaignUnlocked, recordCampaignWin, recommendedCampaignLevel, campaignObjectiveText } from './campaign.js';
import { DEFAULT_MAP_ID, getMap } from './maps.js';
import { normalizeQuality } from './quality.js';

const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const safeRead=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,v)=>{try{localStorage.setItem(key,JSON.stringify(v));return true;}catch{return false;}};
let workshopProfile=normalizeWorkshop(safeRead('frostline-workshop-v1',null));
const settings={difficulty:'normal',quality:'auto',sound:true,invert:false,cameraZoom:100,vehicle:'aircraft',map:DEFAULT_MAP_ID,...safeRead('frostline-settings',{})};
settings.cameraZoom=clamp(Number(settings.cameraZoom)||100,78,140);
settings.map=getMap(settings.map).id;
settings.quality=normalizeQuality(settings.quality);
const VEHICLES=OWNED_VEHICLES.map(v=>v.id);
let navalReadiness=normalizeReadiness(safeRead('frostline-naval-v1',null));
let selectedVehicle=VEHICLES.includes(settings.vehicle)?settings.vehicle:'aircraft';
// The hangar tab returns to whichever jet was last chosen.
let hangarVehicle=!isShipVehicle(selectedVehicle)?selectedVehicle:settings.hangarVehicle==='j16'?'j16':'aircraft';
let cannonAim=null;
let navalVehicle=isShipVehicle(selectedVehicle)?selectedVehicle:isShipVehicle(settings.navalVehicle)?settings.navalVehicle:'destroyer';
const isShip=()=>isShipVehicle(selectedVehicle);
const isNaval=(mode=selectedMode)=>mode==='naval'||mode==='naval-training';
const isTraining=(mode=selectedMode)=>mode==='training'||mode==='naval-training';
const aircraftId=()=>aircraftIdFor(selectedVehicle)||'fa18c';
const hasAntiShip=()=>workshopProfile.loadouts[aircraftId()].some(s=>STORES[s.store]?.kind==='anti-ship'&&s.count>0);

// Hornet records keep their original keys; other airframes and the destroyer are separate.
const recordKey=()=>selectedMode==='campaign'?`campaign-${selectedCampaignId}`:isShip()?`${selectedVehicle}-${selectedMode}`:aircraftId()==='fa18c'?selectedMode:`${aircraftId()}-${selectedMode}`;
let campaignProgress=normalizeCampaignProgress(safeRead('frostline-campaign-v1',null));
let selectedCampaignId=recommendedCampaignLevel(campaignProgress).id,resumeBriefing=false;
let records=safeRead('frostline-records',{}),selectedMode='intercept',cockpit=false,returnPanel=null,toastUntil=0,frameTime=performance.now(),accumulator=0,lastUi=0,endingShown=false;
const debugMode=new URLSearchParams(location.search).has('debug');
let diagnostics=null,metricsFrames=0,metricsStart=performance.now(),metricsDeltas=[];
if(debugMode){diagnostics=document.createElement('output');diagnostics.id='renderDiagnostics';diagnostics.style.cssText='position:fixed;z-index:50;left:12px;bottom:3px;font:10px monospace;color:#cff5df;background:#142c35cc;padding:4px 7px;pointer-events:none;max-width:calc(100vw - 24px)' ;document.body.append(diagnostics);}
const sim=new Simulation();const presentation=new FlightPresentation();presentation.reset(sim);const sound=new FlightAudio();sound.enabled=settings.sound;
let world;
try{world=new WorldRenderer($('world'),{quality:settings.quality,mapId:settings.map});}catch(e){$('bootText').textContent='无法启动 3D 画面：请开启浏览器硬件加速后重试。';throw e;}
try{await world.modelReady;}catch(e){$('bootText').textContent='飞机或舰船模型加载失败，请刷新页面重试。';world.dispose();throw e;}
const baseScene = new BaseScene(world, $('baseViewport'));
const navalWorkshop=new NavalWorkshop(navalReadiness,profile=>{navalReadiness=normalizeReadiness(profile);const saved=save('frostline-naval-v1',navalReadiness);syncBaseVehicle();return saved;});
const workshop=new HangarWorkshop(workshopProfile,profile=>{workshopProfile=profile;const saved=save('frostline-workshop-v1',profile);syncBaseVehicle();selectMode(selectedMode);return saved;});
world.cameraZoom=settings.cameraZoom/100;
function setCameraZoom(value){settings.cameraZoom=clamp(Number(value)||100,78,140);world.cameraZoom=settings.cameraZoom/100;$('cameraDistanceSetting').value=settings.cameraZoom;save('frostline-settings',settings);}
const input=new FlightInput({onAction:action,onThrottle:v=>{sim.player.throttle=v;},onZoom:step=>{if(sim.state==='playing'&&!cockpit)setCameraZoom(settings.cameraZoom+step);},onOrbit:(yaw,pitch)=>world.shipChase.orbit(yaw,pitch),orbitEnabled:()=>sim.state==='playing'&&isShip()&&!cockpit,invert:()=>settings.invert,vehicle:()=>isShip()?'destroyer':selectedVehicle});
const sortie=new SortieFlow($('sortieFlow'),{
 context:()=>({vehicle:vehicleById(selectedVehicle,workshopProfile,navalReadiness),ship:isShip(),map:settings.map,progress:campaignProgress,hasAntiShip:hasAntiShip(),difficulty:settings.difficulty}),
 onChoose:selection=>{if(selection.chapter)selectedCampaignId=selection.chapter;selectMode(selection.mode);},
 onMap:selectMap,
 onOpen:()=>{baseScene.cancelPointers();input.reset();$('menu').hidden=true;},
 onClose:()=>{$('menu').hidden=false;baseScene.dirty=true;$('startBtn').focus({preventScroll:true});},
 onLaunch:()=>start(),
 onWorkshop:()=>{sortie.hide();$('menu').hidden=false;resumeBriefing=true;returnPanel=null;if(isShip()){navalWorkshop.render();panel('navalWorkshopPanel');}else{workshop.render();panel('workshopPanel');}},
});
const hud=$('hudCanvas'),ctx=hud.getContext('2d');let width=innerWidth,height=innerHeight;
const modeNames={intercept:'破晓拦截',free:'无尽巡猎',training:'初次升空',naval:'海峡歼敌','naval-training':'舰炮训练',campaign:'北境航线'};
const modeCodes={intercept:'INTERCEPT',free:'ENDLESS',training:'TRAINING',naval:'NAVAL','naval-training':'GUNNERY',campaign:'CAMPAIGN'};
function selectVehicle(vehicle){selectedVehicle=VEHICLES.includes(vehicle)?vehicle:'aircraft';if(!isShip())hangarVehicle=selectedVehicle;else navalVehicle=selectedVehicle;settings.navalVehicle=navalVehicle;settings.vehicle=selectedVehicle;settings.hangarVehicle=hangarVehicle;workshop.setAircraft(aircraftId());save('frostline-settings',settings);document.body.classList.toggle('destroyer-ui',isShip());document.body.dataset.ship=isShip()?selectedVehicle:'';document.querySelectorAll('[data-vehicle]').forEach(e=>{const active=e.dataset.vehicle===selectedVehicle;e.classList.toggle('selected',active);e.setAttribute('aria-pressed',active);});syncBaseVehicle();$('speedLabel').textContent=isShip()?'航速 KTS':'空速 KTS';$('altLabel').textContent=isShip()?'炮仰角 °':'高度 M';$('healthLabel').textContent=isShip()?'舰体':'机体';$('heatLabel').textContent=isShip()?'舰炮温度':'机炮温度';$('gunLabel').textContent=isShip()?'舰炮':'机炮';$('missileLabel').textContent=isShip()?'防空 F':'导弹';$('flareLabel').textContent=isShip()?'诱饵':'热焰弹';$('touchFlare').innerHTML=(isShip()?'诱饵':'热焰弹')+'<span>X</span>';$('touchMissile').firstChild.textContent=isShip()?'防空':'导弹';$('touchBoost').textContent=isShip()?'全速':'加力';$('throttle').min=isShip()?'0':'12';$('joystick').setAttribute('aria-label',isShip()?'舰船转舵摇杆':'飞行摇杆');$('joystick').querySelector('span').textContent=isShip()?'舰船转舵':'飞行控制';$('desktopHints').innerHTML=isShip()?'<span>A/D 转舵</span><span>J/L 视角左右</span><span>W/S 视角上下</span><span>空格 开炮</span><span>F 防空</span><span>R 反舰</span><span>Tab 换目标</span><span>右键拖动 瞄准</span><span>滚轮 缩放</span><span>V 回正</span><span>C 舰桥</span>':'<span>W/S 俯仰</span><span>A/D 滚转</span><span>空格 机炮</span><span>F 空空</span><span>R 反舰</span><span>B 弹种</span><span>X 诱饵</span><span>C 视角</span><span>ESC 暂停</span>';$('guideTrain').innerHTML=(isShip()?'进入舰船训练':'进入飞行训练')+' <span>↗</span>';selectMode(selectedMode);syncCameraControls();}
function syncBaseVehicle(){
 const vehicle=vehicleById(selectedVehicle,workshopProfile,navalReadiness);baseScene.setVehicle(selectedVehicle);
 if(!isShip())baseScene.jet.userData.setLoadout(workshopProfile.loadouts[aircraftId()]);
 document.body.classList.toggle('aircraft-anti-ship',!isShip()&&hasAntiShip());
 $('ownedVehicleName').textContent=vehicle.name;
 $('ownedVehicleCode').innerHTML=`${vehicle.code} <span>${vehicle.english}</span>`;
 $('ownedVehicleType').textContent=vehicle.type;
 $('ownedVehicleDescription').textContent=vehicle.description;
 $('baseLocation').textContent=vehicle.location;
 $('launchVehicleName').textContent=vehicle.code+' '+vehicle.name;
 $('launchVehicleRole').textContent=vehicle.role;
 $('ownedVehicleWeapons').textContent=vehicle.weapons;
 $('ownedVehicleStats').replaceChildren(...vehicle.stats.map(([label,value,unit])=>{const row=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.append(document.createTextNode(value+' '));const small=document.createElement('small');small.textContent=unit;dd.append(small);row.append(dt,dd);return row;}));
 $('navalWorkshopBtn').hidden=!isShip();navalWorkshop.setShip(isShip()?selectedVehicle:'destroyer');
 $('baseViewLabel').textContent=isShip()?'海军基地 / BERTH 02':'机库 / HANGAR 01';
 document.querySelectorAll('[data-base]').forEach(button=>{const active=button.dataset.base===(isShip()?'destroyer':'aircraft');button.classList.toggle('selected',active);button.setAttribute('aria-pressed',active);});
 $('baseViewport').setAttribute('aria-label',`${vehicle.code} ${vehicle.name} 3D 展示：拖动旋转，滚轮或双指缩放，方向键旋转，Home 回正`);
}
function syncCameraControls(){document.body.classList.toggle('ship-bridge',isShip()&&cockpit);const button=$('touchCamera');button.textContent=isShip()?(cockpit?'跟随':'舰桥'):'视角';button.setAttribute('aria-label',isShip()?(cockpit?'切回镜头瞄准视角':'切换舰桥视角'):'切换视角');}
function selectMap(id){if(sim.state!=='menu'||selectedMode==='campaign')return;settings.map=getMap(id).id;save('frostline-settings',settings);}
function syncQualityDescription(){
 const labels={low:'标清',high:'高清',ultra:'超清'},details={low:'适合手机与低功耗设备，保留完整地图和载具比例。',high:'精细地形、海面反射与柔和阴影。',ultra:'更高分辨率、精密地形与清晰反射，适合高性能设备。'};
 const quality=settings.quality==='auto'?world.effectiveQuality:settings.quality;
 $('qualityDescription').textContent=(settings.quality==='auto'?`自动适配 · 当前${labels[quality]||'高清'}。`:'')+(details[quality]||details.high);
}
function selectMode(mode){
 selectedMode=Object.hasOwn(modeNames,mode)?mode:'intercept';
 if(isShip()&&selectedMode==='campaign')selectedMode='intercept';
 document.body.classList.toggle('naval-ui',isNaval());$('killsLabel').textContent=isNaval()?'击沉':'击落';
 $('resultKillsLabel').textContent=isNaval()?'击沉 / 舰炮命中率':'击落 / 机炮命中率';
 $('guideTrain').innerHTML=(isNaval()?'进入对海训练':isShip()?'进入舰船训练':'进入飞行训练')+' <span>↗</span>';
 $('bestScore').innerHTML=`${String(records[recordKey()]||0).padStart(5,'0')} <small>PTS</small>`;
}
function resize(){width=innerWidth;height=innerHeight;const ratio=Math.min(devicePixelRatio,1.5);hud.width=width*ratio;hud.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);world.resize();baseScene.resize();}
window.addEventListener('resize',resize);resize();
function closePanels(){
 const wasNavalWorkshop=!$('navalWorkshopPanel').hidden,wasWorkshop=!$('workshopPanel').hidden;
 $('modalBackdrop').hidden=true;
 for(const id of ['navalWorkshopPanel','guidePanel','settingsPanel','pausePanel','resultPanel','workshopPanel'])$(id).hidden=true;
 if(sim.state==='menu'){
   if(resumeBriefing&&(wasWorkshop||wasNavalWorkshop)){resumeBriefing=false;$('menu').hidden=true;sortie.root.hidden=false;sortie.refresh();}
   else if(wasNavalWorkshop)$('navalWorkshopBtn').focus({preventScroll:true});
   else if(wasWorkshop)$('workshopBtn').focus({preventScroll:true});
 }
}
function panel(id){closePanels();$(id).hidden=false;$('modalBackdrop').hidden=false;requestAnimationFrame(()=>$(id).querySelector('button,select')?.focus());}
function start(mode=selectedMode){
  if(mode==='campaign'&&(!campaignUnlocked(campaignProgress,selectedCampaignId)||isShip()))return;
  if(!isShip()&&isNaval(mode)&&!hasAntiShip())return;selectMode(mode);mode=selectedMode;sortie.hide();resumeBriefing=false;closePanels();baseScene.cancelPointers();input.reset();world.setMap(mode==='campaign'?DEFAULT_MAP_ID:settings.map);sim.configureAircraft(workshopProfile,aircraftId());sim.configureShip(isShip()?selectedVehicle:'destroyer',navalReadiness[selectedVehicle]);if(mode==='campaign')sim.startCampaign(selectedCampaignId,settings.difficulty);else sim.start(mode,settings.difficulty,selectedVehicle);presentation.reset(sim);world.shipChase.recenter(sim.player.heading);world.cameraReady=false;sound.init();endingShown=false;cockpit=false;syncCameraControls();input.active=true;accumulator=0;frameTime=performance.now();
  document.body.classList.toggle('campaign-flight',mode==='campaign');$('menu').hidden=true;$('flightUI').hidden=false;$('modeLabel').textContent=(isShip()?'DESTROYER / ':'')+modeCodes[mode];$('throttle').value=sim.player.throttle*100;cannonAim=null;
  $('flightMapName').textContent=getMap(world.mapId).name;
  if(isShip())world.render(presentation.sample(sim,1),0,{cockpit:false});
  toast(mode==='campaign'?campaignLevel(selectedCampaignId).radio[0].text:isShip()?(input.touch?'滑动画面瞄准 · 准星对准敌舰后开火 · 双指缩放':'右键拖动瞄准 · 空格或左键开炮 · 滚轮缩放 · V 回正'):'先滚转倾斜机翼，再拉杆转弯。',6000);$('touchHint').hidden=true;readouts(performance.now());
  if(matchMedia('(pointer: coarse)').matches&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().then(()=>{if(screen.orientation?.lock)screen.orientation.lock('landscape').catch(()=>{});}).catch(()=>{});
}
function pause(){if(sim.state==='playing'){sim.state='paused';input.reset();sound.silence();panel('pausePanel');}else if(sim.state==='paused'&&!$('pausePanel').hidden)resume();}
function resume(){closePanels();sim.state='playing';input.active=true;input.reset();sound.init();frameTime=performance.now();}
function base(){sortie.hide();resumeBriefing=false;closePanels();sim.state='menu';input.active=false;input.reset();sound.silence();$('flightUI').hidden=true;$('menu').hidden=false;$('warning').hidden=true;$('toast').hidden=true;selectMode(selectedMode);baseScene.dirty=true;}
function action(a){if(a==='pause'){pause();return;}if(sim.state!=='playing')return;if(a==='missile')sim.launchMissile();if(a==='antiShip')sim.launchAntiShipMissile();if(a==='airWeapon')sim.cycleAirWeapon();if(a==='flare')sim.deployFlare();if(a==='target')sim.cycleTarget();if(a==='recenter'&&isShip()){input.cancelOrbit();world.shipChase.recenter(sim.player.heading);if(cockpit){cockpit=false;world.cameraReady=false;}syncCameraControls();toast('已回正到舰艉跟随视角');}if(a==='camera'){input.cancelOrbit();cockpit=!cockpit;syncCameraControls();toast(cockpit?(isShip()?'舰桥视角':'座舱视角'):(isShip()?'自由跟随视角':'追尾视角'));}}
function toast(text,duration=3200){if(!text)return;$('toast').textContent=text;toastUntil=performance.now()+duration;$('toast').hidden=false;}
function result(){
 if(endingShown)return;
 endingShown=true;input.active=false;input.reset();sound.silence();const won=sim.state==='won';records[recordKey()]=Math.max(records[recordKey()]||0,sim.score);save('frostline-records',records);
 $('resultEyebrow').textContent=won?'MISSION COMPLETE':'SORTIE ENDED';$('resultTitle').textContent=won?(isTraining()?'训练完成':isNaval()?'海峡已肃清':'空域已肃清'):sim.endReason==='ammo'?'对舰弹药耗尽':'本次出击结束';
 $('resultDescription').textContent=won?(isTraining()?(isNaval()?'两艘靶舰已击沉。准备进入海战实战。':'你已掌握目标追踪。准备进入实战。'):(isShip()?'你守住了北境的海域。':'你守住了北境的天空。')):sim.endReason==='ammo'?'舰炮与反舰导弹已耗尽，在途弹药全部结算后仍有敌舰存活。重新出击，合理分配两类武器。':(isShip()?'整理舰炮与航行经验，准备下一次出航。':'每一次升空，都会让下一次飞行更从容。');
 $('resultScore').textContent=String(sim.score).padStart(5,'0');$('resultKills').textContent=`${sim.kills} / ${Math.min(100,Math.round(sim.hits/Math.max(1,sim.shots)*100))}%`;
 $('resultTime').textContent=`${String(Math.floor(sim.time/60)).padStart(2,'0')}:${String(Math.floor(sim.time%60)).padStart(2,'0')}`;
 $('campaignNextBtn').hidden=true;
 if(sim.mode==='campaign'){
   const level=campaignLevel(sim.campaignId);selectedCampaignId=level.id;
   if(won){campaignProgress=recordCampaignWin(campaignProgress,level.id,{won,health:sim.player.health,time:sim.time,score:sim.score});save('frostline-campaign-v1',campaignProgress);}
   $('resultEyebrow').textContent=won?'CHAPTER COMPLETE':'MISSION FAILED';$('resultTitle').textContent=won?(level.number===3?'北境航线 · 战役完成':`${level.title} · 完成`):`${level.title} · 未完成`;
   $('resultDescription').textContent=won?level.ending:sim.endReason==='airspace'?'离开护航空域超过 10 秒，防线出现缺口。重新出击，留意绿色编队标记。':sim.endReason==='time'?'任务时间耗尽。重新出击，优先完成关卡目标。':'苍隼失去联系。本关进度未解锁，重新出击后可以再次挑战。';
   $('campaignNextBtn').hidden=!won||level.number===3;$('campaignNextBtn').textContent=`第${['一','二','三'][level.number]||'三'}章简报 ↗`;
 }
 const reward=sortieReward(workshopProfile,{vehicle:sim.vehicle,mode:sim.mode,kills:sim.kills,score:sim.score,won});workshopProfile=reward.profile;save('frostline-workshop-v1',workshopProfile);workshop.setProfile(workshopProfile);syncBaseVehicle();
 $('resultDescription').textContent+=reward.credits?` 本次获得 ${reward.credits} 改装点与 ${reward.xp} XP。`:isShip()?' 舰艇出击不发航空技术奖励。':' 训练与未交战出击不发改装奖励。';
 panel('resultPanel');
}
$('navalWorkshopBtn').addEventListener('click',()=>{returnPanel=null;navalWorkshop.render();panel('navalWorkshopPanel');});
$('workshopBtn').addEventListener('click',()=>{returnPanel=null;workshop.render();panel('workshopPanel');});
$('airWeaponBtn').addEventListener('click',()=>{if(sim.state==='playing'){sim.cycleAirWeapon();readouts(performance.now());}});
for(const b of document.querySelectorAll('[data-vehicle]'))b.addEventListener('click',()=>selectVehicle(b.dataset.vehicle));
for(const b of document.querySelectorAll('[data-base]'))b.addEventListener('click',()=>selectVehicle(b.dataset.base==='destroyer'?navalVehicle:hangarVehicle));
$('baseReset').addEventListener('click',()=>baseScene.reset());
$('baseRotateLeft').addEventListener('click',()=>baseScene.orbit(-.3));
$('baseRotateRight').addEventListener('click',()=>baseScene.orbit(.3));
$('campaignNextBtn').addEventListener('click',()=>{const next=CAMPAIGN_LEVELS[campaignLevel(sim.campaignId)?.number];if(next){base();sortie.open({chapter:next.id});}});
$('startBtn').addEventListener('click',()=>sortie.open());
$('guideBtn').addEventListener('click',()=>{returnPanel=null;panel('guidePanel');});
$('settingsBtn').addEventListener('click',()=>{returnPanel=null;panel('settingsPanel');});
$('guideTrain').addEventListener('click',()=>{closePanels();if(sim.state!=='menu')base();sortie.category='training';sortie.selection=isNaval()?'naval-training':'training';sortie.open();sortie.screen='missions';sortie.render();});
$('pauseBtn').addEventListener('click',pause);$('resumeBtn').addEventListener('click',resume);
$('restartBtn').addEventListener('click',()=>start());$('againBtn').addEventListener('click',()=>start());
$('exitBtn').addEventListener('click',base);$('resultExitBtn').addEventListener('click',base);
$('pauseGuideBtn').addEventListener('click',()=>{returnPanel='pausePanel';panel('guidePanel');});
for(const b of document.querySelectorAll('.close-panel'))b.addEventListener('click',()=>{if(returnPanel){const p=returnPanel;returnPanel=null;panel(p);}else closePanels();});
$('modalBackdrop').addEventListener('click',e=>{if(e.target!==$('modalBackdrop'))return;if(!$('settingsPanel').hidden||!$('guidePanel').hidden||!$('workshopPanel').hidden||!$('navalWorkshopPanel').hidden){if(returnPanel){const p=returnPanel;returnPanel=null;panel(p);}else closePanels();}});
for(const [id,key] of [['difficultySetting','difficulty'],['qualitySetting','quality'],['soundSetting','sound'],['invertSetting','invert']]){const e=$(id);if(e.type==='checkbox')e.checked=settings[key];else e.value=settings[key];e.addEventListener('change',()=>{settings[key]=e.type==='checkbox'?e.checked:e.value;if(key==='quality')settings.quality=normalizeQuality(settings.quality);save('frostline-settings',settings);if(key==='quality'){world.setQuality(settings.quality);baseScene.dirty=true;syncQualityDescription();}if(key==='sound')sound.setEnabled(settings.sound);});}
$('cameraDistanceSetting').value=settings.cameraZoom;
$('cameraDistanceSetting').addEventListener('input',e=>setCameraZoom(e.target.value));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&sim.state==='playing')pause();});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&sim.state==='menu'&&!sortie.active)closePanels();});


function readouts(now){
 if(!isShip()){const count=sim.player.stores.filter(s=>s.store===sim.player.selectedAirWeapon).reduce((n,s)=>n+s.count,0);$('airWeaponBtn').textContent=sim.airWeapon.short+' '+count+' · 切换 B';$('missileLabel').textContent='空空 F';$('airWeaponBtn').title=`射程 ${(sim.airWeapon.range/1000).toFixed(1)} km · 燃油 ${Math.round(sim.player.fuelKg)} kg`;}
 const p=sim.player,heading=(360-p.heading*180/Math.PI)%360;
 $('speedValue').textContent=Math.round(p.speed*1.94384);$('altValue').textContent=isShip()?Math.round(p.turretPitch*180/Math.PI):Math.round(p.pos.y);$('gValue').textContent=isShip()?`舵 ${Math.round(Math.abs(p.rudder||0)*100)}% ${(p.rudder||0)>0?'左':(p.rudder||0)<0?'右':''}`:`${p.g.toFixed(1)} G · 油 ${Math.round(p.fuelKg/p.systems.fuelCapacity*100)}%`;$('headingValue').textContent=`${String(Math.round(heading)).padStart(3,'0')}° ${['N','E','S','W'][Math.round(heading/90)%4]}`;
 const hp=clamp(p.health/(p.maxHealth||100)*100,0,100);$('healthValue').textContent=isShip()&&selectedVehicle!=='destroyer'?`${Math.round(p.health)} / ${p.maxHealth} HP`:`${Math.round(hp)}%`;$('healthBar').style.width=`${hp}%`;$('healthBar').style.background=hp<35?'#edac80':'#c9f3d2';$('heatValue').textContent=`${Math.round(p.heat*100)}%`;$('heatBar').style.width=`${p.heat*100}%`;
 $('ammoValue').textContent=p.ammo;$('antiShipValue').textContent=String(p.antiShipMissiles||0).padStart(2,'0');$('missileValue').textContent=String(p.missiles).padStart(2,'0');$('flareValue').textContent=String(p.flares).padStart(2,'0');$('killsValue').textContent=sim.kills;$('scoreValue').textContent=String(sim.score).padStart(5,'0');$('throttleValue').textContent=p.boost?(isShip()?'全速':'AB · 加力'):`${Math.round(p.throttle*100)}%`;if(document.activeElement!==$('throttle'))$('throttle').value=p.throttle*100;
 $('waveInfo').textContent=isTraining()?`TRAINING / ${(isNaval()?2:3)-sim.enemies.length} OF ${isNaval()?2:3}`:`WAVE ${String(sim.wave).padStart(2,'0')}${selectedMode==='intercept'||selectedMode==='naval'?' / 03':''}`;$('objective').textContent=sim.enemies.length?`${isShip()&&selectedMode==='training'?'初次出航':modeNames[selectedMode]} · 剩余 ${sim.enemies.length} ${isNaval()?'艘':'架'}`:isShip()?'海域清理中 · 准备补给':'空域清理中 · 准备补给';
 const warning=sim.incoming>0?(isShip()?'导弹来袭 · 诱饵 + 转舵':'导弹来袭 · 热焰弹 + 转向'):p.warning||(p.overheated?(isShip()?'舰炮过热 · 松开扳机':'机炮过热 · 松开扳机'):'');$('warning').hidden=!warning;$('warning').textContent=warning;
 const selectedTarget=sim.enemies.find(e=>e.id===sim.targetId),surfaceTarget=selectedTarget?.kind==='ship',asProgress=sim.antiShipLockProgress||0,samCooldown=sim.missileCooldown||0,asCooldown=sim.antiShipCooldown||0;const samText=samCooldown>0?`冷却 ${samCooldown.toFixed(1)}s`:surfaceTarget?'仅对空':sim.lockProgress>=1?'已锁定':sim.lockProgress>0?`锁定 ${Math.round(sim.lockProgress*100)}%`:'等待空中目标';const asText=asCooldown>0?`冷却 ${asCooldown.toFixed(1)}s`:!surfaceTarget?'等待海上目标':asProgress>=1?'已锁定':asProgress>0?`锁定 ${Math.round(asProgress*100)}%`:'未锁定';$('touchLock').textContent=samText;$('samLockStatus').textContent=samText;$('touchAntiShipLock').textContent=asText;$('antiShipStatus').textContent=asText;$('touchMissile').classList.toggle('ready',sim.lockProgress>=1&&p.missiles>0&&samCooldown===0);$('touchAntiShip').classList.toggle('ready',asProgress>=1&&p.antiShipMissiles>0&&asCooldown===0);
 if(sim.mode==='campaign'){$('objective').textContent=campaignObjectiveText(sim);$('waveInfo').textContent=`CHAPTER ${campaignLevel(sim.campaignId).number} / 03`;}
 $('shipSystemsHud').hidden=!isShip()||!p.modules;
 if(isShip()&&p.modules){$('shipSystemsName').textContent=SHIPS[p.shipId].name;for(const id of ['engine','radar','weapons']){const max=p.shipSystems.modules[id];$('shipModule-'+id).value=p.modules[id]/max;$('shipModuleText-'+id).textContent=`${Math.round(p.modules[id])}/${max}`;}$('ciwsHud').textContent=`近防炮 ${Math.round(p.ciwsHeat*100)}% · 拦截 ${p.interceptions}${p.ciwsOverheated?' · 冷却中':''}`;}
 if(now>toastUntil)$('toast').hidden=true;
}
function line(x1,y1,x2,y2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function brackets(x,y,s){const arm=8;for(const a of [-1,1])for(const b of [-1,1]){ctx.beginPath();ctx.moveTo(x+a*(s-arm),y+b*s);ctx.lineTo(x+a*s,y+b*s);ctx.lineTo(x+a*s,y+b*(s-arm));ctx.stroke();}}
function drawHud(display){
 ctx.clearRect(0,0,width,height);if(display.state==='menu')return;const p=display.player,ship=p.kind==='destroyer',forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(ship?p.turretPitch:p.pitch,ship?p.turretHeading:p.heading,0,'YXZ'));const origin=p.pos.clone();if(ship)origin.copy(shipGunOrigin(p));const linked=ship&&!cockpit;if(linked){const t=p.gunAimFlightTime||Math.max(.1,(p.gunAimDistance||1600)/930);origin.addScaledVector(forward,14+930*t).addScaledVector(p.vel,t);origin.y-=1.6*t*t;}else origin.addScaledVector(forward,1600);const aim=world.project(origin);
 const cx=linked?width/2:aim.visible?aim.x:width/2,cy=linked?height/2:aim.visible?aim.y:height/2;ctx.save();ctx.strokeStyle='rgba(212,246,219,.8)';ctx.fillStyle='#d3f5dd';ctx.lineWidth=1;ctx.font='10px monospace';ctx.textAlign='center';ctx.shadowColor='#133339';ctx.shadowBlur=4;
 const r=input.touch?25:30,reticleVisible=linked||!ship||aim.visible;if(reticleVisible){ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();line(cx-r-10,cy,cx-r+5,cy);line(cx+r-5,cy,cx+r+10,cy);line(cx,cy-r-10,cx,cy-r+5);ctx.fillRect(cx-1,cy-1,2,2);}else{
   const delta=origin.clone().sub(world.camera.position).applyQuaternion(world.camera.quaternion.clone().invert());let x=delta.x,y=-delta.y;if(delta.z>0){x=x||.1;y=Math.abs(y)+height*.3;}const angle=Math.atan2(y,x),ex=width/2+Math.cos(angle)*width*.35,ey=height/2+Math.sin(angle)*height*.27;ctx.save();ctx.translate(ex,ey);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.closePath();ctx.stroke();ctx.restore();ctx.font='9px monospace';ctx.fillText('舰炮方向',ex,ey+19);
 }
 if(linked){const limited=!!p.gunAimLimited,tracking=(p.gunAimError||0)>.012;const label=limited?'射界限制':tracking?'转炮中':cannonAim?.kind==='terrain'?'岸线遮挡':'舰炮就绪';ctx.font='9px monospace';ctx.fillStyle=limited||tracking?'#ffd0a3':'#c9f5d9';ctx.fillText(`${label} · ${((p.gunAimDistance||0)/1000).toFixed(2)} KM`,cx,cy-r-24);if(aim.visible&&Math.hypot(aim.x-cx,aim.y-cy)>8){ctx.strokeStyle='#ffcba1';ctx.beginPath();ctx.arc(aim.x,aim.y,5,0,Math.PI*2);ctx.stroke();ctx.setLineDash([3,5]);line(cx,cy,aim.x,aim.y);ctx.setLineDash([]);}else if(!aim.visible){const delta=origin.clone().sub(world.camera.position).applyQuaternion(world.camera.quaternion.clone().invert());let x=delta.x,y=-delta.y;if(delta.z>0){x=x||.1;y=Math.abs(y)+height*.3;}const a=Math.atan2(y,x),ex=cx+Math.cos(a)*width*.35,ey=cy+Math.sin(a)*height*.27;ctx.save();ctx.translate(ex,ey);ctx.rotate(a);ctx.strokeStyle='#ffcba1';ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.closePath();ctx.stroke();ctx.restore();ctx.fillText('舰炮方向',ex,ey+19);}}
 const selectedTarget=display.enemies.find(e=>e.id===display.targetId),surfaceTarget=selectedTarget?.kind==='ship',lock=surfaceTarget?(display.antiShipLockProgress||0):display.lockProgress;if(lock>0&&!surfaceTarget&&reticleVisible){ctx.strokeStyle=lock>=1?'#ffc888':'#e0f6cf';ctx.lineWidth=2;ctx.beginPath();ctx.arc(cx,cy,r+5,-Math.PI/2,-Math.PI/2+Math.PI*2*lock);ctx.stroke();ctx.font='9px monospace';ctx.fillStyle=lock>=1?'#ffcb8a':'#d3f5dd';ctx.fillText(lock>=1?(ship?'SAM LOCK / F':'LOCK / F'):'ACQUIRING',cx,cy+r+24);ctx.lineWidth=1;}
 // A restrained pitch ladder and bank scale follow the actual airframe attitude.
 if(!ship){ctx.save();ctx.translate(width/2,height/2);ctx.rotate(-p.bank*.8);ctx.strokeStyle='rgba(215,242,220,.29)';ctx.fillStyle='rgba(215,242,220,.60)';ctx.font='8px monospace';for(let pitch=-30;pitch<=30;pitch+=10){const y=(p.pitch*180/Math.PI-pitch)*5.2;if(Math.abs(y)>height*.24)continue;const n=pitch===0?90:56;line(-n,y,-24,y);line(24,y,n,y);if(pitch!==0){ctx.fillText(String(pitch),-n-14,y+3);ctx.fillText(String(pitch),n+14,y+3);}}ctx.restore();}else{ctx.font='10px monospace';ctx.fillText(`炮向 ${String(Math.round((360-p.turretHeading*180/Math.PI)%360)).padStart(3,'0')}° · 仰角 ${Math.round(p.turretPitch*180/Math.PI)}°`,width/2,input.touch&&width<=600&&height>width?height*(linked?.39:.45):height*(linked?.9:.72));}
 // Targets, range, projected lead, and edge bearings.
 if(display.campaignId==='shield'&&display.campaignState){
   const position=display.campaignState.objectivePos,q=world.project(position),distance=Math.hypot(p.pos.x-position.x,p.pos.z-position.z);
   let x=q.x,y=q.y;ctx.strokeStyle='#89dfbe';ctx.fillStyle='#a5edd0';
   if(q.visible){ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.stroke();}
   else {const delta=position.clone().sub(world.camera.position).applyQuaternion(world.camera.quaternion.clone().invert());const angle=Math.atan2(delta.z>0?Math.abs(-delta.y)+height*.3:-delta.y,delta.x||.1);x=width/2+Math.cos(angle)*width*.36;y=height/2+Math.sin(angle)*height*.27;ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.closePath();ctx.stroke();ctx.restore();}
   ctx.font='9px monospace';ctx.fillText(`护航编队 ${(distance/1000).toFixed(1)} / 4.5 KM`,x,y-16);
 }
 for(const e of display.enemies){const targetPos=e.pos.clone();if(e.kind==='ship')targetPos.y+=e.aimHeight??6;const q=world.project(targetPos),d=p.pos.distanceTo(e.pos),selected=e.id===display.targetId;
   ctx.strokeStyle=selected?'#ffbe99':'rgba(245,173,152,.68)';ctx.fillStyle=selected?'#ffcfb2':'#e7b5a4';ctx.lineWidth=selected?1.25:.8;ctx.font='9px monospace';
   if(q.visible){const s=selected?19:12;brackets(q.x,q.y,s);if(selected){if(e.kind==='ship'&&display.antiShipLockProgress>0){ctx.strokeStyle=display.antiShipLockProgress>=1?'#8cf1df':'#b9ede3';ctx.lineWidth=2;ctx.beginPath();ctx.arc(q.x,q.y,s+7,-Math.PI/2,-Math.PI/2+Math.PI*2*display.antiShipLockProgress);ctx.stroke();ctx.font='8px monospace';ctx.fillStyle='#8cf1df';ctx.fillText(display.antiShipLockProgress>=1?'反舰锁定 / R':'反舰锁定中',q.x,q.y+s+22);ctx.lineWidth=1;ctx.font='9px monospace';}ctx.fillText(`${e.kind==='ship'?(e.shipType==='patrol'?'巡逻艇':'护卫舰'):e.name||'TGT '+e.id.split('-').pop()}  ${(d/1000).toFixed(2)} KM`,q.x,q.y-s-9);const hp=clamp(e.health/(e.maxHealth||100),0,1);ctx.fillRect(q.x-s,q.y+s+6,s*2*hp,2);const travelTime=d/Math.max(500,930+p.speed-e.speed),leadPos=targetPos.clone().addScaledVector(e.vel||new THREE.Vector3(),travelTime).addScaledVector(p.vel,-travelTime);if(e.kind==='ship')leadPos.y+=1.6*travelTime*travelTime;const lead=world.project(leadPos);if(lead.visible&&Math.hypot(lead.x-q.x,lead.y-q.y)<220){ctx.strokeStyle='rgba(241,216,175,.6)';ctx.setLineDash([2,4]);line(q.x,q.y,lead.x,lead.y);ctx.setLineDash([]);ctx.beginPath();ctx.arc(lead.x,lead.y,4,0,Math.PI*2);ctx.stroke();}}
   }else if(selected){const delta=targetPos.clone().sub(p.pos).applyQuaternion(world.camera.quaternion.clone().invert());let x=delta.x,y=-delta.y;if(delta.z>0){x=x||.1;y=Math.abs(y)+height*.3;}const angle=Math.atan2(y,x);const rx=width*.40,ry=height*.32;const ex=width/2+Math.cos(angle)*rx,ey=height/2+Math.sin(angle)*ry;ctx.save();ctx.translate(ex,ey);ctx.rotate(angle);ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-5,-5);ctx.lineTo(-5,5);ctx.closePath();ctx.stroke();ctx.restore();ctx.fillText(`${(d/1000).toFixed(1)} KM`,ex,ey+20);}
 }
 // Small heading-up radar. Range 3 km; no hidden assistance.
 const rr=input.touch?32:44,rx=input.touch?(ship?width*.7:width/2):width-75,ry=input.touch?(height<540?50:95):135;ctx.save();ctx.shadowBlur=0;ctx.translate(rx,ry);ctx.strokeStyle='#d2f0d842';ctx.fillStyle='#15333c27';ctx.beginPath();ctx.arc(0,0,rr,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(0,0,rr/2,0,Math.PI*2);ctx.stroke();line(-rr,0,rr,0);line(0,-rr,0,rr);ctx.fillStyle='#d9efdc';ctx.beginPath();ctx.moveTo(0,-4);ctx.lineTo(-3,3);ctx.lineTo(3,3);ctx.closePath();ctx.fill();
 for(const e of display.enemies){const dx=e.pos.x-p.pos.x,dz=e.pos.z-p.pos.z;let x=(dx*Math.cos(p.heading)-dz*Math.sin(p.heading))/(ship?DESTROYER.antiShipRadarRange:3000)*rr,y=(dx*Math.sin(p.heading)+dz*Math.cos(p.heading))/(ship?DESTROYER.antiShipRadarRange:3000)*rr;const length=Math.hypot(x,y);if(length>rr-4){x*=((rr-4)/length);y*=((rr-4)/length);}ctx.fillStyle=e.id===display.targetId?'#ffd0ac':'#dba99c';if(e.kind==='ship'){ctx.beginPath();ctx.arc(x,y,e.id===display.targetId?3:2.4,0,Math.PI*2);ctx.fill();}else ctx.fillRect(x-2,y-2,4,4);}ctx.restore();
 if(cockpit&&!ship){ctx.strokeStyle='rgba(20,33,36,.8)';ctx.lineWidth=Math.max(9,width*.012);ctx.beginPath();ctx.moveTo(width*.08,height);ctx.quadraticCurveTo(width*.11,height*.35,width*.28,-30);ctx.stroke();ctx.beginPath();ctx.moveTo(width*.92,height);ctx.quadraticCurveTo(width*.89,height*.35,width*.72,-30);ctx.stroke();ctx.fillStyle='#17292fcc';ctx.beginPath();ctx.moveTo(width*.20,height);ctx.lineTo(width*.35,height*.9);ctx.lineTo(width*.65,height*.9);ctx.lineTo(width*.8,height);ctx.closePath();ctx.fill();}
 ctx.restore();
}
function frame(now){
 const dt=Math.min(.1,(now-frameTime)/1000);frameTime=now;
 if(sim.state==='playing'){accumulator+=dt;const controls=input.read();if(isShip()&&!cockpit){world.shipChase.orbit((controls.aimYaw||0)*.72*dt,-controls.pitch*.52*dt);cannonAim=shipCameraAimPoint(sim.player,sim.enemies,world.camera.position,world.camera.getWorldDirection(new THREE.Vector3()));controls.aimPoint=cannonAim?.point;controls.aimYaw=0;controls.pitch=0;}else cannonAim=null;while(accumulator>=1/60){presentation.capture(sim);sim.update(1/60,controls);accumulator-=1/60;}for(const e of sim.drainEvents()){sound.event(e);if(e.text&&(e.type==='toast'||e.type==='wave'||e.type==='kill'))toast(e.text);if(e.type==='damage'){document.body.classList.remove('damage-flash');void document.body.offsetWidth;document.body.classList.add('damage-flash');}}if((sim.state==='won'||sim.state==='lost')&&!endingShown)result();}
 // Render the independent base display at 30 FPS; missions retain their existing renderer.
 if(sim.state!=='menu'){const display=presentation.sample(sim,sim.state==='playing'||sim.state==='paused'?accumulator*60:1);world.render(display,sim.state==='paused'?0:dt,{cockpit});drawHud(display);sound.update(sim);if(now-lastUi>80){readouts(now);lastUi=now;}}else {ctx.clearRect(0,0,width,height);if($('modalBackdrop').hidden&&!sortie.active)baseScene.render(now);}
 if(diagnostics){
   metricsFrames++;if(sim.state!=='menu')metricsDeltas.push(dt*1000);
   if(now-metricsStart>750){
     const sorted=metricsDeltas.slice().sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*.95)]||0;
     const info=world.renderer.info,land=world.terrain.userData.stats;
     diagnostics.textContent=`${Math.round(metricsFrames*1000/(now-metricsStart))} FPS · ${world.effectiveQuality} · p95 ${p95.toFixed(1)}ms · ${info.render.calls} draws · ${Math.round(info.render.triangles/1000)}k tris · reflection ${world.reflection.target.width}×${world.reflection.target.height} · GPU ${info.memory.geometries}g/${info.memory.textures}t${land?` · land ${Math.round(land.triangles/1000)}k`:''}`;
     metricsFrames=0;metricsStart=now;metricsDeltas=[];
   }
 }

 requestAnimationFrame(frame);
}
syncQualityDescription();
selectVehicle(selectedVehicle);$('boot').hidden=true;$('menu').hidden=false;requestAnimationFrame(frame);
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(new URLSearchParams(location.search).has('debug'))window.frostlineDiagnostics=()=>({mode:sim.mode,targets:sim.enemies.map(e=>({id:e.id,kind:e.kind,shipType:e.shipType,health:e.health,pos:e.pos.toArray()})),state:sim.state,time:sim.time,score:sim.score,enemies:sim.enemies.length,missiles:sim.missiles.length,vehicle:sim.vehicle,lockProgress:sim.lockProgress,antiShipLockProgress:sim.antiShipLockProgress,antiShipTargetId:sim.antiShipTargetId,targetId:sim.targetId,player:{speed:sim.player.speed,health:sim.player.health,throttle:sim.player.throttle,ammo:sim.player.ammo,antiShipMissiles:sim.player.antiShipMissiles,missiles:sim.player.missiles,pos:sim.player.pos.toArray(),heading:sim.player.heading,bank:sim.player.bank,pitch:sim.player.pitch,turretHeading:sim.player.turretHeading,turretPitch:sim.player.turretPitch,rudder:sim.player.rudder},render:world.renderer.info.render,quality:world.effectiveQuality});
