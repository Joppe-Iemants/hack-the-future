import {createNetwork,makeRoutes,climb,reward} from './router.mjs';
import {RouteMap} from './map.mjs';
import {preferences} from './scenery.mjs';
import {$,icon,modal,closeModal,toast,km,duration,escapeText,read,write} from './ui.mjs';
import {history,reflection,renderActivities} from './journal.mjs';
import {renderFriends} from './friends.mjs';

const popular=[
  ['Korenmarkt',3.7219,51.05442],['Sint-Pietersplein',3.72507,51.04184],['Vrijdagmarkt',3.72524,51.05719],
  ['Gravensteen',3.72067,51.05684],['Gent Zuid',3.73188,51.04731],['Portus Ganda',3.73559,51.05512],
  ['Bijloke',3.71534,51.04439],['Sint-Jacobs',3.72728,51.05677],
];
let data,net,map,grid,startId,selected,choices=[],place='Korenmarkt, Gent',busy=false,picking=false;
let active=read('ongoing',null),mode='run',watch=null,geoNote='',activeTimer,initial=true;
const distance=()=>Number($('#distance').value)*1000;
const xy=(lon,lat)=>[(lon-data.origin[0])*data.scale[0],(lat-data.origin[1])*data.scale[1]];
const plannedTime=r=>Math.max(1,Math.round(r.meters/1000*(mode==='run'?6:12)));
const prefLabels = new Map(preferences.map(p=>[p.key,p.label]));
$('#preferences').innerHTML=preferences.map(({key,label})=>'<label><input type="checkbox" name="scenery" value="'+key+'">'+label+'</label>').join('');
const prefInputs=[...document.querySelectorAll('input[name=scenery]')];
const requested=()=>prefInputs.filter(input=>input.checked).map(input=>input.value);
for(const input of prefInputs)input.checked=(active?.requested||[]).includes(input.value);
$('#preferences').onchange=()=>{dirty();feedback('');};
const titles={planner:['Routeplanner','Jouw afstand, een nieuw rondje. Terug waar je begon.'],activities:['Activiteiten','Je rondjes, persoonlijke records en fijne momenten onderweg.'],friends:['Vrienden','Deel je rondjes en ontdek wie deze week de meeste punten haalt.']};

