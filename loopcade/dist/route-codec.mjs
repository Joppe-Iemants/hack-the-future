const PREFIX = 'v1.';
const MAX_POINTS = 6000;
const MAX_ENCODED_LENGTH = 700000;

// Decimeterprecisie en delta's houden routegeometrie ver onder Firestores 1 MiB-limiet.
export function encodePath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  const stride = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  const sampled = [];
  for (let i = 0; i < points.length; i += stride) sampled.push(points[i]);
  if (sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1));

  let previousX = 0, previousY = 0;
  const parts = sampled.map(point => {
    if (!Array.isArray(point) || point.length < 2
      || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error('Ongeldige routegeometrie.');
    }
    const x = Math.round(point[0] * 10), y = Math.round(point[1] * 10);
    const part = (x - previousX).toString(36) + ',' + (y - previousY).toString(36);
    previousX = x; previousY = y;
    return part;
  });
  const encoded = PREFIX + parts.join(';');
  if (encoded.length > MAX_ENCODED_LENGTH) throw new Error('De route is te groot om veilig op te slaan.');
  return encoded;
}

export function decodePath(encoded) {
  if (typeof encoded !== 'string' || !encoded.startsWith(PREFIX)
    || encoded.length > MAX_ENCODED_LENGTH) return [];
  const body = encoded.slice(PREFIX.length);
  if (!body) return [];
  const parts = body.split(';');
  if (parts.length > MAX_POINTS + 1) return [];
  let x = 0, y = 0;
  const points = [];
  for (const part of parts) {
    const match = /^(-?[0-9a-z]+),(-?[0-9a-z]+)$/.exec(part);
    if (!match) return [];
    const dx = parseInt(match[1], 36), dy = parseInt(match[2], 36);
    if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return [];
    x += dx; y += dy;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return [];
    points.push([x / 10, y / 10]);
  }
  return points;
}

export const routeCodecLimits = Object.freeze({maxPoints: MAX_POINTS, maxEncodedLength: MAX_ENCODED_LENGTH});
