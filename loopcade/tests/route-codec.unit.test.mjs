import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePath, decodePath, routeCodecLimits} from '../dist/route-codec.mjs';

test('routegeometrie maakt een compacte, verliesarme roundtrip', () => {
  const path = [[0, 0], [12.34, -8.91], [5000.25, 1250.04], [0, 0]];
  const encoded = encodePath(path);
  assert.ok(encoded.startsWith('v1.'));
  assert.deepEqual(decodePath(encoded), [[0, 0], [12.3, -8.9], [5000.3, 1250], [0, 0]]);
  assert.ok(encoded.length < JSON.stringify(path).length);
});

test('lege en ongeldige geometrie wordt veilig afgehandeld', () => {
  assert.equal(encodePath([]), '');
  assert.deepEqual(decodePath(''), []);
  assert.deepEqual(decodePath('v1.ongeldig'), []);
  assert.throws(() => encodePath([[Infinity, 0]]));
});

test('zeer lange routes worden begrensd en behouden start en finish', () => {
  const path = Array.from({length: routeCodecLimits.maxPoints * 2 + 10}, (_, i) => [i, i % 20]);
  const decoded = decodePath(encodePath(path));
  assert.ok(decoded.length <= routeCodecLimits.maxPoints + 1);
  assert.deepEqual(decoded[0], [0, 0]);
  assert.deepEqual(decoded.at(-1), path.at(-1));
});