function page(){
  const key=Object.hasOwn(titles,location.hash.slice(1))?location.hash.slice(1):'planner';
  for(const name of Object.keys(titles))$('#'+name).hidden=name!==key;
  document.querySelectorAll('[data-page]').forEach(link=>{
    link.classList.toggle('current',link.dataset.page===key);
    if(link.dataset.page===key)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  });
  $('#page-title').textContent=titles[key][0];$('#page-intro').textContent=titles[key][1];document.title='plan2run · '+titles[key][0];
  if(key==='activities')renderActivities();if(key==='friends')renderFriends();
  if(key==='planner'&&map)requestAnimationFrame(()=>map.fit());
  $('#total').textContent=history().reduce((sum,a)=>sum+a.points,0);
}
window.addEventListener('hashchange',page);$('#score-link').onclick=()=>location.hash='activities';
function feedback(msg=''){$('#form-feedback').textContent=msg;}
function status(text){$('#route-status').innerHTML='<b></b>'+escapeText(text);}
function isOutdated(){
  return !selected || selected.from!==startId || selected.target!==distance() ||
    requested().join(',')!==(selected.requested||[]).join(',');
}
function dirty(){
  const outdated=isOutdated();
  $('#start-run').disabled=busy||(!active&&outdated);
  $('#route-matches').hidden=outdated||!selected?.matches?.length;
  if(!active&&selected)status(outdated?'Pas je rondje aan':'Route klaar');
}
function updateSlider(){
  const el=$('#distance'),value=Number(el.value);
  $('#distance-label').textContent=km(value*1000);el.style.setProperty('--fill',((value-1)/11*100)+'%');el.setAttribute('aria-valuetext',km(value*1000)+' kilometer');
  if(!active)dirty();
}
$('#distance').oninput=updateSlider;
function applyMode(next){
  mode=next;document.querySelector('input[name=mode][value='+mode+']').checked=true;
  if(selected)updateStats();
}
document.querySelectorAll('input[name=mode]').forEach(el=>el.onchange=()=>applyMode(el.value));
function updateStats(){
  const {meters,height}=selected;
  $('#stat-distance').innerHTML=km(meters)+'<small>km</small>';
  $('#stat-height').innerHTML=(height??'—')+'<small>m</small>';
  $('#stat-points').innerHTML='+'+reward(meters)+'<small>pts</small>';
  $('#stat-time').innerHTML=plannedTime(selected)+'<small>min</small>';
  const difficulty=height===null?'Stijging onbekend':meters>=9500||height*1000/meters>22?'Uitdagend':meters>=6500||height*1000/meters>12?'Gemiddeld':'Makkelijk';
  $('#difficulty').textContent=difficulty;
}
function selectRoute(r){
  selected=r;map.setRoute(r.path);updateStats();
  const matches=r.matches||[], met=matches.filter(m=>m.met).length;
  $('#route-matches').innerHTML=matches.length?'<strong>'+met+' van '+matches.length+' voorkeuren op dit rondje</strong><ul>'+matches.map(m=>{
    const label=prefLabels.get(m.key);
    const detail=m.key==='architecture'?m.names?.join(', '):'± '+Math.round(m.meters/10)*10+' m';
    return '<li class="'+(m.met?'met':'miss')+'">'+(m.met?'✓ ':'– ')+escapeText(label)+' · '+(m.met?escapeText(detail):'niet gevonden')+'</li>';
  }).join('')+'</ul>':'';
  dirty();
  if(active)status('Rondje actief');
  document.querySelectorAll('[data-option]').forEach(b=>b.classList.toggle('selected',choices[Number(b.dataset.option)]===r));
}
function lockControls(){
  $('#generate').disabled=busy||!!active||!net;$('#start-place').disabled=busy||!!active||!net;$('#distance').disabled=busy||!!active;
  document.querySelectorAll('input[name=mode]').forEach(el=>el.disabled=busy||!!active);
  prefInputs.forEach(el=>el.disabled=busy||!!active);
  $('#pick-start').disabled=busy||!!active||!map;
  $('#start-run').innerHTML=icon('play')+(active?'Rondje bekijken':'Start rondje');
  $('#start-run').disabled=busy||(!active&&isOutdated());
}
function clearPreview(){
  selected=null;choices=[];map.setRoute([]);$('#options').hidden=true;$('#route-matches').hidden=true;
  for(const key of ['distance','time','height','points'])$('#stat-'+key).textContent='—';
  $('#difficulty').textContent='Nog geen rondje';
}
function setStart(id,name){
  if(selected && selected.from!==id){clearPreview();status('Startpunt gekozen');}
  startId=id;place=name;$('#place-label').textContent=place;
  map.setStart(data.points[id]);setPicking(false);dirty();feedback('');
}
async function generate(){
  if(!net||active||busy)return;
  setPicking(false);busy=true;lockControls();feedback('');status('Route zoeken');$('#generate').innerHTML=icon('shuffle')+'Rondje zoeken…';
  await new Promise(resolve=>setTimeout(resolve,25));
  try{
    const target=distance(), prefs=requested();
    let random=Math.random;
    if(initial){let seed=2026;random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);initial=false;}
    let found=makeRoutes(net,startId,target,random,prefs);
    if(!found.length)found=makeRoutes(net,startId,target,Math.random,prefs);
    if(selected&&found.length===1&&found[0].ids.join(',')===selected.ids?.join(',')){
      const alternates=makeRoutes(net,startId,target,Math.random,prefs);
      if(alternates.length)found=alternates;
    }
    if(!found.length){clearPreview();status('Geen lus gevonden');feedback('Hier vonden we geen geschikte lus. Kies een ander startpunt of een andere afstand.');return;}
    choices=found.map(r=>{const path=r.ids.map(i=>data.points[i]);return {...r,path,from:startId,target,requested:prefs,height:climb(path,grid)};});
    const opts=$('#options');opts.hidden=choices.length<2;
    if(choices.length>1){
      opts.innerHTML='<p>Deze twee rondjes komen het dichtst in de buurt.</p>'+choices.map((r,i)=>'<button type="button" class="button ghost" data-option="'+i+'">'+km(r.meters)+' km · '+(r.height??'—')+' m ↑ · '+reward(r.meters)+' pts</button>').join('');
      opts.querySelectorAll('button').forEach(b=>b.onclick=()=>selectRoute(choices[Number(b.dataset.option)]));
    }else if(Math.abs(choices[0].meters-target)>Math.max(100,target*.05))feedback('Dit is de dichtstbijzijnde lus die we vanaf dit punt vonden.');
    selectRoute(choices[0]);
  }catch{feedback('Het berekenen van dit rondje lukte niet. Probeer een ander startpunt.');status('Probeer opnieuw');}
  finally{busy=false;$('#generate').innerHTML=icon('shuffle')+'Genereer rondje';lockControls();}
}
$('#config').onsubmit=e=>{e.preventDefault();generate();};

