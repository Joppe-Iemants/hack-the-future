import {$,icon,modal,closeModal,toast,km,duration,escapeText,periodStart,speak} from './ui.mjs';
import {getStorageState, saveReflection, readLocalActivities} from './storage.mjs';
import {readAudio, writeAudio} from './audio.mjs';
import {openAccount, migrateLocalData} from './account.mjs';

export const history=()=>getStorageState().activities.map(item=>({...item}));
const dateLabel=time=>new Date(time).toLocaleDateString('nl-BE',{weekday:'short',day:'numeric',month:'short'});

export function reflection(id,onSaved,prompt=false){
  const item=history().find(a=>a.id===id);if(!item)return;
  let recorder,stream,url,closed=false;
  const question='Wat was een fijn moment onderweg?';
  modal('Jouw terugblik',
    '<p>'+question+'</p><textarea id="note" class="input" maxlength="500" rows="3" aria-label="Jouw fijne moment" placeholder="Schrijf hier één zin…">'+escapeText(item.note||'')+'</textarea>'+
    '<div class="dialog-actions"><button class="button ghost" id="record">'+icon('mic')+'Spreek iets in</button><button class="button ghost" id="hear-question">'+icon('listen')+'Hoor de vraag</button></div>'+
    '<p class="fine">Audio blijft uitsluitend in IndexedDB op dit toestel en is niet op andere toestellen beschikbaar.</p><p class="fine" id="clip-state" role="status"></p><div id="clip-preview"></div><div class="dialog-actions"><button class="button aqua" id="save-note">Bewaar terugblik</button><button class="button ghost" id="skip-note">Sluiten</button></div>',
    ()=>{closed=true;if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);speechSynthesisSafeCancel();});
  const preview=blob=>{
    if(!blob||closed)return;
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
    $('#clip-preview').innerHTML='<audio controls aria-label="Jouw spraakbericht"></audio>';
    $('#clip-preview audio').src=url;
  };
  let pending=null;
  readAudio(id).then(b=>{
    if(pending)return;
    if(b)preview(b);else if(item.voice)$('#clip-state').textContent='Deze activiteit vermeldt audio, maar op dit toestel is geen bijbehorende opname gevonden.';
  }).catch(()=>{if(!closed)$('#clip-state').textContent='Lokale audio kan nu niet worden geopend. Je tekst kun je wel bewaren.';});
  if(prompt)speak(question);
  $('#hear-question').onclick=()=>speak(question);
  $('#skip-note').onclick=closeModal;
  $('#record').onclick=async()=>{
    if(recorder?.state==='recording'){recorder.stop();return;}
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('#clip-state').textContent='Je browser ondersteunt hier geen opname. Je kunt je moment hierboven opschrijven.';return;}
    const button=$('#record');button.disabled=true;
    try{
      speechSynthesisSafeCancel();
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(closed){stream.getTracks().forEach(t=>t.stop());return;}
      recorder=new MediaRecorder(stream);const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{
        clearTimeout(limit);stream.getTracks().forEach(t=>t.stop());if(closed)return;
        pending=new Blob(chunks,{type:recorder.mimeType});preview(pending);button.innerHTML=icon('mic')+'Opnieuw opnemen';
        $('#clip-state').textContent='Je opname is klaar om lokaal te bewaren.';$('#save-note').disabled=false;
      };
      recorder.start();const limit=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
      $('#clip-state').textContent='Opname loopt · maximaal 1 minuut';button.textContent='Stop opname';$('#save-note').disabled=true;
    }catch{stream?.getTracks().forEach(t=>t.stop());if(!closed)$('#clip-state').textContent='De microfoon is niet beschikbaar. Je kunt ook een zin typen.';}
    finally{if(!closed)button.disabled=false;}
  };
  $('#save-note').onclick=async()=>{
    const text=$('#note').value.trim(),button=$('#save-note');button.disabled=true;
    $('#clip-state').textContent='Terugblik bewaren…';
    try{
      if(pending)await writeAudio(id,pending);
      await saveReflection(id,{note:text,voice:Boolean(pending)||item.voice});
      closeModal();await onSaved?.();toast('Je terugblik is bewaard.');
    }catch(error){
      console.error('Loopcade terugblik bewaren:',error);
      $('#clip-state').textContent='Bewaren lukte niet. Je wijziging is niet als opgeslagen gemarkeerd. Controleer je verbinding of lokale opslag en probeer opnieuw.';button.disabled=false;
    }
  };
}
function speechSynthesisSafeCancel(){window.speechSynthesis?.cancel();}

