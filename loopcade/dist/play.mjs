// Het tabblad "Spelen": groepen, uitnodigingen, kaart, klassement, voortgang en GPS-registratie.
// Spelregels (play-rules), puntentelling (play-scoring) en opslag (play-storage) staan in aparte modules.
import {$, icon, modal, closeModal, toast, escapeText as esc, read, write} from './ui.mjs';
import {getStorageState, subscribeStorage} from './storage.mjs';
import {openAccount} from './account.mjs';
import {cityMap} from './social-map.mjs';
import {TerritoryMap, PLAYER_COLORS} from './territory-map.mjs';
import {DEFAULT_MODE, getGameMode} from './play-modes.mjs';
import {progressFor} from './play-scoring.mjs';
import {remaining, formatRemaining, weekLabel, weekOf} from './play-time.mjs';
import {formatArea, cellCenter, cellOf} from './play-grid.mjs';
import {popularPlaces} from './places.mjs';
import * as store from './play-storage.mjs';
import {createTracker, hasConsent, giveConsent, revokeConsent, readPending, flushPending} from './play-tracker.mjs';

const REFRESH_MS = 60000;
const tracker = createTracker({save: (groupId, weekId, ids) => store.saveCells(groupId, weekId, ids)});
const ui = {
  uid: null, loaded: false, loading: false, groups: [], groupId: null, data: null, scored: null,
  weekId: null, loadedAt: 0, refreshing: false, problem: '', error: '', hidden: new Set(), shellKey: '', version: 0, joinCode: null,
};
let map = null, mapToken = 0, clock = null, liveTimer = null, streets = null;

const mode = () => getGameMode(currentGroup()?.mode) ?? getGameMode(DEFAULT_MODE);
const currentGroup = () => ui.groups.find(group => group.id === ui.groupId) ?? null;
const rememberedName = () => String(read('play-name', '') || '');
const defaultName = () => rememberedName() || (getStorageState().user?.displayName || '').split(' ')[0] || '';
const notice = (html, extra = '') => '<article class="panel"><div class="section-content"><p role="status">' + html + '</p>' + extra + '</div></article>';
// Vervangt de inhoud alleen als die echt verandert, zodat knoppen tijdens live updates niet verdwijnen onder je vinger.
const cache = new WeakMap();
function setHtml(selector, html) {
  const element = $(selector);
  if (!element || cache.get(element) === html) return;
  cache.set(element, html); element.innerHTML = html;
}
const label = (text, field) => '<label class="field-label">' + text + field + '</label>';

// ----- spelregels (ook zichtbaar zonder groep of login) --------------------------

function rulesPanel() {
  const lines = getGameMode(currentGroup()?.mode ?? DEFAULT_MODE).describeRules();
  return '<article class="panel play-rules" id="play-rules"><h2 class="panel-heading">' + icon('flag') + 'Spelregels</h2><div class="section-content">' +
    '<details open><summary>Zo werkt Terreinjacht</summary><ol>' + lines.map(line => '<li>' + esc(line) + '</li>').join('') + '</ol></details>' +
    '<p class="fine">Demovrienden uit het tabblad Vrienden (Noor, Milan en Yara) en geplande routes doen hier niet mee: alleen echte spelers die je uitnodigt en echt geregistreerde GPS-metingen tellen.</p></div></article>';
}

// ----- hoofdweergave -----------------------------------------------------------------

function gateNotice(state) {
  if (!state.configured) return notice('Spelen bewaart groepen en klassementen in Firebase. Vul eerst <code>dist/firebase-config.mjs</code> in (zie README).');
  if (state.status === 'loading') return notice('Je account wordt geladen…');
  if (state.status === 'error' && !state.user) return notice(esc(state.error));
  if (!state.user) {
    const invited = joinCodeFromHash() ? 'Je bent uitgenodigd voor een groep. ' : '';
    return notice(invited + 'Log in met Google of ga als gast verder om een groep te maken of eraan deel te nemen.', '<button class="button aqua" id="play-login">Account openen</button>');
  }
  return null;
}

