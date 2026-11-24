// Puntentelling voor Spelen. Dit bestand kent geen GPS of Firestore: het rekent alleen met
// de cellen die spelers al hebben verzameld. Een nieuwe spelmodus kan een eigen functie leveren.
import {areaOf} from './play-grid.mjs';

// players: [{uid, cells: ['x_y', ...]}], members: [{uid, displayName}], accepts: id => boolean.
// Alleen leden tellen mee. Elke cel telt maximaal één keer per speler; spelers mogen dezelfde cel hebben.
export function scoreTerritory({players = [], members = [], accepts = () => true, maxCells = Infinity}) {
  const cellsByUid = new Map();
  for (const player of players) {
    const unique = new Set();
    for (const id of Array.isArray(player.cells) ? player.cells : []) {
      if (typeof id === 'string' && accepts(id) && unique.size < maxCells) unique.add(id);
    }
    cellsByUid.set(player.uid, unique);
  }
  const rows = members.map(member => {
    const cells = cellsByUid.get(member.uid) ?? new Set();
    return {uid: member.uid, name: member.displayName || 'Speler', cells: cells.size, area: areaOf(cells.size), cellIds: cells};
  }).sort((a, b) => b.cells - a.cells || a.name.localeCompare(b.name, 'nl') || a.uid.localeCompare(b.uid));

  // Gelijke stand deelt dezelfde plaats (1, 2, 2, 4).
  rows.forEach((row, index) => { row.rank = index && row.cells === rows[index - 1].cells ? rows[index - 1].rank : index + 1; });
  const winners = rows.length && rows[0].cells > 0 ? rows.filter(row => row.rank === 1).map(row => row.uid) : [];
  const holders = new Map();
  for (const row of rows) for (const id of row.cellIds) (holders.get(id) ?? holders.set(id, []).get(id)).push(row.uid);
  const standings = rows.map(({cellIds, ...row}) => row);
  const cellSets = new Map(rows.map(row => [row.uid, row.cellIds]));
  return {standings, winners, holders, cellsByUid: cellSets, totalCells: holders.size};
}

// Persoonlijke voortgang binnen een klassement.
export function progressFor(standings, uid, holders = new Map()) {
  const index = standings.findIndex(row => row.uid === uid);
  if (index < 0) return null;
  const me = standings[index], leader = standings[0];
  let shared = 0, exclusive = 0;
  for (const holderList of holders.values()) {
    if (!holderList.includes(uid)) continue;
    if (holderList.length > 1) shared++; else exclusive++;
  }
  return {
    rank: me.rank, players: standings.length, cells: me.cells, area: me.area,
    leading: me.rank === 1 && me.cells > 0, behind: Math.max(0, leader.cells - me.cells), leaderName: leader.name,
    shared, exclusive,
  };
}

// Onveranderlijke weekuitslag zoals die in Firestore wordt bewaard.
export function buildResult({weekId, mode, scored}) {
  return {
    weekId, mode,
    winners: scored.winners,
    totalCells: scored.totalCells,
    standings: scored.standings.map(({uid, name, cells, area, rank}) => ({uid, name, cells, area, rank})),
  };
}