function recap(period){
  const all=history().filter(a=>a.end>=periodStart(period)), name=period==='month'?'deze maand':'deze week';
  let closed=false,playing,url,playId=0;
  const stop=()=>{playId++;speechSynthesisSafeCancel();if(playing){playing.pause();playing=null;}if(url){URL.revokeObjectURL(url);url=null;}};
  const distance=all.reduce((s,a)=>s+a.meters,0);
  const intro=all.length?'Je hebt '+name+' '+all.length+(all.length===1?' rondje':' rondjes')+' afgelegd, samen '+km(distance)+' kilometer.':'Je hebt '+name+' nog geen rondjes afgerond.';
  const moments=all.filter(a=>a.note||a.voice).sort((a,b)=>a.end-b.end).slice(-3);
  modal('Gesproken terugblik','<p>'+intro+'</p><p class="fine">Spraakberichten zijn alleen beschikbaar als ze op dit toestel en onder dit account zijn opgenomen.</p>'+moments.map(a=>'<div class="activity-row"><div><strong>'+escapeText(dateLabel(a.end))+'</strong><span>'+escapeText(a.note||'Ingesproken moment')+'</span></div></div>').join('')+
    (all.length?'<div class="dialog-actions"><button class="button aqua" id="listen">'+icon('play')+'Speel terugblik af</button><button class="button ghost" id="stop-recap">Stop</button></div><p id="recap-state" class="fine"></p>':''),()=>{closed=true;stop();});
  if(!all.length)return;
  $('#stop-recap').onclick=()=>{stop();$('#recap-state').textContent='Afspelen gestopt.';};
  $('#listen').onclick=async()=>{
    stop();const version=playId;
    $('#recap-state').textContent='Terugblik wordt afgespeeld.';
    await speak(intro);
    for(const a of moments){
      if(closed||version!==playId)return;
      let clip;try{if(a.voice)clip=await readAudio(a.id);}catch{}
      if(closed||version!==playId)return;
      await speak(dateLabel(a.end)+(clip?'':'. '+a.note));
      if(closed||version!==playId)return;
      if(clip){
        url=URL.createObjectURL(clip);playing=new Audio(url);
        await new Promise(resolve=>{playing.onended=playing.onerror=playing.onpause=resolve;playing.play().catch(resolve);});
        if(closed||version!==playId)return;
        URL.revokeObjectURL(url);url=null;playing=null;
      }
    }
    if(!closed&&version===playId)$('#recap-state').textContent=window.speechSynthesis?'Einde van je terugblik.':'Je browser ondersteunt geen voorleesstem. Je kunt de terugblik hierboven lezen.';
  };
}

function migrationCard(state){
  if(!state.user||!readLocalActivities().length)return '';
  return '<article class="panel full"><h2 class="panel-heading">'+icon('save')+'Lokale activiteiten</h2><div class="section-content"><p>Er staan lokale activiteiten op dit toestel. Importeer ze alleen als ze bij dit account horen. Bestaande activiteit-ID’s worden overgeslagen en lokale kopieën blijven behouden.</p><div class="dialog-actions"><button class="button ghost" id="migrate-activities">'+(state.migration?'Opnieuw controleren':'Importeer naar dit account')+'</button></div><p class="fine" id="migration-state" role="status">'+(state.migration?state.migration.imported+' geïmporteerd · '+state.migration.skipped+' al aanwezig. Lokale kopieën zijn behouden.':'')+'</p></div></article>';
}