function joinCodeFromHash() {
  const match = /^#play\/join\/(.+)$/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

function resetFor(uid) {
  if (tracker.isTracking()) tracker.stop();
  clearInterval(clock); clock = null;
  Object.assign(ui, {uid, loaded: false, loading: false, groups: [], groupId: null, data: null, scored: null, weekId: null, loadedAt: 0, problem: '', error: '', shellKey: '', version: ui.version + 1});
  map = null;
}

export function renderPlay() {
  const state = getStorageState(), pane = $('#play');
  const blocked = gateNotice(state);
  if (blocked) {
    if (ui.uid) resetFor(null);
    ui.shellKey = '';
    pane.innerHTML = blocked + rulesPanel();
    if ($('#play-login')) $('#play-login').onclick = openAccount;
    return;
  }
  if (ui.uid !== state.user.uid) resetFor(state.user.uid);
  const code = joinCodeFromHash();
  if (code) ui.joinCode = code;
  if (!ui.loaded) {
    ui.shellKey = '';
    pane.innerHTML = notice('Je groepen worden geladen…');
    loadGroups();
    return;
  }
  if (ui.error) {
    ui.shellKey = '';
    pane.innerHTML = '<article class="panel"><div class="section-content"><p class="error" role="alert">' + esc(ui.error) + '</p><button class="button ghost" data-play="retry">Opnieuw proberen</button></div></article>' + rulesPanel();
    bindPane();
    return;
  }
  if (!ui.groups.length) renderEmpty(); else ensureShell();
  if (ui.joinCode) {
    const pending = ui.joinCode; ui.joinCode = null;
    history.replaceState(null, '', '#play');
    openJoin(pending);
  }
}

async function loadGroups() {
  if (ui.loading) return;
  ui.loading = true;
  const uid = ui.uid, version = ui.version;
  try {
    const groups = await store.listMyGroups();
    if (ui.uid !== uid || ui.version !== version) return;
    ui.groups = groups; ui.error = ''; ui.loaded = true;
    const remembered = read('play-group', null);
    if (!groups.some(group => group.id === ui.groupId)) ui.groupId = groups.find(group => group.id === remembered)?.id ?? groups[0]?.id ?? null;
    flushPending(uid, (groupId, weekId, ids) => store.saveCells(groupId, weekId, ids)).catch(() => {});
  } catch (error) {
    if (ui.uid !== uid || ui.version !== version) return;
    console.error('Loopcade Spelen groepen laden:', error);
    ui.error = 'Je groepen konden niet worden geladen: ' + (error.message || 'onbekende fout') + '. Controleer of de Firestore-regels zijn gedeployd (zie README).';
    ui.loaded = true;
  } finally {
    if (ui.uid === uid && ui.version === version) ui.loading = false;
  }
  if (ui.uid === uid && $('#play') && !$('#play').hidden) renderPlay();
}

function renderEmpty() {
  ui.shellKey = '';
  $('#play').innerHTML = '<article class="panel"><div class="section-content play-intro"><h2>Verover samen de stad</h2>' +
    '<p>Maak een groep, nodig vrienden uit en kies een gezamenlijk startpunt. Van maandag tot zondag verzamel je terrein door te wandelen of te lopen. Wie zondag de grootste oppervlakte heeft, wint.</p>' +
    '<ol class="play-steps"><li>Maak een groep en kies een startpunt in Gent.</li><li>Deel de uitnodigingslink met je vrienden.</li><li>Start de GPS-registratie en ga naar buiten.</li></ol>' +
    '<div class="dialog-actions"><button class="button aqua" data-play="new-group" id="play-new">' + icon('users') + 'Groep maken</button><button class="button ghost" data-play="join" id="play-join">Ik heb een uitnodiging</button></div></div></article>' + rulesPanel();
  bindPane();
}

function shellHtml() {
  const group = currentGroup();
  const options = ui.groups.map(item => '<option value="' + esc(item.id) + '"' + (item.id === group.id ? ' selected' : '') + '>' + esc(item.name) + '</option>').join('');
  return '<div class="play-bar panel"><label class="play-select">Groep<select id="play-group" class="input">' + options + '</select></label>' +
    '<div class="dialog-actions"><button class="button ghost" data-play="new-group" id="play-new">Nieuwe groep</button><button class="button ghost" data-play="join" id="play-join">Deelnemen met code</button>' +
    '<button class="button ghost" data-play="refresh" id="play-refresh" aria-label="Klassement vernieuwen">Vernieuwen</button></div></div>' +
    '<p class="form-feedback" id="play-problem" role="alert"></p>' +
    '<div class="play-layout">' +
    '<article class="panel play-map-panel"><div class="panel-heading"><h2>' + icon('pin') + esc(group.name) + '</h2><span class="live-badge" id="play-week-badge"><b></b>Week</span></div>' +
    '<div class="map-frame play-map" id="play-map-frame"><canvas id="play-map" tabindex="0" role="img" aria-label="Kaart met verzameld terrein"></canvas>' +
    '<div class="map-tools"><button type="button" id="play-zoom-in" aria-label="Inzoomen">+</button><button type="button" id="play-zoom-out" aria-label="Uitzoomen">−</button><button type="button" id="play-fit" aria-label="Naar het startpunt">' + icon('frame') + '</button></div>' +
    '<a class="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>' +
    '<div class="play-legend" id="play-legend" aria-label="Spelers op de kaart"></div>' +
    '<p class="fine play-map-note">Elk vakje is ongeveer 100 × 100 m (1 ha). Spelers delen een vakje door er allebei doorheen te gaan. Het startpunt staat wit gemarkeerd.</p></article>' +
    '<div class="play-side">' +
    '<article class="panel"><h2 class="panel-heading">' + icon('clock') + 'Speeltijd</h2><div class="section-content" id="play-clock"></div></article>' +
    '<article class="panel"><h2 class="panel-heading">' + icon('activity') + 'Jouw voortgang</h2><div class="section-content" id="play-me"></div></article>' +
    '<article class="panel"><h2 class="panel-heading">' + icon('locate') + 'GPS-registratie</h2><div class="section-content" id="play-gps"></div></article></div>' +
    '<article class="panel full"><h2 class="panel-heading">' + icon('trophy') + 'Weekklassement</h2><div class="section-content" id="play-rank"><p>Klassement laden…</p></div></article>' +
    '<article class="panel"><h2 class="panel-heading">' + icon('users') + 'Spelers en uitnodigingen</h2><div class="section-content" id="play-members"></div></article>' +
    '<article class="panel"><h2 class="panel-heading">' + icon('flag') + 'Vorige weken</h2><div class="section-content" id="play-history"></div></article>' +
    '</div>' + rulesPanel();
}

function ensureShell() {
  const group = currentGroup(), key = ui.uid + ':' + group.id;
  const pane = $('#play');
  if (ui.shellKey === key && $('#play-map')) { startClock(); if (Date.now() - ui.loadedAt > REFRESH_MS) refreshGroup(); return; }
  ui.shellKey = key; ui.data = null; ui.scored = null; ui.weekId = null; ui.problem = '';
  write('play-group', group.id);
  pane.innerHTML = shellHtml();
  bindPane();
  $('#play-group').onchange = event => switchGroup(event.target.value);
  paintClock(); paintGps();
  initMap();
  refreshGroup();
  startClock();
}

function switchGroup(id) {
  if (id === ui.groupId) return;
  if (tracker.isTracking()) { tracker.stop(); toast('De GPS-registratie is gestopt omdat je van groep wisselde.'); }
  ui.groupId = id; map = null;
  renderPlay();
}

// ----- acties (event delegation) ---------------------------------------------------

function bindPane() {
  $('#play').onclick = event => {
    const target = event.target.closest('[data-play]');
    if (!target) return;
    const [action, argument] = target.dataset.play.split(':');
    const handlers = {
      'new-group': openCreate, join: () => openJoin(''), refresh: () => refreshGroup(true), retry: () => { ui.loaded = false; ui.error = ''; renderPlay(); },
      invite: openInvite, rename: openRename, leave: confirmLeave, 'remove': () => confirmRemove(argument),
      'start-gps': startTracking, 'stop-gps': () => tracker.stop(), 'revoke-consent': confirmRevoke,
      toggle: () => { ui.hidden.has(argument) ? ui.hidden.delete(argument) : ui.hidden.add(argument); paintLegend(); paintMap(); },
    };
    handlers[action]?.();
  };
}

// ----- kaart -----------------------------------------------------------------------

async function initMap() {
  const token = ++mapToken, canvas = $('#play-map');
  try {
    const data = await cityMap();
    if (token !== mapToken || $('#play-map') !== canvas) return;
    map = new TerritoryMap(canvas, data);
    $('#play-zoom-in').onclick = () => map.zoomBy(1.4);
    $('#play-zoom-out').onclick = () => map.zoomBy(1 / 1.4);
    $('#play-fit').onclick = () => map.fit();
    map.setData({start: currentGroup().start, players: [], visible: null});
    requestAnimationFrame(() => { map?.fit(); paintMap(); });
  } catch (error) {
    if (token === mapToken) $('#play-map-frame')?.insertAdjacentHTML('beforeend', '<p class="map-error" role="alert">De kaart kon niet worden geladen. Het klassement werkt wel.</p>');
  }
}

function colorOf(uid) {
  const index = [...(ui.data?.members ?? [])].map(member => member.uid).sort().indexOf(uid);
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length];
}

