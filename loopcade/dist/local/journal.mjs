import {$,icon,modal,closeModal,toast,km,duration,escapeText,read,write,periodStart,speak} from '/ui.mjs';
import {api,history,player,remember,currentRun,storeRun} from './account.mjs';

export {history};
const dateLabel=time=>new Date(time).toLocaleDateString('nl-BE',{weekday:'short',day:'numeric',month:'short'});
async function legacyClip(id) {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('loopcade-audio',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('clips');
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('clips','readonly'),store=tx.objectStore('clips');
    const req=store.get(id);
    tx.oncomplete=()=>resolve(req.result);tx.onabort=tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}
}
async function audioStore(id){
  const res=await fetch('/api/clip?id='+encodeURIComponent(id),{headers:{'X-Player':String(player.id)}});
  if(!res.ok)throw Error('De opname kon niet worden geladen.');
  return res.blob();
}
async function clipData(blob){
  if(!blob)return {};
  const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  return {clip:url.split(',')[1],mime:blob.type};
}

export function reflection(id,onSaved,prompt=false){
  const item=history().find(a=>a.id===id);if(!item)return;
  let recorder,stream,url,closed=false;
  const question='Wat was een fijn moment onderweg?';
  modal('Jouw terugblik',
    '<p>'+question+'</p><textarea id="note" class="input" maxlength="500" rows="3" aria-label="Jouw fijne moment" placeholder="Schrijf hier één zin…">'+escapeText(item.note||'')+'</textarea>'+
    '<div class="dialog-actions"><button class="button ghost" id="record">'+icon('mic')+'Spreek iets in</button><button class="button ghost" id="hear-question">'+icon('listen')+'Hoor de vraag</button></div>'+
    '<p class="fine" id="clip-state" role="status"></p><div id="clip-preview"></div><div class="dialog-actions"><button class="button aqua" id="save-note">Bewaar terugblik</button><button class="button ghost" id="skip-note">Sluiten</button></div>',
    ()=>{closed=true;if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());if(url)URL.revokeObjectURL(url);speechSynthesisSafeCancel();});
  const preview=blob=>{
    if(!blob||closed)return;
    if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);
    $('#clip-preview').innerHTML='<audio controls aria-label="Jouw spraakbericht"></audio>';
    $('#clip-preview audio').src=url;
  };
  let pending=null;
  if(item.voice)audioStore(id).then(b=>{if(!pending)preview(b);}).catch(()=>{if(!closed)$('#clip-state').textContent='Je opname kon niet worden geladen.';});
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
        $('#clip-state').textContent='Je opname is klaar om te bewaren.';$('#save-note').disabled=false;
      };
      recorder.start();const limit=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
      $('#clip-state').textContent='Opname loopt · maximaal 1 minuut';button.textContent='Stop opname';$('#save-note').disabled=true;
    }catch{stream?.getTracks().forEach(t=>t.stop());if(!closed)$('#clip-state').textContent='De microfoon is niet beschikbaar. Je kunt ook een zin typen.';}
    finally{if(!closed)button.disabled=false;}
  };
  $('#save-note').onclick=async()=>{
    const text=$('#note').value.trim(),button=$('#save-note');button.disabled=true;
    try{
      await api('note',{id,note:text,...await clipData(pending)});
      remember({...item,note:text,voice:Boolean(pending)||item.voice});closeModal();onSaved();toast('Je terugblik is bewaard.');
    }catch(error){if(!closed){$('#clip-state').textContent=error.message;button.disabled=false;}}
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
  modal('Gesproken terugblik','<p>'+intro+'</p>'+moments.map(a=>'<div class="activity-row"><div><strong>'+escapeText(dateLabel(a.end))+'</strong><span>'+escapeText(a.note||'Ingesproken moment')+'</span></div></div>').join('')+
    (all.length?'<div class="dialog-actions"><button class="button aqua" id="listen">'+icon('play')+'Speel terugblik af</button><button class="button ghost" id="stop-recap">Stop</button></div><p id="recap-state" class="fine"></p>':''),()=>{closed=true;stop();});
  if(!all.length)return;
  $('#stop-recap').onclick=()=>{stop();$('#recap-state').textContent='Afspelen gestopt.';};
  $('#listen').onclick=async()=>{
    stop();const version=playId;
    $('#recap-state').textContent='Terugblik wordt afgespeeld.';
    await speak(intro);
    for(const a of moments){
      if(closed||version!==playId)return;
      let clip;try{if(a.voice)clip=await audioStore(a.id);}catch{}
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

export function renderActivities(){
  const list=history().sort((a,b)=>b.end-a.end);
  const high=Math.max(0,...list.map(r=>r.meters)),ascent=Math.max(0,...list.map(r=>r.height||0));
  $('#activities').innerHTML='<div class="dashboard-grid"><article class="panel"><h2 class="panel-heading">'+icon('trophy')+'Persoonlijke records</h2><div class="section-content record-grid"><div><strong>'+km(high)+'</strong>km · langste rondje</div><div><strong>'+ascent+'</strong>m · meeste stijging</div><div><strong>'+list.length+'</strong>voltooide rondjes</div></div></article>'+
    '<article class="panel"><h2 class="panel-heading">'+icon('mic')+'Gesproken terugblik</h2><div class="section-content"><p>Luister naar je rondjes en de fijne momenten die je hebt bewaard.</p><div class="dialog-actions"><button class="button ghost" id="week-recap">Deze week</button><button class="button ghost" id="month-recap">Deze maand</button></div></div></article>'+
    '<article class="panel full"><h2 class="panel-heading">'+icon('activity')+'Recente activiteiten</h2><div class="section-content">'+(list.length?'<div class="stack">'+list.map(a=>'<div class="activity-row"><div><strong>'+icon(a.mode==='run'?'run':'walk')+' '+(a.mode==='run'?'Lopen':'Wandelen')+' · '+km(a.meters)+' km</strong><span>'+escapeText(a.place)+' · '+dateLabel(a.end)+' · '+duration(a.elapsed)+' · +'+a.points+' pts</span></div><button data-note="'+escapeText(a.id)+'" class="button ghost">'+icon('mic')+'Terugblik</button></div>').join('')+'</div>':'<p>Na je eerste rondje vind je hier je afstand, tijd en punten.</p><a class="button aqua" href="#planner">Plan mijn rondje</a>')+'</div></article></div>';
  $('#week-recap').onclick=()=>recap('week');$('#month-recap').onclick=()=>recap('month');
  document.querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>reflection(b.dataset.note,renderActivities));
  for(const button of document.querySelectorAll('[data-note]')){
    const a=list.find(item=>item.id===button.dataset.note),label=document.createElement('label');
    label.className='share-toggle';label.innerHTML='<input type="checkbox"> Zichtbaar voor vrienden';
    const check=label.querySelector('input');check.checked=a.shared;button.before(label);
    check.onchange=async()=>{check.disabled=true;try{await api('sharing',{id:a.id,shared:check.checked});remember({...a,shared:check.checked});}catch(e){check.checked=a.shared;toast(e.message);}finally{check.disabled=false;}};
  }
  const legacy=read('activities',[]),ongoing=read('ongoing',null),owner=read('legacy-owner',null);
  if(player.kind==='user' && (!owner||owner===player.id) && !read('legacy-done',false) && (legacy.length||ongoing)){
    const importBtn=document.createElement('button');importBtn.className='button ghost';
    importBtn.textContent='Eerdere rondjes van dit toestel overnemen';$('#activities').prepend(importBtn);
    importBtn.onclick=()=>{
      modal('Rondjes overnemen','<p>Voeg je eerdere lokale rondjes, privénotities en opnames toe aan dit account. Je bepaalt achteraf welke activiteiten je deelt.</p><button class="button aqua" id="claim-local">Overnemen in mijn account</button><p class="error" id="claim-error"></p>');
      $('#claim-local').onclick=async e=>{
        const b=e.currentTarget;b.disabled=true;
        try{
          if(ongoing&&currentRun())throw Error('Rond je huidige activiteit eerst af.');
          write('legacy-owner',player.id);
          for(const a of legacy){
            const row=await api('import-activity',a);
            if(a.voice){const blob=await legacyClip(a.id);if(blob)await api('note',{id:a.id,note:a.note||'',...await clipData(blob)});}
            remember(row);
          }
          if(ongoing && !history().some(a=>a.id===ongoing.id))storeRun({...ongoing,shared:false});
          write('legacy-done',true);location.reload();
        }catch(error){$('#claim-error').textContent=error.message;b.disabled=false;}
      };
    };
  }
}
