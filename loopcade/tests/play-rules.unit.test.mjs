import test from 'node:test';
import assert from 'node:assert/strict';
import {TerritorySession, territoryRules, isCellInPlay, describeTerritoryRules} from '../dist/play-rules.mjs';
import {cellCenter, cellOf, cellIdOf, distanceMeters, LON_STEP, LAT_STEP} from '../dist/play-grid.mjs';
import {getGameMode, gameModes, DEFAULT_MODE} from '../dist/play-modes.mjs';

const group = {start: cellCenter(cellOf({lon: 3.7219, lat: 51.05442}))};
const M_LON = LON_STEP / 100, M_LAT = LAT_STEP / 100; // graden per meter
const at = (east, north, from = group.start) => ({lon: from.lon + east * M_LON, lat: from.lat + north * M_LAT});
const T0 = Date.UTC(2026, 10, 24, 10, 0, 0); // dinsdag, wintertijd
const fix = (point, seconds, accuracy = 8) => ({...point, accuracy, time: T0 + seconds * 1000});
const cellCoords = id => id.split('_').map(Number);

// Wandel met 1,4 m/s naar het oosten, een meting per 5 s.
function walkEast(session, meters, {from = group.start, startAt = 0, back = false} = {}) {
  const found = [];
  const steps = Math.ceil(meters / 7);
  for (let i = 0; i <= steps; i++) {
    const east = back ? meters - Math.min(meters, i * 7) : Math.min(meters, i * 7);
    found.push(...session.addFix(fix(at(east, 0, from), startAt + i * 5)).found);
  }
  return found;
}

test('een wandeling verzamelt de doorkruiste cellen, elke cel één keer', () => {
  const session = new TerritorySession(group);
  const found = walkEast(session, 1000);
  assert.ok(found.length >= 10 && found.length <= 12, 'ongeveer 1 km = 10–12 cellen, kreeg ' + found.length);
  assert.equal(new Set(found.map(c => c.id)).size, found.length);
  assert.ok(found.every(c => c.weekId === '2026-11-23'));
  // Dezelfde route nogmaals (terug) levert niets nieuws.
  const again = walkEast(session, 1000, {startAt: 400, back: true});
  assert.equal(again.length, 0);
  assert.equal(session.stats.found, found.length);
});

test('GPS-metingen met slechte nauwkeurigheid of ongeldige waarden tellen niet', () => {
  const session = new TerritorySession(group);
  assert.deepEqual(session.addFix(fix(at(0, 0), 0, 120)), {accepted: false, reason: 'accuracy', found: []});
  assert.equal(session.addFix({lon: NaN, lat: 51, accuracy: 5, time: T0}).reason, 'invalid');
  assert.equal(session.addFix({lon: 3.7, lat: 51, accuracy: undefined, time: T0}).reason, 'accuracy');
  assert.equal(session.addFix(null).reason, 'invalid');
  assert.equal(session.addFix(fix(at(0, 0), 1)).accepted, true);
  assert.equal(session.addFix(fix(at(5, 0), 1)).reason, 'time', 'tijd moet vooruitgaan');
});

test('een onmogelijk snelle sprong (auto, GPS-glitch) wordt genegeerd en telt geen cellen', () => {
  const session = new TerritorySession(group);
  session.addFix(fix(at(0, 0), 0));
  const jump = session.addFix(fix(at(2500, 0), 5));
  assert.equal(jump.accepted, false);
  assert.equal(jump.reason, 'speed');
  assert.deepEqual(jump.found, []);
  const back = session.addFix(fix(at(10, 0), 10));
  assert.equal(back.accepted, true);
  assert.equal(session.stats.rejected, 1);
  assert.equal(session.stats.found, 1, 'alleen de startcel; de sprong telde niet');
});

test('rijden met een auto levert geen cellen op', () => {
  const session = new TerritorySession(group);
  let total = 0;
  for (let i = 0; i < 40; i++) total += session.addFix(fix(at(i * 150, 0), i * 10)).found.length; // 15 m/s
  assert.ok(total <= 2, 'alleen de startmeting telt; kreeg ' + total);
});

test('meerdere elkaar bevestigende afgekeurde metingen starten een nieuw stuk zonder de sprong in te vullen', () => {
  const session = new TerritorySession(group);
  session.addFix(fix(at(0, 0), 0));
  const first = session.addFix(fix(at(3000, 0), 5));
  const second = session.addFix(fix(at(3005, 0), 10));
  const third = session.addFix(fix(at(3010, 0), 15));
  assert.equal(first.accepted, false);
  assert.equal(second.accepted, false);
  // Buiten het speelgebied (5 km) is dit nog steeds niets waard, maar de sessie volgt de speler weer.
  assert.equal(third.accepted, true, 'de speler is echt verplaatst');
  assert.ok(third.found.length <= 1, 'hooguit de cel van de nieuwe positie');
});

