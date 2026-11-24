import {$,icon,modal,toast,km,escapeText as esc} from '/ui.mjs';
import {api,player} from './account.mjs';
import {drawRouteMap} from '/social-map.mjs';
const label=p=>'<div><strong>'+esc(p.name)+'</strong><span>@'+esc(p.handle)+(p.kind==='bot'?' · demospeler':'')+'</span></div>';
const action=(p,key,text)=>'<button class="button ghost" data-person="'+p.id+'" data-action="'+key+'">'+text+'</button>';
function resultList(items,empty){return items.length?items.join(''):'<p class="empty">'+empty+'</p>';}
export async function renderFriends(){
  const pane=$('#friends');
  pane.innerHTML='<div class="dashboard-grid"><article class="panel"><h2 class="panel-heading">'+icon('users')+'Mijn vrienden</h2><div class="section-content stack" id="people">Vrienden laden…</div></article>'+
    '<article class="panel"><h2 class="panel-heading">'+icon('users')+'Vriend toevoegen</h2><div class="section-content"><label>Zoek op naam of gebruikersnaam<input id="people-search" class="input" type="search" placeholder="Bijv. Noor" autocomplete="off"></label><div id="suggestions" class="stack" aria-live="polite"></div></div></article>'+
    '<article class="panel"><div class="panel-heading"><h2>'+icon('activity')+'Vriendenfeed</h2><button id="refresh-feed" class="text-link">Vernieuwen</button></div><div id="feed" class="section-content stack"></div></article>'+
    '<article class="panel"><h2 class="panel-heading">'+icon('trophy')+'Weekklassement</h2><div id="friend-ranks" class="section-content stack"></div></article></div>';
  const search=$('#people-search');let version=0,timer;
  async function refresh(){
    const ticket=++version;
    try{
      const s=await api('friends?q='+encodeURIComponent(search.value.trim()));if(!search.isConnected||ticket!==version)return;
      const accepted=s.people.filter(p=>p.accepted),pending=s.people.filter(p=>!p.accepted);
      $('#people').innerHTML=resultList(pending.map(p=>'<div class="activity-row">'+label(p)+'<div class="dialog-actions">'+(p.sender===player.id?'<span>Verzoek verstuurd</span>':action(p,'accept','Accepteren')+action(p,'decline','Weigeren'))+'</div></div>')
        .concat(accepted.map(p=>'<div class="activity-row">'+label(p)+'</div>')),'Zoek iemand op en verstuur je eerste vriendschapsverzoek.');
      $('#suggestions').innerHTML=resultList(s.suggestions.map(p=>'<div class="activity-row">'+label(p)+action(p,'request','Toevoegen')+'</div>'),'Geen nieuwe spelers gevonden.');
      $('#feed').innerHTML=resultList(s.feed.map((a,i)=>'<div class="activity-row"><div><strong>'+esc(a.name)+' · '+(a.mode==='run'?'Lopen':'Wandelen')+'</strong><span>'+km(a.meters)+' km · '+Math.max(1,Math.round(a.elapsed/60000))+' min · '+new Date(a.end).toLocaleDateString('nl-BE',{day:'numeric',month:'short'})+'</span></div>'+(a.lines?.length?'<button class="text-link" data-path="'+i+'">Bekijk route</button>':'<span>+'+a.points+' pts</span>')+'</div>'),'Hier verschijnen de rondjes die je vrienden delen.');
      const ranked=[...accepted,player].sort((a,b)=>s.points[b.id]-s.points[a.id]);
      $('#friend-ranks').innerHTML=ranked.map((p,i)=>'<div class="activity-row"><div><span class="rank">'+(i+1)+'</span> &nbsp;'+esc(p.id===player.id?'Jij':p.name)+'</div><b>'+s.points[p.id]+' pts</b></div>').join('');
      pane.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{
        b.disabled=true;try{await api('friend',{id:Number(b.dataset.person),action:b.dataset.action});await refresh();}catch(e){toast(e.message);b.disabled=false;}
      });
      pane.querySelectorAll('[data-path]').forEach(b=>b.onclick=()=>{
        const row=s.feed[Number(b.dataset.path)];
        modal('Rondje van '+row.name,'<p>'+km(row.meters)+' km · '+(row.mode==='run'?'Lopen':'Wandelen')+'</p><canvas class="shared-route-map" id="friend-map" aria-label="Gedeeld deel van de route"></canvas><p class="fine">De zone rond het startpunt is verborgen. © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a></p>');
        drawRouteMap($('#friend-map'),row.lines).catch(e=>toast(e.message));
      });
    }catch(e){if(search.isConnected)$('#suggestions').textContent=e.message;}
  }
  search.oninput=()=>{version++;clearTimeout(timer);timer=setTimeout(refresh,160);};
  $('#refresh-feed').onclick=refresh;
  const updates=setInterval(()=>{
    if(!search.isConnected||pane.hidden){clearInterval(updates);return;}
    if(!document.hidden&&!$('#dialog').open&&!pane.contains(document.activeElement))refresh();
  },30000);
  await refresh();
}
