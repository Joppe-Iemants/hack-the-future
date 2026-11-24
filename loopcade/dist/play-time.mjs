// Weekgrenzen voor Spelen: maandag 00:00 tot maandag 00:00 in Europe/Brussels.
// Alle functies zijn puur (geen Date.now()) zodat weekovergangen testbaar zijn.
export const PLAY_TIMEZONE = 'Europe/Brussels';

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PLAY_TIMEZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function brusselsParts(ms) {
  const parts = {};
  for (const {type, value} of formatter.formatToParts(new Date(ms))) parts[type] = Number(value);
  return parts;
}

// Minuten tussen UTC en Brussel op dit tijdstip (60 of 120).
function offsetMs(ms) {
  const p = brusselsParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// UTC-moment waarop het Brusselse kalenderdatum-middernacht begint.
function brusselsMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetMs(guess);
  const corrected = guess - offsetMs(instant);
  if (corrected !== instant) instant = corrected;
  return instant;
}

const pad = n => String(n).padStart(2, '0');
export const dateId = (year, month, day) => year + '-' + pad(month) + '-' + pad(day);

// Maandag (kalenderdatum) van de Brusselse week waarin dit moment valt.
function mondayOf(ms) {
  const p = brusselsParts(ms);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - sinceMonday);
  return {year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate()};
}

const parseWeekId = id => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
  return match ? {year: Number(match[1]), month: Number(match[2]), day: Number(match[3])} : null;
};
export const isWeekId = id => typeof id === 'string' && Boolean(parseWeekId(id));

export function addWeeks(weekId, count) {
  const p = parseWeekId(weekId);
  if (!p) throw new Error('Ongeldige week: ' + weekId);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day + 7 * count));
  return dateId(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function weekOf(ms) {
  const monday = mondayOf(ms);
  const id = dateId(monday.year, monday.month, monday.day);
  const start = brusselsMidnight(monday.year, monday.month, monday.day);
  const next = parseWeekId(addWeeks(id, 1));
  const end = brusselsMidnight(next.year, next.month, next.day);
  return {id, start, end};
}

export const weekIdOf = ms => weekOf(ms).id;
export const weekRange = weekId => {
  const p = parseWeekId(weekId);
  if (!p) throw new Error('Ongeldige week: ' + weekId);
  const next = parseWeekId(addWeeks(weekId, 1));
  return {id: weekId, start: brusselsMidnight(p.year, p.month, p.day), end: brusselsMidnight(next.year, next.month, next.day)};
};

export function remaining(now) {
  const week = weekOf(now);
  return {...week, remainingMs: Math.max(0, week.end - now)};
}

// Weken die nog afgesloten moeten worden: alles vanaf de eerste week van de groep
// tot en met de vorige week, zonder reeds bewaarde uitslagen. Begrensd tot `limit` weken.
export function weeksToClose(firstWeek, currentWeek, closedWeeks = [], limit = 12) {
  if (!isWeekId(firstWeek) || !isWeekId(currentWeek)) return [];
  const closed = new Set(closedWeeks);
  const open = [];
  for (let week = firstWeek; week < currentWeek && open.length < 400; week = addWeeks(week, 1)) {
    if (!closed.has(week)) open.push(week);
  }
  return open.slice(-limit);
}

export function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400), hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor(total / 60) % 60, seconds = total % 60;
  if (days) return days + ' d ' + hours + ' u ' + pad(minutes) + ' min';
  return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
}

const dayFormat = new Intl.DateTimeFormat('nl-BE', {timeZone: PLAY_TIMEZONE, day: 'numeric', month: 'short'});
export function weekLabel(weekId) {
  const {start, end} = weekRange(weekId);
  return dayFormat.format(new Date(start)) + ' – ' + dayFormat.format(new Date(end - 3600000));
}
