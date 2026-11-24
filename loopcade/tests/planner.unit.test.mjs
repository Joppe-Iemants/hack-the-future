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

test('gepullde omgevingsvoorkeuren behouden gesloten routes en werkelijke afstanden', () => {
  const network = createNetwork(data);
  const start = network.nearest([(3.7219 - data.origin[0]) * data.scale[0], (51.05442 - data.origin[1]) * data.scale[1]]).id;
  for (const requested of [['nature', 'architecture'], ['river', 'canal'], ['major', 'minor']]) {
    const routes = makeRoutes(network, start, 5000, () => 0.42, requested);
    assert.ok(routes.length > 0, requested.join(', '));
    for (const route of routes) {
      assert.equal(route.ids[0], start);
      assert.equal(route.ids.at(-1), start);
      assert.deepEqual(route.matches.map(match => match.key), requested);
      let meters = 0;
      for (let index = 1; index < route.ids.length; index++) {
        const edge = network.edgeByPair.get(network.pair(route.ids[index - 1], route.ids[index]));
        assert.notEqual(edge, undefined, 'ieder routesegment volgt het wegennet');
        meters += network.edges[edge].length;
      }
      assert.ok(Math.abs(meters - route.meters) < 0.01);
    }
  }
});
