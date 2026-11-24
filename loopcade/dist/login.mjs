import {api} from './account.mjs';
const el=id=>document.getElementById(id);
let signup=false,busy=false;
const destination=()=>'/'+(location.hash||'#planner');
function choose(value){
  signup=value;el('tab-signup').setAttribute('aria-pressed',String(value));el('tab-login').setAttribute('aria-pressed',String(!value));
  el('display-wrap').hidden=!value;el('display').required=value;
  el('auth-title').textContent=value?'Maak je account':'Welkom terug';
  el('auth-submit').textContent=value?'Account aanmaken':'Inloggen';
  el('password').autocomplete=value?'new-password':'current-password';el('password').minLength=value?8:1;
  el('password').placeholder=value?'Minstens 8 tekens':'';
  el('handle').placeholder=value?'Bijv. noor_loopt':'';
  if(value)el('handle').pattern='[A-Za-z0-9_]{3,24}';else el('handle').removeAttribute('pattern');
  el('handle').title=value?'3 tot 24 letters, cijfers of underscores':'';
  el('auth-error').textContent='';
}
el('tab-login').onclick=()=>choose(false);el('tab-signup').onclick=()=>choose(true);
async function enter(path,data){
  if(busy)return;busy=true;el('auth-error').textContent='';
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await api(path,data);location.replace(destination());}
  catch(e){el('auth-error').textContent=e.message;busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
el('auth-form').onsubmit=e=>{e.preventDefault();enter(signup?'signup':'login',{naam:el('display').value,gebruikersnaam:el('handle').value,wachtwoord:el('password').value});};
el('demo').onclick=()=>enter('demo',{});
document.querySelectorAll('button').forEach(b=>b.disabled=false);
