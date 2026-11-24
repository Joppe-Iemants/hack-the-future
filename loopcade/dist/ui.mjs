const paths = {
  route:'<circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7.5 17H15a3 3 0 0 0 0-6H9a2.5 2.5 0 1 1 0-5h7"/>',
  activity:'<path d="M2 13h5l3-8 4 14 3-8 2 2h3"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  coin:'<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M10 7h4v10h-4z"/>',
  sliders:'<path d="M3 6h5m5 0h8M3 12h11m5 0h2M3 18h2m5 0h11"/><path d="M8 4h5v4H8zm6 6h5v4h-5zm-9 6h5v4H5z"/>',
  run:'<circle cx="15" cy="4" r="2"/><path d="m4 11 4-3 4 1 3 4 5-1m-8-3-3 6 5 2 1 5m-6-8-3 4H2"/>',
  walk:'<circle cx="13" cy="4" r="2"/><path d="m6 13 3-5 4-1 2 5 4 2m-6-6-2 7 4 6m-4-6-4 7"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  shuffle:'<path d="M3 6h3c4 0 7 12 11 12h4m-4-4 4 4-4 4M3 18h3c2 0 3.5-2.8 5-6m3-4c1-1.5 2.1-2 3-2h4m-4-4 4 4-4 4"/>',
  frame:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mountain:'<path d="m2 20 8-15 5 9 3-5 5 11zM7 11l3 2 2-3"/>',
  signal:'<path d="M3 18h3v3H3zm6-5h3v8H9zm6-5h3v13h-3z" fill="currentColor" stroke="none"/>',
  play:'<path d="m6 3 14 9-14 9z" fill="currentColor" stroke="none"/>',
  flag:'<path d="M5 21V4m0 0c6-5 9 4 15-1v10c-6 5-9-4-15 1"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/>',
  trophy:'<path d="M7 3h10v7a5 5 0 0 1-10 0zm0 2H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4m-4 4v4m-5 1h10"/>',
  mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  listen:'<path d="M3 10h4l6-5v14l-6-5H3zm13-2a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/>',
  save:'<path d="M4 4h13l3 3v13H4zM8 4v6h8V4m-8 16v-6h8v6"/>',
};
export function icon(key){return '<i data-icon="'+key+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[key]||'')+'</svg></i>';}
export const $ = selector=>document.querySelector(selector);
export const escapeText = text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const km = m=>(m/1000).toLocaleString('nl-BE',{minimumFractionDigits:1,maximumFractionDigits:1});
export const duration = ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');};
export function toast(text){$('#toast').textContent=text;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').textContent='',4500);}
let cleanup;
export function modal(title,html,onClose){
  const d=$('#dialog');
  if(d.open)cleanup?.();
  cleanup=onClose;$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;
  if(!d.open)d.showModal();
}
export const closeModal=()=>$('#dialog').close();
$('#dialog-close').onclick=closeModal;
$('#dialog').addEventListener('close',()=>{cleanup?.();cleanup=null;});
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
document.querySelectorAll('i[data-icon]').forEach(el=>el.outerHTML=icon(el.dataset.icon));

export function read(key,fallback){
  try{return JSON.parse(localStorage.getItem('loopcade-'+key))??fallback;}catch{return fallback;}
}
export function write(key,value){localStorage.setItem('loopcade-'+key,JSON.stringify(value));}
export function periodStart(period, now=new Date()){
  const d=new Date(now);d.setHours(0,0,0,0);
  if(period==='month')d.setDate(1);else d.setDate(d.getDate()-(d.getDay()+6)%7);return d.getTime();
}
export function speak(text){
  return new Promise(resolve=>{
    if(!window.speechSynthesis){resolve();return;}
    window.speechSynthesis.cancel();const msg=new SpeechSynthesisUtterance(text);
    msg.lang='nl-BE';msg.rate=.95;msg.onend=msg.onerror=resolve;speechSynthesis.speak(msg);
  });
}