function mergedPlayers() {
  const group = currentGroup(), players = new Map((ui.data?.players ?? []).map(player => [player.uid, new Set(player.cells)]));
  // Cellen die nog niet in Firestore staan, tellen alvast mee voor jezelf.
  for (const id of readPending(ui.uid)[group.id]?.[ui.weekId] ?? []) (players.get(ui.uid) ?? players.set(ui.uid, new Set()).get(ui.uid)).add(id);
  return [...players].map(([uid, cells]) => ({uid, cells: [...cells]}));
}

// ----- tekenen van de onderdelen ------------------------------------------------------

function paint() {
  const group = currentGroup();
  if (!group || !ui.data || !$('#play-rank')) return;
  ui.scored = mode().score({players: mergedPlayers(), members: ui.data.members, group});
  paintClock(); paintRank(); paintMe(); paintMembers(); paintHistory(); paintLegend(); paintMap(); paintGps();
  $('#play-problem').textContent = ui.problem;
}

function paintClock() {
  const box = $('#play-clock');
  if (!box) return;
  const now = Date.now(), info = remaining(now), total = info.end - info.start;
  box.innerHTML = '<p class="play-countdown" id="play-countdown" role="timer" aria-label="Resterende speeltijd">' + formatRemaining(info.remainingMs) + '</p>' +
    '<progress max="' + total + '" value="' + (total - info.remainingMs) + '" aria-label="Verstreken deel van de week"></progress>' +
    '<p class="fine">Week ' + esc(weekLabel(info.id)) + '. De week eindigt zondag om middernacht (tijd in België); daarna start een nieuwe week met een lege score.</p>';
  const badge = $('#play-week-badge');
  if (badge) badge.innerHTML = '<b></b>' + esc(weekLabel(info.id));
}

