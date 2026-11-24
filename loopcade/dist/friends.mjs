import {$, icon, modal, toast, km, escapeText as esc, periodStart} from './ui.mjs';
import {history} from './journal.mjs';
import {getStorageState, loadDemoFriends, updateDemoFriend} from './storage.mjs';
import {openAccount} from './account.mjs';
import {decodePath} from './route-codec.mjs';
import {drawRouteMap} from './social-map.mjs';

let renderVersion = 0;
const weekPoints = activities => activities.filter(activity => activity.end >= periodStart('week'))
  .reduce((sum, activity) => sum + activity.points, 0);
const person = friend => '<div><strong>' + esc(friend.name) + '</strong><span>@' + esc(friend.handle) + ' · demovriend</span></div>';
const action = (friend, key, label) => '<button class="button ghost" data-person="' + esc(friend.id) + '" data-action="' + key + '">' + label + '</button>';
const list = (items, empty) => items.length ? items.join('') : '<p class="empty">' + empty + '</p>';

export async function renderFriends() {
  const version = ++renderVersion, pane = $('#friends'), state = getStorageState();
  if (!state.configured || !state.user || state.status !== 'ready') {
    pane.innerHTML = '<article class="panel"><div class="section-content"><p id="friends-info">' +
      (state.status === 'loading' ? 'Je account wordt geladen…' : 'Log in met Google of als gast om je demovrienden in Firebase te openen.') +
      '</p><button class="button aqua" id="friends-login">Account openen</button></div></article>';
    $('#friends-login').onclick = openAccount;
    return;
  }
  const uid = state.user.uid;
  pane.innerHTML = '<article class="panel"><div class="section-content" role="status">Vrienden laden uit Firebase…</div></article>';
  try {
    const friends = await loadDemoFriends();
    if (version !== renderVersion || getStorageState().user?.uid !== uid) return;
    const accepted = friends.filter(friend => friend.status === 'accepted');
    const pending = friends.filter(friend => friend.status === 'pending');
    const feed = accepted.flatMap(friend => friend.activities.map(activity => ({...activity, name: friend.name})))
      .sort((a, b) => b.end - a.end);
    const ranked = [{name: 'Jij', points: weekPoints(history()), isDemo: false}, ...accepted.map(friend => ({
      name: friend.name, points: weekPoints(friend.activities), isDemo: true,
    }))].sort((a, b) => b.points - a.points);
    pane.innerHTML = '<p class="fine">Noor, Milan en Yara zijn fictieve demovrienden. Hun voorbeeldrondjes en jouw keuzes worden in jouw Firebase-account bewaard.</p>' +
      '<div class="dashboard-grid"><article class="panel"><h2 class="panel-heading">' + icon('users') + 'Mijn vrienden</h2><div id="people" class="section-content stack">' +
      list(accepted.map(friend => '<div class="activity-row">' + person(friend) + action(friend, 'remove', 'Ontvrienden') + '</div>'), 'Je hebt nog geen demovrienden toegevoegd.') +
      '</div></article><article class="panel"><h2 class="panel-heading">' + icon('users') + 'Vriendschapsverzoeken</h2><div id="friend-requests" class="section-content stack">' +
      list(pending.map(friend => '<div class="activity-row">' + person(friend) + '<div class="dialog-actions">' + action(friend, 'accept', 'Accepteren') + action(friend, 'decline', 'Weigeren') + '</div></div>'), 'Geen openstaande verzoeken.') +
      '</div></article><article class="panel"><h2 class="panel-heading">' + icon('users') + 'Demovriend zoeken</h2><div class="section-content"><label>Zoek op naam<input id="people-search" class="input" type="search" placeholder="Bijv. Yara"></label><div id="suggestions" class="stack"></div></div></article>' +
      '<article class="panel"><h2 class="panel-heading">' + icon('trophy') + 'Weekklassement</h2><div id="friend-ranks" class="section-content stack">' +
      ranked.map((row, index) => '<div class="activity-row"><div><span class="rank">' + (index + 1) + '</span> ' + esc(row.name) + (row.isDemo ? ' · demo' : '') + '</div><b>' + row.points + ' pts</b></div>').join('') +
      '</div></article><article class="panel full"><div class="panel-heading"><h2>' + icon('activity') + 'Vriendenfeed</h2><button id="refresh-feed" class="text-link">Vernieuwen</button></div><div id="feed" class="section-content stack">' +
      list(feed.map((activity, index) => '<div class="activity-row"><div><strong>' + esc(activity.name) + ' · ' + (activity.mode === 'run' ? 'Lopen' : 'Wandelen') + ' · demo</strong><span>' +
        km(activity.meters) + ' km · ' + Math.round(activity.elapsed / 60000) + ' min · ' + new Date(activity.end).toLocaleDateString('nl-BE') + '</span></div>' +
        '<button class="button ghost" data-friend-route="' + index + '">Bekijk route</button></div>'), 'Voeg een demovriend toe om voorbeeldrondjes te zien.') + '</div></article></div>';

    const bindActions = () => pane.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        await updateDemoFriend(button.dataset.person, button.dataset.action);
        if (getStorageState().user?.uid === uid) await renderFriends();
      } catch (error) { if (button.isConnected) { toast(error.message); button.disabled = false; } }
    });
    const search = $('#people-search');
    search.oninput = () => {
      const query = search.value.trim().toLocaleLowerCase('nl');
      $('#suggestions').innerHTML = query ? list(friends.filter(friend => (friend.name + ' ' + friend.handle).toLocaleLowerCase('nl').includes(query))
        .map(friend => '<div class="activity-row">' + person(friend) + (friend.status === 'declined' ? action(friend, 'request', 'Toevoegen') : '<span>' + (friend.status === 'accepted' ? 'Al vrienden' : 'Openstaand verzoek') + '</span>') + '</div>'), 'Geen demovriend gevonden.') : '';
      bindActions();
    };
    bindActions();
    $('#refresh-feed').onclick = renderFriends;
    pane.querySelectorAll('[data-friend-route]').forEach(button => button.onclick = () => {
      const activity = feed[Number(button.dataset.friendRoute)];
      modal('Rondje van ' + activity.name, '<p>' + km(activity.meters) + ' km · voorbeeldrondje</p><canvas class="shared-route-map" id="friend-map" aria-label="Voorbeeldroute van een demovriend"></canvas><p class="fine">De zone binnen 350 meter van het startpunt is verborgen. Kaart © OpenStreetMap.</p>');
      drawRouteMap($('#friend-map'), activity.lines.map(decodePath)).catch(error => toast(error.message));
    });
  } catch (error) {
    if (version !== renderVersion || getStorageState().user?.uid !== uid) return;
    pane.innerHTML = '<article class="panel"><div class="section-content"><p class="error" role="alert">Vrienden konden niet uit Firebase worden geladen: ' + esc(error.message) + '</p><button class="button ghost" id="retry-friends">Opnieuw proberen</button></div></article>';
    $('#retry-friends').onclick = renderFriends;
  }
}