function places(){
  if(!net||active)return;
  const favorites=popular.map(([name,lon,lat])=>[name,net.nearest(xy(lon,lat)).id]);
  modal('Kies je startpunt','<label class="field-label" for="place-search">Zoek een straat of plein in Gent</label><input class="input" id="place-search" type="search" placeholder="Bijv. Korenmarkt" autocomplete="off"><div class="place-list" id="place-list"></div><div class="dialog-actions"><button class="button ghost" id="gps">'+icon('locate')+'Mijn locatie</button><button class="button ghost" id="map-pick">'+icon('pin')+'Kies op kaart</button></div><p class="fine" id="place-note" role="status">Het kaartgebied omvat het centrum van Gent.</p>');
  const search=$('#place-search'),note=$('#place-note');
  const list=()=>{
    const q=search.value.trim().toLocaleLowerCase('nl');
    const names=q?[...new Map([...net.names,...favorites])].filter(([s])=>s.toLocaleLowerCase('nl').includes(q)).sort((a,b)=>a[0].localeCompare(b[0],'nl')).slice(0,25):favorites;
    $('#place-list').innerHTML=names.length?names.map(([name],i)=>'<button data-loc="'+i+'">'+icon('pin')+escapeText(name)+'</button>').join(''):'<p>Geen straat gevonden in het kaartgebied.</p>';
    document.querySelectorAll('[data-loc]').forEach(b=>b.onclick=()=>{const [name,id]=names[Number(b.dataset.loc)];setStart(id,name+', Gent');closeModal();});
  };
  search.oninput=list;list();
  $('#gps').onclick=()=>{
    if(!navigator.geolocation){note.textContent='Je browser ondersteunt geen locatiebepaling.';return;}
    note.textContent='Je locatie wordt gezocht…';
    navigator.geolocation.getCurrentPosition(pos=>{
      if(!note.isConnected||!$('#dialog').open)return;
      const result=net.nearest(xy(pos.coords.longitude,pos.coords.latitude));
      if(result.gap>100){note.textContent='Je staat buiten het bereik van de Gentse padenkaart. Kies een straat of plein in Gent.';return;}
      setStart(result.id,'Mijn locatie, Gent');closeModal();
    },()=>{note.textContent='Geen locatie beschikbaar. Kies een straat of wijs je startpunt aan op de kaart.';},{enableHighAccuracy:true,timeout:12000});
  };
  $('#map-pick').onclick=()=>{closeModal();setPicking(true);$('#map-frame').scrollIntoView({behavior:'smooth',block:'center'});};
}
$('#start-place').onclick=places;
function pickStartAt(point){
  const nearest=net.nearest(point);if(nearest.gap>100){toast('Kies een punt dichter bij een begaanbare straat.');return;}
  setStart(nearest.id,'Gekozen punt, Gent');feedback('Startpunt gekozen. Genereer je rondje.');toast('Startpunt gekozen.');
}
function setPicking(enabled){
  picking=enabled;map.onPick=enabled?pickStartAt:null;
  $('#map-frame').classList.toggle('picking',enabled);$('#pick-start').setAttribute('aria-pressed',String(enabled));
  if(enabled){
    feedback('Tik op een straat, of verschuif de kaart en druk op Enter om het midden te kiezen.');
    $('#map').focus({preventScroll:true});
  }else feedback('');
}
$('#pick-start').onclick=()=>setPicking(!picking);
$('#map').addEventListener('keydown',e=>{if(picking && e.key==='Escape')setPicking(false);});