function paintRank() {
  const {standings} = ui.scored, lead = Math.max(1, standings[0]?.cells ?? 0);
  setHtml('#play-rank', '<ol class="play-rank" id="play-ranking">' + standings.map(row => {
    const me = row.uid === ui.uid;
    return '<li class="' + (me ? 'me' : '') + '" data-uid="' + esc(row.uid) + '"><span class="rank">' + row.rank + '</span><i class="dot" style="background:' + colorOf(row.uid) + '"></i>' +
      '<span class="who"><strong>' + esc(row.name) + (me ? ' (jij)' : '') + '</strong><span class="bar"><i style="width:' + Math.round(row.cells / lead * 100) + '%;background:' + colorOf(row.uid) + '"></i></span></span>' +
      '<b>' + row.cells + ' ' + (row.cells === 1 ? 'cel' : 'cellen') + ' · ' + formatArea(row.cells) + '</b></li>';
  }).join('') + '</ol>' + (ui.scored.totalCells ? '<p class="fine">Samen bedekken jullie ' + ui.scored.totalCells + ' verschillende cellen deze week.</p>' : '<p class="fine">Nog niemand heeft terrein verzameld deze week. Start de GPS-registratie en ga naar buiten!</p>'));
}

function paintMe() {
  const progress = progressFor(ui.scored.standings, ui.uid, ui.scored.holders), session = tracker.getState();
  if (!progress) { setHtml('#play-me', '<p>Je staat niet in het klassement van deze groep.</p>'); return; }
  const gap = progress.leading ? 'Je staat aan kop!' : progress.cells === 0 ? 'Je hebt nog geen cellen. Ga naar buiten en start de registratie.' : 'Nog ' + (progress.behind + 1) + ' cellen om ' + esc(progress.leaderName) + ' voorbij te gaan.';
  setHtml('#play-me', '<div class="record-grid"><div><strong>#' + progress.rank + '</strong>van ' + progress.players + ' spelers</div><div><strong>' + progress.cells + '</strong>cellen · ' + formatArea(progress.cells) + '</div></div>' +
    '<progress max="' + Math.max(1, ui.scored.standings[0].cells) + '" value="' + progress.cells + '" aria-label="Jouw cellen ten opzichte van de leider"></progress>' +
    '<p>' + gap + '</p><p class="fine">' + progress.exclusive + ' cellen zijn alleen van jou, ' + progress.shared + ' deel je met anderen.' +
    (tracker.isTracking() ? ' Deze sessie vond je ' + session.found + ' nieuwe cellen.' : '') + '</p>');
}

function paintMembers() {
  const group = currentGroup(), members = ui.data.members, owner = group.ownerUid === ui.uid;
  setHtml('#play-members', '<div class="stack">' + members.map(member => '<div class="activity-row"><div><strong>' + esc(member.displayName) + (member.uid === ui.uid ? ' (jij)' : '') + '</strong><span>' +
    (member.role === 'owner' ? 'Eigenaar' : 'Speler') + '</span></div>' +
    (owner && member.role !== 'owner' ? '<button class="button ghost" data-play="remove:' + esc(member.uid) + '" aria-label="' + esc(member.displayName) + ' verwijderen">Verwijderen</button>' : '') + '</div>').join('') + '</div>' +
    '<p class="fine">Startpunt: ' + esc(group.start.name) + '. Alleen groepsleden zien elkaars naam en cellen.</p>' +
    '<div class="dialog-actions">' + (owner ? '<button class="button aqua" id="play-invite" data-play="invite">' + icon('users') + 'Vrienden uitnodigen</button>' : '') +
    '<button class="button ghost" data-play="rename">Mijn naam wijzigen</button>' + (owner ? '' : '<button class="button ghost" data-play="leave">Groep verlaten</button>') + '</div>' +
    (owner ? '' : '<p class="fine">Alleen de eigenaar kan nieuwe vrienden uitnodigen.</p>'));
}

function paintHistory() {
  const results = ui.data.results;
  setHtml('#play-history', results.length ? '<div class="stack">' + results.map(result => {
    const names = result.winners.map(uid => result.standings.find(row => row.uid === uid)?.name ?? 'Onbekend');
    const top = result.standings.find(row => row.cells > 0);
    return '<div class="activity-row" data-week="' + esc(result.weekId) + '"><div><strong>' + (names.length ? icon('trophy') + ' ' + esc(names.join(' & ')) : 'Geen winnaar') + '</strong><span>Week ' + esc(weekLabel(result.weekId)) + '</span></div>' +
      '<b>' + (top ? top.cells + ' cellen · ' + formatArea(top.cells) : '—') + '</b></div>';
  }).join('') + '</div>' : '<p>Nog geen afgesloten weken. Zondag om middernacht wordt de winnaar van deze week bewaard en begint een nieuwe week met een lege score.</p>');
}

function paintLegend() {
  const box = $('#play-legend');
  if (!box || !ui.scored) return;
  setHtml('#play-legend', ui.scored.standings.map(row => '<button type="button" class="play-chip" data-play="toggle:' + esc(row.uid) + '" aria-pressed="' + !ui.hidden.has(row.uid) + '"><i style="background:' + colorOf(row.uid) + '"></i>' + esc(row.name) + (row.uid === ui.uid ? ' (jij)' : '') + '</button>').join(''));
}

