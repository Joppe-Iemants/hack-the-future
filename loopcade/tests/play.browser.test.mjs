import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc, setDoc, updateDoc, getDocs, collection, getDoc, Timestamp} from 'firebase/firestore';
import {cellCenter, cellOf, LON_STEP, LAT_STEP} from '../dist/play-grid.mjs';
import {weekIdOf, addWeeks} from '../dist/play-time.mjs';

const PORT = 8000, ORIGIN = 'http://127.0.0.1:' + PORT;
const root = fileURLToPath(new URL('../', import.meta.url));
const start = cellCenter(cellOf({lon: 3.7219, lat: 51.05442})); // Korenmarkt, zoals het standaard startpunt
const M_LON = LON_STEP / 100, M_LAT = LAT_STEP / 100;
let browser, server, environment;

before(async () => {
  let running = await fetch(ORIGIN).then(() => true).catch(() => false);
  if (!running) {
    server = spawn('python', ['serve.py'], {cwd: root, stdio: 'ignore'});
    for (let attempt = 0; attempt < 50 && !running; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      running = await fetch(ORIGIN).then(() => true).catch(() => false);
    }
  }
  if (!running) throw new Error('Loopcade-server kon niet worden gestart.');
  browser = await chromium.launch({headless: true});
  environment = await initializeTestEnvironment({projectId: 'demo-loopcade', firestore: {host: '127.0.0.1', port: 8080}});
});
after(async () => {
  await browser?.close();
  await environment?.cleanup();
  if (server) server.kill();
});

// Een deterministische nep-GPS: de test bepaalt positie, nauwkeurigheid en tijdstip van elke meting.
const fakeGeolocation = () => {
  const watchers = new Map(); let next = 0;
  Object.defineProperty(navigator, 'geolocation', {configurable: true, value: {
    watchPosition(ok, fail) { watchers.set(++next, {ok, fail}); return next; },
    clearWatch(id) { watchers.delete(id); },
    getCurrentPosition(ok) { ok({timestamp: Date.now(), coords: {longitude: 3.7219, latitude: 51.05442, accuracy: 10}}); },
  }});
  window.__gps = {
    watching: () => watchers.size,
    send: (longitude, latitude, accuracy, timestamp) => { for (const watcher of watchers.values()) watcher.ok({timestamp, coords: {longitude, latitude, accuracy}}); },
    fail: code => { for (const watcher of watchers.values()) watcher.fail({code}); },
  };
};

