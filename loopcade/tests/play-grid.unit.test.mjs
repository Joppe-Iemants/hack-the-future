import test from 'node:test';
import assert from 'node:assert/strict';
import {cellOf, cellId, parseCellId, cellsOnSegment, cellCenter, cellBounds, distanceMeters, LON_STEP, LAT_STEP, CELL_METERS, areaOf, cellIdOf} from '../dist/play-grid.mjs';

const korenmarkt = {lon: 3.7219, lat: 51.05442};

test('een cel is ongeveer 100 × 100 meter', () => {
  const {west, south, east, north} = cellBounds(cellOf(korenmarkt));
  assert.ok(Math.abs(distanceMeters({lon: west, lat: south}, {lon: east, lat: south}) - CELL_METERS) < 0.5);
  assert.ok(Math.abs(distanceMeters({lon: west, lat: south}, {lon: west, lat: north}) - CELL_METERS) < 0.5);
  assert.equal(areaOf(3), 30000);
});

test('punten in dezelfde cel geven dezelfde cel-id, een punt aan de overkant een andere', () => {
  const cell = cellOf(korenmarkt), center = cellCenter(cell);
  assert.equal(cellIdOf(center), cellId(cell.x, cell.y));
  assert.equal(cellIdOf({lon: center.lon + LON_STEP * .4, lat: center.lat - LAT_STEP * .4}), cellId(cell.x, cell.y));
  assert.notEqual(cellIdOf({lon: center.lon + LON_STEP * .6, lat: center.lat}), cellId(cell.x, cell.y));
});

test('cel-id’s worden strikt gevalideerd', () => {
  assert.deepEqual(parseCellId('2605_56829'), {x: 2605, y: 56829});
  assert.deepEqual(parseCellId('-12_5'), {x: -12, y: 5});
  for (const bad of ['', '1_', '1.5_2', 'a_b', '1_2_3', '12345678_1', null, 7, '1_2 ']) assert.equal(parseCellId(bad), null, String(bad));
});

test('een recht traject geeft alle doorkruiste cellen, zonder dubbele cellen', () => {
  const a = cellCenter({x: 10, y: 10}), b = cellCenter({x: 14, y: 10});
  assert.deepEqual(cellsOnSegment(a, b).map(c => c.x), [10, 11, 12, 13, 14]);
  const up = cellsOnSegment(cellCenter({x: 3, y: 3}), cellCenter({x: 3, y: 0}));
  assert.deepEqual(up.map(c => c.y), [3, 2, 1, 0]);
  const diagonal = cellsOnSegment({lon: 10.2 * LON_STEP, lat: 10.2 * LAT_STEP}, {lon: 13.8 * LON_STEP, lat: 12.9 * LAT_STEP});
  const ids = diagonal.map(c => cellId(c.x, c.y));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], '10_10');
  assert.equal(ids.at(-1), '13_12');
  for (let i = 1; i < diagonal.length; i++) {
    const step = Math.abs(diagonal[i].x - diagonal[i - 1].x) + Math.abs(diagonal[i].y - diagonal[i - 1].y);
    assert.ok(step >= 1 && step <= 2, 'opeenvolgende cellen grenzen aan elkaar');
  }
});

test('een stuk binnen één cel levert precies die cel; ook langs celgrenzen blijft het eindig', () => {
  const inside = cellsOnSegment(cellCenter({x: 5, y: 5}), {lon: 5.7 * LON_STEP, lat: 5.3 * LAT_STEP});
  assert.deepEqual(inside, [{x: 5, y: 5}]);
  const onBorder = cellsOnSegment({lon: 6 * LON_STEP, lat: 6 * LAT_STEP}, {lon: 8 * LON_STEP, lat: 8 * LAT_STEP});
  assert.ok(onBorder.length >= 3 && onBorder.length <= 5);
  assert.equal(cellsOnSegment(korenmarkt, korenmarkt).length, 1);
});