function paintMap() {
  if (!map || !ui.scored) return;
  const players = ui.scored.standings.map(row => ({uid: row.uid, color: colorOf(row.uid), cells: ui.scored.cellsByUid.get(row.uid) ?? []}));
  map.setData({start: currentGroup().start, players, visible: new Set(players.map(player => player.uid).filter(uid => !ui.hidden.has(uid))), meUid: ui.uid});
  $('#play-map')?.setAttribute('aria-label', 'Kaart met verzameld terrein. ' + ui.scored.standings.map(row => row.name + ': ' + row.cells + ' cellen').join(', ') + '.');
}

// ----- GPS-registratie ------------------------------------------------------------------

function paintGps() {
  const box = $('#play-gps');
  if (!box) return;
  const state = tracker.getState(), tracking = tracker.isTracking(), consent = hasConsent(ui.uid), group = currentGroup();
  const key = (tracking ? 'aan' : 'uit') + (consent ? '1' : '0') + group.id;
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.innerHTML = (tracking
      ? '<p class="gps-live" id="play-gps-state"><b></b><span></span></p><p id="play-gps-count"></p>' +
        '<button class="button pink wide" id="play-stop" data-play="stop-gps">Stop registratie</button>' +
        '<p class="fine">Houd dit tabblad open en je scherm aan. De browser pauzeert GPS op de achtergrond.</p>'
      : '<p>Wandel of loop met GPS aan en verzamel cellen voor <strong>' + esc(group.name) + '</strong>. Alleen tussen Start en Stop wordt je locatie gebruikt.</p>' +
        '<button class="button aqua wide" id="play-start" data-play="start-gps">' + icon('play') + 'Start registratie</button>' +
        (consent ? '<p class="fine">Toestemming gegeven op dit toestel. <button class="text-link" data-play="revoke-consent">Toestemming intrekken</button></p>' : '<p class="fine">Je wordt eerst om toestemming gevraagd.</p>')) +
      '<p class="form-feedback" id="play-gps-message" role="status"></p><p class="fine" id="play-sync" role="status"></p>';
  }
  if (tracking) {
    $('#play-gps-state span').textContent = 'GPS actief' + (state.accuracy ? ' · nauwkeurigheid ± ' + state.accuracy + ' m' : ' · zoeken naar signaal…');
    $('#play-gps-count').textContent = state.found + ' nieuwe ' + (state.found === 1 ? 'cel' : 'cellen') + ' in deze sessie' + (state.pending ? ' · ' + state.pending + ' nog niet bewaard' : '') + '.';
  }
  $('#play-gps-message').textContent = state.message || '';
  $('#play-sync').textContent = state.sync || '';
}

function consentDialog() {
  return new Promise(resolve => {
    let decided = false;
    const finish = value => { if (!decided) { decided = true; resolve(value); } };
    const rules = mode().rules;
    modal('Toestemming voor GPS-registratie',
      '<p>plan2run gebruikt de locatie van dit toestel alleen <strong>vanaf je op Start drukt tot je op Stop drukt</strong> (of dit tabblad sluit).</p><ul class="play-consent">' +
      '<li>Je precieze route, coördinaten en tijdstippen worden niet bewaard of gedeeld. Elke meting wordt omgezet in een kaartcel van ongeveer ' + rules.cellMeters + ' × ' + rules.cellMeters + ' m.</li>' +
      '<li>Met je groep deel je alleen je naam en de cellen die je deze week hebt bezocht.</li>' +
      '<li>Start je meer dan ' + rules.startZoneRadius + ' m van het gezamenlijke startpunt, dan blijven cellen binnen ' + rules.privacyRadius + ' m van je startpositie privé en tellen ze niet mee (bijvoorbeeld rond je thuis).</li>' +
      '<li>Je kunt altijd stoppen en je toestemming intrekken. Cellen die je al deelde verdwijnen als je de groep verlaat.</li>' +
      '<li>De browser vraagt daarnaast zelf toegang tot je locatie.</li></ul>' +
      '<div class="dialog-actions"><button class="button aqua" id="play-consent-accept">Akkoord en start</button><button class="button ghost" id="play-consent-cancel">Annuleren</button></div>',
      () => finish(false));
    $('#play-consent-accept').onclick = () => { finish(true); closeModal(); };
    $('#play-consent-cancel').onclick = () => closeModal();
  });
}

async function startTracking() {
  const group = currentGroup();
  if (!group || tracker.isTracking()) return;
  if (!Number.isFinite(group.start?.lon) || !Number.isFinite(group.start?.lat)) { toast('Deze groep heeft geen geldig startpunt.'); return; }
  if (!hasConsent(ui.uid)) {
    if (!await consentDialog()) return;
    giveConsent(ui.uid);
  }
  tracker.start({uid: ui.uid, group, createSession: item => mode().createSession(item)});
  paintGps();
}

function confirmRevoke() {
  modal('Toestemming intrekken?', '<p>De GPS-registratie stopt en cellen die nog niet in je groep zijn bewaard, worden gewist. Je kunt later opnieuw toestemming geven.</p><div class="dialog-actions"><button class="button aqua" id="play-revoke-yes">Intrekken</button><button class="button ghost" id="play-revoke-no">Annuleren</button></div>');
  $('#play-revoke-no').onclick = closeModal;
  $('#play-revoke-yes').onclick = async () => {
    if (tracker.isTracking()) await tracker.stop();
    revokeConsent(ui.uid); closeModal(); paintGps(); paintMe(); toast('Toestemming ingetrokken.');
  };
}