async function newPlayer({viewport = {width: 1440, height: 1100}} = {}) {
  const context = await browser.newContext({viewport});
  await context.addInitScript(fakeGeolocation);
  await context.route('**/firebase-config.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const firebaseConfig={apiKey:'demo-api-key',authDomain:'demo-loopcade.firebaseapp.com',projectId:'demo-loopcade',appId:'demo-app-id'};
      export const FIREBASE_SDK_VERSION='13.4.0';
      export const emulatorConfig={enabled:true,authUrl:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8080};
      export const firebaseIsConfigured=()=>true;`,
  }));
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return {context, page, errors};
}

async function guestLogin(page) {
  if (!await page.locator('#guest-login').isVisible()) await page.locator('#account-button').click();
  await page.locator('#guest-login').click();
  await expect(page.locator('#account-status')).toHaveText('Gastaccount', {timeout: 15000});
}
const uidOf = page => page.evaluate(async () => (await import('/storage.mjs')).getStorageState().user.uid);
const groupIdOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-play-group')));
const myCells = async page => Number(/^(\d+)/.exec(await page.locator('#play-ranking li.me b').innerText())[1]);

// Elke speler heeft een eigen nep-klok die alleen vooruit loopt, zodat de tijdstippen van de metingen kloppen.
const clocks = new WeakMap();
const clockOf = page => clocks.get(page) ?? clocks.set(page, {t: Date.now() - 3600000}).get(page);

// Wandel met 1,4 m/s: een meting elke 5 s, 7 m verder. Richting als [oost, noord] eenheidsvector.
async function walk(page, {meters, direction = [1, 0], from = start, offset = [0, 0], accuracy = 8}) {
  const clock = clockOf(page), steps = Math.ceil(meters / 7), t0 = clock.t + 5000;
  clock.t = t0 + steps * 5000;
  await page.evaluate(({steps, meters, direction, from, offset, t0, accuracy, M_LON, M_LAT}) => {
    for (let i = 0; i <= steps; i++) {
      const d = Math.min(meters, i * 7);
      window.__gps.send(from.lon + (offset[0] + direction[0] * d) * M_LON, from.lat + (offset[1] + direction[1] * d) * M_LAT, accuracy, t0 + i * 5000);
    }
  }, {steps, meters, direction, from, offset, t0, accuracy, M_LON, M_LAT});
}

async function startTracking(page) {
  await page.locator('#play-start').click();
  if (await page.locator('#play-consent-accept').isVisible()) await page.locator('#play-consent-accept').click();
  await expect(page.locator('#play-stop')).toBeVisible();
  await expect(page.locator('#gps-badge')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__gps.watching()), 1);
}

async function stopTracking(page) {
  await page.locator('#play-stop').click();
  await expect(page.locator('#play-start')).toBeVisible();
  await expect(page.locator('#gps-badge')).toBeHidden();
  assert.equal(await page.evaluate(() => window.__gps.watching()), 0, 'GPS is na Stop vrijgegeven');
  await expect(page.locator('#play-sync')).toContainText('Bewaard', {timeout: 15000});
}

test('Spelen: groep, uitnodiging, GPS, klassement, toegang, weekovergang en verwijderen', {timeout: 240000}, async () => {
  // ---------- niet ingelogd: regels zijn leesbaar, groepen niet bereikbaar ----------
  const anon = await newPlayer();
  await anon.page.goto(ORIGIN + '/#play');
  await expect(anon.page.locator('#play-login')).toBeVisible({timeout: 15000});
  await expect(anon.page.locator('#play-rules')).toContainText('maandag 00:00');
  await expect(anon.page.locator('#play-rules')).toContainText('demovrienden');
  await expect(anon.page.locator('[data-page="play"]')).toHaveAttribute('aria-current', 'page');
  await anon.context.close();

  // ---------- eigenaar maakt een groep ----------
  const a = await newPlayer();
  const pageA = a.page;
  await pageA.goto(ORIGIN + '/');
  await expect(pageA.locator('#account-status')).not.toHaveText('Account laden…', {timeout: 30000});
  await guestLogin(pageA);
  await pageA.locator('#dialog-close').click();
  await pageA.locator('[data-page="play"]').click();
  await expect(pageA.locator('#play-new')).toBeVisible({timeout: 15000});
  await expect(pageA.locator('#play')).toContainText('Terreinjacht');
  await pageA.locator('#play-new').click();
  await pageA.locator('#play-group-name').fill('Loopmaatjes');
  await pageA.locator('#play-my-name').fill('Anna');
  await pageA.locator('#play-place-search').fill('korenmarkt');
  await expect(pageA.locator('#play-place-list [data-place]').first()).toBeVisible({timeout: 30000});
  await pageA.locator('#play-place-search').fill('');
  await expect(pageA.locator('#play-place-list [data-place]')).toHaveCount(8);
  await pageA.locator('#play-place-list [data-place]').first().click();
  await expect(pageA.locator('#play-place-chosen')).toContainText('Korenmarkt');
  await pageA.locator('#play-create').click();
  await expect(pageA.locator('#play-ranking li')).toHaveCount(1, {timeout: 20000});
  await expect(pageA.locator('#play-ranking li.me')).toContainText('Anna (jij)');
  await expect(pageA.locator('#play-countdown')).toHaveText(/\d/);
  await expect(pageA.locator('#play-me')).toContainText('#1');
  await expect(pageA.locator('#play-rules')).toContainText('Elke cel telt maximaal één keer per speler');
  for (const demo of ['Noor', 'Milan', 'Yara']) {
    await expect(pageA.locator('#play-ranking')).not.toContainText(demo);
    await expect(pageA.locator('#play-members')).not.toContainText(demo);
  }
  await expect(pageA.locator('#play-rules')).toContainText('doen hier niet mee');
  await expect(pageA.locator('#play-history')).toContainText('Nog geen afgesloten weken');
  const groupId = await groupIdOf(pageA);
  const uidA = await uidOf(pageA);

  // ---------- GPS: zonder toestemming geen registratie ----------
  await pageA.locator('#play-start').click();
  await expect(pageA.locator('#play-consent-accept')).toBeVisible();
  assert.equal(await pageA.evaluate(() => window.__gps.watching()), 0, 'zonder akkoord wordt geen locatie opgevraagd');
  await pageA.locator('#play-consent-cancel').click();
  assert.equal(await pageA.evaluate(() => window.__gps.watching()), 0);
  await expect(pageA.locator('#play-start')).toBeVisible();

  // ---------- GPS: wandeling van 900 m, elke cel telt één keer ----------
  await startTracking(pageA);
  await walk(pageA, {meters: 900});
  await expect(pageA.locator('#play-gps-count')).toContainText('nieuwe cellen');
  await expect.poll(() => myCells(pageA), {timeout: 10000}).toBeGreaterThanOrEqual(8);
  const during = await myCells(pageA);
  assert.ok(during <= 11, 'ongeveer 9–10 cellen tijdens het lopen, kreeg ' + during);
  await walk(pageA, {meters: 900, direction: [-1, 0], offset: [900, 0]}); // dezelfde weg terug
  // Een auto-sprong en een onnauwkeurige meting tellen niet.
  const clock = clockOf(pageA);
  await pageA.evaluate(({lon, lat, t, M_LON, M_LAT}) => {
    window.__gps.send(lon + 4000 * M_LON, lat, 8, t + 5000);
    window.__gps.send(lon, lat + 300 * M_LAT, 300, t + 10000);
  }, {lon: start.lon, lat: start.lat, t: clock.t, M_LON, M_LAT});
  await pageA.waitForTimeout(1600); // het klassement wordt hooguit één keer per seconde bijgewerkt
  assert.equal(await myCells(pageA), during, 'dezelfde cellen telden niet dubbel en de sprong telde niet');
  await stopTracking(pageA);
  const saved = await myCells(pageA);
  assert.equal(saved, during);
  await expect(pageA.locator('#play-ranking li.me')).toContainText('ha');
  assert.equal(await pageA.evaluate(() => localStorage.getItem('loopcade-play-pending')), '{}', 'wachtrij is leeg na bewaren');

  // De cellen staan in Firestore en overleven een herlaadbeurt.
  await pageA.reload();
  await expect(pageA.locator('#play-ranking li.me')).toBeVisible({timeout: 20000});
  assert.equal(await myCells(pageA), saved);

  // ---------- privacy: Firestore bewaart alleen cel-id’s ----------
  const week = weekIdOf(Date.now());
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const player = (await getDoc(doc(db, `groups/${groupId}/weeks/${week}/players/${uidA}`))).data();
    assert.deepEqual(Object.keys(player).sort(), ['cells', 'uid', 'updatedAt', 'weekId']);
    assert.equal(player.cells.length, saved);
    assert.ok(player.cells.every(id => /^-?\d+_-?\d+$/.test(id)), 'alleen rastercellen, geen coördinaten');
    const everything = JSON.stringify((await getDoc(doc(db, `groups/${groupId}`))).data());
    assert.ok(!everything.includes('accuracy'));
  });

  // ---------- uitnodigen ----------
  await pageA.locator('#play-invite').click();
  await expect(pageA.locator('#play-invite-link')).toBeVisible();
  const link = await pageA.locator('#play-invite-link').inputValue();
  assert.match(link, /#play\/join\/[A-Za-z0-9]{20}\.[A-Za-z0-9_-]{20,}$/);
  await pageA.locator('#dialog-close').click();

  // ---------- tweede speler: link openen, inloggen, deelnemen ----------
  const b = await newPlayer({viewport: {width: 390, height: 900}});
  const pageB = b.page;
  await pageB.goto(link);
  await expect(pageB.locator('#play-login')).toBeVisible({timeout: 30000});
  await expect(pageB.locator('#play')).toContainText('uitgenodigd');
  await pageB.locator('#play-login').click();
  await pageB.locator('#guest-login').click();
  await expect(pageB.locator('#play-join-name')).toBeVisible({timeout: 30000});
  await expect(pageB.locator('#play-join-preview')).toContainText('Loopmaatjes');
  await expect(pageB.locator('#play-join-preview')).toContainText('Anna');
  await pageB.locator('#play-join-name').fill('Bram');
  await pageB.locator('#play-join-confirm').click();
  await expect(pageB.locator('#play-ranking li')).toHaveCount(2, {timeout: 20000});
  await expect(pageB.locator('#play-ranking li').first()).toContainText('Anna');
  assert.equal(await pageB.evaluate(() => location.hash), '#play', 'de uitnodiging wordt uit de adresbalk gehaald');
  const uidB = await uidOf(pageB);
  await expect(pageB.locator('#play-members')).not.toContainText('Vrienden uitnodigen');
  await expect(pageB.locator('#play-members [data-play^="remove"]')).toHaveCount(0);

  // Bram loopt 500 m noordwaarts vanaf het startpunt: de startcel is gedeeld met Anna.
  await startTracking(pageB);
  await walk(pageB, {meters: 500, direction: [0, 1]});
  await expect.poll(() => myCells(pageB), {timeout: 10000}).toBeGreaterThanOrEqual(4);
  await stopTracking(pageB);
  const bram = await myCells(pageB);
  assert.ok(bram >= 4 && bram <= 6, 'ongeveer 5–6 cellen, kreeg ' + bram);
  await expect(pageB.locator('#play-me')).toContainText('#2');
  await expect(pageB.locator('#play-me')).toContainText('deel je met anderen');
  await expect(pageB.locator('#play-me')).toContainText('Anna voorbij');
  await pageB.screenshot({path: 'test-results/play-mobile.png', fullPage: true});

  // Anna ziet Bram na vernieuwen, en het klassement toont gedeelde cellen.
  await pageA.locator('#play-refresh').click();
  await expect(pageA.locator('#play-ranking li')).toHaveCount(2);
  await expect(pageA.locator('#play-ranking li').nth(1)).toContainText('Bram');
  await expect(pageA.locator('#play-ranking')).toContainText(`${bram} cellen`);
  await expect(pageA.locator('#play-legend .play-chip')).toHaveCount(2);
  await pageA.locator('#play-legend .play-chip').nth(1).click();
  await expect(pageA.locator('#play-legend .play-chip').nth(1)).toHaveAttribute('aria-pressed', 'false');
  await pageA.locator('#play-legend .play-chip').nth(1).click();
  await pageA.screenshot({path: 'test-results/play-desktop.png', fullPage: true});

  // ---------- toegang: een buitenstaander komt niet binnen ----------
  const c = await newPlayer();
  await c.page.goto(ORIGIN + '/');
  await expect(c.page.locator('#account-status')).not.toHaveText('Account laden…', {timeout: 30000});
  await guestLogin(c.page);
  await c.page.locator('#dialog-close').click();
  const outsider = await c.page.evaluate(async ({groupId, week, uidA}) => {
    const {firestoreContext} = await import('/storage.mjs');
    const {db, sdk} = await firestoreContext();
    const attempt = async fn => { try { await fn(); return 'toegestaan'; } catch (error) { return error.code; } };
    return {
      group: await attempt(() => sdk.getDoc(sdk.doc(db, 'groups', groupId))),
      members: await attempt(() => sdk.getDocs(sdk.collection(db, 'groups', groupId, 'members'))),
      cells: await attempt(() => sdk.getDoc(sdk.doc(db, 'groups', groupId, 'weeks', week, 'players', uidA))),
      invites: await attempt(() => sdk.getDocs(sdk.collection(db, 'groups', groupId, 'invites'))),
      write: await attempt(() => sdk.setDoc(sdk.doc(db, 'groups', groupId, 'weeks', week, 'players', uidA), {uid: uidA, weekId: week, cells: ['1_1'], updatedAt: sdk.serverTimestamp()})),
    };
  }, {groupId, week, uidA});
  assert.deepEqual(outsider, {group: 'permission-denied', members: 'permission-denied', cells: 'permission-denied', invites: 'permission-denied', write: 'permission-denied'});
  await c.page.locator('[data-page="play"]').click();
  await expect(c.page.locator('#play-new')).toBeVisible({timeout: 15000});
  await c.page.locator('#play-join').click();
  await c.page.locator('#play-join-code').fill('dit-is-geen-code');
  await c.page.locator('#play-join-check').click();
  await expect(c.page.locator('#play-join-preview')).toContainText('klopt niet');
  await c.page.locator('#play-join-code').fill(groupId + '.OnbekendTokenOnbekendToken');
  await c.page.locator('#play-join-check').click();
  await expect(c.page.locator('#play-join-preview')).toContainText('bestaat niet');
  await c.context.close();

  // ---------- weekovergang: vorige weken worden afgesloten, de nieuwe week begint leeg ----------
  const thisWeek = weekIdOf(Date.now()), lastWeek = addWeeks(thisWeek, -1);
  // Cellen rond het startpunt, dus binnen het speelgebied: Anna 3 cellen, Bram 5 cellen.
  const startCell = cellOf(start);
  const cellIds = count => Array.from({length: count}, (_, i) => (startCell.x + i) + '_' + startCell.y);
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, 'groups', groupId), {firstWeek: addWeeks(thisWeek, -3)});
    await setDoc(doc(db, `groups/${groupId}/weeks/${lastWeek}/players/${uidA}`), {uid: uidA, weekId: lastWeek, cells: cellIds(3), updatedAt: Timestamp.now()});
    await setDoc(doc(db, `groups/${groupId}/weeks/${lastWeek}/players/${uidB}`), {uid: uidB, weekId: lastWeek, cells: cellIds(5), updatedAt: Timestamp.now()});
  });
  await pageA.reload();
  await expect(pageA.locator('#play-history [data-week]')).toHaveCount(3, {timeout: 25000});
  await expect(pageA.locator(`#play-history [data-week="${lastWeek}"]`)).toContainText('Bram');
  await expect(pageA.locator(`#play-history [data-week="${lastWeek}"]`)).toContainText('5 cellen');
  await expect(pageA.locator('#play-history')).toContainText('Geen winnaar');
  await expect(pageA.locator('#play-ranking li.me')).toBeVisible();
  assert.equal(await myCells(pageA), saved, 'de lopende week behoudt haar eigen score');
  // Dezelfde uitslag voor Bram, zonder dubbele afsluiting.
  await pageB.reload();
  await expect(pageB.locator('#play-history [data-week]')).toHaveCount(3, {timeout: 25000});
  await environment.withSecurityRulesDisabled(async context => {
    const results = await getDocs(collection(context.firestore(), `groups/${groupId}/results`));
    assert.equal(results.size, 3);
    const last = results.docs.find(snapshot => snapshot.id === lastWeek).data();
    assert.deepEqual(last.winners, [uidB]);
    assert.ok(!JSON.stringify(last).includes(startCell.x + '_'), 'uitslag bevat geen cel-id’s');
  });

  // ---------- eigenaar verwijdert Bram: toegang is weg en de oude link werkt niet meer ----------
  await pageA.locator(`#play-members [data-play^="remove:"]`).click();
  await pageA.locator('#play-remove-yes').click();
  await expect(pageA.locator('#play-members .activity-row')).toHaveCount(1, {timeout: 15000});
  await pageB.reload();
  await expect(pageB.locator('#play-new')).toBeVisible({timeout: 25000});
  await expect(pageB.locator('#play-ranking')).toHaveCount(0);
  await pageB.goto(link);
  await expect(pageB.locator('#play-join-preview')).toContainText('ingetrokken', {timeout: 25000});

  assert.deepEqual([...a.errors, ...b.errors], [], 'geen onverwachte browserfouten');
  await a.context.close();
  await b.context.close();
});