test('een GPS-gat of grote afstand wordt niet ingevuld', () => {
  const session = new TerritorySession(group);
  session.addFix(fix(at(0, 0), 0));
  const gap = session.addFix(fix(at(200, 0), 1000)); // 16 minuten later, 200 m verderop
  assert.equal(gap.accepted, true);
  assert.equal(gap.found.length, 1);
  const segment = new TerritorySession(group);
  segment.addFix(fix(at(0, 0), 0));
  assert.equal(segment.addFix(fix(at(400, 0), 120)).found.length, 1, '400 m in 120 s is plausibel maar te lang om in te vullen');
});

test('privacy: elders gestart blijven cellen rond de startpositie privé', () => {
  const home = at(2000, 0);
  const session = new TerritorySession(group);
  const found = walkEast(session, 900, {from: home});
  assert.equal(session.exempt, false);
  assert.ok(found.length > 0, 'verderop tellen cellen wel');
  for (const cell of found) {
    const [x, y] = cellCoords(cell.id);
    assert.ok(distanceMeters({lon: (x + .5) * LON_STEP, lat: (y + .5) * LAT_STEP}, home) > territoryRules.privacyRadius, cell.id);
  }
  assert.ok(session.stats.hidden >= 2);
  assert.ok(!found.some(cell => cell.id === cellIdOf(home)), 'de cel van de startpositie blijft privé');
});

test('start je bij het gezamenlijke startpunt, dan telt ook de startcel', () => {
  const session = new TerritorySession(group);
  const first = session.addFix(fix(group.start, 0));
  assert.equal(session.exempt, true);
  assert.deepEqual(first.found.map(c => c.id), [cellIdOf(group.start)]);
});

test('cellen buiten het speelgebied tellen niet', () => {
  const session = new TerritorySession(group);
  const found = walkEast(session, 700, {from: at(5500, 0)});
  assert.equal(found.length, 0);
  assert.ok(session.stats.outside > 0);
  assert.equal(isCellInPlay(cellIdOf(group.start), group), true);
  assert.equal(isCellInPlay(cellIdOf(at(5600, 0)), group), false);
  assert.equal(isCellInPlay('kapot', group), false);
});

test('cellen na middernacht op zondag tellen voor de volgende week', () => {
  const session = new TerritorySession(group);
  const sunday = Date.UTC(2026, 10, 29, 22, 59, 50); // 23:59:50 Brussel
  const a = session.addFix({...at(0, 0), accuracy: 5, time: sunday});
  const b = session.addFix({...at(120, 0), accuracy: 5, time: sunday + 20000});
  assert.ok(a.found.length > 0 && a.found.every(c => c.weekId === '2026-11-23'));
  assert.ok(b.found.length > 0 && b.found.every(c => c.weekId === '2026-11-30'));
  // Dezelfde cel mag in een nieuwe week opnieuw gevonden worden, maar daarna niet nog eens.
  const startCell = cellIdOf(at(0, 0));
  assert.ok(a.found.some(cell => cell.id === startCell && cell.weekId === '2026-11-23'));
  assert.ok(b.found.some(cell => cell.id === startCell && cell.weekId === '2026-11-30'));
  const c = session.addFix({...at(0, 0), accuracy: 5, time: sunday + 40000});
  assert.equal(c.found.length, 0);
});

test('de sessie bewaart geen volledig spoor', () => {
  const session = new TerritorySession(group);
  walkEast(session, 500);
  const arrays = Object.entries(session).filter(([, value]) => Array.isArray(value));
  assert.deepEqual(arrays, []);
  assert.ok(session.last && session.origin, 'alleen de laatste meting en de startpositie');
});

test('een groep zonder startpunt kan geen sessie starten', () => {
  assert.throws(() => new TerritorySession({}));
});

test('het spelmodusregister koppelt regels aan scoring en kent alleen bestaande modi', () => {
  assert.equal(DEFAULT_MODE, 'territory');
  const mode = getGameMode('territory');
  assert.ok(mode && typeof mode.score === 'function' && typeof mode.createSession === 'function');
  assert.equal(getGameMode('onbekend'), null);
  assert.deepEqual(Object.keys(gameModes), ['territory']);
  const text = describeTerritoryRules().join(' ');
  for (const needle of ['maandag', 'één keer per speler', 'GPS', 'Privacy', 'demovrienden']) assert.ok(text.includes(needle), needle);
  assert.ok(mode.createSession({start: group.start}) instanceof TerritorySession);
});
