// Register van spelmodi. Een modus koppelt spelregels aan een puntentelling.
// Voor een nieuwe modus: schrijf een regelbestand en een scorefunctie en voeg hier één item toe.
import {territoryRules, describeTerritoryRules, TerritorySession, isCellInPlay} from './play-rules.mjs';
import {scoreTerritory} from './play-scoring.mjs';

const territory = Object.freeze({
  id: 'territory',
  title: 'Terreinjacht',
  summary: 'Verzamel de meeste kaartcellen door echt te wandelen of te lopen.',
  rules: territoryRules,
  describeRules: () => describeTerritoryRules(territoryRules),
  createSession: group => new TerritorySession(group, territoryRules),
  accepts: (id, group) => isCellInPlay(id, group, territoryRules),
  score: ({players, members, group}) => scoreTerritory({
    players, members, accepts: id => isCellInPlay(id, group, territoryRules), maxCells: territoryRules.maxCellsPerWeek,
  }),
});

export const gameModes = Object.freeze({[territory.id]: territory});
export const DEFAULT_MODE = territory.id;
export const getGameMode = id => gameModes[id] ?? null;
