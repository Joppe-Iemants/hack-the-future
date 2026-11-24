import {$, escapeText, modal, closeModal} from './ui.mjs';
import {
  getStorageState, subscribeStorage, signInWithGoogle, signInAsGuest,
  linkGuestToGoogle, signOutUser, migrateLocalActivities, readLocalActivities,
} from './storage.mjs';
import {migrateAudioOwnership} from './audio.mjs';

let busy = false, actionError = '', showExistingLogin = false;

function friendlyError(error) {
  const messages = {
    'auth/popup-closed-by-user': 'Het aanmeldvenster is gesloten. Er is niets gewijzigd.',
    'auth/cancelled-popup-request': 'Er was al een aanmeldvenster actief.',
    'auth/popup-blocked': 'Je browser blokkeerde het aanmeldvenster. Sta pop-ups voor Loopcade toe.',
    'auth/network-request-failed': 'Geen netwerkverbinding. Controleer je verbinding en probeer opnieuw.',
    'auth/unauthorized-domain': 'Dit domein is niet toegestaan. Voeg het toe bij Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'Deze aanmeldmethode is niet ingeschakeld in de Firebase Console.',
    'auth/credential-already-in-use': 'Dit Google-account bestaat al. Je gastgegevens blijven onder het gastaccount bewaard en worden niet overschreven of samengevoegd.',
  };
  return messages[error?.code] || error?.message || 'De accountactie is niet gelukt. Probeer opnieuw.';
}

function accountLabel(state) {
  if (!state.configured) return 'Alleen lokaal';
  if (state.status === 'loading') return 'Account laden…';
  if (!state.user) return 'Niet ingelogd';
  if (state.user.isAnonymous) return 'Gastaccount';
  return state.user.displayName || state.user.email || 'Ingelogd';
}

function renderHeader() {
  const state = getStorageState();
  $('#account-status').textContent = accountLabel(state);
  $('#account-status').title = state.user?.email || accountLabel(state);
  $('#account-button').textContent = state.user ? 'Account' : (state.configured ? 'Inloggen' : 'Opslag');
}

function migrationMarkup(state) {
  if (!state.user) return '';
  const count = readLocalActivities().length;
  if (!count) return '';
  const result = state.migration;
  return '<hr><h3>Lokale activiteiten</h3><p>Er staan ' + count + ' lokale activiteiten op dit toestel. Ze worden pas gekoppeld aan dit account als je hieronder expliciet importeert.</p>'
    + (result ? '<p class="fine" role="status">' + result.imported + ' geïmporteerd · ' + result.skipped + ' al aanwezig. De lokale kopieën zijn behouden.</p>' : '')
    + '<button class="button ghost" id="migrate-local" ' + (busy ? 'disabled' : '') + '>' + (result ? 'Opnieuw controleren' : 'Importeer lokale activiteiten') + '</button>'
    + '<p class="fine">Audio wordt bij de import op dit toestel aan dit account gekoppeld. De oorspronkelijke lokale gegevens worden niet verwijderd.</p>';
}

