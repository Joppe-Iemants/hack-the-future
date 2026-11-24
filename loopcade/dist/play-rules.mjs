// Spelregels van de modus "Terreinjacht": wat telt mee en wat niet.
// De puntentelling staat bewust apart in play-scoring.mjs; play-modes.mjs koppelt beide.
import {CELL_METERS, cellsOnSegment, cellId, cellOf, cellCenter, distanceMeters, parseCellId} from './play-grid.mjs';
import {weekIdOf} from './play-time.mjs';

export const territoryRules = Object.freeze({
  id: 'territory',
  cellMeters: CELL_METERS,
  playRadius: 5000,       // m rond het gezamenlijke startpunt waarbinnen cellen meetellen
  startZoneRadius: 300,   // start je binnen deze afstand van het startpunt, dan telt alles
  privacyRadius: 250,     // elders gestart: cellen rond je startpositie blijven privé
  maxAccuracy: 40,        // m: onnauwkeurigere GPS-metingen worden genegeerd
  maxSpeed: 6.5,          // m/s (± 23 km/u): sneller is geen wandelen of lopen
  maxSegment: 250,        // m: langere sprongen tussen twee metingen worden niet ingevuld
  maxGapSeconds: 120,     // s: bij een langer GPS-gat wordt de tussenliggende route niet ingevuld
  rebaseAfter: 3,         // aaneensluitende afgekeurde metingen die elkaar bevestigen
  maxPlayers: 12,
  maxCellsPerWeek: 2500,
});

export function describeTerritoryRules(rules = territoryRules) {
  const km = rules.playRadius / 1000;
  return [
    'Een week loopt van maandag 00:00 tot maandag 00:00 (tijd in België). Daarna begint iedereen opnieuw met een lege score.',
    'De kaart is verdeeld in cellen van ongeveer ' + rules.cellMeters + ' × ' + rules.cellMeters + ' m (1 hectare).',
    'Een cel telt alleen als je tijdens het wandelen of lopen met geregistreerde GPS-metingen echt door die cel gaat. Geplande routes, demovrienden en voorbeeldrondjes tellen niet.',
    'Elke cel telt maximaal één keer per speler per week. Meerdere spelers kunnen dezelfde cel verdienen.',
    'Wie na zondag de meeste cellen (de grootste oppervlakte) heeft, wint. Bij gelijke stand delen spelers de overwinning.',
    'Alleen cellen binnen ' + km.toLocaleString('nl-BE') + ' km van het gezamenlijke startpunt tellen mee.',
    'Metingen met een nauwkeurigheid slechter dan ' + rules.maxAccuracy + ' m, of die sneller gaan dan ' + Math.round(rules.maxSpeed * 3.6) + ' km/u, worden genegeerd. Bij een GPS-gat van meer dan ' + rules.maxGapSeconds + ' seconden wordt de tussenliggende route niet ingevuld.',
    'Privacy: je precieze route en tijdstippen worden niet bewaard of gedeeld. Alleen de cellen waar je doorheen kwam gaan naar je groep. Start je niet binnen ' + rules.startZoneRadius + ' m van het startpunt, dan blijven de cellen binnen ' + rules.privacyRadius + ' m van je startpositie privé en tellen ze niet mee.',
  ];
}

// Is deze cel een geldige speelcel voor deze groep?
export function isCellInPlay(id, group, rules = territoryRules) {
  const cell = parseCellId(id);
  if (!cell || !group?.start) return false;
  return distanceMeters(cellCenter(cell), group.start) <= rules.playRadius;
}

const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);

// Verwerkt GPS-metingen één voor één tot nieuwe cellen. De sessie bewaart alleen de laatste
// meting en de gevonden cellen, nooit het volledige spoor.
export class TerritorySession {
  constructor(group, rules = territoryRules) {
    if (!group?.start || !finiteNumber(group.start.lon) || !finiteNumber(group.start.lat)) {
      throw new Error('Een groep heeft een startpunt nodig.');
    }
    this.group = group;
    this.rules = rules;
    this.last = null;
    this.origin = null;
    this.exempt = false;
    this.candidate = null;
    this.rejectedStreak = 0;
    this.seen = new Map(); // weekId -> Set van cel-id's die in deze sessie al gevonden zijn
    this.stats = {accepted: 0, rejected: 0, found: 0, hidden: 0, outside: 0};
  }

  eligible(cell) {
    const center = cellCenter(cell);
    if (distanceMeters(center, this.group.start) > this.rules.playRadius) return 'outside';
    if (!this.exempt && distanceMeters(center, this.origin) <= this.rules.privacyRadius) return 'hidden';
    return null;
  }

  collect(cells, weekId) {
    const seen = this.seen.get(weekId) ?? this.seen.set(weekId, new Set()).get(weekId);
    const found = [];
    for (const cell of cells) {
      const id = cellId(cell.x, cell.y);
      if (seen.has(id)) continue;
      const blocked = this.eligible(cell);
      if (blocked) { this.stats[blocked]++; continue; }
      seen.add(id);
      found.push({id, weekId});
    }
    this.stats.found += found.length;
    return found;
  }

  addFix(fix) {
    const {rules} = this;
    if (!fix || !finiteNumber(fix.lon) || !finiteNumber(fix.lat) || !finiteNumber(fix.time)
      || Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return this.reject('invalid');
    if (!finiteNumber(fix.accuracy) || fix.accuracy > rules.maxAccuracy) return this.reject('accuracy');
    const weekId = weekIdOf(fix.time);

    if (!this.last) {
      this.origin = {lon: fix.lon, lat: fix.lat};
      this.exempt = distanceMeters(this.origin, this.group.start) <= rules.startZoneRadius;
      return this.accept(fix, [cellOf(fix)], weekId);
    }

    const seconds = (fix.time - this.last.time) / 1000;
    if (seconds <= 0) return this.reject('time');
    const distance = distanceMeters(this.last, fix);
    const slack = Math.min(60, fix.accuracy + this.last.accuracy);
    if (distance - slack > rules.maxSpeed * seconds) return this.rejectFast(fix);

    const connected = distance <= rules.maxSegment && seconds <= rules.maxGapSeconds;
    return this.accept(fix, connected ? cellsOnSegment(this.last, fix) : [cellOf(fix)], weekId);
  }

  accept(fix, cells, weekId) {
    this.last = fix;
    this.candidate = null;
    this.rejectedStreak = 0;
    this.stats.accepted++;
    return {accepted: true, found: this.collect(cells, weekId)};
  }

  reject(reason) {
    this.stats.rejected++;
    return {accepted: false, reason, found: []};
  }

  // Een te snelle meting is waarschijnlijk een GPS-sprong. Bevestigen meerdere opeenvolgende
  // afgekeurde metingen elkaar, dan was de speler echt verplaatst en starten we een nieuw stuk.
  rejectFast(fix) {
    const {rules} = this;
    const previous = this.candidate;
    const seconds = previous ? (fix.time - previous.time) / 1000 : 0;
    const consistent = previous && seconds > 0
      && distanceMeters(previous, fix) - Math.min(60, fix.accuracy + previous.accuracy) <= rules.maxSpeed * seconds;
    this.candidate = fix;
    this.rejectedStreak = consistent ? this.rejectedStreak + 1 : 1;
    if (this.rejectedStreak >= rules.rebaseAfter) {
      return this.accept(fix, [cellOf(fix)], weekIdOf(fix.time));
    }
    return this.reject('speed');
  }
}
