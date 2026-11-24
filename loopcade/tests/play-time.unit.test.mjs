import test from 'node:test';
import assert from 'node:assert/strict';
import {weekOf, weekIdOf, weekRange, remaining, addWeeks, weeksToClose, formatRemaining, isWeekId} from '../dist/play-time.mjs';

const HOUR = 3600000;

test('een week loopt van maandag 00:00 tot maandag 00:00 in Brussel (wintertijd)', () => {
  const week = weekOf(Date.UTC(2026, 10, 24, 12, 0)); // dinsdag 24 november 2026
  assert.equal(week.id, '2026-11-23');
  assert.equal(week.start, Date.UTC(2026, 10, 22, 23, 0)); // maandag 00:00 CET
  assert.equal(week.end, Date.UTC(2026, 10, 29, 23, 0));
});

test('in de zomer ligt de weekgrens op zondag 22:00 UTC', () => {
  const week = weekOf(Date.UTC(2026, 6, 15, 9, 0));
  assert.equal(week.id, '2026-07-13');
  assert.equal(week.start, Date.UTC(2026, 6, 12, 22, 0));
  assert.equal(week.end, Date.UTC(2026, 6, 19, 22, 0));
});

test('zondag 23:59:59 hoort nog bij de oude week en maandag 00:00:00 bij de nieuwe', () => {
  const lastSecond = Date.UTC(2026, 10, 29, 22, 59, 59), firstSecond = Date.UTC(2026, 10, 29, 23, 0, 0);
  assert.equal(weekIdOf(lastSecond), '2026-11-23');
  assert.equal(weekIdOf(firstSecond), '2026-11-30');
  assert.equal(weekOf(lastSecond).end, firstSecond);
  // Zelfde grens in de zomer: zondag 23:59:59 CEST = 21:59:59 UTC.
  assert.equal(weekIdOf(Date.UTC(2026, 6, 19, 21, 59, 59)), '2026-07-13');
  assert.equal(weekIdOf(Date.UTC(2026, 6, 19, 22, 0, 0)), '2026-07-20');
});

test('de weekovergang volgt de lokale tijd rond zomer- en wintertijd', () => {
  const spring = weekOf(Date.UTC(2026, 2, 29, 12, 0)); // zondag 29 maart 2026: klok vooruit
  assert.equal(spring.id, '2026-03-23');
  assert.equal((spring.end - spring.start) / HOUR, 167);
  assert.equal(weekIdOf(spring.end), '2026-03-30');
  const autumn = weekOf(Date.UTC(2026, 9, 25, 12, 0)); // zondag 25 oktober 2026: klok terug
  assert.equal(autumn.id, '2026-10-19');
  assert.equal((autumn.end - autumn.start) / HOUR, 169);
  assert.equal(weekIdOf(autumn.end - 1), '2026-10-19');
  assert.equal(weekIdOf(autumn.end), '2026-10-26');
});

test('de jaarwisseling en schrikkeljaren geven correcte week-id’s', () => {
  assert.equal(weekIdOf(Date.UTC(2027, 0, 1, 12)), '2026-12-28');
  assert.equal(addWeeks('2026-12-28', 1), '2027-01-04');
  assert.equal(addWeeks('2028-02-28', 1), '2028-03-06');
  assert.equal(addWeeks('2026-11-23', -1), '2026-11-16');
  assert.throws(() => addWeeks('kapot', 1));
  assert.equal(weekRange('2026-11-23').end, weekOf(Date.UTC(2026, 10, 24)).end);
  assert.ok(isWeekId('2026-11-23') && !isWeekId('2026-13') && !isWeekId(undefined));
});

test('de resterende speeltijd telt af tot de weekgrens', () => {
  const now = Date.UTC(2026, 10, 29, 21, 0); // zondag 22:00 Brussel
  const left = remaining(now);
  assert.equal(left.remainingMs, 2 * HOUR);
  assert.equal(formatRemaining(left.remainingMs), '02:00:00');
  assert.equal(formatRemaining(3 * 86400000 + 4 * HOUR + 12 * 60000), '3 d 4 u 12 min');
  assert.equal(formatRemaining(-5), '00:00:00');
});

test('alleen nog niet afgesloten, voltooide weken worden afgesloten', () => {
  assert.deepEqual(weeksToClose('2026-11-02', '2026-11-23', []), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.deepEqual(weeksToClose('2026-11-02', '2026-11-23', ['2026-11-09']), ['2026-11-02', '2026-11-16']);
  assert.deepEqual(weeksToClose('2026-11-23', '2026-11-23', []), [], 'de lopende week sluit nog niet');
  assert.deepEqual(weeksToClose('2026-01-05', '2026-11-23', [], 3), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.deepEqual(weeksToClose('kapot', '2026-11-23'), []);
});
