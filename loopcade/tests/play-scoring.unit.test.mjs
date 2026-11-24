import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreTerritory, progressFor, buildResult} from '../dist/play-scoring.mjs';
import {getGameMode} from '../dist/play-modes.mjs';
import {cellCenter, cellOf, cellIdOf} from '../dist/play-grid.mjs';

const members = [{uid: 'a', displayName: 'Anna'}, {uid: 'b', displayName: 'Bram'}, {uid: 'c', displayName: 'Cato'}];

test('de speler met de meeste unieke cellen wint; de oppervlakte volgt uit het aantal cellen', () => {
  const scored = scoreTerritory({members, players: [
    {uid: 'a', cells: ['1_1', '1_2', '1_3']}, {uid: 'b', cells: ['1_1', '2_2']}, {uid: 'c', cells: []},
  ]});
  assert.deepEqual(scored.standings.map(s => [s.uid, s.cells, s.rank]), [['a', 3, 1], ['b', 2, 2], ['c', 0, 3]]);
  assert.equal(scored.standings[0].area, 30000);
  assert.deepEqual(scored.winners, ['a']);
});

test('elke cel telt maximaal één keer per speler, maar meerdere spelers mogen dezelfde cel hebben', () => {
  const scored = scoreTerritory({members, players: [
    {uid: 'a', cells: ['5_5', '5_5', '5_5', '6_6']}, {uid: 'b', cells: ['5_5']},
  ]});
  assert.equal(scored.standings.find(s => s.uid === 'a').cells, 2);
  assert.equal(scored.standings.find(s => s.uid === 'b').cells, 1);
  assert.equal(scored.totalCells, 2, 'unieke cellen in de groep');
  assert.deepEqual(scored.holders.get('5_5').sort(), ['a', 'b']);
});

test('gelijke stand deelt de plaats en de overwinning; zonder cellen is er geen winnaar', () => {
  const tie = scoreTerritory({members, players: [{uid: 'a', cells: ['1_1']}, {uid: 'b', cells: ['2_2']}, {uid: 'c', cells: ['3_3', '3_4']}]});
  assert.deepEqual(tie.standings.map(s => s.rank), [1, 2, 2]);
  const shared = scoreTerritory({members, players: [{uid: 'a', cells: ['1_1']}, {uid: 'b', cells: ['2_2']}]});
  assert.deepEqual(shared.winners.sort(), ['a', 'b']);
  const empty = scoreTerritory({members, players: []});
  assert.deepEqual(empty.winners, []);
  assert.deepEqual(empty.standings.map(s => s.rank), [1, 1, 1]);
});

test('niet-leden, ongeldige cellen en cellen buiten het speelgebied tellen niet', () => {
  const group = {start: cellCenter(cellOf({lon: 3.7219, lat: 51.05442}))};
  const near = cellIdOf(group.start), far = cellIdOf({lon: group.start.lon + 10000 / 69980, lat: group.start.lat});
  const mode = getGameMode('territory');
  const scored = mode.score({group, members: [members[0]], players: [
    {uid: 'a', cells: [near, far, 'kapot', 42, null]}, {uid: 'vreemde', cells: [near, near]},
  ]});
  assert.equal(scored.standings.length, 1);
  assert.equal(scored.standings[0].cells, 1);
  assert.equal(scored.totalCells, 1);
});

test('het aantal cellen per speler is begrensd', () => {
  const cells = Array.from({length: 40}, (_, i) => '1_' + i);
  const scored = scoreTerritory({members: [members[0]], players: [{uid: 'a', cells}], maxCells: 25});
  assert.equal(scored.standings[0].cells, 25);
});

test('persoonlijke voortgang toont plaats, achterstand en gedeelde cellen', () => {
  const scored = scoreTerritory({members, players: [
    {uid: 'a', cells: ['1_1', '1_2', '1_3', '1_4']}, {uid: 'b', cells: ['1_1', '9_9']}, {uid: 'c', cells: []},
  ]});
  const leader = progressFor(scored.standings, 'a', scored.holders);
  assert.equal(leader.leading, true);
  assert.equal(leader.shared, 1);
  assert.equal(leader.exclusive, 3);
  const second = progressFor(scored.standings, 'b', scored.holders);
  assert.deepEqual([second.rank, second.players, second.behind, second.leaderName], [2, 3, 2, 'Anna']);
  assert.equal(progressFor(scored.standings, 'onbekend', scored.holders), null);
  assert.equal(progressFor(scoreTerritory({members, players: []}).standings, 'a').leading, false, 'zonder cellen is niemand de leider');
});

test('een weekuitslag bevat de winnaar en een compacte stand, zonder celgegevens', () => {
  const scored = scoreTerritory({members, players: [{uid: 'b', cells: ['2_2', '2_3']}, {uid: 'a', cells: ['1_1']}]});
  const result = buildResult({weekId: '2026-11-16', mode: 'territory', scored});
  assert.equal(result.weekId, '2026-11-16');
  assert.deepEqual(result.winners, ['b']);
  assert.deepEqual(result.standings.map(s => s.uid), ['b', 'a', 'c']);
  assert.ok(!JSON.stringify(result).includes('2_2'));
  assert.ok(!('holders' in result));
});
