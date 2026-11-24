import {loadAccount} from './account.mjs';
try{
  await loadAccount();
  await import('./app.mjs');
  document.body.classList.remove('booting');
  document.querySelector('#boot-status').hidden=true;
}catch(e){
  const status=document.querySelector('#boot-status');
  status.textContent=e.message+' ';
  const retry=document.createElement('button');retry.textContent='Opnieuw proberen';retry.className='button ghost';retry.onclick=()=>location.reload();status.append(retry);
}