function stopGPS(){if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null;}geoNote='';if(map){map.position=null;map.schedule();}}
function beginGPS(){
  if(!navigator.geolocation){geoNote='Locatiebepaling is niet beschikbaar.';return;}
  if(watch!==null){stopGPS();return;}
  geoNote='Locatie zoeken…';
  watch=navigator.geolocation.watchPosition(pos=>{
    if(!active)return;
    const point=xy(pos.coords.longitude,pos.coords.latitude);
    if(net.nearest(point).gap>150){geoNote='Je locatie ligt buiten de Gentse padenkaart.';map.position=null;}else{map.position=point;geoNote='Je positie staat in cyaan op de kaart.';}
    map.schedule();if($('#gps-state'))$('#gps-state').textContent=geoNote;
  },()=>{stopGPS();geoNote='Je positie is niet beschikbaar. Je kunt de route op de kaart blijven volgen.';if($('#gps-state'))$('#gps-state').textContent=geoNote;},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
}
function running(){
  if(!active)return;
  modal('Rondje actief','<p>'+icon(mode==='run'?'run':'walk')+' '+(mode==='run'?'Lopen':'Wandelen')+' vanaf '+escapeText(active.place)+'</p><p class="run-time" id="timer"></p><p>Geplande afstand <b>'+km(active.meters)+' km</b> · <b>+'+active.points+' pts</b> bij voltooiing.</p><div class="dialog-actions"><button id="view-map" class="button ghost">'+icon('route')+'Bekijk kaart</button><button id="track" class="button ghost">'+icon('locate')+'Mijn positie</button></div><p class="fine" id="gps-state"></p><div class="dialog-actions"><button class="button aqua" id="finish">'+icon('flag')+'Rondje voltooid</button><button class="text-link" id="discard">Afbreken</button></div>',()=>clearInterval(activeTimer));
  const timer=()=>{if(active&&$('#timer'))$('#timer').textContent=duration(Date.now()-active.began);};timer();activeTimer=setInterval(timer,500);
  $('#gps-state').textContent=geoNote;$('#track').onclick=()=>{beginGPS();$('#gps-state').textContent=geoNote;};$('#view-map').onclick=()=>{closeModal();$('#map-frame').scrollIntoView({block:'center'});};
  $('#finish').onclick=finish;
  $('#discard').onclick=()=>{
    modal('Rondje afbreken?','<p>Bij afbreken vervallen de tijd en punten van dit rondje.</p><div class="dialog-actions"><button class="button aqua" id="resume">Verder lopen</button><button class="button ghost" id="confirm-discard">Rondje afbreken</button></div>');
    $('#resume').onclick=running;$('#confirm-discard').onclick=()=>{write('ongoing',null);active=null;stopGPS();closeModal();dirty();lockControls();};
  };
}
function finish(){
  if(!active)return;
  const item=active,end=Date.now();
  try{
    const list=history();if(!list.some(a=>a.id===item.id))write('activities',[{...item,end,elapsed:Math.max(0,end-item.began),note:'',voice:false},...list]);
    write('ongoing',null);
  }catch{toast('Je rondje kon nog niet worden bewaard. Maak opslagruimte vrij en probeer opnieuw.');return;}
  active=null;stopGPS();dirty();lockControls();page();toast('Rondje bewaard · +'+item.points+' punten');
  reflection(item.id,page,true);
}
$('#start-run').onclick=()=>{
  if(active){running();return;}if(!selected||$('#start-run').disabled)return;
  try{
    setPicking(false);
    active={id:crypto.randomUUID(),began:Date.now(),mode,place,from:startId,meters:selected.meters,height:selected.height,points:reward(selected.meters),path:selected.path,target:selected.target,requested:selected.requested||[],matches:selected.matches||[]};
    write('ongoing',active);
  }catch{active=null;toast('Je browser kan dit rondje niet bewaren. Controleer de lokale opslag.');return;}
  lockControls();status('Rondje actief');running();
};
$('#credits').onclick=()=>modal('Kaart & gegevens',
  '<p>De routeplanner gebruikt een lokale kaart van het centrum van Gent. Afstanden volgen de paden op die kaart. Punten worden toegekend wanneer je een rondje als voltooid bevestigt.</p>'+
  '<p>Voor natuur tellen stukken in of langs Gentse parken en tuinen mee. Voor water zoekt de planner paden die langs een rivier of vaart lopen. Architectuur telt mee wanneer je route binnen 55 meter van een van de negen geselecteerde gebouwen komt. De kaartpunten komen van <a href="https://visit.gent.be/nl/zien-doen/bezienswaardigheden/architectuur" target="_blank" rel="noreferrer">Visit Gent</a>.</p>'+
  '<p>De geschatte tijd rekent met 6 min/km voor lopen en 12 min/km voor wandelen. De stijging is een terreinschatting.</p><p>Activiteiten en opnames worden in deze browser bewaard.</p>'+
  '<p class="fine">Kaart © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap-bijdragers</a>, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">ODbL</a>. <a href="gent.json" download>Kaartdata downloaden</a>.<br>Hoogtes: Copernicus GLO-90 via <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noreferrer">Open-Meteo</a>.<br>Press Start 2P · <a href="font-license.txt">lettertypelicentie</a>.</p>');
async function initialize(){
  $('#start-place').disabled=true;
  try{
    const get=async file=>{const r=await fetch(file);if(!r.ok)throw Error(file);return r.json();};
    [data,grid]=await Promise.all([get('gent.json'),get('height.json').catch(()=>null)]);
    net=createNetwork(data);map=new RouteMap($('#map'),data);setStart(net.nearest(xy(popular[0][1],popular[0][2])).id,place);
    if(active&&history().some(a=>a.id===active.id)){active=null;write('ongoing',null);}
    if(active){
      setStart(active.from,active.place);$('#distance').value=active.target/1000;applyMode(active.mode);updateSlider();selectRoute(active);lockControls();
    }else await generate();
    page();
  }catch{
    status('Kaart niet geladen');feedback('De kaart kon niet worden geladen. Vernieuw de pagina om opnieuw te proberen.');$('#generate').disabled=true;
  }
}
page();updateSlider();initialize();
