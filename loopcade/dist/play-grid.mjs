// Het speelraster: vaste cellen van circa 100 × 100 m (1 hectare) op lengte/breedte.
// Dezelfde constanten gelden voor iedereen, zodat een cel voor alle spelers dezelfde is.
export const CELL_METERS = 100;
export const CELL_AREA_M2 = CELL_METERS * CELL_METERS;
// Meters per graad op 51,05° N; dezelfde schaal als de bestaande Gentse kaart.
const METERS_PER_DEGREE = {lon: 69980.42, lat: 111320};
export const LON_STEP = CELL_METERS / METERS_PER_DEGREE.lon;
export const LAT_STEP = CELL_METERS / METERS_PER_DEGREE.lat;

const CELL_PATTERN = /^-?\d{1,7}_-?\d{1,7}$/;

export const cellId = (x, y) => x + '_' + y;
export function parseCellId(id) {
  if (typeof id !== 'string' || !CELL_PATTERN.test(id)) return null;
  const [x, y] = id.split('_').map(Number);
  return {x, y};
}

export function cellOf({lon, lat}) {
  return {x: Math.floor(lon / LON_STEP), y: Math.floor(lat / LAT_STEP)};
}
export const cellIdOf = point => { const {x, y} = cellOf(point); return cellId(x, y); };

export const cellCenter = ({x, y}) => ({lon: (x + .5) * LON_STEP, lat: (y + .5) * LAT_STEP});
export const cellBounds = ({x, y}) => ({west: x * LON_STEP, south: y * LAT_STEP, east: (x + 1) * LON_STEP, north: (y + 1) * LAT_STEP});

export function distanceMeters(a, b) {
  return Math.hypot((b.lon - a.lon) * METERS_PER_DEGREE.lon, (b.lat - a.lat) * METERS_PER_DEGREE.lat);
}

// Alle cellen die het rechte stuk tussen twee GPS-punten doorkruist (Amanatides & Woo).
// Raakt het stuk exact een hoek, dan telt alleen de diagonale buurcel.
export function cellsOnSegment(a, b) {
  const x0 = a.lon / LON_STEP, y0 = a.lat / LAT_STEP, x1 = b.lon / LON_STEP, y1 = b.lat / LAT_STEP;
  let x = Math.floor(x0), y = Math.floor(y0);
  const endX = Math.floor(x1), endY = Math.floor(y1);
  const cells = [{x, y}];
  const dx = x1 - x0, dy = y1 - y0;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx ? Math.abs(1 / dx) : Infinity, deltaY = dy ? Math.abs(1 / dy) : Infinity;
  let maxX = dx > 0 ? (x + 1 - x0) / dx : dx < 0 ? (x0 - x) / -dx : Infinity;
  let maxY = dy > 0 ? (y + 1 - y0) / dy : dy < 0 ? (y0 - y) / -dy : Infinity;
  let guard = Math.abs(endX - x) + Math.abs(endY - y) + 2;
  while ((x !== endX || y !== endY) && guard-- > 0) {
    if (maxX < maxY) { x += stepX; maxX += deltaX; }
    else if (maxY < maxX) { y += stepY; maxY += deltaY; }
    else { x += stepX; y += stepY; maxX += deltaX; maxY += deltaY; }
    cells.push({x, y});
  }
  if (x !== endX || y !== endY) cells.push({x: endX, y: endY});
  return cells;
}

export const cellsToIds = cells => cells.map(({x, y}) => cellId(x, y));

// Oppervlakte in m² van een aantal cellen.
export const areaOf = cellCount => cellCount * CELL_AREA_M2;
export const formatArea = cellCount => {
  const hectares = areaOf(cellCount) / 10000;
  return hectares.toLocaleString('nl-BE', {maximumFractionDigits: 0}) + ' ha';
};
