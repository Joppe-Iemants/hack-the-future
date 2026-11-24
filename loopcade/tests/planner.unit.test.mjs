import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNetwork, makeRoutes} from '../dist/router.mjs';

const data = JSON.parse(readFileSync(new URL('../dist/gent.json', import.meta.url), 'utf8'));

test('bestaande routeplanner genereert nog een gesloten rondje', () => {
  const network = createNetwork(data);
  const start = network.nearest([(3.7219 - data.origin[0]) * data.scale[0], (51.05442 - data.origin[1]) * data.scale[1]]).id;
  const routes = makeRoutes(network, start, 5000, () => 0.42);
  assert.ok(routes.length > 0);
  assert.equal(routes[0].ids[0], start);
  assert.equal(routes[0].ids.at(-1), start);
  assert.ok(routes[0].meters > 0);
});