// De tracker meldt wijzigingen vaak (elke meting); teken de kaart hooguit één keer per seconde opnieuw.
function onTrackerState() {
  const badge = $('#gps-badge');
  if (badge) badge.hidden = !tracker.isTracking();
  paintGps();
  if (liveTimer || !ui.data) return;
  liveTimer = setTimeout(() => { liveTimer = null; if ($('#play-rank')) paint(); }, 1000);
}

// ----- data verversen en weekovergang ------------------------------------------------------

async function refreshGroup(manual = false) {
  const group = currentGroup();
  if (!group || ui.refreshing) return;
  ui.refreshing = true;
  const uid = ui.uid, key = ui.shellKey;
  if (manual && $('#play-refresh')) $('#play-refresh').disabled = true;
  try {
    const weekId = weekOf(Date.now()).id;
    const data = await store.loadGroupState(group, weekId);
    const closed = await store.closeFinishedWeeks(group, data.members, data.results);
    if (ui.uid !== uid || ui.shellKey !== key) return;
    const known = new Set(data.results.map(result => result.weekId));
    for (const result of closed) if (!known.has(result.weekId)) data.results.push(result);
    data.results.sort((a, b) => b.weekId.localeCompare(a.weekId));
    ui.weekId = weekId; ui.data = data; ui.loadedAt = Date.now(); ui.problem = '';
    paint();
    const fresh = closed.filter(result => !known.has(result.weekId)).sort((a, b) => b.weekId.localeCompare(a.weekId))[0];
    if (fresh) {
      const winners = fresh.winners.map(id => fresh.standings.find(row => row.uid === id)?.name).filter(Boolean);
      toast('Week ' + weekLabel(fresh.weekId) + ' is afgesloten. ' + (winners.length ? 'Winnaar: ' + winners.join(' & ') + '.' : 'Er was geen winnaar.') + ' Een nieuwe week begint met een lege score.');
    }
  } catch (error) {
    if (ui.uid !== uid || ui.shellKey !== key) return;
    console.error('Loopcade Spelen vernieuwen:', error);
    if (error?.code === 'permission-denied') {
      ui.problem = 'Je bent geen lid meer van deze groep of je hebt geen toegang.';
      toast(ui.problem);
      ui.loaded = false; ui.groupId = null; renderPlay();
    } else {
      ui.problem = 'Vernieuwen mislukt: ' + (error.message || 'controleer je verbinding') + '.';
      if ($('#play-problem')) $('#play-problem').textContent = ui.problem;
    }
  } finally {
    ui.refreshing = false;
    if ($('#play-refresh')) $('#play-refresh').disabled = false;
  }
}

function startClock() {
  if (clock) return;
  clock = setInterval(() => {
    if ($('#play').hidden || !$('#play-clock')) { clearInterval(clock); clock = null; return; }
    const now = Date.now(), info = remaining(now), countdown = $('#play-countdown');
    if (countdown) countdown.textContent = formatRemaining(info.remainingMs);
    // Nieuwe week: laad opnieuw zodat de vorige week wordt afgesloten en de score leeg begint.
    if (ui.weekId && info.id !== ui.weekId) refreshGroup();
    else if (now - ui.loadedAt > REFRESH_MS && !document.hidden) refreshGroup();
  }, 1000);
}

// ----- dialogen: groep maken, uitnodigen, deelnemen ----------------------------------------------

async function streetIndex() {
  if (streets) return streets;
  const data = await cityMap(), found = new Map();
  for (const [type, , name, ids] of data.ways) {
    if (!name || (type !== 's' && type !== 'a') || found.has(name)) continue;
    const [x, y] = data.points[ids[Math.floor(ids.length / 2)]];
    found.set(name, [data.origin[0] + x / data.scale[0], data.origin[1] + y / data.scale[1]]);
  }
  return streets = found;
}