export function renderActivities(){
  const state=getStorageState(),list=history().sort((a,b)=>b.end-a.end);
  const high=Math.max(0,...list.map(r=>r.meters)),ascent=Math.max(0,...list.map(r=>r.height||0));
  let notice='';
  if(state.configured&&!state.user)notice='<article class="panel full"><div class="section-content"><p>Log in of ga als gast verder om activiteiten per gebruiker in Firestore te openen en te bewaren.</p><button class="button aqua" id="activities-login">Inloggen of gastaccount</button></div></article>';
  else if(state.status==='loading')notice='<article class="panel full"><div class="section-content"><p role="status">Je activiteiten worden geladen…</p></div></article>';
  else if(state.status==='error')notice='<article class="panel full"><div class="section-content"><p class="error" role="alert">'+escapeText(state.error)+'</p><button class="button ghost" id="activities-retry">Opnieuw proberen</button></div></article>';
  else if(!state.configured)notice='<article class="panel full"><div class="section-content"><p class="error">Firebase is niet geconfigureerd: onderstaande activiteiten staan alleen lokaal in deze browser.</p></div></article>';
  $('#activities').innerHTML=notice+migrationCard(state)+'<div class="dashboard-grid"><article class="panel"><h2 class="panel-heading">'+icon('trophy')+'Persoonlijke records</h2><div class="section-content record-grid"><div><strong>'+km(high)+'</strong>km · langste rondje</div><div><strong>'+ascent+'</strong>m · meeste stijging</div><div><strong>'+list.length+'</strong>voltooide rondjes</div></div></article>'+
    '<article class="panel"><h2 class="panel-heading">'+icon('mic')+'Gesproken terugblik</h2><div class="section-content"><p>Luister naar je rondjes en de fijne momenten die je hebt bewaard. Audio blijft alleen op dit toestel.</p><div class="dialog-actions"><button class="button ghost" id="week-recap">Deze week</button><button class="button ghost" id="month-recap">Deze maand</button></div></div></article>'+
    '<article class="panel full"><h2 class="panel-heading">'+icon('activity')+'Recente activiteiten</h2><div class="section-content">'+(list.length?'<div class="stack">'+list.map(a=>'<div class="activity-row"><div><strong>'+icon(a.mode==='run'?'run':'walk')+' '+(a.mode==='run'?'Lopen':'Wandelen')+' · '+km(a.meters)+' km</strong><span>'+escapeText(a.place)+' · '+dateLabel(a.end)+' · '+duration(a.elapsed)+' · +'+a.points+' pts</span></div><button data-note="'+escapeText(a.id)+'" class="button ghost">'+icon('mic')+'Terugblik</button></div>').join('')+'</div>':'<p>Na je eerste rondje vind je hier je afstand, tijd en punten.</p><a class="button aqua" href="#planner">Plan mijn rondje</a>')+'</div></article></div>';
  if($('#activities-login'))$('#activities-login').onclick=openAccount;
  if($('#activities-retry'))$('#activities-retry').onclick=()=>location.reload();
  if($('#migrate-activities'))$('#migrate-activities').onclick=async()=>{
    const button=$('#migrate-activities');button.disabled=true;$('#migration-state').textContent='Lokale activiteiten importeren…';
    try{
      const result=await migrateLocalData();
      $('#migration-state').textContent=result.imported+' geïmporteerd · '+result.skipped+' al aanwezig. Lokale kopieën zijn behouden.'+result.audioWarning;
      toast('Lokale activiteiten zijn verwerkt.');renderActivities();
    }catch(error){$('#migration-state').textContent=error.message||'Importeren lukte niet. Probeer opnieuw.';button.disabled=false;}
  };
  $('#week-recap').onclick=()=>recap('week');$('#month-recap').onclick=()=>recap('month');
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>reflection(b.dataset.note,renderActivities));
}
