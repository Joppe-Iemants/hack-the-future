import {$,icon,modal,closeModal,toast,km,escapeText,read,write,periodStart} from './ui.mjs';
import {history} from './journal.mjs';
import {reward} from './router.mjs';
const friends=()=>read('friends',[]);
const weekPoints=items=>items.filter(a=>a.end>=periodStart('week')).reduce((sum,a)=>sum+reward(a.meters),0);
function player(){
  let p=read('player',null);if(!p){p={id:crypto.randomUUID(),name:'Speler 1'};write('player',p);}return p;
}
// Cut every visit to the start area, including intermediate returns.
function discreetPath(points){
  if(!points?.length)return [];
  const start=points[0],parts=[];let current=[];
  for(const point of points){
    if(Math.hypot(point[0]-start[0],point[1]-start[1])<350){if(current.length>1)parts.push(current);current=[];continue;}
    if(!current.length||Math.hypot(point[0]-current.at(-1)[0],point[1]-current.at(-1)[1])>20)current.push(point);
  }
  if(current.length>1)parts.push(current);return parts;
}
function exportCard(){
  const p=player();
  modal('Deel je weekkaart','<p>Bewaar een bestand voor je vrienden met je rondjes en weekpunten. Je spraakberichten en notities blijven op dit toestel.</p><label class="field-label">Spelersnaam<input class="input" id="alias" maxlength="25" value="'+escapeText(p.name)+'"></label><label><input type="checkbox" id="share-lines"> Voeg routekaarten toe</label><p class="fine">Bij gedeelde kaarten verbergen we de route binnen 350 meter van je startpunt.</p><button class="button aqua" id="download">'+icon('save')+'Bewaar weekkaart</button>');
  $('#download').onclick=()=>{
    p.name=$('#alias').value.trim()||'Speler 1';write('player',p);
    const withPaths=$('#share-lines').checked;
    const activities=history().filter(a=>a.end>=periodStart('week')).map(a=>({mode:a.mode,end:a.end,meters:a.meters,lines:withPaths?discreetPath(a.path):[]}));
    const blob=new Blob([JSON.stringify({format:'loopcade-week-1',player:p,activities})],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='loopcade-weekkaart.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    closeModal();renderFriends();toast('Je weekkaart is klaar om te delen.');
  };
}
async function importCard(file){
  if(!file||file.size>2_000_000)throw Error('Kies een Loopcade-weekkaart van maximaal 2 MB.');
  const data=JSON.parse(await file.text());
  if(data.format!=='loopcade-week-1'||!data.player||typeof data.player.name!=='string'||typeof data.player.id!=='string'||data.player.id.length>80||!Array.isArray(data.activities)||data.activities.length>500)throw Error('Dit bestand is geen geldige Loopcade-weekkaart.');
  if(player().id===data.player.id)throw Error('Dit is je eigen weekkaart. Kies het bestand van een vriend.');
  const activities=data.activities.map(a=>{
    if(!['run','walk'].includes(a.mode)||!Number.isFinite(a.end)||a.end>Date.now()+600000||a.end<0||!Number.isFinite(a.meters)||a.meters<=0||a.meters>50000)throw Error('Deze weekkaart bevat ongeldige activiteiten.');
    const lines=Array.isArray(a.lines)?a.lines.filter(s=>Array.isArray(s)&&s.length>1&&s.length<5000&&s.every(p=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<20000))):[];
    return {mode:a.mode,end:a.end,meters:a.meters,lines};
  });
  const card={id:data.player.id,name:data.player.name.slice(0,25),activities};
  write('friends',[...friends().filter(f=>f.id!==card.id),card]);renderFriends();toast('De weekkaart van '+card.name+' is bijgewerkt.');
}
function viewPath(row){
  modal('Gedeeld rondje','<p>'+escapeText(row.name)+' · '+km(row.meters)+' km</p><canvas id="shared-map" width="600" height="330" aria-label="Gedeeld deel van de route" style="width:100%;background:#1b192b"></canvas><p class="fine">De eerste en laatste 350 meter rond het startpunt zijn verborgen.</p>');
  const canvas=$('#shared-map'),c=canvas.getContext('2d'),points=row.lines.flat();
  let x1=Infinity,x2=-Infinity,y1=Infinity,y2=-Infinity;
  for(const [x,y] of points){x1=Math.min(x1,x);x2=Math.max(x2,x);y1=Math.min(y1,y);y2=Math.max(y2,y);}
  const s=Math.min(540/Math.max(1,x2-x1),270/Math.max(1,y2-y1));
  c.strokeStyle='#343044';c.lineWidth=1;for(let n=0;n<600;n+=25){c.beginPath();c.moveTo(n,0);c.lineTo(n,330);c.moveTo(0,n);c.lineTo(600,n);c.stroke();}
  c.strokeStyle='#ff70c2';c.lineWidth=4;c.lineJoin='round';c.lineCap='round';
  for(const line of row.lines){c.beginPath();line.forEach(([x,y],i)=>{const px=300+(x-(x1+x2)/2)*s,py=165-(y-(y1+y2)/2)*s;if(i)c.lineTo(px,py);else c.moveTo(px,py);});c.stroke();}
}
export function renderFriends(){
  const imported=friends(),entries=[{name:'Jij',items:history()},...imported.map(f=>({name:f.name,items:f.activities}))].sort((a,b)=>weekPoints(b.items)-weekPoints(a.items));
  const feed=imported.flatMap(f=>f.activities.map(a=>({...a,name:f.name}))).sort((a,b)=>b.end-a.end).slice(0,30);
  $('#friends').innerHTML='<div class="dashboard-grid"><article class="panel"><h2 class="panel-heading">'+icon('trophy')+'Weekklassement</h2><div class="section-content"><p>De punten van maandag tot zondag uit de laatst gedeelde weekkaarten.</p><div class="stack">'+entries.map((p,i)=>'<div class="activity-row"><div><span class="rank">'+String(i+1).padStart(2,'0')+'</span> &nbsp;'+escapeText(p.name)+'</div><b>'+weekPoints(p.items)+' pts</b></div>').join('')+'</div></div></article>'+
  '<article class="panel"><h2 class="panel-heading">'+icon('users')+'Weekkaarten</h2><div class="section-content"><p>Wissel een weekkaart uit met een vriend. Importeer een nieuwe kaart om diens punten en rondjes bij te werken.</p><div class="dialog-actions"><button class="button aqua" id="export-card">Mijn weekkaart</button><button class="button ghost" id="import-card">Importeren</button><input type="file" id="friend-file" accept=".json,application/json" hidden></div><p class="fine error" id="friend-error" role="status"></p></div></article>'+
  '<article class="panel full"><h2 class="panel-heading">'+icon('route')+'Rondjes van vrienden</h2><div class="section-content">'+(feed.length?'<div class="stack">'+feed.map((a,i)=>'<div class="activity-row"><div><strong>'+escapeText(a.name)+' · '+km(a.meters)+' km</strong><span>'+(a.mode==='run'?'Lopen':'Wandelen')+' · '+new Date(a.end).toLocaleDateString('nl-BE')+'</span></div>'+(a.lines.length?'<button class="button ghost" data-friend-route="'+i+'">Bekijk route</button>':'<span>Alleen activiteit gedeeld</span>')+'</div>').join('')+'</div>':'<p>Importeer de weekkaart van een vriend om hier diens recente rondjes te zien.</p>')+'</div></article></div>';
  $('#export-card').onclick=exportCard;$('#import-card').onclick=()=>$('#friend-file').click();
  $('#friend-file').onchange=async e=>{try{await importCard(e.target.files[0]);}catch(error){$('#friend-error').textContent=error instanceof SyntaxError?'Het bestand bevat geen geldige weekkaart.':error.message;}finally{e.target.value='';}};
  document.querySelectorAll('[data-friend-route]').forEach(b=>b.onclick=()=>viewPath(feed[Number(b.dataset.friendRoute)]));
}