function openCreate() {
  let chosen = {name: popularPlaces[0][0] + ', Gent', lon: popularPlaces[0][1], lat: popularPlaces[0][2]};
  const rules = getGameMode(DEFAULT_MODE).rules;
  modal('Nieuwe groep',
    label('Naam van de groep', '<input class="input" id="play-group-name" maxlength="40" autocomplete="off" placeholder="Bijv. Loopmaatjes">') +
    label('Jouw naam in de groep', '<input class="input" id="play-my-name" maxlength="30" autocomplete="nickname" value="' + esc(defaultName()) + '" placeholder="Hoe zien je vrienden je?">') +
    label('Gezamenlijk startpunt', '<input class="input" id="play-place-search" type="search" autocomplete="off" placeholder="Zoek een plein of straat in Gent">') +
    '<div class="place-list" id="play-place-list"></div><p class="fine" id="play-place-chosen"></p>' +
    '<p class="fine">Kies een openbare plek, geen thuisadres. Cellen binnen ' + rules.playRadius / 1000 + ' km van dit punt tellen mee. Vrienden nodig je daarna uit met een link.</p>' +
    '<button class="button aqua wide" id="play-create">Groep maken</button><p class="error" id="play-create-error" role="alert"></p>');
  const chosenText = () => { $('#play-place-chosen').textContent = 'Gekozen: ' + chosen.name; };
  const renderList = async () => {
    const query = $('#play-place-search').value.trim().toLocaleLowerCase('nl');
    let places = popularPlaces.map(([name, lon, lat]) => ({name: name + ', Gent', lon, lat}));
    if (query) {
      try {
        const index = await streetIndex();
        places = [...index].filter(([name]) => name.toLocaleLowerCase('nl').includes(query)).sort((a, b) => a[0].localeCompare(b[0], 'nl')).slice(0, 20)
          .map(([name, [lon, lat]]) => ({name: name + ', Gent', lon, lat}));
      } catch { places = places.filter(place => place.name.toLocaleLowerCase('nl').includes(query)); }
    }
    const list = $('#play-place-list');
    if (!list) return;
    list.innerHTML = places.length ? places.map((place, i) => '<button type="button" data-place="' + i + '">' + icon('pin') + esc(place.name) + '</button>').join('') : '<p>Geen plek gevonden.</p>';
    list.querySelectorAll('[data-place]').forEach(button => button.onclick = () => { chosen = places[Number(button.dataset.place)]; chosenText(); });
  };
  chosenText(); renderList();
  $('#play-place-search').oninput = renderList;
  $('#play-create').onclick = async () => {
    const button = $('#play-create'), error = $('#play-create-error');
    error.textContent = ''; button.disabled = true;
    try {
      const center = cellCenter(cellOf(chosen));
      const myName = $('#play-my-name').value;
      const group = await store.createGroup({name: $('#play-group-name').value, displayName: myName, start: {name: chosen.name, lon: center.lon, lat: center.lat}});
      write('play-name', store.cleanDisplayName(myName));
      closeModal(); toast('Groep gemaakt. Nodig nu je vrienden uit.');
      ui.groupId = group.id; ui.loaded = false; renderPlay();
    } catch (failure) {
      console.error('Loopcade groep maken:', failure);
      error.textContent = failure.message || 'De groep kon niet worden gemaakt.'; button.disabled = false;
    }
  };
}

const inviteLink = code => location.origin + location.pathname + '#play/join/' + code;

async function openInvite() {
  const group = currentGroup();
  if (!group || group.ownerUid !== ui.uid) return;
  modal('Vrienden uitnodigen', '<p role="status">Uitnodiging voorbereiden…</p>');
  const ownerName = ui.data?.members.find(member => member.uid === ui.uid)?.displayName;
  try {
    let invites = await store.listInvites(group.id);
    if (!invites.length) { const created = await store.createInvite(group, ownerName); invites = [{...created, active: true}]; }
    showInvite(group, invites[0], ownerName);
  } catch (error) {
    console.error('Loopcade uitnodiging:', error);
    $('#dialog-body').innerHTML = '<p class="error" role="alert">' + esc(error.message || 'De uitnodiging kon niet worden gemaakt.') + '</p>';
  }
}

function showInvite(group, invite, ownerName) {
  const link = inviteLink(invite.code), days = Math.max(1, Math.ceil((invite.expiresAt - Date.now()) / 86400000));
  modal('Vrienden uitnodigen',
    '<p>Stuur deze link naar vrienden. Wie hem opent en inlogt, kan lid worden van <strong>' + esc(group.name) + '</strong>.</p>' +
    '<input class="input" id="play-invite-link" readonly value="' + esc(link) + '" aria-label="Uitnodigingslink">' +
    '<p class="fine">Code: <span id="play-invite-code">' + esc(invite.code) + '</span><br>Deze uitnodiging blijft nog ' + days + ' dag' + (days === 1 ? '' : 'en') + ' geldig. Iedereen met de link kan lid worden: deel hem alleen met vrienden.</p>' +
    '<div class="dialog-actions"><button class="button aqua" id="play-copy">Kopieer link</button>' + (navigator.share ? '<button class="button ghost" id="play-share">Delen…</button>' : '') +
    '<button class="button ghost" id="play-new-invite">Nieuwe link</button><button class="button ghost" id="play-revoke-invites">Links intrekken</button></div><p class="fine" id="play-invite-state" role="status"></p>');
  const state = text => { $('#play-invite-state').textContent = text; };
  $('#play-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); state('Link gekopieerd.'); }
    catch { $('#play-invite-link').select(); state('Kopieer de geselecteerde link handmatig.'); }
  };
  if ($('#play-share')) $('#play-share').onclick = () => navigator.share({title: 'plan2run · ' + group.name, text: 'Doe mee met mijn plan2run-groep!', url: link}).catch(() => {});
  $('#play-new-invite').onclick = async () => {
    try { const created = await store.createInvite(group, ownerName); showInvite(group, {...created, active: true}, ownerName); }
    catch (error) { state(error.message); }
  };
  $('#play-revoke-invites').onclick = async () => {
    try {
      const active = await store.listInvites(group.id);
      await store.revokeInvites(group.id, active.map(item => item.token));
      closeModal(); toast('Alle uitnodigingslinks zijn ingetrokken.');
    } catch (error) { state(error.message); }
  };
}