function dialogMarkup(state) {
  if (!state.configured) {
    return '<p>Firebase is nog niet geconfigureerd. De routeplanner en lokale activiteiten werken, maar er is geen cloudaccount.</p>'
      + '<p class="fine error">' + escapeText(state.error) + '</p><p class="fine">Vul dist/firebase-config.mjs in volgens README.md en vernieuw de pagina.</p>';
  }
  if (state.status === 'loading') return '<p role="status">Je sessie en activiteiten worden geladen…</p>';
  if (!state.user) {
    return '<p>Log in met Google of maak een gastaccount. Een gast kan later aan Google worden gekoppeld met behoud van hetzelfde account.</p>'
      + '<div class="dialog-actions"><button class="button aqua" id="google-login" ' + (busy ? 'disabled' : '') + '>Doorgaan met Google</button>'
      + '<button class="button ghost" id="guest-login" ' + (busy ? 'disabled' : '') + '>Verder als gast</button></div>'
      + '<p class="fine">Zonder account kun je routes plannen, maar geen nieuw rondje bewaren.</p>';
  }
  const name = state.user.isAnonymous ? 'Gast' : (state.user.displayName || state.user.email);
  let html = '<p>Ingelogd als <strong>' + escapeText(name) + '</strong></p><p class="fine">UID: ' + escapeText(state.user.uid) + '</p>';
  if (state.status === 'error') html += '<p class="fine error" role="alert">' + escapeText(state.error) + '</p>';
  if (state.user.isAnonymous) {
    html += '<p>Koppel dit gastaccount aan Google om dezelfde gebruikers-ID en activiteiten te behouden.</p>'
      + '<button class="button aqua" id="link-google" ' + (busy ? 'disabled' : '') + '>Koppel aan Google</button>'
      + '<p class="fine error">Let op: als je als gast uitlogt zonder te koppelen, kun je dit anonieme account mogelijk niet meer openen.</p>';
  }
  html += migrationMarkup(state);
  html += '<hr><button class="button ghost" id="logout" ' + (busy ? 'disabled' : '') + '>Uitloggen</button>';
  return html;
}

function setDialogError(message, showExistingLogin = false) {
  const body = $('#dialog-body');
  body.querySelector('[data-account-error]')?.remove();
  const error = document.createElement('p');
  error.className = 'fine error';
  error.dataset.accountError = 'true';
  error.setAttribute('role', 'alert');
  error.textContent = message;
  body.append(error);
  if (showExistingLogin) {
    const button = document.createElement('button');
    button.className = 'button ghost';
    button.id = 'existing-google-login';
    button.textContent = 'Log in met het bestaande Google-account';
    button.onclick = () => perform(() => signInWithGoogle({linkGuest: false}));
    body.append(button);
  }
}

async function perform(action) {
  if (busy) return;
  busy = true;
  actionError = ''; showExistingLogin = false;
  renderAccountDialog();
  try {
    await action();
  } catch (error) {
    console.error('Loopcade accountactie:', error);
    actionError = friendlyError(error);
    showExistingLogin = error?.code === 'auth/credential-already-in-use';
  } finally {
    busy = false;
    if ($('#dialog').dataset.account === 'true') renderAccountDialog();
    renderHeader();
  }
}

export async function migrateLocalData() {
  const state = getStorageState();
  if (!state.user) throw new Error('Log eerst in om lokale activiteiten te importeren.');
  const result = await migrateLocalActivities();
  let audioWarning = '';
  try {
    await migrateAudioOwnership(result.importedIds, state.user.uid);
  } catch (error) {
    console.error('Loopcade audio koppelen:', error);
    audioWarning = ' De activiteiten zijn geïmporteerd, maar oude audio kon niet aan dit account worden gekoppeld.';
  }
  return {...result, audioWarning};
}

function bindDialogActions() {
  const state = getStorageState();
  if ($('#google-login')) $('#google-login').onclick = () => perform(() => signInWithGoogle());
  if ($('#guest-login')) $('#guest-login').onclick = () => perform(() => signInAsGuest());
  if ($('#link-google')) $('#link-google').onclick = () => perform(() => linkGuestToGoogle());
  if ($('#logout')) $('#logout').onclick = () => perform(() => signOutUser());
  if ($('#migrate-local')) $('#migrate-local').onclick = () => perform(async () => {
    const result = await migrateLocalData();
    if (result.audioWarning) actionError = result.audioWarning;
  });
}

function renderAccountDialog() {
  if ($('#dialog').dataset.account !== 'true') return;
  modal('Jouw plan2run-account', dialogMarkup(getStorageState()), () => { delete $('#dialog').dataset.account; });
  $('#dialog').dataset.account = 'true';
  bindDialogActions();
  if (actionError) setDialogError(actionError, showExistingLogin);
}

export function openAccount() {
  actionError = ''; showExistingLogin = false;
  $('#dialog').dataset.account = 'true';
  renderAccountDialog();
}

export function initializeAccount() {
  $('#account-button').onclick = openAccount;
  subscribeStorage(() => { renderHeader(); renderAccountDialog(); });
}
