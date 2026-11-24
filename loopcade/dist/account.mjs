export let player=null;
let activities=[];
export const history=()=>activities.slice();

export async function api(path,body){
  const options={headers:{},cache:'no-store'};
  if(player)options.headers['X-Player']=String(player.id);
  if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  const response=await fetch('/api/'+path,options);
  let result;
  try{result=await response.json();}catch{throw Error('De accountserver is niet bereikbaar. Open de app via de plan2run-server.');}
  if(!response.ok){
    if(response.status===401 && !location.pathname.endsWith('login.html'))location.replace('/login.html'+location.hash);
    throw Error(result.error||'Probeer het opnieuw.');
  }
  return result;
}
export async function loadAccount(){
  const result=await api('me');player=result.user;activities=result.activities;
}
export function remember(item){activities=[item,...activities.filter(a=>a.id!==item.id)];}
export function currentRun(){
  try{return JSON.parse(localStorage.getItem('plan2run-run-'+player.id));}catch{return null;}
}
export function storeRun(run){
  const key='plan2run-run-'+player.id;
  if(run)localStorage.setItem(key,JSON.stringify(run));else localStorage.removeItem(key);
}