function openJoin(initialCode) {
  modal('Deelnemen aan een groep',
    label('Uitnodigingslink of code', '<input class="input" id="play-join-code" autocomplete="off" spellcheck="false" placeholder="Plak de link of code van je vriend">') +
    '<button class="button ghost" id="play-join-check">Controleren</button><div id="play-join-preview" aria-live="polite"></div>');
  const input = $('#play-join-code');
  input.value = initialCode;
  const check = async () => {
    const preview = $('#play-join-preview');
    preview.innerHTML = '<p>Uitnodiging controleren…</p>';
    try {
      const invite = await store.previewInvite(input.value);
      preview.innerHTML = '<p>Je bent uitgenodigd voor <strong>' + esc(invite.groupName) + '</strong> door ' + esc(invite.ownerName) + '. Startpunt: ' + esc(invite.startName) + '.</p>' +
        label('Jouw naam in de groep', '<input class="input" id="play-join-name" maxlength="30" autocomplete="nickname" value="' + esc(defaultName()) + '">') +
        '<p class="fine">Leden van de groep zien je naam en de cellen die je verzamelt (geen route of tijdstippen). GPS start alleen als jij dat zelf doet.</p>' +
        '<button class="button aqua wide" id="play-join-confirm">Deelnemen</button><p class="error" id="play-join-error" role="alert"></p>';
      $('#play-join-confirm').onclick = async () => {
        const button = $('#play-join-confirm'), error = $('#play-join-error');
        button.disabled = true; error.textContent = '';
        try {
          const name = $('#play-join-name').value;
          const group = await store.joinGroup(invite, name);
          write('play-name', store.cleanDisplayName(name));
          closeModal(); toast('Welkom in ' + group.name + '!');
          ui.groupId = group.id; ui.loaded = false; renderPlay();
        } catch (failure) { error.textContent = failure.message; button.disabled = false; }
      };
    } catch (error) { preview.innerHTML = '<p class="error" role="alert">' + esc(error.message) + '</p>'; }
  };
  $('#play-join-check').onclick = check;
  input.onkeydown = event => { if (event.key === 'Enter') check(); };
  if (initialCode) check();
}

function openRename() {
  const me = ui.data?.members.find(member => member.uid === ui.uid);
  modal('Mijn naam in de groep', label('Naam', '<input class="input" id="play-rename" maxlength="30" value="' + esc(me?.displayName ?? '') + '">') +
    '<button class="button aqua" id="play-rename-save">Bewaren</button><p class="error" id="play-rename-error" role="alert"></p>');
  $('#play-rename-save').onclick = async () => {
    try {
      await store.renameMember(ui.groupId, $('#play-rename').value);
      write('play-name', store.cleanDisplayName($('#play-rename').value));
      closeModal(); refreshGroup(true);
    } catch (error) { $('#play-rename-error').textContent = error.message; }
  };
}

function confirmLeave() {
  const group = currentGroup();
  modal('Groep verlaten?', '<p>Je verlaat <strong>' + esc(group.name) + '</strong>. Al je gedeelde cellen van deze groep worden verwijderd.</p><div class="dialog-actions"><button class="button pink" id="play-leave-yes">Groep verlaten</button><button class="button ghost" id="play-leave-no">Annuleren</button></div><p class="error" id="play-leave-error" role="alert"></p>');
  $('#play-leave-no').onclick = closeModal;
  $('#play-leave-yes').onclick = async () => {
    try {
      if (tracker.isTracking()) await tracker.stop();
      await store.leaveGroup(group, weekOf(Date.now()).id);
      closeModal(); toast('Je hebt de groep verlaten.');
      ui.groupId = null; ui.loaded = false; renderPlay();
    } catch (error) { $('#play-leave-error').textContent = error.message; }
  };
}

function confirmRemove(uid) {
  const member = ui.data?.members.find(item => item.uid === uid), group = currentGroup();
  if (!member) return;
  modal('Speler verwijderen?', '<p>Verwijder <strong>' + esc(member.displayName) + '</strong> uit de groep? Alle uitnodigingslinks worden ingetrokken, zodat die speler niet meteen opnieuw kan deelnemen.</p><div class="dialog-actions"><button class="button pink" id="play-remove-yes">Verwijderen</button><button class="button ghost" id="play-remove-no">Annuleren</button></div><p class="error" id="play-remove-error" role="alert"></p>');
  $('#play-remove-no').onclick = closeModal;
  $('#play-remove-yes').onclick = async () => {
    try {
      await store.removeMember(group, uid);
      const active = await store.listInvites(group.id).catch(() => []);
      if (active.length) await store.revokeInvites(group.id, active.map(item => item.token)).catch(() => {});
      closeModal(); toast(member.displayName + ' is verwijderd. Maak een nieuwe uitnodigingslink voor nieuwe spelers.'); refreshGroup(true);
    } catch (error) { $('#play-remove-error').textContent = error.message; }
  };
}

// ----- initialisatie --------------------------------------------------------------------------------

export function initializePlay() {
  tracker.subscribe(onTrackerState);
  const badge = $('#gps-badge');
  if (badge) badge.onclick = () => { location.hash = '#play'; };
  // De registratie hoort bij één account: stop zodra iemand uitlogt of van account wisselt.
  subscribeStorage(state => {
    if (tracker.isTracking() && state.user?.uid !== ui.uid) tracker.stop();
    if (!state.user && ui.uid) resetFor(null);
  });
}
